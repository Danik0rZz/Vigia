import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { EChartsCoreOption } from 'echarts/core'
import type { ExportColumn, ProblemSummary } from '@shared/modules'
import { timeRangeToDates } from '@shared/time-range'
import { useTimeRangeValue } from '../app/time-range'
import { Chart, type ChartColors, type ChartHandle } from '../components/Chart'
import { ExportMenu } from '../components/ExportMenu'
import {
  ModuleError,
  ModuleUnavailable,
  RefreshButton,
  TruncatedNotice
} from '../components/ModuleState'
import { PageHeader } from '../components/PageHeader'
import { INPUT } from '../components/styles'
import {
  useModuleAccess,
  useModuleRefresh,
  useProblem,
  useProblems,
  type ProblemFilterValues
} from '../data/modules'

const TEXT_DEBOUNCE_MS = 300
const BUCKETS = 24

/** Problemas por intervalo según su inicio, en el rango de la vista. */
function timelineBuckets(problems: ProblemSummary[], from: Date, to: Date): [number, number][] {
  const span = Math.max(1, to.getTime() - from.getTime())
  const size = span / BUCKETS
  const counts = Array.from({ length: BUCKETS }, () => 0)
  for (const problem of problems) {
    const index = Math.floor((problem.startTime - from.getTime()) / size)
    if (index >= 0 && index < BUCKETS) counts[index] = (counts[index] ?? 0) + 1
  }
  return counts.map((count, index) => [from.getTime() + index * size, count])
}

function ProblemDetail({ envId, problemId }: { envId: string; problemId: string }): JSX.Element {
  const { t } = useTranslation()
  const { data, error } = useProblem(envId, problemId)
  if (error !== null) return <ModuleError error={error} />
  if (data === undefined)
    return <p className="text-sm text-muted-foreground">{t('module.loading')}</p>
  return (
    <section
      data-testid="problem-detail"
      className="glass grid gap-2 rounded-xl p-5"
      aria-label={t('problems.detail')}
    >
      <h2 className="font-semibold">{`${data.displayId} · ${data.title}`}</h2>
      {data.rootCause !== null && (
        <p className="text-sm">
          <span className="text-muted-foreground">{t('problems.rootCause')}: </span>
          {data.rootCause.name ?? data.rootCause.id}
        </p>
      )}
      <h3 className="text-sm font-medium text-muted-foreground">
        {t('problems.affectedEntities')}
      </h3>
      <ul className="grid gap-1 text-sm">
        {data.affectedEntities.map((entity) => (
          <li key={entity.id} data-testid="problem-entity" className="flex gap-2">
            <span>{entity.name ?? entity.id}</span>
            <span className="text-muted-foreground">{entity.type}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Problemas del entorno activo en el rango global: filtros, línea de tiempo, tabla y detalle. */
export function ProblemsPage(): JSX.Element {
  const { t, i18n } = useTranslation()
  const access = useModuleAccess('problems')
  const envId = access.available ? access.envId : null
  const timeRange = useTimeRangeValue()
  const [status, setStatus] = useState<'all' | 'open' | 'closed'>('all')
  const [textInput, setTextInput] = useState('')
  const [text, setText] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const chart = useRef<ChartHandle>(null)
  const tableRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const timer = setTimeout(() => setText(textInput.trim()), TEXT_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [textInput])

  const filters: ProblemFilterValues = {
    ...(status === 'all' ? {} : { status }),
    ...(text === '' ? {} : { text })
  }
  const query = useProblems(envId, filters)
  const refresh = useModuleRefresh(envId, 'problems')
  const problems = useMemo(() => query.data?.problems ?? [], [query.data])

  const formatDate = useCallback(
    (value: number | null) =>
      value === null
        ? ''
        : new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'short' }).format(
            value
          ),
    [i18n.language]
  )

  // El rango del gráfico es el del momento en que llegaron los datos.
  const range = timeRangeToDates(timeRange, new Date(query.dataUpdatedAt))
  const buckets = useMemo(
    () => timelineBuckets(problems, range.from, range.to),
    // El rango se fija con los datos: no se recalcula en cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [problems, query.dataUpdatedAt]
  )
  const buildOption = useCallback(
    (colors: ChartColors): EChartsCoreOption => ({
      animation: false,
      grid: { left: 32, right: 16, top: 16, bottom: 28 },
      tooltip: { trigger: 'axis' },
      xAxis: {
        type: 'time',
        axisLine: { lineStyle: { color: colors.border } },
        axisLabel: { color: colors.muted }
      },
      yAxis: {
        type: 'value',
        minInterval: 1,
        splitLine: { lineStyle: { color: colors.border } },
        axisLabel: { color: colors.muted }
      },
      series: [{ type: 'bar', data: buckets, itemStyle: { color: colors.accent } }]
    }),
    [buckets]
  )

  const columns: ExportColumn[] = [
    { key: 'displayId', header: t('problems.columns.displayId'), type: 'string' },
    { key: 'title', header: t('problems.columns.title'), type: 'string' },
    { key: 'status', header: t('problems.columns.status'), type: 'string' },
    { key: 'severityLevel', header: t('problems.columns.severity'), type: 'string' },
    { key: 'impactLevel', header: t('problems.columns.impact'), type: 'string' },
    { key: 'startTime', header: t('problems.columns.start'), type: 'date' },
    { key: 'endTime', header: t('problems.columns.end'), type: 'date' },
    { key: 'affectedEntities', header: t('problems.columns.affected'), type: 'string' }
  ]
  const rows = problems.map((problem) => ({
    displayId: problem.displayId,
    title: problem.title,
    status: problem.status,
    severityLevel: problem.severityLevel,
    impactLevel: problem.impactLevel,
    startTime: problem.startTime,
    endTime: problem.endTime,
    affectedEntities: problem.affectedEntities.map((entity) => entity.name ?? entity.id).join(', ')
  }))

  if (!access.available) {
    return (
      <>
        <PageHeader title={t('nav.problems')} />
        <ModuleUnavailable access={access} />
      </>
    )
  }

  return (
    <>
      <PageHeader title={t('nav.problems')} />
      <div className="grid gap-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-xs text-muted-foreground">
            {t('problems.filters.status')}
            <select
              data-testid="problems-filter-status"
              value={status}
              onChange={(event) => setStatus(event.target.value as typeof status)}
              className={`${INPUT} w-40`}
            >
              <option value="all">{t('problems.filters.all')}</option>
              <option value="open">{t('problems.filters.open')}</option>
              <option value="closed">{t('problems.filters.closed')}</option>
            </select>
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            {t('problems.filters.text')}
            <input
              data-testid="problems-filter-text"
              value={textInput}
              maxLength={30}
              onChange={(event) => setTextInput(event.target.value)}
              className={`${INPUT} w-60`}
            />
          </label>
          <span className="flex-1" />
          <RefreshButton onRefresh={refresh} busy={query.isFetching} />
        </div>

        {query.error !== null && <ModuleError error={query.error} />}

        <section className="glass grid gap-2 rounded-xl p-4" aria-label={t('problems.timeline')}>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">{t('problems.timeline')}</h2>
            <ExportMenu
              target="problems-timeline"
              module="problems"
              image={() => chart.current?.toPngDataUrl() ?? null}
              table={{
                columns: [
                  { key: 'time', header: t('problems.columns.start'), type: 'date' },
                  { key: 'count', header: t('problems.table'), type: 'number' }
                ],
                rows: buckets.map(([time, count]) => ({ time, count })),
                timeRange
              }}
            />
          </div>
          <Chart
            ref={chart}
            testId="problems-timeline"
            label={t('problems.timeline')}
            buildOption={buildOption}
            height={180}
          />
        </section>

        <section className="glass grid gap-2 rounded-xl p-4" aria-label={t('problems.table')}>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">{t('problems.table')}</h2>
            <ExportMenu
              target="problems-table"
              module="problems"
              element={tableRef}
              table={{ columns, rows, query: text === '' ? undefined : text, timeRange }}
            />
          </div>
          {query.data?.truncated === true && <TruncatedNotice count={problems.length} />}
          <div ref={tableRef} className="overflow-x-auto">
            <table data-testid="problems-table" className="w-full text-left text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  {columns.slice(0, 7).map((column) => (
                    <th key={column.key} className="px-2 py-1.5 font-medium">
                      {column.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {problems.map((problem) => (
                  <tr
                    key={problem.problemId}
                    data-testid="problem-row"
                    onClick={() => setSelected(problem.problemId)}
                    className="cursor-pointer border-t border-border hover:bg-hover aria-selected:bg-active"
                    aria-selected={selected === problem.problemId}
                  >
                    <td className="px-2 py-1.5 font-medium">{problem.displayId}</td>
                    <td className="px-2 py-1.5">{problem.title}</td>
                    <td className="px-2 py-1.5">{t(`problems.status.${problem.status}`)}</td>
                    <td className="px-2 py-1.5">
                      {t(`problems.severity.${problem.severityLevel}`)}
                    </td>
                    <td className="px-2 py-1.5">{t(`problems.impact.${problem.impactLevel}`)}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">
                      {formatDate(problem.startTime)}
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap">{formatDate(problem.endTime)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {query.isSuccess && problems.length === 0 && (
              <p className="px-2 py-3 text-sm text-muted-foreground">{t('module.empty')}</p>
            )}
            {query.isPending && query.fetchStatus !== 'idle' && (
              <p className="px-2 py-3 text-sm text-muted-foreground">{t('module.loading')}</p>
            )}
          </div>
        </section>

        {selected !== null && envId !== null && (
          <ProblemDetail envId={envId} problemId={selected} />
        )}
      </div>
    </>
  )
}
