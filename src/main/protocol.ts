import { net, protocol } from 'electron'
import { pathToFileURL } from 'node:url'
import log from 'electron-log/main'
import { APP_HOST, APP_SCHEME } from '@shared/app'
import { resolveAppPath } from './security/app-path'
import { buildCsp } from './security/csp'

/**
 * Declara `app://` como esquema estándar y seguro, para que se comporte como
 * https (origen propio, `'self'` en la CSP, fetch). Debe llamarse antes de que
 * la app esté lista.
 */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true }
    }
  ])
}

/**
 * Sirve la interfaz desde `rendererRoot` en `app://vigia/`. Sustituye a
 * `file://`: solo expone esa carpeta y añade la CSP a cada respuesta.
 */
export function registerAppProtocol(rendererRoot: string): void {
  const csp = buildCsp()

  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url)

    if (request.method !== 'GET' || url.host !== APP_HOST) {
      return new Response(null, { status: 404 })
    }

    const filePath = resolveAppPath(rendererRoot, url.pathname)
    if (filePath === null) {
      log.warn('Protocolo app: ruta rechazada')
      return new Response(null, { status: 404 })
    }

    try {
      const file = await net.fetch(pathToFileURL(filePath).toString())
      const headers = new Headers(file.headers)
      headers.set('Content-Security-Policy', csp)
      headers.set('X-Content-Type-Options', 'nosniff')
      return new Response(file.body, { status: file.status, headers })
    } catch {
      return new Response(null, { status: 404 })
    }
  })
}
