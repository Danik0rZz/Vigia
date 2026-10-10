import type { TFunction } from 'i18next'
import type { ServiceMetricsResult } from '@shared/modules'

/**
 * Tipos de servicio con nombre legible (los de la tabla de la ficha 0046). Los textos van en
 * `entities.service.serviceTypes.<tipo>`; un tipo que no esté aquí sale tal cual.
 */
export const SERVICE_TYPE_NAMES: readonly string[] = [
  'WEB_SERVICE',
  'CUSTOM_SERVICE',
  'BACKGROUND_ACTIVITY',
  'SPAN',
  'MESSAGING_SERVICE',
  'EXTERNAL',
  'WEB_REQUEST_SERVICE',
  'RPC_SERVICE',
  'DATABASE_SERVICE',
  'UNIFIED',
  'QUEUE_LISTENER_SERVICE'
]

const KNOWN = new Set(SERVICE_TYPE_NAMES)

/** Nombre legible del `serviceType` (ficha 0047); el código tal cual si no es de la tabla. */
export function serviceTypeName(serviceType: string, t: TFunction): string {
  return KNOWN.has(serviceType) ? t(`entities.service.serviceTypes.${serviceType}`) : serviceType
}

/** Nota bajo los marcadores según el conjunto de métricas (ficha 0047). */
export type ServiceMetricNote = 'activity' | 'client' | 'unified' | 'fallback'

/**
 * La nota sale de los campos estructurados de la 0046, no del texto de `warnings` (que es
 * diagnóstico y en español): Servidor sin `serviceType` (la entidad falló, por ejemplo sin
 * `entities.read`) o con un tipo fuera de la tabla es el «por defecto»; Servidor con un tipo de
 * la tabla, como siempre, sin nota.
 */
export function serviceMetricNote(
  data: Pick<ServiceMetricsResult, 'serviceType' | 'metricSet'>
): ServiceMetricNote | null {
  if (data.metricSet !== 'server') return data.metricSet
  return data.serviceType === null || !KNOWN.has(data.serviceType) ? 'fallback' : null
}
