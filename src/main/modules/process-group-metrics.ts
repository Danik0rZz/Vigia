import type {
  ProcessGroupInstance,
  ProcessGroupMetricsResult,
  ProcessSeries
} from '@shared/modules'
import { truncatedResults, type MetricData } from './metrics'

/**
 * Métricas de una entidad PROCESS_GROUP (ficha 0031, canal
 * `entities:processGroupMetrics`). Lo observado en vivo (paso 0, en la
 * "Verificación" de la ficha):
 * - las métricas de la instancia solo tienen la dimensión
 *   `dt.entity.process_group_instance`: con `entityId("<grupo>")` no llega nada; las
 *   instancias del grupo se eligen con `fromRelationships.isInstanceOf`;
 * - el total del grupo es `:splitBy():sum` (punto a punto, la suma de las
 *   instancias); con `resolution=Inf`, la media del total en el rango. Ninguna
 *   expresión con `Inf` da el máximo de la suma: la CPU máxima sale de la serie;
 * - por instancia, `:parents:splitBy(instancia, host):avg:names` con `Inf` trae en
 *   `dimensionMap` el id y el nombre de la instancia y de su host;
 * - cada expresión vuelve en el orden pedido, con `metricId` igual a la expresión:
 *   se casan por posición, como en el proceso;
 * - unidades sin convertir: % (la CPU del grupo puede pasar de 100), bytes y bytes/s.
 */

const G = 'builtin:tech.generic.'
const CPU = `${G}cpu.usage`
const MEMORY = `${G}mem.workingSetSize`
const NETWORK_IN = `${G}network.bytesRx`
const NETWORK_OUT = `${G}network.bytesTx`
const TOTAL = ':splitBy():sum'
const BY_INSTANCE =
  ':parents:splitBy("dt.entity.process_group_instance","dt.entity.host"):avg:names'

const INSTANCE_DIMENSION = 'dt.entity.process_group_instance'
const HOST_DIMENSION = 'dt.entity.host'

/**
 * entitySelector de las instancias del grupo (paso 0). El id ya viene validado por
 * `processGroupEntityIdSchema` (tipo y 16 hexadecimales): no puede cerrar la
 * comilla ni el paréntesis.
 */
export function processGroupEntitySelector(entityId: string): string {
  return `type("PROCESS_GROUP_INSTANCE"),fromRelationships.isInstanceOf(entityId("${entityId}"))`
}

const TOTALS = [CPU, MEMORY, NETWORK_IN, NETWORK_OUT].map((metric) => `${metric}${TOTAL}`)

/** Consulta 1 (series del total, sin resolution), en este orden. */
export const PROCESS_GROUP_SERIES_SELECTOR = TOTALS.join(',')

/** Consulta 2 (medias del total y por instancia, con `resolution=Inf`), en este orden. */
export const PROCESS_GROUP_MARKER_SELECTOR = [
  ...TOTALS,
  `${CPU}${BY_INSTANCE}`,
  `${MEMORY}${BY_INSTANCE}`
].join(',')

const EMPTY: ProcessSeries = { timestamps: [], values: [] }

/** La serie del resultado en la posición `index` (la única: `splitBy()` deja una). */
function seriesAt(data: MetricData, index: number): ProcessSeries {
  const series = data.result[index]?.data[0]
  return series === undefined ? EMPTY : { timestamps: series.timestamps, values: series.values }
}

/** Único valor de la serie de un punto (consulta con `resolution=Inf`). */
function single(data: MetricData, index: number): number | null {
  const value = seriesAt(data, index).values[0]
  return value === undefined ? null : value
}

/** Máximo de los valores con dato de una serie; null si no tiene ninguno. */
function maxOf(series: ProcessSeries): number | null {
  const values = series.values.filter((value): value is number => value !== null)
  return values.length === 0 ? null : Math.max(...values)
}

/**
 * Instancias de las medias por instancia (CPU en `cpuIndex`, memoria en
 * `memoryIndex`), casadas por id. Ordenadas por CPU media de más a menos; las de
 * CPU null, al final. Sin nombre en dimensionMap, el id; sin host, null.
 */
function instancesOf(
  markers: MetricData,
  cpuIndex: number,
  memoryIndex: number
): ProcessGroupMetricsResult['instances'] {
  const byId = new Map<string, ProcessGroupInstance>()
  const collect = (index: number, role: 'cpu' | 'memory'): void => {
    for (const series of markers.result[index]?.data ?? []) {
      const map = series.dimensionMap
      const id = map[INSTANCE_DIMENSION]
      if (id === undefined) continue
      const instance = byId.get(id) ?? {
        id,
        name: id,
        hostId: null,
        hostName: null,
        cpu: null,
        memory: null
      }
      const name = map[`${INSTANCE_DIMENSION}.name`]
      if (name !== undefined) instance.name = name
      instance.hostId ??= map[HOST_DIMENSION] ?? null
      instance.hostName ??= map[`${HOST_DIMENSION}.name`] ?? null
      instance[role] = series.values[0] ?? null
      byId.set(id, instance)
    }
  }
  collect(cpuIndex, 'cpu')
  collect(memoryIndex, 'memory')
  const items = [...byId.values()].sort((a, b) => {
    if (a.cpu === null) return b.cpu === null ? 0 : 1
    if (b.cpu === null) return -1
    return b.cpu - a.cpu
  })
  return { items, total: items.length }
}

/** Junta las dos respuestas en series, totales e instancias para la interfaz. */
export function toProcessGroupMetrics(
  series: MetricData,
  markers: MetricData
): ProcessGroupMetricsResult {
  const cpu = seriesAt(series, 0)
  return {
    resolution: series.resolution,
    series: {
      cpu,
      memory: seriesAt(series, 1),
      network: { in: seriesAt(series, 2), out: seriesAt(series, 3) }
    },
    totals: {
      cpu: { avg: single(markers, 0), max: maxOf(cpu) },
      memory: { avg: single(markers, 1) },
      network: { in: single(markers, 2), out: single(markers, 3) }
    },
    instances: instancesOf(markers, 4, 5),
    warnings: [...new Set([...(series.warnings ?? []), ...(markers.warnings ?? [])])],
    partial: [...truncatedResults(series), ...truncatedResults(markers)]
  }
}
