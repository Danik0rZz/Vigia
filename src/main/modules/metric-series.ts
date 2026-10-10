import type { MetricResult, ServiceSeries } from '@shared/modules'
import { truncatedResults, type MetricData } from './metrics'

/**
 * Código común para transformar las respuestas de `GET /metrics/query` (MetricData de la
 * Environment API v2) en los canales de métricas de entidad (ficha 0057). Cada módulo se
 * queda con sus selectores y su transformación; aquí solo lo que todos repetían.
 *
 * Los resultados se casan por posición, no por `metricId`: Dynatrace devuelve las
 * expresiones en el orden pedido, pero quita las comillas de los filtros (ficha 0040).
 */

/** Una serie de la interfaz: `values[i]` es el valor en `timestamps[i]` (null sin dato). */
export type Series = ServiceSeries

/** Valores de una serie (null donde falta el dato). */
export type Values = (number | null)[]

/** Una serie de un desglose por dimensión: el nombre solo llega con `:names`. */
export interface DimensionEntry {
  name: string | null
  values: Values
}

/**
 * La primera serie del resultado en la posición `index` (con el selector acotado a una
 * entidad, la única), o una vacía. `index` undefined: la métrica no está en la consulta.
 */
export function seriesAt(data: MetricData, index: number | undefined): Series {
  const series = index === undefined ? undefined : data.result[index]?.data[0]
  return series === undefined
    ? { timestamps: [], values: [] }
    : { timestamps: series.timestamps, values: series.values }
}

/** Primer valor de una lista (serie de un punto, con `resolution=Inf`); null si no hay. */
export function firstValue(values: Values | undefined): number | null {
  return values?.[0] ?? null
}

/** Único valor de una consulta con `resolution=Inf`, o null (nunca undefined). */
export function singleValue(data: MetricData, index: number | undefined): number | null {
  return firstValue(seriesAt(data, index).values)
}

/** Valor del último punto con dato (el último llega a menudo a null); null si no hay ninguno. */
export function lastValue(values: Values | undefined): number | null {
  for (let i = (values?.length ?? 0) - 1; i >= 0; i -= 1) {
    const value = values?.[i]
    if (value !== null && value !== undefined) return value
  }
  return null
}

/**
 * Las series del resultado en la posición `index`, por id de la dimensión, con su nombre
 * (`<dimensión>.name`, que solo llega con `:names`). Una serie sin el id se descarta.
 */
export function seriesByDimension(
  data: MetricData,
  index: number,
  dimension: string
): Map<string, DimensionEntry> {
  const entries = new Map<string, DimensionEntry>()
  for (const series of data.result[index]?.data ?? []) {
    const id = series.dimensionMap[dimension]
    if (id === undefined || id === '') continue
    entries.set(id, {
      name: series.dimensionMap[`${dimension}.name`] ?? null,
      values: series.values
    })
  }
  return entries
}

/**
 * Ids de todas las series, en el orden en que aparecen, con su nombre: el primero que
 * llegue y, si no llega ninguno, el id.
 */
export function namesOf(maps: Map<string, { name: string | null }>[]): Map<string, string> {
  const names = new Map<string, string | null>()
  for (const map of maps) {
    for (const [id, entry] of map) {
      if (!names.has(id) || names.get(id) === null) names.set(id, entry.name)
    }
  }
  return new Map([...names].map(([id, name]) => [id, name ?? id]))
}

/** De mayor a menor; los null, al final. `sort` es estable: los empates guardan el orden. */
export function descending(a: number | null, b: number | null): number {
  if (a === null) return b === null ? 0 : 1
  if (b === null) return -1
  return b - a
}

/** De menor a mayor; los null, al final. */
export function ascending(a: number | null, b: number | null): number {
  if (a === null) return b === null ? 0 : 1
  if (b === null) return -1
  return a - b
}

/**
 * Avisos (sin repetir, en orden de llegada) y resultados recortados (ratio > 1,
 * `truncatedResults`) de todas las respuestas de un canal.
 */
export function mergeMeta(
  responses: readonly MetricData[]
): Pick<MetricResult, 'warnings' | 'partial'> {
  return {
    warnings: [...new Set(responses.flatMap((data) => data.warnings ?? []))],
    partial: responses.flatMap(truncatedResults)
  }
}
