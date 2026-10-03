/** Mecanismos de autenticación; los mismos ids que usará `dtRequest({ api })` en la Fase 4. */
export type MechanismId = 'classic' | 'oauth' | 'platform' | 'session'

/** Estado de un mecanismo de autenticación del entorno activo. */
export interface MechanismStatus {
  id: MechanismId
  connected: boolean
}

/** Lo que muestra la tarjeta de estado del pie de la barra lateral. */
export interface EnvStatus {
  mechanisms: MechanismStatus[]
  /** Caducidad del token OAuth, si el entorno lo usa. */
  oauthExpiresAt: Date | null
}

/**
 * Fuente de datos de la tarjeta. Hasta que haya entornos y cliente de
 * Dynatrace (Fases 3 y 4) no hay entorno activo; entonces solo cambia esta función.
 */
export function useEnvStatus(): EnvStatus | null {
  return null
}
