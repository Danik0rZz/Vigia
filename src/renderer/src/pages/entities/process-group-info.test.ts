import { describe, expect, it } from 'vitest'
import type { EntityData, EntityRelationship } from '@shared/modules'
import { buildProcessGroupInfo } from './process-group-info'

/**
 * Ficha 0032: filas y grupos de relaciones de la tarjeta «Información» del process group, con
 * las claves y relaciones vistas en vivo en PROCESS_GROUP.
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
    displayName: 'grupo-prueba',
    type: 'PROCESS_GROUP',
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

describe('buildProcessGroupInfo (0032)', () => {
  it('filas del grupo: tecnologías, puertos, nombre detectado y ejecutable (sin la ruta)', () => {
    const { rows } = buildProcessGroupInfo(
      entity({
        properties: [
          { key: 'metadata', text: 'EXE_NAME pagos-grupo, OTRA cosa' },
          { key: 'listenPorts', text: '9090, 9443' },
          { key: 'detectedName', text: 'pagos-detectado' },
          { key: 'softwareTechnologies', text: 'JAVA OpenJDK 21.0.1, APACHE_TOMCAT 10.1' }
        ]
      })
    )
    expect(rows).toEqual([
      { key: 'technologies', kind: 'chips', chips: ['JAVA OpenJDK 21.0.1', 'APACHE_TOMCAT 10.1'] },
      { key: 'listenPorts', kind: 'text', text: '9090, 9443' },
      { key: 'detectedName', kind: 'text', text: 'pagos-detectado' },
      { key: 'executable', kind: 'text', text: 'pagos-grupo' }
    ])
  })

  it('relaciones: instancias (to isInstanceOf), hosts (from runsOn), servicios (to runsOn) y otras', () => {
    const instances = [1, 2].map((n) => ({
      id: id('PROCESS_GROUP_INSTANCE', n),
      type: 'PROCESS_GROUP_INSTANCE'
    }))
    const { groups } = buildProcessGroupInfo(
      entity({
        relationships: [
          relation('from', 'isNetworkClientOfProcessGroup', [
            { id: id('PROCESS_GROUP', 9), type: 'PROCESS_GROUP' }
          ]),
          relation('to', 'runsOn', [{ id: id('SERVICE', 3), type: 'SERVICE' }]),
          relation('from', 'runsOn', [{ id: id('HOST', 4), type: 'HOST' }], 3),
          relation('to', 'isInstanceOf', instances)
        ]
      })
    )
    expect(groups.map((group) => [group.key, group.total])).toEqual([
      ['instances', 2],
      ['hosts', 3],
      ['services', 1],
      ['other', 1]
    ])
    expect(groups[3]?.entities[0]?.relation).toBe('isNetworkClientOfProcessGroup')
  })

  it('sin relaciones, sin grupos; sin propiedades, sin filas', () => {
    expect(buildProcessGroupInfo(entity())).toEqual({ rows: [], groups: [] })
  })
})
