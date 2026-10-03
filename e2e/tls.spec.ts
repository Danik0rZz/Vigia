import { constants as cryptoConstants, createHash, X509Certificate } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
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
let server: Server | null = null
let port = 0
let host = ''
let environmentId = ''
let clientId = ''
const fingerprints: string[] = []
const consoleErrors: string[] = []
const rendererRemote: string[] = []
const ipcOutputs: string[] = []

/** Certificado autofirmado para 127.0.0.1 y su huella como la da Electron ("sha256/<base64>"). */
async function newCertificate(): Promise<{ key: string; cert: string; fingerprint: string }> {
  const pems = await generate([{ name: 'commonName', value: '127.0.0.1' }], {
    keySize: 2048,
    algorithm: 'sha256',
    extensions: [{ name: 'subjectAltName', altNames: [{ type: 7, ip: '127.0.0.1' }] }]
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
            scopes: ['problems.read', 'metrics.read', 'slo.read']
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

async function setLevel(level: 'system' | 'pinned' | 'ignore'): Promise<void> {
  const list = await invoke<{ environments: Record<string, unknown>[] }>('tenants:list')
  const env = list.environments.find((e) => e['id'] === environmentId) ?? {}
  const input: Record<string, unknown> = { ...env, certificateLevel: level }
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
    env: { ...process.env, VIGIA_USER_DATA_DIR: userDataDir }
  })
  page = await app.firstWindow()
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
  await app?.close()
  server?.closeAllConnections()
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()))
  rmSync(userDataDir, { recursive: true, force: true })
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
  await closeEnvironmentForm()

  const report = await testConnection()
  expect(report.mechanisms).toEqual([
    { id: 'classic', state: 'connected', error: null, missingScopes: [] }
  ])
  expect(report.untrustedCertificates).toEqual([])
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

test('nivel ignore: conecta con un certificado desconocido y la barra superior avisa', async () => {
  await startServer() // tercer certificado, ni fijado ni confiable
  await expect(page.getByTestId('tls-ignore-warning')).toHaveCount(0)

  await setLevel('ignore')
  const report = await testConnection()
  expect(report.mechanisms[0]).toMatchObject({ id: 'classic', state: 'connected' })
  expect(report.untrustedCertificates).toEqual([])

  const warning = page.getByTestId('tls-ignore-warning')
  await expect(warning).toBeVisible()
  await expect(warning).toHaveAttribute('role', 'alert')
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
})

test('connection:status devuelve el último informe y se borra al cambiar el entorno', async () => {
  const status = await invoke<{ mechanisms: Mechanism[] } | null>('connection:status', {
    environmentId
  })
  expect(status?.mechanisms[0]).toMatchObject({ error: { code: 'TLS_UNTRUSTED' } })

  await setLevel('ignore')
  expect(await invoke('connection:status', { environmentId })).toBeNull()
})

test('una URL clásica con /api/v2 da error en el formulario', async () => {
  await openEnvironmentForm()
  const form = page.getByTestId('environment-form')
  const field = form.getByTestId('environment-classic-url')
  await field.fill(`https://127.0.0.1:${port}/api/v2`)
  await form.getByTestId('form-save').click()

  await expect(form).toBeVisible()
  await expect(field).toHaveAttribute('aria-invalid', 'true')
  await expect(
    form.getByRole('alert').filter({ hasText: 'Escribe la URL del entorno sin /api/v2' })
  ).toBeVisible()
  await closeEnvironmentForm()
})

test('ninguna respuesta IPC contiene el token, y sin errores de consola ni peticiones remotas del renderer', async () => {
  for (const output of ipcOutputs) expect(output).not.toContain('SECRETOE2ETLS')
  expect(await page.content()).not.toContain('SECRETOE2ETLS')
  expect(consoleErrors).toEqual([])
  // Las peticiones a 127.0.0.1 las hace main; el renderer no habla con ningún servidor.
  expect(rendererRemote).toEqual([])
})
