import type { JSX, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { UseQueryResult } from '@tanstack/react-query'
import type { EntityData } from '@shared/modules'
import { formatDateTime } from '@shared/format-date'
import { formatNumber } from '@shared/format-number'
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
import { buildMonitorInfo, type MonitorRow } from './monitor-info'

/** Etiquetas que se ven antes de «+N», como en el servicio (ficha 0015). */
const VISIBLE_TAGS = 6

/**
 * Tarjeta «Información» de la página de un browser monitor o de un HTTP monitor (ficha 0026),
 * entre la cabecera y los marcadores: los datos del monitor (`entities:get`) y sus relaciones,
 * con los nombres a demanda (`entities:names`). El marco, las relaciones y «Todas las
 * propiedades» son los de la tarjeta del servicio (`EntityInfoCard.tsx`).
 */
export function MonitorInfo({
  access,
  info
}: {
  access: ModuleAccess
  info: UseQueryResult<EntityData>
}): JSX.Element | null {
  const { t } = useTranslation()
  return (
    <EntityInfoCard
      prefix="monitor-info"
      label={t('entities.monitor.info.label')}
      access={access}
      info={info}
    >
      {(data, envId) => <InfoContent data={data} envId={envId} />}
    </EntityInfoCard>
  )
}

function InfoContent({ data, envId }: { data: EntityData; envId: string }): JSX.Element {
  const { t } = useTranslation()
  const { rows, groups } = buildMonitorInfo(data)
  return (
    <>
      {/* Dos columnas con la ventana normal (1024 px) y una con la estrecha (960 px). */}
      <div className="grid items-start gap-6 min-[990px]:grid-cols-2">
        <section className="grid min-w-0 content-start gap-2">
          <ColumnTitle>{t('entities.monitor.info.column')}</ColumnTitle>
          <InfoRows
            prefix="monitor-info"
            rows={rows.map((row) => ({
              key: row.key,
              label: t(`entities.monitor.info.rows.${row.key}`),
              value: <RowValue row={row} />
            }))}
          />
        </section>
        <RelationsColumn
          prefix="monitor-info"
          groups={groups}
          envId={envId}
          groupLabel={(key) => t(`entities.monitor.info.groups.${key}`)}
        />
      </div>
      <AllProperties prefix="monitor-info" properties={data.properties} />
    </>
  )
}

function RowValue({ row }: { row: MonitorRow }): ReactNode {
  const { t, i18n } = useTranslation()
  switch (row.kind) {
    case 'text':
      return row.text
    case 'boolean':
      return row.value
        ? t('entities.monitor.info.enabledYes')
        : t('entities.monitor.info.enabledNo')
    case 'number':
      // La frecuencia, en minutos (syntheticMonitorFrequency, ficha 0022).
      return t('entities.monitor.info.frequency', { count: row.value })
    case 'count':
      return formatNumber(row.count, i18n.language)
    case 'date':
      return formatDateTime(row.time, dateLang(i18n.language))
    case 'chips':
      if (row.key === 'tags') {
        return (
          <CollapsedChips
            prefix="monitor-info"
            values={row.chips}
            visible={VISIBLE_TAGS}
            moreTestId="monitor-info-tags-more"
            moreLabel={(count) => t('entities.service.info.tagsMore', { count })}
          />
        )
      }
      return <Chips prefix="monitor-info" values={row.chips} />
  }
}
