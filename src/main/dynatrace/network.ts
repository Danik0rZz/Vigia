import { session, type Session } from 'electron'
import type { UntrustedCertificate } from '@shared/dynatrace'
import type { CertificateLevel } from '@shared/tenants'
import type { PinStore } from './pins'
import { queuesRequests, verifyCertificate } from './tls'

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
  /**
   * Si el verificador rechazó esa huella para ese host en la última prueba
   * (lo que `untrusted` ofreció) y el host sigue siendo del entorno o de su
   * SSO. Lo único que `certificates:pin` acepta.
   */
  wasOffered(envId: string, host: string, fingerprint: string): boolean
}

const hostnameOf = (host: string): string => new URL(`https://${host}`).hostname

/**
 * Estado de un host (con puerto) dentro de una sesión: si ya ha entrado una petición y la que está
 * en curso sola (las demás la esperan).
 */
interface HostGate {
  verified: boolean
  pending: Promise<void> | null
}

const urlOf = (input: string | URL | Request): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url

/** Espera a `pending` o lanza si `signal` se aborta antes (como lo haría el propio `fetch`). */
function waitFor(pending: Promise<void>, signal: AbortSignal | null | undefined): Promise<void> {
  if (signal === null || signal === undefined) return pending
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise<void>((resolve, reject) => {
    const onAbort = (): void => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    void pending.then(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    })
  })
}

/**
 * `fetch` de una sesión en el que la primera petición a cada host va sola: dos conexiones nuevas a
 * la vez al mismo host pueden saltarse el verificador de la app (ficha 0079). Las demás peticiones a
 * ese host esperan a que acabe; si entra, ya van todas a la vez; si falla, la siguiente vuelve a ir
 * sola. No reintenta nada: cada petición sale una vez y su error es el suyo.
 *
 * Si `queued(host)` dice que sí (host con huella fijada, ficha 0095), van todas de una en una,
 * también después de la primera: si la sesión olvida la decisión del verificador, nunca hay dos
 * conexiones nuevas a la vez a ese host.
 *
 * Mientras espera solo se respeta `init.signal`: un `Request` con señal propia y sin `init.signal`
 * no se puede abortar hasta que le toca (la app siempre pasa la señal en `init`). Y el tiempo de
 * espera cuenta en el plazo de cada petición: las que esperan gastan el suyo.
 */
function gatedFetch(ses: Session, queued: (host: string) => boolean): typeof fetch {
  const gates = new Map<string, HostGate>()
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof URL ? input.toString() : input
    const host = new URL(urlOf(input)).host
    let gate = gates.get(host)
    if (gate === undefined) {
      gate = { verified: false, pending: null }
      gates.set(host, gate)
    }
    const inQueue = queued(host)
    while ((inQueue || !gate.verified) && gate.pending !== null) {
      await waitFor(gate.pending, init?.signal)
    }
    if (gate.verified && !inQueue) return ses.fetch(request, init)

    let release = (): void => undefined
    gate.pending = new Promise<void>((resolve) => {
      release = resolve
    })
    try {
      const response = await ses.fetch(request, init)
      gate.verified = true
      return response
    } finally {
      gate.pending = null
      release()
    }
  }) as typeof fetch
}

/**
 * Una sesión de red en memoria por entorno (sin `persist:`: no deja cookies ni
 * caché en disco), con su propio verificador de certificados según el nivel
 * del entorno y sus huellas fijadas.
 */
export function createEnvironmentNetwork(deps: {
  certificateLevel(envId: string): CertificateLevel
  /** Nombres de host de la API clásica y de plataforma del entorno (los únicos que "ignorar" acepta). */
  environmentHosts(envId: string): string[]
  /** Nombre del host del SSO del entorno, o null sin OAuth. Se puede fijar, nunca ignorar. */
  ssoHost?(envId: string): string | null
  pins: PinStore
}): EnvironmentNetwork {
  const sessions = new Map<string, { session: Session; fetch: typeof fetch }>()
  const generations = new Map<string, number>()
  /** Certificados rechazados por entorno y nombre de host (el verificador no ve el puerto). */
  const observed = new Map<string, Map<string, Observed>>()
  /** Host con puerto de cada nombre de host que ha fallado, visto desde el cliente. */
  const failedHosts = new Map<string, Map<string, string>>()
  /**
   * Lo último que `untrusted` ofreció por entorno. Sobrevive a `reset` (fijar
   * una huella renueva la sesión y no debe invalidar las demás ofrecidas) y se
   * olvida al empezar otra prueba.
   */
  const offered = new Map<string, UntrustedCertificate[]>()

  function observedFor(envId: string): Map<string, Observed> {
    let map = observed.get(envId)
    if (map === undefined) {
      map = new Map()
      observed.set(envId, map)
    }
    return map
  }

  function sessionFor(envId: string): { session: Session; fetch: typeof fetch } {
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
    const entry = { session: ses, fetch: gatedFetch(ses, (host) => queued(envId, host)) }
    sessions.set(envId, entry)
    return entry
  }

  /** Huellas fijadas del entorno para un nombre de host (sin puerto). */
  function pinsFor(envId: string, hostname: string): string[] {
    return deps.pins
      .list(envId)
      .filter((pin) => hostnameOf(pin.host) === hostname)
      .map((pin) => pin.fingerprint)
  }

  /**
   * Si las peticiones a `host` (con puerto) van en fila, con los datos del verificador. Si algo
   * falla al leerlos (por ejemplo, el entorno se ha borrado), en fila: es lo más seguro.
   */
  function queued(envId: string, host: string): boolean {
    try {
      const hostname = hostnameOf(host)
      return queuesRequests({
        level: deps.certificateLevel(envId),
        pins: pinsFor(envId, hostname),
        hostname,
        envHosts: deps.environmentHosts(envId)
      })
    } catch {
      return true
    }
  }

  /** Decisión del verificador para un certificado (ACCEPT, REJECT o USE_CHROMIUM). */
  function decide(
    envId: string,
    request: { hostname: string; errorCode: number; certificate: { fingerprint: string } }
  ): number {
    const pins = pinsFor(envId, request.hostname)
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
        sessionFor(envId).fetch(input, init)) as typeof fetch
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
      offered.delete(envId)
    },

    untrusted(envId) {
      const seen = observed.get(envId)
      const certificates = [
        ...(failedHosts.get(envId) ?? new Map<string, string>()).entries()
      ].flatMap(([hostname, host]) => {
        const entry = seen?.get(hostname)
        return entry === undefined ? [] : [{ host, ...entry }]
      })
      offered.set(envId, certificates)
      return certificates
    },

    wasOffered(envId, host, fingerprint) {
      // Si la URL del entorno (o la del SSO) ha cambiado, lo ofrecido para el host anterior caduca.
      const pinnable = [...deps.environmentHosts(envId), deps.ssoHost?.(envId) ?? null]
      if (!pinnable.includes(hostnameOf(host))) return false
      return (offered.get(envId) ?? []).some(
        (certificate) => certificate.host === host && certificate.fingerprint === fingerprint
      )
    }
  }
}
