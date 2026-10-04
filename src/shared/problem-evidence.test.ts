import { describe, expect, it } from 'vitest'
import {
  NOT_AVAILABLE,
  changeOf,
  countByType,
  evidenceWireSchema,
  formatUnit,
  groupEvidence,
  toEvidenceView,
  type EvidenceView,
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
    data: null,
    ...overrides
  }
}

/** Vista mínima para probar el agrupado sin depender de toEvidenceView. */
function view(
  name: string,
  start: number | null,
  group: string | null,
  rootCause = false
): EvidenceView {
  const entity = group === null ? null : { id: group, label: group, type: 'SERVICE' }
  return {
    ...toEvidenceView(wire({ displayName: name, startTime: start, rootCauseRelevant: rootCause })),
    entity,
    group: entity
  }
}

const names = (items: readonly EvidenceView[]): string[] => items.map((item) => item.displayName)

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

  it('sin groupingEntity, el grupo es la entidad; con ella, la groupingEntity', () => {
    const plain = toEvidenceView(wire())
    expect(plain.group).toEqual({ id: 'SERVICE-1', label: 'pagos', type: 'SERVICE' })
    const grouped = toEvidenceView(
      wire({ groupingEntity: { id: 'PROCESS_GROUP-1', name: null, type: 'PROCESS_GROUP' } })
    )
    expect(grouped.group).toEqual({
      id: 'PROCESS_GROUP-1',
      label: 'PROCESS_GROUP-1',
      type: 'PROCESS_GROUP'
    })
    expect(grouped.entity?.id).toBe('SERVICE-1')
  })

  it('sin entidad ni groupingEntity: entity y group null', () => {
    const result = toEvidenceView(wire({ entity: null }))
    expect(result.entity).toBeNull()
    expect(result.group).toBeNull()
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
    expect(result.event).toEqual({ eventType: 'PROCESS_RESTART', properties, metric: null })
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

describe('groupEvidence', () => {
  it('la causa raíz va arriba, en orden cronológico, y no se repite en los grupos', () => {
    const result = groupEvidence([
      view('a', 30, 'S-1'),
      view('raíz tarde', 50, 'S-1', true),
      view('raíz pronto', 10, 'S-2', true),
      view('b', 20, 'S-2')
    ])
    expect(names(result.rootCause)).toEqual(['raíz pronto', 'raíz tarde'])
    const grouped = result.byEntity.flatMap((group) => names(group.items))
    expect(grouped).toEqual(['b', 'a'])
    expect(grouped).not.toContain('raíz pronto')
    expect(grouped).not.toContain('raíz tarde')
  })

  it('agrupa por entidad, cada grupo en orden cronológico con start null al final', () => {
    const result = groupEvidence([
      view('s1-sin-hora', null, 'S-1'),
      view('s1-tarde', 300, 'S-1'),
      view('s1-pronto', 100, 'S-1')
    ])
    expect(result.byEntity).toHaveLength(1)
    expect(result.byEntity[0]?.entity?.id).toBe('S-1')
    expect(names(result.byEntity[0]?.items ?? [])).toEqual(['s1-pronto', 's1-tarde', 's1-sin-hora'])
  })

  it('los grupos se ordenan por su primera evidencia', () => {
    const result = groupEvidence([
      view('c', 500, 'S-C'),
      view('a2', 400, 'S-A'),
      view('b', 200, 'S-B'),
      view('a1', 100, 'S-A')
    ])
    expect(result.byEntity.map((group) => group.entity?.id)).toEqual(['S-A', 'S-B', 'S-C'])
    expect(names(result.byEntity[0]?.items ?? [])).toEqual(['a1', 'a2'])
  })

  it('un empate conserva el orden de entrada (en grupos y dentro de un grupo)', () => {
    const groups = groupEvidence([view('y', 100, 'S-Y'), view('x', 100, 'S-X')])
    expect(groups.byEntity.map((group) => group.entity?.id)).toEqual(['S-Y', 'S-X'])
    const items = groupEvidence([view('primera', 100, 'S-1'), view('segunda', 100, 'S-1')])
    expect(names(items.byEntity[0]?.items ?? [])).toEqual(['primera', 'segunda'])
  })

  it('un grupo con todas las horas null va detrás de los que tienen hora', () => {
    const result = groupEvidence([view('sin', null, 'S-0'), view('con', 900, 'S-9')])
    expect(result.byEntity.map((group) => group.entity?.id)).toEqual(['S-9', 'S-0'])
  })

  it('las evidencias sin entidad van juntas en un grupo con entity null', () => {
    const result = groupEvidence([
      view('suelta-1', 10, null),
      view('con', 20, 'S-1'),
      view('suelta-2', 30, null)
    ])
    expect(result.byEntity).toHaveLength(2)
    const loose = result.byEntity.find((group) => group.entity === null)
    expect(names(loose?.items ?? [])).toEqual(['suelta-1', 'suelta-2'])
  })

  it('agrupa por group.id (groupingEntity), no por la entidad', () => {
    const a = toEvidenceView(
      wire({
        displayName: 'a',
        entity: { id: 'SERVICE-1', name: null, type: 'SERVICE' },
        groupingEntity: { id: 'PG-1', name: 'grupo', type: 'PROCESS_GROUP' }
      })
    )
    const b = toEvidenceView(
      wire({
        displayName: 'b',
        entity: { id: 'SERVICE-2', name: null, type: 'SERVICE' },
        groupingEntity: { id: 'PG-1', name: 'grupo', type: 'PROCESS_GROUP' }
      })
    )
    const result = groupEvidence([a, b])
    expect(result.byEntity).toHaveLength(1)
    expect(result.byEntity[0]?.entity?.label).toBe('grupo')
  })

  it('sin evidencias: todo vacío; solo causa raíz: sin grupos', () => {
    expect(groupEvidence([])).toEqual({ rootCause: [], byEntity: [] })
    expect(groupEvidence([view('r', 1, 'S-1', true)]).byEntity).toEqual([])
  })

  it('ninguna se pierde ni se duplica, y no muta la lista de entrada', () => {
    const input = Array.from({ length: 300 }, (_, i) =>
      view(`ev-${i}`, (i * 7919) % 1000, `S-${i % 13}`, i % 50 === 0)
    )
    const copy = names(input)
    const result = groupEvidence(input)
    const all = [...result.rootCause, ...result.byEntity.flatMap((group) => group.items)]
    expect(all).toHaveLength(300)
    expect(new Set(names(all)).size).toBe(300)
    expect(names(input)).toEqual(copy)
  })
})

describe('countByType', () => {
  it('cuenta todas las recibidas, también la causa raíz y los tipos desconocidos', () => {
    const views = [
      toEvidenceView(wire({ evidenceType: 'EVENT' })),
      toEvidenceView(wire({ evidenceType: 'EVENT', rootCauseRelevant: true })),
      toEvidenceView(wire({ evidenceType: 'METRIC' })),
      toEvidenceView(wire({ evidenceType: 'TIPO_NUEVO_DE_DYNATRACE' }))
    ]
    expect(countByType(views)).toEqual({ EVENT: 2, METRIC: 1, TIPO_NUEVO_DE_DYNATRACE: 1 })
    expect(countByType([])).toEqual({})
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
