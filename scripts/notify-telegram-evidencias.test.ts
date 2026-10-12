import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { deflateSync } from 'node:zlib'
import { parse } from 'parse5'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Evidencias visuales en el aviso de ficha hecha (ficha 0108): la sección «Evidencias» de la
 * tarjeta, con las capturas de los e2e que deja la 0107 (`test-results/evidencias/<ficha>/`, con su
 * `manifiesto.json`). Sin red ni navegador: `fetchImpl` y la captura van simulados, como en
 * `notify-telegram-image.test.ts`; el manifiesto y los PNG de prueba, en una carpeta temporal.
 *
 * Contrato que fijan estos tests (la ficha no lo detallaba):
 * - El campo `evidencias` del JSON del aviso es la ruta del manifiesto; aquí, siempre absoluta.
 * - «El repositorio» es la carpeta desde la que se lanza el script (`deps.cwd`, como ya pasa con
 *   `tasks/` y `.env.live.local`): los ficheros válidos están en `<cwd>/test-results/evidencias/`.
 * - El manifiesto es el de la 0107 (`e2e/evidence.ts`): un array con `criterio`, `titulo` (el del
 *   test, con el prefijo «CA1 (0018): »), `nota` (o `null`), `zona` y `ventana` (rutas relativas a
 *   la carpeta del manifiesto) y `estable`.
 * - El HTML de la tarjeta se lee del que recibe `deps.capture(html)` (0105), que sigue devolviendo
 *   la lista de PNG de las partes. Cada evidencia es un bloque `data-bloque="evidencia"` (la marca
 *   de la 0104), con sus dos `img` y su pie dentro, y no va dentro de otro bloque marcado.
 * - Las imágenes van en `data:image/png;base64,<los bytes del fichero>` cuando no hace falta
 *   reducirlas (CA1 a CA3).
 * - Los avisos de la terminal (fichero ignorado, evidencia quitada) van por `deps.stderr` con
 *   `[aviso telegram]`, como los de la 0105.
 */

const SCRIPT = join(__dirname, 'notify-telegram.mjs')
const CARD = join(__dirname, 'telegram-card.mjs')
const ROOT = join(__dirname, '..')

type Datos = {
  tipo: 'tarea' | 'version'
  ficha?: string
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
  evidencias?: string
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
type Api = { main: (argv: string[], deps: Deps) => number | Promise<number> }
type CardApi = { buildCardHtml: (datos: Datos) => string }

const loaded = existsSync(SCRIPT) ? ((await import(pathToFileURL(SCRIPT).href)) as Api) : undefined
// Precarga de la tarjeta (React, react-markdown, highlight.js…) al cargar el fichero, fuera del
// tiempo de cada test: si no, el primero que captura paga la importación en frío (ver 0105).
const card = existsSync(CARD) ? ((await import(pathToFileURL(CARD).href)) as CardApi) : undefined
function api(): Api {
  if (!loaded) throw new Error('No existe scripts/notify-telegram.mjs')
  return loaded
}
function buildCardHtml(datos: Datos): string {
  if (!card) throw new Error('No existe scripts/telegram-card.mjs')
  return card.buildCardHtml(datos)
}

// Credenciales inventadas con la forma de las reales (como en notify-telegram-image.test.ts).
const TOKEN = '123456789:AAFakeTokenInventado_XYZ-abc987'
const CHAT_ID = '987650001234'
const ENV = { VIGIA_TELEGRAM_TOKEN: TOKEN, VIGIA_TELEGRAM_CHAT_ID: CHAT_ID }

// .env de pruebas inventado (como en scan-tenant.test.ts).
const HOST = 'zz99fake.live.dynatrace.com'
const ENV_LIVE = ['# comentario', `DT_URL=https://${HOST}`, 'CORTO=abc', ''].join('\n')
const ENV_UNRELATED = 'DT_URL=https://qq11nadaquever.example.invalid\n'

const REPO = 'https://github.com/Danik0rZz/Vigia'
const AHORA = new Date('2026-10-12T10:30:00+02:00')
const FICHA = '0018'
const NOTA_FALTA = `evidencia en test-results/evidencias/${FICHA}`
const PHOTO_MAX_BYTES = 10_000_000

function tarea(overrides: Partial<Datos> = {}): Datos {
  return {
    tipo: 'tarea',
    ficha: FICHA,
    titulo: 'Gráfico de métricas',
    estado: 'hecha',
    resumen: '## Qué cambia\n\nEl gráfico enseña las series.',
    rondas: 1,
    verifier: 'VERDE',
    ci: `${REPO}/actions/runs/1234567890`,
    decision: '',
    duracion: '1 h 20 min',
    rama: 'feat/0018-grafico',
    pr: `${REPO}/pull/31`,
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
/** Una foto que pasa del peso de Telegram (10 MB) con una cabecera PNG válida. */
function heavyPng(): Buffer {
  return Buffer.concat([png(1600, 900, 200), Buffer.alloc(11 * 1024 * 1024)])
}

// --- Evidencias de prueba (manifiesto de la 0107 en una carpeta temporal) ---

type Entry = {
  criterio: string
  titulo: string
  nota: string | null
  zona: string
  ventana: string
  estable: boolean
}
/** Una evidencia con sus PNG (distintos entre sí, por el tono). */
type Evidence = { entry: Entry; zona: Buffer; ventana: Buffer }

function evidence(n: number, overrides: Partial<Entry> = {}): Evidence {
  const ca = `CA${n}`
  return {
    entry: {
      criterio: `${ca} (${FICHA})`,
      titulo: `${ca} (${FICHA}): enseña la evidencia número ${n}`,
      nota: null,
      zona: `${ca}-1-zona.png`,
      ventana: `${ca}-1-ventana.png`,
      estable: true,
      ...overrides
    },
    // Tonos distintos por evidencia y por captura: cada PNG tiene su base64 propio.
    zona: png(40 + n, 20 + n, (n * 2) % 256),
    ventana: png(102, 72, (n * 2 + 1) % 256)
  }
}

let dirs: string[] = []
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'vigia-telegram-ev-'))
  dirs.push(dir)
  return dir
}

/** Carpeta de las evidencias de la ficha dentro del «repositorio» (`cwd`). */
function evidenceDir(cwd: string): string {
  const dir = join(cwd, 'test-results', 'evidencias', FICHA)
  mkdirSync(dir, { recursive: true })
  return dir
}

/** Escribe los PNG y el manifiesto; devuelve la ruta absoluta del manifiesto. */
function writeEvidences(cwd: string, list: Evidence[]): string {
  const dir = evidenceDir(cwd)
  // Las rutas que salen de la carpeta (absolutas o con ..) las escribe cada test donde toca.
  const inside = (name: string): boolean => !isAbsolute(name) && !name.includes('..')
  for (const item of list) {
    if (inside(item.entry.zona)) writeFileSync(join(dir, item.entry.zona), item.zona)
    if (inside(item.entry.ventana)) writeFileSync(join(dir, item.entry.ventana), item.ventana)
  }
  const manifest = join(dir, 'manifiesto.json')
  writeFileSync(
    manifest,
    `${JSON.stringify(
      list.map((item) => item.entry),
      null,
      2
    )}\n`
  )
  return manifest
}

// --- Telegram simulado (como en notify-telegram-image.test.ts) ---

type Call = { method: string; contentType: string; form?: FormData; json?: Record<string, unknown> }

function telegramOk(messageId: number): Response {
  return new Response(JSON.stringify({ ok: true, result: { message_id: messageId } }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })
}

function telegram(): { fetchImpl: FetchImpl; calls: Call[] } {
  const calls: Call[] = []
  const fetchImpl: FetchImpl = async (url, init) => {
    const request = new Request(url, init)
    const method = String(url).split('/').pop() ?? ''
    const contentType = request.headers.get('content-type') ?? ''
    const call: Call = { method, contentType }
    if (contentType.startsWith('multipart/form-data')) call.form = await request.formData()
    else call.json = JSON.parse(await request.text()) as Record<string, unknown>
    calls.push(call)
    return telegramOk(7000 + calls.length)
  }
  return { fetchImpl, calls }
}

async function photoBytes(form: FormData | undefined): Promise<Buffer> {
  const photo = form?.get('photo')
  expect(photo).toBeInstanceOf(Blob)
  return Buffer.from(await (photo as Blob).arrayBuffer())
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
  cwd?: string
  datos?: Datos
  cwdEnv?: string
  capture?: (html: string) => Promise<Uint8Array[]>
}

async function run(options: RunOptions = {}): Promise<{
  code: unknown
  calls: Call[]
  htmls: string[]
  stderr: string
}> {
  const cwd = options.cwd ?? tempDir()
  writeFileSync(join(cwd, '.env.live.local'), options.cwdEnv ?? ENV_UNRELATED)
  const main = tempDir()
  const input = join(tempDir(), 'aviso.json')
  writeFileSync(input, JSON.stringify(options.datos ?? tarea()))
  const { fetchImpl, calls } = telegram()
  const htmls: string[] = []
  const shoot = options.capture ?? (() => Promise.resolve([png(1600, 900)]))
  const stderr: string[] = []
  const deps: Deps = {
    env: ENV,
    platform: 'win32',
    readRegistry: () => undefined,
    cwd,
    mainCheckout: () => main,
    fetchImpl,
    stdout: () => undefined,
    stderr: (text) => void stderr.push(String(text)),
    capture: (html) => {
      htmls.push(html)
      return shoot(html)
    }
  }
  const code = await api().main([input], deps)
  return { code, calls, htmls, stderr: stderr.join('\n') }
}

/** Ejecuta el aviso con estas evidencias en un repositorio temporal. */
async function runWith(
  list: Evidence[],
  options: Omit<RunOptions, 'cwd'> = {}
): ReturnType<typeof run> {
  const cwd = tempDir()
  const evidencias = writeEvidences(cwd, list)
  return run({ ...options, cwd, datos: options.datos ?? tarea({ evidencias }) })
}

// --- Lectura del HTML (como en telegram-card.test.ts) ---

type Attr = { name: string; value: string }
type Node = {
  nodeName: string
  tagName?: string
  attrs?: Attr[]
  value?: string
  childNodes?: Node[]
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
function textOf(node: Node): string {
  if (node.nodeName === '#text') return node.value ?? ''
  if (node.tagName === 'style' || node.tagName === 'script') return ''
  return (node.childNodes ?? []).map(textOf).join('')
}
function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
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
function evidenceBlocks(root: Node): Node[] {
  return elements(root).filter((el) => attr(el, 'data-bloque') === 'evidencia')
}
function imgSources(el: Node): string[] {
  return elements(el)
    .filter((child) => child.tagName === 'img')
    .map((img) => attr(img, 'src') ?? '')
}
function dataUri(bytes: Buffer): string {
  return `data:image/png;base64,${bytes.toString('base64')}`
}
/** El bloque de evidencia cuyo texto lleva el título (sin prefijo) de esa evidencia. */
function blockOf(root: Node, item: Evidence): Node | undefined {
  const title = shortTitle(item)
  return evidenceBlocks(root).find((el) => normalize(textOf(el)).includes(title))
}
function shortTitle(item: Evidence): string {
  return item.entry.titulo.replace(/^[^:]*:\s*/, '')
}

/** Comprueba que la evidencia sale entera en su bloque: zona, ventana, criterio, título y nota. */
function expectEvidenceShown(root: Node, item: Evidence): void {
  const found = blockOf(root, item)
  expect(found, `bloque de la evidencia ${item.entry.criterio}`).toBeDefined()
  const el = found as Node
  expect(imgSources(el)).toEqual([dataUri(item.zona), dataUri(item.ventana)])
  const text = normalize(textOf(el))
  expect(text).toContain(`${item.entry.criterio} · ${shortTitle(item)}`)
  // El título va sin el prefijo «CAn (NNNN): ».
  expect(text).not.toContain(`${item.entry.criterio}:`)
  if (item.entry.nota !== null) expect(text).toContain(item.entry.nota)
}

describe('CA1 (0108): sección «Evidencias» con zona y ventana de cada una, y su pie', () => {
  it('CA1 (0108): dos evidencias dan cuatro img data:image/png y, debajo de cada una, criterio, título y nota', async () => {
    const list = [
      evidence(1, { nota: 'el gráfico con dos series' }),
      evidence(2, { nota: 'la tabla ordenada por nombre' })
    ]
    const { code, calls, htmls } = await runWith(list)
    expect(code).toBe(0)
    expect(htmls.length).toBeGreaterThanOrEqual(1)
    expect(calls.map((call) => call.method)).not.toContain('sendMessage')
    const root = parseHtml(htmls.at(-1) ?? '')
    const all = elements(root)

    // Rótulo de la sección.
    expect(all.some((el) => normalize(textOf(el)) === 'Evidencias')).toBe(true)

    // Cuatro imágenes, todas en data:image/png.
    const blocks = evidenceBlocks(root)
    expect(blocks).toHaveLength(2)
    const sources = blocks.flatMap(imgSources)
    expect(sources).toHaveLength(4)
    for (const src of sources) expect(src.startsWith('data:image/png;base64,')).toBe(true)
    for (const item of list) expectEvidenceShown(root, item)

    // El pie de cada evidencia va debajo de sus dos capturas.
    for (const block of blocks) {
      const inside = elements(block)
      const lastImg = inside.map((el) => el.tagName).lastIndexOf('img')
      // El elemento más interno con el criterio va después de las imágenes.
      const captionEls = inside.filter((el) => /CA\d \(0018\)/.test(normalize(textOf(el))))
      expect(captionEls.length).toBeGreaterThan(0)
      expect(inside.indexOf(captionEls.at(-1) as Node)).toBeGreaterThan(lastImg)
    }

    // Debajo del resumen y antes del pie, y ningún bloque de evidencia dentro de otro bloque.
    const index = (el: Node): number => all.indexOf(el)
    const resumen = all.filter((el) => attr(el, 'data-bloque') === 'resumen')
    const pie = all.find((el) => attr(el, 'data-bloque') === 'pie')
    expect(resumen.length).toBeGreaterThan(0)
    expect(pie).toBeDefined()
    for (const block of blocks) {
      expect(index(block)).toBeGreaterThan(Math.max(...resumen.map(index)))
      expect(index(block)).toBeLessThan(index(pie as Node))
      expect(ancestors(block).some((a) => attr(a, 'data-bloque') !== undefined)).toBe(false)
    }
  })
})

describe('CA2 (0108): todas las evidencias, sin tope', () => {
  it('CA2 (0108): con 12 evidencias salen las 12, cada una en su bloque marcado', async () => {
    const list = Array.from({ length: 12 }, (_, i) => evidence(i + 1))
    const { code, htmls } = await runWith(list)
    expect(code).toBe(0)
    const root = parseHtml(htmls.at(-1) ?? '')
    const blocks = evidenceBlocks(root)
    expect(blocks).toHaveLength(12)
    expect(blocks.flatMap(imgSources)).toHaveLength(24)
    for (const item of list) expectEvidenceShown(root, item)
    // Una por bloque: ningún bloque lleva el título de otra.
    for (const block of blocks) {
      const text = normalize(textOf(block))
      expect(list.filter((item) => text.includes(`${item.entry.criterio} ·`))).toHaveLength(1)
    }
  })
})

describe('CA3 (0108): solo ficheros de test-results/evidencias y PNG', () => {
  async function expectIgnored(
    bad: Evidence,
    write: (cwd: string, dir: string) => void
  ): Promise<void> {
    const good = evidence(1, { nota: 'la buena' })
    const cwd = tempDir()
    const evidencias = writeEvidences(cwd, [good, bad])
    write(cwd, evidenceDir(cwd))
    const { code, calls, htmls, stderr } = await run({ cwd, datos: tarea({ evidencias }) })
    expect(code).toBe(0)
    expect(calls.map((call) => call.method)).toContain('sendPhoto')
    const html = htmls.at(-1) ?? ''
    // La mala no se pinta; la buena sí, entera.
    expect(html).not.toContain(bad.zona.toString('base64'))
    expectEvidenceShown(parseHtml(html), good)
    expect(stderr).toContain('[aviso telegram]')
    expect(stderr).toMatch(/evidencia/i)
  }

  it('CA3 (0108): una ruta con .. que sale de test-results/evidencias se ignora', async () => {
    const bad = evidence(2, { zona: '../../../fuera.png' })
    await expectIgnored(bad, (cwd) => writeFileSync(join(cwd, 'fuera.png'), bad.zona))
  })

  it('CA3 (0108): una ruta absoluta a otro sitio se ignora', async () => {
    const outside = join(tempDir(), 'otro-sitio.png')
    const bad = evidence(2, { zona: outside })
    await expectIgnored(bad, () => writeFileSync(outside, bad.zona))
  })

  it('CA3 (0108): un fichero que no es PNG (sin la firma) se ignora', async () => {
    const bad = evidence(2)
    bad.zona = Buffer.from('esto no es un PNG, aunque se llame .png\n')
    await expectIgnored(bad, (_, dir) => writeFileSync(join(dir, bad.entry.zona), bad.zona))
  })

  it('CA3 (0108): un manifiesto fuera de test-results/evidencias no pinta nada y se avisa', async () => {
    const cwd = tempDir()
    const item = evidence(1)
    writeEvidences(cwd, [item])
    // Copia del manifiesto y sus PNG fuera de la carpeta de evidencias (en el propio cwd).
    const otra = join(cwd, 'otra')
    mkdirSync(otra)
    writeFileSync(join(otra, item.entry.zona), item.zona)
    writeFileSync(join(otra, item.entry.ventana), item.ventana)
    writeFileSync(join(otra, 'manifiesto.json'), JSON.stringify([item.entry]))
    const { code, calls, htmls, stderr } = await run({
      cwd,
      datos: tarea({ evidencias: join(otra, 'manifiesto.json') })
    })
    expect(code).toBe(0)
    expect(calls.map((call) => call.method)).toContain('sendPhoto')
    const html = htmls.at(-1) ?? ''
    expect(evidenceBlocks(parseHtml(html))).toHaveLength(0)
    expect(html).not.toContain(item.zona.toString('base64'))
    expect(html).not.toContain(item.ventana.toString('base64'))
    expect(stderr).toContain('[aviso telegram]')
    expect(stderr).toMatch(/evidencia/i)
  })
})

describe('CA4 (0108): una evidencia que se pasa del peso de foto', () => {
  /**
   * Captura simulada que «parte» como la 0105 con cortes entre bloques: una parte con los bloques
   * de antes de la primera evidencia, una por evidencia y una con los de después. Una evidencia
   * pesa más de 10 MB cuando `heavy(bloque, html)` lo dice.
   */
  function splitCapture(heavy: (block: Node, html: string) => boolean) {
    return (html: string): Promise<Uint8Array[]> => {
      const root = parseHtml(html)
      const marked = elements(root).filter((el) => attr(el, 'data-bloque') !== undefined)
      const parts: Buffer[] = []
      let pending = false
      for (const el of marked) {
        if (attr(el, 'data-bloque') === 'evidencia') {
          if (pending) parts.push(png(1600, 900, 10))
          pending = false
          parts.push(heavy(el, html) ? heavyPng() : png(1600, 700, 20))
        } else pending = true
      }
      if (pending) parts.push(png(1600, 300, 30))
      return Promise.resolve(parts)
    }
  }

  function hasImage(block: Node): boolean {
    return imgSources(block).length > 0
  }

  async function sentPhotos(calls: Call[]): Promise<Buffer[]> {
    return Promise.all(
      calls.filter((call) => call.method === 'sendPhoto').map((call) => photoBytes(call.form))
    )
  }

  /** Texto de lo enviado: el de la última tarjeta capturada y los pies de las fotos. */
  function sentText(htmls: string[], calls: Call[]): string {
    const captions = calls
      .filter((call) => call.method === 'sendPhoto')
      .map((call) => String(call.form?.get('caption') ?? '').replace(/<[^>]*>/g, ''))
    return normalize([textOf(parseHtml(htmls.at(-1) ?? '')), ...captions].join(' '))
  }

  it('CA4 (0108): se reduce hasta caber y sale con sus dos capturas, sin la nota', async () => {
    const a = evidence(1)
    const b = evidence(2)
    let first: string | undefined
    // Pesa mientras la tarjeta sea la original: hay que cambiarla (reducir la evidencia) para caber.
    const capture = splitCapture((block, html) => {
      first ??= html
      return html === first && blockMatches(block, b) && hasImage(block)
    })
    const { code, calls, htmls, stderr } = await runWith([a, b], { capture })
    expect(code).toBe(0)
    expect(htmls.length).toBeGreaterThanOrEqual(2)
    expect(calls.map((call) => call.method)).not.toContain('sendMessage')
    const photos = await sentPhotos(calls)
    expect(photos.length).toBeGreaterThan(0)
    for (const photo of photos) expect(photo.length).toBeLessThanOrEqual(PHOTO_MAX_BYTES)
    const root = parseHtml(htmls.at(-1) ?? '')
    expectEvidenceShown(root, a)
    const reduced = blockOf(root, b)
    expect(reduced, 'la evidencia reducida sigue en la tarjeta').toBeDefined()
    const sources = imgSources(reduced as Node)
    expect(sources).toHaveLength(2)
    for (const src of sources) expect(src.startsWith('data:image/')).toBe(true)
    expect(sentText(htmls, calls)).not.toContain(NOTA_FALTA)
    expect(stderr).not.toContain(NOTA_FALTA)
  })

  it('CA4 (0108): si no cabe de ninguna forma, la parte sale sin ella y con la nota, y sale con 0', async () => {
    const a = evidence(1, { nota: 'la que cabe' })
    const b = evidence(2)
    // Pesa siempre que lleve alguna imagen, por mucho que se reduzca.
    const capture = splitCapture((block) => blockMatches(block, b) && hasImage(block))
    const { code, calls, htmls, stderr } = await runWith([a, b], { capture })
    expect(code).toBe(0)
    // Nunca se deja de enviar el aviso, y sigue siendo la imagen.
    expect(calls.map((call) => call.method)).not.toContain('sendMessage')
    const photos = await sentPhotos(calls)
    expect(photos.length).toBeGreaterThan(0)
    for (const photo of photos) expect(photo.length).toBeLessThanOrEqual(PHOTO_MAX_BYTES)
    const root = parseHtml(htmls.at(-1) ?? '')
    expectEvidenceShown(root, a)
    const left = blockOf(root, b)
    if (left !== undefined) expect(hasImage(left)).toBe(false)
    expect(htmls.at(-1)).not.toContain(b.zona.toString('base64'))
    expect(htmls.at(-1)).not.toContain(b.ventana.toString('base64'))
    expect(sentText(htmls, calls)).toContain(NOTA_FALTA)
    expect(stderr).toContain('[aviso telegram]')
    expect(stderr).toMatch(/evidencia/i)
  })

  function blockMatches(block: Node, item: Evidence): boolean {
    return normalize(textOf(block)).includes(shortTitle(item))
  }
})

describe('CA5 (0108): sin evidencias, la tarjeta de la 0105', () => {
  it('CA5 (0108): sin el campo evidencias, el HTML es el de buildCardHtml para el mismo JSON', async () => {
    const datos = tarea()
    const { code, htmls } = await run({ datos })
    expect(code).toBe(0)
    expect(htmls).toHaveLength(1)
    expect(htmls[0]).toBe(buildCardHtml(datos))
    expect(evidenceBlocks(parseHtml(htmls[0] ?? ''))).toHaveLength(0)
  })
})

describe('CA6 (0108): los títulos del manifiesto pasan por el filtro del tenant', () => {
  it('CA6 (0108): un título con un valor del tenant hace que no se envíe nada', async () => {
    const item = evidence(1, { titulo: `CA1 (${FICHA}): visto en ${HOST}` })
    const { code, calls, htmls, stderr } = await runWith([item], { cwdEnv: ENV_LIVE })
    expect(code).toBe(0)
    expect(htmls).toHaveLength(0)
    expect(calls).toHaveLength(0)
    expect(stderr).toContain('[aviso telegram]')
    expect(stderr).not.toContain(HOST)
  })

  it('CA6 (0108): control: el mismo manifiesto sin el valor del tenant sí se envía', async () => {
    const item = evidence(1)
    const { code, calls } = await runWith([item], { cwdEnv: ENV_LIVE })
    expect(code).toBe(0)
    expect(calls.map((call) => call.method)).toContain('sendPhoto')
  })
})

describe('CA7 (0108): tarea.md pide el campo evidencias en el aviso de hecha', () => {
  it('CA7 (0108): .claude/commands/tarea.md', () => {
    const text = readFileSync(join(ROOT, '.claude/commands/tarea.md'), 'utf8')
    const paragraphs = text.split(/\r?\n\s*\r?\n/).map((p) => p.replace(/\s+/g, ' '))
    const paragraph = paragraphs.find((p) => p.includes('`evidencias`')) ?? ''
    expect(paragraph, 'ningún párrafo de tarea.md habla del campo `evidencias`').not.toBe('')
    expect(paragraph).toMatch(/manifiesto/i)
    expect(paragraph).toMatch(/verifier/i)
    expect(paragraph).toMatch(/hecha/)
  })
})
