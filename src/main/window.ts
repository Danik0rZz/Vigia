import { BrowserWindow, nativeTheme } from 'electron'
import { APP_ENTRY_URL, APP_NAME } from '@shared/app'
import { preloadPath } from './paths'
import { titleBarColors } from './theme'

let mainWindow: BrowserWindow | null = null

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

/** Trae la ventana al frente; se usa cuando se intenta abrir una segunda instancia. */
export function focusMainWindow(): void {
  if (mainWindow === null) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
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

  window.once('ready-to-show', () => window.show())
  window.on('closed', () => {
    nativeTheme.off('updated', applyTheme)
    if (mainWindow === window) mainWindow = null
  })

  void window.loadURL(devServerUrl ?? APP_ENTRY_URL)

  mainWindow = window
  return window
}
