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
  series3: '#bf8700'
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
