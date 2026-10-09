import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppDatabase } from '../../db/database'
import { createDtClient } from '../../dynatrace/client'
import { createSavedQueryStore } from '../../modules/saved-queries'
import { createSecretStore } from '../../secrets/store'
import { createTenantRepository } from '../../tenants/repository'
import { createIpcHandler, type IpcHandlerDeps } from '../handler'
import { createModuleHandlers } from './modules'
import { createTestDb, fakeCrypto } from '../../../test/fixtures'

/**
 * Ficha 0041, ronda 1 de revisión: `entities:hostLogs` respeta el tope de páginas de
 * `DtClient.paginate` (10 de 500) y, si quedaban procesos, lo dice con `truncated: true`.
 * Dynatrace (falso) devuelve siempre `nextPageKey`.
 */

const TRUSTED = { url: 'app://vigia/index.html', isMainFrame: true }
const TOKEN = `dt0c01.PUBLICAPRUEBA0000000000A.${'SECRETOTRUNC'.padEnd(64, 'X')}`
const BASE = 'https://abc12345.live.dynatrace.com'
const HOST_ID = 'HOST-0123456789ABCDEF'

let requests: URL[]
let db: AppDatabase
let envId: string
let deps: IpcHandlerDeps
let handlers: ReturnType<typeof createModuleHandlers>

const fakeFetch = vi.fn(async (input: unknown) => {
  const url = new URL(String(input instanceof Request ? input.url : input))
  requests.push(url)
  const page = requests.length
  const id = `PROCESS_GROUP_INSTANCE-${page.toString(16).toUpperCase().padStart(16, '0')}`
  return new Response(
    JSON.stringify({
      totalCount: 99_999,
      pageSize: 500,
      nextPageKey: `PAGINA${page}`,
      entities: [
        {
          entityId: id,
          displayName: `proceso-${page}`,
          properties: { logFileStatus: [{ key: 'fuente', value: 'FILE_STATUS_OK' }] }
        }
      ]
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  )
})

beforeEach(() => {
  requests = []
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

describe('entities:hostLogs con más páginas que el tope (0041)', () => {
  it('pide 10 páginas, ni una más, y la salida trae truncated: true', async () => {
    const result = (await createIpcHandler(
      'entities:hostLogs',
      handlers['entities:hostLogs'],
      deps
    )(TRUSTED, { environmentId: envId, entityId: HOST_ID, timeRange: '2h' })) as {
      ok: boolean
      data?: { processes: unknown[]; withLogs: number; total: number; truncated?: boolean }
    }
    expect(result.ok).toBe(true)
    expect(requests).toHaveLength(10)
    expect(result.data?.truncated).toBe(true)
    expect(result.data?.withLogs).toBe(10)
    expect(result.data?.total).toBe(99_999)
  })
})
