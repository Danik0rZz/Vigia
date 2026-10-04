import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DtError } from './errors'
import { createOAuthTokenManager } from './oauth'

/**
 * Gestor de tokens OAuth de plataforma (spec, "OAuth de plataforma"): token en
 * memoria por entorno, expires_in de la respuesta, renovación con menos de
 * 60 s, una sola renovación compartida e invalidación.
 */

const ENV = 'env-1'
const CLIENT_SECRET = `dt0s02.CLIENTEPUBLICO00000000000.${'SECRETOOAUTH'.padEnd(64, 'X')}`
const T0 = new Date('2026-10-03T10:00:00.000Z')

type Credentials = {
  ssoUrl: string
  clientId: string
  clientSecret: string
  scopes: string[]
  accountUuid: string | null
}

const baseCredentials: Credentials = {
  ssoUrl: 'https://sso.dynatrace.com/sso/oauth2/token',
  clientId: 'dt0s02.CLIENTEPUBLICO00000000000',
  clientSecret: CLIENT_SECRET,
  scopes: ['storage:logs:read', 'environment-api:problems:read'],
  accountUuid: '7a1b2c3d-0000-4000-8000-000000000000'
}

let clock: Date
let credentials: Credentials | null
let issued: number

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

/** SSO falso: cada token es distinto (access-1, access-2…). */
function okToken(expiresIn = 300, scope?: string): () => Promise<Response> {
  return async () => {
    issued += 1
    return json(200, {
      access_token: `access-${issued}`,
      expires_in: expiresIn,
      token_type: 'Bearer',
      ...(scope === undefined ? {} : { scope })
    })
  }
}

function manager(fetchImpl: (...args: unknown[]) => Promise<Response>): {
  oauth: ReturnType<typeof createOAuthTokenManager>
  fetchSpy: ReturnType<typeof vi.fn>
} {
  const fetchSpy = vi.fn(fetchImpl)
  const oauth = createOAuthTokenManager({
    fetch: fetchSpy as unknown as typeof fetch,
    now: () => clock,
    credentials: async () => credentials
  })
  return { oauth, fetchSpy }
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

/** Body de la petición al SSO, sea string o URLSearchParams. */
function sentForm(fetchSpy: ReturnType<typeof vi.fn>, call = 0): URLSearchParams {
  const init = fetchSpy.mock.calls[call]?.[1] as RequestInit | undefined
  return new URLSearchParams(String(init?.body ?? ''))
}

beforeEach(() => {
  clock = T0
  credentials = { ...baseCredentials }
  issued = 0
})

describe('createOAuthTokenManager: petición al SSO', () => {
  it('hace un POST form-urlencoded con client_credentials, scopes separados por espacio y resource', async () => {
    const { oauth, fetchSpy } = manager(okToken())
    await oauth.getToken(ENV)

    expect(fetchSpy).toHaveBeenCalledOnce()
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(String(url)).toBe('https://sso.dynatrace.com/sso/oauth2/token')
    expect(init.method).toBe('POST')
    const contentType = new Headers(init.headers).get('content-type') ?? ''
    expect(
      init.body instanceof URLSearchParams ||
        contentType.includes('application/x-www-form-urlencoded')
    ).toBe(true)

    const form = sentForm(fetchSpy)
    expect(form.get('grant_type')).toBe('client_credentials')
    expect(form.get('client_id')).toBe(baseCredentials.clientId)
    expect(form.get('client_secret')).toBe(CLIENT_SECRET)
    expect(form.get('scope')).toBe('storage:logs:read environment-api:problems:read')
    expect(form.get('resource')).toBe('urn:dtaccount:7a1b2c3d-0000-4000-8000-000000000000')
  })

  it('sin accountUuid no manda resource, y usa la URL de SSO configurada', async () => {
    credentials = {
      ...baseCredentials,
      accountUuid: null,
      ssoUrl: 'https://sso.ejemplo.local/token'
    }
    const { oauth, fetchSpy } = manager(okToken())
    await oauth.getToken(ENV)

    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe('https://sso.ejemplo.local/token')
    expect(sentForm(fetchSpy).has('resource')).toBe(false)
  })
})

describe('createOAuthTokenManager: caché y renovación', () => {
  it('devuelve el token con su caducidad según expires_in y los scopes concedidos', async () => {
    const { oauth } = manager(okToken(300, 'storage:logs:read'))
    const token = await oauth.getToken(ENV)

    expect(token).toEqual({
      accessToken: 'access-1',
      expiresAt: new Date(T0.getTime() + 300_000),
      grantedScopes: ['storage:logs:read']
    })
    expect(oauth.expiresAt(ENV)).toEqual(new Date(T0.getTime() + 300_000))
  })

  it('sin scope en la respuesta, grantedScopes es null (no se sabe qué concedió)', async () => {
    const { oauth } = manager(okToken(300))
    expect((await oauth.getToken(ENV)).grantedScopes).toBeNull()
  })

  it('con scope vacío en la respuesta, grantedScopes es [] (no concedió ninguno)', async () => {
    const { oauth } = manager(okToken(300, ''))
    expect((await oauth.getToken(ENV)).grantedScopes).toEqual([])
  })

  it('reutiliza el token mientras queden 60 s o más, y lo renueva con menos', async () => {
    const { oauth, fetchSpy } = manager(okToken(300))
    expect((await oauth.getToken(ENV)).accessToken).toBe('access-1')

    clock = new Date(T0.getTime() + 240_000) // quedan exactamente 60 s
    expect((await oauth.getToken(ENV)).accessToken).toBe('access-1')
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    clock = new Date(T0.getTime() + 241_000) // quedan 59 s
    expect((await oauth.getToken(ENV)).accessToken).toBe('access-2')
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(oauth.expiresAt(ENV)).toEqual(new Date(clock.getTime() + 300_000))
  })

  it('usa el expires_in de la respuesta, no 300 s fijos', async () => {
    const { oauth, fetchSpy } = manager(okToken(3600))
    await oauth.getToken(ENV)
    clock = new Date(T0.getTime() + 1000 * 1000)
    await oauth.getToken(ENV)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('las llamadas simultáneas comparten una sola petición', async () => {
    let release: (response: Response) => void = () => {}
    const { oauth, fetchSpy } = manager(
      () => new Promise<Response>((resolve) => (release = resolve))
    )

    const calls = [oauth.getToken(ENV), oauth.getToken(ENV), oauth.getToken(ENV)]
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    release(json(200, { access_token: 'compartido', expires_in: 300, token_type: 'Bearer' }))
    const tokens = await Promise.all(calls)

    expect(fetchSpy).toHaveBeenCalledOnce()
    expect(tokens.map((t) => t.accessToken)).toEqual(['compartido', 'compartido', 'compartido'])
  })

  it('cada entorno tiene su propio token', async () => {
    const { oauth, fetchSpy } = manager(okToken(300))
    expect((await oauth.getToken('env-1')).accessToken).toBe('access-1')
    expect((await oauth.getToken('env-2')).accessToken).toBe('access-2')
    expect((await oauth.getToken('env-1')).accessToken).toBe('access-1')
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(oauth.expiresAt('env-3')).toBeNull()
  })

  it('invalidate obliga a pedir un token nuevo', async () => {
    const { oauth, fetchSpy } = manager(okToken(300))
    await oauth.getToken(ENV)
    oauth.invalidate(ENV)
    expect(oauth.expiresAt(ENV)).toBeNull()
    expect((await oauth.getToken(ENV)).accessToken).toBe('access-2')
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('si se invalida durante una renovación, su resultado no se guarda', async () => {
    const releases: ((response: Response) => void)[] = []
    const { oauth, fetchSpy } = manager(
      () => new Promise<Response>((resolve) => releases.push(resolve))
    )

    const first = oauth.getToken(ENV)
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1))
    oauth.invalidate(ENV)
    releases[0]?.(json(200, { access_token: 'viejo', expires_in: 300, token_type: 'Bearer' }))
    await first.catch(() => undefined)

    const second = oauth.getToken(ENV)
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2))
    releases[1]?.(json(200, { access_token: 'nuevo', expires_in: 300, token_type: 'Bearer' }))
    expect((await second).accessToken).toBe('nuevo')
  })
})

describe('createOAuthTokenManager: errores', () => {
  it('sin credenciales da NO_CREDENTIAL y no llama al SSO', async () => {
    credentials = null
    const { oauth, fetchSpy } = manager(okToken())
    await expectDtError(oauth.getToken(ENV), 'NO_CREDENTIAL')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it.each([400, 401])('un %d del SSO da UNAUTHORIZED sin dejar ver el secreto', async (status) => {
    const { oauth } = manager(async () =>
      json(status, {
        error: 'invalid_client',
        error_description: `client_secret ${CLIENT_SECRET} no válido`
      })
    )
    const error = await expectDtError(oauth.getToken(ENV), 'UNAUTHORIZED')
    expect(error.message).not.toContain('SECRETOOAUTH')
    expect(JSON.stringify({ ...error, message: error.message })).not.toContain('SECRETOOAUTH')
  })

  describe('AUD-21 (P3): errores del SSO según RFC 6749 §5.2', () => {
    const ssoError =
      (status: number, body: unknown): (() => Promise<Response>) =>
      async () =>
        body === undefined ? new Response(null, { status }) : json(status, body)

    it.each([
      ['401 con invalid_client', 401, { error: 'invalid_client' }],
      ['401 con invalid_scope (401 manda)', 401, { error: 'invalid_scope' }],
      ['401 sin cuerpo', 401, undefined],
      ['400 con invalid_client', 400, { error: 'invalid_client', error_description: 'x' }],
      ['400 con unauthorized_client', 400, { error: 'unauthorized_client' }]
    ])('%s → UNAUTHORIZED con el mensaje de siempre y su status', async (_case, status, body) => {
      const { oauth } = manager(ssoError(status, body))
      const error = await expectDtError(oauth.getToken(ENV), 'UNAUTHORIZED')
      expect(error.message).toBe('El SSO ha rechazado el client ID o el client secret.')
      expect(error.status).toBe(status)
    })

    it('400 con invalid_scope → BAD_REQUEST «El SSO no acepta los scopes pedidos: …»', async () => {
      const { oauth } = manager(
        ssoError(400, { error: 'invalid_scope', error_description: 'Scope storage:x:read unknown' })
      )
      const error = await expectDtError(oauth.getToken(ENV), 'BAD_REQUEST')
      expect(error.message).toBe(
        'El SSO no acepta los scopes pedidos: Scope storage:x:read unknown'
      )
      expect(error.status).toBe(400)
    })

    it.each(['invalid_request', 'invalid_grant', 'unsupported_grant_type'])(
      '400 con %s → BAD_REQUEST «El SSO ha rechazado la petición (<error>): …»',
      async (code) => {
        const { oauth } = manager(ssoError(400, { error: code, error_description: 'Detalle' }))
        const error = await expectDtError(oauth.getToken(ENV), 'BAD_REQUEST')
        expect(error.message).toBe(`El SSO ha rechazado la petición (${code}): Detalle`)
        expect(error.status).toBe(400)
      }
    )

    it.each(['invalid_scope', 'invalid_request'])(
      '400 con %s sin error_description: el mensaje acaba en el código',
      async (code) => {
        const { oauth } = manager(ssoError(400, { error: code }))
        const error = await expectDtError(oauth.getToken(ENV), 'BAD_REQUEST')
        expect(error.message).toMatch(new RegExp(`${code}\\.?$`))
      }
    )

    it.each([
      ['sin cuerpo', undefined],
      ['con un cuerpo que no es JSON', 'texto'],
      ['con JSON sin error', { error_description: 'algo' }],
      ['con un error desconocido', { error: 'otro_error' }]
    ])('400 %s → UNAUTHORIZED como antes', async (_case, body) => {
      const response =
        body === 'texto'
          ? async () => new Response('<html>Bad Request</html>', { status: 400 })
          : ssoError(400, body)
      const { oauth } = manager(response)
      const error = await expectDtError(oauth.getToken(ENV), 'UNAUTHORIZED')
      expect(error.status).toBe(400)
    })

    it('el client_secret no aparece aunque el SSO lo devuelva en error_description', async () => {
      const { oauth } = manager(
        ssoError(400, {
          error: 'invalid_scope',
          error_description: `scope malo para client_secret=${CLIENT_SECRET} (revísalo)`
        })
      )
      const error = await expectDtError(oauth.getToken(ENV), 'BAD_REQUEST')
      expect(error.message).not.toContain('SECRETOOAUTH')
      expect(JSON.stringify({ ...error, message: error.message })).not.toContain('SECRETOOAUTH')
    })

    it('tampoco un client_secret sin el formato dt0…', async () => {
      const secret = 'secreto-propio-sin-formato-7Q2W9E'
      credentials = { ...baseCredentials, clientSecret: secret }
      const { oauth } = manager(
        ssoError(400, { error: 'invalid_request', error_description: `bad secret ${secret}` })
      )
      const error = await expectDtError(oauth.getToken(ENV), 'BAD_REQUEST')
      expect(error.message).not.toContain(secret)
    })

    it('error_description se recorta a 200 y el mensaje entero no pasa de 300', async () => {
      const long = 'x'.repeat(1000)
      for (const code of ['invalid_scope', 'invalid_request']) {
        const { oauth } = manager(ssoError(400, { error: code, error_description: long }))
        const error = await expectDtError(oauth.getToken(ENV), 'BAD_REQUEST')
        expect(error.message, code).toContain('x'.repeat(200))
        expect(error.message, code).not.toContain('x'.repeat(201))
        expect(error.message.length, code).toBeLessThanOrEqual(300)
      }
    })
  })

  it('un 5xx del SSO da SERVER_ERROR', async () => {
    const { oauth } = manager(async () => json(503, { error: 'unavailable' }))
    await expectDtError(oauth.getToken(ENV), 'SERVER_ERROR')
  })

  it.each([
    ['sin access_token', { expires_in: 300, token_type: 'Bearer' }],
    ['sin expires_in', { access_token: 'x', token_type: 'Bearer' }],
    ['que no es un objeto', 'texto']
  ])('una respuesta %s da INVALID_RESPONSE', async (_case, body) => {
    const { oauth } = manager(async () => json(200, body))
    await expectDtError(oauth.getToken(ENV), 'INVALID_RESPONSE')
  })

  it.each([
    ['net::ERR_CERT_AUTHORITY_INVALID', 'TLS_UNTRUSTED'],
    ['net::ERR_CERT_COMMON_NAME_INVALID', 'TLS_UNTRUSTED'],
    ['net::ERR_CONNECTION_REFUSED', 'NETWORK'],
    ['net::ERR_NAME_NOT_RESOLVED', 'NETWORK']
  ])('AUD-20: si fetch lanza %s → %s, con el mensaje y sin el secreto', async (message, code) => {
    const { oauth } = manager(async () => {
      throw new Error(message)
    })
    const error = await expectDtError(oauth.getToken(ENV), code)
    expect(error.message).toContain('No se pudo contactar con el SSO')
    expect(error.message).toContain(message)
    expect(error.message).not.toContain('SECRETOOAUTH')
  })

  it('AUD-20: si fetch lanza algo que no es un Error, también NETWORK', async () => {
    const { oauth } = manager(async () => {
      throw 'cadena suelta'
    })
    const error = await expectDtError(oauth.getToken(ENV), 'NETWORK')
    expect(error.message).toContain('cadena suelta')
  })

  it.each([403, 404, 302])(
    'AUD-20: otro estado no OK del SSO (%d) da UNAUTHORIZED con el estado',
    async (status) => {
      const { oauth } = manager(async () => new Response(null, { status }))
      const error = await expectDtError(oauth.getToken(ENV), 'UNAUTHORIZED')
      expect(error.status).toBe(status)
      expect(error.message).toContain(String(status))
    }
  )

  it.each([
    ['expires_in 0', { access_token: 'x', expires_in: 0 }],
    ['expires_in negativo', { access_token: 'x', expires_in: -5 }],
    ['expires_in como texto', { access_token: 'x', expires_in: '300' }],
    ['access_token vacío', { access_token: '', expires_in: 300 }]
  ])('AUD-20: %s → INVALID_RESPONSE', async (_case, body) => {
    const { oauth } = manager(async () => json(200, body))
    await expectDtError(oauth.getToken(ENV), 'INVALID_RESPONSE')
  })

  it('AUD-20: un cuerpo que no es JSON → INVALID_RESPONSE', async () => {
    const { oauth } = manager(async () => new Response('<html>no</html>', { status: 200 }))
    await expectDtError(oauth.getToken(ENV), 'INVALID_RESPONSE')
  })

  it('AUD-20: scope con espacios de sobra → sin entradas vacías', async () => {
    const { oauth } = manager(okToken(300, '  a:read   b:read  '))
    expect((await oauth.getToken(ENV)).grantedScopes).toEqual(['a:read', 'b:read'])
  })

  it('un fallo no deja nada en caché: el siguiente intento vuelve a pedir', async () => {
    let fail = true
    const { oauth, fetchSpy } = manager(async () =>
      fail
        ? json(503, {})
        : json(200, { access_token: 'ok', expires_in: 300, token_type: 'Bearer' })
    )
    await expectDtError(oauth.getToken(ENV), 'SERVER_ERROR')
    fail = false
    expect((await oauth.getToken(ENV)).accessToken).toBe('ok')
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })
})
