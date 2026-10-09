import type { EntityData } from '@shared/modules'
import { buildRelationGroups } from './process-info'
import type { RelationGroup } from './service-info'

/**
 * Tarjeta «Información» de la página de un DISK (ficha 0040): qué filas salen, a partir de la
 * salida de `entities:get` (0014). Claves vistas en vivo en el paso 0: `properties` con
 * `detectedName` y `filesystemType`, `firstSeenTms` y `lastSeenTms`, y una relación,
 * `fromRelationships.isDiskOf` (el host). El host va en la fila «Disco de», con su enlace a la
 * vista; cualquier otra relación, en «Otras relaciones». Como `host-info.ts`, solo elige y
 * ordena; los textos y el formato los pone el componente.
 */

const ROW_KEYS = [
  'detectedName',
  'filesystemType',
  'diskOf',
  'firstSeen',
  'lastSeen',
  'managementZones'
] as const
export type DiskRowKey = (typeof ROW_KEYS)[number]

/** Un host del que es el disco (id y tipo, para el enlace). */
export interface DiskHost {
  id: string
  type: string
}

/** Una fila del disco. */
export type DiskRow =
  | { key: DiskRowKey; kind: 'text'; text: string }
  | { key: DiskRowKey; kind: 'date'; time: number }
  | { key: DiskRowKey; kind: 'chips'; chips: string[] }
  | { key: DiskRowKey; kind: 'hosts'; hosts: DiskHost[] }

export const DISK_RELATION_GROUP_KEYS = ['other'] as const
export type DiskRelationGroupKey = (typeof DISK_RELATION_GROUP_KEYS)[number]

export interface DiskInfo {
  rows: DiskRow[]
  /** Las relaciones que no son la del host. */
  groups: RelationGroup<DiskRelationGroupKey>[]
}

/** Relación del disco con su host (de `fromRelationships`). */
const DISK_OF = 'isDiskOf'

export function buildDiskInfo(data: EntityData): DiskInfo {
  const properties = new Map<string, string>()
  for (const property of data.properties) {
    const text = property.text.trim()
    // Una clave repetida se queda con el primer valor con dato.
    if (text !== '' && !properties.has(property.key)) properties.set(property.key, text)
  }
  const hosts: DiskHost[] = data.relationships
    .filter((relation) => relation.direction === 'from' && relation.name === DISK_OF)
    .flatMap((relation) => relation.entities)

  const rows: DiskRow[] = []
  for (const key of ROW_KEYS) {
    const row = buildRow(key, data, properties, hosts)
    if (row !== null) rows.push(row)
  }
  // La del host ya va en su fila: aquí solo las demás.
  const rest: EntityData = {
    ...data,
    relationships: data.relationships.filter(
      (relation) => !(relation.direction === 'from' && relation.name === DISK_OF)
    )
  }
  return { rows, groups: buildRelationGroups(rest, DISK_RELATION_GROUP_KEYS, () => 'other') }
}

function buildRow(
  key: DiskRowKey,
  data: EntityData,
  properties: Map<string, string>,
  hosts: DiskHost[]
): DiskRow | null {
  switch (key) {
    case 'detectedName':
    case 'filesystemType': {
      const text = properties.get(key) ?? null
      return text === null ? null : { key, kind: 'text', text }
    }
    case 'diskOf':
      return hosts.length === 0 ? null : { key, kind: 'hosts', hosts }
    case 'firstSeen':
      return data.firstSeen === null ? null : { key, kind: 'date', time: data.firstSeen }
    case 'lastSeen':
      return data.lastSeen === null ? null : { key, kind: 'date', time: data.lastSeen }
    case 'managementZones': {
      const chips = data.managementZones.filter((zone) => zone.trim() !== '')
      return chips.length === 0 ? null : { key, kind: 'chips', chips }
    }
  }
}
