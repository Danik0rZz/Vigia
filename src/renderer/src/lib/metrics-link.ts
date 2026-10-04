import { MAX_CUSTOM_RANGE_MS, timeRangeSchema, type CustomTimeRange } from '@shared/time-range'

/** Margen alrededor del problema: se ve el "antes" del cambio y el final. */
const MARGIN_MS = 30 * 60_000
/** Si el rango no tiene sentido (inicio después del fin), la última hora. */
const FALLBACK_MS = 60 * 60_000
const MAX_SELECTOR = 2000

/**
 * Enlace a Métricas con una métrica y el rango de un problema (con margen y
 * sin pasar de "ahora"). Sin filtro por entidad: la clave de dimensión de la
 * entidad no viene en la evidencia y no se inventa.
 */
export function metricsLink(
  metricId: string,
  problem: { startTime: number; endTime: number | null },
  now: number
): string {
  const to = Math.min(now, (problem.endTime ?? now) + MARGIN_MS)
  let from = problem.startTime - MARGIN_MS
  // Siempre un rango que Métricas acepta: un inicio en el futuro (desfase de
  // reloj) da la última hora, y un problema de hace más de un año, el último año.
  if (from >= to) from = to - FALLBACK_MS
  if (to - from > MAX_CUSTOM_RANGE_MS) from = to - MAX_CUSTOM_RANGE_MS
  const params = new URLSearchParams({
    selector: metricId,
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString()
  })
  return `/metrics?${params.toString()}`
}

/**
 * Lo que pide la URL de Métricas (?selector=&from=&to=), validado: un
 * selector no vacío y un rango personalizado válido (desde antes que hasta,
 * como mucho un año). Cualquier otra cosa → null.
 */
export function parseMetricsSearch(
  params: URLSearchParams
): { selector: string; range: CustomTimeRange } | null {
  const selector = params.get('selector')?.trim() ?? ''
  if (selector === '' || selector.length > MAX_SELECTOR) return null
  const range = timeRangeSchema.safeParse({ from: params.get('from'), to: params.get('to') })
  if (!range.success || typeof range.data === 'string') return null
  return { selector, range: range.data }
}
