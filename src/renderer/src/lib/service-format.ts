/**
 * Formato de los marcadores de la página de un SERVICE (ficha 0008), con el
 * idioma de la interfaz. Sin dato (`null`), «—»: nunca un 0 inventado.
 *
 * Los recuentos usan el separador de miles de Intl tal cual: en español no
 * agrupa los números de 4 cifras («1234»), que es lo normal de es-ES.
 */

const NO_DATA = '—'

/** Espacio duro entre el número y la unidad: «850 ms» no se parte en dos líneas. */
const NBSP = '\u00a0'

/** De ms a «850 ms» (menos de un segundo, sin decimales) o «1,2 s» (un decimal). */
export function formatDurationMs(value: number | null, language: string): string {
  if (value === null || !Number.isFinite(value)) return NO_DATA
  const millis = Math.round(value)
  // 999,6 ms se redondea a 1000: ya es «1,0 s», no «1000 ms».
  if (Math.abs(millis) < 1000) {
    return `${new Intl.NumberFormat(language, { maximumFractionDigits: 0 }).format(millis)}${NBSP}ms`
  }
  const seconds = new Intl.NumberFormat(language, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  }).format(value / 1000)
  return `${seconds}${NBSP}s`
}

/** Recuento con el separador de miles del idioma. */
export function formatCount(value: number | null, language: string): string {
  if (value === null || !Number.isFinite(value)) return NO_DATA
  return new Intl.NumberFormat(language, { maximumFractionDigits: 0 }).format(value)
}

/** Tasa de error: llega en % (0–100) y se enseña con un decimal. */
export function formatErrorRate(value: number | null, language: string): string {
  if (value === null || !Number.isFinite(value)) return NO_DATA
  return new Intl.NumberFormat(language, {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  }).format(value / 100)
}

/** Unidades de la resolución de la API de métricas v2 (`1m`, `5m`, `1h`, `1d`…). */
export type ResolutionUnit = 's' | 'm' | 'h' | 'd' | 'w'

/**
 * La resolución que devuelve Dynatrace, en cantidad y unidad (`5m` → 5 y m).
 * Lo que no se reconoce (por ejemplo, `Inf`) da null y se enseña tal cual.
 */
export function parseResolution(
  resolution: string
): { amount: number; unit: ResolutionUnit } | null {
  const match = /^(\d+)([smhdw])$/.exec(resolution.trim())
  if (match === null) return null
  const amount = Number(match[1])
  if (!Number.isSafeInteger(amount) || amount <= 0) return null
  return { amount, unit: match[2] as ResolutionUnit }
}
