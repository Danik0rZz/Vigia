import { useMemo, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import * as Tooltip from '@radix-ui/react-tooltip'
import { CircleAlert, CircleCheck } from 'lucide-react'
import type { UseQueryResult } from '@tanstack/react-query'
import type { EntityProblem, EntityProblemList } from '@shared/modules'
import { formatDateTime } from '@shared/format-date'
import { cn } from '../../lib/cn'
import { dateLang } from '../../lib/date-lang'
import type { ProblemDetailLocationState } from '../ProblemDetailPage'
import { PROBLEM_BAND_MAX_ROWS, problemBandLayout } from './problem-band'
import { MarkerError } from './ServiceMarkers'

/** Márgenes del área de dibujo del gráfico (`grid` de `serviceChartOption`): la franja se alinea con ella. */
const PLOT_LEFT = 64
const PLOT_RIGHT = 16
/**
 * Caja de un tramo: borde, relleno y una línea de texto (`leading-4`, el alto del icono y del
 * id). En rem: el alto de la fila sale de aquí y sigue al tamaño de letra y al zoom (ficha 0013).
 */
const SEGMENT_BOX = 'rounded border py-px text-xs leading-4'
/**
 * Ancho mínimo de un tramo (un problema muy corto en un rango largo): el icono (0,75rem) entero,
 * con su relleno (2 × 3 px) y el borde (2 × 1 px). Con menos, el icono salía partido (ficha 0013).
 */
const MIN_SEGMENT_WIDTH = 'calc(0.75rem + 8px)'

/**
 * Franja de los problemas de la entidad sobre el gráfico «Tasa de error» (ficha 0010):
 * un tramo por problema, del inicio al fin (los abiertos, hasta el final del rango),
 * en filas si se solapan. Sin problemas en el rango no ocupa nada; si el canal falla,
 * enseña su aviso con Reintentar y el gráfico sigue.
 */
export function ProblemBand({
  query,
  range
}: {
  query: UseQueryResult<EntityProblemList>
  /** Rango visible del gráfico, en ms. */
  range: { from: number; to: number }
}): JSX.Element | null {
  const { t } = useTranslation()
  const data = query.data
  const layout = useMemo(
    () => (data === undefined ? null : problemBandLayout(data.problems, range)),
    [data, range]
  )

  if (query.isError) {
    return (
      <div
        data-testid="service-problem-band"
        role="group"
        aria-label={t('entities.service.problemBand.label')}
        className="rounded-lg border border-danger/50 p-2"
      >
        <MarkerError
          error={query.error}
          busy={query.isFetching}
          onRetry={() => void query.refetch()}
        />
      </div>
    )
  }
  // Mientras carga, o sin nada que dibujar, ni franja ni hueco.
  if (data === undefined || layout === null) return null
  if (layout.segments.length === 0 && layout.overflow === 0 && !data.truncated) return null

  const byId = new Map(data.problems.map((problem) => [problem.problemId, problem]))
  const rows = Math.max(1, ...layout.segments.map((segment) => segment.row + 1))
  const shownRows = layout.overflow > 0 ? PROBLEM_BAND_MAX_ROWS : rows
  const span = Math.max(1, range.to - range.from)

  return (
    <div
      data-testid="service-problem-band"
      role="group"
      aria-label={t('entities.service.problemBand.label')}
      className="grid gap-1"
    >
      <div className="grid gap-0.5" style={{ marginLeft: PLOT_LEFT, marginRight: PLOT_RIGHT }}>
        {Array.from({ length: shownRows }, (_, row) => (
          <div key={row} className="relative">
            {/* Da a la fila el alto de un tramo; los tramos van encima, colocados por tiempo. */}
            <span aria-hidden className={cn(SEGMENT_BOX, 'invisible block border-transparent')}>
              &nbsp;
            </span>
            {layout.overflow > 0 && row === PROBLEM_BAND_MAX_ROWS - 1 && (
              <span
                data-testid="service-problem-more"
                className={cn(
                  SEGMENT_BOX,
                  'absolute top-0 right-full mr-2 border-transparent whitespace-nowrap text-muted-foreground'
                )}
              >
                {t('entities.service.problemBand.more', { count: layout.overflow })}
              </span>
            )}
            {layout.segments
              .filter((segment) => segment.row === row)
              .map((segment) => {
                const problem = byId.get(segment.problemId)
                return problem === undefined ? null : (
                  <Segment
                    key={segment.problemId}
                    problem={problem}
                    left={(segment.start - range.from) / span}
                    width={(segment.end - segment.start) / span}
                  />
                )
              })}
          </div>
        ))}
      </div>
      {data.truncated && (
        <p data-testid="service-problem-truncated" className="text-xs text-muted-foreground">
          {t('entities.service.problemBand.truncated', {
            count: data.problems.length,
            total: data.totalCount ?? data.problems.length
          })}
        </p>
      )}
    </div>
  )
}

/**
 * Un tramo: botón con icono y el id visible, su tooltip y el enlace al detalle. El icono y el id
 * van en una línea que salta de línea si el id no cabe entero; la segunda línea queda fuera de la
 * caja (oculta), así que un tramo estrecho enseña solo el icono, entero y centrado, y nunca medio
 * id. La línea va centrada y el id crece hasta llenar el sitio que queda: con el id al lado, no
 * sobra sitio que repartir y los dos quedan a la izquierda; con el id en la segunda línea, el icono
 * queda solo y centrado, mida lo que mida el tramo (sin umbral de ancho). El id sigue en el nombre
 * accesible y en el tooltip.
 */
function Segment({
  problem,
  left,
  width
}: {
  problem: EntityProblem
  /** Posición y ancho, en fracción del área de dibujo (0 a 1). */
  left: number
  width: number
}): JSX.Element {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const lang = dateLang(i18n.language)
  const open = problem.status === 'OPEN'
  const statusText = t(`problems.status.${problem.status}`)
  const Icon = open ? CircleAlert : CircleCheck
  const openDetail = (): void => {
    // Con este estado, «Volver» del detalle va atrás en el historial: a esta página.
    const state: ProblemDetailLocationState = { fromList: true }
    void navigate(`/problems/${encodeURIComponent(problem.problemId)}`, { state })
  }

  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button
          type="button"
          data-testid="service-problem-segment"
          data-problem-id={problem.problemId}
          data-status={open ? 'open' : 'closed'}
          aria-label={`${statusText} · ${problem.displayId} · ${problem.title}`}
          onClick={openDetail}
          className={cn(
            SEGMENT_BOX,
            'absolute inset-y-0 overflow-hidden text-left',
            open
              ? 'border-danger bg-danger text-danger-foreground'
              : 'border-status-neutral bg-hover text-muted-foreground'
          )}
          style={{
            // Con el ancho mínimo, el tramo pegado al final se corre a la izquierda para no salirse.
            left: `min(${left * 100}%, 100% - max(${MIN_SEGMENT_WIDTH}, ${width * 100}%))`,
            width: `max(${MIN_SEGMENT_WIDTH}, ${width * 100}%)`
          }}
        >
          <span className="flex h-4 flex-wrap items-center justify-center gap-x-1 gap-y-2 overflow-hidden px-[3px]">
            {/* Con my-0.5 mide lo mismo que la línea (1rem): solo, queda centrado en vertical. */}
            <Icon aria-hidden className="my-0.5 size-3 shrink-0" />
            <span className="grow whitespace-nowrap">{problem.displayId}</span>
          </span>
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          data-testid="service-problem-tooltip"
          sideOffset={6}
          className="glass z-50 grid max-w-80 gap-1 rounded-md px-3 py-2 text-xs text-foreground"
        >
          <p className="font-semibold">
            {problem.displayId} · {statusText}
          </p>
          <p className="wrap-anywhere">{problem.title}</p>
          <p className="text-muted-foreground">
            {t('entities.service.problemBand.start')}: {formatDateTime(problem.startTime, lang)}
          </p>
          <p className="text-muted-foreground">
            {t('entities.service.problemBand.end')}:{' '}
            {problem.endTime === null
              ? t('entities.service.problemBand.active')
              : formatDateTime(problem.endTime, lang)}
          </p>
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}
