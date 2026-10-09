import type { DiskMetricsResult, DiskSeries } from '@shared/modules'
import { truncatedResults, type MetricData } from './metrics'

/**
 * Métricas de una entidad DISK (ficha 0040, canal `entities:diskMetrics`). Lo observado en vivo
 * (paso 0, tabla en la "Verificación" de la ficha):
 * - las 16 de `builtin:host.disk.*` tienen el HOST como entidad y las dimensiones
 *   `dt.entity.host` y `dt.entity.disk`: con `entitySelector=entityId("<disco>")` no llega
 *   ninguna serie. El disco se acota con `:filter(eq("dt.entity.disk","<disco>"))` en cada
 *   expresión, que da una serie como mucho;
 * - el `metricId` de la respuesta no es la expresión enviada (Dynatrace quita las comillas del
 *   valor del filtro): los resultados se casan por posición;
 * - no todos los discos traen las de E/S (`readTime`/`writeTime` solo en uno por host): esos
 *   papeles llegan a null;
 * - los marcadores van con `resolution=Inf`, sin `fold` ni `last` (dan 400 con Inf); el libre es
 *   el último punto con dato de la serie de `avail`;
 * - como mucho 10 expresiones por consulta (OpenAPI, decisión de la 0039): 9 en las series y 6
 *   en los marcadores.
 */

const P = 'builtin:host.disk.'
const USED_PCT = `${P}usedPct`
const USED = `${P}used`
const AVAIL = `${P}avail`
const READ = `${P}bytesRead`
const WRITE = `${P}bytesWritten`
const READ_TIME = `${P}readTime`
const WRITE_TIME = `${P}writeTime`
const QUEUE = `${P}queueLength`
const INODES = `${P}inodesAvail`

/**
 * Filtro por el disco, la forma confirmada en vivo. El id ya viene validado por
 * `diskEntityIdSchema` (tipo y 16 hexadecimales): no puede cerrar la comilla ni el paréntesis.
 */
function diskFilter(entityId: string): string {
  return `:filter(eq("dt.entity.disk","${entityId}"))`
}

/** Consulta de series (sin resolution), en este orden. */
const SERIES_METRICS = [USED_PCT, USED, AVAIL, READ, WRITE, READ_TIME, WRITE_TIME, QUEUE, INODES]

/** Consulta de marcadores (con `resolution=Inf`): métrica y agregación, en este orden. */
const MARKER_METRICS: [string, string][] = [
  [USED_PCT, ':max'],
  [READ, ':avg'],
  [WRITE, ':avg'],
  [READ_TIME, ':avg'],
  [WRITE_TIME, ':avg'],
  [QUEUE, ':avg']
]

/** metricSelector de las series del disco (la agregación por defecto de cada métrica). */
export function diskSeriesSelector(entityId: string): string {
  const filter = diskFilter(entityId)
  return SERIES_METRICS.map((metric) => `${metric}${filter}`).join(',')
}

/** metricSelector de los marcadores del disco (la agregación, detrás del filtro). */
export function diskMarkerSelector(entityId: string): string {
  const filter = diskFilter(entityId)
  return MARKER_METRICS.map(([metric, aggregation]) => `${metric}${filter}${aggregation}`).join(',')
}

/** Posiciones de cada métrica en las dos consultas. */
const S = Object.fromEntries(SERIES_METRICS.map((metric, index) => [metric, index]))
const M = Object.fromEntries(MARKER_METRICS.map(([metric], index) => [metric, index]))

const EMPTY: DiskSeries = { timestamps: [], values: [] }

/** ¿Trae Dynatrace alguna serie en la posición `index`? */
function hasSeries(data: MetricData, index: number | undefined): boolean {
  return index !== undefined && (data.result[index]?.data.length ?? 0) > 0
}

/** La serie del resultado en la posición `index` (la única: el filtro deja un disco). */
function seriesAt(data: MetricData, index: number | undefined): DiskSeries {
  const series = index === undefined ? undefined : data.result[index]?.data[0]
  return series === undefined ? EMPTY : { timestamps: series.timestamps, values: series.values }
}

/** Único valor de la serie de un punto (consulta con `resolution=Inf`). */
function single(data: MetricData, index: number | undefined): number | null {
  const value = seriesAt(data, index).values[0]
  return value === undefined ? null : value
}

/** Último punto con dato de una serie (el último suele llegar a null). */
function lastValue(series: DiskSeries): number | null {
  for (let index = series.values.length - 1; index >= 0; index -= 1) {
    const value = series.values[index]
    if (value !== null && value !== undefined) return value
  }
  return null
}

/** Junta las dos respuestas en series y marcadores por papel para la interfaz. */
export function toDiskMetrics(series: MetricData, markers: MetricData): DiskMetricsResult {
  // Un papel opcional existe si Dynatrace trae alguna serie de sus métricas, en series o en
  // marcadores.
  const present = (...metrics: string[]): boolean =>
    metrics.some((metric) => hasSeries(series, S[metric]) || hasSeries(markers, M[metric]))
  const hasLatency = present(READ_TIME, WRITE_TIME)
  const hasQueue = present(QUEUE)
  const hasInodes = present(INODES)
  const free = seriesAt(series, S[AVAIL])

  return {
    resolution: series.resolution,
    series: {
      usage: seriesAt(series, S[USED_PCT]),
      space: { used: seriesAt(series, S[USED]), free },
      throughput: { read: seriesAt(series, S[READ]), write: seriesAt(series, S[WRITE]) },
      latency: hasLatency
        ? { read: seriesAt(series, S[READ_TIME]), write: seriesAt(series, S[WRITE_TIME]) }
        : null,
      queue: hasQueue ? seriesAt(series, S[QUEUE]) : null,
      inodes: hasInodes ? seriesAt(series, S[INODES]) : null
    },
    totals: {
      usage: single(markers, M[USED_PCT]),
      free: lastValue(free),
      throughput: { read: single(markers, M[READ]), write: single(markers, M[WRITE]) },
      latency: hasLatency
        ? { read: single(markers, M[READ_TIME]), write: single(markers, M[WRITE_TIME]) }
        : null,
      queue: hasQueue ? single(markers, M[QUEUE]) : null
    },
    warnings: [...new Set([...(series.warnings ?? []), ...(markers.warnings ?? [])])],
    partial: [...truncatedResults(series), ...truncatedResults(markers)]
  }
}
