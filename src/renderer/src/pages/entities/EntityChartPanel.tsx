import { useCallback, useMemo, useRef, type JSX, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import * as Tooltip from '@radix-ui/react-tooltip'
import type { UseQueryResult } from '@tanstack/react-query'
import type { EChartsCoreOption } from 'echarts/core'
import type { EntityProblemList } from '@shared/modules'
import { useTimeRangeValue } from '../../app/time-range'
import { Chart, type ChartColors, type ChartHandle } from '../../components/Chart'
import { ExportMenu } from '../../components/ExportMenu'
import { PanelBoundary } from '../../components/PanelBoundary'
import { metricsRangeLink } from '../../lib/metrics-link'
import { visibleRange, type VisibleRange } from './entity-charts'
import { MarkerError } from './EntityMarkers'
import { ProblemBand, type BandTestIdPrefix } from './ProblemBand'

/** Lo que el panel necesita de la respuesta del canal (servicio o host). */
interface ChartData {
  resolution: string
  warnings: string[]
}

/**
 * Lo que el panel usa de la consulta: lo cumple un `UseQueryResult` y también la unión de varias
 * («CPU por instancia» del process group, ficha 0032, junta una llamada por instancia).
 */
export interface PanelQuery<T> {
  data: T | undefined
  dataUpdatedAt: number
  isError: boolean
  error: unknown
  isFetching: boolean
  refetch: () => unknown
}

/** Una serie del gráfico tal como va al DOM (`data-series`) y a la exportación. */
export interface PanelSeries {
  name: string
  points: [number, number | null][]
  /** Unidad de esta serie en la exportación, si no es la del panel (otro eje, ficha 0054). */
  unit?: string
}

/** Testids propios de un panel que no sigue el patrón `<prefijo>-chart-…` (ficha 0048). */
export interface PanelTestIds {
  panel: string
  chart: string
  /** Disparador del tooltip del título (con `titleHint`). */
  title: string
}

/**
 * Un gráfico de una página de entidad con su título, «Abrir en Métricas» y la exportación
 * (ficha 0009, sacado del servicio para el host en la 0018); carga y falla por su lado. Con
 * `problemList`, la franja de problemas va encima del gráfico (ficha 0010). Los testids llevan
 * el prefijo del tipo: `service-chart-panel`, `host-chart-panel`… Sin `selector` no hay «Abrir en
 * Métricas» (un cálculo de Vigía, como la disponibilidad del servicio, ficha 0048); con
 * `titleHint`, el título abre un tooltip con el ratón y con el foco.
 */
export function EntityChartPanel<T extends ChartData>({
  testIdPrefix,
  slug,
  title,
  selector,
  query,
  buildOption,
  series,
  unit,
  problemList,
  titleHint,
  testIds,
  note,
  footer
}: {
  testIdPrefix: BandTestIdPrefix
  /** Nombre del gráfico en `data-kind` y en los testids. */
  slug: string
  title: string
  /** Consulta de Métricas de «Abrir en Métricas» y de la exportación; sin ella, sin botón. */
  selector?: string | undefined
  query: PanelQuery<T>
  /** Opción de ECharts con los datos ya cargados, los colores del tema y el rango visible. */
  buildOption: (data: T, colors: ChartColors, range: VisibleRange) => EChartsCoreOption
  /** Las series con sus puntos (sin datos todavía, lista vacía). */
  series: PanelSeries[]
  /** Unidad de los valores, para la exportación. */
  unit: string
  /** Problemas de la entidad (`entities:problems`); null sin franja. */
  problemList: UseQueryResult<EntityProblemList> | null
  /** Explicación del título, en un tooltip. */
  titleHint?: string | undefined
  /** Testids propios; sin ellos, los del prefijo. */
  testIds?: PanelTestIds | undefined
  /** Nota bajo el título (por ejemplo, errores sin separar por tipo, ficha 0053). */
  note?: ReactNode
  /** Contenido bajo el gráfico (por ejemplo, los datos pequeños de sesiones, ficha 0054). */
  footer?: ReactNode
}): JSX.Element {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const chart = useRef<ChartHandle>(null)
  const timeRange = useTimeRangeValue()
  const data = query.data
  const loadedAt = query.dataUpdatedAt
  // El rango que se ve: el relativo, contado desde que llegaron los datos.
  const range = useMemo(() => visibleRange(timeRange, loadedAt), [timeRange, loadedAt])
  // La franja usa el rango del gráfico; sin datos del gráfico, el de cuando llegó la lista.
  const listLoadedAt = problemList?.dataUpdatedAt ?? 0
  const bandRange = useMemo(
    () => (loadedAt > 0 ? range : visibleRange(timeRange, listLoadedAt)),
    [loadedAt, range, timeRange, listLoadedAt]
  )

  const option = useCallback(
    (colors: ChartColors): EChartsCoreOption =>
      data === undefined ? {} : buildOption(data, colors, range),
    [data, buildOption, range]
  )
  const names = useMemo(() => series.map((item) => item.name), [series])
  const exportRows = useMemo(
    () =>
      series.flatMap((item) =>
        item.points.map(([time, value]) => ({
          time,
          series: item.name,
          value,
          unit: item.unit ?? unit
        }))
      ),
    [series, unit]
  )

  const chartTestId = testIds?.chart ?? `${testIdPrefix}-chart-${slug}`

  return (
    <section
      data-testid={testIds?.panel ?? `${testIdPrefix}-chart-panel`}
      data-kind={slug}
      aria-label={title}
      className="glass grid min-w-0 content-start gap-2 rounded-xl p-4"
    >
      <div className="flex min-w-0 items-center gap-3">
        <h3 className="mr-auto truncate text-sm font-semibold">
          {titleHint === undefined ? (
            title
          ) : (
            <TitleWithHint title={title} hint={titleHint} testId={testIds?.title} />
          )}
        </h3>
        {selector !== undefined && (
          <button
            type="button"
            data-testid={`${testIdPrefix}-chart-open`}
            onClick={() => {
              // Sin datos todavía (cargando o con error), el rango contado desde ahora.
              const shown = loadedAt > 0 ? range : visibleRange(timeRange, Date.now())
              void navigate(metricsRangeLink(selector, shown.from, shown.to))
            }}
            className="shrink-0 text-xs underline underline-offset-2"
          >
            {t('problems.openInMetrics')}
          </button>
        )}
        {data !== undefined && !query.isError && (
          <ExportMenu
            target={chartTestId}
            module="metrics"
            image={() => chart.current?.toPngDataUrl() ?? null}
            table={{
              columns: [
                { key: 'time', header: t('metrics.exportColumns.time'), type: 'date' },
                {
                  key: 'series',
                  header: t('entities.service.charts.exportColumns.series'),
                  type: 'string'
                },
                { key: 'value', header: t('metrics.exportColumns.value'), type: 'number' },
                {
                  key: 'unit',
                  header: t('entities.service.charts.exportColumns.unit'),
                  type: 'string'
                }
              ],
              rows: exportRows,
              query: selector,
              timeRange,
              loadedAt,
              resolution: data.resolution,
              warnings: data.warnings
            }}
          />
        )}
      </div>
      {note}
      {problemList !== null && (
        <ProblemBand query={problemList} range={bandRange} testIdPrefix={testIdPrefix} />
      )}
      {query.isError ? (
        <MarkerError
          error={query.error}
          busy={query.isFetching}
          onRetry={() => void query.refetch()}
        />
      ) : data === undefined ? (
        <div
          role="status"
          aria-label={t('entities.service.charts.loading')}
          className="h-60 rounded-lg bg-hover motion-safe:animate-pulse"
        />
      ) : (
        <PanelBoundary onRetry={() => void query.refetch()}>
          <Chart
            ref={chart}
            testId={chartTestId}
            label={title}
            buildOption={option}
            seriesNames={names}
          />
        </PanelBoundary>
      )}
      {footer}
    </section>
  )
}

/** Título del panel con su explicación en un tooltip que también se abre con el foco. */
function TitleWithHint({
  title,
  hint,
  testId
}: {
  title: string
  hint: string
  testId: string | undefined
}): JSX.Element {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <span
          data-testid={testId}
          tabIndex={0}
          className="cursor-help underline decoration-dotted underline-offset-2"
        >
          {title}
        </span>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          sideOffset={6}
          className="glass z-50 max-w-80 rounded-md px-3 py-2 text-xs font-normal text-foreground"
        >
          {hint}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}
