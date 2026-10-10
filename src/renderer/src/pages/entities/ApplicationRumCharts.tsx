import { useCallback, useMemo, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { UseQueryResult } from '@tanstack/react-query'
import type { ApplicationRumResult, EntityProblemList } from '@shared/modules'
import type { ChartColors } from '../../components/Chart'
import {
  RUM_SECTION_CHARTS,
  errorsSeparated,
  rumChartHasData,
  rumChartOption,
  rumChartSelector,
  rumChartSeries,
  rumChartUnit,
  type RumChartKind
} from './application-rum-charts'
import { ApplicationSection } from './ApplicationSection'
import { NO_COLORS, type VisibleRange } from './entity-charts'
import { EntityChartPanel } from './EntityChartPanel'

/**
 * Secciones «Actividad» (acciones y duración por tipo) y «Errores» (errores por tipo y acciones
 * afectadas) de la página de una aplicación web (ficha 0053), de `entities:applicationRum`
 * (0052). Sobre la duración por tipo va la franja de problemas. Un gráfico sin datos no sale, y
 * una sección sin gráficos tampoco; mientras carga, o si falla, salen todos (cada uno con su
 * aviso y Reintentar).
 */
export function ApplicationRumSections({
  applicationId,
  rum,
  problemList
}: {
  /** Id ya validado (`applicationEntityIdSchema`). */
  applicationId: string
  rum: UseQueryResult<ApplicationRumResult>
  /** Problemas de la entidad (`entities:problems`); null sin acceso a Problemas. */
  problemList: UseQueryResult<EntityProblemList> | null
}): JSX.Element {
  const { t } = useTranslation()
  const data = rum.isError ? undefined : rum.data
  const shown = (kinds: readonly RumChartKind[]): RumChartKind[] =>
    kinds.filter((kind) => data === undefined || rumChartHasData(data, kind))

  return (
    <>
      {(['activity', 'errors'] as const).map((section) => {
        const kinds = shown(RUM_SECTION_CHARTS[section])
        if (kinds.length === 0) return null
        return (
          <ApplicationSection
            key={section}
            id={section}
            title={t(`entities.application.sections.${section}`)}
          >
            {kinds.map((kind) => (
              <RumChartPanel
                key={kind}
                kind={kind}
                applicationId={applicationId}
                rum={rum}
                problemList={kind === 'durationByType' ? problemList : null}
              />
            ))}
          </ApplicationSection>
        )
      })}
    </>
  )
}

/** Un gráfico sobre el panel común (título, «Abrir en Métricas», exportación y aviso). */
function RumChartPanel({
  kind,
  applicationId,
  rum,
  problemList
}: {
  kind: RumChartKind
  applicationId: string
  rum: UseQueryResult<ApplicationRumResult>
  problemList: UseQueryResult<EntityProblemList> | null
}): JSX.Element {
  const { t, i18n } = useTranslation()
  const data = rum.data

  const buildOption = useCallback(
    (loaded: ApplicationRumResult, colors: ChartColors, range: VisibleRange) =>
      rumChartOption(kind, rumChartSeries(kind, loaded, { colors, t }), loaded.resolution, {
        colors,
        language: i18n.language,
        t,
        range
      }),
    [kind, i18n.language, t]
  )

  // Nombres y puntos para el DOM (data-series) y la exportación; los colores no hacen falta.
  const series = useMemo(
    () =>
      data === undefined
        ? []
        : rumChartSeries(kind, data, { colors: NO_COLORS, t }).map((item) => ({
            name: item.name,
            points: item.points
          })),
    [kind, data, t]
  )

  const untyped =
    kind === 'errorsByType' && data !== undefined && !rum.isError && !errorsSeparated(data)

  return (
    <EntityChartPanel
      testIdPrefix="application"
      slug={kind}
      title={t(`entities.application.charts.${kind}`)}
      selector={rumChartSelector(kind, applicationId, data)}
      query={rum}
      buildOption={buildOption}
      series={series}
      unit={rumChartUnit(kind, t)}
      problemList={problemList}
      note={
        untyped ? (
          <p data-testid="application-errors-note" className="text-xs text-muted-foreground">
            {t('entities.application.charts.errorsNotSeparated')}
          </p>
        ) : undefined
      }
    />
  )
}
