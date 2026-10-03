import { z } from 'zod'

/** Clientes y entornos: esquemas compartidos por main (validación) y el renderer (formularios). */

export const environmentTypes = [
  'production',
  'preproduction',
  'integration',
  'development',
  'other'
] as const
export type EnvironmentType = (typeof environmentTypes)[number]

/** SaaS o Managed: cambia el formato de las URL y si hay plataforma. */
export const deployments = ['saas', 'managed'] as const
export type Deployment = (typeof deployments)[number]

/** Niveles de certificados TLS (ver la spec, "Certificados TLS"). */
export const certificateLevels = ['system', 'pinned', 'ignore'] as const
export type CertificateLevel = (typeof certificateLevels)[number]

/** Secretos que puede tener un entorno. Se guardan cifrados y nunca vuelven al renderer. */
export const secretKinds = ['classicToken', 'oauthClientSecret', 'platformToken'] as const
export type SecretKind = (typeof secretKinds)[number]

/** URL https bien formada, sin credenciales ni hash, sin "/" final. */
export const httpsUrlSchema = z
  .string()
  .trim()
  .transform((value, ctx) => {
    let url: URL
    try {
      url = new URL(value)
    } catch {
      ctx.addIssue({ code: 'custom', message: 'URL no válida' })
      return z.NEVER
    }
    if (url.protocol !== 'https:') {
      ctx.addIssue({ code: 'custom', message: 'La URL debe empezar por https://' })
      return z.NEVER
    }
    if (url.username !== '' || url.password !== '' || url.hash !== '' || value.includes('#')) {
      ctx.addIssue({ code: 'custom', message: 'La URL no puede llevar credenciales ni #' })
      return z.NEVER
    }
    return url.toString().replace(/\/+$/, '')
  })

const nameSchema = z.string().trim().min(1).max(80)

export const clientInputSchema = z.object({
  name: nameSchema,
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/)
})
export type ClientInput = z.input<typeof clientInputSchema>

export const clientSchema = z.object({ id: z.uuid(), name: z.string(), color: z.string() })
export type Client = z.output<typeof clientSchema>

const environmentFieldsSchema = z.object({
  name: nameSchema,
  type: z.enum(environmentTypes),
  deployment: z.enum(deployments),
  classicApiUrl: httpsUrlSchema.nullable(),
  platformUrl: httpsUrlSchema.nullable(),
  ssoUrl: httpsUrlSchema.nullable(),
  oauthClientId: z.string().trim().min(1).max(200).nullable(),
  oauthScopes: z.array(z.string().trim().min(1).max(200)).max(100),
  accountUuid: z.string().trim().min(1).max(100).nullable(),
  certificateLevel: z.enum(certificateLevels),
  captureUrlPatterns: z.array(z.string().trim().min(1).max(500)).max(100),
  tags: z.array(z.string().trim().min(1).max(50)).max(50),
  readOnly: z.boolean()
})

type EnvironmentFields = z.output<typeof environmentFieldsSchema>

/** En Managed no hay plataforma: sin URL de plataforma ni datos de OAuth. */
function checkDeployment(fields: EnvironmentFields, ctx: z.RefinementCtx): void {
  if (fields.deployment !== 'managed') return
  const platformFields = {
    platformUrl: fields.platformUrl !== null,
    oauthClientId: fields.oauthClientId !== null,
    oauthScopes: fields.oauthScopes.length > 0,
    accountUuid: fields.accountUuid !== null
  }
  for (const [field, present] of Object.entries(platformFields)) {
    if (present) {
      ctx.addIssue({ code: 'custom', path: [field], message: 'Managed no tiene plataforma' })
    }
  }
}

/** Campos de un entorno sin su cliente (formato de importación). */
export const environmentFieldsInputSchema = environmentFieldsSchema.superRefine(checkDeployment)

export const environmentInputSchema = environmentFieldsSchema
  .extend({ clientId: z.uuid() })
  .superRefine(checkDeployment)
export type EnvironmentInput = z.input<typeof environmentInputSchema>

export const environmentSchema = environmentFieldsSchema.extend({
  id: z.uuid(),
  clientId: z.uuid(),
  classicApiUrl: z.string().nullable(),
  platformUrl: z.string().nullable(),
  ssoUrl: z.string().nullable()
})
export type Environment = z.output<typeof environmentSchema>

/** Entorno tal como lo ve el renderer: con qué secretos hay, nunca su valor. */
export const environmentViewSchema = environmentSchema.extend({
  secrets: z.object({
    classicToken: z.boolean(),
    oauthClientSecret: z.boolean(),
    platformToken: z.boolean()
  })
})
export type EnvironmentView = z.output<typeof environmentViewSchema>

/**
 * Fichero de configuración exportado (sin secretos). El sobre y los clientes se
 * validan estrictamente; cada entorno se valida al importarlo, para que uno
 * erróneo no impida importar los demás.
 */
export const configFileSchema = z.object({
  format: z.literal('vigia-config'),
  version: z.literal(1),
  exportedAt: z.iso.datetime(),
  clients: z.array(
    clientInputSchema.extend({
      environments: z.array(z.looseObject({ name: z.string() }))
    })
  )
})
export type ConfigFile = z.output<typeof configFileSchema>

export const importSummarySchema = z.object({
  created: z.object({ clients: z.number().int(), environments: z.number().int() }),
  skipped: z.array(z.object({ kind: z.enum(['client', 'environment']), name: z.string() })),
  errors: z.array(z.object({ name: z.string(), message: z.string() }))
})
export type ImportSummary = z.output<typeof importSummarySchema>
