import type { JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { UseQueryResult } from '@tanstack/react-query'
import type { EntityProblemCounts, ProcessMetricsResult } from '@shared/modules'
import { cn } from '../../lib/cn'
import { formatBitRate, formatBytes, formatUsagePct, usageLevel } from '../../lib/host-format'
import { availabilityLevel, formatAvailabilityPct } from '../../lib/monitor-format'
import { formatCount } from '../../lib/service-format'
import {
  BigValue,
  MarkerBody,
  MarkerCard,
  MarkerCount,
  QueryState,
  RangeLine
} from './EntityMarkers'
import { processLayout, toBits } from './process-charts'

/** Columnas de la fila en pantalla ancha según cuántos marcadores salen (de 3 a 5). */
const COLUMNS: Record<number, string> = {
  3: 'lg:grid-cols-3',
  4: 'lg:grid-cols-4',
  5: 'lg:grid-cols-5'
}

/**
 * Fila de marcadores de la página de un PROCESS_GROUP_INSTANCE (ficha 0028), como la del host:
 * CPU, memoria, red, disponibilidad o recursos (el que haya) y problemas del rango global. Los de
 * métricas salen de `entities:processMetrics` (una llamada, la misma que los gráficos) y el de
 * problemas, de `entities:problemCounts`: si uno falla, sus marcadores enseñan el aviso con
 * Reintentar y los demás siguen. Los papeles sin datos no se pintan (`processLayout`).
 */
export function ProcessMarkers({
  metrics,
  problems,
  metricsEnabled,
  problemsEnabled
}: {
  metrics: UseQueryResult<ProcessMetricsResult>
  problems: UseQueryResult<EntityProblemCounts>
  /** Sin acceso al módulo no se pide nada y el marcador enseña «—». */
  metricsEnabled: boolean
  problemsEnabled: boolean
}): JSX.Element {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const metricState = { query: metrics, enabled: metricsEnabled }
  const layout = processLayout(metrics.data)
  const count = 3 + (layout.network ? 1 : 0) + (layout.fourthMarker === null ? 0 : 1)

  return (
    <div className="grid gap-2">
      <div
        data-testid="process-markers"
        role="group"
        aria-label={t('entities.process.markers.label')}
        className={cn('grid gap-4 sm:grid-cols-2', COLUMNS[count])}
      >
        <MarkerCard testId="process-marker-cpu" title={t('entities.process.markers.cpu')}>
          <QueryState {...metricState}>
            {(data) => {
              const cpu = data?.totals.cpu
              const pct = cpu?.avg ?? null
              const level = usageLevel(pct)
              return (
                <MarkerBody
                  testIdPrefix="process"
                  value={
                    <BigValue testIdPrefix="process" level={level}>
                      {formatUsagePct(pct, lang)}
                    </BigValue>
                  }
                  levelText={level === 'normal' ? null : t(`entities.host.markers.levels.${level}`)}
                  level={level}
                  caption={t('entities.process.markers.average')}
                  secondary={t('entities.process.markers.max', {
                    value: formatUsagePct(cpu?.max ?? null, lang)
                  })}
                />
              )
            }}
          </QueryState>
        </MarkerCard>

        <MarkerCard testId="process-marker-memory" title={t('entities.process.markers.memory')}>
          <QueryState {...metricState}>
            {(data) => {
              const memory = data?.totals.memory
              return (
                <MarkerBody
                  testIdPrefix="process"
                  value={
                    <BigValue testIdPrefix="process">
                      {formatBytes(memory?.avg ?? null, lang)}
                    </BigValue>
                  }
                  caption={t('entities.process.markers.average')}
                  secondary={t('entities.process.markers.max', {
                    value: formatBytes(memory?.max ?? null, lang)
                  })}
                />
              )
            }}
          </QueryState>
        </MarkerCard>

        {layout.network && (
          <MarkerCard testId="process-marker-network" title={t('entities.process.markers.network')}>
            <QueryState {...metricState}>
              {(data) => {
                const network = data?.totals.network
                return (
                  <MarkerBody
                    testIdPrefix="process"
                    value={
                      <BigValue testIdPrefix="process">
                        {formatBitRate(toBits(network?.in ?? null), lang)}
                      </BigValue>
                    }
                    caption={t('entities.process.markers.inAverage')}
                    secondary={t('entities.process.markers.outAverage', {
                      value: formatBitRate(toBits(network?.out ?? null), lang)
                    })}
                  />
                )
              }}
            </QueryState>
          </MarkerCard>
        )}

        {layout.fourthMarker === 'availability' && (
          <MarkerCard
            testId="process-marker-availability"
            title={t('entities.process.markers.availability')}
          >
            <QueryState {...metricState}>
              {(data) => {
                const pct = data?.totals.availability ?? null
                // Umbrales de Dani para la disponibilidad (lote «monitores»), con su texto.
                const level = availabilityLevel(pct)
                return (
                  <MarkerBody
                    testIdPrefix="process"
                    value={
                      <BigValue testIdPrefix="process" level={level}>
                        {formatAvailabilityPct(pct, lang)}
                      </BigValue>
                    }
                    levelText={
                      level === 'normal' ? null : t(`entities.monitor.markers.levels.${level}`)
                    }
                    level={level}
                    caption={t('entities.process.markers.average')}
                  />
                )
              }}
            </QueryState>
          </MarkerCard>
        )}

        {layout.fourthMarker === 'resources' && (
          <MarkerCard
            testId="process-marker-resources"
            title={t('entities.process.markers.resources')}
          >
            <QueryState {...metricState}>
              {(data) => (
                // La métrica dice Percent: se enseña tal cual (decisión del Orquestador, 0028).
                <MarkerBody
                  testIdPrefix="process"
                  value={
                    <BigValue testIdPrefix="process">
                      {formatUsagePct(data?.totals.resources ?? null, lang)}
                    </BigValue>
                  }
                  caption={t('entities.process.markers.resourcesCaption')}
                  secondary={t('entities.process.markers.rangeMax')}
                />
              )}
            </QueryState>
          </MarkerCard>
        )}

        <MarkerCard testId="process-marker-problems" title={t('entities.process.markers.problems')}>
          <QueryState query={problems} enabled={problemsEnabled}>
            {(data) => {
              const open = data?.open ?? null
              return (
                <div className="flex flex-wrap justify-center gap-x-6 gap-y-1">
                  <MarkerCount
                    testId="process-marker-open"
                    danger={open !== null && open > 0}
                    value={formatCount(open, lang)}
                    label={t('entities.service.markers.open')}
                  />
                  <MarkerCount
                    testId="process-marker-closed"
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
      <RangeLine resolution={metrics.data?.resolution ?? null} testId="process-markers-range" />
    </div>
  )
}
