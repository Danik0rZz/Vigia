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
 * Ficha 0006: canal `entities:serviceMetrics` (métricas de una entidad SERVICE),
 * con el cliente de Dynatrace REAL sobre un fetch falso. Se comprueba qué se pide
 * a /metrics/query y cómo llega la respuesta a la interfaz.
 *
 * El fetch falso imita lo observado en vivo (paso 0 de la ficha):
 * - los resultados vuelven en el orden de las expresiones pedidas y su `metricId`
 *   es la expresión enviada sin las comillas del valor del filtro;
 * - `:fold(...)` junto con `resolution=Inf` da 400;
 * - los tiempos (`builtin:service.response.server`) llegan en microsegundos y la
 *   tasa (`builtin:service.errors.server.rate`) en porcentaje (0–100).
 */

const TRUSTED = { url: 'app://vigia/index.html', isMainFrame: true }
const TOKEN = `dt0c01.PUBLICAPRUEBA0000000000A.${'SECRETOSERVICIO'.padEnd(64, 'X')}`
const BASE = 'https://abc12345.live.dynatrace.com'
const CHANNEL = 'entities:serviceMetrics' as IpcChannel
/** Id inventado, con el formato de Dynatrace. */
const SERVICE_ID = 'SERVICE-0123456789ABCDEF'
/** Momento fijo (Europe/Madrid no importa aquí: son epoch ms). */
const T0 = Date.parse('2026-10-03T08:00:00.000Z')
const T = [T0, T0 + 60_000, T0 + 120_000]

const RESPONSE = 'builtin:service.response.server'
const REQUESTS = 'builtin:service.requestCount.server'
const ERRORS = 'builtin:service.errors.server.count'
const RATE = 'builtin:service.errors.server.rate'

type Kind = 'median' | 'p90' | 'p99' | 'requests' | 'errors' | 'rate'

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

/** Qué pide una expresión (null si no es ninguna de las del servicio). */
function kindOf(expression: string): Kind | null {
  if (expression.startsWith(REQUESTS)) return 'requests'
  if (expression.startsWith(ERRORS)) return 'errors'
  if (expression.startsWith(RATE)) return 'rate'
  if (!expression.startsWith(RESPONSE)) return null
  if (/:median\b/.test(expression)) return 'median'
  if (/:percentile\(90(\.0+)?\)/.test(expression)) return 'p90'
  if (/:percentile\(99(\.0+)?\)/.test(expression)) return 'p99'
  return null
}

/** ¿La consulta es la de los marcadores (un valor por métrica para todo el rango)? */
const isMarkerQuery = (query: URLSearchParams): boolean =>
  query.get('resolution') === 'Inf' || (query.get('metricSelector') ?? '').includes(':fold(')

/** ¿La expresión (o la consulta) va acotada al servicio pedido? */
function scopedToService(expression: string, query: URLSearchParams): boolean {
  return (
    expression.includes(SERVICE_ID) ||
    (query.get('entitySelector') ?? '').includes(`entityId("${SERVICE_ID}")`)
  )
}

/** Series de la consulta de series: tiempos en µs, con nulos, y un punto con errores > peticiones. */
let seriesData: Record<Kind, (number | null)[]>
/** Valor único de cada métrica en la consulta de marcadores. */
let markerData: Record<Kind, number | null>
/** Extras de cada respuesta (warnings, ratios, resultados vacíos). */
let seriesExtras: {
  warnings?: string[]
  ratios?: Record<string, number>
  empty?: 'result' | 'data'
}
let markerExtras: {
  warnings?: string[]
  ratios?: Record<string, number>
  empty?: 'result' | 'data'
}
let failWith: { status: number; message: string } | null

function metricsResponse(query: URLSearchParams): Response {
  if (failWith !== null) {
    return json(failWith.status, { error: { code: failWith.status, message: failWith.message } })
  }
  const selector = query.get('metricSelector') ?? ''
  // Observado en vivo: fold y resolution=Inf en la misma consulta dan 400.
  if (query.get('resolution') === 'Inf' && selector.includes(':fold(')) {
    return json(400, { error: { code: 400, message: 'fold no admite resolution Inf' } })
  }
  const marker = isMarkerQuery(query)
  const extras = marker ? markerExtras : seriesExtras
  const expressions = splitSelector(selector)
  const result =
    extras.empty === 'result'
      ? []
      : expressions.map((expression) => {
          const kind = kindOf(expression)
          const values = kind === null ? [] : marker ? [markerData[kind]] : seriesData[kind]
          return {
            // Como en vivo: la expresión enviada sin las comillas del id.
            metricId: expression.split(`"${SERVICE_ID}"`).join(SERVICE_ID),
            ...(extras.ratios ?? {}),
            data:
              extras.empty === 'data' || kind === null
                ? []
                : [
                    {
                      dimensionMap: { 'dt.entity.service': SERVICE_ID },
                      dimensions: [SERVICE_ID],
                      timestamps: marker ? [T0 + 180_000] : T,
                      values
                    }
                  ]
          }
        })
  return json(200, {
    totalCount: result.length,
    nextPageKey: null,
    resolution: marker ? (query.get('resolution') ?? '1m') : '5m',
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
  // Ficha 0046: main pide antes la entidad para elegir las métricas; un WEB_SERVICE usa las
  // de Servidor (las de esta ficha).
  if (decodeURIComponent(url.pathname) === `/api/v2/entities/${SERVICE_ID}`) {
    return json(200, {
      entityId: SERVICE_ID,
      displayName: 'servicio-prueba',
      type: 'SERVICE',
      properties: { serviceType: 'WEB_SERVICE' }
    })
  }
  if (url.pathname === '/api/v2/metrics/query') return metricsResponse(url.searchParams)
  return json(404, { error: { code: 404, message: 'No existe' } })
})

beforeEach(() => {
  requests = []
  failWith = null
  seriesExtras = {}
  markerExtras = {}
  seriesData = {
    median: [200_000, null, 300_000],
    p90: [400_000, 500_000, 600_000],
    p99: [900_000, 1_000_000, 1_100_000],
    requests: [10, null, 5],
    // El último punto: más errores que peticiones (OK nunca negativo).
    errors: [2, 0, 7],
    rate: [20, null, 100]
  }
  markerData = {
    median: 250_000,
    p90: 450_000,
    p99: 950_000,
    // Si main pidiera aquí los recuentos, los totales no saldrían de sumar la serie.
    requests: 100,
    errors: 25,
    rate: 99
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
  expect(JSON.stringify(result)).not.toContain('SECRETOSERVICIO')
  return result
}

const metricQueries = (): URL[] => requests.filter((u) => u.pathname === '/api/v2/metrics/query')
const seriesQuery = (): URL | undefined =>
  metricQueries().find((u) => !isMarkerQuery(u.searchParams))
const markerQuery = (): URL | undefined =>
  metricQueries().find((u) => isMarkerQuery(u.searchParams))
const kindsOf = (url: URL | undefined): (Kind | null)[] =>
  splitSelector(url?.searchParams.get('metricSelector') ?? '').map(kindOf)

describe('CA3 (0006): dos consultas a /metrics/query con el id y el rango pedidos', () => {
  it.each([
    ['relativo (2h)', '2h' as const, { from: 'now-2h', to: null }],
    [
      'absoluto',
      { from: '2026-10-01T08:00:00.000Z', to: '2026-10-01T10:00:00.000Z' },
      { from: '2026-10-01T08:00:00.000Z', to: '2026-10-01T10:00:00.000Z' }
    ]
  ])('rango %s', async (_case, timeRange, expected) => {
    const result = await call({ environmentId: envId, entityId: SERVICE_ID, timeRange })
    expect(result.ok, JSON.stringify(result.error)).toBe(true)

    // Exactamente dos peticiones a /metrics/query (más la de la entidad, ficha 0046).
    expect(requests).toHaveLength(3)
    expect(metricQueries()).toHaveLength(2)
    const series = seriesQuery()
    const markers = markerQuery()
    expect(series, 'consulta de series').toBeDefined()
    expect(markers, 'consulta de marcadores').toBeDefined()

    // Series: las 6 expresiones en una consulta y sin resolution (la elige la API).
    expect(series?.searchParams.has('resolution')).toBe(false)
    expect(kindsOf(series).sort()).toEqual(
      (['errors', 'median', 'p90', 'p99', 'rate', 'requests'] as Kind[]).sort()
    )

    // Marcadores: solo los tres tiempos del rango completo, con resolution=Inf y sin fold
    // (fold con Inf da 400). Los totales de peticiones y errores salen de la serie.
    expect(markers?.searchParams.get('resolution')).toBe('Inf')
    expect(markers?.searchParams.get('metricSelector') ?? '').not.toContain(':fold(')
    expect(kindsOf(markers).sort()).toEqual((['median', 'p90', 'p99'] as Kind[]).sort())

    // Todas las expresiones de las dos consultas, acotadas al servicio pedido; y el rango.
    for (const url of [series, markers]) {
      for (const expression of splitSelector(url?.searchParams.get('metricSelector') ?? '')) {
        expect(scopedToService(expression, url?.searchParams ?? new URLSearchParams())).toBe(true)
      }
      expect(url?.searchParams.get('from')).toBe(expected.from)
      expect(url?.searchParams.get('to')).toBe(expected.to)
    }
  })
})

describe('CA4 (0006): la respuesta se transforma en series y totales', () => {
  it('series en ms y %, nulos conservados, OK = total − errores y resolución devuelta', async () => {
    const result = await call({ environmentId: envId, entityId: SERVICE_ID, timeRange: '2h' })
    expect(result.ok, JSON.stringify(result.error)).toBe(true)
    expect(result.data).toMatchObject({
      // La de la consulta de series (no la de los marcadores).
      resolution: '5m',
      series: {
        responseTime: {
          median: { timestamps: T, values: [200, null, 300] },
          p90: { timestamps: T, values: [400, 500, 600] },
          p99: { timestamps: T, values: [900, 1000, 1100] }
        },
        requests: { timestamps: T, values: [10, null, 5] },
        errors: { timestamps: T, values: [2, 0, 7] },
        // Punto a punto: 10 − 2; sin peticiones, null; 5 − 7 nunca negativo.
        ok: { timestamps: T, values: [8, null, 0] },
        errorRate: { timestamps: T, values: [20, null, 100] }
      },
      totals: {
        // Suma de la serie de la consulta 1 (10 + 5; 2 + 0 + 7), no los de los marcadores.
        requests: 15,
        errors: 9,
        ok: 6,
        // errors / requests, en porcentaje.
        errorRate: 60,
        responseTime: { median: 250, p90: 450, p99: 950 }
      },
      warnings: [],
      partial: []
    })
  })

  it('total con más errores que peticiones: OK a 0, nunca negativo', async () => {
    seriesData = { ...seriesData, requests: [1, null, 2], errors: [2, 0, 3] }
    const result = await call({ environmentId: envId, entityId: SERVICE_ID, timeRange: '2h' })
    expect(result).toMatchObject({ ok: true, data: { totals: { requests: 3, errors: 5, ok: 0 } } })
  })

  it('sin peticiones en el rango, la tasa total es null', async () => {
    seriesData = { ...seriesData, requests: [0, null, 0], errors: [0, 0, 0] }
    const result = await call({ environmentId: envId, entityId: SERVICE_ID, timeRange: '2h' })
    expect(result).toMatchObject({
      ok: true,
      data: { totals: { requests: 0, errors: 0, ok: 0, errorRate: null } }
    })
  })
})

describe('CA5 (0006): errores de Dynatrace y servicio sin datos', () => {
  it.each([400, 404])('un %i acaba en error con reason', async (status) => {
    failWith = { status, message: 'Mensaje de Dynatrace en la prueba' }
    const result = await call({ environmentId: envId, entityId: SERVICE_ID, timeRange: '2h' })
    expect(result.ok).toBe(false)
    expect(result.error?.reason?.key, 'reason del error').toEqual(expect.any(String))
  })

  it.each([
    ['sin resultados (result vacío)', 'result' as const],
    ['resultados sin series (data vacío)', 'data' as const]
  ])('%s: series vacías y totales a 0 o null', async (_case, empty) => {
    seriesExtras = { empty }
    markerExtras = { empty }
    const result = await call({ environmentId: envId, entityId: SERVICE_ID, timeRange: '2h' })
    expect(result.ok, JSON.stringify(result.error)).toBe(true)
    const none = { timestamps: [], values: [] }
    expect(result.data).toMatchObject({
      series: {
        responseTime: { median: none, p90: none, p99: none },
        requests: none,
        errors: none,
        ok: none,
        errorRate: none
      },
      totals: {
        requests: 0,
        errors: 0,
        ok: 0,
        errorRate: null,
        responseTime: { median: null, p90: null, p99: null }
      }
    })
  })
})

describe('CA6 (0006): warnings y resultados recortados', () => {
  it('los warnings de las dos consultas llegan en warnings', async () => {
    seriesExtras = { warnings: ['Aviso de las series'] }
    markerExtras = { warnings: ['Aviso de los marcadores'] }
    const result = await call({ environmentId: envId, entityId: SERVICE_ID, timeRange: '2h' })
    expect(result.ok, JSON.stringify(result.error)).toBe(true)
    const warnings = (result.data as { warnings: string[] }).warnings
    expect(warnings).toEqual(
      expect.arrayContaining(['Aviso de las series', 'Aviso de los marcadores'])
    )
  })

  it('un ratio > 1 es recortado y llega en partial', async () => {
    seriesExtras = { ratios: { dataPointCountRatio: 1.5, dimensionCountRatio: 0.005 } }
    markerExtras = { ratios: { dataPointCountRatio: 1, dimensionCountRatio: 2 } }
    const result = await call({ environmentId: envId, entityId: SERVICE_ID, timeRange: '2h' })
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
    const result = await call({ environmentId: envId, entityId: SERVICE_ID, timeRange: '2h' })
    expect(result).toMatchObject({ ok: true, data: { partial: [] } })
  })
})
