import type { TFunction } from 'i18next'
import type { EChartsCoreOption } from 'echarts/core'
import type { ServiceMetricsResult, ServiceSeries } from '@shared/modules'
import { resolutionMs } from '@shared/metric-points'
import type { ChartColors } from '../../components/Chart'
import { axisTooltip, timeAxisLabel } from '../../components/chart-time'
import { formatDurationMs } from '../../lib/service-format'
import { formatNumber } from '@shared/format-number'

/**
 * Los cuatro gráficos de la página de un SERVICE (ficha 0009), sacados de la
 * respuesta de `entities:serviceMetrics` (la misma que los marcadores, 0006).
 */
export type ServiceChartKind = 'responseTime' | 'activity' | 'errorRate' | 'errors'

/** En el orden de la rejilla: tiempos, actividad, tasa de error y errores. */
export const SERVICE_CHART_KINDS: readonly ServiceChartKind[] = [
  'responseTime',
  'activity',
  'errorRate',
  'errors'
]

/** El nombre del gráfico en los testids y en `data-kind` (`response-time`…). */
export function serviceChartSlug(kind: ServiceChartKind): string {
  return kind.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
}

const MINUTE_MS = 60_000

/**
 * Minutos que cubre cada punto según la resolución que devolvió la API (`5m` → 5,
 * `1h` → 60). Lo que no se reconoce (por ejemplo, `Inf`) cuenta como 1: el valor tal cual.
 */
export function minutesPerPoint(resolution: string): number {
  const step = resolutionMs(resolution)
  return step === null || step <= 0 ? 1 : step / MINUTE_MS
}

/** Una serie como puntos `[tiempo, valor]`; un null sigue siendo null (hueco). */
function points(series: ServiceSeries, divisor = 1): [number, number | null][] {
  return series.timestamps.map((time, index) => {
    const value = series.values[index] ?? null
    return [time, value === null ? null : value / divisor]
  })
}

/** Una serie del gráfico: nombre, puntos, color y unidad para la exportación. */
export interface ServiceChartSeries {
  name: string
  color: string
  points: [number, number | null][]
}

/** Contexto común: colores del tema, idioma, textos y, si se conoce, el rango que se ve. */
export interface ServiceChartContext {
  colors: ChartColors
  language: string
  t: TFunction
  /** Rango visible (ms desde epoch); sin él, el eje se ajusta a los datos. */
  range?: { from: number; to: number } | undefined
}

/** Las series de un gráfico, ya en su unidad (ms, % o peticiones por minuto). */
export function serviceChartSeries(
  kind: ServiceChartKind,
  data: ServiceMetricsResult,
  { colors, t }: Pick<ServiceChartContext, 'colors' | 't'>
): ServiceChartSeries[] {
  const name = (key: string): string => t(`entities.service.charts.series.${key}`)
  const minutes = minutesPerPoint(data.resolution)
  const { series } = data
  switch (kind) {
    case 'responseTime':
      return [
        { name: name('median'), color: colors.accent, points: points(series.responseTime.median) },
        { name: name('p90'), color: colors.series2, points: points(series.responseTime.p90) },
        { name: name('p99'), color: colors.series3, points: points(series.responseTime.p99) }
      ]
    case 'activity':
      return [
        { name: name('ok'), color: colors.success, points: points(series.ok, minutes) },
        { name: name('ko'), color: colors.danger, points: points(series.errors, minutes) }
      ]
    case 'errorRate':
      return [{ name: name('errorRate'), color: colors.accent, points: points(series.errorRate) }]
    case 'errors':
      return [{ name: name('ko'), color: colors.danger, points: points(series.errors, minutes) }]
  }
}

/** Número con el formato del idioma y separador de miles siempre (ficha 0012). */
function formatDigits(value: number, language: string, maximumFractionDigits: number): string {
  return formatNumber(value, language, { maximumFractionDigits })
}

/** Máximo de los puntos con dato (0 si no hay ninguno). */
function maxOf(list: ServiceChartSeries[]): number {
  let max = 0
  for (const item of list) {
    for (const [, value] of item.points) if (value !== null && value > max) max = value
  }
  return max
}

/** Etiqueta del eje Y de tiempos: en ms o, si el máximo llega a 1 s, en s. */
function timeAxisFormatter(max: number, language: string): (value: number) => string {
  if (max >= 1000) return (value) => `${formatDigits(value / 1000, language, 2)} s`
  return (value) => `${formatDigits(value, language, 0)} ms`
}

/** Tasa de error (llega en %, 0–100). */
function formatPercent(value: number, language: string, digits: number): string {
  return formatNumber(value / 100, language, {
    style: 'percent',
    maximumFractionDigits: digits
  })
}

/** Peticiones por minuto, abreviadas como en Dynatrace («2K /min»). */
function formatPerMinute(value: number, language: string, unit: string): string {
  const short = formatNumber(value, language, {
    notation: 'compact',
    maximumFractionDigits: 1
  })
  return `${short} ${unit}`
}

/**
 * Opción de ECharts de uno de los cuatro gráficos. Las líneas no unen los huecos
 * (null); las barras se dan en peticiones por minuto y el tooltip añade el total del
 * intervalo; la unidad del eje Y va en sus etiquetas.
 */
export function serviceChartOption(
  kind: ServiceChartKind,
  data: ServiceMetricsResult,
  context: ServiceChartContext
): EChartsCoreOption {
  const { colors, language, t, range } = context
  const list = serviceChartSeries(kind, data, context)
  const bars = kind === 'activity' || kind === 'errors'
  const minutes = minutesPerPoint(data.resolution)
  const perMinuteUnit = t('entities.service.charts.perMinuteUnit')

  const yFormatter: (value: number) => string =
    kind === 'responseTime'
      ? timeAxisFormatter(maxOf(list), language)
      : kind === 'errorRate'
        ? (value) => formatPercent(value, language, 1)
        : (value) => formatPerMinute(value, language, perMinuteUnit)

  const tooltipValue: (value: number) => string =
    kind === 'responseTime'
      ? (value) => formatDurationMs(value, language)
      : kind === 'errorRate'
        ? (value) => formatPercent(value, language, 2)
        : (value) =>
            t('entities.service.charts.perMinuteTooltip', {
              perMinute: `${formatDigits(value, language, 2)} ${perMinuteUnit}`,
              total: formatDigits(value * minutes, language, 0)
            })

  return {
    animation: false,
    grid: { left: 64, right: 16, top: list.length > 1 ? 28 : 12, bottom: 28 },
    tooltip: axisTooltip(language, tooltipValue),
    // La leyenda se pulsa para ocultar series (lo hace ECharts).
    legend: {
      show: list.length > 1,
      top: 0,
      textStyle: { color: colors.muted },
      inactiveColor: colors.border
    },
    xAxis: {
      type: 'time',
      ...(range === undefined ? {} : { min: range.from, max: range.to }),
      axisLine: { lineStyle: { color: colors.border } },
      axisLabel: { color: colors.muted, ...timeAxisLabel(language, data.resolution) }
    },
    yAxis: {
      type: 'value',
      min: 0,
      // Sin líneas de rejilla (ficha 0012): se quedan las etiquetas y el eje X.
      splitLine: { show: false },
      axisLabel: { color: colors.muted, formatter: yFormatter }
    },
    series: list.map((item) =>
      bars
        ? {
            type: 'bar',
            name: item.name,
            // Actividad: KO encima de OK, en la misma pila.
            ...(kind === 'activity' ? { stack: 'requests' } : {}),
            barMaxWidth: 24,
            itemStyle: { color: item.color },
            data: item.points
          }
        : {
            type: 'line',
            name: item.name,
            showSymbol: false,
            connectNulls: false,
            lineStyle: { color: item.color, width: 1.75 },
            itemStyle: { color: item.color },
            data: item.points
          }
    )
  }
}

/** Unidad de los valores de cada gráfico, para la exportación. */
export function serviceChartUnit(kind: ServiceChartKind, t: TFunction): string {
  if (kind === 'responseTime') return 'ms'
  if (kind === 'errorRate') return '%'
  return t('entities.service.charts.perMinuteUnit')
}

/**
 * Filtro por el servicio, el mismo que usa main en `entities:serviceMetrics`. El id
 * llega ya validado (`serviceEntityIdSchema`: SERVICE- y 16 hexadecimales), así que
 * no puede cerrar la comilla ni el paréntesis.
 */
function scope(entityId: string): string {
  return `:filter(eq("dt.entity.service","${entityId}")):splitBy("dt.entity.service")`
}

/** Consulta de Métricas de cada gráfico («Abrir en Métricas»). */
export function serviceChartSelector(kind: ServiceChartKind, entityId: string): string {
  const s = scope(entityId)
  switch (kind) {
    case 'responseTime':
      return [
        `builtin:service.response.server${s}:median`,
        `builtin:service.response.server${s}:percentile(90.0)`,
        `builtin:service.response.server${s}:percentile(99.0)`
      ].join(',')
    case 'activity':
      return [
        `builtin:service.requestCount.server${s}`,
        `builtin:service.errors.server.count${s}`
      ].join(',')
    case 'errorRate':
      return `builtin:service.errors.server.rate${s}`
    case 'errors':
      return `builtin:service.errors.server.count${s}`
  }
}
