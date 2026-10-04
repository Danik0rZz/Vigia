import { z } from 'zod'
import { estimatePoints } from './metric-points'
import { MAX_CUSTOM_RANGE_MS } from './time-range'

/** Clave del selector de métrica de un evento (observada en vivo; no está en la OpenAPI). */
export const METRIC_SELECTOR_KEY = 'dt.event.metric_selector'
/** Clave del umbral que la acompaña (observada en vivo). */
export const METRIC_THRESHOLD_KEY = 'dt.event.metric_threshold'
/** El mismo máximo que el selector de metrics:query. */
export const MAX_EVENT_SELECTOR = 2000

/**
 * Métrica de un evento: el selector y el umbral, o "demasiado largo" si el
 * selector pasa de 2000 caracteres. Un selector nunca se recorta: cortado
 * sería otra consulta (un gráfico falso o un 400 confuso).
 */
export type EventMetric =
  { status: 'ok'; selector: string; threshold: number | null } | { status: 'tooLong' }

/** EventMetric tal como cruza el IPC (dentro de cada evidencia). */
export const eventMetricSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ok'),
    selector: z.string().min(1).max(MAX_EVENT_SELECTOR),
    threshold: z.number().nullable()
  }),
  z.object({ status: z.literal('tooLong') })
])

/** Número de un texto de Dynatrace: "85", " 85.5 ", "1e-3" o "85 %"; si no, null. */
export function parseLooseNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null
  const match = /^\s*(-?\d+(?:[.,]\d+)?(?:e[-+]?\d+)?)/i.exec(value)
  if (match === null) return null
  const number = Number((match[1] ?? '').replace(',', '.'))
  return Number.isFinite(number) ? number : null
}

/**
 * Selector y umbral de un evento, buscados por clave EXACTA en sus
 * propiedades (en crudo: los values llegan como texto). Sin selector, o vacío,
 * null; de más de 2000 caracteres, { status: 'tooLong' }.
 */
export function eventMetricInfo(
  properties: readonly { key?: unknown; value?: unknown }[]
): EventMetric | null {
  const selector = properties.find((property) => property.key === METRIC_SELECTOR_KEY)?.value
  if (typeof selector !== 'string') return null
  const trimmed = selector.trim()
  if (trimmed === '') return null
  if (trimmed.length > MAX_EVENT_SELECTOR) return { status: 'tooLong' }
  const threshold = properties.find((property) => property.key === METRIC_THRESHOLD_KEY)?.value
  return { status: 'ok', selector: trimmed, threshold: parseLooseNumber(threshold) }
}

const MINUTE = 60_000
/** Antes del inicio, como mínimo: se ve el "antes" del cambio. */
const MIN_BEFORE_MS = 30 * MINUTE
/** Después del fin, cuando ha terminado. */
const AFTER_MS = 15 * MINUTE

/**
 * Rango del gráfico de una evidencia: desde su inicio menos max(30 min, su
 * duración) hasta su fin más 15 min, o hasta ahora si sigue activa. Sin pasar
 * de ahora ni de un año, y nunca al revés.
 */
export function evidenceMetricRange(
  evidence: { start: number | null; end: number | 'ACTIVE' },
  problem: { startTime: number },
  now: number
): { from: number; to: number } {
  const start = evidence.start ?? problem.startTime
  const end = evidence.end === 'ACTIVE' ? null : evidence.end
  const duration = Math.max(0, (end ?? now) - start)
  const to = Math.min(now, end === null ? now : end + AFTER_MS)
  let from = start - Math.max(MIN_BEFORE_MS, duration)
  if (from >= to) from = to - MIN_BEFORE_MS * 2
  if (to - from > MAX_CUSTOM_RANGE_MS) from = to - MAX_CUSTOM_RANGE_MS
  return { from, to }
}

/** Intervalos que puede usar el mini gráfico, de menor a mayor. */
export const CHART_RESOLUTIONS = ['1m', '5m', '10m', '30m', '1h', '6h', '1d'] as const
/** Puntos por serie que se buscan: unos 150 (nunca más de 200). */
const CHART_MAX_POINTS = 200

/** El intervalo más fino que no pasa de unos 150-200 puntos por serie (como mínimo, 1m). */
export function pickResolution(from: number, to: number): string {
  const span = Math.max(0, to - from)
  return CHART_RESOLUTIONS.find((step) => estimatePoints(span, step) <= CHART_MAX_POINTS) ?? '1d'
}

/**
 * Series que se dibujan: primero la de la entidad de la evidencia (la que
 * tiene su id como valor de alguna dimensión, normalmente dt.entity.*), luego
 * las demás en su orden, como mucho `max`. `highlighted` es el índice en
 * `shown` de la de la entidad, o null.
 */
export function selectSeries<T extends { dimensions: Readonly<Record<string, string>> }>(
  series: readonly T[],
  entityId: string | null,
  max = 10
): { shown: T[]; total: number; highlighted: number | null } {
  const index =
    entityId === null
      ? -1
      : series.findIndex((item) => Object.values(item.dimensions).includes(entityId))
  const ordered =
    index < 0
      ? [...series]
      : [series[index] as T, ...series.filter((_item, position) => position !== index)]
  return {
    shown: ordered.slice(0, max),
    total: series.length,
    highlighted: index < 0 ? null : 0
  }
}

export type EvidenceMetricState = 'incompatible' | 'forbidden' | 'noData' | 'error'

/**
 * Qué decir cuando el gráfico no se puede pintar: un selector que la API v2
 * no acepta (400), un permiso que falta (403), una consulta sin series o
 * cualquier otro error.
 */
export function evidenceMetricState(
  error: { code: string } | null,
  seriesCount: number
): EvidenceMetricState | null {
  if (error !== null) {
    if (error.code === 'BAD_REQUEST') return 'incompatible'
    if (error.code === 'FORBIDDEN') return 'forbidden'
    return 'error'
  }
  return seriesCount === 0 ? 'noData' : null
}
