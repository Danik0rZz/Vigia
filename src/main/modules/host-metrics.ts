import type { HostMetricsResult } from '@shared/modules'
import { lastValue, mergeMeta, seriesAt, singleValue } from './metric-series'
import type { MetricData } from './metrics'

/**
 * Métricas de una entidad HOST (ficha 0016, canal `entities:hostMetrics`).
 * Lo observado en vivo (paso 0 de la ficha 0016):
 * - con `entitySelector=entityId("<id>")`, las expresiones vuelven en el orden
 *   pedido: se casan por posición, como en el servicio;
 * - la OpenAPI admite «up to 10 metrics» por consulta (en vivo hoy pasan 11, pero no
 *   se cuenta con ello: ficha 0039). Con la recuperable, las series son 11 y van en
 *   dos consultas en paralelo: CPU, red y disco, y memoria;
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
/** Memoria que el sistema puede liberar (ficha 0039; Byte, una serie por host). */
const MEM_RECL = 'builtin:host.mem.recl'
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

/** Consulta 1a (series), en este orden: CPU (total y desglose), red y disco. */
const CPU_NET_DISK_SERIES = [CPU, CPU_USER, CPU_SYSTEM, CPU_IOWAIT, NET_IN, NET_OUT, DISK]
/** Consulta 1b (series), en este orden: memoria en %, usada, total y recuperable. */
const MEMORY_SERIES = [MEM, MEM_USED, MEM_TOTAL, MEM_RECL]

/**
 * Selectores de las consultas de series, en el orden que espera `toHostMetrics`.
 * Ninguno pasa de 10 expresiones (límite de la OpenAPI de `/metrics/query`).
 */
export const HOST_SERIES_SELECTORS = [
  CPU_NET_DISK_SERIES.join(','),
  MEMORY_SERIES.join(',')
] as const

/** Consulta 2 (marcadores, con `resolution=Inf`), en este orden. */
export const HOST_MARKER_SELECTOR = [CPU, `${CPU}:max`, MEM, NET_IN, NET_OUT, DISK, LOAD].join(',')

/**
 * Junta las respuestas en series y totales para la interfaz: las de series son las de
 * `HOST_SERIES_SELECTORS`, en su orden (CPU, red y disco; memoria).
 */
export function toHostMetrics(
  [main, memory]: [MetricData, MetricData],
  markers: MetricData
): HostMetricsResult {
  const used = seriesAt(memory, 1)
  const total = seriesAt(memory, 2)
  const reclaimable = seriesAt(memory, 3)
  return {
    // Las dos consultas de series piden el mismo rango sin resolución: la API elige la misma.
    resolution: main.resolution,
    series: {
      cpu: seriesAt(main, 0),
      cpuBreakdown: {
        user: seriesAt(main, 1),
        system: seriesAt(main, 2),
        iowait: seriesAt(main, 3)
      },
      memory: seriesAt(memory, 0),
      memoryBytes: { used, reclaimable, total },
      network: { in: seriesAt(main, 4), out: seriesAt(main, 5) },
      disk: seriesAt(main, 6)
    },
    totals: {
      cpu: { avg: singleValue(markers, 0), max: singleValue(markers, 1) },
      memory: {
        avg: singleValue(markers, 2),
        used: lastValue(used.values),
        total: lastValue(total.values),
        reclaimable: lastValue(reclaimable.values)
      },
      network: { in: singleValue(markers, 3), out: singleValue(markers, 4) },
      disk: { max: singleValue(markers, 5) },
      load: { avg: singleValue(markers, 6) }
    },
    ...mergeMeta([main, memory, markers])
  }
}
