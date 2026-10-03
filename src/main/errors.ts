/** Errores de dominio que el renderer recibe con su código (ver `ipcErrorCodes`). */
export type DomainErrorCode = 'CONFLICT' | 'NOT_FOUND' | 'INVALID_INPUT' | 'ENCRYPTION_UNAVAILABLE'

/**
 * Error esperado de una operación (nombre repetido, id inexistente…). Su mensaje
 * llega al renderer, así que nunca debe incluir secretos.
 */
export class DomainError extends Error {
  readonly code: DomainErrorCode

  constructor(code: DomainErrorCode, message: string) {
    super(message)
    this.name = 'DomainError'
    this.code = code
  }
}
