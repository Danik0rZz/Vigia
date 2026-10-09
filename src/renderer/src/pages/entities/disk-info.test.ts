import { describe, expect, it } from 'vitest'
import type { EntityData } from '@shared/modules'
import { buildDiskInfo } from './disk-info'

/**
 * Ficha 0040 (developer): filas de la tarjeta «Información» del disco con las claves vistas en
 * vivo (paso 0): `detectedName`, `filesystemType`, las fechas y `isDiskOf` (el host).
 */

const HOST = { id: 'HOST-0000000000000001', type: 'HOST' }

function entity(overrides: Partial<EntityData> = {}): EntityData {
  return {
    displayName: '/datos',
    type: 'DISK',
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

describe('buildDiskInfo (0040)', () => {
  it('filas en su orden, con el host en «Disco de» y sin grupos de relaciones', () => {
    const info = buildDiskInfo(
      entity({
        firstSeen: 1,
        lastSeen: 2,
        managementZones: ['zona', ' '],
        properties: [
          { key: 'filesystemType', text: 'ext4' },
          { key: 'detectedName', text: '/datos' },
          { key: 'detectedName', text: 'otro' }
        ],
        relationships: [{ direction: 'from', name: 'isDiskOf', entities: [HOST], total: 1 }]
      })
    )
    expect(info.rows).toEqual([
      { key: 'detectedName', kind: 'text', text: '/datos' },
      { key: 'filesystemType', kind: 'text', text: 'ext4' },
      { key: 'diskOf', kind: 'hosts', hosts: [HOST] },
      { key: 'firstSeen', kind: 'date', time: 1 },
      { key: 'lastSeen', kind: 'date', time: 2 },
      { key: 'managementZones', kind: 'chips', chips: ['zona'] }
    ])
    expect(info.groups).toEqual([])
  })

  it('sin datos no hay filas; otras relaciones van a «other»', () => {
    const other = { id: 'PROCESS_GROUP-0000000000000002', type: 'PROCESS_GROUP' }
    const info = buildDiskInfo(
      entity({
        properties: [{ key: 'filesystemType', text: '  ' }],
        relationships: [
          { direction: 'to', name: 'isDiskOf', entities: [other], total: 1 },
          { direction: 'from', name: 'otra', entities: [], total: 3 }
        ]
      })
    )
    expect(info.rows).toEqual([])
    expect(info.groups).toEqual([
      {
        key: 'other',
        total: 4,
        entities: [{ id: other.id, type: other.type, relation: 'isDiskOf', direction: 'to' }]
      }
    ])
  })
})
