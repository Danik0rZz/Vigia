import { describe, expect, it } from 'vitest'
import type { TFunction } from 'i18next'
import type { ApplicationMetricsResult } from '@shared/modules'
import type { ChartColors } from '../../components/Chart'
import {
  APPLICATION_CHART_KINDS,
  applicationChartOption,
  applicationChartSelector,
  applicationChartSeries,
  applicationChartUnit,
  roleHasData
} from './application-charts'

/** Ficha 0034: gráficos de la aplicación, sin React. */
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

function result(overrides: Partial<ApplicationMetricsResult> = {}): ApplicationMetricsResult {
  return {
    resolution: '10m',
    series: {
      apdex: { timestamps: [1, 2], values: [0.9, null] },
      actions: { timestamps: [1, 2], values: [3, 4] },
      duration: { timestamps: [1, 2], values: [null, 1200] },
      errors: { timestamps: [1, 2], values: [0, 1] },
      sessions: { timestamps: [1, 2], values: [5, 6] }
    },
    totals: { apdex: 0.9, actions: 7, duration: 1200, errors: 1, sessions: 11 },
    topActions: [],
    warnings: [],
    partial: [],
    ...overrides
  }
}

describe('roleHasData (0034)', () => {
  it('con total o con algún punto, sí; con serie vacía o solo huecos y total null, no', () => {
    const data = result({
      series: {
        apdex: empty,
        actions: { timestamps: [1], values: [null] },
        duration: { timestamps: [1], values: [null] },
        errors: { timestamps: [1], values: [2] },
        sessions: empty
      },
      totals: { apdex: null, actions: null, duration: 900, errors: null, sessions: null }
    })
    expect(APPLICATION_CHART_KINDS.map((kind) => roleHasData(data, kind))).toEqual([
      false,
      false,
      true,
      true
    ])
  })
})

describe('applicationChartSeries y applicationChartOption (0034)', () => {
  it('una serie por gráfico, con sus puntos; la de errores en el color de error', () => {
    const data = result()
    expect(applicationChartSeries('apdex', data, { colors, t })).toEqual([
      {
        name: 'entities.application.charts.series.apdex',
        color: 'accent',
        points: [
          [1, 0.9],
          [2, null]
        ]
      }
    ])
    expect(applicationChartSeries('errors', data, { colors, t })[0]?.color).toBe('danger')
  })

  it('Apdex y duración en línea; acciones y errores en barras; sin rejilla; Apdex de 0 a 1', () => {
    const data = result()
    const option = (kind: (typeof APPLICATION_CHART_KINDS)[number]): Record<string, unknown> =>
      applicationChartOption(kind, applicationChartSeries(kind, data, { colors, t }), '10m', {
        colors,
        language: 'es',
        t,
        range: { from: 0, to: 10 }
      }) as Record<string, unknown>
    const type = (kind: (typeof APPLICATION_CHART_KINDS)[number]): unknown =>
      (option(kind)['series'] as { type: string }[])[0]?.type
    expect(APPLICATION_CHART_KINDS.map(type)).toEqual(['line', 'bar', 'line', 'bar'])
    const apdexAxis = option('apdex')['yAxis'] as Record<string, unknown>
    expect(apdexAxis['max']).toBe(1)
    expect(apdexAxis['splitLine']).toEqual({ show: false })
    const actionsAxis = option('actions')['yAxis'] as Record<string, unknown>
    expect(actionsAxis['max']).toBeUndefined()
    const xAxis = option('duration')['xAxis'] as Record<string, unknown>
    expect([xAxis['min'], xAxis['max']]).toEqual([0, 10])
    const format = (apdexAxis['axisLabel'] as { formatter: (value: number) => string }).formatter
    expect(format(0.5)).toBe('0,50')
    const durationFormat = (
      (option('duration')['yAxis'] as Record<string, unknown>)['axisLabel'] as {
        formatter: (value: number) => string
      }
    ).formatter
    expect(durationFormat(1500)).toBe('1,5 s')
    const countFormat = (actionsAxis['axisLabel'] as { formatter: (value: number) => string })
      .formatter
    expect(countFormat(12345)).toBe('12.345')
  })

  it('sin rango, el eje X se ajusta a los datos', () => {
    const option = applicationChartOption('apdex', [], '10m', {
      colors,
      language: 'en',
      t
    }) as Record<string, Record<string, unknown>>
    expect(option['xAxis']?.['min']).toBeUndefined()
  })
})

describe('applicationChartSelector y applicationChartUnit (0034)', () => {
  it('la métrica de main, filtrada por la aplicación, con su agregación', () => {
    expect(applicationChartSelector('apdex', APP)).toBe(
      `builtin:apps.web.apdex.userType:filter(eq("dt.entity.application","${APP}")):splitBy():avg`
    )
    expect(applicationChartSelector('actions', APP)).toBe(
      `builtin:apps.web.actionCount.summary:filter(eq("dt.entity.application","${APP}")):splitBy():sum`
    )
    expect(applicationChartSelector('duration', APP)).toContain(
      'builtin:apps.web.visuallyComplete.load.browser:filter('
    )
    expect(applicationChartSelector('errors', APP)).toMatch(/^builtin:apps\.web\.countOfErrors:/)
  })

  it('unidades de la exportación', () => {
    expect(APPLICATION_CHART_KINDS.map((kind) => applicationChartUnit(kind, t))).toEqual([
      'Apdex',
      'entities.application.charts.units.actions',
      'ms',
      'entities.application.charts.units.errors'
    ])
  })
})
