import { createErrorThrottle, ERROR_REPORT_LIMITS } from '@shared/error-report'
import { invoke } from './ipc'

const throttle = createErrorThrottle()
let appVersion = ''

/** La versión de la app que acompaña a cada error (llega con app:getInfo). */
export function setErrorLogVersion(version: string): void {
  appVersion = version.slice(0, ERROR_REPORT_LIMITS.version)
}

/** La versión que va en el log y en los detalles técnicos ('' si aún no ha llegado). */
export function errorLogVersion(): string {
  return appVersion
}

/** Mensaje y stack de cualquier cosa que se haya lanzado. */
export function describeError(error: unknown): { message: string; stack: string | null } {
  if (error instanceof Error) return { message: error.message, stack: error.stack ?? null }
  if (typeof error === 'string') return { message: error, stack: null }
  try {
    return { message: String(JSON.stringify(error) ?? String(error)), stack: null }
  } catch {
    return { message: Object.prototype.toString.call(error), stack: null }
  }
}

/**
 * Manda un error de la interfaz al log de main (que lo enmascara). Con freno:
 * el mismo error en la misma ruta una vez por minuto y 10 por minuto en total.
 * Nunca lanza: informar de un error no puede romper nada más.
 */
export function reportError(error: unknown, route: string): void {
  try {
    const { message, stack } = describeError(error)
    const payload = {
      message: message.slice(0, ERROR_REPORT_LIMITS.message),
      stack: stack === null ? null : stack.slice(0, ERROR_REPORT_LIMITS.stack),
      route: route.slice(0, ERROR_REPORT_LIMITS.route),
      version: appVersion
    }
    if (!throttle.allow(payload.message, payload.route)) return
    void invoke('app:logRendererError', payload).catch(() => undefined)
  } catch {
    // Nada: ver arriba.
  }
}
