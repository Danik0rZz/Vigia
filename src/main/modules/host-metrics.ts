import type { HostMetricsResult, HostSeries } from '@shared/modules'
import { truncatedResults, type MetricData } from './metrics'

/**
 * Métricas de una entidad HOST (ficha 0016, canal `entities:hostMetrics`).
 * Lo observado en vivo (paso 0 de la ficha 0016):
 * - las 10 expresiones de series caben en una consulta con
 *   `entitySelector=entityId("<id>")` y vuelven en el orden pedido: se casan por
 *   posición, como en el servicio;
 * - red y disco llegan con una serie por interfaz o por disco: `:splitBy():sum`
 *   (red) y `:splitBy():max` (disco) dan una sola serie, igual a la suma o al
 *   máximo por punto, también con `resolution=Inf`;
 * - los marcadores van con `resolution=Inf` y sin `fold` (juntos dan 400): media
 *   del rango real y máximo real, que no sale de la serie de medias;
 * - el último punto llega a menudo a null: usada y total de la memoria salen del
 *   último punto con dato de la serie (Inf solo da la media);
 * - unidades: % en 0–100, bytes y bits/s; se entregan sin convertir.
 */

const CPU = 'builtin:host.cpu.usage'
const CPU_USER = 'builtin:host.cpu.user'
const CPU_SYSTEM = 'builtin:host.cpu.system'
const CPU_IOWAIT = 'builtin:host.cpu.iowait'
const LOAD = 'builtin:host.cpu.load'
const MEM = 'builtin:host.mem.usage'
const MEM_USED = 'builtin:host.mem.used'
/** Solo admite la agregación `value`: va sin agregación. */
const MEM_TOTAL = 'builtin:host.mem.total'
/** Todas las interfaces sumadas. */
const NET_IN = 'builtin:host.net.nic.trafficIn:splitBy():sum'
const NET_OUT = 'builtin:host.net.nic.trafficOut:splitBy():sum'
/** El disco más lleno. */
const DISK = 'builtin:host.disk.usedPct:splitBy():max'

/**
 * entitySelector que acota las dos consultas al host. El id ya viene validado por
 * `hostEntityIdSchema` (HOST- y 16 hexadecimales): no puede cerrar la comilla ni
 * el paréntesis.
 */
export function hostEntitySelector(entityId: string): string {
  return `entityId("${entityId}")`
}

/** Consulta 1 (series), en este orden: CPU (total y desglose), memoria, red y disco. */
export const HOST_SERIES_SELECTOR = [
  CPU,
  CPU_USER,
  CPU_SYSTEM,
  CPU_IOWAIT,
  MEM,
  MEM_USED,
  MEM_TOTAL,
  NET_IN,
  NET_OUT,
  DISK
].join(',')

/** Consulta 2 (marcadores, con `resolution=Inf`), en este orden. */
export const HOST_MARKER_SELECTOR = [CPU, `${CPU}:max`, MEM, NET_IN, NET_OUT, DISK, LOAD].join(',')

const EMPTY: HostSeries = { timestamps: [], values: [] }

/** La serie del resultado en la posición `index` (la única: el selector deja un host). */
function seriesAt(data: MetricData, index: number): HostSeries {
  const series = data.result[index]?.data[0]
  return series === undefined ? EMPTY : { timestamps: series.timestamps, values: series.values }
}

/** Valor del último punto con dato de la serie; null si no hay ninguno. */
function lastValue(series: HostSeries): number | null {
  for (let i = series.values.length - 1; i >= 0; i -= 1) {
    const value = series.values[i]
    if (value !== null && value !== undefined) return value
  }
  return null
}

/** Único valor de la serie de un punto (consulta con `resolution=Inf`). */
function single(data: MetricData, index: number): number | null {
  const value = seriesAt(data, index).values[0]
  return value === undefined ? null : value
}

/** Junta las dos respuestas en series y totales para la interfaz. */
export function toHostMetrics(series: MetricData, markers: MetricData): HostMetricsResult {
  return {
    resolution: series.resolution,
    series: {
      cpu: seriesAt(series, 0),
      cpuBreakdown: {
        user: seriesAt(series, 1),
        system: seriesAt(series, 2),
        iowait: seriesAt(series, 3)
      },
      memory: seriesAt(series, 4),
      network: { in: seriesAt(series, 7), out: seriesAt(series, 8) },
      disk: seriesAt(series, 9)
    },
    totals: {
      cpu: { avg: single(markers, 0), max: single(markers, 1) },
      memory: {
        avg: single(markers, 2),
        used: lastValue(seriesAt(series, 5)),
        total: lastValue(seriesAt(series, 6))
      },
      network: { in: single(markers, 3), out: single(markers, 4) },
      disk: { max: single(markers, 5) },
      load: { avg: single(markers, 6) }
    },
    warnings: [...new Set([...(series.warnings ?? []), ...(markers.warnings ?? [])])],
    partial: [...truncatedResults(series), ...truncatedResults(markers)]
  }
}
