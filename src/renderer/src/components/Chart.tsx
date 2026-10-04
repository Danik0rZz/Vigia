import { forwardRef, useEffect, useImperativeHandle, useRef, type JSX } from 'react'
import { BarChart, LineChart } from 'echarts/charts'
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import * as echarts from 'echarts/core'
import langES from 'echarts/i18n/langES-obj.js'
import { CanvasRenderer } from 'echarts/renderers'
import { useTranslation } from 'react-i18next'
import { useResolvedTheme } from '../app/theme'
import { dateLang } from '../lib/date-lang'

// Solo las piezas que se usan: el resto de ECharts no entra en el bundle.
echarts.use([BarChart, LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer])
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
    danger: token('--danger')
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
    instance.current?.setOption(buildOption(readColors()), { notMerge: true })
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
