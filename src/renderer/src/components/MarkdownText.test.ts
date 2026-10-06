import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MarkdownText } from './MarkdownText'

/**
 * Ficha 0001: el Markdown de `dt.event.description` es contenido del tenant (no
 * fiable). Se pinta con `MarkdownText` (props: `{ text: string }`, sin
 * proveedores) y se comprueba sobre el HTML que genera React:
 *
 * - CA10: el HTML en crudo se ve como texto y no crea elementos.
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
    expect(tags(html, 'h1')).toHaveLength(1)
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

describe('CA10 (0001): el HTML en crudo de la descripción se ve como texto', () => {
  it.each([
    ['img con onerror', '<img src=x onerror="window.__xss=1">', 'img'],
    ['script', '<script>window.__xss=2</script>', 'script'],
    ['iframe', '<iframe src="https://ejemplo.test/"></iframe>', 'iframe'],
    ['b', '<b>negrita</b>', 'b']
  ])('%s, en bloque y en línea', (_label, raw, element) => {
    for (const text of [raw, `Antes ${raw} después`, `# Aviso\n\n${raw}\n\n- punto`]) {
      const html = render(text)
      expect(tags(html, element), text).toHaveLength(0)
      // Ninguna etiqueta real con manejadores on* (el texto escapado no cuenta).
      const handlers = (html.match(/<[a-z][^>]*>/gi) ?? []).filter((tag) => /\son\w+=/i.test(tag))
      expect(handlers, text).toEqual([])
      expect(visibleText(html), text).toContain(raw)
    }
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
