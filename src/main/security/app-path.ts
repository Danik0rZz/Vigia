import { isAbsolute, relative, resolve } from 'node:path'

/**
 * Traduce la ruta de una URL `app://vigia/...` a un fichero dentro de `root`.
 * Devuelve `null` si la ruta no es válida o intenta salir de `root`.
 */
export function resolveAppPath(root: string, urlPathname: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(urlPathname)
  } catch {
    return null
  }

  if (decoded.includes('\0')) return null

  const relativePath =
    decoded === '/' || decoded === '' ? 'index.html' : decoded.replace(/^\/+/, '')
  const target = resolve(root, relativePath)
  const fromRoot = relative(root, target)

  if (fromRoot === '' || fromRoot.startsWith('..') || isAbsolute(fromRoot)) return null
  return target
}
