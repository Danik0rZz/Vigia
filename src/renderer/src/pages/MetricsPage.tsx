import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { EChartsCoreOption } from 'echarts/core'
import { Save, Trash2 } from 'lucide-react'
import type { SavedQuery } from '@shared/modules'
import { useTimeRangeValue } from '../app/time-range'
import { Chart, type ChartColors, type ChartHandle } from '../components/Chart'
import { ConfirmDialog, FormDialog } from '../components/dialogs'
import { ExportMenu } from '../components/ExportMenu'
import { ModuleError, ModuleUnavailable, RefreshButton } from '../components/ModuleState'
import { PageHeader } from '../components/PageHeader'
import { BUTTON_ICON, BUTTON_PRIMARY, BUTTON_SECONDARY, INPUT } from '../components/styles'
import {
  useMetricQuery,
  useMetricSearch,
  useModuleAccess,
  useModuleRefresh,
  useSavedQueries,
  type MetricQueryParams
} from '../data/modules'
import { invoke } from '../lib/ipc'

const SEARCH_DEBOUNCE_MS = 300
/** Resoluciones del selector; '' = la de por defecto de la API (120 puntos). */
const RESOLUTIONS = ['', '1m', '5m', '10m', '1h', '6h', '1d', 'Inf'] as const

/** Métricas: búsqueda, consulta con resolución, gráfico y consultas guardadas por entorno. */
export function MetricsPage(): JSX.Element {
  const { t } = useTranslation()
  const access = useModuleAccess('metrics')
  const envId = access.available ? access.envId : null
  const timeRange = useTimeRangeValue()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()

  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [selector, setSelector] = useState('')
  const [resolution, setResolution] = useState<string>('')
  const [params, setParams] = useState<MetricQueryParams | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [saveError, setSaveError] = useState(false)
  const [deleting, setDeleting] = useState<SavedQuery | null>(null)
  const chart = useRef<ChartHandle>(null)

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [searchInput])

  const results = useMetricSearch(envId, search)
  const query = useMetricQuery(envId, params)
  const saved = useSavedQueries(envId)
  const refresh = useModuleRefresh(envId, 'metrics')
  const invalidateSaved = (): Promise<void> =>
    queryClient.invalidateQueries({ queryKey: ['savedQueries', envId] })

  const save = useMutation({
    mutationFn: (name: string) =>
      invoke('savedQueries:save', {
        environmentId: envId ?? '',
        name,
        metricSelector: selector,
        resolution: resolution === '' ? null : resolution
      }),
    onSettled: invalidateSaved
  })
  const remove = useMutation({
    mutationFn: (id: string) => invoke('savedQueries:delete', { id }),
    onSettled: invalidateSaved
  })

  const load = useCallback((savedQuery: SavedQuery) => {
    setSelector(savedQuery.metricSelector)
    setResolution(savedQuery.resolution ?? '')
    setParams({
      metricSelector: savedQuery.metricSelector,
      resolution: savedQuery.resolution ?? undefined
    })
  }, [])

  // Abrir una consulta guardada desde Ctrl+K (#/metrics?saved=<id>).
  const savedId = searchParams.get('saved')
  useEffect(() => {
    if (savedId === null || saved.data === undefined) return
    const found = saved.data.find((candidate) => candidate.id === savedId)
    // Sincroniza con la navegación (estado externo): abre la consulta que pide la URL.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (found !== undefined) load(found)
    setSearchParams({}, { replace: true })
  }, [savedId, saved.data, load, setSearchParams])

  const series = useMemo(() => query.data?.series ?? [], [query.data])
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
        name: Object.values(item.dimensions).join(' · ') || item.metricId,
        showSymbol: false,
        data: item.timestamps.map((time, i) => [time, item.values[i] ?? null]),
        ...(index === 0
          ? { lineStyle: { color: colors.accent }, itemStyle: { color: colors.accent } }
          : {})
      }))
    }),
    [series]
  )

  const exportRows = series.flatMap((item) =>
    item.timestamps.map((time, i) => ({
      time,
      metricId: item.metricId,
      dimensions: Object.entries(item.dimensions)
        .map(([key, value]) => `${key}=${value}`)
        .join(', '),
      value: item.values[i] ?? null
    }))
  )

  const run = (event?: FormEvent): void => {
    event?.preventDefault()
    if (selector.trim() === '') return
    setParams({
      metricSelector: selector.trim(),
      resolution: resolution === '' ? undefined : resolution
    })
  }

  const onSave = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setSaveError(false)
    try {
      await save.mutateAsync(saveName.trim())
      setSaving(false)
      setSaveName('')
    } catch {
      setSaveError(true)
    }
  }

  if (!access.available) {
    return (
      <>
        <PageHeader title={t('nav.metrics')} />
        <ModuleUnavailable access={access} />
      </>
    )
  }

  return (
    <>
      <PageHeader title={t('nav.metrics')} />
      <div className="grid gap-4 lg:grid-cols-[1fr_16rem]">
        <div className="grid content-start gap-4">
          <form onSubmit={run} className="glass grid gap-3 rounded-xl p-4">
            <label className="grid gap-1 text-xs text-muted-foreground">
              {t('metrics.search')}
              <input
                data-testid="metric-search"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                className={INPUT}
              />
            </label>
            {search !== '' && (results.data?.metrics.length ?? 0) > 0 && (
              <ul
                data-testid="metric-search-results"
                role="listbox"
                aria-label={t('metrics.search')}
                className="grid max-h-48 gap-0.5 overflow-y-auto"
              >
                {results.data?.metrics.map((metric) => (
                  <li
                    key={metric.metricId}
                    role="option"
                    aria-selected={selector === metric.metricId}
                    tabIndex={0}
                    onClick={() => {
                      setSelector(metric.metricId)
                      setSearchInput('')
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        setSelector(metric.metricId)
                        setSearchInput('')
                      }
                    }}
                    className="cursor-pointer rounded-md px-2 py-1 text-sm hover:bg-hover"
                  >
                    <span className="font-medium">{metric.displayName ?? metric.metricId}</span>{' '}
                    <span className="text-xs text-muted-foreground">{metric.metricId}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap items-end gap-3">
              <label className="grid flex-1 gap-1 text-xs text-muted-foreground">
                {t('metrics.selector')}
                <input
                  data-testid="metric-selector"
                  value={selector}
                  maxLength={2000}
                  onChange={(event) => setSelector(event.target.value)}
                  className={INPUT}
                />
              </label>
              <label className="grid gap-1 text-xs text-muted-foreground">
                {t('metrics.resolution')}
                <select
                  data-testid="metric-resolution"
                  value={resolution}
                  onChange={(event) => setResolution(event.target.value)}
                  className={`${INPUT} w-36`}
                >
                  {RESOLUTIONS.map((value) => (
                    <option key={value} value={value}>
                      {value === '' ? t('metrics.resolutionAuto') : value}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" data-testid="metric-run" className={BUTTON_PRIMARY}>
                {t('metrics.run')}
              </button>
              <button
                type="button"
                data-testid="saved-query-save"
                disabled={selector.trim() === ''}
                onClick={() => setSaving(true)}
                className={BUTTON_SECONDARY}
              >
                <Save aria-hidden="true" className="size-4" />
                {t('metrics.save')}
              </button>
              <RefreshButton onRefresh={refresh} busy={query.isFetching} />
            </div>
          </form>

          {query.error !== null && <ModuleError error={query.error} />}

          <section className="glass grid gap-2 rounded-xl p-4" aria-label={t('metrics.chart')}>
            <div className="flex items-center justify-between">
              <h2 className="truncate text-sm font-semibold">
                {params?.metricSelector ?? t('metrics.chart')}
              </h2>
              <ExportMenu
                target="metric-chart"
                module="metrics"
                image={() => chart.current?.toPngDataUrl() ?? null}
                table={{
                  columns: [
                    { key: 'time', header: 'time', type: 'date' },
                    { key: 'metricId', header: 'metricId', type: 'string' },
                    { key: 'dimensions', header: 'dimensions', type: 'string' },
                    { key: 'value', header: 'value', type: 'number' }
                  ],
                  rows: exportRows,
                  query: params?.metricSelector,
                  timeRange
                }}
              />
            </div>
            <Chart
              ref={chart}
              testId="metric-chart"
              label={t('metrics.chart')}
              buildOption={buildOption}
            />
            {query.isSuccess && series.length === 0 && (
              <p className="text-sm text-muted-foreground">{t('metrics.noSeries')}</p>
            )}
          </section>
        </div>

        <section
          className="glass grid content-start gap-2 rounded-xl p-4"
          aria-label={t('metrics.saved')}
        >
          <h2 className="text-sm font-semibold">{t('metrics.saved')}</h2>
          {(saved.data?.length ?? 0) === 0 && (
            <p className="text-xs text-muted-foreground">{t('metrics.noSaved')}</p>
          )}
          <ul className="grid gap-0.5">
            {saved.data?.map((savedQuery) => (
              <li
                key={savedQuery.id}
                data-testid="saved-query"
                className="flex items-center gap-1 rounded-md hover:bg-hover"
              >
                <button
                  type="button"
                  onClick={() => load(savedQuery)}
                  className="flex-1 truncate px-2 py-1 text-left text-sm"
                  title={savedQuery.metricSelector}
                >
                  {savedQuery.name}
                </button>
                <button
                  type="button"
                  data-testid="saved-query-delete"
                  aria-label={t('metrics.delete')}
                  title={t('metrics.delete')}
                  onClick={() => setDeleting(savedQuery)}
                  className={BUTTON_ICON}
                >
                  <Trash2 aria-hidden="true" className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <FormDialog
        open={saving}
        onOpenChange={(open) => setSaving(open)}
        title={t('metrics.saveTitle')}
        testId="saved-query-form"
      >
        <form onSubmit={(event) => void onSave(event)} className="grid gap-4" noValidate>
          <label className="grid gap-1 text-xs text-muted-foreground">
            {t('metrics.name')}
            <input
              data-testid="saved-query-name"
              value={saveName}
              maxLength={80}
              aria-invalid={saveError || undefined}
              onChange={(event) => setSaveName(event.target.value)}
              className={INPUT}
            />
          </label>
          {saveError && (
            <p role="alert" className="text-xs text-danger">
              {t('errors.nameTaken')}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              data-testid="form-cancel"
              onClick={() => setSaving(false)}
              className={BUTTON_SECONDARY}
            >
              {t('form.cancel')}
            </button>
            <button
              type="submit"
              data-testid="form-save"
              disabled={saveName.trim() === '' || save.isPending}
              className={BUTTON_PRIMARY}
            >
              {t('form.save')}
            </button>
          </div>
        </form>
      </FormDialog>

      <ConfirmDialog
        open={deleting !== null}
        title={deleting === null ? '' : t('metrics.deleteConfirm', { name: deleting.name })}
        description={t('metrics.deleteBody')}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting !== null) remove.mutate(deleting.id)
          setDeleting(null)
        }}
      />
    </>
  )
}
