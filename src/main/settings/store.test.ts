import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppDatabase } from '../db/database'
import { createSettingsStore } from './store'
import { createTestDb } from '../../test/fixtures'

/** Ajustes clave-valor de la app (por ejemplo `theme`) en SQLite. */

let db: AppDatabase
let settings: ReturnType<typeof createSettingsStore>

beforeEach(() => {
  db = createTestDb()
  settings = createSettingsStore(db)
})

afterEach(() => {
  db.$client.close()
})

describe('createSettingsStore', () => {
  it('una clave que no existe es null', () => {
    expect(settings.get('theme')).toBeNull()
  })

  it('guarda, sobrescribe y lee un valor', () => {
    settings.set('theme', 'dark')
    expect(settings.get('theme')).toBe('dark')
    settings.set('theme', 'light')
    expect(settings.get('theme')).toBe('light')
  })

  it('con null borra la clave', () => {
    settings.set('theme', 'dark')
    settings.set('theme', null)
    expect(settings.get('theme')).toBeNull()
    // Borrar una clave que no existe no falla.
    settings.set('theme', null)
    expect(settings.get('theme')).toBeNull()
  })

  it('las claves son independientes', () => {
    settings.set('theme', 'dark')
    settings.set('language', 'en')
    settings.set('language', null)
    expect(settings.get('theme')).toBe('dark')
    expect(settings.get('language')).toBeNull()
  })

  it('se conserva en la misma base con otro store', () => {
    settings.set('theme', 'dark')
    expect(createSettingsStore(db).get('theme')).toBe('dark')
  })
})
