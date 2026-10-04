import { z } from 'zod'
import {
  MODULE_SCOPES,
  PLATFORM_CHECK_SCOPE,
  REQUIRED_CLASSIC_SCOPES,
  REQUIRED_OAUTH_SCOPES,
  type ConnectionReport,
  type MechanismResult,
  type TokenInfo
} from '@shared/dynatrace'
import type { Environment, SecretKind } from '@shared/tenants'
import { DomainError, wireReason } from '../errors'
import type { DtClient } from './client'
import { DtError } from './errors'
import type { OAuthTokenManager } from './oauth'

/**
 * POST /api/v2/apiTokens/lookup (Environment API v2): metadatos del token, sin
 * scope requerido. El id del token no se pide: no sale de main.
 */
const apiTokenSchema = z.object({
  name: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
  expirationDate: z.string().nullable().optional(),
  scopes: z.array(z.string()).optional()
})

/** GET /platform/management/v1/environment: la llamada de plataforma más barata. */
const PLATFORM_CHECK_PATH = '/platform/management/v1/environment'
const environmentInfoSchema = z.object({ environmentId: z.string() }).loose()

/** Scopes clásicos que usa algún módulo; los demás del token no los usa Vigía. */
const USED_CLASSIC_SCOPES = new Set(
  Object.values(MODULE_SCOPES).flatMap((module) => module.classic)
)
const USED_OAUTH_SCOPES = new Set([...REQUIRED_OAUTH_SCOPES, PLATFORM_CHECK_SCOPE])

type MaybePromise<T> = T | Promise<T>

export interface ConnectionTestDeps {
  client: DtClient
  oauth: OAuthTokenManager
  getEnvironment(envId: string): MaybePromise<Environment>
  secretsStatus(envId: string): MaybePromise<Record<SecretKind, boolean>>
  readSecret(envId: string, kind: SecretKind): MaybePromise<string | null>
  now?: () => Date
  /** Aviso en el log (un motivo de error que no cumple el esquema). */
  warn?: (message: string) => void
}

function failed(
  id: MechanismResult['id'],
  error: unknown,
  warn: (message: string) => void,
  tokenInfo: TokenInfo | null = null
): MechanismResult {
  const dtError =
    error instanceof DtError
      ? error
      : error instanceof DomainError && error.code === 'SECRET_UNREADABLE'
        ? new DtError('SECRET_UNREADABLE', error.message, undefined, error.reason)
        : new DtError('NETWORK', 'Error inesperado al probar la conexión.', undefined, {
            key: 'connectionUnexpected'
          })
  const reason = wireReason(dtError.reason, warn)
  return {
    id,
    state: 'disconnected',
    error:
      reason === undefined
        ? { code: dtError.code, message: dtError.message }
        : { code: dtError.code, message: dtError.message, reason },
    missingScopes: [],
    tokenInfo
  }
}

/** Scopes concedidos, los que faltan de los necesarios y los que Vigía no usa. */
function compareScopes(
  granted: readonly string[],
  required: readonly string[],
  used: ReadonlySet<string>
): TokenInfo['scopes'] {
  const have = new Set(granted)
  return {
    granted: [...have].sort(),
    missing: required.filter((scope) => !have.has(scope)).sort(),
    extra: [...have].filter((scope) => !used.has(scope)).sort()
  }
}

function isoOrNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const time = Date.parse(value)
  return Number.isNaN(time) ? null : new Date(time).toISOString()
}

/**
 * "Probar conexión": prueba por separado cada mecanismo con credencial (token
 * clásico, OAuth y platform token), lista los scopes que faltan y, si se puede,
 * describe el token (nombre, caducidad y scopes; nunca el token ni su id). Un
 * mecanismo que falla no impide probar los demás.
 */
export async function testConnection(
  envId: string,
  deps: ConnectionTestDeps
): Promise<ConnectionReport> {
  const now = deps.now ?? (() => new Date())
  const warn = deps.warn ?? (() => undefined)
  const environment = await deps.getEnvironment(envId)
  const secrets = await deps.secretsStatus(envId)
  const mechanisms: MechanismResult[] = []
  let oauthExpiresAt: string | null = null

  if (secrets.classicToken) {
    try {
      const token = await deps.readSecret(envId, 'classicToken')
      const info = await deps.client.dtRequest({
        envId,
        api: 'classic',
        method: 'POST',
        path: '/apiTokens/lookup',
        body: { token },
        schema: apiTokenSchema,
        auth: 'classicToken'
      })
      const expiresAt = isoOrNull(info.expirationDate)
      const tokenInfo: TokenInfo = {
        name: info.name ?? null,
        enabled: info.enabled ?? null,
        expiresAt,
        scopes: compareScopes(info.scopes ?? [], REQUIRED_CLASSIC_SCOPES, USED_CLASSIC_SCOPES)
      }
      const expired = expiresAt !== null && Date.parse(expiresAt) <= now().getTime()
      if (info.enabled === false || expired) {
        mechanisms.push(
          failed(
            'classic',
            info.enabled === false
              ? new DtError('UNAUTHORIZED', 'El token está desactivado.', undefined, {
                  key: 'tokenDisabled'
                })
              : new DtError('UNAUTHORIZED', 'El token ha caducado.', undefined, {
                  key: 'tokenExpired'
                }),
            warn,
            tokenInfo
          )
        )
      } else {
        mechanisms.push({
          id: 'classic',
          state: 'connected',
          error: null,
          missingScopes: tokenInfo.scopes.missing,
          tokenInfo
        })
      }
    } catch (error) {
      mechanisms.push(failed('classic', error, warn))
    }
  }

  if (secrets.oauthClientSecret && environment.oauthClientId !== null) {
    try {
      const token = await deps.oauth.getToken(envId)
      oauthExpiresAt = token.expiresAt.toISOString()
      await deps.client.dtRequest({
        envId,
        api: 'platform',
        path: PLATFORM_CHECK_PATH,
        schema: environmentInfoSchema,
        auth: 'oauth'
      })
      // Si el SSO no dice qué concede, no se puede saber qué falta ni describir el token.
      const tokenInfo: TokenInfo | null =
        token.grantedScopes === null
          ? null
          : {
              name: null,
              enabled: null,
              expiresAt: oauthExpiresAt,
              scopes: compareScopes(token.grantedScopes, REQUIRED_OAUTH_SCOPES, USED_OAUTH_SCOPES)
            }
      const granted = new Set(token.grantedScopes ?? [])
      mechanisms.push({
        id: 'oauth',
        state: 'connected',
        error: null,
        missingScopes:
          token.grantedScopes === null
            ? []
            : environment.oauthScopes.filter((scope) => !granted.has(scope)),
        tokenInfo
      })
    } catch (error) {
      mechanisms.push(failed('oauth', error, warn))
    }
  }

  if (secrets.platformToken) {
    try {
      await deps.client.dtRequest({
        envId,
        api: 'platform',
        path: PLATFORM_CHECK_PATH,
        schema: environmentInfoSchema,
        auth: 'platformToken'
      })
      // No hay endpoint para consultar los permisos de un platform token.
      mechanisms.push({
        id: 'platform',
        state: 'connected',
        error: null,
        missingScopes: [],
        tokenInfo: null
      })
    } catch (error) {
      mechanisms.push(failed('platform', error, warn))
    }
  }

  return { checkedAt: now().toISOString(), mechanisms, oauthExpiresAt }
}
