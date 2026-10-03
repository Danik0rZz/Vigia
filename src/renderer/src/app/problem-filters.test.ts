import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_PROBLEM_FILTERS, useProblemFiltersStore } from './problem-filters'

/**
 * AUD-21: los filtros de Problemas viven fuera de la página y van por entorno.
 * Al volver a un entorno se recuperan los suyos; uno nuevo empieza con los de
 * por defecto.
 */

const store = useProblemFiltersStore

function filtersOf(envId: string): typeof DEFAULT_PROBLEM_FILTERS | undefined {
  return store.getState().byEnv[envId]
}

beforeEach(() => {
  store.setState({ byEnv: {} })
})

describe('useProblemFiltersStore', () => {
  it('por defecto: estado all, sin texto y sin clústeres', () => {
    expect(DEFAULT_PROBLEM_FILTERS).toEqual({ status: 'all', text: '', clusters: [] })
    expect(store.getState().byEnv).toEqual({})
  })

  it('un cambio parcial en un entorno nuevo parte de los de por defecto', () => {
    store.getState().update('env-a', { status: 'open' })
    expect(filtersOf('env-a')).toEqual({ status: 'open', text: '', clusters: [] })
  })

  it('dos entornos con filtros distintos no se mezclan, y al volver a A siguen los suyos', () => {
    const { update } = store.getState()
    update('env-a', { status: 'open' })
    update('env-a', { text: 'pagos' })
    update('env-a', { clusters: ['cluster-sur'] })
    update('env-b', { status: 'closed', text: 'checkout' })

    expect(filtersOf('env-a')).toEqual({ status: 'open', text: 'pagos', clusters: ['cluster-sur'] })
    expect(filtersOf('env-b')).toEqual({ status: 'closed', text: 'checkout', clusters: [] })

    // Cambiar B no toca A.
    update('env-b', { clusters: ['cluster-norte'] })
    expect(filtersOf('env-a')).toEqual({ status: 'open', text: 'pagos', clusters: ['cluster-sur'] })
  })

  it('un entorno sin cambios no tiene entrada (la página usa los de por defecto)', () => {
    store.getState().update('env-a', { status: 'open' })
    expect(filtersOf('env-c')).toBeUndefined()
  })

  it('update no muta el objeto por defecto ni el estado anterior', () => {
    const before = store.getState().byEnv
    store.getState().update('env-a', { clusters: ['x'] })
    expect(DEFAULT_PROBLEM_FILTERS.clusters).toEqual([])
    expect(before).toEqual({})
    expect(store.getState().byEnv).not.toBe(before)
  })
})
