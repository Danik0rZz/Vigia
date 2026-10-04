import type { JSX, RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import * as Tooltip from '@radix-ui/react-tooltip'
import { formatDateTime } from '@shared/format-date'
import type { ProblemSummary } from '@shared/modules'
import { affectedLabels, type ProblemSort, type ProblemSortKey } from '@shared/problem-sort'
import { dateLang } from '../lib/date-lang'
import { DataGrid, GRID_TOOLTIP, type DataGridColumn, type RowStatus } from './DataGrid'

const GRID_COLUMNS = 'grid grid-cols-[7.5rem_minmax(0,1fr)_6.5rem_9.5rem]'

/** Un problema de la lista, con lo que el grid necesita ya calculado. */
export interface ProblemGridItem {
  summary: ProblemSummary
  problemId: string
  displayId: string
  title: string
  startTime: number
  /** Entidades afectadas únicas (por id). */
  affected: { id: string; name: string | null }[]
  affectedCount: number
}

/** Número de afectados únicos, con hasta 10 nombres (o ids) en un tooltip y "+N". */
function AffectedCell({ item }: { item: ProblemGridItem }): JSX.Element {
  const { t } = useTranslation()
  const { shown, more } = affectedLabels(item.affected)
  const count = (
    <span data-testid="affected-count" className="tabular-nums">
      {item.affectedCount}
    </span>
  )
  if (item.affectedCount === 0) return count
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{count}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content data-testid="affected-tooltip" sideOffset={6} className={GRID_TOOLTIP}>
          {shown.map((label, index) => (
            <span key={`${index}-${label}`} className="truncate">
              {label}
            </span>
          ))}
          {more > 0 && (
            <span className="text-muted-foreground">
              {t('problems.moreValues', { count: more })}
            </span>
          )}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}

const problemId = (item: ProblemGridItem): string => item.problemId
const rowData = (item: ProblemGridItem): Record<string, string> => ({
  'data-problem-id': item.problemId
})

/**
 * Lista de problemas sobre el DataGrid: 4 columnas, barra de estado, orden por
 * columna y teclado (Enter abre). Con muchas filas se virtualiza.
 */
export function ProblemsTable({
  items,
  selected,
  onSelect,
  scrollRef,
  sort,
  onSortChange,
  initialIndex = 0,
  onFirstVisibleChange
}: {
  /** Ya filtrados y ordenados. */
  items: ProblemGridItem[]
  /** El problema que se abrió el último: se marca y, al volver, recibe el foco. */
  selected: string | null
  onSelect: (problemId: string) => void
  /** Zona que se captura como imagen. */
  scrollRef: RefObject<HTMLDivElement | null>
  sort: ProblemSort
  onSortChange: (sort: ProblemSort) => void
  /** Primera fila visible al montar (la que había al ir al detalle). */
  initialIndex?: number
  /** Índice de la primera fila visible cuando cambia con el scroll. */
  onFirstVisibleChange?: (index: number) => void
}): JSX.Element {
  const { t, i18n } = useTranslation()
  const lang = dateLang(i18n.language)

  const status = (item: ProblemGridItem): RowStatus => ({
    open: item.summary.status === 'OPEN',
    value: item.summary.status,
    label: t(`problems.status.${item.summary.status}`)
  })

  const columns: DataGridColumn<ProblemGridItem, ProblemSortKey>[] = [
    {
      id: 'displayId',
      header: t('problems.columns.displayId'),
      headerClassName: 'pr-2 pl-4',
      className: 'truncate py-2 pr-2 pl-4 font-medium tabular-nums',
      sortable: 'asc',
      cell: (item) => (
        <>
          <span className="sr-only">{`${t(`problems.status.${item.summary.status}`)}: `}</span>
          {item.displayId}
        </>
      )
    },
    {
      id: 'title',
      header: t('problems.columns.title'),
      className: 'truncate px-2 py-2',
      sortable: 'asc',
      cellTitle: (item) => item.title,
      cell: (item) => item.title
    },
    {
      id: 'affected',
      header: t('problems.columns.affectedShort'),
      sortable: 'desc',
      cell: (item) => <AffectedCell item={item} />
    },
    {
      id: 'start',
      header: t('problems.columns.start'),
      className: 'px-2 py-2 whitespace-nowrap text-muted-foreground tabular-nums',
      sortable: 'desc',
      cell: (item) => formatDateTime(item.startTime, lang)
    }
  ]

  return (
    <DataGrid
      items={items}
      getId={problemId}
      columns={columns}
      gridTemplate={GRID_COLUMNS}
      sort={sort}
      onSortChange={onSortChange}
      status={status}
      onActivate={(item) => onSelect(item.problemId)}
      selected={selected}
      rowTestId="problem-row"
      rowData={rowData}
      gridTestId="problems-grid"
      scrollTestId="problems-scroll"
      ariaLabel={t('problems.table')}
      scrollRef={scrollRef}
      initialIndex={initialIndex}
      onFirstVisibleChange={onFirstVisibleChange}
    />
  )
}
