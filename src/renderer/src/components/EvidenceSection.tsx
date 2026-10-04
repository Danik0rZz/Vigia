import { useMemo, useState, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import * as Tooltip from '@radix-ui/react-tooltip'
import { ArrowDown, ArrowRight, ArrowUp, ChevronDown, ChevronRight } from 'lucide-react'
import { formatDateTime } from '@shared/format-date'
import type { ProblemDetail } from '@shared/modules'
import {
  countByType,
  formatUnit,
  groupEvidence,
  NOT_AVAILABLE,
  toEvidenceView,
  type EntityLabel,
  type EvidenceView
} from '@shared/problem-evidence'
import { cn } from '../lib/cn'
import { dateLang } from '../lib/date-lang'
import { metricsLink } from '../lib/metrics-link'
import { EvidenceMetricChart } from './EvidenceMetricChart'
import { BUTTON_SECONDARY } from './styles'

/** Lo que las evidencias necesitan del problema: sus fechas y el "ahora" de sus gráficos. */
export interface ProblemContext {
  startTime: number
  endTime: number | null
  now: number
}

/** Evidencias que se ven de cada grupo antes de pulsar "Ver todas". */
const GROUP_PREVIEW = 50
const TOOLTIP = 'glass z-50 max-w-80 rounded-md px-3 py-2 text-xs text-foreground shadow-md'

/** Etiqueta traducida si existe (un tipo nuevo de Dynatrace se muestra tal cual). */
function useLabel(): (group: string, value: string) => string {
  const { t, i18n } = useTranslation()
  return (group, value) => (i18n.exists(`${group}.${value}`) ? t(`${group}.${value}`) : value)
}

function EntityName({ entity }: { entity: EntityLabel | null }): JSX.Element {
  const { t } = useTranslation()
  if (entity === null) return <span>{t('problems.noEntity')}</span>
  return (
    <span>
      {entity.label}
      {entity.type !== null && (
        <span className="ml-1.5 text-xs text-muted-foreground">{entity.type}</span>
      )}
    </span>
  )
}

/** Inicio y fin (o "Activa") de una evidencia. */
function Times({ view }: { view: EvidenceView }): JSX.Element {
  const { t, i18n } = useTranslation()
  const lang = dateLang(i18n.language)
  return (
    <span className="text-xs text-muted-foreground tabular-nums">
      {view.start === null ? NOT_AVAILABLE : formatDateTime(view.start, lang)}
      {' → '}
      {view.end === 'ACTIVE' ? t('problems.evidenceActive') : formatDateTime(view.end, lang)}
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
          <Tooltip.Content sideOffset={6} className={TOOLTIP}>
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

/** Evidencia de tipo EVENT: tipo de evento, fechas y "Más detalles" con sus propiedades. */
function EventItem({
  view,
  problem
}: {
  view: EvidenceView
  problem: ProblemContext
}): JSX.Element {
  const { t } = useTranslation()
  const label = useLabel()
  const [open, setOpen] = useState(false)
  const properties = view.event?.properties ?? []
  const metric = view.event?.metric ?? null
  return (
    <div className="grid gap-1">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <span className="text-sm">{view.displayName}</span>
        {view.event?.eventType !== null && view.event?.eventType !== undefined && (
          <span className="text-xs text-muted-foreground">
            {label('problems.eventTypes', view.event.eventType)}
          </span>
        )}
        <Times view={view} />
      </div>
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
      {properties.length > 0 && (
        <>
          <button
            type="button"
            data-testid="evidence-more"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            className="justify-self-start text-xs underline underline-offset-2"
          >
            {t(open ? 'problems.lessDetails' : 'problems.moreDetails')}
          </button>
          {open && (
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
          )}
        </>
      )}
    </div>
  )
}

/** Una evidencia, según su tipo. */
function EvidenceItem({
  view,
  problem
}: {
  view: EvidenceView
  problem: ProblemContext
}): JSX.Element {
  const label = useLabel()
  let body: JSX.Element
  if (view.type === 'EVENT') body = <EventItem view={view} problem={problem} />
  else if (view.type === 'METRIC' || view.type === 'TRANSACTIONAL') {
    body = <ChangeCard view={view} problem={problem} />
  } else {
    body = (
      <div className="flex flex-wrap items-baseline gap-x-3">
        <span className="text-sm">{view.displayName}</span>
        <span className="text-xs text-muted-foreground">
          {label('problems.evidenceTypes', view.type)}
        </span>
        <Times view={view} />
      </div>
    )
  }
  return (
    <li data-testid="evidence-item" data-type={view.type} className="border-t border-border pt-1.5">
      {body}
    </li>
  )
}

/** Lista de evidencias de 50 en 50, con "Ver todas". */
function EvidenceList({
  items,
  problem
}: {
  items: EvidenceView[]
  problem: ProblemContext
}): JSX.Element {
  const { t } = useTranslation()
  const [all, setAll] = useState(false)
  const shown = all ? items : items.slice(0, GROUP_PREVIEW)
  return (
    <>
      <ul className="grid gap-1.5">
        {shown.map((view, index) => (
          <EvidenceItem key={index} view={view} problem={problem} />
        ))}
      </ul>
      {!all && items.length > GROUP_PREVIEW && (
        <button
          type="button"
          data-testid="evidence-show-all"
          onClick={() => setAll(true)}
          className={`${BUTTON_SECONDARY} justify-self-start`}
        >
          {t('problems.showAllEvidence', { count: items.length })}
        </button>
      )}
    </>
  )
}

/** Grupo de una entidad, plegable. */
function EntityGroup({
  entity,
  items,
  problem
}: {
  entity: EntityLabel | null
  items: EvidenceView[]
  problem: ProblemContext
}): JSX.Element {
  const [open, setOpen] = useState(true)
  const Chevron = open ? ChevronDown : ChevronRight
  return (
    <div data-testid="evidence-group" data-entity-id={entity?.id ?? ''} className="grid gap-1">
      <button
        type="button"
        data-testid="evidence-group-toggle"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-left text-sm font-medium"
      >
        <Chevron aria-hidden="true" className="size-4" />
        <EntityName entity={entity} />
        <span className="ml-1 text-xs text-muted-foreground tabular-nums">({items.length})</span>
      </button>
      {open && <EvidenceList items={items} problem={problem} />}
    </div>
  )
}

/**
 * Evidencias del problema: filtros por tipo (con su contador sobre todas las
 * recibidas), la causa raíz arriba y el resto por entidad, cada grupo en orden
 * cronológico. Todo el texto de Dynatrace va como texto.
 */
export function EvidenceSection({
  detail,
  now
}: {
  detail: ProblemDetail
  /** "Ahora" de los mini gráficos de este problema (ver useProblemClock). */
  now: number
}): JSX.Element {
  const { t } = useTranslation()
  const label = useLabel()
  const views = useMemo(() => detail.evidence.map(toEvidenceView), [detail.evidence])
  const counts = useMemo(() => countByType(views), [views])
  const [types, setTypes] = useState<string[]>([])
  const grouped = useMemo(
    () => groupEvidence(types.length === 0 ? views : views.filter((v) => types.includes(v.type))),
    [views, types]
  )
  const problem = useMemo(
    () => ({ startTime: detail.startTime, endTime: detail.endTime, now }),
    [detail.startTime, detail.endTime, now]
  )
  // Contra lo que mandó la API: una evidencia ilegible no es un recorte (se avisa aparte).
  const truncated = detail.evidenceTotal !== null && detail.evidenceTotal > detail.evidenceReceived

  const toggle = (type: string): void =>
    setTypes(types.includes(type) ? types.filter((item) => item !== type) : [...types, type])

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
      <div
        role="group"
        aria-label={t('problems.evidenceFilter')}
        className="flex flex-wrap gap-1.5"
      >
        {Object.entries(counts).map(([type, count]) => (
          <button
            key={type}
            type="button"
            data-testid="evidence-filter"
            data-type={type}
            aria-pressed={types.includes(type)}
            onClick={() => toggle(type)}
            className={cn(
              'rounded-full border border-border px-2.5 py-0.5 text-xs',
              types.includes(type)
                ? 'bg-active text-foreground'
                : 'text-muted-foreground hover:bg-hover'
            )}
          >
            {label('problems.evidenceTypes', type)} <span className="tabular-nums">{count}</span>
          </button>
        ))}
      </div>

      {grouped.rootCause.length > 0 && (
        <div
          data-testid="evidence-root-cause"
          className="grid gap-1 rounded-lg border border-danger/40 p-3"
        >
          <h3 className="text-sm font-semibold">{t('problems.rootCause')}</h3>
          <EvidenceList items={grouped.rootCause} problem={problem} />
        </div>
      )}

      {grouped.byEntity.map((group) => (
        <EntityGroup
          key={group.entity?.id ?? ''}
          entity={group.entity}
          items={group.items}
          problem={problem}
        />
      ))}
    </div>
  )
}
