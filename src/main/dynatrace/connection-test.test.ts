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
    scopes: ['problems.read', 'metrics.read', 'slo.read', 'entities.read']
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
        missingScopes: REQUIRED_CLASSIC_SCOPES.filter((s) => s !== 'problems.read'),
        tokenInfo: {
          name: 'prueba',
          enabled: true,
          expiresAt: null,
          scopes: {
            granted: ['problems.read'],
            missing: REQUIRED_CLASSIC_SCOPES.filter((s) => s !== 'problems.read'),
            extra: []
          }
        }
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
      missingScopes: ['environment-api:problems:read'],
      tokenInfo: {
        name: null,
        enabled: null,
        expiresAt: OAUTH_EXPIRES.toISOString(),
        scopes: {
          granted: ['platform-management:environments:read'],
          missing: [
            'environment-api:entities:read',
            'environment-api:metrics:read',
            'environment-api:problems:read',
            'environment-api:slo:read'
          ],
          extra: []
        }
      }
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

  it('OAuth sin scope en la respuesta (null): missingScopes vacío y tokenInfo null', async () => {
    secrets = { oauthClientSecret: CLIENT_SECRET }
    grantedScopes = null as unknown as string[]
    expect((await run()).mechanisms).toEqual([
      { id: 'oauth', state: 'connected', error: null, missingScopes: [], tokenInfo: null }
    ])
  })

  it('OAuth con scope vacío ([]): faltan todos los pedidos y tokenInfo sin ninguno concedido', async () => {
    secrets = { oauthClientSecret: CLIENT_SECRET }
    grantedScopes = []
    const [oauthResult] = (await run()).mechanisms
    expect(oauthResult?.id).toBe('oauth')
    expect([...(oauthResult?.missingScopes ?? [])].sort()).toEqual([
      'environment-api:problems:read',
      'platform-management:environments:read'
    ])
    expect(oauthResult?.tokenInfo).toMatchObject({
      scopes: {
        granted: [],
        missing: [
          'environment-api:entities:read',
          'environment-api:metrics:read',
          'environment-api:problems:read',
          'environment-api:slo:read'
        ],
        extra: []
      }
    })
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
      { id: 'platform', state: 'connected', error: null, missingScopes: [], tokenInfo: null }
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

describe('testConnection: información del token', () => {
  it('token clásico: nombre, enabled, caducidad y scopes concedidos, que faltan y que no usa la app, ordenados', async () => {
    secrets = { classicToken: CLASSIC_TOKEN }
    lookupResponse = {
      ...lookupResponse,
      name: 'Token de pruebas',
      expirationDate: '2099-01-01T00:00:00.000Z',
      scopes: ['problems.read', 'metrics.read', 'logs.read', 'entities.read']
    }

    const [classic] = (await run()).mechanisms
    expect(classic).toMatchObject({ id: 'classic', state: 'connected' })
    expect(classic?.tokenInfo).toEqual({
      name: 'Token de pruebas',
      enabled: true,
      expiresAt: '2099-01-01T00:00:00.000Z',
      scopes: {
        granted: ['entities.read', 'logs.read', 'metrics.read', 'problems.read'],
        missing: ['slo.read'],
        // Ficha 0014: entities.read ya lo usa el módulo entities (no es extra).
        extra: ['logs.read']
      }
    })
  })

  it('token clásico sin caducidad: expiresAt null', async () => {
    secrets = { classicToken: CLASSIC_TOKEN }
    expect((await run()).mechanisms[0]?.tokenInfo).toMatchObject({ expiresAt: null, enabled: true })
  })

  it('token clásico desactivado: disconnected con UNAUTHORIZED, pero con tokenInfo y enabled false', async () => {
    secrets = { classicToken: CLASSIC_TOKEN }
    lookupResponse = { ...lookupResponse, enabled: false }
    const [classic] = (await run()).mechanisms
    expect(classic).toMatchObject({ state: 'disconnected', error: { code: 'UNAUTHORIZED' } })
    expect(classic?.tokenInfo).toMatchObject({ enabled: false, name: 'prueba' })
  })

  it('si el lookup falla, tokenInfo es null', async () => {
    secrets = { classicToken: CLASSIC_TOKEN }
    failures = { classic: new DtError('UNAUTHORIZED', 'Token no válido', 401) }
    const [classic] = (await run()).mechanisms
    expect(classic).toMatchObject({ state: 'disconnected', tokenInfo: null })
  })

  it('OAuth: caducidad del token y scopes concedidos frente a los de los módulos', async () => {
    secrets = { oauthClientSecret: CLIENT_SECRET }
    grantedScopes = [
      'platform-management:environments:read',
      'environment-api:problems:read',
      'storage:logs:read'
    ]

    const oauthResult = (await run()).mechanisms.find((m) => m.id === 'oauth')
    expect(oauthResult?.tokenInfo).toEqual({
      name: null,
      enabled: null,
      expiresAt: OAUTH_EXPIRES.toISOString(),
      scopes: {
        granted: [
          'environment-api:problems:read',
          'platform-management:environments:read',
          'storage:logs:read'
        ],
        missing: [
          'environment-api:entities:read',
          'environment-api:metrics:read',
          'environment-api:slo:read'
        ],
        // platform-management:environments:read lo usa Probar conexión: no es "extra".
        extra: ['storage:logs:read']
      }
    })
  })

  it('OAuth sin scope en la respuesta del SSO: tokenInfo null', async () => {
    secrets = { oauthClientSecret: CLIENT_SECRET }
    grantedScopes = null as unknown as string[]
    const oauthResult = (await run()).mechanisms.find((m) => m.id === 'oauth')
    expect(oauthResult).toMatchObject({ state: 'connected', tokenInfo: null })
  })

  it('platform token: tokenInfo siempre null (no hay endpoint para consultar sus permisos)', async () => {
    secrets = { platformToken: PLATFORM_TOKEN }
    expect((await run()).mechanisms[0]).toMatchObject({ id: 'platform', tokenInfo: null })
  })

  it('el informe con tokenInfo no lleva el token, su secreto ni su id', async () => {
    secrets = {
      classicToken: CLASSIC_TOKEN,
      oauthClientSecret: CLIENT_SECRET,
      platformToken: PLATFORM_TOKEN
    }
    lookupResponse = { ...lookupResponse, name: 'Token de pruebas', scopes: ['problems.read'] }
    const json = JSON.stringify(await run())
    expect(json).toContain('Token de pruebas')
    for (const secret of [
      'SECRETOCLASICO',
      'SECRETOPLATFORM',
      'SECRETOOAUTH',
      'ACCESSOOAUTH',
      'dt0c01.PUBLICAPRUEBA'
    ]) {
      expect(json).not.toContain(secret)
    }
  })
})

describe('testConnection con el cliente real: nada del token en el log', () => {
  it('un lookup que da 500 y otro que da 401, con el token en la petición y en la respuesta', async () => {
    const { createDtClient } = await import('./client')
    const logger = { warn: vi.fn(), error: vi.fn() }
    const answers = [500, 401]
    const fetchSpy = vi.fn(async () => {
      const status = answers.shift() ?? 500
      return new Response(
        JSON.stringify({
          error: { code: status, message: `Token ${CLASSIC_TOKEN}` },
          token: CLASSIC_TOKEN
        }),
        { status, headers: { 'content-type': 'application/json' } }
      )
    })
    const client = createDtClient({
      fetchFor: () => fetchSpy as unknown as typeof fetch,
      getEnvironment: () => environment,
      readSecret: () => CLASSIC_TOKEN,
      oauth,
      sleep: async () => undefined,
      now: () => new Date('2026-10-03T10:00:00.000Z'),
      random: () => 0,
      logger
    } as unknown as Parameters<typeof createDtClient>[0])
    const deps = {
      client,
      oauth,
      getEnvironment: () => environment,
      secretsStatus: () => ({ classicToken: true, oauthClientSecret: false, platformToken: false }),
      readSecret: () => CLASSIC_TOKEN
    } as unknown as Parameters<typeof testConnection>[1]

    const reports = [await testConnection(ENV, deps), await testConnection(ENV, deps)]

    expect(reports.map((r) => r.mechanisms[0]?.error?.code)).toEqual([
      'SERVER_ERROR',
      'UNAUTHORIZED'
    ])
    const logged = [...logger.warn.mock.calls, ...logger.error.mock.calls]
      .flat()
      .map((arg) =>
        arg instanceof Error ? `${arg.message} ${arg.stack ?? ''}` : JSON.stringify(arg)
      )
      .join('\n')
    // El id público puede salir enmascarado (dt0c01.<id>.***) por diseño de maskSecrets; el secreto, nunca.
    expect(logged).not.toContain('SECRETOCLASICO')
    expect(JSON.stringify(reports)).not.toContain('SECRETOCLASICO')
  })
})

describe('AUD-05: credencial ilegible', () => {
  it('si leer el token clásico da SECRET_UNREADABLE, el mecanismo queda disconnected con ese código', async () => {
    const { DomainError } = await import('../errors')
    secrets = { classicToken: CLASSIC_TOKEN, platformToken: PLATFORM_TOKEN }
    const report = await testConnection(ENV, {
      client: { dtRequest, paginate: vi.fn() },
      oauth,
      getEnvironment: () => environment,
      secretsStatus: () => ({ classicToken: true, oauthClientSecret: false, platformToken: true }),
      readSecret: (_envId: string, kind: string) => {
        if (kind === 'classicToken') {
          throw new DomainError('SECRET_UNREADABLE' as never, 'No se puede leer la credencial')
        }
        return PLATFORM_TOKEN
      }
    } as unknown as Parameters<typeof testConnection>[1])

    const classic = report.mechanisms.find((m) => m.id === 'classic')
    expect(classic).toMatchObject({
      state: 'disconnected',
      error: { code: 'SECRET_UNREADABLE' },
      tokenInfo: null
    })
    // Un fallo de lectura no impide probar los demás.
    expect(report.mechanisms.find((m) => m.id === 'platform')).toMatchObject({ state: 'connected' })
  })
})

describe('CA3 (0014): «Probar conexión» avisa si falta entities.read', () => {
  it('token clásico sin entities.read: es un scope que falta (missingScopes y tokenInfo)', async () => {
    secrets = { classicToken: CLASSIC_TOKEN }
    lookupResponse = { ...lookupResponse, scopes: ['problems.read', 'metrics.read', 'slo.read'] }

    const [classic] = (await run()).mechanisms
    expect(classic).toMatchObject({ id: 'classic', state: 'connected' })
    expect(classic?.missingScopes).toEqual(['entities.read'])
    expect(classic?.tokenInfo?.scopes.missing).toEqual(['entities.read'])
    expect(classic?.tokenInfo?.scopes.extra).toEqual([])
  })

  it('token clásico con entities.read: no falta ninguno y no cuenta como extra', async () => {
    secrets = { classicToken: CLASSIC_TOKEN }
    lookupResponse = {
      ...lookupResponse,
      scopes: ['problems.read', 'metrics.read', 'slo.read', 'entities.read']
    }

    const [classic] = (await run()).mechanisms
    expect(classic?.missingScopes).toEqual([])
    expect(classic?.tokenInfo?.scopes).toMatchObject({ missing: [], extra: [] })
  })

  it('OAuth sin environment-api:entities:read: falta en la información del token', async () => {
    secrets = { oauthClientSecret: CLIENT_SECRET }
    grantedScopes = [
      'platform-management:environments:read',
      'environment-api:problems:read',
      'environment-api:metrics:read',
      'environment-api:slo:read'
    ]

    const oauthResult = (await run()).mechanisms.find((m) => m.id === 'oauth')
    expect(oauthResult?.tokenInfo?.scopes.missing).toEqual(['environment-api:entities:read'])
  })
})
