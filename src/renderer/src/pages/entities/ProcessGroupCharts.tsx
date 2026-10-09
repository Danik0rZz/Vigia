import { useCallback, useMemo, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { UseQueryResult } from '@tanstack/react-query'
import type {
  EntityProblemList,
  ProcessGroupInstance,
  ProcessGroupMetricsResult,
  ProcessMetricsResult
} from '@shared/modules'
import type { QueryListState } from '../../data/modules'
import type { ChartColors } from '../../components/Chart'
import { NO_COLORS, type VisibleRange } from './entity-charts'
import { EntityChartPanel, type PanelQuery } from './EntityChartPanel'
import {
  combineInstanceCpu,
  groupChartOption,
  groupChartSelector,
  groupChartSeries,
  groupChartTitleKey,
  groupChartUnit,
  instanceCpuSelector,
  instanceCpuSeries,
  type InstanceCpuData,
  type ProcessGroupChartKind
} from './process-group-charts'

type TotalKind = Exclude<ProcessGroupChartKind, 'cpu-instances'>
const TOTAL_KINDS: readonly TotalKind[] = ['cpu', 'memory', 'network']

/**
 * Sección de gráficos de la página de un PROCESS_GROUP (ficha 0032): CPU, memoria y red del total
 * del grupo y «CPU por instancia», en una rejilla de 2×2 (una columna por debajo de 1024 px), como
 * la del proceso. Los tres primeros salen de la llamada de los marcadores
 * (`entities:processGroupMetrics`); el cuarto, de una llamada a `entities:processMetrics` por
 * cada una de las cinco instancias de más CPU (`instanceCpu`). Sobre el de la CPU va la franja de
 * los problemas del grupo (ficha 0010).
 */
export function ProcessGroupCharts({
  groupId,
  metrics,
  instances,
  instanceCpu,
  problemList
}: {
  /** Id ya validado (`processGroupEntityIdSchema`). */
  groupId: string
  metrics: UseQueryResult<ProcessGroupMetricsResult>
  /** Las instancias del gráfico «CPU por instancia» (`topInstances`). */
  instances: ProcessGroupInstance[]
  /** Las consultas de cada instancia, juntas y en el orden de `instances`. */
  instanceCpu: QueryListState<ProcessMetricsResult>
  /** Problemas de la entidad (`entities:problems`); null sin acceso a Problemas. */
  problemList: UseQueryResult<EntityProblemList> | null
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <section
      data-testid="process-group-charts"
      aria-label={t('entities.processGroup.charts.label')}
      className="grid gap-3"
    >
      <h2 className="text-sm font-semibold">{t('entities.processGroup.charts.title')}</h2>
      <div className="grid gap-4 lg:grid-cols-2">
        {TOTAL_KINDS.map((kind) => (
          <TotalChartPanel
            key={kind}
            kind={kind}
            groupId={groupId}
            metrics={metrics}
            problemList={kind === 'cpu' ? problemList : null}
          />
        ))}
        <InstanceCpuPanel metrics={metrics} instances={instances} instanceCpu={instanceCpu} />
      </div>
    </section>
  )
}

/** Un gráfico del total del grupo sobre el panel común (título, «Abrir en Métricas» y exportación). */
function TotalChartPanel({
  kind,
  groupId,
  metrics,
  problemList
}: {
  kind: TotalKind
  groupId: string
  metrics: UseQueryResult<ProcessGroupMetricsResult>
  /** Solo en el de la CPU: la franja de problemas encima del gráfico. */
  problemList: UseQueryResult<EntityProblemList> | null
}): JSX.Element {
  const { t, i18n } = useTranslation()
  const data = metrics.data

  const buildOption = useCallback(
    (loaded: ProcessGroupMetricsResult, colors: ChartColors, range: VisibleRange) =>
      groupChartOption(kind, groupChartSeries(kind, loaded, { colors, t }), loaded.resolution, {
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
        : groupChartSeries(kind, data, { colors: NO_COLORS, t }).map((item) => ({
            name: item.name,
            points: item.points
          })),
    [kind, data, t]
  )

  return (
    <EntityChartPanel
      testIdPrefix="process-group"
      slug={kind}
      title={t(`entities.processGroup.charts.${groupChartTitleKey(kind)}`)}
      selector={groupChartSelector(kind, groupId)}
      query={metrics}
      buildOption={buildOption}
      series={series}
      unit={groupChartUnit(kind)}
      problemList={problemList}
    />
  )
}

/**
 * «CPU por instancia»: una línea por cada una de las cinco instancias de más CPU media. Hasta que
 * llegan las instancias (la llamada del grupo) no hay nada que pedir; si falla esa llamada, el
 * panel enseña su aviso, y si falla la de una instancia, el de esa, con Reintentar.
 */
function InstanceCpuPanel({
  metrics,
  instances,
  instanceCpu
}: {
  metrics: UseQueryResult<ProcessGroupMetricsResult>
  instances: ProcessGroupInstance[]
  instanceCpu: QueryListState<ProcessMetricsResult>
}): JSX.Element {
  const { t, i18n } = useTranslation()
  const group = metrics.data
  const results = instanceCpu.data
  // Los datos del gráfico solo cambian con datos nuevos: si no, el gráfico se rehace en cada render.
  const combined = useMemo(
    () =>
      group === undefined || results === undefined
        ? undefined
        : combineInstanceCpu(instances, results, group.resolution),
    [group, results, instances]
  )
  const query = instanceCpuQuery(metrics, instanceCpu, combined)
  const data = query.data

  const buildOption = useCallback(
    (loaded: InstanceCpuData, colors: ChartColors, range: VisibleRange) =>
      groupChartOption('cpu-instances', instanceCpuSeries(loaded, colors), loaded.resolution, {
        colors,
        language: i18n.language,
        t,
        range
      }),
    [i18n.language, t]
  )

  const series = useMemo(
    () =>
      data === undefined
        ? []
        : instanceCpuSeries(data, NO_COLORS).map((item) => ({
            name: item.name,
            points: item.points
          })),
    [data]
  )

  return (
    <EntityChartPanel
      testIdPrefix="process-group"
      slug="cpu-instances"
      title={t(`entities.processGroup.charts.${groupChartTitleKey('cpu-instances')}`)}
      selector={instanceCpuSelector(instances)}
      query={query}
      buildOption={buildOption}
      series={series}
      unit={groupChartUnit('cpu-instances')}
      problemList={null}
    />
  )
}

/**
 * Las consultas de «CPU por instancia» como una sola para el panel: primero la del grupo (sin ella
 * no se sabe qué instancias pedir) y después las de cada instancia. El primer fallo manda;
 * Reintentar repite solo lo que falló.
 */
function instanceCpuQuery(
  metrics: UseQueryResult<ProcessGroupMetricsResult>,
  instanceCpu: QueryListState<ProcessMetricsResult>,
  data: InstanceCpuData | undefined
): PanelQuery<InstanceCpuData> {
  const isFetching = metrics.isFetching || instanceCpu.isFetching
  if (metrics.isError) {
    return {
      data: undefined,
      dataUpdatedAt: 0,
      isError: true,
      error: metrics.error,
      isFetching,
      refetch: () => metrics.refetch()
    }
  }
  if (instanceCpu.isError) return { ...instanceCpu, data: undefined, isFetching }
  return {
    data,
    dataUpdatedAt: Math.max(metrics.dataUpdatedAt, instanceCpu.dataUpdatedAt),
    isError: false,
    error: null,
    isFetching,
    refetch: () => Promise.all([metrics.refetch(), instanceCpu.refetch()])
  }
}
