import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcChannel } from '@shared/ipc'
import { openDatabase, type AppDatabase } from '../../db/database'
import { createDtClient } from '../../dynatrace/client'
import { testConnection } from '../../dynatrace/connection-test'
import { createOAuthTokenManager } from '../../dynatrace/oauth'
import { createPinStore } from '../../dynatrace/pins'
import { createConnectionStatusStore } from '../../dynatrace/status'
import { createSecretStore } from '../../secrets/store'
import { createTenantRepository } from '../../tenants/repository'
import { createIpcHandler, type IpcHandlerDeps, type IpcImplementation } from '../handler'
import { createConnectionHandlers } from './connection'

/**
 * Canales connection:* y certificates:*, con testConnection REAL (cliente y
 * OAuth reales sobre un fetch falso), secretos conocidos guardados y un access
 * token conocido. Ninguna salida puede contener ninguno de ellos.
 */

const TRUSTED = { url: 'app://vigia/index.html', isMainFrame: true }
const CLASSIC_TOKEN = `dt0c01.PUBLICAPRUEBA0000000000A.${'SECRETOCLASICO'.padEnd(64, 'X')}`
const PLATFORM_TOKEN = `dt0s16.PUBLICAPRUEBA0000000000A.${'SECRETOPLATFORM'.padEnd(64, 'X')}`
const CLIENT_SECRET = `dt0s02.CLIENTEPUBLICO00000000000.${'SECRETOOAUTH'.padEnd(64, 'X')}`
const ACCESS_TOKEN = 'ACCESSOOAUTHCONOCIDO'
const SECRETS = ['SECRETOCLASICO', 'SECRETOPLATFORM', 'SECRETOOAUTH', ACCESS_TOKEN, 'enc:']
const FINGERPRINT = 'sha256/41dd/dggRAcg5cQCL/1k1EsfDBwepuCzHHNupCcW8c0='

const fakeCrypto = {
  isEncryptionAvailable: () => true,
  encryptString: (value: string) => Buffer.from(`enc:${[...value].reverse().join('')}`, 'utf8'),
  decryptString: (buffer: Buffer) => [...buffer.toString('utf8').slice(4)].reverse().join('')
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

/** Dynatrace y SSO falsos: responden bien a lo que pide "Probar conexión". */
const fakeFetch = vi.fn(async (input: unknown) => {
  const url = String(input instanceof Request ? input.url : input)
  if (url.includes('/sso/oauth2/token')) {
    return json(200, { access_token: ACCESS_TOKEN, expires_in: 300, token_type: 'Bearer' })
  }
  if (url.includes('/api/v2/apiTokens/lookup')) {
    return json(200, {
      id: 'dt0c01.PUBLICAPRUEBA0000000000A',
      name: 'prueba',
      enabled: true,
      scopes: ['problems.read', 'metrics.read', 'slo.read']
    })
  }
  if (url.includes('/platform/management/v1/environment')) {
    return json(200, {
      environmentId: 'abc12345',
      createTime: '2026-01-01T00:00:00Z',
      type: 'saas',
      state: 'ACTIVE'
    })
  }
  return json(404, { error: { code: 404, message: 'No existe' } })
})

let db: AppDatabase
let repo: ReturnType<typeof createTenantRepository>
let envId: string
let onChanged: ReturnType<typeof vi.fn>
let deps: IpcHandlerDeps
let handlers: ReturnType<typeof createConnectionHandlers>
let outputs: string[]
let called: Set<string>

beforeEach(() => {
  db = openDatabase(':memory:', 'src/main/db/migrations')
  repo = createTenantRepository(db)
  const secrets = createSecretStore(db, fakeCrypto)
  const client = repo.createClient({ name: 'Cliente A', color: '#111111' })
  envId = repo.createEnvironment({
    clientId: client.id,
    name: 'Producción',
    type: 'production',
    deployment: 'saas',
    classicApiUrl: 'https://abc12345.live.dynatrace.com',
    platformUrl: 'https://abc12345.apps.dynatrace.com',
    ssoUrl: 'https://sso.dynatrace.com/sso/oauth2/token',
    oauthClientId: 'dt0s02.CLIENTEPUBLICO00000000000',
    oauthScopes: ['platform-management:environments:read'],
    accountUuid: null,
    certificateLevel: 'system',
    captureUrlPatterns: [],
    tags: [],
    readOnly: false
  }).id
  secrets.set(envId, 'classicToken', CLASSIC_TOKEN)
  secrets.set(envId, 'platformToken', PLATFORM_TOKEN)
  secrets.set(envId, 'oauthClientSecret', CLIENT_SECRET)

  const oauth = createOAuthTokenManager({
    fetch: fakeFetch as unknown as typeof fetch,
    now: () => new Date('2026-10-03T10:00:00.000Z'),
    credentials: async (id: string) => {
      const env = repo.getEnvironment(id)
      const clientSecret = secrets.read(id, 'oauthClientSecret')
      if (env.oauthClientId === null || clientSecret === null) return null
      return {
        ssoUrl: env.ssoUrl ?? 'https://sso.dynatrace.com/sso/oauth2/token',
        clientId: env.oauthClientId,
        clientSecret,
        scopes: env.oauthScopes,
        accountUuid: env.accountUuid
      }
    }
  })
  const dtClient = createDtClient({
    fetchFor: () => fakeFetch as unknown as typeof fetch,
    getEnvironment: (id: string) => repo.getEnvironment(id),
    readSecret: (id: string, kind: 'classicToken' | 'oauthClientSecret' | 'platformToken') =>
      secrets.read(id, kind),
    oauth,
    sleep: async () => undefined,
    now: () => new Date('2026-10-03T10:00:00.000Z'),
    random: () => 0,
    logger: { warn: vi.fn(), error: vi.fn() }
  } as unknown as Parameters<typeof createDtClient>[0])

  onChanged = vi.fn()
  handlers = createConnectionHandlers({
    testConnection: async (id: string) => ({
      ...(await testConnection(id, {
        client: dtClient,
        oauth,
        getEnvironment: (envIdArg: string) => repo.getEnvironment(envIdArg),
        secretsStatus: (envIdArg: string) => secrets.status(envIdArg),
        readSecret: (
          envIdArg: string,
          kind: 'classicToken' | 'oauthClientSecret' | 'platformToken'
        ) => secrets.read(envIdArg, kind)
      } as unknown as Parameters<typeof testConnection>[1])),
      untrustedCertificates: [
        {
          host: 'abc12345.live.dynatrace.com',
          fingerprint: FINGERPRINT,
          reason: 'untrusted',
          previousFingerprint: null
        }
      ]
    }),
    status: createConnectionStatusStore(),
    pins: createPinStore(db),
    repo,
    onChanged
  } as unknown as Parameters<typeof createConnectionHandlers>[0])

  deps = { isTrustedSender: () => true, logger: { warn: vi.fn(), error: vi.fn() } }
  outputs = []
  called = new Set()
})

afterEach(() => {
  db.$client.close()
})

async function call(
  channel: IpcChannel,
  input?: unknown
): Promise<{ ok: boolean; data?: unknown; error?: { code: string } }> {
  const implementation = (handlers as Record<string, unknown>)[channel] as IpcImplementation<
    typeof channel
  >
  expect(implementation, `implementación de ${channel}`).toBeTypeOf('function')
  const result = (await createIpcHandler(channel, implementation, deps)(TRUSTED, input)) as {
    ok: boolean
    data?: unknown
    error?: { code: string }
  }
  called.add(channel)
  outputs.push(`${channel}: ${JSON.stringify(result)}`)
  return result
}

describe('canales de conexión y certificados', () => {
  it('recorre todos los canales y ninguna salida contiene secretos ni el access token', async () => {
    expect(await call('connection:status', { environmentId: envId })).toEqual({
      ok: true,
      data: null
    })

    const tested = await call('connection:test', { environmentId: envId })
    expect(tested).toMatchObject({
      ok: true,
      data: {
        mechanisms: [
          { id: 'classic', state: 'connected', missingScopes: [] },
          { id: 'oauth', state: 'connected' },
          { id: 'platform', state: 'connected' }
        ],
        untrustedCertificates: [
          {
            host: 'abc12345.live.dynatrace.com',
            fingerprint: FINGERPRINT,
            reason: 'untrusted',
            previousFingerprint: null
          }
        ]
      }
    })
    expect((tested.data as { oauthExpiresAt: string }).oauthExpiresAt).toBe(
      '2026-10-03T10:05:00.000Z'
    )

    // connection:status devuelve el último informe (sin la lista de certificados).
    const status = await call('connection:status', { environmentId: envId })
    expect(status).toMatchObject({
      ok: true,
      data: { checkedAt: (tested.data as { checkedAt: string }).checkedAt }
    })

    // Certificados: fijar pasa el nivel de system a pinned y avisa del cambio.
    expect(await call('certificates:list', { environmentId: envId })).toEqual({
      ok: true,
      data: []
    })
    expect(
      await call('certificates:pin', {
        environmentId: envId,
        host: 'abc12345.live.dynatrace.com',
        fingerprint: FINGERPRINT
      })
    ).toEqual({ ok: true, data: { ok: true } })
    expect(repo.getEnvironment(envId).certificateLevel).toBe('pinned')
    expect(onChanged).toHaveBeenCalledWith(envId)
    expect(await call('certificates:list', { environmentId: envId })).toEqual({
      ok: true,
      data: [{ host: 'abc12345.live.dynatrace.com', fingerprint: FINGERPRINT }]
    })

    onChanged.mockClear()
    expect(
      await call('certificates:unpin', {
        environmentId: envId,
        host: 'abc12345.live.dynatrace.com'
      })
    ).toEqual({
      ok: true,
      data: { ok: true }
    })
    expect(onChanged).toHaveBeenCalledWith(envId)
    expect(await call('certificates:list', { environmentId: envId })).toEqual({
      ok: true,
      data: []
    })

    for (const output of outputs) {
      for (const secret of SECRETS) expect(output, output.slice(0, 80)).not.toContain(secret)
    }
    expect(Object.keys(handlers).filter((channel) => !called.has(channel))).toEqual([])
  })

  it("con nivel 'ignore', fijar una huella no cambia el nivel", async () => {
    const input: Record<string, unknown> = {
      ...repo.getEnvironment(envId),
      certificateLevel: 'ignore'
    }
    delete input['id']
    repo.updateEnvironment(envId, input as Parameters<typeof repo.updateEnvironment>[1])

    await call('certificates:pin', {
      environmentId: envId,
      host: 'a.host',
      fingerprint: FINGERPRINT
    })
    expect(repo.getEnvironment(envId).certificateLevel).toBe('ignore')
  })

  it("con nivel 'pinned', fijar otra huella sustituye la del host", async () => {
    await call('certificates:pin', {
      environmentId: envId,
      host: 'a.host',
      fingerprint: FINGERPRINT
    })
    const other = 'sha256/BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB='
    await call('certificates:pin', { environmentId: envId, host: 'a.host', fingerprint: other })
    expect(await call('certificates:list', { environmentId: envId })).toEqual({
      ok: true,
      data: [{ host: 'a.host', fingerprint: other }]
    })
  })

  it('un entorno que no existe da NOT_FOUND al fijar', async () => {
    expect(
      await call('certificates:pin', {
        environmentId: '00000000-0000-4000-8000-000000000000',
        host: 'a.host',
        fingerprint: FINGERPRINT
      })
    ).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
  })
})
