import type { JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { NavSection } from '../app/navigation'
import { PageHeader } from '../components/PageHeader'

/** Página de una sección todavía sin contenido: solo su cabecera. */
export function SectionPage({ section }: { section: NavSection }): JSX.Element {
  const { t } = useTranslation()
  return <PageHeader title={t(section.labelKey)} />
}
