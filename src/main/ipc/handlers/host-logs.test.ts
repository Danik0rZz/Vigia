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
 * Ficha 0041: canal `entities:hostLogs` (los procesos de un HOST con logs detectados), con el
 * cliente de Dynatrace REAL sobre un fetch falso. Se comprueba qué se pide a `GET /entities` y
 * cómo llega la respuesta.
 *
 * Forma de la respuesta, la observada en vivo en el paso 0 (`host-logs-explore.live.test.ts`):
 * - las tres propiedades son de tipo `Map` (`GET /entityTypes/PROCESS_GROUP_INSTANCE`) y llegan
 *   como lista de `{ key, value }`. La `key` es la fuente del log: una ruta de fichero (Unix o
 *   Windows) o un nombre de fuente con espacios. **Nunca sale de main.**
 * - `logFileStatus`: `value` es un enum (`FILE_STATUS_OK`, `FILE_STATUS_NOT_EXIST`,
 *   `FILE_STATUS_NOT_MONITORED_ANY_MORE`);
 * - `logPathLastUpdate`: `value` es una fecha en SEGUNDOS desde epoch;
 * - `logSourceState`: `value` es un objeto `{ storageStatus }` con un enum
 *   (`LOG_STORAGE_CONFIGURATION_STATUS_SEND_TO_STORAGE`);
 * - un proceso sin logs llega sin esas claves en `properties`.
 *
 * Forma de la salida (decisión del test-writer, delegada y refinable; en la ficha):
 * `{ processes, withLogs, total }`. `processes` trae SOLO los procesos con logs (al menos una
 * entrada en alguna de las tres propiedades), cada uno con `id`, `name`, `fileStatus` (enum o
 * null), `sourceState` (el `storageStatus`, enum o null), `lastUpdate` (la más reciente de
 * `logPathLastUpdate`, en epoch MILISEGUNDOS, o null) y `logCount` (cuántas fuentes de log
 * distintas tiene: se cuentan, nunca se enseñan). `withLogs` es `processes.length` y `total`,
 * cuántos procesos tiene el host.
 */

const TRUSTED = { url: 'app://vigia/index.html', isMainFrame: true }
const TOKEN = `dt0c01.PUBLICAPRUEBA0000000000A.${'SECRETOLOGS'.padEnd(64, 'X')}`
const BASE = 'https://abc12345.live.dynatrace.com'
const CHANNEL = 'entities:hostLogs' as IpcChannel
/** Ids inventados, con el formato de Dynatrace. */
const HOST_ID = 'HOST-0123456789ABCDEF'
const PGI = (n: number): string =>
  `PROCESS_GROUP_INSTANCE-00000000000041${n.toString(16).toUpperCase().padStart(2, '0')}`

/** La consulta de la ficha (forma de la OpenAPI, `fromRelationships` en plural). */
const SELECTOR = `type("PROCESS_GROUP_INSTANCE"),fromRelationships.isProcessOf(entityId("${HOST_ID}"))`
const FIELDS = [
  '+properties.logFileStatus',
  '+properties.logPathLastUpdate',
  '+properties.logSourceState'
]

/** Fuentes de log inventadas: rutas de Unix y de Windows con un usuario, y una fuente sin ruta. */
const USER = 'usuario-inventado-0041'
const PATH_APP = `/home/${USER}/pagos/logs/app.log`
const PATH_ERR = `/var/log/pagos/error.log`
const PATH_WIN = `C:\\Users\\${USER}\\informes\\salida.log`
const SOURCE = 'Fuente generica de logs 0041'
const KEYS = [PATH_APP, PATH_ERR, PATH_WIN, SOURCE]

/** Fechas fijas en segundos (como en vivo) y en milisegundos (como sale del canal). */
const S1 = Date.parse('2026-10-03T07:30:00.000Z') / 1000
const S2 = Date.parse('2026-10-03T08:45:00.000Z') / 1000
const S3 = Date.parse('2026-10-02T22:10:00.000Z') / 1000

const SEND = 'LOG_STORAGE_CONFIGURATION_STATUS_SEND_TO_STORAGE'

type Raw = Record<string, unknown>

/** Procesos del host: tres con logs (de formas distintas) y uno sin ninguno. */
function processes(): Raw[] {
  return [
    {
      entityId: PGI(1),
      displayName: 'pagos-api',
      type: 'PROCESS_GROUP_INSTANCE',
      properties: {
        logFileStatus: [{ key: PATH_APP, value: 'FILE_STATUS_OK' }],
        logPathLastUpdate: [
          { key: PATH_APP, value: S1 },
          { key: PATH_ERR, value: S2 }
        ],
        logSourceState: [{ key: PATH_APP, value: { storageStatus: SEND } }]
      }
    },
    {
      entityId: PGI(2),
      displayName: 'informes-win',
      type: 'PROCESS_GROUP_INSTANCE',
      properties: {
        logFileStatus: [{ key: PATH_WIN, value: 'FILE_STATUS_NOT_EXIST' }],
        logPathLastUpdate: [{ key: PATH_WIN, value: S3 }]
      }
    },
    {
      entityId: PGI(3),
      displayName: 'cola-mensajes',
      type: 'PROCESS_GROUP_INSTANCE',
      properties: { logPathLastUpdate: [{ key: SOURCE, value: S1 }] }
    },
    {
      entityId: PGI(4),
      displayName: 'sin-logs',
      type: 'PROCESS_GROUP_INSTANCE',
      properties: {}
    }
  ]
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

let requests: URL[]
/** Páginas de la respuesta: la primera sin nextPageKey en la petición, las demás por su clave. */
let pages: Raw[][]
let failWith: { status: number; message: string } | null
let db: AppDatabase
let envId: string
let deps: IpcHandlerDeps
let clientLogger: { warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> }
let handlers: ReturnType<typeof createModuleHandlers>

const fakeFetch = vi.fn(async (input: unknown) => {
  const url = new URL(String(input instanceof Request ? input.url : input))
  requests.push(url)
  if (url.pathname !== '/api/v2/entities') {
    return json(404, { error: { code: 404, message: 'No existe' } })
  }
  if (failWith !== null) {
    return json(failWith.status, { error: { code: failWith.status, message: failWith.message } })
  }
  const key = url.searchParams.get('nextPageKey')
  // OpenAPI: con nextPageKey hay que omitir todos los demás parámetros.
  if (key !== null && [...url.searchParams.keys()].some((name) => name !== 'nextPageKey')) {
    return json(400, { error: { code: 400, message: 'Con nextPageKey, ningún otro parámetro' } })
  }
  const index = key === null ? 0 : Number(/^PAGINA(\d+)$/.exec(key)?.[1] ?? NaN)
  const entities = pages[index]
  if (entities === undefined) return json(400, { error: { code: 400, message: 'Clave rara' } })
  const total = pages.reduce((sum, page) => sum + page.length, 0)
  return json(200, {
    totalCount: total,
    pageSize: 500,
    nextPageKey: index + 1 < pages.length ? `PAGINA${index + 1}` : null,
    entities
  })
})

beforeEach(() => {
  requests = []
  pages = [processes()]
  failWith = null

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
  expect(JSON.stringify(result)).not.toContain('SECRETOLOGS')
  return result
}

const base = { entityId: HOST_ID, timeRange: '2h' as const }
const entityQueries = (): URL[] => requests.filter((u) => u.pathname === '/api/v2/entities')

/** Todo lo que se ha escrito en los dos logs (el del handler y el del cliente). */
const loggedText = (): string =>
  JSON.stringify([
    vi.mocked(deps.logger.warn).mock.calls,
    vi.mocked(deps.logger.error).mock.calls,
    clientLogger.warn.mock.calls,
    clientLogger.error.mock.calls
  ])

/** Trozos de las rutas y de la fuente que tampoco pueden salir sueltos. */
const FRAGMENTS = [
  ...KEYS,
  USER,
  '/home/',
  '/var/log',
  'C:\\',
  'informes\\',
  'app.log',
  'error.log',
  'salida.log',
  'generica'
]

describe('CA2 (0041): la consulta lleva el selector con el id del host, los fields y el rango', () => {
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

    // Una sola petición (todo cabe en una página), a GET /api/v2/entities.
    expect(requests).toHaveLength(1)
    expect(entityQueries()).toHaveLength(1)
    const query = entityQueries()[0]!.searchParams
    expect(query.get('entitySelector')).toBe(SELECTOR)
    // Exactamente las tres propiedades de la ficha, con el formato `properties.FIELD`.
    expect(
      (query.get('fields') ?? '')
        .split(',')
        .map((field) => field.trim())
        .sort()
    ).toEqual([...FIELDS].sort())
    expect(query.get('from')).toBe(expected.from)
    expect(query.get('to')).toBe(expected.to)
    expect(query.get('pageSize')).toBe('500')
  })

  it('con más de una página, sigue nextPageKey sin repetir los demás parámetros (OpenAPI) y junta los procesos', async () => {
    const [first, second, third, fourth] = processes()
    pages = [
      [first!, second!],
      [third!, fourth!]
    ]
    const result = await call({ environmentId: envId, ...base })
    expect(result.ok, JSON.stringify(result.error)).toBe(true)

    expect(entityQueries()).toHaveLength(2)
    const [page1, page2] = entityQueries()
    expect(page1!.searchParams.get('entitySelector')).toBe(SELECTOR)
    expect([...page2!.searchParams.keys()]).toEqual(['nextPageKey'])
    expect(page2!.searchParams.get('nextPageKey')).toBe('PAGINA1')

    const data = result.data as { processes: { id: string }[]; withLogs: number; total: number }
    expect(data.processes.map((p) => p.id).sort()).toEqual([PGI(1), PGI(2), PGI(3)])
    expect(data.withLogs).toBe(3)
    expect(data.total).toBe(4)
  })

  it('la interfaz no manda selectores: un entitySelector en la entrada no llega a Dynatrace', async () => {
    await call({ environmentId: envId, ...base, entitySelector: 'type("SERVICE")' })
    for (const url of entityQueries()) {
      expect(url.searchParams.get('entitySelector') ?? '').not.toContain('SERVICE')
    }
  })
})

describe('CA3 (0041): de una respuesta con rutas en sus propiedades, la salida no contiene ninguna ruta', () => {
  it('por proceso con logs: id, nombre, estado del fichero, estado de la fuente, última actualización (ms) y cuántas fuentes', async () => {
    const result = await call({ environmentId: envId, ...base })
    expect(result.ok, JSON.stringify(result.error)).toBe(true)
    const data = result.data as {
      processes: Raw[]
      withLogs: number
      total: number
    }
    expect(data.withLogs).toBe(3)
    expect(data.total).toBe(4)
    const byId = Object.fromEntries(data.processes.map((p) => [String(p['id']), p]))
    expect(Object.keys(byId).sort()).toEqual([PGI(1), PGI(2), PGI(3)])
    expect(byId[PGI(1)]).toEqual({
      id: PGI(1),
      name: 'pagos-api',
      fileStatus: 'FILE_STATUS_OK',
      sourceState: SEND,
      // La más reciente de logPathLastUpdate, de segundos a milisegundos.
      lastUpdate: S2 * 1000,
      logCount: 2
    })
    expect(byId[PGI(2)]).toEqual({
      id: PGI(2),
      name: 'informes-win',
      fileStatus: 'FILE_STATUS_NOT_EXIST',
      sourceState: null,
      lastUpdate: S3 * 1000,
      logCount: 1
    })
    expect(byId[PGI(3)]).toEqual({
      id: PGI(3),
      name: 'cola-mensajes',
      fileStatus: null,
      sourceState: null,
      lastUpdate: S1 * 1000,
      logCount: 1
    })
  })

  it('ninguna ruta ni fuente de log (ni trozos de ellas) sale del canal ni acaba en el log', async () => {
    const result = await call({ environmentId: envId, ...base })
    expect(result.ok, JSON.stringify(result.error)).toBe(true)
    const text = JSON.stringify(result)
    for (const fragment of FRAGMENTS) expect(text, fragment).not.toContain(fragment)
    // Ninguna barra en toda la salida: ni Unix ni Windows.
    expect(text).not.toMatch(/[\\/]/)
    for (const fragment of FRAGMENTS)
      expect(loggedText(), `log: ${fragment}`).not.toContain(fragment)
  })

  it('un valor que no es un enum de Dynatrace (una ruta en lugar del estado) tampoco sale', async () => {
    const odd = '/srv/raro/estado.log'
    pages = [
      [
        {
          entityId: PGI(5),
          displayName: 'proceso-raro',
          type: 'PROCESS_GROUP_INSTANCE',
          properties: {
            logFileStatus: [{ key: PATH_APP, value: odd }],
            logSourceState: [{ key: PATH_APP, value: { storageStatus: odd } }],
            logPathLastUpdate: [{ key: PATH_APP, value: odd }]
          }
        }
      ]
    ]
    const result = await call({ environmentId: envId, ...base })
    expect(result.ok, JSON.stringify(result.error)).toBe(true)
    const text = JSON.stringify(result)
    for (const fragment of [odd, '/srv/', 'estado.log', ...FRAGMENTS]) {
      expect(text, fragment).not.toContain(fragment)
    }
    expect(text).not.toMatch(/[\\/]/)
    expect(loggedText()).not.toContain(odd)
  })

  it('un host sin procesos con logs: lista vacía, withLogs 0 y el total de procesos', async () => {
    pages = [processes().slice(3)]
    const result = await call({ environmentId: envId, ...base })
    expect(result.ok, JSON.stringify(result.error)).toBe(true)
    expect(result.data).toEqual({ processes: [], withLogs: 0, total: 1 })
  })

  it('un host sin procesos: todo a cero, sin error', async () => {
    pages = [[]]
    const result = await call({ environmentId: envId, ...base })
    expect(result.ok, JSON.stringify(result.error)).toBe(true)
    expect(result.data).toEqual({ processes: [], withLogs: 0, total: 0 })
  })

  it.each([400, 404])('un %i acaba en error con reason, sin rutas en el log', async (status) => {
    failWith = { status, message: 'Mensaje de Dynatrace en la prueba' }
    const result = await call({ environmentId: envId, ...base })
    expect(result.ok).toBe(false)
    expect(result.error?.reason?.key, 'reason del error').toEqual(expect.any(String))
    for (const fragment of FRAGMENTS)
      expect(loggedText(), `log: ${fragment}`).not.toContain(fragment)
  })
})
