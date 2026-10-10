// Aviso por Telegram al terminar /tarea o /cerrar-version (ficha 0004).
//
// Uso: node scripts/notify-telegram.mjs <ruta-a-un-json>
//
// El JSON lo escribe el Orquestador en su scratchpad (campos en la ficha 0004).
// El aviso es opcional: el script SIEMPRE sale con 0 y lo que pasa se dice en
// stderr con el prefijo [aviso telegram]. El token y el chat_id salen de
// VIGIA_TELEGRAM_TOKEN y VIGIA_TELEGRAM_CHAT_ID (del entorno o, en Windows, de
// las variables de usuario del registro) y nunca se imprimen: todo texto pasa
// antes por `redact`. Antes de enviar, el texto se compara con los valores de
// .env.live.local, con las mismas reglas que scan:tenant; si coincide, no se
// envía.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { win32 } from 'node:path'
import { pathToFileURL } from 'node:url'
import { findLiveEnv, LIVE_ENV_FILE } from './lib/env-file.mjs'
import { extractNeedles } from './scan-tenant.mjs'

export const MAX_LENGTH = 1500
const PREFIX = '[aviso telegram]'
const TOKEN_VAR = 'VIGIA_TELEGRAM_TOKEN'
const CHAT_VAR = 'VIGIA_TELEGRAM_CHAT_ID'
const TIMEOUT_MS = 10_000

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

/** Tipos (`kind`) de los valores del .env que aparecen en el texto, sin mayúsculas. */
export function checkTenantLeftovers(value, needles) {
  const lower = String(value).toLowerCase()
  const kinds = new Set()
  for (const needle of needles) if (lower.includes(needle.value)) kinds.add(needle.kind)
  return [...kinds]
}

/** Los campos del aviso tal como llegan, sin recortar (para el filtro del tenant). */
function fieldValues(datos) {
  return ['ficha', 'titulo', 'version', 'estado', 'resumen', 'rondas', 'verifier', 'ci', 'decision']
    .map((key) => text(datos[key]))
    .filter((value) => value !== '')
}

/** Sustituye por *** el token (entero y su parte secreta) y el chat_id. */
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

/**
 * Envía el texto con sendMessage de la Bot API. No lanza: devuelve
 * { ok: true } o { ok: false, error }, con el error ya filtrado.
 */
export async function sendTelegram({ token, chatId, text: message, fetchImpl }) {
  const clean = (value) => redact(value, [token, chatId])
  try {
    const response = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
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
    if (response.status === 200 && body?.ok === true) return { ok: true }
    const description = typeof body?.description === 'string' ? `: ${body.description}` : ''
    return { ok: false, error: clean(`HTTP ${response.status}${description}`) }
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError')
      return { ok: false, error: `tiempo agotado (${TIMEOUT_MS / 1000} s)` }
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: clean(`error de red: ${message.split('\n')[0]}`) }
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
    secrets.push(token, chatId)
    if (!token || !chatId) {
      warn(`sin ${TOKEN_VAR} o ${CHAT_VAR}: no se envía.`)
      return 0
    }

    const message = buildMessage(datos)

    // Sin deps.mainCheckout, findLiveEnv pregunta a git por el checkout principal.
    const envFile = findLiveEnv(deps.cwd, { mainCheckout: deps.mainCheckout })
    const needles = envFile ? extractNeedles(readFileSync(envFile, 'utf8')) : []
    if (needles.length === 0) {
      warn(
        `sin ${LIVE_ENV_FILE} con valores: no se ha podido filtrar el texto; se envía igualmente.`
      )
    } else {
      // Sobre el mensaje y sobre los campos completos: el recorte a 1 500
      // caracteres podría partir un valor y dejarlo pasar a medias.
      const kinds = checkTenantLeftovers([message, ...fieldValues(datos)].join('\n'), needles)
      if (kinds.length > 0) {
        warn(`el texto lleva restos del tenant (${kinds.join(', ')}): no se envía.`)
        return 0
      }
    }

    const result = await sendTelegram({ token, chatId, text: message, fetchImpl: deps.fetchImpl })
    if (result.ok) info('enviado.')
    else warn(`no se ha podido enviar (${result.error}); el flujo sigue.`)
    return 0
  } catch (error) {
    const reason = error instanceof Error ? error.message.split('\n')[0] : String(error)
    warn(`error inesperado (${reason}); el flujo sigue.`)
    return 0
  }
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
    stderr: (message) => process.stderr.write(`${message}\n`)
  })
}
