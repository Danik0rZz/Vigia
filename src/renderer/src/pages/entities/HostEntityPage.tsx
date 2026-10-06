import type { JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { EntityPageFrame, UnderConstruction, type EntityPageProps } from './EntityPageFrame'

/** Página de análisis de una entidad HOST (en construcción, ficha 0003). */
export function HostEntityPage(props: EntityPageProps): JSX.Element {
  const { t } = useTranslation()
  return (
    <EntityPageFrame {...props} testId="entity-page-host" typeText={t('entities.types.HOST')}>
      <UnderConstruction text={t('entities.underConstructionText')} />
    </EntityPageFrame>
  )
}
