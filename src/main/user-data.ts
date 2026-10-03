import { join } from 'node:path'
import { APP_ID } from '@shared/app'

/** Variable con la que las pruebas fijan una carpeta de datos propia. */
export const USER_DATA_DIR_ENV = 'VIGIA_USER_DATA_DIR'

/**
 * Carpeta de datos de la app: `%APPDATA%/vigia`, y en desarrollo `vigia-dev`
 * para no mezclar datos de pruebas con los reales.
 *
 * La variable `VIGIA_USER_DATA_DIR` solo se respeta sin empaquetar (pruebas e2e
 * y desarrollo). En la app empaquetada se ignora siempre: si no, bastaría con
 * fijarla para redirigir la base de datos y los secretos a otra carpeta.
 */
export function resolveUserDataDir(options: {
  packaged: boolean
  appData: string
  override: string | undefined
}): string {
  const { packaged, appData, override } = options
  if (packaged) return join(appData, APP_ID)
  if (override !== undefined && override.trim() !== '') return override
  return join(appData, `${APP_ID}-dev`)
}
