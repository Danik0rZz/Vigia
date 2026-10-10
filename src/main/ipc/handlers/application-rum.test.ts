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
 * Ficha 0052: canal `entities:applicationRum` (datos de RUM de una aplicación web, APPLICATION),
 * con el cliente de Dynatrace REAL sobre un fetch falso. SOLO API clásica: métricas
 * `builtin:apps.web.*` por `GET /api/v2/metrics/query`; nada de Grail ni DQL (decisión de Dani).
 *
 * Usa SOLO las expresiones confirmadas en vivo en el paso 0 (tabla de "Verificación" de la
 * ficha; `application-rum-explore.live.test.ts`) e imita lo observado:
 * - todas las métricas tienen la dimensión `dt.entity.application` y se acotan con
 *   `entitySelector=entityId("<aplicación>")`; con `:splitBy()` llega una serie sin dimensiones;
 * - los totales del rango son las mismas expresiones con `resolution=Inf`, que no son la suma ni
 *   la media de la serie (en `activeUsersEst`, una estimación de usuarios distintos del rango);
 * - `countOfErrors:splitBy("Error type"):sum` trae una serie por tipo (`JavaScript` y `Request`
 *   en vivo) con los mismos timestamps, y los tipos suman el total en el rango y en cada
 *   intervalo: los errores HTTP son los de `Request`, y se separan (`errorsByType` no es `null`);
 * - las acciones y duraciones `custom` y `event.count.rageClick` no traen series en vivo;
 * - la duración de sesión llega en microsegundos, el rebote y las acciones afectadas en tanto
 *   por ciento, LCP e INP en milisegundos y CLS sin unidad;
 * - la API admite como mucho 10 expresiones por consulta (OpenAPI v2): con más, aquí un 400.
 *
 * Decisiones del test-writer (delegadas, refinables, anotadas en la ficha): todos los papeles
 * tienen métrica en el catálogo, así que un papel sin datos llega con series vacías (no `null`) y
 * su total a `null`; las unidades llegan sin convertir; los tipos de error que no son JavaScript
 * ni Request van sumados a `other`; un 400 o 404 lleva el `reason` de la 0033
 * (`applicationMetricsRejected`, cuyo texto vale también aquí).
 */

const TRUSTED = { url: 'app://vigia/index.html', isMainFrame: true }
const TOKEN = `dt0c01.PUBLICAPRUEBA0000000000A.${'SECRETORUMAPLICA'.padEnd(64, 'X')}`
const BASE = 'https://abc12345.live.dynatrace.com'
const CHANNEL = 'entities:applicationRum' as IpcChannel
/** Id inventado, con el formato de Dynatrace. */
const APP_ID = 'APPLICATION-0123456789ABCDEF'
const APP_SELECTOR = `entityId("${APP_ID}")`
/** Momento fijo (epoch ms; la zona no importa aquí). */
const T0 = Date.parse('2026-10-03T08:00:00.000Z')
const T = [T0, T0 + 600_000, T0 + 1_200_000, T0 + 1_800_000]
const AT = T0 + 2_400_000
/** Límite de expresiones por consulta de /metrics/query (OpenAPI v2, `metricSelector`). */
const MAX_EXPRESSIONS = 10

const W = 'builtin:apps.web.'
/** Las expresiones exactas probadas en vivo (paso 0), por papel. */
const E = {
  actionsLoad: `${W}actionCount.load.browser:splitBy():sum`,
  actionsXhr: `${W}actionCount.xhr.browser:splitBy():sum`,
  actionsCustom: `${W}actionCount.custom.browser:splitBy():sum`,
  durationLoad: `${W}actionDuration.load.browser:splitBy():avg`,
  durationXhr: `${W}actionDuration.xhr.browser:splitBy():avg`,
  durationCustom: `${W}actionDuration.custom.browser:splitBy():avg`,
  errors: `${W}countOfErrors:splitBy("Error type"):sum`,
  affected: `${W}percentageOfUserActionsAffectedByErrors:splitBy()`,
  users: `${W}activeUsersEst:splitBy()`,
  started: `${W}startedSessions:splitBy():sum`,
  ended: `${W}endedSessions:splitBy():sum`,
  sessionDuration: `${W}sessionDuration:splitBy():avg`,
  actionsPerSession: `${W}actionsPerSession:splitBy():avg`,
  bounce: `${W}bouncedSessionRatio:splitBy()`,
  lcp: `${W}largestContentfulPaint.load.browser:splitBy():percentile(75)`,
  cls: `${W}cumulativeLayoutShift.load.browser:splitBy():percentile(75)`,
  inp: `${W}interactionToNextPaint:splitBy():percentile(75)`,
  rage: `${W}event.count.rageClick:splitBy():sum`
}
const ALL_EXPRESSIONS = Object.values(E)

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

type Values = (number | null)[]
/** Serie de cada expresión sin tipo de error (las que no están llegan sin series). */
let seriesData: Record<string, Values>
/** Valor del rango (Inf) de cada expresión sin tipo de error. */
let totalData: Record<string, number | null>
/** Series de `countOfErrors` por valor de «Error type», en el orden en que las da la API. */
let errorSeries: Record<string, Values>
/** Total del rango (Inf) de `countOfErrors` por valor de «Error type». */
let errorTotals: Record<string, number | null>
let empty: 'result' | 'data' | null
/** Si no es null, el metricId de cada resultado se cambia con esta función (casar por posición). */
let renameMetricId: ((expression: string) => string) | null
let failWith: { status: number; message: string } | null

interface Item {
  dimensionMap: Record<string, string>
  dimensions: string[]
  timestamps: number[]
  values: Values
}

function dataOf(expression: string, inf: boolean): Item[] {
  if (expression === E.errors) {
    const source = inf ? errorTotals : errorSeries
    return Object.entries(source).map(([type, values]) => ({
      dimensionMap: { 'Error type': type },
      dimensions: [type],
      timestamps: inf ? [AT] : T,
      values: inf ? [values as number | null] : (values as Values)
    }))
  }
  if (inf) {
    return expression in totalData
      ? [{ dimensionMap: {}, dimensions: [], timestamps: [AT], values: [totalData[expression]!] }]
      : []
  }
  const values = seriesData[expression]
  return values === undefined ? [] : [{ dimensionMap: {}, dimensions: [], timestamps: T, values }]
}

function metricsResponse(query: URLSearchParams): Response {
  if (failWith !== null) {
    return json(failWith.status, { error: { code: failWith.status, message: failWith.message } })
  }
  const selector = query.get('metricSelector') ?? ''
  const inf = query.get('resolution') === 'Inf'
  if (inf && selector.includes(':fold(')) {
    return json(400, { error: { code: 400, message: 'fold no admite resolution Inf' } })
  }
  const expressions = splitSelector(selector)
  if (expressions.length > MAX_EXPRESSIONS) {
    return json(400, { error: { code: 400, message: 'Como mucho 10 métricas por consulta' } })
  }
  const scoped = query.get('entitySelector') === APP_SELECTOR
  const result = expressions.map((expression) => ({
    metricId: renameMetricId === null ? expression : renameMetricId(expression),
    dataPointCountRatio: 0.005,
    dimensionCountRatio: 0.005,
    data: !scoped || empty === 'data' ? [] : dataOf(expression, inf)
  }))
  return json(200, {
    totalCount: empty === 'result' ? 0 : result.length,
    nextPageKey: null,
    resolution: inf ? 'Inf' : '10m',
    result: empty === 'result' ? [] : result
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
  empty = null
  renameMetricId = null
  // Con null en medio y al final, como en vivo. Sin custom ni rageClick (sin datos en vivo).
  seriesData = {
    [E.actionsLoad]: [120, null, 140, null],
    [E.actionsXhr]: [300, 280, null, null],
    [E.durationLoad]: [2_100.5, null, 1_980, null],
    [E.durationXhr]: [350, 420.25, null, null],
    [E.affected]: [3.5, null, 4.25, null],
    [E.users]: [40, 38, 51, null],
    [E.started]: [14, 9, 21, null],
    [E.ended]: [12, 10, 19, null],
    // Microsegundos (unidad de la API).
    [E.sessionDuration]: [185_000_000, null, 240_500_000, null],
    [E.actionsPerSession]: [6.5, null, 7.25, null],
    [E.bounce]: [22.5, null, 30, null],
    [E.lcp]: [2_350, null, 2_800.5, null],
    [E.cls]: [0.05, null, 0.12, null],
    [E.inp]: [180, null, 240, null]
  }
  // Distintos de lo que saldría de las series: los totales salen de su consulta (Inf). Los
  // usuarios del rango (97) no son la suma de la serie (129): es una estimación de distintos.
  totalData = {
    [E.actionsLoad]: 265,
    [E.actionsXhr]: 583,
    [E.durationLoad]: 2_040.75,
    [E.durationXhr]: 391,
    [E.affected]: 3.9,
    [E.users]: 97,
    [E.started]: 44,
    [E.ended]: 41,
    [E.sessionDuration]: 210_250_000,
    [E.actionsPerSession]: 6.9,
    [E.bounce]: 26.4,
    [E.lcp]: 2_610,
    [E.cls]: 0.09,
    [E.inp]: 215
  }
  errorSeries = {
    JavaScript: [2, null, 5, null],
    Request: [10, 12, null, null]
  }
  errorTotals = { JavaScript: 7, Request: 22 }

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
  expect(JSON.stringify(result)).not.toContain('SECRETORUMAPLICA')
  return result
}

const metricQueries = (): URL[] => requests.filter((u) => u.pathname === '/api/v2/metrics/query')
const isInf = (url: URL): boolean => url.searchParams.get('resolution') === 'Inf'
const expressionsOf = (url: URL): string[] =>
  splitSelector(url.searchParams.get('metricSelector') ?? '')
const sorted = (list: string[]): string[] => [...list].sort()

const series = (values: Values): { timestamps: number[]; values: Values } => ({
  timestamps: T,
  values
})
const none = { timestamps: [], values: [] }
const base = { entityId: APP_ID, timeRange: '2h' as const }

interface RumData {
  resolution: string
  series: Record<string, unknown>
  totals: Record<string, unknown>
}
const dataOfResult = (result: Envelope): RumData => {
  expect(result.ok, JSON.stringify(result.error)).toBe(true)
  return result.data as RumData
}

describe('CA2 (0052): ninguna consulta pasa de 10 expresiones y todas llevan el id y el rango', () => {
  it.each([
    ['relativo (2h)', '2h' as const, { from: 'now-2h', to: null }],
    [
      'absoluto',
      { from: '2026-10-01T08:00:00.000Z', to: '2026-10-01T10:00:00.000Z' },
      { from: '2026-10-01T08:00:00.000Z', to: '2026-10-01T10:00:00.000Z' }
    ]
  ])('rango %s', async (_case, timeRange, expected) => {
    const result = await call({ environmentId: envId, entityId: APP_ID, timeRange })
    expect(result.ok, JSON.stringify(result.error)).toBe(true)

    // Solo API clásica: todas las peticiones son a /api/v2/metrics/query (nada de Grail ni DQL).
    expect(requests.length).toBeGreaterThan(0)
    expect(requests.map((u) => u.pathname)).toEqual(requests.map(() => '/api/v2/metrics/query'))
    for (const url of requests) expect(url.origin).toBe(BASE)

    for (const url of metricQueries()) {
      const expressions = expressionsOf(url)
      expect(expressions.length, 'expresiones de una consulta').toBeGreaterThan(0)
      expect(expressions.length, 'expresiones de una consulta').toBeLessThanOrEqual(MAX_EXPRESSIONS)
      expect(url.searchParams.get('entitySelector')).toBe(APP_SELECTOR)
      expect(url.searchParams.get('from')).toBe(expected.from)
      expect(url.searchParams.get('to')).toBe(expected.to)
      // fold con resolution=Inf da 400 en vivo; el canal no lo usa.
      expect(url.searchParams.get('metricSelector') ?? '').not.toContain(':fold(')
    }

    // Series (sin resolution: la elige la API): cada expresión del paso 0 exactamente una vez.
    const seriesUrls = metricQueries().filter((u) => !isInf(u))
    for (const url of seriesUrls) expect(url.searchParams.has('resolution')).toBe(false)
    expect(sorted(seriesUrls.flatMap(expressionsOf))).toEqual(sorted(ALL_EXPRESSIONS))
    // Totales: las mismas, con resolution=Inf, cada una exactamente una vez.
    const totalUrls = metricQueries().filter(isInf)
    expect(sorted(totalUrls.flatMap(expressionsOf))).toEqual(sorted(ALL_EXPRESSIONS))
    // 18 expresiones de cada clase: como poco dos consultas de series y dos de totales.
    expect(seriesUrls.length).toBeGreaterThanOrEqual(2)
    expect(totalUrls.length).toBeGreaterThanOrEqual(2)
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
      expect(url.searchParams.get('entitySelector')).toBe(APP_SELECTOR)
    }
    if (result.ok) expect(metricQueries().length).toBeGreaterThan(0)
  })

  it.each([
    ['un host', 'HOST-0123456789ABCDEF'],
    ['una acción de usuario', 'APPLICATION_METHOD-0123456789ABCDEF'],
    ['una aplicación móvil', 'MOBILE_APPLICATION-0123456789ABCDEF'],
    ['inyección tras un id válido', 'APPLICATION-0123456789ABCDEF"),type("HOST']
  ])('rechaza %s sin llamar a Dynatrace', async (_case, entityId) => {
    const result = await call({ environmentId: envId, entityId, timeRange: '2h' })
    expect(result.ok).toBe(false)
    expect(requests).toHaveLength(0)
  })
})

describe('CA3 (0052): transformación por papel, con papeles sin datos y null conservados', () => {
  it('series por papel, con los null conservados y las unidades de la API', async () => {
    const data = dataOfResult(await call({ environmentId: envId, ...base }))
    // La de las consultas de series (no la de los totales, Inf).
    expect(data.resolution).toBe('10m')
    expect(data.series).toEqual({
      actionsByType: {
        load: series([120, null, 140, null]),
        xhr: series([300, 280, null, null]),
        // Sin datos (como en vivo): serie vacía, no null.
        custom: none
      },
      durationByType: {
        load: series([2_100.5, null, 1_980, null]),
        xhr: series([350, 420.25, null, null]),
        custom: none
      },
      errorsByType: {
        javascript: series([2, null, 5, null]),
        http: series([10, 12, null, null]),
        // Sin otros tipos: vacía.
        other: none
      },
      // Tanto por ciento, de 0 a 100, sin convertir.
      affectedActionsPct: series([3.5, null, 4.25, null]),
      activeUsers: series([40, 38, 51, null]),
      sessions: {
        started: series([14, 9, 21, null]),
        ended: series([12, 10, 19, null])
      },
      // Microsegundos, como llegan de la API.
      sessionDuration: series([185_000_000, null, 240_500_000, null]),
      actionsPerSession: series([6.5, null, 7.25, null]),
      bounceRate: series([22.5, null, 30, null]),
      // LCP e INP en ms; CLS sin unidad.
      vitals: {
        lcp: series([2_350, null, 2_800.5, null]),
        cls: series([0.05, null, 0.12, null]),
        inp: series([180, null, 240, null])
      },
      rageClicks: none
    })
  })

  it('totales del rango por papel: los de su consulta con Inf, no los de las series', async () => {
    const data = dataOfResult(await call({ environmentId: envId, ...base }))
    expect(data.totals).toEqual({
      actionsByType: { load: 265, xhr: 583, custom: null },
      durationByType: { load: 2_040.75, xhr: 391, custom: null },
      errorsByType: { javascript: 7, http: 22, other: null },
      affectedActionsPct: 3.9,
      // La estimación de usuarios distintos del rango, no la suma de la serie (129).
      activeUsers: 97,
      sessions: { started: 44, ended: 41 },
      sessionDuration: 210_250_000,
      actionsPerSession: 6.9,
      bounceRate: 26.4,
      vitals: { lcp: 2_610, cls: 0.09, inp: 215 },
      rageClicks: null
    })
  })

  it('todos los papeles tienen métrica (paso 0): ninguno llega a null, ni siquiera sin datos', async () => {
    seriesData = {}
    totalData = {}
    errorSeries = {}
    errorTotals = {}
    const data = dataOfResult(await call({ environmentId: envId, ...base }))
    expect(Object.keys(data.series).length).toBe(11)
    for (const [role, value] of Object.entries(data.series)) expect(value, role).not.toBeNull()
    expect(data.series['errorsByType']).toEqual({ javascript: none, http: none, other: none })
    expect(data.totals['errorsByType']).toEqual({ javascript: null, http: null, other: null })
  })

  it('errorsByType según el paso 0: JavaScript, Request (HTTP) y los demás tipos sumados en other', async () => {
    // Los tipos llegan en cualquier orden; los que no son JavaScript ni Request (ninguno visto en
    // vivo) suman en other, intervalo a intervalo (null + null = null).
    errorSeries = {
      Custom: [1, null, null, null],
      Request: [10, 12, null, null],
      Otro: [null, 2, null, 4],
      JavaScript: [2, null, 5, null]
    }
    errorTotals = { Custom: 1, Request: 22, Otro: 6, JavaScript: 7 }
    const data = dataOfResult(await call({ environmentId: envId, ...base }))
    expect(data.series['errorsByType']).toEqual({
      javascript: series([2, null, 5, null]),
      http: series([10, 12, null, null]),
      other: series([1, 2, null, 4])
    })
    expect(data.totals['errorsByType']).toEqual({ javascript: 7, http: 22, other: 7 })
  })

  it('un tipo de error sin series: el suyo vacío y su total a null; los demás, igual', async () => {
    errorSeries = { Request: [10, 12, null, null] }
    errorTotals = { Request: 22 }
    const data = dataOfResult(await call({ environmentId: envId, ...base }))
    expect(data.series['errorsByType']).toEqual({
      javascript: none,
      http: series([10, 12, null, null]),
      other: none
    })
    expect(data.totals['errorsByType']).toEqual({ javascript: null, http: 22, other: null })
  })

  it('casa los resultados por posición: con otro metricId en la respuesta, el resultado no cambia', async () => {
    const expected = dataOfResult(await call({ environmentId: envId, ...base }))
    // Como en la 0040: el metricId puede llegar sin las comillas (o distinto de lo pedido).
    renameMetricId = (expression) => expression.replaceAll('"', '')
    const renamed = dataOfResult(await call({ environmentId: envId, ...base }))
    expect(renamed.series).toEqual(expected.series)
    expect(renamed.totals).toEqual(expected.totals)
  })

  it.each([
    ['sin resultados (result vacío)', 'result' as const],
    ['resultados sin series (data vacío)', 'data' as const]
  ])('%s: series vacías y totales a null, sin error', async (_case, kind) => {
    empty = kind
    const data = dataOfResult(await call({ environmentId: envId, ...base }))
    expect(data.series).toMatchObject({
      actionsByType: { load: none, xhr: none, custom: none },
      errorsByType: { javascript: none, http: none, other: none },
      activeUsers: none,
      vitals: { lcp: none, cls: none, inp: none },
      rageClicks: none
    })
    expect(data.totals).toEqual({
      actionsByType: { load: null, xhr: null, custom: null },
      durationByType: { load: null, xhr: null, custom: null },
      errorsByType: { javascript: null, http: null, other: null },
      affectedActionsPct: null,
      activeUsers: null,
      sessions: { started: null, ended: null },
      sessionDuration: null,
      actionsPerSession: null,
      bounceRate: null,
      vitals: { lcp: null, cls: null, inp: null },
      rageClicks: null
    })
  })
})

describe('CA4 (0052): un 400 o un 404 de Dynatrace acaba en error con reason', () => {
  it.each([400, 404])('un %i', async (status) => {
    failWith = { status, message: 'Mensaje de Dynatrace en la prueba' }
    const result = await call({ environmentId: envId, ...base })
    expect(result.ok).toBe(false)
    expect(result.error?.reason?.key, 'reason del error').toBe('applicationMetricsRejected')
  })
})
