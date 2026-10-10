import Database from 'better-sqlite3'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { backupBeforeMigrations } from './backup'
import { openDatabase } from './database'

/**
 * Ficha 0061 (C-06): copia de `vigia.db` antes de aplicar migraciones
 * pendientes, con `sqlite.backup(...)`, en la carpeta de copias y guardando
 * las 3 últimas. Todo en carpetas temporales: nunca `%APPDATA%\vigia`.
 *
 * Para tener una migración pendiente se abre la base con una carpeta de
 * migraciones recortada (sin la última del journal real), como una versión
 * anterior de la app, y después se pasa la carpeta real.
 */

const REAL_MIGRATIONS = 'src/main/db/migrations'
const DAY = 24 * 60 * 60 * 1000
const BASE_TIME = Date.parse('2026-10-10T09:00:00.000+02:00')

interface JournalEntry {
  tag: string
}

const journal = JSON.parse(
  readFileSync(join(REAL_MIGRATIONS, 'meta', '_journal.json'), 'utf8')
) as { entries: JournalEntry[] }
const LAST_TAG = journal.entries.at(-1)?.tag ?? ''

let root: string
let dbFile: string
let backupDir: string
let oldMigrations: string

type TestLogger = Record<'info' | 'warn' | 'error', Mock<(...args: unknown[]) => void>>

function logger(): TestLogger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

/** Carpeta de migraciones como la de una versión anterior: todas menos la última. */
function writeOldMigrations(dir: string): void {
  mkdirSync(join(dir, 'meta'), { recursive: true })
  const entries = journal.entries.slice(0, -1)
  for (const entry of entries) {
    copyFileSync(join(REAL_MIGRATIONS, `${entry.tag}.sql`), join(dir, `${entry.tag}.sql`))
  }
  writeFileSync(
    join(dir, 'meta', '_journal.json'),
    JSON.stringify({ ...journal, entries }, null, 2),
    'utf8'
  )
}

/** Base de una versión anterior, con un ajuste guardado para comprobar que no se pierde. */
function createOldDatabase(): void {
  const db = openDatabase(dbFile, oldMigrations)
  db.$client.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('marca', 'conservar')
  db.$client.close()
}

function tables(file: string): string[] {
  const sqlite = new Database(file, { readonly: true, fileMustExist: true })
  try {
    return (
      sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
        name: string
      }[]
    ).map((row) => row.name)
  } finally {
    sqlite.close()
  }
}

function setting(file: string, key: string): string | undefined {
  const sqlite = new Database(file, { readonly: true, fileMustExist: true })
  try {
    const row = sqlite.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      { value: string } | undefined
    return row?.value
  } finally {
    sqlite.close()
  }
}

function backups(): string[] {
  return existsSync(backupDir) ? readdirSync(backupDir).sort() : []
}

/** Tabla que solo crea la última migración (la pendiente en estos tests). */
const NEW_TABLE = 'saved_metric_queries'

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'vigia-0061-'))
  dbFile = join(root, 'vigia.db')
  backupDir = join(root, 'backups')
  oldMigrations = join(root, 'migrations-anteriores')
  writeOldMigrations(oldMigrations)
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('CA2 (0061): copia antes de migrar solo si hay migraciones pendientes', () => {
  it('precondición: la base anterior no tiene la tabla de la migración pendiente', () => {
    createOldDatabase()
    expect(tables(dbFile)).not.toContain(NEW_TABLE)
  })

  it('con una migración pendiente crea la copia, con los datos de antes, y la base sigue funcionando', async () => {
    createOldDatabase()
    const log = logger()

    const copy = await backupBeforeMigrations({
      file: dbFile,
      migrationsFolder: REAL_MIGRATIONS,
      backupDir,
      logger: log,
      now: () => new Date(BASE_TIME)
    })

    expect(copy).not.toBeNull()
    const copyPath = copy ?? ''
    expect(existsSync(copyPath)).toBe(true)
    expect(backups()).toHaveLength(1)
    expect(join(backupDir, backups()[0] ?? '')).toBe(copyPath)
    // Con el nombre de la migración pendiente.
    expect(backups()[0]).toContain(LAST_TAG)
    // La copia es una base válida con el estado de antes de migrar.
    expect(setting(copyPath, 'marca')).toBe('conservar')
    expect(tables(copyPath)).not.toContain(NEW_TABLE)
    // La ruta de la copia queda en el log.
    const logged = Object.values(log)
      .flatMap((fn) => fn.mock.calls.flat())
      .map(String)
      .join(' ')
    expect(logged).toContain(copyPath)

    // La base sigue funcionando: se migra y conserva sus datos.
    const db = openDatabase(dbFile, REAL_MIGRATIONS)
    try {
      const names = (
        db.$client.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
          name: string
        }[]
      ).map((row) => row.name)
      expect(names).toContain(NEW_TABLE)
      expect(db.$client.prepare('SELECT value FROM settings WHERE key = ?').get('marca')).toEqual({
        value: 'conservar'
      })
    } finally {
      db.$client.close()
    }
  })

  it('no modifica la base original: la migración la sigue aplicando openDatabase', async () => {
    createOldDatabase()
    await backupBeforeMigrations({
      file: dbFile,
      migrationsFolder: REAL_MIGRATIONS,
      backupDir,
      logger: logger(),
      now: () => new Date(BASE_TIME)
    })
    expect(tables(dbFile)).not.toContain(NEW_TABLE)
    expect(setting(dbFile, 'marca')).toBe('conservar')
  })

  it('sin migraciones pendientes no crea nada', async () => {
    openDatabase(dbFile, REAL_MIGRATIONS).$client.close()

    const copy = await backupBeforeMigrations({
      file: dbFile,
      migrationsFolder: REAL_MIGRATIONS,
      backupDir,
      logger: logger(),
      now: () => new Date(BASE_TIME)
    })

    expect(copy).toBeNull()
    expect(backups()).toEqual([])
  })

  it('si la base no existe (primera ejecución) no crea nada ni la base', async () => {
    const copy = await backupBeforeMigrations({
      file: dbFile,
      migrationsFolder: REAL_MIGRATIONS,
      backupDir,
      logger: logger(),
      now: () => new Date(BASE_TIME)
    })

    expect(copy).toBeNull()
    expect(backups()).toEqual([])
    expect(existsSync(dbFile)).toBe(false)
  })

  it('si la copia falla, rechaza, lo registra y no toca la base (no se migra sin copia)', async () => {
    createOldDatabase()
    // La carpeta de copias es un fichero: no se puede crear ni escribir en ella.
    writeFileSync(backupDir, 'no es una carpeta', 'utf8')
    const log = logger()

    await expect(
      backupBeforeMigrations({
        file: dbFile,
        migrationsFolder: REAL_MIGRATIONS,
        backupDir,
        logger: log,
        now: () => new Date(BASE_TIME)
      })
    ).rejects.toThrow()

    expect(log.error).toHaveBeenCalled()
    expect(tables(dbFile)).not.toContain(NEW_TABLE)
    expect(setting(dbFile, 'marca')).toBe('conservar')
  })
})

describe('CA3 (0061): se guardan las 3 últimas copias', () => {
  async function backupAt(time: number): Promise<string> {
    const copy = await backupBeforeMigrations({
      file: dbFile,
      migrationsFolder: REAL_MIGRATIONS,
      backupDir,
      logger: logger(),
      now: () => new Date(time)
    })
    expect(copy).not.toBeNull()
    return copy ?? ''
  }

  it('con cuatro copias se borra la más antigua', async () => {
    createOldDatabase()
    // Sin migrar entre medias: la migración sigue pendiente en cada arranque.
    const first = await backupAt(BASE_TIME)
    const second = await backupAt(BASE_TIME + DAY)
    const third = await backupAt(BASE_TIME + 2 * DAY)
    expect(backups()).toHaveLength(3)

    const fourth = await backupAt(BASE_TIME + 3 * DAY)

    expect(backups()).toHaveLength(3)
    expect(existsSync(first)).toBe(false)
    for (const kept of [second, third, fourth]) expect(existsSync(kept)).toBe(true)
  })

  it('no borra ficheros de la carpeta que no son copias', async () => {
    createOldDatabase()
    mkdirSync(backupDir, { recursive: true })
    const foreign = join(backupDir, 'nota.txt')
    writeFileSync(foreign, 'de Dani', 'utf8')

    for (let day = 0; day < 4; day += 1) await backupAt(BASE_TIME + day * DAY)

    expect(existsSync(foreign)).toBe(true)
    expect(backups().filter((name) => name !== 'nota.txt')).toHaveLength(3)
  })
})
