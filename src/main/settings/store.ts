import { eq } from 'drizzle-orm'
import type { AppDatabase } from '../db/database'
import { settings } from '../db/schema'

/** Ajustes de la app en la tabla `settings` (tema, entorno activo…), como texto. */
export interface SettingsStore {
  get(key: string): string | null
  /** Con `null` se borra la clave. */
  set(key: string, value: string | null): void
}

export function createSettingsStore(db: AppDatabase): SettingsStore {
  return {
    get(key) {
      return db.select().from(settings).where(eq(settings.key, key)).get()?.value ?? null
    },
    set(key, value) {
      if (value === null) {
        db.delete(settings).where(eq(settings.key, key)).run()
        return
      }
      db.insert(settings)
        .values({ key, value })
        .onConflictDoUpdate({ target: settings.key, set: { value } })
        .run()
    }
  }
}
