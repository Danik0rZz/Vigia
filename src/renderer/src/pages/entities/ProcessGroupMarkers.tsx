import type { JSX, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { UseQueryResult } from '@tanstack/react-query'
import type { EntityProblemCounts, ProcessGroupMetricsResult } from '@shared/modules'
import { cn } from '../../lib/cn'
import {
  formatBitRate,
  formatBytes,
  formatUsagePct,
  usageLevel,
  type UsageLevel
} from '../../lib/host-format'
import { formatCount } from '../../lib/service-format'
import { MarkerCard, MarkerCount, QueryState, RangeLine } from './EntityMarkers'
import { toBits } from './process-charts'
import { instancesTruncated } from './process-group-instances'

/**
 * Fila de marcadores de la página de un PROCESS_GROUP (ficha 0032), como la del proceso:
 * instancias, CPU (media del total del grupo y, debajo, la máxima), memoria (media), red (entrada
 * y, debajo, salida) y problemas del rango global. Los de métricas salen de
 * `entities:processGroupMetrics` (0031, la misma llamada que los gráficos y la tabla) y el de
 * problemas, de `entities:problemCounts`: si uno falla, sus marcadores enseñan el aviso con
 * Reintentar y los demás siguen. Con las instancias recortadas (`partial`), el recuento no se da
 * por el total real del grupo (nota del Orquestador en la ficha).
 */
export function ProcessGroupMarkers({
  metrics,
  problems,
  metricsEnabled,
  problemsEnabled
}: {
  metrics: UseQueryResult<ProcessGroupMetricsResult>
  problems: UseQueryResult<EntityProblemCounts>
  /** Sin acceso al módulo no se pide nada y el marcador enseña «—». */
  metricsEnabled: boolean
  problemsEnabled: boolean
}): JSX.Element {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const metricState = { query: metrics, enabled: metricsEnabled }
  const text = (key: string, options?: Record<string, unknown>): string =>
    t(`entities.processGroup.markers.${key}`, options)

  return (
    <div className="grid gap-2">
      <div
        data-testid="process-group-markers"
        role="group"
        aria-label={text('label')}
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5"
      >
        <MarkerCard testId="process-group-marker-instances" title={text('instances')}>
          <QueryState {...metricState}>
            {(data) => {
              const total = data === null ? null : data.instances.total
              const truncated = data !== null && instancesTruncated(data)
              const count = formatCount(total, lang)
              return (
                <MarkerBody
                  value={
                    <BigValue>{truncated ? text('atLeast', { value: count }) : count}</BigValue>
                  }
                  caption={text('instancesCaption')}
                  secondary={truncated ? text('instancesPartial') : null}
                />
              )
            }}
          </QueryState>
        </MarkerCard>

        <MarkerCard testId="process-group-marker-cpu" title={text('cpu')}>
          <QueryState {...metricState}>
            {(data) => {
              const cpu = data?.totals.cpu
              const pct = cpu?.avg ?? null
              // Umbrales del host (80/90 %), con su texto; la CPU del grupo es la suma de sus
              // instancias (decisión de la ficha).
              const level = usageLevel(pct)
              return (
                <MarkerBody
                  value={<BigValue level={level}>{formatUsagePct(pct, lang)}</BigValue>}
                  level={level === 'normal' ? null : t(`entities.host.markers.levels.${level}`)}
                  levelClass={LEVEL_CLASS[level]}
                  caption={text('cpuCaption')}
                  secondary={text('max', { value: formatUsagePct(cpu?.max ?? null, lang) })}
                />
              )
            }}
          </QueryState>
        </MarkerCard>

        <MarkerCard testId="process-group-marker-memory" title={text('memory')}>
          <QueryState {...metricState}>
            {(data) => (
              <MarkerBody
                value={<BigValue>{formatBytes(data?.totals.memory.avg ?? null, lang)}</BigValue>}
                caption={text('memoryCaption')}
              />
            )}
          </QueryState>
        </MarkerCard>

        <MarkerCard testId="process-group-marker-network" title={text('network')}>
          <QueryState {...metricState}>
            {(data) => {
              const network = data?.totals.network
              return (
                <MarkerBody
                  value={<BigValue>{formatBitRate(toBits(network?.in ?? null), lang)}</BigValue>}
                  caption={text('inAverage')}
                  secondary={text('outAverage', {
                    value: formatBitRate(toBits(network?.out ?? null), lang)
                  })}
                />
              )
            }}
          </QueryState>
        </MarkerCard>

        <MarkerCard testId="process-group-marker-problems" title={text('problems')}>
          <QueryState query={problems} enabled={problemsEnabled}>
            {(data) => {
              const open = data?.open ?? null
              return (
                <div className="flex flex-wrap justify-center gap-x-6 gap-y-1">
                  <MarkerCount
                    testId="process-group-marker-open"
                    danger={open !== null && open > 0}
                    value={formatCount(open, lang)}
                    label={t('entities.service.markers.open')}
                  />
                  <MarkerCount
                    testId="process-group-marker-closed"
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
      <RangeLine
        resolution={metrics.data?.resolution ?? null}
        testId="process-group-markers-range"
      />
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
        <p
          data-testid="process-group-marker-level"
          className={cn('text-xs font-semibold', levelClass)}
        >
          {level}
        </p>
      )}
      {secondary !== null && (
        <p
          data-testid="process-group-marker-secondary"
          className="text-sm tabular-nums wrap-anywhere"
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
  level?: UsageLevel
  children: string
}): JSX.Element {
  return (
    <p
      data-testid="process-group-marker-value"
      data-level={level}
      className={cn('text-3xl font-semibold tabular-nums wrap-anywhere', LEVEL_CLASS[level])}
    >
      {children}
    </p>
  )
}
