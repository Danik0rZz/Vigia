import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Como theme.test: el CSS se lee del disco (Vitest no carga los .css como texto).
const css = readFileSync(resolve('src/renderer/src/assets/main.css'), 'utf8')

/**
 * Colores por tipo de entorno: un token por tipo en los dos temas, y contraste
 * WCAG AA (≥ 4.5) frente a --background, porque el texto del tipo se pinta con
 * ese color en la fila del entorno en Ajustes.
 */

const TYPES = ['production', 'preproduction', 'integration', 'development', 'other'] as const
const THEMES = [
  ['claro', ':root'],
  ['oscuro', ":root[data-theme='dark']"]
] as const

/** Valor de un token dentro del primer bloque que empieza exactamente por `selector {`. */
function cssToken(selector: string, token: string): string | undefined {
  const start = css.indexOf(`${selector} {`)
  if (start === -1) return undefined
  const block = css.slice(start, css.indexOf('}', start))
  return new RegExp(`${token}:\\s*([^;]+);`).exec(block)?.[1]?.trim()
}

/** Luminancia relativa WCAG 2.x de un color #rrggbb. */
function luminance(hex: string): number {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (match === null) throw new Error(`No es #rrggbb: ${hex}`)
  const [r, g, b] = match.slice(1).map((part) => {
    const c = parseInt(part, 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

describe('cálculo de contraste', () => {
  it('da los valores de referencia de WCAG', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 2)
  })
})

describe('AUD-21: botón de peligro', () => {
  it('usa bg-danger con text-danger-foreground (no texto fijo)', () => {
    const styles = readFileSync(resolve('src/renderer/src/components/styles.ts'), 'utf8')
    const classes = styles.split(/['`"]/).filter((part) => /\bbg-danger\b/.test(part))
    expect(classes.length).toBeGreaterThan(0)
    for (const cls of classes) {
      expect(cls).toMatch(/\btext-danger-foreground\b/)
      expect(cls).not.toMatch(/\btext-(white|black)\b/)
    }
  })

  it('--color-danger-foreground expone el token a Tailwind', () => {
    expect(css).toMatch(/--color-danger-foreground:\s*var\(--danger-foreground\);/)
  })
})

describe.each(THEMES)('tema %s', (_name, selector) => {
  const background = cssToken(selector, '--background') ?? ''

  it('--background es un #rrggbb', () => {
    expect(background).toMatch(/^#[0-9a-f]{6}$/i)
  })

  it.each(TYPES)('--env-%s existe y contrasta ≥ 4.5 con --background', (type) => {
    const color = cssToken(selector, `--env-${type}`)
    expect(color, `--env-${type} en ${selector}`).toMatch(/^#[0-9a-f]{6}$/i)
    expect(
      contrast(color ?? '#000000', background),
      `--env-${type} en ${selector}`
    ).toBeGreaterThanOrEqual(4.5)
  })

  it('--production es un alias de --env-production (o lo hereda de :root)', () => {
    const production = cssToken(selector, '--production')
    if (selector === ':root') expect(production).toBe('var(--env-production)')
    else expect([undefined, 'var(--env-production)']).toContain(production)
  })

  it('AUD-21: --danger-foreground sobre --danger contrasta ≥ 4.5 (botón de peligro)', () => {
    const danger = cssToken(selector, '--danger')
    const foreground = cssToken(selector, '--danger-foreground')
    expect(danger, `--danger en ${selector}`).toMatch(/^#[0-9a-f]{6}$/i)
    expect(foreground, `--danger-foreground en ${selector}`).toMatch(/^#[0-9a-f]{6}$/i)
    expect(contrast(foreground ?? '#000000', danger ?? '#000000')).toBeGreaterThanOrEqual(4.5)
  })

  it('cada tipo tiene un color distinto', () => {
    const colors = TYPES.map((type) => cssToken(selector, `--env-${type}`)?.toLowerCase())
    expect(new Set(colors).size).toBe(TYPES.length)
  })
})
