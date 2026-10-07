import type { ServiceMetricsResult, ServiceSeries } from '@shared/modules'
import { truncatedResults, type MetricData } from './metrics'

/**
 * Métricas de una entidad SERVICE (ficha 0006, canal `entities:serviceMetrics`).
 * Lo observado en vivo (paso 0 de la ficha 0006):
 * - las 6 expresiones de series caben en una consulta y vuelven en el orden
 *   pedido; el `metricId` devuelto no es la expresión enviada (Dynatrace quita
 *   las comillas del id del filtro), así que se casan por posición;
 * - `:fold(...)` con `resolution=Inf` en la misma consulta da 400: los totales de
 *   peticiones y errores salen de sumar la serie (igual que `fold(sum)`) y los
 *   tiempos del rango van en una segunda consulta con `resolution=Inf` (mediana y
 *   percentiles reales del rango, no una media de medianas);
 * - `response.server` llega en microsegundos y `errors.server.rate` en porcentaje;
 * - `requestCount.server` incluye las peticiones con error: OK = total − errores.
 */

const RESPONSE = 'builtin:service.response.server'
const REQUESTS = 'builtin:service.requestCount.server'
const ERRORS = 'builtin:service.errors.server.count'
const RATE = 'builtin:service.errors.server.rate'

/** De microsegundos (unidad de `response.server`) a milisegundos. */
const MICROS_PER_MILLI = 1000

/**
 * Filtro y reparto por el servicio, como en la petición original. El id ya viene
 * validado por `serviceEntityIdSchema` (SERVICE- y 16 hexadecimales): no puede
 * cerrar la comilla ni el paréntesis.
 */
function scope(entityId: string): string {
  return `:filter(eq("dt.entity.service","${entityId}")):splitBy("dt.entity.service")`
}

/** Las tres expresiones de tiempos (mediana, p90 y p99), en ese orden. */
function responseTimeExpressions(entityId: string): string[] {
  const s = scope(entityId)
  return [
    `${RESPONSE}${s}:median`,
    `${RESPONSE}${s}:percentile(90.0)`,
    `${RESPONSE}${s}:percentile(99.0)`
  ]
}

/** Consulta 1 (series): tiempos, peticiones, errores y tasa, en este orden. */
export function seriesSelector(entityId: string): string {
  const s = scope(entityId)
  return [
    ...responseTimeExpressions(entityId),
    `${REQUESTS}${s}`,
    `${ERRORS}${s}`,
    `${RATE}${s}`
  ].join(',')
}

/** Consulta 2 (marcadores, con `resolution=Inf`): los tres tiempos del rango. */
export function markerSelector(entityId: string): string {
  return responseTimeExpressions(entityId).join(',')
}

const EMPTY: ServiceSeries = { timestamps: [], values: [] }

/** La serie del resultado en la posición `index` (la única: el filtro deja un servicio). */
function seriesAt(data: MetricData, index: number): ServiceSeries {
  const series = data.result[index]?.data[0]
  return series === undefined ? EMPTY : { timestamps: series.timestamps, values: series.values }
}

const scaled = (series: ServiceSeries, factor: number): ServiceSeries => ({
  timestamps: series.timestamps,
  values: series.values.map((value) => (value === null ? null : value / factor))
})

/** Suma de los puntos con dato (0 si no hay ninguno). */
const sumOf = (series: ServiceSeries): number =>
  series.values.reduce<number>((total, value) => total + (value ?? 0), 0)

/**
 * OK punto a punto: peticiones − errores, nunca negativo. Sin peticiones en un
 * punto, null; un error sin dato en un punto con peticiones cuenta como 0 (en vivo
 * llegan 0, no null). Los errores se casan por timestamp, no por posición.
 */
function okSeries(requests: ServiceSeries, errors: ServiceSeries): ServiceSeries {
  const errorsAt = new Map(errors.timestamps.map((t, i) => [t, errors.values[i] ?? null]))
  return {
    timestamps: requests.timestamps,
    values: requests.values.map((value, i) => {
      if (value === null) return null
      const failed = errorsAt.get(requests.timestamps[i] as number) ?? 0
      return Math.max(0, value - failed)
    })
  }
}

/** Único valor de la serie de un punto (consulta con `resolution=Inf`), en ms. */
function singleMillis(data: MetricData, index: number): number | null {
  const value = seriesAt(data, index).values[0]
  return value === undefined || value === null ? null : value / MICROS_PER_MILLI
}

/** Junta las dos respuestas en series y totales para la interfaz. */
export function toServiceMetrics(series: MetricData, markers: MetricData): ServiceMetricsResult {
  const requests = seriesAt(series, 3)
  const errors = seriesAt(series, 4)
  const totalRequests = sumOf(requests)
  const totalErrors = sumOf(errors)
  return {
    resolution: series.resolution,
    series: {
      responseTime: {
        median: scaled(seriesAt(series, 0), MICROS_PER_MILLI),
        p90: scaled(seriesAt(series, 1), MICROS_PER_MILLI),
        p99: scaled(seriesAt(series, 2), MICROS_PER_MILLI)
      },
      requests,
      errors,
      ok: okSeries(requests, errors),
      // Ya llega en porcentaje (0–100).
      errorRate: seriesAt(series, 5)
    },
    totals: {
      requests: totalRequests,
      errors: totalErrors,
      ok: Math.max(0, totalRequests - totalErrors),
      // En este orden, para no arrastrar decimales (15 / 150 → 10, no 10,000…2).
      errorRate: totalRequests > 0 ? (totalErrors * 100) / totalRequests : null,
      responseTime: {
        median: singleMillis(markers, 0),
        p90: singleMillis(markers, 1),
        p99: singleMillis(markers, 2)
      }
    },
    warnings: [...new Set([...(series.warnings ?? []), ...(markers.warnings ?? [])])],
    partial: [...truncatedResults(series), ...truncatedResults(markers)]
  }
}
