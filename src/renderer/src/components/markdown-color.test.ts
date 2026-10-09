import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MarkdownText } from './MarkdownText'
import { readableColor, THEME_BACKGROUNDS, THEME_FOREGROUNDS } from './markdown-color'
import {
  all,
  contrastOver,
  type HtmlNode,
  paintedColor,
  parse,
  type Rgba,
  sameColor,
  styleOf,
  textOf,
  toRgba
} from '../../../test/html-tree'

/**
 * Ficha 0043 (CA5): un color de bajo contraste se ajusta hacia el más cercano que sí contraste,
 * para que nunca quede texto invisible ni en claro ni en oscuro.
 *
 * Contrato elegido al escribir los tests (la ficha no lo fija; decisión delegada por Dani,
 * refinable, anotada en la «Verificación» de la ficha):
 *
 * - `readableColor(color, backgrounds)` en `markdown-color.ts`: recibe un `#rrggbb` y los fondos
 *   (`#rrggbb`) contra los que se va a leer y devuelve un `#rrggbb` en minúsculas con contraste
 *   WCAG ≥ 3:1 frente a todos. Si ya contrasta, lo devuelve igual; si no, lo aclara u oscurece lo
 *   justo, sin cambiar el tono.
 * - `THEME_BACKGROUNDS` (mismo módulo): `[claro, oscuro]`, el `--background` de cada tema de
 *   `main.css` (lo vigila `src/main/env-colors.test.ts`: Vitest no carga los .css como texto).
 * - El visor pinta el texto con un único color en línea que contrasta ≥ 3:1 con los dos fondos a
 *   la vez, así sigue legible si se cambia de tema sin volver a pintar. Un color casi transparente
 *   (`rgba` con poca opacidad) tampoco puede dejar el texto invisible.
 * - `background-color` (decisión del Orquestador en la ficha): `THEME_FOREGROUNDS` (mismo módulo,
 *   `[claro, oscuro]`, el `--foreground` de cada tema). Un fondo válido se conserva solo si el
 *   texto encima se lee a ≥ 3:1 en los dos temas: con su `color` en línea si lo trae (el par tal
 *   cual; si no llega, se quitan los dos) o con `--foreground` si no. Si no, se quita el fondo. Un
 *   fondo casi transparente cuenta como el fondo del tema.
 */

const [LIGHT, DARK] = THEME_BACKGROUNDS as unknown as [string, string]
const BACKGROUNDS = [LIGHT, DARK] as const

const channels = (hex: string): [number, number, number] => {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/.exec(hex)
  if (match === null) throw new Error(`No es #rrggbb en minúsculas: ${hex}`)
  return match.slice(1).map((part) => parseInt(part, 16)) as [number, number, number]
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex.toLowerCase()).map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

/** Tono HSL en grados. */
function hue(hex: string): number {
  const [r, g, b] = channels(hex).map((v) => v / 255) as [number, number, number]
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  if (d === 0) return 0
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return (h * 60 + 360) % 360
}

const hueDistance = (a: number, b: number): number => {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

describe('CA5 (0043): readableColor ajusta un color de bajo contraste', () => {
  it('THEME_BACKGROUNDS son dos #rrggbb distintos: claro y oscuro', () => {
    expect(THEME_BACKGROUNDS).toHaveLength(2)
    expect(LIGHT).toMatch(/^#[0-9a-f]{6}$/i)
    expect(DARK).toMatch(/^#[0-9a-f]{6}$/i)
    // El claro es claro y el oscuro, oscuro.
    expect(luminance(LIGHT)).toBeGreaterThan(0.5)
    expect(luminance(DARK)).toBeLessThan(0.1)
  })

  it.each(['#dd0000', '#ff0000', '#1f6feb', '#808080', '#8a4a00'])(
    '%s ya contrasta en los dos temas: se devuelve igual',
    (color) => {
      for (const background of BACKGROUNDS) {
        expect(contrast(color, background), `precondición ${background}`).toBeGreaterThanOrEqual(3)
      }
      expect(readableColor(color, BACKGROUNDS)).toBe(color)
    }
  )

  it('acepta mayúsculas y devuelve minúsculas', () => {
    expect(readableColor('#DD0000', BACKGROUNDS)).toBe('#dd0000')
  })

  it.each([
    ['amarillo', '#ffff00'],
    ['cian', '#00ffff'],
    ['magenta', '#ff00ff'],
    ['blanco', '#ffffff'],
    ['el fondo claro', LIGHT],
    ['negro', '#000000'],
    ['el fondo oscuro', DARK],
    ['azul marino', '#00008b'],
    ['rojo muy oscuro', '#3a0000'],
    ['verde claro', '#90ee90']
  ])('%s: contraste ≥ 3:1 en claro y en oscuro', (_label, color) => {
    const result = readableColor(color, BACKGROUNDS)
    expect(result).toMatch(/^#[0-9a-f]{6}$/)
    expect(contrast(result, LIGHT), `claro: ${result}`).toBeGreaterThanOrEqual(3)
    expect(contrast(result, DARK), `oscuro: ${result}`).toBeGreaterThanOrEqual(3)
  })

  it.each([
    ['amarillo', '#ffff00'],
    ['cian', '#00ffff'],
    ['magenta', '#ff00ff'],
    ['azul marino', '#00008b'],
    ['rojo muy oscuro', '#3a0000'],
    ['verde claro', '#90ee90']
  ])('%s: se ajusta sin cambiar el tono (no pasa a gris, negro ni blanco)', (_label, color) => {
    const result = readableColor(color, BACKGROUNDS)
    expect(result).not.toBe(color)
    expect(hueDistance(hue(result), hue(color)), `${color} → ${result}`).toBeLessThanOrEqual(5)
    const [r, g, b] = channels(result)
    expect(Math.max(r, g, b) - Math.min(r, g, b), `${result} sigue teniendo color`).toBeGreaterThan(
      20
    )
  })

  it.each(['#ffffff', '#000000', '#f0f0f0', '#111111'])(
    'un gris (%s) sigue siendo gris',
    (color) => {
      const [r, g, b] = channels(readableColor(color, BACKGROUNDS))
      expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThanOrEqual(8)
    }
  )

  it.each([
    ['demasiado claro', '#ffff00', LIGHT],
    ['demasiado claro', '#ffffff', LIGHT],
    ['demasiado oscuro', '#00008b', DARK],
    ['demasiado oscuro', '#000000', DARK]
  ])('%s (%s): va al más cercano que contrasta, sin pasarse', (_label, color, limiting) => {
    // El ajuste se queda cerca del límite de 3:1 frente al fondo que no se cumplía.
    const result = readableColor(color, BACKGROUNDS)
    expect(contrast(result, limiting), `${color} → ${result}`).toBeLessThanOrEqual(3.5)
  })

  it('con un solo fondo, solo cuenta ese', () => {
    // Amarillo sobre el fondo oscuro ya contrasta: no se toca.
    expect(contrast('#ffff00', DARK)).toBeGreaterThanOrEqual(3)
    expect(readableColor('#ffff00', [DARK])).toBe('#ffff00')
    expect(contrast(readableColor('#ffff00', [LIGHT]), LIGHT)).toBeGreaterThanOrEqual(3)
  })
})

const renderTree = (text: string): ReturnType<typeof parse> =>
  parse(renderToStaticMarkup(createElement(MarkdownText, { text })))

const THEMES: [string, Rgba][] = [
  ['claro', toRgba(LIGHT) as Rgba],
  ['oscuro', toRgba(DARK) as Rgba]
]

describe('CA5 (0043): un color de bajo contraste se ajusta en el visor', () => {
  it.each([
    ['amarillo (invisible en claro)', '<span style="color:#ffff00">texto</span>'],
    ['blanco', '<span style="color:white">texto</span>'],
    ['el fondo claro', '<span style="color:#eef1f6">texto</span>'],
    ['negro (invisible en oscuro)', '<span style="color:#000">texto</span>'],
    ['el fondo oscuro', '<span style="color:rgb(15, 18, 24)">texto</span>'],
    ['azul marino', '<span style="color:navy">texto</span>'],
    ['font amarillo', '<font color="yellow">texto</font>'],
    ['casi transparente', '<span style="color:rgba(221, 0, 0, 0.1)">texto</span>']
  ])('%s: contraste ≥ 3:1 en claro y en oscuro', (_label, raw) => {
    const tree = renderTree(`Antes ${raw} después`)
    const color = paintedColor(tree, 'texto')
    expect(color, 'el texto lleva un color').toBeDefined()
    const rgba = toRgba(color ?? '')
    expect(rgba, `color legible: ${String(color)}`).not.toBeNull()
    for (const [theme, background] of THEMES) {
      expect(
        contrastOver(rgba as Rgba, background),
        `${theme}: ${String(color)}`
      ).toBeGreaterThanOrEqual(3)
    }
  })

  it('un color que ya contrasta en los dos temas no se toca', () => {
    // Precondición: #dd0000 contrasta ≥ 3:1 con los dos fondos.
    const red = toRgba('#dd0000') as Rgba
    for (const [, background] of THEMES)
      expect(contrastOver(red, background)).toBeGreaterThanOrEqual(3)
    const tree = renderTree('A <span style="color:#dd0000">texto</span> B')
    expect(sameColor(paintedColor(tree, 'texto'), '#dd0000')).toBe(true)
  })
})

// --- background-color (decisión del Orquestador, ficha 0043, CA2 y CA5) ---

const [FG_LIGHT, FG_DARK] = THEME_FOREGROUNDS as unknown as [string, string]
const THEME_PAIRS: [string, Rgba, Rgba][] = [
  ['claro', toRgba(LIGHT) as Rgba, toRgba(FG_LIGHT) as Rgba],
  ['oscuro', toRgba(DARK) as Rgba, toRgba(FG_DARK) as Rgba]
]

/** Un color con su opacidad, mezclado sobre otro opaco. */
const over = (top: Rgba, bottom: Rgba): Rgba => {
  const mix = (a: number, b: number): number => top.a * a + (1 - top.a) * b
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a: 1 }
}

/** Fondo en línea del texto (de su elemento o de uno que lo envuelve), si queda alguno. */
function paintedBackground(tree: HtmlNode, text: string): string | undefined {
  let found: string | undefined
  const visit = (node: HtmlNode, inherited: string | undefined): void => {
    const own = styleOf(node, 'background-color') ?? inherited
    if (node.tag !== '#text' && textOf(node) === text) found = own
    for (const child of node.children) visit(child, own)
  }
  visit(tree, undefined)
  return found
}

/** El texto se lee a ≥ 3:1 en los dos temas con lo que haya quedado en línea. */
function expectReadable(tree: HtmlNode, text: string): void {
  expect(
    all(tree).some((n) => textOf(n) === text),
    `un elemento con «${text}»`
  ).toBe(true)
  const color = paintedColor(tree, text)
  const background = paintedBackground(tree, text)
  for (const [theme, themeBg, themeFg] of THEME_PAIRS) {
    const bg = background === undefined ? themeBg : over(toRgba(background) as Rgba, themeBg)
    const fg = color === undefined ? themeFg : (toRgba(color) as Rgba)
    expect(
      contrastOver(fg, bg),
      `${theme}: texto ${String(color)} sobre ${String(background)}`
    ).toBeGreaterThanOrEqual(3)
  }
}

describe('CA2 y CA5 (0043): background-color solo si el texto encima se lee en los dos temas', () => {
  it('THEME_FOREGROUNDS son dos #rrggbb: oscuro en el tema claro y claro en el oscuro', () => {
    expect(THEME_FOREGROUNDS).toHaveLength(2)
    expect(FG_LIGHT).toMatch(/^#[0-9a-f]{6}$/i)
    expect(FG_DARK).toMatch(/^#[0-9a-f]{6}$/i)
    expect(luminance(FG_LIGHT)).toBeLessThan(0.1)
    expect(luminance(FG_DARK)).toBeGreaterThan(0.5)
  })

  it('un fondo claro sin color en línea (ilegible en oscuro) se quita', () => {
    // Precondición: con el texto por defecto del tema oscuro no llega a 3:1.
    expect(contrast(FG_DARK, '#fff3cd')).toBeLessThan(3)
    const tree = renderTree('A <span style="background-color:#fff3cd">texto</span> B')
    expect(paintedBackground(tree, 'texto')).toBeUndefined()
    expectReadable(tree, 'texto')
  })

  it('un fondo que se lee con el texto por defecto en los dos temas se conserva', () => {
    for (const fg of [FG_LIGHT, FG_DARK]) {
      expect(contrast(fg, '#808080'), `precondición ${fg}`).toBeGreaterThanOrEqual(3)
    }
    const tree = renderTree('A <span style="background-color:#808080">texto</span> B')
    expect(sameColor(paintedBackground(tree, 'texto'), '#808080')).toBe(true)
    expectReadable(tree, 'texto')
  })

  it('un par color + fondo legible se conserva tal cual', () => {
    expect(contrast('#ffffff', '#1f6feb')).toBeGreaterThanOrEqual(3)
    const tree = renderTree(
      'A <span style="color:#ffffff; background-color:#1f6feb">texto</span> B'
    )
    expect(sameColor(paintedColor(tree, 'texto'), '#ffffff')).toBe(true)
    expect(sameColor(paintedBackground(tree, 'texto'), '#1f6feb')).toBe(true)
    expectReadable(tree, 'texto')
  })

  it('un par color + fondo ilegible: se quitan los dos', () => {
    expect(contrast('#ffff00', '#ffffff')).toBeLessThan(3)
    const tree = renderTree(
      'A <span style="color:#ffff00; background-color:#ffffff">texto</span> B'
    )
    expect(paintedColor(tree, 'texto'), 'sin color').toBeUndefined()
    expect(paintedBackground(tree, 'texto'), 'sin fondo').toBeUndefined()
    expectReadable(tree, 'texto')
  })

  it.each([
    ['sin color en línea', '<span style="background-color:rgba(255, 243, 205, 0.05)">texto</span>'],
    [
      'con un color ilegible en claro',
      '<span style="color:#ffff00; background-color:rgba(255, 255, 255, 0.05)">texto</span>'
    ],
    [
      'con un color ilegible en oscuro',
      '<span style="color:#000000; background-color:rgba(0, 0, 0, 0.05)">texto</span>'
    ]
  ])('un fondo casi transparente cuenta como el fondo del tema (%s)', (_label, raw) => {
    const tree = renderTree(`A ${raw} B`)
    // El color del texto se mide frente al fondo del tema: se ajusta como si no hubiera fondo.
    const color = paintedColor(tree, 'texto')
    if (color !== undefined) {
      for (const [theme, themeBg] of THEME_PAIRS) {
        expect(
          contrastOver(toRgba(color) as Rgba, themeBg),
          `${theme}: ${color} frente al fondo del tema`
        ).toBeGreaterThanOrEqual(3)
      }
    }
    expectReadable(tree, 'texto')
  })
})
