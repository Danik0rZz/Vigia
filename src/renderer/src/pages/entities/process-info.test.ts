import { describe, expect, it } from 'vitest'
import type { EntityData, EntityRelationship } from '@shared/modules'
import { buildProcessInfo } from './process-info'

/**
 * Ficha 0029, CA2: la función pura que, con la salida de `entities:get` (0014) de un proceso
 * (PROCESS_GROUP_INSTANCE), elige las filas de la tarjeta «Información» y agrupa las relaciones.
 * Claves y relaciones: las que la 0027 vio en vivo (docs/notas-api-v2.md). La línea de comandos y
 * la ruta completa ya las quita main (CA1); aquí la entrada es lo que llega a la interfaz.
 *
 * Lo que fijan estos tests (decisiones del test-writer, delegadas por Dani y refinables):
 *
 * - `buildProcessInfo(data: EntityData): { rows, groups }`, en `process-info.ts`. Filas planas,
 *   como el servicio y el monitor (son pocas), solo las que tengan dato, en este orden:
 *   - `technologies` (`softwareTechnologies`, partida por «, » como en la 0015),
 *     `{ kind: 'chips', chips }`.
 *   - `listenPorts` (`listenPorts`), `{ kind: 'text', text }`, tal cual («8080, 8443»).
 *   - `detectedName` (`detectedName`), `{ kind: 'text', text }`.
 *   - `executable`, `{ kind: 'text', text }`: el valor de `EXE_NAME` dentro del texto de
 *     `metadata` (main lo da como «CLAVE valor, CLAVE valor», con `propertyText` de la 0014) y,
 *     si trae una ruta, solo el nombre del fichero.
 *   - `firstSeen` y `lastSeen`, `{ kind: 'date', time }`; `managementZones` y `tags`,
 *     `{ kind: 'chips', chips }`.
 *   `metadata` nunca es una fila (solo en «Todas las propiedades»).
 * - `groups`: `{ key, total, entities }` como en la 0015, en este orden y solo los que tengan
 *   alguna: `runsOn` («Se ejecuta en»: `isProcessOf` de fromRelationships, el host),
 *   `processGroup` («Process group»: `isInstanceOf` de fromRelationships), `services`
 *   («Servicios»: `runsOnProcessGroupInstance` de toRelationships, la contraria de la que usa el
 *   servicio en la 0015) y `other` (el resto, de las dos direcciones, también esas en la
 *   dirección contraria).
 */

const T_FIRST = Date.UTC(2026, 6, 1, 8, 0)
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
    displayName: 'proceso-prueba',
    type: 'PROCESS_GROUP_INSTANCE',
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

const HOST = id('HOST', 1)
const PROCESS_GROUP = id('PROCESS_GROUP', 2)
const SERVICES = [3, 4].map((n) => id('SERVICE', n))
const CGI = id('CONTAINER_GROUP_INSTANCE', 5)
const HOST_GROUP = id('HOST_GROUP', 6)

/** Propiedades de un proceso (claves de la 0027), en otro orden que el de las filas. */
const PROPERTIES: { key: string; text: string }[] = [
  { key: 'awsNameTag', text: 'etiqueta-aws-prueba' },
  {
    key: 'metadata',
    text: 'OSAGENT_GROUPID_NAME grupo-agente, EXE_NAME pagos-worker, KUBERNETES_NAMESPACE espacio-pagos'
  },
  { key: 'detectedName', text: 'pagos-worker-detectado' },
  { key: 'hasPublicTraffic', text: 'false' },
  { key: 'listenPorts', text: '8080, 8443' },
  { key: 'bitness', text: '64' },
  { key: 'softwareTechnologies', text: 'JAVA OpenJDK 17.0.2, APACHE_TOMCAT 10.1' },
  { key: 'processType', text: 'JAVA' }
]

const ROW_ORDER = [
  'technologies',
  'listenPorts',
  'detectedName',
  'executable',
  'firstSeen',
  'lastSeen',
  'managementZones'
]

const full = (): EntityData =>
  entity({
    firstSeen: T_FIRST,
    lastSeen: T_LAST,
    managementZones: ['Zona A', 'Zona B'],
    // Ficha 0037: etiquetas separadas (ya no dan fila).
    tags: [
      { context: 'CONTEXTLESS', key: 'equipo', value: 'pagos' },
      { context: 'CONTEXTLESS', key: 'entorno', value: 'pro' }
    ],
    properties: PROPERTIES,
    // En otro orden que el de los grupos; 7 servicios según la API, 2 listados.
    relationships: [
      relation(
        'to',
        'runsOnProcessGroupInstance',
        SERVICES.map((service) => ({ id: service, type: 'SERVICE' })),
        7
      ),
      relation('from', 'isPgiOfCgi', [{ id: CGI, type: 'CONTAINER_GROUP_INSTANCE' }]),
      relation('from', 'isInstanceOf', [{ id: PROCESS_GROUP, type: 'PROCESS_GROUP' }]),
      relation('to', 'isHostGroupOf', [{ id: HOST_GROUP, type: 'HOST_GROUP' }]),
      relation('from', 'isProcessOf', [{ id: HOST, type: 'HOST' }])
    ]
  })

const rowMap = (data: EntityData): Map<string, unknown> =>
  new Map<string, unknown>(buildProcessInfo(data).rows.map((row) => [row.key, row]))

const executableOf = (metadata: string): unknown =>
  rowMap(entity({ properties: [{ key: 'metadata', text: metadata }] })).get('executable')

describe('CA2 (0029): filas y grupos de relaciones de un PROCESS_GROUP_INSTANCE a partir de entities:get', () => {
  it('con todas las claves: las filas salen en su orden, sin repetirse', () => {
    expect(buildProcessInfo(full()).rows.map((row) => row.key)).toEqual(ROW_ORDER)
  })

  it('cada fila lleva su dato: tecnologías en chips, puertos, nombre detectado, ejecutable, fechas, zonas y etiquetas', () => {
    const rows = rowMap(full())
    expect(rows.get('technologies')).toEqual({
      key: 'technologies',
      kind: 'chips',
      chips: ['JAVA OpenJDK 17.0.2', 'APACHE_TOMCAT 10.1']
    })
    expect(rows.get('listenPorts')).toEqual({
      key: 'listenPorts',
      kind: 'text',
      text: '8080, 8443'
    })
    expect(rows.get('detectedName')).toEqual({
      key: 'detectedName',
      kind: 'text',
      text: 'pagos-worker-detectado'
    })
    expect(rows.get('executable')).toEqual({
      key: 'executable',
      kind: 'text',
      text: 'pagos-worker'
    })
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

  it('metadata nunca es una fila: de ella solo sale el nombre del ejecutable', () => {
    const rows = buildProcessInfo(full()).rows
    expect(rows.map((row) => row.key)).not.toContain('metadata')
    const text = JSON.stringify(rows)
    for (const other of ['OSAGENT', 'grupo-agente', 'KUBERNETES', 'espacio-pagos', 'EXE_NAME']) {
      expect(text, other).not.toContain(other)
    }
  })

  it('el ejecutable es solo el nombre del fichero, aunque EXE_NAME traiga una ruta', () => {
    expect(executableOf('EXE_NAME pagos-worker')).toEqual({
      key: 'executable',
      kind: 'text',
      text: 'pagos-worker'
    })
    expect(executableOf('EXE_NAME /opt/apps/bin/java, KUBERNETES_NAMESPACE ns')).toEqual({
      key: 'executable',
      kind: 'text',
      text: 'java'
    })
    expect(
      executableOf('OSAGENT_GROUPID_NAME g, EXE_NAME C:\\Program Files\\App\\app.exe')
    ).toEqual({ key: 'executable', kind: 'text', text: 'app.exe' })
  })

  it('sin EXE_NAME en metadata (o vacío), no hay fila del ejecutable', () => {
    for (const metadata of ['', 'KUBERNETES_NAMESPACE ns, OSAGENT_GROUPID_NAME g', 'EXE_NAME ']) {
      expect(executableOf(metadata), `«${metadata}»`).toBeUndefined()
    }
  })

  it('con pocas claves, solo las filas con dato (sin vacíos, fechas null ni «undefined»)', () => {
    const { rows } = buildProcessInfo(
      entity({
        lastSeen: T_LAST,
        properties: [
          { key: 'detectedName', text: '   ' },
          { key: 'listenPorts', text: '' },
          { key: 'softwareTechnologies', text: 'GO' },
          { key: 'awsNameTag', text: 'solo-aws' }
        ]
      })
    )
    expect(rows).toEqual([
      { key: 'technologies', kind: 'chips', chips: ['GO'] },
      { key: 'lastSeen', kind: 'date', time: T_LAST }
    ])
    expect(JSON.stringify(rows)).not.toMatch(/undefined|null|NaN/)
  })

  it('sin propiedades, fechas, zonas, etiquetas ni relaciones, ni filas ni grupos', () => {
    expect(buildProcessInfo(entity())).toEqual({ rows: [], groups: [] })
  })

  it('los grupos van en su orden (Se ejecuta en, Process group, Servicios, Otras), con su total', () => {
    const { groups } = buildProcessInfo(full())
    expect(groups.map((group) => group.key)).toEqual([
      'runsOn',
      'processGroup',
      'services',
      'other'
    ])
    // Servicios: el total de la API (7), no los 2 listados.
    expect(groups.map((group) => group.total)).toEqual([1, 1, 7, 2])
  })

  it('cada grupo lleva sus entidades, con la relación y la dirección tal cual', () => {
    const groups = new Map(buildProcessInfo(full()).groups.map((g) => [g.key, g]))
    expect(groups.get('runsOn')?.entities).toEqual([
      { id: HOST, type: 'HOST', relation: 'isProcessOf', direction: 'from' }
    ])
    expect(groups.get('processGroup')?.entities).toEqual([
      { id: PROCESS_GROUP, type: 'PROCESS_GROUP', relation: 'isInstanceOf', direction: 'from' }
    ])
    expect(groups.get('services')?.entities).toEqual(
      SERVICES.map((service) => ({
        id: service,
        type: 'SERVICE',
        relation: 'runsOnProcessGroupInstance',
        direction: 'to'
      }))
    )
    expect(
      [...(groups.get('other')?.entities ?? [])].map((e) => `${e.direction} ${e.relation} ${e.id}`)
    ).toEqual(expect.arrayContaining([`from isPgiOfCgi ${CGI}`, `to isHostGroupOf ${HOST_GROUP}`]))
    expect(groups.get('other')?.entities).toHaveLength(2)
  })

  it('las mismas relaciones en la dirección contraria van a «Otras relaciones»', () => {
    const { groups } = buildProcessInfo(
      entity({
        relationships: [
          relation('to', 'isProcessOf', [{ id: HOST, type: 'HOST' }]),
          relation('to', 'isInstanceOf', [{ id: PROCESS_GROUP, type: 'PROCESS_GROUP' }]),
          relation('from', 'runsOnProcessGroupInstance', [
            { id: SERVICES[0] ?? '', type: 'SERVICE' }
          ])
        ]
      })
    )
    expect(groups.map((group) => group.key)).toEqual(['other'])
    expect(groups[0]?.total).toBe(3)
  })
})
