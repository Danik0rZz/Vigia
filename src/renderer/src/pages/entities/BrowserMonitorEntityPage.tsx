import type { JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { EntityPageFrame, UnderConstruction, type EntityPageProps } from './EntityPageFrame'

/** Página de análisis de una entidad SYNTHETIC_TEST (en construcción, ficha 0003). */
export function BrowserMonitorEntityPage(props: EntityPageProps): JSX.Element {
  const { t } = useTranslation()
  return (
    <EntityPageFrame
      {...props}
      testId="entity-page-synthetic_test"
      typeText={t('entities.types.SYNTHETIC_TEST')}
    >
      <UnderConstruction text={t('entities.underConstructionText')} />
    </EntityPageFrame>
  )
}
