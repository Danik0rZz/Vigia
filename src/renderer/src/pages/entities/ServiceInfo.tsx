import type { JSX, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { UseQueryResult } from '@tanstack/react-query'
import type { EntityData } from '@shared/modules'
import { formatDateTime } from '@shared/format-date'
import type { ModuleAccess } from '../../data/modules'
import { dateLang } from '../../lib/date-lang'
import {
  AllProperties,
  Chips,
  CollapsedChips,
  ColumnTitle,
  EntityInfoCard,
  InfoRows,
  RelationsColumn
} from './EntityInfoCard'
import { buildServiceInfo, type ServiceRow } from './service-info'

/** Etiquetas que se ven antes de «+N» (ficha 0015). */
const VISIBLE_TAGS = 6

/**
 * Tarjeta «Información» de la página de un SERVICE (ficha 0015), entre la cabecera y los
 * marcadores: los datos del servicio y sus relaciones (`entities:get`), con los nombres de las
 * relacionadas a demanda (`entities:names`). El marco y las relaciones son los comunes
 * (`EntityInfoCard.tsx`, compartidos con el host en la 0020).
 */
export function ServiceInfo({
  access,
  info
}: {
  access: ModuleAccess
  info: UseQueryResult<EntityData>
}): JSX.Element | null {
  const { t } = useTranslation()
  return (
    <EntityInfoCard
      prefix="service-info"
      label={t('entities.service.info.label')}
      access={access}
      info={info}
    >
      {(data, envId) => <InfoContent data={data} envId={envId} />}
    </EntityInfoCard>
  )
}

function InfoContent({ data, envId }: { data: EntityData; envId: string }): JSX.Element {
  const { t } = useTranslation()
  const { rows, groups } = buildServiceInfo(data)
  return (
    <>
      {/* Dos columnas con la ventana normal (1024 px) y una con la estrecha (960 px). */}
      <div className="grid items-start gap-6 min-[990px]:grid-cols-2">
        <ServiceColumn rows={rows} />
        <RelationsColumn
          prefix="service-info"
          groups={groups}
          envId={envId}
          groupLabel={(key) => t(`entities.service.info.groups.${key}`)}
        />
      </div>
      <AllProperties prefix="service-info" properties={data.properties} />
    </>
  )
}

function ServiceColumn({ rows }: { rows: ServiceRow[] }): JSX.Element {
  const { t } = useTranslation()
  return (
    <section data-testid="service-info-service" className="grid min-w-0 content-start gap-2">
      <ColumnTitle>{t('entities.service.info.service')}</ColumnTitle>
      <InfoRows
        prefix="service-info"
        rows={rows.map((row) => ({
          key: row.key,
          label: t(`entities.service.info.rows.${row.key}`),
          value: <RowValue row={row} />
        }))}
      />
    </section>
  )
}

function RowValue({ row }: { row: ServiceRow }): ReactNode {
  const { t, i18n } = useTranslation()
  switch (row.kind) {
    case 'text':
      // Tal cual: el puerto y las versiones son identificadores, sin separador de miles.
      return row.text
    case 'flag':
      return t('entities.service.info.yes')
    case 'date':
      return formatDateTime(row.time, dateLang(i18n.language))
    case 'chips':
      return row.key === 'tags' ? (
        <CollapsedChips
          prefix="service-info"
          values={row.chips}
          visible={VISIBLE_TAGS}
          moreTestId="service-info-tags-more"
          moreLabel={(count) => t('entities.service.info.tagsMore', { count })}
        />
      ) : (
        <Chips prefix="service-info" values={row.chips} />
      )
  }
}
