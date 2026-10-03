import { app } from 'electron'
import { join } from 'node:path'
import { APP_ID, APP_NAME } from '@shared/app'

/**
 * Fija el nombre visible y la carpeta de datos. La carpeta usa el identificador
 * sin tilde (`%APPDATA%/vigia`), y en desarrollo una distinta para no mezclar
 * datos de pruebas con los reales. Debe llamarse antes de que la app esté lista.
 */
export function configureAppPaths(): void {
  app.setName(APP_NAME)
  const folder = app.isPackaged ? APP_ID : `${APP_ID}-dev`
  app.setPath('userData', join(app.getPath('appData'), folder))
}

export function logsDir(): string {
  return join(app.getPath('userData'), 'logs')
}

/** Carpeta con la interfaz ya compilada (dentro del asar en producción). */
export function rendererRoot(): string {
  return join(__dirname, '../renderer')
}

export function preloadPath(): string {
  return join(__dirname, '../preload/index.js')
}
