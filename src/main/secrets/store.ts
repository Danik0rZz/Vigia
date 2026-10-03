import { and, eq, type SQL } from 'drizzle-orm'
import { z } from 'zod'
import { secretKinds, type SecretKind } from '@shared/tenants'
import type { AppDatabase } from '../db/database'
import { environments, secrets } from '../db/schema'
import { DomainError } from '../errors'

/** Cifrado del sistema; en la app, `safeStorage` de Electron (DPAPI en Windows). */
export interface SecretCrypto {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(ciphertext: Buffer): string
}

const secretValueSchema = z.string().trim().min(1).max(4096)

export interface SecretStore {
  /** Se consulta en cada llamada: el cifrado puede dejar de estar disponible. */
  isAvailable(): boolean
  set(environmentId: string, kind: SecretKind, value: string): void
  /** Idempotente: borrar lo que no existe no es un error. */
  delete(environmentId: string, kind: SecretKind): void
  status(environmentId: string): Record<SecretKind, boolean>
  /** Solo para main (cliente de Dynatrace). Nunca se expone por IPC. */
  read(environmentId: string, kind: SecretKind): string | null
}

/**
 * Secretos de los entornos, cifrados en la tabla `secrets`. Si no hay cifrado
 * disponible no se guarda nada: nunca hay un respaldo en claro. El valor solo
 * se descifra en main (`read`); el renderer solo sabe si existe.
 */
export function createSecretStore(db: AppDatabase, crypto: SecretCrypto): SecretStore {
  function requireEnvironment(environmentId: string): void {
    const found = db
      .select({ id: environments.id })
      .from(environments)
      .where(eq(environments.id, environmentId))
      .get()
    if (found === undefined) throw new DomainError('NOT_FOUND', 'El entorno no existe.')
  }

  const where = (environmentId: string, kind: SecretKind): SQL | undefined =>
    and(eq(secrets.environmentId, environmentId), eq(secrets.kind, kind))

  return {
    isAvailable(): boolean {
      return crypto.isEncryptionAvailable()
    },

    set(environmentId: string, kind: SecretKind, value: string): void {
      const parsed = secretValueSchema.safeParse(value)
      if (!parsed.success) {
        throw new DomainError('INVALID_INPUT', 'El valor debe tener entre 1 y 4096 caracteres.')
      }
      requireEnvironment(environmentId)
      if (!crypto.isEncryptionAvailable()) {
        throw new DomainError(
          'ENCRYPTION_UNAVAILABLE',
          'El cifrado del sistema no está disponible: no se guardan secretos.'
        )
      }
      const ciphertext = crypto.encryptString(parsed.data)
      db.insert(secrets)
        .values({ environmentId, kind, ciphertext })
        .onConflictDoUpdate({ target: [secrets.environmentId, secrets.kind], set: { ciphertext } })
        .run()
    },

    delete(environmentId: string, kind: SecretKind): void {
      db.delete(secrets).where(where(environmentId, kind)).run()
    },

    status(environmentId: string): Record<SecretKind, boolean> {
      const present = new Set(
        db
          .select({ kind: secrets.kind })
          .from(secrets)
          .where(eq(secrets.environmentId, environmentId))
          .all()
          .map((row) => row.kind)
      )
      return Object.fromEntries(secretKinds.map((kind) => [kind, present.has(kind)])) as Record<
        SecretKind,
        boolean
      >
    },

    read(environmentId: string, kind: SecretKind): string | null {
      const row = db.select().from(secrets).where(where(environmentId, kind)).get()
      return row === undefined ? null : crypto.decryptString(row.ciphertext)
    }
  }
}
