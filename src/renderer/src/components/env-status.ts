import type { SecretKind } from '@shared/tenants'
import { useActiveEnvironment } from '../data/tenants'

/** Mecanismos de autenticación; los mismos ids que usará `dtRequest({ api })` en la Fase 4. */
export type MechanismId = 'classic' | 'oauth' | 'platform' | 'session'

/** "unchecked": hay credencial, pero la conexión no se ha probado (llega en la Fase 4). */
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
 * Fuente de datos de la tarjeta: los mecanismos con credencial del entorno
 * activo. La comprobación de la conexión llega con el cliente de la Fase 4.
 */
export function useEnvStatus(): EnvStatus | null {
  const active = useActiveEnvironment()
  if (active === null) return null
  const mechanisms = (Object.keys(MECHANISM_BY_SECRET) as SecretKind[])
    .filter((kind) => active.environment.secrets[kind])
    .map((kind) => ({ id: MECHANISM_BY_SECRET[kind], state: 'unchecked' as const }))
  return { mechanisms, oauthExpiresAt: null }
}
