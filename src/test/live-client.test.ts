import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createLiveClient } from './live-client'

/**
 * El cliente de las pruebas en vivo es SOLO LECTURA y va despacio: el fetch
 * envuelto rechaza cualquier método que no sea GET (salvo el POST de
 * apiTokens/lookup) antes de llegar a la red, y deja salir las peticiones de
 * una en una, como mucho 3 por segundo. Aquí no hay red: el fetch es falso y
 * el tiempo, simulado. Corre en `npm run check` (no es un *.live.test.ts).
 */

// Credenciales inventadas.
const ENV = {
  url: 'https://zz99fake.live.dynatrace.com',
  token: `dt0c01.PUBLICOFALSO000000000000.${'SECRETOFALSO'.padEnd(64, 'Q')}`
}

let clock: number
let starts: number[]
let inFlight: number
let maxInFlight: number
let responses: (() => Response)[]
let fakeFetch: ReturnType<typeof vi.fn>

const sleep = async (ms: number): Promise<void> => {
  clock += ms
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  })
}

beforeEach(() => {
  clock = 0
  starts = []
  inFlight = 0
  maxInFlight = 0
  responses = []
  fakeFetch = vi.fn(async () => {
    starts.push(clock)
    inFlight += 1
    maxInFlight = Math.max(maxInFlight, inFlight)
    // La respuesta tarda 20 ms simulados y cede el turno.
    await Promise.resolve()
    clock += 20
    inFlight -= 1
    return (responses.shift() ?? (() => json(200, { ok: true })))()
  })
})

function live(): ReturnType<typeof createLiveClient> {
  return createLiveClient(ENV, {
    fetch: fakeFetch as unknown as typeof fetch,
    sleep,
    now: () => clock
  })
}

const anyObject = z.object({}).passthrough()

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('se esperaba un error')
}

describe('solo lectura', () => {
  it('deja pasar GET', async () => {
    const { client } = live()
    await client.dtRequest({ envId: 'x', api: 'classic', path: '/problems', schema: anyObject })
    expect(fakeFetch).toHaveBeenCalledOnce()
    const [, init] = fakeFetch.mock.calls[0] as [unknown, RequestInit | undefined]
    expect((init?.method ?? 'GET').toUpperCase()).toBe('GET')
  })

  it('deja pasar el POST de apiTokens/lookup', async () => {
    const { client } = live()
    await client.dtRequest({
      envId: 'x',
      api: 'classic',
      method: 'POST',
      path: '/apiTokens/lookup',
      body: { token: ENV.token },
      schema: anyObject
    })
    expect(fakeFetch).toHaveBeenCalledOnce()
  })

  it.each([
    ['POST', '/problems'],
    ['POST', '/apiTokens'],
    ['POST', '/apiTokens/lookup/otra'],
    ['PUT', '/settings/objects/x'],
    ['DELETE', '/entities/x'],
    ['PATCH', '/slo/x']
  ])('rechaza %s %s SIN llamar a la red', async (method, path) => {
    const { client } = live()
    const error = await rejection(
      client.dtRequest({
        envId: 'x',
        api: 'classic',
        method: method as 'POST',
        path,
        body: {},
        schema: anyObject
      })
    )
    expect(fakeFetch).not.toHaveBeenCalled()
    const text = `${(error as { code?: string }).code ?? ''} ${(error as Error).message ?? ''}`
    expect(text).toContain('LIVE_READ_ONLY')
  })
})

describe('limitador', () => {
  it('serie y como mucho 3 por segundo: 7 peticiones a la vez salen de una en una, con ≥ 334 ms entre inicios', async () => {
    const { client, stats } = live()
    await Promise.all(
      Array.from({ length: 7 }, () =>
        client.dtRequest({ envId: 'x', api: 'classic', path: '/problems', schema: anyObject })
      )
    )

    expect(fakeFetch).toHaveBeenCalledTimes(7)
    expect(maxInFlight).toBe(1)
    for (let i = 1; i < starts.length; i += 1) {
      expect((starts[i] ?? 0) - (starts[i - 1] ?? 0), `intervalo ${i}`).toBeGreaterThanOrEqual(334)
    }
    expect((starts[6] ?? 0) - (starts[0] ?? 0)).toBeGreaterThanOrEqual(2000)
    expect(stats).toMatchObject({ requests: 7, maxInFlight: 1 })
  })

  it('tras un 429 con Retry-After no deja salir la siguiente hasta que pase ese tiempo', async () => {
    responses.push(() =>
      json(429, { error: { code: 429, message: 'Too many' } }, { 'retry-after': '2' })
    )
    const { client } = live()
    await client.dtRequest({ envId: 'x', api: 'classic', path: '/problems', schema: anyObject })

    // El DtClient reintenta; la 2.ª salida es al menos 2 s después de la 1.ª.
    expect(starts).toHaveLength(2)
    expect((starts[1] ?? 0) - (starts[0] ?? 0)).toBeGreaterThanOrEqual(2000)
  })

  it('una petición rechazada por solo lectura no ocupa turno ni cuenta como petición', async () => {
    const { client, stats } = live()
    await rejection(
      client.dtRequest({
        envId: 'x',
        api: 'classic',
        method: 'POST',
        path: '/problems',
        body: {},
        schema: anyObject
      })
    )
    await client.dtRequest({ envId: 'x', api: 'classic', path: '/problems', schema: anyObject })
    expect(fakeFetch).toHaveBeenCalledOnce()
    expect(stats.requests).toBe(1)
  })
})

describe('sin fugas', () => {
  it('el log del cliente no guarda el token aunque la respuesta lo traiga', async () => {
    responses.push(() => json(500, { error: { code: 500, message: `Token ${ENV.token}` } }))
    const { client, logged } = live()
    await rejection(
      client.dtRequest({ envId: 'x', api: 'classic', path: '/problems', schema: anyObject })
    )
    expect(logged.some((line) => line.includes('SECRETOFALSO'))).toBe(false)
  })
})
