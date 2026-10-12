// Tarjeta HTML del aviso de Telegram (ficha 0104).
//
// `buildCardHtml(datos)` devuelve un documento HTML completo a partir del JSON del aviso (el de
// `notify-telegram.mjs`, más `duracion`, `rama`, `pr` y `origen`, opcionales). Es una función
// pura: no lee disco ni red. Capturar el HTML y enviarlo es cosa de la 0105.
//
// Seguridad (el resumen lo escriben los agentes):
// - El Markdown se pinta con react-markdown sin `rehype-raw` y con `skipHtml`: el HTML crudo no se
//   interpreta ni sale. Después, `rehype-sanitize` con una lista blanca corta: sin `a` (los
//   enlaces se quedan como texto, en la imagen no se pulsan), sin `img`, `script`, `style`,
//   `iframe` ni `form`, y sin atributos salvo `language-*` en `code` y `start` en `ol`.
// - Los colores del código (lowlight) y las marcas `data-bloque` se añaden después del saneado:
//   las clases `hljs-*` las genera lowlight, nunca el texto del resumen.
// - Los demás campos van como texto de React, que los escapa.
// - La página lleva su CSP en una `meta` y no carga nada de fuera (ni fuentes, ni imágenes, ni
//   scripts).
//
// Marcas `data-bloque` (para que la 0105 parta la imagen entre bloques, nunca por la mitad):
// `cabecera`, `titulo`, `cajitas`, `resumen` (una por bloque del Markdown), `decision` y `pie`.
// Ninguna va dentro de otra.
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSanitize from 'rehype-sanitize'
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

/** Tope de seguridad del resumen, en caracteres (contra un JSON roto; no es para que quepa). */
export const MAX_RESUMEN = 20_000

export const CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:"

const DASH = '—'

// Los mismos lenguajes que el visor de Markdown de la app (markdown-plugins.ts).
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

/** Etiqueta de cada estado: texto con símbolos (no emoji) y clase de color. */
const ESTADOS = {
  hecha: { label: '✓ OK', className: 'estado-ok' },
  cerrada: { label: '✓ OK', className: 'estado-ok' },
  parada: { label: '❚❚ En pausa · espera a Dani', className: 'estado-pausa' },
  en_proceso: { label: '● En proceso', className: 'estado-proceso' },
  bloqueada: { label: '✕ Bloqueada', className: 'estado-bloqueada' },
  fallida: { label: '✕ Bloqueada', className: 'estado-bloqueada' }
}

/** Lista blanca del resumen (formato `hast-util-sanitize`; el ADR-0011 como referencia). */
const SANITIZE_SCHEMA = {
  tagNames: [
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'p',
    'br',
    'hr',
    'strong',
    'em',
    'del',
    'code',
    'pre',
    'blockquote',
    'ul',
    'ol',
    'li',
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td'
  ],
  attributes: {
    code: [['className', /^language-[\w-]+$/]],
    ol: ['start']
  },
  // Se quitan con su contenido; el resto de etiquetas de fuera de la lista deja su texto.
  strip: ['script', 'style', 'template', 'noscript', 'iframe', 'object', 'embed', 'svg', 'math'],
  protocols: {},
  clobber: [],
  ancestors: {},
  required: {}
}

function text(value) {
  return value === undefined || value === null ? '' : String(value).trim()
}

function cut(value, max) {
  return [...value].slice(0, Math.max(0, max)).join('')
}

/** Resumen con el tope de seguridad: si lo pasa, se corta y acaba en «…». */
export function limitResumen(value) {
  const resumen = text(value)
  if ([...resumen].length <= MAX_RESUMEN) return resumen
  return `${cut(resumen, MAX_RESUMEN - 1).trimEnd()}…`
}

/** Fecha y hora locales, `dd/mm/aaaa hh:mm`. */
export function formatDate(date) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`
}

/** Verifier: `VERDE` → «en verde», `ROJO` → «en rojo», `sin pasar`; vacío → «—». */
export function verifierLabel(value) {
  const v = text(value).toLowerCase()
  if (!v) return DASH
  if (v === 'verde' || v === 'en verde') return 'en verde'
  if (v === 'rojo' || v === 'en rojo') return 'en rojo'
  if (v === 'sin pasar') return 'sin pasar'
  return text(value)
}

/**
 * Texto de la cajita del CI. El campo `ci` es el enlace del CI o de la PR (tarea.md), sin
 * estado; el estado se deduce de cuándo se manda el aviso:
 * - vacío → «—»;
 * - un estado escrito tal cual (`VERDE`, `ROJO`, `sin pasar`) → ese;
 * - con enlace, `hecha` y `cerrada` → «en verde» (solo se avisan tras pasar «CI ok»);
 *   `bloqueada` y `fallida` → «en rojo» (el enlace es el del CI que falló); el resto (`parada`
 *   al abrir la PR de una ficha sola, `en_proceso`) → «sin pasar».
 */
export function ciLabel(ci, estado) {
  const value = text(ci)
  if (!value) return DASH
  const explicit = verifierLabel(value)
  if (['en verde', 'en rojo', 'sin pasar'].includes(explicit)) return explicit
  const e = text(estado)
  if (e === 'hecha' || e === 'cerrada') return 'en verde'
  if (e === 'bloqueada' || e === 'fallida') return 'en rojo'
  return 'sin pasar'
}

function valueClass(label) {
  if (label === 'en verde') return 'valor valor-verde'
  if (label === 'en rojo') return 'valor valor-rojo'
  if (label === 'sin pasar') return 'valor valor-ambar'
  return 'valor'
}

function rondasLabel(value) {
  const raw = text(value)
  if (!raw) return DASH
  const n = Number(raw)
  if (!Number.isFinite(n)) return raw
  return n === 1 ? '1 ronda' : `${n} rondas`
}

/** Número de la PR a partir de su URL (`…/pull/321`) o de un número suelto. */
function prNumber(value) {
  const match = /(?:^#?|\/pull\/)(\d+)\/?$/.exec(text(value))
  return match ? match[1] : ''
}

// --- Plugins de rehype (después del saneado) ---

function hastText(node) {
  if (node.type === 'text') return node.value ?? ''
  return (node.children ?? []).map(hastText).join('')
}

function visit(node, callback) {
  callback(node)
  for (const child of node.children ?? []) visit(child, callback)
}

function rehypeCodeHighlight() {
  return (tree) => {
    visit(tree, (node) => {
      if (node.type !== 'element' || node.tagName !== 'pre') return
      const code = (node.children ?? []).find((c) => c.type === 'element' && c.tagName === 'code')
      if (!code) return
      const classNames = Array.isArray(code.properties?.className)
        ? code.properties.className.map(String)
        : []
      const language = classNames
        .find((c) => c.startsWith('language-'))
        ?.slice(9)
        .toLowerCase()
      if (!language || !lowlight.registered(language)) return
      code.children = lowlight.highlight(language, hastText(code)).children
      code.properties = { ...code.properties, className: [...classNames, 'hljs'] }
    })
  }
}

/** Marca cada bloque de primer nivel del resumen; el texto suelto va en un párrafo. */
function rehypeMarkBlocks() {
  return (tree) => {
    tree.children = (tree.children ?? []).flatMap((node) => {
      if (node.type === 'element') {
        node.properties = { ...node.properties, dataBloque: 'resumen' }
        return [node]
      }
      if (node.type === 'text' && node.value.trim() !== '') {
        return [
          {
            type: 'element',
            tagName: 'p',
            properties: { dataBloque: 'resumen' },
            children: [node]
          }
        ]
      }
      return []
    })
  }
}

// --- Piezas de la tarjeta ---

function Cabecera({ origen, fecha }) {
  const quien = origen === 'planificador' ? 'Planificador' : 'Orquestador'
  return h(
    'header',
    { className: 'cabecera', 'data-bloque': 'cabecera' },
    h(
      'div',
      { className: 'marca' },
      h('span', { className: 'punto' }),
      h('span', null, `Vigía · ${quien}`)
    ),
    h('div', { className: 'fecha' }, fecha)
  )
}

function Titulo({ datos }) {
  const estado = ESTADOS[text(datos.estado)]
  const rotulo =
    datos.tipo === 'version'
      ? `Versión ${text(datos.version).replace(/^v+/i, '')}`
      : `Ficha ${text(datos.ficha)}`
  const titulo = text(datos.titulo)
  return h(
    'section',
    { className: 'titulo', 'data-bloque': 'titulo' },
    h(
      'div',
      { className: 'titulo-texto' },
      h('div', { className: 'rotulo' }, rotulo),
      titulo ? h('h1', null, titulo) : null
    ),
    h(
      'span',
      { className: `estado ${estado?.className ?? 'estado-otro'}` },
      estado?.label ?? (text(datos.estado) || DASH)
    )
  )
}

function Cajita({ rotulo, valor, className = 'valor' }) {
  return h(
    'div',
    { className: 'cajita' },
    h('div', { className: 'cajita-rotulo' }, rotulo),
    h('div', { className }, valor)
  )
}

function Cajitas({ datos }) {
  const verifier = verifierLabel(datos.verifier)
  const ci = ciLabel(datos.ci, datos.estado)
  return h(
    'section',
    { className: 'cajitas', 'data-bloque': 'cajitas' },
    h(Cajita, { rotulo: 'Revisión', valor: rondasLabel(datos.rondas) }),
    h(Cajita, { rotulo: 'Verifier', valor: verifier, className: valueClass(verifier) }),
    h(Cajita, { rotulo: 'CI', valor: ci, className: valueClass(ci) }),
    h(Cajita, { rotulo: 'Duración', valor: text(datos.duracion) || DASH })
  )
}

function Resumen({ resumen }) {
  return h(
    'div',
    { className: 'resumen' },
    h(
      Markdown,
      {
        remarkPlugins: [remarkGfm],
        rehypePlugins: [[rehypeSanitize, SANITIZE_SCHEMA], rehypeCodeHighlight, rehypeMarkBlocks],
        skipHtml: true
      },
      resumen
    )
  )
}

function Decision({ decision }) {
  return h(
    'section',
    { className: 'decision', 'data-bloque': 'decision' },
    h('div', { className: 'decision-titulo' }, 'Decisión que se espera'),
    h('div', { className: 'decision-texto' }, decision)
  )
}

function Pie({ rama, pr }) {
  return h(
    'footer',
    { className: 'pie', 'data-bloque': 'pie' },
    h('span', null, rama),
    h('span', null, pr ? `PR #${pr}` : '')
  )
}

function Tarjeta({ datos, fecha }) {
  const resumen = limitResumen(datos.resumen)
  const decision = text(datos.decision)
  const rama = text(datos.rama)
  const pr = prNumber(datos.pr)
  return h(
    'main',
    { className: 'tarjeta' },
    h(Cabecera, { origen: text(datos.origen), fecha }),
    h(Titulo, { datos }),
    h(Cajitas, { datos }),
    resumen ? h(Resumen, { resumen }) : null,
    decision ? h(Decision, { decision }) : null,
    rama || pr ? h(Pie, { rama, pr }) : null
  )
}

// --- Estilos (diseño del prototipo, ficha 0104) ---

const CSS = `
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  width: 800px;
  padding: 28px;
  background: #0f1419;
  color: #e6edf3;
  font-family: "Segoe UI", system-ui, sans-serif;
  font-size: 16px;
  line-height: 1.45;
}
code, pre, .pie { font-family: Consolas, monospace; }
.tarjeta {
  background: #171d24;
  border: 1px solid #26303b;
  border-radius: 16px;
  padding: 24px 28px;
}
.cabecera {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding-bottom: 14px;
  border-bottom: 1px solid #26303b;
  color: #8b98a5;
  font-size: 15px;
}
.marca { display: flex; align-items: center; gap: 10px; color: #e6edf3; font-weight: 600; }
.punto { width: 10px; height: 10px; border-radius: 50%; background: #D97757; flex: none; }
.titulo {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  padding-top: 20px;
}
.titulo-texto { min-width: 0; }
.rotulo { font-size: 15px; color: #8b98a5; }
.titulo h1 { margin: 4px 0 0; font-size: 28px; font-weight: 650; line-height: 1.25; overflow-wrap: anywhere; }
.estado {
  flex: none;
  white-space: nowrap;
  font-size: 15px;
  font-weight: 650;
  padding: 5px 14px;
  border-radius: 999px;
  border: 1px solid #26303b;
  margin-top: 4px;
}
.estado-ok { background: #123524; color: #4ade80; border-color: #1f6b43; }
.estado-pausa { background: #3a2a0e; color: #fbbf24; border-color: #7a5a16; }
.estado-proceso { background: #10283f; color: #60a5fa; border-color: #1e4f7f; }
.estado-bloqueada { background: #3b1418; color: #f87171; border-color: #7f2a31; }
.estado-otro { background: #11171d; color: #8b98a5; }
.cajitas {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-top: 20px;
}
.cajita {
  background: #11171d;
  border: 1px solid #26303b;
  border-radius: 12px;
  padding: 12px 8px;
  text-align: center;
}
.cajita-rotulo { font-size: 13px; color: #8b98a5; }
.valor { font-size: 20px; font-weight: 650; margin-top: 2px; overflow-wrap: anywhere; }
.valor-verde { color: #4ade80; }
.valor-ambar { color: #fbbf24; }
.valor-rojo { color: #f87171; }
.resumen {
  margin-top: 20px;
  font-size: 17px;
  line-height: 1.55;
  color: #cfd8e1;
  overflow-wrap: anywhere;
}
.resumen > * { margin: 0 0 12px; }
.resumen h1, .resumen h2, .resumen h3, .resumen h4, .resumen h5, .resumen h6 {
  color: #e6edf3;
  font-weight: 650;
  line-height: 1.3;
  margin: 18px 0 10px;
}
.resumen h1 { font-size: 23px; }
.resumen h2 { font-size: 21px; }
.resumen h3 { font-size: 19px; padding-bottom: 6px; border-bottom: 1px solid #26303b; }
.resumen h4, .resumen h5, .resumen h6 { font-size: 17px; }
.resumen strong { color: #e6edf3; }
.resumen em { color: #e2c08d; }
.resumen ul, .resumen ol { padding-left: 26px; }
.resumen li { margin: 4px 0; }
.resumen li::marker { color: #D97757; }
.resumen code {
  color: #f0a37f;
  background: #2a1f1b;
  border: 1px solid #4a3128;
  border-radius: 6px;
  padding: 1px 6px;
  font-size: 15px;
}
.resumen pre {
  background: #0d1117;
  border: 1px solid #26303b;
  border-radius: 10px;
  padding: 14px 16px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.resumen pre code {
  color: #e6edf3;
  background: none;
  border: 0;
  padding: 0;
  font-size: 14px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.resumen blockquote {
  border-left: 3px solid #D97757;
  background: #141a20;
  padding: 8px 14px;
  margin-left: 0;
  margin-right: 0;
}
.resumen table { border-collapse: collapse; font-size: 15px; }
.resumen th, .resumen td { border: 1px solid #26303b; padding: 6px 10px; }
.resumen th { color: #e6edf3; background: #11171d; }
.resumen hr { border: 0; border-top: 1px solid #26303b; }
.hljs-keyword, .hljs-selector-tag, .hljs-doctag, .hljs-template-tag, .hljs-type { color: #ff7b72; }
.hljs-title, .hljs-title.class_, .hljs-title.function_ { color: #d2a8ff; }
.hljs-attr, .hljs-attribute, .hljs-literal, .hljs-meta, .hljs-number, .hljs-operator,
.hljs-variable, .hljs-selector-attr, .hljs-selector-class, .hljs-selector-id { color: #79c0ff; }
.hljs-string, .hljs-regexp, .hljs-meta .hljs-string { color: #a5d6ff; }
.hljs-built_in, .hljs-symbol { color: #ffa657; }
.hljs-comment, .hljs-code, .hljs-formula { color: #8b949e; }
.hljs-name, .hljs-quote, .hljs-selector-pseudo { color: #7ee787; }
.hljs-subst { color: #e6edf3; }
.hljs-section { color: #1f6feb; font-weight: 650; }
.hljs-bullet { color: #f2cc60; }
.hljs-emphasis { font-style: italic; }
.hljs-strong { font-weight: 650; }
.hljs-addition { color: #aff5b4; background: #033a16; }
.hljs-deletion { color: #ffdcd7; background: #67060c; }
.decision {
  margin-top: 20px;
  background: #2a2112;
  border-left: 4px solid #fbbf24;
  border-radius: 10px;
  padding: 14px 18px;
}
.decision-titulo { color: #fbbf24; font-weight: 650; font-size: 17px; }
.decision-texto { margin-top: 6px; font-size: 17px; white-space: pre-wrap; overflow-wrap: anywhere; }
.pie {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  margin-top: 20px;
  padding-top: 14px;
  border-top: 1px solid #26303b;
  font-size: 14px;
  color: #8b98a5;
  overflow-wrap: anywhere;
}
`

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Documento HTML completo de la tarjeta, con el CSS en línea y sin nada de fuera. */
export function buildCardHtml(datos) {
  const fecha = formatDate(new Date())
  const body = renderToStaticMarkup(h(Tarjeta, { datos, fecha }))
  const pageTitle =
    datos.tipo === 'version'
      ? `Vigía · versión ${text(datos.version)}`
      : `Vigía · ficha ${text(datos.ficha)}`
  return [
    '<!doctype html>',
    '<html lang="es">',
    '<head>',
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${CSP}">`,
    '<meta name="viewport" content="width=800">',
    `<title>${escapeHtml(pageTitle)}</title>`,
    `<style>${CSS}</style>`,
    '</head>',
    `<body>${body}</body>`,
    '</html>',
    ''
  ].join('\n')
}
