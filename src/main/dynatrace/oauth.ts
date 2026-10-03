import { z } from 'zod'
import { DtError } from './errors'

/** Margen con el que se renueva el token antes de que caduque. */
const RENEW_MARGIN_MS = 60_000
const SSO_TIMEOUT_MS = 30_000

export interface OAuthCredentials {
  ssoUrl: string
  clientId: string
  clientSecret: string
  scopes: string[]
  accountUuid: string | null
}

export interface OAuthToken {
  accessToken: string
  expiresAt: Date
  /** Scopes que concede el SSO (`scope` de la respuesta); vacío si no lo indica. */
  grantedScopes: string[]
}

export interface OAuthTokenManager {
  getToken(envId: string): Promise<OAuthToken>
  /** La siguiente llamada pide un token nuevo (cambio de entorno, de secretos o un 401). */
  invalidate(envId: string): void
  expiresAt(envId: string): Date | null
}

/** Respuesta del SSO (OAuth 2.0, client_credentials). */
const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
  scope: z.string().optional()
})

/**
 * Tokens OAuth de plataforma: solo en memoria y por entorno. Se usa el
 * `expires_in` de la respuesta y se renueva cuando quedan menos de 60 s. Las
 * peticiones simultáneas comparten una única renovación.
 */
export function createOAuthTokenManager(deps: {
  fetch: typeof fetch
  now: () => Date
  credentials: (envId: string) => Promise<OAuthCredentials | null>
}): OAuthTokenManager {
  const tokens = new Map<string, OAuthToken>()
  const pending = new Map<string, Promise<OAuthToken>>()
  /** Se incrementa al invalidar: una renovación iniciada antes no se guarda. */
  const generation = new Map<string, number>()

  async function requestToken(envId: string): Promise<OAuthToken> {
    const credentials = await deps.credentials(envId)
    if (credentials === null) {
      throw new DtError('NO_CREDENTIAL', 'El entorno no tiene client ID y client secret de OAuth.')
    }

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      scope: credentials.scopes.join(' ')
    })
    if (credentials.accountUuid !== null) {
      body.set('resource', `urn:dtaccount:${credentials.accountUuid}`)
    }

    let response: Response
    try {
      response = await deps.fetch(credentials.ssoUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        signal: AbortSignal.timeout(SSO_TIMEOUT_MS)
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new DtError(
        /ERR_CERT/.test(message) ? 'TLS_UNTRUSTED' : 'NETWORK',
        `No se pudo contactar con el SSO: ${message}`
      )
    }

    if (response.status === 400 || response.status === 401) {
      throw new DtError(
        'UNAUTHORIZED',
        'El SSO ha rechazado el client ID o el client secret.',
        response.status
      )
    }
    if (response.status >= 500) {
      throw new DtError('SERVER_ERROR', `El SSO respondió ${response.status}.`, response.status)
    }
    if (!response.ok) {
      throw new DtError('UNAUTHORIZED', `El SSO respondió ${response.status}.`, response.status)
    }

    const parsed = tokenResponseSchema.safeParse(await response.json().catch(() => null))
    if (!parsed.success) {
      throw new DtError(
        'INVALID_RESPONSE',
        'La respuesta del SSO no tiene access_token y expires_in.'
      )
    }
    return {
      accessToken: parsed.data.access_token,
      expiresAt: new Date(deps.now().getTime() + parsed.data.expires_in * 1000),
      grantedScopes: parsed.data.scope?.split(/\s+/).filter((scope) => scope !== '') ?? []
    }
  }

  return {
    getToken(envId) {
      const cached = tokens.get(envId)
      if (
        cached !== undefined &&
        cached.expiresAt.getTime() - deps.now().getTime() >= RENEW_MARGIN_MS
      ) {
        return Promise.resolve(cached)
      }
      const inFlight = pending.get(envId)
      if (inFlight !== undefined) return inFlight

      const startedAt = generation.get(envId) ?? 0
      const promise = requestToken(envId)
        .then((token) => {
          if ((generation.get(envId) ?? 0) === startedAt) tokens.set(envId, token)
          return token
        })
        .finally(() => {
          if (pending.get(envId) === promise) pending.delete(envId)
        })
      pending.set(envId, promise)
      return promise
    },

    invalidate(envId) {
      tokens.delete(envId)
      pending.delete(envId)
      generation.set(envId, (generation.get(envId) ?? 0) + 1)
    },

    expiresAt(envId) {
      return tokens.get(envId)?.expiresAt ?? null
    }
  }
}
