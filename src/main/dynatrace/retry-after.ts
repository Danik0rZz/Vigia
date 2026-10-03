/**
 * Espera indicada por la cabecera `Retry-After`, en milisegundos: segundos
 * enteros o una fecha HTTP. `null` si no viene o no se entiende.
 */
export function parseRetryAfter(header: string | null, now: Date): number | null {
  if (header === null) return null
  const value = header.trim()
  if (/^\d+$/.test(value)) return Number(value) * 1000
  if (!/[a-z]/i.test(value)) return null
  const date = Date.parse(value)
  if (Number.isNaN(date)) return null
  return Math.max(0, date - now.getTime())
}
