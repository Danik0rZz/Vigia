import { describe, expect, it } from 'vitest'
import { byNumber, compareCodes, compareNullable, sortRows, type Comparator } from './grid-sort'

interface Row {
  id: string
  group: number
  time: number
}

const comparators: Record<'group' | 'time', Comparator<Row>> = {
  group: (a, b) => a.group - b.group,
  time: (a, b) => a.time - b.time
}
const tiebreaks: Comparator<Row>[] = [(a, b) => b.time - a.time, (a, b) => compareCodes(a.id, b.id)]

const rows: Row[] = [
  { id: 'c', group: 1, time: 10 },
  { id: 'a', group: 2, time: 10 },
  { id: 'b', group: 1, time: 10 },
  { id: 'd', group: 1, time: 20 }
]

describe('sortRows', () => {
  it('ordena por la columna en los dos sentidos sin tocar la entrada', () => {
    const copy = [...rows]
    expect(
      sortRows(rows, { key: 'group', direction: 'asc' }, comparators, tiebreaks).map((r) => r.id)
    ).toEqual(['d', 'b', 'c', 'a'])
    expect(
      sortRows(rows, { key: 'group', direction: 'desc' }, comparators, tiebreaks).map((r) => r.id)
    ).toEqual(['a', 'd', 'b', 'c'])
    expect(rows).toEqual(copy)
  })

  it('los desempates no cambian con el sentido y el orden no depende de la entrada', () => {
    const asc = sortRows(rows, { key: 'time', direction: 'asc' }, comparators, tiebreaks)
    expect(asc.map((r) => r.id)).toEqual(['a', 'b', 'c', 'd'])
    const reversed = sortRows(
      [...rows].reverse(),
      { key: 'time', direction: 'asc' },
      comparators,
      tiebreaks
    )
    expect(reversed).toEqual(asc)
  })

  it('sin desempates, los iguales conservan su orden (sort estable)', () => {
    expect(
      sortRows(rows, { key: 'time', direction: 'desc' }, comparators, []).map((r) => r.id)
    ).toEqual(['d', 'c', 'a', 'b'])
  })

  it('compareCodes compara por código, no por idioma', () => {
    expect(compareCodes('B', 'a')).toBe(-1)
    expect(compareCodes('a', 'a')).toBe(0)
    expect(compareCodes('b', 'a')).toBe(1)
  })
})

/**
 * Ficha 0058, CA2: los comparadores de números con hueco que repetían las tablas de host, monitores,
 * process group y aplicación, en un solo sitio. Decisión del test-writer (delegada por Dani): la ficha
 * pide `null` «al final en los dos sentidos», pero el arreglo no puede cambiar nada visible (CA4) y
 * hoy `sortRows` invierte el comparador, así que sin dato va por debajo de todo: al final en el
 * orden descendente (el de por defecto de todas esas tablas) y al principio en el ascendente. Se
 * fija lo de hoy.
 */
describe('CA2 (0058): compareNullable y byNumber, con sin dato por debajo de todo', () => {
  interface Item {
    id: string
    value: number | null
  }
  const items: Item[] = [
    { id: 'a', value: 5 },
    { id: 'b', value: null },
    { id: 'c', value: -2 },
    { id: 'd', value: 12.5 },
    { id: 'e', value: null },
    { id: 'f', value: 0 }
  ]
  const comparators: Record<'value', Comparator<Item>> = { value: byNumber((item) => item.value) }
  const byId: Comparator<Item>[] = [(a, b) => compareCodes(a.id, b.id)]
  const order = (direction: 'asc' | 'desc'): string[] =>
    sortRows(items, { key: 'value', direction }, comparators, byId).map((item) => item.id)

  it('CA2 (0058): compareNullable ordena los números de menor a mayor y pone null por debajo', () => {
    expect(compareNullable(1, 2)).toBeLessThan(0)
    expect(compareNullable(2, 1)).toBeGreaterThan(0)
    expect(compareNullable(-3, 0)).toBeLessThan(0)
    expect(compareNullable(4, 4)).toBe(0)
    expect(compareNullable(null, null)).toBe(0)
    expect(compareNullable(null, -1000)).toBeLessThan(0)
    expect(compareNullable(0, null)).toBeGreaterThan(0)
  })

  it('CA2 (0058): en descendente, de mayor a menor y los null al final', () => {
    expect(order('desc')).toEqual(['d', 'a', 'f', 'c', 'b', 'e'])
  })

  it('CA2 (0058): en ascendente, de menor a mayor con los null delante (como hoy en las tablas)', () => {
    expect(order('asc')).toEqual(['b', 'e', 'c', 'f', 'a', 'd'])
  })

  it('CA2 (0058): el orden no depende de cómo llegan los datos', () => {
    const reversed = sortRows(
      [...items].reverse(),
      { key: 'value', direction: 'desc' },
      comparators,
      byId
    )
    expect(reversed.map((item) => item.id)).toEqual(order('desc'))
  })
})
