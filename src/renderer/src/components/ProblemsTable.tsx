import { memo, useEffect, type JSX, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import * as Tooltip from '@radix-ui/react-tooltip'
import { useVirtualizer } from '@tanstack/react-virtual'
import { formatDateTime } from '@shared/format-date'
import { impactLevels, severityLevels } from '@shared/modules'
import { displayList, NA, naIfEmpty, type ProblemRow } from '@shared/problem-row'
import { dateLang } from '../lib/date-lang'

/** A partir de estas filas, solo se pintan las visibles. */
const VIRTUAL_FROM = 200
const ROW_HEIGHT = 37

const COLUMNS = [
  'displayId',
  'title',
  'status',
  'impact',
  'severity',
  'affected',
  'rootCause',
  'cluster',
  'namespace',
  'start',
  'end',
  'duration'
] as const

/** Valores de Dynatrace sin traducción ya avisados en la consola (una vez cada uno). */
const warnedValues = new Set<string>()

/** El primer valor y, si hay más, "+N" con todos en un tooltip. */
function ListCell({ values }: { values: readonly string[] }): JSX.Element {
  const { t } = useTranslation()
  const extra = values.length - 1
  return (
    <span className="flex items-center gap-1.5">
      <span className="truncate">{displayList(values)}</span>
      {extra > 0 && (
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <button
              type="button"
              data-testid="more-values"
              aria-label={values.join(', ')}
              className="shrink-0 rounded bg-hover px-1.5 text-xs text-muted-foreground"
            >
              {t('problems.moreValues', { count: extra })}
            </button>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content
              sideOffset={6}
              className="glass z-50 grid max-w-80 gap-0.5 rounded-md px-3 py-2 text-xs text-foreground"
            >
              {values.map((value, index) => (
                <span key={`${index}-${value}`}>{value}</span>
              ))}
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
      )}
    </span>
  )
}

/**
 * Una fila. Con `memo`, una fila solo se vuelve a pintar si cambian sus datos o
 * su selección: seleccionar un problema o cambiar un filtro no repinta el resto.
 */
const ProblemRowView = memo(function ProblemRowView({
  row,
  index,
  selected,
  onSelect,
  measure
}: {
  row: ProblemRow
  index: number
  selected: boolean
  onSelect: (problemId: string) => void
  measure: ((element: Element | null) => void) | undefined
}): JSX.Element {
  const { t, i18n } = useTranslation()
  const lang = dateLang(i18n.language)
  const known = (group: 'severity' | 'impact', value: string): string =>
    i18n.exists(`problems.${group}.${value}`) ? t(`problems.${group}.${value}`) : value

  return (
    <tr
      data-testid="problem-row"
      data-problem-id={row.problemId}
      data-index={index}
      ref={measure}
      onClick={() => onSelect(row.problemId)}
      // Sin role=grid, aria-selected no se anuncia: la selección es solo visual.
      data-selected={selected ? 'true' : undefined}
      className="cursor-pointer border-t border-border hover:bg-hover data-[selected=true]:bg-active"
    >
      <td className="px-2 py-1.5 font-medium whitespace-nowrap">
        {/* El botón hace la fila accesible con teclado (Tab y Enter o Espacio). */}
        <button
          type="button"
          data-testid="problem-open"
          onClick={(event) => {
            event.stopPropagation()
            onSelect(row.problemId)
          }}
          className="rounded-sm font-medium underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-[var(--ring)]"
        >
          {row.displayId}
        </button>
      </td>
      <td className="max-w-80 truncate px-2 py-1.5" title={row.title}>
        {row.title}
      </td>
      <td className="px-2 py-1.5 whitespace-nowrap">{t(`problems.status.${row.status}`)}</td>
      <td className="px-2 py-1.5 whitespace-nowrap">{known('impact', row.impactLevel)}</td>
      <td className="px-2 py-1.5 whitespace-nowrap">{known('severity', row.severityLevel)}</td>
      <td className="max-w-60 px-2 py-1.5">
        <ListCell values={row.affectedNames} />
      </td>
      <td className="max-w-60 truncate px-2 py-1.5">{naIfEmpty(row.rootCauseName)}</td>
      <td className="max-w-48 px-2 py-1.5">
        <ListCell values={row.clusters} />
      </td>
      <td className="max-w-48 px-2 py-1.5">
        <ListCell values={row.namespaces} />
      </td>
      <td className="px-2 py-1.5 whitespace-nowrap">{formatDateTime(row.startTime, lang)}</td>
      <td className="px-2 py-1.5 whitespace-nowrap">
        {row.endTime === null ? NA : formatDateTime(row.endTime, lang)}
      </td>
      <td className="px-2 py-1.5 whitespace-nowrap">
        {t('problems.minutes', { count: row.durationMinutes })}
        {row.ongoing && (
          <span className="text-muted-foreground">{` ${t('problems.ongoing')}`}</span>
        )}
      </td>
    </tr>
  )
})

/**
 * Tabla de problemas. Las filas llegan ya calculadas (toProblemRow), las mismas
 * que se exportan. Con muchas filas se virtualiza dentro de su zona de scroll.
 */
export function ProblemsTable({
  rows,
  selected,
  onSelect,
  scrollRef
}: {
  rows: ProblemRow[]
  selected: string | null
  onSelect: (problemId: string) => void
  /** Zona que se captura como imagen. */
  scrollRef: RefObject<HTMLDivElement | null>
}): JSX.Element {
  const { t } = useTranslation()
  const virtual = rows.length >= VIRTUAL_FROM
  // El React Compiler no memoiza este componente (useVirtualizer devuelve funciones
  // que cambian en cada render); es lo esperado con TanStack Virtual.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
    enabled: virtual
  })

  // Dynatrace puede añadir severidades o impactos: se muestran tal cual y se avisa una vez.
  useEffect(() => {
    for (const row of rows) {
      for (const [kind, value, known] of [
        ['severityLevel', row.severityLevel, severityLevels],
        ['impactLevel', row.impactLevel, impactLevels]
      ] as const) {
        const key = `${kind}:${value}`
        if (!(known as readonly string[]).includes(value) && !warnedValues.has(key)) {
          warnedValues.add(key)
          console.warn(`[problems] ${kind} sin traducción: ${value}`)
        }
      }
    }
  }, [rows])

  const measure = virtual ? virtualizer.measureElement : undefined
  const renderRow = (row: ProblemRow, index: number): JSX.Element => (
    <ProblemRowView
      key={row.problemId}
      row={row}
      index={index}
      selected={selected === row.problemId}
      onSelect={onSelect}
      measure={measure}
    />
  )

  const items = virtual ? virtualizer.getVirtualItems() : []
  const padTop = items[0]?.start ?? 0
  const padBottom = virtual ? virtualizer.getTotalSize() - (items.at(-1)?.end ?? 0) : 0

  return (
    <div ref={scrollRef} data-testid="problems-scroll" className="max-h-[60vh] overflow-auto">
      <table data-testid="problems-table" className="w-full text-left text-sm">
        <thead className="sticky top-0 z-10 bg-background text-xs text-muted-foreground">
          <tr>
            {COLUMNS.map((key) => (
              <th
                key={key}
                data-testid={`col-${key}`}
                className="px-2 py-1.5 font-medium whitespace-nowrap"
              >
                {t(`problems.columns.${key}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {padTop > 0 && (
            <tr aria-hidden="true">
              <td colSpan={COLUMNS.length} style={{ height: padTop }} />
            </tr>
          )}
          {virtual
            ? items.map((item) => {
                const row = rows[item.index]
                return row === undefined ? null : renderRow(row, item.index)
              })
            : rows.map(renderRow)}
          {padBottom > 0 && (
            <tr aria-hidden="true">
              <td colSpan={COLUMNS.length} style={{ height: padBottom }} />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
