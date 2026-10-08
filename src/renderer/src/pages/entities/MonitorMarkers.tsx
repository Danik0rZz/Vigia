import type { JSX, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { UseQueryResult } from '@tanstack/react-query'
import type {
  EntityProblemCounts,
  MonitorBreakdownResult,
  MonitorKind,
  MonitorMetricsResult
} from '@shared/modules'
import { cn } from '../../lib/cn'
import {
  availabilityLevel,
  formatAvailabilityPct,
  locationsBelowFull,
  type AvailabilityLevel
} from '../../lib/monitor-format'
import { formatCount, formatDurationMs } from '../../lib/service-format'
import { MarkerCard, MarkerCount, QueryState, RangeLine } from './EntityMarkers'

/**
 * Fila de marcadores de las páginas de browser monitor y HTTP monitor (ficha 0024), como la del
 * servicio: disponibilidad, duración, ejecuciones, localizaciones y problemas del rango global.
 * Los tres primeros salen de `entities:monitorMetrics` (una llamada, la misma que los gráficos),
 * el de localizaciones de `entities:monitorBreakdown` (ficha 0023) y el de problemas de
 * `entities:problemCounts`: si uno falla, sus marcadores enseñan el aviso con Reintentar y los
 * demás siguen. Lo que el tipo no tiene (la mediana del HTTP monitor) no se pinta.
 */
export function MonitorMarkers({
  monitorKind,
  metrics,
  breakdown,
  problems,
  metricsEnabled,
  problemsEnabled
}: {
  monitorKind: MonitorKind
  metrics: UseQueryResult<MonitorMetricsResult>
  breakdown: UseQueryResult<MonitorBreakdownResult>
  problems: UseQueryResult<EntityProblemCounts>
  /** Sin acceso al módulo no se pide nada y el marcador enseña «—». */
  metricsEnabled: boolean
  problemsEnabled: boolean
}): JSX.Element {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const metricState = { query: metrics, enabled: metricsEnabled }

  return (
    <div className="grid gap-2">
      <div
        data-testid="monitor-markers"
        role="group"
        aria-label={t('entities.monitor.markers.label')}
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5"
      >
        <MarkerCard
          testId="monitor-marker-availability"
          title={t('entities.monitor.markers.availability')}
        >
          <QueryState {...metricState}>
            {(data) => {
              const pct = data?.totals.availability ?? null
              const level = availabilityLevel(pct)
              return (
                <MarkerBody
                  value={<BigValue level={level}>{formatAvailabilityPct(pct, lang)}</BigValue>}
                  caption={t('entities.monitor.markers.rangeAverage')}
                  level={
                    level === 'normal' ? null : (
                      <p
                        data-testid="monitor-marker-level"
                        className={cn('text-xs font-semibold', LEVEL_CLASS[level])}
                      >
                        {t(`entities.monitor.markers.levels.${level}`)}
                      </p>
                    )
                  }
                />
              )
            }}
          </QueryState>
        </MarkerCard>

        <MarkerCard testId="monitor-marker-duration" title={t('entities.monitor.markers.duration')}>
          <QueryState {...metricState}>
            {(data) => {
              const median = data?.totals.duration.median ?? null
              // El HTTP monitor no tiene mediana (ficha 0022): no se pinta la línea.
              const showMedian = monitorKind === 'browser'
              return (
                <MarkerBody
                  value={
                    <BigValue>{formatDurationMs(data?.totals.duration.avg ?? null, lang)}</BigValue>
                  }
                  caption={t('entities.monitor.markers.average')}
                  secondary={
                    showMedian
                      ? t('entities.monitor.markers.median', {
                          value: formatDurationMs(median, lang)
                        })
                      : null
                  }
                />
              )
            }}
          </QueryState>
        </MarkerCard>

        <MarkerCard
          testId="monitor-marker-executions"
          title={t('entities.monitor.markers.executions')}
        >
          <QueryState {...metricState}>
            {(data) => {
              const failed = data?.totals.executions.failed ?? null
              const failedLevel: AvailabilityLevel =
                failed !== null && failed > 0 ? 'error' : 'normal'
              return (
                <MarkerBody
                  value={
                    <BigValue>{formatCount(data?.totals.executions.ok ?? null, lang)}</BigValue>
                  }
                  caption={t('entities.monitor.markers.ok')}
                  secondary={t('entities.monitor.markers.failed', {
                    value: formatCount(failed, lang)
                  })}
                  secondaryLevel={failedLevel}
                />
              )
            }}
          </QueryState>
        </MarkerCard>

        <MarkerCard
          testId="monitor-marker-locations"
          title={t('entities.monitor.markers.locations')}
        >
          <QueryState query={breakdown} enabled={metricsEnabled}>
            {(data) => (
              <MarkerBody
                value={
                  <BigValue>
                    {data === null
                      ? formatCount(null, lang)
                      : formatCount(data.locations.length, lang)}
                  </BigValue>
                }
                caption={t('entities.monitor.markers.locationsCaption')}
                secondary={t('entities.monitor.markers.belowFull', {
                  value:
                    data === null
                      ? formatCount(null, lang)
                      : formatCount(locationsBelowFull(data.locations), lang)
                })}
              />
            )}
          </QueryState>
        </MarkerCard>

        <MarkerCard testId="monitor-marker-problems" title={t('entities.monitor.markers.problems')}>
          <QueryState query={problems} enabled={problemsEnabled}>
            {(data) => {
              const open = data?.open ?? null
              return (
                <div className="flex flex-wrap justify-center gap-x-6 gap-y-1">
                  <MarkerCount
                    testId="monitor-marker-open"
                    danger={open !== null && open > 0}
                    value={formatCount(open, lang)}
                    label={t('entities.service.markers.open')}
                  />
                  <MarkerCount
                    testId="monitor-marker-closed"
                    danger={false}
                    value={formatCount(data?.closed ?? null, lang)}
                    label={t('entities.service.markers.closed')}
                  />
                </div>
              )
            }}
          </QueryState>
        </MarkerCard>
      </div>
      <RangeLine resolution={metrics.data?.resolution ?? null} testId="monitor-markers-range" />
    </div>
  )
}

/** Color según el nivel; el nivel lleva además su texto (el color nunca va solo). */
const LEVEL_CLASS: Record<AvailabilityLevel, string> = {
  normal: '',
  warning: 'text-status-warning',
  error: 'text-danger'
}

/** Valor principal con su nombre debajo, el nivel (si lo hay) y la línea secundaria (si la hay). */
function MarkerBody({
  value,
  level = null,
  caption,
  secondary = null,
  secondaryLevel = 'normal'
}: {
  value: ReactNode
  level?: ReactNode
  caption: string
  secondary?: string | null
  /** Las fallidas, en color de error si hay alguna (con su número en el texto). */
  secondaryLevel?: AvailabilityLevel
}): JSX.Element {
  return (
    <div className="grid justify-items-center gap-1">
      {value}
      <p className="text-xs text-muted-foreground">{caption}</p>
      {level}
      {secondary !== null && (
        <p
          data-testid="monitor-marker-secondary"
          data-level={secondaryLevel}
          className={cn('text-sm tabular-nums wrap-anywhere', LEVEL_CLASS[secondaryLevel])}
        >
          {secondary}
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
  level?: AvailabilityLevel
  children: string
}): JSX.Element {
  return (
    <p
      data-testid="monitor-marker-value"
      data-level={level}
      className={cn('text-3xl font-semibold tabular-nums wrap-anywhere', LEVEL_CLASS[level])}
    >
      {children}
    </p>
  )
}
