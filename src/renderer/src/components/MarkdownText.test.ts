import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MarkdownText } from './MarkdownText'

/**
 * Ficha 0001: el Markdown de `dt.event.description` es contenido del tenant (no
 * fiable). Se pinta con `MarkdownText` (props: `{ text: string }`, sin
 * proveedores) y se comprueba sobre el HTML que genera React:
 *
 * - CA10: el HTML peligroso no crea elementos (desde la 0043, el HTML de formato se interpreta).
 * - CA11: solo los enlaces http/https son enlaces, y abren fuera (_blank, noopener noreferrer).
 * - CA12: las imágenes no se cargan nunca: su texto alternativo o, si no tiene, la URL.
 *
 * Fixtures inventados; los dominios son `.test` (reservado, no existe).
 */

const render = (text: string): string => renderToStaticMarkup(createElement(MarkdownText, { text }))

/** Etiquetas de apertura de ese elemento en el HTML. */
const tags = (html: string, name: string): string[] =>
  html.match(new RegExp(`<${name}(?=[\\s>/])[^>]*>`, 'gi')) ?? []

/** El texto visible (sin etiquetas y con las entidades básicas decodificadas). */
const visibleText = (html: string): string =>
  html
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, '&')

describe('CA6 (0001), apoyo unitario: CommonMark + GFM como elementos', () => {
  it('pinta títulos, listas, negrita, código y tablas como elementos', () => {
    const html = render(
      [
        '# Título',
        '',
        '- uno',
        '- **dos**',
        '',
        'Con `código` en línea.',
        '',
        '| A | B |',
        '| --- | --- |',
        '| 1 | 2 |'
      ].join('\n')
    )
    // Desde la 0064 (C-14), el título sale como p con role=heading, no como h1.
    expect(tags(html, 'p').filter((tag) => tag.includes('role="heading"'))).toHaveLength(1)
    expect(tags(html, 'li')).toHaveLength(2)
    expect(tags(html, 'strong')).toHaveLength(1)
    expect(tags(html, 'code')).toHaveLength(1)
    expect(tags(html, 'table')).toHaveLength(1)
    expect(visibleText(html)).not.toContain('**')
  })

  it('tabla compacta (sin espacios junto a las barras) con fila de alineación, y escapes', () => {
    // Forma vista en un problema real (con otro texto).
    const html = render(
      [
        'Umbral superado en 9\\.5 puntos',
        '',
        '|Host|Valor|Estado|',
        '|:--|--:|:-:|',
        '|web|9|alto \\(9\\)|',
        '|db|7|bajo \\(7\\)|'
      ].join('\n')
    )
    expect(tags(html, 'table')).toHaveLength(1)
    expect(tags(html, 'th')).toHaveLength(3)
    expect(tags(html, 'td')).toHaveLength(6)
    const text = visibleText(html)
    expect(text).toContain('Umbral superado en 9.5 puntos')
    expect(text).toContain('alto (9)')
    expect(text).toContain('bajo (7)')
    expect(text).not.toContain('\\')
    expect(text).not.toContain(':--')
  })
})

// CA6 (0043): desde la 0043 el HTML de formato se interpreta con lista blanca. Lo peligroso sigue
// sin crear elementos ni manejadores; lo de formato (como `b`) ya es un elemento.
describe('CA10 (0001), actualizado por CA6 (0043): el HTML peligroso no crea elementos', () => {
  it.each([
    ['img con onerror', '<img src=x onerror="window.__xss=1">', 'img'],
    ['script', '<script>window.__xss=2</script>', 'script'],
    ['iframe', '<iframe src="https://ejemplo.test/"></iframe>', 'iframe']
  ])('%s, en bloque y en línea', (_label, raw, element) => {
    for (const text of [raw, `Antes ${raw} después`, `# Aviso\n\n${raw}\n\n- punto`]) {
      const html = render(text)
      expect(tags(html, element), text).toHaveLength(0)
      // Ninguna etiqueta real con manejadores on* (el texto escapado no cuenta).
      const handlers = (html.match(/<[a-z][^>]*>/gi) ?? []).filter((tag) => /\son\w+=/i.test(tag))
      expect(handlers, text).toEqual([])
      // Ninguna etiqueta real con src (el texto escapado no cuenta).
      const sources = (html.match(/<[a-z][^>]*>/gi) ?? []).filter((tag) => /\ssrc=/i.test(tag))
      expect(sources, text).toEqual([])
    }
  })

  it('b es HTML de formato: se interpreta, en bloque y en línea', () => {
    const raw = '<b>negrita</b>'
    for (const text of [raw, `Antes ${raw} después`, `# Aviso\n\n${raw}\n\n- punto`]) {
      const html = render(text)
      expect(tags(html, 'b'), text).toHaveLength(1)
      expect(visibleText(html), text).toContain('negrita')
      expect(visibleText(html), text).not.toContain('<b>')
    }
  })

  it('el texto con < y > que no es HTML se sigue viendo', () => {
    const html = render('Si 3 < 5 y 7 > 2, entonces a<b no es una etiqueta.')
    expect(visibleText(html)).toContain('Si 3 < 5 y 7 > 2')
    expect(visibleText(html)).toContain('a<b no es una etiqueta')
  })

  it('el HTML dentro de código en línea sigue siendo texto', () => {
    const html = render('Usa `<b>negrita</b>` para resaltar.')
    expect(tags(html, 'b')).toHaveLength(0)
    expect(visibleText(html)).toContain('<b>negrita</b>')
  })
})

describe('CA11 (0001): enlaces', () => {
  it.each([
    ['https', 'https://ejemplo.test/guia?a=1&b=2'],
    ['http', 'http://ejemplo.test/guia']
  ])('%s: enlace con target="_blank" y rel="noopener noreferrer"', (_label, url) => {
    const html = render(`Ver [la guía](${url}) ahora.`)
    const anchors = tags(html, 'a')
    expect(anchors).toHaveLength(1)
    const anchor = anchors[0] ?? ''
    expect(anchor).toContain(`href="${url.replace(/&/g, '&amp;')}"`)
    expect(anchor).toContain('target="_blank"')
    const rel = /rel="([^"]*)"/.exec(anchor)?.[1]?.split(/\s+/) ?? []
    expect(rel).toEqual(expect.arrayContaining(['noopener', 'noreferrer']))
    expect(visibleText(html)).toContain('la guía')
  })

  it.each([
    ['javascript:', 'javascript:alert(1)'],
    ['JavaScript: con mayúsculas', 'JavaScript:alert(1)'],
    ['file:', 'file:///C:/Windows/System32/calc.exe'],
    ['data:', 'data:text/html,hola'],
    ['vbscript:', 'vbscript:msgbox(1)'],
    ['relativo', '/ruta/relativa']
  ])('%s: se pinta como texto, sin a', (_label, url) => {
    const html = render(`Ver [pincha aquí](${url}) ahora.`)
    expect(tags(html, 'a')).toHaveLength(0)
    expect(html).not.toMatch(/href=/i)
    expect(visibleText(html)).toContain('pincha aquí')
  })

  it('un enlace de referencia javascript: tampoco es un enlace', () => {
    const html = render('Ver [pincha][ref].\n\n[ref]: javascript:alert(1)')
    expect(tags(html, 'a')).toHaveLength(0)
    expect(visibleText(html)).toContain('pincha')
  })
})

describe('CA12 (0001): imágenes', () => {
  it('con texto alternativo: ningún img, se ve el texto alternativo', () => {
    const html = render('Antes ![diagrama de red](https://ejemplo.test/red.png) después')
    expect(tags(html, 'img')).toHaveLength(0)
    expect(html).not.toMatch(/\ssrc=/i)
    expect(visibleText(html)).toContain('diagrama de red')
  })

  it('sin texto alternativo: ningún img, se ve la URL como texto', () => {
    const html = render('Antes ![](https://ejemplo.test/sin-alt.png) después')
    expect(tags(html, 'img')).toHaveLength(0)
    expect(html).not.toMatch(/\ssrc=/i)
    expect(visibleText(html)).toContain('https://ejemplo.test/sin-alt.png')
  })

  it('una imagen de referencia o dentro de un enlace tampoco crea img', () => {
    const reference = render('![logo][l]\n\n[l]: https://ejemplo.test/logo.png')
    expect(tags(reference, 'img')).toHaveLength(0)
    expect(visibleText(reference)).toContain('logo')
    const linked = render('[![captura](https://ejemplo.test/c.png)](https://ejemplo.test/)')
    expect(tags(linked, 'img')).toHaveLength(0)
    expect(visibleText(linked)).toContain('captura')
  })
})

/**
 * Ficha 0064 (C-14): los títulos del Markdown del tenant no entran en la jerarquía de la página
 * (lectores de pantalla): salen como `p` con `role="heading"` y `aria-level` de 5 o 6
 * (`Math.min(6, 4 + nivel)`), nunca como `h1`…`h6`.
 */
describe('CA6 (0064): los títulos del Markdown salen con nivel 5 o 6 y sin h1…h6', () => {
  const headings = (html: string): string[] =>
    tags(html, 'p').filter((tag) => /\srole="heading"/.test(tag))
  const level = (tag: string | undefined): string | undefined =>
    /\saria-level="(\d+)"/.exec(tag ?? '')?.[1]

  it('«# a» sale con nivel 5 y «###### b» con nivel 6', () => {
    const html = render(['# a', '', '###### b'].join('\n'))
    const found = headings(html)
    expect(found).toHaveLength(2)
    expect(level(found[0])).toBe('5')
    expect(level(found[1])).toBe('6')
    // El texto no se pierde (react-markdown deja un salto de línea entre bloques).
    expect(visibleText(html).split(/\s+/).filter(Boolean)).toEqual(['a', 'b'])
  })

  it('los niveles intermedios se quedan en 6 (min(6, 4 + nivel))', () => {
    const html = render(['## dos', '', '### tres', '', '#### cuatro', '', '##### cinco'].join('\n'))
    expect(headings(html).map(level)).toEqual(['6', '6', '6', '6'])
  })

  it('ningún h1…h6 en el HTML, ni con títulos de todos los niveles', () => {
    const html = render(['# 1', '## 2', '### 3', '#### 4', '##### 5', '###### 6'].join('\n\n'))
    for (const name of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']) {
      expect(tags(html, name), name).toEqual([])
    }
    expect(headings(html)).toHaveLength(6)
  })
})
