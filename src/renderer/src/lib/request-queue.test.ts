import { describe, expect, it } from 'vitest'
import { QueueAbortError, createRequestQueue } from './request-queue'

/**
 * v0.9.2: cola de los mini gráficos de las evidencias. Como mucho `limit`
 * consultas a la vez (3 en la vista), en orden, y una cancelación libera el
 * hueco o saca a la tarea de la cola.
 */

/** Tarea que no termina hasta que se la suelta. */
function deferred<T = string>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** Deja correr las microtareas pendientes. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('createRequestQueue', () => {
  it('nunca más de 3 en vuelo; el resto espera y arranca en orden (FIFO)', async () => {
    const queue = createRequestQueue(3)
    const started: number[] = []
    let inFlight = 0
    let maxInFlight = 0
    const gates = Array.from({ length: 20 }, () => deferred())
    const results = gates.map((gate, i) =>
      queue.run(async () => {
        started.push(i)
        inFlight += 1
        maxInFlight = Math.max(maxInFlight, inFlight)
        try {
          return await gate.promise
        } finally {
          inFlight -= 1
        }
      })
    )
    await flush()
    expect(started).toEqual([0, 1, 2])
    expect(queue.stats()).toEqual({ running: 3, waiting: 17 })

    // Se sueltan en desorden: cada hueco libre lo toma la siguiente de la cola.
    for (const i of [1, 0, 2, 5, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]) {
      gates[i]?.resolve(`r${i}`)
      await flush()
      expect(queue.stats().running).toBeLessThanOrEqual(3)
    }
    expect(await Promise.all(results)).toEqual(gates.map((_g, i) => `r${i}`))
    expect(maxInFlight).toBe(3)
    expect(started).toEqual(Array.from({ length: 20 }, (_, i) => i))
    expect(queue.stats()).toEqual({ running: 0, waiting: 0 })
  })

  it('una tarea que falla rechaza con su error y libera su hueco', async () => {
    const queue = createRequestQueue(1)
    const failing = queue.run(async () => {
      throw new Error('400 de la prueba')
    })
    const next = queue.run(async () => 'siguiente')
    await expect(failing).rejects.toThrow('400 de la prueba')
    await expect(next).resolves.toBe('siguiente')
    expect(queue.stats()).toEqual({ running: 0, waiting: 0 })
  })

  it('cancelada mientras espera: sale de la cola sin ejecutarse, con AbortError', async () => {
    const queue = createRequestQueue(1)
    const gate = deferred()
    const first = queue.run(() => gate.promise)
    const controller = new AbortController()
    let ran = false
    const waiting = queue.run(async () => {
      ran = true
      return 'no'
    }, controller.signal)
    const third = queue.run(async () => 'tercera')
    await flush()
    expect(queue.stats()).toEqual({ running: 1, waiting: 2 })

    controller.abort()
    await expect(waiting).rejects.toBeInstanceOf(QueueAbortError)
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' })
    expect(queue.stats()).toEqual({ running: 1, waiting: 1 })

    gate.resolve('primera')
    await expect(first).resolves.toBe('primera')
    // La siguiente es la tercera: la cancelada no ha ocupado ningún hueco.
    await expect(third).resolves.toBe('tercera')
    expect(ran).toBe(false)
    expect(queue.stats()).toEqual({ running: 0, waiting: 0 })
  })

  it('ya cancelada al pedirla: rechaza enseguida y no ocupa hueco', async () => {
    const queue = createRequestQueue(1)
    const controller = new AbortController()
    controller.abort()
    let ran = false
    await expect(
      queue.run(async () => {
        ran = true
      }, controller.signal)
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(ran).toBe(false)
    expect(queue.stats()).toEqual({ running: 0, waiting: 0 })
    await expect(queue.run(async () => 'libre')).resolves.toBe('libre')
  })

  it('cancelada en marcha: la tarea recibe la señal y, al terminar, libera el hueco', async () => {
    const queue = createRequestQueue(1)
    const controller = new AbortController()
    let received: AbortSignal | undefined
    const running = queue.run(
      (signal) =>
        new Promise((_resolve, reject) => {
          received = signal
          signal?.addEventListener('abort', () => reject(new Error('fetch cancelado')))
        }),
      controller.signal
    )
    const next = queue.run(async () => 'después')
    await flush()
    expect(received).toBe(controller.signal)
    expect(queue.stats()).toEqual({ running: 1, waiting: 1 })

    controller.abort()
    await expect(running).rejects.toThrow('fetch cancelado')
    await expect(next).resolves.toBe('después')
    expect(queue.stats()).toEqual({ running: 0, waiting: 0 })
  })

  it('sin señal, la tarea recibe undefined', async () => {
    const queue = createRequestQueue(2)
    let received: unknown = 'sin llamar'
    await queue.run(async (signal) => {
      received = signal
    })
    expect(received).toBeUndefined()
  })

  it('cancelar después de empezar no la saca de nada ni rechaza dos veces', async () => {
    const queue = createRequestQueue(1)
    const controller = new AbortController()
    const result = queue.run(async () => 'hecha', controller.signal)
    await expect(result).resolves.toBe('hecha')
    controller.abort()
    await flush()
    expect(queue.stats()).toEqual({ running: 0, waiting: 0 })
  })

  it('una tarea que lanza de forma síncrona también rechaza y libera su hueco', async () => {
    const queue = createRequestQueue(1)
    const sync = queue.run((() => {
      throw new Error('síncrono')
    }) as unknown as () => Promise<never>)
    await expect(sync).rejects.toThrow('síncrono')
    expect(queue.stats()).toEqual({ running: 0, waiting: 0 })
    await expect(queue.run(async () => 'libre')).resolves.toBe('libre')
  })
})
