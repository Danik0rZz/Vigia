import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createLiveClient, createReadOnlyFetch } from './live-client'

/**
 * GUARDA DE SOLO LECTURA de las pruebas en vivo. El token del tenant de pruebas
 * tiene permisos de ESCRITURA, así que esta guarda es la única barrera.
 *
 * El fetch de debajo FALLA si se le llama: cualquier caso que deba rechazarse
 * demuestra así que no sale nada a la red. Sin red y sin tiempo real.
 */

const ORIGIN = 'https://zz99fake.live.dynatrace.com'
const ENV = {
  url: ORIGIN,
  token: `dt0c01.PUBLICOFALSO000000000000.${'SECRETOFALSO'.padEnd(64, 'Q')}`
}
const LOOKUP = `${ORIGIN}/api/v2/apiTokens/lookup`

/** fetch que no puede llamarse: si se le llama, la prueba falla. */
function forbiddenFetch(): ReturnType<typeof vi.fn> {
  return vi.fn(async () => {
    throw new Error('NO DEBE SALIR A LA RED')
  })
}

/** fetch que responde 200 para los casos permitidos. */
function okFetch(): ReturnType<typeof vi.fn> {
  return vi.fn(
    async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
  )
}

const noWait = {
  minIntervalMs: 0,
  sleep: async (): Promise<void> => undefined,
  now: (): number => 0
}

async function expectReadOnly(promise: Promise<unknown>): Promise<void> {
  let caught: unknown
  try {
    await promise
  } catch (error) {
    caught = error
  }
  expect(caught, 'se esperaba un rechazo').toBeDefined()
  const text = `${(caught as { code?: string }).code ?? ''} ${(caught as Error).message ?? ''}`
  expect(text).toContain('LIVE_READ_ONLY')
}

describe('createReadOnlyFetch: rechaza sin salir a la red', () => {
  it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])(
    '%s en cualquier ruta',
    async (method) => {
      const base = forbiddenFetch()
      const { fetch } = createReadOnlyFetch(base as unknown as typeof globalThis.fetch, {
        origin: ORIGIN,
        ...noWait
      })
      for (const path of [
        '/api/v2/problems',
        '/api/v2/settings/objects',
        '/api/v2/apiTokens',
        '/api/v2/entities/x',
        '/'
      ]) {
        await expectReadOnly(
          fetch(`${ORIGIN}${path}`, { method, body: method === 'HEAD' ? undefined : '{}' })
        )
      }
      expect(base).not.toHaveBeenCalled()
    }
  )

  it.each([
    ['con un sufijo', `${ORIGIN}/api/v2/apiTokens/lookupX`],
    ['con un segmento más', `${ORIGIN}/api/v2/apiTokens/lookup/x`],
    ['con .. que sale de lookup', `${ORIGIN}/api/v2/apiTokens/lookup/../x`],
    [
      'con .. que vuelve a lookup desde otra ruta',
      `${ORIGIN}/api/v2/settings/../apiTokens/lookupX`
    ],
    ['en mayúsculas', `${ORIGIN}/api/v2/APITOKENS/LOOKUP`],
    ['con mayúsculas parciales', `${ORIGIN}/api/v2/apiTokens/Lookup`],
    ['con barra final', `${ORIGIN}/api/v2/apiTokens/lookup/`],
    ['con query string', `${LOOKUP}?x=1`],
    ['con query vacía', `${LOOKUP}?`],
    ['con fragmento', `${LOOKUP}#x`],
    ['con %2F', `${ORIGIN}/api/v2/apiTokens%2Flookup`],
    ['con %2f en minúscula', `${ORIGIN}/api/v2%2fapiTokens/lookup`],
    [
      'con la ruta de lookup pero otro host',
      'https://otro.ejemplo.invalid/api/v2/apiTokens/lookup'
    ],
    ['con otro puerto', `${ORIGIN}:8443/api/v2/apiTokens/lookup`],
    ['por http', LOOKUP.replace('https://', 'http://')],
    ['con usuario en la URL', LOOKUP.replace('https://', 'https://u:p@')],
    [
      'de un subdominio parecido',
      'https://zz99fake.live.dynatrace.com.otro.invalid/api/v2/apiTokens/lookup'
    ]
  ])('POST a una ruta parecida a lookup: %s', async (_case, url) => {
    const base = forbiddenFetch()
    const { fetch } = createReadOnlyFetch(base as unknown as typeof globalThis.fetch, {
      origin: ORIGIN,
      ...noWait
    })
    await expectReadOnly(fetch(url, { method: 'POST', body: '{}' }))
    expect(base).not.toHaveBeenCalled()
  })

  it('método en minúsculas ("post", "delete") también se controla', async () => {
    const base = forbiddenFetch()
    const { fetch } = createReadOnlyFetch(base as unknown as typeof globalThis.fetch, {
      origin: ORIGIN,
      ...noWait
    })
    await expectReadOnly(fetch(`${ORIGIN}/api/v2/problems`, { method: 'post', body: '{}' }))
    await expectReadOnly(fetch(`${ORIGIN}/api/v2/problems/x`, { method: 'delete' }))
    expect(base).not.toHaveBeenCalled()
  })

  it('un Request ya construido con POST se controla por su método y su URL', async () => {
    const base = forbiddenFetch()
    const { fetch } = createReadOnlyFetch(base as unknown as typeof globalThis.fetch, {
      origin: ORIGIN,
      ...noWait
    })
    await expectReadOnly(
      fetch(new Request(`${ORIGIN}/api/v2/problems`, { method: 'POST', body: '{}' }))
    )
    await expectReadOnly(
      fetch(new Request(`${ORIGIN}/api/v2/apiTokens/lookupX`, { method: 'POST', body: '{}' }))
    )
    await expectReadOnly(fetch(new Request(`${ORIGIN}/api/v2/x`, { method: 'PUT', body: '{}' })))
    expect(base).not.toHaveBeenCalled()
  })

  it('un GET a otro host (o por http) también se rechaza: el token no sale del tenant', async () => {
    const base = forbiddenFetch()
    const { fetch } = createReadOnlyFetch(base as unknown as typeof globalThis.fetch, {
      origin: ORIGIN,
      ...noWait
    })
    await expectReadOnly(fetch('https://otro.ejemplo.invalid/api/v2/problems'))
    await expectReadOnly(fetch(`${ORIGIN.replace('https://', 'http://')}/api/v2/problems`))
    await expectReadOnly(fetch(new Request('https://otro.ejemplo.invalid/api/v2/problems')))
    expect(base).not.toHaveBeenCalled()
  })

  it('un rechazo no cuenta como petición', async () => {
    const base = forbiddenFetch()
    const { fetch, stats } = createReadOnlyFetch(base as unknown as typeof globalThis.fetch, {
      origin: ORIGIN,
      ...noWait
    })
    await expectReadOnly(fetch(`${ORIGIN}/api/v2/problems`, { method: 'POST' }))
    expect(stats.requests).toBe(0)
  })
})

describe('createReadOnlyFetch: deja pasar solo lo permitido', () => {
  it('GET al tenant (sin init, con init y con un Request GET)', async () => {
    const base = okFetch()
    const { fetch } = createReadOnlyFetch(base as unknown as typeof globalThis.fetch, {
      origin: ORIGIN,
      ...noWait
    })
    await fetch(`${ORIGIN}/api/v2/problems?from=now-2h`)
    await fetch(`${ORIGIN}/api/v2/problems`, { method: 'get' })
    await fetch(new Request(`${ORIGIN}/api/v2/slo`))
    expect(base).toHaveBeenCalledTimes(3)
  })

  it('POST exacto a /api/v2/apiTokens/lookup del tenant', async () => {
    const base = okFetch()
    const { fetch } = createReadOnlyFetch(base as unknown as typeof globalThis.fetch, {
      origin: ORIGIN,
      ...noWait
    })
    await fetch(LOOKUP, { method: 'POST', body: '{"token":"x"}' })
    await fetch(LOOKUP, { method: 'post', body: '{"token":"x"}' })
    expect(base).toHaveBeenCalledTimes(2)
  })
})

describe('createReadOnlyFetch: sin redirecciones', () => {
  // Un 307 o 308 repetiría el POST (con su cuerpo y el token) hacia la ruta
  // de destino sin volver a pasar por la guarda: se fuerza redirect 'error'.
  it.each(['follow', 'manual', undefined] as const)(
    'con un string y redirect %s en el init, base recibe redirect "error"',
    async (redirect) => {
      const base = okFetch()
      const { fetch } = createReadOnlyFetch(base as unknown as typeof globalThis.fetch, {
        origin: ORIGIN,
        ...noWait
      })
      await fetch(`${ORIGIN}/api/v2/problems`, redirect === undefined ? undefined : { redirect })
      await fetch(LOOKUP, {
        method: 'POST',
        body: '{}',
        ...(redirect === undefined ? {} : { redirect })
      })
      expect(base).toHaveBeenCalledTimes(2)
      for (const [input, init] of base.mock.calls as [unknown, RequestInit | undefined][]) {
        const effective = input instanceof Request ? input.redirect : init?.redirect
        expect(effective).toBe('error')
      }
    }
  )

  it('con una URL (objeto URL) también se fuerza redirect "error"', async () => {
    const base = okFetch()
    const { fetch } = createReadOnlyFetch(base as unknown as typeof globalThis.fetch, {
      origin: ORIGIN,
      ...noWait
    })
    await fetch(new URL(`${ORIGIN}/api/v2/problems`), { redirect: 'follow' })
    const [input, init] = base.mock.calls[0] as [unknown, RequestInit | undefined]
    expect(input instanceof Request ? input.redirect : init?.redirect).toBe('error')
  })

  it('con un Request con redirect "follow", base recibe un Request con redirect "error"', async () => {
    const base = okFetch()
    const { fetch } = createReadOnlyFetch(base as unknown as typeof globalThis.fetch, {
      origin: ORIGIN,
      ...noWait
    })
    await fetch(new Request(`${ORIGIN}/api/v2/problems`, { redirect: 'follow' }))
    await fetch(new Request(LOOKUP, { method: 'POST', body: '{}', redirect: 'follow' }))
    expect(base).toHaveBeenCalledTimes(2)
    for (const [input, init] of base.mock.calls as [unknown, RequestInit | undefined][]) {
      expect(input).toBeInstanceOf(Request)
      expect((input as Request).redirect).toBe('error')
      // Si además viniera init, tampoco puede reabrir las redirecciones.
      expect(init?.redirect ?? 'error').toBe('error')
    }
  })

  it('el Request que recibe base conserva el método y la URL del original', async () => {
    const base = okFetch()
    const { fetch } = createReadOnlyFetch(base as unknown as typeof globalThis.fetch, {
      origin: ORIGIN,
      ...noWait
    })
    await fetch(new Request(LOOKUP, { method: 'POST', body: '{"token":"x"}', redirect: 'follow' }))
    const request = base.mock.calls[0]?.[0] as Request
    expect(request.method).toBe('POST')
    expect(request.url).toBe(LOOKUP)
    expect(await request.text()).toBe('{"token":"x"}')
  })
})

describe('createLiveClient', () => {
  it('solo expone client, logged y stats (nunca el fetch sin envolver)', () => {
    const live = createLiveClient(ENV, { fetch: forbiddenFetch() as unknown as typeof fetch })
    expect(Object.keys(live).sort()).toEqual(['client', 'logged', 'stats'])
    for (const value of Object.values(live)) expect(typeof value).not.toBe('function')
  })

  it('las escrituras por el cliente se rechazan sin salir a la red', async () => {
    const base = forbiddenFetch()
    const { client } = createLiveClient(ENV, { fetch: base as unknown as typeof fetch, ...noWait })
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      let caught: unknown
      try {
        await client.dtRequest({
          envId: 'x',
          api: 'classic',
          method: method as 'POST',
          path: '/settings/objects',
          body: {},
          schema: z.unknown()
        })
      } catch (error) {
        caught = error
      }
      expect(caught, method).toBeDefined()
    }
    expect(base).not.toHaveBeenCalled()
  })

  it('un lookup con query (por ejemplo, desde dtRequest con query) se rechaza', async () => {
    const base = forbiddenFetch()
    const { client } = createLiveClient(ENV, { fetch: base as unknown as typeof fetch, ...noWait })
    await expect(
      client.dtRequest({
        envId: 'x',
        api: 'classic',
        method: 'POST',
        path: '/apiTokens/lookup',
        query: { x: 1 },
        body: { token: ENV.token },
        schema: z.unknown()
      })
    ).rejects.toBeDefined()
    expect(base).not.toHaveBeenCalled()
  })
})
