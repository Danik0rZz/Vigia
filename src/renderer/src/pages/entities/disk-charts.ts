import type { TFunction } from 'i18next'
import type { EChartsCoreOption } from 'echarts/core'
import type { DiskMetricsResult, DiskSeries } from '@shared/modules'
import { formatNumber } from '@shared/format-number'
import type { ChartColors } from '../../components/Chart'
import { axisTooltip, timeAxisLabel } from '../../components/chart-time'
import { formatByteRate, formatGigabytes, formatUsagePct } from '../../lib/host-format'
import { formatDurationMs } from '../../lib/service-format'

/**
 * Marcadores y gráficos de la página de un DISK (ficha 0040), sacados de la respuesta de
 * `entities:diskMetrics` (una sola llamada para los dos).
 *
 * Qué se pinta: uso, espacio y rendimiento van siempre (sin datos, «—»). El quinto marcador y el
 * cuarto gráfico son Latencia y, si el disco no la trae (el canal la da a null), Cola; si tampoco
 * hay cola, no salen. Con las dos, Latencia (decisión del test-writer en la ficha). Mientras no
 * hay datos (cargando o con error) se pinta lo que saldría con todo.
 */
export type DiskChartKind = 'usage' | 'space' | 'throughput' | 'latency' | 'queue'

/** El papel opcional que se pinta: «Latencia o Cola» (el que haya). */
export type DiskOptionalRole = 'latency' | 'queue'

export interface DiskLayout {
  /** El marcador y el gráfico del papel opcional; null si el disco no trae ninguno. */
  optional: DiskOptionalRole | null
  /** Los gráficos, en el orden de la rejilla. */
  charts: DiskChartKind[]
}

export function diskLayout(data: DiskMetricsResult | undefined): DiskLayout {
  const optional: DiskOptionalRole | null =
    data === undefined || data.series.latency !== null
      ? 'latency'
      : data.series.queue !== null
        ? 'queue'
        : null
  const charts: DiskChartKind[] = ['usage', 'space', 'throughput']
  if (optional !== null) charts.push(optional)
  return { optional, charts }
}

/** Longitud de la cola: un número pequeño, con dos decimales como mucho; sin dato, «—». */
export function formatQueueLength(value: number | null, language: string): string {
  if (value === null || !Number.isFinite(value)) return '—'
  return formatNumber(value, language, { maximumFractionDigits: 2 })
}

/** Una serie del gráfico: nombre, color, puntos y si va apilada (espacio usado y libre). */
export interface DiskChartSeries {
  name: string
  color: string
  points: [number, number | null][]
  stacked: boolean
}

/** Contexto común: colores del tema, idioma, textos y, si se conoce, el rango que se ve. */
export interface DiskChartContext {
  colors: ChartColors
  language: string
  t: TFunction
  /** Rango visible (ms desde epoch); sin él, el eje se ajusta a los datos. */
  range?: { from: number; to: number } | undefined
}

/** Una serie como puntos `[tiempo, valor]`; null es hueco. */
function points(series: DiskSeries | null | undefined): [number, number | null][] {
  if (series === null || series === undefined) return []
  return series.timestamps.map((time, index) => [time, series.values[index] ?? null])
}

/** Las series de un gráfico, en la unidad del canal (%, bytes, bytes/s, ms o longitud). */
export function diskChartSeries(
  kind: DiskChartKind,
  data: DiskMetricsResult,
  { colors, t }: Pick<DiskChartContext, 'colors' | 't'>
): DiskChartSeries[] {
  const name = (key: string): string => t(`entities.disk.charts.series.${key}`)
  const line = (
    key: string,
    color: string,
    series: DiskSeries | null | undefined
  ): DiskChartSeries => ({
    name: name(key),
    color,
    points: points(series),
    stacked: false
  })
  const { series } = data
  switch (kind) {
    case 'usage':
      return [line('usage', colors.accent, series.usage)]
    case 'space':
      return [
        { ...line('used', colors.accent, series.space.used), stacked: true },
        { ...line('free', colors.series2, series.space.free), stacked: true }
      ]
    case 'throughput':
      return [
        line('read', colors.accent, series.throughput.read),
        line('write', colors.series2, series.throughput.write)
      ]
    case 'latency':
      return [
        line('read', colors.accent, series.latency?.read),
        line('write', colors.series2, series.latency?.write)
      ]
    case 'queue':
      return [line('queue', colors.accent, series.queue)]
  }
}

/** Formato de los valores (eje y tooltip) de cada gráfico. */
function valueFormatter(kind: DiskChartKind, language: string): (value: number) => string {
  switch (kind) {
    case 'usage':
      return (value) => formatUsagePct(value, language)
    case 'space':
      return (value) => formatGigabytes(value, language)
    case 'throughput':
      return (value) => formatByteRate(value, language)
    case 'latency':
      return (value) => formatDurationMs(value, language)
    case 'queue':
      return (value) => formatQueueLength(value, language)
  }
}

/**
 * Opción de ECharts de un gráfico del disco: líneas que no unen los huecos (null), sin líneas de
 * rejilla y con los márgenes del host (la franja de problemas se alinea con ellos). El uso, en un
 * eje fijo de 0 a 100 %; el espacio, usado y libre apilados en GB; lectura y escritura en bytes
 * por segundo, latencia en ms y cola en longitud.
 */
export function diskChartOption(
  kind: DiskChartKind,
  data: DiskMetricsResult,
  context: DiskChartContext
): EChartsCoreOption {
  const { colors, language, range } = context
  const list = diskChartSeries(kind, data, context)
  const format = valueFormatter(kind, language)

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
      ...(kind === 'usage' ? { max: 100 } : {}),
      // Sin líneas de rejilla (ficha 0012): se quedan las etiquetas y el eje X.
      splitLine: { show: false },
      axisLabel: { color: colors.muted, formatter: format }
    },
    series: list.map((item) => ({
      type: 'line',
      name: item.name,
      showSymbol: false,
      connectNulls: false,
      ...(item.stacked ? { stack: 'space', areaStyle: { color: item.color, opacity: 0.3 } } : {}),
      lineStyle: { color: item.color, width: 1.75 },
      itemStyle: { color: item.color },
      data: item.points
    }))
  }
}

/** Unidad de los valores de cada gráfico, para la exportación (la del canal, sin convertir). */
export function diskChartUnit(kind: DiskChartKind): string {
  switch (kind) {
    case 'usage':
      return '%'
    case 'space':
      return 'B'
    case 'throughput':
      return 'B/s'
    case 'latency':
      return 'ms'
    case 'queue':
      return ''
  }
}

const P = 'builtin:host.disk.'

/**
 * Consulta de Métricas de cada gráfico («Abrir en Métricas» y exportación): las mismas métricas
 * que pide main (`src/main/modules/disk-metrics.ts`), con el mismo filtro por el disco. El id
 * llega ya validado (`diskEntityIdSchema`), así que no puede cerrar la comilla ni el paréntesis.
 */
export function diskChartSelector(kind: DiskChartKind, entityId: string): string {
  const filter = `:filter(eq("dt.entity.disk","${entityId}"))`
  const metrics: Record<DiskChartKind, string[]> = {
    usage: ['usedPct'],
    space: ['used', 'avail'],
    throughput: ['bytesRead', 'bytesWritten'],
    latency: ['readTime', 'writeTime'],
    queue: ['queueLength']
  }
  return metrics[kind].map((metric) => `${P}${metric}${filter}`).join(',')
}
