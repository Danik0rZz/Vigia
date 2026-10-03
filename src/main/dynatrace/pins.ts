import { and, asc, eq, type SQL } from 'drizzle-orm'
import type { CertificatePin } from '@shared/dynatrace'
import type { AppDatabase } from '../db/database'
import { certificatePins } from '../db/schema'

/** Huellas fijadas por entorno y host: una por host, que solo cambia si el usuario la acepta. */
export interface PinStore {
  list(envId: string): CertificatePin[]
  /** Fija la huella del host, sustituyendo la anterior. */
  pin(envId: string, host: string, fingerprint: string): void
  /** Idempotente. */
  unpin(envId: string, host: string): void
  forHost(envId: string, host: string): string[]
}

export function createPinStore(db: AppDatabase): PinStore {
  const forEnv = (envId: string): SQL => eq(certificatePins.environmentId, envId)
  const forHostOf = (envId: string, host: string): SQL | undefined =>
    and(forEnv(envId), eq(certificatePins.host, host))

  return {
    list(envId) {
      return db
        .select({ host: certificatePins.host, fingerprint: certificatePins.fingerprint })
        .from(certificatePins)
        .where(forEnv(envId))
        .orderBy(asc(certificatePins.host))
        .all()
    },
    pin(envId, host, fingerprint) {
      db.insert(certificatePins)
        .values({ environmentId: envId, host, fingerprint })
        .onConflictDoUpdate({
          target: [certificatePins.environmentId, certificatePins.host],
          set: { fingerprint }
        })
        .run()
    },
    unpin(envId, host) {
      db.delete(certificatePins).where(forHostOf(envId, host)).run()
    },
    forHost(envId, host) {
      return db
        .select({ fingerprint: certificatePins.fingerprint })
        .from(certificatePins)
        .where(forHostOf(envId, host))
        .all()
        .map((row) => row.fingerprint)
    }
  }
}
