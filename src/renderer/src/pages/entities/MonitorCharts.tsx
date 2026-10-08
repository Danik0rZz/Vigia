import { useCallback, useMemo, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { UseQueryResult } from '@tanstack/react-query'
import type { EntityProblemList, MonitorKind, MonitorMetricsResult } from '@shared/modules'
import type { ChartColors } from '../../components/Chart'
import {
  MONITOR_CHART_KINDS,
  monitorChartOption,
  monitorChartSelector,
  monitorChartSeries,
  monitorChartShown,
  monitorChartUnit,
  type MonitorChartKind
} from './monitor-charts'
import { NO_COLORS, type VisibleRange } from './entity-charts'
import { EntityChartPanel } from './EntityChartPanel'

/**
 * Sección «Métricas del monitor» de las páginas de browser monitor y HTTP monitor (ficha 0024):
 * disponibilidad, duración, ejecuciones y rendimiento (o tiempos HTTP) en una rejilla de 2×2 (una
 * columna por debajo de 1024 px), como la del servicio. Todos salen de la misma llamada que los
 * marcadores (`entities:monitorMetrics`). Sobre el de la disponibilidad va la franja de los
 * problemas del monitor (ficha 0010). Sin series de rendimiento, la rejilla queda en tres.
 */
export function MonitorCharts({
  monitorKind,
  monitorId,
  metrics,
  problemList
}: {
  monitorKind: MonitorKind
  /** Id ya validado (`monitorEntityIdSchema`). */
  monitorId: string
  metrics: UseQueryResult<MonitorMetricsResult>
  /** Problemas de la entidad (`entities:problems`); null sin acceso a Problemas. */
  problemList: UseQueryResult<EntityProblemList> | null
}): JSX.Element {
  const { t } = useTranslation()
  const kinds = MONITOR_CHART_KINDS.filter((kind) =>
    monitorChartShown(kind, monitorKind, metrics.data)
  )
  return (
    <section
      data-testid="monitor-charts"
      aria-label={t('entities.monitor.charts.label')}
      className="grid gap-3"
    >
      <h2 className="text-sm font-semibold">{t('entities.monitor.charts.title')}</h2>
      <div className="grid gap-4 lg:grid-cols-2">
        {kinds.map((kind) => (
          <MonitorChartPanel
            key={kind}
            kind={kind}
            monitorKind={monitorKind}
            monitorId={monitorId}
            metrics={metrics}
            problemList={kind === 'availability' ? problemList : null}
          />
        ))}
      </div>
    </section>
  )
}

/** Un gráfico del monitor sobre el panel común (título, «Abrir en Métricas» y exportación). */
function MonitorChartPanel({
  kind,
  monitorKind,
  monitorId,
  metrics,
  problemList
}: {
  kind: MonitorChartKind
  monitorKind: MonitorKind
  monitorId: string
  metrics: UseQueryResult<MonitorMetricsResult>
  /** Solo en el de la disponibilidad: la franja de problemas encima del gráfico. */
  problemList: UseQueryResult<EntityProblemList> | null
}): JSX.Element {
  const { t, i18n } = useTranslation()
  const data = metrics.data

  const buildOption = useCallback(
    (loaded: MonitorMetricsResult, colors: ChartColors, range: VisibleRange) =>
      monitorChartOption(kind, loaded, { colors, language: i18n.language, t, range }),
    [kind, i18n.language, t]
  )

  // Nombres y puntos para el DOM (data-series) y la exportación; los colores no hacen falta.
  const series = useMemo(
    () =>
      data === undefined
        ? []
        : monitorChartSeries(kind, data, { colors: NO_COLORS, t }).map((item) => ({
            name: item.name,
            points: item.points
          })),
    [kind, data, t]
  )

  return (
    <EntityChartPanel
      testIdPrefix="monitor"
      slug={kind}
      title={t(`entities.monitor.charts.${kind}`)}
      selector={monitorChartSelector(kind, monitorKind, monitorId)}
      query={metrics}
      buildOption={buildOption}
      series={series}
      unit={monitorChartUnit(kind, t)}
      problemList={problemList}
    />
  )
}
