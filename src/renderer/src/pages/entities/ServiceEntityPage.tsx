import type { JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { EntityPageFrame, UnderConstruction, type EntityPageProps } from './EntityPageFrame'

/** Página de análisis de una entidad SERVICE (en construcción, ficha 0003). */
export function ServiceEntityPage(props: EntityPageProps): JSX.Element {
  const { t } = useTranslation()
  return (
    <EntityPageFrame {...props} testId="entity-page-service" typeText={t('entities.types.SERVICE')}>
      <UnderConstruction text={t('entities.underConstructionText')} />
    </EntityPageFrame>
  )
}
