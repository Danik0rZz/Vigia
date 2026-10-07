import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { formatNumber } from './format-number'

/**
 * Ficha 0012: números de la interfaz con separador de miles siempre que tengan 4 cifras o más
 * (en español, Intl no agrupa los de 4 cifras por su cuenta). Todo pasa por `formatNumber`.
 */

describe('CA4 (0012): formatNumber agrupa los miles siempre', () => {
  it('CA4 (0012): en español, «9.907», «2.128.749», «999» y «1.234,5»', () => {
    expect(formatNumber(9907, 'es')).toBe('9.907')
    expect(formatNumber(2128749, 'es')).toBe('2.128.749')
    expect(formatNumber(999, 'es')).toBe('999')
    expect(formatNumber(1234.5, 'es')).toBe('1.234,5')
  })

  it('CA4 (0012): en inglés, «9,907»', () => {
    expect(formatNumber(9907, 'en')).toBe('9,907')
  })

  it('CA4 (0012): respeta las opciones que se le pasan (decimales)', () => {
    expect(formatNumber(1234.5678, 'es', { maximumFractionDigits: 0 })).toBe('1.235')
    expect(formatNumber(1234.5678, 'en', { maximumFractionDigits: 2 })).toBe('1,234.57')
  })
})

/** Ficheros .ts y .tsx bajo `dir`. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.tsx?$/.test(path) ? [path] : []
  })
}

describe('CA5 (0012): nadie crea su propio Intl.NumberFormat', () => {
  it('CA5 (0012): en src/renderer/src y src/shared solo aparece en formatNumber (y su test)', () => {
    const allowed = new Set([
      join('src', 'shared', 'format-number.ts'),
      join('src', 'shared', 'format-number.test.ts')
    ])
    const files = [...sources(join('src', 'renderer', 'src')), ...sources(join('src', 'shared'))]
    // El recorrido encuentra ficheros de verdad (si no, el test no probaría nada).
    expect(files.length).toBeGreaterThan(50)
    const offenders = files.filter(
      (path) =>
        !allowed.has(path) && /new\s+Intl\s*\.\s*NumberFormat\b/.test(readFileSync(path, 'utf8'))
    )
    expect(offenders).toEqual([])
  })
})
