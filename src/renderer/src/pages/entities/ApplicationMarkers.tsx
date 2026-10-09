import type { JSX, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { UseQueryResult } from '@tanstack/react-query'
import type { ApplicationMetricsResult, EntityProblemCounts } from '@shared/modules'
import {
  apdexCategory,
  apdexLevel,
  formatApdex,
  type ApdexLevel
} from '../../lib/application-format'
import { cn } from '../../lib/cn'
import { formatCount, formatDurationMs } from '../../lib/service-format'
import { roleHasData, type ApplicationChartKind } from './application-charts'
import { MarkerCard, MarkerCount, QueryState, RangeLine } from './EntityMarkers'

/** Los marcadores de métricas, en su orden; detrás va el de problemas. */
const METRIC_MARKERS: readonly ApplicationChartKind[] = ['apdex', 'actions', 'duration', 'errors']

/** Columnas de la fila con la ventana ancha, según cuántos marcadores salen (1 a 5). */
const COLUMNS: Record<number, string> = {
  1: 'lg:grid-cols-1',
  2: 'lg:grid-cols-2',
  3: 'lg:grid-cols-3',
  4: 'lg:grid-cols-4',
  5: 'lg:grid-cols-5'
}

/**
 * Fila de marcadores de la página de una aplicación web (ficha 0034): Apdex (con su categoría),
 * acciones, duración (visually complete, media), errores y problemas del rango global. Los de
 * métricas salen de `entities:applicationMetrics` (0033, la misma llamada que los gráficos y la
 * tabla) y el de problemas, de `entities:problemCounts`: si uno falla, sus marcadores enseñan el
 * aviso con Reintentar y los demás siguen. Un papel que llega sin datos (serie vacía y total
 * null) no tiene marcador (CA3); mientras carga, o si falla, salen todos.
 */
export function ApplicationMarkers({
  metrics,
  problems,
  metricsEnabled,
  problemsEnabled
}: {
  metrics: UseQueryResult<ApplicationMetricsResult>
  problems: UseQueryResult<EntityProblemCounts>
  /** Sin acceso al módulo no se pide nada y el marcador enseña «—». */
  metricsEnabled: boolean
  problemsEnabled: boolean
}): JSX.Element {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const metricState = { query: metrics, enabled: metricsEnabled }
  const text = (key: string, options?: Record<string, unknown>): string =>
    t(`entities.application.markers.${key}`, options)
  const data = metricsEnabled && !metrics.isError ? metrics.data : undefined
  const shown = METRIC_MARKERS.filter((role) => data === undefined || roleHasData(data, role))

  const body = (role: ApplicationChartKind, loaded: ApplicationMetricsResult | null): ReactNode => {
    const value = loaded?.totals[role] ?? null
    switch (role) {
      case 'apdex': {
        const category = apdexCategory(value)
        const level = apdexLevel(value)
        return (
          <MarkerBody
            value={<BigValue level={level}>{formatApdex(value, lang)}</BigValue>}
            level={category === null ? null : t(`entities.application.apdex.${category}`)}
            levelClass={LEVEL_CLASS[level]}
            caption={text('apdexCaption')}
          />
        )
      }
      case 'actions':
        return (
          <MarkerBody
            value={<BigValue>{formatCount(value, lang)}</BigValue>}
            caption={text('actionsCaption')}
          />
        )
      case 'duration':
        return (
          <MarkerBody
            value={<BigValue>{formatDurationMs(value, lang)}</BigValue>}
            caption={text('durationCaption')}
          />
        )
      case 'errors':
        return (
          <MarkerBody
            value={
              <BigValue level={value !== null && value > 0 ? 'error' : 'normal'}>
                {formatCount(value, lang)}
              </BigValue>
            }
            caption={text('errorsCaption')}
          />
        )
    }
  }

  return (
    <div className="grid gap-2">
      <div
        data-testid="application-markers"
        role="group"
        aria-label={text('label')}
        className={cn('grid gap-4 sm:grid-cols-2', COLUMNS[shown.length + 1])}
      >
        {shown.map((role) => (
          <MarkerCard key={role} testId={`application-marker-${role}`} title={text(role)}>
            <QueryState {...metricState}>{(loaded) => body(role, loaded)}</QueryState>
          </MarkerCard>
        ))}

        <MarkerCard testId="application-marker-problems" title={text('problems')}>
          <QueryState query={problems} enabled={problemsEnabled}>
            {(counts) => {
              const open = counts?.open ?? null
              return (
                <div className="flex flex-wrap justify-center gap-x-6 gap-y-1">
                  <MarkerCount
                    testId="application-marker-open"
                    danger={open !== null && open > 0}
                    value={formatCount(open, lang)}
                    label={t('entities.service.markers.open')}
                  />
                  <MarkerCount
                    testId="application-marker-closed"
                    danger={false}
                    value={formatCount(counts?.closed ?? null, lang)}
                    label={t('entities.service.markers.closed')}
                  />
                </div>
              )
            }}
          </QueryState>
        </MarkerCard>
      </div>
      <RangeLine resolution={metrics.data?.resolution ?? null} testId="application-markers-range" />
    </div>
  )
}

/** Color del valor según su nivel; el del Apdex lleva además su texto (el color nunca va solo). */
const LEVEL_CLASS: Record<ApdexLevel, string> = {
  normal: '',
  success: 'text-status-closed',
  warning: 'text-status-warning',
  error: 'text-danger'
}

/** Valor principal con su nombre debajo y el texto del nivel (si lo hay). */
function MarkerBody({
  value,
  level = null,
  levelClass = '',
  caption
}: {
  value: ReactNode
  level?: string | null
  levelClass?: string
  caption: string
}): JSX.Element {
  return (
    <div className="grid justify-items-center gap-1">
      {value}
      <p className="text-xs text-muted-foreground">{caption}</p>
      {level !== null && (
        <p
          data-testid="application-marker-level"
          className={cn('text-xs font-semibold', levelClass)}
        >
          {level}
        </p>
      )}
    </div>
  )
}

/** Valor principal del marcador, con el color de su nivel. */
function BigValue({
  level = 'normal',
  children
}: {
  level?: ApdexLevel
  children: string
}): JSX.Element {
  return (
    <p
      data-testid="application-marker-value"
      data-level={level}
      className={cn('text-3xl font-semibold tabular-nums wrap-anywhere', LEVEL_CLASS[level])}
    >
      {children}
    </p>
  )
}
