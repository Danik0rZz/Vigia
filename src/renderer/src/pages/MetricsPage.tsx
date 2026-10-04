import { useCallback, useEffect, useState, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { SavedQuery } from '@shared/modules'
import { timeRangeToDates } from '@shared/time-range'
import { useTimeRangeValue } from '../app/time-range'
import { ModuleError, ModuleUnavailable } from '../components/ModuleState'
import { PageHeader } from '../components/PageHeader'
import {
  useMetricQuery,
  useModuleAccess,
  useModuleRefresh,
  useSavedQueries,
  type MetricQueryParams
} from '../data/modules'
import { invoke } from '../lib/ipc'
import { MetricChartPanel } from './metrics/MetricChartPanel'
import { MetricQueryForm } from './metrics/MetricQueryForm'
import { MetricSearch } from './metrics/MetricSearch'
import { SavedQueriesPanel } from './metrics/SavedQueriesPanel'
import { SaveQueryDialog } from './metrics/SaveQueryDialog'

/** Métricas: búsqueda, consulta con resolución, gráfico y consultas guardadas por entorno. */
export function MetricsPage(): JSX.Element {
  const { t } = useTranslation()
  const access = useModuleAccess('metrics')
  const envId = access.available ? access.envId : null
  const timeRange = useTimeRangeValue()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()

  const [selector, setSelector] = useState('')
  const [resolution, setResolution] = useState<string>('')
  const [params, setParams] = useState<MetricQueryParams | null>(null)
  const [saving, setSaving] = useState(false)

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

  // Duración del rango activo, para estimar los puntos antes de consultar.
  const range = timeRangeToDates(timeRange, new Date())
  const spanMs = range.to.getTime() - range.from.getTime()

  const run = (): void => {
    if (selector.trim() === '') return
    setParams({
      metricSelector: selector.trim(),
      resolution: resolution === '' ? undefined : resolution
    })
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
          <div className="glass grid gap-3 rounded-xl p-4">
            {/* El buscador va fuera del formulario: Enter elige una métrica, no consulta. */}
            <MetricSearch envId={envId} onPick={setSelector} />
            <MetricQueryForm
              selector={selector}
              onSelectorChange={setSelector}
              resolution={resolution}
              onResolutionChange={setResolution}
              spanMs={spanMs}
              onRun={run}
              onSave={() => setSaving(true)}
              onRefresh={refresh}
              busy={query.isFetching}
            />
          </div>

          {query.error !== null && <ModuleError error={query.error} />}

          <MetricChartPanel
            title={params?.metricSelector}
            result={query.data}
            isEmpty={query.isSuccess && query.data.series.length === 0}
            query={params?.metricSelector}
            timeRange={timeRange}
            loadedAt={query.dataUpdatedAt}
          />
        </div>

        <SavedQueriesPanel
          queries={saved.data}
          onLoad={load}
          onDelete={(id) => remove.mutate(id)}
        />
      </div>

      <SaveQueryDialog
        open={saving}
        onClose={() => setSaving(false)}
        onSave={(name) => save.mutateAsync(name)}
        saving={save.isPending}
      />
    </>
  )
}
