import type { EntityData } from '@shared/modules'
import { splitList, type RelatedEntity, type RelationGroup } from './service-info'

/**
 * Tarjeta «Información» de la página de un HOST (ficha 0020): qué filas salen, en qué grupo de
 * filas, y cómo se agrupan las relaciones, a partir de la salida de `entities:get` (0014). Como
 * `service-info.ts`, solo elige y ordena; los textos y el formato los pone el componente.
 */

export const HOST_SECTION_KEYS = [
  'system',
  'capacity',
  'network',
  'monitoring',
  'grouping',
  'cloud'
] as const
export type HostSectionKey = (typeof HOST_SECTION_KEYS)[number]

/** Filas de cada grupo, en el orden de la ficha. */
const SECTION_ROWS = {
  system: ['osType', 'osVersion', 'osArchitecture', 'bitness'],
  capacity: ['cpuCores', 'logicalCpuCores', 'memory'],
  network: ['ipAddress', 'networkZone'],
  monitoring: ['monitoringMode', 'state', 'installerVersion', 'firstSeen', 'lastSeen'],
  grouping: ['hostGroupName', 'managementZones', 'tags'],
  cloud: ['cloudType', 'hypervisorType']
} as const satisfies Record<HostSectionKey, readonly string[]>

export type HostRowKey = (typeof SECTION_ROWS)[HostSectionKey][number]

/**
 * Una fila del host. El texto es el del tenant, tal cual (versiones, núcleos y bits incluidos:
 * no llevan separador de miles). La memoria va en bytes; la vista la pasa a GB. La clave es una
 * de `HostRowKey`, como `string` para poder buscarla por cualquier texto (`Map` del test de CA1).
 */
export type HostRow =
  | { key: string; kind: 'text'; text: string }
  | { key: string; kind: 'chips'; chips: string[] }
  | { key: string; kind: 'date'; time: number }
  | { key: string; kind: 'bytes'; bytes: number }

export interface HostSection {
  key: HostSectionKey
  rows: HostRow[]
}

export const HOST_RELATION_GROUP_KEYS = [
  'processes',
  'services',
  'runsOn',
  'hostGroup',
  'other'
] as const
export type HostRelationGroupKey = (typeof HOST_RELATION_GROUP_KEYS)[number]

export interface HostInfo {
  sections: HostSection[]
  groups: RelationGroup<HostRelationGroupKey>[]
}

/** Propiedades de texto que dan una fila con su mismo nombre. */
const TEXT_PROPERTIES = new Set<HostRowKey>([
  'osType',
  'osVersion',
  'osArchitecture',
  'bitness',
  'cpuCores',
  'logicalCpuCores',
  'networkZone',
  'monitoringMode',
  'state',
  'installerVersion',
  'hostGroupName',
  'cloudType',
  'hypervisorType'
])

export function buildHostInfo(data: EntityData): HostInfo {
  return { sections: buildSections(data), groups: buildGroups(data) }
}

function buildSections(data: EntityData): HostSection[] {
  const properties = new Map<string, string>()
  for (const property of data.properties) {
    const text = property.text.trim()
    // Una clave repetida se queda con el primer valor con dato.
    if (text !== '' && !properties.has(property.key)) properties.set(property.key, text)
  }
  const prop = (key: string): string | null => properties.get(key) ?? null

  const sections: HostSection[] = []
  for (const key of HOST_SECTION_KEYS) {
    const rows: HostRow[] = []
    for (const rowKey of SECTION_ROWS[key]) {
      const row = buildRow(rowKey, data, prop)
      if (row !== null) rows.push(row)
    }
    if (rows.length > 0) sections.push({ key, rows })
  }
  return sections
}

function buildRow(
  key: HostRowKey,
  data: EntityData,
  prop: (key: string) => string | null
): HostRow | null {
  if (TEXT_PROPERTIES.has(key)) {
    const text = prop(key)
    return text === null ? null : { key, kind: 'text', text }
  }
  switch (key) {
    case 'memory': {
      // physicalMemory y, si no da un número positivo, memoryTotal (en vivo, iguales y en bytes).
      const bytes = positiveNumber(prop('physicalMemory')) ?? positiveNumber(prop('memoryTotal'))
      return bytes === null ? null : { key, kind: 'bytes', bytes }
    }
    case 'ipAddress':
      return chipsRow(key, splitList(prop('ipAddress')))
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

function positiveNumber(text: string | null): number | null {
  if (text === null) return null
  const value = Number(text)
  return Number.isFinite(value) && value > 0 ? value : null
}

function chipsRow(key: HostRowKey, values: string[]): HostRow | null {
  const chips = values.filter((value) => value.trim() !== '')
  return chips.length === 0 ? null : { key, kind: 'chips', chips }
}

/** Grupo de una relación, en la dirección vista en vivo en la 0020; el resto, «Otras». */
function groupOf(direction: 'from' | 'to', name: string): HostRelationGroupKey {
  if (direction === 'to' && name === 'isProcessOf') return 'processes'
  if (direction === 'to' && name === 'runsOnHost') return 'services'
  if (direction === 'from' && name === 'runsOn') return 'runsOn'
  if (direction === 'from' && name === 'isInstanceOf') return 'hostGroup'
  return 'other'
}

function buildGroups(data: EntityData): RelationGroup<HostRelationGroupKey>[] {
  const groups = new Map<HostRelationGroupKey, RelationGroup<HostRelationGroupKey>>(
    HOST_RELATION_GROUP_KEYS.map((key) => [key, { key, total: 0, entities: [] }])
  )
  for (const relationship of data.relationships) {
    const group = groups.get(groupOf(relationship.direction, relationship.name))
    if (group === undefined) continue
    group.total += relationship.total
    for (const entity of relationship.entities) {
      const related: RelatedEntity = {
        id: entity.id,
        type: entity.type,
        relation: relationship.name,
        direction: relationship.direction
      }
      group.entities.push(related)
    }
  }
  return [...groups.values()].filter((group) => group.total > 0 || group.entities.length > 0)
}
