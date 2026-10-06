import type { JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { EntityPageFrame, UnderConstruction, type EntityPageProps } from './EntityPageFrame'

/** Página de análisis de una entidad PROCESS_GROUP (en construcción, ficha 0003). */
export function ProcessGroupEntityPage(props: EntityPageProps): JSX.Element {
  const { t } = useTranslation()
  return (
    <EntityPageFrame
      {...props}
      testId="entity-page-process_group"
      typeText={t('entities.types.PROCESS_GROUP')}
    >
      <UnderConstruction text={t('entities.underConstructionText')} />
    </EntityPageFrame>
  )
}
