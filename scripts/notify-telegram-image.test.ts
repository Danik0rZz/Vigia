import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { deflateSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Aviso de Telegram en imagen, con pie de texto (ficha 0105): el pie, el envío con `sendPhoto`, el
 * respaldo de texto, el filtro del tenant, las partes y el texto de `tarea.md` y
 * `cerrar-version.md`. Sin red ni navegador: `fetchImpl` y la captura van simulados. La captura
 * con Electron de verdad (CA6, CA7 y CA9) está en `telegram-capture.test.ts`.
 *
 * Contrato que fijan estos tests (la ficha no lo detallaba):
 * - `scripts/notify-telegram.mjs` exporta `buildCaption(datos)`, que devuelve el pie (string) con
 *   una línea por dato, separadas por `\n`.
 * - `main(argv, deps)` acepta, además de lo de la 0004 y la 0103:
 *   - `deps.capture(html)`: recibe el HTML de `buildCardHtml(datos)` (0104) y devuelve (promesa)
 *     la lista de PNG de la tarjeta, en orden, como `Uint8Array` (o `Buffer`); si falla, la
 *     promesa se rechaza. Sin `deps.capture` (los tests de la 0004 y la 0103), no hay imagen y se
 *     envía el texto de siempre. La entrada de la línea de órdenes pasa la captura con Electron.
 *   - `deps.captureTimeoutMs`: el tiempo máximo de la captura, en milisegundos (para no esperar
 *     el de verdad en los tests).
 * - Las peticiones a `sendPhoto` se leen con `new Request(url, init)`: da igual si el cuerpo es
 *   un `FormData` o un multipart hecho a mano, mientras la cabecera sea `multipart/form-data`.
 *   `reply_parameters` va como JSON (así lo pide la Bot API en multipart).
 * - El repositorio de los enlaces es `https://github.com/Danik0rZz/Vigia` (el público). La ficha
 *   enlaza a `…/blob/<rama o main>/tasks/<NNNN>…` (el nombre completo del fichero lo decide el
 *   developer).
 */

const SCRIPT = join(__dirname, 'notify-telegram.mjs')
const ROOT = join(__dirname, '..')

type Datos = {
  tipo: 'tarea' | 'version'
  ficha?: string
  version?: string
  titulo: string
  estado: string
  resumen?: string
  rondas?: number
  verifier?: string
  ci?: string
  decision?: string
  duracion?: string
  rama?: string
  pr?: string
}
type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>
type Deps = {
  env: Record<string, string | undefined>
  platform: string
  readRegistry: (name: string) => string | undefined
  cwd: string
  mainCheckout: () => string | undefined
  fetchImpl: FetchImpl
  stdout: (text: string) => void
  stderr: (text: string) => void
  capture?: (html: string) => Promise<Uint8Array[]>
  captureTimeoutMs?: number
}
type Api = {
  buildCaption: (datos: Datos) => string
  buildMessage: (datos: Datos) => string
  main: (argv: string[], deps: Deps) => number | Promise<number>
}

const loaded = existsSync(SCRIPT) ? ((await import(pathToFileURL(SCRIPT).href)) as Api) : undefined
// El script importa la tarjeta (0104) solo cuando hay que capturar, y esa primera carga (React,
// react-markdown, highlight.js…) tarda segundos: se la llevaba el primer test que envía la foto
// (CA3), que con la máquina cargada pasaba de los 5 s de Vitest. Se precarga aquí, al cargar el
// fichero, fuera del tiempo de cada test; el script reutiliza el mismo módulo ya cargado.
const CARD = join(__dirname, 'telegram-card.mjs')
if (existsSync(CARD)) await import(pathToFileURL(CARD).href)
function api(): Api {
  if (!loaded) throw new Error('No existe scripts/notify-telegram.mjs')
  return loaded
}
function buildCaption(datos: Datos): string {
  if (typeof api().buildCaption !== 'function')
    throw new Error('notify-telegram.mjs no exporta buildCaption (ficha 0105)')
  return api().buildCaption(datos)
}

// Credenciales inventadas con la forma de las reales (como en notify-telegram.test.ts).
const TOKEN = '123456789:AAFakeTokenInventado_XYZ-abc987'
const CHAT_ID = '987650001234'
const THREAD_ID = '48151'
const ENV = { VIGIA_TELEGRAM_TOKEN: TOKEN, VIGIA_TELEGRAM_CHAT_ID: CHAT_ID }

// .env de pruebas inventado (como en scan-tenant.test.ts).
const HOST = 'zz99fake.live.dynatrace.com'
const ENV_LIVE = ['# comentario', `DT_URL=https://${HOST}`, 'CORTO=abc', ''].join('\n')
const ENV_UNRELATED = 'DT_URL=https://qq11nadaquever.example.invalid\n'

const REPO = 'https://github.com/Danik0rZz/Vigia'
const PR_URL = `${REPO}/pull/31`
const CI_URL = `${REPO}/actions/runs/1234567890`
const RAMA = 'feat/0105-telegram-aviso-en-imagen'
const AHORA = new Date('2026-10-12T10:30:00+02:00')

function tarea(overrides: Partial<Datos> = {}): Datos {
  return {
    tipo: 'tarea',
    ficha: '0105',
    titulo: 'Aviso en imagen',
    estado: 'hecha',
    resumen: '## Qué cambia\n\nEl aviso sale como imagen.',
    rondas: 1,
    verifier: 'VERDE',
    ci: CI_URL,
    decision: '',
    duracion: '1 h 20 min',
    rama: RAMA,
    pr: PR_URL,
    ...overrides
  }
}

// --- PNG de prueba (válidos: firma, IHDR, IDAT e IEND, en escala de grises) ---

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(buffer: Buffer): number {
  let c = 0xffffffff
  for (const byte of buffer) c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}
function png(width: number, height: number, shade = 0): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // profundidad
  ihdr[9] = 0 // escala de grises
  const row = Buffer.alloc(width + 1, shade)
  row[0] = 0 // sin filtro
  const raw = Buffer.concat(Array.from({ length: height }, () => row))
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

// --- Telegram simulado: guarda cada petición ya leída ---

type Call = {
  method: string
  url: string
  contentType: string
  form?: FormData
  json?: Record<string, unknown>
}

function telegramOk(messageId: number): Response {
  return new Response(JSON.stringify({ ok: true, result: { message_id: messageId } }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })
}
function telegramError(description = 'Bad Request: wrong file'): Response {
  return new Response(JSON.stringify({ ok: false, error_code: 400, description }), {
    status: 400,
    headers: { 'content-type': 'application/json' }
  })
}

/** `respond(method, n)`: respuesta a la llamada n (desde 0) a ese método. */
function telegram(respond?: (method: string, n: number) => Response): {
  fetchImpl: FetchImpl
  calls: Call[]
} {
  const calls: Call[] = []
  const counts: Record<string, number> = {}
  const fetchImpl: FetchImpl = async (url, init) => {
    const request = new Request(url, init)
    const method = String(url).split('/').pop() ?? ''
    const contentType = request.headers.get('content-type') ?? ''
    const call: Call = { method, url: String(url), contentType }
    if (contentType.startsWith('multipart/form-data')) call.form = await request.formData()
    else call.json = JSON.parse(await request.text()) as Record<string, unknown>
    calls.push(call)
    const n = counts[method] ?? 0
    counts[method] = n + 1
    return respond ? respond(method, n) : telegramOk(7000 + calls.length)
  }
  return { fetchImpl, calls }
}

let dirs: string[] = []
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'vigia-telegram-img-'))
  dirs.push(dir)
  return dir
}

beforeEach(() => {
  dirs = []
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(AHORA)
  vi.stubEnv('VIGIA_TELEGRAM_TOKEN', undefined)
  vi.stubEnv('VIGIA_TELEGRAM_CHAT_ID', undefined)
  vi.stubEnv('VIGIA_TELEGRAM_THREAD_ID', undefined)
  vi.stubEnv('VIGIA_TELEGRAM_TEXTO', undefined)
  // Red de seguridad: si el script ignorase fetchImpl, no saldría a la red.
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new Error('fetch global no permitido en tests')))
  )
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

type RunOptions = {
  datos?: Datos
  env?: Record<string, string | undefined>
  cwdEnv?: string
  capture?: (html: string) => Promise<Uint8Array[]>
  captureTimeoutMs?: number
  respond?: (method: string, n: number) => Response
}

async function run(options: RunOptions = {}): Promise<{
  code: unknown
  calls: Call[]
  capture: ReturnType<typeof vi.fn>
  stderr: string
}> {
  const cwd = tempDir()
  writeFileSync(join(cwd, '.env.live.local'), options.cwdEnv ?? ENV_UNRELATED)
  const main = tempDir()
  const input = join(tempDir(), 'aviso.json')
  writeFileSync(input, JSON.stringify(options.datos ?? tarea()))
  const { fetchImpl, calls } = telegram(options.respond)
  const capture = vi.fn(options.capture ?? (() => Promise.resolve([png(1600, 900)])))
  const stderr: string[] = []
  const deps: Deps = {
    env: options.env ?? ENV,
    platform: 'win32',
    readRegistry: () => undefined,
    cwd,
    mainCheckout: () => main,
    fetchImpl,
    stdout: () => undefined,
    stderr: (text) => void stderr.push(String(text)),
    capture: capture as unknown as (html: string) => Promise<Uint8Array[]>
  }
  if (options.captureTimeoutMs !== undefined) deps.captureTimeoutMs = options.captureTimeoutMs
  const code = await api().main([input], deps)
  return { code, calls, capture, stderr: stderr.join('\n') }
}

function captionLines(caption: string): string[] {
  return caption.split('\n').filter((line) => line.trim() !== '')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
}

/** Texto del HTML de Telegram sin entidades (las con nombre que admite y las numéricas). */
function decodeEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
}

/** Los `href` de los enlaces del pie. */
function hrefs(caption: string): string[] {
  return [...caption.matchAll(/<a\s+href="([^"]*)"/g)].map((m) => decodeEntities(m[1] ?? ''))
}

async function photoBytes(form: FormData | undefined): Promise<Buffer> {
  const photo = form?.get('photo')
  expect(photo).toBeInstanceOf(Blob)
  return Buffer.from(await (photo as Blob).arrayBuffer())
}

function replyTo(form: FormData | undefined): unknown {
  const raw = form?.get('reply_parameters')
  if (typeof raw !== 'string') return undefined
  return (JSON.parse(raw) as { message_id?: unknown }).message_id
}

describe('CA1 (0105): buildCaption da las líneas del pie', () => {
  it('CA1 (0105): tarea con rama, PR y CI: Estado, Título, Tarea, Ficha, PR y CI, en ese orden', () => {
    const lines = captionLines(buildCaption(tarea()))
    expect(lines).toHaveLength(6)
    expect(lines[0]).toBe('<b>Estado:</b> ✅ OK')
    expect(lines[1]).toBe('<b>Título:</b> <b><u>Aviso en imagen</u></b>')
    expect(lines[2]).toBe('<b>Tarea:</b> 0105')
    expect(lines[3]).toMatch(
      new RegExp(
        `^<b>Ficha:</b> <a href="${escapeRegExp(`${REPO}/blob/${RAMA}/tasks/0105`)}[^"]*">[^<]+</a>$`
      )
    )
    expect(lines[4]).toMatch(new RegExp(`^<b>PR:</b> <a href="${escapeRegExp(PR_URL)}">[^<]+</a>$`))
    expect(lines[5]).toMatch(new RegExp(`^<b>CI:</b> <a href="${escapeRegExp(CI_URL)}">[^<]+</a>$`))
  })

  it.each([
    ['hecha', '✅ OK'],
    ['cerrada', '✅ OK'],
    ['bloqueada', '⛔ Bloqueada'],
    ['fallida', '⛔ Bloqueada'],
    ['en_proceso', '🔄 En proceso']
  ])('CA1 (0105): estado %s → «%s»', (estado, label) => {
    expect(captionLines(buildCaption(tarea({ estado })))[0]).toBe(`<b>Estado:</b> ${label}`)
  })

  it('CA1 (0105): estado parada → «⏸️ Pausa, espera a Dani»', () => {
    const first = captionLines(buildCaption(tarea({ estado: 'parada' })))[0] ?? ''
    expect(first.startsWith('<b>Estado:</b> ⏸️ Pausa')).toBe(true)
    expect(first).toContain('espera a Dani')
  })

  it('CA1 (0105): sin pr ni ci, las líneas de PR y CI no salen', () => {
    const caption = buildCaption(tarea({ pr: '', ci: '' }))
    const lines = captionLines(caption)
    expect(lines).toHaveLength(4)
    expect(caption).not.toContain('<b>PR:</b>')
    expect(caption).not.toContain('<b>CI:</b>')
    expect(lines[3]?.startsWith('<b>Ficha:</b> <a href=')).toBe(true)
  })

  it('CA1 (0105): sin rama, la ficha enlaza a main', () => {
    const lines = captionLines(buildCaption(tarea({ rama: '' })))
    const ficha = lines.find((line) => line.startsWith('<b>Ficha:</b>')) ?? ''
    expect(hrefs(ficha)[0]?.startsWith(`${REPO}/blob/main/tasks/0105`)).toBe(true)
  })

  it('CA1 (0105): una versión lleva «Versión: X.Y.Z» en lugar de «Tarea» y no lleva ficha', () => {
    const datos: Datos = {
      tipo: 'version',
      version: '0.12.0',
      titulo: 'Cierre',
      estado: 'cerrada',
      resumen: 'Cierre de versión.',
      rondas: 0,
      verifier: 'VERDE',
      ci: CI_URL,
      decision: ''
    }
    const lines = captionLines(buildCaption(datos))
    expect(lines[0]).toBe('<b>Estado:</b> ✅ OK')
    expect(lines[1]).toBe('<b>Título:</b> <b><u>Cierre</u></b>')
    expect(lines[2]).toBe('<b>Versión:</b> 0.12.0')
    expect(lines.some((line) => line.startsWith('<b>Tarea:</b>'))).toBe(false)
    expect(lines.some((line) => line.startsWith('<b>Ficha:</b>'))).toBe(false)
    expect(lines.at(-1)).toMatch(new RegExp(`^<b>CI:</b> <a href="${escapeRegExp(CI_URL)}">`))
  })
})

describe('CA2 (0105): escapado y enlaces solo al repositorio', () => {
  it('CA2 (0105): un título con <, >, & y comillas sale escapado', () => {
    const titulo = `Menor < mayor > & "dobles" 'simples' <script>`
    const lines = captionLines(buildCaption(tarea({ titulo })))
    const match = /^<b>Título:<\/b> <b><u>(.*)<\/u><\/b>$/.exec(lines[1] ?? '')
    expect(match).not.toBeNull()
    const inner = match?.[1] ?? ''
    expect(inner).not.toMatch(/[<>]/)
    expect(inner).not.toMatch(/&(?!lt;|gt;|amp;|quot;|#\d+;|#x[0-9a-f]+;)/i)
    expect(decodeEntities(inner)).toBe(titulo)
  })

  it('CA2 (0105): las comillas de una URL no rompen el atributo del enlace', () => {
    const caption = buildCaption(
      tarea({ pr: `${REPO}/pull/31" onclick="alert(1)`, rama: 'feat/0105-"x"' })
    )
    expect(caption).not.toContain('onclick="')
    // Todo enlace es <a href="…"> con el valor sin comillas sueltas ni etiquetas dentro.
    for (const anchor of caption.match(/<a\b[^>]*>/g) ?? [])
      expect(anchor).toMatch(/^<a href="[^"<>]*">$/)
  })

  it.each([
    ['otro dominio', 'https://evil.example/Danik0rZz/Vigia/actions/runs/1'],
    ['otro repositorio', 'https://github.com/otro/repo/actions/runs/1'],
    ['un repositorio con el mismo prefijo', 'https://github.com/Danik0rZz/VigiaFalso/pull/1'],
    ['un dominio que empieza igual', 'https://github.com.evil.example/Danik0rZz/Vigia/pull/1'],
    ['http sin s', 'http://github.com/Danik0rZz/Vigia/pull/1'],
    ['javascript:', 'javascript:alert(1)']
  ])('CA2 (0105): una URL de %s en ci o pr no sale como enlace', (_, url) => {
    for (const datos of [tarea({ ci: url }), tarea({ pr: url })]) {
      const caption = buildCaption(datos)
      expect(hrefs(caption)).not.toContain(url)
      for (const href of hrefs(caption)) expect(href.startsWith(`${REPO}/`)).toBe(true)
    }
  })
})

describe('CA3 (0105): sendPhoto con la captura bien', () => {
  it('CA3 (0105): multipart/form-data con chat_id, la foto, el pie y parse_mode HTML', async () => {
    const datos = tarea()
    const foto = png(1600, 900, 40)
    const { code, calls, capture } = await run({ datos, capture: () => Promise.resolve([foto]) })
    expect(code).toBe(0)
    expect(capture).toHaveBeenCalledTimes(1)
    const html = String(capture.mock.calls[0]?.[0])
    expect(html.toLowerCase().startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('Aviso en imagen')
    expect(calls).toHaveLength(1)
    const [call] = calls
    expect(call?.url).toBe(`https://api.telegram.org/bot${TOKEN}/sendPhoto`)
    expect(call?.contentType.startsWith('multipart/form-data')).toBe(true)
    expect(call?.form?.get('chat_id')).toBe(CHAT_ID)
    expect(call?.form?.get('caption')).toBe(buildCaption(datos))
    expect(call?.form?.get('parse_mode')).toBe('HTML')
    expect((await photoBytes(call?.form)).equals(foto)).toBe(true)
    expect(call?.form?.has('message_thread_id')).toBe(false)
  })

  it('CA3 (0105): con VIGIA_TELEGRAM_THREAD_ID, lleva message_thread_id y reply_parameters del hilo', async () => {
    const { code, calls } = await run({ env: { ...ENV, VIGIA_TELEGRAM_THREAD_ID: THREAD_ID } })
    expect(code).toBe(0)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.method).toBe('sendPhoto')
    expect(calls[0]?.form?.get('message_thread_id')).toBe(THREAD_ID)
    expect(replyTo(calls[0]?.form)).toBe(Number(THREAD_ID))
  })
})

describe('CA4 (0105): si falla la imagen, el texto de siempre', () => {
  async function expectTextFallback(options: RunOptions): Promise<Call[]> {
    const datos = options.datos ?? tarea()
    const { code, calls, capture, stderr } = await run({ ...options, datos })
    expect(code).toBe(0)
    // Primero se intenta la imagen; el texto es el respaldo.
    expect(capture).toHaveBeenCalledTimes(1)
    const text = calls.filter((call) => call.method === 'sendMessage')
    expect(text).toHaveLength(1)
    expect(text[0]?.url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`)
    expect(text[0]?.json?.text).toBe(api().buildMessage(datos))
    expect(stderr).toContain('[aviso telegram]')
    return calls
  }

  it('CA4 (0105): la captura falla', async () => {
    const calls = await expectTextFallback({
      capture: () => Promise.reject(new Error('no se encuentra Electron'))
    })
    expect(calls.some((call) => call.method === 'sendPhoto')).toBe(false)
  })

  it('CA4 (0105): la captura tarda más del máximo', async () => {
    const calls = await expectTextFallback({
      capture: () => new Promise<Uint8Array[]>(() => undefined),
      captureTimeoutMs: 50
    })
    expect(calls.some((call) => call.method === 'sendPhoto')).toBe(false)
  }, 10_000)

  it('CA4 (0105): la imagen pasa de 10 MB', async () => {
    const grande = Buffer.concat([png(1600, 900), Buffer.alloc(11 * 1024 * 1024)])
    const calls = await expectTextFallback({ capture: () => Promise.resolve([grande]) })
    expect(calls.some((call) => call.method === 'sendPhoto')).toBe(false)
  })

  it('CA4 (0105): el ancho más el alto pasan de 10 000 px', async () => {
    const calls = await expectTextFallback({ capture: () => Promise.resolve([png(1600, 9000)]) })
    expect(calls.some((call) => call.method === 'sendPhoto')).toBe(false)
  })

  it('CA4 (0105): la proporción pasa de 20', async () => {
    const calls = await expectTextFallback({ capture: () => Promise.resolve([png(100, 2100)]) })
    expect(calls.some((call) => call.method === 'sendPhoto')).toBe(false)
  })

  it('CA4 (0105): sendPhoto responde con error', async () => {
    const calls = await expectTextFallback({
      respond: (method) => (method === 'sendPhoto' ? telegramError() : telegramOk(1))
    })
    expect(calls[0]?.method).toBe('sendPhoto')
    expect(calls.at(-1)?.method).toBe('sendMessage')
  })
})

describe('CA5 (0105): VIGIA_TELEGRAM_TEXTO=1', () => {
  it('CA5 (0105): no se captura nada y se envía el texto', async () => {
    const datos = tarea()
    const { code, calls, capture } = await run({
      datos,
      env: { ...ENV, VIGIA_TELEGRAM_TEXTO: '1' }
    })
    expect(code).toBe(0)
    expect(capture).not.toHaveBeenCalled()
    expect(calls).toHaveLength(1)
    expect(calls[0]?.method).toBe('sendMessage')
    expect(calls[0]?.json?.text).toBe(api().buildMessage(datos))
  })

  it('CA5 (0105): control: sin la variable, sí se captura y se envía la foto', async () => {
    const { calls, capture } = await run({ env: { ...ENV, VIGIA_TELEGRAM_TEXTO: undefined } })
    expect(capture).toHaveBeenCalledTimes(1)
    expect(calls.map((call) => call.method)).toEqual(['sendPhoto'])
  })
})

describe('CA8 (0105): con un hallazgo del filtro del tenant no se captura ni se envía nada', () => {
  it.each([
    ['titulo', { titulo: `Error en ${HOST}` }],
    ['rama', { rama: `feat/${HOST}` }],
    ['pr', { pr: `${REPO}/pull/31?h=${HOST}` }],
    ['duracion', { duracion: `${HOST}` }],
    ['resumen', { resumen: `Visto en https://${HOST}/ui` }]
  ])('CA8 (0105): el valor del tenant en %s', async (_, overrides) => {
    const { code, calls, capture, stderr } = await run({
      datos: tarea(overrides as Partial<Datos>),
      cwdEnv: ENV_LIVE
    })
    expect(code).toBe(0)
    expect(capture).not.toHaveBeenCalled()
    expect(calls).toHaveLength(0)
    expect(stderr).toContain('[aviso telegram]')
    expect(stderr).not.toContain(HOST)
  })
})

describe('CA10 (0105): varias partes', () => {
  const partes = [png(1600, 1000, 10), png(1600, 1200, 20), png(1600, 800, 30)]

  it('CA10 (0105): la primera con el pie entero y las demás como respuesta a ella, con (n/N) y en orden', async () => {
    const datos = tarea()
    const { code, calls } = await run({
      datos,
      capture: () => Promise.resolve(partes),
      respond: (method, n) => (method === 'sendPhoto' ? telegramOk(9100 + n) : telegramOk(1))
    })
    expect(code).toBe(0)
    const photos = calls.filter((call) => call.method === 'sendPhoto')
    expect(photos).toHaveLength(3)
    expect(calls.some((call) => call.method === 'sendMessage')).toBe(false)
    for (const [i, parte] of partes.entries())
      expect((await photoBytes(photos[i]?.form)).equals(parte)).toBe(true)
    expect(String(photos[0]?.form?.get('caption'))).toContain(buildCaption(datos))
    expect(String(photos[1]?.form?.get('caption'))).toContain('(2/3)')
    expect(String(photos[2]?.form?.get('caption'))).toContain('(3/3)')
    // Respuesta al message_id que devolvió Telegram para la primera.
    expect(replyTo(photos[1]?.form)).toBe(9100)
    expect(replyTo(photos[2]?.form)).toBe(9100)
  })

  it('CA10 (0105): si falla una parte que no es la primera, las demás se siguen enviando y se dice en la terminal', async () => {
    const { code, calls, stderr } = await run({
      capture: () => Promise.resolve(partes),
      respond: (method, n) => {
        if (method !== 'sendPhoto') return telegramOk(1)
        return n === 1 ? telegramError() : telegramOk(9200 + n)
      }
    })
    expect(code).toBe(0)
    const photos = calls.filter((call) => call.method === 'sendPhoto')
    expect(photos).toHaveLength(3)
    expect((await photoBytes(photos[2]?.form)).equals(partes[2] as Buffer)).toBe(true)
    expect(String(photos[2]?.form?.get('caption'))).toContain('(3/3)')
    expect(replyTo(photos[2]?.form)).toBe(9200)
    expect(stderr).toContain('[aviso telegram]')
  })
})

describe('CA11 (0105): tarea.md y cerrar-version.md piden el resumen en Markdown con lo relevante', () => {
  /** El párrafo (separado por líneas en blanco) que habla del `resumen` y de Markdown. */
  function resumenParagraph(file: string): string {
    const text = readFileSync(join(ROOT, file), 'utf8')
    const paragraphs = text.split(/\r?\n\s*\r?\n/).map((p) => p.replace(/\s+/g, ' '))
    return paragraphs.find((p) => p.includes('`resumen`') && /markdown/i.test(p)) ?? ''
  }

  it.each(['.claude/commands/tarea.md', '.claude/commands/cerrar-version.md'])(
    'CA11 (0105): %s',
    (file) => {
      const paragraph = resumenParagraph(file)
      expect(paragraph, `${file}: ningún párrafo pide el \`resumen\` en Markdown`).not.toBe('')
      expect(paragraph).toMatch(/qu[eé] cambi/i)
      expect(paragraph).toMatch(/criterios/i)
      expect(paragraph).toMatch(/c[oó]mo se probaron/i)
      expect(paragraph).toMatch(/decisiones/i)
      expect(paragraph).toMatch(/ideas/i)
      expect(paragraph).toMatch(/Dani/)
      expect(paragraph).toMatch(/tenant/i)
      expect(paragraph).toMatch(/clientes/i)
      expect(paragraph).not.toMatch(/en pocas l[ií]neas/i)
    }
  )
})
