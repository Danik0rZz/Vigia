import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

describe('CA8 (0004): sin .env.live.local', () => {
  it('CA8 (0004): sin .env en el directorio ni en el checkout principal, envía y avisa de que no se ha filtrado', async () => {
    const { code, fetchImpl, stderr } = await run({})
    expect(code).toBe(0)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(stderr).toContain('[aviso telegram]')
    expect(stderr).toMatch(/filtr/i)
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
    ['envío sin .env', {}],
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
