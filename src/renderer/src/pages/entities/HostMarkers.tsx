import type { JSX, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import * as Tooltip from '@radix-ui/react-tooltip'
import { CircleHelp } from 'lucide-react'
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
                  extra={<Reclaimable value={formatGigabytes(memory?.reclaimable ?? null, lang)} />}
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
  secondary,
  extra = null
}: {
  pct: number | null
  caption: string
  secondary: string
  /** Línea más bajo la secundaria (la recuperable de la memoria, ficha 0039). */
  extra?: ReactNode
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
      extra={extra}
    />
  )
}

/**
 * Memoria recuperable (ficha 0039), del último punto con dato, con un icono de ayuda que
 * explica qué es; el tooltip se abre con el ratón y con el foco.
 */
function Reclaimable({ value }: { value: string }): JSX.Element {
  const { t } = useTranslation()
  return (
    <p
      data-testid="host-marker-reclaimable"
      className="flex items-center gap-1 text-sm text-muted-foreground"
    >
      <span>{t('entities.host.markers.reclaimable')}</span>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <button
            type="button"
            data-testid="host-marker-reclaimable-help"
            aria-label={t('entities.host.markers.reclaimableHelpLabel')}
            className="inline-flex cursor-help rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <CircleHelp aria-hidden="true" className="size-3.5" />
          </button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            data-testid="host-marker-reclaimable-tooltip"
            sideOffset={6}
            className="glass z-50 max-w-80 rounded-md px-3 py-2 text-xs text-foreground"
          >
            {t('entities.host.markers.reclaimableHelp')}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
      <span className="font-medium text-foreground tabular-nums">{value}</span>
    </p>
  )
}

/** Valor principal con su nombre debajo, el nivel (si lo hay) y la línea secundaria. */
function MarkerBody({
  value,
  level = null,
  caption,
  secondary,
  extra = null
}: {
  value: ReactNode
  level?: ReactNode
  caption: string
  secondary: string
  extra?: ReactNode
}): JSX.Element {
  return (
    <div className="grid justify-items-center gap-1">
      {value}
      <p className="text-xs text-muted-foreground">{caption}</p>
      {level}
      <p data-testid="host-marker-secondary" className="text-sm tabular-nums wrap-anywhere">
        {secondary}
      </p>
      {extra}
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
