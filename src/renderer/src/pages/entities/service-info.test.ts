import { describe, expect, it } from 'vitest'
import type { EntityData, EntityRelationship } from '@shared/modules'
import { buildServiceInfo } from './service-info'

/**
 * Ficha 0015, CA8: la función pura que, con la salida de `entities:get` (0014), elige y ordena
 * las filas de la columna «Servicio» y los grupos de la columna «Relaciones».
 *
 * Lo que fijan estos tests (la ficha no lo daba; decisiones delegadas por Dani, refinables):
 *
 * - `buildServiceInfo(data: EntityData): { rows, groups }`, en `service-info.ts`.
 * - Cada fila lleva `key`: serviceType, technologies, webServerName, webService (nombre y
 *   namespace en una fila), contextRoot, port, isExternalService, remoteEndpoint, databaseVendor,
 *   databaseName, applicationName, applicationEnvironment, applicationReleaseVersion,
 *   publicCloudId, publicCloudRegion, firstSeen, lastSeen, managementZones y tags, en ese orden,
 *   y solo si tienen dato (una propiedad con texto vacío no es dato).
 * - Filas de texto: `{ kind: 'text', text }`; de chips (technologies, managementZones, tags):
 *   `{ kind: 'chips', chips }`; de fecha (firstSeen, lastSeen): `{ kind: 'date', time }` en epoch
 *   ms. Las tecnologías salen de partir por «, » el texto de `serviceTechnologyTypes` y luego el
 *   de `softwareTechnologies` (el formato de texto que da main en la 0014).
 * - isExternalService solo sale si es "true" (la fila dice «Externo»); con "false", nada.
 * - Cada grupo: `{ key, total, entities }`, con key runsOn («Se ejecuta en»), calls («Llama a»),
 *   calledBy («Lo llaman») y other («Otras relaciones»), en ese orden y solo los que tengan
 *   alguna. `total` suma los `total` de sus relaciones; `entities` son `{ id, type, relation,
 *   direction }` (relation, el nombre tal cual de Dynatrace). En runsOn van primero los hosts,
 *   luego los procesos y luego el process group, sea cual sea el orden de la respuesta.
 */

const T_FIRST = Date.UTC(2026, 8, 1, 8, 0)
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
    displayName: 'servicio-prueba',
    type: 'SERVICE',
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

/** Propiedades de un servicio completo, en otro orden que el de la ficha y con internas. */
const FULL_PROPERTIES: { key: string; text: string }[] = [
  { key: 'dt.security_context', text: 'contexto-interno' },
  { key: 'publicCloudRegion', text: 'region-prueba' },
  { key: 'port', text: '443' },
  { key: 'databaseName', text: 'base-prueba' },
  { key: 'agentTechnologyType', text: 'JAVA' },
  { key: 'serviceType', text: 'WEB_REQUEST_SERVICE' },
  { key: 'softwareTechnologies', text: 'JAVA OpenJDK 17.0.2, APACHE_TOMCAT 10.1' },
  { key: 'applicationReleaseVersion', text: '1.2.3' },
  { key: 'serviceTechnologyTypes', text: 'Java, Apache Tomcat' },
  { key: 'contextRoot', text: '/pagos' },
  { key: 'webServerName', text: 'servidor-web' },
  { key: 'webServiceNamespace', text: 'urn:prueba' },
  { key: 'webServiceName', text: 'ServicioPrueba' },
  { key: 'isExternalService', text: 'true' },
  { key: 'remoteEndpoint', text: 'remoto.invalid' },
  { key: 'detectedName', text: 'nombre-detectado' },
  { key: 'databaseVendor', text: 'POSTGRESQL' },
  { key: 'applicationName', text: 'app-prueba' },
  { key: 'applicationEnvironment', text: 'pre' },
  { key: 'publicCloudId', text: 'nube-prueba' },
  { key: 'ipAddress', text: '192.0.2.10' },
  { key: 'matchedServiceDetectionV2Rules', text: 'regla-interna' }
]

const ROW_ORDER = [
  'serviceType',
  'technologies',
  'webServerName',
  'webService',
  'contextRoot',
  'port',
  'isExternalService',
  'remoteEndpoint',
  'databaseVendor',
  'databaseName',
  'applicationName',
  'applicationEnvironment',
  'applicationReleaseVersion',
  'publicCloudId',
  'publicCloudRegion',
  'firstSeen',
  'lastSeen',
  'managementZones'
]

const HOSTS = [id('HOST', 1), id('HOST', 2)]
const PGI = id('PROCESS_GROUP_INSTANCE', 3)
const PG = id('PROCESS_GROUP', 4)
const CALLS = Array.from({ length: 50 }, (_, i) => ({
  id: id('SERVICE', 0x100 + i),
  type: 'SERVICE'
}))
const CALLERS = [
  { id: id('SERVICE', 5), type: 'SERVICE' },
  { id: id('APPLICATION', 6), type: 'APPLICATION' }
]
const METHOD = id('SERVICE_METHOD', 7)
const QUEUE = id('QUEUE', 8)

/** Relaciones en un orden que no es el de los grupos (como puede venir de la API). */
const RELATIONSHIPS: EntityRelationship[] = [
  relation('to', 'isServiceMethodOfService', [{ id: METHOD, type: 'SERVICE_METHOD' }]),
  relation('from', 'calls', CALLS, 55),
  relation('from', 'isServiceOfProcessGroup', [{ id: PG, type: 'PROCESS_GROUP' }]),
  relation('to', 'calls', CALLERS),
  relation('from', 'runsOn', [{ id: PG, type: 'PROCESS_GROUP' }]),
  relation('from', 'runsOnProcessGroupInstance', [{ id: PGI, type: 'PROCESS_GROUP_INSTANCE' }]),
  relation(
    'from',
    'runsOnHost',
    HOSTS.map((host) => ({ id: host, type: 'HOST' }))
  ),
  relation('from', 'indirectlySendsToQueue', [{ id: QUEUE, type: 'QUEUE' }])
]

const full = (): EntityData =>
  entity({
    firstSeen: T_FIRST,
    lastSeen: T_LAST,
    managementZones: ['Zona A', 'Zona B'],
    // Ficha 0037: etiquetas separadas (ya no dan fila).
    tags: [
      { context: 'CONTEXTLESS', key: 'equipo', value: 'pagos' },
      { context: 'CONTEXTLESS', key: 'capa', value: 'backend' }
    ],
    properties: FULL_PROPERTIES,
    relationships: RELATIONSHIPS
  })

describe('CA8 (0015): filas de «Servicio» y grupos de relaciones a partir de entities:get', () => {
  it('con todas las propiedades, las filas van en el orden de la ficha (no en el de la respuesta)', () => {
    const { rows } = buildServiceInfo(full())
    expect(rows.map((row) => row.key)).toEqual(ROW_ORDER)
  })

  it('cada fila lleva su dato: texto, chips o fecha', () => {
    const rows = new Map(buildServiceInfo(full()).rows.map((row) => [row.key, row]))
    expect(rows.get('serviceType')).toMatchObject({ kind: 'text', text: 'WEB_REQUEST_SERVICE' })
    expect(rows.get('technologies')).toEqual({
      key: 'technologies',
      kind: 'chips',
      chips: ['Java', 'Apache Tomcat', 'JAVA OpenJDK 17.0.2', 'APACHE_TOMCAT 10.1']
    })
    expect(rows.get('webServerName')).toMatchObject({ kind: 'text', text: 'servidor-web' })
    const webService = rows.get('webService')
    expect(webService).toMatchObject({ kind: 'text' })
    expect(JSON.stringify(webService)).toContain('ServicioPrueba')
    expect(JSON.stringify(webService)).toContain('urn:prueba')
    expect(rows.get('contextRoot')).toMatchObject({ kind: 'text', text: '/pagos' })
    expect(rows.get('port')).toMatchObject({ kind: 'text', text: '443' })
    expect(rows.get('remoteEndpoint')).toMatchObject({ kind: 'text', text: 'remoto.invalid' })
    expect(rows.get('databaseVendor')).toMatchObject({ kind: 'text', text: 'POSTGRESQL' })
    expect(rows.get('databaseName')).toMatchObject({ kind: 'text', text: 'base-prueba' })
    expect(rows.get('applicationName')).toMatchObject({ kind: 'text', text: 'app-prueba' })
    expect(rows.get('applicationEnvironment')).toMatchObject({ kind: 'text', text: 'pre' })
    expect(rows.get('applicationReleaseVersion')).toMatchObject({ kind: 'text', text: '1.2.3' })
    expect(rows.get('publicCloudId')).toMatchObject({ kind: 'text', text: 'nube-prueba' })
    expect(rows.get('publicCloudRegion')).toMatchObject({ kind: 'text', text: 'region-prueba' })
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

  it('las claves internas y las que no están en la ficha no dan fila', () => {
    const { rows } = buildServiceInfo(full())
    const text = JSON.stringify(rows)
    for (const internal of [
      'contexto-interno',
      'nombre-detectado',
      'regla-interna',
      '192.0.2.10',
      'agentTechnologyType',
      'dt.security_context',
      'ipAddress'
    ]) {
      expect(text, internal).not.toContain(internal)
    }
  })

  it('con pocas propiedades, solo las filas con dato (sin texto vacío, sin false, sin fechas null)', () => {
    const { rows } = buildServiceInfo(
      entity({
        lastSeen: T_LAST,
        properties: [
          { key: 'detectedName', text: 'solo-detectado' },
          { key: 'webServerName', text: '' },
          { key: 'isExternalService', text: 'false' },
          { key: 'serviceType', text: 'DATABASE_SERVICE' },
          { key: 'contextRoot', text: '   ' }
        ]
      })
    )
    expect(rows.map((row) => row.key)).toEqual(['serviceType', 'lastSeen'])
    expect(JSON.stringify(rows)).not.toMatch(/undefined|null/)
  })

  it('una sola tecnología, o solo el namespace del servicio web, también dan su fila', () => {
    const { rows } = buildServiceInfo(
      entity({
        properties: [
          { key: 'webServiceNamespace', text: 'urn:solo' },
          { key: 'softwareTechnologies', text: 'NODE_JS 20.1' }
        ]
      })
    )
    expect(rows.map((row) => row.key)).toEqual(['technologies', 'webService'])
    expect(rows[0]).toEqual({ key: 'technologies', kind: 'chips', chips: ['NODE_JS 20.1'] })
    expect(rows[1]).toMatchObject({ kind: 'text' })
    expect(JSON.stringify(rows[1])).toContain('urn:solo')
  })

  it('los grupos van en su orden (Se ejecuta en, Llama a, Lo llaman, Otras), con su total', () => {
    const { groups } = buildServiceInfo(full())
    expect(groups.map((group) => group.key)).toEqual(['runsOn', 'calls', 'calledBy', 'other'])
    expect(groups.map((group) => group.total)).toEqual([4, 55, 2, 3])
  })

  it('«Se ejecuta en»: hosts, procesos y process group, en ese orden', () => {
    const runsOn = buildServiceInfo(full()).groups.find((group) => group.key === 'runsOn')
    expect(runsOn?.entities).toEqual([
      { id: HOSTS[0], type: 'HOST', relation: 'runsOnHost', direction: 'from' },
      { id: HOSTS[1], type: 'HOST', relation: 'runsOnHost', direction: 'from' },
      {
        id: PGI,
        type: 'PROCESS_GROUP_INSTANCE',
        relation: 'runsOnProcessGroupInstance',
        direction: 'from'
      },
      { id: PG, type: 'PROCESS_GROUP', relation: 'isServiceOfProcessGroup', direction: 'from' }
    ])
  })

  it('«Llama a» es calls de from (50 ids de 55) y «Lo llaman», calls de to, con tipos mezclados', () => {
    const { groups } = buildServiceInfo(full())
    const calls = groups.find((group) => group.key === 'calls')
    expect(calls?.total).toBe(55)
    expect(calls?.entities.map((e) => e.id)).toEqual(CALLS.map((c) => c.id))
    expect(calls?.entities.every((e) => e.direction === 'from' && e.relation === 'calls')).toBe(
      true
    )
    const calledBy = groups.find((group) => group.key === 'calledBy')
    expect(calledBy?.entities).toEqual(
      CALLERS.map((caller) => ({ ...caller, relation: 'calls', direction: 'to' }))
    )
  })

  it('«Otras relaciones»: el resto, de las dos direcciones, con el nombre tal cual', () => {
    const other = buildServiceInfo(full()).groups.find((group) => group.key === 'other')
    const items = (other?.entities ?? []).map((e) => `${e.direction} ${e.relation} ${e.id}`)
    expect([...items].sort()).toEqual(
      [
        `to isServiceMethodOfService ${METHOD}`,
        `from runsOn ${PG}`,
        `from indirectlySendsToQueue ${QUEUE}`
      ].sort()
    )
  })

  it('solo salen los grupos que tienen relaciones; sin ninguna, ningún grupo', () => {
    expect(buildServiceInfo(entity()).groups).toEqual([])
    const onlyCallers = buildServiceInfo(
      entity({ relationships: [relation('to', 'calls', CALLERS)] })
    )
    expect(onlyCallers.groups.map((group) => group.key)).toEqual(['calledBy'])
    const onlyOther = buildServiceInfo(
      entity({
        relationships: [relation('from', 'isServiceOf', [{ id: PG, type: 'PROCESS_GROUP' }])]
      })
    )
    expect(onlyOther.groups.map((group) => group.key)).toEqual(['other'])
  })
})
