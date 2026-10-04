import { z } from 'zod'
import { DtError } from './errors'
import { maskSecrets } from './mask'

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
  /** Scopes que concede el SSO (`scope` de la respuesta); null si no lo indica. */
  grantedScopes: string[] | null
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

/** Cuerpo de error del SSO (RFC 6749 §5.2). */
const ssoErrorSchema = z.object({
  error: z.string().min(1),
  error_description: z.string().optional()
})

/** Deja sitio al prefijo dentro de los 300 caracteres de DtError. */
const DESCRIPTION_MAX = 200
const REQUEST_ERRORS = new Set(['invalid_request', 'invalid_grant', 'unsupported_grant_type'])

/**
 * Error para un 400 o 401 del SSO. Un scope no válido o una petición mal
 * formada no son credenciales malas; el resto (401, invalid_client, cuerpo sin
 * `error` o desconocido) sigue diciendo que el SSO rechaza el client ID o el
 * secret. La descripción del SSO se enmascara y se recorta.
 */
async function ssoRejection(response: Response, clientSecret: string): Promise<DtError> {
  const credentialsError = new DtError(
    'UNAUTHORIZED',
    'El SSO ha rechazado el client ID o el client secret.',
    response.status,
    { key: 'ssoCredentials' }
  )
  if (response.status !== 400) return credentialsError
  // Lo que devuelve el SSO no puede traer el secret, ni siquiera sin formato de token.
  const scrub = (value: string): string =>
    maskSecrets(clientSecret === '' ? value : value.split(clientSecret).join('***'))

  const text = await response.text().catch(() => '')
  let json: unknown = null
  try {
    json = JSON.parse(text)
  } catch {
    return credentialsError
  }
  const parsed = ssoErrorSchema.safeParse(json)
  if (!parsed.success) return credentialsError

  const code = parsed.data.error
  const description = parsed.data.error_description?.trim()
  const detail =
    description === undefined || description === ''
      ? null
      : scrub(description).slice(0, DESCRIPTION_MAX)

  if (code === 'invalid_scope') {
    return new DtError(
      'BAD_REQUEST',
      `El SSO no acepta los scopes pedidos: ${detail ?? code}`,
      response.status,
      { key: 'ssoScope', params: { detail: detail ?? code } }
    )
  }
  if (REQUEST_ERRORS.has(code)) {
    return detail === null
      ? new DtError('BAD_REQUEST', `El SSO ha rechazado la petición: ${code}`, response.status, {
          key: 'ssoRequest',
          params: { code }
        })
      : new DtError(
          'BAD_REQUEST',
          `El SSO ha rechazado la petición (${code}): ${detail}`,
          response.status,
          { key: 'ssoRequestDetail', params: { code, detail } }
        )
  }
  return credentialsError
}

/**
 * Tokens OAuth de plataforma: solo en memoria y por entorno. Se usa el
 * `expires_in` de la respuesta y se renueva cuando quedan menos de 60 s. Las
 * peticiones simultáneas comparten una única renovación.
 */
export function createOAuthTokenManager(deps: {
  fetch: typeof fetch
  now: () => Date
  credentials: (envId: string) => Promise<OAuthCredentials | null>
  /** Por qué falló el certificado de `host` (con puerto), según el verificador. */
  tlsFailure?: (envId: string, host: string) => 'untrusted' | 'mismatch' | null
}): OAuthTokenManager {
  const tokens = new Map<string, OAuthToken>()
  const pending = new Map<string, Promise<OAuthToken>>()
  /** Se incrementa al invalidar: una renovación iniciada antes no se guarda. */
  const generation = new Map<string, number>()

  async function requestToken(envId: string): Promise<OAuthToken> {
    const credentials = await deps.credentials(envId)
    if (credentials === null) {
      throw new DtError(
        'NO_CREDENTIAL',
        'El entorno no tiene client ID y client secret de OAuth.',
        undefined,
        { key: 'oauthMissing' }
      )
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
      // Como en el cliente: el rechazo del verificador propio llega como ERR_FAILED,
      // y solo es de certificado si el verificador lo anotó para el host del SSO.
      const certError = /ERR_CERT|ERR_SSL/i.test(message)
      const host = new URL(credentials.ssoUrl).host
      const observed =
        certError || /ERR_FAILED/.test(message) ? (deps.tlsFailure?.(envId, host) ?? null) : null
      if (certError || observed !== null) {
        throw (observed ?? 'untrusted') === 'mismatch'
          ? new DtError(
              'TLS_PIN_MISMATCH',
              `El certificado del SSO (${host}) no coincide con la huella fijada.`,
              undefined,
              { key: 'tlsMismatch', params: { host } }
            )
          : new DtError(
              'TLS_UNTRUSTED',
              `El certificado del SSO (${host}) no es de confianza.`,
              undefined,
              { key: 'tlsUntrusted', params: { host } }
            )
      }
      throw new DtError('NETWORK', `No se pudo contactar con el SSO: ${message}`, undefined, {
        key: 'ssoUnreachable',
        params: { detail: message }
      })
    }

    if (response.status === 400 || response.status === 401) {
      throw await ssoRejection(response, credentials.clientSecret)
    }
    const statusReason = { key: 'ssoStatus', params: { status: response.status } } as const
    if (response.status >= 500) {
      throw new DtError(
        'SERVER_ERROR',
        `El SSO respondió ${response.status}.`,
        response.status,
        statusReason
      )
    }
    if (!response.ok) {
      throw new DtError(
        'UNAUTHORIZED',
        `El SSO respondió ${response.status}.`,
        response.status,
        statusReason
      )
    }

    const parsed = tokenResponseSchema.safeParse(await response.json().catch(() => null))
    if (!parsed.success) {
      throw new DtError(
        'INVALID_RESPONSE',
        'La respuesta del SSO no tiene access_token y expires_in.',
        undefined,
        { key: 'ssoInvalidToken' }
      )
    }
    return {
      accessToken: parsed.data.access_token,
      expiresAt: new Date(deps.now().getTime() + parsed.data.expires_in * 1000),
      grantedScopes:
        parsed.data.scope === undefined
          ? null
          : parsed.data.scope.split(/\s+/).filter((scope) => scope !== '')
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
