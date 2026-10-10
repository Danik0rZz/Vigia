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
 * Fichas 0031 y 0050: canales `entities:processGroupMetrics` y `entities:processGroupInstances`
 * (una entidad PROCESS_GROUP), con el cliente de Dynatrace REAL sobre un fetch falso. Se
 * comprueba qué se pide a /metrics/query y a /entities y cómo llega la respuesta a la interfaz.
 *
 * Usa SOLO las expresiones confirmadas en vivo (paso 0 de la 0031 y de la 0050, en la
 * "Verificación" de cada ficha) e imita lo observado:
 * - las métricas de la instancia (`builtin:tech.generic.cpu.usage` en %,
 *   `…mem.workingSetSize` en bytes y `…network.bytesRx`/`bytesTx` en bytes/s) solo tienen la
 *   dimensión `dt.entity.process_group_instance`: con `entityId("<grupo>")` no llega nada, y las
 *   instancias del grupo se eligen con
 *   `type("PROCESS_GROUP_INSTANCE"),fromRelationships.isInstanceOf(entityId("<grupo>"))`;
 * - el total del grupo es `:splitBy():sum` (punto a punto, la suma de las instancias); con
 *   `resolution=Inf`, la media del total en el rango;
 * - por instancia, `:parents:splitBy("dt.entity.process_group_instance","dt.entity.host"):avg:names`
 *   con `resolution=Inf` trae, en `dimensionMap`, el id y el nombre de la instancia y de su host,
 *   en un orden que no es el de CPU;
 * - 0050: con `:sort(value(avg,descending))` detrás, llegan de más a menos CPU, y con
 *   `:limit(20)` además, solo las 20 primeras (las de más CPU, no unas cualesquiera);
 * - 0050: `GET /entities` con el selector del grupo y `pageSize=1` trae `totalCount`, el total
 *   real de instancias (igual a las series de CPU cuando no hay recorte);
 * - cada expresión vuelve en el orden pedido, con el `metricId` igual a la expresión; un grupo
 *   sin red llega sin series en esas métricas.
 *
 * Decisiones del test-writer (delegadas, refinables, anotadas en la ficha):
 * - 0031: la CPU máxima del grupo es el máximo de la serie del total.
 * - 0050: la memoria de las 20 sale de la memoria de TODAS en la misma consulta de marcadores,
 *   casada por id (la forma con menos peticiones; filtrar por ids también funciona en vivo, pero
 *   es una petición más). La consulta a /entities lleva el mismo `from`/`to` que las métricas.
 * - 0050: sin `totalCount`, `total` es el número de instancias distintas recibidas (las de CPU o
 *   las de memoria).
 * - 0050: `entities:processGroupInstances` pide `<CPU por instancia>:sort(value(avg,descending))`
 *   y `<memoria por instancia>` con Inf (sin totales) y devuelve `{ items, total, truncated }`,
 *   con los `items` de la misma forma que los de `entities:processGroupMetrics`.
 */

const TRUSTED = { url: 'app://vigia/index.html', isMainFrame: true }
const TOKEN = `dt0c01.PUBLICAPRUEBA0000000000A.${'SECRETOGRUPO'.padEnd(64, 'X')}`
const BASE = 'https://abc12345.live.dynatrace.com'
const CHANNEL = 'entities:processGroupMetrics' as IpcChannel
const INSTANCES_CHANNEL = 'entities:processGroupInstances' as IpcChannel
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
const SORT = ':sort(value(avg,descending))'

/** El selector de las instancias del grupo confirmado en vivo. */
const GROUP_SELECTOR = `type("PROCESS_GROUP_INSTANCE"),fromRelationships.isInstanceOf(entityId("${GROUP_ID}"))`

/** Series del total del grupo: las expresiones exactas probadas en vivo, sin resolution. */
const SERIES_EXPRESSIONS = [
  `${CPU}:splitBy():sum`,
  `${MEMORY}:splitBy():sum`,
  `${NETWORK_IN}:splitBy():sum`,
  `${NETWORK_OUT}:splitBy():sum`
]
/** 0050: CPU de las 20 de más CPU y memoria de todas (probadas en vivo, con Inf). */
const TOP_CPU = `${CPU}${BY_INSTANCE}${SORT}:limit(20)`
const ALL_MEMORY = `${MEMORY}${BY_INSTANCE}`
/** Marcadores del grupo y medias por instancia: las exactas probadas en vivo, con Inf. */
const MARKER_EXPRESSIONS = [...SERIES_EXPRESSIONS, TOP_CPU, ALL_MEMORY]
/** 0050: la lista completa (canal entities:processGroupInstances), con Inf. */
const ALL_CPU_SORTED = `${CPU}${BY_INSTANCE}${SORT}`
const INSTANCES_EXPRESSIONS = [ALL_CPU_SORTED, ALL_MEMORY]

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
/**
 * Una instancia del grupo, en el orden en que la da la API. `cpu` o `memory` sin definir: esa
 * expresión no trae su serie; null: la trae con el valor null.
 */
interface Instance {
  id: string
  name?: string
  hostId?: string
  hostName?: string
  cpu?: number | null
  memory?: number | null
}
/** Serie del total de cada expresión de series (las que no están llegan sin series). */
let seriesData: Record<string, Values>
/** Media del total en el rango, por expresión. */
let markerData: Record<string, number | null>
/** Las instancias del grupo, en el orden de la API (no por CPU). */
let instances: Instance[]
interface Extras {
  empty?: 'result' | 'data'
}
let seriesExtras: Extras
let markerExtras: Extras
let failWith: { status: number; message: string } | null
/** 0050: las expresiones por instancia llegan recortadas a estas series (ratio > 1). */
let perInstanceCut: number | null
/** 0050: totalCount de /entities (null: el número de instancias). */
let entitiesTotal: number | null
/** 0050: /entities falla con este código (403 sin entities.read, 500…). */
let entitiesFail: number | null

interface Item {
  dimensionMap: Record<string, string>
  dimensions: string[]
  timestamps: number[]
  values: Values
}

const PER_INSTANCE =
  /^(.+?):parents:splitBy\("dt\.entity\.process_group_instance","dt\.entity\.host"\):avg:names(:sort\(value\(avg,descending\)\))?(?::limit\((\d+)\))?$/

/** De más a menos por `role`; los null, al final. */
function byValue(role: 'cpu' | 'memory'): (a: Instance, b: Instance) => number {
  return (a, b) => {
    const x = a[role] ?? null
    const y = b[role] ?? null
    if (x === null) return y === null ? 0 : 1
    if (y === null) return -1
    return y - x
  }
}

/** Series por instancia de una expresión con Inf, o null si no es por instancia. */
function perInstanceData(expression: string): Item[] | null {
  const match = PER_INSTANCE.exec(expression)
  if (match === null) return null
  const role = match[1] === CPU ? 'cpu' : match[1] === MEMORY ? 'memory' : null
  if (role === null) return []
  let list = instances.filter((instance) => instance[role] !== undefined)
  if (match[2] !== undefined) list = list.slice().sort(byValue(role))
  if (match[3] !== undefined) list = list.slice(0, Number(match[3]))
  if (perInstanceCut !== null) list = list.slice(0, perInstanceCut)
  return list.map((instance) => {
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
      values: [instance[role] ?? null]
    }
  })
}

function dataOf(expression: string, marker: boolean): Item[] {
  if (PER_INSTANCE.test(expression)) return marker ? (perInstanceData(expression) ?? []) : []
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
      : splitSelector(selector).map((expression) => {
          const cut = perInstanceCut !== null && PER_INSTANCE.test(expression)
          return {
            metricId: expression,
            dataPointCountRatio: 0.005,
            dimensionCountRatio: cut ? 1.5 : 0.005,
            data: extras.empty === 'data' ? [] : dataOf(expression, marker)
          }
        })
  return json(200, {
    totalCount: result.length,
    nextPageKey: null,
    resolution: marker ? 'Inf' : '10m',
    result
  })
}

/** 0050: GET /entities con el selector del grupo (totalCount, la primera página). */
function entitiesResponse(query: URLSearchParams): Response {
  if (entitiesFail !== null) {
    return json(entitiesFail, {
      error: { code: entitiesFail, message: 'Entidades no disponibles' }
    })
  }
  if (query.get('entitySelector') !== GROUP_SELECTOR) {
    return json(400, { error: { code: 400, message: 'entitySelector no válido' } })
  }
  const totalCount = entitiesTotal ?? instances.length
  const pageSize = Number(query.get('pageSize') ?? '50')
  const entities = instances.slice(0, Math.min(pageSize, totalCount)).map((instance) => ({
    entityId: instance.id,
    displayName: instance.name ?? instance.id,
    type: 'PROCESS_GROUP_INSTANCE'
  }))
  return json(200, {
    totalCount,
    pageSize,
    nextPageKey: totalCount > entities.length ? 'AQAAABQBAAAABQ==' : null,
    entities
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
  if (url.pathname === '/api/v2/entities') return entitiesResponse(url.searchParams)
  return json(404, { error: { code: 404, message: 'No existe' } })
})

/** Hexadecimal de dos cifras, para ids inventados. */
const hex = (n: number): string => n.toString(16).toUpperCase().padStart(2, '0')

/**
 * 0050: `n` instancias inventadas en un orden que no es el de CPU (CPU distintas: `(i·7) mod n`
 * es una permutación si n no es múltiplo de 7), cada una con su host y su memoria.
 */
function manyInstances(n: number): Instance[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `PROCESS_GROUP_INSTANCE-00000000000010${hex(i + 1)}`,
    name: `Instancia ${i + 1}`,
    hostId: `HOST-00000000000010${hex(i + 1)}`,
    hostName: `Host ${i + 1}`,
    cpu: ((i * 7) % n) + 0.5,
    memory: 1_000_000 * (i + 1)
  }))
}

/** Lo que espera la interfaz de una instancia del fake. */
const itemOf = (instance: Instance): Record<string, unknown> => ({
  id: instance.id,
  name: instance.name ?? instance.id,
  hostId: instance.hostId ?? null,
  hostName: instance.hostName ?? null,
  cpu: instance.cpu ?? null,
  memory: instance.memory ?? null
})

beforeEach(() => {
  requests = []
  failWith = null
  seriesExtras = {}
  markerExtras = {}
  perInstanceCut = null
  entitiesTotal = null
  entitiesFail = null
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
  instances = [
    {
      id: PGI_A,
      name: 'Instancia A',
      hostId: HOST_A,
      hostName: 'Host A',
      cpu: 12.5,
      memory: 250_000_000
    },
    { id: PGI_B, name: 'Instancia B', cpu: 55, memory: 510_000_000 },
    { id: PGI_C, name: 'Instancia C', hostId: HOST_B, hostName: 'Host B', cpu: 30.25 }
  ]

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

async function call(input: unknown, channel: IpcChannel = CHANNEL): Promise<Envelope> {
  const implementation = (handlers as Record<string, unknown>)[channel] as IpcImplementation<
    typeof channel
  >
  expect(implementation, `implementación de ${channel}`).toBeTypeOf('function')
  const result = (await createIpcHandler(channel, implementation, deps)(TRUSTED, input)) as Envelope
  expect(JSON.stringify(result)).not.toContain('SECRETOGRUPO')
  return result
}

const metricQueries = (): URL[] => requests.filter((u) => u.pathname === '/api/v2/metrics/query')
const entityQueries = (): URL[] => requests.filter((u) => u.pathname === '/api/v2/entities')
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

interface InstancesOut {
  items: { id: string; cpu: number | null; memory: number | null }[]
  total: number
  totalKnown?: boolean
  truncated?: boolean
}
const instancesOf = (result: Envelope): InstancesOut =>
  (result.data as { instances: InstancesOut }).instances

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

    // Dos a /metrics/query (series y marcadores con las instancias: nombres y hosts llegan en
    // dimensionMap) y, desde la 0050, una a /entities para el total real.
    expect(metricQueries()).toHaveLength(2)
    expect(entityQueries()).toHaveLength(1)
    expect(requests).toHaveLength(3)
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
    for (const url of [seriesUrl, markersUrl, entityQueries()[0]]) {
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
    expect(instancesOf(result)).toEqual({
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
      // 0050: de totalCount (aquí, las mismas 3).
      total: 3,
      totalKnown: true
    })
  })

  it('una instancia solo con memoria va al final con CPU null, y sin nombre lleva su id', async () => {
    instances.push({ id: PGI_C.replace('C3', 'D4'), memory: 1_000 })
    instances[0]!.cpu = null
    const result = await call({ environmentId: envId, ...base })
    expect(result.ok, JSON.stringify(result.error)).toBe(true)
    const out = instancesOf(result)
    expect(out.total).toBe(4)
    expect(out.items.map((item) => item.id).slice(0, 2)).toEqual([PGI_B, PGI_C])
    // Las dos sin CPU, detrás de las que la tienen.
    expect(out.items.slice(2)).toEqual(
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
    // Un grupo sin instancias: /entities tampoco cuenta ninguna.
    entitiesTotal = 0
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

describe('CA2 (0050): la CPU por instancia lleva :sort y :limit(20) y salen las 20 de más CPU', () => {
  it('la consulta de marcadores pide la CPU ordenada y limitada a 20, y la memoria de todas', async () => {
    instances = manyInstances(30)
    const result = await call({ environmentId: envId, ...base })
    expect(result.ok, JSON.stringify(result.error)).toBe(true)
    const markers = expressionsOf(markerQuery())
    expect(markerQuery()?.searchParams.get('resolution')).toBe('Inf')
    // La de CPU por instancia, con :sort de más a menos y :limit(20), la probada en vivo.
    expect(markers).toContain(TOP_CPU)
    // Sin la CPU por instancia de la 0031 (sin ordenar ni limitar).
    expect(markers).not.toContain(`${CPU}${BY_INSTANCE}`)
    expect(markers).toContain(ALL_MEMORY)
  })

  it('con 30 instancias, la salida trae las 20 de más CPU, en orden, con su memoria y su host', async () => {
    instances = manyInstances(30)
    const result = await call({ environmentId: envId, ...base })
    expect(result.ok, JSON.stringify(result.error)).toBe(true)
    const expected = instances.slice().sort(byValue('cpu')).slice(0, 20).map(itemOf)
    const out = instancesOf(result)
    expect(out.items).toHaveLength(20)
    // Ni una de las 10 de menos CPU, aunque su memoria también llegue.
    expect(out.items).toEqual(expected)
    expect(out.total).toBe(30)
    expect(out.totalKnown).toBe(true)
  })

  it('con menos de 20 instancias, todas, de más a menos CPU', async () => {
    instances = manyInstances(13)
    const result = await call({ environmentId: envId, ...base })
    expect(result.ok, JSON.stringify(result.error)).toBe(true)
    expect(instancesOf(result).items).toEqual(instances.slice().sort(byValue('cpu')).map(itemOf))
  })
})

describe('CA3 (0050): el total sale de totalCount; sin él, totalKnown false y el número recibido', () => {
  it('pide /entities con el selector del grupo y pageSize=1, y total es su totalCount', async () => {
    instances = manyInstances(30)
    // Más instancias que las recibidas (un grupo grande): manda totalCount.
    entitiesTotal = 640
    const result = await call({ environmentId: envId, ...base })
    expect(result.ok, JSON.stringify(result.error)).toBe(true)
    expect(entityQueries()).toHaveLength(1)
    const query = entityQueries()[0]?.searchParams
    expect(query?.get('entitySelector')).toBe(GROUP_SELECTOR)
    expect(query?.get('pageSize')).toBe('1')
    expect(instancesOf(result)).toMatchObject({ total: 640, totalKnown: true })
    expect(instancesOf(result).items).toHaveLength(20)
  })

  it.each([
    ['403 (sin entities.read)', 403],
    ['un error de Dynatrace (500)', 500]
  ])(
    'con %s en /entities: el canal responde, totalKnown false y total el número recibido',
    async (_case, status) => {
      instances = manyInstances(25)
      entitiesFail = status
      const result = await call({ environmentId: envId, ...base })
      expect(result.ok, JSON.stringify(result.error)).toBe(true)
      // Recibidas: 20 con CPU (las de más) y 25 con memoria; distintas, 25.
      expect(instancesOf(result)).toMatchObject({ total: 25, totalKnown: false })
      expect(instancesOf(result).items).toHaveLength(20)
    }
  )
})

describe('CA4 (0050): entities:processGroupInstances, la lista completa ordenada y si está recortada', () => {
  it.each([
    ['relativo (2h)', '2h' as const, { from: 'now-2h', to: null }],
    [
      'absoluto',
      { from: '2026-10-01T08:00:00.000Z', to: '2026-10-01T10:00:00.000Z' },
      { from: '2026-10-01T08:00:00.000Z', to: '2026-10-01T10:00:00.000Z' }
    ]
  ])(
    'rango %s: una consulta Inf con la CPU ordenada y la memoria, y una a /entities',
    async (_case, timeRange, expected) => {
      instances = manyInstances(30)
      const result = await call(
        { environmentId: envId, entityId: GROUP_ID, timeRange },
        INSTANCES_CHANNEL
      )
      expect(result.ok, JSON.stringify(result.error)).toBe(true)
      expect(metricQueries()).toHaveLength(1)
      expect(entityQueries()).toHaveLength(1)
      const metrics = metricQueries()[0]
      expect(metrics?.searchParams.get('resolution')).toBe('Inf')
      expect([...expressionsOf(metrics)].sort()).toEqual([...INSTANCES_EXPRESSIONS].sort())
      expect(entityQueries()[0]?.searchParams.get('pageSize')).toBe('1')
      for (const url of [metrics, entityQueries()[0]]) {
        expect(url?.searchParams.get('entitySelector')).toBe(GROUP_SELECTOR)
        expect(url?.searchParams.get('from')).toBe(expected.from)
        expect(url?.searchParams.get('to')).toBe(expected.to)
      }
    }
  )

  it('devuelve todas las instancias de más a menos CPU, con host y memoria, y truncated false', async () => {
    instances = manyInstances(30)
    const result = await call({ environmentId: envId, ...base }, INSTANCES_CHANNEL)
    expect(result.ok, JSON.stringify(result.error)).toBe(true)
    expect(result.data).toMatchObject({
      items: instances.slice().sort(byValue('cpu')).map(itemOf),
      total: 30,
      truncated: false
    })
  })

  it('truncated true cuando la API recorta (dimensionCountRatio > 1)', async () => {
    instances = manyInstances(30)
    perInstanceCut = 30
    const result = await call({ environmentId: envId, ...base }, INSTANCES_CHANNEL)
    expect(result.ok, JSON.stringify(result.error)).toBe(true)
    expect(result.data).toMatchObject({ total: 30, truncated: true })
    expect((result.data as InstancesOut).items).toHaveLength(30)
  })

  it('truncated true cuando llegan menos instancias que el total real (totalCount)', async () => {
    instances = manyInstances(30)
    entitiesTotal = 640
    const result = await call({ environmentId: envId, ...base }, INSTANCES_CHANNEL)
    expect(result.ok, JSON.stringify(result.error)).toBe(true)
    expect(result.data).toMatchObject({ total: 640, truncated: true })
    expect((result.data as InstancesOut).items).toEqual(
      instances.slice().sort(byValue('cpu')).map(itemOf)
    )
  })

  it('solo acepta un PROCESS_GROUP como entityId (main construye el selector)', async () => {
    const result = await call(
      { environmentId: envId, entityId: 'HOST-0123456789ABCDEF', timeRange: '2h' },
      INSTANCES_CHANNEL
    )
    expect(result.ok).toBe(false)
    expect(requests).toHaveLength(0)
  })
})

describe('CA5 (0050): un 400 o un 404 de las métricas acaba en error con reason, en los dos canales', () => {
  it.each([
    [CHANNEL, 400],
    [CHANNEL, 404],
    [INSTANCES_CHANNEL, 400],
    [INSTANCES_CHANNEL, 404]
  ])('%s con un %i', async (channel, status) => {
    instances = manyInstances(30)
    failWith = { status, message: 'Mensaje de Dynatrace en la prueba' }
    const result = await call({ environmentId: envId, ...base }, channel)
    expect(result.ok).toBe(false)
    expect(result.error?.reason?.key, 'reason del error').toEqual(expect.any(String))
  })
})
