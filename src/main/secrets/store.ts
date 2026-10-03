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
  /** Qué secretos existen. No descifra nada. */
  status(environmentId: string): Record<SecretKind, boolean>
  /** Secretos que existen pero no se pudieron descifrar en un `read`. */
  unreadable(environmentId: string): SecretKind[]
  /**
   * Solo para main (cliente de Dynatrace). Nunca se expone por IPC. Si no se
   * puede descifrar, lanza SECRET_UNREADABLE y lo marca hasta que se vuelva a
   * guardar o se borre.
   */
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

  // Marca en memoria, a propósito (no es un bug): al reiniciar la app se pierde y
  // el secreto vuelve a verse "Configurado" hasta el primer read() que falle, que
  // la pone otra vez. status() no descifra para comprobarlo.
  const unreadableKeys = new Set<string>()
  const markKey = (environmentId: string, kind: SecretKind): string => `${environmentId}:${kind}`

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
      unreadableKeys.delete(markKey(environmentId, kind))
    },

    delete(environmentId: string, kind: SecretKind): void {
      db.delete(secrets).where(where(environmentId, kind)).run()
      unreadableKeys.delete(markKey(environmentId, kind))
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

    unreadable(environmentId: string): SecretKind[] {
      return secretKinds.filter((kind) => unreadableKeys.has(markKey(environmentId, kind)))
    },

    read(environmentId: string, kind: SecretKind): string | null {
      const row = db.select().from(secrets).where(where(environmentId, kind)).get()
      if (row === undefined) return null
      try {
        return crypto.decryptString(row.ciphertext)
      } catch {
        // Cifrado con la clave de otro equipo o de otro usuario de Windows. El
        // error original no se propaga: podría describir el contenido.
        unreadableKeys.add(markKey(environmentId, kind))
        throw new DomainError(
          'SECRET_UNREADABLE',
          'No se puede leer la credencial: se guardó en otro equipo o con otro usuario de Windows. Vuelve a introducirla.'
        )
      }
    }
  }
}
