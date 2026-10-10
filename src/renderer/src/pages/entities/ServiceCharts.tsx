import { useCallback, useMemo, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { UseQueryResult } from '@tanstack/react-query'
import type { EntityProblemList, ServiceMetricsResult } from '@shared/modules'
import type { ChartColors } from '../../components/Chart'
import {
  SERVICE_CHART_KINDS,
  serviceChartKinds,
  serviceChartOption,
  serviceChartSelector,
  serviceChartSeries,
  serviceChartSlug,
  serviceChartUnit,
  type ServiceChartKind
} from './service-charts'
import { NO_COLORS, type VisibleRange } from './entity-charts'
import { EntityChartPanel } from './EntityChartPanel'

/**
 * Sección «Métricas de peticiones» de la página de un SERVICE (ficha 0009): cuatro
 * gráficos en una rejilla de 2×2 (una columna por debajo de 1024 px). Todos salen de la
 * misma consulta que los marcadores (`entities:serviceMetrics`, una sola llamada). Sobre
 * el de la tasa de error va la franja de los problemas de la entidad (ficha 0010). Los gráficos
 * dependen del conjunto de métricas (ficha 0047): Solo actividad deja solo el de actividad;
 * mientras carga, los cuatro.
 */
export function ServiceCharts({
  serviceId,
  metrics,
  problemList
}: {
  /** Id ya validado (`serviceEntityIdSchema`). */
  serviceId: string
  metrics: UseQueryResult<ServiceMetricsResult>
  /** Problemas de la entidad (`entities:problems`); null sin acceso a Problemas. */
  problemList: UseQueryResult<EntityProblemList> | null
}): JSX.Element {
  const { t } = useTranslation()
  const set = metrics.data?.metricSet
  const kinds = set === undefined ? SERVICE_CHART_KINDS : serviceChartKinds(set)
  return (
    <section
      data-testid="service-charts"
      aria-label={t('entities.service.charts.label')}
      className="grid gap-3"
    >
      <h2 className="text-sm font-semibold">{t('entities.service.charts.title')}</h2>
      <div className={kinds.length > 1 ? 'grid gap-4 lg:grid-cols-2' : 'grid gap-4'}>
        {kinds.map((kind) => (
          <ServiceChartPanel
            key={kind}
            kind={kind}
            serviceId={serviceId}
            metrics={metrics}
            problemList={kind === 'errorRate' ? problemList : null}
          />
        ))}
      </div>
    </section>
  )
}

/** Un gráfico del servicio sobre el panel común (título, «Abrir en Métricas» y exportación). */
function ServiceChartPanel({
  kind,
  serviceId,
  metrics,
  problemList
}: {
  kind: ServiceChartKind
  serviceId: string
  metrics: UseQueryResult<ServiceMetricsResult>
  /** Solo en el de la tasa de error: la franja de problemas encima del gráfico. */
  problemList: UseQueryResult<EntityProblemList> | null
}): JSX.Element {
  const { t, i18n } = useTranslation()
  const data = metrics.data

  const buildOption = useCallback(
    (loaded: ServiceMetricsResult, colors: ChartColors, range: VisibleRange) =>
      serviceChartOption(kind, loaded, { colors, language: i18n.language, t, range }),
    [kind, i18n.language, t]
  )

  // Nombres y puntos para el DOM (data-series) y la exportación; los colores no hacen falta.
  const series = useMemo(
    () =>
      data === undefined
        ? []
        : serviceChartSeries(kind, data, { colors: NO_COLORS, t }).map((item) => ({
            name: item.name,
            points: item.points
          })),
    [kind, data, t]
  )

  return (
    <EntityChartPanel
      testIdPrefix="service"
      slug={serviceChartSlug(kind)}
      title={t(`entities.service.charts.${kind}`)}
      selector={serviceChartSelector(kind, serviceId, data)}
      query={metrics}
      buildOption={buildOption}
      series={series}
      unit={serviceChartUnit(kind, t)}
      problemList={problemList}
    />
  )
}
