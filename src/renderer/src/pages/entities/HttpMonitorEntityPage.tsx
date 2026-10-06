import type { JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { EntityPageFrame, UnderConstruction, type EntityPageProps } from './EntityPageFrame'

/** Página de análisis de una entidad HTTP_CHECK (en construcción, ficha 0003). */
export function HttpMonitorEntityPage(props: EntityPageProps): JSX.Element {
  const { t } = useTranslation()
  return (
    <EntityPageFrame
      {...props}
      testId="entity-page-http_check"
      typeText={t('entities.types.HTTP_CHECK')}
    >
      <UnderConstruction text={t('entities.underConstructionText')} />
    </EntityPageFrame>
  )
}
