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
 * Ficha 0046: `entities:serviceMetrics` elige las métricas según el `serviceType` de la
 * entidad. Cliente de Dynatrace REAL sobre un fetch falso.
 *
 * El fetch falso imita lo observado en vivo (paso 0 de la 0046, `docs/notas-api-v2.md`):
 * - `GET /entities/{id}` con `fields=+properties.serviceType,…` trae `properties` solo con las
 *   claves que tiene el servicio (sin webServerName, la clave no llega);
 * - cada servicio solo tiene datos en las métricas de su conjunto: las de los otros
 *   conjuntos responden 200 con `data: []`;
 * - tiempos de Servidor y Cliente en microsegundos; los de las unificadas
 *   (`response_time_service_aggregation`), en milisegundos;
 * - `response_time_service_aggregation` y `count_service_aggregation` tienen la dimensión
 *   `failed`: sin `splitBy("dt.entity.service")` llegan dos series (failed true y false);
 * - no hay métrica de tasa en las unificadas: `failure_count_service_aggregation` es igual a
 *   `count_service_aggregation` con failed=true;
 * - en Solo actividad, `builtin:service.response.server:count` es el recuento de peticiones
 *   (requestCount.server y los errores no tienen datos).
 */

const TRUSTED = { url: 'app://vigia/index.html', isMainFrame: true }
const TOKEN = `dt0c01.PUBLICAPRUEBA0000000000A.${'SECRETOTIPOS'.padEnd(64, 'X')}`
const BASE = 'https://abc12345.live.dynatrace.com'
const CHANNEL = 'entities:serviceMetrics' as IpcChannel
/** Id inventado, con el formato de Dynatrace. */
const SERVICE_ID = 'SERVICE-00000000000A0046'
/** Momento fijo (epoch ms). */
const T0 = Date.parse('2026-10-03T08:00:00.000Z')
const T = [T0, T0 + 60_000, T0 + 120_000]

type MetricSet = 'server' | 'client' | 'unified' | 'activity'
type Kind = 'median' | 'p90' | 'p99' | 'requests' | 'errors' | 'rate' | 'count'

const SERVER = {
  time: 'builtin:service.response.server',
  errors: 'builtin:service.errors.server.count',
  rate: 'builtin:service.errors.server.rate',
  requests: 'builtin:service.requestCount.server'
}
const CLIENT = {
  time: 'builtin:service.response.client',
  errors: 'builtin:service.errors.client.count',
  rate: 'builtin:service.errors.client.rate',
  requests: 'builtin:service.requestCount.client'
}
const UNIFIED = {
  time: 'builtin:service.request.response_time_service_aggregation',
  errors: 'builtin:service.request.failure_count_service_aggregation',
  requests: 'builtin:service.request.count_service_aggregation'
}

/** Claves de métrica de cada conjunto (tabla de la ficha). */
const SET_KEYS: Record<MetricSet, string[]> = {
  server: [SERVER.time, SERVER.errors, SERVER.rate, SERVER.requests],
  client: [CLIENT.time, CLIENT.errors, CLIENT.rate, CLIENT.requests],
  unified: [UNIFIED.time, UNIFIED.errors, UNIFIED.requests],
  activity: [SERVER.time]
}

/** Un serviceType (y propiedades) de cada conjunto. */
const ENTITY_OF: Record<MetricSet, { serviceType: string; properties: Record<string, string> }> = {
  server: { serviceType: 'WEB_REQUEST_SERVICE', properties: { webServerName: 'servidor-web' } },
  client: { serviceType: 'RPC_SERVICE', properties: { remoteEndpoint: 'extremo-remoto' } },
  unified: { serviceType: 'UNIFIED', properties: {} },
  activity: { serviceType: 'QUEUE_LISTENER_SERVICE', properties: {} }
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

/** Clave de métrica de una expresión (lo que va antes del primer «:» tras «builtin:»). */
const keyOf = (expression: string): string => {
  const rest = expression.replace(/^builtin:/, '')
  return `builtin:${rest.split(':')[0] ?? ''}`
}

/** Conjunto y papel de una expresión (null si no es de ningún conjunto). */
function classify(
  expression: string
): { family: 'server' | 'client' | 'unified'; kind: Kind } | null {
  const key = keyOf(expression)
  const timeKind = (): Kind | null =>
    /:median\b/.test(expression)
      ? 'median'
      : /:percentile\(90(\.0+)?\)/.test(expression)
        ? 'p90'
        : /:percentile\(99(\.0+)?\)/.test(expression)
          ? 'p99'
          : /:count\b/.test(expression)
            ? 'count'
            : null
  for (const [family, keys] of [
    ['server', SERVER],
    ['client', CLIENT]
  ] as const) {
    if (key === keys.time) {
      const kind = timeKind()
      return kind === null ? null : { family, kind }
    }
    if (key === keys.errors) return { family, kind: 'errors' }
    if (key === keys.rate) return { family, kind: 'rate' }
    if (key === keys.requests) return { family, kind: 'requests' }
  }
  if (key === UNIFIED.time) {
    const kind = timeKind()
    return kind === null || kind === 'count' ? null : { family: 'unified', kind }
  }
  if (key === UNIFIED.errors) return { family: 'unified', kind: 'errors' }
  if (key === UNIFIED.requests) return { family: 'unified', kind: 'requests' }
  return null
}

const isMarkerQuery = (query: URLSearchParams): boolean => query.get('resolution') === 'Inf'

/** ¿La expresión (o la consulta) va acotada al servicio pedido? */
const scopedToService = (expression: string, query: URLSearchParams): boolean =>
  expression.includes(SERVICE_ID) ||
  (query.get('entitySelector') ?? '').includes(`entityId("${SERVICE_ID}")`)

/** Datos del servicio en las métricas de su conjunto (las demás, sin series). */
let family: 'server' | 'client' | 'unified'
let seriesData: Record<Kind, (number | null)[]>
let markerData: Record<Kind, number | null>
/** Respuesta de GET /entities/{id}. */
let entityReply: { status: number; body: unknown }

function metricsResponse(query: URLSearchParams): Response {
  const selector = query.get('metricSelector') ?? ''
  if (query.get('resolution') === 'Inf' && selector.includes(':fold(')) {
    return json(400, { error: { code: 400, message: 'fold no admite resolution Inf' } })
  }
  const marker = isMarkerQuery(query)
  const expressions = splitSelector(selector)
  const result = expressions.map((expression) => {
    const found = classify(expression)
    const has = found !== null && found.family === family && scopedToService(expression, query)
    const values = found === null ? [] : marker ? [markerData[found.kind]] : seriesData[found.kind]
    const point = (failed: string | null, part: number): Record<string, unknown> => ({
      dimensionMap: {
        'dt.entity.service': SERVICE_ID,
        ...(failed === null ? {} : { failed })
      },
      dimensions: failed === null ? [SERVICE_ID] : [SERVICE_ID, failed],
      timestamps: marker ? [T0 + 180_000] : T,
      values: values.map((v) => (v === null ? null : v * part))
    })
    // Como en vivo: con la dimensión failed y sin splitBy del servicio, dos series.
    const splitByFailed =
      found?.family === 'unified' &&
      keyOf(expression) !== UNIFIED.errors &&
      !expression.includes('splitBy("dt.entity.service")')
    return {
      metricId: expression.split(`"${SERVICE_ID}"`).join(SERVICE_ID),
      dataPointCountRatio: 0.001,
      dimensionCountRatio: 0.001,
      data: !has ? [] : splitByFailed ? [point('false', 0.7), point('true', 0.3)] : [point(null, 1)]
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

const ENTITY_PATH = `/api/v2/entities/${SERVICE_ID}`

const fakeFetch = vi.fn(async (input: unknown) => {
  const url = new URL(String(input instanceof Request ? input.url : input))
  requests.push(url)
  if (decodeURIComponent(url.pathname) === ENTITY_PATH) {
    return json(entityReply.status, entityReply.body)
  }
  if (url.pathname === '/api/v2/metrics/query') return metricsResponse(url.searchParams)
  return json(404, { error: { code: 404, message: 'No existe' } })
})

/** Entidad SERVICE con la forma de `Entity` de la OpenAPI v2 (solo las claves que tiene). */
function entityBody(
  serviceType: string | null,
  properties: Record<string, string> = {}
): Record<string, unknown> {
  return {
    entityId: SERVICE_ID,
    displayName: 'servicio-prueba',
    type: 'SERVICE',
    properties: { ...(serviceType === null ? {} : { serviceType }), ...properties }
  }
}

/** Prepara el fetch falso para un servicio del conjunto dado. */
function useSet(set: MetricSet): void {
  const { serviceType, properties } = ENTITY_OF[set]
  entityReply = { status: 200, body: entityBody(serviceType, properties) }
  family = set === 'activity' ? 'server' : set
  if (set === 'activity') {
    // Solo actividad: response.server:count tiene datos; tiempos, errores y peticiones de
    // requestCount.server, no (si main los pidiera, no llegarían).
    seriesData = {
      ...seriesData,
      count: [4, null, 6],
      requests: [],
      errors: [],
      rate: [],
      median: [],
      p90: [],
      p99: []
    }
    markerData = { ...markerData, requests: null, errors: null, rate: null }
  }
}

beforeEach(() => {
  requests = []
  family = 'server'
  entityReply = { status: 200, body: entityBody('WEB_SERVICE') }
  seriesData = {
    median: [200_000, null, 300_000],
    p90: [400_000, 500_000, 600_000],
    p99: [900_000, 1_000_000, 1_100_000],
    requests: [10, null, 5],
    errors: [2, 0, 5],
    rate: [20, null, 100],
    count: [3, 3, 3]
  }
  markerData = {
    median: 250_000,
    p90: 450_000,
    p99: 950_000,
    requests: 100,
    errors: 25,
    rate: 99,
    count: 77
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
  data?: Record<string, unknown>
  error?: { code: string; message: string; reason?: { key: string } }
}

async function call(): Promise<Envelope> {
  const implementation = (handlers as Record<string, unknown>)[CHANNEL] as IpcImplementation<
    typeof CHANNEL
  >
  expect(implementation, `implementación de ${CHANNEL}`).toBeTypeOf('function')
  const result = (await createIpcHandler(
    CHANNEL,
    implementation,
    deps
  )(TRUSTED, { environmentId: envId, entityId: SERVICE_ID, timeRange: '2h' })) as Envelope
  expect(JSON.stringify(result)).not.toContain('SECRETOTIPOS')
  expect(result.ok, JSON.stringify(result.error)).toBe(true)
  return result
}

const isEntity = (url: URL): boolean => decodeURIComponent(url.pathname) === ENTITY_PATH
const metricQueries = (): URL[] => requests.filter((u) => u.pathname === '/api/v2/metrics/query')
const allExpressions = (): { expression: string; query: URLSearchParams }[] =>
  metricQueries().flatMap((url) =>
    splitSelector(url.searchParams.get('metricSelector') ?? '').map((expression) => ({
      expression,
      query: url.searchParams
    }))
  )

describe('CA3 (0046): primero la entidad y después las consultas con las métricas del conjunto', () => {
  it.each(['server', 'client', 'unified', 'activity'] as const)('conjunto %s', async (set) => {
    useSet(set)
    await call()

    // Una sola petición a la entidad, la primera, con los fields de la ficha.
    const entityRequests = requests.filter(isEntity)
    expect(entityRequests).toHaveLength(1)
    expect(isEntity(requests[0]!), 'la primera petición es la entidad').toBe(true)
    const fields = (entityRequests[0]?.searchParams.get('fields') ?? '').split(',')
    for (const field of [
      '+properties.serviceType',
      '+properties.webServerName',
      '+properties.remoteEndpoint',
      '+properties.remoteServiceName'
    ]) {
      expect(fields, field).toContain(field)
    }

    // Después, solo consultas de métricas; ninguna con más de 10 expresiones.
    expect(metricQueries().length).toBeGreaterThan(0)
    expect(requests.length).toBe(1 + metricQueries().length)
    for (const url of metricQueries()) {
      expect(splitSelector(url.searchParams.get('metricSelector') ?? '').length).toBeLessThan(11)
    }

    // Todas las expresiones son de las métricas del conjunto, acotadas al servicio, y están
    // todas las del conjunto.
    const used = allExpressions()
    for (const { expression, query } of used) {
      expect(SET_KEYS[set], expression).toContain(keyOf(expression))
      expect(scopedToService(expression, query), expression).toBe(true)
    }
    expect([...new Set(used.map((u) => keyOf(u.expression)))].sort()).toEqual(
      [...SET_KEYS[set]].sort()
    )

    if (set === 'unified') {
      // Con la dimensión failed, sin splitBy del servicio llegarían dos series por expresión.
      for (const { expression } of used) {
        if (keyOf(expression) === UNIFIED.errors) continue
        expect(expression, expression).toContain('splitBy("dt.entity.service")')
      }
    }
    if (set === 'activity') {
      // Solo el recuento: ni mediana ni percentiles.
      for (const { expression } of used) {
        expect(expression).toMatch(/:count\b/)
        expect(expression).not.toMatch(/:median\b|:percentile\(/)
      }
    }
  })
})

describe('CA4 (0046): Solo actividad y tasa de las Unificadas', () => {
  const none = { timestamps: [], values: [] }

  it('Solo actividad: tiempos y errores null y las peticiones salen del recuento', async () => {
    useSet('activity')
    const result = await call()
    expect(result.data).toMatchObject({
      metricSet: 'activity',
      series: {
        responseTime: null,
        requests: { timestamps: T, values: [4, null, 6] },
        errors: null,
        ok: null,
        errorRate: null
      },
      totals: {
        // Suma de la serie del recuento (4 + 6).
        requests: 10,
        errors: null,
        ok: null,
        errorRate: null,
        responseTime: null
      }
    })
  })

  it('Unificadas: tiempos en ms tal cual, OK = total − fallidas y tasa = fallidas / total × 100', async () => {
    useSet('unified')
    // En las unificadas los tiempos ya llegan en milisegundos.
    seriesData = {
      ...seriesData,
      median: [200, null, 300],
      p90: [400, 500, 600],
      p99: [900, 1000, 1100],
      requests: [10, null, 8],
      errors: [2, 0, 2]
    }
    markerData = { ...markerData, median: 250, p90: 450, p99: 950 }
    const result = await call()
    expect(result.data).toMatchObject({
      metricSet: 'unified',
      series: {
        responseTime: {
          median: { timestamps: T, values: [200, null, 300] },
          p90: { timestamps: T, values: [400, 500, 600] },
          p99: { timestamps: T, values: [900, 1000, 1100] }
        },
        requests: { timestamps: T, values: [10, null, 8] },
        errors: { timestamps: T, values: [2, 0, 2] },
        ok: { timestamps: T, values: [8, null, 6] },
        // Punto a punto: 2 / 10; sin peticiones, null; 2 / 8.
        errorRate: { timestamps: T, values: [20, null, 25] }
      },
      totals: {
        requests: 18,
        errors: 4,
        ok: 14,
        errorRate: expect.closeTo((4 / 18) * 100, 9),
        responseTime: { median: 250, p90: 450, p99: 950 }
      }
    })
  })

  it('Unificadas sin peticiones: la tasa es null (en la serie y en el total)', async () => {
    useSet('unified')
    seriesData = { ...seriesData, requests: [0, null, 0], errors: [0, 0, 0] }
    const result = await call()
    expect(result.data).toMatchObject({
      series: { errorRate: { timestamps: T, values: [null, null, null] } },
      totals: { requests: 0, errors: 0, ok: 0, errorRate: null }
    })
  })

  it('Unificadas sin series: vacías y tasa null', async () => {
    useSet('unified')
    family = 'server' // Nada de las unificadas tiene datos.
    const result = await call()
    expect(result.data).toMatchObject({
      series: { requests: none, errors: none, ok: none, errorRate: none },
      totals: { requests: 0, errors: 0, ok: 0, errorRate: null }
    })
  })
})

describe('CA5 (0046): si la entidad falla, conjunto Servidor y un aviso', () => {
  it.each([
    ['403 (sin entities.read)', 403],
    ['404', 404],
    ['400', 400]
  ])('con %s en la entidad', async (_case, status) => {
    entityReply = {
      status,
      body: { error: { code: status, message: 'Token is missing required scope' } }
    }
    const result = await call()
    expect(result.data).toMatchObject({ metricSet: 'server', serviceType: null })
    expect((result.data?.['warnings'] as string[]).length).toBeGreaterThan(0)
    // Las consultas, con las métricas de Servidor (como antes de la 0046).
    expect(metricQueries().length).toBeGreaterThan(0)
    for (const { expression } of allExpressions()) {
      expect(SET_KEYS.server, expression).toContain(keyOf(expression))
    }
    // La página no se rompe: las series de Servidor llegan.
    expect(result.data).toMatchObject({
      series: { requests: { timestamps: T, values: [10, null, 5] } }
    })
  })
})

describe('CA2 (0046) en el canal: tipo desconocido o que no llega → Servidor con aviso', () => {
  it('un serviceType fuera de la tabla usa Servidor y lo anota en warnings', async () => {
    entityReply = { status: 200, body: entityBody('TIPO_QUE_NO_ESTA') }
    const result = await call()
    expect(result.data).toMatchObject({ metricSet: 'server', serviceType: 'TIPO_QUE_NO_ESTA' })
    const warnings = result.data?.['warnings'] as string[]
    expect(warnings.some((w) => w.includes('TIPO_QUE_NO_ESTA'))).toBe(true)
  })

  it('sin serviceType en la entidad usa Servidor, serviceType null y avisa', async () => {
    entityReply = { status: 200, body: entityBody(null) }
    const result = await call()
    expect(result.data).toMatchObject({ metricSet: 'server', serviceType: null })
    expect((result.data?.['warnings'] as string[]).length).toBeGreaterThan(0)
  })

  it('con un serviceType de la tabla no hay aviso', async () => {
    useSet('client')
    const result = await call()
    expect(result.data).toMatchObject({ warnings: [] })
  })
})

describe('CA6 (0046): la salida trae serviceType, metricSet y metricKeys', () => {
  it.each([
    [
      'server',
      {
        responseTime: SERVER.time,
        requests: SERVER.requests,
        errors: SERVER.errors,
        errorRate: SERVER.rate
      }
    ],
    [
      'client',
      {
        responseTime: CLIENT.time,
        requests: CLIENT.requests,
        errors: CLIENT.errors,
        errorRate: CLIENT.rate
      }
    ],
    [
      'unified',
      {
        responseTime: UNIFIED.time,
        requests: UNIFIED.requests,
        errors: UNIFIED.errors,
        // Sin métrica de tasa: se calcula en main.
        errorRate: null
      }
    ],
    ['activity', { responseTime: null, requests: SERVER.time, errors: null, errorRate: null }]
  ] as const)('conjunto %s', async (set, metricKeys) => {
    useSet(set)
    const result = await call()
    expect(result.data?.['serviceType']).toBe(ENTITY_OF[set].serviceType)
    expect(result.data?.['metricSet']).toBe(set)
    expect(result.data?.['metricKeys']).toEqual(metricKeys)
  })
})
