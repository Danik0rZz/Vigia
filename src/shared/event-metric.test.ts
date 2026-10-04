import { describe, expect, it } from 'vitest'
import {
  CHART_RESOLUTIONS,
  MAX_EVENT_SELECTOR,
  METRIC_SELECTOR_KEY,
  METRIC_THRESHOLD_KEY,
  eventMetricInfo,
  eventMetricSchema,
  evidenceMetricRange,
  evidenceMetricState,
  parseLooseNumber,
  pickResolution,
  selectSeries
} from './event-metric'
import { estimatePoints } from './metric-points'
import { MAX_CUSTOM_RANGE_MS } from './time-range'

/**
 * v0.9.2: mini gráfico de la métrica de un EVENT que trae
 * dt.event.metric_selector. Selector y umbral, rango, intervalo, series que se
 * dibujan y qué decir si no se puede pintar. Selectores inventados, con
 * métricas builtin genéricas.
 */

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const NOW = Date.UTC(2026, 9, 4, 12, 0)
const SELECTOR = 'builtin:service.response.time:splitBy("dt.entity.service"):avg'

const prop = (key: unknown, value: unknown): { key?: unknown; value?: unknown } => ({ key, value })

describe('claves y límites', () => {
  it('las claves exactas de las propiedades y el máximo del selector', () => {
    expect(METRIC_SELECTOR_KEY).toBe('dt.event.metric_selector')
    expect(METRIC_THRESHOLD_KEY).toBe('dt.event.metric_threshold')
    expect(MAX_EVENT_SELECTOR).toBe(2000)
  })
})

describe('parseLooseNumber', () => {
  it.each([
    [85, 85],
    [-3.5, -3.5],
    [0, 0],
    ['85', 85],
    [' 85.5 ', 85.5],
    ['85,5', 85.5],
    ['1e-3', 0.001],
    ['2E3', 2000],
    ['85 %', 85],
    ['-12', -12],
    ['300ms', 300]
  ])('%j → %s', (value, expected) => {
    expect(parseLooseNumber(value)).toBe(expected)
  })

  it.each([
    ['basura', 'abc'],
    ['número al final', 'umbral 85'],
    ['vacío', ''],
    ['espacios', '   '],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['texto Infinity', 'Infinity'],
    ['desborda', '1e999'],
    ['null', null],
    ['undefined', undefined],
    ['objeto', { value: 85 }],
    ['booleano', true]
  ])('%s → null', (_label, value) => {
    expect(parseLooseNumber(value)).toBeNull()
  })
})

describe('eventMetricInfo', () => {
  it('con selector y umbral: ok, el selector sin espacios a los lados y el umbral como número', () => {
    expect(
      eventMetricInfo([
        prop('dt.event.title', 'Respuesta lenta'),
        prop(METRIC_SELECTOR_KEY, `  ${SELECTOR}\n`),
        prop(METRIC_THRESHOLD_KEY, '85,5'),
        prop('dt.event.description', 'x')
      ])
    ).toEqual({ status: 'ok', selector: SELECTOR, threshold: 85.5 })
  })

  it('el umbral solo si existe: sin él, o con basura, null (el selector sigue valiendo)', () => {
    expect(eventMetricInfo([prop(METRIC_SELECTOR_KEY, SELECTOR)])).toEqual({
      status: 'ok',
      selector: SELECTOR,
      threshold: null
    })
    expect(
      eventMetricInfo([prop(METRIC_SELECTOR_KEY, SELECTOR), prop(METRIC_THRESHOLD_KEY, 'alto')])
    ).toMatchObject({ status: 'ok', threshold: null })
    expect(
      eventMetricInfo([prop(METRIC_SELECTOR_KEY, SELECTOR), prop(METRIC_THRESHOLD_KEY, 90)])
    ).toMatchObject({ threshold: 90 })
  })

  it('sin la propiedad del selector → null (aunque haya umbral)', () => {
    expect(eventMetricInfo([])).toBeNull()
    expect(eventMetricInfo([prop(METRIC_THRESHOLD_KEY, '85')])).toBeNull()
  })

  it.each([
    ['mayúsculas', 'DT.EVENT.METRIC_SELECTOR'],
    ['con espacio', ' dt.event.metric_selector'],
    ['prefijo', 'dt.event.metric_selector.v2'],
    ['parecida', 'dt.event.metric.selector'],
    ['no es texto', 42]
  ])('clave exacta: %s → null', (_label, key) => {
    expect(eventMetricInfo([prop(key, SELECTOR)])).toBeNull()
  })

  it.each([
    ['vacío', ''],
    ['solo espacios', '   \n\t'],
    ['número', 42],
    ['null', null],
    ['objeto', { selector: SELECTOR }],
    ['ausente', undefined]
  ])('selector %s → null', (_label, value) => {
    expect(eventMetricInfo([prop(METRIC_SELECTOR_KEY, value)])).toBeNull()
  })

  it('el primero con la clave exacta gana', () => {
    expect(
      eventMetricInfo([prop(METRIC_SELECTOR_KEY, 'primero:x'), prop(METRIC_SELECTOR_KEY, 'otro:y')])
    ).toMatchObject({ selector: 'primero:x' })
  })

  it('2000 caracteres (tras trim) valen enteros; 2001 → tooLong, sin recortar nunca', () => {
    const exact = 'm'.repeat(2000)
    expect(eventMetricInfo([prop(METRIC_SELECTOR_KEY, `  ${exact}  `)])).toEqual({
      status: 'ok',
      selector: exact,
      threshold: null
    })
    const long = eventMetricInfo([
      prop(METRIC_SELECTOR_KEY, 'm'.repeat(2001)),
      prop(METRIC_THRESHOLD_KEY, '5')
    ])
    expect(long).toEqual({ status: 'tooLong' })
    // Ni rastro del selector en lo que cruza el IPC.
    expect(JSON.stringify(long)).not.toContain('mmm')
  })

  it('un selector de 600 caracteres llega entero (no es el recorte de 300 de la vista)', () => {
    const selector = `builtin:host.cpu.usage:filter(${'x'.repeat(560)}):avg`
    expect(selector.length).toBeGreaterThan(300)
    expect(eventMetricInfo([prop(METRIC_SELECTOR_KEY, selector)])).toMatchObject({ selector })
  })

  it('la salida cumple eventMetricSchema (ok y tooLong) y el esquema rechaza lo que no vale', () => {
    const ok = eventMetricInfo([prop(METRIC_SELECTOR_KEY, SELECTOR)])
    const tooLong = eventMetricInfo([prop(METRIC_SELECTOR_KEY, 'm'.repeat(2001))])
    expect(eventMetricSchema.safeParse(ok).success).toBe(true)
    expect(eventMetricSchema.safeParse(tooLong).success).toBe(true)
    expect(
      eventMetricSchema.safeParse({ status: 'ok', selector: '', threshold: null }).success
    ).toBe(false)
    expect(
      eventMetricSchema.safeParse({ status: 'ok', selector: 'm'.repeat(2001), threshold: null })
        .success
    ).toBe(false)
    expect(eventMetricSchema.safeParse({ status: 'otro' }).success).toBe(false)
  })
})

describe('evidenceMetricRange', () => {
  const problem = { startTime: NOW - 10 * HOUR }

  it('cerrada y corta: desde inicio − 30 min hasta fin + 15 min', () => {
    const start = NOW - 3 * HOUR
    const end = start + 10 * MIN
    expect(evidenceMetricRange({ start, end }, problem, NOW)).toEqual({
      from: start - 30 * MIN,
      to: end + 15 * MIN
    })
  })

  it('cerrada y larga: antes del inicio, tanto como dura', () => {
    const start = NOW - 10 * HOUR
    const end = start + 4 * HOUR
    expect(evidenceMetricRange({ start, end }, problem, NOW)).toEqual({
      from: start - 4 * HOUR,
      to: end + 15 * MIN
    })
  })

  it('activa: hasta ahora, y antes del inicio max(30 min, lo que lleva)', () => {
    const corta = NOW - 10 * MIN
    expect(evidenceMetricRange({ start: corta, end: 'ACTIVE' }, problem, NOW)).toEqual({
      from: corta - 30 * MIN,
      to: NOW
    })
    const larga = NOW - 2 * HOUR
    expect(evidenceMetricRange({ start: larga, end: 'ACTIVE' }, problem, NOW)).toEqual({
      from: larga - 2 * HOUR,
      to: NOW
    })
  })

  it('fin + 15 min no pasa de ahora', () => {
    const start = NOW - HOUR
    expect(evidenceMetricRange({ start, end: NOW - 5 * MIN }, problem, NOW).to).toBe(NOW)
  })

  it('sin inicio de la evidencia: el del problema', () => {
    expect(evidenceMetricRange({ start: null, end: 'ACTIVE' }, problem, NOW)).toEqual({
      from: problem.startTime - 10 * HOUR,
      to: NOW
    })
  })

  it('inicio en el futuro (from ≥ to): la última hora', () => {
    expect(evidenceMetricRange({ start: NOW + HOUR, end: 'ACTIVE' }, problem, NOW)).toEqual({
      from: NOW - HOUR,
      to: NOW
    })
  })

  it('más de un año: from = to − 1 año exacto', () => {
    const start = NOW - 400 * DAY
    const range = evidenceMetricRange({ start, end: 'ACTIVE' }, problem, NOW)
    expect(range).toEqual({ from: NOW - MAX_CUSTOM_RANGE_MS, to: NOW })
  })

  it.each([
    ['cerrada corta', { start: NOW - HOUR, end: NOW - 50 * MIN }],
    ['cerrada larga', { start: NOW - 30 * DAY, end: NOW - 20 * DAY }],
    ['activa', { start: NOW - 5 * MIN, end: 'ACTIVE' as const }],
    ['futura', { start: NOW + DAY, end: 'ACTIVE' as const }],
    ['fin antes del inicio', { start: NOW - HOUR, end: NOW - 2 * HOUR }],
    ['eterna', { start: 0, end: 'ACTIVE' as const }]
  ])(
    'siempre un rango válido para Métricas (%s): from < to ≤ ahora, como mucho un año',
    (_l, ev) => {
      const { from, to } = evidenceMetricRange(ev, problem, NOW)
      expect(from).toBeLessThan(to)
      expect(to).toBeLessThanOrEqual(NOW)
      expect(to - from).toBeLessThanOrEqual(MAX_CUSTOM_RANGE_MS)
    }
  )
})

describe('pickResolution', () => {
  it.each([
    [2 * HOUR, '1m'],
    [199 * MIN, '1m'],
    [200 * MIN, '5m'],
    [24 * HOUR, '10m'],
    [7 * DAY, '1h'],
    [30 * DAY, '6h'],
    [100 * DAY, '1d']
  ])('%s ms → %s', (span, expected) => {
    expect(pickResolution(NOW - span, NOW)).toBe(expected)
  })

  it('el mínimo es 1m, también con un rango de 0 o al revés', () => {
    expect(pickResolution(NOW, NOW)).toBe('1m')
    expect(pickResolution(NOW, NOW - HOUR)).toBe('1m')
  })

  it('con un año entero no hay intervalo de ≤ 200 puntos: el más grueso, 1d', () => {
    expect(pickResolution(NOW - MAX_CUSTOM_RANGE_MS, NOW)).toBe('1d')
  })

  it('siempre un intervalo de la lista; el más fino que no pasa de 200 puntos', () => {
    for (const span of [1, 30 * MIN, 5 * HOUR, 3 * DAY, 14 * DAY, 60 * DAY, 200 * DAY]) {
      const step = pickResolution(NOW - span, NOW)
      expect(CHART_RESOLUTIONS).toContain(step)
      const index = CHART_RESOLUTIONS.indexOf(step as (typeof CHART_RESOLUTIONS)[number])
      if (step !== '1d') expect(estimatePoints(span, step)).toBeLessThanOrEqual(200)
      // El anterior (más fino) se habría pasado.
      if (index > 0) {
        expect(estimatePoints(span, CHART_RESOLUTIONS[index - 1])).toBeGreaterThan(200)
      }
    }
  })

  it('en los rangos típicos, unos 150 puntos (entre 100 y 200)', () => {
    for (const span of [2 * HOUR, 24 * HOUR, 7 * DAY]) {
      const points = estimatePoints(span, pickResolution(NOW - span, NOW))
      expect(points).toBeGreaterThanOrEqual(100)
      expect(points).toBeLessThanOrEqual(200)
    }
  })
})

describe('selectSeries', () => {
  const series = (n: number): { id: number; dimensions: Record<string, string> }[] =>
    Array.from({ length: n }, (_, i) => ({
      id: i,
      dimensions: { 'dt.entity.service': `SERVICE-${i}` }
    }))

  it('la serie de la entidad va la primera (highlighted 0); las demás, en su orden', () => {
    const result = selectSeries(series(5), 'SERVICE-3')
    expect(result.shown.map((s) => s.id)).toEqual([3, 0, 1, 2, 4])
    expect(result.highlighted).toBe(0)
    expect(result.total).toBe(5)
  })

  it('como mucho 10 (por defecto) y el total; la de la entidad entra aunque esté más allá', () => {
    const result = selectSeries(series(25), 'SERVICE-20')
    expect(result.shown).toHaveLength(10)
    expect(result.total).toBe(25)
    expect(result.shown[0]?.id).toBe(20)
    expect(result.shown.slice(1).map((s) => s.id)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('max propio', () => {
    expect(selectSeries(series(5), null, 2).shown.map((s) => s.id)).toEqual([0, 1])
  })

  it('sin entidad o sin coincidencia: el orden original y highlighted null', () => {
    expect(selectSeries(series(3), null)).toMatchObject({ highlighted: null, total: 3 })
    const none = selectSeries(series(12), 'HOST-1')
    expect(none.shown.map((s) => s.id)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(none.highlighted).toBeNull()
  })

  it('busca el id en cualquier dimensión, no solo dt.entity.*; si hay varias, la primera', () => {
    const list: { dimensions: Record<string, string> }[] = [
      { dimensions: { 'dt.entity.host': 'HOST-1' } },
      { dimensions: { otra: 'HOST-9', 'dt.entity.host': 'HOST-2' } },
      { dimensions: { 'dt.entity.process_group': 'HOST-9' } }
    ]
    const result = selectSeries(list, 'HOST-9')
    expect(result.shown[0]).toBe(list[1])
    expect(result.shown).toEqual([list[1], list[0], list[2]])
  })

  it('el id ha de coincidir entero (no por subcadena) y en un valor, no en una clave', () => {
    const list = [{ dimensions: { 'SERVICE-1': 'x', a: 'SERVICE-10' } }]
    expect(selectSeries(list, 'SERVICE-1').highlighted).toBeNull()
  })

  it('sin series: vacío; no muta la lista de entrada', () => {
    expect(selectSeries([], 'SERVICE-1')).toEqual({ shown: [], total: 0, highlighted: null })
    const input = series(4)
    const copy = structuredClone(input)
    selectSeries(input, 'SERVICE-2', 2)
    expect(input).toEqual(copy)
  })
})

describe('evidenceMetricState', () => {
  it.each([
    [{ code: 'BAD_REQUEST' }, 5, 'incompatible'],
    [{ code: 'FORBIDDEN' }, 0, 'forbidden'],
    [{ code: 'SERVER_ERROR' }, 0, 'error'],
    [{ code: 'NETWORK' }, 3, 'error'],
    [{ code: 'NOT_FOUND' }, 0, 'error'],
    [null, 0, 'noData'],
    [null, 1, null],
    [null, 25, null]
  ] as const)('error %j y %s series → %s', (error, count, expected) => {
    expect(evidenceMetricState(error, count)).toBe(expected)
  })
})
