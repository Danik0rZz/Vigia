import type { JSX, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { UseQueryResult } from '@tanstack/react-query'
import type { EntityData } from '@shared/modules'
import { formatDateTime } from '@shared/format-date'
import type { ModuleAccess } from '../../data/modules'
import { dateLang } from '../../lib/date-lang'
import { buildApplicationInfo } from './application-info'
import {
  AllProperties,
  Chips,
  ColumnTitle,
  EntityInfoCard,
  InfoRows,
  RelationsColumn
} from './EntityInfoCard'
import type { ProcessRow } from './process-info'

/**
 * Tarjeta «Información» de la página de una aplicación web (ficha 0034), la última de la página:
 * los datos de la aplicación (`entities:get`) y sus relaciones («Llama a», «Monitores
 * sintéticos» y «Otras»), con los nombres a demanda (`entities:names`). El marco, las relaciones
 * y «Todas las propiedades» son los comunes (`EntityInfoCard.tsx`).
 */
export function ApplicationInfo({
  access,
  info
}: {
  access: ModuleAccess
  info: UseQueryResult<EntityData>
}): JSX.Element | null {
  const { t } = useTranslation()
  return (
    <EntityInfoCard
      prefix="application-info"
      label={t('entities.application.info.label')}
      access={access}
      info={info}
    >
      {(data, envId) => <InfoContent data={data} envId={envId} />}
    </EntityInfoCard>
  )
}

function InfoContent({ data, envId }: { data: EntityData; envId: string }): JSX.Element {
  const { t } = useTranslation()
  const { rows, groups } = buildApplicationInfo(data)
  return (
    <>
      {/* Dos columnas con la ventana normal (1024 px) y una con la estrecha (960 px). */}
      <div className="grid items-start gap-6 min-[990px]:grid-cols-2">
        <section className="grid min-w-0 content-start gap-2">
          <ColumnTitle>{t('entities.application.info.column')}</ColumnTitle>
          <InfoRows
            prefix="application-info"
            rows={rows.map((row) => ({
              key: row.key,
              label: t(`entities.application.info.rows.${row.key}`),
              value: <RowValue row={row} />
            }))}
          />
        </section>
        <RelationsColumn
          prefix="application-info"
          groups={groups}
          envId={envId}
          groupLabel={(key) => t(`entities.application.info.groups.${key}`)}
        />
      </div>
      <AllProperties prefix="application-info" properties={data.properties} />
    </>
  )
}

function RowValue({ row }: { row: ProcessRow }): ReactNode {
  const { i18n } = useTranslation()
  switch (row.kind) {
    case 'text':
      return row.text
    case 'date':
      return formatDateTime(row.time, dateLang(i18n.language))
    case 'chips':
      return <Chips prefix="application-info" values={row.chips} />
  }
}
