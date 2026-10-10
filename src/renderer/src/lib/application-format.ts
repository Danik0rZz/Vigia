import { formatNumber } from '@shared/format-number'

/**
 * Formato y niveles de los marcadores de la página de una aplicación web, APPLICATION (ficha
 * 0034). Sin dato (`null`), «—»: nunca un 0 inventado. Recuentos y duraciones usan
 * `formatCount` y `formatDurationMs` de `service-format.ts`, como el servicio.
 */

const NO_DATA = '—'

/** Categorías del Apdex, de mejor a peor. */
export const APDEX_CATEGORIES = ['excellent', 'good', 'fair', 'poor', 'unacceptable'] as const
export type ApdexCategory = (typeof APDEX_CATEGORIES)[number]

/**
 * Cortes de la ficha (los «≥» incluyen el corte): excelente ≥ 0,94, buena ≥ 0,85, aceptable
 * ≥ 0,70, pobre ≥ 0,50 y, por debajo, inaceptable.
 */
const APDEX_CUTS: readonly [number, ApdexCategory][] = [
  [0.94, 'excellent'],
  [0.85, 'good'],
  [0.7, 'fair'],
  [0.5, 'poor']
]

/** Categoría de un Apdex (0 a 1); sin dato, null. */
export function apdexCategory(value: number | null): ApdexCategory | null {
  if (value === null || !Number.isFinite(value)) return null
  for (const [cut, category] of APDEX_CUTS) if (value >= cut) return category
  return 'unacceptable'
}

export type ApdexLevel = 'normal' | 'success' | 'warning' | 'error'

/** Color de cada categoría, con los tokens que ya hay (decisión del test-writer en la ficha). */
const CATEGORY_LEVEL: Record<ApdexCategory, ApdexLevel> = {
  excellent: 'success',
  good: 'success',
  fair: 'warning',
  poor: 'error',
  unacceptable: 'error'
}

/** Nivel de color de un Apdex; sin dato, normal (sin color). */
export function apdexLevel(value: number | null): ApdexLevel {
  const category = apdexCategory(value)
  return category === null ? 'normal' : CATEGORY_LEVEL[category]
}

/** Apdex con dos decimales siempre: «0,88», «1,00». */
export function formatApdex(value: number | null, language: string): string {
  if (value === null || !Number.isFinite(value)) return NO_DATA
  return formatNumber(value, language, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** Los Core Web Vitals que pinta la página de una aplicación web (ficha 0054). */
export const WEB_VITALS = ['lcp', 'cls', 'inp'] as const
export type WebVital = (typeof WEB_VITALS)[number]

/** Calificaciones de un Core Web Vital, de mejor a peor. */
export type WebVitalRating = 'good' | 'needsImprovement' | 'poor'

/**
 * Umbrales públicos de Google, en la unidad del canal de la 0052 (LCP e INP en ms, CLS sin
 * unidad): hasta el primero (incluido), «bueno»; hasta el segundo (incluido), «mejorable»; por
 * encima, «pobre».
 */
export const WEB_VITAL_THRESHOLDS: Record<WebVital, readonly [good: number, poor: number]> = {
  lcp: [2_500, 4_000],
  cls: [0.1, 0.25],
  inp: [200, 500]
}

/** Calificación de un Core Web Vital; sin dato, null. */
export function webVitalRating(vital: WebVital, value: number | null): WebVitalRating | null {
  if (value === null || !Number.isFinite(value)) return null
  const [good, poor] = WEB_VITAL_THRESHOLDS[vital]
  if (value <= good) return 'good'
  return value <= poor ? 'needsImprovement' : 'poor'
}

const RATING_LEVEL: Record<WebVitalRating, ApdexLevel> = {
  good: 'success',
  needsImprovement: 'warning',
  poor: 'error'
}

/** Color de la calificación (siempre va con su texto); sin dato, normal. */
export function webVitalLevel(vital: WebVital, value: number | null): ApdexLevel {
  const rating = webVitalRating(vital, value)
  return rating === null ? 'normal' : RATING_LEVEL[rating]
}

/** CLS con dos decimales siempre: «0,18», «0,05». */
export function formatCls(value: number | null, language: string): string {
  if (value === null || !Number.isFinite(value)) return NO_DATA
  return formatNumber(value, language, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
