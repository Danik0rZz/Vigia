/** Error con el que se rechaza una tarea cancelada antes de empezar. */
export class QueueAbortError extends Error {
  constructor() {
    super('Cancelada antes de empezar')
    this.name = 'AbortError'
  }
}

export interface RequestQueue {
  /**
   * Ejecuta `task` cuando haya hueco (como mucho `limit` a la vez). Si `signal`
   * se cancela mientras espera, sale de la cola sin ejecutarse; si ya ha
   * empezado, la tarea recibe la misma señal.
   */
  run<T>(task: (signal: AbortSignal | undefined) => Promise<T>, signal?: AbortSignal): Promise<T>
  /** Tareas en marcha y en espera (para las pruebas). */
  stats(): { running: number; waiting: number }
}

/**
 * Cola con un máximo de tareas a la vez. Los mini gráficos de las evidencias
 * la usan para no lanzar decenas de consultas a Dynatrace al abrir un problema.
 */
export function createRequestQueue(limit: number): RequestQueue {
  let running = 0
  const waiting: { start: () => void; signal: AbortSignal | undefined }[] = []

  const next = (): void => {
    while (running < limit && waiting.length > 0) {
      const item = waiting.shift()
      if (item === undefined) break
      if (item.signal?.aborted === true) continue
      item.start()
    }
  }

  return {
    run(task, signal) {
      return new Promise((resolve, reject) => {
        if (signal?.aborted === true) {
          reject(new QueueAbortError())
          return
        }
        const entry = {
          signal,
          start: (): void => {
            signal?.removeEventListener('abort', onAbort)
            running += 1
            // Dentro de una promesa: una tarea que lanza de forma síncrona también
            // rechaza y libera su hueco (si no, la cola se quedaría bloqueada).
            Promise.resolve()
              .then(() => task(signal))
              .then(resolve, reject)
              .finally(() => {
                running -= 1
                next()
              })
          }
        }
        const onAbort = (): void => {
          const index = waiting.indexOf(entry)
          if (index >= 0) waiting.splice(index, 1)
          reject(new QueueAbortError())
        }
        signal?.addEventListener('abort', onAbort, { once: true })
        waiting.push(entry)
        next()
      })
    },
    stats: () => ({ running, waiting: waiting.length })
  }
}
