import { useCallback, useMemo, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { UseQueryResult } from '@tanstack/react-query'
import type { EntityProblemList, HostMetricsResult } from '@shared/modules'
import type { ChartColors } from '../../components/Chart'
import {
  HOST_CHART_KINDS,
  hostChartOption,
  hostChartSelector,
  hostChartSeries,
  hostChartUnit,
  type HostChartKind
} from './host-charts'
import { NO_COLORS, type VisibleRange } from './entity-charts'
import { EntityChartPanel } from './EntityChartPanel'

/**
 * Sección «Métricas del host» de la página de un HOST (ficha 0018): CPU, memoria, red y disco
 * en una rejilla de 2×2 (una columna por debajo de 1024 px), como la del servicio. Todos salen de
 * la misma llamada que los marcadores (`entities:hostMetrics`). Sobre el de la CPU va la franja
 * de los problemas del host (ficha 0010).
 */
export function HostCharts({
  hostId,
  metrics,
  problemList
}: {
  /** Id ya validado (`hostEntityIdSchema`). */
  hostId: string
  metrics: UseQueryResult<HostMetricsResult>
  /** Problemas de la entidad (`entities:problems`); null sin acceso a Problemas. */
  problemList: UseQueryResult<EntityProblemList> | null
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <section
      data-testid="host-charts"
      aria-label={t('entities.host.charts.label')}
      className="grid gap-3"
    >
      <h2 className="text-sm font-semibold">{t('entities.host.charts.title')}</h2>
      <div className="grid gap-4 lg:grid-cols-2">
        {HOST_CHART_KINDS.map((kind) => (
          <HostChartPanel
            key={kind}
            kind={kind}
            hostId={hostId}
            metrics={metrics}
            problemList={kind === 'cpu' ? problemList : null}
          />
        ))}
      </div>
    </section>
  )
}

/** Un gráfico del host sobre el panel común (título, «Abrir en Métricas» y exportación). */
function HostChartPanel({
  kind,
  hostId,
  metrics,
  problemList
}: {
  kind: HostChartKind
  hostId: string
  metrics: UseQueryResult<HostMetricsResult>
  /** Solo en el de la CPU: la franja de problemas encima del gráfico. */
  problemList: UseQueryResult<EntityProblemList> | null
}): JSX.Element {
  const { t, i18n } = useTranslation()
  const data = metrics.data

  const buildOption = useCallback(
    (loaded: HostMetricsResult, colors: ChartColors, range: VisibleRange) =>
      hostChartOption(kind, loaded, { colors, language: i18n.language, t, range }),
    [kind, i18n.language, t]
  )

  // Nombres y puntos para el DOM (data-series) y la exportación; los colores no hacen falta.
  const series = useMemo(
    () =>
      data === undefined
        ? []
        : hostChartSeries(kind, data, { colors: NO_COLORS, t }).map((item) => ({
            name: item.name,
            points: item.points
          })),
    [kind, data, t]
  )

  return (
    <EntityChartPanel
      testIdPrefix="host"
      slug={kind}
      title={t(`entities.host.charts.${kind}`)}
      selector={hostChartSelector(kind, hostId)}
      query={metrics}
      buildOption={buildOption}
      series={series}
      unit={hostChartUnit(kind)}
      problemList={problemList}
    />
  )
}
