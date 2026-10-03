import { ZodError } from 'zod'
import {
  configFileSchema,
  environmentFieldsInputSchema,
  type Client,
  type ConfigFile,
  type Environment,
  type ImportSummary
} from '@shared/tenants'
import { DomainError } from '../errors'
import type { TenantRepository } from './repository'

/** Tamaño máximo del fichero a importar; una configuración real ocupa unos pocos KB. */
export const MAX_CONFIG_FILE_BYTES = 1024 * 1024

/** Los ids son de esta base: en otro PC no significan nada. */
function withoutIds(environment: Environment): Omit<Environment, 'id' | 'clientId'> {
  const fields: Partial<Environment> = { ...environment }
  delete fields.id
  delete fields.clientId
  return fields as Omit<Environment, 'id' | 'clientId'>
}

/**
 * Fichero de configuración para preparar otro PC: clientes y entornos, sin ids
 * ni secretos (las credenciales se vuelven a introducir en cada equipo).
 */
export function buildConfigExport(
  clients: Client[],
  environments: Environment[],
  now: Date
): ConfigFile {
  return {
    format: 'vigia-config',
    version: 1,
    exportedAt: now.toISOString(),
    clients: clients.map((client) => ({
      name: client.name,
      color: client.color,
      environments: environments
        .filter((environment) => environment.clientId === client.id)
        .map(withoutIds)
    }))
  }
}

export function parseConfigFile(raw: unknown): ConfigFile {
  const parsed = configFileSchema.safeParse(raw)
  if (!parsed.success) {
    throw new DomainError('INVALID_INPUT', 'El fichero no es una configuración de Vigía válida.')
  }
  return parsed.data
}

const sameName = (a: string, b: string): boolean =>
  a.toLocaleLowerCase('es') === b.toLocaleLowerCase('es')

function describeError(error: DomainError | ZodError): string {
  if (error instanceof DomainError) return error.message
  return error.issues
    .map((issue) => `${issue.path.join('.') || '(raíz)'}: ${issue.message}`)
    .join('; ')
}

/**
 * Importa un fichero ya validado. Criterio: lo que ya existe por nombre (sin
 * distinguir mayúsculas) no se toca; los entornos nuevos de un cliente
 * existente se añaden a él, y el cliente solo se informa como saltado si no
 * recibe ninguno. Un entorno inválido va a `errors` y se
 * sigue; un error inesperado deshace toda la importación.
 */
export function applyConfigImport(repo: TenantRepository, file: ConfigFile): ImportSummary {
  return repo.transaction(() => {
    const summary: ImportSummary = {
      created: { clients: 0, environments: 0 },
      skipped: [],
      errors: []
    }

    for (const entry of file.clients) {
      const existing = repo.listClients().find((client) => sameName(client.name, entry.name))
      const client = existing ?? repo.createClient({ name: entry.name, color: entry.color })
      if (existing === undefined) summary.created.clients += 1
      // Un cliente existente solo cuenta como saltado si no recibe ningún entorno nuevo.
      const skippedAt = summary.skipped.length
      const createdBefore = summary.created.environments

      const clientId = client.id
      for (const rawEnvironment of entry.environments) {
        const exists = repo
          .listEnvironments()
          .some((env) => env.clientId === clientId && sameName(env.name, rawEnvironment.name))
        if (exists) {
          summary.skipped.push({ kind: 'environment', name: rawEnvironment.name })
          continue
        }
        try {
          const fields = environmentFieldsInputSchema.parse(rawEnvironment)
          repo.createEnvironment({ ...fields, clientId })
          summary.created.environments += 1
        } catch (error) {
          if (!(error instanceof DomainError) && !(error instanceof ZodError)) throw error
          summary.errors.push({ name: rawEnvironment.name, message: describeError(error) })
        }
      }

      if (existing !== undefined && summary.created.environments === createdBefore) {
        summary.skipped.splice(skippedAt, 0, { kind: 'client', name: entry.name })
      }
    }

    return summary
  })
}
