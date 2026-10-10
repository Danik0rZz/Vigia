import { describe, expect, it } from 'vitest'
import type { TFunction } from 'i18next'
import type { ApplicationRumResult } from '@shared/modules'
import type { ChartColors } from '../../components/Chart'
import {
  sessionStats,
  userChartHasData,
  userChartOption,
  userChartSelector,
  userChartSeries,
  userChartUnit
} from './application-rum-users'

/** Ficha 0054: gráficos de «Usuarios y sesiones» y «Experiencia» de la aplicación, sin React. */
const t = ((key: string) => key) as unknown as TFunction
const colors: ChartColors = {
  foreground: 'fg',
  muted: 'muted',
  border: 'border',
  accent: 'accent',
  background: 'bg',
  danger: 'danger',
  success: 'success',
  series2: 's2',
  series3: 's3',
  series4: 's4',
  series5: 's5'
}
const APP = 'APPLICATION-0000000000000A01'
const empty = { timestamps: [], values: [] }
const some = (values: (number | null)[]): { timestamps: number[]; values: (number | null)[] } => ({
  timestamps: values.map((_, i) => i + 1),
  values
})

function result(): ApplicationRumResult {
  return {
    resolution: '10m',
    series: {
      actionsByType: { load: empty, xhr: empty, custom: empty },
      durationByType: { load: empty, xhr: empty, custom: empty },
      errorsByType: { javascript: empty, http: empty, other: empty },
      affectedActionsPct: empty,
      activeUsers: some([7, 8]),
      sessions: { started: some([3, 4]), ended: some([2, null]) },
      // En microsegundos.
      sessionDuration: some([45_600_000, null]),
      actionsPerSession: some([5, 6]),
      bounceRate: some([25, 30]),
      vitals: { lcp: some([2_200, 2_600]), cls: some([0.04, 0.2]), inp: empty },
      rageClicks: empty
    },
    totals: {
      actionsByType: { load: null, xhr: null, custom: null },
      durationByType: { load: null, xhr: null, custom: null },
      errorsByType: { javascript: null, http: null, other: null },
      affectedActionsPct: null,
      activeUsers: 9,
      sessions: { started: 7, ended: 2 },
      sessionDuration: 45_600_000,
      actionsPerSession: 5.94,
      bounceRate: 28.4,
      vitals: { lcp: 2_310, cls: 0.18, inp: null },
      rageClicks: null
    },
    warnings: [],
    partial: []
  }
}

type Option = {
  grid: { right: number }
  yAxis: { position: string; splitLine: { show: boolean } }[] | { splitLine: { show: boolean } }
  legend: { show: boolean }
  tooltip: { formatter: (params: unknown) => string }
  series: {
    type: string
    name: string
    yAxisIndex?: number
    markLine?: { data: { yAxis: number }[]; lineStyle: { type: string } }
  }[]
}
const option = (kind: Parameters<typeof userChartOption>[0], data = result()): Option =>
  userChartOption(kind, userChartSeries(kind, data, { colors, t }), '10m', {
    colors,
    language: 'es',
    t,
    range: { from: 0, to: 10 }
  }) as Option

describe('userChartSeries y userChartHasData (0054)', () => {
  it('sesiones: iniciadas, terminadas y duración media (de µs a ms, en el eje de la derecha)', () => {
    const series = userChartSeries('sessions', result(), { colors, t })
    expect(series.map((s) => [s.name, s.axis, s.unit])).toEqual([
      [
        'entities.application.charts.series.startedSessions',
        0,
        'entities.application.charts.units.sessions'
      ],
      [
        'entities.application.charts.series.endedSessions',
        0,
        'entities.application.charts.units.sessions'
      ],
      ['entities.application.charts.series.sessionDuration', 1, 'ms']
    ])
    expect(series[2]?.points).toEqual([
      [1, 45_600],
      [2, null]
    ])
  })

  it('Core Web Vitals: solo los que traen datos, con CLS en su eje y el umbral de «bueno»', () => {
    const series = userChartSeries('vitals', result(), { colors, t })
    expect(series.map((s) => [s.name, s.axis, s.threshold])).toEqual([
      ['entities.application.charts.series.lcp', 0, 2_500],
      ['entities.application.charts.series.cls', 1, 0.1]
    ])
  })

  it('un gráfico sin series con datos no sale', () => {
    const data = result()
    expect(userChartHasData(data, 'activeUsers')).toBe(true)
    expect(userChartHasData(data, 'sessions')).toBe(true)
    expect(userChartHasData(data, 'vitals')).toBe(true)
    data.series.activeUsers = empty
    data.totals.activeUsers = null
    data.series.vitals = { lcp: empty, cls: empty, inp: empty }
    data.totals.vitals = { lcp: null, cls: null, inp: null }
    expect(userChartHasData(data, 'activeUsers')).toBe(false)
    expect(userChartHasData(data, 'vitals')).toBe(false)
    expect(userChartSeries('activeUsers', result(), { colors, t })).toHaveLength(1)
  })
})

describe('userChartOption (0054)', () => {
  it('sesiones: barras en el eje izquierdo y la duración en línea a la derecha; sin rejilla', () => {
    const sessions = option('sessions')
    expect(sessions.series.map((s) => [s.type, s.yAxisIndex])).toEqual([
      ['bar', 0],
      ['bar', 0],
      ['line', 1]
    ])
    expect(Array.isArray(sessions.yAxis)).toBe(true)
    const axes = sessions.yAxis as { position: string; splitLine: { show: boolean } }[]
    expect(axes.map((a) => [a.position, a.splitLine.show])).toEqual([
      ['left', false],
      ['right', false]
    ])
    expect(sessions.legend.show).toBe(true)
    // Cada serie en el tooltip con el formato de su eje.
    const html = sessions.tooltip.formatter([
      { seriesName: 'entities.application.charts.series.startedSessions', value: [1, 1_234] },
      { seriesName: 'entities.application.charts.series.sessionDuration', value: [1, 45_600] }
    ])
    expect(html).toContain('1.234')
    expect(html).toMatch(/45,6\s?s/)
  })

  it('usuarios activos: una línea, un solo eje y sin leyenda', () => {
    const users = option('activeUsers')
    expect(users.series.map((s) => s.type)).toEqual(['line'])
    expect(Array.isArray(users.yAxis)).toBe(false)
    expect(users.legend.show).toBe(false)
    expect(users.grid.right).toBe(16)
  })

  it('Core Web Vitals: líneas con la discontinua en el umbral de «bueno» de cada una', () => {
    const vitals = option('vitals')
    expect(vitals.series.map((s) => [s.type, s.yAxisIndex, s.markLine?.data])).toEqual([
      ['line', 0, [{ yAxis: 2_500 }]],
      ['line', 1, [{ yAxis: 0.1 }]]
    ])
    expect(vitals.series.every((s) => s.markLine?.lineStyle.type === 'dashed')).toBe(true)
    const html = vitals.tooltip.formatter([
      { seriesName: 'entities.application.charts.series.cls', value: [1, 0.2] }
    ])
    expect(html).toContain('0,20')
  })
})

describe('userChartUnit, userChartSelector y sessionStats (0054)', () => {
  it('unidades y consultas de Métricas, filtradas por la aplicación', () => {
    expect(userChartUnit('activeUsers', t)).toBe('entities.application.charts.units.users')
    expect(userChartUnit('sessions', t)).toBe('entities.application.charts.units.sessions')
    expect(userChartUnit('vitals', t)).toBe('ms')
    const filter = `:filter(eq("dt.entity.application","${APP}"))`
    expect(userChartSelector('activeUsers', APP, undefined)).toBe(
      `builtin:apps.web.activeUsersEst${filter}:splitBy()`
    )
    expect(userChartSelector('sessions', APP, undefined).split(/,(?=builtin:)/)).toEqual([
      `builtin:apps.web.startedSessions${filter}:splitBy():sum`,
      `builtin:apps.web.endedSessions${filter}:splitBy():sum`,
      `builtin:apps.web.sessionDuration${filter}:splitBy():avg`
    ])
    // Con datos, solo las series pintadas (sin INP).
    expect(userChartSelector('vitals', APP, result()).split(/,(?=builtin:)/)).toEqual([
      `builtin:apps.web.largestContentfulPaint.load.browser${filter}:splitBy():percentile(75)`,
      `builtin:apps.web.cumulativeLayoutShift.load.browser${filter}:splitBy():percentile(75)`
    ])
    expect(userChartSelector('vitals', APP, undefined).split(/,(?=builtin:)/)).toHaveLength(3)
  })

  it('los datos pequeños con dato, formateados; sin rage clicks, ese no sale', () => {
    expect(sessionStats(result(), 'es')).toEqual([
      { stat: 'actionsPerSession', value: '5,9' },
      { stat: 'bounceRate', value: expect.stringMatching(/^28,4\s?%$/) as unknown as string }
    ])
    const data = result()
    data.totals.rageClicks = 1_234
    expect(sessionStats(data, 'es').map((s) => s.value)).toContain('1.234')
    data.totals.actionsPerSession = null
    data.totals.bounceRate = null
    data.totals.rageClicks = null
    expect(sessionStats(data, 'es')).toEqual([])
  })
})
