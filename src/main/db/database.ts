import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import * as schema from './schema'

export type AppDatabase = BetterSQLite3Database<typeof schema> & { $client: Database.Database }

/**
 * Abre la base local (o `:memory:` en los tests) y aplica las migraciones
 * pendientes. Se cierra con `db.$client.close()`.
 */
export function openDatabase(file: string, migrationsFolder: string): AppDatabase {
  const sqlite = new Database(file)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder })
  return db
}
