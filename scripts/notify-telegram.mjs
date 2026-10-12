// Aviso por Telegram al terminar /tarea o /cerrar-version (ficha 0004).
//
// Uso: node scripts/notify-telegram.mjs <ruta-a-un-json>
//
// El JSON lo escribe el Orquestador en su scratchpad (campos en la ficha 0004).
// El aviso es opcional: el script SIEMPRE sale con 0 y lo que pasa se dice en
// stderr con el prefijo [aviso telegram]. El token y el chat_id salen de
// VIGIA_TELEGRAM_TOKEN y VIGIA_TELEGRAM_CHAT_ID (del entorno o, en Windows, de
// las variables de usuario del registro) y nunca se imprimen: todo texto pasa
// antes por `redact`. Con VIGIA_TELEGRAM_THREAD_ID (opcional, ficha 0103), el
// aviso va al hilo del grupo como respuesta al mensaje que lo abre; si Telegram
// lo rechaza, se reintenta una vez sin hilo. El id del hilo también se tapa.
// Antes de enviar, el texto se compara con los valores de .env.live.local, con las mismas reglas que scan:tenant; si coincide, no se
// envía. Sin .env.live.local con valores tampoco se envía, salvo con
// VIGIA_TELEGRAM_UNFILTERED=1 (ficha 0092).
//
// Desde la ficha 0105, el aviso es una imagen: la tarjeta de la 0104 (telegram-card.mjs), capturada
// con el Electron del proyecto (telegram-capture.cjs) y enviada con sendPhoto, con un pie en HTML
// de Telegram que se puede buscar y pulsar (buildCaption). Si la tarjeta es alta, va en partes: la
// primera con el pie y las demás como respuesta a ella. Si la imagen falla (no hay Electron, la
// captura falla o tarda, la imagen se pasa de los límites o Telegram la rechaza), se envía el
// texto de siempre. Con VIGIA_TELEGRAM_TEXTO=1, siempre el texto.
//
// Desde la ficha 0106, cada aviso de una ficha (o versión) responde al anterior de la misma: el
// message_id de cada envío bien (el de la primera parte, si va en varias) se guarda en
// vigia-telegram-avisos.json, en la carpeta común de git (`git rev-parse --git-common-dir`), que
// comparten el checkout principal y los worktrees y que git no ve. Solo guarda { ficha: message_id }
// (las 200 más recientes), nunca el token ni el chat_id. Si el fichero falta o está mal, el aviso
// sale como el primero. Responde con reply_parameters { message_id, allow_sending_without_reply:
// true }, para que llegue aunque el anterior se haya borrado (campos de ReplyParameters y
// result.message_id de sendMessage y sendPhoto, comprobados en
// https://core.telegram.org/bots/api#replyparameters el 2026-10-12).
//
// Desde la ficha 0108, el aviso de `hecha` puede llevar `evidencias`: la ruta del manifiesto de
// las capturas de los e2e (0107). Se lee y se comprueba en telegram-evidence.mjs, sus textos pasan
// por el filtro del tenant y la tarjeta las pinta en la sección «Evidencias».
import { execFileSync, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, win32 } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { findLiveEnv, LIVE_ENV_FILE } from './lib/env-file.mjs'
import { extractNeedles } from './scan-tenant.mjs'
import { captureWithEvidence, evidenceTexts, loadEvidence } from './telegram-evidence.mjs'

export const MAX_LENGTH = 1500
const PREFIX = '[aviso telegram]'
const TOKEN_VAR = 'VIGIA_TELEGRAM_TOKEN'
const CHAT_VAR = 'VIGIA_TELEGRAM_CHAT_ID'
const UNFILTERED_VAR = 'VIGIA_TELEGRAM_UNFILTERED'
const THREAD_VAR = 'VIGIA_TELEGRAM_THREAD_ID'
const TIMEOUT_MS = 10_000
const TEXT_ONLY_VAR = 'VIGIA_TELEGRAM_TEXTO'

/** Repositorio público: los únicos enlaces que lleva el pie. */
export const REPO_URL = 'https://github.com/Danik0rZz/Vigia'
const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url))
const CAPTURE_SCRIPT = join(SCRIPTS_DIR, 'telegram-capture.cjs')
/** Tiempo máximo de la captura (el script de captura se corta solo a los 60 s). */
export const CAPTURE_TIMEOUT_MS = 45_000
/** Tiempo máximo de cada sendPhoto: sube una imagen, más que el texto. */
const PHOTO_TIMEOUT_MS = 30_000
// Límites de sendPhoto (https://core.telegram.org/bots/api#sendphoto, comprobados el 2026-10-12):
// hasta 10 MB, ancho más alto hasta 10 000 px, proporción hasta 20 y pie de 0 a 1 024 caracteres
// después de interpretar las entidades.
export const PHOTO_MAX_BYTES = 10_000_000
export const PHOTO_MAX_SIDES = 10_000
export const PHOTO_MAX_RATIO = 20
export const CAPTION_MAX_LENGTH = 1024
/** Tope del título en el pie: con él, el pie nunca pasa de 1 024 caracteres visibles. */
const CAPTION_MAX_TITLE = 300

const ICONS = {
  hecha: '✅',
  bloqueada: '⛔',
  parada: '⏸',
  cerrada: '📦',
  fallida: '❌'
}

function text(value) {
  return value === undefined || value === null ? '' : String(value).trim()
}

/** Longitud en caracteres visibles (puntos de código), no en unidades UTF-16. */
function length(value) {
  return [...value].length
}

function cut(value, max) {
  return [...value].slice(0, Math.max(0, max)).join('')
}

function firstLine(datos) {
  const estado = text(datos.estado)
  const icon = ICONS[estado] ?? '•'
  const label = estado === 'parada' ? 'parada: decisión de Dani' : estado
  if (datos.tipo === 'version') {
    const version = text(datos.version).replace(/^v+/i, '')
    const titulo = text(datos.titulo)
    return `${icon} v${version}${titulo ? ` · ${titulo}` : ''} — ${label}`
  }
  return `${icon} ${text(datos.ficha)} · ${text(datos.titulo)} — ${label}`
}

/**
 * Texto plano del aviso, de 1 500 caracteres como mucho: primera línea con lo
 * esencial, rondas y verifier, la decisión si la hay, el resumen (recortado
 * con «…» si no cabe) y la URL del CI si la hay.
 */
export function buildMessage(datos) {
  const head = [
    firstLine(datos),
    `Rondas: ${text(datos.rondas) || '0'} · Verifier: ${text(datos.verifier)}`
  ]
  const decision = text(datos.decision)
  if (decision) head.push(`Decide Dani: ${decision}`)
  const headText = head.join('\n')
  const ci = text(datos.ci)
  const tail = ci ? `\n\n${ci}` : ''
  let resumen = text(datos.resumen)

  const fixed = length(headText) + length(tail) + (resumen ? 2 : 0)
  if (fixed + length(resumen) > MAX_LENGTH) {
    const room = MAX_LENGTH - fixed - 1
    resumen = room > 0 ? `${cut(resumen, room).trimEnd()}…` : ''
  }
  const message = `${headText}${resumen ? `\n\n${resumen}` : ''}${tail}`
  // Solo si la cabecera sola ya no cabe (una decisión enorme).
  return length(message) > MAX_LENGTH ? `${cut(message, MAX_LENGTH - 1)}…` : message
}

// --- Pie de la imagen (ficha 0105) ---

/** Estado del pie: con emoji (en la imagen van símbolos de texto, 0104). */
const CAPTION_ESTADOS = {
  hecha: '✅ OK',
  cerrada: '✅ OK',
  parada: '⏸️ Pausa, espera a Dani',
  bloqueada: '⛔ Bloqueada',
  fallida: '⛔ Bloqueada',
  en_proceso: '🔄 En proceso'
}

/** Escapado del HTML de Telegram: solo admite `&lt;`, `&gt;`, `&amp;` y `&quot;` con nombre. */
export function escapeTelegramHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * La URL normalizada si es `https://github.com/` del repositorio (`REPO_URL`), sin puerto ni
 * usuario; si no, undefined. La normalización de `URL` resuelve los `..` antes de comprobar.
 */
export function repoUrl(value) {
  const s = text(value)
  if (!s) return undefined
  let url
  try {
    url = new URL(s)
  } catch {
    return undefined
  }
  const repo = new URL(REPO_URL)
  if (url.protocol !== 'https:' || url.host !== repo.host || url.username || url.password)
    return undefined
  if (!url.pathname.startsWith(`${repo.pathname}/`)) return undefined
  return url.href
}

/** Rama válida para un enlace (letras, números, `.`, `_`, `-` y `/`, sin `..`); si no, main. */
function branchOf(value) {
  const rama = text(value)
  if (!rama || !/^[\w./-]+$/.test(rama) || rama.split('/').some((p) => p === '' || p === '..'))
    return 'main'
  return rama
}

/** Nombre del fichero de la ficha (`NNNN-….md`) en la primera carpeta que lo tenga. */
export function findTaskFile(ficha, dirs) {
  const id = text(ficha)
  if (!/^\d{4}$/.test(id)) return undefined
  for (const dir of dirs) {
    let names
    try {
      names = readdirSync(dir)
    } catch {
      continue
    }
    const name = names
      .filter((n) => n.endsWith('.md') && (n === `${id}.md` || n.startsWith(`${id}-`)))
      .sort()[0]
    if (name) return name
  }
  return undefined
}

function link(href, label) {
  return `<a href="${escapeTelegramHtml(href)}">${escapeTelegramHtml(label)}</a>`
}

/** Enlace de la ficha, al fichero en GitHub de `rama` (o de main). */
function taskLink(datos, taskDirs) {
  const ficha = text(datos.ficha)
  if (!/^\d{4}$/.test(ficha)) return undefined
  const branch = branchOf(datos.rama)
  const file = findTaskFile(ficha, taskDirs)
  const encoded = branch.split('/').map(encodeURIComponent).join('/')
  const href = repoUrl(
    file
      ? `${REPO_URL}/blob/${encoded}/tasks/${encodeURIComponent(file)}`
      : `${REPO_URL}/tree/${encoded}/tasks`
  )
  return href ? link(href, file ? file.replace(/\.md$/, '') : `tasks (${ficha})`) : undefined
}

/** Número de la PR o de la ejecución del CI, como texto del enlace. */
function linkLabel(href) {
  const pull = /\/pull\/(\d+)/.exec(href)
  if (pull) return `#${pull[1]}`
  const run = /\/actions\/runs\/(\d+)/.exec(href)
  if (run) return `ejecución ${run[1]}`
  return 'abrir'
}

/** «Tarea: NNNN» o «Versión: X.Y.Z», escapado. */
function idLine(datos) {
  if (datos.tipo === 'version')
    return `<b>Versión:</b> ${escapeTelegramHtml(text(datos.version).replace(/^v+/i, ''))}`
  return `<b>Tarea:</b> ${escapeTelegramHtml(text(datos.ficha))}`
}

const DEFAULT_TASK_DIRS = [join(SCRIPTS_DIR, '..', 'tasks')]

/**
 * Pie de la imagen en HTML de Telegram, una línea por dato y sin las que no aplican: Estado (con
 * emoji), Título (en negrita y subrayado), Tarea o Versión, y Ficha, PR y CI como enlaces. Solo
 * enlaza al repositorio (`repoUrl`); lo demás no sale. `options.taskDirs`: dónde buscar el
 * fichero de la ficha (por defecto, `tasks/` de este checkout).
 */
export function buildCaption(datos, options = {}) {
  const taskDirs = options.taskDirs ?? DEFAULT_TASK_DIRS
  const estado = text(datos.estado)
  const lines = [
    `<b>Estado:</b> ${escapeTelegramHtml(CAPTION_ESTADOS[estado] ?? `• ${estado || '—'}`)}`
  ]
  let titulo = text(datos.titulo)
  if (length(titulo) > CAPTION_MAX_TITLE) titulo = `${cut(titulo, CAPTION_MAX_TITLE - 1)}…`
  if (titulo) lines.push(`<b>Título:</b> <b><u>${escapeTelegramHtml(titulo)}</u></b>`)
  lines.push(idLine(datos))
  if (datos.tipo !== 'version') {
    const ficha = taskLink(datos, taskDirs)
    if (ficha) lines.push(`<b>Ficha:</b> ${ficha}`)
  }
  const pr = repoUrl(datos.pr)
  if (pr) lines.push(`<b>PR:</b> ${link(pr, linkLabel(pr))}`)
  const ci = repoUrl(datos.ci)
  if (ci) lines.push(`<b>CI:</b> ${link(ci, linkLabel(ci))}`)
  return lines.join('\n')
}

/** Pie de las partes 2 en adelante: «Tarea: NNNN (n/N)». */
export function buildPartCaption(datos, n, total) {
  return `${idLine(datos)} (${n}/${total})`
}

// --- Imagen: límites de Telegram ---

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
/** El problema de peso de `photoProblem` (el que se arregla reduciendo evidencias, 0108). */
const HEAVY_PROBLEM = 'pasa de 10 MB'

/** Por qué la imagen no vale para sendPhoto, o undefined si vale. */
export function photoProblem(bytes) {
  const data = Buffer.from(bytes.buffer ?? bytes, bytes.byteOffset ?? 0, bytes.byteLength)
  if (data.length < 24 || !data.subarray(0, 8).equals(PNG_SIGNATURE)) return 'no es un PNG válido'
  if (data.subarray(12, 16).toString('ascii') !== 'IHDR') return 'no es un PNG válido'
  if (data.length > PHOTO_MAX_BYTES) return HEAVY_PROBLEM
  const width = data.readUInt32BE(16)
  const height = data.readUInt32BE(20)
  if (width === 0 || height === 0) return 'no es un PNG válido'
  if (width + height > PHOTO_MAX_SIDES) return 'el ancho más el alto pasan de 10 000 px'
  if (Math.max(width / height, height / width) > PHOTO_MAX_RATIO) return 'la proporción pasa de 20'
  return undefined
}

/**
 * Cuerpo multipart/form-data hecho a mano, con los campos de texto y un fichero. No se usa el
 * `FormData` de Node porque al enviarlo cambia los saltos de línea de los campos por CRLF (lo pide
 * la especificación de los formularios), y el pie tiene que llegar tal cual.
 */
export function multipart(fields, file) {
  const CRLF = '\r\n'
  const boundary = `----vigia-${randomUUID()}`
  const quote = (value) => String(value).replace(/["\r\n]/g, (c) => encodeURIComponent(c))
  const chunks = []
  for (const [name, value] of fields)
    chunks.push(
      Buffer.from(
        `--${boundary}${CRLF}Content-Disposition: form-data; name="${quote(name)}"${CRLF}${CRLF}${value}${CRLF}`,
        'utf8'
      )
    )
  chunks.push(
    Buffer.from(
      `--${boundary}${CRLF}Content-Disposition: form-data; name="${quote(file.name)}"; ` +
        `filename="${quote(file.filename)}"${CRLF}Content-Type: ${file.type}${CRLF}${CRLF}`,
      'utf8'
    ),
    Buffer.from(file.data),
    Buffer.from(`${CRLF}--${boundary}--${CRLF}`, 'utf8')
  )
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` }
}

/**
 * Envía una foto con sendPhoto (multipart/form-data con `multipart`, y `fetch`). Con
 * `threadId`, al hilo (message_thread_id); `replyTo` es el mensaje al que responde (el que abre el
 * hilo, la primera parte o el aviso anterior de la ficha, 0106). Con `allowWithoutReply`, llega
 * aunque ese mensaje se haya borrado. No lanza: devuelve { ok: true, messageId } o { ok: false,
 * error, rejected }, con el error ya filtrado.
 */
export async function sendTelegramPhoto({
  token,
  chatId,
  threadId,
  replyTo,
  allowWithoutReply = false,
  photo,
  caption,
  fetchImpl
}) {
  const clean = (value) => redact(value, [token, chatId, threadId])
  const fields = [['chat_id', String(chatId)]]
  if (threadId !== undefined) fields.push(['message_thread_id', String(threadId)])
  if (replyTo !== undefined)
    fields.push([
      'reply_parameters',
      JSON.stringify({ message_id: replyTo, allow_sending_without_reply: allowWithoutReply })
    ])
  fields.push(['caption', caption], ['parse_mode', 'HTML'])
  const { body: form, contentType } = multipart(fields, {
    name: 'photo',
    filename: 'aviso.png',
    type: 'image/png',
    data: photo
  })
  try {
    const response = await fetchImpl(`https://api.telegram.org/bot${token}/sendPhoto`, {
      method: 'POST',
      headers: { 'content-type': contentType },
      body: form,
      signal: AbortSignal.timeout(PHOTO_TIMEOUT_MS)
    })
    let body
    try {
      body = await response.json()
    } catch {
      body = undefined
    }
    if (response.status === 200 && body?.ok === true)
      return { ok: true, messageId: body.result?.message_id }
    const description = typeof body?.description === 'string' ? `: ${body.description}` : ''
    return { ok: false, rejected: true, error: clean(`HTTP ${response.status}${description}`) }
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError')
      return { ok: false, error: `tiempo agotado (${PHOTO_TIMEOUT_MS / 1000} s)` }
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: clean(`error de red: ${message.split('\n')[0]}`) }
  }
}

/**
 * Captura la tarjeta con el Electron del proyecto (telegram-capture.cjs) y devuelve sus PNG en
 * orden. Escribe el HTML en una carpeta temporal y la borra al acabar. Con `signal` (el tiempo
 * máximo de `main`), mata el proceso. Rechaza si falta Electron o la captura falla.
 */
export async function captureWithElectron(html, { signal } = {}) {
  const electron = createRequire(import.meta.url)('electron')
  if (typeof electron !== 'string') throw new Error('no se encuentra el binario de Electron')
  const dir = mkdtempSync(join(tmpdir(), 'vigia-aviso-'))
  try {
    const file = join(dir, 'tarjeta.html')
    const out = join(dir, 'partes')
    writeFileSync(file, html)
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    await new Promise((resolve, reject) => {
      const child = spawn(electron, [CAPTURE_SCRIPT, '--html', file, '--out', out], {
        env,
        stdio: ['ignore', 'ignore', 'pipe'],
        windowsHide: true
      })
      let stderr = ''
      child.stderr.on('data', (data) => {
        if (stderr.length < 4000) stderr += data.toString()
      })
      const abort = () => child.kill()
      signal?.addEventListener('abort', abort, { once: true })
      child.on('error', (error) => {
        signal?.removeEventListener('abort', abort)
        reject(error)
      })
      child.on('close', (code) => {
        signal?.removeEventListener('abort', abort)
        // Solo la línea del script de captura, no lo que Chromium escribe en stderr.
        const reason = /\[captura\] (.*)/.exec(stderr)?.[1] ?? `salida ${code}`
        if (code === 0) resolve()
        else reject(new Error(`la captura ha fallado (${reason})`))
      })
    })
    const number = (name) => Number(/(\d+)/.exec(name)?.[1] ?? NaN)
    const names = readdirSync(out)
      .filter((name) => /^parte-\d+\.png$/.test(name))
      .sort((a, b) => number(a) - number(b))
    if (names.length === 0) throw new Error('la captura no ha dejado ninguna imagen')
    const parts = names.map((name) => readFileSync(join(out, name)))
    // Qué evidencias lleva cada parte (0108); si falta o está mal, captureWithEvidence lo supone.
    try {
      parts.evidences = JSON.parse(readFileSync(join(out, 'partes.json'), 'utf8'))
    } catch {
      // Sin mapa.
    }
    return parts
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** `promise`, o un rechazo si tarda más de `ms` (y entonces se aborta `controller`). */
function withTimeout(promise, ms, controller) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new Error(`tiempo agotado (${Math.round(ms / 100) / 10} s)`))
    }, ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/** Tipos (`kind`) de los valores del .env que aparecen en el texto, sin mayúsculas. */
export function checkTenantLeftovers(value, needles) {
  const lower = String(value).toLowerCase()
  const kinds = new Set()
  for (const needle of needles) if (lower.includes(needle.value)) kinds.add(needle.kind)
  return [...kinds]
}

/** Los campos del aviso tal como llegan, sin recortar (para el filtro del tenant). */
function fieldValues(datos) {
  return [
    'ficha',
    'titulo',
    'version',
    'estado',
    'resumen',
    'rondas',
    'verifier',
    'ci',
    'decision',
    'duracion',
    'rama',
    'pr',
    'origen'
  ]
    .map((key) => text(datos[key]))
    .filter((value) => value !== '')
}

/** Sustituye por *** el token (entero y su parte secreta), el chat_id y el id del hilo. */
export function redact(value, secrets) {
  let result = String(value)
  const parts = []
  for (const secret of secrets) {
    const s = text(secret)
    if (!s) continue
    parts.push(s)
    const colon = s.indexOf(':')
    if (colon >= 0 && s.length - colon > 4) parts.push(s.slice(colon + 1))
  }
  parts.sort((a, b) => b.length - a.length)
  for (const part of parts) result = result.split(part).join('***')
  return result
}

/** El id del hilo si es un entero positivo (solo dígitos); si no, undefined. */
export function parseThreadId(value) {
  const s = text(value)
  if (!/^\d+$/.test(s)) return undefined
  const id = Number(s)
  return Number.isSafeInteger(id) && id > 0 ? id : undefined
}

/**
 * Envía el texto con sendMessage de la Bot API. Con `threadId`, al hilo: con
 * message_thread_id y como respuesta al mensaje que lo abre (el grupo no es un
 * foro; solo con message_thread_id cae en el chat principal). Con `replyTo` (el
 * aviso anterior de la misma ficha, 0106), responde a ese mensaje en vez de al que
 * abre el hilo, y llega aunque se haya borrado. No lanza: devuelve
 * { ok: true, messageId } o { ok: false, error, rejected }, con el error ya filtrado;
 * `rejected` dice si fue Telegram quien respondió con un error.
 */
export async function sendTelegram({ token, chatId, threadId, replyTo, text: message, fetchImpl }) {
  const clean = (value) => redact(value, [token, chatId, threadId])
  const thread = threadId === undefined ? {} : { message_thread_id: threadId }
  if (replyTo !== undefined)
    thread.reply_parameters = { message_id: replyTo, allow_sending_without_reply: true }
  else if (threadId !== undefined)
    thread.reply_parameters = { message_id: threadId, allow_sending_without_reply: false }
  try {
    const response = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        ...thread,
        text: message,
        link_preview_options: { is_disabled: true }
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
    let body
    try {
      body = await response.json()
    } catch {
      body = undefined
    }
    if (response.status === 200 && body?.ok === true)
      return { ok: true, messageId: body.result?.message_id }
    const description = typeof body?.description === 'string' ? `: ${body.description}` : ''
    return { ok: false, rejected: true, error: clean(`HTTP ${response.status}${description}`) }
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError')
      return { ok: false, error: `tiempo agotado (${TIMEOUT_MS / 1000} s)` }
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: clean(`error de red: ${message.split('\n')[0]}`) }
  }
}

// --- Aviso anterior de la misma ficha (ficha 0106) ---

/** Fichero de los avisos enviados, en la carpeta común de git. */
export const REPLIES_FILE = 'vigia-telegram-avisos.json'
/** Entradas que se guardan como mucho: las de message_id más alto, que son las más recientes. */
export const REPLIES_MAX = 200

/**
 * Ruta absoluta de `git rev-parse --git-common-dir` desde `cwd`: la carpeta .git del checkout
 * principal, también desde un worktree. undefined si git falla. No lanza.
 */
export function resolveGitCommonDir(cwd) {
  try {
    const output = execFileSync('git', ['rev-parse', '--git-common-dir'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true
    }).trim()
    return output ? resolve(cwd, output) : undefined
  } catch {
    return undefined
  }
}

/** Clave del aviso en el fichero: la ficha, o «v» y la versión; undefined si no tiene. */
function replyKey(datos) {
  if (datos.tipo === 'version') {
    const version = text(datos.version).replace(/^v+/i, '')
    return version ? `v${version}` : undefined
  }
  return text(datos.ficha) || undefined
}

function isMessageId(value) {
  return Number.isSafeInteger(value) && value > 0
}

/**
 * Lee el fichero de los avisos. Devuelve { entries } (vacío y con `missing` si no existe) o, si
 * no se puede leer o no tiene la forma { clave: message_id }, { entries: {}, problem }. No lanza.
 */
export function readReplies(dir) {
  let raw
  try {
    raw = readFileSync(join(dir, REPLIES_FILE), 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return { entries: {}, missing: true }
    return { entries: {}, problem: `no se puede leer (${error?.code ?? 'error'})` }
  }
  let data
  try {
    data = JSON.parse(raw)
  } catch {
    return { entries: {}, problem: 'no es un JSON válido' }
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data))
    return { entries: {}, problem: 'no es un objeto' }
  if (!Object.values(data).every(isMessageId))
    return { entries: {}, problem: 'tiene valores que no son un message_id' }
  return { entries: data }
}

/**
 * Guarda `messageId` como el último aviso de `key` y deja las REPLIES_MAX entradas más recientes.
 * Vuelve a leer el fichero (otro worktree puede haberlo cambiado) y lo reescribe de una vez
 * (fichero temporal y rename). Devuelve el problema, o undefined si se ha guardado. No lanza.
 */
export function saveReply(dir, key, messageId) {
  const { entries } = readReplies(dir)
  // Las más antiguas fuera: los message_id de un chat crecen con el tiempo. No se usa el orden de
  // las claves, porque JavaScript pone delante las que parecen números (una ficha «1000»).
  const kept = Object.entries({ ...entries, [key]: messageId })
    .sort((a, b) => b[1] - a[1])
    .slice(0, REPLIES_MAX)
    .sort((a, b) => a[1] - b[1])
  const file = join(dir, REPLIES_FILE)
  const tmp = `${file}.${process.pid}.tmp`
  try {
    writeFileSync(tmp, `${JSON.stringify(Object.fromEntries(kept), null, 2)}\n`)
    renameSync(tmp, file)
    return undefined
  } catch (error) {
    try {
      unlinkSync(tmp)
    } catch {
      // Si no llegó a crearse, no hay nada que borrar.
    }
    return `no se puede escribir (${error?.code ?? 'error'})`
  }
}

async function credential(name, deps) {
  const fromEnv = text(deps.env[name])
  if (fromEnv) return fromEnv
  if (deps.platform !== 'win32') return ''
  try {
    return text(await deps.readRegistry(name))
  } catch {
    return ''
  }
}

function readInput(path) {
  const datos = JSON.parse(readFileSync(path, 'utf8'))
  if (datos === null || typeof datos !== 'object' || Array.isArray(datos))
    throw new Error('no es un objeto JSON')
  if (datos.tipo !== 'tarea' && datos.tipo !== 'version')
    throw new Error('el campo tipo tiene que ser "tarea" o "version"')
  return datos
}

/** Une las piezas. Siempre devuelve 0: el aviso nunca para el flujo. */
export async function main(argv, deps) {
  const secrets = []
  const warn = (message) => deps.stderr(redact(`${PREFIX} ${message}`, secrets))
  const info = (message) => deps.stdout(redact(`${PREFIX} ${message}`, secrets))
  try {
    const path = argv[0]
    if (!path) {
      warn('falta la ruta del JSON del aviso: no se envía.')
      return 0
    }
    let datos
    try {
      datos = readInput(path)
    } catch (error) {
      const reason = error instanceof Error ? error.message.split('\n')[0] : String(error)
      warn(`no se ha podido leer el JSON del aviso (${reason}): no se envía.`)
      return 0
    }

    const token = await credential(TOKEN_VAR, deps)
    const chatId = await credential(CHAT_VAR, deps)
    const threadRaw = await credential(THREAD_VAR, deps)
    const threadId = threadRaw ? parseThreadId(threadRaw) : undefined
    secrets.push(token, chatId)
    // Solo el id válido: un valor inválido no se usa ni se imprime, y taparlo
    // (un «0», por ejemplo) estropearía el resto de la salida.
    if (threadId !== undefined) secrets.push(String(threadId), threadRaw)
    if (!token || !chatId) {
      warn(`sin ${TOKEN_VAR} o ${CHAT_VAR}: no se envía.`)
      return 0
    }

    // Evidencias (0108): solo en el aviso de hecha; se leen antes del filtro del tenant.
    let evidence
    if (text(datos.evidencias)) {
      if (datos.tipo === 'tarea' && text(datos.estado) === 'hecha')
        evidence = loadEvidence(text(datos.evidencias), { cwd: deps.cwd, warn })
      else warn('las evidencias solo van en el aviso de hecha: se ignoran.')
    }

    const message = buildMessage(datos)
    // La ficha se busca primero en la carpeta desde la que se lanza (el worktree).
    const caption = buildCaption(datos, {
      taskDirs: [join(deps.cwd, 'tasks'), ...DEFAULT_TASK_DIRS]
    })

    // Sin deps.mainCheckout, findLiveEnv pregunta a git por el checkout principal.
    const envFile = findLiveEnv(deps.cwd, { mainCheckout: deps.mainCheckout })
    const needles = envFile ? extractNeedles(readFileSync(envFile, 'utf8')) : []
    if (needles.length === 0) {
      // Sin valores con los que filtrar, no se envía (ficha 0092), salvo que se pida
      // expresamente con VIGIA_TELEGRAM_UNFILTERED=1 (un clon sin tenant de pruebas). Se lee
      // como las credenciales: del entorno o, en Windows, del registro (lo deja `setx`).
      if ((await credential(UNFILTERED_VAR, deps)) !== '1') {
        warn(
          `sin ${LIVE_ENV_FILE} con valores: no se envía (con ${UNFILTERED_VAR}=1 se envía sin filtrar).`
        )
        return 0
      }
      warn(`sin ${LIVE_ENV_FILE} con valores y con ${UNFILTERED_VAR}=1: se envía sin filtrar.`)
    } else {
      // Sobre el mensaje y sobre los campos completos: el recorte a 1 500
      // caracteres podría partir un valor y dejarlo pasar a medias.
      // También el pie de la imagen; la tarjeta sale de los mismos campos.
      const kinds = checkTenantLeftovers(
        [message, caption, ...fieldValues(datos), ...evidenceTexts(evidence)].join('\n'),
        needles
      )
      if (kinds.length > 0) {
        warn(`el texto lleva restos del tenant (${kinds.join(', ')}): no se envía.`)
        return 0
      }
    }

    if (threadRaw && threadId === undefined)
      warn(`${THREAD_VAR} no es un entero positivo: se envía sin hilo.`)

    // El aviso anterior de la misma ficha (0106). Sin deps.gitCommonDir, ni se lee ni se guarda.
    const key = replyKey(datos)
    const repliesDir =
      key && typeof deps.gitCommonDir === 'function' ? text(deps.gitCommonDir()) : ''
    let previous
    if (repliesDir) {
      const read = readReplies(repliesDir)
      if (read.problem)
        warn(`el registro de avisos ${read.problem}: se envía como el primero de la ficha.`)
      else if (read.missing) info('aún no hay registro de avisos: se envía como el primero.')
      const id = Object.hasOwn(read.entries, key) ? read.entries[key] : undefined
      previous = isMessageId(id) ? id : undefined
    }
    const remember = (messageId) => {
      if (!repliesDir || !isMessageId(messageId)) return
      const problem = saveReply(repliesDir, key, messageId)
      if (problem) warn(`el registro de avisos ${problem}: el siguiente no responderá a este.`)
    }

    // Imagen primero (0105); el texto de siempre, de respaldo. Con VIGIA_TELEGRAM_TEXTO=1 o sin
    // `deps.capture`, solo el texto.
    const textOnly = (await credential(TEXT_ONLY_VAR, deps)) === '1'
    if (!textOnly && typeof deps.capture === 'function') {
      const sent = await sendImage({
        datos,
        caption,
        token,
        chatId,
        threadId,
        previous,
        evidence,
        deps,
        warn,
        info
      })
      if (sent) {
        remember(sent.messageId)
        return 0
      }
    }

    const send = (thread, replyTo) =>
      sendTelegram({
        token,
        chatId,
        threadId: thread,
        replyTo,
        text: message,
        fetchImpl: deps.fetchImpl
      })
    let result = await send(threadId, previous)
    if (!result.ok && result.rejected && threadId !== undefined) {
      // El aviso tiene que llegar (Dani, 2026-10-12): una sola vez más, sin hilo ni respuesta.
      warn(`Telegram ha rechazado el envío al hilo (${result.error}): se reintenta sin hilo.`)
      result = await send(undefined, undefined)
      if (result.ok) {
        info('enviado sin hilo.')
        remember(result.messageId)
      } else warn(`no se ha podido enviar sin hilo (${result.error}); el flujo sigue.`)
      return 0
    }
    if (result.ok) {
      info('enviado.')
      remember(result.messageId)
    } else warn(`no se ha podido enviar (${result.error}); el flujo sigue.`)
    return 0
  } catch (error) {
    const reason = error instanceof Error ? error.message.split('\n')[0] : String(error)
    warn(`error inesperado (${reason}); el flujo sigue.`)
    return 0
  }
}

/**
 * Captura la tarjeta y la envía con sendPhoto, en partes si hace falta. La primera parte responde
 * a `previous` (el aviso anterior de la ficha, 0106) o, sin él, al que abre el hilo. Devuelve
 * { messageId } (el de la primera parte) si la primera parte ha llegado (las demás, si fallan,
 * solo se dicen en la terminal) y false si hay que enviar el texto de siempre (lo que ha fallado
 * ya se ha dicho con `warn`).
 */
async function sendImage({
  datos,
  caption,
  token,
  chatId,
  threadId,
  previous,
  evidence,
  deps,
  warn,
  info
}) {
  let parts
  try {
    const { buildCardHtml } = await import('./telegram-card.mjs')
    const ms = deps.captureTimeoutMs ?? CAPTURE_TIMEOUT_MS
    // Cada captura con su tiempo máximo; con evidencias, puede haber más de una (0108).
    const shoot = async (html) => {
      const controller = new AbortController()
      const shot = await withTimeout(
        Promise.resolve().then(() => deps.capture(html, { signal: controller.signal })),
        ms,
        controller
      )
      if (!Array.isArray(shot) || shot.length === 0) throw new Error('no ha dado ninguna imagen')
      return shot
    }
    parts = await captureWithEvidence({
      evidence,
      render: (evidencias) => buildCardHtml(datos, evidencias ? { evidencias } : undefined),
      shoot,
      isHeavy: (part) => photoProblem(part) === HEAVY_PROBLEM,
      warn
    })
  } catch (error) {
    const reason = error instanceof Error ? error.message.split('\n')[0] : String(error)
    warn(`no se ha podido capturar la imagen (${reason}): se envía el texto.`)
    return false
  }
  for (const [i, part] of parts.entries()) {
    const problem = photoProblem(part)
    if (problem) {
      warn(`la imagen ${i + 1} no vale para Telegram (${problem}): se envía el texto.`)
      return false
    }
  }

  const total = parts.length
  const send = (photo, partCaption, thread, replyTo, allowWithoutReply = false) =>
    sendTelegramPhoto({
      token,
      chatId,
      threadId: thread,
      replyTo,
      allowWithoutReply,
      photo,
      caption: partCaption,
      fetchImpl: deps.fetchImpl
    })
  let thread = threadId
  let first = await send(parts[0], caption, thread, previous ?? thread, previous !== undefined)
  if (!first.ok && first.rejected && thread !== undefined) {
    // Como con el texto (0103): una sola vez más, sin hilo.
    warn(`Telegram ha rechazado la imagen en el hilo (${first.error}): se reintenta sin hilo.`)
    thread = undefined
    first = await send(parts[0], caption, undefined, undefined)
  }
  if (!first.ok) {
    warn(`no se ha podido enviar la imagen (${first.error}): se envía el texto.`)
    return false
  }
  // Las demás partes, como respuesta a la primera y en orden; si una falla, se sigue.
  const replyTo = Number.isSafeInteger(first.messageId) ? first.messageId : thread
  let failed = 0
  for (let i = 1; i < total; i++) {
    const result = await send(parts[i], buildPartCaption(datos, i + 1, total), thread, replyTo)
    if (!result.ok) {
      failed++
      warn(`no se ha podido enviar la parte ${i + 1}/${total} (${result.error}); se sigue.`)
    }
  }
  const how = total === 1 ? 'como imagen' : `como imagen en ${total} partes`
  const where = thread === threadId ? '' : ' sin hilo'
  info(`enviado ${how}${where}${failed ? ` (${failed} sin enviar)` : ''}.`)
  return { messageId: first.messageId }
}

/**
 * Valor de una variable de usuario de Windows (`setx` no llega a los procesos
 * ya abiertos). Ejecuta reg.exe por su ruta absoluta (%SystemRoot%\System32),
 * nunca por nombre, con los argumentos en array y sin shell. No lanza.
 */
export function readRegistry(name, { execFile = execFileSync, env = process.env } = {}) {
  const systemRoot = text(env.SystemRoot ?? env.SYSTEMROOT ?? env.windir)
  if (!systemRoot) return undefined
  try {
    const regExe = win32.join(systemRoot, 'System32', 'reg.exe')
    const output = execFile(regExe, ['query', 'HKCU\\Environment', '/v', name], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
      shell: false
    })
    const line = output.split(/\r?\n/).find((l) => l.trim().startsWith(`${name} `))
    const match = line && /\sREG_(?:EXPAND_)?SZ\s+(.*)$/.exec(line)
    return match ? match[1].trim() : undefined
  } catch {
    return undefined
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2), {
    env: process.env,
    platform: process.platform,
    readRegistry,
    cwd: process.cwd(),
    fetchImpl: (url, init) => fetch(url, init),
    stdout: (message) => process.stdout.write(`${message}\n`),
    stderr: (message) => process.stderr.write(`${message}\n`),
    capture: captureWithElectron,
    gitCommonDir: () => resolveGitCommonDir(process.cwd())
  })
}
