import type { JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { EntityPageFrame, UnderConstruction, type EntityPageProps } from './EntityPageFrame'

/** Página de análisis de una entidad CLOUD_APPLICATION (en construcción, ficha 0003). */
export function CloudApplicationEntityPage(props: EntityPageProps): JSX.Element {
  const { t } = useTranslation()
  return (
    <EntityPageFrame
      {...props}
      testId="entity-page-cloud_application"
      typeText={t('entities.types.CLOUD_APPLICATION')}
    >
      <UnderConstruction text={t('entities.underConstructionText')} />
    </EntityPageFrame>
  )
}
