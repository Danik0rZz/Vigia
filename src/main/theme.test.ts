import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TITLE_BAR_HEIGHT, titleBarColors } from './theme'

/** Valor de un token CSS dentro del primer bloque que empieza por `selector`. */
function cssToken(css: string, selector: string, token: string): string | undefined {
  const start = css.indexOf(`${selector} {`)
  if (start === -1) return undefined
  const block = css.slice(start, css.indexOf('}', start))
  return new RegExp(`${token}:\\s*([^;]+);`).exec(block)?.[1]?.trim()
}

const css = readFileSync(resolve('src/renderer/src/assets/main.css'), 'utf8')

describe('titleBarColors', () => {
  it('los botones nativos contrastan con su fondo en ambos temas', () => {
    for (const dark of [true, false]) {
      const { overlay } = titleBarColors(dark)
      expect(overlay.color).not.toBe(overlay.symbolColor)
      expect(overlay.height).toBe(TITLE_BAR_HEIGHT)
    }
  })

  it.each([
    ['claro', false, ':root'],
    ['oscuro', true, ":root[data-theme='dark']"]
  ])('tema %s: coincide con los tokens de main.css', (_name, dark, selector) => {
    const colors = titleBarColors(dark)
    const background = cssToken(css, selector, '--background')
    const foreground = cssToken(css, selector, '--foreground')

    expect(background, `--background en ${selector}`).toBeDefined()
    expect(foreground, `--foreground en ${selector}`).toBeDefined()
    expect(colors.background).toBe(background)
    expect(colors.overlay.color).toBe(background)
    expect(colors.overlay.symbolColor).toBe(foreground)
  })
})
