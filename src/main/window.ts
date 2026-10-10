import { app, BrowserWindow, dialog, nativeTheme } from 'electron'
import { APP_ENTRY_URL, APP_NAME } from '@shared/app'
import {
  crashLanguageFromLocale,
  createCrashPolicy,
  createUnresponsivePolicy,
  type CrashLanguage
} from './crash-policy'
import { E2E_ENV, isE2eMode } from './e2e-mode'
import { log } from './logging'
import { preloadPath } from './paths'
import { titleBarColors } from './theme'

let mainWindow: BrowserWindow | null = null

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

const e2eMode = (): boolean => isE2eMode({ packaged: app.isPackaged, value: process.env[E2E_ENV] })

/**
 * Muestra la ventana. En modo e2e, sin activarla: las pruebas no le quitan el
 * foco a quien usa el PC ni reciben sus teclas.
 */
export function showWindow(
  window: Pick<BrowserWindow, 'show' | 'showInactive'>,
  e2e: boolean
): void {
  if (e2e) window.showInactive()
  else window.show()
}

/** Trae la ventana al frente; se usa cuando se intenta abrir una segunda instancia. */
export function focusMainWindow(): void {
  if (mainWindow === null) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  const e2e = e2eMode()
  showWindow(mainWindow, e2e)
  if (!e2e) mainWindow.focus()
}

/**
 * Caídas y cuelgues del proceso de la interfaz (ficha 0061): la lógica está en
 * `crash-policy.ts`; aquí solo se le pasa lo de Electron.
 */
function watchRenderer(window: BrowserWindow): void {
  const language = (): CrashLanguage => crashLanguageFromLocale(app.getLocale())
  const crashes = createCrashPolicy({
    now: () => Date.now(),
    logger: log,
    reload: () => {
      if (!window.isDestroyed()) window.webContents.reload()
    },
    showErrorBox: (title, content) => dialog.showErrorBox(title, content),
    quit: () => app.quit(),
    language
  })
  const hangs = createUnresponsivePolicy({
    logger: log,
    schedule: (fn, ms) => setTimeout(fn, ms),
    cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    ask: async (texts) => {
      if (window.isDestroyed()) return 'wait'
      const { response } = await dialog.showMessageBox(window, {
        type: 'warning',
        title: APP_NAME,
        message: texts.unresponsiveMessage,
        buttons: [texts.wait, texts.close],
        defaultId: 0,
        cancelId: 0,
        noLink: true
      })
      return response === 1 ? 'close' : 'wait'
    },
    // destroy y no close: una interfaz colgada no contestaría a beforeunload.
    close: () => {
      if (!window.isDestroyed()) window.destroy()
    },
    language
  })
  window.webContents.on('render-process-gone', (_event, details) => {
    // Un proceso caído ya no está colgado: no se arrastra el cuelgue tras recargar.
    hangs.responsive()
    crashes.renderProcessGone(details)
  })
  window.on('unresponsive', () => hangs.unresponsive())
  window.on('responsive', () => hangs.responsive())
}

/**
 * @param devServerUrl URL del servidor de Vite en desarrollo; sin ella se carga
 * la interfaz compilada por el protocolo `app://`.
 */
export function createMainWindow(devServerUrl: string | undefined): BrowserWindow {
  const colors = titleBarColors(nativeTheme.shouldUseDarkColors)
  const window = new BrowserWindow({
    title: APP_NAME,
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    // Barra de título propia (la dibuja la interfaz) conservando los botones nativos.
    titleBarStyle: 'hidden',
    titleBarOverlay: colors.overlay,
    backgroundColor: colors.background,
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true
    }
  })

  // Los botones nativos siguen al tema: cambia al elegirlo en la app o, con
  // "Sistema", al cambiar el de Windows.
  const applyTheme = (): void => {
    const next = titleBarColors(nativeTheme.shouldUseDarkColors)
    window.setTitleBarOverlay(next.overlay)
    window.setBackgroundColor(next.background)
  }
  nativeTheme.on('updated', applyTheme)

  window.once('ready-to-show', () => showWindow(window, e2eMode()))
  window.on('closed', () => {
    nativeTheme.off('updated', applyTheme)
    if (mainWindow === window) mainWindow = null
  })

  watchRenderer(window)

  void window.loadURL(devServerUrl ?? APP_ENTRY_URL)

  mainWindow = window
  return window
}
