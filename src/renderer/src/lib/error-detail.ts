import type { TFunction } from 'i18next'
import type { ErrorReason } from '@shared/error-reasons'

/**
 * Detalle de un error de main en el idioma de la interfaz: el motivo traducido
 * si llega y, si no, el mensaje tal cual (texto propio de Dynatrace o de un
 * error sin motivo).
 */
export function errorDetail(
  t: TFunction,
  error: { message: string; reason?: ErrorReason | undefined }
): string {
  if (error.reason === undefined) return error.message
  const text = t(`errorReasons.${error.reason.key}`, {
    ...error.reason.params,
    defaultValue: ''
  })
  return text === '' ? error.message : text
}
