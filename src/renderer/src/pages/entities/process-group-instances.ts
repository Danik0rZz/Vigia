import type { Comparator, GridSort } from '@shared/grid-sort'
import {
  entityIdSchema,
  processEntityIdSchema,
  type ProcessGroupInstance,
  type ProcessGroupMetricsResult
} from '@shared/modules'

/*
 * Tabla «Instancias» y marcador «Instancias» de la página de un PROCESS_GROUP (ficha 0032). Puras:
 * la tabla ordena antes de pintar (`sortRows`), como las del host.
 */

export const INSTANCE_COLUMN_IDS = ['name', 'host', 'cpu', 'memory'] as const
export type InstanceColumnId = (typeof INSTANCE_COLUMN_IDS)[number]

/** De más a menos CPU media, como llegan de main. */
export const DEFAULT_INSTANCE_SORT: GridSort<InstanceColumnId> = { key: 'cpu', direction: 'desc' }

/** Números ascendentes; sin dato va por debajo de todo (al final en el orden descendente). */
function compareNullable(a: number | null, b: number | null): number {
  if (a === b) return 0
  if (a === null) return -1
  if (b === null) return 1
  return a - b
}

/** Comparadores de la tabla, con el texto en el orden del idioma. */
export function instanceComparators(
  language: string
): Record<InstanceColumnId, Comparator<ProcessGroupInstance>> {
  const text = new Intl.Collator(language, { sensitivity: 'base', numeric: true }).compare
  return {
    name: (a, b) => text(a.name, b.name),
    host: (a, b) => text(hostLabel(a) ?? '', hostLabel(b) ?? ''),
    cpu: (a, b) => compareNullable(a.cpu, b.cpu),
    memory: (a, b) => compareNullable(a.memory, b.memory)
  }
}

/** Lo que se enseña del host: su nombre o, si no llegó, su id; null sin host. */
export function hostLabel(instance: ProcessGroupInstance): string | null {
  return instance.hostName ?? instance.hostId
}

/** Id de la instancia para el enlace a su página de proceso, solo si es válido; si no, null. */
export function instanceLinkId(instance: ProcessGroupInstance): string | null {
  return processEntityIdSchema.safeParse(instance.id).success ? instance.id : null
}

/** Id del host para el enlace a su página, solo si es un id de HOST válido; si no, null. */
export function hostLinkId(instance: ProcessGroupInstance): string | null {
  const id = instance.hostId
  return id !== null && entityIdSchema.safeParse(id).success && id.startsWith('HOST-') ? id : null
}

/**
 * ¿Llegan recortadas las instancias? Por encima de unas 498 instancias, Dynatrace recorta las
 * expresiones por instancia (tope de 1000 series) y main lo avisa en `partial` (nota del
 * Orquestador en la ficha 0032): la tabla y el total pueden estar incompletos.
 */
export function instancesTruncated(data: ProcessGroupMetricsResult): boolean {
  return data.partial.length > 0
}
