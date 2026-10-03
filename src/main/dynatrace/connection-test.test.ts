import { beforeEach, describe, expect, it, vi } from 'vitest'
import { REQUIRED_CLASSIC_SCOPES } from '@shared/dynatrace'
import { testConnection } from './connection-test'
import { DtError } from './errors'

/**
 * "Probar conexión": un resultado por mecanismo con credencial, con los scopes
 * que faltan, sin que un fallo impida probar los demás y sin secretos en el informe.
 */

const ENV = 'env-1'
const CLASSIC_TOKEN = `dt0c01.PUBLICAPRUEBA0000000000A.${'SECRETOCLASICO'.padEnd(64, 'X')}`
const PLATFORM_TOKEN = `dt0s16.PUBLICAPRUEBA0000000000A.${'SECRETOPLATFORM'.padEnd(64, 'X')}`
const CLIENT_SECRET = `dt0s02.CLIENTEPUBLICO00000000000.${'SECRETOOAUTH'.padEnd(64, 'X')}`
const OAUTH_EXPIRES = new Date('2026-10-03T10:05:00.000Z')

type Kind = 'classicToken' | 'oauthClientSecret' | 'platformToken'

let secrets: Partial<Record<Kind, string>>
let environment: Record<string, unknown>
let lookupResponse: Record<string, unknown>
let failures: Partial<Record<'classic' | 'oauth' | 'platform', Error>>
let dtRequest: ReturnType<typeof vi.fn>
let oauth: {
  getToken: ReturnType<typeof vi.fn>
  invalidate: ReturnType<typeof vi.fn>
  expiresAt: ReturnType<typeof vi.fn>
}
let grantedScopes: string[]

beforeEach(() => {
  secrets = {}
  environment = {
    id: ENV,
    classicApiUrl: 'https://abc12345.live.dynatrace.com',
    platformUrl: 'https://abc12345.apps.dynatrace.com',
    ssoUrl: null,
    oauthClientId: 'dt0s02.CLIENTEPUBLICO00000000000',
    oauthScopes: ['platform-management:environments:read', 'environment-api:problems:read'],
    accountUuid: null,
    deployment: 'saas'
  }
  lookupResponse = {
    id: 'dt0c01.PUBLICAPRUEBA0000000000A',
    name: 'prueba',
    enabled: true,
    scopes: ['problems.read', 'metrics.read', 'slo.read']
  }
  failures = {}
  grantedScopes = ['platform-management:environments:read', 'environment-api:problems:read']

  dtRequest = vi.fn(
    async (options: {
      api: string
      path: string
      auth?: string
      schema?: { parse?: (v: unknown) => unknown }
    }) => {
      const key =
        options.api === 'classic' ? 'classic' : options.auth === 'oauth' ? 'oauth' : 'platform'
      const failure = failures[key]
      if (failure !== undefined) throw failure
      const value =
        options.api === 'classic'
          ? lookupResponse
          : {
              environmentId: 'abc12345',
              createTime: '2026-01-01T00:00:00Z',
              type: 'saas',
              state: 'ACTIVE'
            }
      return options.schema?.parse ? options.schema.parse(value) : value
    }
  )
  oauth = {
    getToken: vi.fn(async () => ({
      accessToken: 'ACCESSOOAUTH',
      expiresAt: OAUTH_EXPIRES,
      grantedScopes
    })),
    invalidate: vi.fn(),
    expiresAt: vi.fn(() => OAUTH_EXPIRES)
  }
})

function run(): ReturnType<typeof testConnection> {
  return testConnection(ENV, {
    client: { dtRequest, paginate: vi.fn() },
    oauth,
    getEnvironment: () => environment,
    secretsStatus: () => ({
      classicToken: secrets.classicToken !== undefined,
      oauthClientSecret: secrets.oauthClientSecret !== undefined,
      platformToken: secrets.platformToken !== undefined
    }),
    readSecret: (_envId: string, kind: Kind) => secrets[kind] ?? null
  } as unknown as Parameters<typeof testConnection>[1])
}

describe('testConnection', () => {
  it('sin credenciales no prueba nada', async () => {
    const report = await run()
    expect(report.mechanisms).toEqual([])
    expect(report.oauthExpiresAt).toBeNull()
    expect(Number.isNaN(Date.parse(report.checkedAt))).toBe(false)
    expect(dtRequest).not.toHaveBeenCalled()
  })

  it('token clásico: hace el lookup con el token en el body y calcula los scopes que faltan', async () => {
    secrets = { classicToken: CLASSIC_TOKEN }
    lookupResponse = { ...lookupResponse, scopes: ['problems.read'] }

    const report = await run()

    expect(report.mechanisms).toEqual([
      {
        id: 'classic',
        state: 'connected',
        error: null,
        missingScopes: REQUIRED_CLASSIC_SCOPES.filter((s) => s !== 'problems.read')
      }
    ])
    expect(dtRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        envId: ENV,
        api: 'classic',
        method: 'POST',
        path: '/apiTokens/lookup',
        body: { token: CLASSIC_TOKEN }
      })
    )
  })

  it.each([
    ['desactivado', { enabled: false }],
    ['caducado', { expirationDate: '2020-01-01T00:00:00.000Z' }]
  ])('token clásico %s: disconnected con UNAUTHORIZED', async (_case, change) => {
    secrets = { classicToken: CLASSIC_TOKEN }
    lookupResponse = { ...lookupResponse, ...change }
    const [classic] = (await run()).mechanisms
    expect(classic).toMatchObject({
      id: 'classic',
      state: 'disconnected',
      error: { code: 'UNAUTHORIZED' }
    })
  })

  it('token clásico con caducidad futura o sin caducidad: connected', async () => {
    secrets = { classicToken: CLASSIC_TOKEN }
    lookupResponse = { ...lookupResponse, expirationDate: '2099-01-01T00:00:00.000Z' }
    expect((await run()).mechanisms[0]).toMatchObject({ state: 'connected', missingScopes: [] })
  })

  it('OAuth: token y GET de plataforma forzando OAuth, scopes que faltan y caducidad', async () => {
    secrets = { oauthClientSecret: CLIENT_SECRET, platformToken: PLATFORM_TOKEN }
    grantedScopes = ['platform-management:environments:read']

    const report = await run()

    expect(report.mechanisms.find((m) => m.id === 'oauth')).toEqual({
      id: 'oauth',
      state: 'connected',
      error: null,
      missingScopes: ['environment-api:problems:read']
    })
    expect(report.oauthExpiresAt).toBe(OAUTH_EXPIRES.toISOString())
    expect(dtRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        api: 'platform',
        path: '/platform/management/v1/environment',
        auth: 'oauth'
      })
    )
  })

  it('OAuth sin scopes en la respuesta: missingScopes vacío', async () => {
    secrets = { oauthClientSecret: CLIENT_SECRET }
    grantedScopes = []
    expect((await run()).mechanisms).toEqual([
      { id: 'oauth', state: 'connected', error: null, missingScopes: [] }
    ])
  })

  it('OAuth sin oauthClientId no se prueba', async () => {
    secrets = { oauthClientSecret: CLIENT_SECRET }
    environment = { ...environment, oauthClientId: null }
    expect((await run()).mechanisms).toEqual([])
    expect(oauth.getToken).not.toHaveBeenCalled()
  })

  it('platform token: GET de plataforma con el platform token', async () => {
    secrets = { platformToken: PLATFORM_TOKEN }
    expect((await run()).mechanisms).toEqual([
      { id: 'platform', state: 'connected', error: null, missingScopes: [] }
    ])
    expect(dtRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        api: 'platform',
        path: '/platform/management/v1/environment',
        auth: 'platformToken'
      })
    )
  })

  it('prueba los tres en orden y un fallo no impide probar los demás', async () => {
    secrets = {
      classicToken: CLASSIC_TOKEN,
      oauthClientSecret: CLIENT_SECRET,
      platformToken: PLATFORM_TOKEN
    }
    failures = { classic: new DtError('NETWORK', 'Sin red') }

    const report = await run()

    expect(report.mechanisms.map((m) => [m.id, m.state])).toEqual([
      ['classic', 'disconnected'],
      ['oauth', 'connected'],
      ['platform', 'connected']
    ])
    expect(report.mechanisms[0]).toMatchObject({
      error: { code: 'NETWORK', message: 'Sin red' },
      missingScopes: []
    })
  })

  it('un fallo al pedir el token OAuth deja OAuth en disconnected con su código', async () => {
    secrets = { oauthClientSecret: CLIENT_SECRET, platformToken: PLATFORM_TOKEN }
    oauth.getToken.mockRejectedValue(new DtError('UNAUTHORIZED', 'invalid_client'))

    const report = await run()

    expect(report.mechanisms.find((m) => m.id === 'oauth')).toMatchObject({
      state: 'disconnected',
      error: { code: 'UNAUTHORIZED' }
    })
    expect(report.mechanisms.find((m) => m.id === 'platform')).toMatchObject({ state: 'connected' })
  })

  it('el informe no contiene ningún secreto ni el access token', async () => {
    secrets = {
      classicToken: CLASSIC_TOKEN,
      oauthClientSecret: CLIENT_SECRET,
      platformToken: PLATFORM_TOKEN
    }
    failures = { platform: new DtError('UNAUTHORIZED', `Bearer ${PLATFORM_TOKEN}`) }

    const json = JSON.stringify(await run())

    for (const secret of ['SECRETOCLASICO', 'SECRETOPLATFORM', 'SECRETOOAUTH', 'ACCESSOOAUTH']) {
      expect(json).not.toContain(secret)
    }
  })
})
