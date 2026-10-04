import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import type { EChartsCoreOption } from 'echarts/core'
import {
  evidenceMetricRange,
  evidenceMetricState,
  pickResolution,
  selectSeries
} from '@shared/event-metric'
import { formatDateTime } from '@shared/format-date'
import { seriesName } from '@shared/metric-points'
import type { EvidenceView } from '@shared/problem-evidence'
import { useEvidenceMetric, useModuleAccess } from '../data/modules'
import { dateLang } from '../lib/date-lang'
import { IpcError } from '../lib/ipc'
import { metricsRangeLink } from '../lib/metrics-link'
import { Chart, type ChartColors, type ChartHandle } from './Chart'
import type { ProblemContext } from './EvidenceSection'
import { ExportMenu } from './ExportMenu'
import { ApiWarnings } from './ModuleState'

/** Series que se dibujan como mucho. */
const MAX_SERIES = 10

/** Si el elemento ya se ha visto en pantalla (una vez visto, sigue en true). */
function useSeen(): [React.RefObject<HTMLDivElement | null>, boolean] {
  const ref = useRef<HTMLDivElement>(null)
  // Sin IntersectionObserver (no pasa en Electron), se carga directamente.
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    const element = ref.current
    if (element === null || seen) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setSeen(true)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [seen])
  return [ref, seen]
}

/**
 * Mini gráfico de la métrica de un evento (dt.event.metric_selector): carga
 * diferida al verse en pantalla y en cola, el periodo de la evidencia
 * sombreado, el inicio del problema y el umbral, y como mucho 10 series (la de
 * la entidad, la primera y resaltada).
 */
export function EvidenceMetricChart({
  view,
  selector,
  threshold,
  problem
}: {
  view: EvidenceView
  selector: string
  threshold: number | null
  problem: ProblemContext
}): JSX.Element {
  const { t, i18n } = useTranslation()
  const lang = dateLang(i18n.language)
  const navigate = useNavigate()
  const access = useModuleAccess('problems')
  const envId = access.available ? access.envId : null
  const chart = useRef<ChartHandle>(null)
  const [ref, seen] = useSeen()
  // "Ahora" es el del problema (useProblemClock): el rango, y con él la clave de
  // caché, no cambia al volver a la página; solo con "Actualizar".
  const range = useMemo(
    () => evidenceMetricRange({ start: view.start, end: view.end }, problem, problem.now),
    [view.start, view.end, problem]
  )
  const resolution = pickResolution(range.from, range.to)
  const query = useEvidenceMetric(envId, { selector, ...range, resolution }, seen)
  const series = useMemo(() => query.data?.series ?? [], [query.data])
  const selection = useMemo(
    () => selectSeries(series, view.entity?.id ?? null, MAX_SERIES),
    [series, view.entity]
  )
  const names = useMemo(
    () => selection.shown.map((item) => seriesName(item, false)),
    [selection.shown]
  )
  const state = query.isSuccess
    ? evidenceMetricState(null, series.length)
    : query.error !== null
      ? evidenceMetricState(
          { code: query.error instanceof IpcError ? query.error.code : 'INTERNAL' },
          0
        )
      : null

  const evidenceEnd = view.end === 'ACTIVE' ? range.to : view.end
  const buildOption = useCallback(
    (colors: ChartColors): EChartsCoreOption => ({
      animation: false,
      grid: { left: 48, right: 16, top: names.length > 1 ? 28 : 12, bottom: 28 },
      tooltip: { trigger: 'axis' },
      legend: names.length > 1 ? { top: 0, textStyle: { color: colors.muted } } : undefined,
      xAxis: {
        type: 'time',
        min: range.from,
        max: range.to,
        axisLine: { lineStyle: { color: colors.border } },
        // Hora local con el formato propio de la app.
        axisLabel: {
          color: colors.muted,
          hideOverlap: true,
          formatter: (value: number) => formatDateTime(value, lang).slice(-5)
        }
      },
      yAxis: {
        type: 'value',
        scale: true,
        splitLine: { lineStyle: { color: colors.border } },
        axisLabel: {
          color: colors.muted,
          formatter: (value: number) =>
            new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 2 }).format(value)
        }
      },
      series: selection.shown.map((item, index) => ({
        type: 'line',
        name: names[index],
        showSymbol: false,
        // La de la entidad de la evidencia, más gruesa.
        lineStyle: { width: index === selection.highlighted ? 2.5 : 1.25 },
        data: item.timestamps.map((time, position) => [time, item.values[position] ?? null]),
        ...(index === 0
          ? {
              markArea: {
                silent: true,
                itemStyle: { color: colors.danger, opacity: 0.08 },
                data: [[{ xAxis: view.start ?? range.from }, { xAxis: evidenceEnd }]]
              },
              markLine: {
                silent: true,
                symbol: 'none',
                label: { show: false },
                data: [
                  {
                    xAxis: problem.startTime,
                    lineStyle: { color: colors.danger, type: 'solid', width: 1 }
                  },
                  ...(threshold === null
                    ? []
                    : [{ yAxis: threshold, lineStyle: { color: colors.danger, type: 'dashed' } }])
                ]
              }
            }
          : {})
      }))
    }),
    [
      selection,
      names,
      range,
      view.start,
      evidenceEnd,
      problem.startTime,
      threshold,
      lang,
      i18n.language
    ]
  )

  const exportRows = useMemo(
    () =>
      selection.shown.flatMap((item, index) =>
        item.timestamps.map((time, position) => ({
          time,
          series: names[index] ?? item.metricId,
          value: item.values[position] ?? null
        }))
      ),
    [selection.shown, names]
  )

  return (
    <div
      ref={ref}
      data-testid="evidence-metric-chart"
      className="grid gap-1.5 rounded-lg border border-border p-2"
    >
      <div className="flex items-center justify-end gap-3">
        {selection.total > MAX_SERIES && (
          <span
            data-testid="evidence-metric-truncated"
            className="mr-auto text-xs text-muted-foreground"
          >
            {t('problems.metricSeriesShown', { shown: MAX_SERIES, total: selection.total })}
          </span>
        )}
        <button
          type="button"
          data-testid="evidence-metric-open"
          onClick={() => void navigate(metricsRangeLink(selector, range.from, range.to))}
          className="text-xs underline underline-offset-2"
        >
          {t('problems.openInMetrics')}
        </button>
        {query.isSuccess && series.length > 0 && (
          <ExportMenu
            target="evidence-metric"
            module="problems"
            image={() => chart.current?.toPngDataUrl() ?? null}
            table={{
              columns: [
                { key: 'time', header: t('metrics.exportColumns.time'), type: 'date' },
                { key: 'series', header: t('problems.metricSeries'), type: 'string' },
                { key: 'value', header: t('metrics.exportColumns.value'), type: 'number' }
              ],
              rows: exportRows,
              query: selector,
              timeRange: {
                from: new Date(range.from).toISOString(),
                to: new Date(range.to).toISOString()
              },
              loadedAt: query.dataUpdatedAt,
              resolution: query.data.resolution,
              warnings: query.data.warnings
            }}
          />
        )}
      </div>
      {state === null && query.isSuccess ? (
        <Chart
          ref={chart}
          testId="evidence-metric"
          label={view.displayName}
          buildOption={buildOption}
          height={160}
          seriesNames={names}
        />
      ) : state !== null ? (
        // En el hueco del gráfico: un error no rompe la página.
        <p
          data-testid="evidence-metric-state"
          data-state={state}
          className="grid h-24 place-items-center text-xs text-muted-foreground"
        >
          {t(`problems.metricState.${state}`)}
        </p>
      ) : (
        <p
          data-testid="evidence-metric-loading"
          className="grid h-24 place-items-center text-xs text-muted-foreground"
        >
          {t('module.loading')}
        </p>
      )}
      {query.isSuccess && <ApiWarnings warnings={query.data.warnings} />}
    </div>
  )
}
