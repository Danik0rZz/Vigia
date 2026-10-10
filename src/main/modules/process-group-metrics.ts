import { z } from 'zod'
import type {
  ProcessGroupInstance,
  ProcessGroupInstancesResult,
  ProcessGroupMetricsResult,
  ProcessSeries
} from '@shared/modules'
import { descending, mergeMeta, seriesAt, singleValue } from './metric-series'
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
 *
 * Ficha 0050 (paso 0 en vivo, en su "Verificación"):
 * - `:sort(value(avg,descending))` detrás de la CPU por instancia, con `Inf`, la ordena de más a
 *   menos, y `:limit(20)` además deja solo las 20 de más CPU;
 * - la memoria de esas 20 sale de la memoria de todas en la misma consulta, casada por id (una
 *   petición menos que filtrarla por los ids);
 * - `GET /entities` con el selector del grupo y `pageSize=1` da en `totalCount` el total real de
 *   instancias.
 *
 * Ninguna consulta pasa del límite de 10 expresiones de `metricSelector`.
 */

const G = 'builtin:tech.generic.'
const CPU = `${G}cpu.usage`
const MEMORY = `${G}mem.workingSetSize`
const NETWORK_IN = `${G}network.bytesRx`
const NETWORK_OUT = `${G}network.bytesTx`
const TOTAL = ':splitBy():sum'
const BY_INSTANCE =
  ':parents:splitBy("dt.entity.process_group_instance","dt.entity.host"):avg:names'
/** De más a menos CPU media (ficha 0050, probado en vivo con `Inf`). */
const SORT = ':sort(value(avg,descending))'

/** Instancias que trae `entities:processGroupMetrics`: las de más CPU (ficha 0050). */
export const PROCESS_GROUP_TOP_INSTANCES = 20

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

/**
 * Consulta 2 (medias del total y por instancia, con `resolution=Inf`), en este orden: los cuatro
 * totales, la CPU de las 20 de más CPU y la memoria de todas (ficha 0050).
 */
export const PROCESS_GROUP_MARKER_SELECTOR = [
  ...TOTALS,
  `${CPU}${BY_INSTANCE}${SORT}:limit(${PROCESS_GROUP_TOP_INSTANCES})`,
  `${MEMORY}${BY_INSTANCE}`
].join(',')

/**
 * Lista completa (canal `entities:processGroupInstances`, ficha 0050), con `resolution=Inf`: la
 * CPU de todas, ordenada, y la memoria de todas, en este orden.
 */
export const PROCESS_GROUP_INSTANCES_SELECTOR = [
  `${CPU}${BY_INSTANCE}${SORT}`,
  `${MEMORY}${BY_INSTANCE}`
].join(',')

/**
 * Respuesta de `GET /entities` con `pageSize=1` (`EntitiesList`): solo interesa `totalCount`,
 * el total real de instancias del grupo (ficha 0050).
 */
export const entityCountSchema = z.looseObject({
  totalCount: z.number().int().nonnegative().optional()
})
export type EntityCount = z.output<typeof entityCountSchema>

/** Máximo de los valores con dato de una serie; null si no tiene ninguno. */
function maxOf(series: ProcessSeries): number | null {
  const values = series.values.filter((value): value is number => value !== null)
  return values.length === 0 ? null : Math.max(...values)
}

/**
 * Instancias de las medias por instancia (CPU en `cpuIndex`, memoria en
 * `memoryIndex`), casadas por id. Ordenadas por CPU media de más a menos; las de
 * CPU null (o sin serie de CPU), al final. Sin nombre en dimensionMap, el id; sin host, null.
 */
function instancesOf(
  markers: MetricData,
  cpuIndex: number,
  memoryIndex: number
): ProcessGroupInstance[] {
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
  return [...byId.values()].sort((a, b) => descending(a.cpu, b.cpu))
}

/**
 * Las 20 de más CPU, el total real (de `totalCount`) y si se conoce. Sin `totalCount`, el
 * número de instancias distintas recibidas: las 20 de CPU y las de la memoria de todas.
 */
function topInstancesOf(
  markers: MetricData,
  totalCount: number | null
): ProcessGroupMetricsResult['instances'] {
  const all = instancesOf(markers, 4, 5)
  return {
    items: all.slice(0, PROCESS_GROUP_TOP_INSTANCES),
    total: totalCount ?? all.length,
    totalKnown: totalCount !== null
  }
}

/** El total real de la respuesta de `/entities`; null si no llegó (o no se pudo pedir). */
export function totalCountOf(count: EntityCount | null): number | null {
  return count?.totalCount ?? null
}

/**
 * Junta las dos respuestas en series, totales e instancias para la interfaz. `totalCount`, el
 * total real de instancias (null si `/entities` falló).
 */
export function toProcessGroupMetrics(
  series: MetricData,
  markers: MetricData,
  totalCount: number | null
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
      cpu: { avg: singleValue(markers, 0), max: maxOf(cpu) },
      memory: { avg: singleValue(markers, 1) },
      network: { in: singleValue(markers, 2), out: singleValue(markers, 3) }
    },
    instances: topInstancesOf(markers, totalCount),
    ...mergeMeta([series, markers])
  }
}

/**
 * Lista completa de instancias (canal `entities:processGroupInstances`, ficha 0050), de más a
 * menos CPU. `truncated`: la API recortó las series (ratio > 1) o llegan menos instancias que el
 * total real. Sin `totalCount`, el total es el número recibido y solo cuenta el recorte de la API.
 */
export function toProcessGroupInstances(
  data: MetricData,
  totalCount: number | null
): ProcessGroupInstancesResult {
  const items = instancesOf(data, 0, 1)
  const partial = truncatedResults(data).length > 0
  return {
    items,
    total: totalCount ?? items.length,
    truncated: partial || (totalCount !== null && items.length < totalCount)
  }
}
