import i18next, { type TFunction } from 'i18next'
import { beforeAll, describe, expect, it } from 'vitest'
import type { ServiceMetricsResult, ServiceSeries } from '@shared/modules'
import type { ChartColors } from '../../components/Chart'
import en from '../../locales/en/common.json'
import es from '../../locales/es/common.json'
import {
  AVAILABILITY_CRITICAL,
  availabilityChartOption,
  availabilityLevel,
  availabilityOf,
  availabilityPoints
} from './service-availability'

/**
 * Ficha 0048: disponibilidad (SLO calculado por Vigía) de la página de un SERVICE, a partir de
 * las series de peticiones y errores de `entities:serviceMetrics`:
 * `(peticiones − errores) / peticiones × 100`, con un umbral crítico del 90 %.
 *
 * Lo que fijan estos tests (la ficha no lo daba): el módulo `service-availability.ts` con
 * `availabilityPoints(peticiones, errores)` (puntos `[tiempo, valor]`, null como hueco),
 * `availabilityOf(peticiones, errores)` (el valor de un par de totales), la constante
 * `AVAILABILITY_CRITICAL` (90) y `availabilityChartOption(data, contexto)`, con el mismo contexto
 * que los gráficos de la 0009 (colores, idioma, `t` y rango).
 */

const COLORS = {
  foreground: '#111111',
  muted: '#555555',
  border: '#cccccc',
  accent: '#1f6feb',
  background: '#ffffff',
  danger: '#d1242f',
  success: '#1a7f37',
  series2: '#8250df',
  series3: '#bf8700',
  series4: '#0a7f8f',
  series5: '#cf222e'
} satisfies ChartColors

const T0 = Date.UTC(2026, 9, 3, 8, 0)
const MIN = 60_000

function series(values: (number | null)[]): ServiceSeries {
  return { timestamps: values.map((_, i) => T0 + i * MIN), values }
}

/** Respuesta inventada de un servicio de Servidor con las peticiones y errores dados. */
function metrics(requests: (number | null)[], errors: (number | null)[]): ServiceMetricsResult {
  const total = (list: (number | null)[]): number =>
    list.reduce<number>((sum, value) => sum + (value ?? 0), 0)
  const totalRequests = total(requests)
  const totalErrors = total(errors)
  return {
    resolution: '1m',
    serviceType: 'WEB_SERVICE',
    metricSet: 'server',
    metricKeys: {
      responseTime: 'builtin:service.response.server',
      requests: 'builtin:service.requestCount.server',
      errors: 'builtin:service.errors.server.count',
      errorRate: 'builtin:service.errors.server.rate'
    },
    series: {
      responseTime: {
        median: series(requests.map(() => 100)),
        p90: series(requests.map(() => 300)),
        p99: series(requests.map(() => 800))
      },
      requests: series(requests),
      errors: series(errors),
      ok: series(requests.map((value, i) => (value === null ? null : value - (errors[i] ?? 0)))),
      errorRate: series(requests.map(() => 0))
    },
    totals: {
      requests: totalRequests,
      errors: totalErrors,
      ok: Math.max(0, totalRequests - totalErrors),
      errorRate: totalRequests > 0 ? (totalErrors * 100) / totalRequests : null,
      responseTime: { median: 100, p90: 300, p99: 800 }
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
  data: ServiceMetricsResult,
  language: 'es' | 'en' = 'es'
): Record<string, unknown> {
  return availabilityChartOption(data, {
    colors: COLORS,
    language,
    t: translators[language]
  }) as Record<string, unknown>
}

interface MarkEntry {
  xAxis?: unknown
  yAxis?: unknown
}

interface LineSeries {
  type?: unknown
  name?: unknown
  data?: unknown[]
  markLine?: {
    data?: unknown[]
    lineStyle?: { type?: unknown }
    label?: { formatter?: unknown }
  }
  markArea?: { data?: unknown[]; itemStyle?: { color?: unknown } }
}

function seriesOf(option: Record<string, unknown>): LineSeries[] {
  const list = option['series']
  return (Array.isArray(list) ? list : [list]) as LineSeries[]
}

function yAxisOf(option: Record<string, unknown>): Record<string, unknown> {
  const axis = option['yAxis']
  return (Array.isArray(axis) ? axis[0] : axis) as Record<string, unknown>
}

/** Las entradas de markLine aplanadas (una entrada puede ser `{ yAxis }` o un par). */
function markLineEntries(item: LineSeries): MarkEntry[] {
  return (item.markLine?.data ?? []).flatMap((entry) =>
    Array.isArray(entry) ? (entry as MarkEntry[]) : [entry as MarkEntry]
  )
}

/** Los tramos de markArea como `[desde, hasta]` en el eje de tiempo. */
function markAreaRanges(item: LineSeries): [number, number][] {
  return (item.markArea?.data ?? []).map((entry) => {
    const [from, to] = entry as [MarkEntry, MarkEntry]
    return [Number(from.xAxis), Number(to.xAxis)]
  })
}

describe('CA1 (0048): disponibilidad punto a punto', () => {
  it('(peticiones − errores) / peticiones × 100 en cada punto, con su tiempo', () => {
    const points = availabilityPoints(series([200, 100, 50]), series([2, 0, 10]))
    expect(points).toHaveLength(3)
    expect(points.map(([time]) => time)).toEqual([T0, T0 + MIN, T0 + 2 * MIN])
    expect(points[0]?.[1]).toBeCloseTo(99)
    expect(points[1]?.[1]).toBeCloseTo(100)
    expect(points[2]?.[1]).toBeCloseTo(80)
  })

  it('peticiones 0 o null, o errores null, dan null (hueco, no 0)', () => {
    const points = availabilityPoints(series([0, null, 40, 10]), series([0, 3, null, 1]))
    expect(points.map(([, value]) => value)).toEqual([null, null, null, 90])
  })

  it('con más errores que peticiones, nunca menos de 0', () => {
    const points = availabilityPoints(series([10, 5]), series([15, 5]))
    expect(points.map(([, value]) => value)).toEqual([0, 0])
  })

  it('sin serie de errores (Solo actividad), sin puntos', () => {
    expect(availabilityPoints(series([10, 5]), null)).toEqual([])
  })

  it('el valor del rango sale de los totales igual', () => {
    expect(availabilityOf(150, 14)).toBeCloseTo((136 / 150) * 100)
    expect(availabilityOf(0, 0)).toBeNull()
    expect(availabilityOf(10, null)).toBeNull()
    expect(availabilityOf(10, 20)).toBe(0)
  })
})

describe('CA2 (0048): opción de ECharts con el umbral del 90 % y los tramos por debajo', () => {
  it('el umbral es el 90 %', () => {
    expect(AVAILABILITY_CRITICAL).toBe(90)
  })

  it('una sola línea de disponibilidad con los puntos calculados y sin unir los huecos', () => {
    const option = optionOf(metrics([200, 100, null, 50], [2, 0, null, 10]))
    const list = seriesOf(option)
    expect(list).toHaveLength(1)
    const line = list[0] as LineSeries & { connectNulls?: unknown }
    expect(line.type).toBe('line')
    expect(line.connectNulls).not.toBe(true)
    const values = (line.data ?? []).map((point) =>
      Array.isArray(point) ? (point[1] as unknown) : point
    )
    expect(values[0]).toBeCloseTo(99)
    expect(values[2]).toBeNull()
    expect(values[3]).toBeCloseTo(80)
  })

  it('lleva una línea horizontal discontinua en el 90 % con su etiqueta «Crítico 90 %»', () => {
    const option = optionOf(metrics([200, 100, 50], [2, 0, 10]))
    const line = seriesOf(option)[0] as LineSeries
    const entries = markLineEntries(line)
    expect(entries.some((entry) => entry.yAxis === 90)).toBe(true)
    expect(entries.some((entry) => entry.xAxis !== undefined)).toBe(false)
    expect(line.markLine?.lineStyle?.type).toBe('dashed')
    expect(JSON.stringify(line.markLine)).toMatch(/Crítico 90\s?%/)
    // En inglés, su texto.
    const english = seriesOf(optionOf(metrics([200, 100, 50], [2, 0, 10]), 'en'))[0] as LineSeries
    expect(JSON.stringify(english.markLine)).toMatch(/Critical 90\s?%/)
  })

  it('sombrea en el color de error los tramos por debajo del 90 % y solo esos', () => {
    // 99 %, 100 %, 80 %, 70 %, 95 %: el tramo bajo es el de los puntos 2 y 3.
    const option = optionOf(metrics([100, 100, 100, 100, 100], [1, 0, 20, 30, 5]))
    const line = seriesOf(option)[0] as LineSeries
    const ranges = markAreaRanges(line)
    expect(ranges).toHaveLength(1)
    const [from, to] = ranges[0] as [number, number]
    expect(from).toBeLessThanOrEqual(T0 + 2 * MIN)
    expect(to).toBeGreaterThanOrEqual(T0 + 3 * MIN)
    // No cubre los puntos que están por encima.
    expect(from).toBeGreaterThan(T0 + MIN)
    expect(to).toBeLessThan(T0 + 4 * MIN)
    expect(line.markArea?.itemStyle?.color).toBe(COLORS.danger)
  })

  it('sin puntos por debajo del 90 %, sin tramos sombreados', () => {
    const line = seriesOf(optionOf(metrics([100, 100], [1, 0])))[0] as LineSeries
    expect(markAreaRanges(line)).toHaveLength(0)
  })

  it('eje de 0 a 100 % con el mínimo ajustado que nunca pasa de 90 y sin rejilla', () => {
    for (const [requests, errors] of [
      [
        [100, 100],
        [0, 0]
      ],
      [
        [1000, 1000],
        [1, 5]
      ],
      [
        [100, 100],
        [3, 9]
      ]
    ] as const) {
      const axis = yAxisOf(optionOf(metrics([...requests], [...errors])))
      expect(axis['max']).toBe(100)
      expect(typeof axis['min']).toBe('number')
      expect(axis['min'] as number).toBeLessThanOrEqual(90)
      expect(axis['min'] as number).toBeGreaterThanOrEqual(0)
      expect((axis['splitLine'] as { show?: unknown } | undefined)?.show).toBe(false)
    }
    // Con una caída fuerte, el mínimo baja hasta enseñarla.
    const deep = yAxisOf(optionOf(metrics([100, 100], [0, 60])))
    expect(deep['min'] as number).toBeLessThanOrEqual(40)
    // Con todo alto, el eje no empieza en 0: se ve la variación.
    const high = yAxisOf(optionOf(metrics([1000, 1000], [1, 5])))
    expect(high['min'] as number).toBeGreaterThan(0)
  })

  it('tooltip de eje (fecha y hora) y eje X de tiempo', () => {
    const option = optionOf(metrics([200, 100], [2, 0]))
    const tooltip = option['tooltip'] as { trigger?: unknown } | undefined
    expect(tooltip?.trigger).toBe('axis')
    const xAxis = option['xAxis'] as { type?: unknown }
    expect(xAxis.type).toBe('time')
  })
})

/**
 * Ficha 0066: el marcador «SLO» colorea la disponibilidad del rango con `availabilityLevel`
 * (un `Level` de `EntityMarkers.tsx`): error por debajo del 90 %, éxito del 90 % para arriba y
 * sin color (`normal`) sin dato.
 */
describe('CA1 (0066): nivel de la disponibilidad del marcador', () => {
  it('por debajo del 90 %, error', () => {
    expect(availabilityLevel(89.9)).toBe('error')
    expect(availabilityLevel(0)).toBe('error')
    expect(availabilityLevel(AVAILABILITY_CRITICAL - 0.01)).toBe('error')
  })

  it('en el 90 % justo y por encima, éxito', () => {
    expect(availabilityLevel(90)).toBe('success')
    expect(availabilityLevel(95.5)).toBe('success')
    expect(availabilityLevel(100)).toBe('success')
  })

  it('sin dato, sin color', () => {
    expect(availabilityLevel(null)).toBe('normal')
  })
})
