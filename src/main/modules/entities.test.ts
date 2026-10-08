import { describe, expect, it } from 'vitest'
import { entityIdSelector, propertyText, toEntityData, toEntityNames } from './entities'

/** Casos límite del módulo de la ficha 0014 (los criterios están en entity-detail.test). */

describe('propertyText', () => {
  it('null y undefined dan texto vacío; números y booleanos con String', () => {
    expect(propertyText(null)).toBe('')
    expect(propertyText(undefined)).toBe('')
    expect(propertyText(0)).toBe('0')
    expect(propertyText(true)).toBe('true')
  })

  it('listas con comas y objetos con espacios, sin vacíos', () => {
    expect(propertyText(['a', null, 'b'])).toBe('a, b')
    expect(propertyText([{ type: 'JAVA', version: '17' }, { type: 'GO' }])).toBe('JAVA 17, GO')
  })

  it('lo que está demasiado anidado se omite', () => {
    expect(propertyText([[[[['hondo']]]], 'arriba'])).toBe('arriba')
  })
})

describe('toEntityData', () => {
  it('sin nombre ni tipo usa el id pedido; partes mal formadas se ignoran', () => {
    const data = toEntityData(
      {
        icon: 'java',
        managementZones: [{ id: '1' }, 'x', { name: '' }],
        tags: [{}, { key: 'k' }],
        properties: ['no es un objeto'],
        fromRelationships: { calls: 'x', runsOn: [{ id: 'HOST-1' }], empty: [] },
        toRelationships: null
      },
      'HOST-0123456789ABCDEF'
    )
    expect(data).toEqual({
      displayName: 'HOST-0123456789ABCDEF',
      type: 'HOST',
      firstSeen: null,
      lastSeen: null,
      iconType: null,
      managementZones: [],
      // Ficha 0037: sin contexto, CONTEXTLESS; sin valor, null.
      tags: [{ context: 'CONTEXTLESS', key: 'k', value: null }],
      properties: [],
      relationships: []
    })
  })
})

describe('entityIdSelector', () => {
  it('rechaza un id que no tiene el formato estricto', () => {
    expect(() => entityIdSelector(['HOST-0123456789ABCDEF', 'HOST-1"),x("'])).toThrow()
  })
})

describe('toEntityNames', () => {
  it('ignora lo que no se pidió, lo mal formado y los repetidos', () => {
    const result = toEntityNames(
      {
        entities: [
          { entityId: 'HOST-0000000000000001', displayName: 'a' },
          { entityId: 'HOST-0000000000000001', displayName: 'otra' },
          { entityId: 'HOST-0000000000000009', displayName: 'no pedida' },
          { entityId: 'HOST-0000000000000002' },
          null
        ]
      },
      ['HOST-0000000000000001', 'HOST-0000000000000002']
    )
    expect(result).toEqual({
      names: [{ id: 'HOST-0000000000000001', name: 'a' }],
      missing: ['HOST-0000000000000002']
    })
    expect(toEntityNames({}, ['HOST-0000000000000003']).missing).toEqual(['HOST-0000000000000003'])
  })
})
