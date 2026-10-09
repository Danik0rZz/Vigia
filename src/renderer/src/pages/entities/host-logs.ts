import type { HostLogProcess } from '@shared/modules'

/**
 * Lógica de la tarjeta «Logs» del host (ficha 0041), sin React: qué texto y qué tono lleva cada
 * estado y en qué orden van los procesos.
 */

/** Estados del fichero con texto propio (los vistos en vivo en el paso 0 de la ficha). */
export const KNOWN_FILE_STATUSES = [
  'FILE_STATUS_OK',
  'FILE_STATUS_NOT_EXIST',
  'FILE_STATUS_NOT_MONITORED_ANY_MORE'
] as const

/** Estados de la fuente con texto propio (el visto en vivo). */
export const KNOWN_SOURCE_STATES = ['LOG_STORAGE_CONFIGURATION_STATUS_SEND_TO_STORAGE'] as const

export type LogStatusTone = 'ok' | 'error' | 'warning' | 'neutral'

/** Clave de texto del estado del fichero (`unknown` para null o un estado sin texto propio). */
export function fileStatusKey(status: string | null): string {
  return status !== null && (KNOWN_FILE_STATUSES as readonly string[]).includes(status)
    ? status
    : 'unknown'
}

/** Clave de texto del estado de la fuente. */
export function sourceStateKey(state: string | null): string {
  return state !== null && (KNOWN_SOURCE_STATES as readonly string[]).includes(state)
    ? state
    : 'unknown'
}

/** Tono del estado del fichero: se lee (ok), no existe (error), ya no se monitoriza (aviso). */
export function fileStatusTone(status: string | null): LogStatusTone {
  switch (status) {
    case 'FILE_STATUS_OK':
      return 'ok'
    case 'FILE_STATUS_NOT_EXIST':
      return 'error'
    case 'FILE_STATUS_NOT_MONITORED_ANY_MORE':
      return 'warning'
    default:
      return 'neutral'
  }
}

/** Los más recientes primero (sin fecha, al final); a igual fecha, por nombre y por id. */
export function sortLogProcesses(
  processes: readonly HostLogProcess[],
  lang: string
): HostLogProcess[] {
  const collator = new Intl.Collator(lang, { sensitivity: 'base', numeric: true })
  return [...processes].sort(
    (a, b) =>
      (b.lastUpdate ?? -Infinity) - (a.lastUpdate ?? -Infinity) ||
      collator.compare(a.name, b.name) ||
      a.id.localeCompare(b.id)
  )
}
