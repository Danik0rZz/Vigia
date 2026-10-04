import { app, BrowserWindow, nativeTheme } from 'electron'
import { APP_ENTRY_URL, APP_NAME } from '@shared/app'
import { E2E_ENV, isE2eMode } from './e2e-mode'
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

  void window.loadURL(devServerUrl ?? APP_ENTRY_URL)

  mainWindow = window
  return window
}
