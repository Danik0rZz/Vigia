// Evidencias visuales en el aviso de ficha hecha (ficha 0108).
//
// El campo `evidencias` del JSON del aviso es la ruta del `manifiesto.json` que deja la 0107
// (`e2e/evidence.ts`) en `test-results/evidencias/<ficha>/`. Este módulo lo lee y comprueba
// (`loadEvidence`) y, al capturar la tarjeta, reduce o quita la evidencia que deja una parte por
// encima del peso de foto de Telegram (`captureWithEvidence`). La tarjeta (telegram-card.mjs) solo
// pinta lo que recibe ya leído.
//
// Seguridad (la ruta viene en un JSON): solo se leen ficheros que, con la ruta ya resuelta (sin
// `..` y siguiendo los enlaces con `realpath`), están dentro de `<cwd>/test-results/evidencias/`
// (el repositorio es la carpeta desde la que se lanza el script) y, las imágenes, con la firma de
// PNG. Lo demás se ignora y se dice en la terminal. Los textos del manifiesto pasan por el filtro
// del tenant de notify-telegram.mjs, como el resto de campos (`evidenceTexts`).
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

/** Carpeta de las evidencias, relativa al repositorio. */
export const EVIDENCE_ROOT = join('test-results', 'evidencias')
/** Tope del manifiesto y de cada PNG, en bytes (contra un fichero roto o enorme). */
export const MAX_MANIFEST_BYTES = 1_000_000
export const MAX_IMAGE_BYTES = 25_000_000
/** Tope de los textos de cada evidencia, en caracteres. */
const MAX_TEXT = 500
/** Pasos de reducción: 1 y 2 estrechan las capturas (60 % y 35 %); 3 las quita. */
const REDUCE_STEPS = 2
const DROP_LEVEL = REDUCE_STEPS + 1
/** Capturas como mucho (la primera y las de reducir), para no alargar el aviso sin fin. */
const MAX_CAPTURES = 6

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function cut(value) {
  const chars = [...value]
  return chars.length <= MAX_TEXT ? value : `${chars.slice(0, MAX_TEXT - 1).join('')}…`
}

/** `path` está dentro de `root` (las dos ya resueltas con realpath), sin ser la propia `root`. */
function isInside(root, path) {
  const rel = relative(root, path)
  return rel !== '' && !isAbsolute(rel) && rel.split(sep)[0] !== '..'
}

/** Ruta real de `path` si existe y es un fichero dentro de `root`; si no, el motivo. */
function checkFile(root, path) {
  let real
  try {
    real = realpathSync.native(path)
  } catch {
    return { problem: 'no existe' }
  }
  if (!isInside(root, real)) return { problem: 'está fuera de test-results/evidencias' }
  if (!statSync(real).isFile()) return { problem: 'no es un fichero' }
  return { real }
}

function isPng(bytes) {
  return (
    bytes.length >= 24 &&
    bytes.subarray(0, 8).equals(PNG_SIGNATURE) &&
    bytes.subarray(12, 16).toString('ascii') === 'IHDR'
  )
}

/** La imagen como `data:image/png;base64,…`, o undefined (y se avisa) si no vale. */
function readImage(root, base, name, label, warn) {
  if (text(name) === '') {
    warn(`la evidencia ${label} no dice dónde está su captura: se ignora esa captura.`)
    return undefined
  }
  const { real, problem } = checkFile(root, resolve(base, name))
  if (problem) {
    warn(`una captura de la evidencia ${label} ${problem}: se ignora.`)
    return undefined
  }
  if (statSync(real).size > MAX_IMAGE_BYTES) {
    warn(
      `una captura de la evidencia ${label} pasa de ${MAX_IMAGE_BYTES / 1_000_000} MB: se ignora.`
    )
    return undefined
  }
  const bytes = readFileSync(real)
  if (!isPng(bytes)) {
    warn(`una captura de la evidencia ${label} no es un PNG: se ignora.`)
    return undefined
  }
  return `data:image/png;base64,${bytes.toString('base64')}`
}

/**
 * Lee el manifiesto de `path` (relativa a `cwd` o absoluta) y sus capturas. Devuelve
 * `{ items, folder }`, con `items` como los pide `buildCardHtml(datos, { evidencias })` y `folder`
 * la carpeta del manifiesto relativa al repositorio (`test-results/evidencias/<ficha>`), o
 * undefined si no hay nada que pintar. Lo que no vale se dice con `warn` y no se pinta. No lanza.
 */
export function loadEvidence(path, { cwd, warn }) {
  try {
    let root
    let repo
    try {
      repo = realpathSync.native(cwd)
      root = realpathSync.native(join(cwd, EVIDENCE_ROOT))
    } catch {
      warn('no existe test-results/evidencias en el repositorio: el aviso sale sin evidencias.')
      return undefined
    }
    const { real: manifest, problem } = checkFile(root, resolve(cwd, path))
    if (problem) {
      warn(`el manifiesto de evidencias ${problem}: el aviso sale sin evidencias.`)
      return undefined
    }
    if (statSync(manifest).size > MAX_MANIFEST_BYTES) {
      warn('el manifiesto de evidencias es demasiado grande: el aviso sale sin evidencias.')
      return undefined
    }
    let entries
    try {
      entries = JSON.parse(readFileSync(manifest, 'utf8'))
    } catch {
      warn('el manifiesto de evidencias no es un JSON válido: el aviso sale sin evidencias.')
      return undefined
    }
    if (!Array.isArray(entries)) {
      warn('el manifiesto de evidencias no es una lista: el aviso sale sin evidencias.')
      return undefined
    }
    const base = dirname(manifest)
    const items = []
    for (const [i, entry] of entries.entries()) {
      const criterio = cut(text(entry?.criterio))
      if (!criterio) {
        warn(`la evidencia ${i + 1} del manifiesto no tiene criterio: se ignora.`)
        continue
      }
      const zona = readImage(root, base, entry.zona, criterio, warn)
      const ventana = readImage(root, base, entry.ventana, criterio, warn)
      if (!zona && !ventana) {
        warn(`la evidencia ${criterio} no tiene ninguna captura válida: se ignora.`)
        continue
      }
      items.push({
        criterio,
        titulo: cut(text(entry.titulo)),
        nota: cut(text(entry.nota)),
        estable: entry.estable !== false,
        zona,
        ventana
      })
    }
    if (items.length === 0) {
      warn('ninguna evidencia del manifiesto vale: el aviso sale sin evidencias.')
      return undefined
    }
    return { items, folder: relative(repo, base).split(sep).join('/') }
  } catch (error) {
    const reason = error instanceof Error ? error.message.split('\n')[0] : String(error)
    warn(`no se han podido leer las evidencias (${reason}): el aviso sale sin ellas.`)
    return undefined
  }
}

/** Textos de las evidencias, para el filtro del tenant. */
export function evidenceTexts(evidence) {
  if (!evidence) return []
  return evidence.items.flatMap((item) => [item.criterio, item.titulo, item.nota])
}

/**
 * Qué evidencias lleva cada parte: el mapa que deja la captura (`parts.evidences`, de
 * telegram-capture.cjs) si es válido. Sin él (una captura inyectada), se supone el corte de la
 * 0105 con una parte por evidencia: delante, lo de antes de las evidencias; detrás, el pie, si la
 * tarjeta lo lleva. Si no cuadra, ninguna parte lleva evidencias (y no se reduce nada).
 */
function evidenceMap(parts, count, hasFooter) {
  const map = parts.evidences
  const valid =
    Array.isArray(map) &&
    map.length === parts.length &&
    map.every(
      (list) => Array.isArray(list) && list.every((n) => Number.isInteger(n) && n >= 0 && n < count)
    )
  if (valid) return map
  const before = parts.length - count - (hasFooter ? 1 : 0)
  return parts.map((_, i) => {
    const n = i - before
    return before >= 0 && n >= 0 && n < count ? [n] : []
  })
}

/**
 * Captura la tarjeta y, si una parte pasa del peso de foto por sus evidencias, las reduce (más
 * estrechas) y vuelve a capturar; si ni así, la parte sale sin esas capturas y con la nota
 * «evidencia en <carpeta>». Sin evidencias, una sola captura. Devuelve las partes de la última
 * captura; lo que siga sin valer lo decide quien llama (el texto de respaldo).
 * - `render(evidencias)`: el HTML de la tarjeta (`evidencias` undefined sin evidencias).
 * - `shoot(html)`: las partes (con su tiempo máximo).
 * - `isHeavy(part)`: la parte pasa del peso de foto.
 */
export async function captureWithEvidence({ evidence, render, shoot, isHeavy, warn }) {
  if (!evidence) return shoot(render(undefined))
  const levels = evidence.items.map(() => 0)
  const note = `evidencia en ${evidence.folder}`
  for (let round = 1; ; round++) {
    const evidencias = evidence.items.map((item, i) =>
      levels[i] >= DROP_LEVEL
        ? { ...item, zona: undefined, ventana: undefined, falta: note }
        : { ...item, reduccion: levels[i] }
    )
    const html = render(evidencias)
    const parts = await shoot(html)
    if (round >= MAX_CAPTURES) return parts
    const map = evidenceMap(parts, evidencias.length, html.includes('data-bloque="pie"'))
    const targets = new Set()
    for (const [i, part] of parts.entries()) {
      if (!isHeavy(part)) continue
      const own = map[i].filter((n) => levels[n] < DROP_LEVEL)
      // Una parte que pesa sin evidencias que reducir: no hay arreglo aquí.
      if (own.length === 0) return parts
      for (const n of own) targets.add(n)
    }
    if (targets.size === 0) return parts
    for (const n of targets) {
      levels[n]++
      const { criterio } = evidence.items[n]
      if (levels[n] >= DROP_LEVEL)
        warn(
          `la evidencia ${criterio} no cabe en una foto ni reducida: sale sin sus capturas (${note}).`
        )
      else warn(`la evidencia ${criterio} deja su parte por encima de 10 MB: se reduce.`)
    }
  }
}
