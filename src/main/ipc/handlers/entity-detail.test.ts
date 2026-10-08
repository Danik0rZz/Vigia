import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { errorReasonKeys } from '@shared/error-reasons'
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
 * Ficha 0014: canales `entities:get` (datos de una entidad) y `entities:names`
 * (nombres de los ids de sus relaciones), con el cliente de Dynatrace REAL sobre
 * un fetch falso. Se comprueba qué se pide y qué llega a la interfaz.
 *
 * Según la OpenAPI v2 (APIv2.json):
 * - `GET /entities/{entityId}` admite `fields`, `from` y `to` y devuelve `Entity`
 *   (`displayName`, `entityId`, `type`, `firstSeenTms`, `lastSeenTms`, `icon` con
 *   `primaryIconType`, `managementZones` con `id` y `name`, `tags` con
 *   `stringRepresentation`, `properties` y las relaciones como objetos
 *   `nombre → [{ id, type }]`). Un 4XX llega con `ErrorEnvelope`.
 * - `GET /entities` admite `entitySelector=entityId("id-1","id-2")` (todos del
 *   mismo tipo), `pageSize` y `fields`, y devuelve `EntitiesList` (`entities`,
 *   `totalCount`).
 *
 * Paso 0 (en vivo): los ids de las relaciones se resuelven todos con el `from`
 * por defecto (`now-3d`), así que aquí no se exige ningún `from`.
 */

const TRUSTED = { url: 'app://vigia/index.html', isMainFrame: true }
const TOKEN = `dt0c01.PUBLICAPRUEBA0000000000A.${'SECRETOENTIDAD'.padEnd(64, 'X')}`
const BASE = 'https://abc12345.live.dynatrace.com'
const GET = 'entities:get' as IpcChannel
const NAMES = 'entities:names' as IpcChannel
/** Ids inventados, con el formato de Dynatrace. */
const ENTITY_ID = 'SERVICE-0123456789ABCDEF'
const HOST_ID = 'HOST-00000000000000A1'
const PGI_ID = 'PROCESS_GROUP_INSTANCE-00000000000000B2'
/** Instantes fijos (epoch ms). */
const FIRST_SEEN = Date.parse('2026-09-01T08:00:00.000Z')
const LAST_SEEN = Date.parse('2026-10-03T09:30:00.000Z')

const FIELDS = [
  '+properties',
  '+tags',
  '+managementZones',
  '+fromRelationships',
  '+toRelationships',
  '+firstSeenTms',
  '+lastSeenTms',
  '+icon'
]

/** 60 servicios llamados: más de los 50 que se devuelven por relación. */
const CALLED = Array.from({ length: 60 }, (_, i) => ({
  id: `SERVICE-${(i + 1).toString(16).toUpperCase().padStart(16, '0')}`,
  type: 'SERVICE'
}))

const LONG_NAME = 'x'.repeat(400)

/** Entity de la API v2 con datos inventados (solo tipos estándar). */
function entityBody(): Record<string, unknown> {
  return {
    entityId: ENTITY_ID,
    displayName: 'pagos-api',
    type: 'SERVICE',
    firstSeenTms: FIRST_SEEN,
    lastSeenTms: LAST_SEEN,
    icon: { primaryIconType: 'java' },
    managementZones: [
      { id: '1111', name: 'Zona pagos' },
      { id: '2222', name: 'Zona común' }
    ],
    tags: [
      {
        context: 'CONTEXTLESS',
        key: 'equipo',
        value: 'pagos',
        stringRepresentation: 'equipo:pagos'
      },
      {
        context: 'ENVIRONMENT',
        key: 'Infra',
        value: 'Linux',
        stringRepresentation: '[ENVIRONMENT]Infra:Linux'
      },
      // Sin stringRepresentation: como en las evidencias, key:value o key.
      { context: 'CONTEXTLESS', key: 'capa', value: 'web' },
      { context: 'CONTEXTLESS', key: 'critico' }
    ],
    properties: {
      serviceType: 'WEB_REQUEST_SERVICE',
      port: 8080,
      isExternalService: false,
      serviceTechnologyTypes: ['Java', 'Apache Tomcat'],
      // Observado en vivo: lista de objetos { type, edition?, version? }.
      softwareTechnologies: [
        { type: 'JAVA', edition: 'OpenJDK', version: '17.0.2' },
        { type: 'APACHE_TOMCAT', version: '10.1' }
      ],
      webServiceName: LONG_NAME
    },
    fromRelationships: {
      calls: CALLED,
      runsOnHost: [{ id: HOST_ID, type: 'HOST' }]
    },
    toRelationships: {
      // Observado en vivo: una relación puede mezclar tipos.
      calls: [
        { id: 'SERVICE-00000000000000C3', type: 'SERVICE' },
        { id: PGI_ID, type: 'PROCESS_GROUP_INSTANCE' }
      ]
    }
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

/** Ids de un entityId("a","b"), en orden; null si el selector no tiene esa forma exacta. */
function selectorIds(selector: string | null): string[] | null {
  const match = /^entityId\(((?:"[^"]*")(?:,"[^"]*")*)\)$/.exec(selector ?? '')
  return match === null ? null : [...(match[1] ?? '').matchAll(/"([^"]*)"/g)].map((m) => m[1] ?? '')
}

/** Respuesta de /entities/{id} y nombres conocidos de /entities; cada prueba puede cambiarlos. */
let respondEntity: (id: string) => Response
let knownNames: Record<string, string>
let requests: URL[]
let db: AppDatabase
let envId: string
let deps: IpcHandlerDeps
let handlers: ReturnType<typeof createModuleHandlers>

const fakeFetch = vi.fn(async (input: unknown) => {
  const url = new URL(String(input instanceof Request ? input.url : input))
  requests.push(url)
  const single = /^\/api\/v2\/entities\/([^/]+)$/.exec(url.pathname)
  if (single !== null) return respondEntity(decodeURIComponent(single[1] ?? ''))
  if (url.pathname === '/api/v2/entities') {
    const ids = selectorIds(url.searchParams.get('entitySelector')) ?? []
    const entities = ids
      .filter((id) => knownNames[id] !== undefined)
      .map((id) => ({ entityId: id, displayName: knownNames[id], type: id.split('-')[0] }))
    return json(200, { totalCount: entities.length, pageSize: 50, entities })
  }
  return json(404, { error: { code: 404, message: 'No existe' } })
})

beforeEach(() => {
  requests = []
  respondEntity = (id) =>
    id === ENTITY_ID
      ? json(200, entityBody())
      : json(404, { error: { code: 404, message: `Entity ${id} not found` } })
  knownNames = {
    [HOST_ID]: 'servidor-a',
    'HOST-00000000000000A2': 'servidor-b'
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

type Result = {
  ok: boolean
  data?: unknown
  error?: { code: string; message: string; reason?: { key: string } }
}

async function call(channel: IpcChannel, input: Record<string, unknown>): Promise<Result> {
  const implementation = (handlers as Record<string, unknown>)[channel] as IpcImplementation<
    typeof channel
  >
  expect(implementation, `implementación de ${channel}`).toBeTypeOf('function')
  const result = (await createIpcHandler(
    channel,
    implementation,
    deps
  )(TRUSTED, { environmentId: envId, ...input })) as Result
  // Ninguna salida lleva el token.
  expect(JSON.stringify(result)).not.toContain('SECRETOENTIDAD')
  return result
}

type Relationship = {
  direction: string
  name: string
  entities: { id: string; type: string }[]
  total: number
}
type EntityData = {
  displayName: string
  type: string
  firstSeen: unknown
  lastSeen: unknown
  iconType: string | null
  managementZones: string[]
  tags: { context: string; key: string; value: string | null }[]
  properties: { key: string; text: string }[]
  relationships: Relationship[]
}

async function getEntity(): Promise<EntityData> {
  const result = await call(GET, { entityId: ENTITY_ID })
  expect(result.ok, JSON.stringify(result.error)).toBe(true)
  return result.data as EntityData
}

describe('CA4 (0014): entities:get pide /entities/<id> con los fields y transforma la respuesta', () => {
  it('una sola petición a /api/v2/entities/<id> con los fields de la ficha', async () => {
    await getEntity()
    expect(requests).toHaveLength(1)
    const [url] = requests
    expect(url?.pathname).toBe(`/api/v2/entities/${ENTITY_ID}`)
    expect(
      (url?.searchParams.get('fields') ?? '')
        .split(',')
        .map((part) => part.trim())
        .sort()
    ).toEqual([...FIELDS].sort())
    // Es un GET de una entidad: ni selector ni paginación.
    expect(url?.searchParams.has('entitySelector')).toBe(false)
    expect(url?.searchParams.has('nextPageKey')).toBe(false)
  })

  it('nombre, tipo, fechas (epoch ms) e icono', async () => {
    const data = await getEntity()
    expect(data).toMatchObject({
      displayName: 'pagos-api',
      type: 'SERVICE',
      firstSeen: FIRST_SEEN,
      lastSeen: LAST_SEEN,
      iconType: 'java'
    })
  })

  // Ficha 0037: las etiquetas ya no llegan como texto (su CA1, más abajo).
  it('zonas por nombre', async () => {
    const data = await getEntity()
    expect(data.managementZones).toEqual(['Zona pagos', 'Zona común'])
  })

  it('propiedades: todas, en el orden de la respuesta, a texto y recortadas a 300', async () => {
    const data = await getEntity()
    expect(data.properties.map((p) => p.key)).toEqual([
      'serviceType',
      'port',
      'isExternalService',
      'serviceTechnologyTypes',
      'softwareTechnologies',
      'webServiceName'
    ])
    const text = (key: string): string => data.properties.find((p) => p.key === key)?.text ?? ''
    for (const property of data.properties) {
      expect(typeof property.text, property.key).toBe('string')
      expect(property.text.length, property.key).toBeLessThanOrEqual(300)
    }
    expect(text('serviceType')).toBe('WEB_REQUEST_SERVICE')
    expect(text('port')).toBe('8080')
    expect(text('isExternalService')).toBe('false')
    // Listas y objetos: el texto lleva sus valores (no «[object Object]»).
    for (const part of ['Java', 'Apache Tomcat'])
      expect(text('serviceTechnologyTypes')).toContain(part)
    for (const part of ['JAVA', 'OpenJDK', '17.0.2', 'APACHE_TOMCAT', '10.1'])
      expect(text('softwareTechnologies')).toContain(part)
    expect(text('softwareTechnologies')).not.toContain('[object Object]')
    // 400 caracteres: se recorta a 300.
    expect(text('webServiceName')).toHaveLength(300)
    expect(text('webServiceName').startsWith('x'.repeat(299))).toBe(true)
  })

  it('relaciones con dirección, nombre, como mucho 50 ids (los primeros) y total', async () => {
    const data = await getEntity()
    const find = (direction: string, name: string): Relationship | undefined =>
      data.relationships.find((r) => r.direction === direction && r.name === name)

    expect(data.relationships).toHaveLength(3)
    expect(find('from', 'calls')).toEqual({
      direction: 'from',
      name: 'calls',
      entities: CALLED.slice(0, 50),
      total: 60
    })
    expect(find('from', 'runsOnHost')).toEqual({
      direction: 'from',
      name: 'runsOnHost',
      entities: [{ id: HOST_ID, type: 'HOST' }],
      total: 1
    })
    expect(find('to', 'calls')).toEqual({
      direction: 'to',
      name: 'calls',
      entities: [
        { id: 'SERVICE-00000000000000C3', type: 'SERVICE' },
        { id: PGI_ID, type: 'PROCESS_GROUP_INSTANCE' }
      ],
      total: 2
    })
  })

  it('sin icono ni partes opcionales: iconType null y listas vacías', async () => {
    respondEntity = () =>
      json(200, { entityId: ENTITY_ID, displayName: 'pagos-api', type: 'SERVICE' })
    const data = await getEntity()
    expect(data).toMatchObject({
      displayName: 'pagos-api',
      type: 'SERVICE',
      iconType: null,
      managementZones: [],
      tags: [],
      properties: [],
      relationships: []
    })
  })
})

describe('CA5 (0014): un 404 de entities:get acaba en error con su reason', () => {
  it('NOT_FOUND con un reason propio de entidad, con texto en es y en', async () => {
    respondEntity = (id) => json(404, { error: { code: 404, message: `Entity ${id} not found` } })
    const result = await call(GET, { entityId: 'HOST-0000000000000000' })

    expect(result).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
    const key = result.error?.reason?.key
    expect(key, JSON.stringify(result.error)).toBeDefined()
    expect(errorReasonKeys as readonly string[]).toContain(key)
    // No es el del problema que no existe: es el de la entidad.
    expect(key).not.toBe('problemNotFound')

    const locale = (lang: string): Record<string, string> =>
      (
        JSON.parse(
          readFileSync(join('src', 'renderer', 'src', 'locales', lang, 'common.json'), 'utf8')
        ) as { errorReasons: Record<string, string> }
      ).errorReasons
    const es = locale('es')[key ?? ''] ?? ''
    expect(es).toMatch(/entidad/i)
    expect(es).toMatch(/no existe/i)
    expect(locale('en')[key ?? ''] ?? '').not.toBe('')
  })
})

describe('CA7 (0014): entities:names construye entityId(...), devuelve nombres y missing', () => {
  const byId = (a: { id: string }, b: { id: string }): number => a.id.localeCompare(b.id)

  it('con dos ids: una petición a /entities con entityId("a","b") y pageSize 50', async () => {
    const ids = [HOST_ID, 'HOST-00000000000000A2']
    const result = await call(NAMES, { entityIds: ids })
    expect(result.ok, JSON.stringify(result.error)).toBe(true)

    expect(requests).toHaveLength(1)
    const [url] = requests
    expect(url?.pathname).toBe('/api/v2/entities')
    expect(url?.searchParams.get('entitySelector')).toBe(
      `entityId("${HOST_ID}","HOST-00000000000000A2")`
    )
    expect(url?.searchParams.get('pageSize')).toBe('50')
    expect(url?.searchParams.has('nextPageKey')).toBe(false)

    const data = result.data as { names: { id: string; name: string }[]; missing: string[] }
    expect([...data.names].sort(byId)).toEqual([
      { id: HOST_ID, name: 'servidor-a' },
      { id: 'HOST-00000000000000A2', name: 'servidor-b' }
    ])
    expect(data.missing).toEqual([])
  })

  it('los ids que la API no devuelve van a missing', async () => {
    const ids = ['HOST-00000000000000A3', HOST_ID, 'HOST-00000000000000A4']
    const result = await call(NAMES, { entityIds: ids })
    expect(result.ok, JSON.stringify(result.error)).toBe(true)
    expect(selectorIds(requests[0]?.searchParams.get('entitySelector') ?? null)).toEqual(ids)

    const data = result.data as { names: { id: string; name: string }[]; missing: string[] }
    expect(data.names).toEqual([{ id: HOST_ID, name: 'servidor-a' }])
    expect([...data.missing].sort()).toEqual(['HOST-00000000000000A3', 'HOST-00000000000000A4'])
  })

  it('si no viene ninguno, todos a missing y names vacío', async () => {
    knownNames = {}
    const result = await call(NAMES, { entityIds: [PGI_ID] })
    expect(result).toEqual({ ok: true, data: { names: [], missing: [PGI_ID] } })
  })
})

/**
 * Ficha 0029, CA1: la línea de comandos, los argumentos, las variables de entorno y la ruta
 * completa del ejecutable de un proceso (PROCESS_GROUP_INSTANCE) no salen de `entities:get`, ni
 * en las propiedades que dan filas ni en «Todas las propiedades»: main los filtra antes de mandar
 * la entidad a la interfaz (pueden llevar contraseñas, tokens o el nombre del usuario).
 *
 * Formas (decisión del test-writer, delegada por Dani y refinable):
 * - Vistas en vivo en la 0027 (docs/notas-api-v2.md): `properties.metadata` es una lista de
 *   `{ key, value }`; los argumentos llegan con la clave `COMMAND_LINE_ARGS` y la ruta completa con
 *   `EXE_PATH` (las dos, en el enum de claves de metadata de la Configuration API).
 * - No vistas en vivo, inventadas para la línea de comandos y las variables de entorno que pide
 *   el criterio: una propiedad de texto `commandLine` y una propiedad objeto
 *   `environmentVariables` (nombre → valor).
 * El resto de `metadata` (por ejemplo, `EXE_NAME`, que da la fila «Ejecutable») y las demás
 * propiedades siguen llegando.
 */
describe('CA1 (0029): entities:get de un proceso sale sin línea de comandos, argumentos, variables de entorno ni ruta completa', () => {
  const PROCESS_ID = 'PROCESS_GROUP_INSTANCE-00000000000029A1'
  const SECRETS = {
    args: 'ARGS-SECRETO-0029',
    argsToken: 'TOKEN-ARGS-0029',
    commandLine: 'LINEA-SECRETA-0029',
    envPassword: 'ENV-CLAVE-0029',
    envToken: 'ENV-TOKEN-0029',
    userName: 'usuario-inventado-0029'
  }
  const EXE_PATH = `/home/${SECRETS.userName}/apps/bin/pagos-worker`
  const ARGS = `--db-password=${SECRETS.args} --token ${SECRETS.argsToken} -Xmx512m`
  const COMMAND_LINE = `/home/${SECRETS.userName}/apps/bin/pagos-worker --clave ${SECRETS.commandLine}`

  /** Entity de un proceso con datos inventados (solo tipos estándar). */
  function processBody(properties: Record<string, unknown>): Record<string, unknown> {
    return {
      entityId: PROCESS_ID,
      displayName: 'pagos-worker',
      type: 'PROCESS_GROUP_INSTANCE',
      firstSeenTms: FIRST_SEEN,
      lastSeenTms: LAST_SEEN,
      properties,
      fromRelationships: {
        isProcessOf: [{ id: HOST_ID, type: 'HOST' }],
        isInstanceOf: [{ id: 'PROCESS_GROUP-00000000000029A2', type: 'PROCESS_GROUP' }]
      }
    }
  }

  const metadata = (...entries: [string, string][]): { key: string; value: string }[] =>
    entries.map(([key, value]) => ({ key, value }))

  async function getProcess(properties: Record<string, unknown>): Promise<{
    data: EntityData
    text: string
  }> {
    respondEntity = (id) =>
      id === PROCESS_ID
        ? json(200, processBody(properties))
        : json(404, { error: { code: 404, message: `Entity ${id} not found` } })
    const result = await call(GET, { entityId: PROCESS_ID })
    expect(result.ok, JSON.stringify(result.error)).toBe(true)
    return { data: result.data as EntityData, text: JSON.stringify(result) }
  }

  /** Ninguno de los valores sale de main: ni en la respuesta ni en el log. */
  function expectNone(text: string, values: string[]): void {
    for (const value of values) expect(text, value).not.toContain(value)
    const logged = JSON.stringify([
      vi.mocked(deps.logger.warn).mock.calls,
      vi.mocked(deps.logger.error).mock.calls
    ])
    for (const value of values) expect(logged, `log: ${value}`).not.toContain(value)
  }

  it('los argumentos (COMMAND_LINE_ARGS de metadata, visto en vivo) no salen', async () => {
    const { text } = await getProcess({
      metadata: metadata(['EXE_NAME', 'pagos-worker'], ['COMMAND_LINE_ARGS', ARGS])
    })
    expectNone(text, [ARGS, SECRETS.args, SECRETS.argsToken, '-Xmx512m'])
  })

  it('la ruta completa del ejecutable (EXE_PATH de metadata, visto en vivo) no sale', async () => {
    const { text } = await getProcess({
      metadata: metadata(['EXE_PATH', EXE_PATH], ['EXE_NAME', 'pagos-worker'])
    })
    expectNone(text, [EXE_PATH, SECRETS.userName, '/home/', 'apps/bin'])
  })

  it('la línea de comandos (propiedad commandLine) no sale', async () => {
    const { data, text } = await getProcess({
      detectedName: 'pagos-worker',
      commandLine: COMMAND_LINE
    })
    expectNone(text, [COMMAND_LINE, SECRETS.commandLine, SECRETS.userName])
    expect(data.properties.map((p) => p.key)).toContain('detectedName')
  })

  it('las variables de entorno (propiedad environmentVariables) no salen', async () => {
    const { text } = await getProcess({
      detectedName: 'pagos-worker',
      environmentVariables: { DB_PASSWORD: SECRETS.envPassword, API_TOKEN: SECRETS.envToken }
    })
    expectNone(text, [SECRETS.envPassword, SECRETS.envToken])
  })

  it('todo junto: ninguno de esos valores sale, ni en las propiedades ni en ningún otro sitio de la salida', async () => {
    const { data, text } = await getProcess({
      detectedName: 'pagos-worker',
      commandLine: COMMAND_LINE,
      environmentVariables: { DB_PASSWORD: SECRETS.envPassword, API_TOKEN: SECRETS.envToken },
      metadata: metadata(
        ['COMMAND_LINE_ARGS', ARGS],
        ['EXE_NAME', 'pagos-worker'],
        ['EXE_PATH', EXE_PATH],
        ['KUBERNETES_NAMESPACE', 'espacio-pagos']
      )
    })
    expectNone(text, [
      ARGS,
      EXE_PATH,
      COMMAND_LINE,
      ...Object.values(SECRETS),
      '/home/',
      '-Xmx512m'
    ])
    for (const property of data.properties) {
      for (const value of Object.values(SECRETS)) {
        expect(property.text, `${property.key}: ${value}`).not.toContain(value)
      }
    }
  })

  it('lo demás sigue llegando: el nombre del ejecutable y el resto de metadata, y las otras propiedades', async () => {
    const { data } = await getProcess({
      detectedName: 'pagos-worker',
      listenPorts: [8080, 8443],
      softwareTechnologies: [{ type: 'JAVA', edition: 'OpenJDK', version: '17.0.2' }],
      commandLine: COMMAND_LINE,
      metadata: metadata(
        ['COMMAND_LINE_ARGS', ARGS],
        ['EXE_NAME', 'pagos-worker'],
        ['EXE_PATH', EXE_PATH],
        ['KUBERNETES_NAMESPACE', 'espacio-pagos']
      )
    })
    const text = (key: string): string => data.properties.find((p) => p.key === key)?.text ?? ''
    expect(data.properties.map((p) => p.key)).toEqual(
      expect.arrayContaining(['detectedName', 'listenPorts', 'softwareTechnologies', 'metadata'])
    )
    expect(text('detectedName')).toBe('pagos-worker')
    for (const port of ['8080', '8443']) expect(text('listenPorts')).toContain(port)
    expect(text('softwareTechnologies')).toContain('JAVA')
    // metadata conserva sus otras entradas, con su clave y su valor (como las demás listas).
    for (const part of ['EXE_NAME', 'pagos-worker', 'KUBERNETES_NAMESPACE', 'espacio-pagos']) {
      expect(text('metadata'), part).toContain(part)
    }
    // Las relaciones, tal cual.
    expect(data.relationships.map((r) => `${r.direction} ${r.name}`).sort()).toEqual([
      'from isInstanceOf',
      'from isProcessOf'
    ])
  })
})

/**
 * Ficha 0037, CA1: `entities:get` manda las etiquetas separadas, `{ context, key, value }`, con
 * `context`, `key` y `value` de `EnrichedTagDto` (OpenAPI v2); `value` es null en las de solo
 * clave. Se conserva el orden de la respuesta (ordenar es cosa de la vista).
 *
 * Decisiones del test-writer (delegadas por Dani, refinables): una etiqueta sin `context` llega
 * con `CONTEXTLESS` (el contexto de las etiquetas propias, según la OpenAPI); una sin `key` (o con
 * la clave vacía) no llega; un `value` vacío cuenta como sin valor.
 */
describe('CA1 (0037): entities:get transforma las etiquetas de la API en { context, key, value }', () => {
  async function tagsOf(tags: unknown): Promise<EntityData['tags']> {
    respondEntity = () =>
      json(200, { entityId: ENTITY_ID, displayName: 'pagos-api', type: 'SERVICE', tags })
    return (await getEntity()).tags
  }

  it('con valor y sin contexto propio (CONTEXTLESS), con valor y con contexto, y de solo clave', async () => {
    const data = await getEntity()
    expect(data.tags).toEqual([
      { context: 'CONTEXTLESS', key: 'equipo', value: 'pagos' },
      { context: 'ENVIRONMENT', key: 'Infra', value: 'Linux' },
      { context: 'CONTEXTLESS', key: 'capa', value: 'web' },
      { context: 'CONTEXTLESS', key: 'critico', value: null }
    ])
  })

  it('de solo clave con contexto, y sin el campo context', async () => {
    const tags = await tagsOf([
      { context: 'AWS', key: 'Name', stringRepresentation: '[AWS]Name' },
      { key: 'suelta', value: 'valor-suelto', stringRepresentation: 'suelta:valor-suelto' },
      { key: 'sola', stringRepresentation: 'sola' }
    ])
    expect(tags).toEqual([
      { context: 'AWS', key: 'Name', value: null },
      { context: 'CONTEXTLESS', key: 'suelta', value: 'valor-suelto' },
      { context: 'CONTEXTLESS', key: 'sola', value: null }
    ])
  })

  it('la clave y el valor, tal cual (con dos puntos o espacios dentro), sin usar stringRepresentation', async () => {
    const tags = await tagsOf([
      {
        context: 'KUBERNETES',
        key: 'app.kubernetes.io/name',
        value: 'pagos: api',
        stringRepresentation: 'texto-que-no-se-usa'
      }
    ])
    expect(tags).toEqual([
      { context: 'KUBERNETES', key: 'app.kubernetes.io/name', value: 'pagos: api' }
    ])
  })

  it('sin clave no llega; un valor vacío es una etiqueta de solo clave', async () => {
    const tags = await tagsOf([
      { context: 'CONTEXTLESS', value: 'huerfano' },
      { context: 'CONTEXTLESS', key: '', value: 'vacia' },
      'no-es-un-objeto',
      null,
      { context: 'CONTEXTLESS', key: 'vacio', value: '' }
    ])
    expect(tags).toEqual([{ context: 'CONTEXTLESS', key: 'vacio', value: null }])
  })

  it('sin etiquetas, o con tags que no es una lista, lista vacía', async () => {
    expect(await tagsOf([])).toEqual([])
    expect(await tagsOf({ key: 'no-es-lista' })).toEqual([])
  })
})
