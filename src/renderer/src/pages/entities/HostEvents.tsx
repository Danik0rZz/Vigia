import type { JSX, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { UseQueryResult } from '@tanstack/react-query'
import type { HostEvent, HostEventsResult } from '@shared/modules'
import { formatDateTime } from '@shared/format-date'
import { entityPath, type EntityLocationState } from '../../app/entity-route'
import { ModuleUnavailable } from '../../components/ModuleState'
import type { ModuleAccess } from '../../data/modules'
import { cn } from '../../lib/cn'
import { dateLang } from '../../lib/date-lang'
import { MarkerError, MarkerSkeleton } from './EntityMarkers'
import { hasEntityPage } from './entity-page-types'

/*
 * Tarjeta «Eventos» de la página de un HOST (ficha 0042, canal `entities:hostEvents`), antes de
 * «Información»: los 20 eventos más recientes del rango del host y de lo que corre en él, con el
 * tipo, el título, la entidad (enlace si su tipo tiene página), el inicio, el fin o «Activo» y el
 * estado; «20 de N» si hay más. Los títulos son texto del tenant: se pintan como texto, nunca
 * como HTML. Sin `events.read` (o sin `entities.read`), el aviso del scope; si falla, el aviso
 * con Reintentar y lo demás de la página sigue.
 */

const ROW_GRID =
  'grid grid-cols-[minmax(7rem,9rem)_minmax(10rem,1fr)_minmax(8rem,12rem)_8.5rem_8.5rem_6rem] items-center gap-2'

/** Estados de Dynatrace con texto propio; otro valor se enseña tal cual. */
const KNOWN_STATUS = new Set(['OPEN', 'CLOSED'])

export function HostEvents({
  access,
  events
}: {
  access: ModuleAccess
  events: UseQueryResult<HostEventsResult>
}): JSX.Element | null {
  const { t } = useTranslation()
  // Sin entorno o sin token clásico, nada: ese aviso ya lo da la página.
  if (!access.available && access.reason !== 'missingScope') return null

  let body: ReactNode
  if (!access.available) body = <ModuleUnavailable access={access} />
  else if (events.isError) {
    body = (
      <MarkerError
        error={events.error}
        busy={events.isFetching}
        onRetry={() => void events.refetch()}
      />
    )
  } else if (events.data === undefined) body = <MarkerSkeleton />
  else body = <EventsContent data={events.data} />

  return (
    <section
      data-testid="host-events"
      aria-label={t('entities.host.events.label')}
      className="glass grid min-w-0 content-start gap-3 rounded-xl p-4"
    >
      <h2 className="text-sm font-semibold">{t('entities.host.events.title')}</h2>
      {body}
    </section>
  )
}

function EventsContent({ data }: { data: HostEventsResult }): JSX.Element {
  const { t } = useTranslation()
  if (data.events.length === 0) {
    return (
      <p data-testid="host-events-empty" className="text-sm text-muted-foreground">
        {t('entities.host.events.empty')}
      </p>
    )
  }
  const header = (key: string): string => t(`entities.host.events.columns.${key}`)
  return (
    <>
      {data.totalCount > data.events.length && (
        <p data-testid="host-events-summary" className="text-sm text-muted-foreground">
          {t('entities.host.events.summary', {
            shown: data.events.length,
            count: data.totalCount
          })}
        </p>
      )}
      <div className="overflow-x-auto">
        <div role="table" aria-label={t('entities.host.events.label')} className="min-w-[48rem]">
          <div
            role="row"
            className={cn(
              ROW_GRID,
              'border-b border-border px-2 pb-1.5 text-xs text-muted-foreground'
            )}
          >
            <span role="columnheader">{header('type')}</span>
            <span role="columnheader">{header('title')}</span>
            <span role="columnheader">{header('entity')}</span>
            <span role="columnheader">{header('start')}</span>
            <span role="columnheader">{header('end')}</span>
            <span role="columnheader">{header('status')}</span>
          </div>
          {/* Ya vienen del más reciente al más antiguo (main los ordena). */}
          {data.events.map((event, index) => (
            <EventRow key={`${event.entity.id}-${event.startTime}-${index}`} event={event} />
          ))}
        </div>
      </div>
    </>
  )
}

function EventRow({ event }: { event: HostEvent }): JSX.Element {
  const { t, i18n } = useTranslation()
  const lang = dateLang(i18n.language)
  const open = event.status === 'OPEN'
  return (
    <div
      role="row"
      data-testid="host-event-row"
      className={cn(ROW_GRID, 'border-b border-border/50 px-2 py-2 text-sm last:border-b-0')}
    >
      <span role="cell" className="min-w-0">
        <span
          data-testid="host-event-type"
          title={event.eventType}
          className="inline-block max-w-full truncate rounded-full border border-border bg-hover px-2 py-0.5 font-mono text-xs"
        >
          {event.eventType}
        </span>
      </span>
      {/* Texto del tenant: como texto (React lo escapa), nunca como HTML. */}
      <span role="cell" data-testid="host-event-title" className="min-w-0 wrap-anywhere">
        {event.title}
      </span>
      <span role="cell" data-testid="host-event-entity" className="min-w-0">
        <EventEntity entity={event.entity} />
      </span>
      <span role="cell" data-testid="host-event-start" className="whitespace-nowrap tabular-nums">
        {formatDateTime(event.startTime, lang)}
      </span>
      <span
        role="cell"
        data-testid="host-event-end"
        className={cn(
          'whitespace-nowrap tabular-nums',
          event.endTime === null && 'font-medium text-status-warning'
        )}
      >
        {event.endTime === null
          ? t('entities.host.events.active')
          : formatDateTime(event.endTime, lang)}
      </span>
      <span
        role="cell"
        data-testid="host-event-status"
        data-status={event.status}
        className={cn('font-medium', open ? 'text-status-warning' : 'text-muted-foreground')}
      >
        {KNOWN_STATUS.has(event.status)
          ? t(`entities.host.events.status.${event.status}`)
          : event.status}
      </span>
    </div>
  )
}

function EventEntity({ entity }: { entity: HostEvent['entity'] }): JSX.Element {
  const name = entity.name ?? entity.id
  if (!hasEntityPage(entity.type)) {
    return (
      <span title={entity.id} className="block truncate">
        {name}
      </span>
    )
  }
  // Con `fromProblem`, «Volver» va atrás en el historial: el host no se vuelve a pedir.
  const state: EntityLocationState = {
    fromProblem: true,
    ...(entity.name !== null ? { name: entity.name } : {})
  }
  return (
    <Link
      to={entityPath(entity.type, entity.id)}
      state={state}
      title={entity.id}
      className="block truncate rounded-sm font-medium underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-[var(--ring)]"
    >
      {name}
    </Link>
  )
}
