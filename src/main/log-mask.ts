import type { LogMessage } from 'electron-log'
import { maskSecrets } from './dynatrace/mask'

/**
 * Filtro final del log (fichas 0060 y 0083): enmascara los secretos con
 * formato conocido (`maskSecrets`) en todo lo que llega a electron-log, también
 * en las excepciones de librerías que capturamos sin controlar su mensaje.
 *
 * Recorre lo que escribe el transporte de fichero de electron-log 5.4.4
 * (`transforms/object.js`), a cualquier profundidad (hasta `MAX_DEPTH`):
 * textos, listas, objetos planos, instancias de clase (sus propiedades propias
 * enumerables), lo que devuelve `toJSON`, claves y valores de `Map` y `Set`, y
 * en un `Error` el mensaje, la pila, la `cause` y sus propiedades propias.
 * Trabaja sobre una copia: el original no cambia, y lo que
 * no lleva nada que enmascarar se devuelve tal cual (mismo objeto).
 *
 * Si el recorrido falla, el mensaje se descarta (`false`): nunca se escribe
 * sin filtrar.
 *
 * Es la última barrera, no un permiso para registrar secretos: cada llamada
 * sigue enmascarando lo suyo (`maskSecrets`, `redactQueryEcho`,
 * `maskErrorDetails`). Solo ve los formatos que `maskSecrets` conoce.
 */
export function maskLogMessage(message: LogMessage): LogMessage | false {
  try {
    const seen = new WeakMap<object, unknown>()
    return { ...message, data: message.data.map((value) => maskValue(value, 0, seen)) }
  } catch {
    return false
  }
}

/**
 * Profundidad máxima del recorrido. Supera con holgura la que escribe el
 * transporte de fichero de electron-log (5); por debajo, el valor se sustituye
 * por `DEPTH_MARKER`, que no lleva nada del original.
 */
const MAX_DEPTH = 32
const DEPTH_MARKER = '[profundidad máxima]'
const CIRCULAR_MARKER = '[referencia circular]'

/**
 * Copias ya empezadas, por original: corta las referencias circulares y
 * mantiene la forma (un objeto que se contiene apunta a su copia).
 */
type Seen = WeakMap<object, unknown>

function maskValue(value: unknown, depth: number, seen: Seen): unknown {
  if (typeof value === 'string') return maskSecrets(value)
  if (value === null || typeof value !== 'object') return value
  const done = seen.get(value)
  if (done !== undefined) return done
  // Las fechas no llevan texto: quedan igual.
  if (value instanceof Date) return value
  if (depth >= MAX_DEPTH) return DEPTH_MARKER
  if (hasToJson(value)) return maskToJson(value, depth, seen)
  if (value instanceof Error) return maskError(value, depth, seen)
  if (Array.isArray(value)) return maskArray(value, depth, seen)
  if (value instanceof Map) return maskMap(value, depth, seen)
  if (value instanceof Set) return maskSet(value, depth, seen)
  return maskObject(value, depth, seen)
}

/**
 * Con `toJSON`, el fichero escribe lo que devuelve (`JSON.stringify` lo llama
 * antes que el serializador de electron-log): se enmascara eso. Si nada cambia,
 * queda el original. Un `toJSON` que lanza hace fallar el filtro y el mensaje
 * se descarta.
 */
function maskToJson(value: { toJSON: () => unknown }, depth: number, seen: Seen): unknown {
  seen.set(value, CIRCULAR_MARKER)
  const json = value.toJSON()
  const out = maskValue(json, depth + 1, seen)
  if (out === json && !hasSymbolKeys(value)) {
    seen.set(value, value)
    return value
  }
  seen.set(value, out)
  return out
}

function maskArray(list: unknown[], depth: number, seen: Seen): unknown[] {
  const copy: unknown[] = []
  seen.set(list, copy)
  let changed = hasSymbolKeys(list)
  for (const item of list) {
    const out = maskValue(item, depth + 1, seen)
    if (out !== item) changed = true
    copy.push(out)
  }
  return keepIfUnchanged(list, copy, changed, seen)
}

/**
 * Un `Map` se escribe con `Object.fromEntries`: sus claves también pueden
 * llevar texto, así que se enmascaran claves y valores.
 */
function maskMap(map: Map<unknown, unknown>, depth: number, seen: Seen): Map<unknown, unknown> {
  const copy = new Map<unknown, unknown>()
  seen.set(map, copy)
  let changed = hasSymbolKeys(map)
  for (const [key, inner] of map) {
    const outKey = maskValue(key, depth + 1, seen)
    const out = maskValue(inner, depth + 1, seen)
    if (outKey !== key || out !== inner) changed = true
    copy.set(outKey, out)
  }
  return keepIfUnchanged(map, copy, changed, seen)
}

function maskSet(set: Set<unknown>, depth: number, seen: Seen): Set<unknown> {
  const copy = new Set<unknown>()
  seen.set(set, copy)
  let changed = hasSymbolKeys(set)
  for (const item of set) {
    const out = maskValue(item, depth + 1, seen)
    if (out !== item) changed = true
    copy.add(out)
  }
  return keepIfUnchanged(set, copy, changed, seen)
}

/**
 * Objetos planos e instancias de clase: el fichero escribe sus propiedades
 * propias enumerables. Si algo cambia, la copia es un objeto plano con ellas
 * enmascaradas.
 */
function maskObject(object: object, depth: number, seen: Seen): object {
  const copy: Record<string, unknown> = {}
  seen.set(object, copy)
  let changed = hasSymbolKeys(object)
  for (const [key, inner] of Object.entries(object)) {
    const out = maskValue(inner, depth + 1, seen)
    if (out !== inner) changed = true
    copy[key] = out
  }
  return keepIfUnchanged(object, copy, changed, seen)
}

/**
 * Copia del error con mensaje, pila, `cause` y propiedades propias
 * enmascarados; conserva la clase, el `name` y la cadena de `cause`.
 */
function maskError(error: Error, depth: number, seen: Seen): Error {
  const copy = Object.create(Object.getPrototypeOf(error) as object) as Error
  seen.set(error, copy)
  let changed = hasSymbolKeys(error)
  for (const key of Object.getOwnPropertyNames(error)) {
    if (key === 'message' || key === 'stack') continue
    const descriptor = Object.getOwnPropertyDescriptor(error, key)
    if (descriptor === undefined) continue
    if ('value' in descriptor) {
      const out = maskValue(descriptor.value, depth + 1, seen)
      if (out !== descriptor.value) changed = true
      descriptor.value = out
    }
    Object.defineProperty(copy, key, descriptor)
  }
  const define = (key: 'message' | 'stack', text: string): void => {
    const out = maskSecrets(text)
    if (out !== text) changed = true
    Object.defineProperty(copy, key, {
      value: out,
      writable: true,
      configurable: true,
      enumerable: false
    })
  }
  define('message', error.message)
  if (typeof error.stack === 'string') define('stack', error.stack)
  return keepIfUnchanged(error, copy, changed, seen)
}

/**
 * Si nada cambió, devuelve el original (así una `cause` sin secretos sigue
 * siendo el mismo objeto). En un ciclo, quien recibe la copia a medio hacer
 * cuenta como cambiado, así que todo el ciclo se copia y no se mezclan original
 * y copia.
 */
function keepIfUnchanged<T extends object>(original: T, copy: T, changed: boolean, seen: Seen): T {
  if (changed) return copy
  seen.set(original, original)
  return original
}

function hasToJson(value: object): value is { toJSON: () => unknown } {
  return typeof (value as { toJSON?: unknown }).toJSON === 'function'
}

/**
 * La copia no lleva las claves símbolo; si el original tiene alguna enumerable,
 * cuenta como cambio y se devuelve la copia, porque el camino de reserva de
 * electron-log (`util.formatWithOptions`) sí las escribiría.
 */
function hasSymbolKeys(value: object): boolean {
  return Object.getOwnPropertySymbols(value).some((key) =>
    Object.prototype.propertyIsEnumerable.call(value, key)
  )
}
