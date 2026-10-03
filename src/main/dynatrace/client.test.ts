import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { DT_ENDPOINTS, type DtListEndpoint } from '@shared/dt-endpoints'
import { createDtClient } from './client'
import { DtError } from './errors'

/**
 * Cliente HTTP común (spec, "Cliente HTTP común"): mecanismo según la API,
 * renovación OAuth ante 401, esperas ante 429, timeout, errores de red y TLS,
 * validación de respuestas, paginación y que nada secreto acabe en errores o logs.
 */

const ENV = 'env-1'
const PUBLIC_ID = 'PUBLICAPRUEBA0000000000A'
const CLASSIC_TOKEN = `dt0c01.${PUBLIC_ID}.${'SECRETOCLASICO'.padEnd(64, 'X')}`
const PLATFORM_TOKEN = `dt0s16.${PUBLIC_ID}.${'SECRETOPLATFORM'.padEnd(64, 'X')}`
const SAAS = 'https://abc12345.live.dynatrace.com'
const MANAGED = 'https://dt.ejemplo.local/e/abc-123'
const PLATFORM = 'https://abc12345.apps.dynatrace.com'
const T0 = new Date('2026-10-03T10:00:00.000Z')

type Env = { classicApiUrl: string | null; platformUrl: string | null }
type Secrets = Partial<Record<'classicToken' | 'oauthClientSecret' | 'platformToken', string>>

let environment: Env | null
let secrets: Secrets
let responses: (Response | Error | ((init: RequestInit | undefined) => Promise<Response>))[]
let fetchSpy: ReturnType<typeof vi.fn>
let sleep: ReturnType<typeof vi.fn>
let logger: { warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> }
let oauthIssued: number
let oauth: {
  getToken: ReturnType<typeof vi.fn>
  invalidate: ReturnType<typeof vi.fn>
  expiresAt: ReturnType<typeof vi.fn>
}
let tlsFailure: ReturnType<typeof vi.fn>

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  })
}

/** Error con el formato de la API v2 y de plataforma. */
function dtError(status: number, message: string, extra: Record<string, unknown> = {}): Response {
  return json(status, { error: { code: status, message, ...extra } })
}

beforeEach(() => {
  environment = { classicApiUrl: SAAS, platformUrl: PLATFORM }
  secrets = { classicToken: CLASSIC_TOKEN }
  responses = []
  fetchSpy = vi.fn(async (_input: unknown, init?: RequestInit) => {
    const next = responses.shift()
    if (next === undefined) throw new Error('la prueba no esperaba más peticiones')
    if (next instanceof Error) throw next
    if (typeof next === 'function') return next(init)
    return next
  })
  sleep = vi.fn(async () => undefined)
  logger = { warn: vi.fn(), error: vi.fn() }
  oauthIssued = 0
  oauth = {
    getToken: vi.fn(async () => {
      if (secrets.oauthClientSecret === undefined) {
        throw new DtError('NO_CREDENTIAL', 'Sin credenciales OAuth')
      }
      oauthIssued += 1
      return {
        accessToken: `oauth-access-${oauthIssued}`,
        expiresAt: new Date(T0.getTime() + 300_000),
        grantedScopes: []
      }
    }),
    invalidate: vi.fn(),
    expiresAt: vi.fn(() => null)
  }
  tlsFailure = vi.fn(() => 'untrusted')
})

function client(extra: Record<string, unknown> = {}): ReturnType<typeof createDtClient> {
  return createDtClient({
    fetchFor: () => fetchSpy as unknown as typeof fetch,
    getEnvironment: () => environment,
    readSecret: (_envId: string, kind: keyof Secrets) => secrets[kind] ?? null,
    oauth,
    sleep,
    now: () => T0,
    random: () => 0.5,
    logger,
    ...extra
  } as unknown as Parameters<typeof createDtClient>[0])
}

/** Datos de una llamada a fetch, venga como (url, init) o como Request. */
function sent(call = 0): { url: URL; method: string; headers: Headers; body: string | null } {
  const [input, init] = fetchSpy.mock.calls[call] as [unknown, RequestInit | undefined]
  if (input instanceof Request) {
    return {
      url: new URL(input.url),
      method: input.method,
      headers: input.headers,
      body: init?.body === undefined ? null : String(init.body)
    }
  }
  return {
    url: new URL(String(input)),
    method: (init?.method ?? 'GET').toUpperCase(),
    headers: new Headers(init?.headers),
    body: init?.body === undefined || init.body === null ? null : String(init.body)
  }
}

async function expectDtError(promise: Promise<unknown>, code: string): Promise<DtError> {
  let caught: unknown
  try {
    await promise
  } catch (error) {
    caught = error
  }
  expect(caught, `se esperaba DtError ${code}`).toBeInstanceOf(DtError)
  expect((caught as DtError).code).toBe(code)
  return caught as DtError
}

const anyObject = z.object({}).passthrough()

describe('API clásica', () => {
  it('construye la URL con /api/v2, la query y la cabecera Api-Token', async () => {
    responses.push(json(200, { ok: true }))
    const result = await client().dtRequest({
      envId: ENV,
      api: 'classic',
      path: '/problems',
      query: {
        fields: '+evidenceDetails',
        entitySelector: ['type(HOST)', 'tag(core)'],
        from: undefined
      },
      schema: z.object({ ok: z.boolean() })
    })

    expect(result).toEqual({ ok: true })
    const request = sent()
    expect(`${request.url.origin}${request.url.pathname}`).toBe(`${SAAS}/api/v2/problems`)
    expect(request.method).toBe('GET')
    expect(request.url.searchParams.get('fields')).toBe('+evidenceDetails')
    expect(request.url.searchParams.getAll('entitySelector')).toEqual(['type(HOST)', 'tag(core)'])
    expect(request.url.searchParams.has('from')).toBe(false)
    expect(request.headers.get('authorization')).toBe(`Api-Token ${CLASSIC_TOKEN}`)
  })

  it('en Managed conserva la ruta /e/<id> de la URL base', async () => {
    environment = { classicApiUrl: MANAGED, platformUrl: null }
    responses.push(json(200, {}))
    await client().dtRequest({ envId: ENV, api: 'classic', path: '/problems', schema: anyObject })
    expect(`${sent().url.origin}${sent().url.pathname}`).toBe(`${MANAGED}/api/v2/problems`)
  })

  it('manda el body en JSON con su content-type', async () => {
    responses.push(json(200, {}))
    await client().dtRequest({
      envId: ENV,
      api: 'classic',
      method: 'POST',
      path: '/apiTokens/lookup',
      body: { token: CLASSIC_TOKEN },
      schema: anyObject
    })
    const request = sent()
    expect(request.method).toBe('POST')
    expect(request.headers.get('content-type')).toContain('application/json')
    expect(JSON.parse(request.body ?? '')).toEqual({ token: CLASSIC_TOKEN })
  })

  it.each([
    ['sin URL clásica', () => (environment = { classicApiUrl: null, platformUrl: PLATFORM })],
    ['sin token clásico', () => (secrets = {})],
    ['sin entorno', () => (environment = null)]
  ])('%s da NO_CREDENTIAL sin llamar a la red', async (_case, setup) => {
    setup()
    await expectDtError(
      client().dtRequest({ envId: ENV, api: 'classic', path: '/problems', schema: anyObject }),
      'NO_CREDENTIAL'
    )
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('API de plataforma', () => {
  const path = '/platform/management/v1/environment'

  it('usa el platform token antes que OAuth, con la ruta absoluta desde platformUrl', async () => {
    secrets = { platformToken: PLATFORM_TOKEN, oauthClientSecret: 'dt0s02.X.Y' }
    responses.push(json(200, {}))
    await client().dtRequest({ envId: ENV, api: 'platform', path, schema: anyObject })

    expect(`${sent().url.origin}${sent().url.pathname}`).toBe(`${PLATFORM}${path}`)
    expect(sent().headers.get('authorization')).toBe(`Bearer ${PLATFORM_TOKEN}`)
    expect(oauth.getToken).not.toHaveBeenCalled()
  })

  it('sin platform token usa el access token de OAuth', async () => {
    secrets = { oauthClientSecret: 'dt0s02.X.Y' }
    responses.push(json(200, {}))
    await client().dtRequest({ envId: ENV, api: 'platform', path, schema: anyObject })
    expect(sent().headers.get('authorization')).toBe('Bearer oauth-access-1')
  })

  it("auth: 'oauth' fuerza OAuth aunque haya platform token", async () => {
    secrets = { platformToken: PLATFORM_TOKEN, oauthClientSecret: 'dt0s02.X.Y' }
    responses.push(json(200, {}))
    await client().dtRequest({
      envId: ENV,
      api: 'platform',
      path,
      auth: 'oauth',
      schema: anyObject
    })
    expect(sent().headers.get('authorization')).toBe('Bearer oauth-access-1')
  })

  it("auth: 'platformToken' sin platform token da NO_CREDENTIAL", async () => {
    secrets = { oauthClientSecret: 'dt0s02.X.Y' }
    await expectDtError(
      client().dtRequest({
        envId: ENV,
        api: 'platform',
        path,
        auth: 'platformToken',
        schema: anyObject
      }),
      'NO_CREDENTIAL'
    )
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it.each([
    ['sin platform token ni OAuth', () => (secrets = { classicToken: CLASSIC_TOKEN })],
    [
      'sin URL de plataforma',
      () => {
        environment = { classicApiUrl: SAAS, platformUrl: null }
        secrets = { platformToken: PLATFORM_TOKEN }
      }
    ]
  ])('%s da NO_CREDENTIAL sin llamar a la red', async (_case, setup) => {
    setup()
    await expectDtError(
      client().dtRequest({ envId: ENV, api: 'platform', path, schema: anyObject }),
      'NO_CREDENTIAL'
    )
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('401', () => {
  const path = '/platform/management/v1/environment'

  it('con OAuth invalida, pide un token nuevo y reintenta una vez', async () => {
    secrets = { oauthClientSecret: 'dt0s02.X.Y' }
    responses.push(dtError(401, 'Token caducado'), json(200, { ok: true }))
    const result = await client().dtRequest({
      envId: ENV,
      api: 'platform',
      path,
      schema: anyObject
    })

    expect(result).toEqual({ ok: true })
    expect(oauth.invalidate).toHaveBeenCalledWith(ENV)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(sent(0).headers.get('authorization')).toBe('Bearer oauth-access-1')
    expect(sent(1).headers.get('authorization')).toBe('Bearer oauth-access-2')
  })

  it('con OAuth, un segundo 401 da UNAUTHORIZED sin más reintentos', async () => {
    secrets = { oauthClientSecret: 'dt0s02.X.Y' }
    responses.push(dtError(401, 'No'), dtError(401, 'Sigue sin valer'))
    await expectDtError(
      client().dtRequest({ envId: ENV, api: 'platform', path, schema: anyObject }),
      'UNAUTHORIZED'
    )
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['token clásico', 'classic', '/problems', { classicToken: CLASSIC_TOKEN }],
    ['platform token', 'platform', path, { platformToken: PLATFORM_TOKEN }]
  ] as const)('con %s da UNAUTHORIZED sin reintentar', async (_case, api, p, s) => {
    secrets = { ...s }
    responses.push(dtError(401, 'Token no válido'))
    await expectDtError(
      client().dtRequest({ envId: ENV, api, path: p, schema: anyObject }),
      'UNAUTHORIZED'
    )
    expect(fetchSpy).toHaveBeenCalledOnce()
    expect(oauth.invalidate).not.toHaveBeenCalled()
  })

  it('un 401 cuyo cuerpo trae el token no lo deja en el error', async () => {
    responses.push(dtError(401, `Token ${CLASSIC_TOKEN} no válido`))
    const error = await expectDtError(
      client().dtRequest({ envId: ENV, api: 'classic', path: '/problems', schema: anyObject }),
      'UNAUTHORIZED'
    )
    expect(error.status).toBe(401)
    expect(error.message).not.toContain('SECRETOCLASICO')
    expect(JSON.stringify({ ...error, message: error.message })).not.toContain('SECRETOCLASICO')
  })
})

describe('otros códigos HTTP', () => {
  it('403 da FORBIDDEN con los scopes que faltan en el mensaje', async () => {
    responses.push(
      dtError(403, 'Token is missing required scope', {
        details: { missingScopes: ['problems.read'] }
      })
    )
    const error = await expectDtError(
      client().dtRequest({ envId: ENV, api: 'classic', path: '/problems', schema: anyObject }),
      'FORBIDDEN'
    )
    expect(error.status).toBe(403)
    expect(error.message).toContain('problems.read')
  })

  it('404 da NOT_FOUND con el mensaje de Dynatrace', async () => {
    responses.push(dtError(404, 'Problem P-123 not found'))
    const error = await expectDtError(
      client().dtRequest({
        envId: ENV,
        api: 'classic',
        path: '/problems/P-123',
        schema: anyObject
      }),
      'NOT_FOUND'
    )
    expect(error.message).toContain('Problem P-123 not found')
  })

  it.each([500, 502, 503])('%d da SERVER_ERROR sin reintentar', async (status) => {
    responses.push(dtError(status, 'Fallo interno'))
    await expectDtError(
      client().dtRequest({ envId: ENV, api: 'classic', path: '/problems', schema: anyObject }),
      'SERVER_ERROR'
    )
    expect(fetchSpy).toHaveBeenCalledOnce()
    expect(sleep).not.toHaveBeenCalled()
  })
})

describe('429', () => {
  const request = (): Promise<unknown> =>
    client().dtRequest({ envId: ENV, api: 'classic', path: '/problems', schema: anyObject })

  it('espera lo que diga Retry-After y reintenta', async () => {
    responses.push(
      json(429, { error: { code: 429, message: 'Too many' } }, { 'retry-after': '2' }),
      json(200, { ok: true })
    )
    expect(await request()).toEqual({ ok: true })
    expect(sleep.mock.calls.map((call) => call[0])).toEqual([2000])
  })

  it('acepta un Retry-After de 60 s justos', async () => {
    responses.push(json(429, {}, { 'retry-after': '60' }), json(200, {}))
    await request()
    expect(sleep.mock.calls.map((call) => call[0])).toEqual([60_000])
  })

  it('con un Retry-After de más de 60 s da RATE_LIMITED sin esperar', async () => {
    responses.push(json(429, {}, { 'retry-after': '120' }))
    await expectDtError(request(), 'RATE_LIMITED')
    expect(sleep).not.toHaveBeenCalled()
    expect(fetchSpy).toHaveBeenCalledOnce()
  })

  it('sin Retry-After hace backoff exponencial 1 s, 2 s, 4 s con jitter', async () => {
    responses.push(json(429, {}), json(429, {}), json(429, {}), json(200, { ok: true }))
    expect(await request()).toEqual({ ok: true })
    // random() = 0,5 → jitter de 125 ms.
    expect(sleep.mock.calls.map((call) => call[0])).toEqual([1125, 2125, 4125])
  })

  it('el cuarto 429 da RATE_LIMITED tras 3 reintentos', async () => {
    responses.push(json(429, {}), json(429, {}), json(429, {}), json(429, {}))
    await expectDtError(request(), 'RATE_LIMITED')
    expect(fetchSpy).toHaveBeenCalledTimes(4)
    expect(sleep).toHaveBeenCalledTimes(3)
  })

  it('el jitter nunca pasa de 250 ms', async () => {
    responses.push(json(429, {}), json(200, {}))
    await client({ random: () => 0.999999 }).dtRequest({
      envId: ENV,
      api: 'classic',
      path: '/problems',
      schema: anyObject
    })
    const wait = sleep.mock.calls[0]?.[0] as number
    expect(wait).toBeGreaterThanOrEqual(1000)
    expect(wait).toBeLessThanOrEqual(1250)
  })
})

describe('timeout y red', () => {
  /** fetch que solo termina cuando se aborta su señal. */
  const hanging = (init: RequestInit | undefined): Promise<Response> =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () =>
        reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }))
      )
    })

  it('da TIMEOUT si no responde a tiempo (timeoutMs del cliente)', async () => {
    responses.push(hanging)
    await expectDtError(
      client({ timeoutMs: 30 }).dtRequest({
        envId: ENV,
        api: 'classic',
        path: '/problems',
        schema: anyObject
      }),
      'TIMEOUT'
    )
  })

  it('respeta el timeoutMs de la petición', async () => {
    responses.push(hanging)
    await expectDtError(
      client().dtRequest({
        envId: ENV,
        api: 'classic',
        path: '/problems',
        schema: anyObject,
        timeoutMs: 30
      }),
      'TIMEOUT'
    )
  })

  it('un error de certificado da TLS_UNTRUSTED', async () => {
    responses.push(new Error('net::ERR_CERT_AUTHORITY_INVALID'))
    await expectDtError(
      client().dtRequest({ envId: ENV, api: 'classic', path: '/problems', schema: anyObject }),
      'TLS_UNTRUSTED'
    )
  })

  it('con tlsFailure que dice "mismatch" da TLS_PIN_MISMATCH y recibe el host', async () => {
    tlsFailure.mockReturnValue('mismatch')
    responses.push(new Error('net::ERR_CERT_INVALID'))
    await expectDtError(
      client({ tlsFailure }).dtRequest({
        envId: ENV,
        api: 'classic',
        path: '/problems',
        schema: anyObject
      }),
      'TLS_PIN_MISMATCH'
    )
    expect(tlsFailure).toHaveBeenCalledWith(ENV, 'abc12345.live.dynatrace.com')
  })

  it('cualquier otro fallo de red da NETWORK', async () => {
    responses.push(new Error('net::ERR_CONNECTION_REFUSED'))
    await expectDtError(
      client().dtRequest({ envId: ENV, api: 'classic', path: '/problems', schema: anyObject }),
      'NETWORK'
    )
  })
})

describe('validación de la respuesta', () => {
  it('una respuesta que no cumple el esquema da INVALID_RESPONSE', async () => {
    responses.push(json(200, { totalCount: 'muchos' }))
    await expectDtError(
      client().dtRequest({
        envId: ENV,
        api: 'classic',
        path: '/problems',
        schema: z.object({ totalCount: z.number() })
      }),
      'INVALID_RESPONSE'
    )
  })

  it('una respuesta que no es JSON da INVALID_RESPONSE', async () => {
    responses.push(
      new Response('<html>proxy</html>', { status: 200, headers: { 'content-type': 'text/html' } })
    )
    await expectDtError(
      client().dtRequest({ envId: ENV, api: 'classic', path: '/problems', schema: anyObject }),
      'INVALID_RESPONSE'
    )
  })
})

describe('nada secreto en el log', () => {
  it('un lookup que recibe 429, 401 y 500 con el token en el cuerpo no lo registra', async () => {
    const tokenBody = {
      error: { code: 0, message: `Token ${CLASSIC_TOKEN}` },
      token: CLASSIC_TOKEN
    }
    const lookup = (): Promise<unknown> =>
      client().dtRequest({
        envId: ENV,
        api: 'classic',
        method: 'POST',
        path: '/apiTokens/lookup',
        body: { token: CLASSIC_TOKEN },
        schema: anyObject
      })

    responses.push(json(429, tokenBody), json(401, tokenBody))
    const unauthorized = await expectDtError(lookup(), 'UNAUTHORIZED')
    responses.push(json(500, tokenBody))
    const serverError = await expectDtError(lookup(), 'SERVER_ERROR')

    const logged = [...logger.warn.mock.calls, ...logger.error.mock.calls]
      .flat()
      .map((arg) =>
        arg instanceof Error
          ? `${arg.message} ${arg.stack ?? ''} ${JSON.stringify(arg)}`
          : JSON.stringify(arg)
      )
      .join('\n')
    expect(logger.warn.mock.calls.length + logger.error.mock.calls.length).toBeGreaterThan(0)
    expect(logged).not.toContain('SECRETOCLASICO')
    for (const error of [unauthorized, serverError]) {
      expect(error.message).not.toContain('SECRETOCLASICO')
      expect(JSON.stringify({ ...error, message: error.message })).not.toContain('SECRETOCLASICO')
    }
  })
})

describe('paginate', () => {
  const item = z.object({ id: z.string() })
  /** Lista genérica de prueba: sin parámetros que se repitan. */
  const X: DtListEndpoint = { path: '/x', itemsKey: 'items', keepOnNextPage: [] }

  it('junta las páginas y en las siguientes manda SOLO nextPageKey y fields, sin pedir nada al módulo', async () => {
    responses.push(
      json(200, { problems: [{ id: 'a' }, { id: 'b' }], nextPageKey: 'k1' }),
      json(200, { problems: [{ id: 'c' }], nextPageKey: 'k2' }),
      json(200, { problems: [{ id: 'd' }], nextPageKey: null })
    )

    const page = await client().paginate({
      envId: ENV,
      api: 'classic',
      endpoint: DT_ENDPOINTS.problems,
      query: {
        fields: '+evidenceDetails',
        problemSelector: 'status("open")',
        entitySelector: 'type(SERVICE)',
        from: 'now-2h',
        pageSize: 2
      },
      schema: item
    })

    expect(page).toEqual({
      items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }],
      truncated: false
    })
    expect(fetchSpy).toHaveBeenCalledTimes(3)
    expect(logger.warn).not.toHaveBeenCalled()
    expect(Object.fromEntries(sent(0).url.searchParams)).toEqual({
      fields: '+evidenceDetails',
      problemSelector: 'status("open")',
      entitySelector: 'type(SERVICE)',
      from: 'now-2h',
      pageSize: '2'
    })
    expect(Object.fromEntries(sent(1).url.searchParams)).toEqual({
      nextPageKey: 'k1',
      fields: '+evidenceDetails'
    })
    expect(Object.fromEntries(sent(2).url.searchParams)).toEqual({
      nextPageKey: 'k2',
      fields: '+evidenceDetails'
    })
  })

  it('sin fields en la primera página, las siguientes llevan solo nextPageKey', async () => {
    responses.push(
      json(200, { items: [{ id: 'a' }], nextPageKey: 'k1' }),
      json(200, { items: [{ id: 'b' }], nextPageKey: 'k2' }),
      json(200, { items: [{ id: 'c' }] })
    )
    const page = await client().paginate({
      envId: ENV,
      api: 'classic',
      endpoint: X,
      query: { from: 'now-7d', pageSize: 1, entitySelector: 'type(HOST)', extra: ['a', 'b'] },
      schema: item
    })
    expect(page.items.map((i) => i.id)).toEqual(['a', 'b', 'c'])
    expect([...sent(1).url.searchParams.entries()]).toEqual([['nextPageKey', 'k1']])
    expect([...sent(2).url.searchParams.entries()]).toEqual([['nextPageKey', 'k2']])
  })

  // Los @ts-expect-error de estos tests los comprueba `npm run typecheck`, no Vitest.
  it('keepParams ya no existe en el tipo de paginate', () => {
    // Si alguien vuelve a añadir keepParams al tipo, esta línea deja de ser un error y tsc falla.
    const call = (): unknown =>
      client().paginate({
        envId: ENV,
        api: 'classic',
        endpoint: X,
        // @ts-expect-error keepParams se eliminó: la regla de páginas siguientes es fija.
        keepParams: ['fields'],
        schema: item
      })
    expect(typeof call).toBe('function')
  })

  it.each(['entities', 'slo', 'events'] as const)(
    '%s: la página 2 lleva SOLO nextPageKey aunque la primera llevara fields',
    async (name) => {
      const endpoint = DT_ENDPOINTS[name]
      responses.push(
        json(200, { [endpoint.itemsKey]: [{ id: 'a' }], nextPageKey: 'k1' }),
        json(200, { [endpoint.itemsKey]: [{ id: 'b' }] })
      )
      const page = await client().paginate({
        envId: ENV,
        api: 'classic',
        endpoint,
        query: { fields: '+x', from: 'now-2h', pageSize: 1, entitySelector: 'type(HOST)' },
        schema: item
      })
      expect(page.items.map((i) => i.id)).toEqual(['a', 'b'])
      expect(`${sent(0).url.pathname}`).toBe(`/api/v2${endpoint.path}`)
      expect([...sent(1).url.searchParams.entries()]).toEqual([['nextPageKey', 'k1']])
    }
  )

  it('lee los elementos de la clave del descriptor (eventTypes → eventTypeInfos)', async () => {
    responses.push(json(200, { eventTypeInfos: [{ id: 'a' }], nextPageKey: null }))
    const page = await client().paginate({
      envId: ENV,
      api: 'classic',
      endpoint: DT_ENDPOINTS.eventTypes,
      schema: item
    })
    expect(page.items).toEqual([{ id: 'a' }])
  })

  it('endpoint es obligatorio: sin él (o con path/itemsKey sueltos) tsc falla', () => {
    const call = (): unknown =>
      // @ts-expect-error falta endpoint: paginate exige el descriptor.
      client().paginate({ envId: ENV, api: 'classic', schema: item })
    const legacy = (): unknown =>
      client().paginate({
        envId: ENV,
        api: 'classic',
        endpoint: X,
        // @ts-expect-error path ya no se pasa suelto: va en el descriptor.
        path: '/x',
        schema: item
      })
    expect(typeof call).toBe('function')
    expect(typeof legacy).toBe('function')
  })

  it('para cuando no viene nextPageKey', async () => {
    responses.push(json(200, { items: [{ id: 'a' }] }))
    const page = await client().paginate({
      envId: ENV,
      api: 'classic',
      endpoint: X,
      schema: item
    })
    expect(page).toEqual({ items: [{ id: 'a' }], truncated: false })
    expect(fetchSpy).toHaveBeenCalledOnce()
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('al llegar a maxPages con más páginas pendientes devuelve truncated y lo avisa en el log', async () => {
    responses.push(
      json(200, { items: [{ id: 'a' }], nextPageKey: 'k1' }),
      json(200, { items: [{ id: 'b' }], nextPageKey: 'k2' }),
      json(200, { items: [{ id: 'c' }], nextPageKey: 'k3' })
    )
    const page = await client().paginate({
      envId: ENV,
      api: 'classic',
      endpoint: X,
      query: { entitySelector: 'type(HOST)' },
      maxPages: 2,
      schema: item
    })
    expect(page).toEqual({ items: [{ id: 'a' }, { id: 'b' }], truncated: true })
    expect(fetchSpy).toHaveBeenCalledTimes(2)

    expect(logger.warn).toHaveBeenCalledOnce()
    const logged = JSON.stringify(logger.warn.mock.calls[0])
    expect(logged).toContain('/x')
    expect(logged).toContain('2')
    // Sin query, sin nextPageKey y sin credenciales.
    for (const forbidden of ['type(HOST)', 'k2', 'SECRETOCLASICO']) {
      expect(logged).not.toContain(forbidden)
    }
  })

  it('justo en maxPages pero sin más páginas no está truncado', async () => {
    responses.push(
      json(200, { items: [{ id: 'a' }], nextPageKey: 'k1' }),
      json(200, { items: [{ id: 'b' }], nextPageKey: null })
    )
    const page = await client().paginate({
      envId: ENV,
      api: 'classic',
      endpoint: X,
      maxPages: 2,
      schema: item
    })
    expect(page).toEqual({ items: [{ id: 'a' }, { id: 'b' }], truncated: false })
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('un item que no cumple el esquema da INVALID_RESPONSE', async () => {
    responses.push(json(200, { items: [{ id: 1 }] }))
    await expectDtError(
      client().paginate({
        envId: ENV,
        api: 'classic',
        endpoint: X,
        schema: item
      }),
      'INVALID_RESPONSE'
    )
  })
})
