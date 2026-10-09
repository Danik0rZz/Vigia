import { describe, expect, it } from 'vitest'
import { sortRows } from '@shared/grid-sort'
import type { ApplicationAction } from '@shared/modules'
import { DEFAULT_ACTION_SORT, actionComparators, durationShare } from './application-actions'

/** Ficha 0034: orden y barra de la tabla «Acciones de usuario». */
const actions: ApplicationAction[] = [
  { id: 'a', name: 'Carga', count: 90, duration: 1500 },
  { id: 'b', name: 'buscar', count: 140, duration: 300 },
  { id: 'c', name: 'Carrito', count: null, duration: null }
]
const ids = (list: ApplicationAction[]): string[] => list.map((action) => action.id)

describe('tabla de acciones (0034)', () => {
  it('por defecto, de más a menos acciones; sin dato, al final', () => {
    expect(ids(sortRows(actions, DEFAULT_ACTION_SORT, actionComparators('es'), []))).toEqual([
      'b',
      'a',
      'c'
    ])
  })

  it('por duración y por nombre, en los dos sentidos', () => {
    const comparators = actionComparators('es')
    expect(ids(sortRows(actions, { key: 'duration', direction: 'asc' }, comparators, []))).toEqual([
      'c',
      'b',
      'a'
    ])
    expect(ids(sortRows(actions, { key: 'name', direction: 'asc' }, comparators, []))).toEqual([
      'b',
      'a',
      'c'
    ])
  })

  it('la barra de la duración, frente a la más lenta', () => {
    expect(durationShare(1500, actions)).toBe(100)
    expect(durationShare(300, actions)).toBe(20)
    expect(durationShare(null, actions)).toBe(0)
    expect(durationShare(0, actions)).toBe(0)
    expect(durationShare(10, [{ id: 'x', name: 'x', count: 1, duration: null }])).toBe(0)
  })
})
