import type { TFunction } from 'i18next'
import type { EChartsCoreOption } from 'echarts/core'
import type { ProcessMetricsResult, ProcessSeries } from '@shared/modules'
import type { ChartColors } from '../../components/Chart'
import { axisTooltip, timeAxisLabel } from '../../components/chart-time'
import { formatBitRate, formatBytes, formatUsagePct } from '../../lib/host-format'

/**
 * Marcadores y gráficos de la página de un PROCESS_GROUP_INSTANCE (ficha 0028), sacados de la
 * respuesta de `entities:processMetrics` (ficha 0027, una sola llamada para los dos).
 *
 * Qué se pinta (decisión del Orquestador en la ficha 0028): el canal tiene métrica para los seis
 * papeles y un papel sin datos llega con series vacías y su marcador a null; ese papel no se
 * pinta. CPU y memoria van siempre (como en el host: sin datos, «—»). El cuarto marcador es
 * Disponibilidad y, si no hay, Recursos; el cuarto gráfico, Salud de red y, si no hay, Recursos.
 * Mientras no hay datos (cargando o con error) se pinta lo que saldría con todos.
 */
export type ProcessChartKind = 'cpu' | 'memory' | 'network' | 'network-health' | 'resources'

/** El cuarto marcador: «Disponibilidad o Recursos» (el que haya). */
export type ProcessFourthMarker = 'availability' | 'resources'

/** Qué papeles se pintan con esta respuesta. */
export interface ProcessLayout {
  /** El marcador de red (los gráficos de red van aparte, en `charts`). */
  network: boolean
  fourthMarker: ProcessFourthMarker | null
  /** Los gráficos, en el orden de la rejilla. */
  charts: ProcessChartKind[]
}

/** ¿Trae la serie algún punto con dato? */
function hasPoints(series: ProcessSeries): boolean {
  return series.values.some((value) => value !== null)
}

/** Un papel tiene datos si alguna de sus series tiene un punto o su marcador tiene valor. */
function hasData(series: ProcessSeries[], totals: (number | null)[] = []): boolean {
  return series.some(hasPoints) || totals.some((value) => value !== null)
}

/** Lo que se pinta: sin datos todavía, todo lo que saldría con todos los papeles. */
export function processLayout(data: ProcessMetricsResult | undefined): ProcessLayout {
  if (data === undefined) {
    return {
      network: true,
      fourthMarker: 'availability',
      charts: ['cpu', 'memory', 'network', 'network-health']
    }
  }
  const { series, totals } = data
  const network = hasData(
    [series.network.in, series.network.out],
    [totals.network.in, totals.network.out]
  )
  const availability = hasData([series.availability], [totals.availability])
  const resources = hasData([series.resources], [totals.resources])
  const networkHealth = hasData([series.networkHealth])
  const charts: ProcessChartKind[] = ['cpu', 'memory']
  if (network) charts.push('network')
  if (networkHealth) charts.push('network-health')
  else if (resources) charts.push('resources')
  return {
    network,
    fourthMarker: availability ? 'availability' : resources ? 'resources' : null,
    charts
  }
}

/**
 * bytesRx y bytesTx llegan en BytePerSecond (catálogo de la 0027, `docs/notas-api-v2.md`): la red
 * se enseña en bits por segundo, como en el host.
 */
export const BITS_PER_BYTE = 8

/** Bytes/s a bits/s; null sigue siendo null. */
export function toBits(bytesPerSecond: number | null): number | null {
  return bytesPerSecond === null ? null : bytesPerSecond * BITS_PER_BYTE
}

/** Una serie del gráfico: nombre, color y puntos. */
export interface ProcessChartSeries {
  name: string
  color: string
  points: [number, number | null][]
}

/** Contexto común: colores del tema, idioma, textos y, si se conoce, el rango que se ve. */
export interface ProcessChartContext {
  colors: ChartColors
  language: string
  t: TFunction
  /** Rango visible (ms desde epoch); sin él, el eje se ajusta a los datos. */
  range?: { from: number; to: number } | undefined
}

/** Una serie como puntos `[tiempo, valor]`, con la conversión de su unidad; null es hueco. */
function points(
  series: ProcessSeries,
  convert: (value: number | null) => number | null = (value) => value
): [number, number | null][] {
  return series.timestamps.map((time, index) => [time, convert(series.values[index] ?? null)])
}

/** Las series de un gráfico, ya en la unidad que se enseña (% en 0–100, bytes o bits/s). */
export function processChartSeries(
  kind: ProcessChartKind,
  data: ProcessMetricsResult,
  { colors, t }: Pick<ProcessChartContext, 'colors' | 't'>
): ProcessChartSeries[] {
  const name = (key: string): string => t(`entities.process.charts.series.${key}`)
  const { series } = data
  switch (kind) {
    case 'cpu':
      return [{ name: name('cpu'), color: colors.accent, points: points(series.cpu) }]
    case 'memory':
      return [{ name: name('memory'), color: colors.accent, points: points(series.memory) }]
    case 'network':
      return [
        { name: name('in'), color: colors.accent, points: points(series.network.in, toBits) },
        { name: name('out'), color: colors.series2, points: points(series.network.out, toBits) }
      ]
    case 'network-health':
      return [
        {
          name: name('networkHealth'),
          color: colors.accent,
          points: points(series.networkHealth)
        }
      ]
    case 'resources':
      return [{ name: name('resources'), color: colors.accent, points: points(series.resources) }]
  }
}

/** Formato de los valores (eje y tooltip) de cada gráfico. */
function valueFormatter(kind: ProcessChartKind, language: string): (value: number) => string {
  switch (kind) {
    case 'memory':
      return (value) => formatBytes(value, language)
    case 'network':
      return (value) => formatBitRate(value, language)
    default:
      return (value) => formatUsagePct(value, language)
  }
}

/**
 * Opción de ECharts de un gráfico del proceso: líneas que no unen los huecos (null), sin líneas
 * de rejilla y con los mismos márgenes que el host (la franja de problemas se alinea con ellos).
 * CPU y recursos, en un eje fijo de 0 a 100 %; las retransmisiones, en % desde 0 (son valores
 * pequeños); memoria en bytes y red en bits/s, con la unidad adaptada.
 */
export function processChartOption(
  kind: ProcessChartKind,
  data: ProcessMetricsResult,
  context: ProcessChartContext
): EChartsCoreOption {
  const { colors, language, range } = context
  const list = processChartSeries(kind, data, context)
  const format = valueFormatter(kind, language)
  const fixedPercent = kind === 'cpu' || kind === 'resources'

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
      ...(fixedPercent ? { max: 100 } : {}),
      // Sin líneas de rejilla (ficha 0012): se quedan las etiquetas y el eje X.
      splitLine: { show: false },
      axisLabel: { color: colors.muted, formatter: format }
    },
    series: list.map((item) => ({
      type: 'line',
      name: item.name,
      showSymbol: false,
      connectNulls: false,
      lineStyle: { color: item.color, width: 1.75 },
      itemStyle: { color: item.color },
      data: item.points
    }))
  }
}

/** Unidad de los valores de cada gráfico, para la exportación. */
export function processChartUnit(kind: ProcessChartKind): string {
  switch (kind) {
    case 'memory':
      return 'B'
    case 'network':
      return 'bit/s'
    default:
      return '%'
  }
}

/** Clave del título de cada gráfico en `entities.process.charts`. */
export function processChartTitleKey(kind: ProcessChartKind): string {
  return kind === 'network-health' ? 'networkHealth' : kind
}

const G = 'builtin:tech.generic.'

/**
 * Filtro por el proceso en la dimensión `dt.entity.process_group_instance` (la de estas métricas,
 * `docs/notas-api-v2.md`). El id llega ya validado (`processEntityIdSchema`: el tipo y 16
 * hexadecimales), así que no puede cerrar la comilla ni el paréntesis.
 */
function scope(entityId: string): string {
  return `:filter(eq("dt.entity.process_group_instance","${entityId}")):splitBy("dt.entity.process_group_instance")`
}

/**
 * Consulta de Métricas de cada gráfico («Abrir en Métricas» y exportación): las mismas métricas
 * que pide main (`src/main/modules/process-metrics.ts`), acotadas al proceso.
 */
export function processChartSelector(kind: ProcessChartKind, entityId: string): string {
  const s = scope(entityId)
  switch (kind) {
    case 'cpu':
      return `${G}cpu.usage${s}`
    case 'memory':
      return `${G}mem.workingSetSize${s}`
    case 'network':
      return [`${G}network.bytesRx${s}`, `${G}network.bytesTx${s}`].join(',')
    case 'network-health':
      return `${G}network.packets.retransmission${s}`
    case 'resources':
      return `${G}handles.fileDescriptorsPercentUsed${s}`
  }
}
