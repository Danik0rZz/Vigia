import { describe, expect, it } from 'vitest'
import type { MetricResult } from '@shared/modules'
import type { ChartColors } from '../../components/Chart'
import { metricChartOption } from './metric-chart-option'

/**
 * Ficha 0012: quitar la rejilla es solo de los gráficos del servicio. El gráfico de Métricas
 * sigue como estaba: líneas de rejilla en el eje Y, con el color del borde del tema.
 */

const COLORS: ChartColors = {
  foreground: '#111111',
  muted: '#555555',
  border: '#cccccc',
  accent: '#1f6feb',
  background: '#ffffff',
  danger: '#d1242f',
  success: '#1a7f37',
  series2: '#8250df',
  series3: '#bf8700',
  series4: '#888',
  series5: '#999'
}

const T0 = Date.UTC(2026, 9, 3, 8, 0)

const SERIES: MetricResult['series'] = [
  {
    metricId: 'builtin:host.cpu.usage',
    dimensions: {},
    timestamps: [T0, T0 + 60_000],
    values: [10, 20]
  }
] as MetricResult['series']

describe('CA1 (0012): el gráfico de Métricas conserva la rejilla', () => {
  it('CA1 (0012): yAxis.splitLine sigue con las líneas, del color del borde', () => {
    const option = metricChartOption({
      series: SERIES,
      names: ['cpu'],
      resolution: '1m',
      language: 'es',
      colors: COLORS
    }) as Record<string, unknown>
    const yAxis = option['yAxis'] as { splitLine?: { show?: unknown; lineStyle?: unknown } }
    expect(yAxis.splitLine?.show).not.toBe(false)
    expect(yAxis.splitLine).toEqual({ lineStyle: { color: COLORS.border } })
  })
})

describe('Separador de miles en el eje Y de Métricas (0012)', () => {
  it('Separador de miles (0012): las etiquetas del eje Y pasan por formatNumber: «1.234» en es, «1,234» en en', () => {
    for (const [language, expected] of [
      ['es', '1.234'],
      ['en', '1,234']
    ] as const) {
      const option = metricChartOption({
        series: SERIES,
        names: ['cpu'],
        resolution: '1m',
        language,
        colors: COLORS
      }) as Record<string, unknown>
      const yAxis = option['yAxis'] as { axisLabel?: { formatter?: unknown } }
      const formatter = yAxis.axisLabel?.formatter
      expect(typeof formatter, language).toBe('function')
      expect((formatter as (value: number) => string)(1234), language).toBe(expected)
      expect((formatter as (value: number) => string)(2128749), language).toBe(
        language === 'es' ? '2.128.749' : '2,128,749'
      )
    }
  })
})
