import { setTimeout as sleep } from 'node:timers/promises'
import { classicApiUrlSchema, type Environment } from '@shared/tenants'
import { createDtClient, type DtClient } from '../main/dynatrace/client'
import { DtError } from '../main/dynatrace/errors'
import { maskSecrets } from '../main/dynatrace/mask'
import type { LiveEnv } from './live-env'

/** Id ficticio del entorno de pruebas: el cliente solo lo usa como clave. */
export const LIVE_ENV_ID = '00000000-0000-4000-8000-00000000c0de'

export interface LiveClient {
  client: DtClient
  /** Mensajes del log del cliente, ya enmascarados (para comprobar que no hay fugas). */
  logged: string[]
}

/**
 * Cliente de Dynatrace para las pruebas en vivo: el mismo `createDtClient` que
 * la app, con el fetch de Node y esperas reales (respeta los 429). Solo usa el
 * token clásico, de solo lectura.
 */
export function createLiveClient(env: LiveEnv): LiveClient {
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
    fetchFor: () => fetch,
    getEnvironment: () => environment,
    readSecret: (_envId, kind) => (kind === 'classicToken' ? env.token : null),
    oauth: {
      getToken: () =>
        Promise.reject(new DtError('NO_CREDENTIAL', 'Sin OAuth en las pruebas en vivo.')),
      invalidate: () => undefined,
      expiresAt: () => null
    },
    sleep: (ms) => sleep(ms),
    now: () => new Date(),
    random: Math.random,
    logger: { warn: log, error: log }
  })
  return { client, logged }
}
