import type { EnvironmentInput } from '@shared/tenants'
import { openDatabase, type AppDatabase } from '../main/db/database'
import type { SecretCrypto } from '../main/secrets/store'

/**
 * Ayudas comunes de los tests de main: base en memoria con las migraciones
 * reales, cifrado falso y un entorno de ejemplo con valores inventados.
 */

/** SQLite en memoria con las migraciones reales. Cerrar con `db.$client.close()`. */
export function createTestDb(): AppDatabase {
  return openDatabase(':memory:', 'src/main/db/migrations')
}

/**
 * Cifrado falso y reversible: invierte el texto y le pone el prefijo `enc:`
 * (así el valor en claro nunca aparece tal cual en la base). Con
 * `decryptThrows`, descifrar lanza, como `safeStorage` con datos de otro
 * equipo o de otro usuario de Windows.
 */
export function fakeCrypto({
  available = true,
  decryptThrows = false
}: { available?: boolean; decryptThrows?: boolean } = {}): SecretCrypto {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (value: string) => Buffer.from(`enc:${[...value].reverse().join('')}`, 'utf8'),
    decryptString: (buffer: Buffer) => {
      if (decryptThrows) throw new Error('Error while decrypting the ciphertext provided')
      return [...buffer.toString('utf8').slice(4)].reverse().join('')
    }
  }
}

/** Entorno SaaS de ejemplo (valores inventados); `overrides` cambia lo que haga falta. */
export function environmentInput(
  clientId: string,
  overrides: Partial<EnvironmentInput> = {}
): EnvironmentInput {
  return {
    clientId,
    name: 'Producción',
    type: 'production',
    deployment: 'saas',
    classicApiUrl: 'https://abc12345.live.dynatrace.com',
    platformUrl: 'https://abc12345.apps.dynatrace.com',
    ssoUrl: null,
    oauthClientId: 'dt0s02.EJEMPLO',
    oauthScopes: ['storage:logs:read', 'storage:buckets:read'],
    accountUuid: null,
    certificateLevel: 'system',
    captureUrlPatterns: ['https://abc12345.apps.dynatrace.com/platform/*'],
    tags: ['core', 'pagos'],
    readOnly: true,
    ...overrides
  } as EnvironmentInput
}
