import { describe, expect, it } from 'vitest'
import type { TFunction } from 'i18next'
import type { DiskMetricsResult } from '@shared/modules'
import {
  diskChartOption,
  diskChartSelector,
  diskChartUnit,
  diskLayout,
  formatQueueLength
} from './disk-charts'
import { NO_COLORS } from './entity-charts'

/** Ficha 0040 (developer): qué se pinta en la página del disco y cómo. */

const s = (values: (number | null)[]): { timestamps: number[]; values: (number | null)[] } => ({
  timestamps: values.map((_, i) => i * 60_000),
  values
})

function result(overrides: Partial<DiskMetricsResult['series']> = {}): DiskMetricsResult {
  return {
    resolution: '1m',
    series: {
      usage: s([50, null]),
      space: { used: s([1, 2]), free: s([3, 4]) },
      throughput: { read: s([5]), write: s([6]) },
      latency: { read: s([7]), write: s([8]) },
      queue: s([0.5]),
      inodes: s([90]),
      ...overrides
    },
    totals: {
      usage: 50,
      free: 4,
      throughput: { read: 5, write: 6 },
      latency: { read: 7, write: 8 },
      queue: 0.5
    },
    warnings: [],
    partial: []
  }
}

const t = ((key: string) => key) as unknown as TFunction
const context = { colors: NO_COLORS, language: 'es', t }

describe('diskLayout (0040)', () => {
  it('latencia antes que cola; sin latencia, cola; sin las dos, nada', () => {
    expect(diskLayout(undefined)).toEqual({
      optional: 'latency',
      charts: ['usage', 'space', 'throughput', 'latency']
    })
    expect(diskLayout(result()).optional).toBe('latency')
    expect(diskLayout(result({ latency: null })).charts).toEqual([
      'usage',
      'space',
      'throughput',
      'queue'
    ])
    expect(diskLayout(result({ latency: null, queue: null }))).toEqual({
      optional: null,
      charts: ['usage', 'space', 'throughput']
    })
  })
})

describe('diskChartOption (0040)', () => {
  type Series = { name: string; stack?: string; areaStyle?: unknown; data: unknown[] }
  const seriesOf = (option: unknown): Series[] => (option as { series: Series[] }).series

  it('espacio: usado y libre apilados; el resto, líneas sueltas', () => {
    const space = seriesOf(diskChartOption('space', result(), context))
    expect(space.map((item) => item.stack)).toEqual(['space', 'space'])
    for (const item of space) expect(item.areaStyle).toBeDefined()
    for (const kind of ['usage', 'throughput', 'latency', 'queue'] as const) {
      for (const item of seriesOf(diskChartOption(kind, result(), context))) {
        expect(item, kind).not.toHaveProperty('stack')
      }
    }
  })

  it('uso en un eje de 0 a 100; un papel null da series vacías', () => {
    const option = diskChartOption('usage', result(), context) as { yAxis: { max?: number } }
    expect(option.yAxis.max).toBe(100)
    const latency = seriesOf(diskChartOption('latency', result({ latency: null }), context))
    expect(latency.map((item) => item.data)).toEqual([[], []])
    expect(seriesOf(diskChartOption('queue', result({ queue: null }), context))[0]?.data).toEqual(
      []
    )
  })
})

describe('selector, unidad y formato de la cola (0040)', () => {
  it('el selector lleva el filtro del disco en cada métrica', () => {
    expect(diskChartSelector('space', 'DISK-0123456789ABCDEF')).toBe(
      'builtin:host.disk.used:filter(eq("dt.entity.disk","DISK-0123456789ABCDEF")),' +
        'builtin:host.disk.avail:filter(eq("dt.entity.disk","DISK-0123456789ABCDEF"))'
    )
    expect(diskChartSelector('queue', 'DISK-0123456789ABCDEF')).toContain('queueLength')
    expect(
      ['usage', 'space', 'throughput', 'latency', 'queue'].map((k) => diskChartUnit(k as never))
    ).toEqual(['%', 'B', 'B/s', 'ms', ''])
  })

  it('la cola con dos decimales como mucho y «—» sin dato', () => {
    expect(formatQueueLength(0.75, 'es')).toBe('0,75')
    expect(formatQueueLength(null, 'es')).toBe('—')
  })
})
