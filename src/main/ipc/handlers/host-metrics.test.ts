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
 * Ficha 0016: canal `entities:hostMetrics` (CPU, memoria, red y disco de una entidad
 * HOST), con el cliente de Dynatrace REAL sobre un fetch falso. Se comprueba qué se
 * pide a /metrics/query y cómo llega la respuesta a la interfaz.
 *
 * El fetch falso imita lo observado en vivo (paso 0 de la ficha):
 * - las 11 candidatas existen; `cpu.*`, `mem.usage` y `disk.usedPct` en Percent
 *   (0–100), `cpu.load` en Ratio, `mem.used` y `mem.total` en Byte y
 *   `net.nic.traffic*` en BitPerSecond;
 * - con `entitySelector=entityId(...)`, las 10 expresiones de series caben en una
 *   consulta (200) y vuelven en el orden pedido, con el `metricId` igual a la
 *   expresión enviada;
 * - red y disco llegan con una serie por interfaz o por disco; `:splitBy():sum`
 *   (red) y `:splitBy():max` (disco) dan una sola serie, igual a la suma o al
 *   máximo por punto (también con `resolution=Inf`);
 * - `:fold(...)` junto con `resolution=Inf` da 400 (ficha 0006); con Inf, `:avg` y
 *   `:max` dan el valor real del rango;
 * - el último punto de la serie suele llegar a null: usada y total de la memoria
 *   salen del último punto con dato.
 */

const TRUSTED = { url: 'app://vigia/index.html', isMainFrame: true }
const TOKEN = `dt0c01.PUBLICAPRUEBA0000000000A.${'SECRETOHOST'.padEnd(64, 'X')}`
const BASE = 'https://abc12345.live.dynatrace.com'
const CHANNEL = 'entities:hostMetrics' as IpcChannel
/** Id inventado, con el formato de Dynatrace. */
const HOST_ID = 'HOST-0123456789ABCDEF'
/** Momento fijo (epoch ms; la zona no importa aquí). */
const T0 = Date.parse('2026-10-03T08:00:00.000Z')
const T = [T0, T0 + 60_000, T0 + 120_000, T0 + 180_000]

const CPU = 'builtin:host.cpu.usage'
const CPU_USER = 'builtin:host.cpu.user'
const CPU_SYSTEM = 'builtin:host.cpu.system'
const CPU_IOWAIT = 'builtin:host.cpu.iowait'
const LOAD = 'builtin:host.cpu.load'
const MEM = 'builtin:host.mem.usage'
const MEM_USED = 'builtin:host.mem.used'
const MEM_TOTAL = 'builtin:host.mem.total'
const NET_IN = 'builtin:host.net.nic.trafficIn'
const NET_OUT = 'builtin:host.net.nic.trafficOut'
const DISK = 'builtin:host.disk.usedPct'

type SeriesKind =
  | 'cpu'
  | 'user'
  | 'system'
  | 'iowait'
  | 'memory'
  | 'memUsed'
  | 'memTotal'
  | 'netIn'
  | 'netOut'
  | 'disk'
type MarkerKind = 'cpuAvg' | 'cpuMax' | 'memoryAvg' | 'netInAvg' | 'netOutAvg' | 'diskMax' | 'load'

const SERIES_KINDS: SeriesKind[] = [
  'cpu',
  'user',
  'system',
  'iowait',
  'memory',
  'memUsed',
  'memTotal',
  'netIn',
  'netOut',
  'disk'
]
const MARKER_KINDS: MarkerKind[] = [
  'cpuAvg',
  'cpuMax',
  'memoryAvg',
  'netInAvg',
  'netOutAvg',
  'diskMax',
  'load'
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

/** Clave de la métrica (lo que va antes de la primera transformación). */
const keyOf = (expression: string): string =>
  /^builtin:[A-Za-z.]+/.exec(expression)?.[0].replace(/\.$/, '') ?? ''

/** ¿Junta todas las interfaces o discos? `splitBy()` o `splitBy("dt.entity.host")`. */
const merged = (expression: string): boolean =>
  /:splitBy\((\s*|"dt\.entity\.host")\)/.test(expression)
const has = (expression: string, aggregation: string): boolean =>
  new RegExp(`:${aggregation}\\b`).test(expression)
/** Sin agregación o con la de por defecto (avg). */
const plainOrAvg = (expression: string): boolean =>
  !has(expression, 'max') && !has(expression, 'min') && !has(expression, 'sum')

/** Qué pide una expresión de la consulta de series (null si no es ninguna de las de la ficha). */
function seriesKindOf(expression: string): SeriesKind | null {
  const key = keyOf(expression)
  if (key === CPU && plainOrAvg(expression)) return 'cpu'
  if (key === CPU_USER && plainOrAvg(expression)) return 'user'
  if (key === CPU_SYSTEM && plainOrAvg(expression)) return 'system'
  if (key === CPU_IOWAIT && plainOrAvg(expression)) return 'iowait'
  if (key === MEM && plainOrAvg(expression)) return 'memory'
  if (key === MEM_USED && plainOrAvg(expression)) return 'memUsed'
  if (key === MEM_TOTAL && plainOrAvg(expression)) return 'memTotal'
  if (key === NET_IN && merged(expression) && has(expression, 'sum')) return 'netIn'
  if (key === NET_OUT && merged(expression) && has(expression, 'sum')) return 'netOut'
  if (key === DISK && merged(expression) && has(expression, 'max')) return 'disk'
  return null
}

/** Qué pide una expresión de la consulta de marcadores (resolution=Inf). */
function markerKindOf(expression: string): MarkerKind | null {
  const key = keyOf(expression)
  if (key === CPU && has(expression, 'max')) return 'cpuMax'
  if (key === CPU && plainOrAvg(expression)) return 'cpuAvg'
  if (key === MEM && plainOrAvg(expression)) return 'memoryAvg'
  if (key === NET_IN && merged(expression) && has(expression, 'sum')) return 'netInAvg'
  if (key === NET_OUT && merged(expression) && has(expression, 'sum')) return 'netOutAvg'
  if (key === DISK && merged(expression) && has(expression, 'max')) return 'diskMax'
  if (key === LOAD && plainOrAvg(expression)) return 'load'
  return null
}

/** ¿La consulta es la de los marcadores (un valor por métrica para todo el rango)? */
const isMarkerQuery = (query: URLSearchParams): boolean =>
  query.get('resolution') === 'Inf' || (query.get('metricSelector') ?? '').includes(':fold(')

/** ¿La expresión (o la consulta) va acotada al host pedido? */
function scopedToHost(expression: string, query: URLSearchParams): boolean {
  return (
    expression.includes(HOST_ID) ||
    (query.get('entitySelector') ?? '').includes(`entityId("${HOST_ID}")`)
  )
}

type Values = (number | null)[]
/** Series de la consulta de series, ya juntas (lo que devuelve splitBy():sum o :max). */
let seriesData: Record<SeriesKind, Values>
/** Sin juntar: una serie por interfaz o por disco (si main no pidiera splitBy()). */
let perItem: { netIn: Values[]; netOut: Values[]; disk: Values[] }
/** Valor único de cada marcador (consulta con resolution=Inf). */
let markerData: Record<MarkerKind, number | null>
interface Extras {
  warnings?: string[]
  ratios?: Record<string, number>
  empty?: 'result' | 'data'
}
let seriesExtras: Extras
let markerExtras: Extras
let failWith: { status: number; message: string } | null

/** Las series de un resultado: una sola si va junta; si no, una por interfaz o por disco. */
function dataOf(expression: string, marker: boolean): { dimension: string; values: Values }[] {
  if (marker) {
    const kind = markerKindOf(expression)
    return kind === null ? [] : [{ dimension: HOST_ID, values: [markerData[kind]] }]
  }
  const kind = seriesKindOf(expression)
  if (kind !== null) return [{ dimension: HOST_ID, values: seriesData[kind] }]
  // Red o disco sin juntar: como en vivo, una serie por interfaz o por disco.
  const key = keyOf(expression)
  const items =
    key === NET_IN
      ? perItem.netIn
      : key === NET_OUT
        ? perItem.netOut
        : key === DISK
          ? perItem.disk
          : []
  return items.map((values, i) => ({ dimension: `ITEM-${i}`, values }))
}

function metricsResponse(query: URLSearchParams): Response {
  if (failWith !== null) {
    return json(failWith.status, { error: { code: failWith.status, message: failWith.message } })
  }
  const selector = query.get('metricSelector') ?? ''
  // Observado en vivo (ficha 0006): fold y resolution=Inf en la misma consulta dan 400.
  if (query.get('resolution') === 'Inf' && selector.includes(':fold(')) {
    return json(400, { error: { code: 400, message: 'fold no admite resolution Inf' } })
  }
  const marker = isMarkerQuery(query)
  const extras = marker ? markerExtras : seriesExtras
  const expressions = splitSelector(selector)
  const result =
    extras.empty === 'result'
      ? []
      : expressions.map((expression) => ({
          // Como en vivo: la expresión enviada (sin las comillas del id, si lo lleva).
          metricId: expression.split(`"${HOST_ID}"`).join(HOST_ID),
          ...(extras.ratios ?? {}),
          data:
            extras.empty === 'data'
              ? []
              : dataOf(expression, marker).map(({ dimension, values }) => ({
                  dimensionMap: { 'dt.entity.host': HOST_ID, item: dimension },
                  dimensions: [HOST_ID, dimension],
                  timestamps: marker ? [T0 + 240_000] : T,
                  values
                }))
        }))
  return json(200, {
    totalCount: result.length,
    nextPageKey: null,
    resolution: marker ? (query.get('resolution') ?? '1m') : '1m',
    ...(extras.warnings === undefined ? {} : { warnings: extras.warnings }),
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
  // El último punto a null, como en vivo; y un null en medio.
  seriesData = {
    cpu: [10, null, 30.5, null],
    user: [6, null, 20, null],
    system: [3, null, 8, null],
    iowait: [1, null, 2.5, null],
    memory: [40, null, 55, null],
    // Bytes: el último con dato es el tercero (no el primero).
    memUsed: [4_000_000_000, null, 5_000_000_000, null],
    memTotal: [16_000_000_000, null, 17_000_000_000, null],
    // bits/s, suma de las dos interfaces de perItem.
    netIn: [1500, null, 3700, null],
    netOut: [300, null, 450, null],
    // %, el disco más lleno en cada punto.
    disk: [85, null, 92, null]
  }
  perItem = {
    netIn: [
      [1000, null, 3000, null],
      [500, null, 700, null]
    ],
    netOut: [
      [200, null, 400, null],
      [100, null, 50, null]
    ],
    disk: [
      [70, null, 92, null],
      [85, null, 60, null]
    ]
  }
  // Distintos de lo que saldría de las series: los marcadores salen de su consulta.
  markerData = {
    cpuAvg: 20.25,
    cpuMax: 97.5,
    memoryAvg: 47.5,
    netInAvg: 2600,
    netOutAvg: 375,
    diskMax: 93,
    load: 1.75
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
  expect(JSON.stringify(result)).not.toContain('SECRETOHOST')
  return result
}

const metricQueries = (): URL[] => requests.filter((u) => u.pathname === '/api/v2/metrics/query')
const seriesQuery = (): URL | undefined =>
  metricQueries().find((u) => !isMarkerQuery(u.searchParams))
const markerQuery = (): URL | undefined =>
  metricQueries().find((u) => isMarkerQuery(u.searchParams))
const expressionsOf = (url: URL | undefined): string[] =>
  splitSelector(url?.searchParams.get('metricSelector') ?? '')

const base = { entityId: HOST_ID, timeRange: '2h' as const }

describe('CA3 (0016): dos consultas a /metrics/query con las expresiones confirmadas, el id y el rango', () => {
  it.each([
    ['relativo (2h)', '2h' as const, { from: 'now-2h', to: null }],
    [
      'absoluto',
      { from: '2026-10-01T08:00:00.000Z', to: '2026-10-01T10:00:00.000Z' },
      { from: '2026-10-01T08:00:00.000Z', to: '2026-10-01T10:00:00.000Z' }
    ]
  ])('rango %s', async (_case, timeRange, expected) => {
    const result = await call({ environmentId: envId, entityId: HOST_ID, timeRange })
    expect(result.ok, JSON.stringify(result.error)).toBe(true)

    // Exactamente dos peticiones, y las dos a /metrics/query.
    expect(requests).toHaveLength(2)
    expect(metricQueries()).toHaveLength(2)
    const series = seriesQuery()
    const markers = markerQuery()
    expect(series, 'consulta de series').toBeDefined()
    expect(markers, 'consulta de marcadores').toBeDefined()

    // Series: las 10 expresiones (≤ 10, una consulta) y sin resolution (la elige la API).
    // Red sumada por interfaces (splitBy():sum) y disco más lleno (splitBy():max).
    expect(series?.searchParams.has('resolution')).toBe(false)
    expect(expressionsOf(series).map(seriesKindOf).sort()).toEqual([...SERIES_KINDS].sort())

    // Marcadores: rango completo con resolution=Inf y sin fold (juntos dan 400).
    expect(markers?.searchParams.get('resolution')).toBe('Inf')
    expect(markers?.searchParams.get('metricSelector') ?? '').not.toContain(':fold(')
    expect(expressionsOf(markers).map(markerKindOf).sort()).toEqual([...MARKER_KINDS].sort())

    // Todas las expresiones de las dos consultas, acotadas al host pedido; y el rango.
    for (const url of [series, markers]) {
      for (const expression of expressionsOf(url)) {
        expect(scopedToHost(expression, url?.searchParams ?? new URLSearchParams())).toBe(true)
      }
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

describe('CA4 (0016): la respuesta se transforma en series y totales', () => {
  it('series tal cual (% 0–100, bytes y bits/s sin convertir), nulos conservados y resolución de las series', async () => {
    const result = await call({ environmentId: envId, ...base })
    expect(result.ok, JSON.stringify(result.error)).toBe(true)
    expect(result.data).toMatchObject({
      // La de la consulta de series (no la de los marcadores, Inf).
      resolution: '1m',
      series: {
        cpu: { timestamps: T, values: [10, null, 30.5, null] },
        cpuBreakdown: {
          user: { timestamps: T, values: [6, null, 20, null] },
          system: { timestamps: T, values: [3, null, 8, null] },
          iowait: { timestamps: T, values: [1, null, 2.5, null] }
        },
        memory: { timestamps: T, values: [40, null, 55, null] },
        // Sumadas todas las interfaces, en bits/s.
        network: {
          in: { timestamps: T, values: [1500, null, 3700, null] },
          out: { timestamps: T, values: [300, null, 450, null] }
        },
        // El disco más lleno en cada punto, en %.
        disk: { timestamps: T, values: [85, null, 92, null] }
      },
      warnings: [],
      partial: []
    })
  })

  it('totales: marcadores del rango y memoria usada/total del último punto con dato', async () => {
    const result = await call({ environmentId: envId, ...base })
    expect(result.ok, JSON.stringify(result.error)).toBe(true)
    expect((result.data as { totals: unknown }).totals).toEqual({
      cpu: { avg: 20.25, max: 97.5 },
      // used y total en bytes, del tercer punto (el cuarto llega a null).
      memory: { avg: 47.5, used: 5_000_000_000, total: 17_000_000_000 },
      network: { in: 2600, out: 375 },
      disk: { max: 93 },
      load: { avg: 1.75 }
    })
  })

  it('sin dato en ningún punto de usada y total, los dos a null; un marcador sin dato, null', async () => {
    seriesData = {
      ...seriesData,
      memUsed: [null, null, null, null],
      memTotal: [null, null, null, null]
    }
    markerData = { ...markerData, load: null, cpuMax: null }
    const result = await call({ environmentId: envId, ...base })
    expect(result.ok, JSON.stringify(result.error)).toBe(true)
    expect(result.data).toMatchObject({
      totals: {
        cpu: { avg: 20.25, max: null },
        memory: { avg: 47.5, used: null, total: null },
        load: { avg: null }
      }
    })
  })
})

describe('CA5 (0016): errores de Dynatrace y host sin datos', () => {
  it.each([400, 404])('un %i acaba en error con reason', async (status) => {
    failWith = { status, message: 'Mensaje de Dynatrace en la prueba' }
    const result = await call({ environmentId: envId, ...base })
    expect(result.ok).toBe(false)
    expect(result.error?.reason?.key, 'reason del error').toEqual(expect.any(String))
  })

  it.each([
    ['sin resultados (result vacío)', 'result' as const],
    ['resultados sin series (data vacío)', 'data' as const]
  ])('%s: series vacías y totales a null, sin error', async (_case, empty) => {
    seriesExtras = { empty }
    markerExtras = { empty }
    const result = await call({ environmentId: envId, ...base })
    expect(result.ok, JSON.stringify(result.error)).toBe(true)
    const none = { timestamps: [], values: [] }
    expect(result.data).toMatchObject({
      series: {
        cpu: none,
        cpuBreakdown: { user: none, system: none, iowait: none },
        memory: none,
        network: { in: none, out: none },
        disk: none
      }
    })
    expect((result.data as { totals: unknown }).totals).toEqual({
      cpu: { avg: null, max: null },
      memory: { avg: null, used: null, total: null },
      network: { in: null, out: null },
      disk: { max: null },
      load: { avg: null }
    })
  })
})

describe('CA6 (0016): warnings y resultados recortados', () => {
  it('los warnings de las dos consultas llegan en warnings', async () => {
    seriesExtras = { warnings: ['Aviso de las series'] }
    markerExtras = { warnings: ['Aviso de los marcadores'] }
    const result = await call({ environmentId: envId, ...base })
    expect(result.ok, JSON.stringify(result.error)).toBe(true)
    const warnings = (result.data as { warnings: string[] }).warnings
    expect(warnings).toEqual(
      expect.arrayContaining(['Aviso de las series', 'Aviso de los marcadores'])
    )
  })

  it('un ratio > 1 es recortado y llega en partial', async () => {
    seriesExtras = { ratios: { dataPointCountRatio: 1.5, dimensionCountRatio: 0.005 } }
    markerExtras = { ratios: { dataPointCountRatio: 1, dimensionCountRatio: 2 } }
    const result = await call({ environmentId: envId, ...base })
    expect(result.ok, JSON.stringify(result.error)).toBe(true)
    const partial = (result.data as { partial: { dataPoints: unknown; dimensions: unknown }[] })
      .partial
    expect(partial).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ dataPoints: 1.5, dimensions: null }),
        expect.objectContaining({ dataPoints: null, dimensions: 2 })
      ])
    )
    expect(partial.every((item) => item.dataPoints !== 0.005 && item.dimensions !== 0.005)).toBe(
      true
    )
  })

  it.each([
    ['lo normal en vivo (0,005)', 0.005],
    ['justo 1', 1]
  ])('con ratios de %s no hay partial', async (_case, ratio) => {
    seriesExtras = { ratios: { dataPointCountRatio: ratio, dimensionCountRatio: ratio } }
    markerExtras = { ratios: { dataPointCountRatio: ratio, dimensionCountRatio: ratio } }
    const result = await call({ environmentId: envId, ...base })
    expect(result).toMatchObject({ ok: true, data: { partial: [] } })
  })
})
