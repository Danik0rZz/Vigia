import { describe, expect, it } from 'vitest'
import { DT_ENDPOINTS, nextPageQuery } from './dt-endpoints'

/**
 * Descriptor por endpoint de las listas de la API v2: dónde están los
 * elementos y qué parámetros se repiten con nextPageKey (spec de la API: en
 * /problems se repite fields; en el resto, nada).
 */

describe('DT_ENDPOINTS', () => {
  it('tiene la ruta y la clave de elementos de cada lista (según APIv2.json)', () => {
    expect(DT_ENDPOINTS).toEqual({
      problems: { path: '/problems', itemsKey: 'problems', keepOnNextPage: ['fields'] },
      entities: { path: '/entities', itemsKey: 'entities', keepOnNextPage: [] },
      entityTypes: { path: '/entityTypes', itemsKey: 'types', keepOnNextPage: [] },
      slo: { path: '/slo', itemsKey: 'slo', keepOnNextPage: [] },
      events: { path: '/events', itemsKey: 'events', keepOnNextPage: [] },
      eventTypes: { path: '/eventTypes', itemsKey: 'eventTypeInfos', keepOnNextPage: [] },
      metrics: { path: '/metrics', itemsKey: 'metrics', keepOnNextPage: [] }
    })
  })
})

describe('nextPageQuery', () => {
  const firstWithEverything = {
    fields: '+evidenceDetails',
    from: 'now-2h',
    to: 'now',
    problemSelector: 'status("open")',
    entitySelector: 'type(SERVICE)',
    sloSelector: 'id("x")',
    eventSelector: 'eventType("CUSTOM_ALERT")',
    pageSize: 100,
    evaluate: true
  }

  it('problems: nextPageKey y fields, con el mismo valor', () => {
    expect(nextPageQuery(DT_ENDPOINTS.problems, firstWithEverything, 'k2')).toEqual({
      nextPageKey: 'k2',
      fields: '+evidenceDetails'
    })
  })

  it('problems sin fields en la primera: solo nextPageKey', () => {
    expect(nextPageQuery(DT_ENDPOINTS.problems, { from: 'now-2h', pageSize: 100 }, 'k2')).toEqual({
      nextPageKey: 'k2'
    })
    expect(
      nextPageQuery(DT_ENDPOINTS.problems, { from: 'now-2h', fields: undefined }, 'k2')
    ).toEqual({ nextPageKey: 'k2' })
  })

  it.each(['entities', 'entityTypes', 'slo', 'events', 'eventTypes', 'metrics'] as const)(
    '%s: solo nextPageKey aunque la primera llevara fields y todo lo demás',
    (name) => {
      expect(nextPageQuery(DT_ENDPOINTS[name], firstWithEverything, 'k2')).toEqual({
        nextPageKey: 'k2'
      })
    }
  )

  it('sin query en la primera página: solo nextPageKey', () => {
    expect(nextPageQuery(DT_ENDPOINTS.problems, undefined, 'k2')).toEqual({ nextPageKey: 'k2' })
  })

  it('no modifica la query de la primera página', () => {
    const first = { fields: '+x', from: 'now-2h' }
    nextPageQuery(DT_ENDPOINTS.problems, first, 'k2')
    expect(first).toEqual({ fields: '+x', from: 'now-2h' })
  })
})
