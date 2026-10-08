import type { JSX, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { UseQueryResult } from '@tanstack/react-query'
import type { EntityData } from '@shared/modules'
import { formatDateTime } from '@shared/format-date'
import type { ModuleAccess } from '../../data/modules'
import { dateLang } from '../../lib/date-lang'
import { formatGigabytes } from '../../lib/host-format'
import {
  AllProperties,
  Chips,
  CollapsedChips,
  ColumnTitle,
  EntityInfoCard,
  InfoRows,
  RelationsColumn
} from './EntityInfoCard'
import { buildHostInfo, type HostRow, type HostSection } from './host-info'

/** IPs que se ven antes de «+N» (ficha 0020). */
const VISIBLE_IPS = 2

/**
 * Tarjeta «Información» de la página de un HOST (ficha 0020), entre la cabecera y los
 * marcadores: los datos del host en sus grupos (Sistema, Capacidad, Red…) y sus relaciones
 * (`entities:get`), con los nombres a demanda (`entities:names`). El marco, las relaciones y
 * «Todas las propiedades» son los de la tarjeta del servicio (`EntityInfoCard.tsx`).
 */
export function HostInfo({
  access,
  info
}: {
  access: ModuleAccess
  info: UseQueryResult<EntityData>
}): JSX.Element | null {
  const { t } = useTranslation()
  return (
    <EntityInfoCard
      prefix="host-info"
      label={t('entities.host.info.label')}
      access={access}
      info={info}
    >
      {(data, envId) => <InfoContent data={data} envId={envId} />}
    </EntityInfoCard>
  )
}

function InfoContent({ data, envId }: { data: EntityData; envId: string }): JSX.Element {
  const { t } = useTranslation()
  const { sections, groups } = buildHostInfo(data)
  return (
    <>
      {/* Dos columnas con la ventana normal (1024 px) y una con la estrecha (960 px). */}
      <div className="grid items-start gap-6 min-[990px]:grid-cols-2">
        <div className="grid min-w-0 content-start gap-4">
          {sections.map((section) => (
            <SectionView key={section.key} section={section} />
          ))}
        </div>
        <RelationsColumn
          prefix="host-info"
          groups={groups}
          envId={envId}
          groupLabel={(key) => t(`entities.host.info.groups.${key}`)}
        />
      </div>
      <AllProperties prefix="host-info" properties={data.properties} />
    </>
  )
}

function SectionView({ section }: { section: HostSection }): JSX.Element {
  const { t } = useTranslation()
  return (
    <section
      data-testid="host-info-section"
      data-section={section.key}
      className="grid min-w-0 content-start gap-2"
    >
      <ColumnTitle>{t(`entities.host.info.sections.${section.key}`)}</ColumnTitle>
      <InfoRows
        prefix="host-info"
        rows={section.rows.map((row) => ({
          key: row.key,
          label: t(`entities.host.info.rows.${row.key}`),
          value: <RowValue row={row} />
        }))}
      />
    </section>
  )
}

function RowValue({ row }: { row: HostRow }): ReactNode {
  const { t, i18n } = useTranslation()
  switch (row.kind) {
    case 'text':
      // Tal cual: versiones, núcleos y bits son del tenant, sin separador de miles.
      return row.text
    case 'bytes':
      return formatGigabytes(row.bytes, i18n.language)
    case 'date':
      return formatDateTime(row.time, dateLang(i18n.language))
    case 'chips':
      if (row.key === 'ipAddress') {
        return (
          <CollapsedChips
            prefix="host-info"
            values={row.chips}
            visible={VISIBLE_IPS}
            moreTestId="host-info-more"
            moreLabel={(count) => t('entities.host.info.ipsMore', { count })}
          />
        )
      }
      return <Chips prefix="host-info" values={row.chips} />
  }
}
