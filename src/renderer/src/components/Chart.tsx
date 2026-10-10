import { forwardRef, useEffect, useImperativeHandle, useRef, type JSX } from 'react'
import { BarChart, LineChart } from 'echarts/charts'
import {
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  TooltipComponent
} from 'echarts/components'
import * as echarts from 'echarts/core'
import langES from 'echarts/i18n/langES-obj.js'
import { CanvasRenderer } from 'echarts/renderers'
import { useTranslation } from 'react-i18next'
import { useResolvedTheme } from '../app/theme'
import { dateLang } from '../lib/date-lang'

// Solo las piezas que se usan: el resto de ECharts no entra en el bundle.
echarts.use([
  BarChart,
  LineChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  // Periodo de la evidencia, inicio del problema y umbral en los mini gráficos.
  MarkAreaComponent,
  MarkLineComponent,
  CanvasRenderer
])
// EN viene incluido; ES se registra (meses y días del eje de tiempo, textos propios).
echarts.registerLocale('ES', langES)

/** Colores del tema actual, leídos de los tokens CSS (cambian con el tema y el cliente). */
export interface ChartColors {
  foreground: string
  muted: string
  border: string
  accent: string
  background: string
  danger: string
  /** Verde del tema (lo que va bien: peticiones OK). */
  success: string
  /** Segundo y tercer color de serie (p90 y p99 en los tiempos de un servicio). */
  series2: string
  series3: string
  /** Cuarto y quinto (las cinco instancias de «CPU por instancia» de un process group, 0032). */
  series4: string
  series5: string
}

function readColors(): ChartColors {
  const style = getComputedStyle(document.documentElement)
  const token = (name: string): string => style.getPropertyValue(name).trim()
  return {
    foreground: token('--foreground'),
    muted: token('--muted-foreground'),
    border: token('--border'),
    accent: token('--accent'),
    background: token('--background'),
    danger: token('--danger'),
    success: token('--status-closed'),
    series2: token('--chart-2'),
    series3: token('--chart-3'),
    series4: token('--chart-4'),
    series5: token('--chart-5')
  }
}

/**
 * Rango del eje x (min y max, si los fija la opción), cuántas líneas verticales hay y los valores
 * de las horizontales (umbrales, como el 90 % de la disponibilidad del servicio, ficha 0048).
 */
function optionFacts(option: echarts.EChartsCoreOption): {
  from: string
  to: string
  markLines: number
  thresholds: number[]
} {
  const axis = (Array.isArray(option['xAxis']) ? option['xAxis'][0] : option['xAxis']) as
    { min?: unknown; max?: unknown } | undefined
  const series = (Array.isArray(option['series']) ? option['series'] : []) as {
    markLine?: { data?: unknown[] }
  }[]
  const vertical = series.flatMap((item) =>
    (item.markLine?.data ?? []).filter(
      (entry) => typeof entry === 'object' && entry !== null && 'xAxis' in entry
    )
  )
  const thresholds = series.flatMap((item) =>
    (item.markLine?.data ?? []).flatMap((entry) =>
      typeof entry === 'object' &&
      entry !== null &&
      'yAxis' in entry &&
      typeof entry.yAxis === 'number'
        ? [entry.yAxis]
        : []
    )
  )
  return {
    from: typeof axis?.min === 'number' ? String(axis.min) : '',
    to: typeof axis?.max === 'number' ? String(axis.max) : '',
    markLines: vertical.length,
    thresholds
  }
}

/** Textos que ECharts ha pintado en el eje x (API interna: si cambia, lista vacía). */
function xAxisLabels(chart: echarts.ECharts): string[] {
  try {
    const model = (
      chart as unknown as {
        getModel: () => {
          getComponent: (
            type: string,
            index: number
          ) => { axis?: { getViewLabels: () => { formattedLabel: string }[] } } | undefined
        }
      }
    ).getModel()
    return (
      model
        .getComponent('xAxis', 0)
        ?.axis?.getViewLabels()
        .map((l) => l.formattedLabel) ?? []
    )
  } catch {
    return []
  }
}

export interface ChartHandle {
  /** PNG del gráfico a doble resolución y con fondo sólido (el del tema). */
  toPngDataUrl(): string | null
}

/**
 * Gráfico de ECharts (renderer canvas, sin eval: no hace falta tocar la CSP).
 * `buildOption` recibe los colores del tema y se vuelve a aplicar al cambiarlo.
 */
export const Chart = forwardRef<
  ChartHandle,
  {
    testId: string
    label: string
    buildOption: (colors: ChartColors) => echarts.EChartsCoreOption
    height?: number
    /**
     * Nombres de las series (los de la leyenda), en su orden. El canvas no se
     * puede leer: así se ven en el DOM (data-series, JSON) para las pruebas y
     * las herramientas de accesibilidad.
     */
    seriesNames?: readonly string[] | undefined
  }
>(function Chart({ testId, label, buildOption, height = 240, seriesNames }, ref): JSX.Element {
  const container = useRef<HTMLDivElement>(null)
  const instance = useRef<echarts.ECharts | null>(null)
  const theme = useResolvedTheme()
  const { i18n } = useTranslation()
  // El locale solo se fija al crear el gráfico: cambiar de idioma lo vuelve a crear.
  const locale = dateLang(i18n.language) === 'en' ? 'EN' : 'ES'

  useEffect(() => {
    if (container.current === null) return
    const chart = echarts.init(container.current, undefined, { renderer: 'canvas', locale })
    instance.current = chart
    const observer = new ResizeObserver(() => chart.resize())
    observer.observe(container.current)
    return () => {
      observer.disconnect()
      chart.dispose()
      instance.current = null
    }
  }, [locale])

  useEffect(() => {
    const chart = instance.current
    const element = container.current
    if (chart === null || element === null) return
    const option = buildOption(readColors())
    chart.setOption(option, { notMerge: true })
    // El canvas no se puede leer: rango, líneas verticales, umbrales y etiquetas del eje x
    // van también en el DOM (para las pruebas y las herramientas de accesibilidad).
    const facts = optionFacts(option)
    element.dataset['rangeFrom'] = facts.from
    element.dataset['rangeTo'] = facts.to
    element.dataset['markLines'] = String(facts.markLines)
    if (facts.thresholds.length > 0)
      element.dataset['thresholds'] = JSON.stringify(facts.thresholds)
    else delete element.dataset['thresholds']
    const onFinished = (): void => {
      element.dataset['xLabels'] = JSON.stringify(xAxisLabels(chart))
    }
    chart.on('finished', onFinished)
    return () => {
      chart.off('finished', onFinished)
    }
  }, [buildOption, theme, locale])

  useImperativeHandle(ref, () => ({
    toPngDataUrl: () =>
      instance.current?.getDataURL({
        type: 'png',
        pixelRatio: 2,
        backgroundColor: readColors().background
      }) ?? null
  }))

  return (
    <div
      ref={container}
      data-testid={testId}
      data-series={seriesNames === undefined ? undefined : JSON.stringify(seriesNames)}
      data-locale={locale}
      role="img"
      aria-label={label}
      style={{ height }}
      className="w-full"
    />
  )
})
