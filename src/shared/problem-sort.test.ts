import { describe, expect, it } from 'vitest'
import {
  affectedLabels,
  compareDisplayId,
  compareTitle,
  sortProblems,
  uniqueAffected
} from './problem-sort'

/**
 * v0.9.0: orden de la lista de Problemas. ID con orden natural, Título por
 * idioma, Afectados únicos por id e Inicio descendente por defecto, con un
 * desempate determinista (startTime desc y problemId asc).
 */

type Item = Parameters<typeof sortProblems>[0][number]

const item = (overrides: Partial<Item> & { problemId: string }): Item => ({
  displayId: overrides.problemId.toUpperCase(),
  title: 'x',
  startTime: 1000,
  affectedCount: 1,
  ...overrides
})

const ids = (items: Item[]): string[] => items.map((i) => i.problemId)

describe('compareDisplayId: orden natural', () => {
  it('P-9 < P-10 < P-100 (no alfabético)', () => {
    expect(['P-100', 'P-9', 'P-10'].sort(compareDisplayId)).toEqual(['P-9', 'P-10', 'P-100'])
  })

  it('otros prefijos y sin número usan la misma colación', () => {
    expect(compareDisplayId('A-5', 'P-1')).toBeLessThan(0)
    expect(compareDisplayId('P-', 'P-1')).toBeLessThan(0)
    expect(compareDisplayId('P-1', 'P-1')).toBe(0)
  })

  it('no distingue mayúsculas (sensitivity base)', () => {
    expect(compareDisplayId('p-10', 'P-10')).toBe(0)
  })
})

describe('compareTitle: por idioma', () => {
  it('ignora tildes y mayúsculas', () => {
    expect(compareTitle('es')('árbol', 'Arbol')).toBe(0)
    expect(compareTitle('en')('Error', 'error')).toBe(0)
  })

  it('en español, la ñ va entre la n y la o', () => {
    expect(['oro', 'ñandú', 'nube'].sort(compareTitle('es'))).toEqual(['nube', 'ñandú', 'oro'])
  })

  it('con números dentro, orden natural', () => {
    expect(['Disco 10', 'Disco 9'].sort(compareTitle('es'))).toEqual(['Disco 9', 'Disco 10'])
  })
})

describe('uniqueAffected y affectedLabels', () => {
  it('únicos por id, en el orden de primera aparición, con el primer nombre no nulo', () => {
    expect(
      uniqueAffected([
        { id: 'SERVICE-1', name: null },
        { id: 'HOST-1', name: 'host-pagos' },
        { id: 'SERVICE-1', name: 'pagos' },
        { id: 'HOST-1', name: 'otro-nombre' },
        { id: 'PROCESS_GROUP-1', name: null }
      ])
    ).toEqual([
      { id: 'SERVICE-1', name: 'pagos' },
      { id: 'HOST-1', name: 'host-pagos' },
      { id: 'PROCESS_GROUP-1', name: null }
    ])
  })

  it('lista vacía → vacía', () => {
    expect(uniqueAffected([])).toEqual([])
  })

  it('etiqueta = nombre o, sin nombre, el id; hasta 10 y «+N» con el resto', () => {
    const unique = Array.from({ length: 12 }, (_, i) => ({
      id: `SERVICE-${i}`,
      name: i === 0 ? null : `svc-${i}`
    }))
    const labels = affectedLabels(unique)
    expect(labels.shown).toHaveLength(10)
    expect(labels.shown[0]).toBe('SERVICE-0')
    expect(labels.shown[1]).toBe('svc-1')
    expect(labels.more).toBe(2)
  })

  it('con 10 o menos, more = 0; y el máximo se puede cambiar', () => {
    const unique = [
      { id: 'A', name: 'a' },
      { id: 'B', name: 'b' },
      { id: 'C', name: null }
    ]
    expect(affectedLabels(unique)).toEqual({ shown: ['a', 'b', 'C'], more: 0 })
    expect(affectedLabels(unique, 2)).toEqual({ shown: ['a', 'b'], more: 1 })
  })
})

describe('sortProblems', () => {
  const items: Item[] = [
    item({
      problemId: 'pa-2',
      displayId: 'P-10',
      title: 'Zeta',
      startTime: 2000,
      affectedCount: 3
    }),
    item({
      problemId: 'pa-1',
      displayId: 'P-9',
      title: 'ámbito',
      startTime: 3000,
      affectedCount: 1
    }),
    item({
      problemId: 'pa-3',
      displayId: 'P-100',
      title: 'beta',
      startTime: 1000,
      affectedCount: 2
    })
  ]

  it('por defecto (start desc): el más reciente primero', () => {
    expect(ids(sortProblems(items, { key: 'start', direction: 'desc' }, 'es'))).toEqual([
      'pa-1',
      'pa-2',
      'pa-3'
    ])
    expect(ids(sortProblems(items, { key: 'start', direction: 'asc' }, 'es'))).toEqual([
      'pa-3',
      'pa-2',
      'pa-1'
    ])
  })

  it('displayId: orden natural en los dos sentidos', () => {
    expect(ids(sortProblems(items, { key: 'displayId', direction: 'asc' }, 'es'))).toEqual([
      'pa-1',
      'pa-2',
      'pa-3'
    ])
    expect(ids(sortProblems(items, { key: 'displayId', direction: 'desc' }, 'es'))).toEqual([
      'pa-3',
      'pa-2',
      'pa-1'
    ])
  })

  it('title: por idioma, sin tildes (ámbito < beta < Zeta)', () => {
    expect(ids(sortProblems(items, { key: 'title', direction: 'asc' }, 'es'))).toEqual([
      'pa-1',
      'pa-3',
      'pa-2'
    ])
  })

  it('affected: por número de afectados únicos', () => {
    expect(ids(sortProblems(items, { key: 'affected', direction: 'desc' }, 'es'))).toEqual([
      'pa-2',
      'pa-3',
      'pa-1'
    ])
  })

  it('desempate determinista: startTime desc y después problemId asc', () => {
    const ties = [
      item({ problemId: 'pb', title: 'Igual', startTime: 1000 }),
      item({ problemId: 'pc', title: 'igual', startTime: 2000 }),
      item({ problemId: 'pa', title: 'IGUAL', startTime: 1000 })
    ]
    // Mismo título para la colación: decide startTime desc y luego problemId asc.
    expect(ids(sortProblems(ties, { key: 'title', direction: 'asc' }, 'es'))).toEqual([
      'pc',
      'pa',
      'pb'
    ])
    // Incluso en orden descendente, el desempate sigue siendo el mismo.
    expect(ids(sortProblems(ties, { key: 'title', direction: 'desc' }, 'es'))).toEqual([
      'pc',
      'pa',
      'pb'
    ])
  })

  it('devuelve una copia: no cambia la lista de entrada', () => {
    const copy = [...items]
    const sorted = sortProblems(items, { key: 'displayId', direction: 'desc' }, 'es')
    expect(sorted).not.toBe(items)
    expect(items).toEqual(copy)
  })

  it('lista vacía → vacía', () => {
    expect(sortProblems([], { key: 'start', direction: 'desc' }, 'es')).toEqual([])
  })
})
