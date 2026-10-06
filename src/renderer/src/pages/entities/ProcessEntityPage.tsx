import type { JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { EntityPageFrame, UnderConstruction, type EntityPageProps } from './EntityPageFrame'

/** Página de análisis de una entidad PROCESS_GROUP_INSTANCE (en construcción, ficha 0003). */
export function ProcessEntityPage(props: EntityPageProps): JSX.Element {
  const { t } = useTranslation()
  return (
    <EntityPageFrame
      {...props}
      testId="entity-page-process_group_instance"
      typeText={t('entities.types.PROCESS_GROUP_INSTANCE')}
    >
      <UnderConstruction text={t('entities.underConstructionText')} />
    </EntityPageFrame>
  )
}
