import { createRequire } from 'node:module'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Piezas de la ficha 0071 que no fijan sus criterios: el principio del rango (de dónde se leen
 * los textos de antes) y el patrón de --grep, que se prueba como lo usa Playwright (`forceRegExp`:
 * flags `gi`, o `/patrón/flags`) contra el título con sus etiquetas.
 */

const require = createRequire(import.meta.url)
const { rangeBase, zoneGrep } = require(join(__dirname, 'affected-e2e.cjs')) as {
  rangeBase: (range: string) => { ref: string } | { mergeBase: [string, string] }
  zoneGrep: (tags: string[], userPattern?: string) => string
}

/** Lo que hace Playwright con el texto de --grep. */
function playwrightRegExp(pattern: string): RegExp {
  const literal = pattern.match(/^\/(.*)\/([gi]*)$/)
  return literal ? new RegExp(literal[1] as string, literal[2]) : new RegExp(pattern, 'gi')
}

const accepts = (pattern: string, title: string): boolean => {
  const re = playwrightRegExp(pattern)
  re.lastIndex = 0
  return re.test(title)
}

describe('rangeBase (0071)', () => {
  it.each([
    ['main..HEAD', { ref: 'main' }],
    ['integra/20261011-7..HEAD', { ref: 'integra/20261011-7' }],
    ['..HEAD', { ref: 'HEAD' }],
    ['main', { ref: 'main' }],
    ['main...feat/x', { mergeBase: ['main', 'feat/x'] }],
    ['main...', { mergeBase: ['main', 'HEAD'] }]
  ])('%s → %j', (range, expected) => {
    expect(rangeBase(range)).toEqual(expected)
  })
})

describe('zoneGrep (0071)', () => {
  const tags = ['@problemas', '@smoke']

  it('deja pasar las zonas y no una etiqueta que empieza igual', () => {
    const pattern = zoneGrep(tags)
    expect(accepts(pattern, 'CA1 (0012): lista @problemas')).toBe(true)
    expect(accepts(pattern, 'CA2 (0012): copia @problemas @portapapeles')).toBe(true)
    expect(accepts(pattern, 'CA1 (0001): arranca @smoke')).toBe(true)
    expect(accepts(pattern, 'CA1 (0012): detalle @problema-detalle')).toBe(false)
    expect(accepts(pattern, 'CA1 (0012): menú @shell')).toBe(false)
  })

  it('con el -g de quien lo lanza, hacen falta los dos', () => {
    const pattern = zoneGrep(tags, '(0070)')
    expect(accepts(pattern, 'CA1 (0070): lista @problemas')).toBe(true)
    expect(accepts(pattern, 'CA1 (0012): lista @problemas')).toBe(false)
    expect(accepts(pattern, 'CA1 (0070): menú @shell')).toBe(false)
  })

  it('un -g en forma /patrón/ se combina por su contenido', () => {
    const pattern = zoneGrep(tags, '/CA3/')
    expect(accepts(pattern, 'CA3 (0012): lista @problemas')).toBe(true)
    expect(accepts(pattern, 'CA1 (0012): lista @problemas')).toBe(false)
  })
})
