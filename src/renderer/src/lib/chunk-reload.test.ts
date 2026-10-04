import { describe, expect, it } from 'vitest'
import { shouldAutoReload } from './chunk-reload'

/**
 * v0.10.1: recarga automática tras un fallo de chunk, con marca anti-bucle:
 * un segundo fallo en menos de 60 s ya no recarga. Sin almacenamiento (o si
 * falla) no se recarga: sin marca no se puede evitar el bucle.
 */

const KEY = 'vigia.chunkReloadAt'
const NOW = 1_800_000_000_000

function memory(initial: Record<string, string> = {}): Pick<Storage, 'getItem' | 'setItem'> & {
  data: Record<string, string>
} {
  const data = { ...initial }
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value
    }
  }
}

describe('shouldAutoReload', () => {
  it('sin marca: recarga y deja la marca con ahora', () => {
    const storage = memory()
    expect(shouldAutoReload(storage, NOW)).toBe(true)
    expect(storage.data[KEY]).toBe(String(NOW))
  })

  it('segundo fallo en menos de 60 s → sin recarga (y no mueve la marca)', () => {
    const storage = memory()
    expect(shouldAutoReload(storage, NOW)).toBe(true)
    expect(shouldAutoReload(storage, NOW + 59_999)).toBe(false)
    expect(storage.data[KEY]).toBe(String(NOW))
  })

  it('con una marca de hace más de 60 s: recarga otra vez y la renueva', () => {
    const storage = memory({ [KEY]: String(NOW - 60_001) })
    expect(shouldAutoReload(storage, NOW)).toBe(true)
    expect(storage.data[KEY]).toBe(String(NOW))
  })

  it('una marca ilegible cuenta como sin marca', () => {
    const storage = memory({ [KEY]: 'basura' })
    expect(shouldAutoReload(storage, NOW)).toBe(true)
    expect(storage.data[KEY]).toBe(String(NOW))
  })

  it('una marca en el futuro (reloj cambiado) no deja la app en bucle para siempre', () => {
    // Con la marca 10 min por delante, recargar sería un bucle; lo prudente es no recargar.
    const storage = memory({ [KEY]: String(NOW + 10 * 60_000) })
    expect(shouldAutoReload(storage, NOW)).toBe(false)
  })

  it('sin almacenamiento → false', () => {
    expect(shouldAutoReload(null, NOW)).toBe(false)
  })

  it('si leer o escribir lanza → false (sin marca no se puede evitar el bucle)', () => {
    const throwsOnGet = {
      getItem: (): string | null => {
        throw new Error('SecurityError')
      },
      setItem: (): void => undefined
    }
    expect(shouldAutoReload(throwsOnGet, NOW)).toBe(false)
    const throwsOnSet = {
      getItem: (): string | null => null,
      setItem: (): void => {
        throw new Error('QuotaExceededError')
      }
    }
    expect(shouldAutoReload(throwsOnSet, NOW)).toBe(false)
  })
})
