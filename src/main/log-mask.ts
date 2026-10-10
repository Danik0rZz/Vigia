import type { LogMessage } from 'electron-log'
import { maskSecrets } from './dynatrace/mask'

/**
 * Filtro final del log (ficha 0060): enmascara los secretos con formato
 * conocido (`maskSecrets`) en todo lo que llega a electron-log, también en
 * las excepciones de librerías que capturamos sin controlar su mensaje.
 *
 * Es la última barrera, no un permiso para registrar secretos: cada llamada
 * sigue enmascarando lo suyo (`maskSecrets`, `redactQueryEcho`,
 * `maskErrorDetails`). Solo ve los formatos que `maskSecrets` conoce.
 */
export function maskLogMessage(message: LogMessage): LogMessage {
  return { ...message, data: message.data.map(maskValue) }
}

function maskValue(value: unknown): unknown {
  if (typeof value === 'string') return maskSecrets(value)
  if (value instanceof Error) return maskError(value)
  if (isPlainObject(value)) {
    // Solo el primer nivel: el log de Vigía no registra objetos anidados con texto libre.
    const copy: Record<string, unknown> = {}
    for (const [key, inner] of Object.entries(value)) {
      copy[key] = typeof inner === 'string' ? maskSecrets(inner) : inner
    }
    return copy
  }
  return value
}

/** Copia del error con mensaje y pila enmascarados; conserva clase, `name` y `cause`. */
function maskError(error: Error): Error {
  const copy = Object.create(Object.getPrototypeOf(error) as object) as Error
  for (const key of Object.getOwnPropertyNames(error)) {
    const descriptor = Object.getOwnPropertyDescriptor(error, key)
    if (descriptor !== undefined) Object.defineProperty(copy, key, descriptor)
  }
  const define = (key: 'message' | 'stack', text: string): void => {
    Object.defineProperty(copy, key, {
      value: maskSecrets(text),
      writable: true,
      configurable: true,
      enumerable: false
    })
  }
  define('message', error.message)
  if (typeof error.stack === 'string') define('stack', error.stack)
  return copy
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false
  const proto = Object.getPrototypeOf(value) as unknown
  return proto === Object.prototype || proto === null
}
