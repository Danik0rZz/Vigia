import { rmSync } from 'node:fs'

/**
 * Borra la carpeta temporal de un spec. En Windows, Electron (o el antivirus)
 * puede tener aún un fichero abierto justo después de cerrar la app: se
 * reintenta unas veces antes de rendirse. Sin carpeta (beforeAll falló antes de
 * crearla) no hace nada, para no tapar el error real con otro.
 */
export function removeDir(path: string | undefined): void {
  if (path === undefined || path === '') return
  rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
