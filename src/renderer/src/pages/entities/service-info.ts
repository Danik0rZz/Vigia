import type { EntityData } from '@shared/modules'

/**
 * Tarjeta «Información» de la página de un SERVICE (ficha 0015): qué filas salen en la columna
 * «Servicio» y cómo se agrupan las relaciones, a partir de la salida de `entities:get` (0014).
 * Solo elige y ordena; los textos y el formato los pone el componente.
 */

/** Claves de las filas de «Servicio», en el orden de la ficha. */
export const SERVICE_ROW_KEYS = [
  'serviceType',
  'technologies',
  'webServerName',
  'webService',
  'contextRoot',
  'port',
  'isExternalService',
  'remoteEndpoint',
  'databaseVendor',
  'databaseName',
  'applicationName',
  'applicationEnvironment',
  'applicationReleaseVersion',
  'publicCloudId',
  'publicCloudRegion',
  'firstSeen',
  'lastSeen',
  'managementZones',
  'tags'
] as const
export type ServiceRowKey = (typeof SERVICE_ROW_KEYS)[number]

/**
 * Una fila de «Servicio». El texto es el del tenant, tal cual (también el puerto y las
 * versiones: son identificadores, no cantidades, y no llevan separador de miles). `flag` es una
 * fila sin valor propio (`isExternalService` a "true": la fila dice «Externo»).
 */
export type ServiceRow =
  | { key: ServiceRowKey; kind: 'text'; text: string }
  | { key: ServiceRowKey; kind: 'chips'; chips: string[] }
  | { key: ServiceRowKey; kind: 'date'; time: number }
  | { key: ServiceRowKey; kind: 'flag' }

export const RELATION_GROUP_KEYS = ['runsOn', 'calls', 'calledBy', 'other'] as const
export type RelationGroupKey = (typeof RELATION_GROUP_KEYS)[number]

export interface RelatedEntity {
  id: string
  type: string
  /** Nombre de la relación tal como lo da Dynatrace (`runsOnHost`, `calls`…). */
  relation: string
  direction: 'from' | 'to'
}

/** Un grupo de relaciones de la tarjeta (del servicio o, con sus claves, del host: ficha 0020). */
export interface RelationGroup<K extends string = RelationGroupKey> {
  key: K
  /** Cuántas hay según la API (suma de los `total` de sus relaciones); puede ser más que las listadas. */
  total: number
  entities: RelatedEntity[]
}

export interface ServiceInfo {
  rows: ServiceRow[]
  groups: RelationGroup[]
}

/** Relaciones de «Se ejecuta en» (todas de `fromRelationships`), en el orden en que se enseñan. */
const RUNS_ON_RELATIONS = ['runsOnHost', 'runsOnProcessGroupInstance', 'isServiceOfProcessGroup']

/** Propiedades de texto que dan una fila con su mismo nombre. */
const TEXT_PROPERTIES = new Set<ServiceRowKey>([
  'serviceType',
  'webServerName',
  'contextRoot',
  'port',
  'remoteEndpoint',
  'databaseVendor',
  'databaseName',
  'applicationName',
  'applicationEnvironment',
  'applicationReleaseVersion',
  'publicCloudId',
  'publicCloudRegion'
])

/** Separador de las listas en el texto de una propiedad (formato de main, ficha 0014). */
const LIST_SEPARATOR = ', '

export const splitList = (text: string | null): string[] =>
  text === null
    ? []
    : text
        .split(LIST_SEPARATOR)
        .map((part) => part.trim())
        .filter((part) => part !== '')

export function buildServiceInfo(data: EntityData): ServiceInfo {
  return { rows: buildRows(data), groups: buildGroups(data) }
}

function buildRows(data: EntityData): ServiceRow[] {
  const properties = new Map<string, string>()
  for (const property of data.properties) {
    const text = property.text.trim()
    // Una clave repetida se queda con el primer valor con dato.
    if (text !== '' && !properties.has(property.key)) properties.set(property.key, text)
  }
  const prop = (key: string): string | null => properties.get(key) ?? null

  const rows: ServiceRow[] = []
  for (const key of SERVICE_ROW_KEYS) {
    const row = buildRow(key, data, prop)
    if (row !== null) rows.push(row)
  }
  return rows
}

function buildRow(
  key: ServiceRowKey,
  data: EntityData,
  prop: (key: string) => string | null
): ServiceRow | null {
  if (TEXT_PROPERTIES.has(key)) {
    const text = prop(key)
    return text === null ? null : { key, kind: 'text', text }
  }
  switch (key) {
    case 'technologies': {
      const chips = [
        ...splitList(prop('serviceTechnologyTypes')),
        ...splitList(prop('softwareTechnologies'))
      ]
      return chips.length === 0 ? null : { key, kind: 'chips', chips }
    }
    case 'webService': {
      const name = prop('webServiceName')
      const namespace = prop('webServiceNamespace')
      if (name === null && namespace === null) return null
      const text =
        name !== null && namespace !== null ? `${name} (${namespace})` : (name ?? namespace ?? '')
      return { key, kind: 'text', text }
    }
    case 'isExternalService':
      return prop('isExternalService') === 'true' ? { key, kind: 'flag' } : null
    case 'firstSeen':
      return data.firstSeen === null ? null : { key, kind: 'date', time: data.firstSeen }
    case 'lastSeen':
      return data.lastSeen === null ? null : { key, kind: 'date', time: data.lastSeen }
    case 'managementZones':
      return chipsRow(key, data.managementZones)
    case 'tags':
      return chipsRow(key, data.tags)
    default:
      return null
  }
}

function chipsRow(key: ServiceRowKey, values: string[]): ServiceRow | null {
  const chips = values.filter((value) => value.trim() !== '')
  return chips.length === 0 ? null : { key, kind: 'chips', chips }
}

function groupOf(direction: 'from' | 'to', name: string): RelationGroupKey {
  if (direction === 'from' && RUNS_ON_RELATIONS.includes(name)) return 'runsOn'
  if (name === 'calls') return direction === 'from' ? 'calls' : 'calledBy'
  return 'other'
}

function buildGroups(data: EntityData): RelationGroup[] {
  const groups = new Map<RelationGroupKey, RelationGroup>(
    RELATION_GROUP_KEYS.map((key) => [key, { key, total: 0, entities: [] }])
  )
  // «Se ejecuta en» va por su orden (hosts, procesos, process group), no por el de la respuesta.
  const ordered = [...data.relationships].sort((a, b) => runsOnRank(a) - runsOnRank(b))
  for (const relationship of ordered) {
    const group = groups.get(groupOf(relationship.direction, relationship.name))
    if (group === undefined) continue
    group.total += relationship.total
    for (const entity of relationship.entities) {
      group.entities.push({
        id: entity.id,
        type: entity.type,
        relation: relationship.name,
        direction: relationship.direction
      })
    }
  }
  return [...groups.values()].filter((group) => group.total > 0 || group.entities.length > 0)
}

/** Posición en «Se ejecuta en»; las demás relaciones conservan su orden (sort estable). */
function runsOnRank(relationship: { direction: 'from' | 'to'; name: string }): number {
  if (relationship.direction !== 'from') return RUNS_ON_RELATIONS.length
  const index = RUNS_ON_RELATIONS.indexOf(relationship.name)
  return index === -1 ? RUNS_ON_RELATIONS.length : index
}
