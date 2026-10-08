import { describe, expect, it } from 'vitest'
import type { TFunction } from 'i18next'
import type { HostMetricsResult, HostSeries } from '@shared/modules'
import type { ChartColors } from '../../components/Chart'
import {
  HOST_CHART_KINDS,
  hostChartOption,
  hostChartSelector,
  hostChartSeries,
  hostChartUnit
} from './host-charts'

/**
 * Ficha 0018: los gráficos del HOST. Lo que no se ve en `data-series` (lo pidió el Orquestador):
 * el desglose de la CPU va en líneas sin apilar, y los ejes de % van de 0 a 100.
 */
const t = ((key: string) => key.split('.').pop() ?? key) as unknown as TFunction
const colors: ChartColors = {
  foreground: '#000',
  muted: '#111',
  border: '#222',
  accent: '#333',
  background: '#fff',
  danger: '#444',
  success: '#555',
  series2: '#666',
  series3: '#777'
}
const series = (values: (number | null)[]): HostSeries => ({
  timestamps: values.map((_, i) => 1_000 + i * 60_000),
  values
})
const data: HostMetricsResult = {
  resolution: '1m',
  series: {
    cpu: series([12, null, 48]),
    cpuBreakdown: {
      user: series([8, null, 30]),
      system: series([3, null, 15]),
      iowait: series([1, null, 3])
    },
    memory: series([50, null, 62.5]),
    network: { in: series([2000, null, 5000]), out: series([400, null, 900]) },
    disk: series([81, null, 91])
  },
  totals: {
    cpu: { avg: 33.5, max: 95 },
    memory: { avg: 57, used: 10, total: 16 },
    network: { in: 3600, out: 650 },
    disk: { max: 92 },
    load: { avg: 2.25 }
  },
  warnings: [],
  partial: []
}

type LineSeries = { type: string; stack?: unknown; areaStyle?: unknown; data: unknown[] }
const optionSeries = (kind: (typeof HOST_CHART_KINDS)[number]): LineSeries[] =>
  hostChartOption(kind, data, { colors, language: 'es', t })['series'] as LineSeries[]

describe('hostChartOption (0018)', () => {
  it('CPU: total y desglose en líneas separadas, sin apilar ni área', () => {
    const list = optionSeries('cpu')
    expect(list).toHaveLength(4)
    for (const item of list) {
      expect(item.type).toBe('line')
      expect(item).not.toHaveProperty('stack')
      expect(item).not.toHaveProperty('areaStyle')
    }
  })

  it('ninguno de los cuatro gráficos apila series', () => {
    for (const kind of HOST_CHART_KINDS) {
      for (const item of optionSeries(kind)) expect(item, kind).not.toHaveProperty('stack')
    }
  })

  it('los null quedan como hueco', () => {
    const [total] = optionSeries('cpu')
    expect(total?.data[1]).toEqual([61_000, null])
  })

  it('CPU, memoria y disco en un eje de 0 a 100 %; la red, sin máximo fijo', () => {
    for (const kind of ['cpu', 'memory', 'disk'] as const) {
      const axis = hostChartOption(kind, data, { colors, language: 'es', t })['yAxis'] as {
        min: number
        max?: number
      }
      expect(axis.min, kind).toBe(0)
      expect(axis.max, kind).toBe(100)
    }
    const network = hostChartOption('network', data, { colors, language: 'es', t })['yAxis'] as {
      max?: number
      axisLabel: { formatter: (value: number) => string }
    }
    expect(network.max).toBeUndefined()
    expect(network.axisLabel.formatter(3600).replace(/\u00a0/g, ' ')).toBe('3,6 kbit/s')
  })

  it('sin líneas de rejilla horizontales', () => {
    for (const kind of HOST_CHART_KINDS) {
      const axis = hostChartOption(kind, data, { colors, language: 'es', t })['yAxis'] as {
        splitLine: { show: boolean }
      }
      expect(axis.splitLine.show, kind).toBe(false)
    }
  })
})

describe('hostChartSeries, hostChartUnit y hostChartSelector (0018)', () => {
  it('las series de cada gráfico, en su orden', () => {
    const names = (kind: (typeof HOST_CHART_KINDS)[number]): string[] =>
      hostChartSeries(kind, data, { colors, t }).map((item) => item.name)
    expect(names('cpu')).toEqual(['total', 'user', 'system', 'iowait'])
    expect(names('memory')).toEqual(['memory'])
    expect(names('network')).toEqual(['in', 'out'])
    expect(names('disk')).toEqual(['disk'])
  })

  it('unidades de la exportación', () => {
    expect(hostChartUnit('cpu')).toBe('%')
    expect(hostChartUnit('network')).toBe('bit/s')
  })

  it('«Abrir en Métricas» filtra por el host con las métricas de main', () => {
    const id = 'HOST-0000000000000001'
    const scope = `:filter(eq("dt.entity.host","${id}")):splitBy("dt.entity.host")`
    expect(hostChartSelector('memory', id)).toBe(`builtin:host.mem.usage${scope}`)
    expect(hostChartSelector('disk', id)).toBe(`builtin:host.disk.usedPct${scope}:max`)
    expect(hostChartSelector('network', id)).toBe(
      `builtin:host.net.nic.trafficIn${scope}:sum,builtin:host.net.nic.trafficOut${scope}:sum`
    )
    expect(hostChartSelector('cpu', id).match(/builtin:host\.cpu\./g)).toHaveLength(4)
  })
})
