import { z } from 'zod'
import type { ServiceMetricSet } from '@shared/modules'

/**
 * Conjunto de métricas de un SERVICE según su `serviceType` (ficha 0046, tabla de Dani con la
 * corrección de EXTERNAL). Lo observado en vivo (paso 0 de la 0046, `docs/notas-api-v2.md`):
 * - `GET /entities/{id}` con `SERVICE_TYPE_FIELDS` trae siempre `properties.serviceType`; una
 *   propiedad que el servicio no tiene no llega (la clave falta, no viene a null);
 * - EXTERNAL solo tiene datos en las métricas de Cliente (la tabla lo ponía en Servidor; lo
 *   cambió el Orquestador, en la ficha).
 */

/** Las propiedades que deciden el conjunto, en `fields` de `GET /entities/{entityId}`. */
export const SERVICE_TYPE_FIELDS = [
  '+properties.serviceType',
  '+properties.webServerName',
  '+properties.remoteEndpoint',
  '+properties.remoteServiceName'
].join(',')

/** Lo que se lee de la entidad: solo sus propiedades (el resto se ignora). */
export const serviceTypeEntitySchema = z.looseObject({
  properties: z.record(z.string(), z.unknown()).optional().catch(undefined)
})

const SERVER_TYPES = new Set([
  'WEB_SERVICE',
  'CUSTOM_SERVICE',
  'BACKGROUND_ACTIVITY',
  'SPAN',
  'MESSAGING_SERVICE'
])
const CLIENT_TYPES = new Set(['DATABASE_SERVICE', 'EXTERNAL'])

/** Todos los tipos de la tabla (un tipo fuera de ella se anota como aviso). */
export const KNOWN_SERVICE_TYPES: ReadonlySet<string> = new Set([
  ...SERVER_TYPES,
  ...CLIENT_TYPES,
  'WEB_REQUEST_SERVICE',
  'RPC_SERVICE',
  'UNIFIED',
  'QUEUE_LISTENER_SERVICE'
])

/** Una propiedad cuenta si es una cadena no vacía o una lista no vacía. */
function present(value: unknown): boolean {
  if (typeof value === 'string') return value !== ''
  if (Array.isArray(value)) return value.length > 0
  return false
}

/**
 * Conjunto de métricas del servicio. Los valores distinguen mayúsculas; un tipo desconocido,
 * vacío o null da Servidor (las métricas de antes de la 0046).
 */
export function serviceMetricSet(
  serviceType: string | null,
  properties: Record<string, unknown>
): ServiceMetricSet {
  if (serviceType === null) return 'server'
  if (SERVER_TYPES.has(serviceType)) return 'server'
  if (CLIENT_TYPES.has(serviceType)) return 'client'
  switch (serviceType) {
    case 'WEB_REQUEST_SERVICE':
      return present(properties['webServerName']) ? 'server' : 'client'
    case 'RPC_SERVICE':
      return present(properties['remoteEndpoint']) || present(properties['remoteServiceName'])
        ? 'client'
        : 'server'
    case 'UNIFIED':
      return 'unified'
    case 'QUEUE_LISTENER_SERVICE':
      return 'activity'
    default:
      return 'server'
  }
}
