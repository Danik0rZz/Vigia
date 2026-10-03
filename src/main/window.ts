import { BrowserWindow } from 'electron'
import { APP_ENTRY_URL, APP_NAME } from '@shared/app'
import { preloadPath } from './paths'

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
  const window = new BrowserWindow({
    title: APP_NAME,
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0f1115',
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true
    }
  })

  window.once('ready-to-show', () => window.show())
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })

  void window.loadURL(devServerUrl ?? APP_ENTRY_URL)

  mainWindow = window
  return window
}
