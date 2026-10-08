import { describe, expect, it } from 'vitest'
import type { EntityData, EntityRelationship } from '@shared/modules'
import { buildMonitorInfo } from './monitor-info'

/**
 * Ficha 0026, CA1: la función pura que, con la salida de `entities:get` (0014) de un browser
 * monitor (SYNTHETIC_TEST) o de un HTTP monitor (HTTP_CHECK), elige las filas de la tarjeta
 * «Información» y agrupa las relaciones. Claves y relaciones: las que la 0022 vio en vivo.
 *
 * Lo que fijan estos tests (la ficha deja las filas al developer; decisiones delegadas por Dani,
 * refinables):
 *
 * - `buildMonitorInfo(data: EntityData): { rows, groups }`, en `monitor-info.ts`. El tipo sale
 *   de `data.type` (`HTTP_CHECK` es HTTP; si no, browser).
 * - `rows`: como en la 0015, solo las que tengan dato. Estas son obligatorias y van en este
 *   orden relativo (el developer puede añadir otras entre ellas, con el informe de la 0022):
 *   - `monitorType` (`browserMonitorSubtype` o `httpMonitorSubtype`), `{ kind: 'text', text }`.
 *   - `enabled` (`isEnabled`), `{ kind: 'boolean', value }`; solo con `true` o `false`.
 *   - `frequency` (`syntheticMonitorFrequency`), `{ kind: 'number', value }`; solo con un número
 *     positivo. La unidad la pone la vista.
 *   - `locations` y `steps` (browser) o `requests` (HTTP), `{ kind: 'count', count }`: el
 *     `total` de las relaciones de localizaciones (`runsOn` de fromRelationships) y de pasos o
 *     peticiones (`isStepOf` de toRelationships). De las relaciones y no de `assignedLocations`
 *     ni `steps`: main recorta el texto de una propiedad a 300 caracteres y una lista larga
 *     daría una cuenta menor; el `total` de la relación es el de la API.
 *   - `firstSeen` y `lastSeen`, `{ kind: 'date', time }`; `managementZones` y `tags`,
 *     `{ kind: 'chips', chips }`.
 *   Nunca salen como fila las capturas (`syntheticScreenshot*Uri`) ni `detectedName`.
 * - `groups`: `{ key, total, entities }` como en la 0015 y la 0020, en este orden y solo los que
 *   tengan alguna: `monitors` («Monitoriza»: `monitors` y `calls` de fromRelationships e
 *   `isApplicationOfSyntheticTest` de toRelationships), `locations` (`runsOn` de
 *   fromRelationships), `steps` en browser o `requests` en HTTP (`isStepOf` de
 *   toRelationships) y `other` (el resto, de las dos direcciones).
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

function entity(
  type: 'SYNTHETIC_TEST' | 'HTTP_CHECK',
  overrides: Partial<EntityData> = {}
): EntityData {
  const data: EntityData = {
    displayName: 'monitor-prueba',
    type,
    firstSeen: null,
    lastSeen: null,
    iconType: null,
    managementZones: [],
    tags: [],
    properties: [],
    relationships: [],
    ...overrides
  }
  return data
}

const LOCATIONS = [1, 2, 3].map((n) => id('SYNTHETIC_LOCATION', n))
const BROWSER_STEPS = [4, 5].map((n) => id('SYNTHETIC_TEST_STEP', n))
const HTTP_STEPS = [6, 7, 8].map((n) => id('HTTP_CHECK_STEP', n))
const APP = id('APPLICATION', 9)
const APP_2 = id('APPLICATION', 10)
const SERVICE = id('SERVICE', 11)
const OTHER = id('ENVIRONMENT', 12)

/** Propiedades de un browser monitor (claves de la 0022), en otro orden que el de las filas. */
const BROWSER_PROPERTIES: { key: string; text: string }[] = [
  { key: 'syntheticScreenshotRegularUri', text: 'captura-normal-prueba' },
  { key: 'steps', text: 'paso-a, paso-b' },
  { key: 'detectedName', text: 'nombre-detectado-prueba' },
  { key: 'syntheticMonitorFrequency', text: '15' },
  { key: 'createdBy', text: 'autor-prueba' },
  { key: 'assignedLocations', text: `${LOCATIONS[0]}, ${LOCATIONS[1]}` },
  { key: 'isEnabled', text: 'true' },
  { key: 'syntheticScreenshotThumbnailUri', text: 'captura-mini-prueba' },
  { key: 'browserMonitorSubtype', text: 'CLICKPATH' },
  { key: 'syntheticScreenshotRegularErrorUri', text: 'captura-error-prueba' },
  { key: 'syntheticScreenshotThumbnailErrorUri', text: 'captura-mini-error-prueba' },
  { key: 'lastExecutionTimestamp', text: '1790000000000' },
  { key: 'manuallyAssignedApplications', text: APP }
]

/** Propiedades de un HTTP monitor (claves de la 0022). */
const HTTP_PROPERTIES: { key: string; text: string }[] = [
  { key: 'detectedName', text: 'nombre-detectado-http' },
  { key: 'isEnabled', text: 'false' },
  { key: 'httpMonitorSubtype', text: 'MULTI_REQUEST' },
  { key: 'syntheticMonitorFrequency', text: '5' },
  { key: 'assignedLocations', text: LOCATIONS[2] ?? '' },
  { key: 'steps', text: 'peticion-a' }
]

const REQUIRED_BROWSER = [
  'monitorType',
  'enabled',
  'frequency',
  'locations',
  'steps',
  'firstSeen',
  'lastSeen',
  'managementZones',
  'tags'
]
const REQUIRED_HTTP = REQUIRED_BROWSER.map((key) => (key === 'steps' ? 'requests' : key))

const browserFull = (): EntityData =>
  entity('SYNTHETIC_TEST', {
    firstSeen: T_FIRST,
    lastSeen: T_LAST,
    managementZones: ['Zona A', 'Zona B'],
    tags: ['equipo:web', 'entorno:pro'],
    properties: BROWSER_PROPERTIES,
    // En otro orden que el de los grupos; 12 localizaciones según la API, 3 listadas.
    relationships: [
      relation(
        'to',
        'isStepOf',
        BROWSER_STEPS.map((step) => ({ id: step, type: 'SYNTHETIC_TEST_STEP' }))
      ),
      relation('from', 'belongsTo', [{ id: OTHER, type: 'ENVIRONMENT' }]),
      relation(
        'from',
        'runsOn',
        LOCATIONS.map((location) => ({ id: location, type: 'SYNTHETIC_LOCATION' })),
        12
      ),
      relation('from', 'monitors', [{ id: APP, type: 'APPLICATION' }])
    ]
  })

const httpFull = (): EntityData =>
  entity('HTTP_CHECK', {
    firstSeen: T_FIRST,
    lastSeen: T_LAST,
    managementZones: ['Zona H'],
    tags: ['equipo:api'],
    properties: HTTP_PROPERTIES,
    relationships: [
      relation('to', 'isApplicationOfSyntheticTest', [{ id: APP_2, type: 'APPLICATION' }]),
      relation(
        'to',
        'isStepOf',
        HTTP_STEPS.map((step) => ({ id: step, type: 'HTTP_CHECK_STEP' }))
      ),
      relation('from', 'runsOn', [{ id: LOCATIONS[2] ?? '', type: 'SYNTHETIC_LOCATION' }]),
      relation('from', 'calls', [{ id: SERVICE, type: 'SERVICE' }])
    ]
  })

/** ¿Están las claves `expected` en `actual`, en ese orden relativo? */
function inOrder(actual: string[], expected: string[]): boolean {
  let index = 0
  for (const key of actual) if (key === expected[index]) index += 1
  return index === expected.length
}

const rowMap = (data: EntityData): Map<string, unknown> =>
  new Map<string, unknown>(buildMonitorInfo(data).rows.map((row) => [row.key, row]))

describe('CA1 (0026): filas y grupos de relaciones de un browser monitor y de un HTTP monitor a partir de entities:get', () => {
  it('browser con todas las claves: las filas obligatorias salen, en su orden relativo y sin repetirse', () => {
    const keys = buildMonitorInfo(browserFull()).rows.map((row) => row.key)
    expect(inOrder(keys, REQUIRED_BROWSER), JSON.stringify(keys)).toBe(true)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys).not.toContain('requests')
  })

  it('browser: cada fila obligatoria lleva su dato (texto, sí/no, número, recuento, fecha o chips)', () => {
    const rows = rowMap(browserFull())
    expect(rows.get('monitorType')).toEqual({
      key: 'monitorType',
      kind: 'text',
      text: 'CLICKPATH'
    })
    expect(rows.get('enabled')).toEqual({ key: 'enabled', kind: 'boolean', value: true })
    expect(rows.get('frequency')).toEqual({ key: 'frequency', kind: 'number', value: 15 })
    // El total de la API (12), no las 3 listadas ni las 2 de assignedLocations.
    expect(rows.get('locations')).toEqual({ key: 'locations', kind: 'count', count: 12 })
    expect(rows.get('steps')).toEqual({ key: 'steps', kind: 'count', count: 2 })
    expect(rows.get('firstSeen')).toEqual({ key: 'firstSeen', kind: 'date', time: T_FIRST })
    expect(rows.get('lastSeen')).toEqual({ key: 'lastSeen', kind: 'date', time: T_LAST })
    expect(rows.get('managementZones')).toEqual({
      key: 'managementZones',
      kind: 'chips',
      chips: ['Zona A', 'Zona B']
    })
    expect(rows.get('tags')).toEqual({
      key: 'tags',
      kind: 'chips',
      chips: ['equipo:web', 'entorno:pro']
    })
  })

  it('HTTP con todas las claves: su tipo, inactivo, y «requests» en lugar de «steps»', () => {
    const keys = buildMonitorInfo(httpFull()).rows.map((row) => row.key)
    expect(inOrder(keys, REQUIRED_HTTP), JSON.stringify(keys)).toBe(true)
    expect(keys).not.toContain('steps')
    const rows = rowMap(httpFull())
    expect(rows.get('monitorType')).toEqual({
      key: 'monitorType',
      kind: 'text',
      text: 'MULTI_REQUEST'
    })
    expect(rows.get('enabled')).toEqual({ key: 'enabled', kind: 'boolean', value: false })
    expect(rows.get('frequency')).toEqual({ key: 'frequency', kind: 'number', value: 5 })
    expect(rows.get('locations')).toEqual({ key: 'locations', kind: 'count', count: 1 })
    expect(rows.get('requests')).toEqual({ key: 'requests', kind: 'count', count: 3 })
    expect(rows.get('managementZones')).toEqual({
      key: 'managementZones',
      kind: 'chips',
      chips: ['Zona H']
    })
  })

  it('las capturas y el nombre detectado nunca son una fila (van solo en «Todas las propiedades»)', () => {
    for (const data of [browserFull(), httpFull()]) {
      const text = JSON.stringify(buildMonitorInfo(data).rows)
      for (const other of ['syntheticScreenshot', 'captura-', 'detectedName', 'nombre-detectado']) {
        expect(text, `${data.type}: ${other}`).not.toContain(other)
      }
    }
  })

  it('con pocas claves, solo las filas con dato (sin vacíos, fechas null ni «undefined»)', () => {
    const { rows } = buildMonitorInfo(
      entity('SYNTHETIC_TEST', {
        lastSeen: T_LAST,
        properties: [
          { key: 'detectedName', text: 'solo-detectado' },
          { key: 'browserMonitorSubtype', text: '   ' },
          { key: 'isEnabled', text: 'false' },
          { key: 'syntheticMonitorFrequency', text: '' }
        ]
      })
    )
    expect(rows).toEqual([
      { key: 'enabled', kind: 'boolean', value: false },
      { key: 'lastSeen', kind: 'date', time: T_LAST }
    ])
    expect(JSON.stringify(rows)).not.toMatch(/undefined|null|NaN/)
  })

  it('«si está activo» solo con true o false; la frecuencia, solo con un número positivo', () => {
    for (const text of ['', 'n/a', 'TRUE?', 'sí']) {
      const keys = buildMonitorInfo(
        entity('HTTP_CHECK', { properties: [{ key: 'isEnabled', text }] })
      ).rows.map((row) => row.key)
      expect(keys, `isEnabled «${text}»`).not.toContain('enabled')
    }
    for (const text of ['', 'n/a', '0', '-5']) {
      const keys = buildMonitorInfo(
        entity('HTTP_CHECK', { properties: [{ key: 'syntheticMonitorFrequency', text }] })
      ).rows.map((row) => row.key)
      expect(keys, `frecuencia «${text}»`).not.toContain('frequency')
    }
  })

  it('sin propiedades, fechas, zonas, etiquetas ni relaciones, ni filas ni grupos', () => {
    for (const type of ['SYNTHETIC_TEST', 'HTTP_CHECK'] as const) {
      expect(buildMonitorInfo(entity(type)), type).toEqual({ rows: [], groups: [] })
    }
  })

  it('browser: los grupos van en su orden (Monitoriza, Localizaciones, Pasos, Otras), con su total', () => {
    const { groups } = buildMonitorInfo(browserFull())
    expect(groups.map((group) => group.key)).toEqual(['monitors', 'locations', 'steps', 'other'])
    expect(groups.map((group) => group.total)).toEqual([1, 12, 2, 1])
  })

  it('browser: cada grupo lleva sus entidades, con la relación y la dirección tal cual', () => {
    const groups = new Map(buildMonitorInfo(browserFull()).groups.map((g) => [g.key, g]))
    expect(groups.get('monitors')?.entities).toEqual([
      { id: APP, type: 'APPLICATION', relation: 'monitors', direction: 'from' }
    ])
    expect(groups.get('locations')?.entities).toEqual(
      LOCATIONS.map((location) => ({
        id: location,
        type: 'SYNTHETIC_LOCATION',
        relation: 'runsOn',
        direction: 'from'
      }))
    )
    expect(groups.get('steps')?.entities).toEqual(
      BROWSER_STEPS.map((step) => ({
        id: step,
        type: 'SYNTHETIC_TEST_STEP',
        relation: 'isStepOf',
        direction: 'to'
      }))
    )
    expect(groups.get('other')?.entities).toEqual([
      { id: OTHER, type: 'ENVIRONMENT', relation: 'belongsTo', direction: 'from' }
    ])
  })

  it('HTTP: «Monitoriza» junta el servicio al que llama y la aplicación; los pasos son «Peticiones»', () => {
    const { groups } = buildMonitorInfo(httpFull())
    expect(groups.map((group) => group.key)).toEqual(['monitors', 'locations', 'requests'])
    expect(groups.map((group) => group.total)).toEqual([2, 1, 3])
    const monitors = groups.find((group) => group.key === 'monitors')
    expect(
      [...(monitors?.entities ?? [])].map((e) => `${e.direction} ${e.relation} ${e.id}`).sort()
    ).toEqual([`from calls ${SERVICE}`, `to isApplicationOfSyntheticTest ${APP_2}`].sort())
    expect(groups.find((group) => group.key === 'requests')?.entities).toEqual(
      HTTP_STEPS.map((step) => ({
        id: step,
        type: 'HTTP_CHECK_STEP',
        relation: 'isStepOf',
        direction: 'to'
      }))
    )
  })

  it('las mismas relaciones en la dirección contraria van a «Otras relaciones»', () => {
    const { groups, rows } = buildMonitorInfo(
      entity('SYNTHETIC_TEST', {
        relationships: [
          relation('to', 'runsOn', [{ id: LOCATIONS[0] ?? '', type: 'SYNTHETIC_LOCATION' }]),
          relation('from', 'isStepOf', [
            { id: BROWSER_STEPS[0] ?? '', type: 'SYNTHETIC_TEST_STEP' }
          ])
        ]
      })
    )
    expect(groups.map((group) => group.key)).toEqual(['other'])
    expect(groups[0]?.total).toBe(2)
    // Y no cuentan como localizaciones ni pasos.
    expect(rows.map((row) => row.key)).toEqual([])
  })
})
