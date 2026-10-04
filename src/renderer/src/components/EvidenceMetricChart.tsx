import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import type { EChartsCoreOption } from 'echarts/core'
import {
  EVIDENCE_WINDOW_CHOICES,
  evidenceMetricState,
  evidenceMetricWindow,
  pickResolution,
  selectSeries,
  type EvidenceWindowChoice
} from '@shared/event-metric'
import { formatDateTime } from '@shared/format-date'
import { seriesName } from '@shared/metric-points'
import type { EvidenceView } from '@shared/problem-evidence'
import { useEvidenceMetric, useModuleAccess } from '../data/modules'
import { dateLang } from '../lib/date-lang'
import { IpcError } from '../lib/ipc'
import { metricsRangeLink } from '../lib/metrics-link'
import { cn } from '../lib/cn'
import { Chart, type ChartColors, type ChartHandle } from './Chart'
import { axisTooltip, timeAxisLabel } from './chart-time'
import type { ProblemContext } from './EvidenceSection'
import { ExportMenu } from './ExportMenu'
import { ApiWarnings } from './ModuleState'

/** Series que se dibujan como mucho. */
const MAX_SERIES = 10

/**
 * Si el elemento ya se ha visto en pantalla (una vez visto, sigue en true).
 * `already`: ya se vio en otra visita (hay datos de ese gráfico en la caché);
 * entonces no espera a volver a verse para pedir un rango nuevo ("Actualizar").
 */
function useSeen(already: boolean): [React.RefObject<HTMLDivElement | null>, boolean] {
  const ref = useRef<HTMLDivElement>(null)
  // Sin IntersectionObserver (no pasa en Electron), se carga directamente.
  const [seen, setSeen] = useState(() => already || typeof IntersectionObserver === 'undefined')
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
  const queryClient = useQueryClient()
  // Ya visto en otra visita: hay datos de este selector en la caché del entorno.
  const [already] = useState(() =>
    queryClient
      .getQueriesData({ queryKey: [envId ?? '', 'evidenceMetric', selector] })
      .some(([, data]) => data !== undefined)
  )
  const [ref, seen] = useSeen(already)
  // "Ahora" es el del problema (useProblemClock): el rango, y con él la clave de
  // caché, no cambia al volver a la página; solo con "Actualizar".
  // Ventana: en evidencias largas, por defecto los últimos 7 días (estado local:
  // al volver al problema empieza otra vez en 7 días).
  const [choice, setChoice] = useState<EvidenceWindowChoice>('7d')
  const visible = useMemo(
    () => evidenceMetricWindow({ start: view.start, end: view.end }, problem, problem.now, choice),
    [view.start, view.end, problem, choice]
  )
  const range = useMemo(() => ({ from: visible.from, to: visible.to }), [visible.from, visible.to])
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

  // El periodo de la evidencia, recortado a lo visible.
  const evidenceStart = Math.max(view.start ?? range.from, range.from)
  const evidenceEnd = Math.min(view.end === 'ACTIVE' ? range.to : view.end, range.to)
  // La línea del inicio del problema, solo si cae dentro de lo visible.
  const showStart =
    !visible.clipped.startOutside &&
    problem.startTime >= range.from &&
    problem.startTime <= range.to
  // Etiquetas según la resolución que devuelve la API (puede ser más gruesa que la pedida).
  const axisResolution = query.data?.resolution ?? resolution
  const buildOption = useCallback(
    (colors: ChartColors): EChartsCoreOption => ({
      animation: false,
      grid: { left: 48, right: 16, top: names.length > 1 ? 28 : 12, bottom: 28 },
      tooltip: axisTooltip(i18n.language, (value) =>
        new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 2 }).format(value)
      ),
      legend: names.length > 1 ? { top: 0, textStyle: { color: colors.muted } } : undefined,
      xAxis: {
        type: 'time',
        min: range.from,
        max: range.to,
        axisLine: { lineStyle: { color: colors.border } },
        // Hora local, por niveles: la fecha en el cambio de día (y solo la fecha con puntos diarios).
        axisLabel: { color: colors.muted, ...timeAxisLabel(i18n.language, axisResolution) }
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
                data: [[{ xAxis: evidenceStart }, { xAxis: evidenceEnd }]]
              },
              markLine: {
                silent: true,
                symbol: 'none',
                label: { show: false },
                data: [
                  ...(showStart
                    ? [
                        {
                          xAxis: problem.startTime,
                          lineStyle: { color: colors.danger, type: 'solid', width: 1 }
                        }
                      ]
                    : []),
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
      evidenceStart,
      evidenceEnd,
      showStart,
      problem.startTime,
      threshold,
      axisResolution,
      i18n.language
    ]
  )

  // En Info de la exportación: el rango que se ve, si es una parte de la evidencia.
  const visibleNote = visible.long
    ? [
        t('problems.metricWindow.visibleRange', {
          from: formatDateTime(range.from, lang),
          to: formatDateTime(range.to, lang),
          days: visible.evidenceDays
        })
      ]
    : []

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
              warnings: [...visibleNote, ...query.data.warnings]
            }}
          />
        )}
      </div>
      {visible.long && (
        <div className="flex flex-wrap items-center gap-3">
          <div
            role="group"
            data-testid="evidence-metric-window"
            aria-label={t('problems.metricWindow.label')}
            className="flex overflow-hidden rounded-md border border-border text-xs"
          >
            {EVIDENCE_WINDOW_CHOICES.map((option) => (
              <button
                key={option}
                type="button"
                data-testid={`evidence-metric-window-${option}`}
                aria-pressed={choice === option}
                onClick={() => setChoice(option)}
                className={cn(
                  'px-2 py-1',
                  choice === option
                    ? 'bg-active text-foreground'
                    : 'text-muted-foreground hover:bg-hover'
                )}
              >
                {t(`problems.metricWindow.${option}`)}
              </button>
            ))}
          </div>
          {visible.clipped.startOutside && choice !== 'all' && (
            <p data-testid="evidence-metric-window-note" className="text-xs text-muted-foreground">
              {t('problems.metricWindow.note', {
                shown: choice === '30d' ? 30 : 7,
                days: visible.evidenceDays
              })}
            </p>
          )}
        </div>
      )}
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
