import { z } from 'zod'
import {
  dtLogEnumSchema,
  entityIdSchema,
  type HostLogProcess,
  type HostLogsResult
} from '@shared/modules'

/**
 * Procesos de un HOST con logs detectados (ficha 0041, canal `entities:hostLogs`). Lo observado
 * en vivo (paso 0, en la "Verificación" de la ficha):
 * - `GET /entities` con `type("PROCESS_GROUP_INSTANCE"),fromRelationships.isProcessOf(...)` y
 *   `fields=+properties.X` trae las tres propiedades, de tipo `Map`, como lista de
 *   `{ key, value }`;
 * - la `key` es la fuente del log: una ruta de fichero o un nombre de fuente. **Nunca sale de
 *   aquí**: solo se cuentan las fuentes distintas;
 * - `logFileStatus`: `value` es un enum; `logSourceState`: `value` es `{ storageStatus }` con un
 *   enum; `logPathLastUpdate`: `value` es una fecha en segundos desde epoch;
 * - un proceso sin logs llega sin esas claves en `properties`.
 */

/** Las tres propiedades de la consulta (formato `properties.FIELD` de la OpenAPI). */
export const HOST_LOGS_FIELDS = [
  '+properties.logFileStatus',
  '+properties.logPathLastUpdate',
  '+properties.logSourceState'
].join(',')

/** Procesos por página (la ficha pide 500; en vivo, como mucho 150 por host). */
export const HOST_LOGS_PAGE_SIZE = 500
/** Tope de páginas: 5000 procesos en un host es más de lo razonable. */
export const HOST_LOGS_MAX_PAGES = 10

/**
 * Selector de los procesos del host. El id ya viene validado por `hostEntityIdSchema` (tipo y 16
 * hexadecimales): no puede cerrar la comilla ni el paréntesis.
 */
export function hostLogsSelector(hostId: string): string {
  return `type("PROCESS_GROUP_INSTANCE"),fromRelationships.isProcessOf(entityId("${hostId}"))`
}

/**
 * Un proceso de la lista, tolerante: solo se exige el id; lo demás se lee por separado y lo raro
 * se ignora.
 */
export const hostLogsEntitySchema = z.looseObject({
  entityId: entityIdSchema,
  displayName: z.string().optional(),
  properties: z.unknown().optional()
})
export type HostLogsEntity = z.output<typeof hostLogsEntitySchema>

type Raw = Record<string, unknown>

const asRecord = (value: unknown): Raw | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Raw) : null

/** Entradas `{ key, value }` de una propiedad `Map` (las que no tienen esa forma se ignoran). */
function entriesOf(value: unknown): { key: string; value: unknown }[] {
  if (!Array.isArray(value)) return []
  const entries: { key: string; value: unknown }[] = []
  for (const item of value) {
    const record = asRecord(item)
    if (record !== null && typeof record['key'] === 'string') {
      entries.push({ key: record['key'], value: record['value'] })
    }
  }
  return entries
}

/** El valor, si es un enum de Dynatrace; si no (una ruta, un texto libre), null. */
function asEnum(value: unknown): string | null {
  return dtLogEnumSchema.safeParse(value).success ? (value as string) : null
}

/**
 * Estado que se enseña cuando hay varias fuentes (decisión del developer, refinable): si alguna
 * está en `preferred`, ese; si no, el primero válido. Para el fichero, que se lea alguno
 * (`FILE_STATUS_OK`) es lo que más dice del proceso.
 */
function pickStatus(values: (string | null)[], preferred: string): string | null {
  const valid = values.filter((value): value is string => value !== null)
  if (valid.includes(preferred)) return preferred
  return valid[0] ?? null
}

/** La fecha más reciente (en segundos) pasada a milisegundos; null si no hay ninguna válida. */
function latestMs(values: unknown[]): number | null {
  let latest: number | null = null
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      latest = latest === null ? value : Math.max(latest, value)
    }
  }
  return latest === null ? null : latest * 1000
}

/** Un proceso con sus logs, o null si no tiene ninguno. */
export function toHostLogProcess(entity: HostLogsEntity): HostLogProcess | null {
  const properties = asRecord(entity.properties) ?? {}
  const fileStatus = entriesOf(properties['logFileStatus'])
  const lastUpdate = entriesOf(properties['logPathLastUpdate'])
  const sourceState = entriesOf(properties['logSourceState'])
  const all = [...fileStatus, ...lastUpdate, ...sourceState]
  if (all.length === 0) return null
  return {
    id: entity.entityId,
    name: entity.displayName ?? entity.entityId,
    fileStatus: pickStatus(
      fileStatus.map((entry) => asEnum(entry.value)),
      'FILE_STATUS_OK'
    ),
    sourceState: pickStatus(
      sourceState.map((entry) => asEnum(asRecord(entry.value)?.['storageStatus'])),
      'LOG_STORAGE_CONFIGURATION_STATUS_SEND_TO_STORAGE'
    ),
    lastUpdate: latestMs(lastUpdate.map((entry) => entry.value)),
    // Las fuentes se cuentan aquí y se tiran: nunca salen de main.
    logCount: new Set(all.map((entry) => entry.key)).size
  }
}

/**
 * Junta los procesos del host en la salida del canal. `total` es el de la API si lo da (los
 * procesos descartados por forma rara también cuentan); si no, los recibidos.
 */
export function toHostLogs(
  entities: HostLogsEntity[],
  totalCount: number | null,
  invalid: number
): HostLogsResult {
  const processes = entities
    .map(toHostLogProcess)
    .filter((process): process is HostLogProcess => process !== null)
  return {
    processes,
    withLogs: processes.length,
    total: totalCount ?? entities.length + invalid
  }
}
