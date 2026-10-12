import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

/**
 * Aviso por Telegram al terminar /tarea o /cerrar-version (ficha 0004).
 *
 * Todo simulado: `fetch`, el registro de Windows, las variables de entorno y
 * el .env.live.local (con valores inventados, en carpetas temporales). Ningún
 * test hace red ni lee el token real ni el .env real.
 *
 * Contrato que fijan estos tests (la ficha no lo detallaba):
 * - `buildMessage(datos)` devuelve el texto (string).
 * - `checkTenantLeftovers(texto, needles)` devuelve la lista de TIPOS (`kind`)
 *   que coinciden (vacía si no hay nada).
 * - `sendTelegram({ token, chatId, text, fetchImpl })` no lanza: devuelve
 *   `{ ok: true }` o `{ ok: false, error: string }`.
 * - `main(argv, deps)` (síncrona o asíncrona) devuelve 0, con
 *   `deps = { env, platform, readRegistry(nombre), cwd, mainCheckout(), fetchImpl, stdout(texto), stderr(texto) }`:
 *   `env` sustituye a `process.env`; `readRegistry` sustituye a
 *   `reg query HKCU\Environment /v <nombre>` (string o undefined, o su promesa);
 *   `cwd` es el directorio donde se busca primero `.env.live.local`;
 *   `mainCheckout()` devuelve la ruta del checkout principal (primera entrada de
 *   `git worktree list`) o undefined; `stdout` y `stderr` escriben en la terminal.
 *   `argv[0]` es la ruta (absoluta en los tests) del JSON de entrada.
 */

const SCRIPT = join(__dirname, 'notify-telegram.mjs')
const ROOT = join(__dirname, '..')

type Datos = {
  tipo: 'tarea' | 'version'
  ficha?: string
  titulo: string
  version?: string
  estado: string
  resumen: string
  rondas: number
  verifier: string
  ci: string
  decision: string
}
type Needle = { kind: string; value: string }
type SendResult = { ok: boolean; error?: string }
type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>
type Deps = {
  env: Record<string, string | undefined>
  platform: string
  readRegistry: (name: string) => string | undefined | Promise<string | undefined>
  cwd: string
  mainCheckout: () => string | undefined
  fetchImpl: FetchImpl
  stdout: (text: string) => void
  stderr: (text: string) => void
}
type Api = {
  buildMessage: (datos: Datos) => string
  checkTenantLeftovers: (text: string, needles: Needle[]) => string[]
  sendTelegram: (options: {
    token: string
    chatId: string
    text: string
    fetchImpl: FetchImpl
  }) => Promise<SendResult>
  main: (argv: string[], deps: Deps) => number | Promise<number>
  readRegistry: (
    name: string,
    options: {
      execFile: (file: string, args: string[], options?: Record<string, unknown>) => string
      env: Record<string, string | undefined>
    }
  ) => string | undefined
}

// Si el script aún no existe, solo fallan los tests que lo usan (CA11 no lo necesita).
const loaded = existsSync(SCRIPT) ? ((await import(pathToFileURL(SCRIPT).href)) as Api) : undefined
// El script importa la tarjeta (0104) solo cuando hay que capturar, y esa primera carga (React,
// react-markdown, highlight.js…) tarda segundos: se la llevaba el único test de este fichero que
// envía la foto (CA1 de la 0106), que con la máquina cargada pasaba de los 5 s de Vitest. Se
// precarga aquí, al cargar el fichero, fuera del tiempo de cada test (como en la 0105).
const CARD = join(__dirname, 'telegram-card.mjs')
if (existsSync(CARD)) await import(pathToFileURL(CARD).href)
function api(): Api {
  if (!loaded) throw new Error('No existe scripts/notify-telegram.mjs')
  return loaded
}
const { extractNeedles } = (await import(
  pathToFileURL(join(__dirname, 'scan-tenant.mjs')).href
)) as {
  extractNeedles: (text: string) => Needle[]
}

// Credenciales inventadas con la forma de las reales.
const TOKEN = '123456789:AAFakeTokenInventado_XYZ-abc987'
const TOKEN_SECRET = 'AAFakeTokenInventado_XYZ-abc987'
const CHAT_ID = '987650001234'
const REG_TOKEN = '555000111:AARegistroInventado_QWE-zzz111'
const REG_CHAT_ID = '424242000777'

// .env de pruebas inventado, como en scan-tenant.test.ts.
const HOST = 'zz99fake.live.dynatrace.com'
const ENV_LIVE = ['# comentario', `DT_URL=https://${HOST}`, 'CORTO=abc', ''].join('\n')
// Un .env con valores que no aparecen en ningún mensaje de los tests.
const ENV_UNRELATED = 'DT_URL=https://qq11nadaquever.example.invalid\n'

const CI = 'https://github.com/ejemplo/vigia/actions/runs/1234567890'

function tarea(overrides: Partial<Datos> = {}): Datos {
  return {
    tipo: 'tarea',
    ficha: '0004',
    titulo: 'Aviso por Telegram',
    estado: 'hecha',
    resumen: 'Script de aviso con filtro del tenant y tests.',
    rondas: 2,
    verifier: 'VERDE',
    ci: CI,
    decision: '',
    ...overrides
  }
}

function version(overrides: Partial<Datos> = {}): Datos {
  return {
    tipo: 'version',
    titulo: 'Versión de prueba',
    version: '0.11.0',
    estado: 'cerrada',
    resumen: 'Cierre de versión.',
    rondas: 0,
    verifier: 'VERDE',
    ci: CI,
    decision: '',
    ...overrides
  }
}

function okResponse(): Response {
  return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })
}

let dirs: string[] = []
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'vigia-telegram-'))
  dirs.push(dir)
  return dir
}

function inputFile(datos: unknown): string {
  const file = join(tempDir(), 'aviso.json')
  writeFileSync(file, typeof datos === 'string' ? datos : JSON.stringify(datos))
  return file
}

type Captured = { stdout: string[]; stderr: string[] }
let captured: Captured
let spies: MockInstance[] = []
let globalFetch: ReturnType<typeof vi.fn>

beforeEach(() => {
  dirs = []
  captured = { stdout: [], stderr: [] }
  // Nunca las variables reales: fuera del entorno del proceso de test.
  vi.stubEnv('VIGIA_TELEGRAM_TOKEN', undefined)
  vi.stubEnv('VIGIA_TELEGRAM_CHAT_ID', undefined)
  vi.stubEnv('VIGIA_TELEGRAM_THREAD_ID', undefined)
  // Red de seguridad: si el script ignorase fetchImpl, no saldría a la red.
  globalFetch = vi.fn(() => Promise.reject(new Error('fetch global no permitido en tests')))
  vi.stubGlobal('fetch', globalFetch)
  // Todo lo que se escriba en la terminal, por la vía que sea, se recoge.
  const out = (...args: unknown[]): void => void captured.stdout.push(args.map(String).join(' '))
  const err = (...args: unknown[]): void => void captured.stderr.push(args.map(String).join(' '))
  spies = [
    vi.spyOn(console, 'log').mockImplementation(out),
    vi.spyOn(console, 'info').mockImplementation(out),
    vi.spyOn(console, 'warn').mockImplementation(err),
    vi.spyOn(console, 'error').mockImplementation(err),
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      out(chunk)
      return true
    }),
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      err(chunk)
      return true
    })
  ]
})

afterEach(() => {
  for (const spy of spies) spy.mockRestore()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

type RunOptions = {
  datos?: unknown
  argv?: string[]
  env?: Record<string, string | undefined>
  registry?: Record<string, string>
  cwdEnv?: string
  mainEnv?: string
  fetchImpl?: FetchImpl
}

async function run(options: RunOptions = {}): Promise<{
  code: unknown
  fetchImpl: ReturnType<typeof vi.fn>
  stdout: string
  stderr: string
  all: string
}> {
  const cwd = tempDir()
  if (options.cwdEnv !== undefined) writeFileSync(join(cwd, '.env.live.local'), options.cwdEnv)
  const main = tempDir()
  if (options.mainEnv !== undefined) writeFileSync(join(main, '.env.live.local'), options.mainEnv)
  const fetchImpl = vi.fn(options.fetchImpl ?? (() => Promise.resolve(okResponse())))
  const registry = options.registry ?? {}
  const argv = options.argv ?? [inputFile(options.datos ?? tarea())]
  const code = await api().main(argv, {
    env: options.env ?? { VIGIA_TELEGRAM_TOKEN: TOKEN, VIGIA_TELEGRAM_CHAT_ID: CHAT_ID },
    platform: 'win32',
    readRegistry: (name) => registry[name],
    cwd,
    mainCheckout: () => main,
    fetchImpl: fetchImpl as unknown as FetchImpl,
    stdout: (text) => void captured.stdout.push(String(text)),
    stderr: (text) => void captured.stderr.push(String(text))
  })
  const stdout = captured.stdout.join('\n')
  const stderr = captured.stderr.join('\n')
  return { code, fetchImpl, stdout, stderr, all: `${stdout}\n${stderr}\n${JSON.stringify(code)}` }
}

function lines(text: string): string[] {
  return text.split(/\r?\n/)
}

describe('CA1 (0004): envío correcto', () => {
  it('CA1 (0004): sendTelegram hace un único POST a sendMessage con chat_id, text y link_preview_options desactivado (sin disable_web_page_preview), y es éxito', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(okResponse()))
    const result = await api().sendTelegram({
      token: TOKEN,
      chatId: CHAT_ID,
      text: 'hola',
      fetchImpl: fetchImpl as unknown as FetchImpl
    })
    expect(result.ok).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(String(url)).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`)
    expect(init.method).toBe('POST')
    expect(new Headers(init.headers).get('content-type')).toContain('application/json')
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body).toMatchObject({
      chat_id: CHAT_ID,
      text: 'hola',
      link_preview_options: { is_disabled: true }
    })
    expect(body).not.toHaveProperty('disable_web_page_preview')
    // Texto plano: sin parse_mode.
    expect(body).not.toHaveProperty('parse_mode')
    // Con tiempo máximo (AbortSignal.timeout).
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('CA1 (0004): main con token, chat_id y una tarea hecha envía el mensaje de buildMessage y devuelve 0', async () => {
    const datos = tarea()
    const { code, fetchImpl } = await run({ datos, cwdEnv: ENV_UNRELATED })
    expect(code).toBe(0)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(String(url)).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`)
    expect(init.method).toBe('POST')
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body).toMatchObject({
      chat_id: CHAT_ID,
      text: api().buildMessage(datos),
      link_preview_options: { is_disabled: true }
    })
    expect(body).not.toHaveProperty('disable_web_page_preview')
    expect(globalFetch).not.toHaveBeenCalled()
  })
})

describe('CA2 (0004): buildMessage', () => {
  it.each([
    ['hecha', tarea({ estado: 'hecha' }), '✅'],
    ['bloqueada', tarea({ estado: 'bloqueada', verifier: 'ROJO' }), '⛔'],
    [
      'parada',
      tarea({
        estado: 'parada',
        decision: '¿Se amplía el alcance al CA12?',
        verifier: 'sin pasar'
      }),
      '⏸'
    ]
  ])(
    'CA2 (0004): tarea %s: icono, número, título y estado en la primera línea',
    (estado, datos, icon) => {
      const message = api().buildMessage(datos)
      const first = lines(message)[0] ?? ''
      expect(first.startsWith(icon)).toBe(true)
      expect(first).toContain('0004')
      expect(first).toContain('Aviso por Telegram')
      expect(first).toContain(estado)
    }
  )

  it('CA2 (0004): la primera línea de una tarea hecha tiene la forma de la ficha', () => {
    expect(lines(api().buildMessage(tarea()))[0]).toBe('✅ 0004 · Aviso por Telegram — hecha')
  })

  it.each([
    ['cerrada', version({ estado: 'cerrada' }), '📦'],
    ['fallida', version({ estado: 'fallida', verifier: 'ROJO' }), '❌']
  ])(
    'CA2 (0004): versión %s: icono, versión, título y estado en la primera línea',
    (estado, datos, icon) => {
      const first = lines(api().buildMessage(datos))[0] ?? ''
      expect(first.startsWith(icon)).toBe(true)
      expect(first).toContain('0.11.0')
      expect(first).not.toContain('vv0.11.0')
      expect(first).toContain('Versión de prueba')
      expect(first).toContain(estado)
    }
  )

  it('CA2 (0004): la primera línea de una versión cerrada tiene la forma de la ficha', () => {
    expect(lines(api().buildMessage(version()))[0]).toBe('📦 v0.11.0 · Versión de prueba — cerrada')
  })

  it.each([
    ['hecha', tarea(), 'Rondas: 2 · Verifier: VERDE'],
    [
      'bloqueada',
      tarea({ estado: 'bloqueada', rondas: 3, verifier: 'ROJO' }),
      'Rondas: 3 · Verifier: ROJO'
    ],
    [
      'parada',
      tarea({ estado: 'parada', rondas: 1, verifier: 'sin pasar', decision: 'x' }),
      'Rondas: 1 · Verifier: sin pasar'
    ],
    ['cerrada', version(), 'Rondas: 0 · Verifier: VERDE'],
    ['fallida', version({ estado: 'fallida', verifier: 'ROJO' }), 'Rondas: 0 · Verifier: ROJO']
  ])(
    'CA2 (0004): %s lleva la línea de rondas y verifier en segundo lugar',
    (_estado, datos, line) => {
      expect(lines(api().buildMessage(datos))[1]).toBe(line)
    }
  )

  it('CA2 (0004): con decision, "Decide Dani:" va tras rondas y antes del resumen, y la URL del CI al final', () => {
    const decision = '¿Se amplía el alcance al CA12?'
    const datos = tarea({ estado: 'parada', decision, verifier: 'sin pasar' })
    const message = api().buildMessage(datos)
    const all = lines(message)
    expect(all).toContain(`Decide Dani: ${decision}`)
    const iRondas = all.findIndex((l) => l.startsWith('Rondas:'))
    const iDecide = all.indexOf(`Decide Dani: ${decision}`)
    const iResumen = message.indexOf(datos.resumen)
    const iCi = message.indexOf(CI)
    expect(iRondas).toBeLessThan(iDecide)
    expect(message.indexOf('Decide Dani:')).toBeLessThan(iResumen)
    expect(iResumen).toBeGreaterThan(-1)
    expect(iCi).toBeGreaterThan(iResumen)
  })

  it.each([
    ['hecha', tarea()],
    ['bloqueada', tarea({ estado: 'bloqueada' })],
    ['cerrada', version()],
    ['fallida', version({ estado: 'fallida' })]
  ])('CA2 (0004): %s sin decision no lleva "Decide Dani:"', (_estado, datos) => {
    expect(api().buildMessage(datos)).not.toContain('Decide Dani:')
  })

  it.each([
    ['hecha', tarea({ ci: '' })],
    ['parada', tarea({ estado: 'parada', decision: 'x', ci: '' })],
    ['cerrada', version({ ci: '' })]
  ])('CA2 (0004): %s sin ci no lleva URL del CI', (_estado, datos) => {
    const message = api().buildMessage(datos)
    expect(message).not.toContain('https://')
    expect(message).toContain(datos.resumen)
  })

  it.each([
    ['hecha', tarea()],
    ['cerrada', version()]
  ])('CA2 (0004): %s con ci lleva la URL del CI', (_estado, datos) => {
    expect(api().buildMessage(datos)).toContain(CI)
  })
})

describe('CA3 (0004): longitud máxima', () => {
  it('CA3 (0004): un resumen largo deja el mensaje en 1 500 caracteres como mucho, con «…», la primera línea y la del CI', () => {
    const resumen = 'Una frase larga del resumen del doc-writer. '.repeat(200).trim()
    const message = api().buildMessage(tarea({ resumen }))
    expect([...message].length).toBeLessThanOrEqual(1500)
    expect(lines(message)[0]).toBe('✅ 0004 · Aviso por Telegram — hecha')
    expect(lines(message).at(-1)).toBe(CI)
    // El resumen se recorta (no desaparece) y acaba en «…» justo antes del CI.
    expect(message).toContain('Una frase larga del resumen del doc-writer.')
    const beforeCi = message.slice(0, message.lastIndexOf(CI)).trimEnd()
    expect(beforeCi.endsWith('…')).toBe(true)
  })

  it('CA3 (0004): un resumen corto no se recorta', () => {
    const message = api().buildMessage(tarea())
    expect(message).not.toContain('…')
    expect(message).toContain(tarea().resumen)
  })
})

describe('CA4 (0004): sin credenciales', () => {
  it.each([
    [
      'sin VIGIA_TELEGRAM_TOKEN',
      { VIGIA_TELEGRAM_CHAT_ID: CHAT_ID },
      { VIGIA_TELEGRAM_CHAT_ID: CHAT_ID }
    ],
    [
      'sin VIGIA_TELEGRAM_CHAT_ID',
      { VIGIA_TELEGRAM_TOKEN: TOKEN },
      { VIGIA_TELEGRAM_TOKEN: TOKEN }
    ],
    ['sin ninguna', {}, {}]
  ])(
    'CA4 (0004): %s (ni en el entorno ni en el registro) no llama a fetch, avisa en stderr y devuelve 0',
    async (_case, env, registry) => {
      const { code, fetchImpl, stderr } = await run({ env, registry, cwdEnv: ENV_UNRELATED })
      expect(code).toBe(0)
      expect(fetchImpl).not.toHaveBeenCalled()
      expect(globalFetch).not.toHaveBeenCalled()
      expect(stderr).toContain('[aviso telegram]')
      expect(stderr).toContain('sin VIGIA_TELEGRAM_TOKEN o VIGIA_TELEGRAM_CHAT_ID: no se envía')
    }
  )
})

describe('CA5 (0004): credenciales del registro', () => {
  it('CA5 (0004): sin variables en el entorno pero con ellas en el registro simulado, envía con las del registro', async () => {
    const { code, fetchImpl } = await run({
      env: {},
      registry: { VIGIA_TELEGRAM_TOKEN: REG_TOKEN, VIGIA_TELEGRAM_CHAT_ID: REG_CHAT_ID },
      cwdEnv: ENV_UNRELATED
    })
    expect(code).toBe(0)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(String(url)).toBe(`https://api.telegram.org/bot${REG_TOKEN}/sendMessage`)
    expect(JSON.parse(String(init.body))).toMatchObject({ chat_id: REG_CHAT_ID })
  })
})

const FAILURES: [string, FetchImpl, RegExp][] = [
  ['error de red', () => Promise.reject(new TypeError('fetch failed')), /\[aviso telegram\]/],
  [
    'tiempo agotado',
    () =>
      Promise.reject(new DOMException('The operation was aborted due to timeout', 'TimeoutError')),
    /\[aviso telegram\]/
  ],
  [
    'HTTP 401',
    () =>
      Promise.resolve(
        new Response(JSON.stringify({ ok: false, error_code: 401, description: 'Unauthorized' }), {
          status: 401,
          headers: { 'content-type': 'application/json' }
        })
      ),
    /401|Unauthorized/
  ],
  [
    '200 con ok: false',
    () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            ok: false,
            error_code: 400,
            description: 'Bad Request: chat not found'
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      ),
    /chat not found/
  ]
]

describe('CA6 (0004): fallos del envío', () => {
  it.each(FAILURES)(
    'CA6 (0004): %s acaba en aviso en stderr y main devuelve 0',
    async (_case, fetchImpl, detail) => {
      const { code, stderr } = await run({ fetchImpl, cwdEnv: ENV_UNRELATED })
      expect(code).toBe(0)
      expect(stderr).toContain('[aviso telegram]')
      expect(stderr).toMatch(detail)
    }
  )

  it.each(FAILURES)(
    'CA6 (0004): sendTelegram con %s no lanza y devuelve ok: false',
    async (_case, fetchImpl) => {
      const result = await api().sendTelegram({
        token: TOKEN,
        chatId: CHAT_ID,
        text: 'hola',
        fetchImpl
      })
      expect(result.ok).toBe(false)
    }
  )
})

describe('CA7 (0004): filtro de restos del tenant', () => {
  it('CA7 (0004): checkTenantLeftovers devuelve el tipo de coincidencia, sin mayúsculas, y nada si el texto está limpio', () => {
    const needles = extractNeedles(ENV_LIVE)
    expect(
      api().checkTenantLeftovers(`Fallo en https://${HOST.toUpperCase()}/api`, needles)
    ).toContain('host')
    expect(api().checkTenantLeftovers('Texto limpio sin nada del tenant', needles)).toEqual([])
  })

  it('CA7 (0004): con el .env en el directorio actual, si el texto lleva un valor no llama a fetch, avisa con el tipo y el valor no sale', async () => {
    const { code, fetchImpl, stderr, all } = await run({
      datos: tarea({ resumen: `Probado contra ${HOST.toUpperCase()} sin problemas.` }),
      cwdEnv: ENV_LIVE
    })
    expect(code).toBe(0)
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(globalFetch).not.toHaveBeenCalled()
    expect(stderr).toContain('[aviso telegram]')
    expect(stderr).toMatch(/host|id-de-entorno/)
    const lower = all.toLowerCase()
    expect(lower).not.toContain(HOST)
    expect(lower).not.toContain('zz99fake')
  })

  it('CA7 (0004): sin .env en el directorio actual, usa el del checkout principal', async () => {
    const { fetchImpl, all } = await run({
      datos: tarea({ decision: `Revisar ${HOST}`, estado: 'parada' }),
      mainEnv: ENV_LIVE
    })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(all.toLowerCase()).not.toContain('zz99fake')
  })

  it('CA7 (0004): con el .env y un texto limpio, envía sin avisar de que no se ha filtrado', async () => {
    const { fetchImpl, stderr } = await run({ cwdEnv: ENV_LIVE })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(stderr).not.toMatch(/no se ha (podido )?filtrad/i)
  })
})

// Ficha 0092: lo que esperaba «CA8 (0004)» (sin .env, enviar sin filtrar) cambia: sin valores con
// los que filtrar, no se envía, salvo con VIGIA_TELEGRAM_UNFILTERED=1.
const NO_SEND = '[aviso telegram] sin .env.live.local con valores: no se envía'

// .env que existen pero no dan nada que buscar (como los de scan-tenant.test.ts, ficha 0055).
const EMPTY_ENVS: [string, string][] = [
  ['vacío', ''],
  [
    'solo con claves vacías y comentarios',
    '# comentario\nVIGIA_LIVE_URL=\nVIGIA_LIVE_TOKEN=""\nCORTO=abc\n'
  ]
]

function expectNoSecrets(all: string): void {
  expect(all).not.toContain(TOKEN)
  expect(all).not.toContain(TOKEN_SECRET)
  expect(all).not.toContain(CHAT_ID)
}

describe('CA1 (0092): sin .env.live.local no se envía', () => {
  it('CA1 (0092): sin .env en el directorio ni en el checkout principal, no llama a la red, devuelve 0 y avisa sin el token ni el chat', async () => {
    const { code, fetchImpl, stderr, all } = await run({})
    expect(code).toBe(0)
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(globalFetch).not.toHaveBeenCalled()
    expect(stderr).toContain(NO_SEND)
    expectNoSecrets(all)
  })

  it('CA1 (0092): con las credenciales del registro y sin .env, tampoco envía ni las muestra', async () => {
    const { code, fetchImpl, stderr, all } = await run({
      env: {},
      registry: { VIGIA_TELEGRAM_TOKEN: REG_TOKEN, VIGIA_TELEGRAM_CHAT_ID: REG_CHAT_ID }
    })
    expect(code).toBe(0)
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(globalFetch).not.toHaveBeenCalled()
    expect(stderr).toContain(NO_SEND)
    expect(all).not.toContain(REG_TOKEN)
    expect(all).not.toContain(REG_CHAT_ID)
  })

  it.each(['0', '', 'no'])(
    'CA1 (0092): con VIGIA_TELEGRAM_UNFILTERED=%j (distinto de 1) sigue sin enviar',
    async (value) => {
      const { code, fetchImpl, stderr } = await run({
        env: {
          VIGIA_TELEGRAM_TOKEN: TOKEN,
          VIGIA_TELEGRAM_CHAT_ID: CHAT_ID,
          VIGIA_TELEGRAM_UNFILTERED: value
        }
      })
      expect(code).toBe(0)
      expect(fetchImpl).not.toHaveBeenCalled()
      expect(stderr).toContain(NO_SEND)
    }
  )
})

describe('CA2 (0092): con un .env sin valores no se envía', () => {
  it.each(EMPTY_ENVS)(
    'CA2 (0092): con el .env %s en el directorio actual, no llama a la red, devuelve 0 y avisa sin el token ni el chat',
    async (_case, content) => {
      const { code, fetchImpl, stderr, all } = await run({ cwdEnv: content })
      expect(code).toBe(0)
      expect(fetchImpl).not.toHaveBeenCalled()
      expect(globalFetch).not.toHaveBeenCalled()
      expect(stderr).toContain(NO_SEND)
      expectNoSecrets(all)
    }
  )

  it.each(EMPTY_ENVS)(
    'CA2 (0092): con el .env %s solo en el checkout principal, tampoco envía',
    async (_case, content) => {
      const { code, fetchImpl, stderr, all } = await run({ mainEnv: content })
      expect(code).toBe(0)
      expect(fetchImpl).not.toHaveBeenCalled()
      expect(globalFetch).not.toHaveBeenCalled()
      expect(stderr).toContain(NO_SEND)
      expectNoSecrets(all)
    }
  )
})

describe('CA3 (0092): VIGIA_TELEGRAM_UNFILTERED=1 envía sin filtrar', () => {
  const UNFILTERED_ENV = {
    VIGIA_TELEGRAM_TOKEN: TOKEN,
    VIGIA_TELEGRAM_CHAT_ID: CHAT_ID,
    VIGIA_TELEGRAM_UNFILTERED: '1'
  }

  it('CA3 (0092): sin .env y con VIGIA_TELEGRAM_UNFILTERED=1, envía el mensaje, devuelve 0 y avisa de que va sin filtrar', async () => {
    const datos = tarea()
    const { code, fetchImpl, stderr, all } = await run({ datos, env: UNFILTERED_ENV })
    expect(code).toBe(0)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(globalFetch).not.toHaveBeenCalled()
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(String(url)).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`)
    expect(JSON.parse(String(init.body))).toMatchObject({
      chat_id: CHAT_ID,
      text: api().buildMessage(datos)
    })
    expect(stderr).toContain('[aviso telegram]')
    expect(stderr).toMatch(/sin filtrar|no se ha (podido )?filtrar/i)
    expect(stderr).not.toContain(NO_SEND)
    expectNoSecrets(all)
  })

  it.each(EMPTY_ENVS)(
    'CA3 (0092): con el .env %s y VIGIA_TELEGRAM_UNFILTERED=1, también envía y avisa',
    async (_case, content) => {
      const { code, fetchImpl, stderr } = await run({ env: UNFILTERED_ENV, cwdEnv: content })
      expect(code).toBe(0)
      expect(fetchImpl).toHaveBeenCalledTimes(1)
      expect(stderr).toMatch(/sin filtrar|no se ha (podido )?filtrar/i)
    }
  )
})

describe('CA4 (0092): con un .env con valores, el filtro no cambia', () => {
  it('CA4 (0092): VIGIA_TELEGRAM_UNFILTERED=1 no salta el filtro si hay .env con valores: un resto del tenant no se envía', async () => {
    const { code, fetchImpl, all } = await run({
      datos: tarea({ resumen: `Probado contra ${HOST} sin problemas.` }),
      env: {
        VIGIA_TELEGRAM_TOKEN: TOKEN,
        VIGIA_TELEGRAM_CHAT_ID: CHAT_ID,
        VIGIA_TELEGRAM_UNFILTERED: '1'
      },
      cwdEnv: ENV_LIVE
    })
    expect(code).toBe(0)
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(all.toLowerCase()).not.toContain('zz99fake')
  })

  it('CA4 (0092): con un .env con valores y un texto limpio, envía sin el aviso de «no se envía»', async () => {
    const { fetchImpl, stderr } = await run({ cwdEnv: ENV_LIVE })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(stderr).not.toContain(NO_SEND)
  })
})

describe('CA9 (0004): el token y el chat_id no salen nunca', () => {
  const tokenInUrlError = (): Promise<Response> =>
    Promise.reject(
      new TypeError(
        `request to https://api.telegram.org/bot${TOKEN}/sendMessage failed, chat ${CHAT_ID}`
      )
    )
  const tokenInDescription = (): Promise<Response> =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          ok: false,
          error_code: 400,
          description: `Bad Request: token ${TOKEN} and chat_id ${CHAT_ID} rejected`
        }),
        { status: 400, headers: { 'content-type': 'application/json' } }
      )
    )

  const scenarios: [string, RunOptions][] = [
    ['envío correcto', { cwdEnv: ENV_UNRELATED }],
    ['sin .env (no envía, 0092)', {}],
    ['solo el token', { env: { VIGIA_TELEGRAM_TOKEN: TOKEN } }],
    ['solo el chat_id', { env: { VIGIA_TELEGRAM_CHAT_ID: CHAT_ID } }],
    ...FAILURES.map(([name, fetchImpl]): [string, RunOptions] => [
      name,
      { fetchImpl, cwdEnv: ENV_UNRELATED }
    ]),
    ['error con la URL y el token dentro', { fetchImpl: tokenInUrlError, cwdEnv: ENV_UNRELATED }],
    [
      'description que repite token y chat_id',
      { fetchImpl: tokenInDescription, cwdEnv: ENV_UNRELATED }
    ],
    [
      'bloqueo por restos del tenant',
      { datos: tarea({ resumen: `en ${HOST}` }), cwdEnv: ENV_LIVE }
    ],
    ['JSON inexistente', { argv: [join(tmpdir(), 'vigia-no-existe-0004', 'aviso.json')] }],
    ['JSON no válido', { datos: '{ esto no es json' }]
  ]

  it.each(scenarios)(
    'CA9 (0004): %s: ni token ni chat_id en stdout, stderr ni en lo que devuelve main',
    async (_case, options) => {
      const { all } = await run(options)
      expect(all).not.toContain(TOKEN)
      expect(all).not.toContain(TOKEN_SECRET)
      expect(all).not.toContain(CHAT_ID)
    }
  )

  it('CA9 (0004): con las credenciales del registro tampoco salen', async () => {
    const { all } = await run({
      env: {},
      registry: { VIGIA_TELEGRAM_TOKEN: REG_TOKEN, VIGIA_TELEGRAM_CHAT_ID: REG_CHAT_ID },
      fetchImpl: () =>
        Promise.reject(new TypeError(`https://api.telegram.org/bot${REG_TOKEN}/sendMessage`))
    })
    expect(all).not.toContain(REG_TOKEN)
    expect(all).not.toContain(REG_CHAT_ID)
  })

  it('CA9 (0004): sendTelegram no deja el token ni el chat_id en el error que devuelve', async () => {
    for (const fetchImpl of [tokenInUrlError, tokenInDescription]) {
      const result = await api().sendTelegram({
        token: TOKEN,
        chatId: CHAT_ID,
        text: 'hola',
        fetchImpl
      })
      expect(result.ok).toBe(false)
      const text = JSON.stringify(result)
      expect(text).not.toContain(TOKEN)
      expect(text).not.toContain(TOKEN_SECRET)
      expect(text).not.toContain(CHAT_ID)
    }
  })
})

describe('CA10 (0004): JSON de entrada', () => {
  it.each([
    ['que no existe', { argv: [join(tmpdir(), 'vigia-no-existe-0004', 'aviso.json')] }],
    ['no válido', { datos: '{ esto no es json' }],
    ['sin argumento', { argv: [] }]
  ] as [string, RunOptions][])(
    'CA10 (0004): un JSON %s acaba en aviso y main devuelve 0 sin llamar a fetch',
    async (_case, options) => {
      const { code, fetchImpl, stderr } = await run({ ...options, cwdEnv: ENV_UNRELATED })
      expect(code).toBe(0)
      expect(fetchImpl).not.toHaveBeenCalled()
      expect(globalFetch).not.toHaveBeenCalled()
      expect(stderr).toContain('[aviso telegram]')
    }
  )
})

describe('CA11 (0004): pasos en los comandos y permiso', () => {
  const CALL = 'node scripts/notify-telegram.mjs'

  /** Líneas a 6 o menos de una mención de la llamada: ahí tienen que estar los estados. */
  function nearCalls(file: string): string {
    const all = lines(readFileSync(join(ROOT, file), 'utf8'))
    const near = new Set<number>()
    all.forEach((line, i) => {
      if (line.includes('notify-telegram.mjs'))
        for (let j = Math.max(0, i - 6); j <= Math.min(all.length - 1, i + 6); j++) near.add(j)
    })
    return [...near]
      .sort((a, b) => a - b)
      .map((i) => all[i])
      .join('\n')
  }

  it.each([
    ['.claude/commands/tarea.md', ['hecha', 'bloqueada', 'parada']],
    ['.claude/commands/cerrar-version.md', ['cerrada', 'fallida']]
  ])('CA11 (0004): %s llama al script con cada estado', (file, estados) => {
    const text = readFileSync(join(ROOT, file), 'utf8')
    expect(text).toContain(CALL)
    const near = nearCalls(file)
    for (const estado of estados)
      expect(near, `estado ${estado} junto a la llamada`).toMatch(new RegExp(`\\b${estado}\\b`))
  })

  it('CA11 (0004): tarea.md pone la pregunta en decision al quedar parada', () => {
    expect(nearCalls('.claude/commands/tarea.md')).toContain('decision')
  })

  it('CA11 (0004): .claude/settings.json permite la llamada en Bash y en PowerShell', () => {
    const settings = JSON.parse(readFileSync(join(ROOT, '.claude/settings.json'), 'utf8')) as {
      permissions: { allow: string[] }
    }
    expect(settings.permissions.allow).toContain(`Bash(${CALL} *)`)
    expect(settings.permissions.allow).toContain(`PowerShell(${CALL} *)`)
  })
})

describe('CA12 (0004): filtro sobre los campos completos, antes de recortar', () => {
  // El valor del .env se coloca en muchas posiciones alrededor del punto donde el recorte a
  // 1 500 caracteres parte el resumen: en alguna de ellas el mensaje solo lleva medio valor.
  const offsets = Array.from({ length: 61 }, (_, i) => 1200 + i * 5)
  const resumenAt = (offset: number): string => `${'x'.repeat(offset)} ${HOST} ${'y'.repeat(2000)}`

  it('CA12 (0004): en alguna de las posiciones probadas el recorte parte el valor (el test ejercita el caso)', () => {
    const split = offsets.some((offset) => {
      const message = api().buildMessage(tarea({ resumen: resumenAt(offset) }))
      return !message.toLowerCase().includes(HOST)
    })
    expect(split).toBe(true)
  })

  it('CA12 (0004): un valor del .env que el recorte partiría bloquea el envío igual (sin fetch)', async () => {
    for (const offset of offsets) {
      const { code, fetchImpl, all } = await run({
        datos: tarea({ resumen: resumenAt(offset) }),
        cwdEnv: ENV_LIVE
      })
      expect(code, `posición ${offset}`).toBe(0)
      expect(fetchImpl, `posición ${offset}`).not.toHaveBeenCalled()
      expect(all.toLowerCase(), `posición ${offset}`).not.toContain(HOST)
    }
  })

  it.each([
    ['titulo', { titulo: `Arreglo para ${HOST}` }],
    ['decision', { estado: 'parada', decision: `¿Se prueba en ${HOST}?` }],
    ['ci', { ci: `https://${HOST}/ci/1` }]
  ] as [string, Partial<Datos>][])(
    'CA12 (0004): un valor del .env en %s bloquea el envío',
    async (_campo, overrides) => {
      const { fetchImpl, all } = await run({ datos: tarea(overrides), cwdEnv: ENV_LIVE })
      expect(fetchImpl).not.toHaveBeenCalled()
      expect(all.toLowerCase()).not.toContain('zz99fake')
    }
  )
})

describe('CA13 (0004): lectura del registro con reg.exe por ruta absoluta', () => {
  const SYSTEM_ROOT = 'D:\\WinFalso'
  const REG_OUTPUT = [
    '',
    'HKEY_CURRENT_USER\\Environment',
    `    VIGIA_TELEGRAM_TOKEN    REG_SZ    ${REG_TOKEN}`,
    '',
    ''
  ].join('\r\n')

  it('CA13 (0004): ejecuta %SystemRoot%\\System32\\reg.exe con los argumentos en array y sin shell, y devuelve el valor', () => {
    const execFile = vi.fn<
      (file: string, args: string[], options?: Record<string, unknown>) => string
    >(() => REG_OUTPUT)
    const value = api().readRegistry('VIGIA_TELEGRAM_TOKEN', {
      execFile,
      env: { SystemRoot: SYSTEM_ROOT }
    })
    expect(value).toBe(REG_TOKEN)
    expect(execFile).toHaveBeenCalledTimes(1)
    const [file, args, options] = execFile.mock.calls[0] as [
      string,
      unknown,
      Record<string, unknown> | undefined
    ]
    expect(file.replace(/\//g, '\\').toLowerCase()).toBe(
      `${SYSTEM_ROOT}\\System32\\reg.exe`.toLowerCase()
    )
    expect(Array.isArray(args)).toBe(true)
    expect(args).toEqual(['query', 'HKCU\\Environment', '/v', 'VIGIA_TELEGRAM_TOKEN'])
    expect(options?.shell).toBeFalsy()
  })

  it('CA13 (0004): nunca llama a reg por nombre', () => {
    const execFile = vi.fn<
      (file: string, args: string[], options?: Record<string, unknown>) => string
    >(() => REG_OUTPUT)
    api().readRegistry('VIGIA_TELEGRAM_CHAT_ID', { execFile, env: { SystemRoot: SYSTEM_ROOT } })
    for (const [file] of execFile.mock.calls) {
      expect(file.toLowerCase()).not.toBe('reg')
      expect(file.toLowerCase()).not.toBe('reg.exe')
    }
  })

  it('CA13 (0004): si reg.exe falla (variable que no existe), devuelve undefined sin lanzar', () => {
    const execFile = vi.fn((): string => {
      throw new Error('ERROR: El sistema no pudo encontrar la clave o el valor especificado.')
    })
    expect(
      api().readRegistry('VIGIA_TELEGRAM_TOKEN', { execFile, env: { SystemRoot: SYSTEM_ROOT } })
    ).toBeUndefined()
  })
})

describe('CA4 (0055): notify-telegram usa la función común para encontrar el .env', () => {
  const IMPORT = /import\s*\{[^}]*\bfindLiveEnv\b[^}]*\}\s*from\s*['"]\.\/lib\/env-file\.mjs['"]/

  it('CA4 (0055): notify-telegram.mjs importa findLiveEnv de ./lib/env-file.mjs', () => {
    expect(readFileSync(SCRIPT, 'utf8')).toMatch(IMPORT)
  })

  it('CA4 (0055): notify-telegram.mjs ya no consulta git worktree por su cuenta', () => {
    expect(readFileSync(SCRIPT, 'utf8')).not.toMatch(/['"]worktree['"]\s*,\s*['"]list['"]/)
  })

  it('CA4 (0055): scan-tenant.mjs importa la misma función', () => {
    expect(readFileSync(join(__dirname, 'scan-tenant.mjs'), 'utf8')).toMatch(IMPORT)
  })
})

// Ficha 0103: avisos en un hilo del grupo (VIGIA_TELEGRAM_THREAD_ID). Valores inventados.
const THREAD_ID = '48151'
const REG_THREAD_ID = '62342'
const THREAD_ENV = {
  VIGIA_TELEGRAM_TOKEN: TOKEN,
  VIGIA_TELEGRAM_CHAT_ID: CHAT_ID,
  VIGIA_TELEGRAM_THREAD_ID: THREAD_ID
}

function bodyOf(fetchImpl: ReturnType<typeof vi.fn>, call: number): Record<string, unknown> {
  const [, init] = fetchImpl.mock.calls[call] as unknown as [string, RequestInit]
  return JSON.parse(String(init.body)) as Record<string, unknown>
}

function expectNoThread(body: Record<string, unknown>): void {
  expect(body).not.toHaveProperty('message_thread_id')
  expect(body).not.toHaveProperty('reply_parameters')
}

function telegramError(description: string, status = 400): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify({ ok: false, error_code: 400, description }), {
      status,
      headers: { 'content-type': 'application/json' }
    })
  )
}

/** Primer envío (con hilo) con `first`; los siguientes, con `rest`. */
function sequence(first: FetchImpl, rest: FetchImpl): FetchImpl {
  let calls = 0
  return (url, init) => (calls++ === 0 ? first(url, init) : rest(url, init))
}

describe('CA1 (0103): sendMessage con el hilo', () => {
  it('CA1 (0103): con VIGIA_TELEGRAM_THREAD_ID entero positivo, el cuerpo lleva message_thread_id y reply_parameters con ese número', async () => {
    const datos = tarea()
    const { code, fetchImpl } = await run({ datos, env: THREAD_ENV, cwdEnv: ENV_UNRELATED })
    expect(code).toBe(0)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(bodyOf(fetchImpl, 0)).toMatchObject({
      chat_id: CHAT_ID,
      text: api().buildMessage(datos),
      message_thread_id: Number(THREAD_ID),
      reply_parameters: { message_id: Number(THREAD_ID), allow_sending_without_reply: false }
    })
    expect(globalFetch).not.toHaveBeenCalled()
  })

  it('CA1 (0103): sin VIGIA_TELEGRAM_THREAD_ID (ni en el entorno ni en el registro), no lleva ninguno de los dos', async () => {
    const { code, fetchImpl } = await run({ cwdEnv: ENV_UNRELATED })
    expect(code).toBe(0)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expectNoThread(bodyOf(fetchImpl, 0))
  })
})

describe('CA2 (0103): el hilo se lee también del registro', () => {
  it('CA2 (0103): sin la variable en el entorno pero con ella en el registro simulado, envía al hilo del registro', async () => {
    const { code, fetchImpl } = await run({
      registry: { VIGIA_TELEGRAM_THREAD_ID: REG_THREAD_ID },
      cwdEnv: ENV_UNRELATED
    })
    expect(code).toBe(0)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(bodyOf(fetchImpl, 0)).toMatchObject({
      message_thread_id: Number(REG_THREAD_ID),
      reply_parameters: { message_id: Number(REG_THREAD_ID), allow_sending_without_reply: false }
    })
  })

  it('CA2 (0103): con las tres variables solo en el registro, también envía al hilo', async () => {
    const { fetchImpl } = await run({
      env: {},
      registry: {
        VIGIA_TELEGRAM_TOKEN: REG_TOKEN,
        VIGIA_TELEGRAM_CHAT_ID: REG_CHAT_ID,
        VIGIA_TELEGRAM_THREAD_ID: REG_THREAD_ID
      },
      cwdEnv: ENV_UNRELATED
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(bodyOf(fetchImpl, 0)).toMatchObject({
      chat_id: REG_CHAT_ID,
      message_thread_id: Number(REG_THREAD_ID)
    })
  })
})

describe('CA3 (0103): un hilo que no es un entero positivo', () => {
  it.each(['hilo-xyz', '-48151', '48151.5', '48151abc', '0'])(
    'CA3 (0103): con VIGIA_TELEGRAM_THREAD_ID=%j envía sin hilo y avisa con [aviso telegram] sin el valor',
    async (value) => {
      const warnings = (text: string): number => text.split('[aviso telegram]').length - 1
      // Lo que se escribe sin la variable: el aviso del hilo tiene que ser una línea más.
      const baseline = await run({ cwdEnv: ENV_UNRELATED })
      const expected = warnings(`${baseline.stdout}\n${baseline.stderr}`) + 1
      captured = { stdout: [], stderr: [] }
      const { code, fetchImpl, stderr, stdout, all } = await run({
        env: { ...THREAD_ENV, VIGIA_TELEGRAM_THREAD_ID: value },
        cwdEnv: ENV_UNRELATED
      })
      expect(code).toBe(0)
      expect(fetchImpl).toHaveBeenCalledTimes(1)
      expectNoThread(bodyOf(fetchImpl, 0))
      expect(warnings(`${stdout}\n${stderr}`)).toBeGreaterThanOrEqual(expected)
      // «0» aparece en cualquier salida: solo se comprueban los valores reconocibles.
      if (value !== '0') expect(all).not.toContain(value)
    }
  )
})

describe('CA4 (0103): si Telegram rechaza el envío por el hilo, se reintenta una vez sin hilo', () => {
  const rejectThread = (): Promise<Response> =>
    telegramError('Bad Request: message to be replied not found')

  it.each([
    ['el segundo envío va bien', () => Promise.resolve(okResponse())],
    ['el segundo envío también falla', () => telegramError('Bad Request: chat not found')],
    ['el segundo envío da error de red', () => Promise.reject(new TypeError('fetch failed'))]
  ] as [string, FetchImpl][])(
    'CA4 (0103): %s: dos envíos, el segundo sin message_thread_id ni reply_parameters, y main devuelve 0',
    async (_case, second) => {
      const { code, fetchImpl, stdout, stderr } = await run({
        env: THREAD_ENV,
        fetchImpl: sequence(rejectThread, second),
        cwdEnv: ENV_UNRELATED
      })
      expect(code).toBe(0)
      expect(fetchImpl).toHaveBeenCalledTimes(2)
      const first = bodyOf(fetchImpl, 0)
      expect(first).toHaveProperty('message_thread_id', Number(THREAD_ID))
      const retry = bodyOf(fetchImpl, 1)
      expectNoThread(retry)
      expect(retry).toMatchObject({ chat_id: CHAT_ID, text: first.text })
      expect(`${stdout}\n${stderr}`).toContain('[aviso telegram]')
      expect(globalFetch).not.toHaveBeenCalled()
    }
  )

  it('CA4 (0103): con un 200 y ok: false en el envío con hilo, también reintenta una vez sin hilo', async () => {
    const { code, fetchImpl } = await run({
      env: THREAD_ENV,
      fetchImpl: sequence(
        () => telegramError('Bad Request: message to be replied not found', 200),
        () => Promise.resolve(okResponse())
      ),
      cwdEnv: ENV_UNRELATED
    })
    expect(code).toBe(0)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expectNoThread(bodyOf(fetchImpl, 1))
  })

  it('CA4 (0103): con el envío con hilo correcto, no hay segundo envío', async () => {
    const { fetchImpl } = await run({ env: THREAD_ENV, cwdEnv: ENV_UNRELATED })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('CA4 (0103): sin hilo, un error de Telegram no provoca reintento', async () => {
    const { code, fetchImpl } = await run({ fetchImpl: rejectThread, cwdEnv: ENV_UNRELATED })
    expect(code).toBe(0)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})

describe('CA5 (0103): el id del hilo no sale nunca', () => {
  const withThreadInDescription = (): Promise<Response> =>
    telegramError(
      `Bad Request: message ${THREAD_ID} to be replied not found in thread ${THREAD_ID}`
    )
  const withThreadInNetworkError = (): Promise<Response> =>
    Promise.reject(new TypeError(`request failed: message_thread_id=${THREAD_ID}`))

  const scenarios: [string, RunOptions][] = [
    ['envío correcto con hilo', { env: THREAD_ENV, cwdEnv: ENV_UNRELATED }],
    [
      'rechazo por el hilo con el id en la descripción y reintento correcto',
      {
        env: THREAD_ENV,
        fetchImpl: sequence(withThreadInDescription, () => Promise.resolve(okResponse())),
        cwdEnv: ENV_UNRELATED
      }
    ],
    [
      'rechazo por el hilo y reintento que también falla con el id',
      { env: THREAD_ENV, fetchImpl: withThreadInDescription, cwdEnv: ENV_UNRELATED }
    ],
    [
      'error de red con el id',
      { env: THREAD_ENV, fetchImpl: withThreadInNetworkError, cwdEnv: ENV_UNRELATED }
    ],
    ['sin .env (no envía)', { env: THREAD_ENV }],
    ['solo el hilo, sin token ni chat', { env: { VIGIA_TELEGRAM_THREAD_ID: THREAD_ID } }]
  ]

  it.each(scenarios)(
    'CA5 (0103): %s: el id del hilo no está en stdout, stderr ni en lo que devuelve main (ni el chat_id)',
    async (_case, options) => {
      const { all } = await run(options)
      expect(all).not.toContain(THREAD_ID)
      expect(all).not.toContain(CHAT_ID)
      expect(all).not.toContain(TOKEN_SECRET)
    }
  )

  it('CA5 (0103): con el hilo del registro y un rechazo que lo repite, tampoco sale', async () => {
    const { all } = await run({
      registry: { VIGIA_TELEGRAM_THREAD_ID: REG_THREAD_ID },
      fetchImpl: () => telegramError(`Bad Request: reply to ${REG_THREAD_ID} not found`),
      cwdEnv: ENV_UNRELATED
    })
    expect(all).not.toContain(REG_THREAD_ID)
  })
})

// Ficha 0106: cada aviso de una ficha responde al anterior de la misma ficha.
//
// Contrato que fijan estos tests (la ficha no lo detallaba):
// - `main(argv, deps)` acepta `deps.gitCommonDir()`: la carpeta donde se guarda el fichero de los
//   avisos (string, o undefined si no se sabe). Sin `deps.gitCommonDir` (los tests de la 0004, la
//   0103 y la 0105) no se lee ni se guarda nada, para no tocar el repositorio real. La entrada de
//   la línea de órdenes pasa la carpeta común de git.
// - El script exporta `resolveGitCommonDir(cwd)`: la ruta absoluta de
//   `git rev-parse --git-common-dir` desde `cwd`, o undefined si falla.
// - En la carpeta solo se crea un fichero (el de los avisos); su nombre lo decide el developer.
//   Los tests lo buscan como el único fichero nuevo de la carpeta.
// - Los problemas con el fichero se dicen en stderr con «[aviso telegram]», como en la 0103.

type Api0106 = {
  main: (
    argv: string[],
    deps: Deps & {
      gitCommonDir?: () => string | undefined
      capture?: (html: string) => Promise<Uint8Array[]>
    }
  ) => number | Promise<number>
  resolveGitCommonDir?: (cwd: string) => string | undefined
}
function api0106(): Api0106 {
  return api() as unknown as Api0106
}

type TgCall = { method: string; fields: Record<string, unknown> }

/** Telegram simulado con message_id crecientes desde `firstId`; lee JSON o multipart. */
function telegram0106(firstId: number): { fetchImpl: FetchImpl; calls: TgCall[] } {
  const calls: TgCall[] = []
  let next = firstId
  const fetchImpl: FetchImpl = async (url, init) => {
    const request = new Request(url, init)
    const method = String(url).split('/').pop() ?? ''
    const contentType = request.headers.get('content-type') ?? ''
    const fields: Record<string, unknown> = {}
    if (contentType.startsWith('multipart/form-data')) {
      const form = await request.formData()
      for (const [key, value] of form.entries()) {
        if (
          typeof value === 'string' &&
          (key === 'reply_parameters' || key === 'message_thread_id')
        )
          fields[key] = JSON.parse(value) as unknown
        else fields[key] = value
      }
    } else Object.assign(fields, JSON.parse(await request.text()) as Record<string, unknown>)
    calls.push({ method, fields })
    const messageId = next++
    return new Response(JSON.stringify({ ok: true, result: { message_id: messageId } }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })
  }
  return { fetchImpl, calls }
}

// PNG válido de 1x1 en escala de grises, para el camino de sendPhoto.
const PNG_1X1 = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108000000003a7e9b55' +
    '0000000a49444154789c636000000002000148afa4710000000049454e44ae426082',
  'hex'
)

type Run0106 = {
  commonDir: string
  firstId: number
  datos?: Datos
  env?: Record<string, string | undefined>
  capture?: (html: string) => Promise<Uint8Array[]>
  cwd?: string
}

async function run0106(options: Run0106): Promise<{
  code: unknown
  calls: TgCall[]
  stderr: string
}> {
  captured = { stdout: [], stderr: [] }
  let cwd = options.cwd
  if (cwd === undefined) {
    cwd = tempDir()
    writeFileSync(join(cwd, '.env.live.local'), ENV_UNRELATED)
  }
  const { fetchImpl, calls } = telegram0106(options.firstId)
  const deps: Parameters<Api0106['main']>[1] = {
    env: options.env ?? { VIGIA_TELEGRAM_TOKEN: TOKEN, VIGIA_TELEGRAM_CHAT_ID: CHAT_ID },
    platform: 'win32',
    readRegistry: () => undefined,
    cwd,
    mainCheckout: () => undefined,
    fetchImpl,
    stdout: (text) => void captured.stdout.push(String(text)),
    stderr: (text) => void captured.stderr.push(String(text)),
    gitCommonDir: () => options.commonDir
  }
  if (options.capture) deps.capture = options.capture
  const code = await api0106().main([inputFile(options.datos ?? tarea({ ficha: '0001' }))], deps)
  return { code, calls, stderr: captured.stderr.join('\n') }
}

/** El único fichero de la carpeta (el de los avisos). */
function avisosFile(commonDir: string): string {
  const files = readdirSync(commonDir)
  expect(files).toHaveLength(1)
  return join(commonDir, files[0] as string)
}
function avisos(commonDir: string): unknown {
  return JSON.parse(readFileSync(avisosFile(commonDir), 'utf8')) as unknown
}

const THREAD_ENV_0106 = {
  VIGIA_TELEGRAM_TOKEN: TOKEN,
  VIGIA_TELEGRAM_CHAT_ID: CHAT_ID,
  VIGIA_TELEGRAM_THREAD_ID: THREAD_ID
}

describe('CA1 (0106): el siguiente aviso de la misma ficha responde al anterior', () => {
  it('CA1 (0106): con sendMessage, el fichero guarda el message_id y el siguiente aviso de la 0001 responde a él', async () => {
    const commonDir = tempDir()
    const first = await run0106({ commonDir, firstId: 5001 })
    expect(first.code).toBe(0)
    expect(first.calls.map((call) => call.method)).toEqual(['sendMessage'])
    expect(first.calls[0]?.fields).not.toHaveProperty('reply_parameters')
    expect(avisos(commonDir)).toEqual({ '0001': 5001 })

    const second = await run0106({ commonDir, firstId: 5002 })
    expect(second.code).toBe(0)
    expect(second.calls).toHaveLength(1)
    expect(second.calls[0]?.fields).toMatchObject({
      reply_parameters: { message_id: 5001, allow_sending_without_reply: true }
    })
    expect(avisos(commonDir)).toEqual({ '0001': 5002 })
  })

  it('CA1 (0106): con hilo (0103), mantiene message_thread_id y responde al aviso anterior, no al que abre el hilo', async () => {
    const commonDir = tempDir()
    await run0106({ commonDir, firstId: 5101, env: THREAD_ENV_0106 })
    const second = await run0106({ commonDir, firstId: 5102, env: THREAD_ENV_0106 })
    expect(second.code).toBe(0)
    expect(second.calls).toHaveLength(1)
    expect(second.calls[0]?.fields).toMatchObject({
      message_thread_id: Number(THREAD_ID),
      reply_parameters: { message_id: 5101, allow_sending_without_reply: true }
    })
  })

  it('CA1 (0106): con sendPhoto en varias partes, se guarda el message_id de la primera y el siguiente aviso responde a ella', async () => {
    const commonDir = tempDir()
    const partes = (): Promise<Uint8Array[]> => Promise.resolve([PNG_1X1, PNG_1X1, PNG_1X1])
    const first = await run0106({ commonDir, firstId: 9100, capture: partes })
    expect(first.code).toBe(0)
    expect(first.calls.map((call) => call.method)).toEqual(['sendPhoto', 'sendPhoto', 'sendPhoto'])
    expect(first.calls[0]?.fields).not.toHaveProperty('reply_parameters')
    expect(avisos(commonDir)).toEqual({ '0001': 9100 })

    const second = await run0106({ commonDir, firstId: 9200, capture: partes })
    expect(second.code).toBe(0)
    expect(second.calls.map((call) => call.method)).toEqual(['sendPhoto', 'sendPhoto', 'sendPhoto'])
    expect(second.calls[0]?.fields).toMatchObject({
      reply_parameters: { message_id: 9100, allow_sending_without_reply: true }
    })
    // Las demás partes siguen respondiendo a la primera de su propio aviso (0105).
    expect(second.calls[1]?.fields).toMatchObject({ reply_parameters: { message_id: 9200 } })
    expect(avisos(commonDir)).toEqual({ '0001': 9200 })
  })
})

describe('CA2 (0106): un aviso de otra ficha no responde al de la 0001', () => {
  it('CA2 (0106): sin hilo, el aviso de la 0002 no lleva reply_parameters', async () => {
    const commonDir = tempDir()
    await run0106({ commonDir, firstId: 6001 })
    const other = await run0106({ commonDir, firstId: 6002, datos: tarea({ ficha: '0002' }) })
    expect(other.code).toBe(0)
    expect(other.calls).toHaveLength(1)
    expect(other.calls[0]?.fields).not.toHaveProperty('reply_parameters')
    expect(avisos(commonDir)).toEqual({ '0001': 6001, '0002': 6002 })
  })

  it('CA2 (0106): con hilo, el aviso de la 0002 responde al que abre el hilo (0103)', async () => {
    const commonDir = tempDir()
    await run0106({ commonDir, firstId: 6101, env: THREAD_ENV_0106 })
    const other = await run0106({
      commonDir,
      firstId: 6102,
      env: THREAD_ENV_0106,
      datos: tarea({ ficha: '0002' })
    })
    expect(other.code).toBe(0)
    expect(other.calls[0]?.fields).toMatchObject({
      message_thread_id: Number(THREAD_ID),
      reply_parameters: { message_id: Number(THREAD_ID), allow_sending_without_reply: false }
    })
  })
})

describe('CA3 (0106): con el fichero corrupto o ilegible, sale sin respuesta y con 0', () => {
  // El fichero se crea con un envío bien y luego se estropea, para no depender de su nombre.
  async function brokenAfterFirst(breakIt: (file: string) => void): Promise<void> {
    const commonDir = tempDir()
    await run0106({ commonDir, firstId: 7001 })
    breakIt(avisosFile(commonDir))
    const second = await run0106({ commonDir, firstId: 7002 })
    expect(second.code).toBe(0)
    expect(second.calls).toHaveLength(1)
    expect(second.calls[0]?.fields).not.toHaveProperty('reply_parameters')
    expect(second.stderr).toContain('[aviso telegram]')
  }

  it('CA3 (0106): JSON corrupto', async () => {
    await brokenAfterFirst((file) => writeFileSync(file, '{ "0001": 70'))
  })

  it('CA3 (0106): JSON con otra forma (message_id que no es un número)', async () => {
    await brokenAfterFirst((file) => writeFileSync(file, JSON.stringify({ '0001': 'abc' })))
  })

  it('CA3 (0106): JSON que no es un objeto', async () => {
    await brokenAfterFirst((file) => writeFileSync(file, JSON.stringify([7001])))
  })

  it('CA3 (0106): sin permiso de lectura (en su lugar hay una carpeta, que no se puede leer como fichero)', async () => {
    await brokenAfterFirst((file) => {
      rmSync(file)
      mkdirSync(file)
    })
  })

  it('CA3 (0106): si el fichero no existe, se envía como el primero y sale con 0', async () => {
    const commonDir = tempDir()
    const first = await run0106({ commonDir, firstId: 7101 })
    expect(first.code).toBe(0)
    expect(first.calls).toHaveLength(1)
    expect(first.calls[0]?.fields).not.toHaveProperty('reply_parameters')
  })
})

describe('CA4 (0106): como mucho 200 entradas y sin secretos', () => {
  it('CA4 (0106): tras 201 fichas distintas quedan 200, sin la más antigua', async () => {
    const commonDir = tempDir()
    const cwd = tempDir()
    writeFileSync(join(cwd, '.env.live.local'), ENV_UNRELATED)
    for (let n = 1; n <= 201; n++) {
      const ficha = String(n).padStart(4, '0')
      const { code } = await run0106({
        commonDir,
        cwd,
        firstId: 10000 + n,
        datos: tarea({ ficha })
      })
      expect(code).toBe(0)
    }
    const saved = avisos(commonDir) as Record<string, unknown>
    expect(Object.keys(saved)).toHaveLength(200)
    expect(saved).not.toHaveProperty('0001')
    expect(saved).toHaveProperty('0002', 10002)
    expect(saved).toHaveProperty('0201', 10201)
  }, 60_000)

  it('CA4 (0106): el fichero no contiene el token ni el chat_id', async () => {
    const commonDir = tempDir()
    await run0106({ commonDir, firstId: 8001, env: THREAD_ENV_0106 })
    await run0106({
      commonDir,
      firstId: 8002,
      env: THREAD_ENV_0106,
      datos: tarea({ ficha: '0002' })
    })
    const raw = readFileSync(avisosFile(commonDir), 'utf8')
    expect(raw).not.toContain(TOKEN_SECRET)
    expect(raw).not.toContain(CHAT_ID)
    expect(raw).not.toContain('chat_id')
    expect(raw.toLowerCase()).not.toContain('token')
  })
})

const { withoutGitVars } = (await import(
  pathToFileURL(join(__dirname, 'lib', 'git-env.mjs')).href
)) as { withoutGitVars: (env: NodeJS.ProcessEnv) => NodeJS.ProcessEnv }

describe('CA5 (0106): el fichero está en la carpeta común de git y git status no lo ve', () => {
  function git(cwd: string, args: string[]): string {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      env: withoutGitVars(process.env)
    }).trim()
  }

  /** Repositorio temporal con un commit y un worktree. */
  function repoWithWorktree(): { repo: string; worktree: string } {
    const repo = tempDir()
    git(repo, ['init', '-q', '-b', 'main'])
    git(repo, [
      '-c',
      'user.name=test',
      '-c',
      'user.email=test@example.invalid',
      'commit',
      '-q',
      '--allow-empty',
      '-m',
      'inicio'
    ])
    const worktree = join(tempDir(), 'wt')
    git(repo, ['worktree', 'add', '-q', '-b', 'otra', worktree])
    return { repo, worktree }
  }

  it('CA5 (0106): resolveGitCommonDir da la carpeta .git del checkout principal, también desde un worktree', () => {
    const { repo, worktree } = repoWithWorktree()
    const resolve = api0106().resolveGitCommonDir
    expect(typeof resolve).toBe('function')
    const expected = realpathSync(join(repo, '.git'))
    const fromWorktree = resolve?.(worktree)
    const fromRepo = resolve?.(repo)
    expect(fromWorktree).toBeDefined()
    expect(fromRepo).toBeDefined()
    expect(realpathSync(fromWorktree as string)).toBe(expected)
    expect(realpathSync(fromRepo as string)).toBe(expected)
  })

  it('CA5 (0106): tras un aviso desde un worktree, el fichero está en la carpeta común y git status sale limpio en los dos', async () => {
    const { repo, worktree } = repoWithWorktree()
    const commonDir = api0106().resolveGitCommonDir?.(worktree)
    expect(commonDir).toBeDefined()
    const dir = commonDir as string
    const before = new Set(readdirSync(dir))
    const { code } = await run0106({ commonDir: dir, firstId: 4242 })
    expect(code).toBe(0)
    const added = readdirSync(dir).filter((name) => !before.has(name))
    expect(added).toHaveLength(1)
    expect(JSON.parse(readFileSync(join(dir, added[0] as string), 'utf8'))).toEqual({
      '0001': 4242
    })
    expect(git(repo, ['status', '--porcelain', '--ignored', '--untracked-files=all'])).toBe('')
    expect(git(worktree, ['status', '--porcelain', '--ignored', '--untracked-files=all'])).toBe('')
  })

  it('CA5 (0106): la entrada de la línea de órdenes usa git rev-parse --git-common-dir', () => {
    expect(readFileSync(SCRIPT, 'utf8')).toContain('--git-common-dir')
  })
})
