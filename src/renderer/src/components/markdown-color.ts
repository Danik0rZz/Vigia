/**
 * Colores del HTML de formato de las descripciones (ficha 0043): validación estricta de los
 * valores de `color` y `background-color` y ajuste de contraste para que ningún texto quede
 * invisible en el tema claro ni en el oscuro.
 *
 * El visor pinta un solo color en línea que tiene que leerse a ≥ 3:1 frente a los dos fondos a la
 * vez: así sigue legible si se cambia de tema sin volver a pintar.
 */

export const THEME_BACKGROUNDS = ['#eef1f6', '#0f1218'] as const

// El `--foreground` de cada tema de `main.css` (claro, oscuro), lo vigila `env-colors.test.ts`.
export const THEME_FOREGROUNDS = ['#1b2130', '#e6e9ef'] as const

/** Contraste mínimo (WCAG, texto grande y elementos de interfaz). */
const MIN_CONTRAST = 3

/** Por debajo de esta opacidad, un `background-color` cuenta como el fondo del tema. */
const TRANSPARENT_BACKGROUND = 0.1

export type Rgba = { r: number; g: number; b: number; a: number }

/** Nombres de color de CSS (CSS Color 4), sin `transparent` ni `currentcolor`. */
const NAMED_COLORS: Record<string, string> = {
  aliceblue: 'f0f8ff',
  antiquewhite: 'faebd7',
  aqua: '00ffff',
  aquamarine: '7fffd4',
  azure: 'f0ffff',
  beige: 'f5f5dc',
  bisque: 'ffe4c4',
  black: '000000',
  blanchedalmond: 'ffebcd',
  blue: '0000ff',
  blueviolet: '8a2be2',
  brown: 'a52a2a',
  burlywood: 'deb887',
  cadetblue: '5f9ea0',
  chartreuse: '7fff00',
  chocolate: 'd2691e',
  coral: 'ff7f50',
  cornflowerblue: '6495ed',
  cornsilk: 'fff8dc',
  crimson: 'dc143c',
  cyan: '00ffff',
  darkblue: '00008b',
  darkcyan: '008b8b',
  darkgoldenrod: 'b8860b',
  darkgray: 'a9a9a9',
  darkgreen: '006400',
  darkgrey: 'a9a9a9',
  darkkhaki: 'bdb76b',
  darkmagenta: '8b008b',
  darkolivegreen: '556b2f',
  darkorange: 'ff8c00',
  darkorchid: '9932cc',
  darkred: '8b0000',
  darksalmon: 'e9967a',
  darkseagreen: '8fbc8f',
  darkslateblue: '483d8b',
  darkslategray: '2f4f4f',
  darkslategrey: '2f4f4f',
  darkturquoise: '00ced1',
  darkviolet: '9400d3',
  deeppink: 'ff1493',
  deepskyblue: '00bfff',
  dimgray: '696969',
  dimgrey: '696969',
  dodgerblue: '1e90ff',
  firebrick: 'b22222',
  floralwhite: 'fffaf0',
  forestgreen: '228b22',
  fuchsia: 'ff00ff',
  gainsboro: 'dcdcdc',
  ghostwhite: 'f8f8ff',
  gold: 'ffd700',
  goldenrod: 'daa520',
  gray: '808080',
  green: '008000',
  greenyellow: 'adff2f',
  grey: '808080',
  honeydew: 'f0fff0',
  hotpink: 'ff69b4',
  indianred: 'cd5c5c',
  indigo: '4b0082',
  ivory: 'fffff0',
  khaki: 'f0e68c',
  lavender: 'e6e6fa',
  lavenderblush: 'fff0f5',
  lawngreen: '7cfc00',
  lemonchiffon: 'fffacd',
  lightblue: 'add8e6',
  lightcoral: 'f08080',
  lightcyan: 'e0ffff',
  lightgoldenrodyellow: 'fafad2',
  lightgray: 'd3d3d3',
  lightgreen: '90ee90',
  lightgrey: 'd3d3d3',
  lightpink: 'ffb6c1',
  lightsalmon: 'ffa07a',
  lightseagreen: '20b2aa',
  lightskyblue: '87cefa',
  lightslategray: '778899',
  lightslategrey: '778899',
  lightsteelblue: 'b0c4de',
  lightyellow: 'ffffe0',
  lime: '00ff00',
  limegreen: '32cd32',
  linen: 'faf0e6',
  magenta: 'ff00ff',
  maroon: '800000',
  mediumaquamarine: '66cdaa',
  mediumblue: '0000cd',
  mediumorchid: 'ba55d3',
  mediumpurple: '9370db',
  mediumseagreen: '3cb371',
  mediumslateblue: '7b68ee',
  mediumspringgreen: '00fa9a',
  mediumturquoise: '48d1cc',
  mediumvioletred: 'c71585',
  midnightblue: '191970',
  mintcream: 'f5fffa',
  mistyrose: 'ffe4e1',
  moccasin: 'ffe4b5',
  navajowhite: 'ffdead',
  navy: '000080',
  oldlace: 'fdf5e6',
  olive: '808000',
  olivedrab: '6b8e23',
  orange: 'ffa500',
  orangered: 'ff4500',
  orchid: 'da70d6',
  palegoldenrod: 'eee8aa',
  palegreen: '98fb98',
  paleturquoise: 'afeeee',
  palevioletred: 'db7093',
  papayawhip: 'ffefd5',
  peachpuff: 'ffdab9',
  peru: 'cd853f',
  pink: 'ffc0cb',
  plum: 'dda0dd',
  powderblue: 'b0e0e6',
  purple: '800080',
  rebeccapurple: '663399',
  red: 'ff0000',
  rosybrown: 'bc8f8f',
  royalblue: '4169e1',
  saddlebrown: '8b4513',
  salmon: 'fa8072',
  sandybrown: 'f4a460',
  seagreen: '2e8b57',
  seashell: 'fff5ee',
  sienna: 'a0522d',
  silver: 'c0c0c0',
  skyblue: '87ceeb',
  slateblue: '6a5acd',
  slategray: '708090',
  slategrey: '708090',
  snow: 'fffafa',
  springgreen: '00ff7f',
  steelblue: '4682b4',
  tan: 'd2b48c',
  teal: '008080',
  thistle: 'd8bfd8',
  tomato: 'ff6347',
  turquoise: '40e0d0',
  violet: 'ee82ee',
  wheat: 'f5deb3',
  white: 'ffffff',
  whitesmoke: 'f5f5f5',
  yellow: 'ffff00',
  yellowgreen: '9acd32'
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/
const NUMBER = String.raw`(\d{1,3}(?:\.\d+)?)`
const ALPHA = String.raw`(\d*\.?\d+)`
const RGB = new RegExp(
  String.raw`^rgba?\(\s*${NUMBER}\s*,\s*${NUMBER}\s*,\s*${NUMBER}\s*(?:,\s*${ALPHA}\s*)?\)$`
)

function hexToRgba(hex: string): Rgba {
  const digits = hex.length === 4 ? [...hex.slice(1)].map((c) => c + c).join('') : hex.slice(1)
  return {
    r: parseInt(digits.slice(0, 2), 16),
    g: parseInt(digits.slice(2, 4), 16),
    b: parseInt(digits.slice(4, 6), 16),
    a: 1
  }
}

/**
 * Un valor de color de la lista blanca (`#rgb`, `#rrggbb`, `rgb()`/`rgba()` con números o un
 * nombre de CSS) a canales; cualquier otra cosa (funciones, variables, comentarios, escapes, más de
 * un valor…) da null.
 */
export function parseColor(value: string): Rgba | null {
  const text = value.trim().toLowerCase()
  if (HEX.test(text)) return hexToRgba(text)
  const named = NAMED_COLORS[text]
  if (named !== undefined) return hexToRgba(`#${named}`)
  const match = RGB.exec(text)
  if (match === null) return null
  const [r, g, b] = match.slice(1, 4).map(Number) as [number, number, number]
  const a = match[4] === undefined ? 1 : Number(match[4])
  if ([r, g, b].some((v) => v > 255) || a > 1) return null
  return { r, g, b, a }
}

const toHex = ({ r, g, b }: Rgba): string =>
  `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`

/** Un color para el `style`: `#rrggbb` si es opaco, `rgba()` si no. */
export const formatColor = (color: Rgba): string =>
  color.a >= 1
    ? toHex(color)
    : `rgba(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)}, ${color.a})`

/** Un color con su opacidad, mezclado sobre otro opaco. */
export function over(top: Rgba, bottom: Rgba): Rgba {
  const mix = (a: number, b: number): number => top.a * a + (1 - top.a) * b
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a: 1 }
}

function luminance({ r, g, b }: Rgba): number {
  const [lr, lg, lb] = [r, g, b].map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb
}

/** Contraste WCAG entre un texto (con su opacidad, sobre el fondo) y un fondo opaco. */
export function contrast(text: Rgba, background: Rgba): number {
  const a = luminance(over(text, background))
  const b = luminance(background)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

const readsOn = (text: Rgba, backgrounds: readonly Rgba[]): boolean =>
  backgrounds.every((background) => contrast(text, background) >= MIN_CONTRAST)

type Hsl = { h: number; s: number; l: number }

function toHsl({ r, g, b }: Rgba): Hsl {
  const [nr, ng, nb] = [r / 255, g / 255, b / 255]
  const max = Math.max(nr, ng, nb)
  const min = Math.min(nr, ng, nb)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return { h: 0, s: 0, l }
  const s = d / (1 - Math.abs(2 * l - 1))
  const h = max === nr ? ((ng - nb) / d) % 6 : max === ng ? (nb - nr) / d + 2 : (nr - ng) / d + 4
  return { h: (h * 60 + 360) % 360, s, l }
}

function fromHsl({ h, s, l }: Hsl): Rgba {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x]
  const channel = (v: number): number => Math.round((v + m) * 255)
  return { r: channel(r), g: channel(g), b: channel(b), a: 1 }
}

/** Pasos de luminosidad HSL que se prueban al ajustar (de 0 a 1). */
const STEPS = 1000

/**
 * El color más cercano a `color` (`#rrggbb`) que se lee a ≥ 3:1 frente a todos los `backgrounds`
 * (`#rrggbb`), en `#rrggbb` minúsculas. Si ya se lee, sale igual; si no, se aclara u oscurece sin
 * cambiar el tono ni la saturación (la luminancia crece con la luminosidad HSL, así que el primero
 * que cumple es el que menos cambia). Si ninguno cumple, el que más contraste mínimo consigue.
 */
export function readableColor(color: string, backgrounds: readonly string[]): string {
  const original = hexToRgba(color.toLowerCase())
  const bgs = backgrounds.map((background) => hexToRgba(background.toLowerCase()))
  if (readsOn(original, bgs)) return toHex(original)
  const hsl = toHsl(original)
  const start = Math.round(hsl.l * STEPS)
  let best = original
  let bestScore = -1
  for (let offset = 1; offset <= STEPS; offset += 1) {
    for (const step of [start - offset, start + offset]) {
      if (step < 0 || step > STEPS) continue
      const candidate = fromHsl({ ...hsl, l: step / STEPS })
      if (readsOn(candidate, bgs)) return toHex(candidate)
      const score = Math.min(...bgs.map((background) => contrast(candidate, background)))
      if (score > bestScore) {
        best = candidate
        bestScore = score
      }
    }
  }
  return toHex(best)
}

// --- Ajuste de los colores en línea del árbol (plugin de rehype) ---

type Node = {
  type: string
  tagName?: string
  properties?: Record<string, unknown>
  children?: Node[]
}

/** Lo que tiene el texto debajo y encima en cada tema (claro, oscuro), ya opaco. */
type Paint = { fg: [Rgba, Rgba]; bg: [Rgba, Rgba] }

const THEME_PAINT: Paint = {
  fg: [hexToRgba(THEME_FOREGROUNDS[0]), hexToRgba(THEME_FOREGROUNDS[1])],
  bg: [hexToRgba(THEME_BACKGROUNDS[0]), hexToRgba(THEME_BACKGROUNDS[1])]
}

/**
 * El `color` y el `background-color` válidos de un `style` (gana el último válido de cada uno);
 * cualquier otra declaración, o una con un valor fuera de la lista, se descarta.
 */
export function styleColors(style: string): { color?: Rgba; background?: Rgba } {
  const result: { color?: Rgba; background?: Rgba } = {}
  for (const part of style.split(';')) {
    const colon = part.indexOf(':')
    if (colon < 0) continue
    const property = part.slice(0, colon).trim().toLowerCase()
    if (property !== 'color' && property !== 'background-color') continue
    const value = parseColor(part.slice(colon + 1))
    if (value === null) continue
    if (property === 'color') result.color = value
    else result.background = value
  }
  return result
}

const bothThemes = (paint: (theme: 0 | 1) => Rgba): [Rgba, Rgba] => [paint(0), paint(1)]

/**
 * Decide los colores en línea de un elemento a partir de lo que hereda. Devuelve el `style` que
 * queda (o undefined) y lo que hereda su contenido.
 */
function paintElement(
  own: { color?: Rgba; background?: Rgba },
  inherited: Paint
): { style: string | undefined; paint: Paint } {
  let { color, background } = own
  // Un fondo casi transparente es el del tema: no se pinta.
  if (background !== undefined && background.a <= TRANSPARENT_BACKGROUND) background = undefined

  if (background !== undefined) {
    const fill = background
    const bg = bothThemes((t) => over(fill, inherited.bg[t]))
    if (color !== undefined) {
      const text = color
      // El par se mide tal cual; si no se lee en los dos temas, se quitan los dos.
      if (contrast(text, bg[0]) >= MIN_CONTRAST && contrast(text, bg[1]) >= MIN_CONTRAST) {
        return {
          style: `color:${formatColor(text)};background-color:${formatColor(fill)}`,
          paint: { fg: bothThemes((t) => over(text, bg[t])), bg }
        }
      }
      return { style: undefined, paint: inherited }
    }
    // Sin color propio, el texto es el que hereda (o el del tema).
    if (
      contrast(inherited.fg[0], bg[0]) >= MIN_CONTRAST &&
      contrast(inherited.fg[1], bg[1]) >= MIN_CONTRAST
    ) {
      return { style: `background-color:${formatColor(fill)}`, paint: { fg: inherited.fg, bg } }
    }
    return { style: undefined, paint: inherited }
  }

  if (color === undefined) return { style: undefined, paint: inherited }
  if (!readsOn(color, inherited.bg)) {
    // Se ajusta el color opaco; si ni así se lee (fondos heredados imposibles), se quita.
    const adjusted = hexToRgba(readableColor(toHex(color), inherited.bg.map(toHex)))
    if (!readsOn(adjusted, inherited.bg)) return { style: undefined, paint: inherited }
    color = adjusted
  }
  const text = color
  return {
    style: `color:${formatColor(text)}`,
    paint: { fg: bothThemes((t) => over(text, inherited.bg[t])), bg: inherited.bg }
  }
}

function paintTree(node: Node, inherited: Paint): void {
  let paint = inherited
  if (node.type === 'element') {
    const properties = node.properties ?? {}
    const style = typeof properties['style'] === 'string' ? properties['style'] : ''
    const own = styleColors(style)
    // `font color`: como un `style` con ese color (el `style` gana, como en CSS).
    if (node.tagName === 'font') {
      const fontColor =
        typeof properties['color'] === 'string' ? parseColor(properties['color']) : null
      if (own.color === undefined && fontColor !== null) own.color = fontColor
      node.tagName = 'span'
    }
    const result = paintElement(own, inherited)
    // El `style` sale de nuevo (solo con lo que queda) y el `color` de `font` ya va en él.
    const rest = { ...properties }
    delete rest['style']
    delete rest['color']
    node.properties = result.style === undefined ? rest : { ...rest, style: result.style }
    paint = result.paint
  }
  for (const child of node.children ?? []) paintTree(child, paint)
}

/**
 * Plugin de rehype: deja en cada `style` solo `color` y `background-color` válidos, pasa `font
 * color` a un `span` con `style` y ajusta los colores para que el texto se lea a ≥ 3:1 en los dos
 * temas (los fondos solo se conservan si el texto encima se lee). Va después del saneado.
 */
export function rehypeSafeColors() {
  return (tree: { type: string }): void => {
    paintTree(tree as Node, THEME_PAINT)
  }
}
