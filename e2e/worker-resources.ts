import type { Server } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Recursos propios de cada worker de Playwright (ficha 0070). Con varios workers, cada uno lanza
 * su app y su simulador: cada worker usa su puerto y sus carpetas de datos (`VIGIA_USER_DATA_DIR`)
 * y de exportación (`VIGIA_EXPORT_DIR`), derivados de su `workerIndex`. Va fuera de `e2e/views/`
 * para que otros specs puedan usarlo sin contar como specs de vistas.
 *
 * Hoy lo usa el arnés de vistas. Los demás specs no comparten nada entre workers: sus servidores
 * escuchan en el puerto 0 (el sistema da uno libre) y sus carpetas salen de `mkdtempSync`.
 */

/** Primer puerto del simulador: por debajo del rango dinámico de Windows (49152 en adelante). */
export const BASE_PORT = 39_100

export interface WorkerResources {
  /** Puerto del simulador de Dynatrace del worker (127.0.0.1). */
  port: number
  /** Carpeta de datos de usuario de la app del worker. */
  userDataDir: string
  /** Carpeta de exportación de la app del worker. */
  exportDir: string
}

/**
 * Los recursos del worker `workerIndex`: siempre los mismos para el mismo índice y distintos entre
 * índices. Función pura: no crea carpetas ni abre puertos (eso lo hace el arnés).
 */
export function workerResources(workerIndex: number): WorkerResources {
  if (!Number.isInteger(workerIndex) || workerIndex < 0) {
    throw new RangeError(`workerResources: índice de worker no válido (${workerIndex})`)
  }
  const base = join(tmpdir(), 'vigia-e2e-workers', `w${workerIndex}`)
  return {
    port: BASE_PORT + workerIndex,
    userDataDir: join(base, 'data'),
    exportDir: join(base, 'export')
  }
}

/**
 * Pone `server` a escuchar en `127.0.0.1:port`. Si el puerto está ocupado (u otro error al
 * escuchar), rechaza con un mensaje que nombra el puerto: no prueba otro en silencio, porque el
 * worker tiene que usar justo el suyo.
 */
export function listenOn(server: Server, port: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException): void => {
      server.off('listening', onListening)
      const reason =
        error.code === 'EADDRINUSE'
          ? 'ya está ocupado'
          : `no se puede usar (${error.code ?? error.message})`
      reject(
        new Error(
          `El puerto ${port} del simulador ${reason}: ciérralo o revisa si hay otra tanda de e2e en marcha.`
        )
      )
    }
    const onListening = (): void => {
      server.off('error', onError)
      resolve()
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, '127.0.0.1')
  })
}
