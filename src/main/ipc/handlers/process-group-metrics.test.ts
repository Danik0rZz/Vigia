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
 * Ficha 0031: canal `entities:processGroupMetrics` (una entidad PROCESS_GROUP), con el cliente
 * de Dynatrace REAL sobre un fetch falso. Se comprueba qué se pide a /metrics/query y cómo llega
 * la respuesta a la interfaz.
 *
 * Usa SOLO las expresiones confirmadas en vivo en el paso 0 (tabla de "Verificación" de la
 * ficha) e imita lo observado:
 * - las métricas de la instancia (`builtin:tech.generic.cpu.usage` en %,
 *   `…mem.workingSetSize` en bytes y `…network.bytesRx`/`bytesTx` en bytes/s) solo tienen la
 *   dimensión `dt.entity.process_group_instance`: con `entityId("<grupo>")` no llega nada, y las
 *   instancias del grupo se eligen con
 *   `type("PROCESS_GROUP_INSTANCE"),fromRelationships.isInstanceOf(entityId("<grupo>"))`;
 * - el total del grupo es `:splitBy():sum` (punto a punto, la suma de las instancias); con
 *   `resolution=Inf`, la media del total en el rango;
 * - por instancia, `:parents:splitBy("dt.entity.process_group_instance","dt.entity.host"):avg:names`
 *   con `resolution=Inf` trae, en `dimensionMap`, el id y el nombre de la instancia y de su host;
 * - cada expresión vuelve en el orden pedido, con el `metricId` igual a la expresión; un grupo
 *   sin red llega sin series en esas métricas.
 *
 * Decisión del test-writer (delegada, refinable, anotada en la ficha): la CPU máxima del grupo es
 * el máximo de la serie del total (ninguna expresión con `Inf` da el máximo de la suma).
 */

const TRUSTED = { url: 'app://vigia/index.html', isMainFrame: true }
const TOKEN = `dt0c01.PUBLICAPRUEBA0000000000A.${'SECRETOGRUPO'.padEnd(64, 'X')}`
const BASE = 'https://abc12345.live.dynatrace.com'
const CHANNEL = 'entities:processGroupMetrics' as IpcChannel
/** Ids inventados, con el formato de Dynatrace. */
const GROUP_ID = 'PROCESS_GROUP-0123456789ABCDEF'
const PGI_A = 'PROCESS_GROUP_INSTANCE-00000000000000A1'
const PGI_B = 'PROCESS_GROUP_INSTANCE-00000000000000B2'
const PGI_C = 'PROCESS_GROUP_INSTANCE-00000000000000C3'
const HOST_A = 'HOST-00000000000000A1'
const HOST_B = 'HOST-00000000000000B2'
/** Momento fijo (epoch ms; la zona no importa aquí). */
const T0 = Date.parse('2026-10-03T08:00:00.000Z')
const T = [T0, T0 + 600_000, T0 + 1_200_000, T0 + 1_800_000]

const G = 'builtin:tech.generic.'
const CPU = `${G}cpu.usage`
const MEMORY = `${G}mem.workingSetSize`
const NETWORK_IN = `${G}network.bytesRx`
const NETWORK_OUT = `${G}network.bytesTx`
const BY_INSTANCE =
  ':parents:splitBy("dt.entity.process_group_instance","dt.entity.host"):avg:names'

/** El selector de las instancias del grupo confirmado en vivo. */
const GROUP_SELECTOR = `type("PROCESS_GROUP_INSTANCE"),fromRelationships.isInstanceOf(entityId("${GROUP_ID}"))`

/** Series del total del grupo: las expresiones exactas probadas en vivo, sin resolution. */
const SERIES_EXPRESSIONS = [
  `${CPU}:splitBy():sum`,
  `${MEMORY}:splitBy():sum`,
  `${NETWORK_IN}:splitBy():sum`,
  `${NETWORK_OUT}:splitBy():sum`
]
/** Marcadores del grupo y medias por instancia: las exactas probadas en vivo, con Inf. */
const MARKER_EXPRESSIONS = [
  ...SERIES_EXPRESSIONS,
  `${CPU}${BY_INSTANCE}`,
  `${MEMORY}${BY_INSTANCE}`
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
interface Instance {
  id: string
  name?: string
  hostId?: string
  hostName?: string
  value: number | null
}
/** Serie del total de cada expresión de series (las que no están llegan sin series). */
let seriesData: Record<string, Values>
/** Media del total en el rango, por expresión. */
let markerData: Record<string, number | null>
/** Medias por instancia, por expresión (cpu y memoria). */
let instanceData: Record<string, Instance[]>
interface Extras {
  empty?: 'result' | 'data'
}
let seriesExtras: Extras
let markerExtras: Extras
let failWith: { status: number; message: string } | null

interface Item {
  dimensionMap: Record<string, string>
  dimensions: string[]
  timestamps: number[]
  values: Values
}

function dataOf(expression: string, marker: boolean): Item[] {
  if (expression in instanceData) {
    if (!marker) return []
    return (instanceData[expression] ?? []).map((instance) => {
      const dimensionMap: Record<string, string> = {
        'dt.entity.process_group_instance': instance.id
      }
      if (instance.name !== undefined)
        dimensionMap['dt.entity.process_group_instance.name'] = instance.name
      if (instance.hostId !== undefined) dimensionMap['dt.entity.host'] = instance.hostId
      if (instance.hostName !== undefined) dimensionMap['dt.entity.host.name'] = instance.hostName
      return {
        dimensionMap,
        dimensions: [instance.id, instance.hostId ?? ''],
        timestamps: [T0 + 2_400_000],
        values: [instance.value]
      }
    })
  }
  // Total del grupo: sin dimensiones (splitBy()).
  if (marker) {
    return expression in markerData
      ? [
          {
            dimensionMap: {},
            dimensions: [],
            timestamps: [T0 + 2_400_000],
            values: [markerData[expression] ?? null]
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
  if (query.get('resolution') === 'Inf' && selector.includes(':fold(')) {
    return json(400, { error: { code: 400, message: 'fold no admite resolution Inf' } })
  }
  const marker = isMarkerQuery(query)
  const extras = marker ? markerExtras : seriesExtras
  // Como en vivo: con entityId("<grupo>") estas métricas no traen nada.
  const scoped = query.get('entitySelector') === GROUP_SELECTOR
  const result =
    extras.empty === 'result' || !scoped
      ? []
      : splitSelector(selector).map((expression) => ({
          metricId: expression,
          dataPointCountRatio: 0.005,
          dimensionCountRatio: 0.005,
          data: extras.empty === 'data' ? [] : dataOf(expression, marker)
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
  // Con null en medio y al final, como en vivo. El total de CPU pasa de 100 (suma de instancias).
  seriesData = {
    [`${CPU}:splitBy():sum`]: [42.5, null, 130, null],
    [`${MEMORY}:splitBy():sum`]: [750_000_000, null, 786_432_000, null],
    [`${NETWORK_IN}:splitBy():sum`]: [3_000, null, 4_096.5, null],
    [`${NETWORK_OUT}:splitBy():sum`]: [600, 900, null, null]
  }
  // Distintos de lo que saldría de las series: las medias salen de su consulta.
  markerData = {
    [`${CPU}:splitBy():sum`]: 81.25,
    [`${MEMORY}:splitBy():sum`]: 760_000_000,
    [`${NETWORK_IN}:splitBy():sum`]: 3_600,
    [`${NETWORK_OUT}:splitBy():sum`]: 750
  }
  // En el orden en que las da la API (no por CPU). C no tiene memoria; B no trae su host.
  instanceData = {
    [`${CPU}${BY_INSTANCE}`]: [
      { id: PGI_A, name: 'Instancia A', hostId: HOST_A, hostName: 'Host A', value: 12.5 },
      { id: PGI_B, name: 'Instancia B', value: 55 },
      { id: PGI_C, name: 'Instancia C', hostId: HOST_B, hostName: 'Host B', value: 30.25 }
    ],
    [`${MEMORY}${BY_INSTANCE}`]: [
      { id: PGI_A, name: 'Instancia A', hostId: HOST_A, hostName: 'Host A', value: 250_000_000 },
      { id: PGI_B, name: 'Instancia B', value: 510_000_000 }
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
  expect(JSON.stringify(result)).not.toContain('SECRETOGRUPO')
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
const base = { entityId: GROUP_ID, timeRange: '2h' as const }

describe('CA3 (0031): las consultas llevan las métricas, el selector confirmado, el id y el rango', () => {
  it.each([
    ['relativo (2h)', '2h' as const, { from: 'now-2h', to: null }],
    [
      'absoluto',
      { from: '2026-10-01T08:00:00.000Z', to: '2026-10-01T10:00:00.000Z' },
      { from: '2026-10-01T08:00:00.000Z', to: '2026-10-01T10:00:00.000Z' }
    ]
  ])('rango %s', async (_case, timeRange, expected) => {
    const result = await call({ environmentId: envId, entityId: GROUP_ID, timeRange })
    expect(result.ok, JSON.stringify(result.error)).toBe(true)

    // Exactamente dos peticiones, y las dos a /metrics/query: series y marcadores con las
    // instancias (nombres y hosts llegan en dimensionMap; no hace falta /entities).
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

    // Acotadas a las instancias del grupo pedido (selector del paso 0) y con el rango.
    for (const url of [seriesUrl, markersUrl]) {
      expect(url?.searchParams.get('entitySelector')).toBe(GROUP_SELECTOR)
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

/**
 * CA4. Los cuatro papeles tienen métrica (paso 0): un papel sin datos llega con series vacías,
 * no `null`. Los `null` son los de los totales sin dato y los de cada instancia (CPU o memoria
 * sin dato, host que no llega en dimensionMap).
 */
describe('CA4 (0031): series, totales e instancias del grupo', () => {
  it('series del total del grupo por papel, con los null conservados', async () => {
    const result = await call({ environmentId: envId, ...base })
    expect(result.ok, JSON.stringify(result.error)).toBe(true)
    expect(result.data).toMatchObject({
      // La de la consulta de series (no la de los marcadores, Inf).
      resolution: '10m',
      series: {
        // %, bytes y bytes/s tal cual, sin convertir (la CPU del grupo puede pasar de 100).
        cpu: series([42.5, null, 130, null]),
        memory: series([750_000_000, null, 786_432_000, null]),
        network: {
          in: series([3_000, null, 4_096.5, null]),
          out: series([600, 900, null, null])
        }
      },
      warnings: [],
      partial: []
    })
  })

  it('totales: CPU media (de su consulta) y máxima (de la serie), memoria media y red media', async () => {
    const result = await call({ environmentId: envId, ...base })
    expect(result.ok, JSON.stringify(result.error)).toBe(true)
    expect((result.data as { totals: unknown }).totals).toEqual({
      cpu: { avg: 81.25, max: 130 },
      memory: { avg: 760_000_000 },
      network: { in: 3_600, out: 750 }
    })
  })

  it('instancias ordenadas por CPU media, con nombre, host, CPU y memoria media y total', async () => {
    const result = await call({ environmentId: envId, ...base })
    expect(result.ok, JSON.stringify(result.error)).toBe(true)
    expect((result.data as { instances: unknown }).instances).toEqual({
      items: [
        // Sin host en dimensionMap: hostId y hostName a null.
        {
          id: PGI_B,
          name: 'Instancia B',
          hostId: null,
          hostName: null,
          cpu: 55,
          memory: 510_000_000
        },
        // Sin serie de memoria: memory a null.
        {
          id: PGI_C,
          name: 'Instancia C',
          hostId: HOST_B,
          hostName: 'Host B',
          cpu: 30.25,
          memory: null
        },
        {
          id: PGI_A,
          name: 'Instancia A',
          hostId: HOST_A,
          hostName: 'Host A',
          cpu: 12.5,
          memory: 250_000_000
        }
      ],
      total: 3
    })
  })

  it('una instancia solo con memoria va al final con CPU null, y sin nombre lleva su id', async () => {
    instanceData[`${MEMORY}${BY_INSTANCE}`]!.push({ id: PGI_C.replace('C3', 'D4'), value: 1_000 })
    instanceData[`${CPU}${BY_INSTANCE}`]![0]!.value = null
    const result = await call({ environmentId: envId, ...base })
    expect(result.ok, JSON.stringify(result.error)).toBe(true)
    const instances = (result.data as { instances: { items: { id: string }[]; total: number } })
      .instances
    expect(instances.total).toBe(4)
    expect(instances.items.map((item) => item.id).slice(0, 2)).toEqual([PGI_B, PGI_C])
    // Las dos sin CPU, detrás de las que la tienen.
    expect(instances.items.slice(2)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: PGI_A, cpu: null, memory: 250_000_000 }),
        {
          id: 'PROCESS_GROUP_INSTANCE-00000000000000D4',
          name: 'PROCESS_GROUP_INSTANCE-00000000000000D4',
          hostId: null,
          hostName: null,
          cpu: null,
          memory: 1_000
        }
      ])
    )
  })

  it('un grupo sin datos de red: red con series vacías (no null) y sus medias a null', async () => {
    delete seriesData[`${NETWORK_IN}:splitBy():sum`]
    delete seriesData[`${NETWORK_OUT}:splitBy():sum`]
    delete markerData[`${NETWORK_IN}:splitBy():sum`]
    delete markerData[`${NETWORK_OUT}:splitBy():sum`]
    const result = await call({ environmentId: envId, ...base })
    expect(result.ok, JSON.stringify(result.error)).toBe(true)
    expect(result.data).toMatchObject({
      series: { cpu: series([42.5, null, 130, null]), network: { in: none, out: none } },
      warnings: [],
      partial: []
    })
    expect((result.data as { totals: unknown }).totals).toEqual({
      cpu: { avg: 81.25, max: 130 },
      memory: { avg: 760_000_000 },
      network: { in: null, out: null }
    })
  })

  it('una media sin dato en el rango y una serie de CPU sin ningún valor: totales a null', async () => {
    markerData[`${MEMORY}:splitBy():sum`] = null
    seriesData[`${CPU}:splitBy():sum`] = [null, null, null, null]
    const result = await call({ environmentId: envId, ...base })
    expect(result.ok, JSON.stringify(result.error)).toBe(true)
    expect((result.data as { totals: unknown }).totals).toEqual({
      cpu: { avg: 81.25, max: null },
      memory: { avg: null },
      network: { in: 3_600, out: 750 }
    })
  })
})

describe('CA5 (0031): errores de Dynatrace y grupo sin datos', () => {
  it.each([400, 404])('un %i acaba en error con reason', async (status) => {
    failWith = { status, message: 'Mensaje de Dynatrace en la prueba' }
    const result = await call({ environmentId: envId, ...base })
    expect(result.ok).toBe(false)
    expect(result.error?.reason?.key, 'reason del error').toEqual(expect.any(String))
  })

  it.each([
    ['sin resultados (result vacío)', 'result' as const],
    ['resultados sin series (data vacío)', 'data' as const]
  ])('%s: series e instancias vacías y totales a null, sin error', async (_case, empty) => {
    seriesExtras = { empty }
    markerExtras = { empty }
    const result = await call({ environmentId: envId, ...base })
    expect(result.ok, JSON.stringify(result.error)).toBe(true)
    expect(result.data).toMatchObject({
      series: { cpu: none, memory: none, network: { in: none, out: none } },
      instances: { items: [], total: 0 }
    })
    expect((result.data as { totals: unknown }).totals).toEqual({
      cpu: { avg: null, max: null },
      memory: { avg: null },
      network: { in: null, out: null }
    })
  })
})
