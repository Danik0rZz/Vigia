import type { ErrorReasonKey } from '@shared/error-reasons'
import type { DtClient } from '../../dynatrace/client'
import { DtError } from '../../dynatrace/errors'
import { metricDataSchema, type MetricData } from '../../modules/metrics'

/**
 * Lo común de los canales de métricas de entidad (ficha 0057): la consulta a
 * `GET /metrics/query` (API clásica, Environment API v2) y el `catch` de sus rechazos.
 */

/** Parámetros fijos de todas las consultas de un canal: el rango y, si lo hay, el entitySelector. */
export interface MetricsQueryRange {
  from: string
  to?: string
  entitySelector?: string
}

export type MetricsQuery = (metricSelector: string, resolution?: 'Inf') => Promise<MetricData>

/**
 * Devuelve `query(metricSelector, resolution?)`. Sin resolución, la elige la API; con `Inf`,
 * un valor por serie para todo el rango. Cada expresión del selector la pone el módulo, tal
 * cual se probó en vivo (como mucho 10 por consulta).
 */
export function createMetricsQuery(
  client: DtClient,
  envId: string,
  range: MetricsQueryRange
): MetricsQuery {
  // El mismo orden de parámetros en la URL que tenía cada canal: selector de métricas, de
  // entidades, resolución y rango (un valor undefined no se envía).
  const { entitySelector, ...time } = range
  return (metricSelector, resolution) =>
    client.dtRequest({
      envId,
      api: 'classic',
      path: '/metrics/query',
      query: { metricSelector, entitySelector, resolution, ...time },
      schema: metricDataSchema
    })
}

/**
 * Un rechazo de Dynatrace a la consulta (`BAD_REQUEST` o `NOT_FOUND`) sale con el mismo
 * código, mensaje y estado, y el motivo del canal con el texto de Dynatrace como detalle
 * (status 0 si no llega). El resto de errores, tal cual.
 */
export function rethrowRejected(error: unknown, reasonKey: ErrorReasonKey): never {
  if (error instanceof DtError && (error.code === 'BAD_REQUEST' || error.code === 'NOT_FOUND')) {
    throw new DtError(error.code, error.message, error.status, {
      key: reasonKey,
      params: { status: error.status ?? 0, detail: error.message }
    })
  }
  throw error
}
