/**
 * Comparación de orígenes. No se usa `URL.origin` porque para esquemas propios
 * como `app://` devuelve la cadena "null".
 */
export function originOf(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (parsed.host === '') return null
    return `${parsed.protocol}//${parsed.host}`
  } catch {
    return null
  }
}

export function isAllowedOrigin(
  url: string | undefined,
  allowedOrigins: readonly string[]
): boolean {
  if (url === undefined) return false
  const origin = originOf(url)
  return origin !== null && allowedOrigins.includes(origin)
}

/** Solo se abren en el navegador del sistema enlaces http y https. */
export function isSafeExternalUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}
