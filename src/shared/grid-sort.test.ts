import { describe, expect, it } from 'vitest'
import { compareCodes, sortRows, type Comparator } from './grid-sort'

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
