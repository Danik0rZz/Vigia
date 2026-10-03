import { z } from 'zod'
import {
  REQUIRED_CLASSIC_SCOPES,
  type ConnectionReport,
  type MechanismResult
} from '@shared/dynatrace'
import type { Environment, SecretKind } from '@shared/tenants'
import type { DtClient } from './client'
import { DtError } from './errors'
import type { OAuthTokenManager } from './oauth'

/** POST /api/v2/apiTokens/lookup (Environment API v2): metadatos del token, sin scope requerido. */
const apiTokenSchema = z.object({
  enabled: z.boolean().optional(),
  expirationDate: z.string().nullable().optional(),
  scopes: z.array(z.string()).optional()
})

/** GET /platform/management/v1/environment: la llamada de plataforma más barata. */
const PLATFORM_CHECK_PATH = '/platform/management/v1/environment'
const environmentInfoSchema = z.object({ environmentId: z.string() }).loose()

type MaybePromise<T> = T | Promise<T>

export interface ConnectionTestDeps {
  client: DtClient
  oauth: OAuthTokenManager
  getEnvironment(envId: string): MaybePromise<Environment>
  secretsStatus(envId: string): MaybePromise<Record<SecretKind, boolean>>
  readSecret(envId: string, kind: SecretKind): MaybePromise<string | null>
  now?: () => Date
}

function failed(id: MechanismResult['id'], error: unknown): MechanismResult {
  const dtError =
    error instanceof DtError
      ? error
      : new DtError('NETWORK', 'Error inesperado al probar la conexión.')
  return {
    id,
    state: 'disconnected',
    error: { code: dtError.code, message: dtError.message },
    missingScopes: []
  }
}

/**
 * "Probar conexión": prueba por separado cada mecanismo con credencial (token
 * clásico, OAuth y platform token) y lista los scopes que faltan. Un mecanismo
 * que falla no impide probar los demás.
 */
export async function testConnection(
  envId: string,
  deps: ConnectionTestDeps
): Promise<ConnectionReport> {
  const now = deps.now ?? (() => new Date())
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
      const expired =
        info.expirationDate !== undefined &&
        info.expirationDate !== null &&
        Date.parse(info.expirationDate) <= now().getTime()
      if (info.enabled === false || expired) {
        throw new DtError(
          'UNAUTHORIZED',
          info.enabled === false ? 'El token está desactivado.' : 'El token ha caducado.'
        )
      }
      const granted = new Set(info.scopes ?? [])
      mechanisms.push({
        id: 'classic',
        state: 'connected',
        error: null,
        missingScopes: REQUIRED_CLASSIC_SCOPES.filter((scope) => !granted.has(scope))
      })
    } catch (error) {
      mechanisms.push(failed('classic', error))
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
      const granted = new Set(token.grantedScopes)
      mechanisms.push({
        id: 'oauth',
        state: 'connected',
        error: null,
        // Si el SSO no dice qué concede, no se puede saber qué falta.
        missingScopes:
          granted.size === 0 ? [] : environment.oauthScopes.filter((scope) => !granted.has(scope))
      })
    } catch (error) {
      mechanisms.push(failed('oauth', error))
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
      mechanisms.push({ id: 'platform', state: 'connected', error: null, missingScopes: [] })
    } catch (error) {
      mechanisms.push(failed('platform', error))
    }
  }

  return { checkedAt: now().toISOString(), mechanisms, oauthExpiresAt }
}
