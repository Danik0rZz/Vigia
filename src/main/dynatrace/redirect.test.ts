import { readFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { errorReasonKeys } from '@shared/error-reasons'
import { createDtClient } from './client'
import { DtError } from './errors'
import { createOAuthTokenManager } from './oauth'

/**
 * Ficha 0060 (S-02): ninguna petición con credenciales sigue una redirección.
 * El cliente y el gestor OAuth llaman a `fetch` con `redirect: 'error'`, y una
 * 3xx se convierte en `DtError('NETWORK')` con el motivo `redirectRefused`.
 *
 * Dos niveles: un `fetch` simulado (qué opciones recibe y cómo se traduce el
 * rechazo) y servidores HTTP locales falsos en 127.0.0.1 con el `fetch` real de
 * Node, para ver que la petición no llega al destino de la redirección. Tokens
 * y secretos inventados.
 */

const ENV = 'env-redir'
const PUBLIC_ID = 'PUBLICAPRUEBA0000000000A'
const SECRET_PART = 'SECRETOCLASICO'.padEnd(64, 'X')
const CLASSIC_TOKEN = `dt0c01.${PUBLIC_ID}.${SECRET_PART}`
const PLATFORM_TOKEN = `dt0s16.${PUBLIC_ID}.${'SECRETOPLATFORM'.padEnd(64, 'X')}`
const CLIENT_SECRET = `dt0s02.CLIENTEPUBLICO00000000000.${'SECRETOOAUTH'.padEnd(64, 'X')}`
const SAAS = 'https://abc12345.live.dynatrace.com'
const PLATFORM = 'https://abc12345.apps.dynatrace.com'
const T0 = new Date('2026-10-03T10:00:00.000Z')

/** Rechazo real de `session.fetch` de Electron 44 con `redirect: 'error'` (ClientRequest). */
const electronRedirectError = (): Error =>
  new Error("Attempted to redirect, but redirect policy was 'error'")
/** Rechazo real del `fetch` de Node (undici) con `redirect: 'error'`. */
const nodeRedirectError = (): Error =>
  new TypeError('fetch failed', { cause: new Error('unexpected redirect') })

const anyObject = z.object({}).passthrough()

async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  return undefined
}

/** Todo lo que el error deja ver (mensaje y motivo con sus parámetros). */
function visible(error: unknown): string {
  const dt = error as DtError
  return `${dt.message} ${JSON.stringify(dt.reason ?? null)}`
}

/** Opción `redirect` efectiva de una llamada a fetch, venga como (url, init) o como Request. */
function redirectOf(call: unknown[]): RequestRedirect | undefined {
  const [input, init] = call as [unknown, RequestInit | undefined]
  if (init?.redirect !== undefined) return init.redirect
  return input instanceof Request ? input.redirect : undefined
}

function oauthStub(): {
  getToken: ReturnType<typeof vi.fn>
  invalidate: ReturnType<typeof vi.fn>
  expiresAt: ReturnType<typeof vi.fn>
} {
  return {
    getToken: vi.fn(async () => ({
      accessToken: 'oauth-access-1',
      expiresAt: new Date(T0.getTime() + 300_000),
      grantedScopes: []
    })),
    invalidate: vi.fn(),
    expiresAt: vi.fn(() => null)
  }
}

function clientWith(
  fetchImpl: typeof fetch,
  env: { classicApiUrl: string | null; platformUrl: string | null } = {
    classicApiUrl: SAAS,
    platformUrl: PLATFORM
  }
): ReturnType<typeof createDtClient> {
  const secrets: Record<string, string> = {
    classicToken: CLASSIC_TOKEN,
    platformToken: PLATFORM_TOKEN
  }
  return createDtClient({
    fetchFor: () => fetchImpl,
    getEnvironment: () => env,
    readSecret: (_envId: string, kind: string) => secrets[kind] ?? null,
    oauth: oauthStub(),
    sleep: vi.fn(async () => undefined),
    now: () => T0,
    random: () => 0.5,
    logger: { warn: vi.fn(), error: vi.fn() },
    tlsFailure: () => null
  } as unknown as Parameters<typeof createDtClient>[0])
}

function ok(body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })
}

const oauthCredentials = (
  ssoUrl: string
): Parameters<typeof createOAuthTokenManager>[0]['credentials'] =>
  vi.fn(async () => ({
    ssoUrl,
    clientId: 'dt0s02.CLIENTEPUBLICO00000000000',
    clientSecret: CLIENT_SECRET,
    scopes: ['storage:logs:read'],
    accountUuid: null
  }))

describe('CA1 (0060): las llamadas a fetch del cliente y del OAuth llevan redirect "error"', () => {
  it.each([
    ['classic', undefined],
    ['platform', undefined],
    ['platform', 'oauth']
  ] as const)('cliente, api %s con auth %s', async (api, auth) => {
    const fetchSpy = vi.fn(async () => ok())
    await clientWith(fetchSpy as unknown as typeof fetch).dtRequest({
      envId: ENV,
      api,
      path: api === 'classic' ? '/problems' : '/platform/management/v1/environment',
      schema: anyObject,
      ...(auth === undefined ? {} : { auth })
    })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(redirectOf(fetchSpy.mock.calls[0] as unknown[])).toBe('error')
  })

  it('cliente: también en un POST con cuerpo y en el reintento tras un 429', async () => {
    const responses = [
      new Response(JSON.stringify({ error: { code: 429, message: 'Too many requests' } }), {
        status: 429,
        headers: { 'content-type': 'application/json', 'retry-after': '1' }
      }),
      ok({ enabled: true })
    ]
    const fetchSpy = vi.fn(async () => responses.shift() ?? ok())
    await clientWith(fetchSpy as unknown as typeof fetch).dtRequest({
      envId: ENV,
      api: 'classic',
      method: 'POST',
      path: '/apiTokens/lookup',
      body: { token: CLASSIC_TOKEN },
      schema: anyObject
    })
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    for (const call of fetchSpy.mock.calls) expect(redirectOf(call as unknown[])).toBe('error')
  })

  it('OAuth: la petición del token al SSO', async () => {
    const fetchSpy = vi.fn(async () =>
      ok({ access_token: 'access-1', expires_in: 300, token_type: 'Bearer' })
    )
    const oauth = createOAuthTokenManager({
      fetch: fetchSpy as unknown as typeof fetch,
      now: () => T0,
      credentials: oauthCredentials('https://sso.dynatrace.com/sso/oauth2/token')
    })
    await oauth.getToken(ENV)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(redirectOf(fetchSpy.mock.calls[0] as unknown[])).toBe('error')
  })
})

describe('CA2 (0060): un rechazo por redirección da NETWORK con reason redirectRefused', () => {
  it.each([
    ['session.fetch de Electron', electronRedirectError],
    ['fetch de Node (undici)', nodeRedirectError]
  ])('rechazo de %s', async (_label, rejection) => {
    const fetchSpy = vi.fn(async () => {
      throw rejection()
    })
    const error = await caught(
      clientWith(fetchSpy as unknown as typeof fetch).dtRequest({
        envId: ENV,
        api: 'classic',
        path: '/problems',
        query: { problemSelector: 'status("open")' },
        schema: anyObject
      })
    )
    expect(error).toBeInstanceOf(DtError)
    expect((error as DtError).code).toBe('NETWORK')
    expect((error as DtError).reason?.key).toBe('redirectRefused')
    // Nada de credenciales en lo que se registra o se enseña.
    expect(visible(error)).not.toContain(SECRET_PART)
    expect(visible(error)).not.toContain('Api-Token')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('un fallo de red que no es una redirección sigue siendo el motivo network', async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error('net::ERR_CONNECTION_REFUSED')
    })
    const error = await caught(
      clientWith(fetchSpy as unknown as typeof fetch).dtRequest({
        envId: ENV,
        api: 'classic',
        path: '/problems',
        schema: anyObject
      })
    )
    expect((error as DtError).code).toBe('NETWORK')
    expect((error as DtError).reason?.key).toBe('network')
  })
})

/* ------------------------------------------------------------------------ */
/* Servidores HTTP locales falsos y el fetch real de Node.                   */
/* ------------------------------------------------------------------------ */

interface Seen {
  method: string
  path: string
  authorization: string | undefined
  body: string
}

interface FakeServer {
  server: Server
  port: number
  seen: Seen[]
  /** Qué responde a cada ruta: [estado, cabeceras]. Por defecto, 200 con {}. */
  routes: Map<string, { status: number; headers: Record<string, string> }>
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let raw = ''
    req.on('data', (chunk: Buffer) => (raw += chunk.toString('utf8')))
    req.on('end', () => resolve(raw))
  })
}

async function startServer(host: string | undefined): Promise<FakeServer> {
  const fake: FakeServer = {
    server: undefined as unknown as Server,
    port: 0,
    seen: [],
    routes: new Map()
  }
  fake.server = createServer((req, res) => {
    void readBody(req).then((body) => {
      const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
      fake.seen.push({
        method: req.method ?? '',
        path,
        authorization: req.headers.authorization,
        body
      })
      const route = fake.routes.get(path)
      if (route !== undefined) {
        res.writeHead(route.status, route.headers)
        res.end()
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        path.endsWith('/oauth2/token')
          ? JSON.stringify({ access_token: 'robado', expires_in: 300, token_type: 'Bearer' })
          : JSON.stringify({ totalCount: 0, problems: [] })
      )
    })
  })
  await new Promise<void>((resolve) => fake.server.listen(0, host, resolve))
  fake.port = (fake.server.address() as AddressInfo).port
  return fake
}

let origin: FakeServer
/** Destino de las redirecciones: escucha en todas las interfaces (127.0.0.1 y localhost). */
let target: FakeServer

beforeAll(async () => {
  origin = await startServer('127.0.0.1')
  target = await startServer(undefined)
})

afterAll(async () => {
  await Promise.all(
    [origin, target].map((s) => new Promise<void>((resolve) => s.server.close(() => resolve())))
  )
})

beforeEach(() => {
  origin.seen = []
  origin.routes.clear()
  target.seen = []
  target.routes.clear()
})

describe('CA1 y CA2 (0060): contra servidores locales, ninguna 3xx se sigue', () => {
  const originBase = (): string => `http://127.0.0.1:${origin.port}`

  // El origen es http: el fetch de Node no confía en un certificado autofirmado
  // sin tocar la configuración global de TLS. El cambio de esquema se prueba de
  // http a https; el mecanismo (rechazar toda 3xx) es el mismo en sentido contrario.
  const cases: [string, number, () => string, () => Seen[]][] = [
    [
      'mismo origen, otra ruta',
      302,
      () => `${originBase()}/api/v2/otra-ruta`,
      () => origin.seen.filter((s) => s.path === '/api/v2/otra-ruta')
    ],
    [
      'otro puerto',
      307,
      () => `http://127.0.0.1:${target.port}/api/v2/problems`,
      () => target.seen
    ],
    ['otro host', 301, () => `http://localhost:${target.port}/api/v2/problems`, () => target.seen],
    [
      'otro esquema, con credenciales en la URL',
      308,
      () => `https://usuario:clave-inventada@localhost:${target.port}/api/v2/problems`,
      () => target.seen
    ]
  ]

  it.each(cases)('cliente: %s (%i)', async (_label, status, location, reached) => {
    origin.routes.set('/api/v2/problems', { status, headers: { location: location() } })
    const error = await caught(
      clientWith(globalThis.fetch, { classicApiUrl: originBase(), platformUrl: null }).dtRequest({
        envId: ENV,
        api: 'classic',
        path: '/problems',
        schema: anyObject
      })
    )
    expect(error).toBeInstanceOf(DtError)
    expect((error as DtError).code).toBe('NETWORK')
    expect((error as DtError).reason?.key).toBe('redirectRefused')
    expect(visible(error)).not.toContain(SECRET_PART)
    expect(visible(error)).not.toContain('clave-inventada')
    // La petición con el token llegó al origen una vez y a ningún otro sitio.
    expect(origin.seen.filter((s) => s.path === '/api/v2/problems')).toHaveLength(1)
    expect(reached()).toEqual([])
  })

  it('OAuth: un 307 del SSO no reenvía el client_secret al destino', async () => {
    origin.routes.set('/sso/oauth2/token', {
      status: 307,
      headers: { location: `http://127.0.0.1:${target.port}/sso/oauth2/token` }
    })
    const oauth = createOAuthTokenManager({
      fetch: globalThis.fetch,
      now: () => T0,
      credentials: oauthCredentials(`${originBase()}/sso/oauth2/token`)
    })
    const error = await caught(oauth.getToken(ENV))
    expect(error).toBeInstanceOf(DtError)
    expect((error as DtError).code).toBe('NETWORK')
    expect(visible(error)).not.toContain(CLIENT_SECRET)
    expect(origin.seen).toHaveLength(1)
    expect(target.seen).toEqual([])
  })
})

describe('CA5 (0060): el motivo redirectRefused tiene texto en es y en', () => {
  const reasons = (locale: 'es' | 'en'): Record<string, unknown> =>
    (
      JSON.parse(
        readFileSync(join('src', 'renderer', 'src', 'locales', locale, 'common.json'), 'utf8')
      ) as { errorReasons?: Record<string, unknown> }
    ).errorReasons ?? {}

  it('la clave está en errorReasonKeys', () => {
    expect(errorReasonKeys as readonly string[]).toContain('redirectRefused')
  })

  it('es: el texto de la ficha; en: un texto propio, sin parámetros', () => {
    const es = reasons('es')['redirectRefused']
    const en = reasons('en')['redirectRefused']
    expect(es).toMatch(/^La URL del entorno redirige a otra dirección; usa la URL final\.?$/)
    expect(typeof en).toBe('string')
    expect(String(en).trim()).not.toBe('')
    expect(en).not.toBe(es)
    expect(String(es)).not.toMatch(/\{\{/)
    expect(String(en)).not.toMatch(/\{\{/)
  })
})
