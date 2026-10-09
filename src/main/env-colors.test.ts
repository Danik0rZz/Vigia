import { readdirSync, readFileSync } from 'node:fs'
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

  it('v0.9.0: --color-status-open y --color-status-closed exponen los tokens a Tailwind', () => {
    expect(css).toMatch(/--color-status-open:\s*var\(--status-open\);/)
    expect(css).toMatch(/--color-status-closed:\s*var\(--status-closed\);/)
  })

  it('SLO: --color-status-warning y su foreground exponen los tokens a Tailwind', () => {
    expect(css).toMatch(/--color-status-warning:\s*var\(--status-warning\);/)
    expect(css).toMatch(/--color-status-warning-foreground:\s*var\(--status-warning-foreground\);/)
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

  it('SLO: --status-warning sobre --background contrasta ≥ 4.5 (texto de aviso)', () => {
    const warning = cssToken(selector, '--status-warning')
    expect(warning, `--status-warning en ${selector}`).toMatch(/^#[0-9a-f]{6}$/i)
    expect(contrast(warning ?? '#000000', background)).toBeGreaterThanOrEqual(4.5)
  })

  it('SLO: --status-warning-foreground sobre --status-warning contrasta ≥ 4.5 (pastilla)', () => {
    const warning = cssToken(selector, '--status-warning')
    const foreground = cssToken(selector, '--status-warning-foreground')
    expect(foreground, `--status-warning-foreground en ${selector}`).toMatch(/^#[0-9a-f]{6}$/i)
    expect(contrast(foreground ?? '#000000', warning ?? '#000000')).toBeGreaterThanOrEqual(4.5)
  })

  it('SLO: --status-warning no comparte valor con ningún tipo de entorno', () => {
    const warning = cssToken(selector, '--status-warning')?.toLowerCase()
    const envColors = TYPES.map((type) => cssToken(selector, `--env-${type}`)?.toLowerCase())
    expect(envColors).not.toContain(warning)
    // Y no es un alias de uno de ellos.
    expect(warning).not.toMatch(/var\(--env-/)
  })

  it.each(['open', 'closed'])(
    'v0.9.0: --status-%s (barra de estado) contrasta ≥ 3 con --background (WCAG 1.4.11)',
    (state) => {
      const color = cssToken(selector, `--status-${state}`)
      expect(color, `--status-${state} en ${selector}`).toMatch(/^#[0-9a-f]{6}$/i)
      expect(contrast(color ?? '#000000', background)).toBeGreaterThanOrEqual(3)
    }
  )

  it.each(['chart-2', 'chart-3', 'chart-4', 'chart-5'])(
    'ficha 0009: --%s (serie de un gráfico) contrasta ≥ 3 con --background (WCAG 1.4.11)',
    (token) => {
      const color = cssToken(selector, `--${token}`)
      expect(color, `--${token} en ${selector}`).toMatch(/^#[0-9a-f]{6}$/i)
      expect(contrast(color ?? '#000000', background)).toBeGreaterThanOrEqual(3)
    }
  )

  it('ficha 0009: las series de los tiempos (acento, --chart-2 y --chart-3) se distinguen', () => {
    const colors = ['--accent', '--chart-2', '--chart-3'].map((token) =>
      cssToken(selector, token)?.toLowerCase()
    )
    expect(new Set(colors).size).toBe(3)
  })

  it('ficha 0032: las cinco series de «CPU por instancia» (acento y --chart-2 a --chart-5) se distinguen', () => {
    const colors = ['--accent', '--chart-2', '--chart-3', '--chart-4', '--chart-5'].map((token) =>
      cssToken(selector, token)?.toLowerCase()
    )
    expect(new Set(colors).size).toBe(5)
  })

  it('v0.9.0: abierto y cerrado tienen colores distintos', () => {
    const open = cssToken(selector, '--status-open')?.toLowerCase()
    const closed = cssToken(selector, '--status-closed')?.toLowerCase()
    expect(open).not.toBe(closed)
  })

  it('cada tipo tiene un color distinto', () => {
    const colors = TYPES.map((type) => cssToken(selector, `--env-${type}`)?.toLowerCase())
    expect(new Set(colors).size).toBe(TYPES.length)
  })
})

/**
 * Ficha 0038 (CA7): colores nuevos del visor de Markdown, en los dos temas. Contrato elegido al
 * escribir los tests (anotado en la ficha): tokens `--md-*` en `main.css`, cada uno #rrggbb y
 * definido en `:root` y en el bloque oscuro; texto ≥ 4.5 frente al fondo sobre el que se pinta.
 *
 * - Bloque de código: fondo `--md-code-bg`; números `--md-line-number` y colores de sintaxis
 *   `--md-hl-<nombre>` (al menos cuatro) sobre ese fondo.
 * - Código en línea: `--md-inline-code` sobre `--md-inline-code-bg`.
 * - Marcas (`--md-mark-success|error|warning`) y título de los avisos
 *   (`--md-alert-note|tip|important|warning|caution`) sobre `--background`.
 */
const MD_ALERTS = ['note', 'tip', 'important', 'warning', 'caution'] as const
const MD_MARKS = ['success', 'error', 'warning'] as const

/** Nombres de los tokens `--md-hl-*` definidos en el bloque que empieza por `selector {`. */
function highlightTokens(selector: string): string[] {
  const start = css.indexOf(`${selector} {`)
  if (start === -1) return []
  const block = css.slice(start, css.indexOf('}', start))
  return [...block.matchAll(/(--md-hl-[a-z0-9-]+):/g)].map((match) => match[1] ?? '').sort()
}

describe.each(THEMES)('CA7 (0038): contraste del visor de Markdown, tema %s', (_name, selector) => {
  const background = cssToken(selector, '--background') ?? '#000000'
  const hex = (token: string): string => {
    const value = cssToken(selector, token)
    expect(value ?? '(sin definir)', `${token} en ${selector}`).toMatch(/^#[0-9a-f]{6}$/i)
    return value ?? '#000000'
  }

  it('números de línea sobre el fondo del bloque de código ≥ 4.5', () => {
    expect(contrast(hex('--md-line-number'), hex('--md-code-bg'))).toBeGreaterThanOrEqual(4.5)
  })

  it('al menos cuatro colores de sintaxis, cada uno ≥ 4.5 sobre el fondo del bloque', () => {
    const tokens = highlightTokens(selector)
    expect(tokens.length, `--md-hl-* en ${selector}`).toBeGreaterThanOrEqual(4)
    for (const token of tokens) {
      expect(contrast(hex(token), hex('--md-code-bg')), token).toBeGreaterThanOrEqual(4.5)
    }
    // Se distinguen entre sí.
    expect(new Set(tokens.map((token) => hex(token).toLowerCase())).size).toBe(tokens.length)
  })

  it('código en línea: texto ≥ 4.5 sobre su píldora', () => {
    expect(contrast(hex('--md-inline-code'), hex('--md-inline-code-bg'))).toBeGreaterThanOrEqual(
      4.5
    )
  })

  it.each(MD_MARKS)('marca %s ≥ 4.5 sobre --background', (mark) => {
    expect(contrast(hex(`--md-mark-${mark}`), background)).toBeGreaterThanOrEqual(4.5)
  })

  it('las tres marcas tienen colores distintos', () => {
    const colors = MD_MARKS.map((mark) => hex(`--md-mark-${mark}`).toLowerCase())
    expect(new Set(colors).size).toBe(MD_MARKS.length)
  })

  it.each(MD_ALERTS)('aviso %s ≥ 4.5 sobre --background', (alert) => {
    expect(contrast(hex(`--md-alert-${alert}`), background)).toBeGreaterThanOrEqual(4.5)
  })

  it('los cinco avisos tienen colores distintos', () => {
    const colors = MD_ALERTS.map((alert) => hex(`--md-alert-${alert}`).toLowerCase())
    expect(new Set(colors).size).toBe(MD_ALERTS.length)
  })
})

describe('CA7 (0038): los colores de sintaxis salen del tema, no de un tema de highlight.js', () => {
  it('claro y oscuro definen los mismos --md-hl-*', () => {
    expect(highlightTokens(":root[data-theme='dark']")).toEqual(highlightTokens(':root'))
  })

  it('las reglas .hljs-* de main.css usan var(--md-hl-*) y ningún color fijo', () => {
    const rules = [...css.matchAll(/([^{}]*\.hljs[^{}]*)\{([^}]*)\}/g)]
    expect(rules.length, 'reglas .hljs en main.css').toBeGreaterThan(0)
    for (const [, selectorText = '', body = ''] of rules) {
      expect(body, selectorText.trim()).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|hsl\(/i)
      if (/color\s*:/.test(body)) expect(body, selectorText.trim()).toMatch(/var\(--md-hl-/)
    }
  })

  it('el renderer no importa ninguna hoja de estilos de highlight.js', () => {
    const sources = readdirSync(resolve('src/renderer/src'), { recursive: true })
      .map(String)
      .filter((file) => /\.(tsx?|css)$/.test(file) && !/\.test\.tsx?$/.test(file))
    for (const file of sources) {
      const text = readFileSync(resolve('src/renderer/src', file), 'utf8')
      expect(text, file).not.toMatch(/highlight\.js\/styles/)
    }
  })
})

/**
 * Ficha 0043 (CA5): el visor ajusta los colores del HTML de las descripciones frente a
 * `THEME_BACKGROUNDS` (`src/renderer/src/components/markdown-color.ts`). Vitest no carga los .css
 * como texto en el renderer, así que aquí se comprueba que esos fondos son los `--background` de
 * los dos temas de `main.css`, en el orden claro, oscuro.
 */
describe('CA5 (0043): los fondos del ajuste de contraste son los de los temas', () => {
  it('THEME_BACKGROUNDS lleva el --background claro y el oscuro, en ese orden', () => {
    const source = readFileSync(
      resolve('src/renderer/src/components/markdown-color.ts'),
      'utf8'
    ).toLowerCase()
    const declaration = /theme_backgrounds[^=]*=([^\n;]*(?:\n[^\n;]*){0,4})/.exec(source)?.[1] ?? ''
    const light = (cssToken(':root', '--background') ?? '').toLowerCase()
    const dark = (cssToken(":root[data-theme='dark']", '--background') ?? '').toLowerCase()
    expect(light).toMatch(/^#[0-9a-f]{6}$/)
    expect(dark).toMatch(/^#[0-9a-f]{6}$/)
    expect(declaration, 'THEME_BACKGROUNDS con el fondo claro').toContain(light)
    expect(declaration, 'THEME_BACKGROUNDS con el fondo oscuro').toContain(dark)
    expect(declaration.indexOf(light)).toBeLessThan(declaration.indexOf(dark))
  })
})
