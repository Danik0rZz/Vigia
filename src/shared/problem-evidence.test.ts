import { describe, expect, it } from 'vitest'
import {
  EMPTY_EVIDENCE_FILTERS,
  NOT_AVAILABLE,
  changeOf,
  durationParts,
  evidenceWireSchema,
  filterEvidence,
  filtersShowing,
  formatUnit,
  toEvidenceView,
  type EvidenceWire
} from './problem-evidence'

/**
 * v0.9.1: modelo común de las evidencias del detalle de un problema (vista y
 * exportación). Los 5 tipos de la OpenAPI v2 (EVENT, METRIC, TRANSACTIONAL,
 * AVAILABILITY_EVIDENCE y MAINTENANCE_WINDOW) más uno desconocido, que se
 * conserva tal cual. Fixtures inventados.
 */

const TYPES = [
  'EVENT',
  'METRIC',
  'TRANSACTIONAL',
  'AVAILABILITY_EVIDENCE',
  'MAINTENANCE_WINDOW',
  'TIPO_NUEVO_DE_DYNATRACE'
] as const

describe('durationParts', () => {
  it.each([
    [0, { unit: 's', seconds: 0 }],
    [-5000, { unit: 's', seconds: 0 }],
    [59_999, { unit: 's', seconds: 59 }],
    [60_000, { unit: 'min', minutes: 1 }],
    [59 * 60_000 + 59_000, { unit: 'min', minutes: 59 }],
    [3_600_000, { unit: 'h', hours: 1, minutes: 0 }],
    [26 * 3_600_000 + 5 * 60_000, { unit: 'h', hours: 26, minutes: 5 }]
  ])('%d ms → %j', (ms, expected) => {
    expect(durationParts(ms)).toEqual(expected)
  })
})

describe('filtersShowing (salto desde el resumen de la causa raíz)', () => {
  const root = toEvidenceView(
    wire({
      displayName: 'Reinicio',
      rootCauseRelevant: true,
      endTime: 2000,
      data: {
        status: 'CLOSED',
        endTime: 2000,
        title: null,
        eventId: 'e1',
        tags: ['equipo:pagos'],
        managementZones: [],
        flags: { maintenance: false, frequent: false, suppressed: false }
      }
    })
  )

  it('quita solo los filtros que la ocultan y deja los demás', () => {
    const result = filtersShowing(
      {
        text: 'cpu',
        types: ['METRIC'],
        entity: 'SERVICE-1',
        tag: 'otro',
        rootCauseOnly: true,
        status: 'OPEN'
      },
      root
    )
    expect(result).toEqual({
      text: '',
      types: [],
      entity: 'SERVICE-1',
      tag: null,
      rootCauseOnly: true,
      status: 'ALL'
    })
  })

  it('si ningún filtro la oculta, los devuelve iguales (en una copia)', () => {
    const filters = {
      ...EMPTY_EVIDENCE_FILTERS,
      text: 'reinicio',
      tag: 'equipo:pagos',
      status: 'CLOSED' as const
    }
    const result = filtersShowing(filters, root)
    expect(result).toEqual(filters)
    expect(result).not.toBe(filters)
    expect(filterEvidence([root], result)).toHaveLength(1)
  })
})

function wire(overrides: Partial<EvidenceWire> = {}): EvidenceWire {
  return {
    evidenceType: 'EVENT',
    displayName: 'Evidencia de prueba',
    entity: { id: 'SERVICE-1', name: 'pagos', type: 'SERVICE' },
    groupingEntity: null,
    rootCauseRelevant: false,
    startTime: 1000,
    endTime: 2000,
    eventType: null,
    properties: [],
    metricId: null,
    unit: null,
    valueBefore: null,
    valueAfter: null,
    eventMetric: null,
    description: null,
    data: null,
    ...overrides
  }
}

describe('evidenceWireSchema', () => {
  it('acepta una evidencia completa y un tipo desconocido (el tipo es texto libre)', () => {
    expect(evidenceWireSchema.safeParse(wire()).success).toBe(true)
    expect(
      evidenceWireSchema.safeParse(wire({ evidenceType: 'TIPO_NUEVO_DE_DYNATRACE' })).success
    ).toBe(true)
  })

  it('como mucho 8 propiedades del evento', () => {
    const properties = Array.from({ length: 9 }, (_, i) => ({ key: `k${i}`, text: 'v' }))
    expect(evidenceWireSchema.safeParse(wire({ properties: properties.slice(0, 8) })).success).toBe(
      true
    )
    expect(evidenceWireSchema.safeParse(wire({ properties })).success).toBe(false)
  })

  it('endTime admite -1 y null tal cual', () => {
    expect(evidenceWireSchema.parse(wire({ endTime: -1 })).endTime).toBe(-1)
    expect(evidenceWireSchema.parse(wire({ endTime: null })).endTime).toBeNull()
  })
})

describe('toEvidenceView', () => {
  it.each(TYPES)('%s: conserva el tipo con su texto original', (type) => {
    expect(toEvidenceView(wire({ evidenceType: type })).type).toBe(type)
  })

  describe.each(TYPES)('%s: fin de la evidencia', (type) => {
    it.each([
      ['-1', -1],
      ['null', null],
      ['NaN', Number.NaN],
      ['Infinity', Number.POSITIVE_INFINITY]
    ])('endTime %s → ACTIVE', (_label, endTime) => {
      expect(toEvidenceView(wire({ evidenceType: type, endTime })).end).toBe('ACTIVE')
    })

    it('con un número, ese número es el fin (no hay CLOSED)', () => {
      expect(toEvidenceView(wire({ evidenceType: type, endTime: 5000 })).end).toBe(5000)
      expect(toEvidenceView(wire({ evidenceType: type, endTime: 0 })).end).toBe(0)
    })
  })

  it('una entidad sin nombre se etiqueta con su id', () => {
    const result = toEvidenceView(wire({ entity: { id: 'HOST-9', name: null, type: 'HOST' } }))
    expect(result.entity).toEqual({ id: 'HOST-9', label: 'HOST-9', type: 'HOST' })
  })

  it('la entidad es la de la evidencia, no la groupingEntity', () => {
    const result = toEvidenceView(
      wire({ groupingEntity: { id: 'PROCESS_GROUP-1', name: null, type: 'PROCESS_GROUP' } })
    )
    expect(result.entity?.id).toBe('SERVICE-1')
  })

  it('sin entidad: entity null', () => {
    expect(toEvidenceView(wire({ entity: null })).entity).toBeNull()
  })

  it.each(['METRIC', 'TRANSACTIONAL'])(
    '%s: calcula el cambio y conserva unidad y métrica',
    (type) => {
      const result = toEvidenceView(
        wire({
          evidenceType: type,
          valueBefore: 100,
          valueAfter: 250,
          unit: 'MilliSecond',
          metricId: 'builtin:service.response.time'
        })
      )
      expect(result.change).toEqual({ direction: 'up', ratio: 2.5, delta: null })
      expect(result.before).toBe(100)
      expect(result.after).toBe(250)
      expect(result.unit).toBe('MilliSecond')
      expect(result.metricId).toBe('builtin:service.response.time')
      expect(result.event).toBeNull()
    }
  )

  it.each(['METRIC', 'TRANSACTIONAL'])('%s sin uno de los valores: change null (N/A)', (type) => {
    expect(toEvidenceView(wire({ evidenceType: type, valueBefore: 1 })).change).toBeNull()
    expect(toEvidenceView(wire({ evidenceType: type, valueAfter: 1 })).change).toBeNull()
  })

  it.each(['EVENT', 'AVAILABILITY_EVIDENCE', 'MAINTENANCE_WINDOW', 'TIPO_NUEVO_DE_DYNATRACE'])(
    '%s: sin cambio aunque traiga valores',
    (type) => {
      expect(
        toEvidenceView(wire({ evidenceType: type, valueBefore: 1, valueAfter: 2 })).change
      ).toBeNull()
    }
  )

  it('EVENT: el tipo de evento y sus propiedades', () => {
    const properties = [{ key: 'dt.event.description', text: 'Reinicio' }]
    const result = toEvidenceView(wire({ eventType: 'PROCESS_RESTART', properties }))
    expect(result.event).toEqual({
      eventType: 'PROCESS_RESTART',
      properties,
      metric: null,
      description: null
    })
  })

  it('v0.9.2: EVENT con métrica: event.metric es la eventMetric de main, tal cual', () => {
    const metric = { status: 'ok' as const, selector: 'builtin:host.cpu.usage:avg', threshold: 85 }
    expect(toEvidenceView(wire({ eventMetric: metric })).event?.metric).toEqual(metric)
    expect(toEvidenceView(wire({ eventMetric: { status: 'tooLong' } })).event?.metric).toEqual({
      status: 'tooLong'
    })
  })

  it.each(['METRIC', 'TRANSACTIONAL', 'AVAILABILITY_EVIDENCE', 'MAINTENANCE_WINDOW'])(
    '%s: sin bloque de evento',
    (type) => {
      expect(
        toEvidenceView(
          wire({ evidenceType: type, eventType: 'X', properties: [{ key: 'k', text: 'v' }] })
        ).event
      ).toBeNull()
    }
  )

  it('causa raíz, inicio y nombre pasan tal cual', () => {
    const result = toEvidenceView(
      wire({ rootCauseRelevant: true, startTime: 42, displayName: 'CPU' })
    )
    expect(result).toMatchObject({ rootCause: true, start: 42, displayName: 'CPU' })
  })

  it('no muta la entrada', () => {
    const input = wire({ evidenceType: 'METRIC', valueBefore: 1, valueAfter: 2 })
    const copy = structuredClone(input)
    toEvidenceView(input)
    expect(input).toEqual(copy)
  })
})

describe('changeOf', () => {
  it('sube, baja o se queda igual, con el cociente', () => {
    expect(changeOf(10, 20)).toEqual({ direction: 'up', ratio: 2, delta: null })
    expect(changeOf(20, 5)).toEqual({ direction: 'down', ratio: 0.25, delta: null })
    expect(changeOf(7, 7)).toEqual({ direction: 'same', ratio: 1, delta: null })
  })

  it('con before 0 (o casi): sin cociente, con la diferencia', () => {
    expect(changeOf(0, 15)).toEqual({ direction: 'up', ratio: null, delta: 15 })
    expect(changeOf(0, -3)).toEqual({ direction: 'down', ratio: null, delta: -3 })
    expect(changeOf(0, 0)).toEqual({ direction: 'same', ratio: null, delta: 0 })
    expect(changeOf(1e-12, 5)?.ratio).toBeNull()
  })

  it('before negativo: el cociente sigue siendo after / before', () => {
    expect(changeOf(-10, -5)).toEqual({ direction: 'up', ratio: 0.5, delta: null })
  })

  it.each([
    [null, 1],
    [1, null],
    [null, null],
    [Number.NaN, 1],
    [1, Number.NaN],
    [Number.POSITIVE_INFINITY, 1],
    [1, Number.NEGATIVE_INFINITY]
  ])('changeOf(%s, %s) → null (la vista pinta N/A)', (before, after) => {
    expect(changeOf(before, after)).toBeNull()
  })
})

describe('formatUnit', () => {
  it.each([null, Number.NaN, Number.POSITIVE_INFINITY])('sin valor (%s) → N/A', (value) => {
    expect(NOT_AVAILABLE).toBe('N/A')
    expect(formatUnit(value, 'MilliSecond', 'es')).toBe('N/A')
    expect(formatUnit(value, null, 'en')).toBe('N/A')
  })

  it.each([
    // [valor, unidad, es, en]
    [1500, 'MicroSecond', '1,5 ms', '1.5 ms'],
    [1_500_000, 'MicroSecond', '1,5 s', '1.5 s'],
    [250, 'MilliSecond', '250 ms', '250 ms'],
    [1000, 'MilliSecond', '1 s', '1 s'],
    [2500, 'MilliSecond', '2,5 s', '2.5 s'],
    [0.5, 'Second', '500 ms', '500 ms'],
    [3, 'Second', '3 s', '3 s'],
    [2_000_000, 'NanoSecond', '2 ms', '2 ms'],
    [-1500, 'MilliSecond', '-1,5 s', '-1.5 s']
  ])('tiempo: %s %s → es «%s», en «%s»', (value, unit, es, en) => {
    expect(formatUnit(value, unit, 'es')).toBe(es)
    expect(formatUnit(value, unit, 'en')).toBe(en)
  })

  it('porcentaje con espacio en los dos idiomas', () => {
    expect(formatUnit(12.345, 'Percent', 'es')).toBe('12,35 %')
    expect(formatUnit(12.345, 'Percent', 'en')).toBe('12.35 %')
  })

  it.each([
    [512, '512 B', '512 B'],
    [1024, '1 KB', '1 KB'],
    [1536, '1,5 KB', '1.5 KB'],
    [5 * 1024 ** 2, '5 MB', '5 MB'],
    [2.5 * 1024 ** 3, '2,5 GB', '2.5 GB'],
    // Sin pasar de GB.
    [2048 * 1024 ** 3, '2048 GB', '2,048 GB']
  ])('bytes: %s → es «%s», en «%s»', (value, es, en) => {
    expect(formatUnit(value, 'Byte', 'es')).toBe(es)
    expect(formatUnit(value, 'Byte', 'en')).toBe(en)
  })

  it('Count entero, Ratio con 3 decimales, PerMinute y PerSecond', () => {
    expect(formatUnit(3.7, 'Count', 'es')).toBe('4')
    expect(formatUnit(12_345, 'Count', 'en')).toBe('12,345')
    expect(formatUnit(0.123456, 'Ratio', 'es')).toBe('0,123')
    expect(formatUnit(0.123456, 'Ratio', 'en')).toBe('0.123')
    expect(formatUnit(42.5, 'PerMinute', 'es')).toBe('42,5 /min')
    expect(formatUnit(3, 'PerSecond', 'en')).toBe('3 /s')
  })

  it('sin unidad: solo el número; unidad desconocida: el número y su nombre original', () => {
    expect(formatUnit(1234.5, null, 'en')).toBe('1,234.5')
    expect(formatUnit(12_345.5, null, 'es')).toBe('12.345,5')
    expect(formatUnit(7, 'UnidadRara', 'es')).toBe('7 UnidadRara')
    expect(formatUnit(7.125, 'KiloRequest', 'en')).toBe('7.13 KiloRequest')
  })

  it('separador de miles según Intl: en es, 4 cifras van sin punto', () => {
    expect(formatUnit(1234.5, null, 'es')).toBe('1234,5')
  })

  it.each([
    // [valor, unidad, es, en]: el redondeo va ANTES de elegir la escala.
    [999.999, 'MilliSecond', '1 s', '1 s'],
    [999.994, 'MilliSecond', '999,99 ms', '999.99 ms'],
    [999_999, 'MicroSecond', '1 s', '1 s'],
    [1023.999, 'Byte', '1 KB', '1 KB'],
    [1023.994, 'Byte', '1023,99 B', '1,023.99 B'],
    [1024 ** 2 - 0.001, 'Byte', '1 MB', '1 MB']
  ])('redondeo antes de la escala: %s %s → es «%s», en «%s»', (value, unit, es, en) => {
    expect(formatUnit(value, unit, 'es')).toBe(es)
    expect(formatUnit(value, unit, 'en')).toBe(en)
  })

  it.each([
    // [valor, unidad, es, en]: un valor distinto de 0 nunca sale como 0.
    [500, 'NanoSecond', '< 0,01 ms', '< 0.01 ms'],
    [4000, 'NanoSecond', '< 0,01 ms', '< 0.01 ms'],
    [0.0004, 'Percent', '< 0,01 %', '< 0.01 %'],
    [-0.0001, 'Percent', '> -0,01 %', '> -0.01 %'],
    [0.004, null, '< 0,01', '< 0.01'],
    [0.004, 'UnidadRara', '< 0,01 UnidadRara', '< 0.01 UnidadRara']
  ])('valor pequeño no nulo: %s %s → es «%s», en «%s»', (value, unit, es, en) => {
    expect(formatUnit(value, unit, 'es')).toBe(es)
    expect(formatUnit(value, unit, 'en')).toBe(en)
  })

  it('Count (umbral 1) y Ratio (umbral 0,001) siguen la misma regla con sus decimales', () => {
    expect(formatUnit(0.3, 'Count', 'es')).toBe('< 1')
    expect(formatUnit(-0.3, 'Count', 'en')).toBe('> -1')
    expect(formatUnit(0, 'Count', 'es')).toBe('0')
    expect(formatUnit(0.0004, 'Ratio', 'es')).toBe('< 0,001')
    expect(formatUnit(0.0004, 'Ratio', 'en')).toBe('< 0.001')
    expect(formatUnit(-0.0004, 'Ratio', 'es')).toBe('> -0,001')
    expect(formatUnit(0, 'Ratio', 'en')).toBe('0')
  })

  it('el 0 exacto sigue siendo 0, y 0,005 ya redondea a 0,01', () => {
    expect(formatUnit(0, 'MilliSecond', 'es')).toBe('0 ms')
    expect(formatUnit(0, 'Percent', 'en')).toBe('0 %')
    expect(formatUnit(0, null, 'es')).toBe('0')
    expect(formatUnit(0.005, 'Percent', 'es')).toBe('0,01 %')
  })
})
