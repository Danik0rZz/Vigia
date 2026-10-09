import { useCallback, useMemo, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { UseQueryResult } from '@tanstack/react-query'
import type { ApplicationMetricsResult, EntityProblemList } from '@shared/modules'
import type { ChartColors } from '../../components/Chart'
import {
  APPLICATION_CHART_KINDS,
  applicationChartOption,
  applicationChartSelector,
  applicationChartSeries,
  applicationChartUnit,
  roleHasData,
  type ApplicationChartKind
} from './application-charts'
import { NO_COLORS, type VisibleRange } from './entity-charts'
import { EntityChartPanel } from './EntityChartPanel'

/**
 * Sección de gráficos de la página de una aplicación web (ficha 0034): Apdex, acciones, duración
 * y errores, en una rejilla de 2×2 (una columna por debajo de 1024 px), de la llamada de los
 * marcadores (`entities:applicationMetrics`). Sobre el del Apdex va la franja de los problemas
 * de la aplicación (ficha 0010); si el Apdex no sale, sobre el primero que salga. Un papel que
 * llega sin datos no tiene gráfico (CA3); mientras carga, o si falla, salen los cuatro (cada uno
 * con su aviso).
 */
export function ApplicationCharts({
  applicationId,
  metrics,
  problemList
}: {
  /** Id ya validado (`applicationEntityIdSchema`). */
  applicationId: string
  metrics: UseQueryResult<ApplicationMetricsResult>
  /** Problemas de la entidad (`entities:problems`); null sin acceso a Problemas. */
  problemList: UseQueryResult<EntityProblemList> | null
}): JSX.Element | null {
  const { t } = useTranslation()
  const data = metrics.isError ? undefined : metrics.data
  const kinds = APPLICATION_CHART_KINDS.filter(
    (kind) => data === undefined || roleHasData(data, kind)
  )
  // Ningún papel con datos: no hay nada que dibujar (los marcadores tampoco salen).
  if (kinds.length === 0) return null
  return (
    <section
      data-testid="application-charts"
      aria-label={t('entities.application.charts.label')}
      className="grid gap-3"
    >
      <h2 className="text-sm font-semibold">{t('entities.application.charts.title')}</h2>
      <div className="grid gap-4 lg:grid-cols-2">
        {kinds.map((kind) => (
          <ApplicationChartPanel
            key={kind}
            kind={kind}
            applicationId={applicationId}
            metrics={metrics}
            problemList={kind === kinds[0] ? problemList : null}
          />
        ))}
      </div>
    </section>
  )
}

/** Un gráfico sobre el panel común (título, «Abrir en Métricas» y exportación). */
function ApplicationChartPanel({
  kind,
  applicationId,
  metrics,
  problemList
}: {
  kind: ApplicationChartKind
  applicationId: string
  metrics: UseQueryResult<ApplicationMetricsResult>
  /** Solo en el primero (el del Apdex): la franja de problemas encima del gráfico. */
  problemList: UseQueryResult<EntityProblemList> | null
}): JSX.Element {
  const { t, i18n } = useTranslation()
  const data = metrics.data

  const buildOption = useCallback(
    (loaded: ApplicationMetricsResult, colors: ChartColors, range: VisibleRange) =>
      applicationChartOption(
        kind,
        applicationChartSeries(kind, loaded, { colors, t }),
        loaded.resolution,
        { colors, language: i18n.language, t, range }
      ),
    [kind, i18n.language, t]
  )

  // Nombres y puntos para el DOM (data-series) y la exportación; los colores no hacen falta.
  const series = useMemo(
    () =>
      data === undefined
        ? []
        : applicationChartSeries(kind, data, { colors: NO_COLORS, t }).map((item) => ({
            name: item.name,
            points: item.points
          })),
    [kind, data, t]
  )

  return (
    <EntityChartPanel
      testIdPrefix="application"
      slug={kind}
      title={t(`entities.application.charts.${kind}`)}
      selector={applicationChartSelector(kind, applicationId)}
      query={metrics}
      buildOption={buildOption}
      series={series}
      unit={applicationChartUnit(kind, t)}
      problemList={problemList}
    />
  )
}
