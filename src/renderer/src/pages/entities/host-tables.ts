import { compareCodes, type Comparator, type GridSort } from '@shared/grid-sort'
import {
  diskEntityIdSchema,
  entityIdSchema,
  type HostBreakdownResult,
  type HostDisk,
  type HostProcess
} from '@shared/modules'

/*
 * Orden y reglas de las tablas de discos y procesos de la página de un HOST (ficha 0019). Puras:
 * la tabla ordena antes de pintar (`sortRows`), como Problemas y las evidencias.
 */

export const DISK_COLUMN_IDS = ['name', 'usage', 'used', 'free', 'read', 'write'] as const
export type DiskColumnId = (typeof DISK_COLUMN_IDS)[number]
export const PROCESS_COLUMN_IDS = ['name', 'cpu', 'cpuMax', 'memory'] as const
export type ProcessColumnId = (typeof PROCESS_COLUMN_IDS)[number]

/** Del más lleno al menos (último dato, como lo da main) y por CPU media. */
export const DEFAULT_DISK_SORT: GridSort<DiskColumnId> = { key: 'usage', direction: 'desc' }
export const DEFAULT_PROCESS_SORT: GridSort<ProcessColumnId> = { key: 'cpu', direction: 'desc' }

/** Números ascendentes; sin dato va por debajo de todo (al final en el orden descendente). */
function compareNullable(a: number | null, b: number | null): number {
  if (a === b) return 0
  if (a === null) return -1
  if (b === null) return 1
  return a - b
}

const byNumber =
  <T>(value: (item: T) => number | null): Comparator<T> =>
  (a, b) =>
    compareNullable(value(a), value(b))

/** Comparadores de la tabla de discos, con el texto en el orden del idioma. */
export function diskComparators(language: string): Record<DiskColumnId, Comparator<HostDisk>> {
  const text = new Intl.Collator(language, { sensitivity: 'base', numeric: true }).compare
  return {
    name: (a, b) => text(a.name, b.name),
    usage: byNumber((d) => d.usedPct.last),
    used: byNumber((d) => d.used),
    free: byNumber((d) => d.avail),
    read: byNumber((d) => d.read),
    write: byNumber((d) => d.write)
  }
}

export function processComparators(
  language: string
): Record<ProcessColumnId, Comparator<HostProcess>> {
  const text = new Intl.Collator(language, { sensitivity: 'base', numeric: true }).compare
  return {
    name: (a, b) => text(a.name, b.name),
    cpu: byNumber((p) => p.cpu.avg),
    cpuMax: byNumber((p) => p.cpu.max),
    memory: byNumber((p) => p.memory)
  }
}

/** Desempate fijo por id: el orden no depende de cómo llegaron los datos. */
export const byId: Comparator<{ id: string }> = (a, b) => compareCodes(a.id, b.id)

/** Total del disco: usado + libre (los dos del último dato); sin uno de ellos, sin total. */
export function diskTotal(disk: HostDisk): number | null {
  return disk.used === null || disk.avail === null ? null : disk.used + disk.avail
}

/**
 * ¿Llega recortada la consulta de procesos? La de `builtin:tech.generic.*` puede pasar del tope
 * de 1.000 series en hosts con muchos procesos (nota de la revisión de la 0017): entonces la
 * lista y el total pueden estar incompletos. Una de discos recortada no cuenta.
 */
export function processesTruncated(data: HostBreakdownResult): boolean {
  return data.partial.some((entry) => entry.metricId.includes('builtin:tech.generic.'))
}

/**
 * Id del proceso para el enlace a su página, solo si es un id de Dynatrace válido y de
 * PROCESS_GROUP_INSTANCE (el que da `dt.entity.process_group_instance`); si no, sin enlace.
 */
export function processLinkId(process: HostProcess): string | null {
  return entityIdSchema.safeParse(process.id).success &&
    process.id.startsWith('PROCESS_GROUP_INSTANCE-')
    ? process.id
    : null
}

/**
 * Id del disco para el enlace a su página (ficha 0040), solo si es un id de DISK válido (el que da
 * `dt.entity.disk`); si no, sin enlace.
 */
export function diskLinkId(disk: HostDisk): string | null {
  return diskEntityIdSchema.safeParse(disk.id).success ? disk.id : null
}
