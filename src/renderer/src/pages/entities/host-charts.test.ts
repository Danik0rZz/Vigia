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
  series3: '#777',
  series4: '#888',
  series5: '#999'
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
    // Ficha 0039: la memoria en bytes (usada, recuperable y total).
    memoryBytes: {
      used: series([8_000_000_000, null, 10_000_000_000]),
      reclaimable: series([3_000_000_000, null, 2_500_000_000]),
      total: series([16_000_000_000, null, 16_000_000_000])
    },
    network: { in: series([2000, null, 5000]), out: series([400, null, 900]) },
    disk: series([81, null, 91])
  },
  totals: {
    cpu: { avg: 33.5, max: 95 },
    memory: { avg: 57, used: 10, total: 16, reclaimable: 2.5 },
    network: { in: 3600, out: 650 },
    disk: { max: 92 },
    load: { avg: 2.25 }
  },
  warnings: [],
  partial: []
}

type LineSeries = {
  type: string
  stack?: unknown
  areaStyle?: unknown
  lineStyle?: { type?: unknown }
  data: unknown[]
}
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

  it('CPU, red y disco no apilan series (la memoria sí, desde la 0039)', () => {
    for (const kind of ['cpu', 'network', 'disk'] as const) {
      for (const item of optionSeries(kind)) expect(item, kind).not.toHaveProperty('stack')
    }
  })

  it('los null quedan como hueco', () => {
    const [total] = optionSeries('cpu')
    expect(total?.data[1]).toEqual([61_000, null])
  })

  it('CPU y disco en un eje de 0 a 100 %; la red, sin máximo fijo (la memoria, en bytes desde la 0039)', () => {
    for (const kind of ['cpu', 'disk'] as const) {
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
    // Ficha 0039: usada, recuperable y total (sus nombres los fija el e2e).
    expect(names('memory')).toHaveLength(3)
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

/**
 * Ficha 0039: el gráfico «Memoria» pasa a bytes: usada y recuperable apiladas en área y la total
 * como línea discontinua, sin apilar. El eje, en bytes (GB adaptados), ya no va de 0 a 100. Cada
 * serie se reconoce por sus datos (pares [timestamp, valor]).
 */
describe('CA3 (0039): gráfico de memoria en bytes, usada y recuperable apiladas y total discontinua', () => {
  const memory = (): LineSeries[] => optionSeries('memory')
  const valuesOf = (item: LineSeries): unknown[] =>
    item.data.map((point) => (Array.isArray(point) ? point[1] : point))
  const byValues = (values: (number | null)[]): LineSeries | undefined =>
    memory().find((item) => JSON.stringify(valuesOf(item)) === JSON.stringify(values))

  it('tres series con los bytes de usada, recuperable y total', () => {
    expect(memory()).toHaveLength(3)
    expect(byValues([8_000_000_000, null, 10_000_000_000]), 'usada').toBeDefined()
    expect(byValues([3_000_000_000, null, 2_500_000_000]), 'recuperable').toBeDefined()
    expect(byValues([16_000_000_000, null, 16_000_000_000]), 'total').toBeDefined()
  })

  it('usada y recuperable, en área y en la misma pila', () => {
    const used = byValues([8_000_000_000, null, 10_000_000_000])
    const reclaimable = byValues([3_000_000_000, null, 2_500_000_000])
    for (const item of [used, reclaimable]) {
      expect(item?.type).toBe('line')
      expect(item?.areaStyle).toBeDefined()
      expect(item?.stack).toEqual(expect.anything())
    }
    expect(used?.stack).toBe(reclaimable?.stack)
  })

  it('la total, línea discontinua sin apilar ni área', () => {
    const total = byValues([16_000_000_000, null, 16_000_000_000])
    expect(total?.type).toBe('line')
    expect(total).not.toHaveProperty('stack')
    expect(total).not.toHaveProperty('areaStyle')
    expect(total?.lineStyle?.type).toBe('dashed')
  })

  it('el eje, en bytes con GB adaptados y sin máximo de 100', () => {
    const axis = hostChartOption('memory', data, { colors, language: 'es', t })['yAxis'] as {
      max?: number
      axisLabel: { formatter: (value: number) => string }
    }
    expect(axis.max).not.toBe(100)
    expect(axis.axisLabel.formatter(16_000_000_000).replace(/\s/g, ' ')).toMatch(/^16(,0)? GB$/)
  })
})
