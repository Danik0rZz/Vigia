import { z } from 'zod'

/**
 * Motivo de un error de main, para que la interfaz lo diga en su idioma
 * (`errorReasons.<key>` en los locales). Main no traduce: su `message` en
 * español es lo que va al log; el renderer muestra el motivo si llega y, si no,
 * el `message` tal cual (por ejemplo, el texto propio de Dynatrace).
 */
export const errorReasonKeys = [
  // Dynatrace y SSO
  'environmentMissing',
  'missingClassicToken',
  'missingPlatformToken',
  'missingClassicUrl',
  'missingPlatformUrl',
  'timeout',
  'tlsUntrusted',
  'tlsMismatch',
  'network',
  'rateLimited',
  'notJson',
  'unexpectedFormat',
  'oauthMissing',
  'ssoCredentials',
  'ssoScope',
  'ssoRequest',
  'ssoRequestDetail',
  'ssoUnreachable',
  'ssoStatus',
  'ssoInvalidToken',
  'tokenDisabled',
  'tokenExpired',
  'connectionUnexpected',
  'problemNotFound',
  // Datos locales
  'clientMissing',
  'clientNameTaken',
  'environmentNameTaken',
  'secretLength',
  'encryptionUnavailable',
  'secretUnreadable',
  'configInvalid',
  'configTooLarge',
  'configNotJson',
  'platformSecretsPresent',
  'savedQueryMissing',
  'savedQueryNameTaken',
  'exportTooLarge',
  'captureNotPng',
  'captureInvalidPng',
  'captureOutOfWindow',
  'certificateNotObserved',
  'externalUrlRejected'
] as const
export type ErrorReasonKey = (typeof errorReasonKeys)[number]

/** Límites de los parámetros: pocos y cortos (los textos ya van enmascarados). */
export const REASON_MAX_PARAMS = 6
export const REASON_PARAM_MAX_LENGTH = 300

export const errorReasonSchema = z.object({
  key: z.enum(errorReasonKeys),
  params: z
    .record(z.string(), z.union([z.string().max(REASON_PARAM_MAX_LENGTH), z.number()]))
    .refine((params) => Object.keys(params).length <= REASON_MAX_PARAMS)
    .optional()
})
export type ErrorReason = z.output<typeof errorReasonSchema>
