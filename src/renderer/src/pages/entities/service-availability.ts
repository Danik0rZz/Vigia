import type { EChartsCoreOption } from 'echarts/core'
import type { ServiceMetricsResult, ServiceSeries } from '@shared/modules'
import { resolutionMs } from '@shared/metric-points'
import { formatNumber } from '@shared/format-number'
import { axisTooltip, timeAxisLabel } from '../../components/chart-time'
import type { ServiceChartContext } from './service-charts'
import type { Level } from './EntityMarkers'

/**
 * Disponibilidad de un SERVICE calculada por Vigía (ficha 0048), no un SLO configurado en
 * Dynatrace: `(peticiones − errores) / peticiones × 100`, con las series de peticiones y errores
 * que ya trae `entities:serviceMetrics`. Umbral crítico fijo del 90 %.
 */
export const AVAILABILITY_CRITICAL = 90

/**
 * Disponibilidad de un par peticiones/errores, en % (0–100). Sin peticiones, o si falta alguno
 * de los dos, null (hueco, no 0). Con más errores que peticiones, 0.
 */
export function availabilityOf(requests: number | null, errors: number | null): number | null {
  if (requests === null || errors === null || !(requests > 0)) return null
  return Math.max(0, ((requests - errors) * 100) / requests)
}

/**
 * La disponibilidad de cada punto como `[tiempo, valor]`. Sin serie de errores (Solo actividad,
 * ficha 0047), sin puntos: ese conjunto no los mide.
 */
export function availabilityPoints(
  requests: ServiceSeries,
  errors: ServiceSeries | null
): [number, number | null][] {
  if (errors === null) return []
  return requests.timestamps.map((time, index) => [
    time,
    availabilityOf(requests.values[index] ?? null, errors.values[index] ?? null)
  ])
}

/** Disponibilidad del rango, de los totales; null en Solo actividad o sin peticiones. */
export function rangeAvailability(data: ServiceMetricsResult): number | null {
  if (data.series.errors === null) return null
  if (!data.series.requests.values.some((value) => value !== null)) return null
  return availabilityOf(data.totals.requests, data.totals.errors)
}

/**
 * Nivel del marcador «SLO» (ficha 0066): por debajo del umbral crítico, error; del 90 % para
 * arriba, éxito (sin franja intermedia, decidido por Dani); sin dato, sin color.
 */
export function availabilityLevel(value: number | null): Level {
  if (value === null) return 'normal'
  return value < AVAILABILITY_CRITICAL ? 'error' : 'success'
}

/** Si el servicio tiene disponibilidad que enseñar: hace falta la serie de errores. */
export function hasAvailability(data: ServiceMetricsResult): boolean {
  return data.series.errors !== null
}

/** Disponibilidad con un decimal, como la tasa de error de los marcadores («85,3 %»). */
export function formatAvailability(value: number, language: string): string {
  return formatNumber(value / 100, language, {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  })
}

/**
 * Mínimo del eje Y: 5 puntos por debajo del valor más bajo, redondeado a múltiplos de 5, entre
 * 0 y 85 (nunca por encima de 90, para que la línea del umbral quede dentro y se vea).
 */
function axisMin(points: [number, number | null][]): number {
  let lowest = 100
  for (const [, value] of points) if (value !== null && value < lowest) lowest = value
  return Math.max(0, Math.min(85, Math.floor(lowest / 5) * 5 - 5))
}

/**
 * Tramos seguidos de puntos por debajo del umbral, como pares `[desde, hasta]` del eje de tiempo:
 * medio paso antes del primero y medio después del último, para que un punto suelto se vea.
 */
function criticalRanges(points: [number, number | null][], step: number): [number, number][] {
  const ranges: [number, number][] = []
  let start: number | null = null
  let last = 0
  for (const [time, value] of points) {
    if (value !== null && value < AVAILABILITY_CRITICAL) {
      if (start === null) start = time
      last = time
    } else if (start !== null) {
      ranges.push([start - step / 2, last + step / 2])
      start = null
    }
  }
  if (start !== null) ranges.push([start - step / 2, last + step / 2])
  return ranges
}

/** Paso entre puntos: el de la resolución o, si no se reconoce, el de los propios puntos. */
function stepOf(data: ServiceMetricsResult): number {
  const step = resolutionMs(data.resolution)
  if (step !== null && step > 0) return step
  const [first, second] = data.series.requests.timestamps
  return first !== undefined && second !== undefined ? second - first : 60_000
}

/**
 * Opción de ECharts del gráfico de disponibilidad: una línea (sin unir huecos), la línea
 * horizontal discontinua del 90 % con su etiqueta y los tramos por debajo sombreados en el color
 * de error. Eje Y de 0–100 % con el mínimo ajustado; sin rejilla, como los demás (ficha 0012).
 */
export function availabilityChartOption(
  data: ServiceMetricsResult,
  context: ServiceChartContext
): EChartsCoreOption {
  const { colors, language, t, range } = context
  const points = availabilityPoints(data.series.requests, data.series.errors)
  const format = (value: number): string => formatAvailability(value, language)

  return {
    animation: false,
    grid: { left: 64, right: 96, top: 12, bottom: 28 },
    tooltip: axisTooltip(language, format),
    xAxis: {
      type: 'time',
      ...(range === undefined ? {} : { min: range.from, max: range.to }),
      axisLine: { lineStyle: { color: colors.border } },
      axisLabel: { color: colors.muted, ...timeAxisLabel(language, data.resolution) }
    },
    yAxis: {
      type: 'value',
      min: axisMin(points),
      max: 100,
      splitLine: { show: false },
      axisLabel: {
        color: colors.muted,
        formatter: (value: number) =>
          formatNumber(value / 100, language, { style: 'percent', maximumFractionDigits: 0 })
      }
    },
    series: [
      {
        type: 'line',
        name: t('entities.service.availability.series'),
        showSymbol: false,
        connectNulls: false,
        lineStyle: { color: colors.accent, width: 1.75 },
        itemStyle: { color: colors.accent },
        data: points,
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: { type: 'dashed', color: colors.danger, width: 1 },
          label: {
            position: 'end',
            color: colors.danger,
            formatter: t('entities.service.availability.critical')
          },
          data: [{ yAxis: AVAILABILITY_CRITICAL }]
        },
        markArea: {
          silent: true,
          itemStyle: { color: colors.danger, opacity: 0.15 },
          data: criticalRanges(points, stepOf(data)).map(([from, to]) => [
            { xAxis: from },
            { xAxis: to }
          ])
        }
      }
    ]
  }
}
