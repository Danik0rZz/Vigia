import { useState, type JSX, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import Markdown, { type Components, type Options, type UrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Info, Lightbulb, MessageSquareWarning, OctagonAlert, TriangleAlert } from 'lucide-react'
import { invoke } from '../lib/ipc'
import {
  ALERT_TYPES,
  codeLanguage,
  hastText,
  preCode,
  rehypeAlerts,
  rehypeCodeHighlight,
  rehypeMarks,
  type AlertType,
  type HastNode
} from './markdown-plugins'
import { htmlPlugins } from './markdown-html'

/**
 * Markdown del tenant (contenido no fiable), ficha 0001:
 *
 * - CommonMark + GFM como elementos de React, sin `dangerouslySetInnerHTML`.
 * - El HTML de formato escrito en el texto (colores, `mark`, `kbd`, `details`…)
 *   se interpreta con una lista blanca (ficha 0043, `markdown-html.ts`): lo que
 *   no está en la lista no crea elementos ni atributos, y los colores se validan
 *   y se ajustan para leerse en los dos temas (`markdown-color.ts`).
 * - Solo los enlaces http/https son enlaces, y se abren en el navegador del
 *   sistema (`target="_blank"`, que recoge `setWindowOpenHandler` de main).
 *   Cualquier otro esquema o una ruta relativa se queda en texto.
 * - Las imágenes no se cargan nunca: su texto alternativo o, sin él, la URL.
 *
 * Capa visual (ficha 0038, `markdown-plugins.ts` y las clases `md-*` de
 * `main.css`): bloques de código con números de línea, colores por lenguaje y
 * «Copiar»; código en línea como píldora; avisos de GitHub; marcas ✓ ✗ ⚠ al
 * principio de un elemento, y tipografía con jerarquía. Los plugins solo
 * cambian el árbol: siguen sin pasar por HTML.
 */

/** Si es una URL absoluta http o https. */
function isWebUrl(url: string): boolean {
  try {
    const protocol = new URL(url).protocol
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Antes de pintar: un href que no es web se quita (el enlace sale como texto).
 * El src de una imagen se deja tal cual: nunca llega a un `img`, solo se
 * enseña como texto si no hay alternativo.
 */
const urlTransform: UrlTransform = (url, key) => {
  if (key === 'src') return url
  return isWebUrl(url) ? url : null
}

// Orden: primero el HTML de formato (interpretar, sanear y colores), después los avisos y las
// marcas (miran el texto tal cual) y al final los colores de los bloques de código. La capa visual
// va después del saneado, para que sus clases no se quiten.
const rehypePlugins = [
  ...htmlPlugins,
  rehypeAlerts,
  rehypeMarks,
  rehypeCodeHighlight
] as unknown as Options['rehypePlugins']

/** Texto del bloque sin el salto de línea final que añade Markdown. */
const blockCode = (code: HastNode): string => hastText(code).replace(/\r?\n$/, '')

/**
 * Bloque de código: cabecera con el lenguaje y «Copiar» (copia el código por
 * `app:copyText`, sin los números), columna de números apagada y el `pre`.
 */
function CodeBlock({
  node,
  children
}: {
  node: HastNode | undefined
  children: ReactNode
}): JSX.Element {
  const { t } = useTranslation()
  const [copy, setCopy] = useState<'idle' | 'done' | 'failed'>('idle')
  const code = node === undefined ? null : preCode(node)
  // Un `pre` escrito en HTML puede no llevar `code`: se copia su texto.
  const text = node === undefined ? '' : blockCode(code ?? node)
  const language = code === null ? null : codeLanguage(code)
  const lines = text.split('\n')
  const copyCode = (): void => {
    invoke('app:copyText', { text })
      .then(() => setCopy('done'))
      .catch(() => setCopy('failed'))
  }
  return (
    <div data-testid="md-code-block" className="md-code-block">
      <div className="md-code-header">
        <span className="md-code-language">{language}</span>
        {copy !== 'idle' && (
          <span data-testid="md-code-copy-status" role="status" className="md-code-status">
            {t(copy === 'done' ? 'errorScreen.copied' : 'errorScreen.copyFailed')}
          </span>
        )}
        <button
          type="button"
          data-testid="md-code-copy"
          aria-label={t('markdown.copyCodeLabel')}
          onClick={copyCode}
          className="md-code-copy"
        >
          {t('markdown.copyCode')}
        </button>
      </div>
      <div className="md-code-body">
        {/* Los números no son parte del código: ni se seleccionan ni se leen. */}
        <div aria-hidden="true" className="md-code-gutter">
          {lines.map((_, index) => (
            <span key={index} data-line-number={index + 1}>
              {index + 1}
            </span>
          ))}
        </div>
        <pre className="md-code-pre">{children}</pre>
      </div>
    </div>
  )
}

const ALERT_ICONS = {
  note: Info,
  tip: Lightbulb,
  important: MessageSquareWarning,
  warning: TriangleAlert,
  caution: OctagonAlert
} as const

const ALERT_TITLES = {
  note: 'markdown.alerts.note',
  tip: 'markdown.alerts.tip',
  important: 'markdown.alerts.important',
  warning: 'markdown.alerts.warning',
  caution: 'markdown.alerts.caution'
} as const

function alertType(node: HastNode | undefined): AlertType | null {
  const value = node?.properties?.['dataAlert']
  return ALERT_TYPES.find((type) => type === value) ?? null
}

/** Cita normal, o aviso de GitHub si `rehypeAlerts` la marcó. */
function Blockquote({
  node,
  children
}: {
  node: HastNode | undefined
  children: ReactNode
}): JSX.Element {
  const { t } = useTranslation()
  const type = alertType(node)
  if (type === null) return <blockquote className="md-quote">{children}</blockquote>
  const Icon = ALERT_ICONS[type]
  return (
    <div role="note" className={`md-alert md-alert-${type}`}>
      <p className="md-alert-title">
        <Icon aria-hidden="true" className="size-3.5 shrink-0" />
        {t(ALERT_TITLES[type])}
      </p>
      {children}
    </div>
  )
}

const components: Components = {
  a: ({ href, children }) =>
    typeof href === 'string' && isWebUrl(href) ? (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="underline decoration-accent underline-offset-2 hover:decoration-2"
      >
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
  img: ({ alt, src }) => (
    <span className="text-muted-foreground italic">
      {alt !== undefined && alt !== '' ? alt : typeof src === 'string' ? src : ''}
    </span>
  ),
  // `style` y `title` los trae el HTML de formato ya saneado (ficha 0043).
  p: ({ children, className, style, title }) => (
    <p className={className} style={style} title={title}>
      {children}
    </p>
  ),
  li: ({ children, className, style, title }) => (
    <li className={className} style={style} title={title}>
      {children}
    </li>
  ),
  ol: ({ children, start, style, title }) => (
    <ol start={start} style={style} title={title}>
      {children}
    </ol>
  ),
  blockquote: ({ node, children }) => (
    <Blockquote node={node as HastNode | undefined}>{children}</Blockquote>
  ),
  pre: ({ node, children }) => (
    <CodeBlock node={node as HastNode | undefined}>{children}</CodeBlock>
  ),
  code: ({ children, className, style, title }) => (
    <code className={className} style={style} title={title}>
      {children}
    </code>
  ),
  // Tablas con scroll propio: no ensanchan la fila.
  table: ({ children }) => (
    <div className="overflow-x-auto">
      <table>{children}</table>
    </div>
  ),
  th: ({ children, style, title }) => (
    <th style={style} title={title}>
      {children}
    </th>
  ),
  td: ({ children, style, title }) => (
    <td style={style} title={title}>
      {children}
    </td>
  )
}

export function MarkdownText({ text }: { text: string }): JSX.Element {
  return (
    <div className="md-text">
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={rehypePlugins}
        urlTransform={urlTransform}
        components={components}
      >
        {text}
      </Markdown>
    </div>
  )
}
