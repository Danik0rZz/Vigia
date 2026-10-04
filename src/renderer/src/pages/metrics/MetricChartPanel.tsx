import { useCallback, useMemo, useRef, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { EChartsCoreOption } from 'echarts/core'
import type { MetricResult } from '@shared/modules'
import { seriesName } from '@shared/metric-points'
import type { TimeRangeValue } from '@shared/time-range'
import { Chart, type ChartColors, type ChartHandle } from '../../components/Chart'
import { ExportMenu } from '../../components/ExportMenu'
import { ApiWarnings } from '../../components/ModuleState'

/** Porcentaje entero de un ratio (0,5 → 50). */
const percent = (ratio: number): number => Math.round(ratio * 100)

/**
 * Gráfico del resultado, con su exportación y, debajo, los avisos: resolución
 * aplicada, resultados recortados por la API y sus `warnings`.
 */
export function MetricChartPanel({
  title,
  result,
  isEmpty,
  query,
  timeRange
}: {
  title: string | undefined
  result: MetricResult | undefined
  /** La consulta ha respondido sin series. */
  isEmpty: boolean
  query: string | undefined
  timeRange: TimeRangeValue
}): JSX.Element {
  const { t } = useTranslation()
  const chart = useRef<ChartHandle>(null)
  const series = useMemo(() => result?.series ?? [], [result])
  const names = useMemo(() => {
    const multipleMetrics = new Set(series.map((item) => item.metricId)).size > 1
    return series.map((item) => seriesName(item, multipleMetrics))
  }, [series])

  const buildOption = useCallback(
    (colors: ChartColors): EChartsCoreOption => ({
      animation: false,
      grid: { left: 48, right: 16, top: 24, bottom: 28 },
      tooltip: { trigger: 'axis' },
      legend: { show: series.length > 1, textStyle: { color: colors.muted }, top: 0 },
      xAxis: {
        type: 'time',
        axisLine: { lineStyle: { color: colors.border } },
        axisLabel: { color: colors.muted }
      },
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: colors.border } },
        axisLabel: { color: colors.muted }
      },
      series: series.map((item, index) => ({
        type: 'line',
        name: names[index],
        showSymbol: false,
        data: item.timestamps.map((time, i) => [time, item.values[i] ?? null]),
        ...(index === 0
          ? { lineStyle: { color: colors.accent }, itemStyle: { color: colors.accent } }
          : {})
      }))
    }),
    [series, names]
  )

  // Se calcula una vez por resultado, no en cada render (AUD-21: exportRows).
  const exportRows = useMemo(
    () =>
      series.flatMap((item) =>
        item.timestamps.map((time, i) => ({
          time,
          metricId: item.metricId,
          dimensions: Object.entries(item.dimensions)
            .map(([key, value]) => `${key}=${value}`)
            .join(', '),
          value: item.values[i] ?? null
        }))
      ),
    [series]
  )

  // Recortes de la API, en lenguaje claro.
  const partialLines = (result?.partial ?? []).flatMap((item) => [
    ...(item.dataPoints === null
      ? []
      : [
          t('metrics.partialPoints', { metricId: item.metricId, percent: percent(item.dataPoints) })
        ]),
    ...(item.dimensions === null
      ? []
      : [
          t('metrics.partialDimensions', {
            metricId: item.metricId,
            percent: percent(item.dimensions)
          })
        ])
  ])

  return (
    <section className="glass grid gap-2 rounded-xl p-4" aria-label={t('metrics.chart')}>
      <div className="flex items-center justify-between">
        <h2 className="truncate text-sm font-semibold">{title ?? t('metrics.chart')}</h2>
        <ExportMenu
          target="metric-chart"
          module="metrics"
          image={() => chart.current?.toPngDataUrl() ?? null}
          table={{
            columns: [
              { key: 'time', header: t('metrics.exportColumns.time'), type: 'date' },
              { key: 'metricId', header: t('metrics.exportColumns.metricId'), type: 'string' },
              { key: 'dimensions', header: t('metrics.exportColumns.dimensions'), type: 'string' },
              { key: 'value', header: t('metrics.exportColumns.value'), type: 'number' }
            ],
            rows: exportRows,
            query,
            timeRange,
            resolution: result?.resolution,
            warnings: [...partialLines, ...(result?.warnings ?? [])]
          }}
        />
      </div>
      <Chart
        ref={chart}
        testId="metric-chart"
        label={t('metrics.chart')}
        buildOption={buildOption}
        seriesNames={names}
      />
      {isEmpty && <p className="text-sm text-muted-foreground">{t('metrics.noSeries')}</p>}
      {result !== undefined && (
        <p data-testid="metric-resolution-applied" className="text-xs text-muted-foreground">
          {t('metrics.resolutionApplied', { resolution: result.resolution })}
        </p>
      )}
      <ApiWarnings warnings={[...partialLines, ...(result?.warnings ?? [])]} />
    </section>
  )
}
