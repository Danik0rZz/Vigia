import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { EChartsCoreOption } from 'echarts/core'
import type { ExportColumn, ProblemSummary } from '@shared/modules'
import { PROBLEM_EXPORT_COLUMNS, toProblemExport, toProblemRow } from '@shared/problem-row'
import { timeRangeToDates } from '@shared/time-range'
import { useTimeRangeValue } from '../app/time-range'
import { Chart, type ChartColors, type ChartHandle } from '../components/Chart'
import { ExportMenu } from '../components/ExportMenu'
import {
  ApiWarnings,
  ModuleError,
  ModuleUnavailable,
  RefreshButton,
  TruncatedNotice
} from '../components/ModuleState'
import { dataWarnings } from '../lib/data-warnings'
import { PageHeader } from '../components/PageHeader'
import { ProblemDetail } from '../components/ProblemDetail'
import { ProblemsTable } from '../components/ProblemsTable'
import { INPUT } from '../components/styles'
import {
  useModuleAccess,
  useModuleRefresh,
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

/** Problemas del entorno activo en el rango global: filtros, línea de tiempo, tabla y detalle. */
export function ProblemsPage(): JSX.Element {
  const { t } = useTranslation()
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

  // El rango del gráfico es el del momento en que llegaron los datos.
  const buckets = useMemo(() => {
    const range = timeRangeToDates(timeRange, new Date(query.dataUpdatedAt))
    return timelineBuckets(problems, range.from, range.to)
  }, [problems, timeRange, query.dataUpdatedAt])
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

  // Tabla y exportación usan las mismas filas; la duración de los abiertos, hasta la consulta.
  const rows = useMemo(() => {
    const now = new Date(query.dataUpdatedAt)
    return problems.map((problem) => toProblemRow(problem, now))
  }, [problems, query.dataUpdatedAt])
  const columns: ExportColumn[] = PROBLEM_EXPORT_COLUMNS.map((column) => ({
    ...column,
    header: t(`problems.exportColumns.${column.key}`)
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
              table={{
                columns,
                rows: rows.map(toProblemExport),
                query: text === '' ? undefined : text,
                timeRange,
                note: t('problems.exportNote'),
                warnings: dataWarnings(t, query.data?.invalid ?? 0, query.data?.warnings)
              }}
            />
          </div>
          <ApiWarnings invalid={query.data?.invalid} warnings={query.data?.warnings} />
          {query.data?.truncated === true && (
            <TruncatedNotice shown={problems.length} total={query.data.totalCount} />
          )}
          <ProblemsTable
            rows={rows}
            selected={selected}
            onSelect={setSelected}
            scrollRef={tableRef}
          />
          {query.isSuccess && problems.length === 0 && (
            <p className="px-2 py-3 text-sm text-muted-foreground">{t('module.empty')}</p>
          )}
          {query.isPending && query.fetchStatus !== 'idle' && (
            <p className="px-2 py-3 text-sm text-muted-foreground">{t('module.loading')}</p>
          )}
        </section>

        {selected !== null && envId !== null && (
          <ProblemDetail envId={envId} problemId={selected} timeRange={timeRange} />
        )}
      </div>
    </>
  )
}
