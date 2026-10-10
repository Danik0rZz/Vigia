/** Orden de una tabla: la columna (su id) y el sentido. */
export interface GridSort<K extends string = string> {
  key: K
  direction: 'asc' | 'desc'
}

/** Comparador ascendente. */
export type Comparator<T> = (a: T, b: T) => number

/** Comparación por código de carácter: para ids, nunca para texto que lee una persona. */
export function compareCodes(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Copia ordenada por la columna elegida y, en empate, por los desempates en
 * orden. Los desempates son fijos (no cambian con el sentido), y el último debe
 * ser un id único, para que el orden no dependa de cómo llegaron los datos.
 */
export function sortRows<T, K extends string>(
  items: readonly T[],
  sort: GridSort<K>,
  comparators: Record<K, Comparator<T>>,
  tiebreaks: readonly Comparator<T>[]
): T[] {
  const primary = comparators[sort.key]
  const sign = sort.direction === 'asc' ? 1 : -1
  return [...items].sort((a, b) => {
    const first = sign * primary(a, b)
    if (first !== 0) return first
    for (const tiebreak of tiebreaks) {
      const next = tiebreak(a, b)
      if (next !== 0) return next
    }
    return 0
  })
}

/**
 * Números ascendentes; sin dato va por debajo de todo. Como `sortRows` invierte el comparador
 * en descendente (el orden por defecto de las tablas de entidad), allí va al final y en
 * ascendente, al principio (ficha 0058).
 */
export function compareNullable(a: number | null, b: number | null): number {
  if (a === b) return 0
  if (a === null) return -1
  if (b === null) return 1
  return a - b
}

/** Comparador por un número que puede faltar (`compareNullable`). */
export const byNumber =
  <T>(value: (item: T) => number | null): Comparator<T> =>
  (a, b) =>
    compareNullable(value(a), value(b))
