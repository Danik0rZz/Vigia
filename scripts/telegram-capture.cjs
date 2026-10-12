// Captura de la tarjeta del aviso de Telegram (ficha 0105).
//
// Uso (con el binario de Electron del proyecto, no con Node):
//   electron scripts/telegram-capture.cjs --html <fichero.html> --out <carpeta> [--max-height <px>]
//
// Abre el HTML de la 0104 en una ventana oculta de 800 px a escala 2 (la imagen sale de 1600 px de
// ancho), mide el alto con `document.documentElement.scrollHeight` cuando ha cargado todo (también
// las imágenes `data:`), y deja en <carpeta> `parte-1.png`, `parte-2.png`… Sale con 0 si ha ido
// bien y con otro código si no (notify-telegram.mjs envía entonces el texto de siempre).
//
// Partes: si la tarjeta pasa de `--max-height` (en píxeles de la imagen; por defecto
// DEFAULT_MAX_HEIGHT), se parte entre bloques (las marcas `data-bloque` de la 0104), nunca por la
// mitad de uno. Un bloque que solo ya pasa del máximo va en su propia parte. Ninguna parte pasa
// del límite de Telegram (ancho más alto hasta 10 000 px): un bloque más alto que eso se corta.
//
// Ventana cerrada a todo (el contenido lo escriben los agentes): `sandbox`, sin `nodeIntegration`,
// sin preload, sesión en memoria propia en la que se cancela toda petición que no sea el propio
// documento o `data:`, sin permisos, sin navegación ni ventanas nuevas y sin herramientas de
// desarrollo. El JavaScript de la medida lo ejecuta este script; la tarjeta no lleva scripts y su
// CSP (0104) los bloquea.
'use strict'

const { app, BrowserWindow, session } = require('electron')
const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { fileURLToPath, pathToFileURL } = require('node:url')

const WIDTH = 800
const SCALE = 2
// Alto máximo de cada parte, en píxeles de la imagen (1600 × 3200, proporción 2): Telegram reduce
// las fotos a unos 2 560 px por el lado largo, y a 1 280 px de ancho la tarjeta se sigue leyendo
// en el móvil. El prototipo mandó una de 1600 × 3750 sin problemas.
const DEFAULT_MAX_HEIGHT = 3200
// Límite de Telegram para fotos: ancho más alto hasta 10 000 px (y proporción hasta 20).
const HARD_MAX_HEIGHT = 10_000 - WIDTH * SCALE
// Tiempo máximo de todo el script (notify-telegram.mjs tiene el suyo, algo menor).
const SELF_TIMEOUT_MS = 60_000

function fail(message) {
  // Se sale cuando el mensaje ha llegado a la tubería (app.exit no espera).
  process.stderr.write(`[captura] ${message}\n`, () => app.exit(1))
}

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i]
    if (key === '--html' || key === '--out' || key === '--max-height')
      args[key.slice(2)] = argv[++i]
  }
  return args
}

/**
 * Cortes de la tarjeta, en píxeles CSS: una lista de `[inicio, fin)` que cubre `[0, height)`.
 * `blocks` son las cajas de las marcas, `max` y `hard` en píxeles CSS.
 */
function planParts(height, blocks, max, hard) {
  const sorted = [...blocks].sort((a, b) => a.top - b.top)
  // Cortes posibles: en medio del hueco entre un bloque y todo lo anterior.
  const cuts = []
  let bottom = -Infinity
  for (const block of sorted) {
    if (bottom !== -Infinity && block.top >= bottom - 0.5) {
      const cut = Math.round((bottom + Math.max(bottom, block.top)) / 2)
      if (cut > 0 && cut < height) cuts.push(cut)
    }
    bottom = Math.max(bottom, block.bottom)
  }
  const unique = [...new Set(cuts)].sort((a, b) => a - b)

  const parts = []
  let start = 0
  while (start < height) {
    let end
    if (height - start <= max) end = height
    else {
      const fitting = unique.filter((cut) => cut > start && cut - start <= max)
      // El corte más lejano que cabe; si no cabe ninguno, el siguiente (un bloque que solo ya
      // pasa del máximo va en su propia parte).
      end = fitting.length > 0 ? fitting[fitting.length - 1] : unique.find((cut) => cut > start)
      if (end === undefined) end = height
    }
    // Nunca más del límite de Telegram, aunque haya que partir un bloque.
    while (end - start > hard) {
      parts.push([start, start + hard])
      start += hard
    }
    if (end > start) parts.push([start, end])
    start = end
  }
  return parts
}

// Se ejecuta en la página (desde este script, no desde la tarjeta): alto y cajas de las marcas,
// o null si aún no han cargado las fuentes. Síncrono, como todo lo que se ejecuta en la página
// (ver `evaluate`).
const MEASURE = `(() => {
  if (document.fonts.status !== 'loaded') return null
  return {
    height: document.documentElement.scrollHeight,
    blocks: [...document.querySelectorAll('[data-bloque]')].map((el) => {
      const r = el.getBoundingClientRect()
      return { top: r.top + window.scrollY, bottom: r.bottom + window.scrollY }
    })
  }
})()`

// Tiempo máximo de cada llamada a la página y de cada espera, y cada cuánto se pregunta.
const EVALUATE_TIMEOUT_MS = 5_000
const WAIT_TIMEOUT_MS = 15_000
const POLL_MS = 25

/**
 * `executeJavaScript` con tiempo máximo, solo con código síncrono. Si el código devuelve una
 * promesa y la página intenta navegar mientras tanto (la navegación se cancela, arriba), Electron
 * pierde el resultado y la promesa no se resuelve nunca, ni la de esa llamada ni las siguientes
 * que esperen algo; las síncronas siguen respondiendo. Se vio en el CI de Windows con la máquina
 * cargada (0105, CA7). Por eso las esperas se hacen preguntando desde aquí (`waitFor`).
 */
async function evaluate(contents, code) {
  let timer
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('la página no responde')), EVALUATE_TIMEOUT_MS)
  })
  try {
    return await Promise.race([contents.executeJavaScript(code), timeout])
  } finally {
    clearTimeout(timer)
  }
}

/** Repite `code` (síncrono) hasta que devuelve algo que no es null. */
async function waitFor(contents, code, what) {
  const deadline = Date.now() + WAIT_TIMEOUT_MS
  for (;;) {
    const value = await evaluate(contents, code)
    if (value !== null && value !== undefined) return value
    if (Date.now() > deadline) throw new Error(`tiempo agotado esperando ${what}`)
    await new Promise((resolveWait) => setTimeout(resolveWait, POLL_MS))
  }
}

// Marca de los fotogramas pintados tras desplazar, en una propiedad que no se enumera.
const FRAMES_KEY = '__vigiaCapturaFrames'

/** Espera dos fotogramas (lo desplazado ya está pintado) y devuelve el desplazamiento. */
async function waitFrames(contents) {
  await evaluate(
    contents,
    `(() => {
      const key = ${JSON.stringify(FRAMES_KEY)}
      Object.defineProperty(window, key, { value: false, writable: true, configurable: true })
      requestAnimationFrame(() => requestAnimationFrame(() => { window[key] = true }))
    })()`
  )
  return waitFor(
    contents,
    `window[${JSON.stringify(FRAMES_KEY)}] === true ? window.scrollY : null`,
    'a que se pinte la página'
  )
}

async function run(args) {
  if (!args.html || !args.out) throw new Error('faltan --html o --out')
  const maxImage =
    args['max-height'] === undefined ? DEFAULT_MAX_HEIGHT : Number(args['max-height'])
  if (!Number.isFinite(maxImage) || maxImage < 2 * SCALE) throw new Error('--max-height no válido')
  const max = Math.floor(Math.min(maxImage, HARD_MAX_HEIGHT) / SCALE)
  const hard = Math.floor(HARD_MAX_HEIGHT / SCALE)
  const htmlPath = resolve(args.html)
  const documentUrl = pathToFileURL(htmlPath).href
  // El propio documento (file:), comparado por su ruta: la codificación de la URL puede variar.
  const isDocument = (url) => {
    if (!url.startsWith('file:')) return false
    try {
      return resolve(fileURLToPath(url.split('#')[0])).toLowerCase() === htmlPath.toLowerCase()
    } catch {
      return false
    }
  }

  // Sesión en memoria, solo para esta ventana.
  const captureSession = session.fromPartition('vigia-captura', { cache: false })
  captureSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !(details.url.startsWith('data:') || isDocument(details.url)) })
  })
  captureSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  captureSession.setPermissionCheckHandler(() => false)

  const win = new BrowserWindow({
    show: false,
    width: WIDTH,
    // Baja: scrollHeight nunca es menor que la ventana, y una tarjeta corta saldría con relleno.
    height: 50,
    useContentSize: true,
    paintWhenInitiallyHidden: true,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      devTools: false,
      spellcheck: false,
      webgl: false,
      partition: 'vigia-captura'
    }
  })
  const contents = win.webContents
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.on('will-navigate', (event) => event.preventDefault())
  contents.on('will-redirect', (event) => event.preventDefault())
  contents.on('will-frame-navigate', (event) => {
    if (!event.isMainFrame || !isDocument(event.url)) event.preventDefault()
  })

  // Resuelve con did-finish-load: después del evento `load`, con las imágenes ya cargadas.
  // No se espera a la promesa de loadURL: si la página intenta navegar mientras carga, la
  // navegación se cancela (arriba) y esa promesa se rechaza aunque el documento cargue bien.
  await new Promise((resolveLoad, rejectLoad) => {
    contents.once('did-finish-load', () => resolveLoad())
    contents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
      if (isMainFrame && isDocument(url)) rejectLoad(new Error(`no carga (${code} ${description})`))
    })
    win.loadURL(documentUrl).catch(() => undefined)
  })
  const { height: rawHeight, blocks } = await waitFor(contents, MEASURE, 'a las fuentes')
  const height = Math.max(1, Math.ceil(rawHeight))
  const parts = planParts(height, blocks, max, hard)

  // La ventana, del alto de la parte más alta; cada parte se captura desplazando la página.
  const viewport = Math.min(height, Math.max(...parts.map(([a, b]) => b - a)))
  win.setContentSize(WIDTH, viewport)
  mkdirSync(args.out, { recursive: true })
  for (const [i, [start, end]] of parts.entries()) {
    await evaluate(contents, `window.scrollTo(0, ${start})`)
    const scrollY = Math.round(await waitFrames(contents))
    const image = await contents.capturePage(
      { x: 0, y: start - scrollY, width: WIDTH, height: end - start },
      { stayHidden: true }
    )
    if (image.isEmpty()) throw new Error(`la parte ${i + 1} ha salido vacía`)
    writeFileSync(join(args.out, `parte-${i + 1}.png`), image.toPNG())
  }
  win.destroy()
}

// Escala 2 (1600 px de ancho) y un perfil temporal propio: varias capturas a la vez no se pisan
// ni dejan nada en el perfil de Electron.
const profile = mkdtempSync(join(tmpdir(), 'vigia-captura-perfil-'))
app.setPath('userData', profile)
app.commandLine.appendSwitch('force-device-scale-factor', String(SCALE))
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.on('will-attach-webview', (event) => event.preventDefault())
})
app.on('window-all-closed', () => undefined)
app.on('quit', () => {
  try {
    rmSync(profile, { recursive: true, force: true })
  } catch {
    // El perfil está en la carpeta temporal: si no se puede borrar ahora, no pasa nada.
  }
})

const timer = setTimeout(() => fail('tiempo agotado'), SELF_TIMEOUT_MS)
app
  .whenReady()
  .then(() => run(parseArgs(process.argv.slice(2))))
  .then(() => {
    clearTimeout(timer)
    app.quit()
  })
  .catch((error) => {
    clearTimeout(timer)
    fail(error instanceof Error ? error.message.split('\n')[0] : String(error))
  })
