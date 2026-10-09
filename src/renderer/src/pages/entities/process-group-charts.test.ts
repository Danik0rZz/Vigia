import { describe, expect, it } from 'vitest'
import type { TFunction } from 'i18next'
import type {
  ProcessGroupInstance,
  ProcessGroupMetricsResult,
  ProcessMetricsResult,
  ProcessSeries
} from '@shared/modules'
import type { ChartColors } from '../../components/Chart'
import {
  combineInstanceCpu,
  groupChartOption,
  groupChartSelector,
  groupChartSeries,
  groupChartTitleKey,
  groupChartUnit,
  instanceCpuSelector,
  instanceCpuSeries,
  topInstances
} from './process-group-charts'

/**
 * Ficha 0032: gráficos de la página del process group, en lo que no se ve en los e2e (qué
 * instancias van en «CPU por instancia», ejes, unidades y selectores de «Abrir en Métricas»).
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
const series = (values: (number | null)[]): ProcessSeries => ({
  timestamps: values.map((_, i) => 1_000 + i * 60_000),
  values
})
const GROUP = 'PROCESS_GROUP-0123456789ABCDEF'
const pgi = (n: number): string => `PROCESS_GROUP_INSTANCE-000000000000000${n}`
const instance = (n: number, cpu: number | null): ProcessGroupInstance => ({
  id: pgi(n),
  name: `inst-${n}`,
  hostId: null,
  hostName: null,
  cpu,
  memory: null
})

function group(items: ProcessGroupInstance[]): ProcessGroupMetricsResult {
  return {
    resolution: '10m',
    series: {
      cpu: series([100, null, 120]),
      memory: series([1e8, 2e8]),
      network: { in: series([100, 200]), out: series([10, 20]) }
    },
    totals: {
      cpu: { avg: 110, max: 120 },
      memory: { avg: 1.5e8 },
      network: { in: 150, out: 15 }
    },
    instances: { items, total: items.length },
    warnings: [],
    partial: []
  }
}

const processResult = (cpu: ProcessSeries, warnings: string[] = []): ProcessMetricsResult =>
  ({
    resolution: '5m',
    series: { cpu },
    warnings
  }) as unknown as ProcessMetricsResult

describe('topInstances (0032)', () => {
  it('sin datos, ninguna', () => {
    expect(topInstances(undefined)).toEqual([])
  })

  it('las cinco primeras (main ya las da de más a menos CPU), sin las de sin dato ni id inválido', () => {
    const items = [
      instance(1, 50),
      { ...instance(2, 40), id: 'otra-cosa' },
      instance(3, 30),
      instance(4, 20),
      instance(5, 10),
      instance(6, 5),
      instance(7, 1),
      instance(8, null)
    ]
    expect(topInstances(group(items)).map((item) => item.id)).toEqual([1, 3, 4, 5, 6].map(pgi))
  })
})

describe('combineInstanceCpu (0032)', () => {
  it('una línea por instancia con su nombre y su serie; la resolución de la primera y los avisos sin repetir', () => {
    const data = combineInstanceCpu(
      [instance(1, 50), instance(2, 40)],
      [processResult(series([1, 2]), ['a']), processResult(series([3, 4]), ['a', 'b'])],
      '10m'
    )
    expect(data.resolution).toBe('5m')
    expect(data.warnings).toEqual(['a', 'b'])
    expect(data.lines.map((line) => [line.name, line.cpu.values])).toEqual([
      ['inst-1', [1, 2]],
      ['inst-2', [3, 4]]
    ])
  })

  it('sin instancias, la resolución del grupo y ninguna línea', () => {
    expect(combineInstanceCpu([], [], '10m')).toEqual({
      resolution: '10m',
      warnings: [],
      lines: []
    })
  })
})

describe('series y opción (0032)', () => {
  it('red en bits por segundo, entrada y salida', () => {
    const list = groupChartSeries('network', group([]), { colors, t })
    expect(list.map((item) => item.name)).toEqual(['in', 'out'])
    expect(list[0]?.points).toEqual([
      [1_000, 800],
      [61_000, 1600]
    ])
  })

  it('CPU y memoria, una serie con los huecos como null', () => {
    expect(groupChartSeries('cpu', group([]), { colors, t })[0]?.points[1]).toEqual([61_000, null])
    expect(groupChartSeries('memory', group([]), { colors, t })).toHaveLength(1)
  })

  it('«CPU por instancia»: cinco colores distintos, en orden', () => {
    const lines = [1, 2, 3, 4, 5].map((n) => ({ id: pgi(n), name: `i${n}`, cpu: series([n]) }))
    const list = instanceCpuSeries({ resolution: '5m', warnings: [], lines }, colors)
    expect(new Set(list.map((item) => item.color)).size).toBe(5)
    expect(list.map((item) => item.name)).toEqual(['i1', 'i2', 'i3', 'i4', 'i5'])
  })

  it('la CPU del grupo no tiene tope en el eje (la suma pasa de 100)', () => {
    const list = groupChartSeries('cpu', group([]), { colors, t })
    const option = groupChartOption('cpu', list, '10m', { colors, language: 'es', t }) as {
      yAxis: { min: number; max?: number }
      legend: { show: boolean }
      series: unknown[]
    }
    expect(option.yAxis.min).toBe(0)
    expect(option.yAxis.max).toBeUndefined()
    expect(option.legend.show).toBe(false)
    expect(option.series).toHaveLength(1)
  })

  it('con rango, el eje x lo respeta', () => {
    const option = groupChartOption('memory', [], '10m', {
      colors,
      language: 'es',
      t,
      range: { from: 1, to: 2 }
    }) as { xAxis: { min: number; max: number } }
    expect([option.xAxis.min, option.xAxis.max]).toEqual([1, 2])
  })
})

describe('unidades, títulos y selectores (0032)', () => {
  it('unidades de la exportación y claves de título', () => {
    expect(
      ['cpu', 'memory', 'network', 'cpu-instances'].map((k) => groupChartUnit(k as never))
    ).toEqual(['%', 'B', 'bit/s', '%'])
    expect(groupChartTitleKey('cpu-instances')).toBe('cpuByInstance')
    expect(groupChartTitleKey('network')).toBe('network')
  })

  it('el total, con la suma de las instancias del grupo elegidas por entitySelector en la expresión', () => {
    const scope = `:filter(in("dt.entity.process_group_instance",entitySelector("type(PROCESS_GROUP_INSTANCE),fromRelationships.isInstanceOf(entityId(${GROUP}))"))):splitBy():sum`
    expect(groupChartSelector('cpu', GROUP)).toBe(`builtin:tech.generic.cpu.usage${scope}`)
    expect(groupChartSelector('memory', GROUP)).toBe(
      `builtin:tech.generic.mem.workingSetSize${scope}`
    )
    expect(groupChartSelector('network', GROUP)).toBe(
      `builtin:tech.generic.network.bytesRx${scope},builtin:tech.generic.network.bytesTx${scope}`
    )
  })

  it('«CPU por instancia», la CPU de cada instancia, separadas por comas', () => {
    const selector = instanceCpuSelector([{ id: pgi(1) }, { id: pgi(2) }])
    expect(selector.split(',builtin:')).toHaveLength(2)
    expect(selector).toContain(`eq("dt.entity.process_group_instance","${pgi(1)}")`)
    expect(selector).toContain(`eq("dt.entity.process_group_instance","${pgi(2)}")`)
  })
})
