import { formatNumber } from '@shared/format-number'
import type { MonitorLocation } from '@shared/modules'

/**
 * Formato y niveles de los marcadores de las páginas de browser monitor y HTTP monitor (ficha
 * 0024), con el idioma de la interfaz. Sin dato (`null`), «—»: nunca un 0 inventado. Los números
 * pasan por `formatNumber` (separador de miles siempre, ficha 0012). Las duraciones usan
 * `formatDurationMs` de `service-format.ts` (ms o s, como el servicio).
 */

const NO_DATA = '—'

/**
 * Umbrales de la disponibilidad (decisión de Dani al aprobar el lote «monitores», 2026-10-07):
 * error por debajo del 95 % y aviso por debajo del 99 %. Los dos «por debajo» son estrictos: un
 * 95 % justo es aviso y un 99 % justo, normal.
 */
export const AVAILABILITY_ERROR_PCT = 95
export const AVAILABILITY_WARNING_PCT = 99

export type AvailabilityLevel = 'normal' | 'warning' | 'error'

/** Nivel de una disponibilidad en % (0–100); sin dato, normal (sin color). */
export function availabilityLevel(pct: number | null): AvailabilityLevel {
  if (pct === null || !Number.isFinite(pct)) return 'normal'
  if (pct < AVAILABILITY_ERROR_PCT) return 'error'
  if (pct < AVAILABILITY_WARNING_PCT) return 'warning'
  return 'normal'
}

/** Disponibilidad (llega en % 0–100) con un decimal siempre: «87,5 %», «100,0 %». */
export function formatAvailabilityPct(value: number | null, language: string): string {
  if (value === null || !Number.isFinite(value)) return NO_DATA
  return formatNumber(value / 100, language, {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  })
}

/**
 * Localizaciones con la disponibilidad del rango por debajo del 100 % (marcador
 * «Localizaciones»). Las que no traen dato no cuentan: no se sabe si han fallado.
 */
export function locationsBelowFull(locations: readonly MonitorLocation[]): number {
  return locations.filter((item) => item.availability !== null && item.availability < 100).length
}
