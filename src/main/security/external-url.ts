/**
 * Si una URL se puede abrir en el navegador del sistema: solo http o https, con
 * host y sin credenciales. Se mira también el texto tal cual, porque el
 * analizador de URL acepta formas que no lo parecen ("http:///ruta" acaba con
 * "ruta" como host).
 */
export function isSafeExternalUrl(raw: string): boolean {
  if (!/^https?:\/\/[^/\\?#@\s]/i.test(raw)) return false
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  return (
    (url.protocol === 'http:' || url.protocol === 'https:') &&
    url.hostname !== '' &&
    url.username === '' &&
    url.password === ''
  )
}
