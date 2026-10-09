import type { TFunction } from 'i18next'
import type { EChartsCoreOption } from 'echarts/core'
import {
  processEntityIdSchema,
  type ProcessGroupInstance,
  type ProcessGroupMetricsResult,
  type ProcessMetricsResult,
  type ProcessSeries
} from '@shared/modules'
import type { ChartColors } from '../../components/Chart'
import { axisTooltip, timeAxisLabel } from '../../components/chart-time'
import { formatBitRate, formatBytes, formatUsagePct } from '../../lib/host-format'
import { processChartSelector, toBits } from './process-charts'

/**
 * Gráficos de la página de un PROCESS_GROUP (ficha 0032). CPU, memoria y red salen del total del
 * grupo de `entities:processGroupMetrics` (ficha 0031, la misma llamada que los marcadores y la
 * tabla); «CPU por instancia», de `entities:processMetrics` (0027) de las cinco instancias de más
 * CPU media (decisión del Orquestador en la ficha: el canal de la 0031 no trae series por
 * instancia y no se añade una expresión sin probar en vivo). Puras: el componente pone React.
 */
export type ProcessGroupChartKind = 'cpu' | 'memory' | 'network' | 'cpu-instances'

/** Los cuatro gráficos, en el orden de la rejilla de 2×2. */
export const PROCESS_GROUP_CHART_KINDS: readonly ProcessGroupChartKind[] = [
  'cpu',
  'memory',
  'network',
  'cpu-instances'
]

/** Como mucho, cuántas instancias van en «CPU por instancia» (las de más CPU). */
export const TOP_INSTANCE_COUNT = 5

/** Una línea de «CPU por instancia»: la instancia y su serie de CPU. */
export interface InstanceCpuLine {
  id: string
  name: string
  cpu: ProcessSeries
}

/** Lo que pinta «CPU por instancia», ya juntado de las llamadas de cada instancia. */
export interface InstanceCpuData {
  resolution: string
  warnings: string[]
  lines: InstanceCpuLine[]
}

/** Una serie del gráfico: nombre, color y puntos. */
export interface GroupChartSeries {
  name: string
  color: string
  points: [number, number | null][]
}

/** Contexto común: colores del tema, idioma, textos y, si se conoce, el rango que se ve. */
export interface GroupChartContext {
  colors: ChartColors
  language: string
  t: TFunction
  /** Rango visible (ms desde epoch); sin él, el eje se ajusta a los datos. */
  range?: { from: number; to: number } | undefined
}

/**
 * Las instancias de «CPU por instancia»: las primeras de `instances.items` (main ya las da de más
 * a menos CPU media, las de sin dato al final) con id de proceso válido y CPU con dato, como
 * mucho cinco. Las demás no se piden.
 */
export function topInstances(data: ProcessGroupMetricsResult | undefined): ProcessGroupInstance[] {
  if (data === undefined) return []
  return data.instances.items
    .filter((item) => item.cpu !== null && processEntityIdSchema.safeParse(item.id).success)
    .slice(0, TOP_INSTANCE_COUNT)
}

/**
 * Junta las respuestas de `entities:processMetrics` de las instancias (en el mismo orden) en los
 * datos del gráfico. La resolución, la de la primera (sin instancias, la del grupo); los avisos,
 * sin repetir.
 */
export function combineInstanceCpu(
  instances: ProcessGroupInstance[],
  results: ProcessMetricsResult[],
  fallbackResolution: string
): InstanceCpuData {
  return {
    resolution: results[0]?.resolution ?? fallbackResolution,
    warnings: [...new Set(results.flatMap((result) => result.warnings))],
    lines: instances.map((instance, index) => ({
      id: instance.id,
      name: instance.name,
      cpu: results[index]?.series.cpu ?? { timestamps: [], values: [] }
    }))
  }
}

/** Una serie como puntos `[tiempo, valor]`, con la conversión de su unidad; null es hueco. */
function points(
  series: ProcessSeries,
  convert: (value: number | null) => number | null = (value) => value
): [number, number | null][] {
  return series.timestamps.map((time, index) => [time, convert(series.values[index] ?? null)])
}

/** Colores de las líneas de «CPU por instancia», en orden. */
function instanceColors(colors: ChartColors): string[] {
  return [colors.accent, colors.series2, colors.series3, colors.series4, colors.series5]
}

/** Las series de un gráfico del total del grupo, ya en la unidad que se enseña. */
export function groupChartSeries(
  kind: Exclude<ProcessGroupChartKind, 'cpu-instances'>,
  data: ProcessGroupMetricsResult,
  { colors, t }: Pick<GroupChartContext, 'colors' | 't'>
): GroupChartSeries[] {
  const name = (key: string): string => t(`entities.processGroup.charts.series.${key}`)
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
  }
}

/** Las series de «CPU por instancia»: una por instancia, con su nombre. */
export function instanceCpuSeries(data: InstanceCpuData, colors: ChartColors): GroupChartSeries[] {
  const palette = instanceColors(colors)
  return data.lines.map((line, index) => ({
    name: line.name,
    color: palette[index % palette.length] ?? colors.accent,
    points: points(line.cpu)
  }))
}

/** Formato de los valores (eje y tooltip) de cada gráfico. */
function valueFormatter(kind: ProcessGroupChartKind, language: string): (value: number) => string {
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
 * Opción de ECharts de un gráfico del grupo: líneas que no unen los huecos, sin líneas de rejilla
 * y con los márgenes del proceso (la franja de problemas se alinea con ellos). La CPU, en % desde
 * 0 y sin tope: la del grupo es la suma de sus instancias y pasa de 100.
 */
export function groupChartOption(
  kind: ProcessGroupChartKind,
  list: GroupChartSeries[],
  resolution: string,
  context: GroupChartContext
): EChartsCoreOption {
  const { colors, language, range } = context
  const format = valueFormatter(kind, language)
  return {
    animation: false,
    grid: { left: 64, right: 16, top: list.length > 1 ? 28 : 12, bottom: 28 },
    tooltip: axisTooltip(language, format),
    // La leyenda se pulsa para ocultar series (lo hace ECharts).
    legend: {
      show: list.length > 1,
      top: 0,
      type: 'scroll',
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
export function groupChartUnit(kind: ProcessGroupChartKind): string {
  switch (kind) {
    case 'memory':
      return 'B'
    case 'network':
      return 'bit/s'
    default:
      return '%'
  }
}

/** Clave del título de cada gráfico en `entities.processGroup.charts`. */
export function groupChartTitleKey(kind: ProcessGroupChartKind): string {
  return kind === 'cpu-instances' ? 'cpuByInstance' : kind
}

const G = 'builtin:tech.generic.'

/**
 * Consulta de Métricas de los gráficos del total («Abrir en Métricas» y exportación): la suma
 * (`:splitBy():sum`, la de main) de las instancias del grupo, elegidas con el filtro
 * `in("dt.entity.process_group_instance",entitySelector(…))` en la expresión, que la ficha 0017
 * probó en vivo con `isProcessOf` (da lo mismo que la relación en `entitySelector`); aquí con
 * `isInstanceOf`, la relación de main (`processGroupEntitySelector`). Métricas solo recibe el
 * selector: no puede llevar entitySelector aparte. El id llega ya validado
 * (`processGroupEntityIdSchema`), así que no puede cerrar las comillas ni el paréntesis.
 */
export function groupChartSelector(
  kind: Exclude<ProcessGroupChartKind, 'cpu-instances'>,
  groupId: string
): string {
  const instances = `type(PROCESS_GROUP_INSTANCE),fromRelationships.isInstanceOf(entityId(${groupId}))`
  const scope = `:filter(in("dt.entity.process_group_instance",entitySelector("${instances}"))):splitBy():sum`
  switch (kind) {
    case 'cpu':
      return `${G}cpu.usage${scope}`
    case 'memory':
      return `${G}mem.workingSetSize${scope}`
    case 'network':
      return [`${G}network.bytesRx${scope}`, `${G}network.bytesTx${scope}`].join(',')
  }
}

/**
 * Consulta de Métricas de «CPU por instancia»: la de la CPU del proceso (0028) de cada una de
 * las instancias del gráfico, separadas por comas (una expresión por instancia).
 */
export function instanceCpuSelector(instances: { id: string }[]): string {
  return instances.map((instance) => processChartSelector('cpu', instance.id)).join(',')
}
