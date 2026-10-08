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
import { buildProcessInfo, type ProcessRow } from './process-info'
import { splitList } from './service-info'

/** Etiquetas que se ven antes de «+N», como en el servicio (ficha 0015). */
const VISIBLE_TAGS = 6

/**
 * Tarjeta «Información» de la página de un proceso (ficha 0029), entre la cabecera y los
 * marcadores: los datos del proceso (`entities:get`) y sus relaciones, con los nombres a demanda
 * (`entities:names`). El marco, las relaciones y «Todas las propiedades» son los de la tarjeta del
 * servicio (`EntityInfoCard.tsx`). La línea de comandos y las rutas completas no llegan: las
 * quita main.
 */
export function ProcessInfo({
  access,
  info
}: {
  access: ModuleAccess
  info: UseQueryResult<EntityData>
}): JSX.Element | null {
  const { t } = useTranslation()
  return (
    <EntityInfoCard
      prefix="process-info"
      label={t('entities.process.info.label')}
      access={access}
      info={info}
    >
      {(data, envId) => <InfoContent data={data} envId={envId} />}
    </EntityInfoCard>
  )
}

function InfoContent({ data, envId }: { data: EntityData; envId: string }): JSX.Element {
  const { t } = useTranslation()
  const { rows, groups } = buildProcessInfo(data)
  return (
    <>
      {/* Dos columnas con la ventana normal (1024 px) y una con la estrecha (960 px). */}
      <div className="grid items-start gap-6 min-[990px]:grid-cols-2">
        <section className="grid min-w-0 content-start gap-2">
          <ColumnTitle>{t('entities.process.info.column')}</ColumnTitle>
          <InfoRows
            prefix="process-info"
            rows={rows.map((row) => ({
              key: row.key,
              label: t(`entities.process.info.rows.${row.key}`),
              value: <RowValue row={row} />
            }))}
          />
        </section>
        <RelationsColumn
          prefix="process-info"
          groups={groups}
          envId={envId}
          groupLabel={(key) => t(`entities.process.info.groups.${key}`)}
        />
      </div>
      <AllProperties prefix="process-info" properties={data.properties} />
    </>
  )
}

function RowValue({ row }: { row: ProcessRow }): ReactNode {
  const { t, i18n } = useTranslation()
  switch (row.kind) {
    case 'text':
      // Los puertos, sin separador de miles y separados por « · »: con la coma de la lista
      // («8080, 8443») se leerían como un solo número con decimales.
      if (row.key === 'listenPorts') return splitList(row.text).join(' · ')
      return row.text
    case 'date':
      return formatDateTime(row.time, dateLang(i18n.language))
    case 'chips':
      if (row.key === 'tags') {
        return (
          <CollapsedChips
            prefix="process-info"
            values={row.chips}
            visible={VISIBLE_TAGS}
            moreTestId="process-info-tags-more"
            moreLabel={(count) => t('entities.service.info.tagsMore', { count })}
          />
        )
      }
      return <Chips prefix="process-info" values={row.chips} />
  }
}
