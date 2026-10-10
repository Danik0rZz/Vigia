import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Ficha 0057, CA3: guardia contra las copias. Ningún módulo de `src/main/modules/` (salvo
 * `metric-series.ts`, que es donde viven) puede volver a definir `seriesAt`, `single`,
 * `singleValue` o `lastValue` por su cuenta: se importan del módulo común.
 */

const DIR = resolve('src/main/modules')
const OWNER = 'metric-series.ts'
const HELPERS = ['seriesAt', 'single', 'singleValue', 'lastValue']
/** `function x`, `const x =`, `let x =` o `var x =`, al principio de línea o tras `export`. */
const DEFINITION = new RegExp(
  String.raw`^\s*(?:export\s+)?(?:async\s+)?(?:function\s*\*?\s*|(?:const|let|var)\s+)(${HELPERS.join('|')})\b`,
  'gm'
)

function sources(): string[] {
  return readdirSync(DIR).filter(
    (file) => file.endsWith('.ts') && !file.endsWith('.test.ts') && file !== OWNER
  )
}

describe('CA3 (0057): ningún módulo redefine seriesAt, single/singleValue ni lastValue', () => {
  it('hay módulos que revisar (la guardia no pasa en vacío)', () => {
    expect(sources().length).toBeGreaterThan(5)
  })

  it('las definiciones solo están en metric-series.ts', () => {
    const offenders = sources().flatMap((file) => {
      const text = readFileSync(resolve(DIR, file), 'utf8')
      return [...text.matchAll(DEFINITION)].map((match) => `${file}: ${match[1]}`)
    })
    expect(offenders).toEqual([])
  })

  it('el módulo común las define (la expresión de la guardia las reconoce)', () => {
    const text = readFileSync(resolve(DIR, OWNER), 'utf8')
    const found = new Set([...text.matchAll(DEFINITION)].map((match) => match[1]))
    expect([...found].sort()).toEqual(['lastValue', 'seriesAt', 'singleValue'])
  })
})
