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
 * distinguir mayúsculas) no se toca y se informa como saltado; los entornos de
 * un cliente existente se añaden a él. Un entorno inválido va a `errors` y se
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
      let client = repo.listClients().find((existing) => sameName(existing.name, entry.name))
      if (client === undefined) {
        client = repo.createClient({ name: entry.name, color: entry.color })
        summary.created.clients += 1
      } else {
        summary.skipped.push({ kind: 'client', name: entry.name })
      }

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
    }

    return summary
  })
}
