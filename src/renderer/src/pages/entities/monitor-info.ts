import type { EntityData, EntityRelationship } from '@shared/modules'
import type { RelatedEntity, RelationGroup } from './service-info'

/**
 * Tarjeta «Información» de las páginas de un browser monitor (SYNTHETIC_TEST) y de un HTTP
 * monitor (HTTP_CHECK), ficha 0026: qué filas salen y cómo se agrupan las relaciones, a partir de
 * la salida de `entities:get` (0014). Claves y relaciones, las que la 0022 vio en vivo. Como
 * `service-info.ts` y `host-info.ts`, solo elige y ordena; los textos y el formato los pone el
 * componente. Filas planas, como en el servicio: son pocas.
 */

/**
 * Filas, en su orden. Las de la ficha más dos elegidas con el informe de la 0022:
 * `deviceProfile` (solo browser: el dispositivo que simula) y `lastExecution`
 * (`lastExecutionTimestamp`: cuándo se ejecutó por última vez).
 */
const ROW_KEYS = [
  'monitorType',
  'enabled',
  'frequency',
  'deviceProfile',
  'locations',
  'steps',
  'requests',
  'lastExecution',
  'firstSeen',
  'lastSeen',
  'managementZones',
  'tags'
] as const
export type MonitorRowKey = (typeof ROW_KEYS)[number]

/**
 * Una fila del monitor. `boolean` es «si está activo» (la vista lo dice con palabras); `number`,
 * la frecuencia en minutos (la unidad la pone la vista); `count`, el `total` de una relación.
 * La clave, como `string` para poder buscarla por cualquier texto (`Map` del test de CA1).
 */
export type MonitorRow =
  | { key: string; kind: 'text'; text: string }
  | { key: string; kind: 'boolean'; value: boolean }
  | { key: string; kind: 'number'; value: number }
  | { key: string; kind: 'count'; count: number }
  | { key: string; kind: 'date'; time: number }
  | { key: string; kind: 'chips'; chips: string[] }

export const MONITOR_RELATION_GROUP_KEYS = [
  'monitors',
  'locations',
  'steps',
  'requests',
  'other'
] as const
export type MonitorRelationGroupKey = (typeof MONITOR_RELATION_GROUP_KEYS)[number]

export interface MonitorInfo {
  rows: MonitorRow[]
  groups: RelationGroup<MonitorRelationGroupKey>[]
}

type Kind = 'browser' | 'http'

const kindOf = (data: EntityData): Kind => (data.type === 'HTTP_CHECK' ? 'http' : 'browser')

export function buildMonitorInfo(data: EntityData): MonitorInfo {
  const kind = kindOf(data)
  return { rows: buildRows(data, kind), groups: buildGroups(data, kind) }
}

/** Grupo de una relación, en la dirección vista en vivo en la 0022; el resto, «Otras». */
function groupOf(direction: 'from' | 'to', name: string, kind: Kind): MonitorRelationGroupKey {
  if (direction === 'from' && (name === 'monitors' || name === 'calls')) return 'monitors'
  if (direction === 'to' && name === 'isApplicationOfSyntheticTest') return 'monitors'
  if (direction === 'from' && name === 'runsOn') return 'locations'
  if (direction === 'to' && name === 'isStepOf') return kind === 'http' ? 'requests' : 'steps'
  return 'other'
}

function buildRows(data: EntityData, kind: Kind): MonitorRow[] {
  const properties = new Map<string, string>()
  for (const property of data.properties) {
    const text = property.text.trim()
    // Una clave repetida se queda con el primer valor con dato.
    if (text !== '' && !properties.has(property.key)) properties.set(property.key, text)
  }
  const prop = (key: string): string | null => properties.get(key) ?? null

  const rows: MonitorRow[] = []
  for (const key of ROW_KEYS) {
    const row = buildRow(key, data, kind, prop)
    if (row !== null) rows.push(row)
  }
  return rows
}

function buildRow(
  key: MonitorRowKey,
  data: EntityData,
  kind: Kind,
  prop: (key: string) => string | null
): MonitorRow | null {
  switch (key) {
    case 'monitorType':
      return textRow(key, prop(kind === 'http' ? 'httpMonitorSubtype' : 'browserMonitorSubtype'))
    case 'enabled': {
      const text = prop('isEnabled')
      return text === 'true' || text === 'false'
        ? { key, kind: 'boolean', value: text === 'true' }
        : null
    }
    case 'frequency': {
      const value = positiveNumber(prop('syntheticMonitorFrequency'))
      return value === null ? null : { key, kind: 'number', value }
    }
    case 'deviceProfile':
      return kind === 'browser' ? textRow(key, prop('deviceProfile')) : null
    // Recuentos del `total` de la relación, no de `assignedLocations` ni `steps`: main recorta el
    // texto de una propiedad a 300 caracteres y una lista larga daría una cuenta menor.
    case 'locations':
      return countRow(key, data, (r) => r.direction === 'from' && r.name === 'runsOn')
    case 'steps':
    case 'requests':
      if ((key === 'requests') !== (kind === 'http')) return null
      return countRow(key, data, (r) => r.direction === 'to' && r.name === 'isStepOf')
    case 'lastExecution': {
      const time = positiveNumber(prop('lastExecutionTimestamp'))
      return time === null ? null : { key, kind: 'date', time }
    }
    case 'firstSeen':
      return data.firstSeen === null ? null : { key, kind: 'date', time: data.firstSeen }
    case 'lastSeen':
      return data.lastSeen === null ? null : { key, kind: 'date', time: data.lastSeen }
    case 'managementZones':
      return chipsRow(key, data.managementZones)
    case 'tags':
      return chipsRow(key, data.tags)
  }
}

function textRow(key: MonitorRowKey, text: string | null): MonitorRow | null {
  return text === null ? null : { key, kind: 'text', text }
}

function positiveNumber(text: string | null): number | null {
  if (text === null) return null
  const value = Number(text)
  return Number.isFinite(value) && value > 0 ? value : null
}

function countRow(
  key: MonitorRowKey,
  data: EntityData,
  matches: (relationship: EntityRelationship) => boolean
): MonitorRow | null {
  const count = data.relationships
    .filter(matches)
    .reduce((sum, relationship) => sum + relationship.total, 0)
  return count > 0 ? { key, kind: 'count', count } : null
}

function chipsRow(key: MonitorRowKey, values: string[]): MonitorRow | null {
  const chips = values.filter((value) => value.trim() !== '')
  return chips.length === 0 ? null : { key, kind: 'chips', chips }
}

function buildGroups(data: EntityData, kind: Kind): RelationGroup<MonitorRelationGroupKey>[] {
  const groups = new Map<MonitorRelationGroupKey, RelationGroup<MonitorRelationGroupKey>>(
    MONITOR_RELATION_GROUP_KEYS.map((key) => [key, { key, total: 0, entities: [] }])
  )
  for (const relationship of data.relationships) {
    const group = groups.get(groupOf(relationship.direction, relationship.name, kind))
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
