/**
 * Límite de peticiones simultáneas a Dynatrace por entorno (ficha 0062): como
 * mucho `limit` en vuelo y el resto en cola por orden de llegada. El renderer ya
 * frena, pero main no se fía: un renderer en bucle no puede gastar la cuota del
 * cliente a golpe de 429.
 *
 * Bloqueos: un sitio se toma solo alrededor de UN intento HTTP (`fetch` y
 * lectura del cuerpo) y se suelta antes de devolver o de esperar un reintento.
 * Quien ocupa un sitio nunca pide otro mientras lo tiene, así que la paginación
 * y las peticiones en dos fases (que esperan una respuesta para pedir la
 * siguiente) no pueden quedarse esperando un sitio que ocupan ellas mismas.
 */

export const DEFAULT_MAX_CONCURRENT_PER_ENV = 6
/** Con más pendientes que esto en la cola de un entorno, una línea `debug`. */
export const QUEUE_DEBUG_THRESHOLD = 20

/** Suelta el sitio. Llamarla más de una vez no hace nada. */
export type Release = () => void

interface Waiter {
  grant(release: Release): void
}

interface Lane {
  active: number
  queue: Waiter[]
  /** Ya se avisó de la cola larga; se rearma cuando vuelve al umbral. */
  warned: boolean
}

export interface EnvLimiter {
  /**
   * Toma un sitio del entorno. Si lo hay, lo da sin esperar (devuelve la
   * función directamente, no una promesa); si no, la promesa se resuelve
   * cuando le toque. Con `signal` abortado, rechaza con su `reason` (lo mismo
   * que haría `fetch`) y sale de la cola sin ocupar sitio.
   */
  acquire(envId: string, signal?: AbortSignal): Release | Promise<Release>
}

/** Con qué se rechaza una petición cancelada: el `reason` de la señal, como `fetch`. */
export function cancelReason(signal: AbortSignal | undefined): unknown {
  return signal?.reason ?? new DOMException('Petición cancelada.', 'AbortError')
}

/** Si la señal (opcional) está abortada. */
export function isCancelled(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true
}

export function createEnvLimiter(options: {
  limit?: number
  /** Solo se le pasa el id del entorno y el número de pendientes: nunca URL ni token. */
  onLongQueue?(envId: string, pending: number): void
}): EnvLimiter {
  const limit = Math.max(1, options.limit ?? DEFAULT_MAX_CONCURRENT_PER_ENV)
  const lanes = new Map<string, Lane>()

  function laneOf(envId: string): Lane {
    let lane = lanes.get(envId)
    if (lane === undefined) {
      lane = { active: 0, queue: [], warned: false }
      lanes.set(envId, lane)
    }
    return lane
  }

  function releaseFor(envId: string, lane: Lane): Release {
    let released = false
    return () => {
      if (released) return
      released = true
      const next = lane.queue.shift()
      if (next !== undefined) {
        // El sitio pasa directamente a la siguiente: `active` no cambia.
        next.grant(releaseFor(envId, lane))
        return
      }
      lane.active -= 1
      if (lane.active === 0) lanes.delete(envId)
    }
  }

  return {
    acquire(envId, signal) {
      if (signal?.aborted === true) return Promise.reject(cancelReason(signal))
      const lane = laneOf(envId)
      if (lane.active < limit) {
        lane.active += 1
        return releaseFor(envId, lane)
      }
      return new Promise<Release>((resolve, reject) => {
        const onAbort = (): void => {
          lane.queue = lane.queue.filter((w) => w !== waiter)
          if (lane.queue.length <= QUEUE_DEBUG_THRESHOLD) lane.warned = false
          reject(cancelReason(signal))
        }
        const waiter: Waiter = {
          grant(release) {
            signal?.removeEventListener('abort', onAbort)
            if (lane.queue.length <= QUEUE_DEBUG_THRESHOLD) lane.warned = false
            resolve(release)
          }
        }
        signal?.addEventListener('abort', onAbort, { once: true })
        lane.queue.push(waiter)
        if (lane.queue.length > QUEUE_DEBUG_THRESHOLD && !lane.warned) {
          lane.warned = true
          options.onLongQueue?.(envId, lane.queue.length)
        }
      })
    }
  }
}
