import type { TFunction } from 'i18next'
import type { EChartsCoreOption } from 'echarts/core'
import type { MonitorKind, MonitorMetricsResult, MonitorSeries } from '@shared/modules'
import { formatNumber } from '@shared/format-number'
import type { ChartColors } from '../../components/Chart'
import { axisTooltip, timeAxisLabel } from '../../components/chart-time'
import { formatDurationMs } from '../../lib/service-format'

/**
 * Los gráficos de las páginas de browser monitor y HTTP monitor (ficha 0024), sacados de la
 * respuesta de `entities:monitorMetrics` (la misma que los marcadores, ficha 0022). Los dos tipos
 * comparten gráficos; cambia el cuarto: rendimiento (browser) o tiempos HTTP.
 */
export type MonitorChartKind = 'availability' | 'duration' | 'executions' | 'performance'

/** En el orden de la rejilla: disponibilidad, duración, ejecuciones y rendimiento. */
export const MONITOR_CHART_KINDS: readonly MonitorChartKind[] = [
  'availability',
  'duration',
  'executions',
  'performance'
]

/** Una serie del gráfico: nombre, color y puntos. */
export interface MonitorChartSeries {
  name: string
  color: string
  points: [number, number | null][]
}

/** Contexto común: colores del tema, idioma, textos y, si se conoce, el rango que se ve. */
export interface MonitorChartContext {
  colors: ChartColors
  language: string
  t: TFunction
  /** Rango visible (ms desde epoch); sin él, el eje se ajusta a los datos. */
  range?: { from: number; to: number } | undefined
}

/** Una serie como puntos `[tiempo, valor]`; un null sigue siendo null (hueco). */
function points(series: MonitorSeries): [number, number | null][] {
  return series.timestamps.map((time, index) => [time, series.values[index] ?? null])
}

/**
 * Las series del cuarto gráfico, ya con su nombre. En browser, LCP, visually complete y speed
 * index: el CLS no es un tiempo (sin unidad, valores de 0 a 1) y en el mismo eje de ms quedaría
 * pegado al cero, así que no se pinta (decisión del developer, anotada en la ficha 0024). En HTTP,
 * los cuatro tiempos (DNS, TCP, TLS y primer byte), todos en ms.
 */
function performanceSeries(
  data: MonitorMetricsResult,
  colors: ChartColors,
  name: (key: string) => string
): MonitorChartSeries[] {
  const { performance, httpTimings } = data.series
  if (performance !== null) {
    return [
      {
        name: name('lcp'),
        color: colors.accent,
        points: points(performance.largestContentfulPaint)
      },
      {
        name: name('visuallyComplete'),
        color: colors.series2,
        points: points(performance.visuallyComplete)
      },
      { name: name('speedIndex'), color: colors.series3, points: points(performance.speedIndex) }
    ]
  }
  if (httpTimings !== null) {
    return [
      { name: name('dns'), color: colors.accent, points: points(httpTimings.dns) },
      { name: name('tcp'), color: colors.series2, points: points(httpTimings.tcpConnect) },
      { name: name('tls'), color: colors.series3, points: points(httpTimings.tlsHandshake) },
      { name: name('ttfb'), color: colors.muted, points: points(httpTimings.timeToFirstByte) }
    ]
  }
  return []
}

/** Las series de un gráfico, en su unidad sin convertir (% en 0–100, ms o recuento). */
export function monitorChartSeries(
  kind: MonitorChartKind,
  data: MonitorMetricsResult,
  { colors, t }: Pick<MonitorChartContext, 'colors' | 't'>
): MonitorChartSeries[] {
  const name = (key: string): string => t(`entities.monitor.charts.series.${key}`)
  const { series } = data
  switch (kind) {
    case 'availability':
      return [
        { name: name('availability'), color: colors.accent, points: points(series.availability) }
      ]
    case 'duration':
      return [{ name: name('duration'), color: colors.accent, points: points(series.duration) }]
    case 'executions':
      return [
        { name: name('ok'), color: colors.success, points: points(series.executions.ok) },
        { name: name('failed'), color: colors.danger, points: points(series.executions.failed) }
      ]
    case 'performance':
      return performanceSeries(data, colors, name)
  }
}

/**
 * ¿Se pinta el gráfico? Los tres primeros, siempre. El de rendimiento, solo si el papel tiene
 * métrica en el tipo (no `null`) y, con los datos ya cargados, alguna de sus series trae puntos:
 * si no hay ninguna, la rejilla queda en tres (ficha 0024). Mientras carga o si falla, se pinta
 * (con su esqueleto o su aviso): todavía no se sabe.
 */
export function monitorChartShown(
  kind: MonitorChartKind,
  monitorKind: MonitorKind,
  data: MonitorMetricsResult | undefined
): boolean {
  if (kind !== 'performance') return true
  if (data === undefined) return true
  const role = monitorKind === 'browser' ? data.series.performance : data.series.httpTimings
  if (role === null) return false
  return Object.values(role).some((series) => series.timestamps.length > 0)
}

/** Máximo de los puntos con dato (0 si no hay ninguno). */
function maxOf(list: MonitorChartSeries[]): number {
  let max = 0
  for (const item of list) {
    for (const [, value] of item.points) if (value !== null && value > max) max = value
  }
  return max
}

/** Etiqueta del eje Y de tiempos: en ms o, si el máximo llega a 1 s, en s. */
function timeAxisFormatter(max: number, language: string): (value: number) => string {
  if (max >= 1000) {
    return (value) => `${formatNumber(value / 1000, language, { maximumFractionDigits: 2 })} s`
  }
  return (value) => `${formatNumber(value, language, { maximumFractionDigits: 0 })} ms`
}

/** Disponibilidad (llega en %, 0–100) con los decimales que se pidan. */
function formatPercent(value: number, language: string, digits: number): string {
  return formatNumber(value / 100, language, { style: 'percent', maximumFractionDigits: digits })
}

/**
 * Opción de ECharts de uno de los gráficos. Disponibilidad, duración y rendimiento son líneas que
 * no unen los huecos (null); la disponibilidad, en un eje fijo de 0 a 100 %. Las ejecuciones van
 * en barras apiladas: correctas (verde) y fallidas (rojo) encima, en recuento por intervalo. Sin
 * líneas de rejilla (ficha 0012) y con los márgenes del servicio: la franja de problemas se alinea
 * con ellos (`ProblemBand`).
 */
export function monitorChartOption(
  kind: MonitorChartKind,
  data: MonitorMetricsResult,
  context: MonitorChartContext
): EChartsCoreOption {
  const { colors, language, range } = context
  const list = monitorChartSeries(kind, data, context)
  const bars = kind === 'executions'

  const axisFormat: (value: number) => string =
    kind === 'availability'
      ? (value) => formatPercent(value, language, 0)
      : kind === 'executions'
        ? (value) => formatNumber(value, language, { maximumFractionDigits: 0 })
        : timeAxisFormatter(maxOf(list), language)
  const tooltipFormat: (value: number) => string =
    kind === 'availability'
      ? (value) => formatPercent(value, language, 1)
      : kind === 'executions'
        ? (value) => formatNumber(value, language, { maximumFractionDigits: 0 })
        : (value) => formatDurationMs(value, language)

  return {
    animation: false,
    grid: { left: 64, right: 16, top: list.length > 1 ? 28 : 12, bottom: 28 },
    tooltip: axisTooltip(language, tooltipFormat),
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
      ...(kind === 'availability' ? { max: 100 } : {}),
      ...(bars ? { minInterval: 1 } : {}),
      // Sin líneas de rejilla (ficha 0012): se quedan las etiquetas y el eje X.
      splitLine: { show: false },
      axisLabel: { color: colors.muted, formatter: axisFormat }
    },
    series: list.map((item) =>
      bars
        ? {
            type: 'bar',
            name: item.name,
            // Fallidas encima de correctas, en la misma pila.
            stack: 'executions',
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
export function monitorChartUnit(kind: MonitorChartKind, t: TFunction): string {
  if (kind === 'availability') return '%'
  if (kind === 'executions') return t('entities.monitor.charts.executionsUnit')
  return 'ms'
}

const B = 'builtin:synthetic.browser.'
const H = 'builtin:synthetic.http.'
const BROWSER_SPLIT = ':splitBy("dt.entity.synthetic_test")'
const HTTP_SPLIT = ':splitBy("dt.entity.http_check")'

/**
 * Consulta de Métricas de cada gráfico («Abrir en Métricas»): las mismas expresiones que pide main
 * (`src/main/modules/monitor-metrics.ts`), con el filtro por el monitor justo detrás de la clave.
 * Main acota con `entitySelector=entityId(...)`, pero la página de Métricas solo recibe el
 * selector: sin el filtro saldrían todos los monitores. El filtro va por la dimensión del monitor
 * (`dt.entity.synthetic_test` o `dt.entity.http_check`, la de los `splitBy` del canal); en las de
 * estado de HTTP se junta con el de «Result status» en un `and`. El id llega ya validado
 * (`monitorEntityIdSchema`): no puede cerrar la comilla ni el paréntesis.
 */
export function monitorChartSelector(
  kind: MonitorChartKind,
  monitorKind: MonitorKind,
  entityId: string
): string {
  if (monitorKind === 'browser') {
    const own = `:filter(eq("dt.entity.synthetic_test","${entityId}"))`
    switch (kind) {
      case 'availability':
        return `${B}availability.location.total${own}${BROWSER_SPLIT}:avg`
      case 'duration':
        return `${B}totalDuration${own}:avg`
      case 'executions':
        return [`${B}success${own}`, `${B}failure${own}`].join(',')
      case 'performance':
        return [
          `${B}largestContentfulPaint.load${own}:avg`,
          `${B}visuallyComplete.load${own}:avg`,
          `${B}speedIndex.load${own}:avg`
        ].join(',')
    }
  }
  const own = `eq("dt.entity.http_check","${entityId}")`
  const filtered = `:filter(${own})`
  const status = (value: 'SUCCESS' | 'FAILURE'): string =>
    `${H}resultStatus:filter(and(eq("Result status","${value}"),${own}))${HTTP_SPLIT}:sum`
  switch (kind) {
    case 'availability':
      return `${H}availability.location.total${filtered}${HTTP_SPLIT}:avg`
    case 'duration':
      return `${H}duration.geo${filtered}${HTTP_SPLIT}:avg`
    case 'executions':
      return [status('SUCCESS'), status('FAILURE')].join(',')
    case 'performance':
      return [
        `${H}dns.geo${filtered}${HTTP_SPLIT}:avg`,
        `${H}tcpConnectTime.geo${filtered}${HTTP_SPLIT}:avg`,
        `${H}tlsHandshakeTime.geo${filtered}${HTTP_SPLIT}:avg`,
        `${H}timeToFirstByte.geo${filtered}${HTTP_SPLIT}:avg`
      ].join(',')
  }
}
