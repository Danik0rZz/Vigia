import {
  memo,
  useEffect,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent,
  type ReactNode,
  type RefObject
} from 'react'
import * as Tooltip from '@radix-ui/react-tooltip'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDown, ArrowUp } from 'lucide-react'
import type { GridSort } from '@shared/grid-sort'
import { cn } from '../lib/cn'

/** A partir de estas filas, solo se pintan las visibles. */
const VIRTUAL_FROM = 200
const ROW_HEIGHT = 44
/** Filas que saltan RePág y AvPág. */
const PAGE_STEP = 10
export const GRID_TOOLTIP =
  'glass z-50 grid max-w-80 gap-0.5 rounded-md px-3 py-2 text-xs text-foreground shadow-md'

/**
 * Una columna: su cabecera y su celda. El orden de los datos no va aquí: lo
 * hacen los comparadores puros de shared (`sortRows`), porque la página ordena
 * antes de pintar y la exportación sigue ese mismo orden.
 */
export interface DataGridColumn<T, K extends string = string> {
  id: K
  header: ReactNode
  /** Clases de la celda. */
  className?: string
  /** Clases de la cabecera (por defecto, el relleno estándar). */
  headerClassName?: string
  cell: (item: T) => ReactNode
  /** Texto completo de la celda al pasar el ratón (atributo title). */
  cellTitle?: (item: T) => string
  /** Ordenable: la dirección con la que empieza al elegirla. */
  sortable?: GridSort['direction']
}

/** Barra de estado de una fila: roja si abierto, verde y más fina si cerrado, con su texto. */
export interface RowStatus {
  open: boolean
  /** Valor para data-status (OPEN, CLOSED…). */
  value: string
  /** Texto del tooltip. */
  label: string
}

function StatusBar({ status }: { status: RowStatus }): JSX.Element {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <span
          data-testid="status-bar"
          data-status={status.value}
          aria-hidden="true"
          className={cn(
            'absolute top-1.5 bottom-1.5 left-0.5 rounded-full',
            status.open ? 'w-1 bg-status-open' : 'w-0.5 bg-status-closed'
          )}
        />
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content side="right" sideOffset={6} className={GRID_TOOLTIP}>
          {status.label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}

interface RowProps<T> {
  item: T
  index: number
  columns: readonly DataGridColumn<T>[]
  gridTemplate: string
  rowTestId: string
  // Funciones (no sus resultados) para que `memo` compare referencias estables.
  rowData: ((item: T) => Record<string, string>) | undefined
  status: ((item: T) => RowStatus) | undefined
  selected: boolean
  /** La fila del roving tabindex: la única a la que llega Tab. */
  active: boolean
  onActivate: (item: T) => void
  onFocusRow: (index: number) => void
  measure: ((element: Element | null) => void) | undefined
}

/**
 * Una fila. Con `memo`, una fila solo se vuelve a pintar si cambian sus datos,
 * su selección o si es la que tiene el foco.
 */
const GridRow = memo(function GridRow<T>({
  item,
  index,
  columns,
  gridTemplate,
  rowTestId,
  rowData,
  status,
  selected,
  active,
  onActivate,
  onFocusRow,
  measure
}: RowProps<T>): JSX.Element {
  const rowStatus = status?.(item)
  return (
    <div
      role="row"
      aria-rowindex={index + 2}
      tabIndex={active ? 0 : -1}
      data-testid={rowTestId}
      {...rowData?.(item)}
      data-index={index}
      // Sin aria-selected: la marca del último abierto es solo visual.
      data-selected={selected ? 'true' : undefined}
      ref={measure}
      onClick={() => onActivate(item)}
      onFocus={() => onFocusRow(index)}
      style={{ minHeight: ROW_HEIGHT }}
      className={cn(
        gridTemplate,
        'relative cursor-pointer items-center border-t border-border text-sm outline-none',
        'hover:bg-hover focus-visible:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
        'data-[selected=true]:bg-active'
      )}
    >
      {rowStatus !== undefined && <StatusBar status={rowStatus} />}
      {columns.map((column) => (
        <span
          key={column.id}
          role="gridcell"
          className={column.className ?? 'px-2 py-2'}
          title={column.cellTitle?.(item)}
        >
          {column.cell(item)}
        </span>
      ))}
    </div>
  )
}) as <T>(props: RowProps<T>) => JSX.Element

/**
 * Grid accesible y genérico: columnas declarativas, barra de estado opcional,
 * cabecera fija con orden por columna, roving tabindex (flechas, Inicio, Fin,
 * RePág, AvPág; Enter activa) y virtualización con muchas filas. Se usa en la
 * lista de Problemas.
 */
export function DataGrid<T, K extends string = string>({
  items,
  getId,
  columns,
  gridTemplate,
  sort,
  onSortChange,
  status,
  onActivate,
  selected,
  rowTestId,
  rowData,
  gridTestId,
  scrollTestId,
  ariaLabel,
  scrollRef,
  initialIndex = 0,
  onFirstVisibleChange
}: {
  /** Ya filtrados y ordenados. */
  items: T[]
  getId: (item: T) => string
  columns: readonly DataGridColumn<T, K>[]
  /** Clases de la rejilla de columnas (cabecera y filas). */
  gridTemplate: string
  sort: GridSort<K>
  onSortChange: (sort: GridSort<K>) => void
  status?: ((item: T) => RowStatus) | undefined
  /** Clic o Enter en una fila. */
  onActivate: (item: T) => void
  /** La fila marcada (la última activada); al volver, recibe el foco. */
  selected: string | null
  rowTestId: string
  rowData?: ((item: T) => Record<string, string>) | undefined
  gridTestId: string
  scrollTestId: string
  ariaLabel: string
  /** Zona de scroll (y la que se captura como imagen). */
  scrollRef: RefObject<HTMLDivElement | null>
  /** Primera fila visible al montar. */
  initialIndex?: number
  /** Índice de la primera fila visible cuando cambia con el scroll. */
  onFirstVisibleChange?: ((index: number) => void) | undefined
}): JSX.Element {
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
  // seleccionada (si está) o en la primera.
  const selectedIndex = items.findIndex((item) => getId(item) === selected)
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
      // La zona de scroll puede salirse de la ventana: 'nearest' mueve lo justo,
      // el contenedor y también la página.
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
    // Solo con el foco en una fila: Enter en un botón de la cabecera ordena, no activa.
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
        onActivate(item)
      }
    }
  }

  // Al volver a la vista: la misma primera fila visible (por índice, no por
  // píxeles) y el foco en la seleccionada. Una sola vez, con datos.
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
    // Solo si nada tiene el foco (se vuelve de otra página, no se llega desde el menú).
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

  const chooseSort = (column: DataGridColumn<T, K>): void =>
    onSortChange(
      sort.key === column.id
        ? { key: column.id, direction: sort.direction === 'asc' ? 'desc' : 'asc' }
        : { key: column.id, direction: column.sortable ?? 'asc' }
    )

  const measure = virtual ? virtualizer.measureElement : undefined
  const renderRow = (item: T, index: number): JSX.Element => {
    const id = getId(item)
    return (
      <GridRow
        key={id}
        item={item}
        index={index}
        columns={columns}
        gridTemplate={gridTemplate}
        rowTestId={rowTestId}
        rowData={rowData}
        status={status}
        selected={selected === id}
        active={index === active}
        onActivate={onActivate}
        onFocusRow={setActive}
        measure={measure}
      />
    )
  }

  const virtualItems = virtual ? virtualizer.getVirtualItems() : []
  const padTop = virtualItems[0]?.start ?? 0
  const padBottom = virtual ? virtualizer.getTotalSize() - (virtualItems.at(-1)?.end ?? 0) : 0

  return (
    <div
      ref={scrollRef}
      data-testid={scrollTestId}
      onScroll={onScroll}
      className="max-h-[60vh] overflow-auto rounded-lg"
    >
      <div
        role="grid"
        data-testid={gridTestId}
        aria-label={ariaLabel}
        aria-rowcount={items.length + 1}
        onKeyDown={onKeyDown}
      >
        <div role="rowgroup" data-grid-header className="sticky top-0 z-10 bg-background">
          <div
            role="row"
            aria-rowindex={1}
            className={cn(gridTemplate, 'text-xs text-muted-foreground')}
          >
            {columns.map((column) => {
              const current = sort.key === column.id
              const Arrow = sort.direction === 'asc' ? ArrowUp : ArrowDown
              return (
                <div
                  key={column.id}
                  role="columnheader"
                  data-testid={`col-${column.id}`}
                  aria-sort={
                    column.sortable === undefined
                      ? undefined
                      : current
                        ? sort.direction === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : 'none'
                  }
                  className={cn('py-1.5', column.headerClassName ?? 'px-2')}
                >
                  {column.sortable === undefined ? (
                    <span className="font-medium">{column.header}</span>
                  ) : (
                    <button
                      type="button"
                      data-testid={`sort-${column.id}`}
                      onClick={() => chooseSort(column)}
                      className={cn(
                        'flex items-center gap-1 rounded-sm font-medium hover:text-foreground focus-visible:outline-2 focus-visible:outline-[var(--ring)]',
                        current && 'text-foreground'
                      )}
                    >
                      {column.header}
                      {current && <Arrow aria-hidden="true" className="size-3" />}
                    </button>
                  )}
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
