import { z } from 'zod'
import {
  entityIdSchema,
  entityTypeOf,
  MAX_ENTITY_IDS,
  MAX_ENTITY_PROPERTY_LENGTH,
  type EntityData,
  type EntityNames,
  type EntityRelationship
} from '@shared/modules'
import { tagText } from './problems'

/**
 * Datos de una entidad y nombres de sus relaciones (ficha 0014, canales
 * `entities:get` y `entities:names`). Lo observado en vivo (paso 0):
 * - `GET /entities/{id}` con `ENTITY_FIELDS` trae fechas en epoch ms, `icon` con
 *   `primaryIconType`, etiquetas con `stringRepresentation`, `properties` con
 *   texto, listas de texto, booleanos y `softwareTechnologies` como lista de
 *   objetos `{ type, edition?, version? }`, y relaciones `nombre → [{ id, type }]`
 *   (una relación puede mezclar tipos).
 * - Un id con buen formato que no existe da 404.
 * - `GET /entities?entitySelector=entityId(...)` resuelve los ids de las
 *   relaciones con el `from` por defecto (`now-3d`); con tipos mezclados, 400.
 */

/** Partes de `Entity` que no vienen por defecto en `GET /entities/{entityId}`. */
export const ENTITY_FIELDS = [
  '+properties',
  '+tags',
  '+managementZones',
  '+fromRelationships',
  '+toRelationships',
  '+firstSeenTms',
  '+lastSeenTms',
  '+icon'
].join(',')

/** Profundidad máxima al pasar a texto un valor anidado (el resto se omite). */
const MAX_VALUE_DEPTH = 4

/**
 * `Entity` de la API v2, tolerante: solo se exige que sea un objeto; cada parte se
 * lee por separado y una rara se ignora en vez de tumbar la entidad.
 */
export const entityResponseSchema = z.looseObject({
  entityId: z.string().optional(),
  displayName: z.string().optional(),
  type: z.string().optional(),
  firstSeenTms: z.number().optional(),
  lastSeenTms: z.number().optional(),
  icon: z.unknown().optional(),
  managementZones: z.unknown().optional(),
  tags: z.unknown().optional(),
  properties: z.unknown().optional(),
  fromRelationships: z.unknown().optional(),
  toRelationships: z.unknown().optional()
})
export type EntityResponse = z.output<typeof entityResponseSchema>

/** `EntitiesList` de la API v2: solo la lista, cada entidad se lee por separado. */
export const entityListResponseSchema = z.looseObject({
  entities: z.array(z.unknown()).optional()
})
export type EntityListResponse = z.output<typeof entityListResponseSchema>

type Raw = Record<string, unknown>

const asObject = (value: unknown): Raw | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Raw) : null

const asString = (value: unknown): string | null => (typeof value === 'string' ? value : null)

/**
 * Un valor de `properties` como texto legible: número con `String`, booleano
 * `true`/`false`, listas separadas por comas y objetos con sus valores separados
 * por espacios (`JAVA OpenJDK 17.0.2`), nunca `[object Object]`.
 */
export function propertyText(value: unknown, depth = 0): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value)
  }
  if (depth >= MAX_VALUE_DEPTH) return ''
  if (Array.isArray(value)) {
    return value
      .map((item) => propertyText(item, depth + 1))
      .filter((text) => text !== '')
      .join(', ')
  }
  if (typeof value === 'object') {
    return Object.values(value as Raw)
      .map((item) => propertyText(item, depth + 1))
      .filter((text) => text !== '')
      .join(' ')
  }
  return ''
}

/** Relaciones de una dirección: como mucho 50 ids (los primeros) y el total. */
function toRelationships(raw: unknown, direction: 'from' | 'to'): EntityRelationship[] {
  const relationships = asObject(raw)
  if (relationships === null) return []
  return Object.entries(relationships).flatMap(([name, list]) => {
    if (!Array.isArray(list)) return []
    const entities = list.flatMap((entry) => {
      const item = asObject(entry)
      const id = asString(item?.['id'])
      const type = asString(item?.['type'])
      return id === null || type === null ? [] : [{ id, type }]
    })
    if (entities.length === 0) return []
    return [
      { direction, name, entities: entities.slice(0, MAX_ENTITY_IDS), total: entities.length }
    ]
  })
}

/** De `Entity` a lo que ve la interfaz (salida de `entities:get`). */
export function toEntityData(entity: EntityResponse, requestedId: string): EntityData {
  const zones = Array.isArray(entity.managementZones)
    ? entity.managementZones.flatMap((entry) => {
        const name = asString(asObject(entry)?.['name'])
        return name === null || name === '' ? [] : [name]
      })
    : []
  const tags = Array.isArray(entity.tags)
    ? entity.tags.flatMap((entry) => {
        const text = tagText(entry)
        return text === null ? [] : [text]
      })
    : []
  const properties = Object.entries(asObject(entity.properties) ?? {}).map(([key, value]) => ({
    key,
    text: propertyText(value).slice(0, MAX_ENTITY_PROPERTY_LENGTH)
  }))
  return {
    displayName: entity.displayName ?? entity.entityId ?? requestedId,
    type: entity.type ?? entityTypeOf(entity.entityId ?? requestedId),
    firstSeen: entity.firstSeenTms ?? null,
    lastSeen: entity.lastSeenTms ?? null,
    iconType: asString(asObject(entity.icon)?.['primaryIconType']),
    managementZones: zones,
    tags,
    properties,
    relationships: [
      ...toRelationships(entity.fromRelationships, 'from'),
      ...toRelationships(entity.toRelationships, 'to')
    ]
  }
}

/**
 * Selector `entityId("a","b")`. Los ids ya llegan validados por el canal; se
 * vuelven a comprobar aquí porque van dentro de comillas del selector.
 */
export function entityIdSelector(entityIds: readonly string[]): string {
  for (const id of entityIds) {
    if (!entityIdSchema.safeParse(id).success) {
      throw new Error('Id de entidad no válido para el selector.')
    }
  }
  return `entityId(${entityIds.map((id) => `"${id}"`).join(',')})`
}

/** Nombres de los ids pedidos; los que la API no devuelve van a `missing`. */
export function toEntityNames(
  response: EntityListResponse,
  requested: readonly string[]
): EntityNames {
  const wanted = new Set(requested)
  const found = new Map<string, string>()
  for (const entry of response.entities ?? []) {
    const entity = asObject(entry)
    const id = asString(entity?.['entityId'])
    const name = asString(entity?.['displayName'])
    if (id !== null && name !== null && wanted.has(id) && !found.has(id)) found.set(id, name)
  }
  return {
    names: [...found].map(([id, name]) => ({ id, name })),
    missing: requested.filter((id) => !found.has(id))
  }
}
