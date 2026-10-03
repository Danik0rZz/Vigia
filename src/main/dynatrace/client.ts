import { z, type ZodType } from 'zod'
import type { Environment, SecretKind } from '@shared/tenants'
import { DtError } from './errors'
import type { OAuthTokenManager } from './oauth'
import { parseRetryAfter } from './retry-after'

const DEFAULT_TIMEOUT_MS = 30_000
const MAX_RATE_LIMIT_RETRIES = 3
const MAX_WAIT_MS = 60_000
const BASE_BACKOFF_MS = 1_000
const MAX_JITTER_MS = 250

/** API de destino: la clásica (/api/v2) o la de plataforma (/platform/...). */
export type DtApi = 'classic' | 'platform'
/** Credencial con que se firma la petición; por defecto la decide `api`. */
export type DtAuth = 'classicToken' | 'oauth' | 'platformToken'

type Query = Record<string, string | number | boolean | readonly string[] | undefined>

export interface DtRequestOptions<T> {
  envId: string
  api: DtApi
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  /** classic: relativo a `<url>/api/v2`; platform: absoluto desde la URL de plataforma. */
  path: string
  query?: Query
  body?: unknown
  schema: ZodType<T>
  timeoutMs?: number
  auth?: DtAuth
}

export interface DtPaginateOptions<T> extends Omit<DtRequestOptions<T>, 'schema'> {
  /** Esquema de cada elemento de la lista. */
  schema: ZodType<T>
  /** Propiedad de la respuesta con la lista (`problems`, `slo`…). */
  itemsKey: string
  maxPages?: number
  /** Parámetros que se repiten en las páginas siguientes (en /problems, `fields`). */
  keepParams?: string[]
}

export interface DtClient {
  dtRequest<T>(options: DtRequestOptions<T>): Promise<T>
  paginate<T>(options: DtPaginateOptions<T>): Promise<T[]>
}

type MaybePromise<T> = T | Promise<T>

export interface DtClientDeps {
  /** `fetch` de la sesión de red del entorno (certificados por entorno). */
  fetchFor(envId: string): typeof fetch
  getEnvironment(envId: string): MaybePromise<Environment | null | undefined>
  readSecret(envId: string, kind: SecretKind): MaybePromise<string | null>
  oauth: OAuthTokenManager
  sleep(ms: number): Promise<void>
  now(): Date
  random(): number
  logger: { warn(...args: unknown[]): void; error(...args: unknown[]): void }
  timeoutMs?: number
  /** Por qué se rechazó el certificado de un host: huella cambiada o no confiable. */
  tlsFailure?(envId: string, host: string): 'untrusted' | 'mismatch'
}

/** Cuerpo de error de la API v2 y de plataforma: { error: { code, message, details } }. */
const errorBodySchema = z.object({
  error: z.object({
    message: z.string().optional(),
    details: z.object({ missingScopes: z.array(z.string()).optional() }).optional()
  })
})

function buildQuery(query: Query | undefined): string {
  if (query === undefined) return ''
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue
    if (Array.isArray(value)) for (const item of value) params.append(key, String(item))
    else params.append(key, String(value))
  }
  const text = params.toString()
  return text === '' ? '' : `?${text}`
}

async function readErrorMessage(response: Response): Promise<string> {
  const parsed = errorBodySchema.safeParse(await response.json().catch(() => null))
  if (!parsed.success) return `HTTP ${response.status}`
  const { message, details } = parsed.data.error
  const missing = details?.missingScopes ?? []
  return [
    message ?? `HTTP ${response.status}`,
    missing.length > 0 ? `missingScopes: ${missing.join(', ')}` : ''
  ]
    .filter((part) => part !== '')
    .join(' · ')
}

function errorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  const cause = error.cause instanceof Error ? ` ${error.cause.message}` : ''
  return `${error.message}${cause}`
}

/**
 * Cliente HTTP de Dynatrace. Elige la credencial según la API, reintenta lo que
 * tiene sentido reintentar (401 con OAuth, 429) y traduce todo a `DtError`.
 * Nunca registra cabeceras ni cuerpos.
 */
export function createDtClient(deps: DtClientDeps): DtClient {
  const defaultTimeout = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS

  async function environmentOf(envId: string): Promise<Environment> {
    let environment: Environment | null | undefined
    try {
      environment = await deps.getEnvironment(envId)
    } catch {
      environment = null
    }
    if (environment === null || environment === undefined) {
      throw new DtError('NO_CREDENTIAL', 'El entorno no existe.')
    }
    return environment
  }

  async function secretOrFail(envId: string, kind: SecretKind, what: string): Promise<string> {
    const value = await deps.readSecret(envId, kind)
    if (value === null || value === '')
      throw new DtError('NO_CREDENTIAL', `El entorno no tiene ${what}.`)
    return value
  }

  /** Cabecera Authorization y si es de OAuth (la única que se renueva ante un 401). */
  async function authorization(
    envId: string,
    api: DtApi,
    auth: DtAuth | undefined
  ): Promise<{ header: string; oauth: boolean }> {
    const mode: DtAuth =
      auth ??
      (api === 'classic'
        ? 'classicToken'
        : (await deps.readSecret(envId, 'platformToken')) !== null
          ? 'platformToken'
          : 'oauth')
    switch (mode) {
      case 'classicToken':
        return {
          header: `Api-Token ${await secretOrFail(envId, 'classicToken', 'token clásico')}`,
          oauth: false
        }
      case 'platformToken':
        return {
          header: `Bearer ${await secretOrFail(envId, 'platformToken', 'platform token')}`,
          oauth: false
        }
      case 'oauth':
        return { header: `Bearer ${(await deps.oauth.getToken(envId)).accessToken}`, oauth: true }
    }
  }

  async function send(
    envId: string,
    url: string,
    init: RequestInit,
    timeoutMs: number
  ): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      return await deps.fetchFor(envId)(url, { ...init, signal: controller.signal })
    } catch (error) {
      const text = errorText(error)
      const name = error instanceof Error ? error.name : ''
      if (controller.signal.aborted || name === 'AbortError' || name === 'TimeoutError') {
        throw new DtError('TIMEOUT', `Sin respuesta en ${Math.round(timeoutMs / 1000)} s.`)
      }
      if (/ERR_CERT|ERR_SSL/i.test(text)) {
        const host = new URL(url).host
        const reason = deps.tlsFailure?.(envId, host) ?? 'untrusted'
        throw new DtError(
          reason === 'mismatch' ? 'TLS_PIN_MISMATCH' : 'TLS_UNTRUSTED',
          reason === 'mismatch'
            ? `El certificado de ${host} no coincide con la huella fijada.`
            : `El certificado de ${host} no es de confianza.`
        )
      }
      throw new DtError('NETWORK', `Error de red: ${text}`)
    } finally {
      clearTimeout(timer)
    }
  }

  async function dtRequest<T>(options: DtRequestOptions<T>): Promise<T> {
    const { envId, api, path, schema } = options
    const method = options.method ?? 'GET'
    const environment = await environmentOf(envId)
    const base = api === 'classic' ? environment.classicApiUrl : environment.platformUrl
    if (base === null) {
      throw new DtError(
        'NO_CREDENTIAL',
        api === 'classic' ? 'Falta la URL de la API clásica.' : 'Falta la URL de plataforma.'
      )
    }
    // Concatenación, no new URL(path, base): en Managed la base lleva /e/<id>.
    const url = `${base}${api === 'classic' ? '/api/v2' : ''}${path}${buildQuery(options.query)}`
    const timeoutMs = options.timeoutMs ?? defaultTimeout

    let auth = await authorization(envId, api, options.auth)
    let renewedOAuth = false
    let rateLimitRetries = 0

    for (;;) {
      const headers: Record<string, string> = {
        authorization: auth.header,
        accept: 'application/json'
      }
      const init: RequestInit = { method, headers }
      if (options.body !== undefined) {
        headers['content-type'] = 'application/json; charset=utf-8'
        init.body = JSON.stringify(options.body)
      }

      const response = await send(envId, url, init, timeoutMs)

      if (response.status === 401) {
        if (auth.oauth && !renewedOAuth) {
          renewedOAuth = true
          deps.oauth.invalidate(envId)
          auth = await authorization(envId, api, 'oauth')
          continue
        }
        throw new DtError('UNAUTHORIZED', await readErrorMessage(response), 401)
      }

      if (response.status === 429) {
        const retryAfter = parseRetryAfter(response.headers.get('retry-after'), deps.now())
        if (
          rateLimitRetries >= MAX_RATE_LIMIT_RETRIES ||
          (retryAfter !== null && retryAfter > MAX_WAIT_MS)
        ) {
          throw new DtError(
            'RATE_LIMITED',
            'Dynatrace limita las peticiones; prueba más tarde.',
            429
          )
        }
        const wait =
          retryAfter ??
          Math.min(
            MAX_WAIT_MS,
            BASE_BACKOFF_MS * 2 ** rateLimitRetries + deps.random() * MAX_JITTER_MS
          )
        rateLimitRetries += 1
        deps.logger.warn(
          `Dynatrace 429 en ${method} ${path}; reintento ${rateLimitRetries} en ${Math.round(wait)} ms`
        )
        await deps.sleep(wait)
        continue
      }

      if (!response.ok) {
        const message = await readErrorMessage(response)
        const code =
          response.status === 403
            ? 'FORBIDDEN'
            : response.status === 404
              ? 'NOT_FOUND'
              : response.status >= 500
                ? 'SERVER_ERROR'
                : 'INVALID_RESPONSE'
        const error = new DtError(code, message, response.status)
        deps.logger.error(`Dynatrace ${response.status} en ${method} ${path}: ${error.message}`)
        throw error
      }

      let json: unknown
      try {
        json = await response.json()
      } catch {
        throw new DtError('INVALID_RESPONSE', 'La respuesta no es JSON.', response.status)
      }
      const parsed = schema.safeParse(json)
      if (!parsed.success) {
        throw new DtError(
          'INVALID_RESPONSE',
          `La respuesta no tiene el formato esperado (${path}).`,
          response.status
        )
      }
      return parsed.data
    }
  }

  async function paginate<T>(options: DtPaginateOptions<T>): Promise<T[]> {
    const { itemsKey, schema, maxPages = 20, keepParams = [], ...request } = options
    const pageSchema = z.object({
      nextPageKey: z.string().nullable().optional(),
      [itemsKey]: z.array(schema)
    })
    const items: T[] = []
    let query = request.query
    for (let page = 0; page < maxPages; page += 1) {
      const result = (await dtRequest({ ...request, query, schema: pageSchema })) as Record<
        string,
        unknown
      > & { nextPageKey?: string | null }
      items.push(...(result[itemsKey] as T[]))
      const next = result.nextPageKey
      if (next === null || next === undefined || next === '') break
      const kept = Object.fromEntries(
        keepParams.flatMap((key) =>
          request.query?.[key] === undefined ? [] : [[key, request.query[key]]]
        )
      )
      query = { ...kept, nextPageKey: next }
    }
    return items
  }

  return { dtRequest, paginate }
}
