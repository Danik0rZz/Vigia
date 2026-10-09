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
 * Ficha 0040: canal `entities:diskMetrics` (una entidad DISK), con el cliente de Dynatrace REAL
 * sobre un fetch falso. Se comprueba qué se pide a /metrics/query y cómo llega la respuesta.
 *
 * Usa SOLO las métricas que eligió el paso 0 (tabla de "Verificación" de la ficha) e imita lo
 * observado en vivo (`disk-metrics-explore.live.test.ts`):
 * - las 16 de `builtin:host.disk.*` tienen `entityType` HOST y las dimensiones
 *   `dt.entity.host` y `dt.entity.disk`. Con `entitySelector=entityId("<disco>")` NO llega
 *   ninguna serie: el disco se acota con `:filter(eq("dt.entity.disk","<disco>"))`, que da una
 *   serie por expresión;
 * - el `metricId` de la respuesta NO es la expresión enviada: Dynatrace quita las comillas del
 *   valor del filtro (`eq("dt.entity.disk",DISK-…)`). Los resultados se casan por posición;
 * - la OpenAPI documenta como mucho 10 métricas por consulta (decisión de la 0039): el
 *   simulador responde 400 con más;
 * - el último punto de las series suele llegar a null; `:last` con `resolution=Inf` da 400
 *   (ficha 0017) y `:fold(...)` con `Inf`, también (ficha 0006).
 *
 * Forma de la salida (decisión del test-writer, delegada y refinable; en la ficha):
 * - `series`: `usage` (%), `space.used` y `space.free` (bytes; `free` es `avail`),
 *   `throughput.read` y `.write` (bytes/s), `latency.read` y `.write` (ms), `queue` (longitud
 *   media) e `inodes` (% de inodos libres);
 * - `totals`: `usage` (% máximo del rango), `free` (último dato de `avail`, en bytes),
 *   `throughput.read`/`.write` (medias), `latency.read`/`.write` (medias, ms) y `queue` (media);
 * - papeles `null`: latencia, cola e inodos son `null` (en `series` y en `totals`) si Dynatrace
 *   no devuelve ninguna serie para sus métricas en ese disco (no todos los discos las traen).
 *   Uso, espacio y rendimiento nunca son `null`: sin series, llegan vacías y su marcador a null.
 */

const TRUSTED = { url: 'app://vigia/index.html', isMainFrame: true }
const TOKEN = `dt0c01.PUBLICAPRUEBA0000000000A.${'SECRETODISCO'.padEnd(64, 'X')}`
const BASE = 'https://abc12345.live.dynatrace.com'
const CHANNEL = 'entities:diskMetrics' as IpcChannel
/** Ids inventados, con el formato de Dynatrace. */
const DISK_ID = 'DISK-0123456789ABCDEF'
const HOST_ID = 'HOST-FEDCBA9876543210'
/** Momento fijo (epoch ms; la zona no importa aquí). */
const T0 = Date.parse('2026-10-03T08:00:00.000Z')
const T = [T0, T0 + 60_000, T0 + 120_000, T0 + 180_000]

/** Límite de la OpenAPI: «You can select up to 10 metrics for one query» (ficha 0039). */
const MAX_EXPRESSIONS = 10

const P = 'builtin:host.disk.'
const USED_PCT = `${P}usedPct`
const USED = `${P}used`
const AVAIL = `${P}avail`
const READ = `${P}bytesRead`
const WRITE = `${P}bytesWritten`
const READ_TIME = `${P}readTime`
const WRITE_TIME = `${P}writeTime`
const QUEUE = `${P}queueLength`
const INODES = `${P}inodesAvail`

/** Filtro por el disco: la forma confirmada en vivo (con entityId no llega nada). */
const FILTER = `:filter(eq("dt.entity.disk","${DISK_ID}"))`
const f = (metric: string, aggregation = ''): string => `${metric}${FILTER}${aggregation}`

/** Series: las expresiones exactas probadas en vivo (paso 0), sin resolution. */
const SERIES_EXPRESSIONS = [
  USED_PCT,
  USED,
  AVAIL,
  READ,
  WRITE,
  READ_TIME,
  WRITE_TIME,
  QUEUE,
  INODES
].map((metric) => f(metric))
/** Marcadores: las expresiones exactas probadas en vivo, con resolution=Inf. */
const MARKER_EXPRESSIONS = [
  f(USED_PCT, ':max'),
  f(READ, ':avg'),
  f(WRITE, ':avg'),
  f(READ_TIME, ':avg'),
  f(WRITE_TIME, ':avg'),
  f(QUEUE, ':avg')
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

const isMarkerQuery = (query: URLSearchParams): boolean => query.get('resolution') === 'Inf'

type Values = (number | null)[]
/** Serie de cada métrica (sin filtro ni agregación). */
let seriesData: Record<string, Values>
/** Valor del rango de cada expresión de marcador (con su filtro y su agregación). */
let markerData: Record<string, number | null>
/** Métricas que no traen ninguna serie para este disco (en series y en marcadores). */
let noSeries: Set<string>
let emptyResult: boolean
let failWith: { status: number; message: string } | null

/** Métrica base de una expresión del canal (sin filtro ni agregación). */
const metricOf = (expression: string): string => expression.split(':filter(')[0] ?? expression

function metricsResponse(query: URLSearchParams): Response {
  if (failWith !== null) {
    return json(failWith.status, { error: { code: failWith.status, message: failWith.message } })
  }
  const selector = query.get('metricSelector') ?? ''
  const expressions = splitSelector(selector)
  if (expressions.length > MAX_EXPRESSIONS) {
    return json(400, { error: { code: 400, message: 'Más de 10 métricas en una consulta' } })
  }
  const marker = isMarkerQuery(query)
  if (marker && (selector.includes(':fold(') || selector.includes(':last'))) {
    return json(400, { error: { code: 400, message: 'fold y last no admiten resolution Inf' } })
  }
  // Como en vivo: la entidad de estas métricas es el HOST; acotar con entityId del disco no
  // devuelve ninguna serie.
  const byDiskEntity = (query.get('entitySelector') ?? '').includes(DISK_ID)
  const result = emptyResult
    ? []
    : expressions.map((expression) => {
        const metric = metricOf(expression)
        const scoped = expression.includes(FILTER) && !byDiskEntity
        let data: Values[] = []
        if (scoped && !noSeries.has(metric)) {
          if (marker) data = expression in markerData ? [[markerData[expression] ?? null]] : []
          else data = seriesData[metric] === undefined ? [] : [seriesData[metric]]
        }
        return {
          // Como en vivo: Dynatrace quita las comillas del valor del filtro.
          metricId: expression.replace(`"${DISK_ID}"`, DISK_ID),
          dataPointCountRatio: 0.004,
          dimensionCountRatio: 0.004,
          data: data.map((values) => ({
            dimensionMap: { 'dt.entity.host': HOST_ID, 'dt.entity.disk': DISK_ID },
            dimensions: [HOST_ID, DISK_ID],
            timestamps: marker ? [T0 + 240_000] : T,
            values
          }))
        }
      })
  return json(200, {
    totalCount: result.length,
    nextPageKey: null,
    resolution: marker ? 'Inf' : '1m',
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
  emptyResult = false
  noSeries = new Set()
  // Con null en medio y al final, como en vivo.
  seriesData = {
    [USED_PCT]: [61.5, null, 63.25, null],
    [USED]: [61_500_000_000, null, 63_250_000_000, null],
    [AVAIL]: [38_500_000_000, 37_000_000_000, 36_750_000_000, null],
    [READ]: [1_024, null, 2_048.5, null],
    [WRITE]: [4_096, 8_192, null, null],
    [READ_TIME]: [1.5, null, 2.25, null],
    [WRITE_TIME]: [3, null, 4.5, null],
    [QUEUE]: [0.25, null, 0.5, null],
    [INODES]: [97.5, null, 97.25, null]
  }
  // Distintos de lo que saldría de las series: los marcadores salen de su consulta.
  markerData = {
    [f(USED_PCT, ':max')]: 91.5,
    [f(READ, ':avg')]: 1_500,
    [f(WRITE, ':avg')]: 6_000,
    [f(READ_TIME, ':avg')]: 1.75,
    [f(WRITE_TIME, ':avg')]: 3.5,
    [f(QUEUE, ':avg')]: 0.375
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
  expect(JSON.stringify(result)).not.toContain('SECRETODISCO')
  return result
}

const metricQueries = (): URL[] => requests.filter((u) => u.pathname === '/api/v2/metrics/query')
const expressionsOf = (urls: URL[]): string[] =>
  urls.flatMap((url) => splitSelector(url.searchParams.get('metricSelector') ?? ''))
const seriesQueries = (): URL[] => metricQueries().filter((u) => !isMarkerQuery(u.searchParams))
const markerQueries = (): URL[] => metricQueries().filter((u) => isMarkerQuery(u.searchParams))

const series = (values: Values): { timestamps: number[]; values: Values } => ({
  timestamps: T,
  values
})
const none = { timestamps: [], values: [] }
const base = { entityId: DISK_ID, timeRange: '2h' as const }

describe('CA3 (0040): las consultas llevan las métricas elegidas, el id y el rango', () => {
  it.each([
    ['relativo (2h)', '2h' as const, { from: 'now-2h', to: null }],
    [
      'absoluto',
      { from: '2026-10-01T08:00:00.000Z', to: '2026-10-01T10:00:00.000Z' },
      { from: '2026-10-01T08:00:00.000Z', to: '2026-10-01T10:00:00.000Z' }
    ]
  ])('rango %s', async (_case, timeRange, expected) => {
    const result = await call({ environmentId: envId, entityId: DISK_ID, timeRange })
    expect(result.ok, JSON.stringify(result.error)).toBe(true)

    // Todo a /metrics/query; al menos una consulta de series y una de marcadores.
    expect(requests.length).toBeGreaterThan(0)
    expect(metricQueries()).toHaveLength(requests.length)
    expect(seriesQueries().length).toBeGreaterThan(0)
    expect(markerQueries().length).toBeGreaterThan(0)

    // Series: exactamente las expresiones probadas en vivo, una vez cada una, sin resolution.
    for (const url of seriesQueries()) expect(url.searchParams.has('resolution')).toBe(false)
    expect([...expressionsOf(seriesQueries())].sort()).toEqual([...SERIES_EXPRESSIONS].sort())

    // Marcadores: rango completo con resolution=Inf, sin fold ni last (dan 400 con Inf).
    expect([...expressionsOf(markerQueries())].sort()).toEqual([...MARKER_EXPRESSIONS].sort())

    for (const url of metricQueries()) {
      // Ninguna consulta pasa de 10 expresiones (OpenAPI, decisión de la 0039).
      expect(
        splitSelector(url.searchParams.get('metricSelector') ?? '').length
      ).toBeLessThanOrEqual(MAX_EXPRESSIONS)
      // El disco va en el filtro: con entityId del disco Dynatrace no devuelve nada.
      expect(url.searchParams.get('entitySelector') ?? '').not.toContain(DISK_ID)
      expect(url.searchParams.get('from')).toBe(expected.from)
      expect(url.searchParams.get('to')).toBe(expected.to)
    }
  })

  it('la interfaz no manda selectores: un metricSelector en la entrada no llega a Dynatrace', async () => {
    const result = await call({ environmentId: envId, ...base, metricSelector: 'builtin:otra' })
    for (const url of metricQueries()) {
      expect(url.searchParams.get('metricSelector') ?? '').not.toContain('builtin:otra')
    }
    if (result.ok) expect(expressionsOf(seriesQueries())).toHaveLength(SERIES_EXPRESSIONS.length)
  })
})

describe('CA3 (0040): la respuesta se transforma por papel, con papeles null', () => {
  it('series por papel, casadas por posición aunque el metricId no sea la expresión enviada', async () => {
    const result = await call({ environmentId: envId, ...base })
    expect(result.ok, JSON.stringify(result.error)).toBe(true)
    expect(result.data).toMatchObject({
      // La de la consulta de series (no la de los marcadores, Inf).
      resolution: '1m',
      series: {
        // %, bytes, bytes/s y ms tal cual, sin convertir.
        usage: series([61.5, null, 63.25, null]),
        space: {
          used: series([61_500_000_000, null, 63_250_000_000, null]),
          free: series([38_500_000_000, 37_000_000_000, 36_750_000_000, null])
        },
        throughput: {
          read: series([1_024, null, 2_048.5, null]),
          write: series([4_096, 8_192, null, null])
        },
        latency: {
          read: series([1.5, null, 2.25, null]),
          write: series([3, null, 4.5, null])
        },
        queue: series([0.25, null, 0.5, null]),
        inodes: series([97.5, null, 97.25, null])
      },
      warnings: [],
      partial: []
    })
  })

  it('marcadores: uso máximo, libre del último dato, medias de lectura, escritura, latencia y cola', async () => {
    const result = await call({ environmentId: envId, ...base })
    expect(result.ok, JSON.stringify(result.error)).toBe(true)
    expect((result.data as { totals: unknown }).totals).toEqual({
      usage: 91.5,
      // Último punto con dato de `avail` (el último llega a null).
      free: 36_750_000_000,
      throughput: { read: 1_500, write: 6_000 },
      latency: { read: 1.75, write: 3.5 },
      queue: 0.375
    })
  })

  it('un disco sin latencia ni inodos: esos papeles a null y el resto con sus datos', async () => {
    noSeries = new Set([READ_TIME, WRITE_TIME, INODES])
    const result = await call({ environmentId: envId, ...base })
    expect(result.ok, JSON.stringify(result.error)).toBe(true)
    expect(result.data).toMatchObject({
      series: {
        usage: series([61.5, null, 63.25, null]),
        latency: null,
        queue: series([0.25, null, 0.5, null]),
        inodes: null
      }
    })
    expect((result.data as { totals: unknown }).totals).toEqual({
      usage: 91.5,
      free: 36_750_000_000,
      throughput: { read: 1_500, write: 6_000 },
      latency: null,
      queue: 0.375
    })
  })

  it('un disco sin cola: queue a null en series y en marcadores', async () => {
    noSeries = new Set([QUEUE])
    const result = await call({ environmentId: envId, ...base })
    expect(result.ok, JSON.stringify(result.error)).toBe(true)
    expect(result.data).toMatchObject({
      series: { queue: null, latency: { read: series([1.5, null, 2.25, null]) } },
      totals: { queue: null, latency: { read: 1.75, write: 3.5 } }
    })
  })

  it('un marcador sin dato llega a null sin anular su papel', async () => {
    markerData = { ...markerData, [f(USED_PCT, ':max')]: null, [f(READ, ':avg')]: null }
    const result = await call({ environmentId: envId, ...base })
    expect(result.ok, JSON.stringify(result.error)).toBe(true)
    expect(result.data).toMatchObject({
      series: { usage: series([61.5, null, 63.25, null]) },
      totals: { usage: null, throughput: { read: null, write: 6_000 } }
    })
  })
})

describe('CA3 (0040): errores de Dynatrace y disco sin datos', () => {
  it.each([400, 404])('un %i acaba en error con reason', async (status) => {
    failWith = { status, message: 'Mensaje de Dynatrace en la prueba' }
    const result = await call({ environmentId: envId, ...base })
    expect(result.ok).toBe(false)
    expect(result.error?.reason?.key, 'reason del error').toEqual(expect.any(String))
  })

  it.each([
    ['sin resultados (result vacío)', 'result' as const],
    ['resultados sin series (data vacío)', 'data' as const]
  ])('%s: uso, espacio y rendimiento vacíos, opcionales a null, sin error', async (_c, empty) => {
    if (empty === 'result') emptyResult = true
    else
      noSeries = new Set([USED_PCT, USED, AVAIL, READ, WRITE, READ_TIME, WRITE_TIME, QUEUE, INODES])
    const result = await call({ environmentId: envId, ...base })
    expect(result.ok, JSON.stringify(result.error)).toBe(true)
    expect(result.data).toMatchObject({
      series: {
        usage: none,
        space: { used: none, free: none },
        throughput: { read: none, write: none },
        latency: null,
        queue: null,
        inodes: null
      }
    })
    expect((result.data as { totals: unknown }).totals).toEqual({
      usage: null,
      free: null,
      throughput: { read: null, write: null },
      latency: null,
      queue: null
    })
  })
})
