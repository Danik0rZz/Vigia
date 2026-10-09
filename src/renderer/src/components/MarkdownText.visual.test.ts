import i18n, { type Resource } from 'i18next'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { initReactI18next } from 'react-i18next'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import packageJson from '../../../../package.json?raw'
import { MarkdownText } from './MarkdownText'

/**
 * Ficha 0038: capa visual del visor de Markdown (`MarkdownText`, props `{ text: string }`). Se
 * comprueba sobre el HTML que genera React, como en `MarkdownText.test.ts`, con i18next arrancado
 * con los textos reales de es y en (los títulos de los avisos van traducidos).
 *
 * Contrato elegido al escribir los tests (la ficha no fija nombres; anotado en su «Verificación»):
 *
 * - Bloque de código: un elemento por número de línea con `data-line-number="N"` (1, 2, …), fuera
 *   del `code`, cuyo texto es exactamente el código. Los tokens coloreados llevan clases `hljs-*`
 *   (las de highlight.js).
 * - Aviso de GitHub: caja con las clases `md-alert` y `md-alert-<tipo>` (`note`, `tip`,
 *   `important`, `warning`, `caution`), con su título traducido delante del cuerpo.
 * - Marcas: el `li` (o el `p`) que empieza por la marca lleva `md-mark-success`, `md-mark-error` o
 *   `md-mark-warning`.
 *
 * Fixtures inventados, sin nada del tenant.
 */

// --- i18next con los textos reales (como `app/i18n.ts`, sin preferencias ni documento) ---

function loadResources(): Resource {
  const files = import.meta.glob<Record<string, unknown>>('../locales/*/*.json', {
    eager: true,
    import: 'default'
  })
  const resources: Resource = {}
  for (const [path, messages] of Object.entries(files)) {
    const match = /\/locales\/([^/]+)\/([^/]+)\.json$/.exec(path)
    if (match === null) continue
    const [, language, namespace] = match as unknown as [string, string, string]
    resources[language] = { ...resources[language], [namespace]: messages }
  }
  return resources
}

beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    resources: loadResources(),
    defaultNS: 'common',
    lng: 'es',
    fallbackLng: 'es',
    interpolation: { escapeValue: false }
  })
})

beforeEach(async () => {
  await i18n.changeLanguage('es')
})

// --- HTML estático a un árbol pequeño, para mirar elementos, clases y texto ---

type HtmlNode = { tag: string; attrs: Record<string, string>; children: HtmlNode[]; text: string }

const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'wbr', 'col', 'source'])

const decode = (text: string): string =>
  text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, '&')

/** Parte el HTML de `renderToStaticMarkup` (bien formado) en un árbol con nodos de texto (`#text`). */
function parse(html: string): HtmlNode {
  const root: HtmlNode = { tag: '#root', attrs: {}, children: [], text: '' }
  const stack: HtmlNode[] = [root]
  const pattern = /<\/([a-z0-9]+)>|<([a-z0-9]+)((?:\s+[^\s=>/]+(?:="[^"]*")?)*)\s*(\/?)>|([^<]+)/gi
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

const textOf = (node: HtmlNode): string =>
  node.tag === '#text' ? node.text : node.children.map(textOf).join('')

const all = (node: HtmlNode): HtmlNode[] =>
  node.children.flatMap((child) => (child.tag === '#text' ? [] : [child, ...all(child)]))

const classes = (node: HtmlNode): string[] => (node.attrs['class'] ?? '').split(/\s+/)

const byTag = (node: HtmlNode, tag: string): HtmlNode[] => all(node).filter((n) => n.tag === tag)

const byClass = (node: HtmlNode, name: string): HtmlNode[] =>
  all(node).filter((n) => classes(n).includes(name))

/** Elementos con alguna clase de token de highlight.js (`hljs-keyword`, `hljs-attr`, …). */
const tokens = (node: HtmlNode): HtmlNode[] =>
  all(node).filter((n) => classes(n).some((c) => /^hljs-[a-z]/.test(c)))

const render = (text: string): HtmlNode =>
  parse(renderToStaticMarkup(createElement(MarkdownText, { text })))

const fence = (language: string, code: string): string => ['```' + language, code, '```'].join('\n')

/** El primer `pre` y su `code`, o falla. */
function codeBlock(tree: HtmlNode): { pre: HtmlNode; code: HtmlNode } {
  const pre = byTag(tree, 'pre')
  expect(pre, 'bloque pre').toHaveLength(1)
  const code = byTag(pre[0] as HtmlNode, 'code')
  expect(code, 'code dentro del pre').toHaveLength(1)
  return { pre: pre[0] as HtmlNode, code: code[0] as HtmlNode }
}

/** Los números de línea del bloque, en orden. */
const lineNumbers = (tree: HtmlNode): string[] =>
  all(tree)
    .filter((n) => 'data-line-number' in n.attrs)
    .map((n) => n.attrs['data-line-number'] ?? '')

const YAML = ['servicio:', '  nombre: pagos', '  replicas: 3', '  activo: true'].join('\n')

describe('CA1 (0038): bloques de código con números de línea y colores por lenguaje', () => {
  it('un bloque yaml: un número por línea y clases de resaltado en sus tokens', () => {
    const tree = render(`Antes del bloque.\n\n${fence('yaml', YAML)}`)
    const { pre, code } = codeBlock(tree)
    expect(lineNumbers(tree)).toEqual(['1', '2', '3', '4'])
    // Los números se ven (texto del elemento) y van fuera del código.
    for (const n of all(pre).filter((node) => 'data-line-number' in node.attrs)) {
      expect(textOf(n).trim()).toBe(n.attrs['data-line-number'])
    }
    expect(textOf(code).replace(/\n$/, '')).toBe(YAML)
    expect(tokens(code).length).toBeGreaterThan(0)
    // Las claves del YAML van coloreadas como tales.
    expect(tokens(code).map(textOf).join(' ')).toContain('servicio')
  })

  it('un bloque sin lenguaje: con números de línea y sin clases de resaltado', () => {
    const plain = ['servicio:', '  nombre: pagos', 'const a = 1'].join('\n')
    const tree = render(fence('', plain))
    const { pre, code } = codeBlock(tree)
    expect(lineNumbers(tree)).toEqual(['1', '2', '3'])
    expect(textOf(code).replace(/\n$/, '')).toBe(plain)
    expect(tokens(pre)).toEqual([])
  })

  it('una sola línea lleva un solo número', () => {
    const tree = render(fence('yaml', 'clave: valor'))
    expect(lineNumbers(tree)).toEqual(['1'])
  })
})

describe('CA3 (0038): avisos de GitHub', () => {
  const ALERTS = [
    ['NOTE', 'note', 'Información', 'Note'],
    ['TIP', 'tip', 'Consejo', 'Tip'],
    ['IMPORTANT', 'important', 'Importante', 'Important'],
    ['WARNING', 'warning', 'Aviso', 'Warning'],
    ['CAUTION', 'caution', 'Peligro', 'Caution']
  ] as const

  /** La única caja de aviso del árbol, con su título delante del cuerpo. */
  function alertBox(tree: HtmlNode, type: string): HtmlNode {
    const boxes = byClass(tree, 'md-alert')
    expect(boxes, 'una caja md-alert').toHaveLength(1)
    const box = boxes[0] as HtmlNode
    expect(classes(box), `clase md-alert-${type}`).toContain(`md-alert-${type}`)
    return box
  }

  it.each(ALERTS)(
    '[!%s]: caja con su clase de color y su título en es y en',
    async (marker, type, titleEs, titleEn) => {
      const text = `> [!${marker}]\n> Revisa el pool de conexiones.`
      for (const [language, title] of [
        ['es', titleEs],
        ['en', titleEn]
      ] as const) {
        await i18n.changeLanguage(language)
        const box = alertBox(render(text), type)
        const visible = textOf(box)
        expect(visible.toLowerCase(), `${language}: título`).toContain(title.toLowerCase())
        expect(visible, `${language}: cuerpo`).toContain('Revisa el pool de conexiones.')
        expect(visible.toLowerCase().indexOf(title.toLowerCase())).toBeLessThan(
          visible.indexOf('Revisa el pool')
        )
        // El marcador no se ve.
        expect(visible, `${language}: sin [!${marker}]`).not.toContain(`[!${marker}]`)
        // Solo una de las cinco clases de color.
        const others = ALERTS.filter(([, other]) => other !== type).map(
          ([, other]) => `md-alert-${other}`
        )
        expect(classes(box).filter((c) => others.includes(c))).toEqual([])
      }
    }
  )

  it('el marcador en minúsculas también es un aviso (como en GitHub)', () => {
    alertBox(render('> [!warning]\n> Disco casi lleno.'), 'warning')
  })

  it('una cita normal sigue siendo una cita, sin caja de aviso', () => {
    const tree = render('> Avisado por el equipo de guardia.')
    expect(byClass(tree, 'md-alert')).toEqual([])
    const quotes = byTag(tree, 'blockquote')
    expect(quotes).toHaveLength(1)
    expect(textOf(quotes[0] as HtmlNode)).toContain('Avisado por el equipo de guardia.')
  })

  it('un tipo que no es de GitHub ([!INFO]) sigue siendo una cita con su texto', () => {
    const tree = render('> [!INFO]\n> Texto.')
    expect(byClass(tree, 'md-alert')).toEqual([])
    expect(byTag(tree, 'blockquote')).toHaveLength(1)
    expect(textOf(tree)).toContain('[!INFO]')
  })
})

describe('CA4 (0038): marcas al principio de un elemento de lista o párrafo', () => {
  const MARKS = [
    ['✓', 'md-mark-success'],
    ['✔', 'md-mark-success'],
    ['✅', 'md-mark-success'],
    ['✗', 'md-mark-error'],
    ['✘', 'md-mark-error'],
    ['❌', 'md-mark-error'],
    ['⚠', 'md-mark-warning']
  ] as const
  const MARK_CLASSES = ['md-mark-success', 'md-mark-error', 'md-mark-warning']

  const markClasses = (node: HtmlNode): string[] =>
    classes(node).filter((c) => MARK_CLASSES.includes(c))

  it('✓ lleva la clase de éxito, ✗ la de error y ⚠ la de aviso; sin marca, ninguna', () => {
    const tree = render(['- ✓ base de datos', '- ✗ caché', '- ⚠ disco', '- sin marca'].join('\n'))
    const items = byTag(tree, 'li')
    expect(items).toHaveLength(4)
    expect(items.map(markClasses)).toEqual([
      ['md-mark-success'],
      ['md-mark-error'],
      ['md-mark-warning'],
      []
    ])
    // El símbolo se sigue viendo (es la señal; el color la refuerza).
    expect(textOf(items[0] as HtmlNode)).toContain('✓')
  })

  it.each(MARKS)('%s al principio de un elemento de lista: %s', (mark, expected) => {
    const items = byTag(render(`- ${mark} comprobado`), 'li')
    expect(items).toHaveLength(1)
    expect(markClasses(items[0] as HtmlNode)).toEqual([expected])
  })

  it.each(MARKS)('%s al principio de un párrafo: %s', (mark, expected) => {
    const paragraphs = byTag(render(`${mark} Conexión revisada.`), 'p')
    expect(paragraphs).toHaveLength(1)
    expect(markClasses(paragraphs[0] as HtmlNode)).toEqual([expected])
  })

  it('una marca en medio del texto no colorea el elemento', () => {
    const tree = render('- revisado ✓ ayer\n\nTodo ✗ por ahora')
    for (const node of [...byTag(tree, 'li'), ...byTag(tree, 'p')]) {
      expect(markClasses(node)).toEqual([])
    }
  })
})

describe('CA5 (0038): el HTML en crudo sigue saliendo como texto con la capa visual', () => {
  it.each([
    ['en un aviso', '> [!NOTE]\n> <b>negrita</b> <img src=x onerror="window.__xss=1">'],
    ['en un elemento con marca', '- ✓ <b>negrita</b> <img src=x onerror="window.__xss=1">'],
    ['en un bloque de código', fence('xml', '<b>negrita</b> <img src=x onerror="x()">')]
  ])('%s', (_label, text) => {
    const tree = render(text)
    expect(byTag(tree, 'b')).toEqual([])
    expect(byTag(tree, 'img')).toEqual([])
    expect(all(tree).filter((n) => Object.keys(n.attrs).some((a) => a.startsWith('on')))).toEqual(
      []
    )
    expect(textOf(tree)).toContain('<b>negrita</b>')
  })
})

describe('CA6 (0038): solo se registran los lenguajes de la lista', () => {
  // La 0035 solo encontró yaml en vivo (docs/notas-api-v2.md); el resto es la lista de la ficha.
  const LISTED: [string, string][] = [
    ['yaml', YAML],
    ['json', '{ "nombre": "pagos", "replicas": 3, "activo": true }'],
    ['bash', 'echo "hola" # comentario\nexport RUTA=/tmp'],
    ['sql', 'SELECT nombre FROM servicios WHERE replicas > 3;'],
    ['javascript', 'const total = 1 // comentario\nfunction f() { return "x" }'],
    ['typescript', 'interface A { n: number }\nconst a: A = { n: 1 }'],
    ['python', 'def f(n):\n    return n + 1  # comentario'],
    ['java', 'public class A {\n  private int n = 1;\n}'],
    ['xml', '<servicio nombre="pagos"><replicas>3</replicas></servicio>']
  ]

  it.each(LISTED)('%s, de la lista, sale con colores', (language, code) => {
    const { code: element } = codeBlock(render(fence(language, code)))
    expect(tokens(element).length, language).toBeGreaterThan(0)
  })

  it.each([
    ['rust', 'fn main() {\n    let total: i32 = 1; // comentario\n    println!("{}", total);\n}'],
    ['go', 'package main\n\nfunc main() {\n\tvar total int = 1 // comentario\n}'],
    ['ruby', 'def suma(n)\n  return n + 1 # comentario\nend'],
    ['cpp', '#include <vector>\nint main() { return 0; }']
  ])('%s, fuera de la lista, sale sin colores (y con sus números de línea)', (language, code) => {
    const tree = render(fence(language, code))
    const { pre, code: element } = codeBlock(tree)
    expect(tokens(pre), language).toEqual([])
    expect(textOf(element).replace(/\n$/, '')).toBe(code)
    expect(lineNumbers(tree)).toEqual(code.split('\n').map((_, i) => String(i + 1)))
  })

  it('la librería de resaltado es una dependencia con versión exacta', () => {
    const pkg = JSON.parse(packageJson) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }
    const highlighters = ['rehype-highlight', 'highlight.js', 'lowlight'].filter(
      (name) => name in deps
    )
    expect(highlighters.length, 'rehype-highlight, highlight.js o lowlight').toBeGreaterThan(0)
    for (const name of highlighters) {
      expect(deps[name], name).toMatch(/^\d+\.\d+\.\d+$/)
    }
  })
})
