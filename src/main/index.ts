import { app, BrowserWindow, dialog, Menu, nativeTheme } from 'electron'
import { APP_NAME, APP_ORIGIN, APP_USER_MODEL_ID } from '@shared/app'
import { createAppHandlers } from './ipc/handlers/app'
import { createTenantHandlers } from './ipc/handlers/tenants'
import { createUiHandlers } from './ipc/handlers/ui'
import { openLocalData, storedTheme, storeTheme, type LocalData } from './local-data'
import { registerIpcHandlers } from './ipc/register'
import { initLogging, log } from './logging'
import { configureAppPaths, rendererRoot } from './paths'
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

  void app.whenReady().then(() => {
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
      data = openLocalData()
    } catch (error) {
      log.error('No se pudo abrir la base de datos local', error)
      dialog.showErrorBox(APP_NAME, 'No se pudo abrir la base de datos local. Revisa los logs.')
      app.quit()
      return
    }
    app.on('will-quit', () => data.db.$client.close())

    // El tema guardado se aplica antes de crear la ventana: así la barra de
    // título no parpadea con el tema de Windows.
    nativeTheme.themeSource = storedTheme(data.repo)

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
            }
          })
        }),
        ...createUiHandlers({
          setThemeSource: (theme) => {
            nativeTheme.themeSource = theme
            storeTheme(data.repo, theme)
            return nativeTheme.shouldUseDarkColors
          }
        }),
        ...createTenantHandlers(data.tenantDeps)
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
