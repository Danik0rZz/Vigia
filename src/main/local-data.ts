import { app, BrowserWindow, clipboard, ClipboardItem, dialog, safeStorage } from 'electron'
import { existsSync } from 'node:fs'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { themePreferences, type ThemePreference } from '@shared/ipc'
import { openDatabase, type AppDatabase } from './db/database'
import { createDynatraceServices } from './dynatrace/services'
import { EXPORT_DIR_ENV, resolveExportDir } from './export/export-dir'
import type { ConnectionHandlerDeps } from './ipc/handlers/connection'
import type { ExportHandlerDeps, SaveKind } from './ipc/handlers/export'
import type { ModuleHandlerDeps } from './ipc/handlers/modules'
import { createSavedQueryStore } from './modules/saved-queries'
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
  moduleDeps: ModuleHandlerDeps
  exportDeps: ExportHandlerDeps
}

const SAVE_FILTERS: Record<SaveKind, { name: string; extensions: string[] }> = {
  csv: { name: 'CSV', extensions: ['csv'] },
  xlsx: { name: 'Excel', extensions: ['xlsx'] },
  txt: { name: 'Texto', extensions: ['txt'] },
  png: { name: 'PNG', extensions: ['png'] }
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
    // Transacción de better-sqlite3: el repositorio y los secretos usan la misma conexión.
    transaction: (fn) => db.$client.transaction(fn)(),
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

  const moduleDeps: ModuleHandlerDeps = {
    client: dynatrace.client,
    savedQueries: createSavedQueryStore(db),
    repo
  }

  const exportDeps: ExportHandlerDeps = {
    repo,
    settings,
    exportDir: resolveExportDir({
      packaged: app.isPackaged,
      override: process.env[EXPORT_DIR_ENV]
    }),
    dialogs: {
      async chooseSaveFile(defaultPath, kind) {
        // Sin carpeta recordada, se propone Documentos.
        const path = isAbsolute(defaultPath)
          ? defaultPath
          : join(app.getPath('documents'), defaultPath)
        const options = { defaultPath: path, filters: [SAVE_FILTERS[kind]] }
        const window = parent()
        const result =
          window !== undefined
            ? await dialog.showSaveDialog(window, options)
            : await dialog.showSaveDialog(options)
        return result.canceled || result.filePath === undefined ? null : result.filePath
      }
    },
    writeFile: (path, data) => writeFile(path, data),
    fileExists: (path) => existsSync(path),
    // Electron 44: portapapeles asíncrono al estilo W3C (ya no hay writeImage).
    clipboard: {
      writeImage: (png) =>
        clipboard.write([
          new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })
        ])
    },
    window: {
      size() {
        const window = BrowserWindow.getAllWindows()[0]
        const [width, height] = window?.getContentSize() ?? [0, 0]
        return { width: width ?? 0, height: height ?? 0 }
      },
      async capturePage(rect) {
        const window = BrowserWindow.getAllWindows()[0]
        if (window === undefined) throw new Error('No hay ventana que capturar')
        return (await window.webContents.capturePage(rect)).toPNG()
      }
    },
    now: () => new Date(),
    timeZone: () => Intl.DateTimeFormat().resolvedOptions().timeZone
  }

  return {
    db,
    settings,
    tenantDeps,
    connectionDeps: dynatrace.connectionDeps,
    moduleDeps,
    exportDeps
  }
}

/** Última preferencia de tema recibida, para aplicarla antes de crear la ventana. */
export function storedTheme(settings: SettingsStore): ThemePreference {
  const value = settings.get(THEME_SETTING)
  return themePreferences.find((theme) => theme === value) ?? 'system'
}

export function storeTheme(settings: SettingsStore, theme: ThemePreference): void {
  settings.set(THEME_SETTING, theme)
}
