import Database from 'better-sqlite3'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Copia de `vigia.db` antes de aplicar migraciones pendientes (ficha 0061,
 * C-06). Lo conservador manda: si la copia falla, se rechaza y el arranque no
 * migra; las copias viejas solo se podan después de una copia correcta y solo
 * se borran ficheros con el nombre de copia, nunca otros de la carpeta.
 */

/** Copias que se conservan. */
export const BACKUPS_KEPT = 3

/** Tabla en la que Drizzle apunta las migraciones aplicadas (su valor por defecto). */
const MIGRATIONS_TABLE = '__drizzle_migrations'

/**
 * `vigia-<fecha UTC>-<migración>.db`. La fecha va primero y con ancho fijo,
 * así que el orden alfabético es el cronológico.
 */
const BACKUP_NAME = /^vigia-\d{8}T\d{6}\d{3}Z-[\w-]+\.db$/

interface BackupLogger {
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
}

export interface BackupOptions {
  file: string
  migrationsFolder: string
  backupDir: string
  logger: BackupLogger
  now?: () => Date
}

interface JournalEntry {
  tag: string
  when: number
}

function readJournal(migrationsFolder: string): JournalEntry[] {
  const raw = JSON.parse(readFileSync(join(migrationsFolder, 'meta', '_journal.json'), 'utf8')) as {
    entries: JournalEntry[]
  }
  return raw.entries
}

/** Momento de la última migración aplicada, como lo compara Drizzle (`created_at`). */
function lastApplied(sqlite: Database.Database): number | null {
  const table = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(MIGRATIONS_TABLE)
  if (table === undefined) return null
  const row = sqlite
    .prepare(`SELECT created_at FROM ${MIGRATIONS_TABLE} ORDER BY created_at DESC LIMIT 1`)
    .get() as { created_at: number | string } | undefined
  return row === undefined ? null : Number(row.created_at)
}

function stamp(date: Date): string {
  // 2026-10-10T07:00:00.000Z → 20261010T070000000Z
  return date.toISOString().replace(/[-:.]/g, '')
}

/** Borra las copias más antiguas por encima de `BACKUPS_KEPT`. Un fallo aquí no impide arrancar. */
function prune(backupDir: string, logger: BackupLogger): void {
  try {
    const copies = readdirSync(backupDir)
      .filter((name) => BACKUP_NAME.test(name))
      .sort()
    for (const name of copies.slice(0, Math.max(0, copies.length - BACKUPS_KEPT))) {
      rmSync(join(backupDir, name))
      logger.info('Copia antigua de la base borrada', join(backupDir, name))
    }
  } catch (error) {
    logger.warn('No se pudieron borrar las copias antiguas de la base', error)
  }
}

/**
 * Si `file` existe y tiene migraciones pendientes, la copia con
 * `sqlite.backup(...)` (consistente con WAL) y devuelve la ruta de la copia;
 * si no, `null`. Rechaza si la copia falla: en ese caso no se debe migrar.
 */
export async function backupBeforeMigrations(options: BackupOptions): Promise<string | null> {
  const { file, migrationsFolder, backupDir, logger } = options
  const now = options.now ?? (() => new Date())
  if (!existsSync(file)) return null

  let destination: string | null = null
  // Abre la base existente sin crearla; no escribe en ella.
  const sqlite = new Database(file, { fileMustExist: true })
  try {
    const applied = lastApplied(sqlite)
    const pending = readJournal(migrationsFolder).filter(
      (entry) => applied === null || applied < entry.when
    )
    const target = pending.at(-1)
    if (target === undefined) return null

    destination = join(backupDir, `vigia-${stamp(now())}-${target.tag}.db`)
    // Nunca se pisa un fichero que ya exista.
    if (existsSync(destination)) {
      const existing = destination
      destination = null
      throw new Error(`Ya existe un fichero con el nombre de la copia: ${existing}`)
    }
    mkdirSync(backupDir, { recursive: true })
    await sqlite.backup(destination)
    logger.info('Copia de la base antes de migrar', destination)
  } catch (error) {
    logger.error('No se pudo copiar la base antes de migrar: no se migra', error)
    // Una copia a medias no sirve y podría parecer buena: se quita (solo la nuestra).
    if (destination !== null && existsSync(destination)) {
      try {
        rmSync(destination)
      } catch (cleanupError) {
        logger.warn('No se pudo borrar la copia incompleta', destination, cleanupError)
      }
    }
    throw error
  } finally {
    sqlite.close()
  }

  prune(backupDir, logger)
  return destination
}
