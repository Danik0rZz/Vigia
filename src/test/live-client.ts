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

/** Única escritura permitida: comprobar el token (no cambia nada en el tenant). */
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

/**
 * Fetch de las pruebas en vivo: SOLO LECTURA (GET y el POST de apiTokens/lookup;
 * lo demás se rechaza antes de llegar a la red) y en serie, con un intervalo
 * mínimo entre peticiones y respetando el Retry-After de los 429.
 */
function guardedFetch(
  base: typeof fetch,
  options: { minIntervalMs: number; sleep: (ms: number) => Promise<void>; now: () => number },
  stats: LiveClient['stats']
): typeof fetch {
  let queue: Promise<unknown> = Promise.resolve()
  let nextStart = Number.NEGATIVE_INFINITY
  let inFlight = 0

  return (input, init) => {
    const request = input instanceof Request ? input : null
    const method = (init?.method ?? request?.method ?? 'GET').toUpperCase()
    const url = new URL(request?.url ?? String(input))
    const allowed = method === 'GET' || (method === 'POST' && url.pathname === LOOKUP_PATH)
    // Rechazada: no entra en la cola ni cuenta como petición.
    if (!allowed) return Promise.reject(readOnlyError())

    const run = queue.then(async () => {
      const wait = nextStart - options.now()
      if (wait > 0) await options.sleep(wait)
      nextStart = options.now() + options.minIntervalMs
      stats.requests += 1
      inFlight += 1
      stats.maxInFlight = Math.max(stats.maxInFlight, inFlight)
      try {
        const response = await base(input, init)
        if (response.status === 429) {
          const retryAfter = parseRetryAfter(
            response.headers.get('retry-after'),
            new Date(options.now())
          )
          if (retryAfter !== null) nextStart = Math.max(nextStart, options.now() + retryAfter)
        }
        return response
      } finally {
        inFlight -= 1
      }
    })
    queue = run.catch(() => undefined)
    return run
  }
}

/**
 * Cliente de Dynatrace para las pruebas en vivo: el mismo `createDtClient` que
 * la app, sobre un fetch de solo lectura y con limitador. Solo usa el token
 * clásico. En los tests unitarios se inyectan fetch, sleep y now.
 */
export function createLiveClient(env: LiveEnv, options: LiveClientOptions = {}): LiveClient {
  const sleep = options.sleep ?? ((ms: number) => sleepFor(ms).then(() => undefined))
  const now = options.now ?? (() => Date.now())
  const stats = { requests: 0, maxInFlight: 0 }
  const fetchLive = guardedFetch(
    options.fetch ?? fetch,
    { minIntervalMs: options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS, sleep, now },
    stats
  )
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
    classicApiUrl: classicApiUrlSchema.parse(env.url),
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
