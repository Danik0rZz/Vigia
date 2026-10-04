/** Resoluciones que puede sugerir la interfaz, de más fina a más gruesa. */
export const RESOLUTION_STEPS = ['1m', '5m', '10m', '1h', '6h', '1d'] as const

/**
 * Por encima de estos puntos por serie se avisa. Referencia medida en vivo: 1m
 * en 7 días son 10 081 puntos por serie, y la API los devuelve sin rebajar la
 * resolución ni avisar.
 */
export const POINTS_WARNING = 2000

/** Puntos que usa la API si no se le da resolución (OpenAPI de /metrics/query). */
const DEFAULT_POINTS = 120

const UNIT_MS: Record<string, number> = {
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 7 * 86_400_000,
  M: 30 * 86_400_000,
  q: 91 * 86_400_000,
  y: 365 * 86_400_000
}

/** Duración de una resolución de intervalo ('10m', '1h'…); null si es N puntos o 'Inf'. */
export function resolutionMs(resolution: string): number | null {
  const match = /^(\d+)([mhdwMqy])$/.exec(resolution)
  if (match === null) return null
  return Number(match[1]) * (UNIT_MS[match[2] ?? ''] ?? 0)
}

/** Puntos por serie que devolverá /metrics/query para ese rango y esa resolución. */
export function estimatePoints(spanMs: number, resolution: string | undefined): number {
  if (resolution === undefined || resolution === '') return DEFAULT_POINTS
  if (resolution === 'Inf') return 1
  if (/^\d+$/.test(resolution)) return Number(resolution)
  const step = resolutionMs(resolution)
  if (step === null || step <= 0) return DEFAULT_POINTS
  return Math.ceil(spanMs / step) + 1
}

/** La resolución más fina que se queda en `limit` puntos por serie (o '1d' si ninguna). */
export function suggestResolution(spanMs: number, limit: number = POINTS_WARNING): string {
  return RESOLUTION_STEPS.find((step) => estimatePoints(spanMs, step) <= limit) ?? '1d'
}

/**
 * Nombre de una serie en la leyenda: sus dimensiones y, si la consulta tiene
 * varias métricas, el metricId delante (si no, dos series del mismo host se
 * llamarían igual).
 */
export function seriesName(
  series: { metricId: string; dimensions: Readonly<Record<string, string>> },
  multipleMetrics: boolean
): string {
  const dimensions = Object.values(series.dimensions)
  if (dimensions.length === 0) return series.metricId
  const joined = dimensions.join(' · ')
  return multipleMetrics ? `${series.metricId} · ${joined}` : joined
}
