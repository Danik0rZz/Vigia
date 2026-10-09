import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { type Options as SanitizeOptions } from 'rehype-sanitize'
import { rehypeSafeColors } from './markdown-color'

/**
 * HTML de formato dentro de las descripciones (ficha 0043): `rehype-raw` lo interpreta y
 * `rehype-sanitize` lo deja pasar solo con la lista blanca de abajo. Después, `rehypeSafeColors`
 * valida los colores y ajusta el contraste.
 *
 * Los elementos que genera el propio Markdown (no el HTML escrito) no pasan por la lista blanca de
 * atributos: antes de `rehype-raw` se guardan sus propiedades en el `VFile` y se dejan con una
 * marca `data-vigia-slot` con un valor aleatorio de esta sesión (imposible de adivinar desde el
 * contenido); después del saneado se les devuelven. Así conservan lo suyo (clases de lenguaje,
 * casillas de las listas de tareas, notas al pie, alineación de tablas…) sin abrir esos atributos
 * al HTML escrito. Los que no están en la lista (`img`, `input`, `section`) viajan como `span` o
 * `div` y recuperan su etiqueta al final. Los enlaces e imágenes siguen la regla de la 0001 en
 * `MarkdownText` (`urlTransform` y sus componentes).
 */

type Node = {
  type: string
  tagName?: string
  properties?: Record<string, unknown>
  children?: Node[]
}

type File = { data: Record<string, unknown> }

type Slot = { tagName: string; properties: Record<string, unknown> }

const SLOTS_KEY = 'vigiaMarkdownSlots'

/** Valor aleatorio de la sesión: el HTML escrito no puede imitar una marca. */
const NONCE = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
  byte.toString(16).padStart(2, '0')
).join('')

const SLOT_PATTERN = new RegExp(`^${NONCE}-(\\d+)$`)

/** Etiquetas permitidas: las de la ficha y las que genera el Markdown (encabezados, citas, enlaces). */
const TAG_NAMES = [
  'span',
  'mark',
  'b',
  'strong',
  'i',
  'em',
  'u',
  's',
  'del',
  'sub',
  'sup',
  'small',
  'kbd',
  'br',
  'hr',
  'code',
  'pre',
  'p',
  'div',
  'ul',
  'ol',
  'li',
  'table',
  'caption',
  'colgroup',
  'col',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'details',
  'summary',
  'font',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'a'
]

/** Se quitan con todo su contenido (el resto de etiquetas fuera de la lista dejan su texto). */
const STRIP = [
  'script',
  'style',
  'template',
  'noscript',
  'iframe',
  'frame',
  'frameset',
  'noframes',
  'object',
  'embed',
  'applet',
  'svg',
  'math',
  'textarea',
  'select',
  'button',
  'title',
  'xmp',
  'noembed',
  'plaintext',
  'video',
  'audio',
  'picture',
  'map'
]

const SANITIZE_SCHEMA: SanitizeOptions = {
  tagNames: TAG_NAMES,
  strip: STRIP,
  attributes: {
    // `style` se limpia después en `rehypeSafeColors` (solo color y background-color válidos).
    '*': ['title', 'style', ['dataVigiaSlot', SLOT_PATTERN]],
    a: ['href'],
    font: ['color']
  },
  protocols: { href: ['http', 'https'] },
  clobber: [],
  allowComments: false,
  allowDoctypes: false
}

const ALLOWED = new Set(TAG_NAMES)

function visit(node: Node, callback: (node: Node) => void): void {
  callback(node)
  for (const child of node.children ?? []) visit(child, callback)
}

/** Antes de `rehype-raw`: guarda las propiedades de los elementos del Markdown y los marca. */
function rehypeProtectMarkdown() {
  return (tree: { type: string }, file: File): void => {
    const slots: Slot[] = []
    visit(tree as Node, (node) => {
      if (node.type !== 'element' || node.tagName === undefined) return
      slots.push({ tagName: node.tagName, properties: node.properties ?? {} })
      if (!ALLOWED.has(node.tagName)) {
        node.tagName = (node.children ?? []).length === 0 ? 'span' : 'div'
      }
      node.properties = { dataVigiaSlot: `${NONCE}-${slots.length - 1}` }
    })
    file.data[SLOTS_KEY] = slots
  }
}

/** Después del saneado: devuelve a los elementos del Markdown su etiqueta y sus propiedades. */
function rehypeRestoreMarkdown() {
  return (tree: { type: string }, file: File): void => {
    const slots = (file.data[SLOTS_KEY] ?? []) as Slot[]
    visit(tree as Node, (node) => {
      if (node.type !== 'element') return
      const { dataVigiaSlot, ...rest } = node.properties ?? {}
      node.properties = rest
      const index = Number(SLOT_PATTERN.exec(String(dataVigiaSlot ?? ''))?.[1] ?? Number.NaN)
      const slot = slots[index]
      // Un elemento que el HTML parte en dos (el analizador repite su apertura) recupera lo suyo
      // en los dos trozos: es contenido del Markdown, no del HTML escrito.
      if (slot === undefined) return
      node.tagName = slot.tagName
      node.properties = { ...slot.properties }
    })
    delete file.data[SLOTS_KEY]
  }
}

/** Plugins del HTML de formato, en orden; van antes de los de la capa visual. */
export const htmlPlugins = [
  rehypeProtectMarkdown,
  rehypeRaw,
  [rehypeSanitize, SANITIZE_SCHEMA],
  rehypeRestoreMarkdown,
  rehypeSafeColors
] as const
