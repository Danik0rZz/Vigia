import { app, session, shell, type WebContents } from 'electron'
import log from 'electron-log/main'
import { buildCsp } from './csp'
import { isAllowedOrigin, isSafeExternalUrl, originOf } from './origins'

/**
 * Bloquea la navegación de cualquier ventana fuera de la propia app y la
 * apertura de ventanas nuevas. Los enlaces externos http/https se abren en el
 * navegador del sistema.
 */
function hardenWebContents(contents: WebContents, allowedOrigins: readonly string[]): void {
  contents.on('will-navigate', (event, url) => {
    if (!isAllowedOrigin(url, allowedOrigins)) {
      event.preventDefault()
      log.warn('Navegación bloqueada:', originOf(url) ?? '(URL no válida)')
    }
  })

  contents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) {
      void shell.openExternal(url)
    } else {
      log.warn('Apertura de ventana bloqueada:', originOf(url) ?? '(URL no válida)')
    }
    return { action: 'deny' }
  })

  contents.on('will-attach-webview', (event) => {
    event.preventDefault()
  })
}

/** Debe llamarse antes de crear ninguna ventana. */
export function hardenAllWebContents(allowedOrigins: readonly string[]): void {
  app.on('web-contents-created', (_event, contents) => {
    hardenWebContents(contents, allowedOrigins)
  })
}

/**
 * Ajustes de la sesión por defecto: sin permisos web (cámara, micrófono,
 * ubicación, notificaciones…) y, en desarrollo, la CSP sobre las respuestas del
 * servidor de Vite. En producción la CSP la pone el protocolo `app://`.
 */
export function hardenDefaultSession(devServerOrigin: string | undefined): void {
  const ses = session.defaultSession

  // Ninguna función actual necesita permisos web. Si una fase futura necesita
  // alguno, se concede aquí de forma explícita y solo para el origen de la app.
  ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  ses.setPermissionCheckHandler(() => false)

  if (devServerOrigin !== undefined) {
    const csp = buildCsp({ devServerOrigin })
    ses.webRequest.onHeadersReceived({ urls: [`${devServerOrigin}/*`] }, (details, callback) => {
      callback({
        responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] }
      })
    })
  }
}
