import type { Comparator, GridSort } from '@shared/grid-sort'
import {
  entityIdSchema,
  processEntityIdSchema,
  type ProcessGroupInstance,
  type ProcessGroupInstancesResult,
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

/** Instancias que da `entities:processGroupMetrics` como mucho: las 20 de más CPU (ficha 0050). */
export const TOP_INSTANCES = 20

/**
 * ¿Se presenta el número de instancias como mínimo y no como total? Solo si Dynatrace recortó las
 * expresiones por instancia (`partial`) y no se pudo saber el total real: con `totalKnown`, el
 * total sale de `totalCount` de `GET /entities` y es exacto aunque llegue `partial` (ficha 0051,
 * nota del revisor de la 0050).
 */
export function instancesTruncated(data: ProcessGroupMetricsResult): boolean {
  return data.partial.length > 0 && !data.instances.totalKnown
}

/** Aviso de que hay más instancias que las enseñadas: «N de total» o «N; puede haber más». */
export type InstancesNotice =
  { kind: 'of'; shown: number; total: number } | { kind: 'maybeMore'; shown: number }

/**
 * Aviso de la tabla de la página (ficha 0051): con el total real mayor que las enseñadas, «N de
 * total»; sin el total real, «puede haber más» si llegan las 20 (el tope) o la respuesta vino
 * recortada. Con todas a la vista, null (ni aviso ni «Ver todas»).
 */
export function instancesNotice(data: ProcessGroupMetricsResult): InstancesNotice | null {
  const shown = data.instances.items.length
  if (data.instances.totalKnown) {
    return data.instances.total > shown ? { kind: 'of', shown, total: data.instances.total } : null
  }
  return shown >= TOP_INSTANCES || data.partial.length > 0 ? { kind: 'maybeMore', shown } : null
}

/**
 * Aviso del modal con la lista completa (ficha 0051). `truncated` es true si Dynatrace recortó o
 * si llegan menos que el total real, que también pasa si `totalCount` cuenta instancias sin
 * datos en el rango (nota del revisor de la 0050): el texto no afirma un recorte, da los números.
 */
export function fullListNotice(data: ProcessGroupInstancesResult): InstancesNotice | null {
  if (!data.truncated) return null
  const shown = data.items.length
  return data.total > shown
    ? { kind: 'of', shown, total: data.total }
    : { kind: 'maybeMore', shown }
}

/** Buscador del modal: por nombre o por host (su nombre o su id), sin distinguir mayúsculas. */
export function filterInstances(
  items: readonly ProcessGroupInstance[],
  query: string
): ProcessGroupInstance[] {
  const needle = query.trim().toLocaleLowerCase()
  if (needle === '') return [...items]
  return items.filter(
    (item) =>
      item.name.toLocaleLowerCase().includes(needle) ||
      (hostLabel(item) ?? '').toLocaleLowerCase().includes(needle)
  )
}
