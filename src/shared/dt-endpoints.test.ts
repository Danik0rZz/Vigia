import { describe, expect, it } from 'vitest'
import { DT_ENDPOINTS, nextPageQuery, problemCommentsEndpoint } from './dt-endpoints'

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

describe('problemCommentsEndpoint (v0.9.1)', () => {
  it('ruta con el id del problema, elementos en comments y nada que repetir', () => {
    expect(problemCommentsEndpoint('-1234567890123456789_1700000000000V2')).toEqual({
      path: '/problems/-1234567890123456789_1700000000000V2/comments',
      itemsKey: 'comments',
      keepOnNextPage: []
    })
  })

  it('el id va codificado: no puede cambiar la ruta ni añadir parámetros', () => {
    expect(problemCommentsEndpoint('../x?y=1#z').path).toBe('/problems/..%2Fx%3Fy%3D1%23z/comments')
    expect(problemCommentsEndpoint('a/b').path).toBe('/problems/a%2Fb/comments')
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

  it('v0.9.1: comentarios de un problema: solo nextPageKey (el endpoint no tiene fields)', () => {
    expect(nextPageQuery(problemCommentsEndpoint('p-1'), firstWithEverything, 'k2')).toEqual({
      nextPageKey: 'k2'
    })
  })

  it('no modifica la query de la primera página', () => {
    const first = { fields: '+x', from: 'now-2h' }
    nextPageQuery(DT_ENDPOINTS.problems, first, 'k2')
    expect(first).toEqual({ fields: '+x', from: 'now-2h' })
  })
})
