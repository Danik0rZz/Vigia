import type { JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { UseQueryResult } from '@tanstack/react-query'
import type { EntityProblemCounts, ProcessGroupMetricsResult } from '@shared/modules'
import { formatBitRate, formatBytes, formatUsagePct, usageLevel } from '../../lib/host-format'
import { formatCount } from '../../lib/service-format'
import {
  BigValue,
  MarkerBody,
  MarkerCard,
  MarkerCount,
  QueryState,
  RangeLine
} from './EntityMarkers'
import { toBits } from './process-charts'
import { instancesAtLeast } from './process-group-instances'

/**
 * Fila de marcadores de la página de un PROCESS_GROUP (ficha 0032), como la del proceso:
 * instancias, CPU (media del total del grupo y, debajo, la máxima), memoria (media), red (entrada
 * y, debajo, salida) y problemas del rango global. Los de métricas salen de
 * `entities:processGroupMetrics` (0031, la misma llamada que los gráficos y la tabla) y el de
 * problemas, de `entities:problemCounts`: si uno falla, sus marcadores enseñan el aviso con
 * Reintentar y los demás siguen. Con las instancias recortadas (`partial`) y sin el total real (0051), el recuento no se da
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
              const truncated = data !== null && instancesAtLeast(data)
              const count = formatCount(total, lang)
              return (
                <MarkerBody
                  testIdPrefix="process-group"
                  value={
                    <BigValue testIdPrefix="process-group">
                      {truncated ? text('atLeast', { value: count }) : count}
                    </BigValue>
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
                  testIdPrefix="process-group"
                  value={
                    <BigValue testIdPrefix="process-group" level={level}>
                      {formatUsagePct(pct, lang)}
                    </BigValue>
                  }
                  levelText={level === 'normal' ? null : t(`entities.host.markers.levels.${level}`)}
                  level={level}
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
                testIdPrefix="process-group"
                value={
                  <BigValue testIdPrefix="process-group">
                    {formatBytes(data?.totals.memory.avg ?? null, lang)}
                  </BigValue>
                }
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
                  testIdPrefix="process-group"
                  value={
                    <BigValue testIdPrefix="process-group">
                      {formatBitRate(toBits(network?.in ?? null), lang)}
                    </BigValue>
                  }
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
