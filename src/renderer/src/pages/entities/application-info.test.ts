import { describe, expect, it } from 'vitest'
import type { EntityData, EntityRelationship } from '@shared/modules'
import { buildApplicationInfo } from './application-info'

/**
 * Ficha 0034: filas y grupos de relaciones de la tarjeta «Información» de la aplicación, con las
 * claves y relaciones vistas en vivo en APPLICATION (ficha 0033).
 */
const id = (type: string, n: number): string =>
  `${type}-${n.toString(16).toUpperCase().padStart(16, '0')}`

function relation(
  direction: 'from' | 'to',
  name: string,
  entities: { id: string; type: string }[],
  total = entities.length
): EntityRelationship {
  return { direction, name, entities, total }
}

function entity(overrides: Partial<EntityData> = {}): EntityData {
  return {
    displayName: 'aplicacion-prueba',
    type: 'APPLICATION',
    firstSeen: null,
    lastSeen: null,
    iconType: null,
    managementZones: [],
    tags: [],
    properties: [],
    relationships: [],
    ...overrides
  }
}

describe('buildApplicationInfo (0034)', () => {
  it('filas: tipo, inyección, nombres, fechas y zonas, en ese orden; sin las demás claves', () => {
    const { rows } = buildApplicationInfo(
      entity({
        firstSeen: 10,
        lastSeen: 20,
        managementZones: ['Zona A', ' '],
        properties: [
          { key: 'detectedName', text: 'detectada' },
          { key: 'applicationLikeDeleted', text: 'false' },
          { key: 'customizedName', text: ' ' },
          { key: 'customizedName', text: 'personalizada' },
          { key: 'applicationInjectionType', text: 'AUTO_INJECTED' },
          { key: 'applicationType', text: 'MANUALLY_INJECTED' }
        ]
      })
    )
    expect(rows).toEqual([
      { key: 'applicationType', kind: 'text', text: 'MANUALLY_INJECTED' },
      { key: 'applicationInjectionType', kind: 'text', text: 'AUTO_INJECTED' },
      { key: 'customizedName', kind: 'text', text: 'personalizada' },
      { key: 'detectedName', kind: 'text', text: 'detectada' },
      { key: 'firstSeen', kind: 'date', time: 10 },
      { key: 'lastSeen', kind: 'date', time: 20 },
      { key: 'managementZones', kind: 'chips', chips: ['Zona A'] }
    ])
  })

  it('relaciones: «Llama a» (from calls), sintéticos (to monitors y from isApplicationOfSyntheticTest) y otras', () => {
    const { groups } = buildApplicationInfo(
      entity({
        relationships: [
          relation('to', 'isApplicationMethodOf', [
            { id: id('APPLICATION_METHOD', 1), type: 'APPLICATION_METHOD' }
          ]),
          relation('to', 'monitors', [{ id: id('SYNTHETIC_TEST', 2), type: 'SYNTHETIC_TEST' }]),
          relation('from', 'isApplicationOfSyntheticTest', [
            { id: id('HTTP_CHECK', 3), type: 'HTTP_CHECK' }
          ]),
          relation('from', 'calls', [{ id: id('SERVICE', 4), type: 'SERVICE' }], 5),
          // La contraria no es «Llama a».
          relation('to', 'calls', [{ id: id('SERVICE', 6), type: 'SERVICE' }])
        ]
      })
    )
    expect(groups.map((group) => [group.key, group.total])).toEqual([
      ['calls', 5],
      ['synthetic', 2],
      ['other', 2]
    ])
    expect(groups[2]?.entities.map((item) => item.relation)).toEqual([
      'isApplicationMethodOf',
      'calls'
    ])
  })

  it('sin relaciones ni propiedades, sin grupos ni filas', () => {
    expect(buildApplicationInfo(entity())).toEqual({ rows: [], groups: [] })
  })
})
