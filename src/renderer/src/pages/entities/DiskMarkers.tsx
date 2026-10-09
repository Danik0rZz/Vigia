import type { JSX, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { UseQueryResult } from '@tanstack/react-query'
import type { DiskMetricsResult, EntityProblemCounts } from '@shared/modules'
import { cn } from '../../lib/cn'
import {
  formatByteRate,
  formatGigabytes,
  formatUsagePct,
  usageLevel,
  type UsageLevel
} from '../../lib/host-format'
import { formatCount, formatDurationMs } from '../../lib/service-format'
import { MarkerCard, MarkerCount, QueryState, RangeLine } from './EntityMarkers'
import { diskLayout, formatQueueLength } from './disk-charts'

/** Columnas de la fila en pantalla ancha según cuántos marcadores salen (5 o 6). */
const COLUMNS: Record<number, string> = {
  5: 'lg:grid-cols-5',
  6: 'lg:grid-cols-6'
}

/**
 * Fila de marcadores de la página de un DISK (ficha 0040), como la del host: uso (% máximo del
 * rango, con los umbrales del 80 y el 90 % y su texto), libre (último dato), lectura y escritura
 * (medias), latencia o cola (el que haya) y problemas del rango global. Los de métricas salen de
 * `entities:diskMetrics` (una llamada, la misma que los gráficos) y el de problemas, de
 * `entities:problemCounts`: si uno falla, sus marcadores enseñan el aviso con Reintentar y los
 * demás siguen.
 */
export function DiskMarkers({
  metrics,
  problems,
  metricsEnabled,
  problemsEnabled
}: {
  metrics: UseQueryResult<DiskMetricsResult>
  problems: UseQueryResult<EntityProblemCounts>
  /** Sin acceso al módulo no se pide nada y el marcador enseña «—». */
  metricsEnabled: boolean
  problemsEnabled: boolean
}): JSX.Element {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const metricState = { query: metrics, enabled: metricsEnabled }
  const { optional } = diskLayout(metrics.data)
  const count = 5 + (optional === null ? 0 : 1)

  return (
    <div className="grid gap-2">
      <div
        data-testid="disk-markers"
        role="group"
        aria-label={t('entities.disk.markers.label')}
        className={cn('grid gap-4 sm:grid-cols-2', COLUMNS[count])}
      >
        <MarkerCard testId="disk-marker-usage" title={t('entities.disk.markers.usage')}>
          <QueryState {...metricState}>
            {(data) => {
              const pct = data?.totals.usage ?? null
              const level = usageLevel(pct)
              return (
                <MarkerBody
                  value={<BigValue level={level}>{formatUsagePct(pct, lang)}</BigValue>}
                  level={level === 'normal' ? null : t(`entities.host.markers.levels.${level}`)}
                  levelClass={LEVEL_CLASS[level]}
                  caption={t('entities.disk.markers.usageCaption')}
                />
              )
            }}
          </QueryState>
        </MarkerCard>

        <MarkerCard testId="disk-marker-free" title={t('entities.disk.markers.free')}>
          <QueryState {...metricState}>
            {(data) => (
              <MarkerBody
                value={<BigValue>{formatGigabytes(data?.totals.free ?? null, lang)}</BigValue>}
                caption={t('entities.disk.markers.freeCaption')}
              />
            )}
          </QueryState>
        </MarkerCard>

        <MarkerCard testId="disk-marker-read" title={t('entities.disk.markers.read')}>
          <QueryState {...metricState}>
            {(data) => (
              <MarkerBody
                value={
                  <BigValue>{formatByteRate(data?.totals.throughput.read ?? null, lang)}</BigValue>
                }
                caption={t('entities.disk.markers.average')}
              />
            )}
          </QueryState>
        </MarkerCard>

        <MarkerCard testId="disk-marker-write" title={t('entities.disk.markers.write')}>
          <QueryState {...metricState}>
            {(data) => (
              <MarkerBody
                value={
                  <BigValue>{formatByteRate(data?.totals.throughput.write ?? null, lang)}</BigValue>
                }
                caption={t('entities.disk.markers.average')}
              />
            )}
          </QueryState>
        </MarkerCard>

        {optional === 'latency' && (
          <MarkerCard testId="disk-marker-latency" title={t('entities.disk.markers.latency')}>
            <QueryState {...metricState}>
              {(data) => {
                const latency = data?.totals.latency ?? null
                return (
                  <MarkerBody
                    value={<BigValue>{formatDurationMs(latency?.read ?? null, lang)}</BigValue>}
                    caption={t('entities.disk.markers.latencyCaption')}
                    secondary={t('entities.disk.markers.latencyWrite', {
                      value: formatDurationMs(latency?.write ?? null, lang)
                    })}
                  />
                )
              }}
            </QueryState>
          </MarkerCard>
        )}

        {optional === 'queue' && (
          <MarkerCard testId="disk-marker-queue" title={t('entities.disk.markers.queue')}>
            <QueryState {...metricState}>
              {(data) => (
                <MarkerBody
                  value={<BigValue>{formatQueueLength(data?.totals.queue ?? null, lang)}</BigValue>}
                  caption={t('entities.disk.markers.queueCaption')}
                />
              )}
            </QueryState>
          </MarkerCard>
        )}

        <MarkerCard testId="disk-marker-problems" title={t('entities.disk.markers.problems')}>
          <QueryState query={problems} enabled={problemsEnabled}>
            {(data) => {
              const open = data?.open ?? null
              return (
                <div className="flex flex-wrap justify-center gap-x-6 gap-y-1">
                  <MarkerCount
                    testId="disk-marker-open"
                    danger={open !== null && open > 0}
                    value={formatCount(open, lang)}
                    label={t('entities.service.markers.open')}
                  />
                  <MarkerCount
                    testId="disk-marker-closed"
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
      <RangeLine resolution={metrics.data?.resolution ?? null} testId="disk-markers-range" />
    </div>
  )
}

/** Color del valor según su nivel; el nivel lleva además su texto (el color nunca va solo). */
const LEVEL_CLASS: Record<UsageLevel, string> = {
  normal: '',
  warning: 'text-status-warning',
  error: 'text-danger'
}

/** Valor principal con su nombre debajo, el texto del nivel (si lo hay) y la línea secundaria. */
function MarkerBody({
  value,
  level = null,
  levelClass = '',
  caption,
  secondary = null
}: {
  value: ReactNode
  level?: string | null
  levelClass?: string
  caption: string
  secondary?: string | null
}): JSX.Element {
  return (
    <div className="grid justify-items-center gap-1">
      {value}
      <p className="text-xs text-muted-foreground">{caption}</p>
      {level !== null && (
        <p data-testid="disk-marker-level" className={cn('text-xs font-semibold', levelClass)}>
          {level}
        </p>
      )}
      {secondary !== null && (
        <p data-testid="disk-marker-secondary" className="text-sm tabular-nums wrap-anywhere">
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
  level?: UsageLevel
  children: string
}): JSX.Element {
  return (
    <p
      data-testid="disk-marker-value"
      data-level={level}
      className={cn('text-3xl font-semibold tabular-nums wrap-anywhere', LEVEL_CLASS[level])}
    >
      {children}
    </p>
  )
}
