/** Columnas por las que se ordena la lista de Problemas. */
export type ProblemSortKey = 'displayId' | 'title' | 'affected' | 'start'

export interface ProblemSort {
  key: ProblemSortKey
  direction: 'asc' | 'desc'
}

export const DEFAULT_PROBLEM_SORT: ProblemSort = { key: 'start', direction: 'desc' }

/** Lo que el orden necesita de cada problema. */
export interface SortableProblem {
  problemId: string
  displayId: string
  title: string
  startTime: number
  /** Entidades afectadas únicas (por id). */
  affectedCount: number
}

const displayIdCollator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

/** Orden natural del ID visible: P-9 < P-10 < P-100. Sin distinguir mayúsculas. */
export function compareDisplayId(a: string, b: string): number {
  return displayIdCollator.compare(a, b)
}

/** Comparador de títulos en el idioma de la interfaz: sin tildes ni mayúsculas, números en orden natural. */
export function compareTitle(lang: string): (a: string, b: string) => number {
  return new Intl.Collator(lang, { sensitivity: 'base', numeric: true }).compare
}

/** Entidades únicas por id, en el orden en que aparecen, con su primer nombre conocido. */
export function uniqueAffected(
  entities: readonly { id: string; name: string | null }[]
): { id: string; name: string | null }[] {
  const byId = new Map<string, { id: string; name: string | null }>()
  for (const entity of entities) {
    const seen = byId.get(entity.id)
    if (seen === undefined) byId.set(entity.id, { id: entity.id, name: entity.name })
    else if (seen.name === null && entity.name !== null) seen.name = entity.name
  }
  return [...byId.values()]
}

/** Etiquetas del tooltip de Afectados: hasta `max` (nombre o, si falta, el id) y cuántas quedan. */
export function affectedLabels(
  unique: readonly { id: string; name: string | null }[],
  max = 10
): { shown: string[]; more: number } {
  return {
    shown: unique.slice(0, max).map((entity) => entity.name ?? entity.id),
    more: Math.max(0, unique.length - max)
  }
}

/**
 * Copia ordenada de la lista. El desempate es fijo en los dos sentidos
 * (startTime descendente y después problemId), para que el orden no dependa de
 * cómo llegaron los datos.
 */
export function sortProblems<T extends SortableProblem>(
  items: readonly T[],
  sort: ProblemSort,
  lang: string
): T[] {
  const byTitle = compareTitle(lang)
  const primary = (a: T, b: T): number => {
    switch (sort.key) {
      case 'displayId':
        return compareDisplayId(a.displayId, b.displayId)
      case 'title':
        return byTitle(a.title, b.title)
      case 'affected':
        return a.affectedCount - b.affectedCount
      case 'start':
        return a.startTime - b.startTime
    }
  }
  const sign = sort.direction === 'asc' ? 1 : -1
  return [...items].sort(
    (a, b) =>
      sign * primary(a, b) ||
      b.startTime - a.startTime ||
      (a.problemId < b.problemId ? -1 : a.problemId > b.problemId ? 1 : 0)
  )
}
