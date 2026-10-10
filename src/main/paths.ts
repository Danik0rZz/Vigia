import { app } from 'electron'
import { join } from 'node:path'
import { APP_NAME } from '@shared/app'
import { resolveUserDataDir, USER_DATA_DIR_ENV } from './user-data'

/**
 * Fija el nombre visible y la carpeta de datos (ver `resolveUserDataDir`).
 * Debe llamarse antes de que la app esté lista.
 */
export function configureAppPaths(): void {
  app.setName(APP_NAME)
  app.setPath(
    'userData',
    resolveUserDataDir({
      packaged: app.isPackaged,
      appData: app.getPath('appData'),
      override: process.env[USER_DATA_DIR_ENV]
    })
  )
}

export function databasePath(): string {
  return join(app.getPath('userData'), 'vigia.db')
}

/** Copias de la base antes de migrar (ficha 0061). */
export function databaseBackupsDir(): string {
  return join(app.getPath('userData'), 'backups')
}

/**
 * Migraciones de la base: en la app empaquetada van en `resources/migrations`
 * (`extraResources`); sin empaquetar se leen del código fuente.
 */
export function migrationsDir(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'migrations')
    : join(app.getAppPath(), 'src/main/db/migrations')
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
