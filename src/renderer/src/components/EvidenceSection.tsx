import { useEffect, useId, useMemo, useRef, type JSX, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import * as Popover from '@radix-ui/react-popover'
import * as Tooltip from '@radix-ui/react-tooltip'
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  BellOff,
  Check,
  ChevronDown,
  Repeat,
  Wrench
} from 'lucide-react'
import { formatDateTime } from '@shared/format-date'
import type { ProblemDetail } from '@shared/modules'
import {
  DEFAULT_EVIDENCE_SORT,
  EMPTY_EVIDENCE_FILTERS,
  NOT_AVAILABLE,
  countByStatus,
  durationParts,
  entityOptions,
  evidenceDuration,
  filterEvidence,
  filtersShowing,
  formatUnit,
  sortEvidence,
  tagOptions,
  toEvidenceView,
  typeCounts,
  type EvidenceFilters,
  type EvidenceSort,
  type EvidenceSortKey,
  type EvidenceView
} from '@shared/problem-evidence'
import {
  INITIAL_EVIDENCE_TABLE,
  evidenceTableKey,
  useEvidenceTableStore
} from '../app/evidence-table'
import { cn } from '../lib/cn'
import { dateLang } from '../lib/date-lang'
import { metricsLink } from '../lib/metrics-link'
import {
  DataGrid,
  GRID_TOOLTIP,
  type DataGridColumn,
  type DataGridHandle,
  type RowStatus
} from './DataGrid'
import { EvidenceMetricChart } from './EvidenceMetricChart'
import { BUTTON_SECONDARY, INPUT } from './styles'

/** Lo que las evidencias necesitan del problema: sus fechas y el "ahora" de sus gráficos. */
export interface ProblemContext {
  startTime: number
  endTime: number | null
  now: number
}

const GRID_COLUMNS =
  'grid grid-cols-[5.5rem_minmax(14rem,1fr)_9rem_10rem_9.5rem_9.5rem_7.5rem_12rem_5.5rem_5.5rem]'
/** Ancho mínimo de las 10 columnas: en una ventana estrecha, scroll horizontal. */
const GRID_MIN_WIDTH = 'min-w-[80rem]'
/** Etiquetas que se ven en la celda antes del "+N". */
const TAGS_IN_CELL = 2
/** Líneas del resumen de la causa raíz. */
const ROOT_SUMMARY = 3

/** Etiqueta traducida si existe (un tipo nuevo de Dynatrace se muestra tal cual). */
function useLabel(): (group: string, value: string) => string {
  const { t, i18n } = useTranslation()
  return (group, value) => (i18n.exists(`${group}.${value}`) ? t(`${group}.${value}`) : value)
}

/** Tipo de la evidencia para leerlo: el tipo de evento en EVENT; si no, el de evidencia. */
function useTypeText(): (view: EvidenceView) => string {
  const label = useLabel()
  return (view) =>
    label(view.type === 'EVENT' ? 'problems.eventTypes' : 'problems.evidenceTypes', view.typeLabel)
}

/** Duración legible ("1 h 5 min", "12 min", "40 s"). */
function useDurationText(): (ms: number) => string {
  const { t } = useTranslation()
  return (ms) => {
    const parts = durationParts(ms)
    if (parts.unit === 's') return t('problems.eventTable.seconds', { count: parts.seconds })
    if (parts.unit === 'min') return t('problems.eventTable.minutes', { count: parts.minutes })
    return t('problems.eventTable.hours', { hours: parts.hours, minutes: parts.minutes })
  }
}

/** Inicio y fin (o "Activo") de una evidencia, para el detalle. */
function Times({ view }: { view: EvidenceView }): JSX.Element {
  const { t, i18n } = useTranslation()
  const lang = dateLang(i18n.language)
  return (
    <span className="text-xs text-muted-foreground tabular-nums">
      {view.start === null ? NOT_AVAILABLE : formatDateTime(view.start, lang)}
      {' → '}
      {view.end === 'ACTIVE' ? t('problems.eventTable.active') : formatDateTime(view.end, lang)}
    </span>
  )
}

/** Tarjeta de cambio (METRIC y TRANSACTIONAL): antes → después, variación y flecha. */
function ChangeCard({
  view,
  problem
}: {
  view: EvidenceView
  problem: ProblemContext
}): JSX.Element {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const change = view.change
  const Arrow =
    change?.direction === 'up' ? ArrowUp : change?.direction === 'down' ? ArrowDown : ArrowRight
  const variation =
    change === null
      ? NOT_AVAILABLE
      : change.ratio !== null
        ? `${change.ratio >= 1 ? '+' : ''}${new Intl.NumberFormat(i18n.language, {
            maximumFractionDigits: 1
          }).format((change.ratio - 1) * 100)} %`
        : `${(change.delta ?? 0) >= 0 ? '+' : ''}${formatUnit(change.delta, view.unit, i18n.language)}`
  return (
    <div data-testid="evidence-change" className="grid gap-1">
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <p className="text-sm" tabIndex={0}>
            {t('problems.changeSentence', {
              name: view.displayName,
              entity: view.entity?.label ?? t('problems.noEntity')
            })}{' '}
            <span className="tabular-nums">
              {formatUnit(view.before, view.unit, i18n.language)}
              {' → '}
              {formatUnit(view.after, view.unit, i18n.language)}
            </span>{' '}
            {/* La flecha va siempre en el color de alerta: solo cambia la dirección. */}
            <span
              data-testid="evidence-variation"
              className="inline-flex items-center gap-0.5 text-danger tabular-nums"
            >
              {/* Sin valores no hay dirección: ni flecha ni texto, solo N/A. */}
              {change !== null && (
                <>
                  <Arrow aria-hidden="true" className="size-3.5" />
                  <span className="sr-only">
                    {t(`problems.changeDirection.${change.direction}`)}
                  </span>
                </>
              )}
              {variation}
            </span>
          </p>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content sideOffset={6} className={GRID_TOOLTIP}>
            {t('problems.changeHint')}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Times view={view} />
        {view.metricId !== null && (
          <>
            <code
              data-testid="evidence-metric-id"
              className="text-xs break-all text-muted-foreground"
            >
              {view.metricId}
            </code>
            <button
              type="button"
              data-testid="evidence-open-metrics"
              onClick={() => void navigate(metricsLink(view.metricId ?? '', problem, Date.now()))}
              className="text-xs underline underline-offset-2"
            >
              {t('problems.openInMetrics')}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

/** Detalle de un EVENT: propiedades, zonas, todas las etiquetas y el mini gráfico. */
function EventDetail({
  view,
  problem
}: {
  view: EvidenceView
  problem: ProblemContext
}): JSX.Element {
  const { t } = useTranslation()
  const properties = view.event?.properties ?? []
  const metric = view.event?.metric ?? null
  return (
    <div className="grid gap-2">
      {properties.length > 0 && (
        <section className="grid gap-0.5">
          <h4 className="text-xs font-medium text-muted-foreground">
            {t('problems.eventTable.properties')}
          </h4>
          <dl
            data-testid="evidence-properties"
            className="grid grid-cols-[auto_1fr] gap-x-3 text-xs"
          >
            {properties.map((property, index) => (
              <div key={`${index}-${property.key}`} className="contents">
                <dt className="text-muted-foreground">{property.key}</dt>
                {/* Siempre como texto. */}
                <dd className="break-all whitespace-pre-wrap">{property.text}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      {view.managementZones.length > 0 && (
        <section className="grid gap-0.5">
          <h4 className="text-xs font-medium text-muted-foreground">
            {t('problems.eventTable.zones')}
          </h4>
          <ul data-testid="evidence-zones" className="flex flex-wrap gap-1 text-xs">
            {view.managementZones.map((zone, index) => (
              <li key={`${index}-${zone}`} className="rounded-sm border border-border px-1.5">
                {zone}
              </li>
            ))}
          </ul>
        </section>
      )}
      {view.tags.length > 0 && (
        <section className="grid gap-0.5">
          <h4 className="text-xs font-medium text-muted-foreground">
            {t('problems.eventTable.tags')}
          </h4>
          <ul data-testid="evidence-all-tags" className="flex flex-wrap gap-1 text-xs">
            {view.tags.map((tag) => (
              <li key={tag} className="rounded-sm border border-border px-1.5 break-all">
                {tag}
              </li>
            ))}
          </ul>
        </section>
      )}
      {/* Eventos con dt.event.metric_selector: el mini gráfico de esa métrica. */}
      {metric?.status === 'ok' && (
        <EvidenceMetricChart
          view={view}
          selector={metric.selector}
          threshold={metric.threshold}
          problem={problem}
        />
      )}
      {metric?.status === 'tooLong' && (
        <p data-testid="evidence-metric-too-long" className="text-xs text-muted-foreground">
          {t('problems.metricTooLong')}
        </p>
      )}
    </div>
  )
}

/** Lo que va debajo de una fila desplegada, según el tipo. */
function EvidenceDetail({
  view,
  problem
}: {
  view: EvidenceView
  problem: ProblemContext
}): JSX.Element {
  const typeText = useTypeText()
  if (view.type === 'EVENT') return <EventDetail view={view} problem={problem} />
  if (view.type === 'METRIC' || view.type === 'TRANSACTIONAL') {
    return <ChangeCard view={view} problem={problem} />
  }
  return (
    <div className="flex flex-wrap items-baseline gap-x-3">
      <span className="text-sm">{view.displayName}</span>
      <span className="text-xs text-muted-foreground">{typeText(view)}</span>
      <Times view={view} />
    </div>
  )
}

/** Entidad, con su tipo en un tooltip. */
function EntityCell({ view }: { view: EvidenceView }): JSX.Element {
  const { t } = useTranslation()
  const entity = view.entity
  if (entity === null) {
    return <span className="text-muted-foreground">{t('problems.noEntity')}</span>
  }
  const name = <span className="block truncate">{entity.label}</span>
  if (entity.type === null) return name
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{name}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          data-testid="evidence-entity-tooltip"
          sideOffset={6}
          className={GRID_TOOLTIP}
        >
          {t('problems.eventTable.entityType', { type: entity.type })}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}

/** Las 2 primeras etiquetas y "+N" con todas en un tooltip. */
function TagsCell({ view }: { view: EvidenceView }): JSX.Element | null {
  const { t } = useTranslation()
  if (view.tags.length === 0) return null
  const more = view.tags.length - TAGS_IN_CELL
  return (
    <span data-testid="evidence-tags" className="flex min-w-0 items-center gap-1 text-xs">
      {view.tags.slice(0, TAGS_IN_CELL).map((tag) => (
        <span key={tag} className="truncate rounded-sm border border-border px-1">
          {tag}
        </span>
      ))}
      {more > 0 && (
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <span
              data-testid="evidence-tags-more"
              className="shrink-0 text-muted-foreground tabular-nums"
            >
              {t('problems.moreValues', { count: more })}
            </span>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content
              data-testid="evidence-tags-tooltip"
              sideOffset={6}
              className={GRID_TOOLTIP}
            >
              {view.tags.map((tag) => (
                <span key={tag} className="break-all">
                  {tag}
                </span>
              ))}
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
      )}
    </span>
  )
}

const FLAG_ICONS = { maintenance: Wrench, frequent: Repeat, suppressed: BellOff } as const

/** Indicadores (mantenimiento, frecuente, suprimido): solo los que están. */
function FlagsCell({ view }: { view: EvidenceView }): JSX.Element | null {
  const { t } = useTranslation()
  const on = (Object.keys(FLAG_ICONS) as (keyof typeof FLAG_ICONS)[]).filter(
    (flag) => view.flags[flag]
  )
  if (on.length === 0) return null
  return (
    <span data-testid="evidence-flags" className="flex items-center gap-1.5">
      {on.map((flag) => {
        const Icon = FLAG_ICONS[flag]
        const text = t(`problems.eventTable.flags.${flag}`)
        return (
          <span key={flag} data-testid={`flag-${flag}`} title={text}>
            <Icon aria-hidden="true" className="size-3.5 text-status-warning" />
            <span className="sr-only">{text}</span>
          </span>
        )
      })}
    </span>
  )
}

/**
 * Filtro de tipos: un botón que abre un menú de casillas (varias = unión), con
 * cuántas hay de cada tipo según los demás filtros. Flechas, Inicio y Fin
 * mueven el foco entre las opciones.
 */
function TypeMenu({
  options,
  selected,
  onChange
}: {
  options: { value: string; text: string; count: number }[]
  selected: readonly string[]
  onChange: (next: string[]) => void
}): JSX.Element {
  const { t } = useTranslation()
  const labelId = useId()
  const toggle = (value: string): void =>
    onChange(
      selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value]
    )
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const items = [
      ...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]')
    ]
    const current = items.indexOf(event.target as HTMLElement)
    const next =
      event.key === 'ArrowDown'
        ? current + 1
        : event.key === 'ArrowUp'
          ? current - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? items.length - 1
              : null
    if (next === null) return
    event.preventDefault()
    items[(next + items.length) % items.length]?.focus()
  }
  return (
    <div className="grid gap-1 text-xs text-muted-foreground">
      <span id={labelId}>{t('problems.eventTable.types')}</span>
      <Popover.Root>
        <Popover.Trigger
          data-testid="evidence-types"
          aria-labelledby={labelId}
          aria-haspopup="menu"
          className={`${INPUT} flex w-48 items-center justify-between gap-2 text-left text-foreground`}
        >
          <span className="truncate">
            {selected.length === 0
              ? t('problems.filters.all')
              : t('problems.eventTable.typesSelected', { count: selected.length })}
          </span>
          <ChevronDown aria-hidden="true" className="size-4 shrink-0" />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            role="menu"
            aria-labelledby={labelId}
            align="start"
            sideOffset={4}
            onKeyDown={onKeyDown}
            className="glass z-50 grid max-h-72 w-64 gap-0.5 overflow-y-auto rounded-lg p-2 text-sm"
          >
            {options.map((option) => {
              const checked = selected.includes(option.value)
              return (
                <button
                  key={option.value}
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={checked}
                  data-testid="evidence-type-option"
                  data-type={option.value}
                  onClick={() => toggle(option.value)}
                  className="flex items-center gap-2 rounded-md px-1 py-1 text-left hover:bg-hover focus-visible:bg-hover focus-visible:outline-none"
                >
                  <Check
                    aria-hidden="true"
                    className={cn('size-4 shrink-0', !checked && 'invisible')}
                  />
                  <span className="truncate">{option.text}</span>
                  <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                    {option.count}
                  </span>
                </button>
              )
            })}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  )
}

const evidenceId = (view: EvidenceView): string => view.id
const evidenceRowData = (view: EvidenceView): Record<string, string> => ({
  'data-status': view.status,
  ...(view.eventId === null ? {} : { 'data-event-id': view.eventId })
})

/**
 * Evidencias del problema como tabla (el mismo grid que la lista de
 * Problemas): estado propio de cada evento, abiertos primero, filtros con
 * contadores y filas que se despliegan con el detalle. Filtros, orden y filas
 * desplegadas se recuerdan por entorno y problema (ver evidence-table). Todo
 * el texto de Dynatrace va como texto.
 */
export function EvidenceSection({
  envId,
  detail,
  now
}: {
  envId: string
  detail: ProblemDetail
  /** "Ahora" del problema: duración de lo activo y mini gráficos (ver useProblemClock). */
  now: number
}): JSX.Element {
  const { t, i18n } = useTranslation()
  const lang = dateLang(i18n.language)
  const typeText = useTypeText()
  const durationText = useDurationText()
  const searchId = useId()
  const entityId = useId()
  const tagId = useId()

  const key = evidenceTableKey(envId, detail.problemId)
  const table = useEvidenceTableStore((state) => state.tables[key]) ?? INITIAL_EVIDENCE_TABLE
  const touch = useEvidenceTableStore((state) => state.touch)
  const update = useEvidenceTableStore((state) => state.update)
  const toggleExpanded = useEvidenceTableStore((state) => state.toggleExpanded)
  useEffect(() => touch(key), [touch, key])
  const { filters, sort, expanded } = table
  const setFilters = (next: Partial<EvidenceFilters>): void =>
    update(key, { filters: { ...filters, ...next } })

  const views = useMemo(
    () => detail.evidence.map((evidence, index) => toEvidenceView(evidence, index)),
    [detail.evidence]
  )
  const rows = useMemo(
    () => sortEvidence(filterEvidence(views, filters), sort, i18n.language, now),
    [views, filters, sort, i18n.language, now]
  )
  const counts = useMemo(() => countByStatus(views, filters), [views, filters])
  const types = useMemo(() => typeCounts(views, filters), [views, filters])
  const entities = useMemo(() => entityOptions(views, i18n.language), [views, i18n.language])
  const tags = useMemo(() => tagOptions(views, i18n.language), [views, i18n.language])
  const roots = useMemo(
    () =>
      sortEvidence(
        views.filter((view) => view.rootCause),
        DEFAULT_EVIDENCE_SORT,
        i18n.language,
        now
      ),
    [views, i18n.language, now]
  )
  const problem = useMemo(
    () => ({ startTime: detail.startTime, endTime: detail.endTime, now }),
    [detail.startTime, detail.endTime, now]
  )
  // Contra lo que mandó la API: una evidencia ilegible no es un recorte (se avisa aparte).
  const truncated = detail.evidenceTotal !== null && detail.evidenceTotal > detail.evidenceReceived

  // Salto desde el resumen de la causa raíz: cuando la fila ya está en la tabla
  // (tras quitar los filtros que la ocultaban), se lleva a la vista y se enfoca.
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const gridRef = useRef<DataGridHandle | null>(null)
  const pendingJump = useRef<string | null>(null)
  useEffect(() => {
    const id = pendingJump.current
    if (id !== null && rows.some((row) => row.id === id)) {
      pendingJump.current = null
      gridRef.current?.focusRow(id)
    }
  })
  const jumpTo = (view: EvidenceView): void => {
    pendingJump.current = view.id
    update(key, {
      filters: filtersShowing(filters, view),
      expanded: expanded.includes(view.id) ? expanded : [...expanded, view.id]
    })
  }

  const status = (view: EvidenceView): RowStatus => ({
    open: view.status === 'OPEN',
    value: view.status,
    label: t(`problems.status.${view.status}`)
  })

  // tags y flags no ordenan: sus ids no son claves de orden.
  const columns: DataGridColumn<EvidenceView, EvidenceSortKey | 'tags' | 'flags'>[] = [
    {
      id: 'status',
      header: t('problems.eventTable.columns.status'),
      headerClassName: 'pr-2 pl-4',
      className: 'py-2 pr-2 pl-4 text-xs',
      sortable: 'asc',
      cell: (view) => (
        <span
          data-testid="evidence-status"
          data-status={view.status}
          className={cn(
            'font-medium',
            view.status === 'OPEN' ? 'text-status-open' : 'text-muted-foreground'
          )}
        >
          {t(`problems.status.${view.status}`)}
        </span>
      )
    },
    {
      id: 'title',
      header: t('problems.eventTable.columns.title'),
      className: 'truncate px-2 py-2',
      sortable: 'asc',
      cellTitle: (view) => view.title,
      cell: (view) => view.title
    },
    {
      id: 'type',
      header: t('problems.eventTable.columns.type'),
      className: 'truncate px-2 py-2 text-xs text-muted-foreground',
      sortable: 'asc',
      cell: (view) => typeText(view)
    },
    {
      id: 'entity',
      header: t('problems.eventTable.columns.entity'),
      className: 'min-w-0 px-2 py-2',
      sortable: 'asc',
      cell: (view) => <EntityCell view={view} />
    },
    {
      id: 'start',
      header: t('problems.eventTable.columns.start'),
      className: 'px-2 py-2 text-xs whitespace-nowrap text-muted-foreground tabular-nums',
      sortable: 'desc',
      cell: (view) => (view.start === null ? NOT_AVAILABLE : formatDateTime(view.start, lang))
    },
    {
      id: 'end',
      header: t('problems.eventTable.columns.end'),
      className: 'px-2 py-2 text-xs whitespace-nowrap text-muted-foreground tabular-nums',
      sortable: 'desc',
      cell: (view) => (
        <span data-testid="evidence-end">
          {view.end === 'ACTIVE' ? t('problems.eventTable.active') : formatDateTime(view.end, lang)}
        </span>
      )
    },
    {
      id: 'duration',
      header: t('problems.eventTable.columns.duration'),
      className: 'px-2 py-2 text-xs whitespace-nowrap tabular-nums',
      sortable: 'desc',
      cell: (view) => {
        const ms = evidenceDuration(view, now)
        return (
          <span data-testid="evidence-duration">
            {view.end === 'ACTIVE'
              ? t('problems.eventTable.ongoing')
              : ms === null
                ? NOT_AVAILABLE
                : durationText(ms)}
          </span>
        )
      }
    },
    {
      id: 'tags',
      header: t('problems.eventTable.columns.tags'),
      className: 'min-w-0 px-2 py-2',
      cell: (view) => <TagsCell view={view} />
    },
    {
      id: 'rootCause',
      header: t('problems.eventTable.columns.rootCause'),
      className: 'px-2 py-2 text-xs',
      sortable: 'desc',
      cell: (view) => (
        <span data-testid="evidence-root" className="font-medium text-danger">
          {view.rootCause ? t('problems.eventTable.yes') : ''}
        </span>
      )
    },
    {
      id: 'flags',
      header: t('problems.eventTable.columns.flags'),
      className: 'px-2 py-2',
      cell: (view) => <FlagsCell view={view} />
    }
  ]

  const statusButtons = [
    { value: 'ALL', label: t('problems.eventTable.statusAll'), count: counts.all },
    { value: 'OPEN', label: t('problems.eventTable.statusOpen'), count: counts.open },
    { value: 'CLOSED', label: t('problems.eventTable.statusClosed'), count: counts.closed }
  ] as const

  return (
    <div className="grid gap-3">
      {truncated && (
        <p
          data-testid="evidence-api-truncated"
          role="status"
          className="text-xs text-status-warning"
        >
          {t('problems.apiTruncatedEvidence', {
            shown: detail.evidenceReceived,
            total: detail.evidenceTotal
          })}
        </p>
      )}

      {roots.length > 0 && (
        <div
          data-testid="root-cause-summary"
          className="grid gap-1 rounded-lg border border-danger/40 px-3 py-2"
        >
          <h3 className="text-xs font-semibold text-danger">
            {t('problems.eventTable.rootSummary')}
          </h3>
          <ul className="grid gap-0.5">
            {roots.slice(0, ROOT_SUMMARY).map((view) => (
              <li key={view.id}>
                <button
                  type="button"
                  data-testid="root-cause-link"
                  data-id={view.id}
                  onClick={() => jumpTo(view)}
                  className="max-w-full truncate text-left text-sm underline-offset-2 hover:underline"
                >
                  {view.title}
                  <span className="ml-2 text-xs text-muted-foreground">
                    {view.entity?.label ?? t('problems.noEntity')}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {roots.length > ROOT_SUMMARY && (
            <p className="text-xs text-muted-foreground">
              {t('problems.eventTable.rootMore', { count: roots.length - ROOT_SUMMARY })}
            </p>
          )}
        </div>
      )}

      <div
        role="group"
        aria-label={t('problems.eventTable.filters')}
        className="flex flex-wrap items-end gap-3"
      >
        <div
          role="group"
          aria-label={t('problems.eventTable.statusFilter')}
          className="flex overflow-hidden rounded-md border border-border text-xs"
        >
          {statusButtons.map((button) => (
            <button
              key={button.value}
              type="button"
              data-testid={`evidence-status-${button.value}`}
              data-count={button.count}
              aria-pressed={filters.status === button.value}
              onClick={() => setFilters({ status: button.value })}
              className={cn(
                'px-2.5 py-1.5',
                filters.status === button.value
                  ? 'bg-active text-foreground'
                  : 'text-muted-foreground hover:bg-hover'
              )}
            >
              {button.label} <span className="tabular-nums">{button.count}</span>
            </button>
          ))}
        </div>
        <div className="grid gap-1 text-xs text-muted-foreground">
          <label htmlFor={searchId}>{t('problems.eventTable.search')}</label>
          <input
            id={searchId}
            type="search"
            data-testid="evidence-search"
            value={filters.text}
            onChange={(event) => setFilters({ text: event.target.value })}
            className={`${INPUT} w-56 text-foreground`}
          />
        </div>
        <TypeMenu
          // Los marcados siguen en el menú aunque los otros filtros los dejen en 0.
          options={[...new Set([...Object.keys(types), ...filters.types])]
            .map((type) => {
              const sample = views.find((view) => view.typeLabel === type)
              const text = sample === undefined ? type : typeText(sample)
              return { value: type, text, count: types[type] ?? 0 }
            })
            .sort((a, b) => a.text.localeCompare(b.text, i18n.language))}
          selected={filters.types}
          onChange={(next) => setFilters({ types: next })}
        />
        <div className="grid gap-1 text-xs text-muted-foreground">
          <label htmlFor={entityId}>{t('problems.eventTable.entityFilter')}</label>
          <select
            id={entityId}
            data-testid="evidence-entity"
            value={filters.entity ?? ''}
            onChange={(event) => setFilters({ entity: event.target.value || null })}
            className={`${INPUT} w-48 text-foreground`}
          >
            <option value="">{t('problems.eventTable.allEntities')}</option>
            {entities.map((entity) => (
              <option key={entity.id} value={entity.id}>
                {entity.label}
              </option>
            ))}
          </select>
        </div>
        {tags.length > 0 && (
          <div className="grid gap-1 text-xs text-muted-foreground">
            <label htmlFor={tagId}>{t('problems.eventTable.tagFilter')}</label>
            <select
              id={tagId}
              data-testid="evidence-tag"
              value={filters.tag ?? ''}
              onChange={(event) => setFilters({ tag: event.target.value || null })}
              className={`${INPUT} w-48 text-foreground`}
            >
              <option value="">{t('problems.eventTable.allTags')}</option>
              {tags.map((tag) => (
                <option key={tag} value={tag}>
                  {tag}
                </option>
              ))}
            </select>
          </div>
        )}
        <label className="flex items-center gap-2 py-1.5 text-xs">
          <input
            type="checkbox"
            data-testid="evidence-root-only"
            checked={filters.rootCauseOnly}
            onChange={(event) => setFilters({ rootCauseOnly: event.target.checked })}
            className="size-4 accent-[var(--accent)]"
          />
          {t('problems.eventTable.rootOnly')}
        </label>
      </div>

      {rows.length === 0 ? (
        <div data-testid="evidence-empty" className="grid justify-items-start gap-2 py-2">
          <p className="text-sm text-muted-foreground">{t('problems.eventTable.empty')}</p>
          <button
            type="button"
            data-testid="evidence-clear-filters"
            onClick={() => update(key, { filters: EMPTY_EVIDENCE_FILTERS })}
            className={BUTTON_SECONDARY}
          >
            {t('problems.eventTable.clearFilters')}
          </button>
        </div>
      ) : (
        <DataGrid
          items={rows}
          getId={evidenceId}
          columns={columns}
          gridTemplate={GRID_COLUMNS}
          className={GRID_MIN_WIDTH}
          sort={sort}
          // Solo ordenan las columnas con `sortable`, todas con clave de EvidenceSortKey.
          onSortChange={(next) => update(key, { sort: next as EvidenceSort })}
          status={status}
          onActivate={(view) => toggleExpanded(key, view.id)}
          selected={null}
          rowTestId="evidence-row"
          rowData={evidenceRowData}
          gridTestId="evidence-grid"
          scrollTestId="evidence-scroll"
          ariaLabel={t('problems.eventTable.label')}
          scrollRef={scrollRef}
          handleRef={gridRef}
          detail={{
            expanded,
            testId: 'evidence-detail',
            onCollapse: (view) => toggleExpanded(key, view.id),
            render: (view) => <EvidenceDetail view={view} problem={problem} />
          }}
        />
      )}
    </div>
  )
}
