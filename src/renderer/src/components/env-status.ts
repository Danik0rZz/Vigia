import type { MechanismId } from '@shared/dynatrace'
import type { SecretKind } from '@shared/tenants'
import { useActiveEnvironment, useConnectionStatus } from '../data/tenants'

export type { MechanismId }

/** "unchecked": hay credencial, pero no se ha probado la conexión desde el último cambio. */
export type MechanismState = 'unchecked' | 'connected' | 'disconnected'

/** Estado de un mecanismo de autenticación del entorno activo. */
export interface MechanismStatus {
  id: MechanismId
  state: MechanismState
}

/** Lo que muestra la tarjeta de estado del pie de la barra lateral. */
export interface EnvStatus {
  mechanisms: MechanismStatus[]
  /** Caducidad del token OAuth, si el entorno lo usa. */
  oauthExpiresAt: Date | null
}

const MECHANISM_BY_SECRET: Record<SecretKind, MechanismId> = {
  classicToken: 'classic',
  oauthClientSecret: 'oauth',
  platformToken: 'platform'
}

/**
 * Fuente de datos de la tarjeta: el último "Probar conexión" del entorno
 * activo y, si no lo hay, sus mecanismos con credencial sin comprobar.
 */
export function useEnvStatus(): EnvStatus | null {
  const active = useActiveEnvironment()
  const report = useConnectionStatus(active?.environment.id ?? null)
  if (active === null) return null
  if (report !== null) {
    return {
      mechanisms: report.mechanisms.map(({ id, state }) => ({ id, state })),
      oauthExpiresAt: report.oauthExpiresAt === null ? null : new Date(report.oauthExpiresAt)
    }
  }
  const mechanisms = (Object.keys(MECHANISM_BY_SECRET) as SecretKind[])
    .filter((kind) => active.environment.secrets[kind])
    .map((kind) => ({ id: MECHANISM_BY_SECRET[kind], state: 'unchecked' as const }))
  return { mechanisms, oauthExpiresAt: null }
}
