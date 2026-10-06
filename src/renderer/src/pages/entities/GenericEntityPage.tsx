import type { JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { EntityPageFrame, UnderConstruction, type EntityPageProps } from './EntityPageFrame'

/**
 * Página de cualquier tipo sin página propia (estándar no listado, personalizado
 * o de extensión): enseña el código del tipo tal cual llega. Nunca el 404.
 */
export function GenericEntityPage(props: EntityPageProps): JSX.Element {
  const { t } = useTranslation()
  return (
    <EntityPageFrame {...props} testId="entity-page-generic" typeText={props.type}>
      <UnderConstruction text={t('entities.genericText')} />
    </EntityPageFrame>
  )
}
