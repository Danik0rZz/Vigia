import { describe, expect, it } from 'vitest'
import type { EntityData, EntityRelationship } from '@shared/modules'
import { buildHostInfo } from './host-info'

/**
 * Ficha 0020, CA1: la función pura que, con la salida de `entities:get` (0014) de un HOST, elige
 * y ordena las filas de la tarjeta «Información» (en sus grupos de filas) y los grupos de
 * relaciones.
 *
 * Lo que fijan estos tests (la ficha no lo daba; decisiones delegadas por Dani, refinables):
 *
 * - `buildHostInfo(data: EntityData): { sections, groups }`, en `host-info.ts`.
 * - `sections`: `{ key, rows }`, en este orden y solo las que tengan alguna fila:
 *   - `system` (Sistema): osType, osVersion, osArchitecture y bitness.
 *   - `capacity` (Capacidad): cpuCores, logicalCpuCores y memory.
 *   - `network` (Red): ipAddress y networkZone.
 *   - `monitoring` (Monitorización): monitoringMode, state, installerVersion (versión de
 *     OneAgent), firstSeen y lastSeen (visto por primera y última vez).
 *   - `grouping` (Agrupación): hostGroupName, managementZones y tags.
 *   - `cloud` (Nube o virtualización): cloudType e hypervisorType.
 * - Filas como en la 0015: `{ key, kind: 'text', text }`, `{ key, kind: 'chips', chips }`
 *   (ipAddress, partida por «, », que es como main pasa una lista a texto; managementZones y
 *   tags) y `{ key, kind: 'date', time }` (epoch ms). La memoria, `{ key: 'memory', kind:
 *   'bytes', bytes }`: physicalMemory y, si no hay, memoryTotal (en vivo, en bytes); la vista la
 *   pasa a GB. Solo filas con dato: texto vacío o en blanco, fecha null o memoria que no es un
 *   número positivo no dan fila.
 * - `groups`: `{ key, total, entities }` (como en la 0015, con `entities` = `{ id, type,
 *   relation, direction }`), en este orden y solo los que tengan alguna: `processes`
 *   (`isProcessOf` de toRelationships), `services` (`runsOnHost` de toRelationships),
 *   `runsOn` (`runsOn` de fromRelationships), `hostGroup` (`isInstanceOf` de
 *   fromRelationships) y `other` (el resto, de las dos direcciones; también el `runsOn` de
 *   toRelationships, que en vivo son process groups). Direcciones vistas en vivo en la 0020.
 */

const T_FIRST = Date.UTC(2026, 7, 20, 7, 15)
const T_LAST = Date.UTC(2026, 9, 3, 9, 30)

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
    displayName: 'host-prueba',
    type: 'HOST',
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

/** Propiedades de un host completo, en otro orden que el de la ficha y con otras claves. */
const FULL_PROPERTIES: { key: string; text: string }[] = [
  { key: 'detectedName', text: 'nombre-detectado' },
  { key: 'hypervisorType', text: 'KVM' },
  { key: 'state', text: 'RUNNING' },
  { key: 'memoryTotal', text: '15500000000' },
  { key: 'ipAddress', text: '192.0.2.10, 192.0.2.11, 2001:db8::1' },
  { key: 'osVersion', text: 'Ubuntu 24.04' },
  { key: 'macAddresses', text: '00-00-5E-00-53-01' },
  { key: 'cpuCores', text: '4' },
  { key: 'standalone', text: 'false' },
  { key: 'installerVersion', text: '1.300.12.20260901' },
  { key: 'cloudType', text: 'EC2' },
  { key: 'osType', text: 'LINUX' },
  { key: 'physicalMemory', text: '16000000000' },
  { key: 'networkZone', text: 'zona-red' },
  { key: 'hostGroupName', text: 'grupo-hosts' },
  { key: 'bitness', text: '64' },
  { key: 'logicalCpuCores', text: '8' },
  { key: 'monitoringMode', text: 'FULL_STACK' },
  { key: 'osArchitecture', text: 'X86' },
  { key: 'oneAgentCustomHostName', text: 'nombre-propio' },
  { key: 'additionalSystemInfo', text: 'info-adicional' }
]

const SECTIONS: [string, string[]][] = [
  ['system', ['osType', 'osVersion', 'osArchitecture', 'bitness']],
  ['capacity', ['cpuCores', 'logicalCpuCores', 'memory']],
  ['network', ['ipAddress', 'networkZone']],
  ['monitoring', ['monitoringMode', 'state', 'installerVersion', 'firstSeen', 'lastSeen']],
  ['grouping', ['hostGroupName', 'managementZones']],
  ['cloud', ['cloudType', 'hypervisorType']]
]

const PGIS = [id('PROCESS_GROUP_INSTANCE', 1), id('PROCESS_GROUP_INSTANCE', 2)]
const SERVICES = [id('SERVICE', 3), id('SERVICE', 4)]
const SERVICE_INSTANCE = id('SERVICE_INSTANCE', 5)
const EC2 = id('EC2_INSTANCE', 6)
const HOST_GROUP = id('HOST_GROUP', 7)
const PG = id('PROCESS_GROUP', 8)
const DISK = id('DISK', 9)
const PEER = id('HOST', 10)

/** Relaciones en un orden que no es el de los grupos (como puede venir de la API). */
const RELATIONSHIPS: EntityRelationship[] = [
  relation('to', 'isDiskOf', [{ id: DISK, type: 'DISK' }]),
  relation('from', 'isInstanceOf', [{ id: HOST_GROUP, type: 'HOST_GROUP' }]),
  relation('to', 'runsOn', [{ id: PG, type: 'PROCESS_GROUP' }], 12),
  relation('to', 'runsOnHost', [
    { id: SERVICES[0] ?? '', type: 'SERVICE' },
    { id: SERVICE_INSTANCE, type: 'SERVICE_INSTANCE' },
    { id: SERVICES[1] ?? '', type: 'SERVICE' }
  ]),
  relation('from', 'isNetworkClientOfHost', [{ id: PEER, type: 'HOST' }]),
  relation(
    'to',
    'isProcessOf',
    PGIS.map((pgi) => ({ id: pgi, type: 'PROCESS_GROUP_INSTANCE' })),
    60
  ),
  relation('from', 'runsOn', [{ id: EC2, type: 'EC2_INSTANCE' }])
]

const full = (): EntityData =>
  entity({
    firstSeen: T_FIRST,
    lastSeen: T_LAST,
    managementZones: ['Zona A', 'Zona B'],
    // Ficha 0037: etiquetas separadas (ya no dan fila).
    tags: [
      { context: 'CONTEXTLESS', key: 'equipo', value: 'sistemas' },
      { context: 'CONTEXTLESS', key: 'entorno', value: 'pre' }
    ],
    properties: FULL_PROPERTIES,
    relationships: RELATIONSHIPS
  })

describe('CA1 (0020): grupos de filas y de relaciones de un HOST a partir de entities:get', () => {
  it('con todas las claves, los grupos de filas y sus filas van en el orden de la ficha', () => {
    const { sections } = buildHostInfo(full())
    expect(sections.map((section) => [section.key, section.rows.map((row) => row.key)])).toEqual(
      SECTIONS
    )
  })

  it('cada fila lleva su dato: texto, chips, fecha o bytes', () => {
    const rows = new Map(
      buildHostInfo(full()).sections.flatMap((section) => section.rows.map((row) => [row.key, row]))
    )
    const text: [string, string][] = [
      ['osType', 'LINUX'],
      ['osVersion', 'Ubuntu 24.04'],
      ['osArchitecture', 'X86'],
      ['bitness', '64'],
      ['cpuCores', '4'],
      ['logicalCpuCores', '8'],
      ['networkZone', 'zona-red'],
      ['monitoringMode', 'FULL_STACK'],
      ['state', 'RUNNING'],
      ['installerVersion', '1.300.12.20260901'],
      ['hostGroupName', 'grupo-hosts'],
      ['cloudType', 'EC2'],
      ['hypervisorType', 'KVM']
    ]
    for (const [key, value] of text) {
      expect(rows.get(key), key).toEqual({ key, kind: 'text', text: value })
    }
    expect(rows.get('ipAddress')).toEqual({
      key: 'ipAddress',
      kind: 'chips',
      chips: ['192.0.2.10', '192.0.2.11', '2001:db8::1']
    })
    // physicalMemory antes que memoryTotal.
    expect(rows.get('memory')).toEqual({ key: 'memory', kind: 'bytes', bytes: 16_000_000_000 })
    expect(rows.get('firstSeen')).toEqual({ key: 'firstSeen', kind: 'date', time: T_FIRST })
    expect(rows.get('lastSeen')).toEqual({ key: 'lastSeen', kind: 'date', time: T_LAST })
    expect(rows.get('managementZones')).toEqual({
      key: 'managementZones',
      kind: 'chips',
      chips: ['Zona A', 'Zona B']
    })
    // Ficha 0037, CA4: las etiquetas ya no son una fila de la tarjeta.
    expect(rows.has('tags')).toBe(false)
  })

  it('las claves que no nombra la ficha no dan fila (van solo en «Todas las propiedades»)', () => {
    const text = JSON.stringify(buildHostInfo(full()).sections)
    for (const other of [
      'nombre-detectado',
      'nombre-propio',
      'info-adicional',
      '00-00-5E-00-53-01',
      'detectedName',
      'macAddresses',
      'standalone',
      'oneAgentCustomHostName',
      'additionalSystemInfo',
      'physicalMemory',
      'memoryTotal'
    ]) {
      expect(text, other).not.toContain(other)
    }
  })

  it('sin physicalMemory, la memoria sale de memoryTotal; sin ninguna con número, no hay fila', () => {
    const onlyTotal = buildHostInfo(
      entity({ properties: [{ key: 'memoryTotal', text: '8000000000' }] })
    )
    expect(onlyTotal.sections).toEqual([
      { key: 'capacity', rows: [{ key: 'memory', kind: 'bytes', bytes: 8_000_000_000 }] }
    ])
    const emptyPhysical = buildHostInfo(
      entity({
        properties: [
          { key: 'physicalMemory', text: '' },
          { key: 'memoryTotal', text: '4000000000' }
        ]
      })
    )
    expect(emptyPhysical.sections[0]?.rows).toEqual([
      { key: 'memory', kind: 'bytes', bytes: 4_000_000_000 }
    ])
    for (const bad of ['', 'n/a', '0', '-1']) {
      const none = buildHostInfo(
        entity({
          properties: [
            { key: 'physicalMemory', text: bad },
            { key: 'memoryTotal', text: bad }
          ]
        })
      )
      expect(none.sections, `memoria «${bad}»`).toEqual([])
    }
  })

  it('con pocas claves, solo los grupos y las filas con dato (sin vacíos ni fechas null)', () => {
    const { sections } = buildHostInfo(
      entity({
        lastSeen: T_LAST,
        properties: [
          { key: 'detectedName', text: 'solo-detectado' },
          { key: 'osVersion', text: '' },
          { key: 'osType', text: 'WINDOWS' },
          { key: 'networkZone', text: '   ' },
          { key: 'ipAddress', text: '' },
          { key: 'hostGroupName', text: '' }
        ]
      })
    )
    expect(sections).toEqual([
      { key: 'system', rows: [{ key: 'osType', kind: 'text', text: 'WINDOWS' }] },
      { key: 'monitoring', rows: [{ key: 'lastSeen', kind: 'date', time: T_LAST }] }
    ])
    expect(JSON.stringify(sections)).not.toMatch(/undefined|null|NaN/)
  })

  it('una sola IP da su fila de chips', () => {
    const { sections } = buildHostInfo(
      entity({ properties: [{ key: 'ipAddress', text: '198.51.100.7' }] })
    )
    expect(sections).toEqual([
      { key: 'network', rows: [{ key: 'ipAddress', kind: 'chips', chips: ['198.51.100.7'] }] }
    ])
  })

  it('sin propiedades, fechas, zonas ni etiquetas, ningún grupo de filas', () => {
    expect(buildHostInfo(entity()).sections).toEqual([])
  })

  it('los grupos de relaciones van en su orden (Procesos, Servicios, Se ejecuta en, Grupo de hosts, Otras), con su total', () => {
    const { groups } = buildHostInfo(full())
    expect(groups.map((group) => group.key)).toEqual([
      'processes',
      'services',
      'runsOn',
      'hostGroup',
      'other'
    ])
    // Procesos: 2 ids de 60; otras: isDiskOf (1), runsOn de to (12) e isNetworkClientOfHost (1).
    expect(groups.map((group) => group.total)).toEqual([60, 3, 1, 1, 14])
  })

  it('cada grupo lleva sus entidades, con la relación y la dirección tal cual', () => {
    const groups = new Map(buildHostInfo(full()).groups.map((group) => [group.key, group]))
    expect(groups.get('processes')?.entities).toEqual(
      PGIS.map((pgi) => ({
        id: pgi,
        type: 'PROCESS_GROUP_INSTANCE',
        relation: 'isProcessOf',
        direction: 'to'
      }))
    )
    expect(groups.get('services')?.entities).toEqual([
      { id: SERVICES[0], type: 'SERVICE', relation: 'runsOnHost', direction: 'to' },
      { id: SERVICE_INSTANCE, type: 'SERVICE_INSTANCE', relation: 'runsOnHost', direction: 'to' },
      { id: SERVICES[1], type: 'SERVICE', relation: 'runsOnHost', direction: 'to' }
    ])
    expect(groups.get('runsOn')?.entities).toEqual([
      { id: EC2, type: 'EC2_INSTANCE', relation: 'runsOn', direction: 'from' }
    ])
    expect(groups.get('hostGroup')?.entities).toEqual([
      { id: HOST_GROUP, type: 'HOST_GROUP', relation: 'isInstanceOf', direction: 'from' }
    ])
  })

  it('«Otras relaciones»: el resto de las dos direcciones, también el runsOn de toRelationships', () => {
    const other = buildHostInfo(full()).groups.find((group) => group.key === 'other')
    const items = (other?.entities ?? []).map((e) => `${e.direction} ${e.relation} ${e.id}`)
    expect([...items].sort()).toEqual(
      [`to isDiskOf ${DISK}`, `to runsOn ${PG}`, `from isNetworkClientOfHost ${PEER}`].sort()
    )
  })

  it('solo salen los grupos que tienen relaciones; sin ninguna, ningún grupo', () => {
    expect(buildHostInfo(entity()).groups).toEqual([])
    const onlyGroup = buildHostInfo(
      entity({
        relationships: [relation('from', 'isInstanceOf', [{ id: HOST_GROUP, type: 'HOST_GROUP' }])]
      })
    )
    expect(onlyGroup.groups.map((group) => group.key)).toEqual(['hostGroup'])
    const onlyIncomingRunsOn = buildHostInfo(
      entity({ relationships: [relation('to', 'runsOn', [{ id: PG, type: 'PROCESS_GROUP' }])] })
    )
    expect(onlyIncomingRunsOn.groups.map((group) => group.key)).toEqual(['other'])
  })
})
