import type { ZodType } from 'zod'

/** Rutas de error distintas que se registran como mucho. */
const MAX_PATHS = 20

export interface ParsedItems<T> {
  items: T[]
  /** Elementos que no cumplían el esquema y se han descartado. */
  invalid: number
  /**
   * Rutas de Zod de los errores, sin duplicados, con los índices de array
   * generalizados a "[]". Nunca valores ni mensajes: pueden ir al log.
   */
  paths: string[]
}

/**
 * Valida una lista elemento a elemento: un elemento que no cumple el esquema
 * (un valor nuevo de Dynatrace, un campo que falta) se descarta y se cuenta,
 * en vez de tumbar la lista entera.
 */
export function parseItems<T>(schema: ZodType<T>, raw: readonly unknown[]): ParsedItems<T> {
  const items: T[] = []
  const paths = new Set<string>()
  let invalid = 0
  for (const value of raw) {
    const parsed = schema.safeParse(value)
    if (parsed.success) {
      items.push(parsed.data)
      continue
    }
    invalid += 1
    for (const issue of parsed.error.issues) {
      if (paths.size >= MAX_PATHS) break
      paths.add(issuePath(issue.path))
    }
  }
  return { items, invalid, paths: [...paths] }
}

/** Ruta de un issue de Zod sin valores: los índices pasan a "[]". */
export function issuePath(path: readonly PropertyKey[]): string {
  if (path.length === 0) return '(raíz)'
  return path.map((part) => (typeof part === 'number' ? '[]' : String(part))).join('.')
}
