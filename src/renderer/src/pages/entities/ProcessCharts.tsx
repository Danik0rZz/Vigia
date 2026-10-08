import { useCallback, useMemo, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { UseQueryResult } from '@tanstack/react-query'
import type { EntityProblemList, ProcessMetricsResult } from '@shared/modules'
import type { ChartColors } from '../../components/Chart'
import {
  processChartOption,
  processChartSelector,
  processChartSeries,
  processChartTitleKey,
  processChartUnit,
  processLayout,
  type ProcessChartKind
} from './process-charts'
import { NO_COLORS, type VisibleRange } from './entity-charts'
import { EntityChartPanel } from './EntityChartPanel'

/**
 * Sección «Métricas del proceso» de la página de un PROCESS_GROUP_INSTANCE (ficha 0028): CPU,
 * memoria, red y salud de red (o recursos) en una rejilla de 2×2 (una columna por debajo de
 * 1024 px), como la del host. Todos salen de la misma llamada que los marcadores
 * (`entities:processMetrics`); los papeles sin datos no se pintan (`processLayout`). Sobre el de
 * la CPU va la franja de los problemas del proceso (ficha 0010).
 */
export function ProcessCharts({
  processId,
  metrics,
  problemList
}: {
  /** Id ya validado (`processEntityIdSchema`). */
  processId: string
  metrics: UseQueryResult<ProcessMetricsResult>
  /** Problemas de la entidad (`entities:problems`); null sin acceso a Problemas. */
  problemList: UseQueryResult<EntityProblemList> | null
}): JSX.Element {
  const { t } = useTranslation()
  const { charts } = processLayout(metrics.data)
  return (
    <section
      data-testid="process-charts"
      aria-label={t('entities.process.charts.label')}
      className="grid gap-3"
    >
      <h2 className="text-sm font-semibold">{t('entities.process.charts.title')}</h2>
      <div className="grid gap-4 lg:grid-cols-2">
        {charts.map((kind) => (
          <ProcessChartPanel
            key={kind}
            kind={kind}
            processId={processId}
            metrics={metrics}
            problemList={kind === 'cpu' ? problemList : null}
          />
        ))}
      </div>
    </section>
  )
}

/** Un gráfico del proceso sobre el panel común (título, «Abrir en Métricas» y exportación). */
function ProcessChartPanel({
  kind,
  processId,
  metrics,
  problemList
}: {
  kind: ProcessChartKind
  processId: string
  metrics: UseQueryResult<ProcessMetricsResult>
  /** Solo en el de la CPU: la franja de problemas encima del gráfico. */
  problemList: UseQueryResult<EntityProblemList> | null
}): JSX.Element {
  const { t, i18n } = useTranslation()
  const data = metrics.data

  const buildOption = useCallback(
    (loaded: ProcessMetricsResult, colors: ChartColors, range: VisibleRange) =>
      processChartOption(kind, loaded, { colors, language: i18n.language, t, range }),
    [kind, i18n.language, t]
  )

  // Nombres y puntos para el DOM (data-series) y la exportación; los colores no hacen falta.
  const series = useMemo(
    () =>
      data === undefined
        ? []
        : processChartSeries(kind, data, { colors: NO_COLORS, t }).map((item) => ({
            name: item.name,
            points: item.points
          })),
    [kind, data, t]
  )

  return (
    <EntityChartPanel
      testIdPrefix="process"
      slug={kind}
      title={t(`entities.process.charts.${processChartTitleKey(kind)}`)}
      selector={processChartSelector(kind, processId)}
      query={metrics}
      buildOption={buildOption}
      series={series}
      unit={processChartUnit(kind)}
      problemList={problemList}
    />
  )
}
