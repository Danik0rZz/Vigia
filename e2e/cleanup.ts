import { rmSync } from 'node:fs'

/**
 * Borra la carpeta temporal de un spec. En Windows, Electron (o el antivirus)
 * puede tener aún un fichero abierto justo después de cerrar la app: se
 * reintenta unas veces antes de rendirse.
 */
export function removeDir(path: string): void {
  rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
