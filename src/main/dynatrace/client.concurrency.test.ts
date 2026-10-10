import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createDtClient } from './client'

/**
 * Ficha 0062: semáforo por entorno alrededor de `send`. Como mucho 6 peticiones
 * en vuelo por entorno, el resto en cola FIFO; las canceladas salen de la cola;
 * con más de 20 pendientes, una línea `debug` en el log.
 *
 * Nada depende del tiempo real: cada `fetch` devuelve una promesa que el test
 * resuelve o rechaza a mano, y entre pasos solo se vacía la cola de microtareas.
 */

const ENV_A = 'env-a'
const ENV_B = 'env-b'
const LIMIT = 6
const SAAS = 'https://abc12345.live.dynatrace.com'
const TOKEN = `dt0c01.PUBLICAPRUEBA0000000000A.${'SECRETOCLASICO'.padEnd(64, 'X')}`
const T0 = new Date('2026-10-03T10:00:00.000Z')

interface Pending {
  envId: string
  index: number
  resolve(response: Response): void
  reject(error: unknown): void
}

let pending: Pending[]
let arrivals: { envId: string; index: number }[]
let fetchFor: ReturnType<typeof vi.fn>
let logger: {
  debug: ReturnType<typeof vi.fn>
  warn: ReturnType<typeof vi.fn>
  error: ReturnType<typeof vi.fn>
}

function ok(): Response {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })
}

beforeEach(() => {
  pending = []
  arrivals = []
  logger = { debug: vi.fn(), warn: vi.fn(), error: vi.fn() }
  fetchFor = vi.fn((envId: string) => {
    return ((input: unknown, init?: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        const url = new URL(input instanceof Request ? input.url : String(input))
        const index = Number(url.searchParams.get('i'))
        arrivals.push({ envId, index })
        const entry: Pending = { envId, index, resolve, reject }
        pending.push(entry)
        // Un fetch real rechaza cuando se aborta su señal.
        init?.signal?.addEventListener('abort', () => {
          pending = pending.filter((p) => p !== entry)
          reject(new DOMException('aborted', 'AbortError'))
        })
      })) as unknown as typeof fetch
  })
})

afterEach(async () => {
  // Que no quede nada colgando entre tests.
  for (let round = 0; round < 50 && pending.length > 0; round++) {
    for (const p of pending.splice(0)) p.resolve(ok())
    await flush()
  }
})

function client(): ReturnType<typeof createDtClient> {
  return createDtClient({
    fetchFor,
    getEnvironment: () => ({ classicApiUrl: SAAS, platformUrl: null }),
    readSecret: () => TOKEN,
    oauth: {
      getToken: vi.fn(),
      invalidate: vi.fn(),
      expiresAt: vi.fn(() => null)
    },
    sleep: vi.fn(async () => undefined),
    now: () => T0,
    random: () => 0.5,
    logger
  } as unknown as Parameters<typeof createDtClient>[0])
}

/** Vacía la cola de microtareas y de macrotareas inmediatas, sin temporizadores. */
async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise<void>((resolve) => setImmediate(resolve))
}

const schema = z.object({ ok: z.boolean() })

function request(
  dt: ReturnType<typeof createDtClient>,
  envId: string,
  index: number,
  signal?: AbortSignal
): Promise<unknown> {
  const promise = dt.dtRequest({
    envId,
    api: 'classic',
    path: '/problems',
    query: { i: index },
    schema,
    ...(signal === undefined ? {} : { signal })
  } as unknown as Parameters<ReturnType<typeof createDtClient>['dtRequest']>[0])
  // Los rechazos se comprueban en cada test; aquí solo se evita el aviso de «no controlado».
  promise.catch(() => undefined)
  return promise
}

/** Comprueba que la promesa ya está rechazada, sin esperar a ningún plazo real. */
async function expectRejected(promise: Promise<unknown>): Promise<void> {
  const state = await Promise.race([
    promise.then(
      () => 'resolved',
      () => 'rejected'
    ),
    flush().then(() => 'pending')
  ])
  expect(state, 'la petición cancelada debía rechazarse').toBe('rejected')
}

function arrivedFor(envId: string): number[] {
  return arrivals.filter((a) => a.envId === envId).map((a) => a.index)
}

function settle(envId: string, index: number, how: 'ok' | 'fail' = 'ok'): void {
  const entry = pending.find((p) => p.envId === envId && p.index === index)
  if (entry === undefined) throw new Error(`la petición ${envId}#${index} no está en vuelo`)
  pending = pending.filter((p) => p !== entry)
  if (how === 'ok') entry.resolve(ok())
  else entry.reject(new TypeError('fetch failed'))
}

describe('CA1 (0062): como mucho 6 peticiones en vuelo por entorno', () => {
  it('con 10 simultáneas y un fetch que no resuelve, solo 6 llegan a fetchFor', async () => {
    const dt = client()
    for (let i = 1; i <= 10; i++) request(dt, ENV_A, i)
    await flush()

    expect(arrivedFor(ENV_A)).toHaveLength(LIMIT)
    expect(fetchFor.mock.calls.filter(([envId]) => envId === ENV_A)).toHaveLength(LIMIT)
  })

  it('al resolver una, entra la séptima (y solo ella)', async () => {
    const dt = client()
    const first = request(dt, ENV_A, 1)
    for (let i = 2; i <= 10; i++) request(dt, ENV_A, i)
    await flush()

    settle(ENV_A, 1)
    await expect(first).resolves.toEqual({ ok: true })
    await flush()

    expect(arrivedFor(ENV_A)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('respeta el orden de llegada: las de la cola entran en el orden en que se pidieron', async () => {
    const dt = client()
    for (let i = 1; i <= 10; i++) request(dt, ENV_A, i)
    await flush()

    // Se liberan sitios en desorden; la cola sigue saliendo en orden FIFO.
    settle(ENV_A, 4)
    await flush()
    settle(ENV_A, 2)
    await flush()
    settle(ENV_A, 6)
    settle(ENV_A, 1)
    await flush()

    expect(arrivedFor(ENV_A)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('una petición que falla libera su sitio: la cola no se atasca', async () => {
    const dt = client()
    const failing = request(dt, ENV_A, 1)
    for (let i = 2; i <= 8; i++) request(dt, ENV_A, i)
    await flush()

    settle(ENV_A, 1, 'fail')
    await expect(failing).rejects.toMatchObject({ name: 'DtError', code: 'NETWORK' })
    await flush()
    expect(arrivedFor(ENV_A)).toEqual([1, 2, 3, 4, 5, 6, 7])

    settle(ENV_A, 2, 'fail')
    await flush()
    expect(arrivedFor(ENV_A)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('tras vaciarse la cola, el entorno vuelve a admitir 6 a la vez', async () => {
    const dt = client()
    const first = Array.from({ length: LIMIT }, (_, k) => request(dt, ENV_A, k + 1))
    await flush()
    for (let i = 1; i <= LIMIT; i++) settle(ENV_A, i, i % 2 === 0 ? 'fail' : 'ok')
    await Promise.allSettled(first)
    await flush()

    for (let i = 11; i <= 20; i++) request(dt, ENV_A, i)
    await flush()
    expect(arrivedFor(ENV_A).filter((i) => i > 10)).toEqual([11, 12, 13, 14, 15, 16])
  })
})

describe('CA2 (0062): dos entornos no se frenan entre sí', () => {
  it('con el entorno A lleno, el B también lleva 6 en vuelo (6 y 6)', async () => {
    const dt = client()
    for (let i = 1; i <= 10; i++) request(dt, ENV_A, i)
    await flush()
    for (let i = 1; i <= 10; i++) request(dt, ENV_B, i)
    await flush()

    expect(arrivedFor(ENV_A)).toHaveLength(LIMIT)
    expect(arrivedFor(ENV_B)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('liberar un sitio en A no deja entrar una petición de B, ni al revés', async () => {
    const dt = client()
    for (let i = 1; i <= 8; i++) request(dt, ENV_A, i)
    for (let i = 1; i <= 8; i++) request(dt, ENV_B, i)
    await flush()

    settle(ENV_A, 1)
    await flush()
    expect(arrivedFor(ENV_A)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(arrivedFor(ENV_B)).toEqual([1, 2, 3, 4, 5, 6])

    settle(ENV_B, 3, 'fail')
    await flush()
    expect(arrivedFor(ENV_A)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(arrivedFor(ENV_B)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('tres entornos con 7 peticiones cada uno llevan 6 en vuelo cada uno', async () => {
    const dt = client()
    const envs = ['env-1', 'env-2', 'env-3']
    for (const envId of envs) for (let i = 1; i <= 7; i++) request(dt, envId, i)
    await flush()

    for (const envId of envs) expect(arrivedFor(envId)).toEqual([1, 2, 3, 4, 5, 6])
  })
})

describe('CA3 (0062): las canceladas salen de la cola', () => {
  it('una petición cancelada en cola no llega a fetchFor y libera su sitio', async () => {
    const dt = client()
    for (let i = 1; i <= LIMIT; i++) request(dt, ENV_A, i)
    const controller = new AbortController()
    const cancelled = request(dt, ENV_A, 7, controller.signal)
    request(dt, ENV_A, 8)
    await flush()

    controller.abort()
    await expectRejected(cancelled)
    await flush()
    // Cancelar en cola no ocupa sitio ni deja pasar a nadie todavía.
    expect(arrivedFor(ENV_A)).toEqual([1, 2, 3, 4, 5, 6])

    settle(ENV_A, 1)
    await flush()
    // Entra la 8: la 7 ya no estaba en la cola.
    expect(arrivedFor(ENV_A)).toEqual([1, 2, 3, 4, 5, 6, 8])

    settle(ENV_A, 2)
    await flush()
    expect(arrivedFor(ENV_A)).not.toContain(7)
  })

  it('una petición cancelada antes de pedirla no llega a fetchFor', async () => {
    const dt = client()
    const controller = new AbortController()
    controller.abort()
    const cancelled = request(dt, ENV_A, 1, controller.signal)

    await expectRejected(cancelled)
    await flush()
    expect(arrivedFor(ENV_A)).toEqual([])

    for (let i = 2; i <= 8; i++) request(dt, ENV_A, i)
    await flush()
    expect(arrivedFor(ENV_A)).toEqual([2, 3, 4, 5, 6, 7])
  })

  it('cancelar una petición en vuelo libera su sitio para la primera de la cola', async () => {
    const dt = client()
    const controller = new AbortController()
    const inFlight = request(dt, ENV_A, 1, controller.signal)
    for (let i = 2; i <= 8; i++) request(dt, ENV_A, i)
    await flush()
    expect(arrivedFor(ENV_A)).toEqual([1, 2, 3, 4, 5, 6])

    controller.abort()
    await expectRejected(inFlight)
    await flush()
    expect(arrivedFor(ENV_A)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('cancelar varias en cola mantiene el orden de las demás', async () => {
    const dt = client()
    for (let i = 1; i <= LIMIT; i++) request(dt, ENV_A, i)
    const controllers = new Map<number, AbortController>()
    for (let i = 7; i <= 12; i++) {
      const controller = new AbortController()
      controllers.set(i, controller)
      request(dt, ENV_A, i, controller.signal)
    }
    await flush()

    controllers.get(7)?.abort()
    controllers.get(9)?.abort()
    await flush()
    for (let i = 1; i <= 3; i++) settle(ENV_A, i)
    await flush()

    expect(arrivedFor(ENV_A)).toEqual([1, 2, 3, 4, 5, 6, 8, 10, 11])
  })
})

describe('CA4 (0062): con más de 20 en cola se registra una línea debug', () => {
  it('con 20 pendientes en cola no registra nada en debug', async () => {
    const dt = client()
    for (let i = 1; i <= LIMIT + 20; i++) request(dt, ENV_A, i)
    await flush()

    expect(arrivedFor(ENV_A)).toHaveLength(LIMIT)
    expect(logger.debug).not.toHaveBeenCalled()
  })

  it('al pasar de 20 pendientes registra una línea debug, sin el token', async () => {
    const dt = client()
    for (let i = 1; i <= LIMIT + 21; i++) request(dt, ENV_A, i)
    await flush()

    expect(logger.debug).toHaveBeenCalled()
    const logged = logger.debug.mock.calls.flat().map(String).join(' ')
    expect(logged).not.toContain(TOKEN)
    expect(logged).not.toContain('SECRETOCLASICO')
  })

  it('la cola de un entorno no cuenta para el umbral de otro', async () => {
    const dt = client()
    for (let i = 1; i <= LIMIT + 15; i++) request(dt, ENV_A, i)
    for (let i = 1; i <= LIMIT + 15; i++) request(dt, ENV_B, i)
    await flush()

    expect(logger.debug).not.toHaveBeenCalled()
  })
})
