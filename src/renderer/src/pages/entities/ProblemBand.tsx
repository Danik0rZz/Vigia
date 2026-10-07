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
import { PROBLEM_BAND_MAX_ROWS, problemBandLayout, type ProblemBandSegment } from './problem-band'
import { MarkerError } from './ServiceMarkers'

/** Alto de una fila de la franja, en px. */
const ROW_HEIGHT = 20
const ROW_GAP = 2
/** Márgenes del área de dibujo del gráfico (`grid` de `serviceChartOption`): la franja se alinea con ella. */
const PLOT_LEFT = 64
const PLOT_RIGHT = 16
/** Ancho mínimo de un tramo (un problema muy corto en un rango largo), para poder pulsarlo. */
const MIN_SEGMENT_PX = 8

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
      <div
        className="relative"
        style={{ height: shownRows * ROW_HEIGHT + (shownRows - 1) * ROW_GAP }}
      >
        {layout.overflow > 0 && (
          <span
            data-testid="service-problem-more"
            className="absolute left-0 text-xs text-muted-foreground"
            style={{
              top: (PROBLEM_BAND_MAX_ROWS - 1) * (ROW_HEIGHT + ROW_GAP),
              width: PLOT_LEFT - 8,
              lineHeight: `${ROW_HEIGHT}px`
            }}
          >
            {t('entities.service.problemBand.more', { count: layout.overflow })}
          </span>
        )}
        <div className="absolute inset-y-0" style={{ left: PLOT_LEFT, right: PLOT_RIGHT }}>
          {layout.segments.map((segment) => {
            const problem = byId.get(segment.problemId)
            return problem === undefined ? null : (
              <Segment
                key={segment.problemId}
                segment={segment}
                problem={problem}
                left={(segment.start - range.from) / span}
                width={(segment.end - segment.start) / span}
              />
            )
          })}
        </div>
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

/** Un tramo: botón con icono y el id visible, su tooltip y el enlace al detalle. */
function Segment({
  segment,
  problem,
  left,
  width
}: {
  segment: ProblemBandSegment
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
            'absolute flex items-center gap-1 overflow-hidden rounded px-1 text-left text-xs',
            open
              ? 'bg-danger text-danger-foreground'
              : 'border border-status-neutral bg-hover text-muted-foreground'
          )}
          style={{
            left: `${left * 100}%`,
            // Sin pasarse del final del área, aunque se aplique el ancho mínimo.
            width: `max(${MIN_SEGMENT_PX}px, ${width * 100}%)`,
            maxWidth: `${(1 - left) * 100}%`,
            top: segment.row * (ROW_HEIGHT + ROW_GAP),
            height: ROW_HEIGHT
          }}
        >
          <Icon aria-hidden className="size-3 shrink-0" />
          <span className="truncate">{problem.displayId}</span>
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
