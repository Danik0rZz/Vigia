import { setTimeout as sleepFor } from 'node:timers/promises'
import { classicApiUrlSchema, type Environment } from '@shared/tenants'
import { createDtClient, type DtClient } from '../main/dynatrace/client'
import { DtError } from '../main/dynatrace/errors'
import { maskSecrets } from '../main/dynatrace/mask'
import { parseRetryAfter } from '../main/dynatrace/retry-after'
import type { LiveEnv } from './live-env'

/** Id ficticio del entorno de pruebas: el cliente solo lo usa como clave. */
export const LIVE_ENV_ID = '00000000-0000-4000-8000-00000000c0de'

/** 3 peticiones por segundo como mucho. */
const DEFAULT_MIN_INTERVAL_MS = 334

/** Única petición no GET permitida: comprobar el token (no cambia nada en el tenant). */
const LOOKUP_PATH = '/api/v2/apiTokens/lookup'

export interface LiveClientOptions {
  fetch?: typeof fetch
  /** Tiempo mínimo entre el inicio de una petición y el de la siguiente. */
  minIntervalMs?: number
  sleep?: (ms: number) => Promise<void>
  /** Milisegundos desde epoch. */
  now?: () => number
}

export interface LiveClient {
  client: DtClient
  /** Mensajes del log del cliente, ya enmascarados (para comprobar que no hay fugas). */
  logged: string[]
  /** Peticiones que han llegado a la red y máximo de peticiones simultáneas. */
  stats: { requests: number; maxInFlight: number }
}

function readOnlyError(): Error {
  return Object.assign(new Error('LIVE_READ_ONLY'), { code: 'LIVE_READ_ONLY' })
}

export interface ReadOnlyFetchOptions {
  /** URL base del entorno (la de la API clásica, sin /api/v2). */
  origin: string
  minIntervalMs?: number
  /** Por defecto, espera real. */
  sleep?: (ms: number) => Promise<void>
  /** Milisegundos desde epoch; por defecto, Date.now. */
  now?: () => number
}

const realSleep = (ms: number): Promise<void> => sleepFor(ms).then(() => undefined)

/**
 * ¿Se puede enviar? Solo al tenant (mismo https, host y puerto, sin
 * credenciales en la URL, dentro de su ruta base) y solo GET, salvo el POST a
 * la URL EXACTA de apiTokens/lookup (comparada como texto: sin query,
 * fragmento, mayúsculas, "..", %2F ni barra final).
 */
function isAllowed(rawUrl: string, method: string, base: URL): boolean {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return false
  }
  const basePath = base.pathname.replace(/\/+$/, '')
  if (
    url.protocol !== 'https:' ||
    url.origin !== base.origin ||
    url.username !== '' ||
    url.password !== '' ||
    !url.pathname.startsWith(`${basePath}/`)
  ) {
    return false
  }
  if (method === 'GET') return true
  return method === 'POST' && rawUrl === `${base.origin}${basePath}${LOOKUP_PATH}`
}

/**
 * Fetch de las pruebas en vivo: SOLO LECTURA (GET al tenant y el POST de
 * apiTokens/lookup; lo demás se rechaza antes de llegar a la red y sin contar
 * como petición) y en serie, con un intervalo mínimo entre peticiones y
 * respetando el Retry-After de los 429. El token tiene permisos de escritura:
 * esta guarda es la única barrera.
 */
export function createReadOnlyFetch(
  base: typeof fetch,
  options: ReadOnlyFetchOptions
): { fetch: typeof fetch; stats: LiveClient['stats'] } {
  const stats = { requests: 0, maxInFlight: 0 }
  const tenant = new URL(options.origin)
  const minIntervalMs = options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS
  const sleep = options.sleep ?? realSleep
  const now = options.now ?? Date.now
  let queue: Promise<unknown> = Promise.resolve()
  let nextStart = Number.NEGATIVE_INFINITY
  let inFlight = 0

  const guarded: typeof fetch = (input, init) => {
    const request = input instanceof Request ? input : null
    const method = (init?.method ?? request?.method ?? 'GET').toUpperCase()
    const rawUrl = request?.url ?? (input instanceof URL ? input.href : String(input))
    // Rechazada: no entra en la cola ni cuenta como petición.
    if (!isAllowed(rawUrl, method, tenant)) return Promise.reject(readOnlyError())

    const run = queue.then(async () => {
      const wait = nextStart - now()
      if (wait > 0) await sleep(wait)
      nextStart = now() + minIntervalMs
      stats.requests += 1
      inFlight += 1
      stats.maxInFlight = Math.max(stats.maxInFlight, inFlight)
      try {
        // Sin seguir redirecciones: un 307/308 repetiría el método, el cuerpo y el
        // token hacia una URL que la guarda no ha visto. Una redirección es un error.
        const response =
          request === null
            ? await base(input, { ...init, redirect: 'error' })
            : await base(new Request(request, { ...init, redirect: 'error' }))
        if (response.status === 429) {
          const retryAfter = parseRetryAfter(response.headers.get('retry-after'), new Date(now()))
          if (retryAfter !== null) nextStart = Math.max(nextStart, now() + retryAfter)
        }
        return response
      } finally {
        inFlight -= 1
      }
    })
    queue = run.catch(() => undefined)
    return run
  }
  return { fetch: guarded, stats }
}

/**
 * Cliente de Dynatrace para las pruebas en vivo: el mismo `createDtClient` que
 * la app, sobre un fetch de solo lectura y con limitador. Solo usa el token
 * clásico. En los tests unitarios se inyectan fetch, sleep y now.
 */
export function createLiveClient(env: LiveEnv, options: LiveClientOptions = {}): LiveClient {
  const sleep = options.sleep ?? realSleep
  const now = options.now ?? Date.now
  const classicApiUrl = classicApiUrlSchema.parse(env.url)
  const { fetch: fetchLive, stats } = createReadOnlyFetch(options.fetch ?? fetch, {
    origin: classicApiUrl,
    sleep,
    now,
    ...(options.minIntervalMs === undefined ? {} : { minIntervalMs: options.minIntervalMs })
  })
  const logged: string[] = []
  const log = (...args: unknown[]): void => {
    logged.push(maskSecrets(args.map(String).join(' ')))
  }
  const environment: Environment = {
    id: LIVE_ENV_ID,
    clientId: LIVE_ENV_ID,
    name: 'live',
    type: 'other',
    deployment: 'saas',
    classicApiUrl,
    platformUrl: null,
    ssoUrl: null,
    oauthClientId: null,
    oauthScopes: [],
    accountUuid: null,
    certificateLevel: 'system',
    captureUrlPatterns: [],
    tags: [],
    readOnly: true
  }
  const client = createDtClient({
    fetchFor: () => fetchLive,
    getEnvironment: () => environment,
    readSecret: (_envId, kind) => (kind === 'classicToken' ? env.token : null),
    oauth: {
      getToken: () =>
        Promise.reject(new DtError('NO_CREDENTIAL', 'Sin OAuth en las pruebas en vivo.')),
      invalidate: () => undefined,
      expiresAt: () => null
    },
    sleep,
    now: () => new Date(now()),
    random: Math.random,
    logger: { warn: log, error: log }
  })
  return { client, logged, stats }
}
