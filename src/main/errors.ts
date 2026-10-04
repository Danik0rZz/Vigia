import {
  errorReasonSchema,
  REASON_PARAM_MAX_LENGTH,
  type ErrorReason,
  type ErrorReasonKey
} from '@shared/error-reasons'
import { maskSecrets } from './dynatrace/mask'

/** Errores de dominio que el renderer recibe con su código (ver `ipcErrorCodes`). */
export type DomainErrorCode =
  'CONFLICT' | 'NOT_FOUND' | 'INVALID_INPUT' | 'ENCRYPTION_UNAVAILABLE' | 'SECRET_UNREADABLE'

/** Motivo tal como lo construye main; `wireReason` lo valida antes de enviarlo. */
export interface ReasonInput {
  key: ErrorReasonKey
  params?: Record<string, string | number>
}

/** Parámetros de texto enmascarados y recortados: pueden venir de fuera (Dynatrace, SSO). */
export function cleanReason(reason: ReasonInput | undefined): ReasonInput | undefined {
  if (reason?.params === undefined) return reason
  const params: Record<string, string | number> = {}
  for (const [name, value] of Object.entries(reason.params)) {
    params[name] =
      typeof value === 'string' ? maskSecrets(value).slice(0, REASON_PARAM_MAX_LENGTH) : value
  }
  return { key: reason.key, params }
}

/**
 * El motivo que cruza IPC, validado. Si no cumple el esquema se descarta solo
 * el motivo (el renderer muestra el mensaje) y se avisa en el log.
 */
export function wireReason(
  reason: unknown,
  warn: (message: string) => void
): ErrorReason | undefined {
  if (reason === undefined) return undefined
  const parsed = errorReasonSchema.safeParse(reason)
  if (parsed.success) return parsed.data
  const key = typeof reason === 'object' && reason !== null && 'key' in reason ? reason.key : null
  warn(`Motivo de error descartado por no cumplir el esquema (clave: ${String(key)}).`)
  return undefined
}

/**
 * Error esperado de una operación (nombre repetido, id inexistente…). Su mensaje
 * llega al renderer, así que nunca debe incluir secretos. Con texto para el
 * usuario, lleva `reason` para que la interfaz lo traduzca.
 */
export class DomainError extends Error {
  readonly code: DomainErrorCode
  readonly reason: ReasonInput | undefined

  constructor(code: DomainErrorCode, message: string, reason?: ReasonInput) {
    super(message)
    this.name = 'DomainError'
    this.code = code
    this.reason = cleanReason(reason)
  }
}
