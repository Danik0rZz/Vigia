import { z } from 'zod'
import {
  entityIdSchema,
  HOST_EVENTS_LIMIT,
  type HostEvent,
  type HostEventsResult
} from '@shared/modules'

/**
 * Eventos de un HOST y de lo que corre en él (ficha 0042, canal `entities:hostEvents`). Lo
 * observado en vivo (paso 0, en la "Verificación" de la ficha):
 * - `GET /events?eventSelector=entityId("<host>","<id-2>",…)` acepta ids de tipos mezclados y trae
 *   lo mismo que una consulta por tipo con `entitySelector` y la relación (6 o 7 peticiones): se
 *   usa esta forma, con las relaciones de `GET /entities/{host}`. El `optionalEntitySelector` de la
 *   interfaz de Dynatrace no está en la OpenAPI y no se usa;
 * - el límite es de longitud: un `eventSelector` de 9.898 caracteres dio 200 y uno de 10.485, 400.
 *   Si no caben, los ids se reparten en varias consultas por debajo de `HOST_EVENTS_MAX_SELECTOR`;
 * - un evento trae `eventType`, `title`, `status`, `startTime`, `endTime` (-1 en los activos; la
 *   OpenAPI dice null) y `entityId: { entityId: { id, type }, name }`; la respuesta llega del más
 *   reciente al más antiguo.
 */

/** Longitud máxima de cada `eventSelector` (en vivo, 9.898 dio 200 y 10.485, 400). */
export const HOST_EVENTS_MAX_SELECTOR = 9800

/**
 * Relaciones del host cuyos ids entran en la consulta (decisión delegada, refinable; en la
 * ficha): procesos, discos, interfaces de red, grupos de contenedores, nodo de Kubernetes y, de
 * `from`, la máquina virtual en la que corre. No entran el process group (`to:runsOn`: ya están
 * sus instancias), los servicios, el grupo de hosts ni los hosts vecinos.
 */
export const HOST_EVENT_RELATIONS = {
  to: ['isProcessOf', 'isDiskOf', 'isNetworkInterfaceOf', 'isCgiOfHost', 'isNodeOfHost'],
  from: ['runsOn']
} as const

/** Solo las relaciones del host: lo demás de la entidad no hace falta. */
export const HOST_EVENTS_ENTITY_FIELDS = '+fromRelationships,+toRelationships'

/** El host, tolerante: solo se leen sus relaciones. */
export const hostEventsEntitySchema = z.looseObject({
  fromRelationships: z.unknown().optional(),
  toRelationships: z.unknown().optional()
})
export type HostEventsEntity = z.output<typeof hostEventsEntitySchema>

/** `EventList` de la API v2: cada evento se lee por separado y uno raro se descarta. */
export const hostEventsPageSchema = z.looseObject({
  totalCount: z.number().int().nonnegative().optional(),
  events: z.array(z.unknown()).optional()
})
export type HostEventsPage = z.output<typeof hostEventsPageSchema>

type Raw = Record<string, unknown>

const asRecord = (value: unknown): Raw | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Raw) : null

/** Ids de una relación (`nombre → [{ id, type }]`); los que no tienen forma de id se ignoran. */
function relationIds(relationships: unknown, names: readonly string[]): string[] {
  const record = asRecord(relationships)
  if (record === null) return []
  const ids: string[] = []
  for (const name of names) {
    const list = record[name]
    if (!Array.isArray(list)) continue
    for (const item of list) {
      const id = asRecord(item)?.['id']
      // Un id raro podría cerrar la comilla del selector: solo los de formato Dynatrace.
      if (entityIdSchema.safeParse(id).success) ids.push(id as string)
    }
  }
  return ids
}

/** El host y los ids de sus relaciones que entran, sin repetir y con el host primero. */
export function hostEventIds(hostId: string, entity: HostEventsEntity): string[] {
  return [
    ...new Set([
      hostId,
      ...relationIds(entity.toRelationships, HOST_EVENT_RELATIONS.to),
      ...relationIds(entity.fromRelationships, HOST_EVENT_RELATIONS.from)
    ])
  ]
}

const selectorOf = (ids: readonly string[]): string =>
  `entityId(${ids.map((id) => `"${id}"`).join(',')})`

/**
 * Los `eventSelector` de la consulta: `entityId("a","b",…)`, repartidos para que ninguno pase
 * de `max` caracteres. Los ids ya vienen validados (formato Dynatrace), así que caben siempre.
 */
export function hostEventSelectors(
  ids: readonly string[],
  max = HOST_EVENTS_MAX_SELECTOR
): string[] {
  const selectors: string[] = []
  let current: string[] = []
  for (const id of ids) {
    if (current.length > 0 && selectorOf([...current, id]).length > max) {
      selectors.push(selectorOf(current))
      current = []
    }
    current.push(id)
  }
  if (current.length > 0) selectors.push(selectorOf(current))
  return selectors
}

const finite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

/** Un evento de la API en la forma del canal, o null si le falta lo imprescindible. */
export function toHostEvent(raw: unknown): HostEvent | null {
  const record = asRecord(raw)
  if (record === null) return null
  const stub = asRecord(record['entityId'])
  const ref = asRecord(stub?.['entityId'])
  const id = ref?.['id']
  const startTime = finite(record['startTime'])
  if (typeof id !== 'string' || id === '' || startTime === null) return null
  const endTime = finite(record['endTime'])
  const name = stub?.['name']
  const type = ref?.['type']
  return {
    eventType: typeof record['eventType'] === 'string' ? record['eventType'] : '',
    title: typeof record['title'] === 'string' ? record['title'] : '',
    status: typeof record['status'] === 'string' ? record['status'] : '',
    startTime,
    // Activo: -1 en vivo, null según la OpenAPI, o sin el campo.
    endTime: endTime !== null && endTime >= 0 ? endTime : null,
    entity: {
      id,
      name: typeof name === 'string' ? name : null,
      // Sin tipo, el del prefijo del id (`PROCESS_GROUP_INSTANCE-…`).
      type: typeof type === 'string' ? type : id.slice(0, Math.max(0, id.lastIndexOf('-')))
    }
  }
}

/**
 * Junta las páginas de las consultas: los `HOST_EVENTS_LIMIT` más recientes por `startTime`
 * (aunque lleguen desordenados) y la suma de los `totalCount` (sin él, los recibidos).
 */
export function toHostEvents(pages: readonly HostEventsPage[]): HostEventsResult {
  const events = pages
    .flatMap((page) => (page.events ?? []).map(toHostEvent))
    .filter((event): event is HostEvent => event !== null)
    .sort((a, b) => b.startTime - a.startTime)
  const totalCount = pages.reduce(
    (sum, page) => sum + (page.totalCount ?? (page.events ?? []).length),
    0
  )
  return { events: events.slice(0, HOST_EVENTS_LIMIT), totalCount }
}
