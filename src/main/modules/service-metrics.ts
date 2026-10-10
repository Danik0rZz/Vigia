import type { ServiceMetricSet, ServiceMetricsResult, ServiceSeries } from '@shared/modules'
import { mergeMeta, seriesAt, singleValue } from './metric-series'
import type { MetricData } from './metrics'

/**
 * Métricas de una entidad SERVICE (fichas 0006 y 0046, canal `entities:serviceMetrics`).
 * Lo observado en vivo (pasos 0 de las fichas 0006 y 0046, `docs/notas-api-v2.md`):
 * - las expresiones de series caben en una consulta (como mucho 10) y vuelven en el orden
 *   pedido; el `metricId` devuelto no es la expresión enviada (Dynatrace quita las comillas
 *   del id del filtro), así que se casan por posición;
 * - `:fold(...)` con `resolution=Inf` en la misma consulta da 400: los totales de
 *   peticiones y errores salen de sumar la serie (igual que `fold(sum)`) y los
 *   tiempos del rango van en una segunda consulta con `resolution=Inf` (mediana y
 *   percentiles reales del rango, no una media de medianas);
 * - Servidor y Cliente: tiempos en microsegundos, tasa de error en porcentaje, y el
 *   recuento de peticiones incluye las de error (OK = total − errores);
 * - Unificadas: tiempos ya en milisegundos; `response_time_…` y `count_…` tienen la
 *   dimensión `failed` y sin `splitBy("dt.entity.service")` llegan en dos series;
 *   `failure_count_…` es el `count_…` con failed=true y no hay métrica de tasa (se calcula);
 * - Solo actividad: `response.server:count` es el recuento de peticiones; tiempos,
 *   `requestCount.server` y errores no tienen datos.
 */

/** Claves de métrica por papel (null si el conjunto no lo tiene o se calcula en main). */
export interface ServiceMetricKeys {
  responseTime: string | null
  requests: string | null
  errors: string | null
  errorRate: string | null
}

const SERVER: ServiceMetricKeys = {
  responseTime: 'builtin:service.response.server',
  requests: 'builtin:service.requestCount.server',
  errors: 'builtin:service.errors.server.count',
  errorRate: 'builtin:service.errors.server.rate'
}

export const SERVICE_METRIC_KEYS: Record<ServiceMetricSet, ServiceMetricKeys> = {
  server: SERVER,
  client: {
    responseTime: 'builtin:service.response.client',
    requests: 'builtin:service.requestCount.client',
    errors: 'builtin:service.errors.client.count',
    errorRate: 'builtin:service.errors.client.rate'
  },
  unified: {
    responseTime: 'builtin:service.request.response_time_service_aggregation',
    requests: 'builtin:service.request.count_service_aggregation',
    errors: 'builtin:service.request.failure_count_service_aggregation',
    errorRate: null
  },
  // El recuento sale de `response.server:count`: la única clave del conjunto.
  activity: { responseTime: null, requests: SERVER.responseTime, errors: null, errorRate: null }
}

/** Divisor de los tiempos a milisegundos: µs en Servidor y Cliente, ya en ms en Unificadas. */
const TIME_DIVISOR: Record<ServiceMetricSet, number> = {
  server: 1000,
  client: 1000,
  unified: 1,
  activity: 1
}

/**
 * Filtro y reparto por el servicio, como en la petición original. El id ya viene
 * validado por `serviceEntityIdSchema` (SERVICE- y 16 hexadecimales): no puede
 * cerrar la comilla ni el paréntesis. El `splitBy` junta las dos series de `failed`
 * de las unificadas.
 */
function scope(entityId: string): string {
  return `:filter(eq("dt.entity.service","${entityId}")):splitBy("dt.entity.service")`
}

/** Las tres expresiones de tiempos (mediana, p90 y p99), en ese orden. */
function responseTimeExpressions(key: string, entityId: string): string[] {
  const s = scope(entityId)
  return [`${key}${s}:median`, `${key}${s}:percentile(90.0)`, `${key}${s}:percentile(99.0)`]
}

/**
 * Consulta 1 (series). Servidor y Cliente: tiempos, peticiones, errores y tasa;
 * Unificadas: tiempos, peticiones y errores; Solo actividad: el recuento.
 */
export function seriesSelector(set: ServiceMetricSet, entityId: string): string {
  const keys = SERVICE_METRIC_KEYS[set]
  const s = scope(entityId)
  if (set === 'activity') return `${keys.requests}${s}:count`
  return [
    ...responseTimeExpressions(keys.responseTime as string, entityId),
    `${keys.requests}${s}`,
    `${keys.errors}${s}`,
    ...(keys.errorRate === null ? [] : [`${keys.errorRate}${s}`])
  ].join(',')
}

/**
 * Consulta 2 (marcadores, con `resolution=Inf`): los tres tiempos del rango. Null en Solo
 * actividad, que no mide tiempos (no se pide).
 */
export function markerSelector(set: ServiceMetricSet, entityId: string): string | null {
  const key = SERVICE_METRIC_KEYS[set].responseTime
  return key === null ? null : responseTimeExpressions(key, entityId).join(',')
}

const scaled = (series: ServiceSeries, factor: number): ServiceSeries => ({
  timestamps: series.timestamps,
  values: series.values.map((value) => (value === null ? null : value / factor))
})

/** Suma de los puntos con dato (0 si no hay ninguno). */
const sumOf = (series: ServiceSeries): number =>
  series.values.reduce<number>((total, value) => total + (value ?? 0), 0)

/**
 * Combina peticiones y errores punto a punto, casando los errores por timestamp (no por
 * posición). Sin peticiones en un punto, null; un error sin dato en un punto con
 * peticiones cuenta como 0 (en vivo llegan 0, no null).
 */
function perPoint(
  requests: ServiceSeries,
  errors: ServiceSeries,
  combine: (requests: number, failed: number) => number | null
): ServiceSeries {
  const errorsAt = new Map(errors.timestamps.map((t, i) => [t, errors.values[i] ?? null]))
  return {
    timestamps: requests.timestamps,
    values: requests.values.map((value, i) => {
      if (value === null) return null
      return combine(value, errorsAt.get(requests.timestamps[i] as number) ?? 0)
    })
  }
}

/** OK punto a punto: peticiones − errores, nunca negativo. */
const okSeries = (requests: ServiceSeries, errors: ServiceSeries): ServiceSeries =>
  perPoint(requests, errors, (total, failed) => Math.max(0, total - failed))

/** Tasa punto a punto (Unificadas): fallidas / total × 100; null sin peticiones. */
const rateSeries = (requests: ServiceSeries, errors: ServiceSeries): ServiceSeries =>
  perPoint(requests, errors, (total, failed) => (total > 0 ? (failed * 100) / total : null))

/** Un tiempo a milisegundos, con el divisor del conjunto (`TIME_DIVISOR`). */
const inMs = (value: number | null, divisor: number): number | null =>
  value === null ? null : value / divisor

/** Lo que main sabe de la entidad al elegir el conjunto. */
export interface ServiceMetricContext {
  set: ServiceMetricSet
  serviceType: string | null
  /** Avisos propios (entidad que falla, tipo fuera de la tabla…). */
  warnings: string[]
}

/** Junta las respuestas en series y totales para la interfaz. */
export function toServiceMetrics(
  context: ServiceMetricContext,
  series: MetricData,
  markers: MetricData | null
): ServiceMetricsResult {
  const { set } = context
  const meta = mergeMeta(markers === null ? [series] : [series, markers])
  const common = {
    resolution: series.resolution,
    serviceType: context.serviceType,
    metricSet: set,
    metricKeys: { ...SERVICE_METRIC_KEYS[set] },
    warnings: [...new Set([...context.warnings, ...meta.warnings])],
    partial: meta.partial
  }

  if (set === 'activity' || markers === null) {
    const requests = seriesAt(series, 0)
    return {
      ...common,
      series: { responseTime: null, requests, errors: null, ok: null, errorRate: null },
      totals: {
        requests: sumOf(requests),
        errors: null,
        ok: null,
        errorRate: null,
        responseTime: null
      }
    }
  }

  const divisor = TIME_DIVISOR[set]
  const requests = seriesAt(series, 3)
  const errors = seriesAt(series, 4)
  const totalRequests = sumOf(requests)
  const totalErrors = sumOf(errors)
  return {
    ...common,
    series: {
      responseTime: {
        median: scaled(seriesAt(series, 0), divisor),
        p90: scaled(seriesAt(series, 1), divisor),
        p99: scaled(seriesAt(series, 2), divisor)
      },
      requests,
      errors,
      ok: okSeries(requests, errors),
      // Servidor y Cliente: ya llega en porcentaje (0–100). Unificadas: se calcula.
      errorRate: set === 'unified' ? rateSeries(requests, errors) : seriesAt(series, 5)
    },
    totals: {
      requests: totalRequests,
      errors: totalErrors,
      ok: Math.max(0, totalRequests - totalErrors),
      // En este orden, para no arrastrar decimales (15 / 150 → 10, no 10,000…2).
      errorRate: totalRequests > 0 ? (totalErrors * 100) / totalRequests : null,
      responseTime: {
        median: inMs(singleValue(markers, 0), divisor),
        p90: inMs(singleValue(markers, 1), divisor),
        p99: inMs(singleValue(markers, 2), divisor)
      }
    }
  }
}
