import type { ConnectionReport, UntrustedCertificate } from '@shared/dynatrace'
import { DomainError } from '../../errors'
import type { PinStore } from '../../dynatrace/pins'
import type { ConnectionStatusStore } from '../../dynatrace/status'
import type { TenantRepository } from '../../tenants/repository'
import type { IpcImplementations } from '../handler'

type ConnectionChannels =
  | 'connection:test'
  | 'connection:status'
  | 'certificates:list'
  | 'certificates:pin'
  | 'certificates:unpin'

export interface ConnectionHandlerDeps {
  testConnection(
    envId: string
  ): Promise<ConnectionReport & { untrustedCertificates: UntrustedCertificate[] }>
  status: ConnectionStatusStore
  pins: PinStore
  repo: TenantRepository
  /** Si la última prueba ofreció esa huella para ese host (ver `EnvironmentNetwork.wasOffered`). */
  wasOffered(envId: string, host: string, fingerprint: string): boolean
  /** Algo del entorno ha cambiado: token OAuth, estado y sesión de red se renuevan. */
  onChanged(envId: string): void
}

/** "Probar conexión", su último resultado y las huellas de certificado fijadas. */
export function createConnectionHandlers(
  deps: ConnectionHandlerDeps
): Pick<IpcImplementations, ConnectionChannels> {
  const { repo, pins } = deps

  return {
    'connection:test': async ({ environmentId }) => {
      repo.getEnvironment(environmentId)
      const result = await deps.testConnection(environmentId)
      // El estado de la tarjeta no guarda los certificados: solo el resultado.
      deps.status.set(environmentId, {
        checkedAt: result.checkedAt,
        mechanisms: result.mechanisms,
        oauthExpiresAt: result.oauthExpiresAt
      })
      return result
    },
    'connection:status': ({ environmentId }) => deps.status.get(environmentId),
    'certificates:list': ({ environmentId }) => {
      repo.getEnvironment(environmentId)
      return pins.list(environmentId)
    },
    'certificates:pin': ({ environmentId, host, fingerprint }) => {
      const environment = repo.getEnvironment(environmentId)
      // Solo una huella que el verificador vio para ese host: el renderer no
      // puede fijar una cualquiera.
      if (!deps.wasOffered(environmentId, host, fingerprint)) {
        throw new DomainError(
          'CONFLICT',
          'CERTIFICATE_NOT_OBSERVED: esa huella no es la que se vio para ese host en la última prueba de conexión.'
        )
      }
      pins.pin(environmentId, host, fingerprint)
      // Aceptar una huella con el nivel "sistema" activa el nivel "huella fijada".
      if (environment.certificateLevel === 'system') {
        repo.updateEnvironment(environmentId, { ...environment, certificateLevel: 'pinned' })
      }
      deps.onChanged(environmentId)
      return { ok: true }
    },
    'certificates:unpin': ({ environmentId, host }) => {
      repo.getEnvironment(environmentId)
      pins.unpin(environmentId, host)
      deps.onChanged(environmentId)
      return { ok: true }
    }
  }
}
