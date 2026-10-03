import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type AppDatabase } from '../db/database'
import { createSettingsStore } from './store'

/** Ajustes clave-valor de la app (por ejemplo `theme`) en SQLite. */

let db: AppDatabase
let settings: ReturnType<typeof createSettingsStore>

beforeEach(() => {
  db = openDatabase(':memory:', 'src/main/db/migrations')
  settings = createSettingsStore(db)
})

afterEach(() => {
  db.$client.close()
})

describe('createSettingsStore', () => {
  it('una clave que no existe es null', async () => {
    expect(await settings.get('theme')).toBeNull()
  })

  it('guarda, sobrescribe y lee un valor', async () => {
    await settings.set('theme', 'dark')
    expect(await settings.get('theme')).toBe('dark')
    await settings.set('theme', 'light')
    expect(await settings.get('theme')).toBe('light')
  })

  it('con null borra la clave', async () => {
    await settings.set('theme', 'dark')
    await settings.set('theme', null)
    expect(await settings.get('theme')).toBeNull()
    // Borrar una clave que no existe no falla.
    await settings.set('theme', null)
    expect(await settings.get('theme')).toBeNull()
  })

  it('las claves son independientes', async () => {
    await settings.set('theme', 'dark')
    await settings.set('language', 'en')
    await settings.set('language', null)
    expect(await settings.get('theme')).toBe('dark')
    expect(await settings.get('language')).toBeNull()
  })

  it('se conserva en la misma base con otro store', async () => {
    await settings.set('theme', 'dark')
    expect(await createSettingsStore(db).get('theme')).toBe('dark')
  })
})
