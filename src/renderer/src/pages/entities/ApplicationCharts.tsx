import { useCallback, useMemo, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { UseQueryResult } from '@tanstack/react-query'
import type { ApplicationMetricsResult, EntityProblemList } from '@shared/modules'
import type { ChartColors } from '../../components/Chart'
import {
  applicationChartOption,
  applicationChartSelector,
  applicationChartSeries,
  applicationChartUnit,
  roleHasData,
  type ApplicationChartKind
} from './application-charts'
import { ApplicationSection } from './ApplicationSection'
import { NO_COLORS, type VisibleRange } from './entity-charts'
import { EntityChartPanel } from './EntityChartPanel'

/**
 * Sección «Apdex» de la página de una aplicación web (fichas 0034 y 0053), de la llamada del
 * marcador del Apdex (`entities:applicationMetrics`), con la franja de los problemas de la
 * aplicación encima (ficha 0010). Los gráficos de acciones, duración y errores totales de la 0034
 * los sustituyen los de tipo de «Actividad» y «Errores» (ficha 0053). Sin datos de Apdex, la
 * sección no sale (CA3 de la 0034); mientras carga, o si falla, sale con su aviso.
 */
export function ApplicationApdexSection({
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
  if (data !== undefined && !roleHasData(data, 'apdex')) return null
  return (
    <ApplicationSection id="apdex" title={t('entities.application.sections.apdex')}>
      <ApplicationChartPanel
        kind="apdex"
        applicationId={applicationId}
        metrics={metrics}
        problemList={problemList}
      />
    </ApplicationSection>
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
  /** La franja de problemas encima del gráfico. */
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
