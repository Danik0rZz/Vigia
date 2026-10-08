import { formatNumber } from '@shared/format-number'

/**
 * Formato de los marcadores y gráficos de la página de un HOST (ficha 0018), con el idioma de
 * la interfaz. Sin dato (`null`), «—»: nunca un 0 inventado. Los números pasan por
 * `formatNumber` (separador de miles siempre, ficha 0012).
 */

const NO_DATA = '—'

/** Espacio duro entre el número y la unidad: «3,6 kbit/s» no se parte en dos líneas. */
const NBSP = '\u00a0'

/**
 * Umbrales de uso de CPU, memoria y disco (decisión de Dani al aprobar el lote «host»): aviso
 * por encima del 80 % y error por encima del 90 %. Fijos (los configurables quedan fuera de la
 * ficha 0018); «por encima» es estricto: un 80 % justo sigue siendo normal.
 */
export const USAGE_WARNING_PCT = 80
export const USAGE_ERROR_PCT = 90

export type UsageLevel = 'normal' | 'warning' | 'error'

/** Nivel de un uso en % (0–100); sin dato, normal (sin color). */
export function usageLevel(pct: number | null): UsageLevel {
  if (pct === null || !Number.isFinite(pct)) return 'normal'
  if (pct > USAGE_ERROR_PCT) return 'error'
  if (pct > USAGE_WARNING_PCT) return 'warning'
  return 'normal'
}

/** Uso en % (llega en 0–100), con un decimal como mucho: «33,5 %», «57 %». */
export function formatUsagePct(value: number | null, language: string): string {
  if (value === null || !Number.isFinite(value)) return NO_DATA
  return formatNumber(value / 100, language, { style: 'percent', maximumFractionDigits: 1 })
}

const BIT_UNITS = ['kbit/s', 'Mbit/s', 'Gbit/s'] as const

/**
 * Tráfico en bits/s con la unidad adaptada, de 1000 en 1000: bit/s sin decimales por debajo
 * de 1000 y kbit/s, Mbit/s o Gbit/s con un decimal. Por encima de 1000 Gbit/s se queda en Gbit/s.
 */
export function formatBitRate(bits: number | null, language: string): string {
  if (bits === null || !Number.isFinite(bits)) return NO_DATA
  if (Math.abs(Math.round(bits)) < 1000) {
    return `${formatNumber(Math.round(bits), language, { maximumFractionDigits: 0 })}${NBSP}bit/s`
  }
  let scaled = bits / 1000
  let unit = 0
  // Se mira el valor ya redondeado: 999.960 bit/s es «1,0 Mbit/s», no «1.000,0 kbit/s».
  while (unit < BIT_UNITS.length - 1 && Math.abs(Math.round(scaled * 10) / 10) >= 1000) {
    scaled /= 1000
    unit += 1
  }
  const text = formatNumber(scaled, language, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  })
  return `${text}${NBSP}${BIT_UNITS[unit] ?? 'Gbit/s'}`
}

/** Bytes en GB (10^9 bytes, como Dynatrace) con un decimal: «16,0 GB». */
export function formatGigabytes(bytes: number | null, language: string): string {
  if (bytes === null || !Number.isFinite(bytes)) return NO_DATA
  const text = formatNumber(bytes / 1_000_000_000, language, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  })
  return `${text}${NBSP}GB`
}
