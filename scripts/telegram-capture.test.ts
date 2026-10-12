import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * Captura de la tarjeta con el Electron del proyecto (ficha 0105, CA6, CA7 y CA9). Electron de
 * verdad, sin red: las páginas son la tarjeta de la 0104 (con datos inventados) o páginas de
 * prueba escritas aquí.
 *
 * Contrato que fijan estos tests (la ficha daba el nombre como ejemplo):
 * - `scripts/telegram-capture.cjs` se lanza con el binario de Electron del proyecto:
 *   `electron scripts/telegram-capture.cjs --html <fichero.html> --out <carpeta> [--max-height <px>]`.
 *   `--max-height` es el alto máximo de cada parte en píxeles de la imagen (a escala 2); sin él,
 *   el que fije el developer.
 * - Deja en `<carpeta>` un PNG por parte, con el número de la parte en el nombre
 *   (`parte-1.png`, `parte-2.png`…), y sale con 0 si la captura ha ido bien.
 *
 * Las posiciones de las marcas `data-bloque` y el alto del contenido se miden aparte, con un
 * script de Electron propio de los tests (una ventana oculta de 800 px, como la de la captura, y
 * después del evento `load`): no se fían de lo que diga el script de captura.
 */

const SCRIPT = join(__dirname, 'telegram-capture.cjs')
const { withoutGitVars } = (await import(
  pathToFileURL(join(__dirname, 'lib', 'git-env.mjs')).href
)) as { withoutGitVars: (env: NodeJS.ProcessEnv) => NodeJS.ProcessEnv }
const ELECTRON = createRequire(import.meta.url)('electron') as unknown as string
const ELECTRON_TIMEOUT = 90_000
const AHORA = new Date('2026-10-12T10:30:00+02:00')

type CardApi = { buildCardHtml: (datos: Record<string, unknown>) => string }
const card = (await import(pathToFileURL(join(__dirname, 'telegram-card.mjs')).href)) as CardApi

function cardHtml(datos: Record<string, unknown>): string {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(AHORA)
  try {
    return card.buildCardHtml({
      tipo: 'tarea',
      ficha: '0105',
      titulo: 'Aviso en imagen',
      estado: 'hecha',
      rondas: 1,
      verifier: 'VERDE',
      ci: 'https://github.com/Danik0rZz/Vigia/actions/runs/1234567890',
      decision: '',
      duracion: '1 h',
      rama: 'feat/0105-telegram-aviso-en-imagen',
      pr: 'https://github.com/Danik0rZz/Vigia/pull/31',
      ...datos
    })
  } finally {
    vi.useRealTimers()
  }
}

/** Párrafos de texto inventado, cada uno de varias líneas a 800 px. */
function parrafos(n: number): string {
  return Array.from(
    { length: n },
    (_, i) =>
      `Párrafo ${i + 1}: el aviso sale como imagen con su pie de texto, se captura con Electron ` +
      'en una ventana oculta y se manda con sendPhoto; si algo falla, se envía el texto de siempre.'
  ).join('\n\n')
}

/** Imagen `data:` (SVG) sin tamaño en la etiqueta: su alto solo se sabe cuando carga. */
function dataImage(height: number): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="${height}"><rect width="400" height="${height}" fill="#D97757"/></svg>`
  return `<img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" alt="">`
}

function withImage(html: string, height: number): string {
  expect(html).toContain('</main>')
  return html.replace('</main>', `${dataImage(height)}</main>`)
}

// --- Electron ---

const dirs: string[] = []
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'vigia-capture-'))
  dirs.push(dir)
  return dir
}

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

function electronEnv(): NodeJS.ProcessEnv {
  const env = withoutGitVars(process.env)
  delete env.ELECTRON_RUN_AS_NODE
  return env
}

function runElectron(args: string[]): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(ELECTRON, args, { env: electronEnv(), windowsHide: true })
    let output = ''
    child.stdout.on('data', (data: Buffer) => (output += data.toString()))
    child.stderr.on('data', (data: Buffer) => (output += data.toString()))
    const timer = setTimeout(() => child.kill(), ELECTRON_TIMEOUT - 5_000)
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ code: -1, output: `${output}\n${error.message}` })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, output })
    })
  })
}

type Png = { file: string; width: number; height: number }

function readPng(file: string): Png {
  const data = readFileSync(file)
  expect(
    data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    `${file} no tiene la firma PNG`
  ).toBe(true)
  expect(data.subarray(12, 16).toString('ascii')).toBe('IHDR')
  return { file, width: data.readUInt32BE(16), height: data.readUInt32BE(20) }
}

/** Captura `html` con el script de la ficha y devuelve sus PNG, en orden de parte. */
async function capture(html: string, maxHeight?: number): Promise<Png[]> {
  if (!existsSync(SCRIPT)) throw new Error('No existe scripts/telegram-capture.cjs')
  const dir = tempDir()
  const file = join(dir, 'tarjeta.html')
  writeFileSync(file, html)
  const out = join(dir, 'salida')
  const args = [SCRIPT, '--html', file, '--out', out]
  if (maxHeight !== undefined) args.push('--max-height', String(maxHeight))
  const { code, output } = await runElectron(args)
  expect(code, `la captura ha salido con ${code}:\n${output}`).toBe(0)
  const number = (name: string): number => Number(/(\d+)/.exec(name)?.[1] ?? NaN)
  const files = readdirSync(out)
    .filter((name) => name.toLowerCase().endsWith('.png'))
    .sort((a, b) => number(a) - number(b))
  expect(files.length, 'la captura no ha dejado ningún PNG').toBeGreaterThan(0)
  return files.map((name) => readPng(join(out, name)))
}

// Script de medida de los tests: una ventana oculta de 800 px, sin nodeIntegration y en sandbox,
// que tras `load` devuelve el alto del documento y la caja de cada marca `data-bloque`. Escala 1
// forzada: sin ella, Chromium usa la de la pantalla (p. ej. 150 %) y redondea el diseño a otros
// píxeles CSS que la captura.
const MEASURE = `
const { app, BrowserWindow } = require('electron')
const { writeFileSync } = require('node:fs')
app.commandLine.appendSwitch('force-device-scale-factor', '1')
const args = process.argv.slice(process.argv.findIndex((a) => a.endsWith('medir.cjs')) + 1)
const [html, out] = args
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 800,
    height: 50,
    useContentSize: true,
    webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true }
  })
  await win.loadFile(html)
  const inPage = () => ({
    height: document.documentElement.scrollHeight,
    blocks: [...document.querySelectorAll('[data-bloque]')].map((el) => {
      const r = el.getBoundingClientRect()
      return { name: el.dataset.bloque, top: r.top + window.scrollY, bottom: r.bottom + window.scrollY }
    })
  })
  const data = await win.webContents.executeJavaScript('(' + inPage.toString() + ')()')
  writeFileSync(out, JSON.stringify(data))
  app.quit()
}).catch((error) => {
  console.error(error)
  app.exit(1)
})
`

type Block = { name: string; top: number; bottom: number }
type Measure = { height: number; blocks: Block[] }

async function measure(html: string): Promise<Measure> {
  const dir = tempDir()
  const script = join(dir, 'medir.cjs')
  writeFileSync(script, MEASURE)
  const file = join(dir, 'tarjeta.html')
  writeFileSync(file, html)
  const out = join(dir, 'medida.json')
  const { code, output } = await runElectron([script, file, out])
  expect(code, `la medida ha salido con ${code}:\n${output}`).toBe(0)
  return JSON.parse(readFileSync(out, 'utf8')) as Measure
}

// Margen en píxeles CSS para los redondeos de la escala.
const TOL = 1.5

describe('CA6 (0105): captura con el Electron del proyecto', () => {
  it(
    'CA6 (0105): PNG válido, de 1600 px de ancho y con el alto del contenido, con la imagen data: ya cargada',
    async () => {
      const corto = cardHtml({ resumen: 'Resumen corto.' })
      const largo = cardHtml({ resumen: parrafos(12) })
      const conImagen = withImage(corto, 900)

      const [cortoPng, largoPng, imagenPng] = await Promise.all([
        capture(corto, 8000),
        capture(largo, 8000),
        capture(conImagen, 8000)
      ])
      for (const parts of [cortoPng, largoPng, imagenPng]) {
        expect(parts).toHaveLength(1)
        expect(parts[0]?.width).toBe(1600)
      }
      const alto = (parts: Png[]): number => parts[0]?.height ?? 0

      // Más alto con un resumen largo que con uno corto.
      expect(alto(largoPng)).toBeGreaterThan(alto(cortoPng))
      // La imagen data: cuenta: se ha medido después de que cargara (900 px CSS más, a escala 2).
      expect(alto(imagenPng) - alto(cortoPng)).toBeGreaterThanOrEqual(2 * 900 - 4)

      // El alto, el del contenido (medido aparte), a escala 2.
      const [mCorto, mImagen] = await Promise.all([measure(corto), measure(conImagen)])
      expect(Math.abs(alto(cortoPng) - 2 * mCorto.height)).toBeLessThanOrEqual(2 * TOL)
      expect(Math.abs(alto(imagenPng) - 2 * mImagen.height)).toBeLessThanOrEqual(2 * TOL)
    },
    ELECTRON_TIMEOUT * 2
  )
})

describe('CA7 (0105): la ventana de captura, cerrada', () => {
  let server: ReturnType<typeof createServer>
  let port = 0
  const connections: string[] = []

  beforeAll(async () => {
    server = createServer((socket: Socket) => {
      connections.push(`${socket.remoteAddress}:${socket.remotePort}`)
      socket.destroy()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    port = typeof address === 'object' && address ? address.port : 0
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it(
    'CA7 (0105): las peticiones https:// metidas en la página no salen y la página no llega a Node',
    async () => {
      const marker = join(tempDir(), 'fuga.txt')
      const base = `https://127.0.0.1:${port}`
      // Sin CSP: lo que corta las peticiones tiene que ser la ventana, no la página.
      const html = [
        '<!doctype html>',
        '<html lang="es"><head><meta charset="utf-8">',
        `<link rel="stylesheet" href="${base}/estilo.css">`,
        '</head>',
        '<body style="width:800px;margin:0">',
        '<main data-bloque="cabecera"><p>Página de prueba</p>',
        `<img src="${base}/fuga.png" alt="">`,
        `<iframe src="${base}/marco"></iframe>`,
        '</main>',
        '<script>',
        `try { require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'require') } catch {}`,
        `try { process.mainModule.require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'process') } catch {}`,
        `try { fetch('${base}/fetch') } catch {}`,
        `try { window.open('${base}/ventana') } catch {}`,
        `setTimeout(() => { location.href = '${base}/navega' }, 0)`,
        '</script>',
        '</body></html>'
      ].join('\n')

      const parts = await capture(html, 8000)
      expect(parts.length).toBeGreaterThan(0)
      // Lo que esté de camino.
      await new Promise((resolve) => setTimeout(resolve, 500))
      expect(connections, 'alguna petición de la página ha llegado al servidor').toEqual([])
      expect(existsSync(marker), 'la página ha podido usar Node').toBe(false)
    },
    ELECTRON_TIMEOUT
  )

  it('CA7 (0105): la ventana se crea con sandbox y sin nodeIntegration', () => {
    if (!existsSync(SCRIPT)) throw new Error('No existe scripts/telegram-capture.cjs')
    const source = readFileSync(SCRIPT, 'utf8')
    expect(source).toMatch(/sandbox\s*:\s*true/)
    expect(source).not.toMatch(/nodeIntegration\s*:\s*true/)
    expect(source).not.toMatch(/sandbox\s*:\s*false/)
  })
})

describe('CA9 (0105): una tarjeta más alta que el máximo, en partes entre bloques', () => {
  it(
    'CA9 (0105): varias imágenes, ninguna más alta que el máximo salvo un bloque que solo lo pasa, y los cortes entre marcas',
    async () => {
      const MAX = 1200
      const codigo = Array.from({ length: 90 }, (_, i) => `const linea${i} = ${i}`).join('\n')
      const resumen = `${parrafos(10)}\n\n\`\`\`ts\n${codigo}\n\`\`\`\n\n${parrafos(8)}`
      const html = cardHtml({ resumen, decision: '¿Se fusiona? 1) sí 2) no' })

      const [parts, medida] = await Promise.all([capture(html, MAX), measure(html)])
      expect(parts.length).toBeGreaterThanOrEqual(3)
      for (const part of parts) expect(part.width).toBe(1600)

      // Las partes cubren la tarjeta entera.
      const total = parts.reduce((sum, part) => sum + part.height, 0)
      expect(Math.abs(total - 2 * medida.height)).toBeLessThanOrEqual(2 * TOL * parts.length)

      // El bloque de código pasa por sí solo del máximo (si no, el test no prueba ese caso).
      const pre = medida.blocks.filter((b) => 2 * (b.bottom - b.top) > MAX)
      expect(pre).toHaveLength(1)

      let start = 0
      for (const [i, part] of parts.entries()) {
        const end = start + part.height / 2
        // Ningún corte cae dentro de un bloque.
        if (i < parts.length - 1)
          for (const b of medida.blocks)
            expect(
              b.top + TOL < end && end < b.bottom - TOL,
              `el corte ${i + 1} (y=${end}) parte el bloque ${b.name} (${b.top}–${b.bottom})`
            ).toBe(false)
        if (part.height > MAX) {
          // Solo puede ser la parte del bloque que ya pasa del máximo, y va sola.
          const dentro = medida.blocks.filter(
            (b) => Math.min(b.bottom, end) - Math.max(b.top, start) > TOL
          )
          expect(dentro.map((b) => b.name)).toEqual([pre[0]?.name])
          expect(dentro[0]).toEqual(pre[0])
        }
        start = end
      }
    },
    ELECTRON_TIMEOUT * 2
  )
})
