import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { backupBeforeMigrations } from './backup'
import { openDatabase } from './database'

/**
 * Ficha 0061, ronda 1 del revisor: la poda nunca borra la copia recién hecha,
 * aunque el reloj haya ido hacia atrás y su nombre quede el primero. Test del
 * developer; todo en carpetas temporales.
 */

const REAL_MIGRATIONS = 'src/main/db/migrations'
const DAY = 24 * 60 * 60 * 1000
const BASE_TIME = Date.parse('2026-10-10T09:00:00.000+02:00')

const journal = JSON.parse(
  readFileSync(join(REAL_MIGRATIONS, 'meta', '_journal.json'), 'utf8')
) as { entries: { tag: string }[] }

let root: string
let dbFile: string
let backupDir: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'vigia-0061-poda-'))
  dbFile = join(root, 'vigia.db')
  backupDir = join(root, 'backups')
  // Base de una versión anterior: todas las migraciones menos la última.
  const old = join(root, 'migrations-anteriores')
  mkdirSync(join(old, 'meta'), { recursive: true })
  const entries = journal.entries.slice(0, -1)
  for (const entry of entries) {
    copyFileSync(join(REAL_MIGRATIONS, `${entry.tag}.sql`), join(old, `${entry.tag}.sql`))
  }
  writeFileSync(join(old, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries }), 'utf8')
  openDatabase(dbFile, old).$client.close()
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

async function backupAt(time: number): Promise<string> {
  const copy = await backupBeforeMigrations({
    file: dbFile,
    migrationsFolder: REAL_MIGRATIONS,
    backupDir,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    now: () => new Date(time)
  })
  expect(copy).not.toBeNull()
  return copy ?? ''
}

describe('0061: la poda conserva la copia recién hecha', () => {
  it('con el reloj hacia atrás, la nueva sigue y se borra la más antigua del resto', async () => {
    const later = [
      await backupAt(BASE_TIME + DAY),
      await backupAt(BASE_TIME + 2 * DAY),
      await backupAt(BASE_TIME + 3 * DAY)
    ]

    const fresh = await backupAt(BASE_TIME)

    expect(existsSync(fresh)).toBe(true)
    expect(existsSync(later[0] ?? '')).toBe(false)
    expect(existsSync(later[1] ?? '')).toBe(true)
    expect(existsSync(later[2] ?? '')).toBe(true)
    expect(readdirSync(backupDir)).toHaveLength(3)
  })
})
