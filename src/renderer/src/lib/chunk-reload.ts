const KEY = 'vigia.chunkReloadAt'
/** Un segundo fallo antes de esto ya no recarga: se enseña el error. */
const WINDOW_MS = 60_000

/**
 * Si, tras un fallo al cargar un trozo de la interfaz, toca recargar sola. Una
 * sola vez: deja la hora en el almacenamiento de sesión y, si vuelve a fallar
 * en menos de 60 s (o la marca está en el futuro), no recarga. Sin
 * almacenamiento, o si falla, tampoco: sin marca no se puede evitar un bucle.
 */
export function shouldAutoReload(
  storage: Pick<Storage, 'getItem' | 'setItem'> | null,
  now: number
): boolean {
  if (storage === null) return false
  try {
    const stored = Number(storage.getItem(KEY))
    if (Number.isFinite(stored) && stored > 0 && now - stored < WINDOW_MS) return false
    storage.setItem(KEY, String(now))
    return true
  } catch {
    return false
  }
}

/** sessionStorage, o null si no se puede usar. */
export function sessionStore(): Storage | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}
