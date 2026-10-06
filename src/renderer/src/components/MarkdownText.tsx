import type { JSX } from 'react'
import Markdown, { type Components, type UrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'

/**
 * Markdown del tenant (contenido no fiable), ficha 0001:
 *
 * - CommonMark + GFM como elementos de React, sin pasar por HTML. El HTML en
 *   crudo se queda en texto (react-markdown convierte los nodos `raw` en texto;
 *   nunca `rehype-raw` ni `dangerouslySetInnerHTML`).
 * - Solo los enlaces http/https son enlaces, y se abren en el navegador del
 *   sistema (`target="_blank"`, que recoge `setWindowOpenHandler` de main).
 *   Cualquier otro esquema o una ruta relativa se queda en texto.
 * - Las imágenes no se cargan nunca: su texto alternativo o, sin él, la URL.
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
  h1: ({ children }) => <h1 className="text-sm font-semibold">{children}</h1>,
  h2: ({ children }) => <h2 className="text-sm font-semibold">{children}</h2>,
  h3: ({ children }) => <h3 className="text-xs font-semibold">{children}</h3>,
  h4: ({ children }) => <h4 className="text-xs font-semibold">{children}</h4>,
  h5: ({ children }) => <h5 className="text-xs font-semibold">{children}</h5>,
  h6: ({ children }) => <h6 className="text-xs font-semibold">{children}</h6>,
  p: ({ children }) => <p className="break-words">{children}</p>,
  ul: ({ children }) => <ul className="list-disc pl-5">{children}</ul>,
  ol: ({ children, start }) => (
    <ol start={start} className="list-decimal pl-5">
      {children}
    </ol>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-border pl-3 text-muted-foreground">
      {children}
    </blockquote>
  ),
  // Bloques de código y tablas con scroll propio: no ensanchan la fila.
  pre: ({ children }) => (
    <pre className="overflow-x-auto rounded-md bg-hover p-2 font-mono [&>code]:bg-transparent [&>code]:p-0">
      {children}
    </pre>
  ),
  code: ({ children }) => (
    <code className="rounded-sm bg-hover px-1 font-mono break-words">{children}</code>
  ),
  table: ({ children }) => (
    <div className="overflow-x-auto">
      <table className="border-collapse">{children}</table>
    </div>
  ),
  th: ({ children, style }) => (
    <th style={style} className="border border-border px-2 py-0.5 text-left font-medium">
      {children}
    </th>
  ),
  td: ({ children, style }) => (
    <td style={style} className="border border-border px-2 py-0.5">
      {children}
    </td>
  ),
  hr: () => <hr className="border-border" />
}

export function MarkdownText({ text }: { text: string }): JSX.Element {
  return (
    <div className="grid gap-1.5 text-xs">
      <Markdown remarkPlugins={[remarkGfm]} urlTransform={urlTransform} components={components}>
        {text}
      </Markdown>
    </div>
  )
}
