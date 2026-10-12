import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parse } from 'parse5'
import postcss from 'postcss'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Tarjeta HTML del aviso de Telegram (ficha 0104).
 *
 * Todo sobre el HTML que devuelve `buildCardHtml(datos)`: sin navegador ni red. El HTML se lee
 * con `parse5` y el CSS de las etiquetas `<style>` con `postcss` (los dos ya están en
 * `node_modules`, como dependencias de otras; solo se usan aquí, en los tests).
 *
 * Contrato que fijan estos tests (la ficha lo dejaba como ejemplo):
 * - El módulo es `scripts/telegram-card.mjs` y exporta `buildCardHtml(datos)`, que devuelve un
 *   string con el documento completo.
 * - Cada bloque de primer nivel lleva `data-bloque` con estos valores: `cabecera`, `cajitas`,
 *   `resumen` (uno por cada bloque del Markdown), `decision` y `pie`. Ningún bloque marcado va
 *   dentro de otro.
 * - La fecha y hora de la cabecera es la del momento de la llamada (`Date`), que aquí se fija.
 */

const SCRIPT = join(__dirname, 'telegram-card.mjs')

type Datos = {
  tipo: 'tarea' | 'version'
  origen?: 'orquestador' | 'planificador'
  ficha?: string
  version?: string
  titulo: string
  estado: string
  rondas?: number
  verifier?: string
  ci?: string
  resumen?: string
  decision?: string
  duracion?: string
  rama?: string
  pr?: string
}
type Api = { buildCardHtml: (datos: Datos) => string }

// Si el módulo aún no existe, cada test falla con este mensaje (no por un error del test).
const loaded = existsSync(SCRIPT) ? ((await import(pathToFileURL(SCRIPT).href)) as Api) : undefined
function build(datos: Datos): string {
  if (!loaded) throw new Error('No existe scripts/telegram-card.mjs')
  return loaded.buildCardHtml(datos)
}

// --- Datos de prueba (inventados; nada del tenant) ---

const RESUMEN_MD = [
  '## Qué se hizo',
  '',
  '### Detalle',
  '',
  'Texto con **negrita** y la CLAVE `VIGIA_TELEGRAM_TOKEN`.',
  '',
  '- uno',
  '- dos',
  '',
  '1. primero',
  '2. segundo',
  '',
  '| campo | valor |',
  '| ----- | ----- |',
  '| a     | 1     |',
  '',
  '```ts',
  'const total: number = 1',
  '```'
].join('\n')
// Bloques de primer nivel de RESUMEN_MD, en orden.
const RESUMEN_BLOQUES = ['h2', 'h3', 'p', 'ul', 'ol', 'table', 'pre']

const CI_URL = 'https://github.com/ejemplo/vigia/actions/runs/1234567890'
const PR_URL = 'https://github.com/ejemplo/vigia/pull/321'
const RAMA = 'feat/0104-telegram-tarjeta-html'
const DECISION = '¿Se fusiona la PR? 1) sí 2) no'

function completo(overrides: Partial<Datos> = {}): Datos {
  return {
    tipo: 'tarea',
    ficha: '0104',
    titulo: 'Tarjeta HTML del aviso',
    estado: 'parada',
    rondas: 2,
    verifier: 'VERDE',
    ci: CI_URL,
    resumen: RESUMEN_MD,
    decision: DECISION,
    duracion: '42 min',
    rama: RAMA,
    pr: PR_URL,
    ...overrides
  }
}

function minimo(overrides: Partial<Datos> = {}): Datos {
  return {
    tipo: 'tarea',
    ficha: '0104',
    titulo: 'Tarjeta HTML del aviso',
    estado: 'hecha',
    rondas: 1,
    verifier: 'VERDE',
    resumen: 'Un resumen corto.',
    ...overrides
  }
}

// 12/10/2026 10:00 en Madrid (08:00 UTC, horario de verano).
const AHORA = new Date('2026-10-12T08:00:00Z')

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(AHORA)
})
afterEach(() => {
  vi.useRealTimers()
})

// --- Lectura del HTML ---

type Attr = { name: string; value: string }
type Node = {
  nodeName: string
  tagName?: string
  attrs?: Attr[]
  value?: string
  childNodes?: Node[]
  content?: Node
  parentNode?: Node | null
}

function parseHtml(html: string): Node {
  return parse(html) as unknown as Node
}

function isElement(node: Node): boolean {
  return typeof node.tagName === 'string'
}

function elements(root: Node): Node[] {
  const out: Node[] = []
  const visit = (node: Node): void => {
    for (const child of node.childNodes ?? []) {
      if (isElement(child)) out.push(child)
      visit(child)
    }
  }
  visit(root)
  return out
}

function attr(el: Node, name: string): string | undefined {
  return el.attrs?.find((a) => a.name === name)?.value
}

function classes(el: Node): string[] {
  return (attr(el, 'class') ?? '').split(/\s+/).filter(Boolean)
}

function textOf(node: Node): string {
  if (node.nodeName === '#text') return node.value ?? ''
  if (node.tagName === 'style' || node.tagName === 'script') return ''
  return (node.childNodes ?? []).map(textOf).join('')
}

function squash(value: string): string {
  return value.replace(/\s+/g, '')
}

function ancestors(el: Node): Node[] {
  const out: Node[] = []
  let current = el.parentNode
  while (current && isElement(current)) {
    out.push(current)
    current = current.parentNode
  }
  return out
}

function isInside(el: Node, container: Node): boolean {
  return el === container || ancestors(el).includes(container)
}

function blocks(root: Node, name: string): Node[] {
  return elements(root).filter((el) => attr(el, 'data-bloque') === name)
}

function block(root: Node, name: string): Node {
  const found = blocks(root, name)
  expect(found, `bloque data-bloque="${name}"`).toHaveLength(1)
  return found[0] as Node
}

// El elemento más interno cuyo texto (sin espacios) es exactamente `expected`.
function findByText(root: Node, expected: string): Node | undefined {
  const target = squash(expected)
  // Solo en el cuerpo: el <title> de la página puede repetir el título.
  const matches = elements(root).filter(
    (el) =>
      squash(textOf(el)) === target &&
      el.tagName !== 'title' &&
      !ancestors(el).some((a) => a.tagName === 'head')
  )
  return matches.find((el) => !matches.some((other) => other !== el && isInside(other, el)))
}

// --- Lectura del CSS ---

type Rule = { selector: string; decls: Map<string, string> }

function cssOf(root: Node): string {
  return elements(root)
    .filter((el) => el.tagName === 'style')
    .map((el) => (el.childNodes ?? []).map((c) => c.value ?? '').join(''))
    .join('\n')
}

function cssRules(root: Node): Rule[] {
  const rules: Rule[] = []
  postcss.parse(cssOf(root)).walkRules((rule) => {
    const decls = new Map<string, string>()
    rule.walkDecls((decl) => {
      decls.set(decl.prop.toLowerCase(), decl.value.trim())
    })
    rules.push({ selector: rule.selector, decls })
  })
  return rules
}

function inlineStyles(root: Node): { el: Node; style: string }[] {
  return elements(root)
    .filter((el) => attr(el, 'style') !== undefined)
    .map((el) => ({ el, style: attr(el, 'style') ?? '' }))
}

// Selectores sencillos: etiqueta, `.clase`, `#id`, `[atributo]`, `[atributo="valor"]` y `*`,
// con descendiente (espacio), hijo (`>`) y hermanos (`+`, `~`). Las pseudoclases y los
// pseudoelementos se ignoran (el selector puede coincidir con más elementos de los reales).
type Compound = {
  tag?: string
  classes: string[]
  id?: string
  attrs: { name: string; value?: string }[]
}

function parseCompound(source: string): Compound {
  const withoutPseudo = source.replace(/::?[a-zA-Z-]+(\([^)]*\))?/g, '')
  const compound: Compound = { classes: [], attrs: [] }
  const tag = /^[a-zA-Z][a-zA-Z0-9-]*/.exec(withoutPseudo)
  if (tag) compound.tag = tag[0].toLowerCase()
  for (const m of withoutPseudo.matchAll(/\.([\w-]+)/g)) compound.classes.push(m[1] ?? '')
  const id = /#([\w-]+)/.exec(withoutPseudo)
  if (id) compound.id = id[1]
  for (const m of withoutPseudo.matchAll(/\[([\w-]+)(?:[~|^$*]?=["']?([^"'\]]*)["']?)?\]/g)) {
    compound.attrs.push({ name: m[1] ?? '', value: m[2] })
  }
  return compound
}

function matchesCompound(el: Node, compound: Compound): boolean {
  if (compound.tag && el.tagName !== compound.tag) return false
  const own = classes(el)
  if (!compound.classes.every((c) => own.includes(c))) return false
  if (compound.id && attr(el, 'id') !== compound.id) return false
  return compound.attrs.every((a) => {
    const value = attr(el, a.name)
    return value !== undefined && (a.value === undefined || value === a.value)
  })
}

function previousSiblings(el: Node): Node[] {
  const siblings = (el.parentNode?.childNodes ?? []).filter(isElement)
  return siblings.slice(0, siblings.indexOf(el)).reverse()
}

function matchesSelector(el: Node, selector: string): boolean {
  const tokens = selector
    .trim()
    .replace(/\s*([>+~])\s*/g, ' $1 ')
    .split(/\s+/)
    .filter(Boolean)
  const parts: { compound: Compound; combinator: string }[] = []
  let combinator = ' '
  for (const token of tokens) {
    if (token === '>' || token === '+' || token === '~') {
      combinator = token
      continue
    }
    parts.push({ compound: parseCompound(token), combinator })
    combinator = ' '
  }
  const step = (node: Node, index: number): boolean => {
    const part = parts[index]
    if (!part || !matchesCompound(node, part.compound)) return false
    if (index === 0) return true
    const link = part.combinator
    if (link === '>') {
      const parent = node.parentNode
      return !!parent && isElement(parent) && step(parent, index - 1)
    }
    if (link === '+') {
      const previous = previousSiblings(node)[0]
      return !!previous && step(previous, index - 1)
    }
    if (link === '~') return previousSiblings(node).some((p) => step(p, index - 1))
    return ancestors(node).some((a) => step(a, index - 1))
  }
  return parts.length > 0 && step(el, parts.length - 1)
}

function ruleMatches(el: Node, rule: Rule): boolean {
  return rule.selector.split(',').some((s) => matchesSelector(el, s))
}

function sameColor(a: string | undefined, b: string): boolean {
  return !!a && a.toLowerCase().includes(b.toLowerCase())
}

// Valores de las cuatro cajitas, por su rótulo, del texto del bloque.
function boxValues(root: Node): Record<string, string> {
  const text = textOf(block(root, 'cajitas')).replace(/\s+/g, ' ').trim()
  const m = /^Revisión\s*(.+?)\s*Verifier\s*(.+?)\s*CI\s*(.+?)\s*Duración\s*(.+)$/.exec(text)
  expect(m, `las cuatro cajitas, en orden, en «${text}»`).not.toBeNull()
  const [, revision, verifier, ci, duracion] = m ?? []
  return {
    revision: revision ?? '',
    verifier: verifier ?? '',
    ci: ci ?? '',
    duracion: duracion ?? ''
  }
}

// --- Criterios ---

describe('CA1 (0104): con un JSON completo salen todas las partes de la tarjeta', () => {
  it('cabecera con «Vigía · Orquestador» y la fecha y hora local', () => {
    const root = parseHtml(build(completo()))
    const cabecera = textOf(block(root, 'cabecera'))
    expect(cabecera).toContain('Vigía · Orquestador')
    expect(cabecera).toMatch(/12/)
    expect(cabecera).toMatch(/10:00/)
  })

  it('con origen «planificador», la cabecera dice «Vigía · Planificador»', () => {
    const root = parseHtml(build(completo({ origen: 'planificador' })))
    const cabecera = textOf(block(root, 'cabecera'))
    expect(cabecera).toContain('Vigía · Planificador')
    expect(cabecera).not.toContain('Orquestador')
  })

  it('«Ficha NNNN», el título, la etiqueta de estado y las cuatro cajitas con su valor', () => {
    const root = parseHtml(build(completo()))
    const all = textOf(root)
    expect(all).toContain('Ficha 0104')
    expect(findByText(root, 'Tarjeta HTML del aviso')).toBeDefined()
    expect(findByText(root, '❚❚ En pausa · espera a Dani')).toBeDefined()

    const values = boxValues(root)
    expect(values.revision).toContain('2')
    expect(values.verifier).toMatch(/verde/i)
    // El CI va sin enlace: uno de los textos de la ficha, nunca la URL.
    expect(['en verde', 'en rojo', 'sin pasar']).toContain(values.ci)
    expect(values.duracion).toBe('42 min')
    const cajitas = block(root, 'cajitas')
    expect(textOf(cajitas)).not.toContain(CI_URL)
    expect(elements(cajitas).some((el) => el.tagName === 'a')).toBe(false)
  })

  it('el resumen, la caja de decisión y el pie con la rama y la PR', () => {
    const root = parseHtml(build(completo()))
    const resumen = blocks(root, 'resumen').map(textOf).join('\n')
    expect(resumen).toContain('Qué se hizo')
    expect(resumen).toContain('VIGIA_TELEGRAM_TOKEN')

    const decision = textOf(block(root, 'decision'))
    expect(decision).toContain('Decisión que se espera')
    expect(decision).toContain(DECISION)

    const pie = textOf(block(root, 'pie'))
    expect(pie).toContain(RAMA)
    expect(pie).toMatch(/321/)
  })
})

describe('CA2 (0104): lo que no viene no sale, salvo las cuatro cajitas con «—»', () => {
  it('sin decision, rama, pr ni duracion: ni caja de decisión ni pie, y Duración con «—»', () => {
    const root = parseHtml(build(minimo()))
    expect(blocks(root, 'decision')).toHaveLength(0)
    expect(blocks(root, 'pie')).toHaveLength(0)
    expect(textOf(root)).not.toContain('Decisión que se espera')
    const values = boxValues(root)
    expect(values.duracion).toBe('—')
    // Sin `ci`, la cajita del CI también enseña «—».
    expect(values.ci).toBe('—')
  })

  it('una decisión vacía tampoco saca la caja', () => {
    const root = parseHtml(build(minimo({ decision: '' })))
    expect(blocks(root, 'decision')).toHaveLength(0)
    expect(textOf(root)).not.toContain('Decisión que se espera')
  })

  it('con solo la rama, el pie la lleva', () => {
    const root = parseHtml(build(minimo({ rama: RAMA })))
    expect(textOf(block(root, 'pie'))).toContain(RAMA)
  })
})

describe('CA3 (0104): cada estado da su etiqueta con símbolo y su clase de color', () => {
  const ESTADOS: { estado: string; label: string; bg: string; fg: string }[] = [
    { estado: 'hecha', label: '✓ OK', bg: '#123524', fg: '#4ade80' },
    { estado: 'cerrada', label: '✓ OK', bg: '#123524', fg: '#4ade80' },
    { estado: 'parada', label: '❚❚ En pausa · espera a Dani', bg: '#3a2a0e', fg: '#fbbf24' },
    { estado: 'bloqueada', label: '✕ Bloqueada', bg: '#3b1418', fg: '#f87171' },
    { estado: 'fallida', label: '✕ Bloqueada', bg: '#3b1418', fg: '#f87171' },
    { estado: 'en_proceso', label: '● En proceso', bg: '#10283f', fg: '#60a5fa' }
  ]

  // La etiqueta y sus dos elementos de encima: la píldora puede envolver el texto.
  function pillChain(root: Node, label: string): Node[] {
    const el = findByText(root, label)
    expect(el, `etiqueta «${label}»`).toBeDefined()
    return el ? [el, ...ancestors(el).slice(0, 2)] : []
  }

  // Clase de color de la etiqueta: la que tiene una regla con el color de texto del estado.
  function colorClass(root: Node, chain: Node[], fg: string): string {
    const rules = cssRules(root).filter((r) => sameColor(r.decls.get('color'), fg))
    for (const el of chain) {
      for (const c of classes(el)) {
        if (rules.some((r) => r.selector.includes(`.${c}`) && ruleMatches(el, r))) return c
      }
    }
    return ''
  }

  it.each(ESTADOS)('$estado → «$label», con su clase de color', ({ estado, label, bg, fg }) => {
    const root = parseHtml(build(minimo({ estado })))
    const chain = pillChain(root, label)
    // Símbolos, no emoji (en Windows los emoji salen con su propio color).
    expect(/\p{Extended_Pictographic}/u.test(textOf(chain[0] as Node))).toBe(false)
    expect(textOf(chain[0] as Node)).not.toContain(String.fromCodePoint(0xfe0f))

    const rules = cssRules(root)
    const applies = (pred: (r: Rule) => boolean): boolean =>
      chain.some((el) => rules.some((r) => pred(r) && ruleMatches(el, r)))
    expect(colorClass(root, chain, fg), `clase con color ${fg}`).not.toBe('')
    expect(
      applies(
        (r) =>
          sameColor(r.decls.get('background'), bg) || sameColor(r.decls.get('background-color'), bg)
      ),
      `fondo ${bg}`
    ).toBe(true)
  })

  it('hecha y cerrada comparten clase; bloqueada y fallida también', () => {
    const cls = (estado: string, label: string, fg: string): string => {
      const root = parseHtml(build(minimo({ estado })))
      return colorClass(root, pillChain(root, label), fg)
    }
    expect(cls('hecha', '✓ OK', '#4ade80')).toBe(cls('cerrada', '✓ OK', '#4ade80'))
    expect(cls('bloqueada', '✕ Bloqueada', '#f87171')).toBe(
      cls('fallida', '✕ Bloqueada', '#f87171')
    )
  })

  it('con tipo «version» sale «Versión X.Y.Z» y no «Ficha»', () => {
    const datos: Datos = {
      tipo: 'version',
      version: '0.12.0',
      titulo: 'Avisos en imagen',
      estado: 'cerrada',
      resumen: 'Versión cerrada.'
    }
    const root = parseHtml(build(datos))
    const all = textOf(root)
    expect(all).toContain('Versión 0.12.0')
    expect(all).not.toMatch(/Ficha\b/)
  })
})

describe('CA4 (0104): el Markdown del resumen da títulos, código, listas, tabla y colores', () => {
  it('h2, h3, code en línea, ul, ol, tabla y bloque de código con clases de lowlight', () => {
    const root = parseHtml(build(minimo({ resumen: RESUMEN_MD })))
    const inResumen = blocks(root, 'resumen').flatMap((b) => [b, ...elements(b)])
    const tags = new Set(inResumen.map((el) => el.tagName))
    for (const tag of ['h2', 'h3', 'ul', 'ol', 'table', 'pre']) expect(tags, tag).toContain(tag)

    const inlineCode = inResumen.filter(
      (el) => el.tagName === 'code' && !ancestors(el).some((a) => a.tagName === 'pre')
    )
    expect(inlineCode.map(textOf)).toContain('VIGIA_TELEGRAM_TOKEN')

    const pre = inResumen.find((el) => el.tagName === 'pre')
    expect(pre).toBeDefined()
    const code = pre ? elements(pre).find((el) => el.tagName === 'code') : undefined
    expect(code).toBeDefined()
    const highlighted = code
      ? elements(code).filter((el) => classes(el).some((c) => c.startsWith('hljs-')))
      : []
    expect(highlighted.length).toBeGreaterThan(0)
    expect(code ? textOf(code) : '').toContain('const total: number = 1')
    // Las clases de lowlight tienen sus colores en el CSS de la página.
    expect(cssRules(root).some((r) => /\.hljs-[\w-]+/.test(r.selector))).toBe(true)
  })
})

describe('CA5 (0104): el resumen no mete HTML y los demás campos se escapan', () => {
  const MALICIOSO = [
    'Texto normal.',
    '',
    '<script>alert(1)</script>',
    '',
    '<img src="https://ejemplo.invalid/x.png" onerror="alert(2)">',
    '',
    '<iframe src="https://ejemplo.invalid/"></iframe>',
    '',
    '<div onclick="alert(4)">caja</div>',
    '',
    '<span style="color:red">rojo</span> y <style>body{display:none}</style>',
    '',
    '[pulsa aquí](javascript:alert(3))'
  ].join('\n')

  it('ni script, img, iframe, style, atributos on* ni enlaces javascript:', () => {
    const html = build(minimo({ resumen: MALICIOSO }))
    const root = parseHtml(html)
    const inResumen = blocks(root, 'resumen').flatMap((b) => [b, ...elements(b)])
    expect(inResumen.length).toBeGreaterThan(0)
    for (const el of inResumen) {
      expect(['script', 'img', 'iframe', 'style', 'form'], `<${el.tagName}>`).not.toContain(
        el.tagName
      )
      for (const a of el.attrs ?? []) {
        expect(a.name, `atributo ${a.name}`).not.toMatch(/^on/i)
        expect(a.name, `atributo ${a.name}`).not.toMatch(/^(style|src)$/i)
        expect(a.value).not.toMatch(/javascript:/i)
      }
    }
    // Los enlaces se quedan como texto.
    expect(inResumen.some((el) => el.tagName === 'a')).toBe(false)
    expect(blocks(root, 'resumen').map(textOf).join(' ')).toContain('pulsa aquí')
    // En todo el documento, nada de lo anterior como etiqueta o atributo.
    const all = elements(root)
    expect(all.some((el) => ['script', 'img', 'iframe', 'form'].includes(el.tagName ?? ''))).toBe(
      false
    )
    expect(all.some((el) => (el.attrs ?? []).some((a) => /^on/i.test(a.name)))).toBe(false)
    expect(all.some((el) => (el.attrs ?? []).some((a) => /javascript:/i.test(a.value)))).toBe(false)
    expect(html).not.toMatch(/<script/i)
  })

  it('un título y una decisión con <, > y & salen escapados', () => {
    const titulo = 'Menor <b>negrita</b> & mayor > fin'
    const decision = '¿A < B && C? <i>sí</i> o no'
    const html = build(completo({ titulo, decision }))
    const root = parseHtml(html)
    const titleEl = findByText(root, titulo)
    expect(titleEl, 'el título, con su texto tal cual').toBeDefined()
    expect(titleEl ? elements(titleEl).some((el) => el.tagName === 'b') : true).toBe(false)
    const caja = block(root, 'decision')
    expect(textOf(caja)).toContain(decision)
    expect(elements(caja).some((el) => el.tagName === 'i')).toBe(false)
    expect(html).toContain('&lt;b&gt;negrita&lt;/b&gt; &amp; mayor &gt; fin')
    expect(html).toContain('&lt;i&gt;sí&lt;/i&gt;')
    expect(html).toContain('&amp;&amp;')
  })
})

describe('CA6 (0104): nada externo y con la CSP de la ficha', () => {
  it('sin URL http:, https: ni // en src o href, sin <link> ni <script>, con la CSP', () => {
    const resumen = [
      'Ver [la PR](https://github.com/ejemplo/vigia/pull/321) y [otra](//ejemplo.invalid/x).',
      '',
      '![captura](https://ejemplo.invalid/captura.png)'
    ].join('\n')
    const html = build(completo({ resumen }))
    const root = parseHtml(html)
    expect(html.trimStart()).toMatch(/^<!doctype html>/i)

    const all = elements(root)
    expect(all.some((el) => el.tagName === 'link')).toBe(false)
    expect(all.some((el) => el.tagName === 'script')).toBe(false)
    for (const el of all) {
      for (const name of ['src', 'href']) {
        const value = attr(el, name)
        if (value !== undefined)
          expect(value.trim(), `${name} de <${el.tagName}>`).not.toMatch(/^(https?:|\/\/)/i)
      }
    }
    // Ni fuentes ni hojas de estilo de fuera.
    const css = cssOf(root)
    expect(css).not.toMatch(/@import/i)
    expect(css).not.toMatch(/url\(\s*["']?(https?:|\/\/)/i)

    const metas = all.filter(
      (el) =>
        el.tagName === 'meta' && attr(el, 'http-equiv')?.toLowerCase() === 'content-security-policy'
    )
    expect(metas).toHaveLength(1)
    const csp = (attr(metas[0] as Node, 'content') ?? '')
      .split(';')
      .map((d) => d.trim().replace(/\s+/g, ' '))
      .filter(Boolean)
    expect(csp).toEqual(["default-src 'none'", "style-src 'unsafe-inline'", 'img-src data:'])
  })
})

describe('CA7 (0104): sin mayúsculas forzadas ni espaciado; solo las cajitas centradas', () => {
  it('el CSS no tiene text-transform: uppercase ni letter-spacing', () => {
    const root = parseHtml(build(completo()))
    const styles = [cssOf(root), ...inlineStyles(root).map((s) => s.style)].join('\n')
    expect(styles).not.toMatch(/text-transform\s*:\s*uppercase/i)
    expect(styles).not.toMatch(/letter-spacing/i)
    expect(styles).not.toMatch(/font-variant[^;]*small-caps/i)
  })

  it('lo centrado está solo en las cajitas; el título y el resumen, a la izquierda', () => {
    const root = parseHtml(build(completo()))
    const all = elements(root)
    const cajitas = block(root, 'cajitas')
    const rules = cssRules(root)
    const centers = (decls: Map<string, string>): boolean =>
      ['text-align', 'justify-content', 'justify-items', 'place-items', 'place-content'].some(
        (prop) => /\bcenter\b/i.test(decls.get(prop) ?? '')
      )

    for (const rule of rules.filter((r) => centers(r.decls))) {
      for (const el of all.filter((e) => ruleMatches(e, rule))) {
        expect(
          isInside(el, cajitas),
          `«${rule.selector}» centra <${el.tagName}> fuera de las cajitas`
        ).toBe(true)
      }
    }
    for (const { el, style } of inlineStyles(root)) {
      if (
        /(text-align|justify-content|justify-items|place-items|place-content)\s*:[^;]*center/i.test(
          style
        )
      ) {
        expect(isInside(el, cajitas), 'estilo en línea centrado fuera de las cajitas').toBe(true)
      }
    }

    // Las cajitas sí van centradas.
    const centeredInBoxes = [cajitas, ...elements(cajitas)].some(
      (el) =>
        rules.some(
          (r) => /\bcenter\b/i.test(r.decls.get('text-align') ?? '') && ruleMatches(el, r)
        ) || /text-align\s*:\s*center/i.test(attr(el, 'style') ?? '')
    )
    expect(centeredInBoxes, 'text-align: center en las cajitas').toBe(true)

    // Nada alinea a la derecha (ni justifica) el título, el resumen ni lo que los contiene.
    const titleEl = findByText(root, 'Tarjeta HTML del aviso')
    expect(titleEl).toBeDefined()
    const targets = [titleEl as Node, ...blocks(root, 'resumen')]
    const notLeft = rules.filter((r) =>
      /\b(right|end|justify|center)\b/i.test(r.decls.get('text-align') ?? '')
    )
    for (const target of targets) {
      for (const el of [target, ...ancestors(target)]) {
        for (const rule of notLeft) {
          expect(ruleMatches(el, rule), `«${rule.selector}» en <${el.tagName}>`).toBe(false)
        }
      }
    }
  })
})

describe('CA8 (0104): el resumen no se recorta, salvo el tope de seguridad', () => {
  // Párrafos numerados de 100 caracteres, separados por una línea en blanco.
  function paragraphs(count: number): string {
    return Array.from({ length: count }, (_, i) => {
      const mark = `P${String(i + 1).padStart(4, '0')}`
      return `${mark} ${'texto '.repeat(16)}`.slice(0, 100)
    }).join('\n\n')
  }

  it('un resumen de 10 000 caracteres sale entero', () => {
    const resumen = paragraphs(99)
    expect(resumen.length).toBeGreaterThanOrEqual(10_000)
    const root = parseHtml(build(minimo({ resumen })))
    const text = blocks(root, 'resumen').map(textOf).join('\n')
    for (let i = 1; i <= 99; i++) expect(text).toContain(`P${String(i).padStart(4, '0')}`)
    expect(text).not.toContain('…')
  })

  it('uno más largo que el tope se corta con «…»', () => {
    const resumen = paragraphs(1000)
    expect(resumen.length).toBeGreaterThan(100_000)
    const root = parseHtml(build(minimo({ resumen })))
    const resumenBlocks = blocks(root, 'resumen')
    const text = resumenBlocks.map(textOf).join('\n')
    expect(text).toContain('P0099')
    expect(text).not.toContain('P1000')
    expect(text.length).toBeLessThan(resumen.length)
    expect(textOf(resumenBlocks[resumenBlocks.length - 1] as Node).trimEnd()).toMatch(/…$/)
  })
})

describe('CA9 (0104): cada bloque de primer nivel lleva su marca data-bloque', () => {
  it('cabecera, cajitas, cada bloque del resumen, decisión y pie, sin anidarse', () => {
    const root = parseHtml(build(completo()))
    const marked = elements(root).filter((el) => attr(el, 'data-bloque') !== undefined)
    const names = marked.map((el) => attr(el, 'data-bloque'))
    for (const name of ['cabecera', 'cajitas', 'decision', 'pie']) {
      expect(
        names.filter((n) => n === name),
        name
      ).toHaveLength(1)
    }
    for (const el of marked) {
      expect(
        ancestors(el).some((a) => attr(a, 'data-bloque') !== undefined),
        `data-bloque="${attr(el, 'data-bloque')}" dentro de otro bloque`
      ).toBe(false)
    }

    // Un bloque marcado por cada bloque del Markdown, en orden.
    const resumen = blocks(root, 'resumen')
    expect(resumen).toHaveLength(RESUMEN_BLOQUES.length)
    const kinds = resumen.map((el) => {
      if (RESUMEN_BLOQUES.includes(el.tagName ?? '')) return el.tagName
      const children = (el.childNodes ?? []).filter(isElement)
      return children.length === 1 ? children[0]?.tagName : `envoltorio de ${children.length}`
    })
    expect(kinds).toEqual(RESUMEN_BLOQUES)
  })
})
