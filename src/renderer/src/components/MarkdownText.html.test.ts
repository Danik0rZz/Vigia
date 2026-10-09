import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import packageJson from '../../../../package.json?raw'
import { MarkdownText } from './MarkdownText'
import {
  all,
  byTag,
  declarations,
  type HtmlNode,
  paintedColor,
  parse,
  sameColor,
  styleOf,
  textOf,
  toRgba
} from '../../../test/html-tree'

/**
 * Ficha 0043: el HTML de formato de las descripciones se interpreta con una lista blanca propia
 * (`rehype-raw` + `rehype-sanitize`). Se comprueba sobre el HTML que genera React con
 * `MarkdownText` (props `{ text: string }`), como en `MarkdownText.test.ts`.
 *
 * Lo que NO puede pasar se prueba a fondo: ningún elemento fuera de la lista (script, style,
 * iframe, object, embed, formularios, img, video, audio, svg, math, link, meta, base…), ningún
 * manejador `on*`, ningún enlace que no sea http/https y ningún `style` con algo que no sea un
 * color válido.
 *
 * Contrato elegido al escribir los tests (la ficha no lo fija; decisión delegada por Dani,
 * refinable, anotada en la «Verificación» de la ficha):
 *
 * - Legibilidad (CA5): en `markdown-color.test.ts`.
 * - `font color` puede salir como `font` con `color` o convertido a un elemento con `style`; lo que
 *   cuenta es el color con el que se pinta el texto.
 * - `background-color` se conserva si el valor es válido (la ficha no dice si se ajusta).
 *
 * Fixtures inventados; los dominios son `.test` (reservado, no existe).
 */

const html = (text: string): string => renderToStaticMarkup(createElement(MarkdownText, { text }))

const render = (text: string): HtmlNode => parse(html(text))

/** Solo las etiquetas reales del HTML generado (el texto escapado no cuenta). */
const realTags = (text: string): string => (html(text).match(/<[a-z][^>]*>/gi) ?? []).join(' ')

// --- Invariantes de seguridad, comunes a todos los casos ---

/** Elementos que no pueden salir nunca del HTML de una descripción. */
const FORBIDDEN_TAGS = [
  'script',
  'style',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'param',
  'form',
  'input',
  'textarea',
  'select',
  'option',
  'button',
  'label',
  'fieldset',
  'output',
  'img',
  'picture',
  'source',
  'video',
  'audio',
  'track',
  'svg',
  'math',
  'link',
  'meta',
  'base',
  'template',
  'noscript',
  'dialog',
  'marquee',
  'area',
  'map',
  'portal'
]

/** Atributos que no pueden salir nunca (además de cualquier `on*`). */
const FORBIDDEN_ATTRS = [
  'src',
  'srcset',
  'srcdoc',
  'action',
  'formaction',
  'http-equiv',
  'content',
  'data',
  'poster',
  'background',
  'xlink:href',
  'ping',
  'download',
  'autofocus',
  'tabindex',
  'contenteditable',
  'id',
  'name'
]

function expectSafe(tree: HtmlNode, label: string): void {
  const elements = all(tree)
  for (const tag of FORBIDDEN_TAGS) {
    expect(byTag(tree, tag), `${label}: ningún <${tag}>`).toEqual([])
  }
  for (const node of elements) {
    for (const attr of Object.keys(node.attrs)) {
      expect(attr.startsWith('on'), `${label}: atributo ${attr} en <${node.tag}>`).toBe(false)
      expect(FORBIDDEN_ATTRS, `${label}: atributo ${attr} en <${node.tag}>`).not.toContain(attr)
    }
    // Ningún href que no sea http/https.
    if ('href' in node.attrs) {
      expect(node.attrs['href'], `${label}: href en <${node.tag}>`).toMatch(/^https?:\/\//i)
    }
    // Un style solo con color o background-color.
    for (const [property] of declarations(node.attrs['style'])) {
      expect(['color', 'background-color'], `${label}: style ${property}`).toContain(property)
    }
  }
}

// ---------------------------------------------------------------------------------------------

describe('CA1 (0043): el HTML de formato se interpreta', () => {
  it('<span style="color:#d00"> sale como span con ese color', () => {
    const tree = render('Estado: <span style="color:#d00">x</span> ahora.')
    const spans = byTag(tree, 'span').filter((n) => textOf(n) === 'x')
    expect(spans).toHaveLength(1)
    const span = spans[0] as HtmlNode
    expect(sameColor(styleOf(span, 'color'), '#dd0000'), `color: ${span.attrs['style']}`).toBe(true)
    expect(textOf(tree)).toContain('Estado: x ahora.')
    expect(textOf(tree)).not.toContain('<span')
  })

  it('<mark>, <kbd> y <details>/<summary> se interpretan', () => {
    const tree = render(
      [
        'Pulsa <kbd>Ctrl</kbd> y mira lo <mark>resaltado</mark>.',
        '',
        '<details><summary>Más datos</summary>Contenido oculto</details>'
      ].join('\n')
    )
    expect(byTag(tree, 'kbd').map(textOf)).toEqual(['Ctrl'])
    expect(byTag(tree, 'mark').map(textOf)).toEqual(['resaltado'])
    const details = byTag(tree, 'details')
    expect(details).toHaveLength(1)
    expect(byTag(details[0] as HtmlNode, 'summary').map(textOf)).toEqual(['Más datos'])
    expect(textOf(details[0] as HtmlNode)).toContain('Contenido oculto')
    expect(textOf(tree)).not.toMatch(/<\/?(kbd|mark|details|summary)/)
  })

  it('<font color="red"> pinta su texto en rojo', () => {
    const tree = render('Fallo <font color="red">crítico</font> en pagos.')
    expect(textOf(tree)).toContain('Fallo crítico en pagos.')
    expect(textOf(tree)).not.toContain('<font')
    const color = paintedColor(tree, 'crítico')
    expect(sameColor(color, '#ff0000'), `color pintado: ${String(color)}`).toBe(true)
  })

  it.each([
    ['b', 'Un <b>texto</b> aquí'],
    ['strong', 'Un <strong>texto</strong> aquí'],
    ['i', 'Un <i>texto</i> aquí'],
    ['em', 'Un <em>texto</em> aquí'],
    ['u', 'Un <u>texto</u> aquí'],
    ['s', 'Un <s>texto</s> aquí'],
    ['del', 'Un <del>texto</del> aquí'],
    ['sub', 'Un <sub>texto</sub> aquí'],
    ['sup', 'Un <sup>texto</sup> aquí'],
    ['small', 'Un <small>texto</small> aquí'],
    ['kbd', 'Un <kbd>texto</kbd> aquí'],
    ['code', 'Un <code>texto</code> aquí'],
    ['mark', 'Un <mark>texto</mark> aquí'],
    ['span', 'Un <span>texto</span> aquí'],
    ['p', '<p>texto</p>'],
    ['div', '<div>texto</div>'],
    ['pre', '<pre>texto</pre>'],
    ['ul', '<ul><li>texto</li></ul>'],
    ['ol', '<ol><li>texto</li></ol>'],
    ['li', '<ul><li>texto</li></ul>']
  ])('<%s> se interpreta', (tag, text) => {
    const tree = render(text)
    const found = byTag(tree, tag)
    expect(found.length, `<${tag}>`).toBeGreaterThan(0)
    expect(found.map(textOf).join(' ')).toContain('texto')
    expect(textOf(tree)).not.toContain(`<${tag}>`)
  })

  it('<br> y <hr> se interpretan', () => {
    const tree = render('<div>uno<br>dos</div>\n\n<hr>\n\nfin')
    expect(byTag(tree, 'br')).toHaveLength(1)
    expect(byTag(tree, 'hr')).toHaveLength(1)
    expect(textOf(tree)).not.toMatch(/<(br|hr)/)
  })

  it('una tabla en HTML con sus partes se interpreta', () => {
    const tree = render(
      [
        '<table>',
        '<caption>Servicios</caption>',
        '<thead><tr><th>Nombre</th><th>Estado</th></tr></thead>',
        '<tbody><tr><td>pagos</td><td>ok</td></tr></tbody>',
        '<tfoot><tr><td>total</td><td>1</td></tr></tfoot>',
        '</table>'
      ].join('\n')
    )
    for (const [tag, count] of [
      ['table', 1],
      ['caption', 1],
      ['thead', 1],
      ['tbody', 1],
      ['tfoot', 1],
      ['tr', 3],
      ['th', 2],
      ['td', 4]
    ] as const) {
      expect(byTag(tree, tag), `<${tag}>`).toHaveLength(count)
    }
    expect(textOf(tree)).not.toContain('<table')
  })

  it('title se conserva', () => {
    const tree = render('Ver <span title="Detalle del umbral">umbral</span>.')
    const span = byTag(tree, 'span').find((n) => textOf(n) === 'umbral')
    expect(span?.attrs['title']).toBe('Detalle del umbral')
  })

  it('class, id, srcset y data-* del contenido se quitan', () => {
    const tree = render(
      'A <span class="peligro" id="raiz" srcset="https://ejemplo.test/a.png 1x" data-testid="falso" data-line-number="1">x</span> B'
    )
    const span = byTag(tree, 'span').find((n) => textOf(n) === 'x')
    expect(span, 'el span sigue (con su texto)').toBeDefined()
    for (const attr of ['class', 'id', 'srcset', 'data-testid', 'data-line-number']) {
      expect(Object.keys(span?.attrs ?? {}), attr).not.toContain(attr)
    }
    expect(all(tree).filter((n) => 'data-testid' in n.attrs)).toEqual([])
    expect(all(tree).filter((n) => n.attrs['id'] === 'raiz')).toEqual([])
  })

  it('una clase del propio visor escrita en el HTML no crea un aviso falso', () => {
    const tree = render('<div class="md-alert md-alert-caution">Falso aviso</div>')
    const classes = all(tree).flatMap((n) => (n.attrs['class'] ?? '').split(/\s+/))
    expect(classes).not.toContain('md-alert')
    expect(classes).not.toContain('md-alert-caution')
    expect(textOf(tree)).toContain('Falso aviso')
  })

  it('una etiqueta fuera de la lista se quita pero su texto se sigue viendo', () => {
    const tree = render('Antes <custom-tag>dentro</custom-tag> <blink>parpadeo</blink> después')
    expect(byTag(tree, 'custom-tag')).toEqual([])
    expect(byTag(tree, 'blink')).toEqual([])
    expect(textOf(tree)).toContain('dentro')
    expect(textOf(tree)).toContain('parpadeo')
  })
})

describe('CA2 (0043): style solo con color y background-color, y con valores válidos', () => {
  it('color:red; position:fixed; background:url(…) deja solo color', () => {
    const tree = render(
      'Hay <span style="color:red; position:fixed; background:url(https://ejemplo.test/x.png)">x</span>.'
    )
    const span = byTag(tree, 'span').find((n) => textOf(n) === 'x')
    expect(span).toBeDefined()
    const declared = declarations(span?.attrs['style'])
    expect(declared.map(([name]) => name)).toEqual(['color'])
    expect(sameColor(styleOf(span as HtmlNode, 'color'), '#ff0000')).toBe(true)
    expect(
      realTags('Hay <span style="background:url(https://ejemplo.test/x.png)">x</span>.')
    ).not.toMatch(/url\(/i)
  })

  it.each([
    'position:fixed; top:0; left:0; width:100%; height:100%; z-index:9999',
    'display:none',
    'font-size:200px',
    'opacity:0',
    'background-image:url(https://ejemplo.test/x.png)',
    'content:"x"',
    'behavior:url(x.htc)',
    '-webkit-user-modify:read-write',
    'transform:scale(100)'
  ])('style="%s" no deja ninguna declaración', (style) => {
    const tree = render(`Texto <span style="${style}">x</span> fin`)
    for (const node of all(tree)) {
      expect(declarations(node.attrs['style']), `<${node.tag}>`).toEqual([])
    }
    expect(textOf(tree)).toContain('x')
  })

  it.each([
    ['expression(…)', 'expression(alert(1))'],
    ['url(…)', 'url(https://ejemplo.test/x.png)'],
    ['javascript:', 'javascript:alert(1)'],
    ['var(…)', 'var(--danger)'],
    ['rgb() con var()', 'rgb(var(--x), 0, 0)'],
    ['rgb() con calc()', 'rgb(calc(255), 0, 0)'],
    ['nombre que no es un color', 'noexiste'],
    ['hexadecimal corto de 2', '#12'],
    ['hexadecimal no válido', '#gggggg'],
    ['comentario delante', '/**/red'],
    ['valor con escape', '\\72 ed'],
    ['dos valores', 'red blue']
  ])('color: %s no válido quita la declaración', (_label, value) => {
    const tree = render(`Texto <span style="color:${value}">x</span> fin`)
    for (const node of all(tree)) {
      expect(styleOf(node, 'color'), `<${node.tag}> style="${node.attrs['style'] ?? ''}"`).toBe(
        undefined
      )
    }
    expect(realTags(`Texto <span style="color:${value}">x</span> fin`)).not.toMatch(
      /expression|url\(|javascript|var\(|calc\(/i
    )
  })

  it('un valor no válido de background-color también se quita', () => {
    const tree = render(
      'Texto <span style="background-color:url(https://ejemplo.test/x.png)">x</span> fin'
    )
    for (const node of all(tree)) expect(styleOf(node, 'background-color')).toBe(undefined)
  })

  it('una declaración no válida se quita y la válida se queda', () => {
    const tree = render('A <span style="color:expression(alert(1)); color:#d00">x</span> B')
    const span = byTag(tree, 'span').find((n) => textOf(n) === 'x')
    const declared = declarations(span?.attrs['style'])
    expect(declared).toHaveLength(1)
    expect(sameColor(declared[0]?.[1], '#dd0000')).toBe(true)
  })

  it.each([
    ['#rgb', '#d00', '#dd0000'],
    ['#rrggbb', '#dd0000', '#dd0000'],
    ['rgb() con números', 'rgb(221, 0, 0)', '#dd0000'],
    ['nombre CSS', 'red', '#ff0000']
  ])('color con %s es válido', (_label, value, expected) => {
    const tree = render(`A <span style="color:${value}">x</span> B`)
    const span = byTag(tree, 'span').find((n) => textOf(n) === 'x')
    expect(sameColor(styleOf(span as HtmlNode, 'color'), expected), span?.attrs['style']).toBe(true)
  })

  it('rgba() con números es un valor válido (se pinta un color)', () => {
    const tree = render('A <span style="color:rgba(221, 0, 0, 1)">x</span> B')
    const span = byTag(tree, 'span').find((n) => textOf(n) === 'x')
    expect(toRgba(styleOf(span as HtmlNode, 'color') ?? '')).not.toBeNull()
  })

  it('background-color con un color válido se conserva', () => {
    const tree = render('A <span style="background-color:#fff3cd">x</span> B')
    const span = byTag(tree, 'span').find((n) => textOf(n) === 'x')
    expect(toRgba(styleOf(span as HtmlNode, 'background-color') ?? '')).not.toBeNull()
  })

  it.each([
    ['javascript:', 'javascript:alert(1)'],
    ['expression(…)', 'expression(alert(1))'],
    ['url(…)', 'url(https://ejemplo.test/x.png)'],
    ['nombre que no es un color', 'noexiste']
  ])('font color con %s no válido se quita', (_label, value) => {
    const tree = render(`A <font color="${value}">x</font> B`)
    for (const node of all(tree)) {
      expect(node.attrs['color'], `<${node.tag}>`).toBe(undefined)
      expect(styleOf(node, 'color'), `<${node.tag}>`).toBe(undefined)
    }
    expect(textOf(tree)).toContain('x')
  })

  it('font solo conserva color (sin face, size ni style de otra cosa)', () => {
    const tree = render('A <font color="red" face="Comic Sans" size="7">x</font> B')
    for (const node of all(tree)) {
      expect(Object.keys(node.attrs)).not.toContain('face')
      expect(Object.keys(node.attrs)).not.toContain('size')
    }
  })
})

describe('CA3 (0043): lo que nunca crea elementos ni atributos en el DOM', () => {
  it.each([
    ['script', '<script>window.__xss=1</script>'],
    ['script en línea', 'Antes <script>window.__xss=1</script> después'],
    ['script con src', '<script src="https://ejemplo.test/x.js"></script>'],
    ['style', '<style>body{display:none}</style>'],
    ['iframe', '<iframe src="https://ejemplo.test/"></iframe>'],
    ['iframe con srcdoc', '<iframe srcdoc="<script>window.__xss=1</script>"></iframe>'],
    ['img con onerror', '<img src=x onerror="window.__xss=1">'],
    ['img en línea', 'Antes <img src="https://ejemplo.test/a.png" alt="a"> después'],
    ['img con srcset', '<img srcset="https://ejemplo.test/a.png 1x">'],
    ['picture', '<picture><source srcset="https://ejemplo.test/a.png"></picture>'],
    ['svg', '<svg onload="window.__xss=1"><circle r="5"/></svg>'],
    ['svg con script', '<svg><script>window.__xss=1</script></svg>'],
    ['svg con enlace', '<svg><a xlink:href="javascript:alert(1)"><text>x</text></a></svg>'],
    ['math', '<math><mi>x</mi></math>'],
    ['math con mglyph (mXSS)', '<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>'],
    ['noscript (mXSS)', '<noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript>'],
    ['form', '<form action="https://ejemplo.test/"><input name="q"><button>Enviar</button></form>'],
    ['input', '<input autofocus onfocus="window.__xss=1">'],
    ['textarea', '<textarea>texto</textarea>'],
    ['select', '<select><option>uno</option></select>'],
    ['button con formaction', '<button formaction="javascript:alert(1)">Pulsa</button>'],
    ['label y fieldset', '<fieldset><label>Nombre</label></fieldset>'],
    ['object', '<object data="https://ejemplo.test/x.swf"></object>'],
    ['embed', '<embed src="https://ejemplo.test/x.swf">'],
    [
      'video',
      '<video src="https://ejemplo.test/v.mp4" poster="https://ejemplo.test/p.png"></video>'
    ],
    ['video con source', '<video><source src="x" onerror="window.__xss=1"></video>'],
    ['audio', '<audio src="https://ejemplo.test/a.mp3" onerror="window.__xss=1"></audio>'],
    ['link', '<link rel="stylesheet" href="https://ejemplo.test/x.css">'],
    ['meta refresh', '<meta http-equiv="refresh" content="0;url=https://ejemplo.test/">'],
    ['base', '<base href="https://ejemplo.test/">'],
    ['template', '<template><img src=x onerror=alert(1)></template>'],
    ['dialog', '<dialog open>Diálogo</dialog>'],
    ['marquee', '<marquee onstart="window.__xss=1">x</marquee>'],
    ['map y area', '<map name="m"><area href="javascript:alert(1)"></map>'],
    ['frameset', '<frameset><frame src="https://ejemplo.test/"></frameset>']
  ])('%s', (label, raw) => {
    for (const text of [raw, `# Aviso\n\n${raw}\n\n- punto`, `- ${raw}`, `> ${raw}`]) {
      const tree = render(text)
      expectSafe(tree, `${label} en ${JSON.stringify(text)}`)
    }
  })

  it.each([
    ['onclick en span', '<span onclick="window.__xss=1">x</span>'],
    ['onmouseover en b', '<b onmouseover="window.__xss=1">x</b>'],
    [
      'ontoggle en details',
      '<details open ontoggle="window.__xss=1"><summary>x</summary>y</details>'
    ],
    ['onpointerenter en div', '<div onpointerenter="window.__xss=1">x</div>'],
    ['onfocus con tabindex', '<span tabindex="0" onfocus="window.__xss=1">x</span>'],
    ['onclick en mayúsculas', '<span OnClick="window.__xss=1">x</span>'],
    ['onanimationstart', '<mark onanimationstart="window.__xss=1">x</mark>'],
    ['onclick en a', '<a href="https://ejemplo.test/" onclick="window.__xss=1">x</a>'],
    ['onerror en font', '<font color="red" onerror="window.__xss=1">x</font>'],
    ['style y on*', '<span style="color:red" onmouseenter="window.__xss=1">x</span>']
  ])('atributo %s: el elemento queda sin el manejador', (label, raw) => {
    const tree = render(`Texto ${raw} fin`)
    expectSafe(tree, label)
    expect(textOf(tree)).toContain('x')
    expect(realTags(`Texto ${raw} fin`)).not.toMatch(/\son[a-z]+=/i)
  })

  it('una descripción con todo junto no deja nada peligroso y sí el formato', () => {
    const tree = render(
      [
        '# Incidencia',
        '',
        '<span style="color:#d00" onclick="x()">Crítico</span> <script>x()</script>',
        '',
        '<img src=x onerror=x()> <iframe src="https://ejemplo.test/"></iframe>',
        '',
        '- <b>uno</b> <svg onload=x()></svg>',
        '- <a href="javascript:x()">dos</a>'
      ].join('\n')
    )
    expectSafe(tree, 'todo junto')
    expect(byTag(tree, 'b').map(textOf)).toEqual(['uno'])
    expect(byTag(tree, 'h1')).toHaveLength(1)
    expect(textOf(tree)).toContain('Crítico')
    expect(textOf(tree)).toContain('dos')
  })

  it('ningún componente de la interfaz usa dangerouslySetInnerHTML', () => {
    const sources = import.meta.glob<string>(
      ['../**/*.tsx', '../**/*.ts', '!../**/*.test.ts', '!../**/*.test.tsx'],
      {
        query: '?raw',
        import: 'default',
        eager: true
      }
    )
    expect(Object.keys(sources).length).toBeGreaterThan(10)
    const offenders = Object.entries(sources)
      .filter(([, source]) => source.includes('dangerouslySetInnerHTML='))
      .map(([path]) => path)
    expect(offenders).toEqual([])
  })
})

describe('CA4 (0043): enlaces escritos en HTML', () => {
  it('un enlace https: es clicable, con target="_blank" y rel="noopener noreferrer"', () => {
    const tree = render('Ver <a href="https://ejemplo.test/guia?a=1&amp;b=2">la guía</a> ahora.')
    const anchors = byTag(tree, 'a')
    expect(anchors).toHaveLength(1)
    const anchor = anchors[0] as HtmlNode
    expect(anchor.attrs['href']).toBe('https://ejemplo.test/guia?a=1&b=2')
    expect(anchor.attrs['target']).toBe('_blank')
    expect((anchor.attrs['rel'] ?? '').split(/\s+/)).toEqual(
      expect.arrayContaining(['noopener', 'noreferrer'])
    )
    expect(textOf(anchor)).toBe('la guía')
  })

  it('un enlace http: también es clicable', () => {
    const anchors = byTag(render('<a href="http://ejemplo.test/">aquí</a>'), 'a')
    expect(anchors).toHaveLength(1)
    expect(anchors[0]?.attrs['href']).toBe('http://ejemplo.test/')
    expect(anchors[0]?.attrs['target']).toBe('_blank')
  })

  it('el HTML no puede cambiar target ni rel, ni añadir ping o download', () => {
    const tree = render(
      '<a href="https://ejemplo.test/" target="_self" rel="opener" ping="https://ejemplo.test/p" download>x</a>'
    )
    const anchor = byTag(tree, 'a')[0]
    expect(anchor).toBeDefined()
    expect(anchor?.attrs['target']).toBe('_blank')
    const rel = (anchor?.attrs['rel'] ?? '').split(/\s+/)
    expect(rel).toEqual(expect.arrayContaining(['noopener', 'noreferrer']))
    expect(rel).not.toContain('opener')
    expect(Object.keys(anchor?.attrs ?? {})).not.toContain('ping')
    expect(Object.keys(anchor?.attrs ?? {})).not.toContain('download')
  })

  it.each([
    ['javascript:', 'javascript:alert(1)'],
    ['JavaScript: con mayúsculas', 'JaVaScRiPt:alert(1)'],
    ['javascript: con espacios delante', '  javascript:alert(1)'],
    ['javascript: con entidades', 'java&#x73;cript:alert(1)'],
    ['javascript: con tabulador', 'jav&#x09;ascript:alert(1)'],
    ['javascript: con salto de línea', 'jav&#x0A;ascript:alert(1)'],
    ['data:', 'data:text/html,<script>alert(1)</script>'],
    ['vbscript:', 'vbscript:msgbox(1)'],
    ['file:', 'file:///C:/Windows/System32/calc.exe'],
    ['relativo', '/ruta/relativa'],
    ['sin protocolo', '//ejemplo.test/x'],
    ['ancla', '#seccion'],
    ['app:', 'app://vigia/index.html'],
    ['mailto:', 'mailto:alguien@ejemplo.test']
  ])('un enlace %s no es clicable y su texto se ve', (_label, href) => {
    const tree = render(`Ver <a href="${href}">pulsa aquí</a> ahora.`)
    expectSafe(tree, href)
    for (const anchor of byTag(tree, 'a')) {
      expect(Object.keys(anchor.attrs), `a con href ${href}`).not.toContain('href')
    }
    expect(textOf(tree)).toContain('pulsa aquí')
  })
})

describe('CA7 (0043): rehype-raw y rehype-sanitize con versión exacta', () => {
  it.each(['rehype-raw', 'rehype-sanitize'])('%s', (name) => {
    const pkg = JSON.parse(packageJson) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    const version = pkg.dependencies?.[name] ?? pkg.devDependencies?.[name]
    expect(version, `${name} en package.json`).toBeDefined()
    expect(version).toMatch(/^\d+\.\d+\.\d+$/)
  })
})
