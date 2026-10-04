import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_PROBLEM_FILTERS, useProblemFiltersStore } from './problem-filters'

/**
 * AUD-21: los filtros de Problemas viven fuera de la página y van por entorno.
 * Al volver a un entorno se recuperan los suyos; uno nuevo empieza con los de
 * por defecto. AUD-12 añade severidad e impacto, también por entorno.
 */

const store = useProblemFiltersStore

function filtersOf(envId: string): typeof DEFAULT_PROBLEM_FILTERS | undefined {
  return store.getState().byEnv[envId]
}

beforeEach(() => {
  store.setState({ byEnv: {} })
})

describe('useProblemFiltersStore', () => {
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

  it('un cambio parcial en un entorno nuevo parte de los de por defecto', () => {
    store.getState().update('env-a', { status: 'open' })
    expect(filtersOf('env-a')).toEqual({ ...DEFAULT_PROBLEM_FILTERS, status: 'open' })
  })

  it('dos entornos con filtros distintos no se mezclan, y al volver a A siguen los suyos', () => {
    const { update } = store.getState()
    update('env-a', { status: 'open' })
    update('env-a', { text: 'pagos' })
    update('env-a', { clusters: ['cluster-sur'] })
    update('env-a', { severity: ['AVAILABILITY'], impact: ['SERVICES'] })
    update('env-b', { status: 'closed', text: 'checkout' })

    const a = {
      status: 'open',
      text: 'pagos',
      clusters: ['cluster-sur'],
      severity: ['AVAILABILITY'],
      impact: ['SERVICES']
    }
    expect(filtersOf('env-a')).toEqual(a)
    expect(filtersOf('env-b')).toEqual({
      ...DEFAULT_PROBLEM_FILTERS,
      status: 'closed',
      text: 'checkout'
    })

    // Cambiar B no toca A.
    update('env-b', { clusters: ['cluster-norte'], severity: ['ERROR'] })
    expect(filtersOf('env-a')).toEqual(a)
  })

  it('un entorno sin cambios no tiene entrada (la página usa los de por defecto)', () => {
    store.getState().update('env-a', { status: 'open' })
    expect(filtersOf('env-c')).toBeUndefined()
  })

  it('update no muta el objeto por defecto ni el estado anterior', () => {
    const before = store.getState().byEnv
    store.getState().update('env-a', { clusters: ['x'], severity: ['ERROR'], impact: ['SERVICES'] })
    expect(DEFAULT_PROBLEM_FILTERS.clusters).toEqual([])
    expect(DEFAULT_PROBLEM_FILTERS.severity).toEqual([])
    expect(DEFAULT_PROBLEM_FILTERS.impact).toEqual([])
    expect(before).toEqual({})
    expect(store.getState().byEnv).not.toBe(before)
  })
})
