import { app, BrowserWindow, dialog, safeStorage } from 'electron'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { themePreferences, type ThemePreference } from '@shared/ipc'
import { openDatabase, type AppDatabase } from './db/database'
import { createDynatraceServices } from './dynatrace/services'
import type { ConnectionHandlerDeps } from './ipc/handlers/connection'
import type { TenantHandlerDeps } from './ipc/handlers/tenants'
import { databasePath, migrationsDir } from './paths'
import { createSecretStore } from './secrets/store'
import { createSettingsStore, type SettingsStore } from './settings/store'
import { createTenantRepository } from './tenants/repository'

const THEME_SETTING = 'theme'

export interface LocalData {
  db: AppDatabase
  settings: SettingsStore
  tenantDeps: TenantHandlerDeps
  connectionDeps: ConnectionHandlerDeps
}

/** Abre la base local (aplicando migraciones) y prepara ajustes, tenants, secretos y diálogos. */
export function openLocalData(logger: {
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
}): LocalData {
  const db = openDatabase(databasePath(), migrationsDir())
  const settings = createSettingsStore(db)
  const repo = createTenantRepository(db)

  // safeStorage se consulta en cada llamada: no se cachea si hay cifrado.
  const secrets = createSecretStore(db, {
    isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
    encryptString: (value) => safeStorage.encryptString(value),
    decryptString: (ciphertext) => safeStorage.decryptString(ciphertext)
  })

  const dynatrace = createDynatraceServices({ db, repo, secrets, logger })

  const parent = (): BrowserWindow | undefined => BrowserWindow.getFocusedWindow() ?? undefined
  const filters = [{ name: 'JSON', extensions: ['json'] }]

  const tenantDeps: TenantHandlerDeps = {
    repo,
    secrets,
    onEnvironmentChanged: dynatrace.onEnvironmentChanged,
    dialogs: {
      async chooseSaveFile(defaultName) {
        const options = { defaultPath: join(app.getPath('documents'), defaultName), filters }
        const window = parent()
        const result =
          window !== undefined
            ? await dialog.showSaveDialog(window, options)
            : await dialog.showSaveDialog(options)
        return result.canceled || result.filePath === undefined ? null : result.filePath
      },
      async chooseOpenFile() {
        const options = { filters, properties: ['openFile' as const] }
        const window = parent()
        const result =
          window !== undefined
            ? await dialog.showOpenDialog(window, options)
            : await dialog.showOpenDialog(options)
        return result.canceled ? null : (result.filePaths[0] ?? null)
      }
    },
    statFile: (path) => stat(path),
    readFile: (path) => readFile(path, 'utf8'),
    writeFile: (path, content) => writeFile(path, content, 'utf8')
  }

  return { db, settings, tenantDeps, connectionDeps: dynatrace.connectionDeps }
}

/** Última preferencia de tema recibida, para aplicarla antes de crear la ventana. */
export function storedTheme(settings: SettingsStore): ThemePreference {
  const value = settings.get(THEME_SETTING)
  return themePreferences.find((theme) => theme === value) ?? 'system'
}

export function storeTheme(settings: SettingsStore, theme: ThemePreference): void {
  settings.set(THEME_SETTING, theme)
}
