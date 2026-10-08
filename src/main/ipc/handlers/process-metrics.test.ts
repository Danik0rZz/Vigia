import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcChannel } from '@shared/ipc'
import type { AppDatabase } from '../../db/database'
import { createDtClient } from '../../dynatrace/client'
import { createSavedQueryStore } from '../../modules/saved-queries'
import { createSecretStore } from '../../secrets/store'
import { createTenantRepository } from '../../tenants/repository'
import { createIpcHandler, type IpcHandlerDeps, type IpcImplementation } from '../handler'
import { createModuleHandlers } from './modules'
import { createTestDb, fakeCrypto } from '../../../test/fixtures'

/**
 * Ficha 0027: canal `entities:processMetrics` (una entidad PROCESS_GROUP_INSTANCE), con el
 * cliente de Dynatrace REAL sobre un fetch falso. Se comprueba qué se pide a /metrics/query y
 * cómo llega la respuesta a la interfaz.
 *
 * Usa SOLO las métricas que eligió el paso 0 (tabla de "Verificación" de la ficha) e imita lo
 * observado en vivo:
 * - CPU `builtin:tech.generic.cpu.usage` (Percent), memoria `…mem.workingSetSize` (Byte),
 *   disponibilidad `builtin:pgi.availability` (Percent) y recursos
 *   `…handles.fileDescriptorsPercentUsed` (Percent);
 * - red y salud de red se quedan sin métrica: ningún proceso de muestra trae datos de red
 *   (papeles `null`);
 * - con `entitySelector=entityId(...)`, cada expresión vuelve en el orden pedido, con el
 *   `metricId` igual a la expresión enviada y una sola serie; un proceso sin descriptores de
 *   fichero (Windows) llega sin series en esa métrica;
 * - `:fold(...)` junto con `resolution=Inf` da 400 (ficha 0006); con Inf, `:avg` y `:max` dan
 *   el valor del rango.
 */

const TRUSTED = { url: 'app://vigia/index.html', isMainFrame: true }
const TOKEN = `dt0c01.PUBLICAPRUEBA0000000000A.${'SECRETOPROC'.padEnd(64, 'X')}`
const BASE = 'https://abc12345.live.dynatrace.com'
const CHANNEL = 'entities:processMetrics' as IpcChannel
/** Id inventado, con el formato de Dynatrace. */
const PROCESS_ID = 'PROCESS_GROUP_INSTANCE-0123456789ABCDEF'
/** Momento fijo (epoch ms; la zona no importa aquí). */
const T0 = Date.parse('2026-10-03T08:00:00.000Z')
const T = [T0, T0 + 600_000, T0 + 1_200_000, T0 + 1_800_000]

const G = 'builtin:tech.generic.'
const CPU = `${G}cpu.usage`
const MEMORY = `${G}mem.workingSetSize`
const AVAILABILITY = 'builtin:pgi.availability'
const RESOURCES = `${G}handles.fileDescriptorsPercentUsed`

/** Series: las expresiones exactas probadas en vivo (paso 0), sin resolution. */
const SERIES_EXPRESSIONS = [CPU, MEMORY, AVAILABILITY, RESOURCES]
/** Marcadores: las expresiones exactas probadas en vivo, con resolution=Inf. */
const MARKER_EXPRESSIONS = [
  `${CPU}:avg`,
  `${CPU}:max`,
  `${MEMORY}:avg`,
  `${MEMORY}:max`,
  `${AVAILABILITY}:avg`,
  `${RESOURCES}:max`
]

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

/** Separa un metricSelector por las comas de primer nivel (no las de dentro de paréntesis). */
function splitSelector(selector: string): string[] {
  const parts: string[] = []
  let depth = 0
  let quoted = false
  let current = ''
  for (const char of selector) {
    if (char === '"') quoted = !quoted
    if (!quoted && char === '(') depth += 1
    if (!quoted && char === ')') depth -= 1
    if (!quoted && depth === 0 && char === ',') {
      parts.push(current)
      current = ''
      continue
    }
    current += char
  }
  if (current !== '') parts.push(current)
  return parts
}

/** ¿La consulta es la de los marcadores (un valor por métrica para todo el rango)? */
const isMarkerQuery = (query: URLSearchParams): boolean =>
  query.get('resolution') === 'Inf' || (query.get('metricSelector') ?? '').includes(':fold(')

type Values = (number | null)[]
/** Serie de cada expresión de series (las que no están aquí llegan sin series). */
let seriesData: Record<string, Values>
/** Valor del rango de cada expresión de marcadores. */
let markerData: Record<string, number | null>
/** Expresiones que llegan sin series (como los descriptores de un proceso de Windows). */
let noSeries: Set<string>
interface Extras {
  empty?: 'result' | 'data'
}
let seriesExtras: Extras
let markerExtras: Extras
let failWith: { status: number; message: string } | null

function dataOf(expression: string, marker: boolean): Values[] {
  if (noSeries.has(expression)) return []
  if (marker) return expression in markerData ? [[markerData[expression] ?? null]] : []
  const values = seriesData[expression]
  return values === undefined ? [] : [values]
}

function metricsResponse(query: URLSearchParams): Response {
  if (failWith !== null) {
    return json(failWith.status, { error: { code: failWith.status, message: failWith.message } })
  }
  const selector = query.get('metricSelector') ?? ''
  if (query.get('resolution') === 'Inf' && selector.includes(':fold(')) {
    return json(400, { error: { code: 400, message: 'fold no admite resolution Inf' } })
  }
  const marker = isMarkerQuery(query)
  const extras = marker ? markerExtras : seriesExtras
  const scoped = (query.get('entitySelector') ?? '').includes(PROCESS_ID)
  const result =
    extras.empty === 'result' || !scoped
      ? []
      : splitSelector(selector).map((expression) => ({
          // Como en vivo: la expresión enviada.
          metricId: expression,
          dataPointCountRatio: 0.005,
          dimensionCountRatio: 0.005,
          data:
            extras.empty === 'data'
              ? []
              : dataOf(expression, marker).map((values) => ({
                  dimensionMap: { 'dt.entity.process_group_instance': PROCESS_ID },
                  dimensions: [PROCESS_ID],
                  timestamps: marker ? [T0 + 2_400_000] : T,
                  values
                }))
        }))
  return json(200, {
    totalCount: result.length,
    nextPageKey: null,
    resolution: marker ? 'Inf' : '10m',
    result
  })
}

let requests: URL[]
let db: AppDatabase
let envId: string
let deps: IpcHandlerDeps
let handlers: ReturnType<typeof createModuleHandlers>

const fakeFetch = vi.fn(async (input: unknown) => {
  const url = new URL(String(input instanceof Request ? input.url : input))
  requests.push(url)
  if (url.pathname === '/api/v2/metrics/query') return metricsResponse(url.searchParams)
  return json(404, { error: { code: 404, message: 'No existe' } })
})

beforeEach(() => {
  requests = []
  failWith = null
  seriesExtras = {}
  markerExtras = {}
  noSeries = new Set()
  // Con null en medio y al final, como en vivo.
  seriesData = {
    [CPU]: [12.5, null, 30, null],
    [MEMORY]: [250_000_000, null, 262_144_000, null],
    [AVAILABILITY]: [100, 100, null, 50],
    [RESOURCES]: [0.4, null, 0.6, null]
  }
  // Distintos de lo que saldría de las series: los marcadores salen de su consulta.
  markerData = {
    [`${CPU}:avg`]: 18.75,
    [`${CPU}:max`]: 96.5,
    [`${MEMORY}:avg`]: 255_000_000,
    [`${MEMORY}:max`]: 270_000_000,
    [`${AVAILABILITY}:avg`]: 87.5,
    [`${RESOURCES}:max`]: 0.75
  }

  db = createTestDb()
  const repo = createTenantRepository(db)
  const secrets = createSecretStore(db, fakeCrypto())
  const client = repo.createClient({ name: 'Cliente A', color: '#111111' })
  envId = repo.createEnvironment({
    clientId: client.id,
    name: 'Producción',
    type: 'production',
    deployment: 'saas',
    classicApiUrl: BASE,
    platformUrl: null,
    ssoUrl: null,
    oauthClientId: null,
    oauthScopes: [],
    accountUuid: null,
    certificateLevel: 'system',
    captureUrlPatterns: [],
    tags: [],
    readOnly: false
  }).id
  secrets.set(envId, 'classicToken', TOKEN)

  const dtClient = createDtClient({
    fetchFor: () => fakeFetch as unknown as typeof fetch,
    getEnvironment: (id: string) => repo.getEnvironment(id),
    readSecret: (id: string, kind: 'classicToken' | 'oauthClientSecret' | 'platformToken') =>
      secrets.read(id, kind),
    oauth: { getToken: vi.fn(), invalidate: vi.fn(), expiresAt: vi.fn(() => null) },
    sleep: async () => undefined,
    now: () => new Date('2026-10-03T10:00:00.000Z'),
    random: () => 0,
    logger: { warn: vi.fn(), error: vi.fn() }
  } as unknown as Parameters<typeof createDtClient>[0])

  handlers = createModuleHandlers({
    client: dtClient,
    savedQueries: createSavedQueryStore(db),
    repo
  } as unknown as Parameters<typeof createModuleHandlers>[0])
  deps = { isTrustedSender: () => true, logger: { warn: vi.fn(), error: vi.fn() } }
})

afterEach(() => {
  db.$client.close()
})

interface Envelope {
  ok: boolean
  data?: unknown
  error?: { code: string; message: string; reason?: { key: string } }
}

async function call(input: unknown): Promise<Envelope> {
  const implementation = (handlers as Record<string, unknown>)[CHANNEL] as IpcImplementation<
    typeof CHANNEL
  >
  expect(implementation, `implementación de ${CHANNEL}`).toBeTypeOf('function')
  const result = (await createIpcHandler(CHANNEL, implementation, deps)(TRUSTED, input)) as Envelope
  expect(JSON.stringify(result)).not.toContain('SECRETOPROC')
  return result
}

const metricQueries = (): URL[] => requests.filter((u) => u.pathname === '/api/v2/metrics/query')
const seriesQuery = (): URL | undefined =>
  metricQueries().find((u) => !isMarkerQuery(u.searchParams))
const markerQuery = (): URL | undefined =>
  metricQueries().find((u) => isMarkerQuery(u.searchParams))
const expressionsOf = (url: URL | undefined): string[] =>
  splitSelector(url?.searchParams.get('metricSelector') ?? '')

const series = (values: Values): { timestamps: number[]; values: Values } => ({
  timestamps: T,
  values
})
const none = { timestamps: [], values: [] }
const base = { entityId: PROCESS_ID, timeRange: '2h' as const }

describe('CA3 (0027): las consultas llevan las métricas elegidas, el id y el rango', () => {
  it.each([
    ['relativo (2h)', '2h' as const, { from: 'now-2h', to: null }],
    [
      'absoluto',
      { from: '2026-10-01T08:00:00.000Z', to: '2026-10-01T10:00:00.000Z' },
      { from: '2026-10-01T08:00:00.000Z', to: '2026-10-01T10:00:00.000Z' }
    ]
  ])('rango %s', async (_case, timeRange, expected) => {
    const result = await call({ environmentId: envId, entityId: PROCESS_ID, timeRange })
    expect(result.ok, JSON.stringify(result.error)).toBe(true)

    // Exactamente dos peticiones, y las dos a /metrics/query: series y marcadores.
    expect(requests).toHaveLength(2)
    expect(metricQueries()).toHaveLength(2)
    const seriesUrl = seriesQuery()
    const markersUrl = markerQuery()
    expect(seriesUrl, 'consulta de series').toBeDefined()
    expect(markersUrl, 'consulta de marcadores').toBeDefined()

    // Series: exactamente las expresiones probadas en vivo, sin resolution (la elige la API).
    expect(seriesUrl?.searchParams.has('resolution')).toBe(false)
    expect([...expressionsOf(seriesUrl)].sort()).toEqual([...SERIES_EXPRESSIONS].sort())

    // Marcadores: rango completo con resolution=Inf y sin fold (juntos dan 400).
    expect(markersUrl?.searchParams.get('resolution')).toBe('Inf')
    expect(markersUrl?.searchParams.get('metricSelector') ?? '').not.toContain(':fold(')
    expect([...expressionsOf(markersUrl)].sort()).toEqual([...MARKER_EXPRESSIONS].sort())

    // Acotadas al proceso pedido con entityId (como en el paso 0); sin métricas de red; y el rango.
    for (const url of [seriesUrl, markersUrl]) {
      expect(url?.searchParams.get('entitySelector')).toBe(`entityId("${PROCESS_ID}")`)
      expect(url?.searchParams.get('metricSelector') ?? '').not.toContain('.network.')
      expect(url?.searchParams.get('from')).toBe(expected.from)
      expect(url?.searchParams.get('to')).toBe(expected.to)
    }
  })

  it('la interfaz no manda selectores: un metricSelector en la entrada no llega a Dynatrace', async () => {
    const result = await call({
      environmentId: envId,
      ...base,
      metricSelector: 'builtin:tenant.otra'
    })
    // O lo rechaza el esquema o se ignora; nunca se envía.
    for (const url of metricQueries()) {
      expect(url.searchParams.get('metricSelector') ?? '').not.toContain('builtin:tenant.otra')
    }
    if (result.ok) expect(metricQueries()).toHaveLength(2)
  })
})

describe('CA4 (0027): la respuesta se transforma por papel, con papeles null', () => {
  it('series por papel con los null conservados; red y salud de red sin métrica (null)', async () => {
    const result = await call({ environmentId: envId, ...base })
    expect(result.ok, JSON.stringify(result.error)).toBe(true)
    expect(result.data).toMatchObject({
      // La de la consulta de series (no la de los marcadores, Inf).
      resolution: '10m',
      series: {
        // %, bytes y % tal cual, sin convertir.
        cpu: series([12.5, null, 30, null]),
        memory: series([250_000_000, null, 262_144_000, null]),
        availability: series([100, 100, null, 50]),
        resources: series([0.4, null, 0.6, null]),
        // Papeles sin métrica (paso 0).
        network: null,
        networkHealth: null
      },
      warnings: [],
      partial: []
    })
  })

  it('marcadores: CPU y memoria media y máxima, disponibilidad media, recursos máximo y red null', async () => {
    const result = await call({ environmentId: envId, ...base })
    expect(result.ok, JSON.stringify(result.error)).toBe(true)
    expect((result.data as { totals: unknown }).totals).toEqual({
      cpu: { avg: 18.75, max: 96.5 },
      memory: { avg: 255_000_000, max: 270_000_000 },
      network: null,
      availability: 87.5,
      resources: 0.75
    })
  })

  it('un proceso sin descriptores de fichero: recursos vacío y su marcador a null; otro marcador sin dato, null', async () => {
    noSeries = new Set([RESOURCES, `${RESOURCES}:max`])
    markerData = { ...markerData, [`${CPU}:max`]: null }
    const result = await call({ environmentId: envId, ...base })
    expect(result.ok, JSON.stringify(result.error)).toBe(true)
    expect(result.data).toMatchObject({
      series: { cpu: series([12.5, null, 30, null]), resources: none },
      totals: { cpu: { avg: 18.75, max: null }, resources: null }
    })
  })
})

describe('CA5 (0027): errores de Dynatrace y proceso sin datos', () => {
  it.each([400, 404])('un %i acaba en error con reason', async (status) => {
    failWith = { status, message: 'Mensaje de Dynatrace en la prueba' }
    const result = await call({ environmentId: envId, ...base })
    expect(result.ok).toBe(false)
    expect(result.error?.reason?.key, 'reason del error').toEqual(expect.any(String))
  })

  it.each([
    ['sin resultados (result vacío)', 'result' as const],
    ['resultados sin series (data vacío)', 'data' as const]
  ])('%s: series vacías y marcadores a null, sin error', async (_case, empty) => {
    seriesExtras = { empty }
    markerExtras = { empty }
    const result = await call({ environmentId: envId, ...base })
    expect(result.ok, JSON.stringify(result.error)).toBe(true)
    expect(result.data).toMatchObject({
      series: {
        cpu: none,
        memory: none,
        availability: none,
        resources: none,
        network: null,
        networkHealth: null
      }
    })
    expect((result.data as { totals: unknown }).totals).toEqual({
      cpu: { avg: null, max: null },
      memory: { avg: null, max: null },
      network: null,
      availability: null,
      resources: null
    })
  })
})
