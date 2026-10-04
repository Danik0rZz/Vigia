import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:https'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Locator,
  type Page
} from '@playwright/test'
import { captureOnFailure } from './failure-capture'
import ExcelJS from 'exceljs'
import { generate } from 'selfsigned'
import es from '../src/renderer/src/locales/es/common.json'

/**
 * Fase 6, primeras vistas core sobre la app compilada (`out/`): Problemas,
 * Métricas e Inicio contra un Dynatrace simulado (HTTPS en 127.0.0.1), con
 * exportación CSV/XLSX/TXT, capturas, consultas guardadas, rango personalizado,
 * módulos no disponibles y sin auto-refresco.
 *
 * Los entornos usan el nivel 'ignore' para no tener que fijar huellas (eso ya
 * lo prueba tls.spec). Las exportaciones van a una carpeta temporal
 * (VIGIA_EXPORT_DIR). El portapapeles del sistema se guarda y se restaura.
 *
 * Deuda conocida (para después de la primera versión): las pruebas dependen del
 * orden, porque cada una parte del estado que dejó la anterior. Lo ideal es que
 * cada prueba prepare su propio estado.
 */
test.describe.configure({ mode: 'serial' })

const tok = (name: string): string => `dt0c01.PUBLICAPRUEBA0000000000A.${name.padEnd(64, 'X')}`
const TOKEN_A = tok('SECRETOVISTASA')
const TOKEN_B = tok('SECRETOVISTASB')
const TOKEN_NO_METRICS = tok('SECRETOVISTASNOMETRICS')
const TOKEN_FORBIDDEN = tok('SECRETOVISTASFORBIDDEN')
const SECRET_MARKS = ['SECRETOVISTAS']

const HOUR = 3600_000
const NOW = Date.now()

type FakeProblem = Record<string, unknown> & { displayId: string; title: string; status: string }

const problemsA: FakeProblem[] = [
  {
    problemId: 'pa-1',
    displayId: 'P-101',
    'k8s.cluster.name': ['cluster-norte'],
    title: 'Respuesta lenta en pagos',
    status: 'OPEN',
    severityLevel: 'PERFORMANCE',
    impactLevel: 'SERVICES',
    startTime: NOW - HOUR,
    endTime: -1,
    affectedEntities: [
      { entityId: { id: 'SERVICE-AAA1', type: 'SERVICE' }, name: 'pagos' },
      { entityId: { id: 'HOST-AAA1', type: 'HOST' }, name: 'host-pagos-01' }
    ],
    impactedEntities: [{ entityId: { id: 'APPLICATION-AAA1', type: 'APPLICATION' }, name: 'web' }],
    rootCauseEntity: { entityId: { id: 'SERVICE-AAA1', type: 'SERVICE' }, name: 'pagos' },
    managementZones: [{ id: '1', name: 'Producción' }],
    problemFilters: []
  },
  {
    problemId: 'pa-2',
    displayId: 'P-102',
    title: 'Disco lleno',
    status: 'CLOSED',
    severityLevel: 'RESOURCE_CONTENTION',
    impactLevel: 'INFRASTRUCTURE',
    startTime: NOW - 3 * HOUR,
    endTime: NOW - 2 * HOUR,
    affectedEntities: [{ entityId: { id: 'HOST-AAA2', type: 'HOST' }, name: 'host-bd-01' }],
    impactedEntities: [],
    managementZones: [],
    problemFilters: []
  },
  {
    // Título con forma de fórmula: el CSV tiene que neutralizarlo.
    problemId: 'pa-3',
    displayId: 'P-103',
    'k8s.cluster.name': ['cluster-sur', 'cluster-norte'],
    title: '=HYPERLINK("http://x","y") errores',
    status: 'OPEN',
    // Severidad que la app no conoce: se muestra tal cual (con un console.warn, no error).
    severityLevel: 'NUEVA_SEVERIDAD',
    'k8s.namespace.name': ['carrito-ns', 'comun-ns'],
    impactLevel: 'SERVICES',
    startTime: NOW - 30 * 60_000,
    endTime: -1,
    affectedEntities: [{ entityId: { id: 'SERVICE-AAA2', type: 'SERVICE' }, name: 'carrito' }],
    impactedEntities: [],
    managementZones: [],
    problemFilters: []
  }
]

const problemsB: FakeProblem[] = [
  {
    problemId: 'pb-1',
    displayId: 'P-900',
    title: 'Problema solo de Desarrollo',
    status: 'OPEN',
    severityLevel: 'AVAILABILITY',
    impactLevel: 'APPLICATION',
    startTime: NOW - HOUR,
    endTime: -1,
    affectedEntities: [{ entityId: { id: 'SERVICE-BBB1', type: 'SERVICE' }, name: 'login-dev' }],
    impactedEntities: [],
    managementZones: [],
    problemFilters: []
  }
]

/** 300 problemas sintéticos para la tabla virtualizada. */
const manyProblems: FakeProblem[] = Array.from({ length: 300 }, (_, i) => ({
  problemId: `pm-${i + 1}`,
  displayId: `P-M${i + 1}`,
  title: `Problema masivo ${i + 1}`,
  status: 'OPEN',
  severityLevel: 'ERROR',
  impactLevel: 'SERVICES',
  startTime: NOW - (i + 1) * 60_000,
  endTime: -1,
  affectedEntities: [
    { entityId: { id: `SERVICE-M${i + 1}`, type: 'SERVICE' }, name: `svc-${i + 1}` }
  ],
  impactedEntities: [],
  managementZones: [],
  problemFilters: []
}))

/** Partes del detalle de P-101 que llegan con fields (evidencias, impactos, comentarios…). */
const detailExtras = {
  entityTags: [
    { context: 'CONTEXTLESS', key: 'equipo', value: 'pagos', stringRepresentation: 'equipo:pagos' }
  ],
  linkedProblemInfo: { displayId: 'P-099', problemId: 'pa-0' },
  evidenceDetails: {
    totalCount: 1,
    details: [
      {
        evidenceType: 'EVENT',
        displayName: 'Tiempo de respuesta degradado',
        entity: { entityId: { id: 'SERVICE-AAA1', type: 'SERVICE' }, name: 'pagos' },
        rootCauseRelevant: true,
        startTime: NOW - HOUR
      }
    ]
  },
  impactAnalysis: {
    impacts: [
      {
        impactType: 'APPLICATION',
        impactedEntity: { entityId: { id: 'APPLICATION-AAA1', type: 'APPLICATION' }, name: 'web' },
        estimatedAffectedUsers: 42
      }
    ]
  },
  recentComments: {
    totalCount: 1,
    comments: [
      {
        authorName: 'operador',
        content: 'Revisando el pool de conexiones',
        createdAtTimestamp: NOW
      }
    ]
  }
}

/** Estado y registro del Dynatrace simulado. */
const sim = {
  problemsRequests: 0,
  truncate: false,
  many: false,
  /** AUD-08: mete un problema inválido (sin problemId) y avisos de la API. */
  invalidOne: false,
  warnings: [] as string[],
  badRequest: false,
  /** Si no es null, /problems no responde hasta que se cumpla (para ver qué hay mientras carga). */
  problemsGate: null as Promise<void> | null,
  /** AUD-12: igual para /problems/{id} (detalle lento). */
  detailGate: null as Promise<void> | null,
  /** AUD-12: el detalle falla (404). */
  detailFails: false,
  lastDetailQuery: new URLSearchParams(),
  lastProblemsQuery: new URLSearchParams(),
  lastMetricsQuery: new URLSearchParams(),
  /** AUD-13: peticiones a /metrics/query. */
  metricsQueries: 0,
  /** AUD-13: dataPointCountRatio / dimensionCountRatio de cada resultado. */
  metricRatios: {} as { dataPointCountRatio?: number; dimensionCountRatio?: number },
  /** AUD-13: warnings de /metrics/query. */
  metricWarnings: [] as string[]
}

let server: Server
let port = 0
let app: ElectronApplication
let page: Page
let userDataDir: string
captureOnFailure(() => ({ page, userDataDir }))
let exportDir: string
const env: Record<string, string> = {}
const consoleErrors: string[] = []
const rendererRemote: string[] = []
const ipcOutputs: string[] = []

/**
 * Portapapeles de Electron 44 (al estilo W3C y asíncrono). El de Dani se guarda en
 * main (globalThis) al empezar y se restaura al terminar.
 */
type ClipboardItemLike = { types: readonly string[]; getType(type: string): Promise<Blob> }
type ElectronClipboard = {
  clear(): void
  has(mimetype: string): Promise<boolean>
  read(): Promise<ClipboardItemLike[]>
  write(items: unknown[]): Promise<void>
}
const SAVED_CLIPBOARD = '__vigiaE2eSavedClipboard'

function problemsFor(token: string): FakeProblem[] {
  return token === TOKEN_B ? problemsB : problemsA
}

/** Valores de un criterio con lista, p. ej. severityLevel("A","B") → ['A', 'B']. */
function selectorList(selector: string, name: string): string[] | undefined {
  const inner = new RegExp(`${name}\\(([^)]*)\\)`).exec(selector)?.[1]
  return inner === undefined ? undefined : [...inner.matchAll(/"([^"]*)"/g)].map((m) => m[1] ?? '')
}

/** Aplica de forma aproximada status, text, severityLevel e impactLevel del problemSelector. */
function applySelector(problems: FakeProblem[], selector: string | null): FakeProblem[] {
  if (selector === null) return problems
  const status = /status\("(open|closed)"\)/.exec(selector)?.[1]
  const text = /text\("((?:[^"~]|~.)*)"\)/.exec(selector)?.[1]?.replace(/~(.)/g, '$1')
  const severities = selectorList(selector, 'severityLevel')
  const impacts = selectorList(selector, 'impactLevel')
  return problems.filter(
    (p) =>
      (status === undefined || p.status.toLowerCase() === status) &&
      (text === undefined || p.title.toLowerCase().includes(text.toLowerCase())) &&
      (severities === undefined || severities.includes(String(p['severityLevel']))) &&
      (impacts === undefined || impacts.includes(String(p['impactLevel'])))
  )
}

async function startServer(): Promise<void> {
  const pems = await generate([{ name: 'commonName', value: '127.0.0.1' }], {
    keySize: 2048,
    algorithm: 'sha256',
    extensions: [{ name: 'subjectAltName', altNames: [{ type: 7, ip: '127.0.0.1' }] }]
  })
  server = createServer({ key: pems.private, cert: pems.cert }, (req, res) => {
    const url = new URL(req.url ?? '/', 'https://127.0.0.1')
    const token = (req.headers.authorization ?? '').replace(/^Api-Token /, '')
    const send = (status: number, body: unknown): void => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    req.resume()
    req.on('end', () => {
      if (![TOKEN_A, TOKEN_B, TOKEN_NO_METRICS, TOKEN_FORBIDDEN].includes(token)) {
        return send(401, { error: { code: 401, message: 'Missing or invalid token' } })
      }
      if (req.method === 'POST' && url.pathname === '/api/v2/apiTokens/lookup') {
        return send(200, {
          id: 'dt0c01.PUBLICAPRUEBA0000000000A',
          name: 'e2e',
          enabled: true,
          scopes:
            token === TOKEN_NO_METRICS
              ? ['problems.read', 'slo.read']
              : ['problems.read', 'metrics.read', 'slo.read']
        })
      }
      if (req.method === 'GET' && url.pathname === '/api/v2/problems') {
        sim.problemsRequests += 1
        sim.lastProblemsQuery = url.searchParams
        if (sim.problemsGate !== null) {
          void sim.problemsGate.then(() => respondProblems())
          return
        }
        return respondProblems()
      }
      function respondProblems(): void {
        if (token === TOKEN_FORBIDDEN) {
          return send(403, {
            error: {
              code: 403,
              message: 'Token is missing required scope',
              details: { missingScopes: ['problems.read'] }
            }
          })
        }
        if (sim.badRequest) {
          return send(400, { error: { code: 400, message: 'Selector mal formado en la prueba' } })
        }
        const source = sim.many && token === TOKEN_A ? manyProblems : problemsFor(token)
        const selected = applySelector(source, url.searchParams.get('problemSelector'))
        const problems = sim.invalidOne
          ? [...selected, { displayId: 'P-ROTO', title: 'Sin problemId', status: 'OPEN' }]
          : selected
        return send(200, {
          ...(sim.warnings.length > 0 ? { warnings: sim.warnings } : {}),
          // Al truncar, el total de la API es mayor que lo que llega (AUD-07).
          totalCount: sim.truncate ? 999 : problems.length,
          problems,
          nextPageKey: sim.truncate ? `pagina-${sim.problemsRequests}` : null
        })
      }
      const single = /^\/api\/v2\/problems\/([^/]+)$/.exec(url.pathname)
      if (req.method === 'GET' && single !== null) {
        sim.lastDetailQuery = url.searchParams
        const respondDetail = (): void => {
          // 404 y no 5xx: el cliente reintenta los 5xx y la prueba se alargaría.
          if (sim.detailFails) {
            return send(404, {
              error: { code: 404, message: 'Detalle no disponible en la prueba' }
            })
          }
          const found = problemsFor(token).find(
            (p) => p['problemId'] === decodeURIComponent(single[1] ?? '')
          )
          return found
            ? send(200, { ...found, ...(found['problemId'] === 'pa-1' ? detailExtras : {}) })
            : send(404, { error: { code: 404, message: 'No existe' } })
        }
        if (sim.detailGate !== null) {
          void sim.detailGate.then(respondDetail)
          return
        }
        return respondDetail()
      }
      if (req.method === 'GET' && url.pathname === '/api/v2/metrics') {
        // Filtra por text (AUD-13: «Sin resultados» con un texto que no casa).
        const text = (url.searchParams.get('text') ?? '').toLowerCase()
        const metrics = [
          { metricId: 'builtin:host.cpu.usage', displayName: 'CPU usage %', unit: 'Percent' },
          { metricId: 'builtin:host.cpu.idle', displayName: 'CPU idle', unit: 'Percent' }
        ].filter((m) => `${m.metricId} ${m.displayName}`.toLowerCase().includes(text))
        return send(200, { totalCount: metrics.length, nextPageKey: null, metrics })
      }
      if (req.method === 'GET' && url.pathname === '/api/v2/metrics/query') {
        sim.metricsQueries += 1
        sim.lastMetricsQuery = url.searchParams
        const timestamps = [0, 1, 2, 3, 4].map((i) => NOW - (4 - i) * 60_000)
        // Varias métricas separadas por comas: un resultado por métrica.
        const selectors = (url.searchParams.get('metricSelector') ?? 'x').split(',')
        return send(200, {
          resolution: url.searchParams.get('resolution') ?? '1m',
          totalCount: selectors.length,
          ...(sim.metricWarnings.length > 0 ? { warnings: sim.metricWarnings } : {}),
          result: selectors.map((metricId) => ({
            metricId,
            ...sim.metricRatios,
            data: [
              {
                dimensionMap: { 'dt.entity.host': 'HOST-AAA1' },
                timestamps,
                values: [10, 20, null, 15, 30]
              }
            ]
          }))
        })
      }
      if (req.method === 'GET' && url.pathname === '/api/v2/slo') {
        return send(200, {
          totalCount: 4,
          nextPageKey: null,
          slo: [
            {
              id: 'slo-1',
              name: 'Disponibilidad pagos',
              enabled: true,
              status: 'SUCCESS',
              target: 99.5,
              warning: 99.8,
              evaluatedPercentage: 99.9,
              errorBudget: 80,
              error: 'NONE',
              relatedOpenProblems: 0
            },
            {
              id: 'slo-2',
              name: 'Latencia carrito',
              enabled: true,
              status: 'FAILURE',
              target: 95,
              warning: 97,
              evaluatedPercentage: 90.1,
              errorBudget: -20,
              error: 'NONE',
              relatedOpenProblems: 2
            },
            {
              // Entre target y warning: la API dice WARNING.
              id: 'slo-3',
              name: 'Errores de login',
              enabled: true,
              status: 'WARNING',
              target: 99,
              warning: 99.5,
              evaluatedPercentage: 99.2,
              errorBudget: 20,
              error: 'NONE',
              relatedOpenProblems: 0
            },
            {
              // Sin evaluar: la API da -1 y SUCCESS; la tarjeta no puede decir «Correcto».
              id: 'slo-4',
              name: 'Búsqueda sin datos',
              enabled: true,
              status: 'SUCCESS',
              target: 98,
              warning: 99,
              evaluatedPercentage: -1,
              errorBudget: -1,
              error: 'NONE'
            }
          ]
        })
      }
      send(404, { error: { code: 404, message: 'No existe' } })
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  port = (server.address() as AddressInfo).port
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

async function reloadUi(): Promise<void> {
  await page.reload()
  await page.waitForLoadState('domcontentloaded')
}

async function createEnvironment(
  clientId: string,
  name: string,
  type: string,
  token: string | null
): Promise<string> {
  const created = await invoke<{ id: string }>('environments:create', {
    clientId,
    name,
    type,
    deployment: 'saas',
    classicApiUrl: `https://127.0.0.1:${port}`,
    platformUrl: null,
    ssoUrl: null,
    oauthClientId: null,
    oauthScopes: [],
    accountUuid: null,
    certificateLevel: 'ignore',
    captureUrlPatterns: [],
    tags: [],
    readOnly: false
  })
  if (token !== null)
    await invoke('secrets:set', { environmentId: created.id, kind: 'classicToken', value: token })
  return created.id
}

async function activate(name: string): Promise<void> {
  await invoke('environments:setActive', { environmentId: env[name] })
  await reloadUi()
}

async function goTo(id: string): Promise<void> {
  await page.getByTestId(`nav-${id}`).click()
}

function exportMenu(target: string): Locator {
  return page.locator(`[data-testid="export-menu"][data-export-target="${target}"]`)
}

/** Lanza una opción del menú de exportación y devuelve el fichero nuevo de la carpeta de exportación. */
async function exportTo(target: string, option: string): Promise<string> {
  const before = new Set(readdirSync(exportDir))
  await exportMenu(target).click()
  await page.getByTestId(option).click()
  let created = ''
  await expect
    .poll(() => {
      created = readdirSync(exportDir).find((name) => !before.has(name)) ?? ''
      return created
    })
    .not.toBe('')
  return join(exportDir, created)
}

/** Tamaño CSS del canvas de un gráfico. */
async function canvasSize(testId: string): Promise<{ width: number; height: number }> {
  return page
    .getByTestId(testId)
    .locator('canvas')
    .first()
    .evaluate((canvas) => ({
      width: (canvas as HTMLCanvasElement).clientWidth,
      height: (canvas as HTMLCanvasElement).clientHeight
    }))
}

/** Tamaño y alpha de la esquina superior izquierda de un PNG, leído con nativeImage en main. */
async function pngInfo(
  path: string
): Promise<{ width: number; height: number; cornerAlpha: number }> {
  return app.evaluate(({ nativeImage }, file) => {
    const image = nativeImage.createFromPath(file)
    const { width, height } = image.getSize()
    // toBitmap: BGRA, 4 bytes por píxel.
    return { width, height, cornerAlpha: image.toBitmap()[3] ?? 0 }
  }, path)
}

test.beforeAll(async () => {
  test.setTimeout(120_000)
  await startServer()
  userDataDir = mkdtempSync(join(tmpdir(), 'vigia-e2e-views-'))
  exportDir = mkdtempSync(join(tmpdir(), 'vigia-e2e-export-'))
  app = await electron.launch({
    // VIGIA_E2E_NO_SANDBOX solo hace falta en contenedores Linux que ejecutan como root.
    args: ['.', ...(process.env['VIGIA_E2E_NO_SANDBOX'] ? ['--no-sandbox'] : [])],
    env: { ...process.env, VIGIA_USER_DATA_DIR: userDataDir, VIGIA_EXPORT_DIR: exportDir }
  })
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

  // El portapapeles es el del sistema: se guarda para restaurarlo al final.
  await app.evaluate(async ({ clipboard }, key) => {
    const items = await (clipboard as unknown as ElectronClipboard).read()
    ;(globalThis as Record<string, unknown>)[key] = items
  }, SAVED_CLIPBOARD)

  const client = await invoke<{ id: string }>('clients:create', {
    name: 'Cliente A',
    color: '#336699'
  })
  env['Producción'] = await createEnvironment(client.id, 'Producción', 'production', TOKEN_A)
  env['Desarrollo'] = await createEnvironment(client.id, 'Desarrollo', 'development', TOKEN_B)
  env['Sin métricas'] = await createEnvironment(
    client.id,
    'Sin métricas',
    'integration',
    TOKEN_NO_METRICS
  )
  env['Sin token'] = await createEnvironment(client.id, 'Sin token', 'other', null)
  env['Prohibido'] = await createEnvironment(client.id, 'Prohibido', 'other', TOKEN_FORBIDDEN)
  await reloadUi()
})

test.afterAll(async () => {
  await app
    ?.evaluate(async ({ clipboard, ClipboardItem }, key) => {
      const cb = clipboard as unknown as ElectronClipboard
      const saved = (globalThis as Record<string, unknown>)[key] as ClipboardItemLike[] | undefined
      if (saved === undefined) return
      cb.clear()
      if (saved.length === 0) return
      try {
        await cb.write(saved)
      } catch {
        // Si no se pueden reescribir tal cual, se reconstruyen tipo a tipo.
        const rebuilt = await Promise.all(
          saved.map(async (item) => {
            const parts: Record<string, Blob> = {}
            for (const type of item.types) parts[type] = await item.getType(type)
            return new (ClipboardItem as unknown as new (parts: Record<string, Blob>) => unknown)(
              parts
            )
          })
        )
        await cb.write(rebuilt)
      }
    }, SAVED_CLIPBOARD)
    .catch(() => undefined)
  await app?.close()
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()))
  rmSync(userDataDir, { recursive: true, force: true })
  rmSync(exportDir, { recursive: true, force: true })
})

test('sin entorno activo, las tres vistas dicen que no hay entorno', async () => {
  for (const id of ['home', 'problems', 'metrics']) {
    await goTo(id)
    await expect(page.getByTestId('module-unavailable'), id).toContainText('Sin entorno')
  }
  expect(sim.problemsRequests).toBe(0)
})

test('Problemas: tabla, línea de tiempo y detalle con las entidades afectadas', async () => {
  await activate('Producción')
  await goTo('problems')

  const rows = page.getByTestId('problem-row')
  await expect(rows).toHaveCount(3)
  for (const p of problemsA) {
    await expect(page.getByTestId('problems-table')).toContainText(p.displayId)
  }
  await expect(page.getByTestId('problems-table')).toContainText('Respuesta lenta en pagos')
  await expect(page.getByTestId('problems-timeline').locator('canvas').first()).toBeVisible()

  // Sin rango personalizado, la petición va con el rango global (2 h por defecto).
  expect(sim.lastProblemsQuery.get('from')).toBe('now-2h')

  await rows.filter({ hasText: 'P-101' }).click()
  const detail = page.getByTestId('problem-detail')
  await expect(detail).toBeVisible()
  // Todas las entidades afectadas, con nombre, tipo e id.
  const entities = detail.getByTestId('problem-entity')
  await expect(entities).toHaveCount(2)
  // Cada entidad se identifica por su id (los nombres pueden contenerse unos a otros).
  const byId = (id: string): Locator =>
    entities.filter({ has: page.getByTestId('entity-id').filter({ hasText: id }) })
  await expect(byId('SERVICE-AAA1')).toContainText('pagos')
  await expect(byId('SERVICE-AAA1').getByTestId('entity-type')).toHaveText(/SERVICE/)
  await expect(byId('HOST-AAA1')).toContainText('host-pagos-01')
  await expect(byId('HOST-AAA1').getByTestId('entity-type')).toHaveText(/HOST/)

  // El detalle se pide con fields y muestra cada parte que llega.
  await expect.poll(() => sim.lastDetailQuery.get('fields') ?? '').toContain('evidenceDetails')
  for (const part of ['evidenceDetails', 'impactAnalysis', 'recentComments']) {
    expect(sim.lastDetailQuery.get('fields') ?? '').toContain(part)
  }
  await expect(detail.getByTestId('detail-evidence')).toContainText('Tiempo de respuesta degradado')
  await expect(detail.getByTestId('detail-impacts')).toContainText('42')
  await expect(detail.getByTestId('detail-comments')).toContainText(
    'Revisando el pool de conexiones'
  )
  await expect(detail.getByTestId('detail-zones')).toContainText('Producción')
  await expect(detail.getByTestId('detail-impacted')).toContainText('web')
  await expect(detail.getByTestId('detail-tags')).toContainText('equipo:pagos')
  await expect(detail.getByTestId('detail-linked')).toContainText('P-099')
  await expect(
    page.locator('[data-testid="export-menu"][data-export-target="problem-detail"]')
  ).toBeVisible()

  // AUD-12: el detalle es un panel lateral (diálogo) que no tapa toda la tabla.
  await expect(detail).toHaveAttribute('role', 'dialog')
  await expect(detail).toHaveAttribute('aria-label', 'Detalle del problema')
  const box = await detail.boundingBox()
  const viewport = await page.evaluate(() => window.innerWidth)
  expect(box?.width ?? 0).toBeLessThanOrEqual(Math.min(560, viewport * 0.9) + 1)
  expect(box?.x ?? 0, 'anclado a la derecha').toBeGreaterThan(0)
  expect(Math.round((box?.x ?? 0) + (box?.width ?? 0))).toBeGreaterThanOrEqual(viewport - 1)
  // La fila abierta se marca con data-selected, sin aria-selected.
  const p101 = rows.filter({ hasText: 'P-101' })
  await expect(p101).toHaveAttribute('data-selected', 'true')
  await expect(p101).not.toHaveAttribute('aria-selected', /.*/)

  // El botón Cerrar lo cierra.
  await detail.getByTestId('problem-detail-close').click()
  await expect(detail).toBeHidden()
})

test('AUD-12: mientras el detalle carga, el panel ya muestra los datos de la fila', async () => {
  const detail = page.getByTestId('problem-detail')
  let release = (): void => undefined
  sim.detailGate = new Promise<void>((resolve) => {
    release = resolve
  })
  try {
    await page
      .getByTestId('problem-row')
      .filter({ hasText: 'P-103' })
      .getByTestId('problem-open')
      .click()
    await expect(detail).toBeVisible()
    // Lo de la fila, al instante: título, entidad afectada y severidad.
    await expect(detail).toContainText('errores')
    await expect(detail).toContainText('carrito')
    await expect(detail).toContainText('NUEVA_SEVERIDAD')
    // Lo que solo trae el detalle, cargando.
    await expect(detail.getByTestId('detail-loading').first()).toBeVisible()
  } finally {
    release()
    sim.detailGate = null
  }
  await expect(detail.getByTestId('detail-loading')).toHaveCount(0)
  await expect(detail).toContainText('carrito')
  await page.keyboard.press('Escape')
  await expect(detail).toBeHidden()
})

test('AUD-12: si el detalle falla, el error va dentro del panel y los datos de la fila se quedan', async () => {
  const detail = page.getByTestId('problem-detail')
  sim.detailFails = true
  try {
    await page
      .getByTestId('problem-row')
      .filter({ hasText: 'P-102' })
      .getByTestId('problem-open')
      .click()
    await expect(detail).toBeVisible()
    await expect(detail.getByRole('alert').first()).toBeVisible()
    await expect(detail).toContainText('Disco lleno')
    await expect(detail).toContainText('host-bd-01')
    // Con error, las secciones del detalle no se quedan en «Cargando…».
    await expect(detail.getByTestId('detail-loading')).toHaveCount(0)
  } finally {
    sim.detailFails = false
  }
  await page.keyboard.press('Escape')
  await expect(detail).toBeHidden()
})

test('AUD-12: el detalle se abre con el teclado, se cierra con Escape y el foco vuelve a la fila', async () => {
  const detail = page.getByTestId('problem-detail')
  await expect(page.getByTestId('problem-row')).toHaveCount(3)

  // Tab desde el filtro de texto hasta el primer botón problem-open.
  await page.getByTestId('problems-filter-text').focus()
  let reached = false
  for (let i = 0; i < 40 && !reached; i++) {
    await page.keyboard.press('Tab')
    reached = await page.evaluate(
      () => document.activeElement?.getAttribute('data-testid') === 'problem-open'
    )
  }
  expect(reached, 'Tab llega a un problem-open').toBe(true)
  const focusedId = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? '')
  expect(focusedId).toMatch(/^P-\d+$/)
  const opener = page
    .getByTestId('problem-row')
    .filter({ hasText: focusedId })
    .getByTestId('problem-open')

  // Enter abre el panel con el foco dentro.
  await page.keyboard.press('Enter')
  await expect(detail).toBeVisible()
  await expect(detail).toContainText(focusedId)
  await expect.poll(() => detail.evaluate((el) => el.contains(document.activeElement))).toBe(true)

  // Escape cierra y el foco vuelve al botón de esa fila.
  await page.keyboard.press('Escape')
  await expect(detail).toBeHidden()
  await expect(opener).toBeFocused()

  // Espacio también abre; un click fuera del panel lo cierra.
  await page.keyboard.press('Space')
  await expect(detail).toBeVisible()
  await page.mouse.click(10, Math.round((await page.evaluate(() => window.innerHeight)) / 2))
  await expect(detail).toBeHidden()
  await expect(opener).toBeFocused()

  // Un click en cualquier parte de la fila sigue abriendo.
  await page
    .getByTestId('problem-row')
    .filter({ hasText: 'P-102' })
    .getByText('Disco lleno')
    .click()
  await expect(detail).toBeVisible()
  await expect(detail).toContainText('P-102')
  await page.keyboard.press('Escape')
  await expect(detail).toBeHidden()
})

test('AUD-12: filtros de severidad e impacto, en el servidor', async () => {
  const rows = page.getByTestId('problem-row')
  const selectorParam = (): string => sim.lastProblemsQuery.get('problemSelector') ?? ''
  const pick = async (filter: string, option: string, value: string): Promise<void> => {
    await page.getByTestId(filter).click()
    await page.locator(`[data-testid="${option}"][value="${value}"]`).click()
    await page.keyboard.press('Escape')
  }
  await expect(rows).toHaveCount(3)

  // Opciones con los valores de la API.
  await page.getByTestId('problems-filter-severity').click()
  const severityValues = await page
    .getByTestId('severity-option')
    .evaluateAll((els) => els.map((el) => el.getAttribute('value')))
  expect(severityValues).toEqual(
    expect.arrayContaining(['AVAILABILITY', 'ERROR', 'PERFORMANCE', 'RESOURCE_CONTENTION'])
  )
  await page.keyboard.press('Escape')

  await pick('problems-filter-severity', 'severity-option', 'PERFORMANCE')
  await expect.poll(selectorParam).toMatch(/severityLevel\([^)]*"PERFORMANCE"[^)]*\)/)
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('P-101')

  // Dos severidades: las dos en el mismo criterio (OR).
  await pick('problems-filter-severity', 'severity-option', 'RESOURCE_CONTENTION')
  await expect.poll(selectorParam).toMatch(/severityLevel\([^)]*"RESOURCE_CONTENTION"[^)]*\)/)
  expect(selectorParam()).toMatch(/severityLevel\([^)]*"PERFORMANCE"[^)]*\)/)
  await expect(rows).toHaveCount(2)

  // AVAILABILITY va como valor de la API.
  await pick('problems-filter-severity', 'severity-option', 'AVAILABILITY')
  await expect.poll(selectorParam).toMatch(/severityLevel\([^)]*"AVAILABILITY"[^)]*\)/)

  // Se quitan las tres: vuelve la consulta sin severidad (ya en caché, sin petición nueva).
  for (const value of ['PERFORMANCE', 'RESOURCE_CONTENTION', 'AVAILABILITY']) {
    await pick('problems-filter-severity', 'severity-option', value)
  }
  await expect(rows).toHaveCount(3)

  // Impacto.
  await pick('problems-filter-impact', 'impact-option', 'INFRASTRUCTURE')
  await expect.poll(selectorParam).toMatch(/impactLevel\([^)]*"INFRASTRUCTURE"[^)]*\)/)
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('P-102')

  // Van por entorno, como los demás filtros: Desarrollo empieza sin ellos (con
  // INFRASTRUCTURE, P-900, de impacto APPLICATION, no saldría).
  await page.getByTestId('env-selector').click()
  await page.getByRole('option', { name: 'Cliente A › Desarrollo' }).click()
  await expect(page.getByTestId('problems-table')).toContainText('P-900')
  await page.getByTestId('env-selector').click()
  await page.getByRole('option', { name: 'Cliente A › Producción' }).click()
  await expect(rows).toHaveCount(1)

  await pick('problems-filter-impact', 'impact-option', 'INFRASTRUCTURE')
  await expect(rows).toHaveCount(3)
})

test('tabla de Problemas: columnas, N/A, "+N" con tooltip, en curso y fechas propias', async () => {
  const headers = await page
    .locator('[data-testid^="col-"]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')))
  expect(headers).toEqual(
    [
      'displayId',
      'title',
      'status',
      'impact',
      'severity',
      'affected',
      'rootCause',
      'cluster',
      'namespace',
      'start',
      'end',
      'duration'
    ].map((key) => `col-${key}`)
  )

  const row = (id: string): Locator => page.getByTestId('problem-row').filter({ hasText: id })
  const table = page.getByTestId('problems-table')

  // P-101, abierto: dos afectadas → la primera y "+1" con tooltip; sin namespace → N/A; fin N/A; en curso.
  await expect(row('P-101')).toContainText('pagos')
  await expect(row('P-101')).not.toContainText('host-pagos-01')
  const more = row('P-101').getByTestId('more-values')
  await expect(more).toHaveText(/\+1/)
  await more.hover()
  await expect(page.getByRole('tooltip')).toContainText('host-pagos-01')
  await page.mouse.move(0, 0)
  await expect(row('P-101')).toContainText('N/A')
  await expect(row('P-101')).toContainText('(en curso)')
  await expect(row('P-101')).toContainText(/\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/)

  // P-102, cerrado: sin causa raíz → N/A; fin con fecha; 60 min sin "(en curso)".
  await expect(row('P-102')).toContainText('60 min')
  await expect(row('P-102')).not.toContainText('(en curso)')
  const dates = (await row('P-102').innerText()).match(/\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/g) ?? []
  expect(dates, 'inicio y fin con fecha').toHaveLength(2)
  await expect(row('P-102')).toContainText('N/A')

  // P-103: severidad desconocida en crudo y dos namespaces → el primero y "+1".
  await expect(row('P-103')).toContainText('NUEVA_SEVERIDAD')
  await expect(row('P-103')).toContainText('carrito-ns')
  // P-103 tiene dos «+1» (clúster y namespace): cada uno se identifica por sus valores.
  await expect(
    row('P-103')
      .getByTestId('more-values')
      .and(page.getByRole('button', { name: /comun-ns/ }))
  ).toHaveText(/\+1/)

  // Los tipos y los ids de las entidades no van en la tabla.
  await expect(table).not.toContainText('SERVICE-AAA1')
  await expect(table).not.toContainText('HOST-AAA1')
})

test('clúster: columna, filtro local, aviso y exportación filtrada', async () => {
  const rows = page.getByTestId('problem-row')
  const row = (id: string): Locator => rows.filter({ hasText: id })
  await expect(rows).toHaveCount(3)

  // Columna: el primero y "+N"; sin clúster, N/A.
  await expect(row('P-101')).toContainText('cluster-norte')
  await expect(row('P-103')).toContainText('cluster-sur')
  await expect(
    row('P-103')
      .getByTestId('more-values')
      .and(page.getByRole('button', { name: /cluster-norte/ }))
  ).toHaveText(/\+1/)

  // Filtro: una casilla por clúster de los datos cargados, ordenadas.
  await page.getByTestId('problems-filter-cluster').click()
  const options = page.getByTestId('cluster-option')
  await expect(options).toHaveCount(2)
  expect(await options.evaluateAll((els) => els.map((el) => el.getAttribute('value')))).toEqual([
    'cluster-norte',
    'cluster-sur'
  ])

  // Solo cluster-sur → P-103; el aviso dice que hay filtro y cuántos se cargaron.
  await page.locator('[data-testid="cluster-option"][value="cluster-sur"]').click()
  await page.keyboard.press('Escape')
  await expect(rows).toHaveCount(1)
  await expect(row('P-103')).toHaveCount(1)
  const notice = page.getByTestId('list-truncated')
  await expect(notice).toContainText('filtro de clúster')
  await expect(notice).toContainText('de 3')

  // La exportación sale filtrada.
  const lines = readFileSync(await exportTo('problems-table', 'export-csv'))
    .subarray(3)
    .toString('utf8')
    .split('\r\n')
    .filter((line) => line !== '')
  expect(lines).toHaveLength(2)
  expect(lines[1]).toContain('P-103')

  // El XLSX filtrado lo dice en Info, con su fila propia.
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(
    readFileSync(await exportTo('problems-table', 'export-xlsx')) as unknown as ArrayBuffer
  )
  const info: [string, unknown][] = []
  workbook.getWorksheet('Info')?.eachRow((r) => {
    info.push([String(r.getCell(1).value), r.getCell(2).value])
  })
  expect(info.filter(([label]) => label === 'Filtro de clúster')).toEqual([
    ['Filtro de clúster', 'cluster-sur']
  ])
  expect(workbook.getWorksheet('Datos')?.actualRowCount).toBe(2)

  // Con las dos marcadas (OR) salen P-101 y P-103; P-102 no tiene clúster.
  await page.getByTestId('problems-filter-cluster').click()
  await page.locator('[data-testid="cluster-option"][value="cluster-norte"]').click()
  await page.keyboard.press('Escape')
  await expect(rows).toHaveCount(2)
  await expect(row('P-102')).toHaveCount(0)

  // Sin filtro: vuelven las 3 y el aviso desaparece.
  await page.getByTestId('problems-filter-cluster').click()
  for (const name of ['cluster-norte', 'cluster-sur']) {
    await page.locator(`[data-testid="cluster-option"][value="${name}"]`).click()
  }
  await page.keyboard.press('Escape')
  await expect(rows).toHaveCount(3)
  await expect(notice).toHaveCount(0)
})

test('tabla de Problemas virtualizada con 300 problemas', async () => {
  sim.many = true
  await page.getByTestId('module-refresh').click()
  const rows = page.getByTestId('problem-row')
  await expect(rows.first()).toContainText('P-M')

  const visible = async (): Promise<string[]> =>
    rows.evaluateAll((els) => els.map((el) => /P-M\d+/.exec(el.textContent ?? '')?.[0] ?? ''))
  const before = await visible()
  expect(before.length, 'filas en el DOM').toBeGreaterThan(0)
  expect(before.length, 'menos filas en el DOM que problemas').toBeLessThan(300)

  await page.getByTestId('problems-scroll').evaluate((el) => {
    el.scrollTop = el.scrollHeight
  })
  await expect.poll(async () => (await visible()).some((id) => !before.includes(id))).toBe(true)
  expect((await visible()).length).toBeLessThan(300)

  sim.many = false
  await page.getByTestId('module-refresh').click()
  await expect(rows).toHaveCount(3)
})

test('Problemas: filtros de estado y de texto', async () => {
  const rows = page.getByTestId('problem-row')
  await page.getByTestId('problems-filter-status').selectOption('open')
  await expect(rows).toHaveCount(2)
  await expect(page.getByTestId('problems-table')).not.toContainText('P-102')

  await page.getByTestId('problems-filter-text').fill('pagos')
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('P-101')

  await page.getByTestId('problems-filter-text').fill('')
  await page.getByTestId('problems-filter-status').selectOption('all')
  await expect(rows).toHaveCount(3)
})

test('AUD-21: los filtros de Problemas se conservan al cambiar de sección', async () => {
  const rows = page.getByTestId('problem-row')
  await page.getByTestId('problems-filter-status').selectOption('open')
  await page.getByTestId('problems-filter-text').fill('pagos')
  await expect(rows).toHaveCount(1)

  await goTo('metrics')
  await expect(page).toHaveURL(/#\/metrics/)
  await goTo('problems')
  await expect(page.getByTestId('problems-filter-status')).toHaveValue('open')
  await expect(page.getByTestId('problems-filter-text')).toHaveValue('pagos')
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('P-101')

  await page.getByTestId('problems-filter-text').fill('')
  await page.getByTestId('problems-filter-status').selectOption('all')
  await expect(rows).toHaveCount(3)
})

test('AUD-21: los filtros de Problemas van por entorno', async () => {
  const status = page.getByTestId('problems-filter-status')
  const table = page.getByTestId('problems-table')
  const switchTo = async (name: string): Promise<void> => {
    await page.getByTestId('env-selector').click()
    await page.getByRole('option', { name: `Cliente A › ${name}` }).click()
  }

  await status.selectOption('open')
  await expect(page.getByTestId('problem-row')).toHaveCount(2)

  // Desarrollo no hereda el «open» de Producción.
  await switchTo('Desarrollo')
  await expect(table).toContainText('P-900')
  await expect(status).toHaveValue('all')
  await expect(page.getByTestId('problems-filter-text')).toHaveValue('')

  // Al volver, Producción recupera el suyo.
  await switchTo('Producción')
  await expect(status).toHaveValue('open')
  await expect(page.getByTestId('problem-row')).toHaveCount(2)
  await expect(table).not.toContainText('P-900')

  await status.selectOption('all')
  await expect(page.getByTestId('problem-row')).toHaveCount(3)
})

test('AUD-10: guardar un secreto del entorno descarta sus datos y Problemas los vuelve a pedir', async () => {
  const rows = page.getByTestId('problem-row')
  await expect(rows).toHaveCount(3)
  const before = sim.problemsRequests

  // secrets:set desde Ajustes (la mutación del renderer, no IPC directo).
  await goTo('settings')
  await page
    .getByTestId('environment-row')
    .filter({ hasText: 'Producción' })
    .getByTestId('environment-edit')
    .click()
  const form = page.getByTestId('environment-form')
  await form.getByTestId('secret-input-classicToken').fill(TOKEN_A)
  await form.getByTestId('secret-save-classicToken').click()
  await expect(form.getByTestId('secret-status-classicToken')).toHaveText('Configurado')
  await form.getByTestId('form-cancel').click()
  await expect(form).toBeHidden()

  // Se retiene la respuesta: mientras llega, no se ven los problemas de antes.
  let release = (): void => undefined
  sim.problemsGate = new Promise<void>((resolve) => {
    release = resolve
  })
  try {
    await goTo('problems')
    await expect.poll(() => sim.problemsRequests).toBeGreaterThan(before)
    await expect(rows).toHaveCount(0)
    await expect(page.getByTestId('problems-table')).not.toContainText('P-101')
  } finally {
    release()
    sim.problemsGate = null
  }
  await expect(rows).toHaveCount(3)
})

test('sin auto-refresco: ni volver a la vista, ni el foco, ni la reconexión piden datos; module-refresh sí', async () => {
  const before = sim.problemsRequests
  await goTo('metrics')
  await goTo('problems')
  await expect(page.getByTestId('problem-row')).toHaveCount(3)

  // Lo que dispararía un refresco automático (refetchOnWindowFocus, refetchOnReconnect).
  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'))
    window.dispatchEvent(new Event('visibilitychange'))
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('online'))
  })
  await page.evaluate(() => window.blur())
  await page.bringToFront()
  // Aserción negativa: no hay ninguna condición que esperar, solo un margen de tiempo.
  await page.waitForTimeout(1500)
  expect(sim.problemsRequests).toBe(before)

  await page.getByTestId('module-refresh').click()
  await expect.poll(() => sim.problemsRequests).toBeGreaterThan(before)
})

test('una lista truncada lo indica, con el total real de la API', async () => {
  await expect(page.getByTestId('list-truncated')).toHaveCount(0)
  sim.truncate = true
  await page.getByTestId('module-refresh').click()
  const notice = page.getByTestId('list-truncated')
  await expect(notice).toBeVisible()
  await expect(notice).toContainText('de 999')

  // Inicio: el KPI de problemas abiertos muestra el total de la API, no los que han llegado.
  await goTo('home')
  await page.getByTestId('module-refresh').click()
  await expect(page.getByTestId('kpi-open-problems')).toContainText('999')
  await goTo('problems')

  sim.truncate = false
  await page.getByTestId('module-refresh').click()
  await expect(page.getByTestId('list-truncated')).toHaveCount(0)

  // Inicio también tiene la consulta truncada en caché (sin auto-refresco): se refresca para
  // que las pruebas siguientes partan del estado normal.
  await goTo('home')
  await page.getByTestId('module-refresh').click()
  await expect(page.getByTestId('kpi-open-problems')).not.toContainText('999')
  await expect(page.getByTestId('list-truncated')).toHaveCount(0)
  await goTo('problems')
})

test('exporta problemas a CSV: BOM, ";", una fila por problema y fórmulas neutralizadas', async () => {
  const file = await exportTo('problems-table', 'export-csv')
  // Si en el mismo minuto ya se exportó otro (por ejemplo, el CSV filtrado del test del clúster), lleva -N.
  expect(file).toMatch(/Cliente_A_Producción_problems_\d{8}-\d{4}(-\d+)?\.csv$/)

  const buffer = readFileSync(file)
  expect([...buffer.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
  const lines = buffer
    .subarray(3)
    .toString('utf8')
    .split('\r\n')
    .filter((line) => line !== '')
  expect(lines).toHaveLength(1 + problemsA.length)
  expect(lines[0]).toContain(';')
  for (const p of problemsA) expect(buffer.toString('utf8')).toContain(p.displayId)
  expect(buffer.toString('utf8')).toContain(`'=HYPERLINK`)
  expect(buffer.toString('utf8')).not.toMatch(/(^|;|")=HYPERLINK/m)
})

test('exporta problemas a XLSX con su hoja Info, y a TXT alineado y con tabuladores', async () => {
  const xlsx = await exportTo('problems-table', 'export-xlsx')
  expect(xlsx).toMatch(/\.xlsx$/)
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(readFileSync(xlsx) as unknown as ArrayBuffer)
  const data = workbook.getWorksheet('Datos')
  const info = workbook.getWorksheet('Info')
  expect(data?.actualRowCount).toBe(1 + problemsA.length)
  const infoText: Record<string, unknown> = {}
  info?.eachRow((row) => {
    infoText[String(row.getCell(1).value)] = row.getCell(2).value
  })
  expect(infoText['Cliente']).toBe('Cliente A')
  expect(infoText['Entorno']).toBe('Producción')
  expect(infoText['Rango']).toBe('now-2h')
  expect(infoText['Desde']).toBeInstanceOf(Date)
  expect(infoText['Hasta']).toBeInstanceOf(Date)
  expect(String(infoText['Nota'])).toContain('Problemas abiertos: sin fin')
  const header = (data?.getRow(1).values as unknown[]).slice(1).map(String)
  expect(header).toHaveLength(17)
  // La fila de un problema abierto: fin vacío y duración en número.
  let openRow: unknown[] = []
  data?.eachRow((r, n) => {
    if (n > 1 && String(r.getCell(1).value) === 'P-101') openRow = (r.values as unknown[]).slice(1)
  })
  expect(String(openRow[11]), 'clusters antes de namespaces').toBe('cluster-norte')
  expect(openRow[14] ?? null, 'endTime vacío si está abierto').toBeNull()
  expect(typeof openRow[15], 'durationMinutes es número').toBe('number')
  expect(String(openRow[5]), 'afectadas unidas con " | "').toBe('pagos | host-pagos-01')
  expect(String(openRow[7])).toBe('SERVICE-AAA1 | HOST-AAA1')

  const txt = readFileSync(await exportTo('problems-table', 'export-txt'), 'utf8')
  expect(txt).toContain('P-101')
  expect(txt).not.toContain('\t')
  const tabs = readFileSync(await exportTo('problems-table', 'export-txt-tabs'), 'utf8')
  expect(tabs.split(/\r?\n/)[0]).toContain('\t')
})

test('con la interfaz en inglés, el XLSX lleva las hojas y la Info en inglés', async () => {
  await goTo('settings')
  await page.getByTestId('language-en').click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await goTo('problems')

  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(
    readFileSync(await exportTo('problems-table', 'export-xlsx')) as unknown as ArrayBuffer
  )
  expect(workbook.worksheets.map((sheet) => sheet.name).sort()).toEqual(['Data', 'Info'])
  const info: Record<string, unknown> = {}
  workbook.getWorksheet('Info')?.eachRow((row) => {
    info[String(row.getCell(1).value)] = row.getCell(2).value
  })
  expect(info['Client']).toBe('Cliente A')
  expect(info['Environment']).toBe('Producción')
  expect(info['Cliente']).toBeUndefined()

  await goTo('settings')
  await page.getByTestId('language-es').click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'es')
})

test('con el separador "," en Ajustes, el CSV usa coma', async () => {
  await goTo('settings')
  await page.getByTestId('csv-separator-comma').click()
  await expect(page.getByTestId('csv-separator-comma')).toBeChecked()
  expect(await invoke('export:getSettings')).toMatchObject({ csvSeparator: ',' })

  await goTo('problems')
  const lines = readFileSync(await exportTo('problems-table', 'export-csv'))
    .subarray(3)
    .toString('utf8')
    .split('\r\n')
  expect(lines[0]).toContain(',')
  expect(lines[0]).not.toContain(';')

  await goTo('settings')
  await page.getByTestId('csv-separator-semicolon').click()
  expect(await invoke('export:getSettings')).toMatchObject({ csvSeparator: ';' })
})

test('AUD-08: elementos ilegibles y avisos de la API se ven en Problemas y en Inicio', async () => {
  await goTo('problems')
  await expect(page.getByTestId('api-warnings')).toHaveCount(0)

  sim.invalidOne = true
  sim.warnings = ['Aviso de prueba de la API']
  await page.getByTestId('module-refresh').click()
  const warnings = page.getByTestId('api-warnings')
  await expect(warnings).toBeVisible()
  await expect(warnings).toContainText('1 elemento')
  await expect(warnings).toContainText('Aviso de prueba de la API')
  // El problema ilegible no sale en la tabla; los demás sí.
  await expect(page.getByTestId('problem-row')).toHaveCount(3)
  await expect(page.getByTestId('problems-table')).not.toContainText('P-ROTO')

  await goTo('home')
  await page.getByTestId('module-refresh').click()
  await expect(page.getByTestId('api-warnings').first()).toContainText('1 elemento')

  // El XLSX de Problemas lleva la fila «Elementos descartados» con 1, aparte de los avisos.
  await goTo('problems')
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(
    readFileSync(await exportTo('problems-table', 'export-xlsx')) as unknown as ArrayBuffer
  )
  const info: [string, unknown][] = []
  workbook.getWorksheet('Info')?.eachRow((r) => {
    info.push([String(r.getCell(1).value), r.getCell(2).value])
  })
  expect(info.filter(([label]) => label === 'Elementos descartados')).toEqual([
    ['Elementos descartados', 1]
  ])
  expect(info.filter(([label]) => label === 'Aviso').map(([, value]) => value)).toEqual([
    'Aviso de prueba de la API'
  ])
  await goTo('home')

  // Se deja todo como estaba (y se refrescan las dos vistas, que guardan caché).
  sim.invalidOne = false
  sim.warnings = []
  await page.getByTestId('module-refresh').click()
  await expect(page.getByTestId('api-warnings')).toHaveCount(0)
  await goTo('problems')
  await page.getByTestId('module-refresh').click()
  await expect(page.getByTestId('api-warnings')).toHaveCount(0)
})

test('BAD_REQUEST: un 400 se muestra como «La consulta no es válida» con el mensaje de la API', async () => {
  sim.badRequest = true
  await page.getByTestId('module-refresh').click()
  await expect(page.getByText('La consulta no es válida').first()).toBeVisible()
  await expect(page.getByText(/Selector mal formado en la prueba/).first()).toBeVisible()
  sim.badRequest = false
  await page.getByTestId('module-refresh').click()
  await expect(page.getByTestId('problem-row')).toHaveCount(3)
})

test('captura del gráfico al portapapeles', async () => {
  await goTo('problems')
  await app.evaluate(({ clipboard }) => (clipboard as unknown as ElectronClipboard).clear())
  expect(
    await app.evaluate(({ clipboard }) =>
      (clipboard as unknown as ElectronClipboard).has('image/png')
    )
  ).toBe(false)
  await exportMenu('problems-timeline').click()
  await page.getByTestId('capture-copy').click()
  await expect
    .poll(() =>
      app.evaluate(async ({ clipboard }) =>
        (await (clipboard as unknown as ElectronClipboard).read()).some((item) =>
          item.types.includes('image/png')
        )
      )
    )
    .toBe(true)
})

test('captura del gráfico a PNG: x2, fondo sólido y pie según Ajustes', async () => {
  const size = await canvasSize('problems-timeline')

  const withFooter = await pngInfo(await exportTo('problems-timeline', 'capture-save'))
  expect(withFooter.width).toBeGreaterThanOrEqual(2 * size.width)
  expect(withFooter.height).toBeGreaterThan(2 * size.height)
  expect(withFooter.cornerAlpha).toBe(255)

  await goTo('settings')
  await expect(page.getByTestId('capture-footer-on')).toBeChecked()
  await page.getByTestId('capture-footer-off').click()
  await goTo('problems')

  const file = await exportTo('problems-timeline', 'capture-save')
  expect(file).toMatch(/Cliente_A_Producción_problems_\d{8}-\d{4}.*\.png$/)
  // AUD-14: el aviso dice el nombre del fichero escrito (con su -N si lo hay), no «Guardado:» vacío.
  await expect(exportMenu('problems-timeline').locator('xpath=..').getByRole('status')).toHaveText(
    `Guardado: ${basename(file)}`
  )
  const withoutFooter = await pngInfo(file)
  expect(Math.abs(withoutFooter.height - 2 * size.height)).toBeLessThanOrEqual(1)
  expect(withoutFooter.cornerAlpha).toBe(255)

  await goTo('settings')
  await page.getByTestId('capture-footer-on').click()
})

test('capture:region rechaza un rectángulo que no cabe en la ventana', async () => {
  const result = await page.evaluate(() =>
    (
      window as unknown as { vigia: { invoke: (...args: unknown[]) => Promise<unknown> } }
    ).vigia.invoke('capture:region', {
      module: 'problems',
      rect: { x: 0, y: 0, width: 100_000, height: 100_000 },
      action: 'save'
    })
  )
  expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
})

test('Métricas: búsqueda, consulta con resolución y gráfico', async () => {
  await goTo('metrics')
  await page.getByTestId('metric-search').fill('cpu')
  const options = page.getByTestId('metric-search-results').getByRole('option')
  await expect(options).toHaveCount(2)
  await options.filter({ hasText: 'CPU usage' }).click()
  await expect(page.getByTestId('metric-selector')).toHaveValue('builtin:host.cpu.usage')

  await page.getByTestId('metric-resolution').selectOption('5m')
  await page.getByTestId('metric-run').click()
  await expect(page.getByTestId('metric-chart').locator('canvas').first()).toBeVisible()
  expect(sim.lastMetricsQuery.get('metricSelector')).toBe('builtin:host.cpu.usage')
  expect(sim.lastMetricsQuery.get('resolution')).toBe('5m')
})

test('AUD-13: resolución aplicada bajo el gráfico', async () => {
  // Viene del test anterior: 5m consultado.
  await expect(page.getByTestId('metric-resolution-applied')).toHaveText(/Resolución aplicada: 5m/)

  // Sin resolución, la que diga la API (el simulador responde 1m).
  await page.getByTestId('metric-resolution').selectOption('')
  await page.getByTestId('metric-run').click()
  await expect.poll(() => sim.lastMetricsQuery.has('resolution')).toBe(false)
  await expect(page.getByTestId('metric-resolution-applied')).toHaveText(/Resolución aplicada: 1m/)
})

test('AUD-13: aviso de puntos antes de consultar y resolución sugerida', async () => {
  const estimate = page.getByTestId('points-estimate')
  const resolution = page.getByTestId('metric-resolution')
  await page.getByTestId('time-range-7d').click()

  // Sin resolución (120 puntos) o Inf (1): sin aviso.
  for (const value of ['', 'Inf', '1h']) {
    await resolution.selectOption(value)
    await expect(estimate).toHaveCount(0)
  }

  // 1m en 7 días son 10 081 puntos por serie.
  await resolution.selectOption('1m')
  await expect(estimate).toBeVisible()
  await expect(estimate).toContainText(/10\D?081/)
  const use = page.getByTestId('use-resolution')
  await expect(use).toHaveText(/Usar 10m/)

  // No bloquea: con el aviso, la consulta sale igual con 1m.
  const before = sim.metricsQueries
  await page.getByTestId('metric-run').click()
  await expect.poll(() => sim.metricsQueries).toBeGreaterThan(before)
  expect(sim.lastMetricsQuery.get('resolution')).toBe('1m')
  expect(sim.lastMetricsQuery.get('from')).toBe('now-7d')

  // «Usar 10m» cambia la resolución y el aviso desaparece.
  await use.click()
  await expect(resolution).toHaveValue('10m')
  await expect(estimate).toHaveCount(0)

  // En 2 h, 1m son 121 puntos: sin aviso.
  await page.getByTestId('time-range-2h').click()
  await resolution.selectOption('1m')
  await expect(estimate).toHaveCount(0)
  await resolution.selectOption('5m')
})

test('AUD-13: recortes y warnings de la API bajo el gráfico', async () => {
  const warnings = page.getByTestId('api-warnings')
  sim.metricRatios = { dataPointCountRatio: 0.5 }
  sim.metricWarnings = ['Aviso de métricas de la prueba']
  // Cada paso con una resolución nueva: una clave ya consultada sale de la caché sin petición.
  const resolution = page.getByTestId('metric-resolution')
  try {
    await resolution.selectOption('10m')
    await page.getByTestId('metric-run').click()
    await expect(warnings).toContainText(
      'builtin:host.cpu.usage: la API ha devuelto solo parte de los puntos (50 %)'
    )
    await expect(warnings).toContainText('Aviso de métricas de la prueba')
    await expect(warnings).not.toContainText('dimensiones')

    sim.metricRatios = { dimensionCountRatio: 0.25 }
    sim.metricWarnings = []
    await resolution.selectOption('1h')
    await page.getByTestId('metric-run').click()
    await expect(warnings).toContainText('parte de las dimensiones (25 %)')
    await expect(warnings).not.toContainText('parte de los puntos')

    // El XLSX lleva la resolución y los recortes como Aviso.
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(
      readFileSync(await exportTo('metric-chart', 'export-xlsx')) as unknown as ArrayBuffer
    )
    const info: [string, unknown][] = []
    workbook.getWorksheet('Info')?.eachRow((r) => {
      info.push([String(r.getCell(1).value), r.getCell(2).value])
    })
    expect(info.filter(([label]) => label === 'Resolución')).toEqual([['Resolución', '1h']])
    expect(
      info.filter(([label, value]) => label === 'Aviso' && String(value).includes('dimensiones'))
    ).toHaveLength(1)
  } finally {
    sim.metricRatios = {}
    sim.metricWarnings = []
  }
  // Vuelta a 5m (en caché, sin recortes): solo queda la resolución aplicada.
  await resolution.selectOption('5m')
  await page.getByTestId('metric-run').click()
  await expect(page.getByText(/la API ha devuelto solo parte/)).toHaveCount(0)
  await expect(page.getByTestId('metric-resolution-applied')).toBeVisible()
})

test('AUD-13: el buscador elige con Enter sin lanzar la consulta, y dice «Sin resultados»', async () => {
  const search = page.getByTestId('metric-search')
  const selector = page.getByTestId('metric-selector')
  await expect(search).toHaveAttribute('maxlength', '100')
  await selector.fill('otra.metrica')

  const before = sim.metricsQueries
  await search.fill('idle')
  const results = page.getByTestId('metric-search-result')
  await expect(results).toHaveCount(1)
  await search.press('Enter')
  await expect(selector).toHaveValue('builtin:host.cpu.idle')
  await expect(search).toHaveValue('')
  // Aserción negativa: un margen para que una consulta indebida llegara.
  await page.waitForTimeout(500)
  expect(sim.metricsQueries).toBe(before)

  // Un click en un resultado hace lo mismo.
  await search.fill('cpu')
  await expect(results).toHaveCount(2)
  await results.filter({ hasText: 'CPU usage' }).click()
  await expect(selector).toHaveValue('builtin:host.cpu.usage')
  await expect(search).toHaveValue('')
  expect(sim.metricsQueries).toBe(before)

  await search.fill('nada-que-casar')
  await expect(page.getByTestId('metric-search-empty')).toBeVisible()
  await expect(results).toHaveCount(0)
  await search.fill('')
})

test('AUD-13: con varias métricas, la leyenda lleva el metricId delante', async () => {
  const chart = page.getByTestId('metric-chart')
  await page.getByTestId('metric-selector').fill('builtin:host.cpu.usage,builtin:host.cpu.idle')
  await page.getByTestId('metric-run').click()
  await expect
    .poll(async () => JSON.parse((await chart.getAttribute('data-series')) ?? '[]') as string[])
    .toEqual(['builtin:host.cpu.usage · HOST-AAA1', 'builtin:host.cpu.idle · HOST-AAA1'])

  // Con una sola, solo las dimensiones.
  await page.getByTestId('metric-selector').fill('builtin:host.cpu.usage')
  await page.getByTestId('metric-run').click()
  await expect
    .poll(async () => JSON.parse((await chart.getAttribute('data-series')) ?? '[]') as string[])
    .toEqual(['HOST-AAA1'])
})

test('AUD-13: guardar con un nombre repetido dice que ya existe; cancelar limpia', async () => {
  const dialogName = page.getByTestId('saved-query-name')
  await page.getByTestId('saved-query-save').click()
  await dialogName.fill('Consulta repetida')
  await page.getByTestId('form-save').click()
  const saved = page.getByTestId('saved-query').filter({ hasText: 'Consulta repetida' })
  await expect(saved).toHaveCount(1)

  await page.getByTestId('saved-query-save').click()
  await dialogName.fill('Consulta repetida')
  await page.getByTestId('form-save').click()
  await expect(page.getByText(es.errors.nameTaken)).toBeVisible()
  await expect(saved).toHaveCount(1)

  // Cancelar limpia el nombre y el error.
  await page.getByTestId('form-cancel').click()
  await expect(dialogName).toHaveCount(0)
  await page.getByTestId('saved-query-save').click()
  await expect(dialogName).toHaveValue('')
  await expect(page.getByText(es.errors.nameTaken)).toHaveCount(0)
  await page.getByTestId('form-cancel').click()

  await saved.getByTestId('saved-query-delete').click()
  const confirm = page.getByTestId('confirm-dialog')
  // Siempre pide confirmación (AUD-15: aserción fija, no condicional).
  await expect(confirm).toBeVisible()
  await expect(confirm).toHaveAttribute('role', 'alertdialog')
  await confirm.getByTestId('confirm-accept').click()
  await expect(confirm).toBeHidden()
  await expect(saved).toHaveCount(0)
})

test('Métricas: guardar, cargar desde la lista y desde Ctrl+K, y borrar una consulta', async () => {
  await page.getByTestId('saved-query-save').click()
  await page.getByTestId('saved-query-name').fill('CPU producción')
  await page.getByTestId('form-save').click()
  const saved = page.getByTestId('saved-query').filter({ hasText: 'CPU producción' })
  await expect(saved).toHaveCount(1)

  await page.getByTestId('metric-selector').fill('builtin:host.mem.usage')
  await saved.click()
  await expect(page.getByTestId('metric-selector')).toHaveValue('builtin:host.cpu.usage')

  await goTo('home')
  await page.keyboard.press('Control+K')
  const palette = page.getByTestId('command-palette')
  await expect(palette.getByRole('option', { name: /CPU producción/ })).toHaveCount(1)
  await page.keyboard.type('CPU producción')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/#\/metrics/)
  await expect(page.getByTestId('metric-selector')).toHaveValue('builtin:host.cpu.usage')

  await saved.getByTestId('saved-query-delete').click()
  const confirm = page.getByTestId('confirm-dialog')
  // Siempre pide confirmación (AUD-15: aserción fija, no condicional).
  await expect(confirm).toBeVisible()
  await expect(confirm).toHaveAttribute('role', 'alertdialog')
  await confirm.getByTestId('confirm-accept').click()
  await expect(confirm).toBeHidden()
  await expect(page.getByTestId('saved-query').filter({ hasText: 'CPU producción' })).toHaveCount(0)
})

test('Inicio: problemas abiertos, SLOs y salud de servicios', async () => {
  await goTo('home')
  await expect(page.getByTestId('kpi-open-problems')).toContainText('2')
  const slos = page.getByTestId('kpi-slos')
  await expect(slos).toContainText('Disponibilidad pagos')
  await expect(slos).toContainText('Latencia carrito')
  await expect(slos).toContainText(/99[.,]5/)
  const health = page.getByTestId('service-health')
  await expect(health).toContainText('pagos')
  await expect(health).toContainText('carrito')
  // Los servicios de problemas cerrados y las entidades que no son servicios no salen.
  await expect(health).not.toContainText('host-pagos-01')
})

test('Inicio: estado de cada SLO (con texto y color), sin evaluar y problemas relacionados', async () => {
  await goTo('home')
  const card = page.getByTestId('kpi-slos')
  const item = (name: string): Locator => card.locator('li').filter({ hasText: name })
  const status = (name: string): Locator => item(name).getByTestId('slo-status')

  const expected = [
    ['Disponibilidad pagos', 'SUCCESS', 'text-muted-foreground'],
    ['Latencia carrito', 'FAILURE', 'text-danger'],
    ['Errores de login', 'WARNING', 'text-status-warning'],
    ['Búsqueda sin datos', 'UNEVALUATED', 'text-muted-foreground']
  ] as const
  for (const [name, value, cls] of expected) {
    await expect(status(name), name).toHaveAttribute('data-status', value)
    await expect(status(name), name).toHaveClass(new RegExp(`\\b${cls}\\b`))
    // El color nunca es la única señal: siempre hay texto.
    expect((await status(name).textContent())?.trim(), name).not.toBe('')
  }
  // WARNING no se pinta como FAILURE, ni con su color.
  await expect(status('Errores de login')).not.toHaveClass(/\btext-danger\b/)

  // Sin evaluar: «Sin evaluar», nunca «Correcto», y los valores con «—».
  await expect(status('Búsqueda sin datos')).toHaveText('Sin evaluar')
  await expect(item('Búsqueda sin datos')).not.toContainText('Correcto')
  await expect(item('Búsqueda sin datos')).toContainText('—')

  // Problemas abiertos relacionados: solo donde hay más de 0, con plural.
  await expect(card.getByTestId('slo-related-problems')).toHaveCount(1)
  await expect(item('Latencia carrito').getByTestId('slo-related-problems')).toHaveText(
    '2 problemas abiertos'
  )

  // La exportación lleva la columna, vacía si no hay dato.
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(
    readFileSync(await exportTo('kpi-slos', 'export-xlsx')) as unknown as ArrayBuffer
  )
  const sheet = workbook.getWorksheet('Datos')
  const header = (sheet?.getRow(1).values as unknown[]).slice(1).map(String)
  const column = header.indexOf('Problemas abiertos relacionados') + 1
  expect(column, `cabeceras: ${header.join(' | ')}`).toBeGreaterThan(0)
  const byName = new Map<string, unknown>()
  sheet?.eachRow((row, n) => {
    if (n > 1) byName.set(String(row.getCell(1).value), row.getCell(column).value)
  })
  expect(byName.get('Latencia carrito')).toBe(2)
  expect(byName.get('Disponibilidad pagos')).toBe(0)
  expect(byName.get('Búsqueda sin datos') ?? null).toBeNull()
})

test('rango personalizado: valida las fechas y se usa en las peticiones', async () => {
  await goTo('problems')
  await page.getByTestId('time-range-custom').click()
  const popover = page.getByTestId('custom-range')
  await expect(popover).toBeVisible()

  // Desde posterior a hasta: no vale.
  await popover.getByTestId('custom-range-from').fill('2026-10-02T12:00')
  await popover.getByTestId('custom-range-to').fill('2026-10-02T10:00')
  await popover.getByTestId('form-save').click()
  await expect(popover).toBeVisible()
  await expect(popover.getByRole('alert')).toBeVisible()
  await expect(
    popover.locator('[data-testid^="custom-range-"][aria-invalid="true"]').first()
  ).toBeVisible()

  await popover.getByTestId('custom-range-to').fill('2026-10-02T14:00')
  await popover.getByTestId('form-save').click()
  await expect(popover).toBeHidden()
  await page.getByTestId('module-refresh').click()

  await expect.poll(() => sim.lastProblemsQuery.get('to')).not.toBeNull()
  const from = new Date(sim.lastProblemsQuery.get('from') ?? '').getTime()
  const to = new Date(sim.lastProblemsQuery.get('to') ?? '').getTime()
  expect(to - from).toBe(2 * HOUR)

  await page.getByTestId('time-range-2h').click()
  await page.getByTestId('module-refresh').click()
  await expect.poll(() => sim.lastProblemsQuery.get('from')).toBe('now-2h')
})

test('cambiar de entorno no mezcla datos', async () => {
  await goTo('problems')
  await page.getByTestId('env-selector').click()
  await page.getByRole('option', { name: 'Cliente A › Desarrollo' }).click()
  const table = page.getByTestId('problems-table')
  await expect(table).toContainText('P-900')
  await expect(table).not.toContainText('P-101')

  await page.getByTestId('env-selector').click()
  await page.getByRole('option', { name: 'Cliente A › Producción' }).click()
  await expect(table).toContainText('P-101')
  await expect(table).not.toContainText('P-900')
})

test('un error de Dynatrace se muestra con el texto traducido del código', async () => {
  await activate('Prohibido')
  await goTo('problems')
  await expect(page.getByText(es.dtErrors.FORBIDDEN).first()).toBeVisible()
})

test('Métricas no disponible: sin metrics.read tras probar la conexión, o sin token clásico', async () => {
  await invoke('connection:test', { environmentId: env['Sin métricas'] })
  await activate('Sin métricas')
  await goTo('metrics')
  await expect(page.getByTestId('module-unavailable')).toContainText('metrics.read')
  await goTo('problems')
  await expect(page.getByTestId('module-unavailable')).toHaveCount(0)
  await expect(page.getByTestId('problem-row')).toHaveCount(3)

  await activate('Sin token')
  await goTo('metrics')
  await expect(page.getByTestId('module-unavailable')).toContainText(
    'Este módulo usa el token clásico'
  )
})

test('sin secretos en IPC ni en la página, sin errores de consola ni peticiones remotas del renderer', async () => {
  for (const output of ipcOutputs)
    for (const mark of SECRET_MARKS) expect(output).not.toContain(mark)
  const html = await page.content()
  for (const mark of SECRET_MARKS) expect(html).not.toContain(mark)
  expect(consoleErrors).toEqual([])
  expect(rendererRemote).toEqual([])
})
