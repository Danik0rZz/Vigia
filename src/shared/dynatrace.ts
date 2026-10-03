import { z } from 'zod'

/**
 * Scopes que necesita cada módulo, deducidos de `..\API\` (Environment API v2):
 * `x-token-scopes` para el token clásico y `ssoAuth` para OAuth. "Probar
 * conexión" avisa de los que faltan.
 */
export const MODULE_SCOPES = {
  problems: { classic: ['problems.read'], oauth: ['environment-api:problems:read'] },
  metrics: { classic: ['metrics.read'], oauth: ['environment-api:metrics:read'] },
  slos: { classic: ['slo.read'], oauth: ['environment-api:slo:read'] }
} as const satisfies Record<string, { classic: readonly string[]; oauth: readonly string[] }>

/** Scopes de token clásico de todos los módulos, sin repetir y ordenados. */
export const REQUIRED_CLASSIC_SCOPES: readonly string[] = [
  ...new Set(Object.values(MODULE_SCOPES).flatMap((module) => module.classic))
].sort()

/** Mecanismos de autenticación que se prueban (la sesión capturada es de la Fase 10). */
export const mechanismIds = ['classic', 'oauth', 'platform'] as const
export type MechanismId = (typeof mechanismIds)[number]

export const dtErrorCodes = [
  'NO_CREDENTIAL',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'RATE_LIMITED',
  'TIMEOUT',
  'NETWORK',
  'TLS_UNTRUSTED',
  'TLS_PIN_MISMATCH',
  'INVALID_RESPONSE',
  'SERVER_ERROR'
] as const
export type DtErrorCode = (typeof dtErrorCodes)[number]

export const mechanismResultSchema = z.object({
  id: z.enum(mechanismIds),
  state: z.enum(['connected', 'disconnected']),
  error: z.object({ code: z.enum(dtErrorCodes), message: z.string() }).nullable(),
  missingScopes: z.array(z.string())
})
export type MechanismResult = z.output<typeof mechanismResultSchema>

export const connectionReportSchema = z.object({
  checkedAt: z.iso.datetime(),
  mechanisms: z.array(mechanismResultSchema),
  oauthExpiresAt: z.iso.datetime().nullable()
})
export type ConnectionReport = z.output<typeof connectionReportSchema>

/** Certificado que no se ha aceptado: el usuario puede fijar su huella. */
export const untrustedCertificateSchema = z.object({
  host: z.string(),
  fingerprint: z.string(),
  reason: z.enum(['untrusted', 'mismatch']),
  /** Huella fijada que ya no coincide (solo con `mismatch`). */
  previousFingerprint: z.string().nullable()
})
export type UntrustedCertificate = z.output<typeof untrustedCertificateSchema>

export const certificatePinSchema = z.object({ host: z.string(), fingerprint: z.string() })
export type CertificatePin = z.output<typeof certificatePinSchema>
