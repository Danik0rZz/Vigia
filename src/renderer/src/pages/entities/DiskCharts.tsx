import { useCallback, useMemo, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { UseQueryResult } from '@tanstack/react-query'
import type { DiskMetricsResult, EntityProblemList } from '@shared/modules'
import type { ChartColors } from '../../components/Chart'
import {
  diskChartOption,
  diskChartSelector,
  diskChartSeries,
  diskChartUnit,
  diskLayout,
  type DiskChartKind
} from './disk-charts'
import { NO_COLORS, type VisibleRange } from './entity-charts'
import { EntityChartPanel } from './EntityChartPanel'

/**
 * Sección «Métricas del disco» de la página de un DISK (ficha 0040): uso %, espacio (usado y
 * libre apilados), lectura y escritura, y latencia (o cola) en una rejilla de 2×2 (una columna
 * por debajo de 1024 px), como la del host. Todos salen de la misma llamada que los marcadores
 * (`entities:diskMetrics`). Sobre el de uso va la franja de los problemas del disco (ficha 0010).
 */
export function DiskCharts({
  diskId,
  metrics,
  problemList
}: {
  /** Id ya validado (`diskEntityIdSchema`). */
  diskId: string
  metrics: UseQueryResult<DiskMetricsResult>
  /** Problemas de la entidad (`entities:problems`); null sin acceso a Problemas. */
  problemList: UseQueryResult<EntityProblemList> | null
}): JSX.Element {
  const { t } = useTranslation()
  const { charts } = diskLayout(metrics.data)
  return (
    <section
      data-testid="disk-charts"
      aria-label={t('entities.disk.charts.label')}
      className="grid gap-3"
    >
      <h2 className="text-sm font-semibold">{t('entities.disk.charts.title')}</h2>
      <div className="grid gap-4 lg:grid-cols-2">
        {charts.map((kind) => (
          <DiskChartPanel
            key={kind}
            kind={kind}
            diskId={diskId}
            metrics={metrics}
            problemList={kind === 'usage' ? problemList : null}
          />
        ))}
      </div>
    </section>
  )
}

/** Un gráfico del disco sobre el panel común (título, «Abrir en Métricas» y exportación). */
function DiskChartPanel({
  kind,
  diskId,
  metrics,
  problemList
}: {
  kind: DiskChartKind
  diskId: string
  metrics: UseQueryResult<DiskMetricsResult>
  /** Solo en el de uso: la franja de problemas encima del gráfico. */
  problemList: UseQueryResult<EntityProblemList> | null
}): JSX.Element {
  const { t, i18n } = useTranslation()
  const data = metrics.data

  const buildOption = useCallback(
    (loaded: DiskMetricsResult, colors: ChartColors, range: VisibleRange) =>
      diskChartOption(kind, loaded, { colors, language: i18n.language, t, range }),
    [kind, i18n.language, t]
  )

  // Nombres y puntos para el DOM (data-series) y la exportación; los colores no hacen falta.
  const series = useMemo(
    () =>
      data === undefined
        ? []
        : diskChartSeries(kind, data, { colors: NO_COLORS, t }).map((item) => ({
            name: item.name,
            points: item.points
          })),
    [kind, data, t]
  )

  return (
    <EntityChartPanel
      testIdPrefix="disk"
      slug={kind}
      title={t(`entities.disk.charts.${kind}`)}
      selector={diskChartSelector(kind, diskId)}
      query={metrics}
      buildOption={buildOption}
      series={series}
      unit={diskChartUnit(kind)}
      problemList={problemList}
    />
  )
}
