import { useState, type JSX, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { ChevronRight } from 'lucide-react'
import type { UseQueryResult } from '@tanstack/react-query'
import { MAX_ENTITY_IDS, entityIdSchema, entityTypeOf, type EntityData } from '@shared/modules'
import { formatNumber } from '@shared/format-number'
import { entityPath, type EntityLocationState } from '../../app/entity-route'
import { ModuleUnavailable } from '../../components/ModuleState'
import { BUTTON_SECONDARY } from '../../components/styles'
import { useEntityNames, type ModuleAccess } from '../../data/modules'
import { cn } from '../../lib/cn'
import { MarkerError } from './EntityMarkers'
import type { RelatedEntity, RelationGroup } from './service-info'

/**
 * Piezas comunes de la tarjeta «Información» de una entidad: la del servicio (ficha 0015), la
 * del host (ficha 0020), la de los monitores (ficha 0026) y la del proceso (ficha 0029). Cada
 * tarjeta pone sus filas; aquí van el marco (aviso del scope, error y esqueleto), los chips, las
 * relaciones con «Ver nombres» a demanda y «Todas las propiedades». `prefix` da los `data-testid`
 * (`service-info`, `host-info`, `monitor-info`, `process-info`, `process-group-info`,
 * `application-info`). Todo lo del tenant se pinta como texto, nunca como HTML. Los textos
 * comunes siguen en `entities.service.info`.
 */
export type InfoPrefix =
  | 'service-info'
  | 'host-info'
  | 'monitor-info'
  | 'process-info'
  | 'process-group-info'
  | 'application-info'
  | 'disk-info'

/**
 * Marco de la tarjeta, entre la cabecera y los marcadores. Sin `entities.read`, el aviso del
 * scope que falta; sin entorno o sin token clásico, nada: ese aviso ya lo da la página.
 */
export function EntityInfoCard({
  prefix,
  label,
  access,
  info,
  children
}: {
  prefix: InfoPrefix
  label: string
  access: ModuleAccess
  info: UseQueryResult<EntityData>
  children: (data: EntityData, envId: string) => ReactNode
}): JSX.Element | null {
  const { t } = useTranslation()
  if (!access.available && access.reason !== 'missingScope') return null

  let body: ReactNode
  if (!access.available) body = <ModuleUnavailable access={access} />
  else if (info.isError) {
    body = (
      <MarkerError error={info.error} busy={info.isFetching} onRetry={() => void info.refetch()} />
    )
  } else if (info.data === undefined) body = <InfoSkeleton />
  else body = children(info.data, access.envId)

  return (
    <section
      data-testid={prefix}
      aria-label={label}
      className="glass grid min-w-0 gap-4 rounded-xl p-5"
    >
      <h2 className="text-sm font-semibold">{t('entities.service.info.title')}</h2>
      {body}
    </section>
  )
}

function InfoSkeleton(): JSX.Element {
  const { t } = useTranslation()
  return (
    <div
      role="status"
      aria-label={t('entities.service.info.loading')}
      className="grid gap-2 min-[990px]:grid-cols-2"
    >
      {[0, 1].map((column) => (
        <div key={column} className="grid content-start gap-2">
          <span className="h-4 w-24 rounded bg-hover motion-safe:animate-pulse" />
          <span className="h-3 w-3/4 rounded bg-hover motion-safe:animate-pulse" />
          <span className="h-3 w-2/3 rounded bg-hover motion-safe:animate-pulse" />
          <span className="h-3 w-1/2 rounded bg-hover motion-safe:animate-pulse" />
        </div>
      ))}
    </div>
  )
}

export function ColumnTitle({ children }: { children: string }): JSX.Element {
  return (
    <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
      {children}
    </h3>
  )
}

/** Filas de dato y valor, con los `data-testid` de la tarjeta (`*-row`, `*-value`). */
export function InfoRows({
  prefix,
  rows
}: {
  prefix: InfoPrefix
  rows: { key: string; label: string; value: ReactNode }[]
}): JSX.Element {
  return (
    <dl className="grid gap-1.5 text-sm">
      {rows.map((row) => (
        <div
          key={row.key}
          data-testid={`${prefix}-row`}
          data-key={row.key}
          className="grid grid-cols-[minmax(7rem,11rem)_minmax(0,1fr)] gap-x-3"
        >
          <dt className="text-muted-foreground">{row.label}</dt>
          <dd data-testid={`${prefix}-value`} className="min-w-0 wrap-anywhere">
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}

export function Chips({
  prefix,
  values,
  children
}: {
  prefix: InfoPrefix
  values: string[]
  children?: ReactNode
}): JSX.Element {
  return (
    <ul className="flex flex-wrap gap-1">
      {values.map((value, index) => (
        <li
          key={`${index}-${value}`}
          data-testid={`${prefix}-chip`}
          className="rounded-md border border-border px-1.5 py-0.5 text-xs wrap-anywhere"
        >
          {value}
        </li>
      ))}
      {children}
    </ul>
  )
}

/** Los `visible` primeros chips y «+N», que despliega el resto. */
export function CollapsedChips({
  prefix,
  values,
  visible,
  moreTestId,
  moreLabel
}: {
  prefix: InfoPrefix
  values: string[]
  visible: number
  moreTestId: string
  moreLabel: (count: number) => string
}): JSX.Element {
  const { i18n } = useTranslation()
  const [all, setAll] = useState(false)
  const hidden = values.length - visible
  const shown = all || hidden <= 0 ? values : values.slice(0, visible)
  return (
    <Chips prefix={prefix} values={shown}>
      {!all && hidden > 0 && (
        <li>
          <button
            type="button"
            data-testid={moreTestId}
            aria-label={moreLabel(hidden)}
            onClick={() => setAll(true)}
            className="rounded-md border border-border px-1.5 py-0.5 text-xs hover:bg-hover"
          >
            {`+${formatNumber(hidden, i18n.language)}`}
          </button>
        </li>
      )}
    </Chips>
  )
}

export function RelationsColumn<K extends string>({
  prefix,
  groups,
  envId,
  groupLabel
}: {
  prefix: InfoPrefix
  groups: RelationGroup<K>[]
  envId: string
  groupLabel: (key: K) => string
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <section data-testid={`${prefix}-relations`} className="grid min-w-0 content-start gap-2">
      <ColumnTitle>{t('entities.service.info.relations')}</ColumnTitle>
      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('entities.service.info.noRelations')}</p>
      ) : (
        <div className="grid gap-1">
          {groups.map((group) => (
            <RelationGroupView
              key={group.key}
              prefix={prefix}
              group={group}
              label={groupLabel(group.key)}
              envId={envId}
            />
          ))}
        </div>
      )}
    </section>
  )
}

/**
 * Lotes de `entities:names` de un grupo: los ids de formato estándar, sin repetir, por tipo y de
 * 50 en 50 (la API rechaza tipos mezclados). Los de otro formato no se piden: quedan «sin nombre».
 */
function nameBatches(entities: RelatedEntity[]): string[][] {
  const byType = new Map<string, string[]>()
  for (const { id } of entities) {
    if (!entityIdSchema.safeParse(id).success) continue
    const ids = byType.get(entityTypeOf(id)) ?? []
    if (!ids.includes(id)) ids.push(id)
    byType.set(entityTypeOf(id), ids)
  }
  const batches: string[][] = []
  for (const ids of byType.values()) {
    for (let start = 0; start < ids.length; start += MAX_ENTITY_IDS) {
      batches.push(ids.slice(start, start + MAX_ENTITY_IDS))
    }
  }
  return batches
}

/**
 * Un grupo de relaciones: plegado, con su número; desplegado, la lista (tipo, nombre si se
 * conoce e id) con «Ver nombres». Los nombres solo se piden al pulsarlo.
 */
function RelationGroupView({
  prefix,
  group,
  label,
  envId
}: {
  prefix: InfoPrefix
  group: RelationGroup<string>
  label: string
  envId: string
}): JSX.Element {
  const { t, i18n } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const [namesRequested, setNamesRequested] = useState(false)
  const batches = nameBatches(group.entities)
  const names = useEntityNames(envId, batches, namesRequested)
  const listId = `${prefix}-group-${group.key}`

  const resolved = new Map<string, string>()
  for (const query of names) {
    for (const entry of query.data?.names ?? []) {
      resolved.set(entry.id, entry.name)
    }
  }
  const failed = names.filter((query) => query.isError)
  const loading = namesRequested && names.some((query) => query.isFetching)
  const namesDone = namesRequested && names.every((query) => query.isSuccess)

  return (
    <div data-testid={`${prefix}-group`} data-group={group.key} className="grid gap-1">
      <button
        type="button"
        data-testid={`${prefix}-group-toggle`}
        aria-expanded={expanded}
        aria-controls={listId}
        onClick={() => setExpanded((value) => !value)}
        className="flex items-center gap-2 rounded-md px-1 py-1 text-left text-sm hover:bg-hover"
      >
        <ChevronRight
          aria-hidden="true"
          className={cn(
            'size-4 shrink-0 transition-transform duration-(--motion-duration)',
            expanded && 'rotate-90'
          )}
        />
        <span className="font-medium">{label}</span>
        <span
          data-testid={`${prefix}-group-count`}
          className="rounded-md bg-hover px-1.5 text-xs tabular-nums"
        >
          {formatNumber(group.total, i18n.language)}
        </span>
      </button>
      {expanded && (
        <div id={listId} className="grid gap-2 pb-2 pl-7">
          <ul className="grid gap-1">
            {group.entities.map((entity, index) => (
              <li key={`${entity.direction}-${entity.relation}-${entity.id}-${index}`}>
                <EntityLink
                  prefix={prefix}
                  entity={entity}
                  name={resolved.get(entity.id) ?? null}
                  unnamed={namesDone && !resolved.has(entity.id)}
                  showRelation={group.key === 'other'}
                />
              </li>
            ))}
          </ul>
          {group.entities.length < group.total && (
            <p data-testid={`${prefix}-group-truncated`} className="text-xs text-muted-foreground">
              {t('module.truncatedOf', { shown: group.entities.length, total: group.total })}
            </p>
          )}
          {failed.length > 0 ? (
            <MarkerError
              error={failed[0]?.error}
              busy={loading}
              onRetry={() => {
                for (const query of failed) void query.refetch()
              }}
            />
          ) : (
            !namesDone &&
            batches.length > 0 && (
              <div>
                <button
                  type="button"
                  data-testid={`${prefix}-names`}
                  onClick={() => setNamesRequested(true)}
                  disabled={loading}
                  className={BUTTON_SECONDARY}
                >
                  {loading
                    ? t('entities.service.info.loadingNames')
                    : t('entities.service.info.showNames')}
                </button>
              </div>
            )
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Enlace a la página de la entidad relacionada. Viaja con `fromProblem` (así «Volver» va atrás en
 * el historial y la entidad de origen no se vuelve a pedir) y con el nombre, si ya se conoce.
 */
function EntityLink({
  prefix,
  entity,
  name,
  unnamed,
  showRelation
}: {
  prefix: InfoPrefix
  entity: RelatedEntity
  name: string | null
  unnamed: boolean
  showRelation: boolean
}): JSX.Element {
  const { t, i18n } = useTranslation()
  const typeKey = `entities.types.${entity.type}`
  const typeText = i18n.exists(typeKey) ? t(typeKey) : entity.type
  const state: EntityLocationState = { fromProblem: true, ...(name !== null ? { name } : {}) }
  return (
    <Link
      to={entityPath(entity.type, entity.id)}
      state={state}
      data-testid={`${prefix}-entity`}
      data-entity-id={entity.id}
      className="flex flex-wrap items-baseline gap-x-2 rounded-md px-1 py-0.5 text-sm hover:bg-hover"
    >
      <span className="text-xs text-muted-foreground">{typeText}</span>
      {name !== null && (
        <span data-testid={`${prefix}-entity-name`} className="font-medium wrap-anywhere">
          {name}
        </span>
      )}
      {unnamed && (
        <span className="text-xs text-muted-foreground italic">
          {t('entities.service.info.noName')}
        </span>
      )}
      <span className="font-mono text-xs wrap-anywhere underline-offset-2 hover:underline">
        {entity.id}
      </span>
      {showRelation && (
        <span className="text-xs text-muted-foreground">{`(${entity.relation})`}</span>
      )}
    </Link>
  )
}

/** «Todas las propiedades», plegada: cada propiedad como dato y valor, también las internas. */
export function AllProperties({
  prefix,
  properties
}: {
  prefix: InfoPrefix
  properties: EntityData['properties']
}): JSX.Element {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const listId = `${prefix}-properties`
  return (
    <div className="grid gap-1 border-t border-border pt-3">
      <button
        type="button"
        data-testid={`${prefix}-properties-toggle`}
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-2 justify-self-start rounded-md px-1 py-1 text-sm hover:bg-hover"
      >
        <ChevronRight
          aria-hidden="true"
          className={cn(
            'size-4 shrink-0 transition-transform duration-(--motion-duration)',
            open && 'rotate-90'
          )}
        />
        <span className="font-medium">{t('entities.service.info.allProperties')}</span>
        <span className="rounded-md bg-hover px-1.5 text-xs tabular-nums">
          {formatNumber(properties.length, i18n.language)}
        </span>
      </button>
      {open && (
        <dl id={listId} className="grid gap-1 pl-7 text-sm">
          {properties.map((property, index) => (
            <div
              key={`${property.key}-${index}`}
              data-testid={`${prefix}-property`}
              data-key={property.key}
              className="grid grid-cols-[minmax(8rem,16rem)_minmax(0,1fr)] gap-x-3"
            >
              <dt className="font-mono text-xs wrap-anywhere text-muted-foreground">
                {property.key}
              </dt>
              <dd className="min-w-0 wrap-anywhere">
                {property.text.trim() === '' ? '—' : property.text}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}
