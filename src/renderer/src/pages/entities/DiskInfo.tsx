import type { JSX, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { UseQueryResult } from '@tanstack/react-query'
import type { EntityData } from '@shared/modules'
import { formatDateTime } from '@shared/format-date'
import { entityPath, type EntityLocationState } from '../../app/entity-route'
import type { ModuleAccess } from '../../data/modules'
import { cn } from '../../lib/cn'
import { dateLang } from '../../lib/date-lang'
import {
  AllProperties,
  Chips,
  ColumnTitle,
  EntityInfoCard,
  InfoRows,
  RelationsColumn
} from './EntityInfoCard'
import { buildDiskInfo, type DiskHost, type DiskRow } from './disk-info'

/**
 * Tarjeta «Información» de la página de un DISK (ficha 0040), la última de la página: los datos
 * del disco (`entities:get`) y su relación con el host («Disco de», con el enlace a su vista).
 * El marco y «Todas las propiedades» son los comunes (`EntityInfoCard.tsx`); otras relaciones,
 * si las hubiera, van en su columna con los nombres a demanda.
 */
export function DiskInfo({
  access,
  info
}: {
  access: ModuleAccess
  info: UseQueryResult<EntityData>
}): JSX.Element | null {
  const { t } = useTranslation()
  return (
    <EntityInfoCard
      prefix="disk-info"
      label={t('entities.disk.info.label')}
      access={access}
      info={info}
    >
      {(data, envId) => <InfoContent data={data} envId={envId} />}
    </EntityInfoCard>
  )
}

function InfoContent({ data, envId }: { data: EntityData; envId: string }): JSX.Element {
  const { t } = useTranslation()
  const { rows, groups } = buildDiskInfo(data)
  return (
    <>
      {/* Dos columnas con la ventana normal (1024 px) si hay otras relaciones; si no, una. */}
      <div className={cn('grid items-start gap-6', groups.length > 0 && 'min-[990px]:grid-cols-2')}>
        <section className="grid min-w-0 content-start gap-2">
          <ColumnTitle>{t('entities.disk.info.column')}</ColumnTitle>
          <InfoRows
            prefix="disk-info"
            rows={rows.map((row) => ({
              key: row.key,
              label: t(`entities.disk.info.rows.${row.key}`),
              value: <RowValue row={row} />
            }))}
          />
        </section>
        {groups.length > 0 && (
          <RelationsColumn
            prefix="disk-info"
            groups={groups}
            envId={envId}
            groupLabel={(key) => t(`entities.disk.info.groups.${key}`)}
          />
        )}
      </div>
      <AllProperties prefix="disk-info" properties={data.properties} />
    </>
  )
}

function RowValue({ row }: { row: DiskRow }): ReactNode {
  const { i18n } = useTranslation()
  switch (row.kind) {
    case 'text':
      return row.text
    case 'date':
      return formatDateTime(row.time, dateLang(i18n.language))
    case 'chips':
      return <Chips prefix="disk-info" values={row.chips} />
    case 'hosts':
      return (
        <span className="grid gap-0.5">
          {row.hosts.map((host) => (
            <HostLink key={host.id} host={host} />
          ))}
        </span>
      )
  }
}

/**
 * Enlace a la vista del host del disco. Viaja con `fromProblem`: «Volver» desde el host va atrás
 * en el historial y el disco no se vuelve a pedir.
 */
function HostLink({ host }: { host: DiskHost }): JSX.Element {
  const { t, i18n } = useTranslation()
  const typeKey = `entities.types.${host.type}`
  const state: EntityLocationState = { fromProblem: true }
  return (
    <Link
      to={entityPath(host.type, host.id)}
      state={state}
      data-testid="disk-info-host"
      data-entity-id={host.id}
      className="flex flex-wrap items-baseline gap-x-2 rounded-md text-sm hover:bg-hover"
    >
      <span className="text-xs text-muted-foreground">
        {i18n.exists(typeKey) ? t(typeKey) : host.type}
      </span>
      <span className="font-mono text-xs wrap-anywhere underline underline-offset-2">
        {host.id}
      </span>
    </Link>
  )
}
