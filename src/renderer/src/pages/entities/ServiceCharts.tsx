import { useCallback, useMemo, useRef, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import type { UseQueryResult } from '@tanstack/react-query'
import type { EChartsCoreOption } from 'echarts/core'
import type { ServiceMetricsResult } from '@shared/modules'
import { timeRangeToDates, type TimeRangeValue } from '@shared/time-range'
import { useTimeRangeValue } from '../../app/time-range'
import { Chart, type ChartColors, type ChartHandle } from '../../components/Chart'
import { ExportMenu } from '../../components/ExportMenu'
import { PanelBoundary } from '../../components/PanelBoundary'
import { metricsRangeLink } from '../../lib/metrics-link'
import {
  SERVICE_CHART_KINDS,
  serviceChartOption,
  serviceChartSelector,
  serviceChartSeries,
  serviceChartSlug,
  serviceChartUnit,
  type ServiceChartKind
} from './service-charts'
import { MarkerError } from './ServiceMarkers'

/**
 * Sección «Métricas de peticiones» de la página de un SERVICE (ficha 0009): cuatro
 * gráficos en una rejilla de 2×2 (una columna por debajo de 1024 px). Todos salen de la
 * misma consulta que los marcadores (`entities:serviceMetrics`, una sola llamada).
 */
export function ServiceCharts({
  serviceId,
  metrics
}: {
  /** Id ya validado (`serviceEntityIdSchema`). */
  serviceId: string
  metrics: UseQueryResult<ServiceMetricsResult>
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <section
      data-testid="service-charts"
      aria-label={t('entities.service.charts.label')}
      className="grid gap-3"
    >
      <h2 className="text-sm font-semibold">{t('entities.service.charts.title')}</h2>
      <div className="grid gap-4 lg:grid-cols-2">
        {SERVICE_CHART_KINDS.map((kind) => (
          <ServiceChartPanel key={kind} kind={kind} serviceId={serviceId} metrics={metrics} />
        ))}
      </div>
    </section>
  )
}

/** Un gráfico con su título, «Abrir en Métricas» y la exportación; carga y falla por su lado. */
function ServiceChartPanel({
  kind,
  serviceId,
  metrics
}: {
  kind: ServiceChartKind
  serviceId: string
  metrics: UseQueryResult<ServiceMetricsResult>
}): JSX.Element {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const chart = useRef<ChartHandle>(null)
  const timeRange = useTimeRangeValue()
  const slug = serviceChartSlug(kind)
  const title = t(`entities.service.charts.${kind}`)
  const data = metrics.data
  const loadedAt = metrics.dataUpdatedAt
  // El rango que se ve: el relativo, contado desde que llegaron los datos.
  const range = useMemo(() => visibleRange(timeRange, loadedAt), [timeRange, loadedAt])
  const selector = serviceChartSelector(kind, serviceId)

  const buildOption = useCallback(
    (colors: ChartColors): EChartsCoreOption =>
      data === undefined
        ? {}
        : serviceChartOption(kind, data, { colors, language: i18n.language, t, range }),
    [kind, data, i18n.language, t, range]
  )

  // Nombres y puntos para el DOM (data-series) y la exportación; los colores no hacen falta.
  const series = useMemo(
    () =>
      data === undefined
        ? []
        : serviceChartSeries(kind, data, { colors: NO_COLORS, t }).map((item) => ({
            name: item.name,
            points: item.points
          })),
    [kind, data, t]
  )
  const names = useMemo(() => series.map((item) => item.name), [series])
  const unit = serviceChartUnit(kind, t)
  const exportRows = useMemo(
    () =>
      series.flatMap((item) =>
        item.points.map(([time, value]) => ({ time, series: item.name, value, unit }))
      ),
    [series, unit]
  )

  return (
    <section
      data-testid="service-chart-panel"
      data-kind={slug}
      aria-label={title}
      className="glass grid min-w-0 content-start gap-2 rounded-xl p-4"
    >
      <div className="flex min-w-0 items-center gap-3">
        <h3 className="mr-auto truncate text-sm font-semibold">{title}</h3>
        <button
          type="button"
          data-testid="service-chart-open"
          onClick={() => {
            // Sin datos todavía (cargando o con error), el rango contado desde ahora.
            const shown = loadedAt > 0 ? range : visibleRange(timeRange, Date.now())
            void navigate(metricsRangeLink(selector, shown.from, shown.to))
          }}
          className="shrink-0 text-xs underline underline-offset-2"
        >
          {t('problems.openInMetrics')}
        </button>
        {data !== undefined && !metrics.isError && (
          <ExportMenu
            target={`service-chart-${slug}`}
            module="metrics"
            image={() => chart.current?.toPngDataUrl() ?? null}
            table={{
              columns: [
                { key: 'time', header: t('metrics.exportColumns.time'), type: 'date' },
                {
                  key: 'series',
                  header: t('entities.service.charts.exportColumns.series'),
                  type: 'string'
                },
                { key: 'value', header: t('metrics.exportColumns.value'), type: 'number' },
                {
                  key: 'unit',
                  header: t('entities.service.charts.exportColumns.unit'),
                  type: 'string'
                }
              ],
              rows: exportRows,
              query: selector,
              timeRange,
              loadedAt,
              resolution: data.resolution,
              warnings: data.warnings
            }}
          />
        )}
      </div>
      {metrics.isError ? (
        <MarkerError
          error={metrics.error}
          busy={metrics.isFetching}
          onRetry={() => void metrics.refetch()}
        />
      ) : data === undefined ? (
        <div
          role="status"
          aria-label={t('entities.service.charts.loading')}
          className="h-60 rounded-lg bg-hover motion-safe:animate-pulse"
        />
      ) : (
        <PanelBoundary>
          <Chart
            ref={chart}
            testId={`service-chart-${slug}`}
            label={title}
            buildOption={buildOption}
            seriesNames={names}
          />
        </PanelBoundary>
      )}
    </section>
  )
}

/** Rango que se ve (ms desde epoch); el relativo, contado desde `at`. */
function visibleRange(timeRange: TimeRangeValue, at: number): { from: number; to: number } {
  const dates = timeRangeToDates(timeRange, new Date(at))
  return { from: dates.from.getTime(), to: dates.to.getTime() }
}

/** Sin colores: solo se quieren los nombres y los puntos de las series. */
const NO_COLORS: ChartColors = {
  foreground: '',
  muted: '',
  border: '',
  accent: '',
  background: '',
  danger: '',
  success: '',
  series2: '',
  series3: ''
}
