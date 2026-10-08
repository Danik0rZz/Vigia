import { describe, expect, it } from 'vitest'
import type { TFunction } from 'i18next'
import type { MonitorMetricsResult, MonitorSeries } from '@shared/modules'
import type { ChartColors } from '../../components/Chart'
import {
  MONITOR_CHART_KINDS,
  monitorChartOption,
  monitorChartSelector,
  monitorChartSeries,
  monitorChartShown,
  monitorChartUnit
} from './monitor-charts'

/**
 * Ficha 0024: lo de los gráficos del monitor que no se ve en `data-series`: las ejecuciones van en
 * barras apiladas (correctas en verde y fallidas en rojo), sin líneas de rejilla, la
 * disponibilidad en un eje de 0 a 100 %, el rendimiento sin series no se pinta y «Abrir en
 * Métricas» lleva el filtro por el monitor.
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
const series = (values: (number | null)[]): MonitorSeries => ({
  timestamps: values.map((_, i) => 1_000 + i * 600_000),
  values
})
const EMPTY: MonitorSeries = { timestamps: [], values: [] }

const browser: MonitorMetricsResult = {
  kind: 'browser',
  resolution: '10m',
  series: {
    availability: series([100, null, 50]),
    duration: series([4200, null, 4800]),
    executions: { ok: series([3, null, 1]), failed: series([0, null, 1]) },
    performance: {
      largestContentfulPaint: series([1900, null, 2300]),
      visuallyComplete: series([2500, null, 2900]),
      cumulativeLayoutShift: series([0.05, null, 0.2]),
      speedIndex: series([1600, null, 1800])
    },
    httpTimings: null
  },
  totals: {
    availability: 87.5,
    duration: { avg: 4550, median: 4400 },
    executions: { ok: 4, failed: 1 }
  },
  warnings: [],
  partial: []
}
const http: MonitorMetricsResult = {
  ...browser,
  kind: 'http',
  series: {
    ...browser.series,
    performance: null,
    httpTimings: {
      dns: series([3, null, 5]),
      tcpConnect: series([10, null, 12]),
      tlsHandshake: series([20, null, 25]),
      timeToFirstByte: series([120, null, 160])
    }
  }
}

type OptionSeries = { type: string; stack?: unknown; itemStyle?: { color?: string } }
const optionOf = (
  kind: (typeof MONITOR_CHART_KINDS)[number],
  data = browser
): Record<string, unknown> => monitorChartOption(kind, data, { colors, language: 'es', t })

describe('gráficos del monitor (0024)', () => {
  it('las ejecuciones van en barras apiladas: correctas en verde y fallidas en rojo', () => {
    const list = optionOf('executions')['series'] as OptionSeries[]
    expect(list.map((item) => item.type)).toEqual(['bar', 'bar'])
    expect(list.map((item) => item.stack)).toEqual(['executions', 'executions'])
    expect(list.map((item) => item.itemStyle?.color)).toEqual([colors.success, colors.danger])
  })

  it('disponibilidad, duración y rendimiento son líneas, sin líneas de rejilla', () => {
    for (const kind of MONITOR_CHART_KINDS) {
      const option = optionOf(kind)
      const yAxis = option['yAxis'] as { splitLine: { show: boolean }; max?: number }
      expect(yAxis.splitLine.show, kind).toBe(false)
      if (kind !== 'executions') {
        const types = (option['series'] as OptionSeries[]).map((item) => item.type)
        expect(new Set(types), kind).toEqual(new Set(['line']))
      }
    }
    const availability = optionOf('availability')['yAxis'] as { max?: number }
    expect(availability.max).toBe(100)
  })

  it('el rendimiento del browser no pinta el CLS; el de HTTP, los cuatro tiempos', () => {
    expect(monitorChartSeries('performance', browser, { colors, t }).map((s) => s.name)).toEqual([
      'lcp',
      'visuallyComplete',
      'speedIndex'
    ])
    expect(monitorChartSeries('performance', http, { colors, t }).map((s) => s.name)).toEqual([
      'dns',
      'tcp',
      'tls',
      'ttfb'
    ])
  })

  it('el rendimiento sin ninguna serie no se pinta; mientras carga, sí', () => {
    const empty: MonitorMetricsResult = {
      ...browser,
      series: {
        ...browser.series,
        performance: {
          largestContentfulPaint: EMPTY,
          visuallyComplete: EMPTY,
          cumulativeLayoutShift: EMPTY,
          speedIndex: EMPTY
        }
      }
    }
    expect(monitorChartShown('performance', 'browser', empty)).toBe(false)
    expect(monitorChartShown('performance', 'browser', browser)).toBe(true)
    expect(monitorChartShown('performance', 'http', http)).toBe(true)
    expect(monitorChartShown('performance', 'http', browser)).toBe(false)
    expect(monitorChartShown('performance', 'browser', undefined)).toBe(true)
    expect(monitorChartShown('availability', 'browser', empty)).toBe(true)
  })

  it('«Abrir en Métricas» lleva cada expresión filtrada por el monitor', () => {
    const browserId = 'SYNTHETIC_TEST-0123456789ABCDEF'
    const httpId = 'HTTP_CHECK-0123456789ABCDEF'
    for (const kind of MONITOR_CHART_KINDS) {
      for (const expression of monitorChartSelector(kind, 'browser', browserId).split(
        /,(?=builtin:)/
      )) {
        expect(expression, kind).toContain(`eq("dt.entity.synthetic_test","${browserId}")`)
      }
      for (const expression of monitorChartSelector(kind, 'http', httpId).split(/,(?=builtin:)/)) {
        expect(expression, kind).toContain(`eq("dt.entity.http_check","${httpId}")`)
      }
    }
    expect(monitorChartSelector('executions', 'http', httpId)).toContain(
      'filter(and(eq("Result status","SUCCESS"),'
    )
  })

  it('unidades para la exportación', () => {
    expect(monitorChartUnit('availability', t)).toBe('%')
    expect(monitorChartUnit('duration', t)).toBe('ms')
    expect(monitorChartUnit('performance', t)).toBe('ms')
    expect(monitorChartUnit('executions', t)).toBe('executionsUnit')
  })
})
