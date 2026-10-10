import type { TFunction } from 'i18next'
import type { EChartsCoreOption } from 'echarts/core'
import type { ApplicationRumResult, ServiceSeries } from '@shared/modules'
import { formatNumber } from '@shared/format-number'
import type { ChartColors } from '../../components/Chart'
import { axisTooltip, timeAxisLabel } from '../../components/chart-time'
import { formatDurationMs, formatErrorRate } from '../../lib/service-format'
import type { ApplicationChartContext, ApplicationChartSeries } from './application-charts'

/**
 * Secciones «Actividad» y «Errores» de la página de una aplicación web (ficha 0053), sacadas de
 * la respuesta de `entities:applicationRum` (ficha 0052, la misma llamada que los marcadores de
 * usuarios, sesiones, acciones y errores). Acciones y errores por tipo, en barras apiladas;
 * duración por tipo y acciones afectadas, en línea. Un tipo sin datos no tiene serie (custom y
 * «otros» no traen datos en vivo). Puras: el componente pone React.
 */
export type RumChartKind = 'actionsByType' | 'durationByType' | 'errorsByType' | 'affectedActions'

export type ActionType = 'load' | 'xhr' | 'custom'
export type ErrorType = 'javascript' | 'http' | 'other'

export const ACTION_TYPES: readonly ActionType[] = ['load', 'xhr', 'custom']
export const ERROR_TYPES: readonly ErrorType[] = ['javascript', 'http', 'other']

/** Los gráficos de cada sección, en su orden. */
export const RUM_SECTION_CHARTS = {
  activity: ['actionsByType', 'durationByType'],
  errors: ['errorsByType', 'affectedActions']
} as const satisfies Record<string, readonly RumChartKind[]>

/** ¿Trae datos? Con total o con algún punto; serie vacía (o solo huecos) y total null, no. */
export function hasData(series: ServiceSeries, total: number | null): boolean {
  return total !== null || series.values.some((value) => value !== null)
}

/** Tipos de acción con datos en el papel (recuento o duración), en su orden. */
export function actionTypesWithData(
  data: ApplicationRumResult,
  role: 'actionsByType' | 'durationByType'
): ActionType[] {
  return ACTION_TYPES.filter((type) => hasData(data.series[role][type], data.totals[role][type]))
}

/** Tipos de error con datos, en su orden. */
export function errorTypesWithData(data: ApplicationRumResult): ErrorType[] {
  return ERROR_TYPES.filter((type) =>
    hasData(data.series.errorsByType[type], data.totals.errorsByType[type])
  )
}

/**
 * ¿Se pueden separar los errores por tipo? No, si JavaScript y HTTP llegan sin datos y todo
 * está en «otros»: el canal los pone ahí cuando llegan sin «Error type» (lectura del
 * test-writer, ficha 0053). Que solo falte HTTP es que no hubo errores HTTP.
 */
export function errorsSeparated(data: ApplicationRumResult): boolean {
  const types = errorTypesWithData(data)
  return types.length === 0 || types.some((type) => type !== 'other')
}

/** Suma de los totales con dato; null si ninguno lo tiene (nunca un 0 inventado). */
export function sumTotals(values: readonly (number | null)[]): number | null {
  const known = values.filter((value): value is number => value !== null)
  return known.length === 0 ? null : known.reduce((sum, value) => sum + value, 0)
}

/** ¿Tiene datos el gráfico? Si no, no se pinta (CA4 de la ficha). */
export function rumChartHasData(data: ApplicationRumResult, kind: RumChartKind): boolean {
  switch (kind) {
    case 'actionsByType':
    case 'durationByType':
      return actionTypesWithData(data, kind).length > 0
    case 'errorsByType':
      return errorTypesWithData(data).length > 0
    case 'affectedActions':
      return hasData(data.series.affectedActionsPct, data.totals.affectedActionsPct)
  }
}

function points(series: ServiceSeries): [number, number | null][] {
  return series.timestamps.map((time, index) => [time, series.values[index] ?? null])
}

function actionColor(type: ActionType, colors: ChartColors): string {
  return { load: colors.accent, xhr: colors.series2, custom: colors.series3 }[type]
}

function errorColor(type: ErrorType, colors: ChartColors): string {
  return { javascript: colors.danger, http: colors.series4, other: colors.series5 }[type]
}

/** Las series del gráfico, con su nombre y su color; solo las de los tipos con datos. */
export function rumChartSeries(
  kind: RumChartKind,
  data: ApplicationRumResult,
  { colors, t }: Pick<ApplicationChartContext, 'colors' | 't'>
): ApplicationChartSeries[] {
  const name = (key: string): string => t(`entities.application.charts.series.${key}`)
  switch (kind) {
    case 'actionsByType':
    case 'durationByType':
      return actionTypesWithData(data, kind).map((type) => ({
        name: name(type),
        color: actionColor(type, colors),
        points: points(data.series[kind][type])
      }))
    case 'errorsByType':
      if (!errorsSeparated(data)) {
        // Sin separar: una sola serie, en el color de error, con la nota en el panel.
        return [
          {
            name: name('errors'),
            color: colors.danger,
            points: points(data.series.errorsByType.other)
          }
        ]
      }
      return errorTypesWithData(data).map((type) => ({
        name: name(type),
        color: errorColor(type, colors),
        points: points(data.series.errorsByType[type])
      }))
    case 'affectedActions':
      return [
        {
          name: name('affectedActions'),
          color: colors.danger,
          points: points(data.series.affectedActionsPct)
        }
      ]
  }
}

/** Formato de los valores (eje y tooltip) de cada gráfico. */
function valueFormatter(kind: RumChartKind, language: string): (value: number) => string {
  switch (kind) {
    case 'durationByType':
      return (value) => formatDurationMs(value, language)
    case 'affectedActions':
      return (value) => formatErrorRate(value, language)
    default:
      return (value) => formatNumber(value, language, { maximumFractionDigits: 0 })
  }
}

/**
 * Opción de ECharts: sin líneas de rejilla, con los márgenes de las demás páginas (la franja de
 * problemas se alinea con ellos) y la leyenda con más de una serie. Acciones y errores, barras
 * apiladas; el % de acciones afectadas, de 0 a 100.
 */
export function rumChartOption(
  kind: RumChartKind,
  list: ApplicationChartSeries[],
  resolution: string,
  context: ApplicationChartContext
): EChartsCoreOption {
  const { colors, language, range } = context
  const format = valueFormatter(kind, language)
  const bars = kind === 'actionsByType' || kind === 'errorsByType'
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
      axisLabel: { color: colors.muted, ...timeAxisLabel(language, resolution) }
    },
    yAxis: {
      type: 'value',
      min: 0,
      ...(kind === 'affectedActions' ? { max: 100 } : {}),
      // Sin líneas de rejilla (ficha 0012): se quedan las etiquetas y el eje X.
      splitLine: { show: false },
      axisLabel: { color: colors.muted, formatter: format }
    },
    series: list.map((item) =>
      bars
        ? {
            type: 'bar',
            name: item.name,
            stack: kind,
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
export function rumChartUnit(kind: RumChartKind, t: TFunction): string {
  switch (kind) {
    case 'actionsByType':
      return t('entities.application.charts.units.actions')
    case 'durationByType':
      return 'ms'
    case 'errorsByType':
      return t('entities.application.charts.units.errors')
    case 'affectedActions':
      return '%'
  }
}

const W = 'builtin:apps.web.'

/**
 * Consulta de Métricas de cada gráfico («Abrir en Métricas» y exportación), con las métricas y
 * agregaciones de main (ficha 0052), una expresión por tipo pintado (todos mientras no hay
 * datos). La aplicación va en un `:filter(eq("dt.entity.application",…))`, como en la 0034; el
 * id llega ya validado (`applicationEntityIdSchema`).
 */
export function rumChartSelector(
  kind: RumChartKind,
  entityId: string,
  data: ApplicationRumResult | undefined
): string {
  const filter = `:filter(eq("dt.entity.application","${entityId}"))`
  switch (kind) {
    case 'actionsByType':
    case 'durationByType': {
      const shown = data === undefined ? [] : actionTypesWithData(data, kind)
      const [metric, aggregation] =
        kind === 'actionsByType' ? ['actionCount', 'sum'] : ['actionDuration', 'avg']
      return (shown.length === 0 ? ACTION_TYPES : shown)
        .map((type) => `${W}${metric}.${type}.browser${filter}:splitBy():${aggregation}`)
        .join(',')
    }
    case 'errorsByType':
      return `${W}countOfErrors${filter}:splitBy("Error type"):sum`
    case 'affectedActions':
      return `${W}percentageOfUserActionsAffectedByErrors${filter}:splitBy()`
  }
}
