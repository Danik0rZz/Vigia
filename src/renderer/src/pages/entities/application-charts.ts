import type { TFunction } from 'i18next'
import type { EChartsCoreOption } from 'echarts/core'
import type { ApplicationMetricsResult, ServiceSeries } from '@shared/modules'
import { formatNumber } from '@shared/format-number'
import type { ChartColors } from '../../components/Chart'
import { axisTooltip, timeAxisLabel } from '../../components/chart-time'
import { formatApdex } from '../../lib/application-format'
import { formatDurationMs } from '../../lib/service-format'

/**
 * Gráficos de la página de una aplicación web, APPLICATION (ficha 0034), sacados de la respuesta
 * de `entities:applicationMetrics` (ficha 0033, la misma llamada que los marcadores y la tabla).
 * Apdex y duración, en línea; acciones y errores, en barras (un valor por intervalo, tal como
 * llega). Puras: el componente pone React.
 */
export type ApplicationChartKind = 'apdex' | 'actions' | 'duration' | 'errors'

/** En el orden de la rejilla de 2×2: Apdex, acciones, duración y errores. */
export const APPLICATION_CHART_KINDS: readonly ApplicationChartKind[] = [
  'apdex',
  'actions',
  'duration',
  'errors'
]

/**
 * ¿Trae datos el papel? En el canal de la 0033 todos los papeles tienen métrica y uno sin datos
 * llega con la serie vacía (o solo huecos) y el total null: su marcador y su gráfico no se
 * pintan (CA3 de la ficha, con la lectura del test-writer).
 */
export function roleHasData(data: ApplicationMetricsResult, role: ApplicationChartKind): boolean {
  if (data.totals[role] !== null) return true
  return data.series[role].values.some((value) => value !== null)
}

/** Una serie del gráfico: nombre, color y puntos. */
export interface ApplicationChartSeries {
  name: string
  color: string
  points: [number, number | null][]
}

/** Contexto común: colores del tema, idioma, textos y, si se conoce, el rango que se ve. */
export interface ApplicationChartContext {
  colors: ChartColors
  language: string
  t: TFunction
  /** Rango visible (ms desde epoch); sin él, el eje se ajusta a los datos. */
  range?: { from: number; to: number } | undefined
}

function points(series: ServiceSeries): [number, number | null][] {
  return series.timestamps.map((time, index) => [time, series.values[index] ?? null])
}

/** La serie de un gráfico (una por gráfico), con su nombre y su color. */
export function applicationChartSeries(
  kind: ApplicationChartKind,
  data: ApplicationMetricsResult,
  { colors, t }: Pick<ApplicationChartContext, 'colors' | 't'>
): ApplicationChartSeries[] {
  return [
    {
      name: t(`entities.application.charts.series.${kind}`),
      color: kind === 'errors' ? colors.danger : colors.accent,
      points: points(data.series[kind])
    }
  ]
}

/** Formato de los valores (eje y tooltip) de cada gráfico. */
function valueFormatter(kind: ApplicationChartKind, language: string): (value: number) => string {
  switch (kind) {
    case 'apdex':
      return (value) => formatApdex(value, language)
    case 'duration':
      return (value) => formatDurationMs(value, language)
    default:
      return (value) => formatNumber(value, language, { maximumFractionDigits: 0 })
  }
}

/**
 * Opción de ECharts de un gráfico: sin líneas de rejilla y con los márgenes de las demás páginas
 * (la franja de problemas se alinea con ellos). El Apdex, de 0 a 1.
 */
export function applicationChartOption(
  kind: ApplicationChartKind,
  list: ApplicationChartSeries[],
  resolution: string,
  context: ApplicationChartContext
): EChartsCoreOption {
  const { colors, language, range } = context
  const format = valueFormatter(kind, language)
  const bars = kind === 'actions' || kind === 'errors'
  return {
    animation: false,
    grid: { left: 64, right: 16, top: 12, bottom: 28 },
    tooltip: axisTooltip(language, format),
    xAxis: {
      type: 'time',
      ...(range === undefined ? {} : { min: range.from, max: range.to }),
      axisLine: { lineStyle: { color: colors.border } },
      axisLabel: { color: colors.muted, ...timeAxisLabel(language, resolution) }
    },
    yAxis: {
      type: 'value',
      min: 0,
      ...(kind === 'apdex' ? { max: 1 } : {}),
      // Sin líneas de rejilla (ficha 0012): se quedan las etiquetas y el eje X.
      splitLine: { show: false },
      axisLabel: { color: colors.muted, formatter: format }
    },
    series: list.map((item) =>
      bars
        ? {
            type: 'bar',
            name: item.name,
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
export function applicationChartUnit(kind: ApplicationChartKind, t: TFunction): string {
  switch (kind) {
    case 'apdex':
      return 'Apdex'
    case 'duration':
      return 'ms'
    default:
      return t(`entities.application.charts.units.${kind}`)
  }
}

const W = 'builtin:apps.web.'

/** Expresión de cada gráfico, la misma métrica y agregación que usa main (ficha 0033). */
const EXPRESSIONS: Record<ApplicationChartKind, [string, string]> = {
  apdex: [`${W}apdex.userType`, 'avg'],
  actions: [`${W}actionCount.summary`, 'sum'],
  duration: [`${W}visuallyComplete.load.browser`, 'avg'],
  errors: [`${W}countOfErrors`, 'sum']
}

/**
 * Consulta de Métricas de cada gráfico («Abrir en Métricas» y exportación). Métricas solo recibe
 * el selector: la aplicación va en un `:filter(eq("dt.entity.application",…))` (la dimensión que
 * la 0033 vio en el catálogo), como el servicio con la suya. El id llega ya validado
 * (`applicationEntityIdSchema`), así que no puede cerrar las comillas ni el paréntesis.
 */
export function applicationChartSelector(kind: ApplicationChartKind, entityId: string): string {
  const [metric, aggregation] = EXPRESSIONS[kind]
  return `${metric}:filter(eq("dt.entity.application","${entityId}")):splitBy():${aggregation}`
}
