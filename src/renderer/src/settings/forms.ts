import { z } from 'zod'
import {
  certificateLevels,
  classicApiUrlSchema,
  deployments,
  environmentTypes,
  httpsUrlSchema,
  type EnvironmentInput,
  type EnvironmentView
} from '@shared/tenants'

/** Los mensajes de error son claves i18n (`errors.*`); los traduce el campo. */

const name = z.string().trim().min(1, 'errors.required').max(80, 'errors.tooLong')

const optionalUrl = z
  .string()
  .refine(
    (value) => value.trim() === '' || httpsUrlSchema.safeParse(value).success,
    'errors.httpsUrl'
  )

/**
 * URL de la API clásica como se guardará: sin /api/v2 final (lo añade el
 * cliente). Si no es válida, se devuelve tal cual para que el campo dé su error.
 */
export function normalizedClassicUrl(value: string): string {
  const parsed = classicApiUrlSchema.safeParse(value)
  return parsed.success ? parsed.data : value
}

export const clientFormSchema = z.object({
  name,
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'errors.color')
})
export type ClientFormValues = z.infer<typeof clientFormSchema>

export const environmentFormSchema = z.object({
  name,
  type: z.enum(environmentTypes),
  deployment: z.enum(deployments),
  classicApiUrl: optionalUrl,
  platformUrl: optionalUrl,
  ssoUrl: optionalUrl,
  oauthClientId: z.string(),
  oauthScopes: z.string(),
  accountUuid: z.string(),
  certificateLevel: z.enum(certificateLevels),
  tags: z.string(),
  captureUrlPatterns: z.string(),
  readOnly: z.boolean()
})
export type EnvironmentFormValues = z.infer<typeof environmentFormSchema>

export const NEW_ENVIRONMENT: EnvironmentFormValues = {
  name: '',
  type: 'production',
  deployment: 'saas',
  classicApiUrl: '',
  platformUrl: '',
  ssoUrl: '',
  oauthClientId: '',
  oauthScopes: '',
  accountUuid: '',
  certificateLevel: 'system',
  tags: '',
  captureUrlPatterns: '',
  readOnly: false
}

export function environmentToForm(environment: EnvironmentView): EnvironmentFormValues {
  return {
    name: environment.name,
    type: environment.type,
    deployment: environment.deployment,
    classicApiUrl: environment.classicApiUrl ?? '',
    platformUrl: environment.platformUrl ?? '',
    ssoUrl: environment.ssoUrl ?? '',
    oauthClientId: environment.oauthClientId ?? '',
    oauthScopes: environment.oauthScopes.join(' '),
    accountUuid: environment.accountUuid ?? '',
    certificateLevel: environment.certificateLevel,
    tags: environment.tags.join(', '),
    captureUrlPatterns: environment.captureUrlPatterns.join('\n'),
    readOnly: environment.readOnly
  }
}

const text = (value: string): string | null => (value.trim() === '' ? null : value.trim())
const list = (value: string, separator: RegExp): string[] =>
  value
    .split(separator)
    .map((item) => item.trim())
    .filter((item) => item !== '')

/** Valores del formulario → entrada del canal IPC. En Managed se vacía la plataforma. */
export function formToEnvironmentInput(
  values: EnvironmentFormValues,
  clientId: string
): EnvironmentInput {
  const saas = values.deployment === 'saas'
  return {
    clientId,
    name: values.name.trim(),
    type: values.type,
    deployment: values.deployment,
    classicApiUrl: text(normalizedClassicUrl(values.classicApiUrl)),
    platformUrl: saas ? text(values.platformUrl) : null,
    ssoUrl: text(values.ssoUrl),
    oauthClientId: saas ? text(values.oauthClientId) : null,
    oauthScopes: saas ? list(values.oauthScopes, /\s+/) : [],
    accountUuid: saas ? text(values.accountUuid) : null,
    certificateLevel: values.certificateLevel,
    tags: list(values.tags, /,/),
    captureUrlPatterns: list(values.captureUrlPatterns, /\r?\n/),
    readOnly: values.readOnly
  }
}
