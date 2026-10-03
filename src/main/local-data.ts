import { app, BrowserWindow, dialog, safeStorage } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { themePreferences, type ThemePreference } from '@shared/ipc'
import { openDatabase, type AppDatabase } from './db/database'
import type { TenantHandlerDeps } from './ipc/handlers/tenants'
import { databasePath, migrationsDir } from './paths'
import { createSecretStore } from './secrets/store'
import { createTenantRepository, type TenantRepository } from './tenants/repository'

const THEME_SETTING = 'theme'

export interface LocalData {
  db: AppDatabase
  repo: TenantRepository
  tenantDeps: TenantHandlerDeps
}

/** Abre la base local (aplicando migraciones) y prepara repositorio, secretos y diálogos. */
export function openLocalData(): LocalData {
  const db = openDatabase(databasePath(), migrationsDir())
  const repo = createTenantRepository(db)

  // safeStorage se consulta en cada llamada: no se cachea si hay cifrado.
  const secrets = createSecretStore(db, {
    isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
    encryptString: (value) => safeStorage.encryptString(value),
    decryptString: (ciphertext) => safeStorage.decryptString(ciphertext)
  })

  const parent = (): BrowserWindow | undefined => BrowserWindow.getFocusedWindow() ?? undefined
  const filters = [{ name: 'JSON', extensions: ['json'] }]

  const tenantDeps: TenantHandlerDeps = {
    repo,
    secrets,
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
    readFile: (path) => readFile(path, 'utf8'),
    writeFile: (path, content) => writeFile(path, content, 'utf8')
  }

  return { db, repo, tenantDeps }
}

/** Última preferencia de tema recibida, para aplicarla antes de crear la ventana. */
export function storedTheme(repo: TenantRepository): ThemePreference {
  const value = repo.getSetting(THEME_SETTING)
  return themePreferences.find((theme) => theme === value) ?? 'system'
}

export function storeTheme(repo: TenantRepository, theme: ThemePreference): void {
  repo.setSetting(THEME_SETTING, theme)
}
