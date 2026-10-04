/** Margen tras una recarga en caliente en el que un error se atribuye a ella. */
const HOT_WINDOW_MS = 10_000

let lastUpdate: number | null = null

// Solo en desarrollo: Vite quita este bloque del build (import.meta.hot no existe).
if (import.meta.hot) {
  import.meta.hot.on('vite:afterUpdate', () => {
    lastUpdate = Date.now()
  })
}

/** Hora de la última recarga en caliente (null en el build o si no ha habido). */
export function lastHotUpdate(): number | null {
  return lastUpdate
}

/**
 * Si un error llega justo después de una recarga en caliente: en desarrollo,
 * editar el código con la app abierta deja la interfaz a medias y no es un
 * fallo de la app publicada.
 */
export function isRecentHotUpdate(last: number | null, now: number): boolean {
  if (last === null) return false
  const elapsed = now - last
  return elapsed >= 0 && elapsed < HOT_WINDOW_MS
}
