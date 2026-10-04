import { maskSecrets } from './mask'

/** Topes de lo que el renderer manda al log por app:logRendererError. */
export const ERROR_REPORT_LIMITS = { message: 2000, stack: 8000, route: 500, version: 50 } as const

const CHUNK_MESSAGES = [
  /failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /importing a module script failed/i,
  /loading chunk \S+ failed/i,
  /loading css chunk/i
]

function messageOf(error: unknown): string {
  if (typeof error === 'string') return error
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message: unknown }).message
    return typeof message === 'string' ? message : ''
  }
  return ''
}

/**
 * Si el error es un trozo de la interfaz que no se pudo cargar (un import
 * dinámico de una versión anterior, o la recarga en caliente de desarrollo):
 * se arregla recargando.
 */
export function isChunkLoadError(error: unknown): boolean {
  if (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'ChunkLoadError'
  ) {
    return true
  }
  const message = messageOf(error)
  return CHUNK_MESSAGES.some((pattern) => pattern.test(message))
}

/** Parámetros de una URL cuyo valor puede ser una credencial. */
const SECRET_PARAMS =
  /([?&](?:api-token|token|access_token|refresh_token|password|secret|client_secret|code|key)=)[^&#\s"']*/gi

/**
 * Detalles de un error listos para copiar o para el log: sin secretos (tokens
 * y cabeceras), sin el nombre del usuario en las rutas locales (C:\Users\x,
 * también %APPDATA% expandido, /home/x y /Users/x) y sin el valor de los
 * parámetros de una URL que pueden ser credenciales.
 */
export function maskErrorDetails(text: string): string {
  return maskSecrets(text)
    .replace(/([A-Za-z]:[\\/]+Users[\\/]+)[^\\/\s"'<>|:*?]+/gi, '$1<usuario>')
    .replace(/(\/(?:home|Users)\/)[^/\s"']+/g, '$1<usuario>')
    .replace(SECRET_PARAMS, '$1***')
}

/**
 * Freno de errores repetidos: la misma pareja (mensaje, ruta) una sola vez por
 * ventana, y como mucho `max` en total por ventana deslizante. Un error en
 * bucle no llena el log.
 */
export function createErrorThrottle({
  windowMs = 60_000,
  max = 10,
  now = Date.now
}: { windowMs?: number; max?: number; now?: () => number } = {}): {
  allow: (message: string, route: string) => boolean
} {
  const lastByKey = new Map<string, number>()
  let recent: number[] = []
  return {
    allow: (message, route) => {
      const at = now()
      recent = recent.filter((time) => at - time < windowMs)
      const key = `${route}\u0000${message}`
      const last = lastByKey.get(key)
      if (last !== undefined && at - last < windowMs) return false
      if (recent.length >= max) return false
      lastByKey.set(key, at)
      recent.push(at)
      // Que el mapa no crezca sin fin.
      for (const [stored, time] of lastByKey) if (at - time >= windowMs) lastByKey.delete(stored)
      return true
    }
  }
}
