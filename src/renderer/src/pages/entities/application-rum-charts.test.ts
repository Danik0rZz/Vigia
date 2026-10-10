import { describe, expect, it } from 'vitest'
import type { TFunction } from 'i18next'
import type { ApplicationRumResult } from '@shared/modules'
import type { ChartColors } from '../../components/Chart'
import {
  errorsSeparated,
  rumChartHasData,
  rumChartOption,
  rumChartSelector,
  rumChartSeries,
  rumChartUnit,
  sumTotals
} from './application-rum-charts'

/** Ficha 0053: gráficos de «Actividad» y «Errores» de la aplicación, sin React. */
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
      actionsByType: { load: some([1, 2]), xhr: some([3, null]), custom: empty },
      durationByType: { load: some([900, 1000]), xhr: some([null, null]), custom: empty },
      errorsByType: { javascript: some([1, 0]), http: some([2, 3]), other: empty },
      affectedActionsPct: some([5, 6]),
      activeUsers: some([7, 8]),
      sessions: { started: some([1, 1]), ended: some([1, 1]) },
      sessionDuration: some([1, 2]),
      actionsPerSession: some([1, 2]),
      bounceRate: some([1, 2]),
      vitals: { lcp: empty, cls: empty, inp: empty },
      rageClicks: empty
    },
    totals: {
      actionsByType: { load: 3, xhr: 3, custom: null },
      durationByType: { load: 950, xhr: null, custom: null },
      errorsByType: { javascript: 1, http: 5, other: null },
      affectedActionsPct: 5.5,
      activeUsers: 9,
      sessions: { started: 2, ended: 2 },
      sessionDuration: 1.5,
      actionsPerSession: 1.5,
      bounceRate: 1.5,
      vitals: { lcp: null, cls: null, inp: null },
      rageClicks: null
    },
    warnings: [],
    partial: []
  }
}

describe('rumChartSeries (0053)', () => {
  it('una serie por tipo con datos, en su orden; custom y «otros» sin datos no salen', () => {
    const data = result()
    expect(rumChartSeries('actionsByType', data, { colors, t }).map((s) => s.name)).toEqual([
      'entities.application.charts.series.load',
      'entities.application.charts.series.xhr'
    ])
    // XHR sin ningún punto y total null: fuera.
    expect(rumChartSeries('durationByType', data, { colors, t }).map((s) => s.color)).toEqual([
      'accent'
    ])
    expect(rumChartSeries('errorsByType', data, { colors, t }).map((s) => s.name)).toEqual([
      'entities.application.charts.series.javascript',
      'entities.application.charts.series.http'
    ])
    expect(rumChartSeries('affectedActions', data, { colors, t })[0]?.points).toEqual([
      [1, 5],
      [2, 6]
    ])
  })

  it('errores sin separar (todo en «otros»): una sola serie en el color de error', () => {
    const data = result()
    data.series.errorsByType = { javascript: empty, http: empty, other: some([4, 5]) }
    data.totals.errorsByType = { javascript: null, http: null, other: 9 }
    expect(errorsSeparated(data)).toBe(false)
    const list = rumChartSeries('errorsByType', data, { colors, t })
    expect(list).toHaveLength(1)
    expect(list[0]?.color).toBe('danger')
    // Solo sin HTTP no es «sin separar».
    data.totals.errorsByType.javascript = 2
    expect(errorsSeparated(data)).toBe(true)
  })
})

describe('rumChartHasData y sumTotals (0053)', () => {
  it('un gráfico sin ningún tipo con datos no sale', () => {
    const data = result()
    expect(rumChartHasData(data, 'actionsByType')).toBe(true)
    data.series.actionsByType = { load: empty, xhr: some([null]), custom: empty }
    data.totals.actionsByType = { load: null, xhr: null, custom: null }
    expect(rumChartHasData(data, 'actionsByType')).toBe(false)
    data.series.affectedActionsPct = empty
    data.totals.affectedActionsPct = null
    expect(rumChartHasData(data, 'affectedActions')).toBe(false)
    expect(rumChartHasData(data, 'errorsByType')).toBe(true)
  })

  it('suma los totales con dato; sin ninguno, null', () => {
    expect(sumTotals([3, null, 4])).toBe(7)
    expect(sumTotals([null, null])).toBeNull()
  })
})

describe('rumChartOption, rumChartUnit y rumChartSelector (0053)', () => {
  it('acciones y errores en barras apiladas; duración y % en línea; sin rejilla; leyenda con varias', () => {
    const data = result()
    type Option = {
      series: { type: string; stack?: string }[]
      yAxis: { max?: number; splitLine: { show: boolean } }
      legend: { show: boolean }
    }
    const option = (kind: Parameters<typeof rumChartOption>[0]): Option =>
      rumChartOption(kind, rumChartSeries(kind, data, { colors, t }), '10m', {
        colors,
        language: 'es',
        t,
        range: { from: 0, to: 10 }
      }) as Option
    const actions = option('actionsByType')
    expect(actions.series.map((s) => [s.type, s.stack])).toEqual([
      ['bar', 'actionsByType'],
      ['bar', 'actionsByType']
    ])
    expect(actions.legend.show).toBe(true)
    expect(actions.yAxis.splitLine.show).toBe(false)
    expect(option('durationByType').series.map((s) => s.type)).toEqual(['line'])
    expect(option('durationByType').legend.show).toBe(false)
    expect(option('affectedActions').yAxis.max).toBe(100)
    expect(option('errorsByType').series.every((s) => s.type === 'bar')).toBe(true)
  })

  it('unidades y consultas de Métricas, filtradas por la aplicación', () => {
    expect(rumChartUnit('durationByType', t)).toBe('ms')
    expect(rumChartUnit('affectedActions', t)).toBe('%')
    expect(rumChartUnit('actionsByType', t)).toBe('entities.application.charts.units.actions')
    expect(rumChartUnit('errorsByType', t)).toBe('entities.application.charts.units.errors')
    const filter = `:filter(eq("dt.entity.application","${APP}"))`
    expect(rumChartSelector('actionsByType', APP, result())).toBe(
      [
        `builtin:apps.web.actionCount.load.browser${filter}:splitBy():sum`,
        `builtin:apps.web.actionCount.xhr.browser${filter}:splitBy():sum`
      ].join(',')
    )
    // Sin datos todavía, los tres tipos.
    expect(rumChartSelector('durationByType', APP, undefined).match(/builtin:/g)).toHaveLength(3)
    expect(rumChartSelector('errorsByType', APP, undefined)).toBe(
      `builtin:apps.web.countOfErrors${filter}:splitBy("Error type"):sum`
    )
    expect(rumChartSelector('affectedActions', APP, undefined)).toBe(
      `builtin:apps.web.percentageOfUserActionsAffectedByErrors${filter}:splitBy()`
    )
  })
})
