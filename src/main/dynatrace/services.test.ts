import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { z } from 'zod'
import type { AppDatabase } from '../db/database'
import { createSecretStore, type SecretStore } from '../secrets/store'
import { createTenantRepository, type TenantRepository } from '../tenants/repository'
import { createTestDb, environmentInput, fakeCrypto } from '../../test/fixtures'
import { DtError } from './errors'

/**
 * AUD-20: createDynatraceServices monta el cliente con sus piezas reales
 * (repositorio, secretos, gestor OAuth y sesión de red por entorno). Electron
 * se simula: cada partición tiene un fetch que hace de SSO y de plataforma.
 * Aquí se prueba el camino correcto de OAuth de punta a punta.
 */

type Call = { partition: string; url: string; method: string; headers: Headers; body: string }

const fake = vi.hoisted(() => ({
  calls: [] as {
    partition: string
    url: string
    method: string
    headers: Headers
    body: string
  }[],
  issued: 0,
  ssoStatus: 200
}))

vi.mock('electron', () => ({
  session: {
    fromPartition: (partition: string) => ({
      setCertificateVerifyProc: () => undefined,
      fetch: async (input: string, init: RequestInit = {}) => {
        const url = String(input)
        fake.calls.push({
          partition,
          url,
          method: (init.method ?? 'GET').toUpperCase(),
          headers: new Headers(init.headers),
          body: init.body === undefined || init.body === null ? '' : String(init.body)
        })
        if (url.includes('/token')) {
          if (fake.ssoStatus !== 200) return new Response('{}', { status: fake.ssoStatus })
          fake.issued += 1
          return Response.json({
            access_token: `token-oauth-${fake.issued}`,
            expires_in: 300,
            scope: 'storage:logs:read storage:buckets:read'
          })
        }
        return Response.json({ ok: true })
      }
    })
  }
}))

const { createDynatraceServices } = await import('./services')

const CLIENT_SECRET = 'dt0s02.EJEMPLO.SECRETOOAUTHPRUEBA'
const SSO = 'https://sso.ejemplo.test/sso/oauth2/token'
const PLATFORM = 'https://abc12345.apps.dynatrace.com'

let db: AppDatabase
let repo: TenantRepository
let secrets: SecretStore
let logger: {
  warn: Mock<(...args: unknown[]) => void>
  error: Mock<(...args: unknown[]) => void>
}
let envId: string

function services(): ReturnType<typeof createDynatraceServices> {
  return createDynatraceServices({ db, repo, secrets, logger })
}

function platformGet(svc: ReturnType<typeof createDynatraceServices>): Promise<unknown> {
  return svc.client.dtRequest({
    envId,
    api: 'platform',
    path: '/platform/storage/query/v1/query:poll',
    schema: z.unknown()
  })
}

const ssoCalls = (): Call[] => fake.calls.filter((call) => call.url.includes('/token'))
const apiCalls = (): Call[] => fake.calls.filter((call) => call.url.startsWith(PLATFORM))

beforeEach(() => {
  fake.calls.length = 0
  fake.issued = 0
  fake.ssoStatus = 200
  db = createTestDb()
  repo = createTenantRepository(db)
  secrets = createSecretStore(db, fakeCrypto())
  logger = {
    warn: vi.fn<(...args: unknown[]) => void>(),
    error: vi.fn<(...args: unknown[]) => void>()
  }
  const client = repo.createClient({ name: 'Cliente A', color: '#111111' })
  envId = repo.createEnvironment(
    environmentInput(client.id, {
      ssoUrl: SSO,
      accountUuid: '0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b'
    })
  ).id
  secrets.set(envId, 'oauthClientSecret', CLIENT_SECRET)
})

afterEach(() => {
  db.$client.close()
})

describe('OAuth: el camino correcto', () => {
  it('lee el client secret guardado, pide el token al SSO y lo usa como Bearer', async () => {
    await expect(platformGet(services())).resolves.toEqual({ ok: true })

    const [sso] = ssoCalls()
    expect(sso?.url).toBe(SSO)
    expect(sso?.method).toBe('POST')
    expect(sso?.headers.get('content-type')).toBe('application/x-www-form-urlencoded')
    const form = new URLSearchParams(sso?.body)
    expect(Object.fromEntries(form)).toEqual({
      grant_type: 'client_credentials',
      client_id: 'dt0s02.EJEMPLO',
      client_secret: CLIENT_SECRET,
      scope: 'storage:logs:read storage:buckets:read',
      resource: 'urn:dtaccount:0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b'
    })

    const [api] = apiCalls()
    expect(api?.url).toBe(`${PLATFORM}/platform/storage/query/v1/query:poll`)
    expect(api?.headers.get('authorization')).toBe('Bearer token-oauth-1')
  })

  it('el SSO y la API van por la sesión de red del entorno', async () => {
    await platformGet(services())
    expect(new Set(fake.calls.map((call) => call.partition))).toEqual(new Set([`env-${envId}-0`]))
  })

  it('el token se reutiliza mientras no caduca: una sola petición al SSO', async () => {
    const svc = services()
    await platformGet(svc)
    await platformGet(svc)
    expect(ssoCalls()).toHaveLength(1)
    expect(apiCalls().map((call) => call.headers.get('authorization'))).toEqual([
      'Bearer token-oauth-1',
      'Bearer token-oauth-1'
    ])
    expect(svc.connectionDeps).toBeDefined()
  })

  it('onEnvironmentChanged descarta el token y la sesión: el siguiente pide otro', async () => {
    const svc = services()
    await platformGet(svc)
    svc.onEnvironmentChanged(envId)
    await platformGet(svc)
    expect(ssoCalls()).toHaveLength(2)
    expect(apiCalls().at(-1)?.headers.get('authorization')).toBe('Bearer token-oauth-2')
    // Sesión nueva (Electron cachea la verificación de certificados).
    expect(fake.calls.at(-1)?.partition).toBe(`env-${envId}-1`)
  })

  it('sin ssoUrl, usa el SSO de Dynatrace', async () => {
    const env = repo.getEnvironment(envId)
    repo.updateEnvironment(envId, { ...env, ssoUrl: null })
    await platformGet(services())
    expect(ssoCalls()[0]?.url).toBe('https://sso.dynatrace.com/sso/oauth2/token')
  })

  it('sin accountUuid, no manda resource', async () => {
    const env = repo.getEnvironment(envId)
    repo.updateEnvironment(envId, { ...env, accountUuid: null })
    await platformGet(services())
    expect(new URLSearchParams(ssoCalls()[0]?.body).has('resource')).toBe(false)
  })

  it('el client secret no aparece en el log ni en un error del SSO', async () => {
    fake.ssoStatus = 401
    const error = await platformGet(services()).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(DtError)
    expect((error as DtError).code).toBe('UNAUTHORIZED')
    expect(String((error as Error).message)).not.toContain(CLIENT_SECRET)
    expect(JSON.stringify([logger.warn.mock.calls, logger.error.mock.calls])).not.toContain(
      CLIENT_SECRET
    )
  })
})

describe('connectionDeps.testConnection', () => {
  it('prueba por la sesión del entorno y añade untrustedCertificates (vacío si no hubo fallos TLS)', async () => {
    secrets.set(envId, 'classicToken', `dt0c01.PUBLICAPRUEBA0000000000A.${'S'.repeat(64)}`)
    const svc = services()
    const report = await svc.connectionDeps.testConnection(envId)
    expect(report.untrustedCertificates).toEqual([])
    expect(report.mechanisms.map((m) => m.id)).toContain('classic')
    // Todo por la partición del entorno: también el SSO y la consulta del token.
    expect(new Set(fake.calls.map((call) => call.partition))).toEqual(new Set([`env-${envId}-0`]))
  })

  it('connectionDeps.onChanged es el mismo onEnvironmentChanged (sesión nueva)', async () => {
    const svc = services()
    await platformGet(svc)
    svc.connectionDeps.onChanged(envId)
    await platformGet(svc)
    expect(fake.calls.at(-1)?.partition).toBe(`env-${envId}-1`)
  })
})

describe('OAuth: sin credenciales', () => {
  it('sin client secret guardado → NO_CREDENTIAL, sin llamar al SSO', async () => {
    secrets.delete(envId, 'oauthClientSecret')
    const error = await platformGet(services()).catch((e: unknown) => e)
    expect((error as DtError).code).toBe('NO_CREDENTIAL')
    expect(ssoCalls()).toEqual([])
  })

  it('sin client ID → NO_CREDENTIAL, sin llamar al SSO', async () => {
    const env = repo.getEnvironment(envId)
    repo.updateEnvironment(envId, { ...env, oauthClientId: null })
    const error = await platformGet(services()).catch((e: unknown) => e)
    expect((error as DtError).code).toBe('NO_CREDENTIAL')
    expect(ssoCalls()).toEqual([])
  })
})
