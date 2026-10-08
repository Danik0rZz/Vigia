import type { EntityData } from '@shared/modules'
import { splitList, type RelatedEntity, type RelationGroup } from './service-info'

/**
 * Tarjeta «Información» de la página de un proceso (PROCESS_GROUP_INSTANCE), ficha 0029: qué filas
 * salen y cómo se agrupan las relaciones, a partir de la salida de `entities:get` (0014). Claves y
 * relaciones, las que la 0027 vio en vivo. Como `service-info.ts`, `host-info.ts` y
 * `monitor-info.ts`, solo elige y ordena; los textos y el formato los pone el componente. Filas
 * planas: son pocas. La línea de comandos y las rutas completas ya no llegan: las quita main
 * (`src/main/modules/entity-secrets.ts`).
 */

const ROW_KEYS = [
  'technologies',
  'listenPorts',
  'detectedName',
  'executable',
  'firstSeen',
  'lastSeen',
  'managementZones',
  'tags'
] as const
export type ProcessRowKey = (typeof ROW_KEYS)[number]

/** Una fila del proceso. La clave, como `string` para poder buscarla por cualquier texto. */
export type ProcessRow =
  | { key: string; kind: 'text'; text: string }
  | { key: string; kind: 'date'; time: number }
  | { key: string; kind: 'chips'; chips: string[] }

export const PROCESS_RELATION_GROUP_KEYS = ['runsOn', 'processGroup', 'services', 'other'] as const
export type ProcessRelationGroupKey = (typeof PROCESS_RELATION_GROUP_KEYS)[number]

export interface ProcessInfo {
  rows: ProcessRow[]
  groups: RelationGroup<ProcessRelationGroupKey>[]
}

/** Clave de `metadata` con el nombre del ejecutable (enum de la Configuration API). */
const EXE_NAME = 'EXE_NAME'

export function buildProcessInfo(data: EntityData): ProcessInfo {
  return { rows: buildRows(data), groups: buildGroups(data) }
}

function buildRows(data: EntityData): ProcessRow[] {
  const properties = new Map<string, string>()
  for (const property of data.properties) {
    const text = property.text.trim()
    // Una clave repetida se queda con el primer valor con dato.
    if (text !== '' && !properties.has(property.key)) properties.set(property.key, text)
  }
  const prop = (key: string): string | null => properties.get(key) ?? null

  const rows: ProcessRow[] = []
  for (const key of ROW_KEYS) {
    const row = buildRow(key, data, prop)
    if (row !== null) rows.push(row)
  }
  return rows
}

function buildRow(
  key: ProcessRowKey,
  data: EntityData,
  prop: (key: string) => string | null
): ProcessRow | null {
  switch (key) {
    case 'technologies':
      return chipsRow(key, splitList(prop('softwareTechnologies')))
    case 'listenPorts':
    case 'detectedName': {
      const text = prop(key)
      return text === null ? null : { key, kind: 'text', text }
    }
    case 'executable': {
      const text = executableName(prop('metadata'))
      return text === null ? null : { key, kind: 'text', text }
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

/**
 * El nombre del ejecutable, de `EXE_NAME` dentro del texto de `metadata` (main lo da como
 * «CLAVE valor, CLAVE valor»). Si trae una ruta, solo el nombre del fichero.
 */
function executableName(metadata: string | null): string | null {
  for (const part of splitList(metadata)) {
    if (part !== EXE_NAME && !part.startsWith(`${EXE_NAME} `)) continue
    const value = part.slice(EXE_NAME.length).trim()
    const name = value.split(/[\\/]/).pop()?.trim() ?? ''
    return name === '' ? null : name
  }
  return null
}

function chipsRow(key: ProcessRowKey, values: string[]): ProcessRow | null {
  const chips = values.filter((value) => value.trim() !== '')
  return chips.length === 0 ? null : { key, kind: 'chips', chips }
}

/**
 * Grupo de una relación: el host (`isProcessOf`) y el process group (`isInstanceOf`), de
 * fromRelationships como en la 0027; los servicios, `runsOnProcessGroupInstance` de
 * toRelationships (la contraria de la que usa el servicio en la 0015). El resto, «Otras».
 */
function groupOf(direction: 'from' | 'to', name: string): ProcessRelationGroupKey {
  if (direction === 'from' && name === 'isProcessOf') return 'runsOn'
  if (direction === 'from' && name === 'isInstanceOf') return 'processGroup'
  if (direction === 'to' && name === 'runsOnProcessGroupInstance') return 'services'
  return 'other'
}

function buildGroups(data: EntityData): RelationGroup<ProcessRelationGroupKey>[] {
  const groups = new Map<ProcessRelationGroupKey, RelationGroup<ProcessRelationGroupKey>>(
    PROCESS_RELATION_GROUP_KEYS.map((key) => [key, { key, total: 0, entities: [] }])
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
