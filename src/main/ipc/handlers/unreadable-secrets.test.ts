import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcChannel } from '@shared/ipc'
import type { AppDatabase } from '../../db/database'
import { createDtClient } from '../../dynatrace/client'
import { createSavedQueryStore } from '../../modules/saved-queries'
import { createSecretStore } from '../../secrets/store'
import { createTenantRepository } from '../../tenants/repository'
import { createIpcHandler, type IpcImplementation } from '../handler'
import { createModuleHandlers } from './modules'
import { createTenantHandlers } from './tenants'
import { createTestDb } from '../../../test/fixtures'

/**
 * AUD-05 por IPC: un secreto que no se puede descifrar (guardado en otro
 * equipo o con otro usuario de Windows) llega como SECRET_UNREADABLE, sin el
 * error original, y tenants:list lo indica en unreadableSecrets.
 */

const TRUSTED = { url: 'app://vigia/index.html', isMainFrame: true }
const TOKEN = `dt0c01.PUBLICOFALSO000000000000.${'SECRETOILEGIBLE'.padEnd(64, 'Q')}`

/** Cifra bien, pero no puede descifrar. */
const brokenCrypto = {
  isEncryptionAvailable: () => true,
  encryptString: (value: string) => Buffer.from(`enc:${value}`, 'utf8'),
  decryptString: () => {
    throw new Error(`DPAPI: no se puede descifrar ${TOKEN}`)
  }
}

let db: AppDatabase
let envId: string
let repo: ReturnType<typeof createTenantRepository>
let secrets: ReturnType<typeof createSecretStore>
let fetchSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  db = createTestDb()
  repo = createTenantRepository(db)
  secrets = createSecretStore(db, brokenCrypto)
  const client = repo.createClient({ name: 'Cliente A', color: '#111111' })
  envId = repo.createEnvironment({
    clientId: client.id,
    name: 'Producción',
    type: 'production',
    deployment: 'saas',
    classicApiUrl: 'https://abc12345.live.dynatrace.com',
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
  fetchSpy = vi.fn(async () => new Response('{}', { status: 200 }))
})

afterEach(() => {
  db.$client.close()
})

async function call(
  handlers: Record<string, unknown>,
  channel: IpcChannel,
  input?: unknown
): Promise<{ ok: boolean; data?: unknown; error?: { code: string; message: string } }> {
  const implementation = handlers[channel] as IpcImplementation<typeof channel>
  return (await createIpcHandler(channel, implementation, {
    isTrustedSender: () => true,
    logger: { warn: vi.fn(), error: vi.fn() }
  })(TRUSTED, input)) as { ok: boolean; data?: unknown; error?: { code: string; message: string } }
}

function moduleHandlers(): ReturnType<typeof createModuleHandlers> {
  const client = createDtClient({
    fetchFor: () => fetchSpy as unknown as typeof fetch,
    getEnvironment: (id: string) => repo.getEnvironment(id),
    readSecret: (id: string, kind: 'classicToken' | 'oauthClientSecret' | 'platformToken') =>
      secrets.read(id, kind),
    oauth: { getToken: vi.fn(), invalidate: vi.fn(), expiresAt: vi.fn(() => null) },
    sleep: async () => undefined,
    now: () => new Date('2026-10-04T10:00:00.000Z'),
    random: () => 0,
    logger: { warn: vi.fn(), error: vi.fn() }
  } as unknown as Parameters<typeof createDtClient>[0])
  return createModuleHandlers({
    client,
    savedQueries: createSavedQueryStore(db),
    repo
  } as unknown as Parameters<typeof createModuleHandlers>[0])
}

function tenantHandlers(): ReturnType<typeof createTenantHandlers> {
  return createTenantHandlers({
    repo,
    secrets,
    dialogs: { chooseSaveFile: async () => null, chooseOpenFile: async () => null },
    statFile: async () => ({ size: 0 }),
    readFile: async () => '',
    writeFile: async () => undefined
  } as unknown as Parameters<typeof createTenantHandlers>[0])
}

describe('AUD-05 por IPC', () => {
  it('problems:list con un token ilegible da SECRET_UNREADABLE, sin llamar a la red ni filtrar nada', async () => {
    const result = await call(moduleHandlers(), 'problems:list', {
      environmentId: envId,
      timeRange: '2h'
    })
    expect(result).toMatchObject({ ok: false, error: { code: 'SECRET_UNREADABLE' } })
    expect(fetchSpy).not.toHaveBeenCalled()
    const json = JSON.stringify(result)
    expect(json).not.toContain('SECRETOILEGIBLE')
    expect(json).not.toContain('DPAPI')
  })

  it('tenants:list incluye unreadableSecrets tras una lectura fallida, y [] antes', async () => {
    const handlers = tenantHandlers()
    const before = await call(handlers, 'tenants:list')
    expect(before).toMatchObject({
      ok: true,
      data: { environments: [{ id: envId, unreadableSecrets: [] }] }
    })

    await call(moduleHandlers(), 'problems:list', { environmentId: envId, timeRange: '2h' })

    const after = await call(handlers, 'tenants:list')
    expect(after).toMatchObject({
      ok: true,
      data: {
        environments: [
          {
            id: envId,
            secrets: { classicToken: true },
            unreadableSecrets: ['classicToken']
          }
        ]
      }
    })
    expect(JSON.stringify(after)).not.toContain('SECRETOILEGIBLE')
  })

  it('volver a guardar el secreto quita la marca', async () => {
    await call(moduleHandlers(), 'problems:list', { environmentId: envId, timeRange: '2h' })
    const handlers = tenantHandlers()
    await call(handlers, 'secrets:set', {
      environmentId: envId,
      kind: 'classicToken',
      value: 'dt0c01.NUEVO'
    })
    expect(await call(handlers, 'tenants:list')).toMatchObject({
      ok: true,
      data: { environments: [{ id: envId, unreadableSecrets: [] }] }
    })
  })
})
