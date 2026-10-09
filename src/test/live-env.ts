import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** Credenciales del tenant de pruebas para `npm run test:live`. */
export interface LiveEnv {
  /** URL base del entorno (API clásica), sin /api/v2. */
  url: string
  /** Token clásico de solo lectura. */
  token: string
}

export const LIVE_ENV_FILE = '.env.live.local'

/** Las parejas clave=valor del fichero; null si no existe. Nunca se imprimen. */
function readLiveValues(cwd: string): Map<string, string> | null {
  const path = resolve(cwd, LIVE_ENV_FILE)
  if (!existsSync(path)) return null
  const values = new Map<string, string>()
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#') || !line.includes('=')) continue
    const key = line.slice(0, line.indexOf('=')).trim()
    const value = line
      .slice(line.indexOf('=') + 1)
      .trim()
      .replace(/^["']|["']$/g, '')
    values.set(key, value)
  }
  return values
}

/**
 * Lee `.env.live.local` (ignorado por git). Nunca imprime nada de su contenido:
 * ni la URL ni el token pueden acabar en la salida de los tests ni en las
 * conversaciones. Devuelve null si el fichero no existe o le falta algún valor.
 */
export function loadLiveEnv(cwd: string = process.cwd()): LiveEnv | null {
  const values = readLiveValues(cwd)
  if (values === null) return null
  const url = values.get('VIGIA_LIVE_URL')
  const token = values.get('VIGIA_LIVE_TOKEN')
  if (url === undefined || url === '' || token === undefined || token === '') return null
  return { url, token }
}

/**
 * Ficha 0035: el id de problema que Dani añade como `VIGIA_LIVE_PROBLEM_ID` para medirlo en
 * vivo. Null si no está (o está vacío). Igual que la URL y el token, nunca se imprime ni se
 * escribe en un informe.
 */
export function loadLiveProblemId(cwd: string = process.cwd()): string | null {
  const id = readLiveValues(cwd)?.get('VIGIA_LIVE_PROBLEM_ID')
  return id === undefined || id === '' ? null : id
}
