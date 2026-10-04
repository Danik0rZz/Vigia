/** A partir de esta longitud, un valor de la query que aparece en un mensaje no va al log. */
const MIN_REDACTED_LENGTH = 16

/**
 * Mensaje de error de Dynatrace listo para el log de main: si repite un valor
 * largo de la query (un selector de métrica, un texto de búsqueda), se
 * sustituye por "<parámetro> (N caracteres)". El log nunca lleva el selector.
 */
export function redactQueryEcho(
  message: string,
  query: Readonly<Record<string, unknown>> | undefined
): string {
  let result = message
  for (const [key, value] of Object.entries(query ?? {})) {
    if (typeof value !== 'string' || value.length < MIN_REDACTED_LENGTH) continue
    result = result.split(value).join(`${key} (${value.length} caracteres)`)
    // Dynatrace a veces lo devuelve sin los espacios de los extremos.
    const trimmed = value.trim()
    if (trimmed !== value && trimmed.length >= MIN_REDACTED_LENGTH) {
      result = result.split(trimmed).join(`${key} (${trimmed.length} caracteres)`)
    }
  }
  return result
}
