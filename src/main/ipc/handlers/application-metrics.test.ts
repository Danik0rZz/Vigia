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
 * Ficha 0033: canal `entities:applicationMetrics` (una aplicación web, APPLICATION), con el
 * cliente de Dynatrace REAL sobre un fetch falso. Se comprueba qué se pide a /metrics/query y
 * cómo llega la respuesta a la interfaz.
 *
 * Usa SOLO las expresiones confirmadas en vivo en el paso 0 (tabla de "Verificación" de la
 * ficha) e imita lo observado:
 * - las métricas de la aplicación tienen la dimensión `dt.entity.application` y se acotan con
 *   `entitySelector=entityId("<aplicación>")`; con `:splitBy()` llega una serie sin dimensiones;
 * - los totales del rango son las mismas expresiones con `resolution=Inf` (Apdex y duración, la
 *   media ponderada, que no es la media de la serie; los recuentos, a menos del 1 % de su suma);
 * - las métricas por acción (`builtin:apps.web.action.*`) solo tienen la dimensión
 *   `dt.entity.application_method`: con `entityId("<aplicación>")` no llega nada, y las acciones
 *   se eligen con
 *   `type("APPLICATION_METHOD"),fromRelationships.isApplicationMethodOf(entityId("<aplicación>"))`;
 * - por tipo de acción (load, xhr y custom), las 10 de más volumen con
 *   `:sort(value(count,descending)):limit(10)` antes de `:count` (el recuento) y de `:avg` (la
 *   duración media), con `:names`: las dos expresiones del mismo tipo traen las mismas acciones;
 *   una acción no sale en dos tipos;
 * - cada expresión vuelve en el orden pedido, con el `metricId` igual a la expresión.
 *
 * Decisiones del test-writer (delegadas, refinables, anotadas en la ficha): los cinco papeles
 * tienen métrica, así que un papel sin datos llega con series vacías (no `null`); los `null` son
 * los de los totales sin dato y los de cada acción (recuento o duración sin dato). Las 10
 * acciones son las de más recuento entre los tres tipos.
 */

const TRUSTED = { url: 'app://vigia/index.html', isMainFrame: true }
const TOKEN = `dt0c01.PUBLICAPRUEBA0000000000A.${'SECRETOAPLICACION'.padEnd(64, 'X')}`
const BASE = 'https://abc12345.live.dynatrace.com'
const CHANNEL = 'entities:applicationMetrics' as IpcChannel
/** Ids inventados, con el formato de Dynatrace. */
const APP_ID = 'APPLICATION-0123456789ABCDEF'
const method = (n: number): string =>
  `APPLICATION_METHOD-${n.toString(16).toUpperCase().padStart(16, '0')}`
/** Momento fijo (epoch ms; la zona no importa aquí). */
const T0 = Date.parse('2026-10-03T08:00:00.000Z')
const T = [T0, T0 + 600_000, T0 + 1_200_000, T0 + 1_800_000]

const W = 'builtin:apps.web.'
const APDEX = `${W}apdex.userType:splitBy():avg`
const ACTIONS = `${W}actionCount.summary:splitBy():sum`
const DURATION = `${W}visuallyComplete.load.browser:splitBy():avg`
const ERRORS = `${W}countOfErrors:splitBy():sum`
const SESSIONS = `${W}startedSessions:splitBy():sum`
/** Series y totales de la aplicación: las expresiones exactas probadas en vivo. */
const APP_EXPRESSIONS = [APDEX, ACTIONS, DURATION, ERRORS, SESSIONS]

const BY_METHOD = ':splitBy("dt.entity.application_method"):sort(value(count,descending)):limit(10)'
const TYPES = ['load', 'xhr', 'custom'] as const
type ActionType = (typeof TYPES)[number]
const countOf = (type: ActionType): string =>
  `${W}action.duration.${type}.browser${BY_METHOD}:count:names`
const avgOf = (type: ActionType): string =>
  `${W}action.duration.${type}.browser${BY_METHOD}:avg:names`
/** Las 10 acciones de cada tipo: las exactas probadas en vivo, con Inf. */
const ACTION_EXPRESSIONS = TYPES.flatMap((type) => [countOf(type), avgOf(type)])

const APP_SELECTOR = `entityId("${APP_ID}")`
/** El selector de las acciones de la aplicación confirmado en vivo. */
const METHODS_SELECTOR = `type("APPLICATION_METHOD"),fromRelationships.isApplicationMethodOf(entityId("${APP_ID}"))`

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
interface Action {
  id: string
  name?: string
  value: number | null
}
/** Serie de cada expresión de la aplicación (las que no están llegan sin series). */
let seriesData: Record<string, Values>
/** Valor del rango (Inf) de cada expresión de la aplicación. */
let totalData: Record<string, number | null>
/** Acciones por expresión de acción, en el orden en que las da la API. */
let actionData: Record<string, Action[]>
interface Extras {
  empty?: 'result' | 'data'
  ratios?: { dataPointCountRatio: number; dimensionCountRatio: number }
}
let seriesExtras: Extras
let totalExtras: Extras
let actionExtras: Extras
let failWith: { status: number; message: string } | null

interface Item {
  dimensionMap: Record<string, string>
  dimensions: string[]
  timestamps: number[]
  values: Values
}

const AT = T0 + 2_400_000

function dataOf(expression: string, kind: 'series' | 'totals' | 'actions'): Item[] {
  if (kind === 'actions') {
    return (actionData[expression] ?? []).map((action) => {
      const dimensionMap: Record<string, string> = { 'dt.entity.application_method': action.id }
      if (action.name !== undefined) dimensionMap['dt.entity.application_method.name'] = action.name
      return { dimensionMap, dimensions: [action.id], timestamps: [AT], values: [action.value] }
    })
  }
  if (kind === 'totals') {
    return expression in totalData
      ? [
          {
            dimensionMap: {},
            dimensions: [],
            timestamps: [AT],
            values: [totalData[expression] ?? null]
          }
        ]
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
  const entitySelector = query.get('entitySelector')
  const expressions = splitSelector(selector)
  // Como en vivo: las de la aplicación, con entityId; las de acción, con el selector de las
  // acciones (con entityId de la aplicación no traen nada, y al revés).
  const result = expressions.map((expression) => {
    const isAction = ACTION_EXPRESSIONS.includes(expression)
    const scoped = isAction ? entitySelector === METHODS_SELECTOR : entitySelector === APP_SELECTOR
    const kind = isAction ? 'actions' : inf ? 'totals' : 'series'
    const extras = isAction ? actionExtras : inf ? totalExtras : seriesExtras
    return {
      extras,
      item: {
        metricId: expression,
        dataPointCountRatio: extras.ratios?.dataPointCountRatio ?? 0.005,
        dimensionCountRatio: extras.ratios?.dimensionCountRatio ?? 0.005,
        data: !scoped || extras.empty === 'data' ? [] : dataOf(expression, kind)
      }
    }
  })
  const empty = result.some(({ extras }) => extras.empty === 'result')
  return json(200, {
    totalCount: empty ? 0 : result.length,
    nextPageKey: null,
    resolution: inf ? 'Inf' : '10m',
    result: empty ? [] : result.map(({ item }) => item)
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
  totalExtras = {}
  actionExtras = {}
  // Con null en medio y al final, como en vivo (los errores, con huecos).
  seriesData = {
    [APDEX]: [0.92, null, 0.875, null],
    [ACTIONS]: [120, 95, 140, null],
    [DURATION]: [1_850.5, null, 2_400, null],
    [ERRORS]: [3, null, 7, null],
    [SESSIONS]: [14, 9, 21, null]
  }
  // Distintos de lo que saldría de las series: los totales salen de su consulta (Inf).
  totalData = {
    [APDEX]: 0.9,
    [ACTIONS]: 356,
    [DURATION]: 2_050.25,
    [ERRORS]: 10,
    [SESSIONS]: 44
  }
  // Las de cada tipo, de más a menos recuento (como las da :sort); cada tipo con sus acciones.
  // La 3 no trae duración media; la 6 no trae nombre.
  actionData = {
    [countOf('load')]: [
      { id: method(1), name: 'Carga de inicio', value: 300 },
      { id: method(2), name: 'Carga de ficha', value: 40 }
    ],
    [avgOf('load')]: [
      { id: method(1), name: 'Carga de inicio', value: 2_100.5 },
      { id: method(2), name: 'Carga de ficha', value: 3_200 }
    ],
    [countOf('xhr')]: [
      { id: method(3), name: 'Petición de búsqueda', value: 120 },
      { id: method(4), name: 'Petición de guardado', value: 12 }
    ],
    [avgOf('xhr')]: [{ id: method(4), name: 'Petición de guardado', value: 450 }],
    [countOf('custom')]: [
      { id: method(5), name: 'Acción propia', value: 75 },
      { id: method(6), value: 5 }
    ],
    [avgOf('custom')]: [
      { id: method(5), name: 'Acción propia', value: 88.25 },
      { id: method(6), value: 10 }
    ]
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
  expect(JSON.stringify(result)).not.toContain('SECRETOAPLICACION')
  return result
}

const metricQueries = (): URL[] => requests.filter((u) => u.pathname === '/api/v2/metrics/query')
const isInf = (url: URL): boolean => url.searchParams.get('resolution') === 'Inf'
const bySelector = (selector: string): URL[] =>
  metricQueries().filter((u) => u.searchParams.get('entitySelector') === selector)
const expressionsOf = (url: URL | undefined): string[] =>
  splitSelector(url?.searchParams.get('metricSelector') ?? '')

const series = (values: Values): { timestamps: number[]; values: Values } => ({
  timestamps: T,
  values
})
const none = { timestamps: [], values: [] }
const base = { entityId: APP_ID, timeRange: '2h' as const }

describe('CA3 (0033): las consultas llevan las métricas elegidas, el id y el rango', () => {
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

    // Exactamente tres peticiones, todas a /metrics/query: series y totales de la aplicación y
    // las 10 acciones (los nombres llegan en dimensionMap; no hace falta /entities).
    expect(requests).toHaveLength(3)
    expect(metricQueries()).toHaveLength(3)
    const app = bySelector(APP_SELECTOR)
    const seriesUrl = app.find((u) => !isInf(u))
    const totalsUrl = app.find(isInf)
    const [actionsUrl] = bySelector(METHODS_SELECTOR)
    expect(seriesUrl, 'consulta de series, con entityId de la aplicación').toBeDefined()
    expect(totalsUrl, 'consulta de totales, con entityId de la aplicación').toBeDefined()
    expect(actionsUrl, 'consulta de las acciones, con el selector de sus acciones').toBeDefined()

    // Series: exactamente las expresiones probadas en vivo, sin resolution (la elige la API).
    expect(seriesUrl?.searchParams.has('resolution')).toBe(false)
    expect([...expressionsOf(seriesUrl)].sort()).toEqual([...APP_EXPRESSIONS].sort())
    // Totales: las mismas, con resolution=Inf y sin fold (juntos dan 400).
    expect(totalsUrl?.searchParams.get('metricSelector') ?? '').not.toContain(':fold(')
    expect([...expressionsOf(totalsUrl)].sort()).toEqual([...APP_EXPRESSIONS].sort())
    // Acciones: las seis (recuento y media de los tres tipos), con resolution=Inf.
    expect(actionsUrl && isInf(actionsUrl)).toBe(true)
    expect([...expressionsOf(actionsUrl)].sort()).toEqual([...ACTION_EXPRESSIONS].sort())

    for (const url of [seriesUrl, totalsUrl, actionsUrl]) {
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
      expect(url.searchParams.get('entitySelector') ?? '').toContain(APP_ID)
    }
    if (result.ok) expect(metricQueries()).toHaveLength(3)
  })
})

/**
 * CA4. Los cinco papeles tienen métrica (paso 0): un papel sin datos llega con series vacías,
 * no `null`. Los `null` son los de los totales sin dato y los de cada acción.
 */
describe('CA4 (0033): transformación por papel y de las 10 acciones', () => {
  it('series por papel, con los null conservados y las unidades de la API', async () => {
    const result = await call({ environmentId: envId, ...base })
    expect(result.ok, JSON.stringify(result.error)).toBe(true)
    expect(result.data).toMatchObject({
      // La de la consulta de series (no la de los totales, Inf).
      resolution: '10m',
      series: {
        // Apdex de 0 a 1, recuentos por intervalo y duración en ms, sin convertir.
        apdex: series([0.92, null, 0.875, null]),
        actions: series([120, 95, 140, null]),
        duration: series([1_850.5, null, 2_400, null]),
        errors: series([3, null, 7, null]),
        sessions: series([14, 9, 21, null])
      },
      warnings: [],
      partial: []
    })
  })

  it('totales del rango por papel: los de su consulta con Inf, no los de las series', async () => {
    const result = await call({ environmentId: envId, ...base })
    expect(result.ok, JSON.stringify(result.error)).toBe(true)
    expect((result.data as { totals: unknown }).totals).toEqual({
      apdex: 0.9,
      actions: 356,
      duration: 2_050.25,
      errors: 10,
      sessions: 44
    })
  })

  it('acciones de los tres tipos juntas, de más a menos recuento, con su duración media', async () => {
    const result = await call({ environmentId: envId, ...base })
    expect(result.ok, JSON.stringify(result.error)).toBe(true)
    expect((result.data as { topActions: unknown }).topActions).toEqual([
      { id: method(1), name: 'Carga de inicio', count: 300, duration: 2_100.5 },
      // Sin serie de duración media: duration a null.
      { id: method(3), name: 'Petición de búsqueda', count: 120, duration: null },
      { id: method(5), name: 'Acción propia', count: 75, duration: 88.25 },
      { id: method(2), name: 'Carga de ficha', count: 40, duration: 3_200 },
      { id: method(4), name: 'Petición de guardado', count: 12, duration: 450 },
      // Sin nombre en dimensionMap: name es el id.
      { id: method(6), name: method(6), count: 5, duration: 10 }
    ])
  })

  it('con más de 10 acciones entre los tres tipos, solo las 10 de más recuento', async () => {
    // 10 de carga (la API ya da como mucho 10 por tipo) y 10 de xhr, intercaladas por recuento.
    const load = Array.from({ length: 10 }, (_, i) => ({
      id: method(100 + i),
      value: 1_000 - i * 100
    }))
    const xhr = Array.from({ length: 10 }, (_, i) => ({
      id: method(200 + i),
      value: 950 - i * 100
    }))
    actionData = {
      [countOf('load')]: load,
      [avgOf('load')]: load.map((a) => ({ ...a, value: 1_500 })),
      [countOf('xhr')]: xhr,
      [avgOf('xhr')]: xhr.map((a) => ({ ...a, value: 300 }))
    }
    const result = await call({ environmentId: envId, ...base })
    expect(result.ok, JSON.stringify(result.error)).toBe(true)
    const top = (result.data as { topActions: { id: string; count: number; duration: number }[] })
      .topActions
    expect(top.map((a) => a.count)).toEqual([1_000, 950, 900, 850, 800, 750, 700, 650, 600, 550])
    expect(top.map((a) => a.id)).toEqual([
      method(100),
      method(200),
      method(101),
      method(201),
      method(102),
      method(202),
      method(103),
      method(203),
      method(104),
      method(204)
    ])
    // Cada una con la duración media de su tipo.
    expect(top.find((a) => a.id === method(100))?.duration).toBe(1_500)
    expect(top.find((a) => a.id === method(200))?.duration).toBe(300)
  })

  it('una acción sin recuento va al final con count null', async () => {
    actionData[countOf('load')]![0]!.value = null
    const result = await call({ environmentId: envId, ...base })
    expect(result.ok, JSON.stringify(result.error)).toBe(true)
    const top = (result.data as { topActions: { id: string; count: number | null }[] }).topActions
    expect(top.map((a) => a.id)).toEqual([
      method(3),
      method(5),
      method(2),
      method(4),
      method(6),
      method(1)
    ])
    expect(top.at(-1)).toEqual({
      id: method(1),
      name: 'Carga de inicio',
      count: null,
      duration: 2_100.5
    })
  })

  it('un papel sin datos: series vacías (no null) y su total a null', async () => {
    delete seriesData[ERRORS]
    delete totalData[ERRORS]
    totalData[APDEX] = null
    const result = await call({ environmentId: envId, ...base })
    expect(result.ok, JSON.stringify(result.error)).toBe(true)
    expect(result.data).toMatchObject({
      series: { apdex: series([0.92, null, 0.875, null]), errors: none },
      warnings: [],
      partial: []
    })
    expect((result.data as { totals: unknown }).totals).toEqual({
      apdex: null,
      actions: 356,
      duration: 2_050.25,
      errors: null,
      sessions: 44
    })
  })

  it('un ratio > 1 en la consulta de las acciones llega en partial', async () => {
    actionExtras = { ratios: { dataPointCountRatio: 0.005, dimensionCountRatio: 2 } }
    const result = await call({ environmentId: envId, ...base })
    expect(result.ok, JSON.stringify(result.error)).toBe(true)
    const partial = (result.data as { partial: { metricId: string; dimensions: unknown }[] })
      .partial
    expect(partial.map((item) => item.metricId).sort()).toEqual([...ACTION_EXPRESSIONS].sort())
    expect(partial.every((item) => item.dimensions === 2)).toBe(true)
  })
})

describe('CA5 (0033): errores de Dynatrace y aplicación sin datos', () => {
  it.each([400, 404])('un %i acaba en error con reason', async (status) => {
    failWith = { status, message: 'Mensaje de Dynatrace en la prueba' }
    const result = await call({ environmentId: envId, ...base })
    expect(result.ok).toBe(false)
    expect(result.error?.reason?.key, 'reason del error').toEqual(expect.any(String))
  })

  it.each([
    ['sin resultados (result vacío)', 'result' as const],
    ['resultados sin series (data vacío)', 'data' as const]
  ])('%s: series y acciones vacías y totales a null, sin error', async (_case, empty) => {
    seriesExtras = { empty }
    totalExtras = { empty }
    actionExtras = { empty }
    const result = await call({ environmentId: envId, ...base })
    expect(result.ok, JSON.stringify(result.error)).toBe(true)
    expect(result.data).toMatchObject({
      series: { apdex: none, actions: none, duration: none, errors: none, sessions: none },
      topActions: []
    })
    expect((result.data as { totals: unknown }).totals).toEqual({
      apdex: null,
      actions: null,
      duration: null,
      errors: null,
      sessions: null
    })
  })
})
