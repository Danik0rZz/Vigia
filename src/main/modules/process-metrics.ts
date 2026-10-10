import type { ProcessMetricsResult } from '@shared/modules'
import { mergeMeta, seriesAt, singleValue } from './metric-series'
import type { MetricData } from './metrics'

/**
 * Métricas de una entidad PROCESS_GROUP_INSTANCE (ficha 0027, canal
 * `entities:processMetrics`). Lo observado en vivo (paso 0 y confirmación de la
 * decisión del Orquestador, tabla en la "Verificación" de la ficha):
 * - con `entitySelector=entityId("<id>")` cada expresión de abajo (exactamente la
 *   probada) vuelve con una serie como mucho, en el orden pedido y con `metricId`
 *   igual a la expresión: se casan por posición, como en el host y el monitor;
 * - un proceso sin descriptores de fichero o sin datos de red llega sin series en
 *   esas métricas: series vacías y marcadores a null;
 * - los marcadores van con `resolution=Inf` y sin `fold` (juntos dan 400);
 * - salud de red (`packets.retransmission`) solo lleva serie: la especificación no
 *   le pide marcador;
 * - unidades: % (CPU, disponibilidad, retransmisiones, descriptores), bytes
 *   (memoria) y bytes/s (red); se entregan sin convertir.
 */

const G = 'builtin:tech.generic.'
const CPU = `${G}cpu.usage`
const MEMORY = `${G}mem.workingSetSize`
const NETWORK_IN = `${G}network.bytesRx`
const NETWORK_OUT = `${G}network.bytesTx`
const NETWORK_HEALTH = `${G}network.packets.retransmission`
const AVAILABILITY = 'builtin:pgi.availability'
const RESOURCES = `${G}handles.fileDescriptorsPercentUsed`

/**
 * entitySelector que acota las dos consultas al proceso. El id ya viene validado
 * por `processEntityIdSchema` (tipo y 16 hexadecimales): no puede cerrar la
 * comilla ni el paréntesis.
 */
export function processEntitySelector(entityId: string): string {
  return `entityId("${entityId}")`
}

/** Consulta 1 (series, sin resolution), en este orden. */
export const PROCESS_SERIES_SELECTOR = [
  CPU,
  MEMORY,
  NETWORK_IN,
  NETWORK_OUT,
  NETWORK_HEALTH,
  AVAILABILITY,
  RESOURCES
].join(',')

/** Consulta 2 (marcadores, con `resolution=Inf`), en este orden. */
export const PROCESS_MARKER_SELECTOR = [
  `${CPU}:avg`,
  `${CPU}:max`,
  `${MEMORY}:avg`,
  `${MEMORY}:max`,
  `${NETWORK_IN}:avg`,
  `${NETWORK_OUT}:avg`,
  `${AVAILABILITY}:avg`,
  `${RESOURCES}:max`
].join(',')

/** Junta las dos respuestas en series y marcadores por papel para la interfaz. */
export function toProcessMetrics(series: MetricData, markers: MetricData): ProcessMetricsResult {
  return {
    resolution: series.resolution,
    series: {
      cpu: seriesAt(series, 0),
      memory: seriesAt(series, 1),
      network: { in: seriesAt(series, 2), out: seriesAt(series, 3) },
      networkHealth: seriesAt(series, 4),
      availability: seriesAt(series, 5),
      resources: seriesAt(series, 6)
    },
    totals: {
      cpu: { avg: singleValue(markers, 0), max: singleValue(markers, 1) },
      memory: { avg: singleValue(markers, 2), max: singleValue(markers, 3) },
      network: { in: singleValue(markers, 4), out: singleValue(markers, 5) },
      availability: singleValue(markers, 6),
      resources: singleValue(markers, 7)
    },
    ...mergeMeta([series, markers])
  }
}
