import { createLowlight } from 'lowlight'
import bash from 'highlight.js/lib/languages/bash'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import python from 'highlight.js/lib/languages/python'
import sql from 'highlight.js/lib/languages/sql'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'

/**
 * Plugins de rehype de la capa visual del visor de Markdown (ficha 0038). Trabajan sobre el árbol
 * hast que construye react-markdown, antes de pasarlo a elementos de React: no generan HTML ni
 * usan `eval`, así que no tocan las reglas del ADR-0008 ni la CSP.
 *
 * - `rehypeCodeHighlight`: colores por lenguaje con lowlight (highlight.js), solo con los lenguajes
 *   registrados aquí. Un bloque sin lenguaje o con uno de fuera de la lista se queda sin colores.
 * - `rehypeAlerts`: avisos de GitHub (`> [!NOTE]` y los otros cuatro) en el primer párrafo de una
 *   cita.
 * - `rehypeMarks`: marcas ✓ ✗ ⚠ al principio de un elemento de lista o de un párrafo.
 */

/** Nodo hast mínimo (lo justo para estos plugins; los tipos de hast no son dependencia directa). */
export type HastNode = {
  type: string
  tagName?: string
  value?: string
  properties?: Record<string, unknown>
  children?: HastNode[]
}

/**
 * Lenguajes con colores: el que vio la ficha 0035 en vivo (yaml) y los de la lista de la 0038. Se
 * registran uno a uno (sin `common` ni `all` de lowlight) para no cargar los demás. Sus alias
 * (yml, sh, js, ts, py, html…) los trae cada gramática.
 */
const lowlight = createLowlight({
  bash,
  java,
  javascript,
  json,
  python,
  sql,
  typescript,
  xml,
  yaml
})

const isElement = (node: HastNode, tagName?: string): boolean =>
  node.type === 'element' && (tagName === undefined || node.tagName === tagName)

function classList(node: HastNode): string[] {
  const value = node.properties?.['className']
  if (Array.isArray(value)) return value.map(String)
  return typeof value === 'string' ? value.split(/\s+/).filter((c) => c !== '') : []
}

function addClasses(node: HastNode, ...names: string[]): void {
  node.properties = { ...node.properties, className: [...classList(node), ...names] }
}

/** Texto de un nodo hast, sin marcas. */
export function hastText(node: HastNode): string {
  if (node.type === 'text') return node.value ?? ''
  return (node.children ?? []).map(hastText).join('')
}

/** Recorre el árbol en preorden. */
function visit(node: HastNode, callback: (node: HastNode) => void): void {
  callback(node)
  for (const child of node.children ?? []) visit(child, callback)
}

/** Lenguaje de un `code` según su clase `language-*`, en minúsculas. */
export function codeLanguage(code: HastNode): string | null {
  const name = classList(code).find((c) => c.startsWith('language-'))
  return name === undefined ? null : name.slice('language-'.length).toLowerCase()
}

/** El `code` de un `pre` (bloque de código de Markdown), o null. */
export function preCode(pre: HastNode): HastNode | null {
  return pre.children?.find((child) => isElement(child, 'code')) ?? null
}

export function rehypeCodeHighlight() {
  return (tree: { type: string }): void => {
    visit(tree as HastNode, (node) => {
      if (!isElement(node, 'pre')) return
      const code = preCode(node)
      if (code === null) return
      const language = codeLanguage(code)
      if (language === null || !lowlight.registered(language)) return
      const result = lowlight.highlight(language, hastText(code))
      code.children = result.children as unknown as HastNode[]
      addClasses(code, 'hljs')
    })
  }
}

export const ALERT_TYPES = ['note', 'tip', 'important', 'warning', 'caution'] as const
export type AlertType = (typeof ALERT_TYPES)[number]

/** El marcador de GitHub, solo en su propia línea (en mayúsculas o minúsculas, como GitHub). */
const ALERT_MARKER = /^\s*\[!(note|tip|important|warning|caution)\][ \t]*(?:\r?\n|$)/i

const isBlank = (node: HastNode): boolean =>
  node.type === 'text' && (node.value ?? '').trim() === ''

export function rehypeAlerts() {
  return (tree: { type: string }): void => {
    visit(tree as HastNode, (node) => {
      if (!isElement(node, 'blockquote')) return
      const paragraph = node.children?.find((child) => !isBlank(child))
      if (paragraph === undefined || !isElement(paragraph, 'p')) return
      const first = paragraph.children?.[0]
      if (first?.type !== 'text') return
      const match = ALERT_MARKER.exec(first.value ?? '')
      if (match === null) return
      first.value = (first.value ?? '').slice(match[0].length)
      if (first.value === '') paragraph.children?.shift()
      if ((paragraph.children ?? []).every(isBlank)) {
        node.children = node.children?.filter((child) => child !== paragraph)
      }
      node.properties = {
        ...node.properties,
        dataAlert: (match[1] ?? '').toLowerCase()
      }
    })
  }
}

export type MarkKind = 'success' | 'error' | 'warning'

/** Marcas reconocidas (con el selector de variante U+FE0F opcional detrás). */
const MARKS: [RegExp, MarkKind][] = [
  [/^[✓✔✅]️?/u, 'success'],
  [/^[✗✘❌]️?/u, 'error'],
  [/^⚠️?/u, 'warning']
]

/** El primer texto visible de un elemento, con su padre, o null si empieza por otra cosa. */
function leadingText(node: HastNode): { parent: HastNode; index: number } | null {
  const children = node.children ?? []
  for (const [index, child] of children.entries()) {
    if (isBlank(child)) continue
    if (child.type === 'text') return { parent: node, index }
    // La casilla de una lista de tareas va delante del texto.
    if (isElement(child, 'input')) continue
    // Una marca ya separada (el `p` de un `li` holgado): la cuenta el `li`.
    if (!isElement(child) || classList(child).includes('md-mark-glyph')) return null
    if (child.tagName === 'ul' || child.tagName === 'ol' || child.tagName === 'pre') return null
    return leadingText(child)
  }
  return null
}

export function rehypeMarks() {
  return (tree: { type: string }): void => {
    visit(tree as HastNode, (node) => {
      if (!isElement(node, 'li') && !isElement(node, 'p')) return
      const found = leadingText(node)
      if (found === null) return
      const text = found.parent.children?.[found.index]
      const value = text?.value ?? ''
      const start = value.length - value.trimStart().length
      for (const [pattern, kind] of MARKS) {
        const match = pattern.exec(value.slice(start))
        if (match === null) continue
        addClasses(node, `md-mark-${kind}`)
        // El símbolo va aparte para colorearlo solo a él; el texto no cambia.
        const pieces: HastNode[] = [
          ...(start > 0 ? [{ type: 'text', value: value.slice(0, start) }] : []),
          {
            type: 'element',
            tagName: 'span',
            properties: { className: ['md-mark-glyph', `md-mark-glyph-${kind}`] },
            children: [{ type: 'text', value: match[0] }]
          },
          { type: 'text', value: value.slice(start + match[0].length) }
        ]
        found.parent.children?.splice(found.index, 1, ...pieces)
        return
      }
    })
  }
}
