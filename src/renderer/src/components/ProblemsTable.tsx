import {
  memo,
  useEffect,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent,
  type RefObject
} from 'react'
import { useTranslation } from 'react-i18next'
import * as Tooltip from '@radix-ui/react-tooltip'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { formatDateTime } from '@shared/format-date'
import type { ProblemSummary } from '@shared/modules'
import { affectedLabels, type ProblemSort, type ProblemSortKey } from '@shared/problem-sort'
import { dateLang } from '../lib/date-lang'
import { cn } from '../lib/cn'

/** A partir de estas filas, solo se pintan las visibles. */
const VIRTUAL_FROM = 200
const ROW_HEIGHT = 44
/** Filas que saltan RePág y AvPág. */
const PAGE_STEP = 10
const COLUMNS: readonly ProblemSortKey[] = ['displayId', 'title', 'affected', 'start']
/** Dirección con la que empieza una columna al elegirla. */
const FIRST_DIRECTION: Record<ProblemSortKey, ProblemSort['direction']> = {
  displayId: 'asc',
  title: 'asc',
  affected: 'desc',
  start: 'desc'
}
const GRID_COLUMNS = 'grid grid-cols-[7.5rem_minmax(0,1fr)_6.5rem_9.5rem]'
const TOOLTIP =
  'glass z-50 grid max-w-80 gap-0.5 rounded-md px-3 py-2 text-xs text-foreground shadow-md'

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

/** Barra de estado: roja si abierto, verde y más fina si cerrado, con su texto. */
function StatusBar({ status }: { status: ProblemSummary['status'] }): JSX.Element {
  const { t } = useTranslation()
  const label = t(`problems.status.${status}`)
  const open = status === 'OPEN'
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <span
          data-testid="status-bar"
          data-status={status}
          aria-hidden="true"
          className={cn(
            'absolute top-1.5 bottom-1.5 left-0.5 rounded-full',
            open ? 'w-1 bg-status-open' : 'w-0.5 bg-status-closed'
          )}
        />
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content side="right" sideOffset={6} className={TOOLTIP}>
          {label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
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
        <Tooltip.Content data-testid="affected-tooltip" sideOffset={6} className={TOOLTIP}>
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

/**
 * Una fila. Con `memo`, una fila solo se vuelve a pintar si cambian sus datos,
 * su selección o si es la que tiene el foco.
 */
const ProblemRowView = memo(function ProblemRowView({
  item,
  index,
  selected,
  active,
  onSelect,
  onFocusRow,
  measure
}: {
  item: ProblemGridItem
  index: number
  selected: boolean
  /** La fila del roving tabindex: la única a la que llega Tab. */
  active: boolean
  onSelect: (problemId: string) => void
  onFocusRow: (index: number) => void
  measure: ((element: Element | null) => void) | undefined
}): JSX.Element {
  const { t, i18n } = useTranslation()
  const lang = dateLang(i18n.language)
  const status = t(`problems.status.${item.summary.status}`)

  return (
    <div
      role="row"
      aria-rowindex={index + 2}
      tabIndex={active ? 0 : -1}
      data-testid="problem-row"
      data-problem-id={item.problemId}
      data-index={index}
      // Sin aria-selected: la marca del último abierto es solo visual.
      data-selected={selected ? 'true' : undefined}
      ref={measure}
      onClick={() => onSelect(item.problemId)}
      onFocus={() => onFocusRow(index)}
      style={{ minHeight: ROW_HEIGHT }}
      className={cn(
        GRID_COLUMNS,
        'relative cursor-pointer items-center border-t border-border text-sm outline-none',
        'hover:bg-hover focus-visible:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
        'data-[selected=true]:bg-active'
      )}
    >
      <StatusBar status={item.summary.status} />
      <span role="gridcell" className="truncate py-2 pr-2 pl-4 font-medium tabular-nums">
        <span className="sr-only">{`${status}: `}</span>
        {item.displayId}
      </span>
      <span role="gridcell" className="truncate px-2 py-2" title={item.title}>
        {item.title}
      </span>
      <span role="gridcell" className="px-2 py-2">
        <AffectedCell item={item} />
      </span>
      <span
        role="gridcell"
        className="px-2 py-2 whitespace-nowrap text-muted-foreground tabular-nums"
      >
        {formatDateTime(item.startTime, lang)}
      </span>
    </div>
  )
})

/**
 * Lista de problemas como grid accesible: 4 columnas, barra de estado,
 * cabecera fija con orden por columna y roving tabindex (flechas, Inicio, Fin,
 * RePág, AvPág; Enter abre). Con muchas filas se virtualiza en su zona de scroll.
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
  const { t } = useTranslation()
  const virtual = items.length >= VIRTUAL_FROM
  // El React Compiler no memoiza este componente (useVirtualizer devuelve funciones
  // que cambian en cada render); es lo esperado con TanStack Virtual.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
    enabled: virtual
  })

  // Roving tabindex: la fila activa es la única con tabIndex 0. Empieza en la
  // última abierta (si está) o en la primera.
  const selectedIndex = items.findIndex((item) => item.problemId === selected)
  const [activeState, setActive] = useState<number | null>(null)
  const active = Math.min(activeState ?? Math.max(selectedIndex, 0), Math.max(items.length - 1, 0))
  const pendingFocus = useRef<number | null>(null)

  const rowElement = (index: number): HTMLElement | null =>
    scrollRef.current?.querySelector<HTMLElement>(`[role="row"][data-index="${index}"]`) ?? null

  // Tras mover el foco con el teclado, la fila puede no estar pintada aún
  // (virtualización): se enfoca cuando aparece.
  useEffect(() => {
    const target = pendingFocus.current
    if (target === null) return
    const row = rowElement(target)
    if (row !== null) {
      pendingFocus.current = null
      row.focus({ preventScroll: true })
      // La zona de scroll puede salirse de la ventana (filtros y gráfico encima):
      // 'nearest' mueve lo justo, el contenedor y también la página.
      row.scrollIntoView({ block: 'nearest' })
    }
  })

  const moveTo = (index: number): void => {
    const next = Math.max(0, Math.min(items.length - 1, index))
    setActive(next)
    pendingFocus.current = next
    if (virtual) virtualizer.scrollToIndex(next, { align: 'auto' })
    else rowElement(next)?.scrollIntoView({ block: 'nearest' })
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    // Solo con el foco en una fila: Enter en un botón de la cabecera ordena, no abre.
    if (items.length === 0 || (event.target as HTMLElement).getAttribute('role') !== 'row') return
    const steps: Partial<Record<string, number>> = {
      ArrowDown: active + 1,
      ArrowUp: active - 1,
      PageDown: active + PAGE_STEP,
      PageUp: active - PAGE_STEP,
      Home: 0,
      End: items.length - 1
    }
    const target = steps[event.key]
    if (target !== undefined) {
      event.preventDefault()
      moveTo(target)
    } else if (event.key === 'Enter') {
      const item = items[active]
      if (item !== undefined) {
        event.preventDefault()
        onSelect(item.problemId)
      }
    }
  }

  // Al volver del detalle: la misma primera fila visible (por índice, no por
  // píxeles) y el foco en el problema que se abrió. Una sola vez, con datos.
  const restored = useRef(false)
  useEffect(() => {
    const container = scrollRef.current
    if (restored.current || container === null || items.length === 0) return
    restored.current = true
    const index = Math.min(initialIndex, items.length - 1)
    if (index > 0) {
      if (virtual) {
        virtualizer.scrollToIndex(index, { align: 'start' })
      } else {
        const row = container.querySelector<HTMLElement>(`[role="row"][data-index="${index}"]`)
        const head = container.querySelector<HTMLElement>('[data-grid-header]')
        if (row !== null) container.scrollTop = row.offsetTop - (head?.offsetHeight ?? 0)
      }
    }
    // Solo si nada tiene el foco (se vuelve del detalle, no se llega desde el menú).
    if (selectedIndex >= 0 && document.activeElement === document.body) {
      setActive(selectedIndex)
      pendingFocus.current = selectedIndex
    }
  }, [items.length, initialIndex, selectedIndex, virtual, virtualizer, scrollRef])

  // La primera fila visible, bajo la cabecera fija, cada vez que cambia.
  const lastReported = useRef(initialIndex)
  const frame = useRef(0)
  const onScroll = (): void => {
    if (onFirstVisibleChange === undefined) return
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => {
      const container = scrollRef.current
      if (container === null) return
      const top = container.querySelector('[data-grid-header]')?.getBoundingClientRect().bottom ?? 0
      const first = [...container.querySelectorAll<HTMLElement>('[role="row"][data-index]')].find(
        (row) => row.getBoundingClientRect().bottom > top + 1
      )
      const index = first === undefined ? 0 : Number(first.dataset['index'])
      if (index !== lastReported.current) {
        lastReported.current = index
        onFirstVisibleChange(index)
      }
    })
  }

  const chooseSort = (key: ProblemSortKey): void =>
    onSortChange(
      sort.key === key
        ? { key, direction: sort.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: FIRST_DIRECTION[key] }
    )

  const measure = virtual ? virtualizer.measureElement : undefined
  const renderRow = (item: ProblemGridItem, index: number): JSX.Element => (
    <ProblemRowView
      key={item.problemId}
      item={item}
      index={index}
      selected={selected === item.problemId}
      active={index === active}
      onSelect={onSelect}
      onFocusRow={setActive}
      measure={measure}
    />
  )

  const virtualItems = virtual ? virtualizer.getVirtualItems() : []
  const padTop = virtualItems[0]?.start ?? 0
  const padBottom = virtual ? virtualizer.getTotalSize() - (virtualItems.at(-1)?.end ?? 0) : 0

  return (
    <div
      ref={scrollRef}
      data-testid="problems-scroll"
      onScroll={onScroll}
      className="max-h-[60vh] overflow-auto rounded-lg"
    >
      <div
        role="grid"
        data-testid="problems-grid"
        aria-label={t('problems.table')}
        aria-rowcount={items.length + 1}
        onKeyDown={onKeyDown}
      >
        <div role="rowgroup" data-grid-header className="sticky top-0 z-10 bg-background">
          <div
            role="row"
            aria-rowindex={1}
            className={cn(GRID_COLUMNS, 'text-xs text-muted-foreground')}
          >
            {COLUMNS.map((key, column) => {
              const current = sort.key === key
              const Arrow = sort.direction === 'asc' ? ArrowUp : ArrowDown
              return (
                <div
                  key={key}
                  role="columnheader"
                  data-testid={`col-${key}`}
                  aria-sort={
                    current ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'
                  }
                  className={cn('py-1.5', column === 0 ? 'pr-2 pl-4' : 'px-2')}
                >
                  <button
                    type="button"
                    data-testid={`sort-${key}`}
                    onClick={() => chooseSort(key)}
                    className={cn(
                      'flex items-center gap-1 rounded-sm font-medium hover:text-foreground focus-visible:outline-2 focus-visible:outline-[var(--ring)]',
                      current && 'text-foreground'
                    )}
                  >
                    {t(`problems.columns.${key === 'affected' ? 'affectedShort' : key}`)}
                    {current && <Arrow aria-hidden="true" className="size-3" />}
                  </button>
                </div>
              )
            })}
          </div>
        </div>
        <div role="rowgroup">
          {padTop > 0 && <div aria-hidden="true" style={{ height: padTop }} />}
          {virtual
            ? virtualItems.map((virtualItem) => {
                const item = items[virtualItem.index]
                return item === undefined ? null : renderRow(item, virtualItem.index)
              })
            : items.map(renderRow)}
          {padBottom > 0 && <div aria-hidden="true" style={{ height: padBottom }} />}
        </div>
      </div>
    </div>
  )
}
