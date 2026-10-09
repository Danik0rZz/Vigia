import type { EntityData } from '@shared/modules'
import { buildRelationGroups, type ProcessRow } from './process-info'
import type { RelationGroup } from './service-info'

/**
 * Tarjeta «Información» de la página de una aplicación web, APPLICATION (ficha 0034), a partir
 * de la salida de `entities:get` (0014). Solo elige y ordena; los textos y el formato los pone el
 * componente.
 *
 * Filas: las claves de `properties` que la 0033 vio en vivo en APPLICATION (`applicationType`,
 * `applicationInjectionType`, `customizedName` y `detectedName`; `applicationLikeDeleted` y las
 * de reglas quedan en «Todas las propiedades») y, como en las demás tarjetas, visto por primera y
 * última vez y las management zones.
 *
 * Relaciones, con los nombres vistos en vivo: «Llama a» = `calls` de fromRelationships (SERVICE);
 * «Monitores sintéticos» = `monitors` de toRelationships (SYNTHETIC_TEST y HTTP_CHECK) e
 * `isApplicationOfSyntheticTest` de fromRelationships (HTTP_CHECK); «Otras», el resto (acciones
 * con `isApplicationMethodOf` y grupos de acciones con `isGroupOf`).
 */

const TEXT_KEYS = [
  'applicationType',
  'applicationInjectionType',
  'customizedName',
  'detectedName'
] as const

export const APPLICATION_RELATION_GROUP_KEYS = ['calls', 'synthetic', 'other'] as const
export type ApplicationRelationGroupKey = (typeof APPLICATION_RELATION_GROUP_KEYS)[number]

export interface ApplicationInfo {
  rows: ProcessRow[]
  groups: RelationGroup<ApplicationRelationGroupKey>[]
}

function groupOf(direction: 'from' | 'to', name: string): ApplicationRelationGroupKey {
  if (direction === 'from' && name === 'calls') return 'calls'
  if (direction === 'to' && name === 'monitors') return 'synthetic'
  if (direction === 'from' && name === 'isApplicationOfSyntheticTest') return 'synthetic'
  return 'other'
}

export function buildApplicationInfo(data: EntityData): ApplicationInfo {
  const properties = new Map<string, string>()
  for (const property of data.properties) {
    const text = property.text.trim()
    // Una clave repetida se queda con el primer valor con dato.
    if (text !== '' && !properties.has(property.key)) properties.set(property.key, text)
  }
  const rows: ProcessRow[] = []
  for (const key of TEXT_KEYS) {
    const text = properties.get(key)
    if (text !== undefined) rows.push({ key, kind: 'text', text })
  }
  if (data.firstSeen !== null) rows.push({ key: 'firstSeen', kind: 'date', time: data.firstSeen })
  if (data.lastSeen !== null) rows.push({ key: 'lastSeen', kind: 'date', time: data.lastSeen })
  const zones = data.managementZones.filter((zone) => zone.trim() !== '')
  if (zones.length > 0) rows.push({ key: 'managementZones', kind: 'chips', chips: zones })
  return {
    rows,
    groups: buildRelationGroups(data, APPLICATION_RELATION_GROUP_KEYS, groupOf)
  }
}
