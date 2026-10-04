import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppDatabase } from './db/database'
import { createSettingsStore, type SettingsStore } from './settings/store'
import { createTestDb } from '../test/fixtures'

/**
 * AUD-20: preferencia de tema guardada, que main aplica antes de crear la
 * ventana. Un valor guardado que no es válido (o ninguno) vuelve a 'system'.
 */

// local-data importa Electron para sus diálogos y su portapapeles; aquí no se usan.
vi.mock('electron', () => ({
  app: {},
  BrowserWindow: {},
  clipboard: {},
  ClipboardItem: class {},
  dialog: {},
  safeStorage: {}
}))

const { storedTheme, storeTheme } = await import('./local-data')

let db: AppDatabase
let settings: SettingsStore

beforeEach(() => {
  db = createTestDb()
  settings = createSettingsStore(db)
})

afterEach(() => {
  db.$client.close()
})

describe('storedTheme y storeTheme', () => {
  it("sin nada guardado → 'system'", () => {
    expect(storedTheme(settings)).toBe('system')
  })

  it.each(['light', 'dark', 'system'] as const)('guardado %s → %s', (theme) => {
    storeTheme(settings, theme)
    expect(storedTheme(settings)).toBe(theme)
  })

  it.each(['Dark', 'azul', '', ' light', 'null'])(
    "un valor guardado que no es válido (%j) → 'system'",
    (value) => {
      settings.set('theme', value)
      expect(storedTheme(settings)).toBe('system')
    }
  )

  it('se guarda en el ajuste theme y el último gana', () => {
    storeTheme(settings, 'dark')
    storeTheme(settings, 'light')
    expect(settings.get('theme')).toBe('light')
    expect(storedTheme(settings)).toBe('light')
  })
})
