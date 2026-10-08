import type { JSX, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { UseQueryResult } from '@tanstack/react-query'
import type { EntityProblemCounts, HostMetricsResult } from '@shared/modules'
import { cn } from '../../lib/cn'
import {
  formatBitRate,
  formatGigabytes,
  formatUsagePct,
  usageLevel,
  type UsageLevel
} from '../../lib/host-format'
import { formatCount } from '../../lib/service-format'
import { MarkerCard, MarkerCount, QueryState, RangeLine } from './EntityMarkers'

/**
 * Fila de marcadores de la página de un HOST (ficha 0018), como la del servicio: CPU, memoria,
 * red, disco y problemas del rango global. Los cuatro primeros salen del canal
 * `entities:hostMetrics` (una llamada, la misma que los gráficos) y el de problemas, de
 * `entities:problemCounts`: si uno falla, sus marcadores enseñan el aviso con Reintentar y los
 * demás siguen.
 */
export function HostMarkers({
  metrics,
  problems,
  metricsEnabled,
  problemsEnabled
}: {
  metrics: UseQueryResult<HostMetricsResult>
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
        data-testid="host-markers"
        role="group"
        aria-label={t('entities.host.markers.label')}
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5"
      >
        <MarkerCard testId="host-marker-cpu" title={t('entities.host.markers.cpu')}>
          <QueryState {...metricState}>
            {(data) => {
              const cpu = data?.totals.cpu
              return (
                <UsageValue
                  pct={cpu?.avg ?? null}
                  caption={t('entities.host.markers.average')}
                  secondary={t('entities.host.markers.max', {
                    value: formatUsagePct(cpu?.max ?? null, lang)
                  })}
                />
              )
            }}
          </QueryState>
        </MarkerCard>

        <MarkerCard testId="host-marker-memory" title={t('entities.host.markers.memory')}>
          <QueryState {...metricState}>
            {(data) => {
              const memory = data?.totals.memory
              return (
                <UsageValue
                  pct={memory?.avg ?? null}
                  caption={t('entities.host.markers.average')}
                  secondary={t('entities.host.markers.usedOfTotal', {
                    used: formatGigabytes(memory?.used ?? null, lang),
                    total: formatGigabytes(memory?.total ?? null, lang)
                  })}
                />
              )
            }}
          </QueryState>
        </MarkerCard>

        <MarkerCard testId="host-marker-network" title={t('entities.host.markers.network')}>
          <QueryState {...metricState}>
            {(data) => {
              const network = data?.totals.network
              return (
                <MarkerBody
                  value={<BigValue>{formatBitRate(network?.in ?? null, lang)}</BigValue>}
                  caption={t('entities.host.markers.inAverage')}
                  secondary={t('entities.host.markers.outAverage', {
                    value: formatBitRate(network?.out ?? null, lang)
                  })}
                />
              )
            }}
          </QueryState>
        </MarkerCard>

        <MarkerCard testId="host-marker-disk" title={t('entities.host.markers.disk')}>
          <QueryState {...metricState}>
            {(data) => (
              // La 0016 no trae el nombre del disco más lleno: debajo va qué es el valor.
              <UsageValue
                pct={data?.totals.disk.max ?? null}
                caption={t('entities.host.markers.fullest')}
                secondary={t('entities.host.markers.fullestHint')}
              />
            )}
          </QueryState>
        </MarkerCard>

        <MarkerCard testId="host-marker-problems" title={t('entities.host.markers.problems')}>
          <QueryState query={problems} enabled={problemsEnabled}>
            {(data) => {
              const open = data?.open ?? null
              return (
                <div className="flex flex-wrap justify-center gap-x-6 gap-y-1">
                  <MarkerCount
                    testId="host-marker-open"
                    danger={open !== null && open > 0}
                    value={formatCount(open, lang)}
                    label={t('entities.service.markers.open')}
                  />
                  <MarkerCount
                    testId="host-marker-closed"
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
      <RangeLine resolution={metrics.data?.resolution ?? null} testId="host-markers-range" />
    </div>
  )
}

/** Color del valor según su nivel; el nivel lleva además su texto (el color nunca va solo). */
const LEVEL_CLASS: Record<UsageLevel, string> = {
  normal: '',
  warning: 'text-status-warning',
  error: 'text-danger'
}

/**
 * Un uso en % (CPU, memoria o disco) con su nivel: aviso por encima del 80 % y error por
 * encima del 90 % (`usageLevel`), en `data-level`, en el color y con el texto del nivel debajo.
 */
function UsageValue({
  pct,
  caption,
  secondary
}: {
  pct: number | null
  caption: string
  secondary: string
}): JSX.Element {
  const { t, i18n } = useTranslation()
  const level = usageLevel(pct)
  return (
    <MarkerBody
      value={<BigValue level={level}>{formatUsagePct(pct, i18n.language)}</BigValue>}
      level={
        level === 'normal' ? null : (
          <p
            data-testid="host-marker-level"
            className={cn('text-xs font-semibold', LEVEL_CLASS[level])}
          >
            {t(`entities.host.markers.levels.${level}`)}
          </p>
        )
      }
      caption={caption}
      secondary={secondary}
    />
  )
}

/** Valor principal con su nombre debajo, el nivel (si lo hay) y la línea secundaria. */
function MarkerBody({
  value,
  level = null,
  caption,
  secondary
}: {
  value: ReactNode
  level?: ReactNode
  caption: string
  secondary: string
}): JSX.Element {
  return (
    <div className="grid justify-items-center gap-1">
      {value}
      <p className="text-xs text-muted-foreground">{caption}</p>
      {level}
      <p data-testid="host-marker-secondary" className="text-sm tabular-nums wrap-anywhere">
        {secondary}
      </p>
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
      data-testid="host-marker-value"
      data-level={level}
      className={cn('text-3xl font-semibold tabular-nums wrap-anywhere', LEVEL_CLASS[level])}
    >
      {children}
    </p>
  )
}
