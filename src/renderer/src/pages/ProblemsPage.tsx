import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import type { EChartsCoreOption } from 'echarts/core'
import {
  impactLevels,
  SEVERITY_ORDER,
  type ExportColumn,
  type ImpactLevel,
  type ProblemSummary,
  type SeverityLevel
} from '@shared/modules'
import { PROBLEM_EXPORT_COLUMNS, toProblemExport, toProblemRow } from '@shared/problem-row'
import { sortProblems, uniqueAffected } from '@shared/problem-sort'
import { timeRangeToDates } from '@shared/time-range'
import { useProblemFilters } from '../app/problem-filters'
import { useTimeRangeValue } from '../app/time-range'
import { Chart, type ChartColors, type ChartHandle } from '../components/Chart'
import { ExportMenu } from '../components/ExportMenu'
import { PanelBoundary } from '../components/PanelBoundary'
import {
  ApiWarnings,
  ModuleError,
  ModuleUnavailable,
  RefreshButton,
  TruncatedNotice
} from '../components/ModuleState'
import { PageHeader } from '../components/PageHeader'
import { ClusterFilter } from '../components/ClusterFilter'
import { MultiFilter } from '../components/MultiFilter'
import { ProblemsTable, type ProblemGridItem } from '../components/ProblemsTable'
import { INPUT } from '../components/styles'
import {
  useModuleAccess,
  useModuleRefresh,
  useProblems,
  type ProblemFilterValues
} from '../data/modules'
import type { ProblemDetailLocationState } from './ProblemDetailPage'

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

/** Problemas del entorno activo en el rango global: filtros, línea de tiempo y tabla. */
export function ProblemsPage(): JSX.Element {
  const { t, i18n } = useTranslation()
  const access = useModuleAccess('problems')
  const envId = access.available ? access.envId : null
  const timeRange = useTimeRangeValue()
  // Los filtros viven en un store, por entorno: sobreviven al cambio de sección
  // y cada entorno recupera los suyos.
  const {
    status,
    setStatus,
    text: textInput,
    setText: setTextInput,
    clusters: clusterSelection,
    setClusters: setClusterSelection,
    severity,
    setSeverity,
    impact,
    setImpact,
    sort,
    setSort,
    scrollIndex,
    setScrollIndex,
    lastOpened,
    setLastOpened
  } = useProblemFilters(envId)
  const navigate = useNavigate()
  // Texto con retardo, ligado a su entorno: al cambiar de entorno (o al volver
  // a la sección) se aplica el texto guardado sin esperar.
  const [debounced, setDebounced] = useState({ envId, text: textInput.trim() })
  const text = debounced.envId === envId ? debounced.text : textInput.trim()
  // Abrir un problema lleva a su página; al volver, la lista recupera su fila.
  const open = useCallback(
    (problemId: string): void => {
      setLastOpened(problemId)
      const state: ProblemDetailLocationState = { fromList: true }
      void navigate(`/problems/${encodeURIComponent(problemId)}`, { state })
    },
    [navigate, setLastOpened]
  )
  const chart = useRef<ChartHandle>(null)
  const tableRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const timer = setTimeout(
      () => setDebounced({ envId, text: textInput.trim() }),
      TEXT_DEBOUNCE_MS
    )
    return () => clearTimeout(timer)
  }, [envId, textInput])

  const filters: ProblemFilterValues = {
    ...(status === 'all' ? {} : { status }),
    ...(text === '' ? {} : { text }),
    // Severidad e impacto sí filtran en Dynatrace (problemSelector).
    ...(severity.length === 0 ? {} : { severity }),
    ...(impact.length === 0 ? {} : { impact })
  }
  const query = useProblems(envId, filters)
  const refresh = useModuleRefresh(envId, 'problems')
  const loaded = useMemo(() => query.data?.problems ?? [], [query.data])

  // Filtro de clúster LOCAL (problemSelector no lo admite): sobre lo cargado.
  const clusterOptions = useMemo(
    () =>
      [...new Set(loaded.flatMap((problem) => problem.clusters))].sort((a, b) =>
        a.localeCompare(b)
      ),
    [loaded]
  )
  // Una selección que ya no está en los datos cargados no filtra.
  const activeClusters = useMemo(
    () => clusterSelection.filter((cluster) => clusterOptions.includes(cluster)),
    [clusterSelection, clusterOptions]
  )
  const filtered = activeClusters.length > 0
  const problems = useMemo(
    () =>
      activeClusters.length > 0
        ? loaded.filter((problem) => problem.clusters.some((c) => activeClusters.includes(c)))
        : loaded,
    [loaded, activeClusters]
  )

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

  // Se ordena solo lo cargado: la API ya da los más recientes primero, así que
  // con la lista recortada lo que falta es lo más antiguo.
  const items = useMemo(
    () =>
      sortProblems(
        problems.map((summary): ProblemGridItem => {
          const affected = uniqueAffected(summary.affectedEntities)
          return {
            summary,
            problemId: summary.problemId,
            displayId: summary.displayId,
            title: summary.title,
            startTime: summary.startTime,
            affected,
            affectedCount: affected.length
          }
        }),
        sort,
        i18n.language
      ),
    [problems, sort, i18n.language]
  )
  // La exportación es completa (todas las columnas), en el mismo orden que el grid;
  // la duración de los abiertos, hasta la consulta.
  const rows = useMemo(() => {
    const now = new Date(query.dataUpdatedAt)
    return items.map((item) => toProblemRow(item.summary, now))
  }, [items, query.dataUpdatedAt])
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
          <MultiFilter
            label={t('problems.filters.severity')}
            testId="problems-filter-severity"
            optionTestId="severity-option"
            options={SEVERITY_ORDER.map((value) => ({
              value,
              label: t(`problems.severity.${value}`)
            }))}
            selected={severity}
            onChange={(next) => setSeverity(next as SeverityLevel[])}
          />
          <MultiFilter
            label={t('problems.filters.impact')}
            testId="problems-filter-impact"
            optionTestId="impact-option"
            options={impactLevels.map((value) => ({
              value,
              label: t(`problems.impact.${value}`)
            }))}
            selected={impact}
            onChange={(next) => setImpact(next as ImpactLevel[])}
          />
          {clusterOptions.length > 0 && (
            <ClusterFilter
              options={clusterOptions}
              selected={activeClusters}
              onChange={setClusterSelection}
            />
          )}
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
                timeRange,
                loadedAt: query.dataUpdatedAt,
                clusterFilter: filtered ? activeClusters : undefined
              }}
            />
          </div>
          <PanelBoundary>
            <Chart
              ref={chart}
              testId="problems-timeline"
              label={t('problems.timeline')}
              buildOption={buildOption}
              height={180}
            />
          </PanelBoundary>
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
                loadedAt: query.dataUpdatedAt,
                note: t('problems.exportNote'),
                warnings: query.data?.warnings,
                invalidCount: query.data?.invalid,
                clusterFilter: filtered ? activeClusters : undefined
              }}
            />
          </div>
          <ApiWarnings invalid={query.data?.invalid} warnings={query.data?.warnings} />
          {query.data !== undefined && (
            <TruncatedNotice
              shown={problems.length}
              loaded={loaded.length}
              total={query.data.totalCount}
              truncated={query.data.truncated}
              filtered={filtered}
            />
          )}
          <PanelBoundary>
            <ProblemsTable
              items={items}
              selected={lastOpened}
              onSelect={open}
              scrollRef={tableRef}
              sort={sort}
              onSortChange={setSort}
              initialIndex={scrollIndex}
              onFirstVisibleChange={setScrollIndex}
            />
          </PanelBoundary>
          {query.isSuccess && problems.length === 0 && (
            <p className="px-2 py-3 text-sm text-muted-foreground">{t('module.empty')}</p>
          )}
          {query.isPending && query.fetchStatus !== 'idle' && (
            <p className="px-2 py-3 text-sm text-muted-foreground">{t('module.loading')}</p>
          )}
        </section>
      </div>
    </>
  )
}
