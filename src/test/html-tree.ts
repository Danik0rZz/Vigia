/**
 * Ayudas de los tests del visor de Markdown (ficha 0043): el HTML estático de
 * `renderToStaticMarkup` a un árbol pequeño, y colores CSS con su contraste WCAG.
 * Sin DOM ni Node: valen para los tests del renderer.
 */

// --- HTML estático a un árbol pequeño (como en `MarkdownText.visual.test.ts`) ---

export type HtmlNode = {
  tag: string
  attrs: Record<string, string>
  children: HtmlNode[]
  text: string
}

const VOID = new Set([
  'br',
  'hr',
  'img',
  'input',
  'meta',
  'link',
  'wbr',
  'col',
  'source',
  'embed',
  'base',
  'area',
  'track',
  'param'
])

const decode = (text: string): string =>
  text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, '&')

export function parse(html: string): HtmlNode {
  const root: HtmlNode = { tag: '#root', attrs: {}, children: [], text: '' }
  const stack: HtmlNode[] = [root]
  const pattern =
    /<\/([a-z0-9-]+)>|<([a-z0-9-]+)((?:\s+[^\s=>/]+(?:="[^"]*")?)*)\s*(\/?)>|([^<]+)/gi
  for (const match of html.matchAll(pattern)) {
    const parent = stack[stack.length - 1] as HtmlNode
    const [, closing, tag, rawAttrs, selfClosing, text] = match
    if (closing !== undefined) {
      stack.pop()
    } else if (tag !== undefined) {
      const attrs: Record<string, string> = {}
      for (const attr of (rawAttrs ?? '').matchAll(/([^\s=>/]+)(?:="([^"]*)")?/g)) {
        attrs[(attr[1] ?? '').toLowerCase()] = decode(attr[2] ?? '')
      }
      const node: HtmlNode = { tag: tag.toLowerCase(), attrs, children: [], text: '' }
      parent.children.push(node)
      if (selfClosing !== '/' && !VOID.has(node.tag)) stack.push(node)
    } else if (text !== undefined) {
      parent.children.push({ tag: '#text', attrs: {}, children: [], text: decode(text) })
    }
  }
  return root
}

export const textOf = (node: HtmlNode): string =>
  node.tag === '#text' ? node.text : node.children.map(textOf).join('')

export const all = (node: HtmlNode): HtmlNode[] =>
  node.children.flatMap((child) => (child.tag === '#text' ? [] : [child, ...all(child)]))

export const byTag = (node: HtmlNode, tag: string): HtmlNode[] =>
  all(node).filter((n) => n.tag === tag)

/** Declaraciones de un atributo `style` como pares `[propiedad, valor]`. */
export function declarations(style: string | undefined): [string, string][] {
  if (style === undefined) return []
  return style
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .map((part) => {
      const colon = part.indexOf(':')
      return [part.slice(0, colon).trim().toLowerCase(), part.slice(colon + 1).trim()]
    })
}

export const styleOf = (node: HtmlNode, property: string): string | undefined =>
  declarations(node.attrs['style']).find(([name]) => name === property)?.[1]

// --- Colores ---

export type Rgba = { r: number; g: number; b: number; a: number }

const NAMED: Record<string, string> = {
  red: '#ff0000',
  white: '#ffffff',
  black: '#000000',
  yellow: '#ffff00',
  blue: '#0000ff',
  navy: '#000080',
  green: '#008000',
  orange: '#ffa500',
  gray: '#808080',
  grey: '#808080',
  darkred: '#8b0000',
  darkblue: '#00008b'
}

/** Un color CSS (#rgb, #rrggbb, rgb(), rgba() o los nombres de arriba) a canales 0–255. */
export function toRgba(value: string): Rgba | null {
  const text = value.trim().toLowerCase()
  const named = NAMED[text]
  if (named !== undefined) return toRgba(named)
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(text)
  if (short !== null) {
    const [r, g, b] = short.slice(1).map((c) => parseInt(c + c, 16)) as [number, number, number]
    return { r, g, b, a: 1 }
  }
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/.exec(text)
  if (long !== null) {
    const [r, g, b] = long.slice(1).map((c) => parseInt(c, 16)) as [number, number, number]
    return { r, g, b, a: 1 }
  }
  const fn = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(
    text
  )
  if (fn !== null) {
    const alphaText = fn[4]
    const a =
      alphaText === undefined
        ? 1
        : alphaText.endsWith('%')
          ? parseFloat(alphaText) / 100
          : parseFloat(alphaText)
    return { r: Number(fn[1]), g: Number(fn[2]), b: Number(fn[3]), a }
  }
  return null
}

export const sameColor = (value: string | undefined, expected: string): boolean => {
  const a = value === undefined ? null : toRgba(value)
  const b = toRgba(expected)
  return a !== null && b !== null && a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a
}

function luminance({ r, g, b }: Rgba): number {
  const [lr, lg, lb] = [r, g, b].map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb
}

/** Contraste del texto (con su opacidad, mezclado sobre el fondo) frente al fondo. */
export function contrastOver(color: Rgba, background: Rgba): number {
  const mix = (c: number, bg: number): number => color.a * c + (1 - color.a) * bg
  const shown = {
    r: mix(color.r, background.r),
    g: mix(color.g, background.g),
    b: mix(color.b, background.b),
    a: 1
  }
  const [hi, lo] = [luminance(shown), luminance(background)].sort((x, y) => y - x) as [
    number,
    number
  ]
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * El color con el que se pinta un texto: el `color` del `style` o del atributo `color` (`font`) del
 * elemento más cercano que lo envuelve.
 */
export function paintedColor(tree: HtmlNode, text: string): string | undefined {
  let found: string | undefined
  const visit = (node: HtmlNode, inherited: string | undefined): void => {
    const own = styleOf(node, 'color') ?? node.attrs['color'] ?? inherited
    if (node.tag !== '#text' && textOf(node) === text && own !== undefined) found = own
    for (const child of node.children) visit(child, own)
  }
  visit(tree, undefined)
  return found
}
