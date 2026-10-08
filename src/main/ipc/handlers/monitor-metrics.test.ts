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
 * Ficha 0022: canal `entities:monitorMetrics` (browser monitor, SYNTHETIC_TEST, y HTTP
 * monitor, HTTP_CHECK), con el cliente de Dynatrace REAL sobre un fetch falso. Se comprueba
 * qué se pide a /metrics/query y cómo llega la respuesta a la interfaz.
 *
 * Usa SOLO las métricas que eligió el paso 0 (tabla de "Verificación" de la ficha) e imita lo
 * observado en vivo:
 * - con `entitySelector=entityId(...)` (o el id en un filtro), cada expresión vuelve en el
 *   orden pedido con el `metricId` igual a la expresión enviada;
 * - las métricas por localización (`availability.location.total` y las `*.geo` de HTTP)
 *   traen una serie por localización si no se juntan con `splitBy()` o
 *   `splitBy("<dimensión del monitor>")`;
 * - `http.resultStatus` trae una serie por «Result status» (SUCCESS y FAILURE) salvo con
 *   `filter(eq("Result status", …))`; sin fallos, la de FAILURE llega sin series;
 * - `http.duration.geo:median` devuelve lo mismo que `:avg` (median no está entre sus
 *   agregaciones): el HTTP monitor no tiene mediana de duración;
 * - `:fold(...)` junto con `resolution=Inf` da 400 (ficha 0006); con Inf, `:avg` y
 *   `:median` dan el valor del rango y los recuentos, la suma de la serie.
 */

const TRUSTED = { url: 'app://vigia/index.html', isMainFrame: true }
const TOKEN = `dt0c01.PUBLICAPRUEBA0000000000A.${'SECRETOMONI'.padEnd(64, 'X')}`
const BASE = 'https://abc12345.live.dynatrace.com'
const CHANNEL = 'entities:monitorMetrics' as IpcChannel
/** Ids inventados, con el formato de Dynatrace. */
const BROWSER_ID = 'SYNTHETIC_TEST-0123456789ABCDEF'
const HTTP_ID = 'HTTP_CHECK-FEDCBA9876543210'
/** Momento fijo (epoch ms; la zona no importa aquí). */
const T0 = Date.parse('2026-10-03T08:00:00.000Z')
const T = [T0, T0 + 600_000, T0 + 1_200_000, T0 + 1_800_000]

const B = 'builtin:synthetic.browser.'
const H = 'builtin:synthetic.http.'

type Kind = 'browser' | 'http'
/** Papeles de las series (consulta sin resolution). */
type SeriesRole =
  | 'availability'
  | 'duration'
  | 'ok'
  | 'failed'
  | 'lcp'
  | 'visuallyComplete'
  | 'cls'
  | 'speedIndex'
  | 'dns'
  | 'tcp'
  | 'tls'
  | 'ttfb'
/** Papeles de los marcadores (consulta con resolution=Inf). */
type MarkerRole = 'availability' | 'durationAvg' | 'durationMedian' | 'ok' | 'failed'

const SERIES_ROLES: Record<Kind, SeriesRole[]> = {
  browser: [
    'availability',
    'duration',
    'ok',
    'failed',
    'lcp',
    'visuallyComplete',
    'cls',
    'speedIndex'
  ],
  http: ['availability', 'duration', 'ok', 'failed', 'dns', 'tcp', 'tls', 'ttfb']
}
/** HTTP: sin mediana (paso 0). */
const MARKER_ROLES: Record<Kind, MarkerRole[]> = {
  browser: ['availability', 'durationAvg', 'durationMedian', 'ok', 'failed'],
  http: ['availability', 'durationAvg', 'ok', 'failed']
}
const ID: Record<Kind, string> = { browser: BROWSER_ID, http: HTTP_ID }
const MONITOR_DIMENSION: Record<Kind, string> = {
  browser: 'dt.entity.synthetic_test',
  http: 'dt.entity.http_check'
}

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
const has = (expression: string, aggregation: string): boolean =>
  new RegExp(`:${aggregation}\\b`).test(expression)
/** Sin agregación o con la de por defecto (avg). */
const plainOrAvg = (expression: string): boolean =>
  !['max', 'min', 'sum', 'median', 'count', 'percentile'].some((a) => has(expression, a))
/** ¿Junta las localizaciones? `splitBy()` o `splitBy("<dimensión del monitor>")`. */
const merged = (expression: string, kind: Kind): boolean =>
  new RegExp(`:splitBy\\((\\s*|"${MONITOR_DIMENSION[kind].replace(/\./g, '\\.')}")\\)`).test(
    expression
  )
/** ¿Filtra «Result status» por ese valor? */
const resultStatus = (expression: string, value: string): boolean =>
  new RegExp(`filter\\(\\s*eq\\(\\s*"Result status"\\s*,\\s*"${value}"\\s*\\)\\s*\\)`).test(
    expression
  )

/** Qué pide una expresión de la consulta de series (null si no es ninguna de las elegidas). */
function seriesRoleOf(expression: string, kind: Kind): SeriesRole | null {
  const key = keyOf(expression)
  if (kind === 'browser') {
    if (!key.startsWith(B)) return null
    if (key === `${B}availability.location.total`)
      return merged(expression, kind) && plainOrAvg(expression) ? 'availability' : null
    const plain: Record<string, SeriesRole> = {
      [`${B}totalDuration`]: 'duration',
      [`${B}largestContentfulPaint.load`]: 'lcp',
      [`${B}visuallyComplete.load`]: 'visuallyComplete',
      [`${B}cumulativeLayoutShift.load`]: 'cls',
      [`${B}speedIndex.load`]: 'speedIndex'
    }
    if (plain[key] !== undefined) return plainOrAvg(expression) ? plain[key] : null
    // Recuentos con agregación value (la única, además de auto).
    if (key === `${B}success`) return 'ok'
    if (key === `${B}failure`) return 'failed'
    return null
  }
  if (!key.startsWith(H) || !merged(expression, kind)) return null
  if (key === `${H}resultStatus`) {
    if (!has(expression, 'sum')) return null
    if (resultStatus(expression, 'SUCCESS')) return 'ok'
    if (resultStatus(expression, 'FAILURE')) return 'failed'
    return null
  }
  const timed: Record<string, SeriesRole> = {
    [`${H}availability.location.total`]: 'availability',
    [`${H}duration.geo`]: 'duration',
    [`${H}dns.geo`]: 'dns',
    [`${H}tcpConnectTime.geo`]: 'tcp',
    [`${H}tlsHandshakeTime.geo`]: 'tls',
    [`${H}timeToFirstByte.geo`]: 'ttfb'
  }
  return timed[key] !== undefined && plainOrAvg(expression) ? timed[key] : null
}

/** Qué pide una expresión de la consulta de marcadores (resolution=Inf). */
function markerRoleOf(expression: string, kind: Kind): MarkerRole | null {
  const key = keyOf(expression)
  if (kind === 'browser') {
    if (key === `${B}availability.location.total`)
      return merged(expression, kind) && plainOrAvg(expression) ? 'availability' : null
    if (key === `${B}totalDuration`) {
      if (has(expression, 'median')) return 'durationMedian'
      return plainOrAvg(expression) ? 'durationAvg' : null
    }
    if (key === `${B}success`) return 'ok'
    if (key === `${B}failure`) return 'failed'
    return null
  }
  if (!merged(expression, kind)) return null
  if (key === `${H}availability.location.total`)
    return plainOrAvg(expression) ? 'availability' : null
  if (key === `${H}duration.geo`) {
    // Observado en vivo: :median devuelve lo mismo que :avg.
    if (has(expression, 'median')) return 'durationAvg'
    return plainOrAvg(expression) ? 'durationAvg' : null
  }
  if (key === `${H}resultStatus` && has(expression, 'sum')) {
    if (resultStatus(expression, 'SUCCESS')) return 'ok'
    if (resultStatus(expression, 'FAILURE')) return 'failed'
  }
  return null
}

/** ¿La consulta es la de los marcadores (un valor por métrica para todo el rango)? */
const isMarkerQuery = (query: URLSearchParams): boolean =>
  query.get('resolution') === 'Inf' || (query.get('metricSelector') ?? '').includes(':fold(')

/** ¿La expresión (o la consulta) va acotada al monitor pedido? */
function scopedTo(id: string, expression: string, query: URLSearchParams): boolean {
  return (
    expression.includes(`"${id}"`) ||
    (query.get('entitySelector') ?? '').includes(`entityId("${id}")`)
  )
}

/** De qué tipo es la consulta, por el id que lleva. */
function kindOf(query: URLSearchParams): Kind | null {
  const text = `${query.get('metricSelector') ?? ''} ${query.get('entitySelector') ?? ''}`
  if (text.includes(BROWSER_ID)) return 'browser'
  if (text.includes(HTTP_ID)) return 'http'
  return null
}

type Values = (number | null)[]
let seriesData: Record<Kind, Partial<Record<SeriesRole, Values>>>
let markerData: Record<Kind, Partial<Record<MarkerRole, number | null>>>
/** Papeles que llegan sin series (como la de FAILURE de un monitor sin fallos). */
let noSeries: Partial<Record<SeriesRole | MarkerRole, true>>
interface Extras {
  empty?: 'result' | 'data'
}
let seriesExtras: Extras
let markerExtras: Extras
let failWith: { status: number; message: string } | null

/** Una serie por localización (dos) o por «Result status», si no se juntan. */
function unmerged(expression: string, kind: Kind): { dimension: string; values: Values }[] {
  const key = keyOf(expression)
  const perLocation =
    key === `${B}availability.location.total` || (kind === 'http' && key.startsWith(H))
  if (!perLocation) return []
  return [
    { dimension: 'SYNTHETIC_LOCATION-0000000000000001', values: [1, 2, 3, 4] },
    { dimension: 'SYNTHETIC_LOCATION-0000000000000002', values: [5, 6, 7, 8] }
  ]
}

function dataOf(
  expression: string,
  kind: Kind,
  marker: boolean
): { dimension: string; values: Values }[] {
  if (marker) {
    const role = markerRoleOf(expression, kind)
    if (role === null) return unmerged(expression, kind).map((s) => ({ ...s, values: [9] }))
    if (noSeries[role]) return []
    return [{ dimension: ID[kind], values: [markerData[kind][role] ?? null] }]
  }
  const role = seriesRoleOf(expression, kind)
  if (role === null) return unmerged(expression, kind)
  if (noSeries[role]) return []
  const values = seriesData[kind][role]
  return values === undefined ? [] : [{ dimension: ID[kind], values }]
}

function metricsResponse(query: URLSearchParams): Response {
  if (failWith !== null) {
    return json(failWith.status, { error: { code: failWith.status, message: failWith.message } })
  }
  const selector = query.get('metricSelector') ?? ''
  if (query.get('resolution') === 'Inf' && selector.includes(':fold(')) {
    return json(400, { error: { code: 400, message: 'fold no admite resolution Inf' } })
  }
  const kind = kindOf(query)
  const marker = isMarkerQuery(query)
  const extras = marker ? markerExtras : seriesExtras
  const expressions = splitSelector(selector)
  const id = kind === null ? '' : ID[kind]
  const result =
    extras.empty === 'result' || kind === null
      ? []
      : expressions.map((expression) => ({
          // Como en vivo: la expresión enviada (sin las comillas del id, si lo lleva).
          metricId: expression.split(`"${id}"`).join(id),
          dataPointCountRatio: 0.005,
          dimensionCountRatio: 0.005,
          data:
            extras.empty === 'data'
              ? []
              : dataOf(expression, kind, marker).map(({ dimension, values }) => ({
                  dimensionMap: { [MONITOR_DIMENSION[kind]]: id, location: dimension },
                  dimensions: [id, dimension],
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
  noSeries = {}
  // Con null en medio y al final, como en vivo.
  seriesData = {
    browser: {
      availability: [100, null, 66.6, 100],
      duration: [5200, null, 6100.5, null],
      ok: [2, null, 1, 3],
      failed: [0, null, 1, 0],
      lcp: [1800, null, 2100, null],
      visuallyComplete: [2400, null, 2600, null],
      cls: [0.02, null, 0.1, null],
      speedIndex: [1500, null, 1700, null]
    },
    http: {
      availability: [100, 50, null, 100],
      duration: [320, 410.5, null, null],
      ok: [6, 3, null, 6],
      failed: [0, 3, null, 0],
      dns: [0.5, 12, null, null],
      tcp: [8, 9, null, null],
      tls: [0.4, 20, null, null],
      ttfb: [150, 220, null, null]
    }
  }
  // Disponibilidad y duraciones, distintas de lo que saldría de las series: los marcadores
  // salen de su consulta. Los recuentos, iguales a la suma de la serie (lo observado en vivo).
  markerData = {
    browser: { availability: 91.25, durationAvg: 5600, durationMedian: 5400, ok: 6, failed: 1 },
    http: { availability: 83.5, durationAvg: 365, ok: 15, failed: 3 }
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
  expect(JSON.stringify(result)).not.toContain('SECRETOMONI')
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

describe('CA3 (0022): cada tipo pide las métricas de su catálogo, con el id y el rango', () => {
  describe.each(['browser', 'http'] as const)('%s', (kind) => {
    it.each([
      ['relativo (2h)', '2h' as const, { from: 'now-2h', to: null }],
      [
        'absoluto',
        { from: '2026-10-01T08:00:00.000Z', to: '2026-10-01T10:00:00.000Z' },
        { from: '2026-10-01T08:00:00.000Z', to: '2026-10-01T10:00:00.000Z' }
      ]
    ])('rango %s', async (_case, timeRange, expected) => {
      const result = await call({ environmentId: envId, entityId: ID[kind], timeRange })
      expect(result.ok, JSON.stringify(result.error)).toBe(true)

      // Exactamente dos peticiones, y las dos a /metrics/query: series y marcadores.
      expect(requests).toHaveLength(2)
      expect(metricQueries()).toHaveLength(2)
      const seriesUrl = seriesQuery()
      const markersUrl = markerQuery()
      expect(seriesUrl, 'consulta de series').toBeDefined()
      expect(markersUrl, 'consulta de marcadores').toBeDefined()

      // Series: las del catálogo de su tipo (≤ 10, una consulta), sin resolution (la elige la API).
      expect(seriesUrl?.searchParams.has('resolution')).toBe(false)
      expect(expressionsOf(seriesUrl).length).toBeLessThanOrEqual(10)
      expect(
        expressionsOf(seriesUrl)
          .map((e) => seriesRoleOf(e, kind))
          .sort()
      ).toEqual([...SERIES_ROLES[kind]].sort())

      // Marcadores: rango completo con resolution=Inf y sin fold (juntos dan 400).
      expect(markersUrl?.searchParams.get('resolution')).toBe('Inf')
      expect(markersUrl?.searchParams.get('metricSelector') ?? '').not.toContain(':fold(')
      expect(
        expressionsOf(markersUrl)
          .map((e) => markerRoleOf(e, kind))
          .sort()
      ).toEqual([...MARKER_ROLES[kind]].sort())

      // Solo el catálogo de su tipo; todas acotadas al monitor pedido; y el rango.
      const other = kind === 'browser' ? H : B
      for (const url of [seriesUrl, markersUrl]) {
        expect(url?.searchParams.get('metricSelector') ?? '').not.toContain(other)
        for (const expression of expressionsOf(url)) {
          expect(scopedTo(ID[kind], expression, url?.searchParams ?? new URLSearchParams())).toBe(
            true
          )
        }
        expect(url?.searchParams.get('from')).toBe(expected.from)
        expect(url?.searchParams.get('to')).toBe(expected.to)
      }
    })
  })

  it('la interfaz no manda selectores: un metricSelector en la entrada no llega a Dynatrace', async () => {
    const result = await call({
      environmentId: envId,
      entityId: BROWSER_ID,
      timeRange: '2h',
      metricSelector: 'builtin:tenant.otra'
    })
    // O lo rechaza el esquema o se ignora; nunca se envía.
    for (const url of metricQueries()) {
      expect(url.searchParams.get('metricSelector') ?? '').not.toContain('builtin:tenant.otra')
    }
    if (result.ok) expect(metricQueries()).toHaveLength(2)
  })
})

describe('CA4 (0022): la respuesta se transforma por papel', () => {
  it('browser: series por papel con los null conservados, rendimiento y httpTimings a null', async () => {
    const result = await call({ environmentId: envId, entityId: BROWSER_ID, timeRange: '2h' })
    expect(result.ok, JSON.stringify(result.error)).toBe(true)
    expect(result.data).toMatchObject({
      kind: 'browser',
      // La de la consulta de series (no la de los marcadores, Inf).
      resolution: '10m',
      series: {
        // % (0–100) y ms, tal cual.
        availability: series([100, null, 66.6, 100]),
        duration: series([5200, null, 6100.5, null]),
        executions: { ok: series([2, null, 1, 3]), failed: series([0, null, 1, 0]) },
        performance: {
          largestContentfulPaint: series([1800, null, 2100, null]),
          visuallyComplete: series([2400, null, 2600, null]),
          // Sin unidad (0–1).
          cumulativeLayoutShift: series([0.02, null, 0.1, null]),
          speedIndex: series([1500, null, 1700, null])
        },
        // Papel sin métrica en el browser monitor.
        httpTimings: null
      },
      warnings: [],
      partial: []
    })
    expect((result.data as { totals: unknown }).totals).toEqual({
      availability: 91.25,
      duration: { avg: 5600, median: 5400 },
      executions: { ok: 6, failed: 1 }
    })
  })

  it('http: series por papel con los null conservados, tiempos HTTP y performance a null', async () => {
    const result = await call({ environmentId: envId, entityId: HTTP_ID, timeRange: '2h' })
    expect(result.ok, JSON.stringify(result.error)).toBe(true)
    expect(result.data).toMatchObject({
      kind: 'http',
      resolution: '10m',
      series: {
        // Todas las localizaciones juntas, en % y ms.
        availability: series([100, 50, null, 100]),
        duration: series([320, 410.5, null, null]),
        executions: { ok: series([6, 3, null, 6]), failed: series([0, 3, null, 0]) },
        httpTimings: {
          dns: series([0.5, 12, null, null]),
          tcpConnect: series([8, 9, null, null]),
          tlsHandshake: series([0.4, 20, null, null]),
          timeToFirstByte: series([150, 220, null, null])
        },
        // Papel sin métrica en el HTTP monitor.
        performance: null
      },
      warnings: [],
      partial: []
    })
    // Sin mediana de duración en HTTP (paso 0): null.
    expect((result.data as { totals: unknown }).totals).toEqual({
      availability: 83.5,
      duration: { avg: 365, median: null },
      executions: { ok: 15, failed: 3 }
    })
  })

  it('http sin fallos: la de FAILURE llega sin series → fallidas vacías y 0 en el total', async () => {
    noSeries = { failed: true }
    const result = await call({ environmentId: envId, entityId: HTTP_ID, timeRange: '2h' })
    expect(result.ok, JSON.stringify(result.error)).toBe(true)
    expect(result.data).toMatchObject({
      series: { executions: { ok: series([6, 3, null, 6]), failed: none } },
      totals: { executions: { ok: 15, failed: 0 } }
    })
  })

  it('un marcador sin dato llega a null', async () => {
    markerData = {
      ...markerData,
      browser: { ...markerData.browser, availability: null, durationMedian: null }
    }
    const result = await call({ environmentId: envId, entityId: BROWSER_ID, timeRange: '2h' })
    expect(result.ok, JSON.stringify(result.error)).toBe(true)
    expect(result.data).toMatchObject({
      totals: { availability: null, duration: { avg: 5600, median: null } }
    })
  })
})

describe('CA5 (0022): errores de Dynatrace y monitor sin datos', () => {
  describe.each(['browser', 'http'] as const)('%s', (kind) => {
    it.each([400, 404])('un %i acaba en error con reason', async (status) => {
      failWith = { status, message: 'Mensaje de Dynatrace en la prueba' }
      const result = await call({ environmentId: envId, entityId: ID[kind], timeRange: '2h' })
      expect(result.ok).toBe(false)
      expect(result.error?.reason?.key, 'reason del error').toEqual(expect.any(String))
    })

    it.each([
      ['sin resultados (result vacío)', 'result' as const],
      ['resultados sin series (data vacío)', 'data' as const]
    ])('%s: series vacías, sin error', async (_case, empty) => {
      seriesExtras = { empty }
      markerExtras = { empty }
      const result = await call({ environmentId: envId, entityId: ID[kind], timeRange: '2h' })
      expect(result.ok, JSON.stringify(result.error)).toBe(true)
      expect(result.data).toMatchObject({
        kind,
        series: {
          availability: none,
          duration: none,
          executions: { ok: none, failed: none },
          ...(kind === 'browser'
            ? {
                performance: {
                  largestContentfulPaint: none,
                  visuallyComplete: none,
                  cumulativeLayoutShift: none,
                  speedIndex: none
                },
                httpTimings: null
              }
            : {
                httpTimings: {
                  dns: none,
                  tcpConnect: none,
                  tlsHandshake: none,
                  timeToFirstByte: none
                },
                performance: null
              })
        }
      })
      // Sin dato: disponibilidad y duraciones a null; los recuentos, 0.
      expect((result.data as { totals: unknown }).totals).toEqual({
        availability: null,
        duration: { avg: null, median: null },
        executions: { ok: 0, failed: 0 }
      })
    })
  })
})
