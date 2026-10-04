import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_PROBLEM_FILTERS,
  DEFAULT_PROBLEM_LIST_VIEW,
  DEFAULT_PROBLEM_SORT,
  useProblemFiltersStore
} from './problem-filters'

/**
 * AUD-21: los filtros de Problemas viven fuera de la página y van por entorno.
 * Al volver a un entorno se recuperan los suyos; uno nuevo empieza con los de
 * por defecto. AUD-12 añade severidad e impacto, también por entorno. v0.9.0
 * añade la vista de la lista (orden, fila visible y último abierto), que
 * tiene que sobrevivir a ir al detalle y volver.
 */

const store = useProblemFiltersStore
const DEFAULT_STATE = { ...DEFAULT_PROBLEM_FILTERS, ...DEFAULT_PROBLEM_LIST_VIEW }

function stateOf(envId: string): typeof DEFAULT_STATE | undefined {
  return store.getState().byEnv[envId]
}

beforeEach(() => {
  store.setState({ byEnv: {} })
})

describe('useProblemFiltersStore: filtros', () => {
  it('por defecto: estado all, sin texto, sin clústeres, sin severidad ni impacto', () => {
    expect(DEFAULT_PROBLEM_FILTERS).toEqual({
      status: 'all',
      text: '',
      clusters: [],
      severity: [],
      impact: []
    })
    expect(store.getState().byEnv).toEqual({})
  })

  it('un cambio parcial en un entorno nuevo parte de los de por defecto (filtros y vista)', () => {
    store.getState().update('env-a', { status: 'open' })
    expect(stateOf('env-a')).toEqual({ ...DEFAULT_STATE, status: 'open' })
  })

  it('dos entornos con filtros distintos no se mezclan, y al volver a A siguen los suyos', () => {
    const { update } = store.getState()
    update('env-a', { status: 'open' })
    update('env-a', { text: 'pagos' })
    update('env-a', { clusters: ['cluster-sur'] })
    update('env-a', { severity: ['AVAILABILITY'], impact: ['SERVICES'] })
    update('env-b', { status: 'closed', text: 'checkout' })

    const a = {
      ...DEFAULT_STATE,
      status: 'open',
      text: 'pagos',
      clusters: ['cluster-sur'],
      severity: ['AVAILABILITY'],
      impact: ['SERVICES']
    }
    expect(stateOf('env-a')).toEqual(a)
    expect(stateOf('env-b')).toEqual({ ...DEFAULT_STATE, status: 'closed', text: 'checkout' })

    // Cambiar B no toca A.
    update('env-b', { clusters: ['cluster-norte'], severity: ['ERROR'] })
    expect(stateOf('env-a')).toEqual(a)
  })

  it('un entorno sin cambios no tiene entrada (la página usa los de por defecto)', () => {
    store.getState().update('env-a', { status: 'open' })
    expect(stateOf('env-c')).toBeUndefined()
  })

  it('update no muta el objeto por defecto ni el estado anterior', () => {
    const before = store.getState().byEnv
    store.getState().update('env-a', {
      clusters: ['x'],
      severity: ['ERROR'],
      impact: ['SERVICES'],
      sort: { key: 'title', direction: 'asc' },
      scrollIndex: 42
    })
    expect(DEFAULT_PROBLEM_FILTERS.clusters).toEqual([])
    expect(DEFAULT_PROBLEM_FILTERS.severity).toEqual([])
    expect(DEFAULT_PROBLEM_FILTERS.impact).toEqual([])
    expect(DEFAULT_PROBLEM_LIST_VIEW).toEqual({
      sort: { key: 'start', direction: 'desc' },
      scrollIndex: 0,
      lastOpened: null
    })
    expect(before).toEqual({})
    expect(store.getState().byEnv).not.toBe(before)
  })
})

describe('useProblemFiltersStore: vista de la lista (v0.9.0)', () => {
  it('por defecto: Inicio descendente, fila 0 y ningún problema abierto antes', () => {
    expect(DEFAULT_PROBLEM_SORT).toEqual({ key: 'start', direction: 'desc' })
    expect(DEFAULT_PROBLEM_LIST_VIEW).toEqual({
      sort: DEFAULT_PROBLEM_SORT,
      scrollIndex: 0,
      lastOpened: null
    })
  })

  it('el orden, la fila visible y el último abierto se guardan y se recuperan', () => {
    const { update } = store.getState()
    update('env-a', { sort: { key: 'displayId', direction: 'asc' } })
    update('env-a', { scrollIndex: 137 })
    update('env-a', { lastOpened: 'pa-137' })
    expect(stateOf('env-a')).toMatchObject({
      sort: { key: 'displayId', direction: 'asc' },
      scrollIndex: 137,
      lastOpened: 'pa-137'
    })
  })

  it('no se mezclan entre entornos: B empieza por defecto y cambiar B no toca A', () => {
    const { update } = store.getState()
    update('env-a', { sort: { key: 'title', direction: 'asc' }, scrollIndex: 50 })
    update('env-a', { lastOpened: 'pa-50' })

    update('env-b', { status: 'open' })
    expect(stateOf('env-b')).toMatchObject(DEFAULT_PROBLEM_LIST_VIEW)

    update('env-b', { sort: { key: 'affected', direction: 'desc' }, scrollIndex: 3 })
    update('env-b', { lastOpened: 'pb-1' })
    expect(stateOf('env-a')).toMatchObject({
      sort: { key: 'title', direction: 'asc' },
      scrollIndex: 50,
      lastOpened: 'pa-50'
    })
  })

  it('cambiar el orden no toca los filtros ni la fila visible (y al revés)', () => {
    const { update } = store.getState()
    update('env-a', { status: 'open', text: 'pagos', scrollIndex: 20 })
    update('env-a', { sort: { key: 'displayId', direction: 'desc' } })
    expect(stateOf('env-a')).toMatchObject({ status: 'open', text: 'pagos', scrollIndex: 20 })
    update('env-a', { text: '' })
    expect(stateOf('env-a')?.sort).toEqual({ key: 'displayId', direction: 'desc' })
  })
})
