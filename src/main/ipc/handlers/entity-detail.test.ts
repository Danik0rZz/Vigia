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
  tags: string[]
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

  it('zonas por nombre y etiquetas como texto (como en las evidencias)', async () => {
    const data = await getEntity()
    expect(data.managementZones).toEqual(['Zona pagos', 'Zona común'])
    expect(data.tags).toEqual(['equipo:pagos', '[ENVIRONMENT]Infra:Linux', 'capa:web', 'critico'])
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
