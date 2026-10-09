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
  ColumnTitle,
  EntityInfoCard,
  InfoRows,
  RelationsColumn
} from './EntityInfoCard'
import type { ProcessRow } from './process-info'
import { buildProcessGroupInfo } from './process-group-info'
import { splitList } from './service-info'

/**
 * Tarjeta «Información» de la página de un process group (ficha 0032), la última de la página: los
 * datos del grupo (`entities:get`) y sus relaciones (instancias, hosts, servicios y otras), con los
 * nombres a demanda (`entities:names`). El marco, las relaciones y «Todas las propiedades» son los
 * comunes (`EntityInfoCard.tsx`). La línea de comandos y las rutas completas no llegan: las quita
 * main.
 */
export function ProcessGroupInfo({
  access,
  info
}: {
  access: ModuleAccess
  info: UseQueryResult<EntityData>
}): JSX.Element | null {
  const { t } = useTranslation()
  return (
    <EntityInfoCard
      prefix="process-group-info"
      label={t('entities.processGroup.info.label')}
      access={access}
      info={info}
    >
      {(data, envId) => <InfoContent data={data} envId={envId} />}
    </EntityInfoCard>
  )
}

function InfoContent({ data, envId }: { data: EntityData; envId: string }): JSX.Element {
  const { t } = useTranslation()
  const { rows, groups } = buildProcessGroupInfo(data)
  return (
    <>
      {/* Dos columnas con la ventana normal (1024 px) y una con la estrecha (960 px). */}
      <div className="grid items-start gap-6 min-[990px]:grid-cols-2">
        <section className="grid min-w-0 content-start gap-2">
          <ColumnTitle>{t('entities.processGroup.info.column')}</ColumnTitle>
          <InfoRows
            prefix="process-group-info"
            rows={rows.map((row) => ({
              key: row.key,
              label: t(`entities.processGroup.info.rows.${row.key}`),
              value: <RowValue row={row} />
            }))}
          />
        </section>
        <RelationsColumn
          prefix="process-group-info"
          groups={groups}
          envId={envId}
          groupLabel={(key) => t(`entities.processGroup.info.groups.${key}`)}
        />
      </div>
      <AllProperties prefix="process-group-info" properties={data.properties} />
    </>
  )
}

function RowValue({ row }: { row: ProcessRow }): ReactNode {
  const { i18n } = useTranslation()
  switch (row.kind) {
    case 'text':
      // Los puertos, separados por « · »: con la coma de la lista se leerían como un número.
      if (row.key === 'listenPorts') return splitList(row.text).join(' · ')
      return row.text
    case 'date':
      return formatDateTime(row.time, dateLang(i18n.language))
    case 'chips':
      return <Chips prefix="process-group-info" values={row.chips} />
  }
}
