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
 * Ficha 0042: canal `entities:hostEvents` (los eventos de un HOST y de lo que corre en él), con el
 * cliente de Dynatrace REAL sobre un fetch falso. Se comprueba qué se pide y cómo sale.
 *
 * La forma elegida en el paso 0 (`host-events-explore.live.test.ts`, en la "Verificación" de la
 * ficha): con ids de tipos mezclados, `GET /events?eventSelector=entityId("<host>","<id-2>",…)`
 * da 200 y trae exactamente los mismos eventos que una consulta por tipo con `entitySelector` y la
 * relación (6 o 7 peticiones). Con la forma de la ficha bastan dos peticiones:
 * 1. `GET /entities/{host}` con `+fromRelationships,+toRelationships`;
 * 2. `GET /events` con `eventSelector=entityId(...)`, el host y los ids de sus relaciones:
 *    `to:isProcessOf` (procesos), `to:isDiskOf` (discos), `to:isNetworkInterfaceOf` (interfaces
 *    de red), `to:isCgiOfHost` (grupos de contenedores), `to:isNodeOfHost` (nodo de Kubernetes;
 *    en vivo llega por esta relación, no por `runsOn`) y `from:runsOn` (la máquina virtual).
 *    `to:runsOn` (el PROCESS_GROUP), `to:runsOnHost` (servicios), `from:isInstanceOf` (grupo de
 *    hosts), `isNetworkClientOfHost`, `isSiteOf`… no entran (decisión del test-writer, refinable).
 *
 * En vivo, un `eventSelector` de 9.898 caracteres (250 ids) dio 200 y uno de 10.485 dio 400: si los
 * ids no caben, se reparten en varias consultas, cada una por debajo de `MAX_SELECTOR` (el falso
 * da 400 por encima, como en vivo), y se juntan. El `optionalEntitySelector` de la interfaz de
 * Dynatrace no está en la OpenAPI y no se usa.
 *
 * Forma de un evento en vivo: `eventType`, `title`, `status` (`OPEN`/`CLOSED`), `startTime` y
 * `endTime` en ms (`-1` en los activos; la OpenAPI dice `null`), `entityId` como
 * `{ entityId: { id, type }, name }`. La respuesta llega ordenada del más reciente al más antiguo.
 *
 * Salida (decisión del test-writer, refinable; en la ficha): `{ events, totalCount }`. `events`,
 * los 20 más recientes por `startTime` (descendente), cada uno con `eventType`, `title`, `status`,
 * `startTime`, `endTime` (null si está activo) y `entity: { id, name, type }` (`name` null si no
 * llega). `totalCount`, el de Dynatrace (la suma, si hubo varias consultas).
 */

const TRUSTED = { url: 'app://vigia/index.html', isMainFrame: true }
const TOKEN = `dt0c01.PUBLICAPRUEBA0000000000A.${'SECRETOEVENTOS'.padEnd(64, 'X')}`
const BASE = 'https://abc12345.live.dynatrace.com'
const CHANNEL = 'entities:hostEvents' as IpcChannel
/** Por encima de esto el falso da 400 (en vivo: 9.898 dio 200 y 10.485, 400). */
const MAX_SELECTOR = 9800

/** Ids inventados, con el formato de Dynatrace. */
const hex = (n: number): string => n.toString(16).toUpperCase().padStart(16, '0')
const HOST_ID = 'HOST-0123456789ABCDEF'
const PGI_1 = `PROCESS_GROUP_INSTANCE-${hex(0x4201)}`
const PGI_2 = `PROCESS_GROUP_INSTANCE-${hex(0x4202)}`
const DISK = `DISK-${hex(0x4203)}`
const NIC = `NETWORK_INTERFACE-${hex(0x4204)}`
const CGI = `CONTAINER_GROUP_INSTANCE-${hex(0x4205)}`
const K8S_NODE = `KUBERNETES_NODE-${hex(0x4206)}`
const VM = `EC2_INSTANCE-${hex(0x4207)}`
/** Relaciones que NO entran. */
const PG = `PROCESS_GROUP-${hex(0x4208)}`
const SERVICE = `SERVICE-${hex(0x4209)}`
const HOST_GROUP = `HOST_GROUP-${hex(0x420a)}`
const PEER = `HOST-${hex(0x420b)}`
const SITE = `GEOLOC_SITE-${hex(0x420c)}`

const EXPECTED_IDS = [HOST_ID, PGI_1, PGI_2, DISK, NIC, CGI, K8S_NODE, VM]
const EXCLUDED_IDS = [PG, SERVICE, HOST_GROUP, PEER, SITE]

const TYPE_OF: Record<string, string> = Object.fromEntries(
  [...EXPECTED_IDS, ...EXCLUDED_IDS].map((id) => [id, id.slice(0, id.lastIndexOf('-'))])
)
const NAME_OF: Record<string, string> = {
  [HOST_ID]: 'host-pagos',
  [PGI_1]: 'pagos-api',
  [PGI_2]: 'cola-mensajes',
  [DISK]: '/datos',
  [NIC]: 'eth0',
  [CGI]: 'contenedor-pagos',
  [K8S_NODE]: 'nodo-1',
  [VM]: 'instancia-pagos',
  [SERVICE]: 'servicio-pagos'
}

type Raw = Record<string, unknown>
const rel = (id: string): Raw => ({ id, type: TYPE_OF[id] })

/** El host, con relaciones de todos los grupos (PGI_1 repetido, como puede llegar). */
function hostBody(): Raw {
  return {
    entityId: HOST_ID,
    displayName: NAME_OF[HOST_ID],
    type: 'HOST',
    properties: {},
    fromRelationships: {
      runsOn: [rel(VM)],
      isInstanceOf: [rel(HOST_GROUP)],
      isNetworkClientOfHost: [rel(PEER)]
    },
    toRelationships: {
      isProcessOf: [rel(PGI_1), rel(PGI_2), rel(PGI_1)],
      isDiskOf: [rel(DISK)],
      isNetworkInterfaceOf: [rel(NIC)],
      isCgiOfHost: [rel(CGI)],
      isNodeOfHost: [rel(K8S_NODE)],
      runsOn: [rel(PG)],
      runsOnHost: [rel(SERVICE)],
      isSiteOf: [rel(SITE)],
      isNetworkClientOfHost: [rel(PEER)]
    }
  }
}

const T0 = Date.parse('2026-10-03T10:00:00.000Z')
const MIN = 60_000

/** Un evento con la forma vista en vivo. */
function event(n: number, entityId: string, extra: Raw = {}): Raw {
  const open = n % 7 === 0
  return {
    eventId: `${1000 + n}_${T0 - n * MIN}`,
    eventType: n % 2 === 0 ? 'PROCESS_RESTART' : 'HIGH_CPU',
    title: `Evento ${n}`,
    status: open ? 'OPEN' : 'CLOSED',
    startTime: T0 - n * 10 * MIN,
    endTime: open ? -1 : T0 - n * 10 * MIN + 5 * MIN,
    entityId: {
      entityId: { id: entityId, type: TYPE_OF[entityId] ?? 'PROCESS_GROUP_INSTANCE' },
      name: NAME_OF[entityId] ?? `proceso-${n}`
    },
    entityTags: [],
    managementZones: [],
    properties: [{ key: 'dt.event.description', value: 'Detalle' }],
    correlationId: `c${n}`,
    frequentEvent: false,
    suppressAlert: false,
    suppressProblem: false,
    underMaintenance: false,
    ...extra
  }
}

/** 26 eventos: de los ids que entran (25) y uno de un SERVICE (que no se pide). */
function allEvents(): Raw[] {
  const owners = [HOST_ID, PGI_1, PGI_2, DISK, VM]
  const list = Array.from({ length: 25 }, (_, i) => event(i + 1, owners[i % owners.length]!))
  list.push(event(0, SERVICE))
  return list
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

let requests: URL[]
let host: Raw
let events: Raw[]
/** Si es true, el falso devuelve los eventos sin ordenar. */
let unsorted: boolean
let eventsFail: { status: number; message: string } | null
let entityFail: { status: number; message: string } | null
let db: AppDatabase
let envId: string
let deps: IpcHandlerDeps
let clientLogger: { warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> }
let handlers: ReturnType<typeof createModuleHandlers>

/** Ids de un `eventSelector=entityId("a","b")`, o null si tiene otra forma. */
function selectorIds(selector: string): string[] | null {
  const inner = /^entityId\((.*)\)$/.exec(selector)?.[1]
  if (inner === undefined) return null
  return inner.split(',').map((part) => part.trim().replace(/^"|"$/g, ''))
}

const fakeFetch = vi.fn(async (input: unknown) => {
  const url = new URL(String(input instanceof Request ? input.url : input))
  requests.push(url)
  if (url.pathname === `/api/v2/entities/${HOST_ID}`) {
    if (entityFail !== null) {
      return json(entityFail.status, {
        error: { code: entityFail.status, message: entityFail.message }
      })
    }
    return json(200, host)
  }
  if (url.pathname !== '/api/v2/events') {
    return json(404, { error: { code: 404, message: 'No existe' } })
  }
  if (eventsFail !== null) {
    return json(eventsFail.status, {
      error: { code: eventsFail.status, message: eventsFail.message }
    })
  }
  const selector = url.searchParams.get('eventSelector') ?? ''
  const ids = selectorIds(selector)
  if (ids === null || selector.length > MAX_SELECTOR) {
    return json(400, { error: { code: 400, message: 'eventSelector no válido' } })
  }
  const wanted = new Set(ids)
  const matched = events
    .filter((e) => wanted.has(String(((e['entityId'] as Raw)['entityId'] as Raw)['id'])))
    .sort((a, b) => Number(b['startTime']) - Number(a['startTime']))
  const pageSize = Number(url.searchParams.get('pageSize') ?? '100')
  const page = matched.slice(0, pageSize)
  return json(200, {
    totalCount: matched.length,
    pageSize,
    nextPageKey: matched.length > pageSize ? 'PAGINA1' : null,
    warnings: [],
    events: unsorted ? [...page].reverse() : page
  })
})

beforeEach(() => {
  requests = []
  host = hostBody()
  events = allEvents()
  unsorted = false
  eventsFail = null
  entityFail = null

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

  clientLogger = { warn: vi.fn(), error: vi.fn() }
  const dtClient = createDtClient({
    fetchFor: () => fakeFetch as unknown as typeof fetch,
    getEnvironment: (id: string) => repo.getEnvironment(id),
    readSecret: (id: string, kind: 'classicToken' | 'oauthClientSecret' | 'platformToken') =>
      secrets.read(id, kind),
    oauth: { getToken: vi.fn(), invalidate: vi.fn(), expiresAt: vi.fn(() => null) },
    sleep: async () => undefined,
    now: () => new Date('2026-10-03T10:00:00.000Z'),
    random: () => 0,
    logger: clientLogger
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
  expect(JSON.stringify(result)).not.toContain('SECRETOEVENTOS')
  return result
}

const base = { entityId: HOST_ID, timeRange: '2h' as const }
const eventQueries = (): URL[] => requests.filter((u) => u.pathname === '/api/v2/events')
const entityQueries = (): URL[] =>
  requests.filter((u) => u.pathname === `/api/v2/entities/${HOST_ID}`)
/** Todos los ids pedidos en los eventSelector, con repeticiones. */
const askedIds = (): string[] =>
  eventQueries().flatMap((u) => selectorIds(u.searchParams.get('eventSelector') ?? '') ?? [])

interface OutEvent {
  eventType: string
  title: string
  status: string
  startTime: number
  endTime: number | null
  entity: { id: string; name: string | null; type: string }
}
interface Out {
  events: OutEvent[]
  totalCount: number
}

describe('CA4 (0042): la consulta lleva el selector con el host y sus relacionados y el rango', () => {
  it.each([
    ['relativo (2h)', '2h' as const, { from: 'now-2h', to: null }],
    [
      'absoluto',
      { from: '2026-10-01T08:00:00.000Z', to: '2026-10-01T10:00:00.000Z' },
      { from: '2026-10-01T08:00:00.000Z', to: '2026-10-01T10:00:00.000Z' }
    ]
  ])(
    'rango %s: las relaciones del host y una sola consulta de eventos',
    async (_c, timeRange, expected) => {
      const result = await call({ environmentId: envId, entityId: HOST_ID, timeRange })
      expect(result.ok, JSON.stringify(result.error)).toBe(true)

      // 1. Las relaciones del host, de GET /entities/{id}.
      expect(entityQueries()).toHaveLength(1)
      const fields = (entityQueries()[0]!.searchParams.get('fields') ?? '').split(',')
      expect(fields).toEqual(expect.arrayContaining(['+fromRelationships', '+toRelationships']))

      // 2. Una sola consulta de eventos (todo cabe), con eventSelector=entityId(...) y nada más.
      expect(eventQueries()).toHaveLength(1)
      const query = eventQueries()[0]!.searchParams
      const selector = query.get('eventSelector') ?? ''
      expect(selector, 'eventSelector solo con entityId(...)').toMatch(/^entityId\(.+\)$/)
      // Cada id, entre comillas (como en la OpenAPI: `entityId("id-1", "id-2")`).
      for (const id of EXPECTED_IDS) expect(selector).toContain(`"${id}"`)
      expect([...askedIds()].sort()).toEqual([...EXPECTED_IDS].sort())
      for (const id of EXCLUDED_IDS) expect(selector, id).not.toContain(id)
      expect(query.get('from')).toBe(expected.from)
      expect(query.get('to')).toBe(expected.to)
      expect(Number(query.get('pageSize'))).toBeGreaterThanOrEqual(20)
      expect(Number(query.get('pageSize'))).toBeLessThanOrEqual(1000)
      // La API pública: ni entitySelector ni el `optionalEntitySelector` interno de Dynatrace.
      expect(query.has('entitySelector')).toBe(false)
      expect(query.has('optionalEntitySelector')).toBe(false)
      expect(query.has('nextPageKey')).toBe(false)

      // Nada más que esas dos peticiones.
      expect(requests).toHaveLength(2)
    }
  )

  it('ningún id repetido en el selector (PGI_1 llega dos veces en las relaciones)', async () => {
    const result = await call({ environmentId: envId, ...base })
    expect(result.ok, JSON.stringify(result.error)).toBe(true)
    const ids = askedIds()
    expect(ids).toHaveLength(new Set(ids).size)
  })

  it('un host sin relaciones: solo su propio id', async () => {
    host = { ...hostBody(), fromRelationships: {}, toRelationships: {} }
    const result = await call({ environmentId: envId, ...base })
    expect(result.ok, JSON.stringify(result.error)).toBe(true)
    expect(eventQueries()).toHaveLength(1)
    expect(eventQueries()[0]!.searchParams.get('eventSelector')).toBe(`entityId("${HOST_ID}")`)
  })

  it('un id de relación que no tiene forma de id de Dynatrace no llega al selector', async () => {
    const odd = `PROCESS_GROUP_INSTANCE-${hex(0x42ff)}")),type("SERVICE`
    host = {
      ...hostBody(),
      toRelationships: {
        isProcessOf: [rel(PGI_1), { id: odd, type: 'PROCESS_GROUP_INSTANCE' }]
      }
    }
    const result = await call({ environmentId: envId, ...base })
    expect(result.ok, JSON.stringify(result.error)).toBe(true)
    for (const url of eventQueries()) {
      const selector = url.searchParams.get('eventSelector') ?? ''
      expect(selector).not.toContain('SERVICE')
      expect(selectorIds(selector)).not.toBeNull()
    }
    expect(askedIds()).toEqual(expect.arrayContaining([HOST_ID, PGI_1]))
  })

  it('con muchos procesos (450), reparte los ids en pocas consultas que caben y junta el resultado', async () => {
    const many = Array.from(
      { length: 450 },
      (_, i) => `PROCESS_GROUP_INSTANCE-${hex(0x420000 + i)}`
    )
    for (const id of many) TYPE_OF[id] = 'PROCESS_GROUP_INSTANCE'
    host = {
      ...hostBody(),
      toRelationships: { isProcessOf: many.map((id) => ({ id, type: 'PROCESS_GROUP_INSTANCE' })) }
    }
    // Un evento por cada proceso 0, 100, 200, 300 y 400 (en consultas distintas) y dos del host.
    events = [
      ...[0, 100, 200, 300, 400].map((i, n) => event(n + 1, many[i]!)),
      event(6, HOST_ID),
      event(7, HOST_ID)
    ]
    const result = await call({ environmentId: envId, ...base })
    expect(result.ok, JSON.stringify(result.error)).toBe(true)

    const queries = eventQueries()
    expect(queries.length, 'más de una consulta').toBeGreaterThan(1)
    expect(queries.length, 'pocas consultas, no una por id').toBeLessThanOrEqual(4)
    for (const url of queries) {
      const selector = url.searchParams.get('eventSelector') ?? ''
      expect(selector.length, 'el selector cabe').toBeLessThanOrEqual(MAX_SELECTOR)
      expect(url.searchParams.get('from')).toBe('now-2h')
    }
    // Cada id, una vez y en alguna consulta.
    const ids = askedIds()
    expect(ids).toHaveLength(new Set(ids).size)
    expect([...ids].sort()).toEqual([HOST_ID, ...many].sort())

    const data = result.data as Out
    expect(data.totalCount).toBe(7)
    expect(data.events.map((e) => e.title)).toEqual([1, 2, 3, 4, 5, 6, 7].map((n) => `Evento ${n}`))
  })
})

describe('CA4 (0042): la salida trae 20 como mucho, del más reciente al más antiguo', () => {
  it('20 de los 25 del host y sus relacionados, más el totalCount; nada del SERVICE', async () => {
    const result = await call({ environmentId: envId, ...base })
    expect(result.ok, JSON.stringify(result.error)).toBe(true)
    const data = result.data as Out
    expect(data.totalCount).toBe(25)
    expect(data.events).toHaveLength(20)
    const starts = data.events.map((e) => e.startTime)
    expect(starts).toEqual([...starts].sort((a, b) => b - a))
    // Los 20 más recientes: los eventos 1 a 20.
    expect(data.events.map((e) => e.title)).toEqual(
      Array.from({ length: 20 }, (_, i) => `Evento ${i + 1}`)
    )
    expect(data.events.some((e) => e.entity.id === SERVICE)).toBe(false)
  })

  it('cada evento: tipo, título, estado, inicio, fin (null si está activo) y la entidad', async () => {
    const result = await call({ environmentId: envId, ...base })
    expect(result.ok, JSON.stringify(result.error)).toBe(true)
    const data = result.data as Out
    const byTitle = Object.fromEntries(data.events.map((e) => [e.title, e]))
    // Evento 1: HIGH_CPU, cerrado, del host.
    expect(byTitle['Evento 1']).toMatchObject({
      eventType: 'HIGH_CPU',
      title: 'Evento 1',
      status: 'CLOSED',
      startTime: T0 - 10 * MIN,
      endTime: T0 - 10 * MIN + 5 * MIN,
      entity: { id: HOST_ID, name: 'host-pagos', type: 'HOST' }
    })
    // Evento 7: activo (endTime -1 en vivo) → null; del primer proceso.
    expect(byTitle['Evento 7']).toMatchObject({
      eventType: 'HIGH_CPU',
      status: 'OPEN',
      startTime: T0 - 70 * MIN,
      endTime: null,
      entity: { id: PGI_1, name: 'pagos-api', type: 'PROCESS_GROUP_INSTANCE' }
    })
    // Evento 14: activo, de un disco (y el 3, de PGI_2).
    expect(byTitle['Evento 14']).toMatchObject({
      eventType: 'PROCESS_RESTART',
      status: 'OPEN',
      endTime: null,
      entity: { id: DISK, name: '/datos', type: 'DISK' }
    })
    expect(byTitle['Evento 3']).toMatchObject({
      entity: { id: PGI_2, name: 'cola-mensajes', type: 'PROCESS_GROUP_INSTANCE' }
    })
    expect(byTitle['Evento 5']).toMatchObject({ entity: { id: VM, type: 'EC2_INSTANCE' } })
  })

  it('un evento activo con endTime null (como dice la OpenAPI) o sin endTime también sale con null', async () => {
    events = [
      event(1, HOST_ID, { status: 'OPEN', endTime: null }),
      (() => {
        const e = event(2, HOST_ID, { status: 'OPEN' })
        delete e['endTime']
        return e
      })()
    ]
    const result = await call({ environmentId: envId, ...base })
    expect(result.ok, JSON.stringify(result.error)).toBe(true)
    expect((result.data as Out).events.map((e) => e.endTime)).toEqual([null, null])
  })

  it('una entidad sin nombre (la API no lo trae si no la encuentra): name null', async () => {
    const e = event(1, PGI_1)
    e['entityId'] = { entityId: { id: PGI_1, type: 'PROCESS_GROUP_INSTANCE' } }
    events = [e]
    const result = await call({ environmentId: envId, ...base })
    expect(result.ok, JSON.stringify(result.error)).toBe(true)
    expect((result.data as Out).events[0]?.entity).toEqual({
      id: PGI_1,
      name: null,
      type: 'PROCESS_GROUP_INSTANCE'
    })
  })

  it('aunque la respuesta llegue desordenada, sale del más reciente al más antiguo', async () => {
    unsorted = true
    const result = await call({ environmentId: envId, ...base })
    expect(result.ok, JSON.stringify(result.error)).toBe(true)
    const starts = (result.data as Out).events.map((e) => e.startTime)
    expect(starts.length).toBeGreaterThan(1)
    expect(starts).toEqual([...starts].sort((a, b) => b - a))
  })

  it('el título sale tal cual, como texto (lo pinta la interfaz, nunca como HTML)', async () => {
    const title = '<b>Disco</b> lleno & "lento"'
    events = [event(1, DISK, { title })]
    const result = await call({ environmentId: envId, ...base })
    expect(result.ok, JSON.stringify(result.error)).toBe(true)
    expect((result.data as Out).events[0]?.title).toBe(title)
  })

  it('sin eventos: lista vacía y totalCount 0, sin error', async () => {
    events = []
    const result = await call({ environmentId: envId, ...base })
    expect(result.ok, JSON.stringify(result.error)).toBe(true)
    expect(result.data).toEqual({ events: [], totalCount: 0 })
  })

  it('la interfaz no manda selectores: un eventSelector en la entrada no llega a Dynatrace', async () => {
    await call({ environmentId: envId, ...base, eventSelector: 'status("OPEN")' })
    for (const url of eventQueries()) {
      expect(url.searchParams.get('eventSelector') ?? '').not.toContain('status')
    }
  })

  it.each([
    ['GET /events', 400],
    ['GET /events', 403],
    ['GET /entities/{id}', 404]
  ])('un fallo de %s (%i) acaba en error con reason', async (where, status) => {
    const failure = { status, message: 'Mensaje de Dynatrace en la prueba' }
    if (where === 'GET /events') eventsFail = failure
    else entityFail = failure
    const result = await call({ environmentId: envId, ...base })
    expect(result.ok).toBe(false)
    expect(result.error?.reason?.key, 'reason del error').toEqual(expect.any(String))
  })
})
