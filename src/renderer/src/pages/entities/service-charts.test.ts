import i18next, { type TFunction } from 'i18next'
import { beforeAll, describe, expect, it } from 'vitest'
import type { ServiceMetricsResult, ServiceSeries } from '@shared/modules'
import type { ChartColors } from '../../components/Chart'
import en from '../../locales/en/common.json'
import es from '../../locales/es/common.json'
import { serviceChartOption, type ServiceChartKind } from './service-charts'

/**
 * Ficha 0009: opciones de ECharts de los cuatro gráficos de la página de un SERVICE
 * (Tiempo de respuesta, Actividad, Tasa de error y Errores), sacadas de la respuesta de
 * `entities:serviceMetrics` (0006). Función pura: `serviceChartOption(kind, data, contexto)`
 * con los colores del tema, el idioma y `t`.
 *
 * Lo que fijan estos tests (la ficha no lo daba): las series van en el orden de la ficha
 * (mediana, p90, p99; OK, KO; tasa; KO); los puntos de cada serie, como `[tiempo, valor]` o como
 * valor suelto (se aceptan los dos); y la unidad del eje Y va en las etiquetas
 * (`yAxis.axisLabel.formatter`), como en Dynatrace («800 ms», «2K /min»).
 */

/** Colores inventados; `success` por si el tema añade el verde para OK. */
const COLORS = {
  foreground: '#111111',
  muted: '#555555',
  border: '#cccccc',
  accent: '#1f6feb',
  background: '#ffffff',
  danger: '#d1242f',
  success: '#1a7f37'
} as unknown as ChartColors

const T0 = Date.UTC(2026, 9, 3, 8, 0)
const MIN = 60_000

function series(values: (number | null)[], step = MIN): ServiceSeries {
  return { timestamps: values.map((_, i) => T0 + i * step), values }
}

/**
 * Respuesta de `entities:serviceMetrics` inventada: tiempos en ms y tasa en %, con un hueco
 * (null) en el tercer punto de todas las series.
 */
function metrics(
  overrides: {
    resolution?: string
    median?: (number | null)[]
    p90?: (number | null)[]
    p99?: (number | null)[]
    requests?: (number | null)[]
    errors?: (number | null)[]
    ok?: (number | null)[]
    errorRate?: (number | null)[]
  } = {}
): ServiceMetricsResult {
  const {
    resolution = '1m',
    median = [100, 120, null, 110],
    p90 = [300, 320, null, 310],
    p99 = [800, 850, null, 820],
    requests = [600, 300, null, 120],
    errors = [60, 0, null, 12],
    ok = [540, 300, null, 108],
    errorRate = [10, 0, null, 10]
  } = overrides
  return {
    resolution,
    // Campos de la ficha 0046 (un servicio de Servidor, como los de la 0009).
    serviceType: 'WEB_SERVICE',
    metricSet: 'server',
    metricKeys: {
      responseTime: 'builtin:service.response.server',
      requests: 'builtin:service.requestCount.server',
      errors: 'builtin:service.errors.server.count',
      errorRate: 'builtin:service.errors.server.rate'
    },
    series: {
      responseTime: { median: series(median), p90: series(p90), p99: series(p99) },
      requests: series(requests),
      errors: series(errors),
      ok: series(ok),
      errorRate: series(errorRate)
    },
    totals: {
      requests: 1020,
      errors: 72,
      ok: 948,
      errorRate: (72 / 1020) * 100,
      responseTime: { median: 110, p90: 310, p99: 820 }
    },
    warnings: [],
    partial: []
  }
}

const translators: Record<'es' | 'en', TFunction> = {} as Record<'es' | 'en', TFunction>
beforeAll(async () => {
  for (const [lng, messages] of [
    ['es', es],
    ['en', en]
  ] as const) {
    const instance = i18next.createInstance()
    await instance.init({
      lng,
      resources: { [lng]: { common: messages } },
      defaultNS: 'common',
      interpolation: { escapeValue: false }
    })
    translators[lng] = instance.getFixedT(lng)
  }
})

function optionOf(
  kind: ServiceChartKind,
  data: ServiceMetricsResult,
  language: 'es' | 'en' = 'es'
): Record<string, unknown> {
  return serviceChartOption(kind, data, {
    colors: COLORS,
    language,
    t: translators[language]
  }) as Record<string, unknown>
}

interface SeriesOption {
  type?: unknown
  name?: unknown
  stack?: unknown
  connectNulls?: unknown
  data?: unknown[]
}

function seriesOf(option: Record<string, unknown>): SeriesOption[] {
  const list = option['series']
  return (Array.isArray(list) ? list : [list]) as SeriesOption[]
}

/** El valor de un punto, esté como `[tiempo, valor]`, como `{ value }` o suelto. */
function pointValue(point: unknown): unknown {
  if (Array.isArray(point)) return point[1]
  if (point !== null && typeof point === 'object' && 'value' in point) {
    return pointValue((point as { value: unknown }).value)
  }
  return point
}

function valuesOf(item: SeriesOption | undefined): unknown[] {
  return (item?.data ?? []).map(pointValue)
}

/** Etiqueta del eje Y para `value`, con la plantilla o la función de su formatter. */
function yLabel(option: Record<string, unknown>, value: number): string {
  const raw = option['yAxis']
  const axis = (Array.isArray(raw) ? raw[0] : raw) as
    { axisLabel?: { formatter?: unknown } } | undefined
  const formatter = axis?.axisLabel?.formatter
  let text: string
  if (typeof formatter === 'function') {
    text = String((formatter as (value: number, index: number) => unknown)(value, 0))
  } else if (typeof formatter === 'string') {
    text = formatter.replace('{value}', String(value))
  } else {
    throw new Error('el eje Y no tiene formatter en axisLabel')
  }
  // Intl puede poner un espacio duro (U+00A0 o U+202F) delante de la unidad.
  return text.replace(/\s/g, ' ')
}

const KINDS: ServiceChartKind[] = ['responseTime', 'activity', 'errorRate', 'errors']

describe('CA2 (0009): Actividad apila OK y KO y va por minuto según la resolución', () => {
  it('dos series de barras, OK y después KO (encima), en el mismo stack', () => {
    const list = seriesOf(optionOf('activity', metrics()))
    expect(list).toHaveLength(2)
    const [okSeries, koSeries] = list
    expect(okSeries?.type).toBe('bar')
    expect(koSeries?.type).toBe('bar')
    expect(okSeries?.stack, 'OK lleva stack').toBeDefined()
    expect(okSeries?.stack).not.toBe('')
    expect(koSeries?.stack).toBe(okSeries?.stack)
    expect(String(okSeries?.name)).toMatch(/OK/)
    expect(String(koSeries?.name)).toMatch(/KO/)
  })

  it('con 1m, el valor tal cual (OK de la serie ok y KO de la de errores)', () => {
    const [okSeries, koSeries] = seriesOf(optionOf('activity', metrics({ resolution: '1m' })))
    expect(valuesOf(okSeries)).toEqual([540, 300, null, 108])
    expect(valuesOf(koSeries)).toEqual([60, 0, null, 12])
  })

  it('con 5m, el valor entre 5', () => {
    const [okSeries, koSeries] = seriesOf(optionOf('activity', metrics({ resolution: '5m' })))
    const ok = valuesOf(okSeries)
    const ko = valuesOf(koSeries)
    expect(ok[0]).toBeCloseTo(108)
    expect(ok[1]).toBeCloseTo(60)
    expect(ok[2]).toBeNull()
    expect(ok[3]).toBeCloseTo(21.6)
    expect(ko[0]).toBeCloseTo(12)
    expect(ko[1]).toBe(0)
    expect(ko[2]).toBeNull()
    expect(ko[3]).toBeCloseTo(2.4)
  })

  it('con 1h, el valor entre 60', () => {
    const [okSeries, koSeries] = seriesOf(optionOf('activity', metrics({ resolution: '1h' })))
    const ok = valuesOf(okSeries)
    const ko = valuesOf(koSeries)
    expect(ok[0]).toBeCloseTo(9)
    expect(ok[1]).toBeCloseTo(5)
    expect(ok[2]).toBeNull()
    expect(ok[3]).toBeCloseTo(1.8)
    expect(ko[0]).toBeCloseTo(1)
    expect(ko[1]).toBe(0)
    expect(ko[2]).toBeNull()
    expect(ko[3]).toBeCloseTo(0.2)
  })

  it('Errores también son barras por minuto (la ficha: «las barras se normalizan»)', () => {
    const list = seriesOf(optionOf('errors', metrics({ resolution: '5m' })))
    expect(list).toHaveLength(1)
    expect(list[0]?.type).toBe('bar')
    const ko = valuesOf(list[0])
    expect(ko[0]).toBeCloseTo(12)
    expect(ko[2]).toBeNull()
    expect(ko[3]).toBeCloseTo(2.4)
  })
})

describe('CA3 (0009): un null es un hueco (null en la opción), no un 0', () => {
  const expectedCounts: Record<ServiceChartKind, number> = {
    responseTime: 3,
    activity: 2,
    errorRate: 1,
    errors: 1
  }

  for (const kind of KINDS) {
    it(`${kind}: el tercer punto de cada serie sigue siendo null y los demás no`, () => {
      const list = seriesOf(optionOf(kind, metrics({ resolution: '5m' })))
      expect(list).toHaveLength(expectedCounts[kind])
      for (const [index, item] of list.entries()) {
        const values = valuesOf(item)
        expect(values, `${kind}[${index}]`).toHaveLength(4)
        expect(values[2], `${kind}[${index}] hueco`).toBeNull()
        for (const i of [0, 1, 3]) {
          expect(typeof values[i], `${kind}[${index}] punto ${i}`).toBe('number')
        }
        // Una línea no une el hueco.
        if (item.type === 'line') expect(item.connectNulls, `${kind}[${index}]`).not.toBe(true)
      }
    })
  }

  it('Tiempo de respuesta: mediana, p90 y p99 en ese orden, con sus valores en ms', () => {
    const list = seriesOf(optionOf('responseTime', metrics()))
    expect(list.map((item) => item.type)).toEqual(['line', 'line', 'line'])
    expect(String(list[0]?.name)).toMatch(/mediana/i)
    expect(String(list[1]?.name)).toMatch(/p90/i)
    expect(String(list[2]?.name)).toMatch(/p99/i)
    expect(valuesOf(list[0])).toEqual([100, 120, null, 110])
    expect(valuesOf(list[1])).toEqual([300, 320, null, 310])
    expect(valuesOf(list[2])).toEqual([800, 850, null, 820])
  })

  it('Tasa de error: una línea con el % tal cual (sin normalizar por minuto)', () => {
    const list = seriesOf(optionOf('errorRate', metrics({ resolution: '5m' })))
    expect(list.map((item) => item.type)).toEqual(['line'])
    expect(valuesOf(list[0])).toEqual([10, 0, null, 10])
  })

  it('una serie entera de null queda entera de null', () => {
    const empty = [null, null, null, null]
    const list = seriesOf(
      optionOf('activity', metrics({ requests: empty, errors: empty, ok: empty, errorRate: empty }))
    )
    for (const item of list) expect(valuesOf(item)).toEqual(empty)
  })
})

describe('CA4 (0009): unidades del eje Y, en es y en', () => {
  it('tiempos con el máximo por debajo de 1 s: en ms', () => {
    for (const language of ['es', 'en'] as const) {
      const option = optionOf('responseTime', metrics(), language)
      expect(yLabel(option, 800), language).toMatch(/^800 ?ms$/)
      expect(yLabel(option, 200), language).toMatch(/^200 ?ms$/)
    }
  })

  it('tiempos con el máximo de 1 s o más: en s, con la coma o el punto del idioma', () => {
    const slow = metrics({
      median: [800, 900, null, 850],
      p90: [1100, 1300, null, 1200],
      p99: [2400, 2600, null, 2500]
    })
    const esOption = optionOf('responseTime', slow, 'es')
    expect(yLabel(esOption, 1500)).toMatch(/^1,5 ?s$/)
    expect(yLabel(esOption, 2000)).toMatch(/^2(,0+)? ?s$/)
    expect(yLabel(esOption, 500)).toMatch(/^0,5 ?s$/)
    const enOption = optionOf('responseTime', slow, 'en')
    expect(yLabel(enOption, 1500)).toMatch(/^1\.5 ?s$/)
    expect(yLabel(enOption, 2000)).toMatch(/^2(\.0+)? ?s$/)
    expect(yLabel(enOption, 500)).toMatch(/^0\.5 ?s$/)
  })

  it('tasa de error en %', () => {
    expect(yLabel(optionOf('errorRate', metrics(), 'es'), 25)).toMatch(/^25(,0+)? ?%$/)
    expect(yLabel(optionOf('errorRate', metrics(), 'en'), 25)).toMatch(/^25(\.0+)? ?%$/)
    expect(yLabel(optionOf('errorRate', metrics(), 'es'), 0)).toMatch(/^0(,0+)? ?%$/)
  })

  it('las barras (Actividad y Errores) con «/min»', () => {
    for (const language of ['es', 'en'] as const) {
      for (const kind of ['activity', 'errors'] as const) {
        const option = optionOf(kind, metrics(), language)
        const label = yLabel(option, 2000)
        expect(label, `${kind} ${language}`).toMatch(/\d/)
        expect(label, `${kind} ${language}`).toMatch(/ ?\/min$/)
        expect(yLabel(option, 0), `${kind} ${language}`).toMatch(/^0 ?\/min$/)
      }
    }
  })
})

/**
 * Ficha 0012: los cuatro gráficos del servicio, sin líneas de rejilla en el eje Y. Se quedan las
 * etiquetas del eje Y y el eje X. (El gráfico de Métricas, en `metric-chart-option.test.ts`.)
 */
describe('CA1 (0012): sin líneas de rejilla en los gráficos del servicio', () => {
  it('CA1 (0012): yAxis.splitLine.show === false en los cuatro, con sus etiquetas y su eje X', () => {
    for (const kind of ['responseTime', 'activity', 'errorRate', 'errors'] as const) {
      const option = optionOf(kind, metrics())
      const yAxis = option['yAxis'] as {
        splitLine?: { show?: unknown }
        axisLabel?: { show?: unknown; formatter?: unknown }
      }
      expect(yAxis.splitLine?.show, kind).toBe(false)
      expect(yAxis.axisLabel?.show, kind).not.toBe(false)
      expect(typeof yAxis.axisLabel?.formatter, kind).toBe('function')
      const xAxis = option['xAxis'] as { show?: unknown; type?: unknown }
      expect(xAxis.show, kind).not.toBe(false)
      expect(xAxis.type, kind).toBe('time')
    }
  })
})
