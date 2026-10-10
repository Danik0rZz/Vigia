import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createDtClient } from './client'
import { createEnvLimiter, QUEUE_DEBUG_THRESHOLD, type Release } from './concurrency'

/** Pruebas propias del limitador (ficha 0062); los criterios están en client.concurrency.test.ts. */

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await new Promise<void>((resolve) => setImmediate(resolve))
}

describe('createEnvLimiter', () => {
  it('soltar dos veces el mismo sitio no deja pasar a dos', async () => {
    const limiter = createEnvLimiter({ limit: 1 })
    const first = limiter.acquire('a') as Release
    const granted: number[] = []
    void Promise.resolve(limiter.acquire('a')).then(() => granted.push(2))
    void Promise.resolve(limiter.acquire('a')).then(() => granted.push(3))
    first()
    first()
    await flush()
    expect(granted).toEqual([2])
  })

  it('respeta un límite inyectado', () => {
    const limiter = createEnvLimiter({ limit: 2 })
    expect(typeof limiter.acquire('a')).toBe('function')
    expect(typeof limiter.acquire('a')).toBe('function')
    const third = limiter.acquire('a')
    expect(third).toBeInstanceOf(Promise)
  })

  it('avisa una vez al pasar el umbral y se rearma cuando la cola baja', async () => {
    const onLongQueue = vi.fn()
    const limiter = createEnvLimiter({ limit: 1, onLongQueue })
    const held = limiter.acquire('a') as Release
    const queued: Promise<Release>[] = []
    for (let i = 0; i < QUEUE_DEBUG_THRESHOLD + 3; i++) {
      queued.push(limiter.acquire('a') as Promise<Release>)
    }
    expect(onLongQueue).toHaveBeenCalledTimes(1)
    expect(onLongQueue).toHaveBeenCalledWith('a', QUEUE_DEBUG_THRESHOLD + 1)

    // Se vacía por debajo del umbral y vuelve a pasarlo: segundo aviso.
    held()
    for (const waiting of queued.slice(0, 3)) (await waiting)()
    for (let i = 0; i < 2; i++) queued.push(limiter.acquire('a') as Promise<Release>)
    expect(onLongQueue).toHaveBeenCalledTimes(2)
  })

  it('una cancelada en cola rechaza con el reason de la señal', async () => {
    const limiter = createEnvLimiter({ limit: 1 })
    limiter.acquire('a')
    const controller = new AbortController()
    const waiting = limiter.acquire('a', controller.signal)
    controller.abort(new Error('fuera'))
    await expect(waiting).rejects.toThrow('fuera')
  })
})

describe('sin bloqueos con paginación (ficha 0062)', () => {
  it('8 paginaciones de 3 páginas a la vez en un entorno terminan todas', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const fetchFor = (): typeof fetch =>
      (async (input: unknown) => {
        inFlight += 1
        maxInFlight = Math.max(maxInFlight, inFlight)
        await new Promise<void>((resolve) => setImmediate(resolve))
        inFlight -= 1
        const url = new URL(String(input))
        const page = Number(url.searchParams.get('nextPageKey') ?? '0')
        const body = {
          totalCount: 3,
          nextPageKey: page < 2 ? String(page + 1) : null,
          items: [page]
        }
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }) as unknown as typeof fetch
    const dt = createDtClient({
      fetchFor,
      getEnvironment: () => ({ classicApiUrl: 'https://abc.example', platformUrl: null }),
      readSecret: () => 'secreto',
      oauth: { getToken: vi.fn(), invalidate: vi.fn(), expiresAt: vi.fn(() => null) },
      sleep: async () => undefined,
      now: () => new Date(0),
      random: () => 0,
      logger: { warn: vi.fn(), error: vi.fn() }
    } as unknown as Parameters<typeof createDtClient>[0])

    const runs = Array.from({ length: 8 }, () =>
      dt.paginate({
        envId: 'a',
        api: 'classic',
        endpoint: { path: '/items', itemsKey: 'items', keepOnNextPage: [] },
        schema: z.number()
      })
    )
    const pages = await Promise.all(runs)
    expect(pages.map((p) => p.items)).toEqual(Array.from({ length: 8 }, () => [0, 1, 2]))
    expect(maxInFlight).toBe(6)
  })
})
