import type { EnvironmentView, SecretKind } from '@shared/tenants'
import { DomainError } from '../../errors'
import type { SecretStore } from '../../secrets/store'
import {
  applyConfigImport,
  buildConfigExport,
  MAX_CONFIG_FILE_BYTES,
  parseConfigFile
} from '../../tenants/config-file'
import type { TenantRepository } from '../../tenants/repository'
import type { IpcImplementation, IpcImplementations } from '../handler'

type TenantChannels =
  | 'tenants:list'
  | 'clients:create'
  | 'clients:update'
  | 'clients:delete'
  | 'environments:create'
  | 'environments:update'
  | 'environments:delete'
  | 'environments:getActive'
  | 'environments:setActive'
  | 'secrets:set'
  | 'secrets:delete'
  | 'secrets:availability'
  | 'config:export'
  | 'config:import'

/** Secretos que solo existen en SaaS (Managed no tiene plataforma). */
const PLATFORM_SECRETS: readonly SecretKind[] = ['oauthClientSecret', 'platformToken']

export interface TenantHandlerDeps {
  repo: TenantRepository
  secrets: SecretStore
  /**
   * Ejecuta `fn` en una transacción de la base (todo o nada). Por defecto, sin
   * transacción (solo en tests que no la necesitan).
   */
  transaction?: <T>(fn: () => T) => T
  /** Diálogos de fichero de main; `null` si el usuario cancela. */
  dialogs: {
    chooseSaveFile(defaultName: string): Promise<string | null>
    chooseOpenFile(): Promise<string | null>
  }
  statFile(path: string): Promise<{ size: number }>
  readFile(path: string): Promise<string>
  writeFile(path: string, content: string): Promise<void>
  now?: () => Date
  /**
   * Ha cambiado un entorno (datos, secretos o borrado): main renueva su token
   * OAuth, su estado de conexión y su sesión de red.
   */
  onEnvironmentChanged?: (envId: string) => void
}

/** Canales de clientes, entornos, secretos y configuración. El renderer no toca el disco. */
export function createTenantHandlers(
  deps: TenantHandlerDeps
): Pick<IpcImplementations, TenantChannels> {
  const { repo, secrets } = deps
  const now = deps.now ?? (() => new Date())
  const transaction = deps.transaction ?? (<T>(fn: () => T): T => fn())
  const changed = (envId: string): void => deps.onEnvironmentChanged?.(envId)

  const view = (id: string): EnvironmentView => ({
    ...repo.getEnvironment(id),
    secrets: secrets.status(id),
    unreadableSecrets: secrets.unreadable(id)
  })

  const exportConfig: IpcImplementation<'config:export'> = async () => {
    const date = now()
    const stamp = date.toISOString().slice(0, 10).replaceAll('-', '')
    const path = await deps.dialogs.chooseSaveFile(`vigia-config-${stamp}.json`)
    if (path === null) return { status: 'cancelled' }
    const file = buildConfigExport(repo.listClients(), repo.listEnvironments(), date)
    await deps.writeFile(path, `${JSON.stringify(file, null, 2)}\n`)
    return { status: 'saved' }
  }

  const importConfig: IpcImplementation<'config:import'> = async () => {
    const path = await deps.dialogs.chooseOpenFile()
    if (path === null) return { status: 'cancelled' }
    // Antes de leer: un fichero enorme elegido por error bloquearía main.
    if ((await deps.statFile(path)).size > MAX_CONFIG_FILE_BYTES) {
      throw new DomainError(
        'INVALID_INPUT',
        'El fichero es demasiado grande para ser una configuración.',
        { key: 'configTooLarge' }
      )
    }
    let raw: unknown
    try {
      raw = JSON.parse(await deps.readFile(path))
    } catch {
      throw new DomainError('INVALID_INPUT', 'No se pudo leer el fichero como JSON.', {
        key: 'configNotJson'
      })
    }
    return { status: 'done', summary: applyConfigImport(repo, parseConfigFile(raw)) }
  }

  return {
    'tenants:list': () => ({
      clients: repo.listClients(),
      environments: repo.listEnvironments().map((env) => ({
        ...env,
        secrets: secrets.status(env.id),
        unreadableSecrets: secrets.unreadable(env.id)
      }))
    }),
    'clients:create': (input) => repo.createClient(input),
    'clients:update': ({ id, ...input }) => repo.updateClient(id, input),
    'clients:delete': ({ id }) => {
      // Los entornos se borran en cascada: se avisa de cada uno.
      const removed = repo.listEnvironments().filter((env) => env.clientId === id)
      repo.deleteClient(id)
      for (const env of removed) changed(env.id)
      return { ok: true }
    },
    'environments:create': (input) => view(repo.createEnvironment(input).id),
    'environments:update': ({ id, dropPlatformSecrets, ...input }) => {
      transaction(() => {
        // Managed no tiene plataforma: sus secretos quedarían huérfanos. Solo se
        // borran con el permiso explícito de la interfaz (confirmado por el
        // usuario), y en la misma transacción que el cambio.
        const before = repo.getEnvironment(id)
        const status = secrets.status(id)
        const orphans = PLATFORM_SECRETS.filter((kind) => status[kind])
        const toManaged = before.deployment === 'saas' && input.deployment === 'managed'
        if (toManaged && orphans.length > 0 && dropPlatformSecrets !== true) {
          throw new DomainError(
            'CONFLICT',
            'PLATFORM_SECRETS_PRESENT: el entorno tiene credenciales de plataforma; confirma que se borren al pasar a Managed.',
            { key: 'platformSecretsPresent' }
          )
        }
        repo.updateEnvironment(id, input)
        if (toManaged) for (const kind of orphans) secrets.delete(id, kind)
      })
      changed(id)
      return view(id)
    },
    'environments:delete': ({ id }) => {
      repo.deleteEnvironment(id)
      changed(id)
      return { ok: true }
    },
    'environments:getActive': () => ({ environmentId: repo.getActiveEnvironmentId() }),
    'environments:setActive': ({ environmentId }) => {
      repo.setActiveEnvironmentId(environmentId)
      return { environmentId }
    },
    'secrets:set': ({ environmentId, kind, value }) => {
      secrets.set(environmentId, kind, value)
      changed(environmentId)
      return { configured: true }
    },
    'secrets:delete': ({ environmentId, kind }) => {
      secrets.delete(environmentId, kind)
      changed(environmentId)
      return { configured: false }
    },
    'secrets:availability': () => ({ available: secrets.isAvailable() }),
    'config:export': exportConfig,
    'config:import': importConfig
  }
}
