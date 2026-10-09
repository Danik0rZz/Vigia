import type { Comparator, GridSort } from '@shared/grid-sort'
import type { ApplicationAction } from '@shared/modules'

/*
 * Tabla «Acciones de usuario» de la página de una aplicación web (ficha 0034). Puras: la tabla
 * ordena antes de pintar (`sortRows`), como las del host y del process group.
 */

export const ACTION_COLUMN_IDS = ['name', 'count', 'duration'] as const
export type ActionColumnId = (typeof ACTION_COLUMN_IDS)[number]

/** De más a menos acciones, como llegan de main (top 10 por volumen). */
export const DEFAULT_ACTION_SORT: GridSort<ActionColumnId> = { key: 'count', direction: 'desc' }

/** Números ascendentes; sin dato va por debajo de todo (al final en el orden descendente). */
function compareNullable(a: number | null, b: number | null): number {
  if (a === b) return 0
  if (a === null) return -1
  if (b === null) return 1
  return a - b
}

/** Comparadores de la tabla, con el texto en el orden del idioma. */
export function actionComparators(
  language: string
): Record<ActionColumnId, Comparator<ApplicationAction>> {
  const text = new Intl.Collator(language, { sensitivity: 'base', numeric: true }).compare
  return {
    name: (a, b) => text(a.name, b.name),
    count: (a, b) => compareNullable(a.count, b.count),
    duration: (a, b) => compareNullable(a.duration, b.duration)
  }
}

/**
 * Ancho de la barra de la duración media (0 a 100), frente a la más lenta de la tabla. Sin
 * dato, o si ninguna tiene duración, vacía.
 */
export function durationShare(
  duration: number | null,
  actions: readonly ApplicationAction[]
): number {
  if (duration === null || !Number.isFinite(duration) || duration <= 0) return 0
  let max = 0
  for (const action of actions) {
    if (action.duration !== null && action.duration > max) max = action.duration
  }
  return max <= 0 ? 0 : Math.min(100, (duration / max) * 100)
}
