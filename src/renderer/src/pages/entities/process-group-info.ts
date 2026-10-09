import type { EntityData } from '@shared/modules'
import { buildProcessRows, buildRelationGroups, type ProcessRow } from './process-info'
import type { RelationGroup } from './service-info'

/**
 * Tarjeta «Información» de la página de un PROCESS_GROUP (ficha 0032), a partir de la salida de
 * `entities:get` (0014). Las filas, las del proceso (0029): en vivo, un PROCESS_GROUP trae las
 * mismas claves (`detectedName`, `listenPorts`, `softwareTechnologies` y `metadata`, de la que solo
 * se enseña el nombre del ejecutable). La línea de comandos y las rutas completas no llegan: las
 * quita main (`src/main/modules/entity-secrets.ts`).
 *
 * Relaciones, con los nombres vistos en vivo en PROCESS_GROUP (informe de `entities-explore`):
 * «Instancias» = `isInstanceOf` de toRelationships, «Hosts» = `runsOn` de fromRelationships,
 * «Servicios» = `runsOn` de toRelationships y «Otras», el resto.
 */
export const PROCESS_GROUP_RELATION_GROUP_KEYS = [
  'instances',
  'hosts',
  'services',
  'other'
] as const
export type ProcessGroupRelationGroupKey = (typeof PROCESS_GROUP_RELATION_GROUP_KEYS)[number]

export interface ProcessGroupInfo {
  rows: ProcessRow[]
  groups: RelationGroup<ProcessGroupRelationGroupKey>[]
}

function groupOf(direction: 'from' | 'to', name: string): ProcessGroupRelationGroupKey {
  if (direction === 'to' && name === 'isInstanceOf') return 'instances'
  if (direction === 'from' && name === 'runsOn') return 'hosts'
  if (direction === 'to' && name === 'runsOn') return 'services'
  return 'other'
}

export function buildProcessGroupInfo(data: EntityData): ProcessGroupInfo {
  return {
    rows: buildProcessRows(data),
    groups: buildRelationGroups(data, PROCESS_GROUP_RELATION_GROUP_KEYS, groupOf)
  }
}
