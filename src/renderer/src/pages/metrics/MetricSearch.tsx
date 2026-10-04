import { useEffect, useState, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { Command } from 'cmdk'
import { ApiWarnings, ModuleError, TruncatedNotice } from '../../components/ModuleState'
import { INPUT } from '../../components/styles'
import { useMetricSearch } from '../../data/modules'

const SEARCH_DEBOUNCE_MS = 300

/**
 * Buscador de métricas, FUERA del formulario de la consulta: Enter elige un
 * resultado, nunca lanza la consulta. Con cmdk: flechas para moverse y una
 * sola parada de tabulación para la lista.
 */
export function MetricSearch({
  envId,
  onPick
}: {
  envId: string | null
  /** Métrica elegida: pasa al selector. */
  onPick: (metricId: string) => void
}): JSX.Element {
  const { t } = useTranslation()
  const [input, setInput] = useState('')
  const [search, setSearch] = useState('')

  useEffect(() => {
    const timer = setTimeout(() => setSearch(input.trim()), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [input])

  const results = useMetricSearch(envId, search)
  const metrics = results.data?.metrics ?? []
  const pick = (metricId: string): void => {
    onPick(metricId)
    setInput('')
    setSearch('')
  }

  return (
    // La búsqueda la hace Dynatrace (text=): cmdk no filtra.
    <Command shouldFilter={false} label={t('metrics.search')} className="grid gap-2">
      <label className="grid gap-1 text-xs text-muted-foreground">
        {t('metrics.search')}
        <Command.Input
          data-testid="metric-search"
          value={input}
          onValueChange={setInput}
          maxLength={100}
          className={INPUT}
        />
      </label>
      {search !== '' && (
        <>
          {results.error !== null && <ModuleError error={results.error} />}
          <Command.List data-testid="metric-search-results" className="max-h-48 overflow-y-auto">
            {results.isFetching && (
              <Command.Loading>
                <p className="px-2 py-1 text-sm text-muted-foreground">{t('module.loading')}</p>
              </Command.Loading>
            )}
            {results.isSuccess && metrics.length === 0 && (
              <p
                data-testid="metric-search-empty"
                className="px-2 py-1 text-sm text-muted-foreground"
              >
                {t('metrics.noResults')}
              </p>
            )}
            {metrics.map((metric) => (
              <Command.Item
                key={metric.metricId}
                value={metric.metricId}
                data-testid="metric-search-result"
                onSelect={() => pick(metric.metricId)}
                className="cursor-pointer rounded-md px-2 py-1 text-sm data-[selected=true]:bg-hover"
              >
                <span className="font-medium">{metric.displayName ?? metric.metricId}</span>{' '}
                <span className="text-xs text-muted-foreground">{metric.metricId}</span>
              </Command.Item>
            ))}
          </Command.List>
          <ApiWarnings invalid={results.data?.invalid} />
          {results.data?.truncated === true && (
            <TruncatedNotice shown={metrics.length} total={results.data.totalCount} />
          )}
        </>
      )}
    </Command>
  )
}
