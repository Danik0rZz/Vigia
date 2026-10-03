import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveUserDataDir } from './user-data'

const appData = join('C:', 'Users', 'dani', 'AppData', 'Roaming')
const override = join('C:', 'temp', 'vigia-e2e-123')

describe('resolveUserDataDir', () => {
  it('empaquetada usa %APPDATA%/vigia', () => {
    expect(resolveUserDataDir({ packaged: true, appData, override: undefined })).toBe(
      join(appData, 'vigia')
    )
  })

  it('empaquetada ignora siempre VIGIA_USER_DATA_DIR', () => {
    expect(resolveUserDataDir({ packaged: true, appData, override })).toBe(join(appData, 'vigia'))
  })

  it('sin empaquetar usa vigia-dev por defecto', () => {
    expect(resolveUserDataDir({ packaged: false, appData, override: undefined })).toBe(
      join(appData, 'vigia-dev')
    )
    expect(resolveUserDataDir({ packaged: false, appData, override: '  ' })).toBe(
      join(appData, 'vigia-dev')
    )
  })

  it.each([undefined, '', '   ', override])(
    'sin empaquetar NUNCA usa la carpeta real %APPDATA%/vigia (override %j)',
    (value) => {
      const result = resolveUserDataDir({ packaged: false, appData, override: value })
      expect(result).not.toBe(join(appData, 'vigia'))
    }
  )

  it('sin empaquetar respeta VIGIA_USER_DATA_DIR', () => {
    expect(resolveUserDataDir({ packaged: false, appData, override })).toBe(override)
  })
})
