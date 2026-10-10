import { byNumber, type Comparator, type GridSort } from '@shared/grid-sort'
import type { MonitorBreakdownResult, MonitorLocation, MonitorStep } from '@shared/modules'

/*
 * Orden y reglas de las tablas de localizaciones y de pasos o peticiones de las páginas de
 * monitor (ficha 0025). Puras: la tabla ordena antes de pintar (`sortRows`), como las del host.
 */

export const LOCATION_COLUMN_IDS = ['name', 'availability', 'duration', 'failed'] as const
export type LocationColumnId = (typeof LOCATION_COLUMN_IDS)[number]
export const STEP_COLUMN_IDS = ['name', 'duration', 'share'] as const
export type StepColumnId = (typeof STEP_COLUMN_IDS)[number]

/** De peor a mejor disponibilidad. */
export const DEFAULT_LOCATION_SORT: GridSort<LocationColumnId> = {
  key: 'availability',
  direction: 'asc'
}
/**
 * «En su orden»: el que da el canal, de mayor a menor duración (la dimensión no trae número de
 * secuencia, ficha 0023).
 */
export const DEFAULT_STEP_SORT: GridSort<StepColumnId> = { key: 'duration', direction: 'desc' }

/**
 * ¿Sale la tarjeta de pasos? No sin pasos que enseñar (`steps: null`, tipo sin métrica de pasos,
 * o la lista vacía; decisión del Orquestador en la ficha 0025). Sin datos todavía (carga o
 * error), sí: la tarjeta enseña su estado.
 */
export function monitorStepsShown(data: MonitorBreakdownResult | undefined): boolean {
  if (data === undefined) return true
  return data.steps !== null && data.steps.length > 0
}

export function locationComparators(
  language: string
): Record<LocationColumnId, Comparator<MonitorLocation>> {
  const text = new Intl.Collator(language, { sensitivity: 'base', numeric: true }).compare
  return {
    name: (a, b) => text(a.name, b.name),
    availability: byNumber((l) => l.availability),
    duration: byNumber((l) => l.duration),
    failed: byNumber((l) => l.failed)
  }
}

export function stepComparators(language: string): Record<StepColumnId, Comparator<MonitorStep>> {
  const text = new Intl.Collator(language, { sensitivity: 'base', numeric: true }).compare
  return {
    name: (a, b) => text(a.name, b.name),
    duration: byNumber((s) => s.duration),
    share: byNumber((s) => s.share)
  }
}

/**
 * Id del paso más lento (mayor duración media), o null si ninguno tiene dato. En empate, el
 * primero en el orden del canal. No depende del orden de la tabla: sigue marcado al reordenar.
 */
export function slowestStepId(steps: readonly MonitorStep[]): string | null {
  let slowest: MonitorStep | null = null
  for (const step of steps) {
    if (step.duration === null || !Number.isFinite(step.duration)) continue
    if (slowest === null || (slowest.duration ?? 0) < step.duration) slowest = step
  }
  return slowest?.id ?? null
}
