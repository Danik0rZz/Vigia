import { session, type Session } from 'electron'
import type { UntrustedCertificate } from '@shared/dynatrace'
import type { CertificateLevel } from '@shared/tenants'
import type { PinStore } from './pins'
import { verifyCertificate } from './tls'

/** Valores del callback de `setCertificateVerifyProc`. */
const ACCEPT = 0
const REJECT = -2
const USE_CHROMIUM = -3

interface Observed {
  fingerprint: string
  reason: 'untrusted' | 'mismatch'
  previousFingerprint: string | null
}

export interface EnvironmentNetwork {
  /** `fetch` de la sesión del entorno: red de Chromium con su verificación de certificados. */
  fetchFor(envId: string): typeof fetch
  /**
   * Crea una sesión nueva para el entorno. Hace falta al cambiar el nivel o las
   * huellas: Electron cachea el resultado de la verificación y no ofrece forma
   * de borrarlo (ver CLAUDE.md, "Cosas que ya se aprendieron").
   */
  reset(envId: string): void
  /** Por qué falló el certificado de `host` (con puerto) en la última petición. */
  tlsFailure(envId: string, host: string): 'untrusted' | 'mismatch' | null
  /** Antes de "Probar conexión": olvida qué hosts fallaron en la prueba anterior. */
  clearFailures(envId: string): void
  /** Certificados rechazados de los hosts que han fallado desde `clearFailures`. */
  untrusted(envId: string): UntrustedCertificate[]
}

const hostnameOf = (host: string): string => new URL(`https://${host}`).hostname

/**
 * Una sesión de red en memoria por entorno (sin `persist:`: no deja cookies ni
 * caché en disco), con su propio verificador de certificados según el nivel
 * del entorno y sus huellas fijadas.
 */
export function createEnvironmentNetwork(deps: {
  certificateLevel(envId: string): CertificateLevel
  /** Nombres de host de la API clásica y de plataforma del entorno (los únicos que "ignorar" acepta). */
  environmentHosts(envId: string): string[]
  pins: PinStore
}): EnvironmentNetwork {
  const sessions = new Map<string, Session>()
  const generations = new Map<string, number>()
  /** Certificados rechazados por entorno y nombre de host (el verificador no ve el puerto). */
  const observed = new Map<string, Map<string, Observed>>()
  /** Host con puerto de cada nombre de host que ha fallado, visto desde el cliente. */
  const failedHosts = new Map<string, Map<string, string>>()

  function observedFor(envId: string): Map<string, Observed> {
    let map = observed.get(envId)
    if (map === undefined) {
      map = new Map()
      observed.set(envId, map)
    }
    return map
  }

  function sessionFor(envId: string): Session {
    const existing = sessions.get(envId)
    if (existing !== undefined) return existing

    const generation = generations.get(envId) ?? 0
    const ses = session.fromPartition(`env-${envId}-${generation}`)
    // El verificador se pone antes de la primera petición de esta sesión.
    ses.setCertificateVerifyProc((request, callback) => {
      // Si algo falla (por ejemplo, el entorno se ha borrado con una petición en
      // curso), se rechaza: el callback siempre responde y nunca se acepta por error.
      try {
        callback(decide(envId, request))
      } catch {
        callback(REJECT)
      }
    })
    sessions.set(envId, ses)
    return ses
  }

  /** Decisión del verificador para un certificado (ACCEPT, REJECT o USE_CHROMIUM). */
  function decide(
    envId: string,
    request: { hostname: string; errorCode: number; certificate: { fingerprint: string } }
  ): number {
    const pins = deps.pins
      .list(envId)
      .filter((pin) => hostnameOf(pin.host) === request.hostname)
      .map((pin) => pin.fingerprint)
    const fingerprint = request.certificate.fingerprint
    const chromiumOk = request.errorCode === 0
    const decision = verifyCertificate({
      level: deps.certificateLevel(envId),
      pins,
      fingerprint,
      chromiumOk,
      hostname: request.hostname,
      envHosts: deps.environmentHosts(envId)
    })

    const seen = observedFor(envId)
    if (decision === 'reject') {
      seen.set(request.hostname, {
        fingerprint,
        reason: 'mismatch',
        previousFingerprint: pins[0] ?? null
      })
    } else if (decision === 'chromium' && !chromiumOk) {
      seen.set(request.hostname, { fingerprint, reason: 'untrusted', previousFingerprint: null })
    } else {
      seen.delete(request.hostname)
    }

    return decision === 'accept' ? ACCEPT : decision === 'reject' ? REJECT : USE_CHROMIUM
  }

  return {
    fetchFor(envId) {
      return ((input: string | URL | Request, init?: RequestInit) =>
        sessionFor(envId).fetch(
          input instanceof URL ? input.toString() : input,
          init
        )) as typeof fetch
    },

    reset(envId) {
      sessions.delete(envId)
      generations.set(envId, (generations.get(envId) ?? 0) + 1)
      observed.delete(envId)
      failedHosts.delete(envId)
    },

    tlsFailure(envId, host) {
      const hostname = hostnameOf(host)
      let hosts = failedHosts.get(envId)
      if (hosts === undefined) {
        hosts = new Map()
        failedHosts.set(envId, hosts)
      }
      hosts.set(hostname, host)
      return observed.get(envId)?.get(hostname)?.reason ?? null
    },

    clearFailures(envId) {
      // Lo observado por el verificador se conserva mientras dure la sesión:
      // Chromium cachea el rechazo y no vuelve a llamar al verificador.
      failedHosts.delete(envId)
    },

    untrusted(envId) {
      const seen = observed.get(envId)
      return [...(failedHosts.get(envId) ?? new Map<string, string>()).entries()].flatMap(
        ([hostname, host]) => {
          const entry = seen?.get(hostname)
          return entry === undefined ? [] : [{ host, ...entry }]
        }
      )
    }
  }
}
