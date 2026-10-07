import { useCallback, useMemo, useRef, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { EChartsCoreOption } from 'echarts/core'
import type { MetricResult } from '@shared/modules'
import { seriesName } from '@shared/metric-points'
import type { TimeRangeValue } from '@shared/time-range'
import { Chart, type ChartColors, type ChartHandle } from '../../components/Chart'
import { ExportMenu } from '../../components/ExportMenu'
import { ApiWarnings } from '../../components/ModuleState'
import { PanelBoundary } from '../../components/PanelBoundary'
import { metricChartOption } from './metric-chart-option'

/**
 * Parte que sí llegó, en porcentaje entero, de un ratio de recorte («pedido /
 * máximo permitido», siempre > 1): 1,5 → 67; 4 → 25. Como mínimo 1.
 */
const percent = (ratio: number): number => Math.max(1, Math.round(100 / ratio))

/**
 * Gráfico del resultado, con su exportación y, debajo, los avisos: resolución
 * aplicada, resultados recortados por la API y sus `warnings`.
 */
export function MetricChartPanel({
  title,
  result,
  isEmpty,
  query,
  timeRange,
  loadedAt
}: {
  title: string | undefined
  result: MetricResult | undefined
  /** La consulta ha respondido sin series. */
  isEmpty: boolean
  query: string | undefined
  timeRange: TimeRangeValue
  /** Cuándo llegaron los datos (dataUpdatedAt), para el rango de la hoja Info. */
  loadedAt: number
}): JSX.Element {
  const { t, i18n } = useTranslation()
  const chart = useRef<ChartHandle>(null)
  const series = useMemo(() => result?.series ?? [], [result])
  const names = useMemo(() => {
    const multipleMetrics = new Set(series.map((item) => item.metricId)).size > 1
    return series.map((item) => seriesName(item, multipleMetrics))
  }, [series])

  // Etiquetas según la resolución que devuelve la API, no la pedida.
  const resolution = result?.resolution ?? null
  const buildOption = useCallback(
    (colors: ChartColors): EChartsCoreOption =>
      metricChartOption({ series, names, resolution, language: i18n.language, colors }),
    [series, names, resolution, i18n.language]
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
            loadedAt,
            resolution: result?.resolution,
            warnings: [...partialLines, ...(result?.warnings ?? [])]
          }}
        />
      </div>
      <PanelBoundary>
        <Chart
          ref={chart}
          testId="metric-chart"
          label={t('metrics.chart')}
          buildOption={buildOption}
          seriesNames={names}
        />
      </PanelBoundary>
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
