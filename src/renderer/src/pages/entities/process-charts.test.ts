import { describe, expect, it } from 'vitest'
import type { TFunction } from 'i18next'
import type { ProcessMetricsResult, ProcessSeries } from '@shared/modules'
import type { ChartColors } from '../../components/Chart'
import {
  processChartOption,
  processChartSelector,
  processChartSeries,
  processChartTitleKey,
  processChartUnit,
  processLayout,
  toBits,
  type ProcessChartKind
} from './process-charts'

/**
 * Ficha 0028: qué papeles del proceso se pintan y cómo, en lo que no se ve en los e2e (ejes,
 * unidades de la exportación y selectores de «Abrir en Métricas»).
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
const series = (values: (number | null)[]): ProcessSeries => ({
  timestamps: values.map((_, i) => 1_000 + i * 60_000),
  values
})
const EMPTY: ProcessSeries = { timestamps: [], values: [] }
const ID = 'PROCESS_GROUP_INSTANCE-0123456789ABCDEF'

function result(overrides: Partial<ProcessMetricsResult['series']> = {}): ProcessMetricsResult {
  return {
    resolution: '10m',
    series: {
      cpu: series([10, null, 20]),
      memory: series([1e8, null, 2e8]),
      network: { in: series([100, null, 200]), out: series([10, null, 20]) },
      networkHealth: series([0.5, null, 1]),
      availability: series([100, null, 100]),
      resources: series([0.5, null, 0.9]),
      ...overrides
    },
    totals: {
      cpu: { avg: 15, max: 20 },
      memory: { avg: 1.5e8, max: 2e8 },
      network: { in: 150, out: 15 },
      availability: 100,
      resources: 0.9
    },
    warnings: [],
    partial: []
  }
}

/** Sin datos en un papel: series vacías (o solo huecos) y marcadores a null. */
function withoutTotals(
  data: ProcessMetricsResult,
  totals: Partial<ProcessMetricsResult['totals']>
): ProcessMetricsResult {
  return { ...data, totals: { ...data.totals, ...totals } }
}

describe('processLayout (0028)', () => {
  it('sin datos todavía, todo lo que saldría con todos los papeles', () => {
    expect(processLayout(undefined)).toEqual({
      network: true,
      fourthMarker: 'availability',
      charts: ['cpu', 'memory', 'network', 'network-health']
    })
  })

  it('con todos, disponibilidad antes que recursos y salud de red antes que recursos', () => {
    expect(processLayout(result())).toEqual({
      network: true,
      fourthMarker: 'availability',
      charts: ['cpu', 'memory', 'network', 'network-health']
    })
  })

  it('un papel con solo huecos y sin marcador cuenta como sin datos', () => {
    const data = withoutTotals(
      result({
        network: { in: series([null, null]), out: EMPTY },
        networkHealth: EMPTY,
        availability: EMPTY
      }),
      { network: { in: null, out: null }, availability: null }
    )
    expect(processLayout(data)).toEqual({
      network: false,
      fourthMarker: 'resources',
      charts: ['cpu', 'memory', 'resources']
    })
  })

  it('con el marcador pero sin series, el papel se pinta', () => {
    const data = result({ availability: EMPTY })
    expect(processLayout(data).fourthMarker).toBe('availability')
  })

  it('sin disponibilidad, recursos ni salud de red: ni cuarto marcador ni cuarto gráfico', () => {
    const data = withoutTotals(
      result({ availability: EMPTY, resources: EMPTY, networkHealth: EMPTY }),
      { availability: null, resources: null }
    )
    expect(processLayout(data)).toEqual({
      network: true,
      fourthMarker: null,
      charts: ['cpu', 'memory', 'network']
    })
  })
})

describe('gráficos del proceso (0028)', () => {
  const kinds: ProcessChartKind[] = ['cpu', 'memory', 'network', 'network-health', 'resources']

  it('la red, en bits por segundo (llega en bytes/s)', () => {
    expect(toBits(256)).toBe(2048)
    expect(toBits(null)).toBeNull()
    const [inbound, outbound] = processChartSeries('network', result(), { colors, t })
    expect(inbound?.points).toEqual([
      [1_000, 800],
      [61_000, null],
      [121_000, 1600]
    ])
    expect(outbound?.points[0]).toEqual([1_000, 80])
  })

  it('ejes: CPU y recursos de 0 a 100 %; el resto desde 0 y sin tope; sin líneas de rejilla', () => {
    for (const kind of kinds) {
      const option = processChartOption(kind, result(), {
        colors,
        language: 'es',
        t,
        range: { from: 0, to: 200_000 }
      }) as { yAxis: { min: number; max?: number; splitLine: { show: boolean } } }
      expect(option.yAxis.min, kind).toBe(0)
      expect(option.yAxis.max, kind).toBe(kind === 'cpu' || kind === 'resources' ? 100 : undefined)
      expect(option.yAxis.splitLine.show, kind).toBe(false)
    }
  })

  it('leyenda solo con más de una serie (la red)', () => {
    for (const kind of kinds) {
      const option = processChartOption(kind, result(), { colors, language: 'en', t }) as {
        legend: { show: boolean }
      }
      expect(option.legend.show, kind).toBe(kind === 'network')
    }
  })

  it('unidades de la exportación y claves de los títulos', () => {
    expect(kinds.map(processChartUnit)).toEqual(['%', 'B', 'bit/s', '%', '%'])
    expect(kinds.map(processChartTitleKey)).toEqual([
      'cpu',
      'memory',
      'network',
      'networkHealth',
      'resources'
    ])
  })

  it('«Abrir en Métricas»: las métricas del canal, acotadas al proceso', () => {
    const filter = `:filter(eq("dt.entity.process_group_instance","${ID}"))`
    expect(processChartSelector('cpu', ID)).toBe(
      `builtin:tech.generic.cpu.usage${filter}:splitBy("dt.entity.process_group_instance")`
    )
    expect(processChartSelector('network', ID).match(/network\.bytes(Rx|Tx)/g)).toHaveLength(2)
    for (const kind of kinds) expect(processChartSelector(kind, ID), kind).toContain(filter)
  })
})
