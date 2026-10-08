import type { TFunction } from 'i18next'
import type { EChartsCoreOption } from 'echarts/core'
import type { HostMetricsResult, HostSeries } from '@shared/modules'
import type { ChartColors } from '../../components/Chart'
import { axisTooltip, timeAxisLabel } from '../../components/chart-time'
import { formatBitRate, formatUsagePct } from '../../lib/host-format'

/**
 * Los cuatro gráficos de la página de un HOST (ficha 0018), sacados de la respuesta de
 * `entities:hostMetrics` (la misma que los marcadores, ficha 0016).
 */
export type HostChartKind = 'cpu' | 'memory' | 'network' | 'disk'

/** En el orden de la rejilla: CPU, memoria, red y disco. */
export const HOST_CHART_KINDS: readonly HostChartKind[] = ['cpu', 'memory', 'network', 'disk']

/** Una serie del gráfico: nombre, color, puntos y si es parte del desglose de la CPU. */
export interface HostChartSeries {
  name: string
  color: string
  points: [number, number | null][]
  /** `user`, `system` e `iowait`: línea discontinua y más fina que el total. */
  breakdown: boolean
}

/** Contexto común: colores del tema, idioma, textos y, si se conoce, el rango que se ve. */
export interface HostChartContext {
  colors: ChartColors
  language: string
  t: TFunction
  /** Rango visible (ms desde epoch); sin él, el eje se ajusta a los datos. */
  range?: { from: number; to: number } | undefined
}

/** Una serie como puntos `[tiempo, valor]`; un null sigue siendo null (hueco). */
function points(series: HostSeries): [number, number | null][] {
  return series.timestamps.map((time, index) => [time, series.values[index] ?? null])
}

/** Las series de un gráfico, en su unidad sin convertir (% en 0–100 o bits/s). */
export function hostChartSeries(
  kind: HostChartKind,
  data: HostMetricsResult,
  { colors, t }: Pick<HostChartContext, 'colors' | 't'>
): HostChartSeries[] {
  const name = (key: string): string => t(`entities.host.charts.series.${key}`)
  const line = (
    key: string,
    color: string,
    series: HostSeries,
    breakdown = false
  ): HostChartSeries => ({
    name: name(key),
    color,
    points: points(series),
    breakdown
  })
  const { series } = data
  switch (kind) {
    case 'cpu':
      return [
        line('total', colors.accent, series.cpu),
        line('user', colors.series2, series.cpuBreakdown.user, true),
        line('system', colors.series3, series.cpuBreakdown.system, true),
        line('iowait', colors.muted, series.cpuBreakdown.iowait, true)
      ]
    case 'memory':
      return [line('memory', colors.accent, series.memory)]
    case 'network':
      return [
        line('in', colors.accent, series.network.in),
        line('out', colors.series2, series.network.out)
      ]
    case 'disk':
      return [line('disk', colors.accent, series.disk)]
  }
}

/**
 * Opción de ECharts de uno de los cuatro gráficos. Todo son líneas que no unen los huecos
 * (null). El desglose de la CPU va **sin apilar** (decisión del Orquestador en la ficha 0018):
 * `user + system + iowait` no suma el total (hay más componentes) y apiladas parecerían un
 * reparto del total que no cuadra. CPU, memoria y disco van en un eje fijo de 0 a 100 %; la red,
 * en bits/s con la unidad adaptada. Mismos márgenes que el servicio: la franja de problemas se
 * alinea con ellos (`ProblemBand`).
 */
export function hostChartOption(
  kind: HostChartKind,
  data: HostMetricsResult,
  context: HostChartContext
): EChartsCoreOption {
  const { colors, language, range } = context
  const list = hostChartSeries(kind, data, context)
  const percent = kind !== 'network'
  const format = (value: number): string =>
    percent ? formatUsagePct(value, language) : formatBitRate(value, language)

  return {
    animation: false,
    grid: { left: 64, right: 16, top: list.length > 1 ? 28 : 12, bottom: 28 },
    tooltip: axisTooltip(language, format),
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
      ...(percent ? { max: 100 } : {}),
      // Sin líneas de rejilla (ficha 0012): se quedan las etiquetas y el eje X.
      splitLine: { show: false },
      axisLabel: { color: colors.muted, formatter: format }
    },
    series: list.map((item) => ({
      type: 'line',
      name: item.name,
      showSymbol: false,
      connectNulls: false,
      lineStyle: {
        color: item.color,
        width: item.breakdown ? 1.25 : 1.75,
        ...(item.breakdown ? { type: 'dashed' } : {})
      },
      itemStyle: { color: item.color },
      data: item.points
    }))
  }
}

/** Unidad de los valores de cada gráfico, para la exportación. */
export function hostChartUnit(kind: HostChartKind): string {
  return kind === 'network' ? 'bit/s' : '%'
}

/**
 * Filtro por el host en la dimensión `dt.entity.host` (la de todas estas métricas,
 * `docs/notas-api-v2.md`). El id llega ya validado (`hostEntityIdSchema`: HOST- y 16
 * hexadecimales), así que no puede cerrar la comilla ni el paréntesis.
 */
function scope(entityId: string): string {
  return `:filter(eq("dt.entity.host","${entityId}")):splitBy("dt.entity.host")`
}

/**
 * Consulta de Métricas de cada gráfico («Abrir en Métricas»): las mismas métricas que pide
 * main (`src/main/modules/host-metrics.ts`); red y disco, juntando interfaces y discos por
 * host con `sum` y `max`, como allí.
 */
export function hostChartSelector(kind: HostChartKind, entityId: string): string {
  const s = scope(entityId)
  switch (kind) {
    case 'cpu':
      return [
        `builtin:host.cpu.usage${s}`,
        `builtin:host.cpu.user${s}`,
        `builtin:host.cpu.system${s}`,
        `builtin:host.cpu.iowait${s}`
      ].join(',')
    case 'memory':
      return `builtin:host.mem.usage${s}`
    case 'network':
      return [
        `builtin:host.net.nic.trafficIn${s}:sum`,
        `builtin:host.net.nic.trafficOut${s}:sum`
      ].join(',')
    case 'disk':
      return `builtin:host.disk.usedPct${s}:max`
  }
}
