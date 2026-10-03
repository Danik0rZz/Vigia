import { setTimeout as sleep } from 'node:timers/promises'
import type { AppDatabase } from '../db/database'
import type { ConnectionHandlerDeps } from '../ipc/handlers/connection'
import type { SecretStore } from '../secrets/store'
import type { TenantRepository } from '../tenants/repository'
import { createDtClient, type DtClient } from './client'
import { testConnection } from './connection-test'
import { createEnvironmentNetwork } from './network'
import { createOAuthTokenManager, type OAuthTokenManager } from './oauth'
import { createPinStore } from './pins'
import { createConnectionStatusStore } from './status'

const DEFAULT_SSO_URL = 'https://sso.dynatrace.com/sso/oauth2/token'

export interface DynatraceServices {
  client: DtClient
  connectionDeps: ConnectionHandlerDeps
  /** Para los handlers de tenants: un entorno ha cambiado o se ha borrado. */
  onEnvironmentChanged(envId: string): void
}

/**
 * Cliente de Dynatrace con sus piezas de Electron: una sesión de red por
 * entorno (certificados) y un gestor OAuth por entorno, para que también la
 * petición al SSO pase por la sesión y los certificados de ese entorno.
 */
export function createDynatraceServices(deps: {
  db: AppDatabase
  repo: TenantRepository
  secrets: SecretStore
  logger: { warn(...args: unknown[]): void; error(...args: unknown[]): void }
}): DynatraceServices {
  const { repo, secrets } = deps
  const pins = createPinStore(deps.db)
  const status = createConnectionStatusStore()
  const network = createEnvironmentNetwork({
    certificateLevel: (envId) => repo.getEnvironment(envId).certificateLevel,
    environmentHosts: (envId) => {
      const { classicApiUrl, platformUrl } = repo.getEnvironment(envId)
      return [classicApiUrl, platformUrl].flatMap((url) =>
        url === null ? [] : [new URL(url).hostname]
      )
    },
    pins
  })

  const oauthByEnv = new Map<string, OAuthTokenManager>()
  const managerFor = (envId: string): OAuthTokenManager => {
    let manager = oauthByEnv.get(envId)
    if (manager === undefined) {
      manager = createOAuthTokenManager({
        fetch: (input, init) => network.fetchFor(envId)(input, init),
        now: () => new Date(),
        credentials: async (id) => {
          const environment = repo.getEnvironment(id)
          const clientSecret = secrets.read(id, 'oauthClientSecret')
          if (environment.oauthClientId === null || clientSecret === null) return null
          return {
            ssoUrl: environment.ssoUrl ?? DEFAULT_SSO_URL,
            clientId: environment.oauthClientId,
            clientSecret,
            scopes: environment.oauthScopes,
            accountUuid: environment.accountUuid
          }
        }
      })
      oauthByEnv.set(envId, manager)
    }
    return manager
  }
  const oauth: OAuthTokenManager = {
    getToken: (envId) => managerFor(envId).getToken(envId),
    invalidate: (envId) => oauthByEnv.get(envId)?.invalidate(envId),
    expiresAt: (envId) => oauthByEnv.get(envId)?.expiresAt(envId) ?? null
  }

  const client = createDtClient({
    fetchFor: (envId) => network.fetchFor(envId),
    getEnvironment: (envId) => repo.getEnvironment(envId),
    readSecret: (envId, kind) => secrets.read(envId, kind),
    oauth,
    sleep: (ms) => sleep(ms),
    now: () => new Date(),
    random: Math.random,
    logger: deps.logger,
    tlsFailure: (envId, host) => network.tlsFailure(envId, host)
  })

  const onEnvironmentChanged = (envId: string): void => {
    oauth.invalidate(envId)
    oauthByEnv.delete(envId)
    status.clear(envId)
    network.reset(envId)
  }

  return {
    client,
    onEnvironmentChanged,
    connectionDeps: {
      async testConnection(envId) {
        network.clearFailures(envId)
        const report = await testConnection(envId, {
          client,
          oauth,
          getEnvironment: (id) => repo.getEnvironment(id),
          secretsStatus: (id) => secrets.status(id),
          readSecret: (id, kind) => secrets.read(id, kind)
        })
        return { ...report, untrustedCertificates: network.untrusted(envId) }
      },
      status,
      pins,
      repo,
      onChanged: onEnvironmentChanged
    }
  }
}
