import { describe, expect, it } from 'vitest'
import {
  DEFAULT_EVIDENCE_SORT,
  EMPTY_EVIDENCE_FILTERS,
  countByStatus,
  entityOptions,
  filterEvidence,
  sortEvidence,
  tagOptions,
  toEvidenceView,
  typeCounts,
  type EvidenceFilters,
  type EvidenceView,
  type EvidenceWire
} from './problem-evidence'

/**
 * v0.10.0: tabla de evidencias. Estado propio de cada evento (data.status, con
 * el endTime de respaldo), tags, flags y título; orden por defecto (abiertos
 * primero, startTime desc, eventId) y estable; filtros y contadores. Fixtures
 * inventados.
 */

const NOW = Date.UTC(2026, 9, 4, 12, 0)
const MIN = 60_000

type EventData = NonNullable<EvidenceWire['data']>

function data(overrides: Partial<EventData> = {}): EventData {
  return {
    status: null,
    endTime: null,
    title: null,
    eventId: null,
    tags: [],
    managementZones: [],
    flags: { maintenance: false, frequent: false, suppressed: false },
    ...overrides
  }
}

function wire(overrides: Partial<EvidenceWire> = {}): EvidenceWire {
  return {
    evidenceType: 'EVENT',
    displayName: 'Evidencia',
    entity: { id: 'SERVICE-1', name: 'pagos', type: 'SERVICE' },
    groupingEntity: null,
    rootCauseRelevant: false,
    startTime: NOW - 60 * MIN,
    endTime: NOW - 30 * MIN,
    eventType: 'CUSTOM_ALERT',
    properties: [],
    metricId: null,
    unit: null,
    valueBefore: null,
    valueAfter: null,
    eventMetric: null,
    data: null,
    ...overrides
  }
}

const view = (overrides: Partial<EvidenceWire> = {}, index = 0): EvidenceView =>
  toEvidenceView(wire(overrides), index)

const filters = (overrides: Partial<EvidenceFilters> = {}): EvidenceFilters => ({
  ...EMPTY_EVIDENCE_FILTERS,
  ...overrides
})

const ids = (views: readonly EvidenceView[]): string[] => views.map((item) => item.id)

describe('toEvidenceView: estado propio del evento', () => {
  it('data.status manda: OPEN o CLOSED, aunque no cuadre con ningún endTime', () => {
    // Evidencia terminada, data.endTime terminado, pero status OPEN → OPEN.
    expect(view({ data: data({ status: 'OPEN', endTime: NOW - MIN }) }).status).toBe('OPEN')
    // Evidencia activa (-1) y data.endTime -1, pero status CLOSED → CLOSED.
    expect(view({ endTime: -1, data: data({ status: 'CLOSED', endTime: -1 }) }).status).toBe(
      'CLOSED'
    )
  })

  it.each([
    ['null', null],
    ['-1', -1]
  ])(
    'sin status, con data y data.endTime %s → OPEN (aunque la evidencia esté terminada)',
    (_l, end) => {
      expect(view({ endTime: NOW - MIN, data: data({ endTime: end }) }).status).toBe('OPEN')
    }
  )

  it('sin status y data.endTime numérico: decide el endTime de la evidencia', () => {
    expect(view({ endTime: NOW - MIN, data: data({ endTime: NOW - MIN }) }).status).toBe('CLOSED')
    expect(view({ endTime: -1, data: data({ endTime: NOW - MIN }) }).status).toBe('OPEN')
  })

  it.each([
    ['-1', -1, 'OPEN'],
    ['null', null, 'OPEN'],
    ['no finito', Number.POSITIVE_INFINITY, 'OPEN'],
    ['un número', NOW - MIN, 'CLOSED'],
    ['0', 0, 'CLOSED']
  ] as const)('sin data: endTime de la evidencia %s → %s', (_l, endTime, expected) => {
    expect(view({ endTime, data: null }).status).toBe(expected)
  })

  it.each(['METRIC', 'TRANSACTIONAL', 'AVAILABILITY_EVIDENCE', 'MAINTENANCE_WINDOW'])(
    '%s (sin data): solo el endTime de la evidencia',
    (type) => {
      expect(view({ evidenceType: type, endTime: -1 }).status).toBe('OPEN')
      expect(view({ evidenceType: type, endTime: NOW }).status).toBe('CLOSED')
    }
  )
})

describe('toEvidenceView: id, título, tipo, tags, flags y zonas', () => {
  it('id = eventId o, si no hay, ev-<índice>; eventId tal cual', () => {
    expect(view({ data: data({ eventId: '-123_456V2' }) }, 7)).toMatchObject({
      id: '-123_456V2',
      eventId: '-123_456V2'
    })
    expect(view({}, 7)).toMatchObject({ id: 'ev-7', eventId: null })
    expect(view({ data: data() }, 3).id).toBe('ev-3')
  })

  it('título: data.title si no está vacío; si no, displayName', () => {
    expect(view({ displayName: 'Nombre', data: data({ title: 'Título' }) }).title).toBe('Título')
    expect(view({ displayName: 'Nombre', data: data({ title: '' }) }).title).toBe('Nombre')
    expect(view({ displayName: 'Nombre', data: data({ title: null }) }).title).toBe('Nombre')
    expect(view({ displayName: 'Nombre' }).title).toBe('Nombre')
  })

  it('typeLabel: en EVENT el eventType (o EVENT); en el resto, el evidenceType', () => {
    expect(view({ eventType: 'PROCESS_RESTART' }).typeLabel).toBe('PROCESS_RESTART')
    expect(view({ eventType: null }).typeLabel).toBe('EVENT')
    expect(view({ evidenceType: 'METRIC', eventType: 'X' }).typeLabel).toBe('METRIC')
    expect(view({ evidenceType: 'TIPO_NUEVO' }).typeLabel).toBe('TIPO_NUEVO')
  })

  it('tags, flags y zonas de data; sin data, vacíos y false', () => {
    const flags = { maintenance: true, frequent: false, suppressed: true }
    expect(
      view({ data: data({ tags: ['a:1', 'b'], managementZones: ['Zona'], flags }) })
    ).toMatchObject({ tags: ['a:1', 'b'], managementZones: ['Zona'], flags })
    expect(view({ data: null })).toMatchObject({
      tags: [],
      managementZones: [],
      flags: { maintenance: false, frequent: false, suppressed: false }
    })
  })
})

describe('sortEvidence', () => {
  const ev = (
    id: string,
    status: 'OPEN' | 'CLOSED',
    start: number | null,
    extra: Partial<EvidenceWire> = {}
  ): EvidenceView =>
    view({
      startTime: start,
      endTime: status === 'OPEN' ? -1 : NOW - MIN,
      data: data({ status, eventId: id }),
      ...extra
    })

  it('por defecto: abiertos primero, luego startTime desc (null al final) y luego eventId', () => {
    expect(DEFAULT_EVIDENCE_SORT).toEqual({ key: 'status', direction: 'asc' })
    const items = [
      ev('c-1', 'CLOSED', NOW - 10 * MIN),
      ev('o-old', 'OPEN', NOW - 90 * MIN),
      ev('o-null', 'OPEN', null),
      ev('o-new', 'OPEN', NOW - 5 * MIN),
      ev('c-2', 'CLOSED', NOW - 2 * MIN),
      ev('o-b', 'OPEN', NOW - 30 * MIN),
      ev('o-a', 'OPEN', NOW - 30 * MIN)
    ]
    expect(ids(sortEvidence(items, DEFAULT_EVIDENCE_SORT, 'es', NOW))).toEqual([
      'o-new',
      'o-a',
      'o-b',
      'o-old',
      'o-null',
      'c-2',
      'c-1'
    ])
  })

  it('estable: el mismo resultado sea cual sea el orden de llegada (refrescar)', () => {
    const items = [
      ev('x-3', 'OPEN', NOW - MIN),
      ev('x-1', 'OPEN', NOW - MIN),
      ev('x-2', 'OPEN', NOW - MIN),
      ev('y', 'CLOSED', null),
      ev('z', 'CLOSED', null)
    ]
    const first = ids(sortEvidence(items, DEFAULT_EVIDENCE_SORT, 'es', NOW))
    for (const shuffled of [
      [...items].reverse(),
      [items[2], items[4], items[0], items[3], items[1]]
    ]) {
      expect(
        ids(sortEvidence(shuffled as EvidenceView[], DEFAULT_EVIDENCE_SORT, 'es', NOW))
      ).toEqual(first)
    }
    expect(first).toEqual(['x-1', 'x-2', 'x-3', 'y', 'z'])
  })

  it('sin eventId, el desempate final es el id (ev-<índice>): sigue siendo estable', () => {
    const a = toEvidenceView(wire({ startTime: null, endTime: -1 }), 1)
    const b = toEvidenceView(wire({ startTime: null, endTime: -1 }), 0)
    const withId = toEvidenceView(
      wire({ startTime: null, endTime: -1, data: data({ eventId: 'e' }) }),
      2
    )
    expect(ids(sortEvidence([a, withId, b], DEFAULT_EVIDENCE_SORT, 'es', NOW))).toEqual([
      'e',
      'ev-0',
      'ev-1'
    ])
  })

  it('status desc: cerrados primero, con los mismos desempates fijos (start desc)', () => {
    const items = [
      ev('o', 'OPEN', NOW - MIN),
      ev('c-old', 'CLOSED', NOW - 60 * MIN),
      ev('c-new', 'CLOSED', NOW - 10 * MIN)
    ]
    expect(ids(sortEvidence(items, { key: 'status', direction: 'desc' }, 'es', NOW))).toEqual([
      'c-new',
      'c-old',
      'o'
    ])
  })

  it('título con el Collator del idioma: sin tildes, sin mayúsculas y con números', () => {
    const items = [
      ev('2', 'OPEN', 1, { displayName: 'evento 10' }),
      ev('1', 'OPEN', 1, { displayName: 'Evento 2' }),
      ev('3', 'OPEN', 1, { displayName: 'Ámbar' }),
      ev('4', 'OPEN', 1, { displayName: 'beta' })
    ]
    expect(
      sortEvidence(items, { key: 'title', direction: 'asc' }, 'es', NOW).map((i) => i.title)
    ).toEqual(['Ámbar', 'beta', 'Evento 2', 'evento 10'])
    expect(
      sortEvidence(items, { key: 'title', direction: 'desc' }, 'es', NOW).map((i) => i.title)
    ).toEqual(['evento 10', 'Evento 2', 'beta', 'Ámbar'])
  })

  it('tipo y entidad (etiqueta), con desempate fijo por start desc en cualquier sentido', () => {
    const items = [
      ev('a', 'OPEN', NOW - 50 * MIN, { eventType: 'B_TYPE' }),
      ev('b', 'OPEN', NOW - 10 * MIN, { eventType: 'A_TYPE' }),
      ev('c', 'OPEN', NOW - 5 * MIN, { eventType: 'A_TYPE' })
    ]
    expect(ids(sortEvidence(items, { key: 'type', direction: 'asc' }, 'es', NOW))).toEqual([
      'c',
      'b',
      'a'
    ])
    expect(ids(sortEvidence(items, { key: 'type', direction: 'desc' }, 'es', NOW))).toEqual([
      'a',
      'c',
      'b'
    ])
    const byEntity = [
      ev('x', 'OPEN', 1, { entity: { id: 'S-2', name: 'zeta', type: 'SERVICE' } }),
      ev('y', 'OPEN', 1, { entity: { id: 'S-1', name: 'Alfa', type: 'SERVICE' } })
    ]
    expect(ids(sortEvidence(byEntity, { key: 'entity', direction: 'asc' }, 'es', NOW))).toEqual([
      'y',
      'x'
    ])
  })

  it('fin: una activa cuenta como +∞; duración: (fin o ahora) − inicio, null al final en los dos sentidos', () => {
    const active = ev('activa', 'OPEN', NOW - 10 * MIN, { endTime: -1 })
    const short = ev('corta', 'CLOSED', NOW - 60 * MIN, { endTime: NOW - 55 * MIN })
    const long = ev('larga', 'CLOSED', NOW - 300 * MIN, { endTime: NOW - 100 * MIN })
    const noStart = ev('sin-inicio', 'CLOSED', null, { endTime: NOW - 20 * MIN })
    const all = [active, short, long, noStart]
    expect(ids(sortEvidence(all, { key: 'end', direction: 'asc' }, 'es', NOW))).toEqual([
      'larga',
      'corta',
      'sin-inicio',
      'activa'
    ])
    expect(ids(sortEvidence(all, { key: 'end', direction: 'desc' }, 'es', NOW))[0]).toBe('activa')
    // Duraciones: corta 5 min, activa 10 min (hasta ahora), larga 200 min.
    expect(ids(sortEvidence(all, { key: 'duration', direction: 'asc' }, 'es', NOW))).toEqual([
      'corta',
      'activa',
      'larga',
      'sin-inicio'
    ])
    expect(ids(sortEvidence(all, { key: 'duration', direction: 'desc' }, 'es', NOW))).toEqual([
      'larga',
      'activa',
      'corta',
      'sin-inicio'
    ])
  })

  it('causa raíz y start: ordenan por su columna', () => {
    const items = [
      ev('normal', 'OPEN', NOW - 5 * MIN),
      ev('raiz', 'OPEN', NOW - 50 * MIN, { rootCauseRelevant: true })
    ]
    const rootFirst = ids(sortEvidence(items, { key: 'rootCause', direction: 'desc' }, 'es', NOW))
    const rootLast = ids(sortEvidence(items, { key: 'rootCause', direction: 'asc' }, 'es', NOW))
    expect(rootFirst).toEqual([...rootLast].reverse())
    expect(ids(sortEvidence(items, { key: 'start', direction: 'asc' }, 'es', NOW))).toEqual([
      'raiz',
      'normal'
    ])
  })

  it('devuelve una copia: no muta la lista de entrada', () => {
    const items = [ev('b', 'CLOSED', 1), ev('a', 'OPEN', 2)]
    const before = ids(items)
    const sorted = sortEvidence(items, DEFAULT_EVIDENCE_SORT, 'es', NOW)
    expect(sorted).not.toBe(items)
    expect(ids(items)).toEqual(before)
  })
})

describe('filterEvidence, countByStatus y typeCounts', () => {
  const items: EvidenceView[] = [
    view(
      {
        displayName: 'Reinicio de la aplicación',
        eventType: 'PROCESS_RESTART',
        entity: { id: 'PGI-1', name: 'Proceso Pagos', type: 'PROCESS_GROUP_INSTANCE' },
        rootCauseRelevant: true,
        endTime: -1,
        data: data({ status: 'OPEN', eventId: 'e1', tags: ['equipo:pagos', 'crítico'] })
      },
      0
    ),
    view(
      {
        displayName: 'Respuesta lenta',
        eventType: 'SERVICE_SLOWDOWN',
        entity: { id: 'S-1', name: 'carrito', type: 'SERVICE' },
        data: data({ status: 'CLOSED', eventId: 'e2', tags: ['equipo:pagos'] })
      },
      1
    ),
    view(
      {
        displayName: 'Errores',
        eventType: 'SERVICE_SLOWDOWN',
        entity: { id: 'S-1', name: 'carrito', type: 'SERVICE' },
        endTime: -1,
        data: data({ status: 'OPEN', eventId: 'e3', tags: [] })
      },
      2
    ),
    view(
      {
        evidenceType: 'METRIC',
        displayName: 'CPU alta',
        entity: null,
        endTime: NOW - MIN
      },
      3
    )
  ]
  const run = (overrides: Partial<EvidenceFilters>): string[] =>
    ids(filterEvidence(items, filters(overrides)))

  it('sin filtros: todas', () => {
    expect(run({})).toEqual(['e1', 'e2', 'e3', 'ev-3'])
  })

  it('texto sin tildes ni mayúsculas, en título, tipo, entidad y tags', () => {
    expect(run({ text: 'APLICACION' })).toEqual(['e1'])
    expect(run({ text: 'slowdown' })).toEqual(['e2', 'e3'])
    expect(run({ text: 'CARRITO' })).toEqual(['e2', 'e3'])
    expect(run({ text: 'critico' })).toEqual(['e1'])
    expect(run({ text: 'metric' })).toEqual(['ev-3'])
    expect(run({ text: 'no existe' })).toEqual([])
  })

  it('tipos (unión), entidad por id, tag exacto y solo causa raíz', () => {
    expect(run({ types: ['SERVICE_SLOWDOWN'] })).toEqual(['e2', 'e3'])
    expect(run({ types: ['SERVICE_SLOWDOWN', 'METRIC'] })).toEqual(['e2', 'e3', 'ev-3'])
    expect(run({ entity: 'S-1' })).toEqual(['e2', 'e3'])
    expect(run({ tag: 'equipo:pagos' })).toEqual(['e1', 'e2'])
    // Exacto: un prefijo no vale.
    expect(run({ tag: 'equipo' })).toEqual([])
    expect(run({ rootCauseOnly: true })).toEqual(['e1'])
  })

  it('estado y combinaciones', () => {
    expect(run({ status: 'OPEN' })).toEqual(['e1', 'e3'])
    expect(run({ status: 'CLOSED' })).toEqual(['e2', 'ev-3'])
    expect(run({ status: 'OPEN', entity: 'S-1' })).toEqual(['e3'])
    expect(run({ status: 'CLOSED', tag: 'equipo:pagos', text: 'lenta' })).toEqual(['e2'])
  })

  it('countByStatus: sobre todos los filtros MENOS el de estado', () => {
    expect(countByStatus(items, filters())).toEqual({ open: 2, closed: 2, all: 4 })
    // El de estado no cambia los contadores (si no, los otros botones mostrarían 0).
    expect(countByStatus(items, filters({ status: 'OPEN' }))).toEqual({
      open: 2,
      closed: 2,
      all: 4
    })
    expect(countByStatus(items, filters({ entity: 'S-1' }))).toEqual({ open: 1, closed: 1, all: 2 })
    expect(countByStatus(items, filters({ text: 'no existe' }))).toEqual({
      open: 0,
      closed: 0,
      all: 0
    })
  })

  it('typeCounts: sobre todos los filtros MENOS el de tipos (y por typeLabel)', () => {
    expect(typeCounts(items, filters())).toEqual({
      PROCESS_RESTART: 1,
      SERVICE_SLOWDOWN: 2,
      METRIC: 1
    })
    expect(typeCounts(items, filters({ types: ['METRIC'] }))).toEqual({
      PROCESS_RESTART: 1,
      SERVICE_SLOWDOWN: 2,
      METRIC: 1
    })
    expect(typeCounts(items, filters({ status: 'OPEN' }))).toEqual({
      PROCESS_RESTART: 1,
      SERVICE_SLOWDOWN: 1
    })
  })

  it('opciones de entidad y de tag: únicas y ordenadas (sin la evidencia sin entidad)', () => {
    expect(entityOptions(items)).toEqual([
      { id: 'S-1', label: 'carrito' },
      { id: 'PGI-1', label: 'Proceso Pagos' }
    ])
    expect(tagOptions(items)).toEqual(['crítico', 'equipo:pagos'])
  })

  it('no mutan la lista de entrada', () => {
    const before = ids(items)
    filterEvidence(items, filters({ status: 'OPEN', text: 'x' }))
    countByStatus(items, filters())
    typeCounts(items, filters())
    expect(ids(items)).toEqual(before)
  })
})
