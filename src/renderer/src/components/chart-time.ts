import { format as echartsFormat, time } from 'echarts/core'
import { formatDateTime } from '@shared/format-date'
import { resolutionMs } from '@shared/metric-points'
import { dateLang } from '../lib/date-lang'

// La de siempre (shared, con sus tests), también desde aquí: es parte del eje de tiempo.
export { resolutionMs }

/** Niveles del eje de tiempo de ECharts (los de su formatter por niveles). */
export type PrimaryTimeUnit =
  'year' | 'month' | 'day' | 'hour' | 'minute' | 'second' | 'millisecond'
type TimeLabels = Record<PrimaryTimeUnit, string>

const DAY_MS = 86_400_000

/** Fecha corta del idioma, con las plantillas de ECharts. */
function datePattern(lang: string): string {
  return dateLang(lang) === 'en' ? '{MM}-{dd}' : '{dd}/{MM}'
}

/**
 * Plantilla de cada nivel. ECharts usa la del nivel superior en las marcas de
 * frontera (medianoche → la del día), así que en el cambio de día sale la
 * fecha y en el resto la hora. Con puntos de un día o más, todas las marcas
 * caen a las 00:00: entonces solo la fecha, sin hora.
 */
function labelsFor(lang: string, resolution: string | null): TimeLabels {
  const date = datePattern(lang)
  const step = resolution === null ? null : resolutionMs(resolution)
  const daily = step !== null && step >= DAY_MS
  return {
    year: '{yyyy}',
    month: date,
    day: date,
    hour: daily ? date : '{HH}:{mm}',
    minute: daily ? date : '{HH}:{mm}',
    second: daily ? date : '{HH}:{mm}:{ss}',
    millisecond: daily ? date : '{HH}:{mm}:{ss}'
  }
}

/**
 * axisLabel del eje x de tiempo, igual en todos los gráficos, en hora local.
 * `resolution`: la que DEVUELVE la API (en rangos antiguos llega más gruesa
 * que la pedida por la retención de Dynatrace); mientras no llega, la pedida.
 */
export function timeAxisLabel(
  lang: string,
  resolution: string | null
): { hideOverlap: true; formatter: TimeLabels } {
  return { hideOverlap: true, formatter: labelsFor(lang, resolution) }
}

/** La etiqueta de una marca de ese nivel (para probar las plantillas). */
export function formatTimeTick(
  value: number,
  unit: PrimaryTimeUnit,
  lang: string,
  resolution: string | null
): string {
  return time.format(value, labelsFor(lang, resolution)[unit], false)
}

/** Fecha y hora completas del idioma, para la cabecera del tooltip. */
export function tooltipTime(value: number, lang: string): string {
  return formatDateTime(value, dateLang(lang))
}

/** Clase del tooltip HTML de los gráficos (los e2e lo buscan por ella). */
export const CHART_TOOLTIP_CLASS = 'vigia-chart-tooltip'

interface AxisTooltipParam {
  marker?: unknown
  seriesName?: unknown
  value?: unknown
}

/**
 * Tooltip de eje: la fecha completa arriba y una fila por serie. Los nombres
 * de serie vienen de Dynatrace: se escapan (el tooltip es HTML).
 */
export function axisTooltip(
  lang: string,
  formatValue: (value: number) => string
): {
  trigger: 'axis'
  className: string
  formatter: (params: unknown) => string
} {
  return {
    trigger: 'axis',
    className: CHART_TOOLTIP_CLASS,
    formatter: (params) => {
      const list = (Array.isArray(params) ? params : [params]) as AxisTooltipParam[]
      const first = list[0]?.value
      const at = Array.isArray(first) ? Number(first[0]) : Number.NaN
      const header = Number.isFinite(at) ? echartsFormat.encodeHTML(tooltipTime(at, lang)) : ''
      const rows = list.map((item) => {
        const value = Array.isArray(item.value) ? item.value[1] : item.value
        const shown = typeof value === 'number' && Number.isFinite(value) ? formatValue(value) : '-'
        const marker = typeof item.marker === 'string' ? item.marker : ''
        return `${marker}${echartsFormat.encodeHTML(String(item.seriesName ?? ''))}: ${echartsFormat.encodeHTML(shown)}`
      })
      return [header, ...rows].filter((line) => line !== '').join('<br/>')
    }
  }
}
