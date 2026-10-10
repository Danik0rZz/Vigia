import { app, BrowserWindow, clipboard, dialog, Menu, nativeTheme } from 'electron'
import { APP_NAME, APP_ORIGIN, APP_USER_MODEL_ID } from '@shared/app'
import { backupBeforeMigrations } from './db/backup'
import { E2E_ENV, isE2eMode } from './e2e-mode'
import { createAppHandlers } from './ipc/handlers/app'
import { createConnectionHandlers } from './ipc/handlers/connection'
import { createExportHandlers } from './ipc/handlers/export'
import { createModuleHandlers } from './ipc/handlers/modules'
import { createTenantHandlers } from './ipc/handlers/tenants'
import { createUiHandlers } from './ipc/handlers/ui'
import { openLocalData, storedTheme, storeTheme, type LocalData } from './local-data'
import { registerIpcHandlers } from './ipc/register'
import { initLogging, log } from './logging'
import {
  configureAppPaths,
  databaseBackupsDir,
  databasePath,
  migrationsDir,
  rendererRoot
} from './paths'
import { registerAppProtocol, registerAppScheme } from './protocol'
import { hardenAllWebContents, hardenDefaultSession } from './security/harden'
import { isAllowedOrigin, originOf } from './security/origins'
import { asciiUserAgent } from './user-agent'
import { createMainWindow, focusMainWindow } from './window'

/**
 * En desarrollo, electron-vite sirve la interfaz desde su servidor y lo indica
 * con esta variable. En la app empaquetada se ignora siempre.
 */
function resolveDevServerUrl(): string | undefined {
  if (app.isPackaged) return undefined
  const url = process.env['ELECTRON_RENDERER_URL']
  return url !== undefined && url !== '' ? url : undefined
}

function bootstrap(): void {
  configureAppPaths()
  initLogging()
  app.userAgentFallback = asciiUserAgent(app.userAgentFallback, app.getName(), app.getVersion())

  // Instancia única: una segunda ejecución enfoca la ventana ya abierta.
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return
  }
  app.on('second-instance', () => focusMainWindow())

  const devServerUrl = resolveDevServerUrl()
  const devServerOrigin =
    devServerUrl !== undefined ? (originOf(devServerUrl) ?? undefined) : undefined

  // Único origen del que se aceptan navegación y mensajes IPC.
  const trustedOrigins = [devServerOrigin ?? APP_ORIGIN]

  registerAppScheme()
  hardenAllWebContents(trustedOrigins)

  app.on('window-all-closed', () => app.quit())

  void app.whenReady().then(async () => {
    log.info(`${APP_NAME} ${app.getVersion()} arrancando`, {
      electron: process.versions.electron,
      packaged: app.isPackaged
    })

    app.setAppUserModelId(APP_USER_MODEL_ID)
    // Sin menú en producción: desactiva también sus atajos (recargar, DevTools).
    if (app.isPackaged) Menu.setApplicationMenu(null)

    hardenDefaultSession(devServerOrigin)
    registerAppProtocol(rendererRoot())

    let data: LocalData
    try {
      // Sin copia correcta no se migra: si falla, rechaza y cae en este diálogo (ficha 0061).
      await backupBeforeMigrations({
        file: databasePath(),
        migrationsFolder: migrationsDir(),
        backupDir: databaseBackupsDir(),
        logger: log
      })
      data = openLocalData(log)
    } catch (error) {
      log.error('No se pudo abrir la base de datos local', error)
      dialog.showErrorBox(APP_NAME, 'No se pudo abrir la base de datos local. Revisa los logs.')
      app.quit()
      return
    }
    app.on('will-quit', () => data.db.$client.close())

    // El tema guardado se aplica antes de crear la ventana: así la barra de
    // título no parpadea con el tema de Windows.
    nativeTheme.themeSource = storedTheme(data.settings)

    registerIpcHandlers(
      {
        ...createAppHandlers({
          getInfo: () => ({
            name: APP_NAME,
            version: app.getVersion(),
            packaged: app.isPackaged,
            platform: process.platform,
            versions: {
              electron: process.versions.electron,
              chrome: process.versions.chrome,
              node: process.versions.node
            },
            errorTrigger: isE2eMode({ packaged: app.isPackaged, value: process.env[E2E_ENV] })
          }),
          logError: (message, details) => log.error(`Error en la interfaz: ${message}`, details),
          writeClipboardText: (text) => clipboard.writeText(text)
        }),
        ...createUiHandlers({
          setThemeSource: (theme) => {
            nativeTheme.themeSource = theme
            storeTheme(data.settings, theme)
            return nativeTheme.shouldUseDarkColors
          }
        }),
        ...createTenantHandlers(data.tenantDeps),
        ...createConnectionHandlers(data.connectionDeps),
        ...createModuleHandlers(data.moduleDeps),
        ...createExportHandlers(data.exportDeps)
      },
      {
        isTrustedSender: (sender) =>
          sender.isMainFrame && isAllowedOrigin(sender.url, trustedOrigins),
        logger: log
      }
    )

    createMainWindow(devServerUrl)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow(devServerUrl)
    })
  })
}

bootstrap()
