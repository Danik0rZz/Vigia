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
 * Ficha 0023: canal `entities:monitorBreakdown` (desglose de un browser monitor,
 * SYNTHETIC_TEST, o de un HTTP monitor, HTTP_CHECK, por localización y por paso o
 * petición), con el cliente de Dynatrace REAL sobre un fetch falso.
 *
 * Lección de la 0022: el canal solo puede enviar EXACTAMENTE las expresiones probadas
 * en vivo (`monitor-breakdown-explore.live.test.ts`, "Verificación" de la ficha), con el
 * mismo ámbito. El fetch falso imita lo observado en vivo, el 2026-10-08:
 * - `browser.availability`, `http.availability`, `http.duration.geo` y
 *   `http.resultStatus` quedan acotadas al monitor con `entitySelector=entityId(...)`;
 * - `browser.duration` y `browser.step.duration` NO: con `entityId(...)` (o con el
 *   selector de los pasos por relación) traen las series de todos los monitores. Solo
 *   las acota `filter(eq("dt.entity.synthetic_test","<id>"))`;
 * - `http.request.duration.geo` no tiene la dimensión del monitor: con `entityId(...)`
 *   sale vacía; la acota `type("HTTP_CHECK_STEP"),fromRelationships.isStepOf(...)`;
 * - con `:names`, `dimensionMap` trae `<dimensión>.name` de localización y de paso; no
 *   trae número de secuencia del paso;
 * - las series de cada métrica no llegan en el mismo orden de localizaciones;
 * - el `metricId` devuelto quita las comillas de los valores de `filter(eq(...))`: no
 *   coincide con la expresión enviada (se casan por posición);
 * - sin fallos en una localización, `resultStatus` FAILURE no trae su serie;
 * - el browser monitor no tiene métrica de fallidas por localización (`browser.failure`
 *   solo tiene la dimensión del monitor).
 */

const TRUSTED = { url: 'app://vigia/index.html', isMainFrame: true }
const TOKEN = `dt0c01.PUBLICAPRUEBA0000000000A.${'SECRETODESGL'.padEnd(64, 'X')}`
const BASE = 'https://abc12345.live.dynatrace.com'
const CHANNEL = 'entities:monitorBreakdown' as IpcChannel
/** Ids inventados, con el formato de Dynatrace. */
const BROWSER_ID = 'SYNTHETIC_TEST-0123456789ABCDEF'
const HTTP_ID = 'HTTP_CHECK-FEDCBA9876543210'
/** De otro monitor: lo que trae una expresión no acotada. */
const OTHER_LOCATION = 'SYNTHETIC_LOCATION-00000000000000FF'
const OTHER_STEP: Record<Kind, string> = {
  browser: 'SYNTHETIC_TEST_STEP-00000000000000FF',
  http: 'HTTP_CHECK_STEP-00000000000000FF'
}
const T0 = Date.parse('2026-10-03T08:00:00.000Z')

const B = 'builtin:synthetic.browser.'
const H = 'builtin:synthetic.http.'
const BY_LOCATION = ':splitBy("dt.entity.synthetic_location")'
const browserFilter = (id: string): string => `:filter(eq("dt.entity.synthetic_test","${id}"))`

type Kind = 'browser' | 'http'
type Role = 'availability' | 'duration' | 'failed' | 'steps'
/** Ámbito con el que se probó cada expresión. */
type Scope = 'monitor' | 'steps' | 'none'

interface Confirmed {
  role: Role
  expression: string
  scopes: Scope[]
}

/** Las expresiones confirmadas en vivo, con el id del monitor y los ámbitos probados. */
function confirmed(kind: Kind, id: string): Confirmed[] {
  if (kind === 'browser') {
    return [
      {
        role: 'availability',
        expression: `${B}availability${BY_LOCATION}:avg:names`,
        scopes: ['monitor']
      },
      {
        role: 'duration',
        expression: `${B}duration${browserFilter(id)}${BY_LOCATION}:avg:names`,
        scopes: ['monitor', 'none']
      },
      {
        role: 'steps',
        expression: `${B}step.duration${browserFilter(id)}:splitBy("dt.entity.synthetic_test_step"):avg:names`,
        scopes: ['monitor', 'none']
      }
    ]
  }
  return [
    {
      role: 'availability',
      expression: `${H}availability${BY_LOCATION}:avg:names`,
      scopes: ['monitor']
    },
    {
      role: 'duration',
      expression: `${H}duration.geo${BY_LOCATION}:avg:names`,
      scopes: ['monitor']
    },
    {
      role: 'failed',
      expression: `${H}resultStatus:filter(eq("Result status","FAILURE"))${BY_LOCATION}:sum:names`,
      scopes: ['monitor']
    },
    {
      role: 'steps',
      expression: `${H}request.duration.geo:splitBy("dt.entity.http_check_step"):avg:names`,
      scopes: ['steps']
    }
  ]
}

const ID: Record<Kind, string> = { browser: BROWSER_ID, http: HTTP_ID }
const STEP_TYPE: Record<Kind, string> = { browser: 'SYNTHETIC_TEST_STEP', http: 'HTTP_CHECK_STEP' }
const STEP_DIMENSION: Record<Kind, string> = {
  browser: 'dt.entity.synthetic_test_step',
  http: 'dt.entity.http_check_step'
}
const LOCATION_DIMENSION = 'dt.entity.synthetic_location'

/** Ámbito de una consulta, por su entitySelector. */
function scopeOf(query: URLSearchParams, kind: Kind): Scope | 'other' {
  const selector = query.get('entitySelector')
  if (selector === null) return 'none'
  if (selector === `entityId("${ID[kind]}")`) return 'monitor'
  if (selector === `type("${STEP_TYPE[kind]}"),fromRelationships.isStepOf(entityId("${ID[kind]}"))`)
    return 'steps'
  return 'other'
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

/** De qué tipo es la consulta, por el id que lleva. */
function kindOf(query: URLSearchParams): Kind | null {
  const text = `${query.get('metricSelector') ?? ''} ${query.get('entitySelector') ?? ''}`
  if (text.includes(BROWSER_ID)) return 'browser'
  if (text.includes(HTTP_ID)) return 'http'
  return null
}

/** Una serie del simulador: id de la entidad, su nombre (o ninguno) y el valor del rango. */
interface Item {
  id: string
  name?: string
  value: number | null
}
/** Datos del monitor, por papel, en el orden en que los devuelve la API (no el esperado). */
let data: Record<Kind, Partial<Record<Role, Item[]>>>
let failWith: { status: number; message: string } | null
let empty: boolean

const loc = (n: number): string => `SYNTHETIC_LOCATION-000000000000000${n}`
const step = (kind: Kind, n: number): string => `${STEP_TYPE[kind]}-000000000000000${n}`

/** Lo que trae una expresión no confirmada o con otro ámbito: también otros monitores. */
function unscoped(kind: Kind, role: Role | null): Item[] {
  if (role === 'steps') return [{ id: OTHER_STEP[kind], name: 'Paso ajeno', value: 1 }]
  return [{ id: OTHER_LOCATION, name: 'Localización ajena', value: 1 }]
}

/** ¿A qué papel se parece una expresión (aunque no sea la confirmada)? */
function roleLike(expression: string): Role | null {
  if (expression.includes('step.') || expression.includes('request.')) return 'steps'
  if (expression.includes('resultStatus')) return 'failed'
  if (expression.includes('availability')) return 'availability'
  if (expression.includes('duration')) return 'duration'
  return null
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
  const inf = query.get('resolution') === 'Inf'
  const expressions = splitSelector(selector)
  const result = expressions.map((expression) => {
    const match =
      kind === null ? undefined : confirmed(kind, ID[kind]).find((c) => c.expression === expression)
    const scope = kind === null ? 'other' : scopeOf(query, kind)
    const valid = match !== undefined && (match.scopes as string[]).includes(scope)
    const role = match?.role ?? roleLike(expression)
    // HTTP: los pasos con entityId del monitor salen vacíos (no tienen su dimensión).
    const items: Item[] =
      kind === null || empty
        ? []
        : valid
          ? (data[kind][match.role] ?? [])
          : kind === 'http' && role === 'steps' && scope === 'monitor'
            ? []
            : [...(role === null ? [] : (data[kind][role] ?? [])), ...unscoped(kind, role)]
    const dimension = role === 'steps' && kind !== null ? STEP_DIMENSION[kind] : LOCATION_DIMENSION
    return {
      // Como en vivo: sin las comillas de los valores del filtro.
      metricId: expression
        .split(`"${kind === null ? '' : ID[kind]}"`)
        .join(kind === null ? '' : ID[kind])
        .split('"FAILURE"')
        .join('FAILURE'),
      dataPointCountRatio: 0.005,
      dimensionCountRatio: 0.005,
      data: items.map((item) => ({
        dimensionMap: {
          [dimension]: item.id,
          ...(item.name === undefined ? {} : { [`${dimension}.name`]: item.name })
        },
        dimensions: [item.id],
        timestamps: inf ? [T0 + 2_400_000] : [T0, T0 + 600_000],
        values: inf ? [item.value] : [item.value, item.value]
      }))
    }
  })
  return json(200, {
    totalCount: result.length,
    nextPageKey: null,
    resolution: inf ? 'Inf' : '10m',
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

/**
 * 4 localizaciones y 5 pasos o peticiones por tipo, en un orden que no es el esperado y
 * distinto en cada métrica (como en vivo).
 */
function fourAndFive(): Record<Kind, Partial<Record<Role, Item[]>>> {
  return {
    browser: {
      // De peor a mejor: 3 (50), 2 (87.5), 4 (99.2), 1 (100).
      availability: [
        { id: loc(1), name: 'Madrid', value: 100 },
        { id: loc(2), name: 'Fráncfort', value: 87.5 },
        { id: loc(3), name: 'Virginia', value: 50 },
        { id: loc(4), name: 'Tokio', value: 99.2 }
      ],
      duration: [
        { id: loc(4), name: 'Tokio', value: 4500 },
        { id: loc(3), name: 'Virginia', value: 6100 },
        { id: loc(1), name: 'Madrid', value: 4000 },
        { id: loc(2), name: 'Fráncfort', value: 5200 }
      ],
      // Total 5000 ms: pesos 24, 6, 50, 16 y 4 %. Por duración: 3, 1, 4, 2, 5.
      steps: [
        { id: step('browser', 1), name: 'Abrir la portada', value: 1200 },
        { id: step('browser', 2), name: 'Aceptar cookies', value: 300 },
        { id: step('browser', 3), name: 'Iniciar sesión', value: 2500 },
        { id: step('browser', 4), name: 'Buscar', value: 800 },
        { id: step('browser', 5), name: 'Cerrar sesión', value: 200 }
      ]
    },
    http: {
      // De peor a mejor: 2 (75), 4 (96), 3 (99.9), 1 (100).
      availability: [
        { id: loc(3), name: 'Virginia', value: 99.9 },
        { id: loc(1), name: 'Madrid', value: 100 },
        { id: loc(4), name: 'Tokio', value: 96 },
        { id: loc(2), name: 'Fráncfort', value: 75 }
      ],
      duration: [
        { id: loc(1), name: 'Madrid', value: 300 },
        { id: loc(2), name: 'Fráncfort', value: 410 },
        { id: loc(3), name: 'Virginia', value: 350 },
        { id: loc(4), name: 'Tokio', value: 280 }
      ],
      // Madrid sin fallos: su serie no llega.
      failed: [
        { id: loc(4), name: 'Tokio', value: 2 },
        { id: loc(2), name: 'Fráncfort', value: 6 },
        { id: loc(3), name: 'Virginia', value: 1 }
      ],
      // Total 200 ms: pesos 5, 50, 12.5, 25 y 7.5 %. Por duración: 2, 4, 3, 5, 1.
      steps: [
        { id: step('http', 1), name: 'GET /salud', value: 10 },
        { id: step('http', 2), name: 'POST /login', value: 100 },
        { id: step('http', 3), name: 'GET /perfil', value: 25 },
        { id: step('http', 4), name: 'GET /pedidos', value: 50 },
        { id: step('http', 5), name: 'POST /logout', value: 15 }
      ]
    }
  }
}

beforeEach(() => {
  requests = []
  failWith = null
  empty = false
  data = fourAndFive()

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
  expect(JSON.stringify(result)).not.toContain('SECRETODESGL')
  return result
}

interface Location {
  id: string
  name: string
  availability: number | null
  duration: number | null
  failed: number | null
}
interface Step {
  id: string
  name: string
  duration: number | null
  share: number | null
}
interface Breakdown {
  locations: Location[]
  steps: Step[] | null
}

async function breakdown(kind: Kind): Promise<Breakdown> {
  const result = await call({ environmentId: envId, entityId: ID[kind], timeRange: '2h' })
  expect(result.ok, JSON.stringify(result.error)).toBe(true)
  return result.data as Breakdown
}

const metricQueries = (): URL[] => requests.filter((u) => u.pathname === '/api/v2/metrics/query')

describe('CA1 (0023): las consultas llevan las métricas confirmadas, con su splitBy, el id y el rango', () => {
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

      // Solo /metrics/query.
      expect(requests.length).toBeGreaterThan(0)
      expect(metricQueries()).toHaveLength(requests.length)

      const wanted = confirmed(kind, ID[kind])
      const sent: string[] = []
      for (const url of metricQueries()) {
        const query = url.searchParams
        // El valor del rango (disponibilidad del rango y medias): resolution=Inf, sin fold.
        expect(query.get('resolution')).toBe('Inf')
        expect(query.get('metricSelector') ?? '').not.toContain(':fold(')
        expect(query.get('from')).toBe(expected.from)
        expect(query.get('to')).toBe(expected.to)
        const scope = scopeOf(query, kind)
        for (const expression of splitSelector(query.get('metricSelector') ?? '')) {
          // Cada expresión, EXACTAMENTE una de las confirmadas en vivo y con un ámbito probado.
          const match = wanted.find((c) => c.expression === expression)
          expect(match, `expresión no confirmada en vivo: ${expression}`).toBeDefined()
          expect(match?.scopes, `ámbito de ${expression}`).toContain(scope)
          sent.push(expression)
        }
      }
      // Todas las confirmadas de su tipo, una vez cada una (≤ 10 por consulta).
      expect([...sent].sort()).toEqual(wanted.map((c) => c.expression).sort())
      for (const url of metricQueries()) {
        expect(splitSelector(url.searchParams.get('metricSelector') ?? '').length).toBeLessThan(11)
      }
    })
  })

  it.each([
    'SYNTHETIC_TEST-0123456789ABCDEF")',
    'HTTP_CHECK-FEDCBA987654321',
    'HOST-0123456789ABCDEF',
    'SYNTHETIC_TEST-0123456789ABCDEF,entityId("HOST-0123456789ABCDEF")'
  ])('main valida el id antes de construir los selectores: %s no llega a Dynatrace', async (id) => {
    const result = await call({ environmentId: envId, entityId: id, timeRange: '2h' })
    expect(result.ok).toBe(false)
    expect(requests).toHaveLength(0)
  })
})

describe('CA2 (0023): 4 localizaciones y 5 pasos, ordenados y con el peso de cada paso', () => {
  it('browser: localizaciones de peor a mejor disponibilidad; pasos por duración, con su peso', async () => {
    const out = await breakdown('browser')
    expect(out.locations.map((l) => l.id)).toEqual([loc(3), loc(2), loc(4), loc(1)])
    // Cada valor casado por id (las series llegan en otro orden en cada métrica).
    expect(out.locations).toEqual([
      { id: loc(3), name: 'Virginia', availability: 50, duration: 6100, failed: null },
      { id: loc(2), name: 'Fráncfort', availability: 87.5, duration: 5200, failed: null },
      { id: loc(4), name: 'Tokio', availability: 99.2, duration: 4500, failed: null },
      { id: loc(1), name: 'Madrid', availability: 100, duration: 4000, failed: null }
    ])
    // Sin número de secuencia en la dimensión (paso 0): por duración, de mayor a menor.
    expect(out.steps?.map((s) => s.id)).toEqual([
      step('browser', 3),
      step('browser', 1),
      step('browser', 4),
      step('browser', 2),
      step('browser', 5)
    ])
    const expectedShares = [50, 24, 16, 6, 4]
    expect(out.steps?.map((s) => s.duration)).toEqual([2500, 1200, 800, 300, 200])
    out.steps?.forEach((s, i) => expect(s.share).toBeCloseTo(expectedShares[i] ?? NaN, 6))
    expect(out.steps?.[0]?.name).toBe('Iniciar sesión')
  })

  it('http: localizaciones de peor a mejor, con fallidas (0 si no llega su serie); peticiones con su peso', async () => {
    const out = await breakdown('http')
    expect(out.locations).toEqual([
      { id: loc(2), name: 'Fráncfort', availability: 75, duration: 410, failed: 6 },
      { id: loc(4), name: 'Tokio', availability: 96, duration: 280, failed: 2 },
      { id: loc(3), name: 'Virginia', availability: 99.9, duration: 350, failed: 1 },
      // Sin fallos: la serie de FAILURE no llega, pero la métrica existe → 0.
      { id: loc(1), name: 'Madrid', availability: 100, duration: 300, failed: 0 }
    ])
    expect(out.steps?.map((s) => s.id)).toEqual([
      step('http', 2),
      step('http', 4),
      step('http', 3),
      step('http', 5),
      step('http', 1)
    ])
    const expectedShares = [50, 25, 12.5, 7.5, 5]
    expect(out.steps?.map((s) => s.duration)).toEqual([100, 50, 25, 15, 10])
    out.steps?.forEach((s, i) => expect(s.share).toBeCloseTo(expectedShares[i] ?? NaN, 6))
    // Los pesos suman el 100 %.
    expect(out.steps?.reduce((sum, s) => sum + (s.share ?? 0), 0)).toBeCloseTo(100, 6)
  })

  it('una localización sin disponibilidad en el rango va al final, con availability null', async () => {
    data.browser.availability = [
      { id: loc(1), name: 'Madrid', value: null },
      { id: loc(2), name: 'Fráncfort', value: 87.5 },
      { id: loc(3), name: 'Virginia', value: 50 },
      { id: loc(4), name: 'Tokio', value: 99.2 }
    ]
    const result = await breakdown('browser')
    expect(result.locations.map((l) => l.id)).toEqual([loc(3), loc(2), loc(4), loc(1)])
    expect(result.locations[3]).toMatchObject({ availability: null, duration: 4000 })
  })

  it('nada de otros monitores: solo las localizaciones y los pasos del pedido', async () => {
    const result = await breakdown('browser')
    expect(result.locations.map((l) => l.id)).not.toContain(OTHER_LOCATION)
    expect(result.steps?.map((s) => s.id)).not.toContain(OTHER_STEP.browser)
  })
})

describe('CA3 (0023): nombres de dimensionMap o, si faltan, el id; steps según la métrica de pasos', () => {
  it.each(['browser', 'http'] as const)(
    '%s: sin el «.name» en dimensionMap, el nombre es el id',
    async (kind) => {
      const strip = (items: Item[] | undefined, id: string): Item[] =>
        (items ?? []).map((item) => (item.id === id ? { id: item.id, value: item.value } : item))
      // La localización 2 sin nombre en ninguna métrica; el paso 4, tampoco.
      for (const role of ['availability', 'duration', 'failed'] as const) {
        if (data[kind][role] !== undefined) data[kind][role] = strip(data[kind][role], loc(2))
      }
      data[kind].steps = strip(data[kind].steps, step(kind, 4))
      const result = await breakdown(kind)
      expect(result.locations.find((l) => l.id === loc(2))?.name).toBe(loc(2))
      expect(result.locations.find((l) => l.id === loc(1))?.name).toBe('Madrid')
      expect(result.steps?.find((s) => s.id === step(kind, 4))?.name).toBe(step(kind, 4))
      expect(result.steps?.find((s) => s.id === step(kind, 2))?.name).toBe(
        kind === 'browser' ? 'Aceptar cookies' : 'POST /login'
      )
    }
  )

  it.each(['browser', 'http'] as const)(
    '%s: la 0022 encontró métrica de pasos, así que steps es una lista (vacía sin series), no null',
    async (kind) => {
      empty = true
      const result = await breakdown(kind)
      expect(result.locations).toEqual([])
      expect(result.steps).toEqual([])
    }
  )
})

describe('CA4 (0023): errores de Dynatrace', () => {
  describe.each(['browser', 'http'] as const)('%s', (kind) => {
    it.each([400, 404])('un %i acaba en error con reason', async (status) => {
      failWith = { status, message: 'Mensaje de Dynatrace en la prueba' }
      const result = await call({ environmentId: envId, entityId: ID[kind], timeRange: '2h' })
      expect(result.ok).toBe(false)
      expect(result.error?.reason?.key, 'reason del error').toEqual(expect.any(String))
    })
  })
})
