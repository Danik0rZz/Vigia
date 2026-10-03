import type { JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { EnvironmentType } from '@shared/tenants'

const DOT: Record<EnvironmentType, string> = {
  production: 'bg-env-production',
  preproduction: 'bg-env-preproduction',
  integration: 'bg-env-integration',
  development: 'bg-env-development',
  other: 'bg-env-other'
}

/**
 * Distintivo de color del tipo de entorno (Producción mantiene su color fijo).
 * Sin texto visible: el tipo siempre aparece escrito al lado; aquí se anuncia
 * con `aria-label`, así que el color nunca es la única señal.
 */
export function EnvTypeBadge({ type }: { type: EnvironmentType }): JSX.Element {
  const { t } = useTranslation()
  const label = t(`environmentTypes.${type}`)
  return (
    <span
      data-testid="env-type-badge"
      data-type={type}
      role="img"
      aria-label={label}
      title={label}
      className={`inline-block size-2 shrink-0 rounded-full ${DOT[type]}`}
    />
  )
}
