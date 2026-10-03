import type { JSX } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Distintivo fijo de los entornos de Producción. Sin texto visible, para no
 * romper la ruta "Cliente › Entorno › Sección"; se anuncia por `aria-label`.
 */
export function ProductionBadge(): JSX.Element {
  const { t } = useTranslation()
  const label = t('environmentTypes.production')
  return (
    <span
      data-testid="production-badge"
      role="img"
      aria-label={label}
      title={label}
      className="inline-block size-2 shrink-0 rounded-full bg-production ring-2 ring-production/30"
    />
  )
}
