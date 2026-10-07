import type { EChartsCoreOption } from 'echarts/core'
import { formatNumber } from '@shared/format-number'
import type { MetricResult } from '@shared/modules'
import type { ChartColors } from '../../components/Chart'
import { axisTooltip, timeAxisLabel } from '../../components/chart-time'

/**
 * Opción de ECharts del gráfico de Métricas, sacada de `MetricChartPanel` para poder probarla
 * (ficha 0012: este gráfico conserva las líneas de rejilla; las quitan solo los del servicio).
 */
export function metricChartOption({
  series,
  names,
  resolution,
  language,
  colors
}: {
  series: MetricResult['series']
  /** Nombre de cada serie, en el mismo orden. */
  names: string[]
  /** Resolución que devolvió la API (no la pedida), para las etiquetas del eje X. */
  resolution: string | null
  language: string
  colors: ChartColors
}): EChartsCoreOption {
  return {
    animation: false,
    grid: { left: 48, right: 16, top: 24, bottom: 28 },
    tooltip: axisTooltip(language, (value) =>
      formatNumber(value, language, { maximumFractionDigits: 3 })
    ),
    legend: { show: series.length > 1, textStyle: { color: colors.muted }, top: 0 },
    xAxis: {
      type: 'time',
      axisLine: { lineStyle: { color: colors.border } },
      // Hora local, por niveles: la fecha en el cambio de día (y solo la fecha con puntos diarios).
      axisLabel: { color: colors.muted, ...timeAxisLabel(language, resolution) }
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: colors.border } },
      // Separador de miles siempre (ficha 0012): ECharts pondría comas también en español.
      axisLabel: {
        color: colors.muted,
        formatter: (value: number) => formatNumber(value, language)
      }
    },
    series: series.map((item, index) => ({
      type: 'line',
      name: names[index],
      showSymbol: false,
      data: item.timestamps.map((time, i) => [time, item.values[i] ?? null]),
      ...(index === 0
        ? { lineStyle: { color: colors.accent }, itemStyle: { color: colors.accent } }
        : {})
    }))
  }
}
