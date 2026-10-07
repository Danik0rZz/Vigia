import { constants as cryptoConstants, createHash, X509Certificate } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { createServer, type Server } from 'node:https'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { removeDir } from './cleanup'
import { captureOnFailure } from './failure-capture'
import { FIXED_WINDOW, fitsContentSize, useCiWindow } from './window-size'
import { generate } from 'selfsigned'

/**
 * Fase 4, certificados TLS y "Probar conexión" sobre la app compilada (`out/`),
 * contra un servidor HTTPS en 127.0.0.1 con certificados autofirmados generados
 * aquí (no se guardan en disco).
 *
 * Recorrido: system (no confiable) → aceptar huella (pinned, conecta) → el
 * servidor cambia de certificado (mismatch, el pin no cambia solo) → aceptar
 * la nueva → ignore (conecta con cualquiera y avisa) → vuelta a system (otra
 * vez no confiable: la caché de verificación no sobrevive al cambio de nivel).
 */
test.describe.configure({ mode: 'serial' })

const TOKEN = `dt0c01.PUBLICAPRUEBA0000000000A.${'SECRETOE2ETLS'.padEnd(64, 'X')}`

let app: ElectronApplication
let page: Page
let userDataDir: string
captureOnFailure(() => ({ page, userDataDir }))
let server: Server | null = null
let port = 0
let host = ''
let environmentId = ''
let clientId = ''
const fingerprints: string[] = []
/** Segundo servidor, en 'localhost' (otro hostname): hace de SSO ajeno al entorno. */
let ssoServer: Server | null = null
let ssoRequests = 0
const CLIENT_SECRET = `dt0s02.CLIENTEPUBLICO00000000000.${'SECRETOE2ESSO'.padEnd(64, 'X')}`
/** Token que emite el SSO fijado de P3-7 (no es un secreto real). */
const SSO_ACCESS_TOKEN = 'ACCESOSSOFIJADOE2E'
const consoleErrors: string[] = []
const rendererRemote: string[] = []
const ipcOutputs: string[] = []

/** Certificado autofirmado para 127.0.0.1 (o localhost) y su huella como la da Electron ("sha256/<base64>"). */
async function newCertificate(
  name: '127.0.0.1' | 'localhost' = '127.0.0.1'
): Promise<{ key: string; cert: string; fingerprint: string }> {
  const pems = await generate([{ name: 'commonName', value: name }], {
    keySize: 2048,
    algorithm: 'sha256',
    extensions: [
      {
        name: 'subjectAltName',
        altNames: [name === 'localhost' ? { type: 2, value: 'localhost' } : { type: 7, ip: name }]
      }
    ]
  })
  const der = new X509Certificate(pems.cert).raw
  return {
    key: pems.private,
    cert: pems.cert,
    fingerprint: `sha256/${createHash('sha256').update(der).digest('base64')}`
  }
}

/** Arranca (o rearranca en el mismo puerto) el Dynatrace simulado con un certificado nuevo. */
async function startServer(): Promise<string> {
  if (server !== null) {
    const old = server
    old.closeAllConnections()
    await new Promise<void>((resolve) => old.close(() => resolve()))
  }
  const { key, cert, fingerprint } = await newCertificate()
  server = createServer(
    // Sin tickets de sesión: cada conexión presenta el certificado y se vuelve a verificar.
    { key, cert, secureOptions: cryptoConstants.SSL_OP_NO_TICKET },
    (req, res) => {
      let raw = ''
      req.on('data', (chunk: Buffer) => (raw += chunk.toString('utf8')))
      req.on('end', () => {
        const send = (status: number, body: unknown): void => {
          res.writeHead(status, { 'content-type': 'application/json', connection: 'close' })
          res.end(JSON.stringify(body))
        }
        if (req.method === 'POST' && req.url === '/api/v2/apiTokens/lookup') {
          if (req.headers.authorization !== `Api-Token ${TOKEN}`) {
            return send(401, { error: { code: 401, message: 'Missing or invalid token' } })
          }
          return send(200, {
            id: 'dt0c01.PUBLICAPRUEBA0000000000A',
            name: 'e2e',
            enabled: true,
            scopes: ['problems.read', 'metrics.read', 'slo.read', 'entities.read']
          })
        }
        // P3-7: la comprobación de plataforma de OAuth, solo con el token del SSO de prueba.
        if (req.method === 'GET' && req.url === '/platform/management/v1/environment') {
          if (req.headers.authorization !== `Bearer ${SSO_ACCESS_TOKEN}`) {
            return send(401, { error: { code: 401, message: 'Missing or invalid token' } })
          }
          return send(200, {
            environmentId: 'e2e',
            createTime: '2026-01-01T00:00:00Z',
            type: 'saas',
            state: 'ACTIVE'
          })
        }
        send(404, { error: { code: 404, message: 'No existe' } })
      })
    }
  )
  await new Promise<void>((resolve) => server?.listen(port, '127.0.0.1', resolve))
  port = (server.address() as AddressInfo).port
  host = `127.0.0.1:${port}`
  fingerprints.push(fingerprint)
  return fingerprint
}

/** Llama a un canal IPC desde la interfaz y guarda la respuesta para buscar secretos. */
async function invoke<T = unknown>(channel: string, input?: unknown): Promise<T> {
  const result = await page.evaluate(
    ([name, payload]) => {
      const api = (
        window as unknown as { vigia: { invoke: (...args: unknown[]) => Promise<unknown> } }
      ).vigia
      return payload === undefined ? api.invoke(name) : api.invoke(name, payload)
    },
    [channel, input] as const
  )
  ipcOutputs.push(`${channel}: ${JSON.stringify(result)}`)
  const envelope = result as { ok: boolean; data?: unknown; error?: unknown }
  if (!envelope.ok) throw new Error(`${channel} falló: ${JSON.stringify(envelope.error)}`)
  return envelope.data as T
}

type Mechanism = {
  id: string
  state: string
  error: { code: string } | null
  missingScopes: string[]
}
type Report = {
  mechanisms: Mechanism[]
  untrustedCertificates: {
    host: string
    fingerprint: string
    reason: string
    previousFingerprint: string | null
  }[]
}

/**
 * Recarga la interfaz tras un cambio hecho solo por IPC. La interfaz no recibe
 * eventos de main: lo que cambia por IPC directo no lo ve hasta recargar. Los
 * cambios hechos desde la propia interfaz se actualizan solos.
 */
async function reloadUi(): Promise<void> {
  await page.reload()
  await page.waitForLoadState('domcontentloaded')
}

async function testConnection(): Promise<Report> {
  return invoke<Report>('connection:test', { environmentId })
}

async function setLevel(
  level: 'system' | 'pinned' | 'ignore',
  extra: Record<string, unknown> = {}
): Promise<void> {
  const list = await invoke<{ environments: Record<string, unknown>[] }>('tenants:list')
  const env = list.environments.find((e) => e['id'] === environmentId) ?? {}
  const input: Record<string, unknown> = { ...env, ...extra, certificateLevel: level }
  delete input['secrets']
  await invoke('environments:update', input)
  await reloadUi()
}

async function openEnvironmentForm(): Promise<void> {
  await page.getByTestId('nav-settings').click()
  await page
    .getByTestId('environment-row')
    .filter({ hasText: 'Local' })
    .getByTestId('environment-edit')
    .click()
  await expect(page.getByTestId('environment-form')).toBeVisible()
}

async function closeEnvironmentForm(): Promise<void> {
  await page.getByTestId('environment-form').getByTestId('form-cancel').click()
  await expect(page.getByTestId('environment-form')).toBeHidden()
}

test.beforeAll(async () => {
  test.setTimeout(120_000)
  await startServer()
  userDataDir = mkdtempSync(join(tmpdir(), 'vigia-e2e-tls-'))
  app = await electron.launch({
    // VIGIA_E2E_NO_SANDBOX solo hace falta en contenedores Linux que ejecutan como root.
    args: ['.', ...(process.env['VIGIA_E2E_NO_SANDBOX'] ? ['--no-sandbox'] : [])],
    env: { ...process.env, VIGIA_USER_DATA_DIR: userDataDir, VIGIA_E2E: '1' }
  })
  await useCiWindow(app)
  page = await app.firstWindow()
  // Nunca la carpeta real de datos: la temporal de esta prueba.
  expect(await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'))).toBe(
    userDataDir
  )
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(error.message))
  page.on('request', (request) => {
    if (/^(https?|wss?):/i.test(request.url())) rendererRemote.push(request.url())
  })
  await page.waitForLoadState('domcontentloaded')

  const client = await invoke<{ id: string }>('clients:create', {
    name: 'Cliente TLS',
    color: '#336699'
  })
  clientId = client.id
  const env = await invoke<{ id: string }>('environments:create', {
    clientId,
    name: 'Local',
    type: 'production',
    deployment: 'saas',
    classicApiUrl: `https://127.0.0.1:${port}`,
    platformUrl: null,
    ssoUrl: null,
    oauthClientId: null,
    oauthScopes: [],
    accountUuid: null,
    certificateLevel: 'system',
    captureUrlPatterns: [],
    tags: [],
    readOnly: false
  })
  environmentId = env.id
  await invoke('secrets:set', { environmentId, kind: 'classicToken', value: TOKEN })
  await invoke('environments:setActive', { environmentId })
  await reloadUi()
})

test.afterAll(async () => {
  try {
    await app?.close()
  } finally {
    // Aunque falle el cierre, los servidores se paran y la carpeta temporal se borra.
    ssoServer?.closeAllConnections()
    await new Promise<void>((resolve) => (ssoServer ? ssoServer.close(() => resolve()) : resolve()))
    server?.closeAllConnections()
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()))
    removeDir(userDataDir)
  }
})

/** Ficha 0021: todos los e2e corren con el contenido de la ventana del CI (useCiWindow). */
test('CA2 (0021): al empezar, el contenido de la ventana mide 1024×720 (con el margen de 2 px)', async () => {
  const size = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))
  expect(fitsContentSize(size, FIXED_WINDOW), `contenido de ${size.width}×${size.height}`).toBe(
    true
  )
})

test('nivel system: certificado no confiable, con su host y su huella', async () => {
  const report = await testConnection()
  expect(report.mechanisms).toEqual([
    expect.objectContaining({
      id: 'classic',
      state: 'disconnected',
      error: expect.objectContaining({ code: 'TLS_UNTRUSTED' })
    })
  ])
  expect(report.untrustedCertificates).toEqual([
    { host, fingerprint: fingerprints[0], reason: 'untrusted', previousFingerprint: null }
  ])
  expect(await invoke('certificates:list', { environmentId })).toEqual([])
})

test('i18n (b): con la interfaz en inglés, el motivo del error de main sale en inglés', async () => {
  // Botón de idioma de la barra superior (topbar.language en cada idioma).
  await page.getByRole('button', { name: 'Cambiar a inglés' }).click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  try {
    await openEnvironmentForm()
    const form = page.getByTestId('environment-form')
    await form.getByTestId('connection-test').click()
    const result = form.getByTestId('connection-result-classic')
    // El motivo tlsUntrusted {host} traducido, con el host:puerto del servidor simulado.
    await expect(result).toContainText(`The certificate of ${host} is not trusted.`)
    await expect(result).not.toContainText('no es de confianza')
    await closeEnvironmentForm()
  } finally {
    await page.getByRole('button', { name: 'Switch to Spanish' }).click()
    await expect(page.locator('html')).toHaveAttribute('lang', 'es')
  }

  // En español, el mismo motivo en español.
  await openEnvironmentForm()
  const form = page.getByTestId('environment-form')
  await form.getByTestId('connection-test').click()
  await expect(form.getByTestId('connection-result-classic')).toContainText(
    `El certificado de ${host} no es de confianza.`
  )
  await closeEnvironmentForm()
})

test('AUD-21 (P3-2): aceptar una huella que ya no ofrece la última prueba da error y no fija nada', async () => {
  await openEnvironmentForm()
  const form = page.getByTestId('environment-form')
  await form.getByTestId('connection-test').click()
  const block = form.getByTestId('certificate-untrusted')
  await expect(block).toHaveCount(1)
  await expect(block.getByTestId('certificate-new-fingerprint')).toHaveText(fingerprints[0] ?? '')

  // Por detrás (IPC directo: la interfaz no se entera), el entorno pasa a "ignorar" y
  // se vuelve a probar. Esa prueba ya no ofrece ningún certificado.
  const list = await invoke<{ environments: Record<string, unknown>[] }>('tenants:list')
  const env = list.environments.find((e) => e['id'] === environmentId) ?? {}
  const input: Record<string, unknown> = { ...env, certificateLevel: 'ignore' }
  delete input['secrets']
  delete input['unreadableSecrets']
  await invoke('environments:update', input)
  const report = await testConnection()
  expect(report.untrustedCertificates).toEqual([])

  // La interfaz todavía enseña el certificado de antes: aceptarlo falla.
  await block.getByTestId('certificate-accept').click()
  await expect(form.getByTestId('certificate-accept-error')).toHaveText(
    'No se ha podido aceptar la huella. Vuelve a probar la conexión.'
  )
  expect(await invoke('certificates:list', { environmentId })).toEqual([])

  // Se deja como estaba: nivel system, sin huellas y con la interfaz recargada.
  await closeEnvironmentForm()
  await setLevel('system')
  const after = await invoke<{ environments: { id: string; certificateLevel: string }[] }>(
    'tenants:list'
  )
  expect(after.environments.find((e) => e.id === environmentId)?.certificateLevel).toBe('system')
  expect(await invoke('certificates:list', { environmentId })).toEqual([])
})

test('la interfaz muestra el fallo y el certificado; aceptarlo lo fija y pasa a pinned', async () => {
  await openEnvironmentForm()
  const form = page.getByTestId('environment-form')
  await form.getByTestId('connection-test').click()

  await expect(form.getByTestId('connection-result-classic')).toContainText('Sin conexión')
  const block = form.getByTestId('certificate-untrusted')
  await expect(block).toHaveCount(1)
  await expect(block).toContainText(host)
  await expect(block.getByTestId('certificate-new-fingerprint')).toHaveText(fingerprints[0] ?? '')
  await expect(block.getByTestId('certificate-previous-fingerprint')).toHaveCount(0)
  await expect(page.getByTestId('env-status')).toContainText('Sin conexión')

  await block.getByTestId('certificate-accept').click()
  await expect
    .poll(() => invoke('certificates:list', { environmentId }))
    .toEqual([{ host, fingerprint: fingerprints[0] }])
  const list = await invoke<{ environments: { id: string; certificateLevel: string }[] }>(
    'tenants:list'
  )
  expect(list.environments.find((e) => e.id === environmentId)?.certificateLevel).toBe('pinned')
})

test('con la huella fijada conecta, sin scopes que falten', async () => {
  const form = page.getByTestId('environment-form')
  await form.getByTestId('connection-test').click()
  await expect(form.getByTestId('connection-result-classic')).toContainText('Conectado')
  await expect(form.getByTestId('certificate-untrusted')).toHaveCount(0)
  await expect(page.getByTestId('env-status')).toContainText('Token clásico')
  await expect(page.getByTestId('env-status')).toContainText('Conectado')

  // Información del token: nombre, sin caducidad y sus scopes (ninguno falta ni sobra).
  const info = form.getByTestId('token-info-classic')
  await expect(info).toBeVisible()
  await expect(info).toContainText('e2e')
  await expect(info).toContainText('Sin caducidad')
  const granted = info.getByTestId('token-scopes-granted')
  for (const scope of ['problems.read', 'metrics.read', 'slo.read', 'entities.read'])
    await expect(granted).toContainText(scope)
  await expect(info.getByTestId('token-scopes-missing')).not.toContainText('.read')
  await expect(info.getByTestId('token-scopes-extra')).not.toContainText('.read')
  await expect(form.getByTestId('token-disabled')).toHaveCount(0)
  await expect(page.locator('body')).not.toContainText('SECRETOE2ETLS')
  await closeEnvironmentForm()

  const report = await testConnection()
  expect(report.mechanisms).toEqual([
    {
      id: 'classic',
      state: 'connected',
      error: null,
      missingScopes: [],
      tokenInfo: {
        name: 'e2e',
        enabled: true,
        expiresAt: null,
        scopes: {
          granted: ['entities.read', 'metrics.read', 'problems.read', 'slo.read'],
          missing: [],
          extra: []
        }
      }
    }
  ])
  expect(report.untrustedCertificates).toEqual([])
})

test('AUD-18: el resultado de «Probar conexión» se borra al cambiar las credenciales', async () => {
  await openEnvironmentForm()
  const form = page.getByTestId('environment-form')
  const result = form.getByTestId('connection-result-classic')
  const confirm = page.getByTestId('confirm-dialog')

  // Un secreto de plataforma guardado y una prueba con resultado.
  await form.getByTestId('secret-input-platformToken').fill('dt0s16.FALSOAUD18.RESET')
  await form.getByTestId('secret-save-platformToken').click()
  await expect(form.getByTestId('secret-status-platformToken')).toHaveText('Configurado')
  await form.getByTestId('connection-test').click()
  await expect(result).toContainText('Conectado')

  // Borrar el secreto (confirmando): el resultado anterior ya no vale y desaparece.
  await form.getByTestId('secret-delete-platformToken').click()
  await confirm.getByTestId('confirm-accept').click()
  await expect(form.getByTestId('secret-status-platformToken')).toHaveText('Sin configurar')
  await expect(result).toHaveCount(0)

  // Guardar un secreto también lo reinicia.
  await form.getByTestId('connection-test').click()
  await expect(result).toContainText('Conectado')
  await form.getByTestId('secret-input-classicToken').fill(TOKEN)
  await form.getByTestId('secret-save-classicToken').click()
  await expect(result).toHaveCount(0)

  // Cancelar la confirmación de borrado no lo reinicia.
  await form.getByTestId('connection-test').click()
  await expect(result).toContainText('Conectado')
  await form.getByTestId('secret-delete-classicToken').click()
  await confirm.getByTestId('confirm-cancel').click()
  await expect(form.getByTestId('secret-status-classicToken')).toHaveText('Configurado')
  await expect(result).toContainText('Conectado')
  await closeEnvironmentForm()
})

test('si el servidor cambia de certificado: TLS_PIN_MISMATCH y el pin NO cambia solo', async () => {
  await startServer()
  const report = await testConnection()

  expect(report.mechanisms[0]).toMatchObject({
    id: 'classic',
    state: 'disconnected',
    error: { code: 'TLS_PIN_MISMATCH' }
  })
  expect(report.untrustedCertificates).toEqual([
    { host, fingerprint: fingerprints[1], reason: 'mismatch', previousFingerprint: fingerprints[0] }
  ])
  expect(await invoke('certificates:list', { environmentId })).toEqual([
    { host, fingerprint: fingerprints[0] }
  ])
  // Volver a probar no lo cambia tampoco.
  await testConnection()
  expect(await invoke('certificates:list', { environmentId })).toEqual([
    { host, fingerprint: fingerprints[0] }
  ])
})

test('la interfaz muestra la huella antigua y la nueva; aceptar fija la nueva y vuelve a conectar', async () => {
  await openEnvironmentForm()
  const form = page.getByTestId('environment-form')
  await form.getByTestId('connection-test').click()

  const block = form.getByTestId('certificate-untrusted')
  await expect(block).toContainText(host)
  await expect(block.getByTestId('certificate-previous-fingerprint')).toHaveText(
    fingerprints[0] ?? ''
  )
  await expect(block.getByTestId('certificate-new-fingerprint')).toHaveText(fingerprints[1] ?? '')
  await block.getByTestId('certificate-accept').click()

  await expect
    .poll(() => invoke('certificates:list', { environmentId }))
    .toEqual([{ host, fingerprint: fingerprints[1] }])
  await form.getByTestId('connection-test').click()
  await expect(form.getByTestId('connection-result-classic')).toContainText('Conectado')
  await closeEnvironmentForm()
  expect((await testConnection()).mechanisms[0]).toMatchObject({ state: 'connected' })
})

test('nivel ignore: conecta con un certificado desconocido; avisa en la tarjeta y en el formulario, no en la barra', async () => {
  await startServer() // tercer certificado, ni fijado ni confiable
  await expect(page.getByTestId('env-status-certificates')).toHaveCount(0)

  await setLevel('ignore')
  const report = await testConnection()
  expect(report.mechanisms[0]).toMatchObject({ id: 'classic', state: 'connected' })
  expect(report.untrustedCertificates).toEqual([])

  // Ya no hay aviso rojo en la barra superior: va a una línea de la tarjeta.
  await expect(page.getByTestId('tls-ignore-warning')).toHaveCount(0)
  await expect(page.getByTestId('env-status-certificates')).toContainText('Certificados: ignorados')

  // En el formulario, el aviso acompaña al select y está asociado con aria-describedby.
  await openEnvironmentForm()
  const form = page.getByTestId('environment-form')
  const level = form.getByTestId('environment-certificate-level')
  const warning = form.getByTestId('certificate-ignore-warning')
  await expect(level).toHaveValue('ignore')
  await expect(warning).toBeVisible()
  await expect(warning).toHaveAttribute('role', 'alert')
  await expect(warning).toContainText('Cualquiera en la red podría hacerse pasar por este entorno')
  const warningId = await warning.getAttribute('id')
  expect(warningId).toBeTruthy()
  expect((await level.getAttribute('aria-describedby'))?.split(/\s+/)).toContain(warningId)

  // Con otro nivel en el select, el aviso desaparece (sin guardar).
  await level.selectOption('pinned')
  await expect(form.getByTestId('certificate-ignore-warning')).toHaveCount(0)
  await closeEnvironmentForm()
})

test('nivel ignore NO vale para el SSO: un SSO ajeno autofirmado falla y no recibe el client_secret', async () => {
  // SSO en 'localhost', un hostname distinto de los del entorno (127.0.0.1).
  const { key, cert } = await newCertificate('localhost')
  ssoServer = createServer({ key, cert }, (_req, res) => {
    ssoRequests += 1
    res.writeHead(200, { 'content-type': 'application/json', connection: 'close' })
    res.end(JSON.stringify({ access_token: 'NOSEDEBEUSAR', expires_in: 300, token_type: 'Bearer' }))
  })
  await new Promise<void>((resolve) => ssoServer?.listen(0, '127.0.0.1', resolve))
  const ssoPort = (ssoServer.address() as AddressInfo).port

  await setLevel('ignore', {
    oauthClientId: 'dt0s02.CLIENTEPUBLICO00000000000',
    oauthScopes: ['platform-management:environments:read'],
    ssoUrl: `https://localhost:${ssoPort}/sso/oauth2/token`
  })
  await invoke('secrets:set', { environmentId, kind: 'oauthClientSecret', value: CLIENT_SECRET })

  const report = await testConnection()
  expect(report.mechanisms.find((m) => m.id === 'classic')).toMatchObject({ state: 'connected' })
  expect(report.mechanisms.find((m) => m.id === 'oauth')).toMatchObject({
    state: 'disconnected',
    error: { code: 'TLS_UNTRUSTED' }
  })
  expect(report.untrustedCertificates.filter((c) => c.host === host)).toEqual([])
  // El handshake TLS falla antes de enviar nada: el SSO falso no ha recibido ninguna petición.
  expect(ssoRequests).toBe(0)

  // Se deja el entorno como estaba para los pasos siguientes.
  await invoke('secrets:delete', { environmentId, kind: 'oauthClientSecret' })
  await setLevel('ignore', { oauthClientId: null, oauthScopes: [], ssoUrl: null })
})

test('P3-7: el certificado del SSO se ofrece en «Probar conexión», se puede fijar y entonces OAuth conecta', async () => {
  // SSO propio con certificado autofirmado en 'localhost' (distinto del host del entorno).
  ssoServer?.closeAllConnections()
  await new Promise<void>((resolve) => (ssoServer ? ssoServer.close(() => resolve()) : resolve()))
  const { key, cert, fingerprint: ssoFingerprint } = await newCertificate('localhost')
  ssoServer = createServer({ key, cert }, (_req, res) => {
    ssoRequests += 1
    res.writeHead(200, { 'content-type': 'application/json', connection: 'close' })
    res.end(
      JSON.stringify({
        access_token: SSO_ACCESS_TOKEN,
        expires_in: 300,
        token_type: 'Bearer',
        scope: 'platform-management:environments:read'
      })
    )
  })
  await new Promise<void>((resolve) => ssoServer?.listen(0, '127.0.0.1', resolve))
  const ssoHost = `localhost:${(ssoServer.address() as AddressInfo).port}`
  const requestsBefore = ssoRequests

  await setLevel('pinned', {
    platformUrl: `https://${host}`,
    oauthClientId: 'dt0s02.CLIENTEPUBLICO00000000000',
    oauthScopes: ['platform-management:environments:read'],
    ssoUrl: `https://${ssoHost}/sso/oauth2/token`
  })
  await invoke('secrets:set', { environmentId, kind: 'oauthClientSecret', value: CLIENT_SECRET })
  try {
    // 1) La prueba ofrece el certificado del SSO (y no le ha llegado nada: el TLS falla antes).
    const first = await testConnection()
    expect(first.mechanisms.find((m) => m.id === 'oauth')).toMatchObject({
      state: 'disconnected',
      error: { code: 'TLS_UNTRUSTED' }
    })
    const offeredSso = first.untrustedCertificates.find((c) => c.host === ssoHost)
    expect(offeredSso).toEqual({
      host: ssoHost,
      fingerprint: ssoFingerprint,
      reason: 'untrusted',
      previousFingerprint: null
    })
    expect(ssoRequests).toBe(requestsBefore)

    // 2) Se fija la huella del SSO (y la del host del entorno, que la prueba también ofrece).
    for (const certificate of first.untrustedCertificates) {
      await invoke('certificates:pin', {
        environmentId,
        host: certificate.host,
        fingerprint: certificate.fingerprint
      })
    }
    const pinned = await invoke<{ host: string; fingerprint: string }[]>('certificates:list', {
      environmentId
    })
    expect(pinned).toContainEqual({ host: ssoHost, fingerprint: ssoFingerprint })

    // 3) Con la huella fijada, la siguiente prueba conecta OAuth (el SSO emite el token y la
    // plataforma lo acepta).
    const second = await testConnection()
    expect(second.mechanisms.find((m) => m.id === 'oauth')).toMatchObject({
      state: 'connected',
      error: null
    })
    expect(second.untrustedCertificates.filter((c) => c.host === ssoHost)).toEqual([])
    expect(ssoRequests).toBeGreaterThan(requestsBefore)
  } finally {
    // Se deja como estaba: sin OAuth, sin plataforma, sin la huella del SSO y en 'ignore'.
    await invoke('certificates:unpin', { environmentId, host: ssoHost })
    await invoke('secrets:delete', { environmentId, kind: 'oauthClientSecret' })
    await setLevel('ignore', {
      platformUrl: null,
      oauthClientId: null,
      oauthScopes: [],
      ssoUrl: null
    })
  }
})

test('de vuelta a system: otra vez no confiable (no queda nada en caché) y sin aviso', async () => {
  await setLevel('system')
  const report = await testConnection()
  expect(report.mechanisms[0]).toMatchObject({
    state: 'disconnected',
    error: { code: 'TLS_UNTRUSTED' }
  })
  expect(report.untrustedCertificates[0]).toMatchObject({
    host,
    fingerprint: fingerprints[2],
    reason: 'untrusted'
  })
  await expect(page.getByTestId('tls-ignore-warning')).toHaveCount(0)
  await expect(page.getByTestId('env-status-certificates')).toHaveCount(0)
})

test('connection:status devuelve el último informe y se borra al cambiar el entorno', async () => {
  const status = await invoke<{ mechanisms: Mechanism[] } | null>('connection:status', {
    environmentId
  })
  expect(status?.mechanisms[0]).toMatchObject({ error: { code: 'TLS_UNTRUSTED' } })

  await setLevel('ignore')
  expect(await invoke('connection:status', { environmentId })).toBeNull()
})

test('una URL clásica con /api/v2 se normaliza en el formulario y se guarda sin el sufijo', async () => {
  await openEnvironmentForm()
  const form = page.getByTestId('environment-form')
  const field = form.getByTestId('environment-classic-url')
  await field.fill(`https://127.0.0.1:${port}/API/v2/`)
  await field.press('Tab')

  await expect(field).toHaveValue(`https://127.0.0.1:${port}`)
  await expect(field).not.toHaveAttribute('aria-invalid', 'true')

  await form.getByTestId('form-save').click()
  await expect(form).toBeHidden()
  const list = await invoke<{ environments: { id: string; classicApiUrl: string | null }[] }>(
    'tenants:list'
  )
  expect(list.environments.find((e) => e.id === environmentId)?.classicApiUrl).toBe(
    `https://127.0.0.1:${port}`
  )
})

test('ninguna respuesta IPC contiene el token, y sin errores de consola ni peticiones remotas del renderer', async () => {
  for (const output of ipcOutputs) expect(output).not.toContain('SECRETOE2ETLS')
  expect(await page.content()).not.toContain('SECRETOE2ETLS')
  expect(consoleErrors).toEqual([])
  // Las peticiones a 127.0.0.1 las hace main; el renderer no habla con ningún servidor.
  expect(rendererRemote).toEqual([])
})
