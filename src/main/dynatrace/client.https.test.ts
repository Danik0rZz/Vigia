import { request as httpsRequest, createServer, type Server } from 'node:https'
import type { AddressInfo } from 'node:net'
import { generate } from 'selfsigned'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createDtClient } from './client'
import { DtError } from './errors'
import { createOAuthTokenManager } from './oauth'

/**
 * ACEPTACIÓN DE LA FASE 4 (spec): cliente y gestor OAuth reales contra un
 * servidor HTTPS simulado en 127.0.0.1, con certificado autofirmado generado
 * aquí (no se guarda en disco). Cubre renovación de token, reintento tras 401
 * y espera ante 429. La huella fijada se prueba en e2e/tls.spec.ts, porque
 * necesita la red de Chromium.
 */

const ENV = 'env-https'
const CLASSIC_TOKEN = `dt0c01.PUBLICAPRUEBA0000000000A.${'SECRETOCLASICO'.padEnd(64, 'X')}`
const CLIENT_SECRET = `dt0s02.CLIENTEPUBLICO00000000000.${'SECRETOOAUTH'.padEnd(64, 'X')}`
const T0 = new Date('2026-10-03T10:00:00.000Z')

let server: Server
let ca: string
let base: string

/** Estado del servidor simulado. */
const sim = {
  issued: 0,
  ssoForms: [] as URLSearchParams[],
  platformAuth: [] as string[],
  revoked: new Set<string>(),
  problems429: 0
}

function send(
  res: import('node:http').ServerResponse,
  status: number,
  body: unknown,
  headers = {}
): void {
  res.writeHead(status, { 'content-type': 'application/json', ...headers })
  res.end(JSON.stringify(body))
}

beforeAll(async () => {
  const pems = await generate([{ name: 'commonName', value: '127.0.0.1' }], {
    keySize: 2048,
    algorithm: 'sha256',
    extensions: [{ name: 'subjectAltName', altNames: [{ type: 7, ip: '127.0.0.1' }] }]
  })
  ca = pems.cert

  server = createServer({ key: pems.private, cert: pems.cert }, (req, res) => {
    let raw = ''
    req.on('data', (chunk: Buffer) => (raw += chunk.toString('utf8')))
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'https://127.0.0.1')
      const auth = req.headers.authorization ?? ''

      if (req.method === 'POST' && url.pathname === '/sso/oauth2/token') {
        const form = new URLSearchParams(raw)
        sim.ssoForms.push(form)
        if (form.get('client_secret') !== CLIENT_SECRET) {
          return send(res, 401, { error: 'invalid_client' })
        }
        sim.issued += 1
        return send(res, 200, {
          access_token: `tok-${sim.issued}`,
          expires_in: 120,
          token_type: 'Bearer',
          scope: form.get('scope')
        })
      }

      if (req.method === 'GET' && url.pathname === '/platform/management/v1/environment') {
        sim.platformAuth.push(auth)
        const token = auth.replace(/^Bearer /, '')
        if (!/^tok-\d+$/.test(token) || sim.revoked.has(token)) {
          return send(res, 401, { error: { code: 401, message: 'Token no válido' } })
        }
        return send(res, 200, {
          environmentId: 'abc12345',
          createTime: '2026-01-01T00:00:00Z',
          type: 'saas',
          state: 'ACTIVE'
        })
      }

      if (req.method === 'POST' && url.pathname === '/api/v2/apiTokens/lookup') {
        if (auth !== `Api-Token ${CLASSIC_TOKEN}`) {
          return send(res, 401, { error: { code: 401, message: 'Missing or invalid token' } })
        }
        return send(res, 200, {
          id: 'dt0c01.PUBLICAPRUEBA0000000000A',
          name: 'prueba',
          enabled: true,
          scopes: ['problems.read']
        })
      }

      if (req.method === 'GET' && url.pathname === '/api/v2/problems') {
        if (sim.problems429 > 0) {
          sim.problems429 -= 1
          return send(
            res,
            429,
            { error: { code: 429, message: 'Too many requests' } },
            { 'retry-after': '1' }
          )
        }
        return send(res, 200, { totalCount: 0, problems: [] })
      }

      send(res, 404, { error: { code: 404, message: 'No existe' } })
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `https://127.0.0.1:${(server.address() as AddressInfo).port}`
}, 60_000)

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

/** fetch mínimo sobre node:https que confía solo en el certificado del servidor de prueba. */
const httpsFetch = (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
  const url = new URL(input instanceof Request ? input.url : String(input))
  const headers = Object.fromEntries(new Headers(init.headers).entries())
  const body = init.body === undefined || init.body === null ? undefined : String(init.body)
  if (init.body instanceof URLSearchParams && headers['content-type'] === undefined) {
    headers['content-type'] = 'application/x-www-form-urlencoded'
  }
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      url,
      { method: init.method ?? 'GET', headers, ca, signal: init.signal ?? undefined },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => {
          const responseHeaders = new Headers()
          for (const [key, value] of Object.entries(res.headers)) {
            if (typeof value === 'string') responseHeaders.set(key, value)
          }
          resolve(
            new Response(Buffer.concat(chunks), {
              status: res.statusCode ?? 0,
              headers: responseHeaders
            })
          )
        })
      }
    )
    req.on('error', reject)
    req.end(body)
  })
}

let clock: Date
let sleep: ReturnType<typeof vi.fn>

function build(
  secrets: Partial<Record<'classicToken' | 'oauthClientSecret' | 'platformToken', string>>
): {
  client: ReturnType<typeof createDtClient>
  oauth: ReturnType<typeof createOAuthTokenManager>
} {
  const oauth = createOAuthTokenManager({
    fetch: httpsFetch as typeof fetch,
    now: () => clock,
    credentials: async () =>
      secrets.oauthClientSecret === undefined
        ? null
        : {
            ssoUrl: `${base}/sso/oauth2/token`,
            clientId: 'dt0s02.CLIENTEPUBLICO00000000000',
            clientSecret: secrets.oauthClientSecret,
            scopes: ['platform-management:environments:read'],
            accountUuid: null
          }
  })
  const client = createDtClient({
    fetchFor: () => httpsFetch as typeof fetch,
    getEnvironment: () => ({ classicApiUrl: base, platformUrl: base }),
    readSecret: (_envId: string, kind: string) => (secrets as Record<string, string>)[kind] ?? null,
    oauth,
    sleep,
    now: () => clock,
    random: () => 0,
    logger: { warn: vi.fn(), error: vi.fn() }
  } as unknown as Parameters<typeof createDtClient>[0])
  return { client, oauth }
}

const environmentSchema = z.object({ environmentId: z.string() }).passthrough()

beforeEach(() => {
  clock = T0
  sleep = vi.fn(async () => undefined)
  sim.issued = 0
  sim.ssoForms = []
  sim.platformAuth = []
  sim.revoked.clear()
  sim.problems429 = 0
})

describe('contra un servidor HTTPS simulado', () => {
  it('OAuth: pide el token al SSO, lo reutiliza y lo renueva cuando quedan menos de 60 s', async () => {
    const { client, oauth } = build({ oauthClientSecret: CLIENT_SECRET })
    const call = (): Promise<unknown> =>
      client.dtRequest({
        envId: ENV,
        api: 'platform',
        path: '/platform/management/v1/environment',
        schema: environmentSchema
      })

    expect(await call()).toMatchObject({ environmentId: 'abc12345' })
    clock = new Date(T0.getTime() + 30_000) // quedan 90 s
    await call()
    expect(sim.issued).toBe(1)

    clock = new Date(T0.getTime() + 61_000) // quedan 59 s
    await call()
    expect(sim.issued).toBe(2)
    expect(sim.platformAuth).toEqual(['Bearer tok-1', 'Bearer tok-1', 'Bearer tok-2'])
    expect(oauth.expiresAt(ENV)).toEqual(new Date(clock.getTime() + 120_000))
    expect(sim.ssoForms[0]?.get('grant_type')).toBe('client_credentials')
    expect(sim.ssoForms[0]?.get('scope')).toBe('platform-management:environments:read')
  })

  it('401: invalida el token, pide otro y reintenta una sola vez', async () => {
    const { client } = build({ oauthClientSecret: CLIENT_SECRET })
    const call = (): Promise<unknown> =>
      client.dtRequest({
        envId: ENV,
        api: 'platform',
        path: '/platform/management/v1/environment',
        schema: environmentSchema
      })

    await call()
    sim.revoked.add('tok-1') // el servidor revoca el token sin que haya caducado
    expect(await call()).toMatchObject({ environmentId: 'abc12345' })
    expect(sim.platformAuth).toEqual(['Bearer tok-1', 'Bearer tok-1', 'Bearer tok-2'])
    expect(sim.issued).toBe(2)
  })

  it('401 repetido: tras un reintento da UNAUTHORIZED', async () => {
    const { client } = build({ oauthClientSecret: CLIENT_SECRET })
    sim.revoked.add('tok-1')
    sim.revoked.add('tok-2')
    let caught: unknown
    try {
      await client.dtRequest({
        envId: ENV,
        api: 'platform',
        path: '/platform/management/v1/environment',
        schema: environmentSchema
      })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(DtError)
    expect((caught as DtError).code).toBe('UNAUTHORIZED')
    expect(sim.platformAuth).toHaveLength(2)
  })

  it('429: espera lo que indica Retry-After y reintenta', async () => {
    const { client } = build({ classicToken: CLASSIC_TOKEN })
    sim.problems429 = 1
    const result = await client.dtRequest({
      envId: ENV,
      api: 'classic',
      path: '/problems',
      schema: z.object({ totalCount: z.number() }).passthrough()
    })
    expect(result).toMatchObject({ totalCount: 0 })
    expect(sleep.mock.calls.map((call) => call[0])).toEqual([1000])
  })

  it('token clásico: lookup por HTTPS con Api-Token, y un token erróneo da UNAUTHORIZED', async () => {
    const ok = build({ classicToken: CLASSIC_TOKEN })
    expect(
      await ok.client.dtRequest({
        envId: ENV,
        api: 'classic',
        method: 'POST',
        path: '/apiTokens/lookup',
        body: { token: CLASSIC_TOKEN },
        schema: z.object({ enabled: z.boolean() }).passthrough()
      })
    ).toMatchObject({ enabled: true })

    const wrong = build({ classicToken: 'dt0c01.OTRO.OTRO' })
    let caught: unknown
    try {
      await wrong.client.dtRequest({
        envId: ENV,
        api: 'classic',
        method: 'POST',
        path: '/apiTokens/lookup',
        body: { token: 'dt0c01.OTRO.OTRO' },
        schema: z.object({}).passthrough()
      })
    } catch (error) {
      caught = error
    }
    expect((caught as DtError).code).toBe('UNAUTHORIZED')
  })
})
