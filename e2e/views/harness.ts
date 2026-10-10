import { mkdtempSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import {
  _electron as electron,
  type ElectronApplication,
  expect,
  type Locator,
  type Page,
  test
} from '@playwright/test'
import { SECRET_MARKS, TOKEN_A, TOKEN_B, TOKEN_FORBIDDEN, TOKEN_NO_METRICS } from './fixtures'
import { defaultSim, sim } from './sim-state'
import { port, server, startServer } from './simulator'
import { removeDir } from '../cleanup'
import { captureOnFailure } from '../failure-capture'
import {
  fitsContentSize,
  FIXED_WINDOW,
  useCiWindow,
  viewportSize as pageViewportSize,
  type WindowSize
} from '../window-size'
import en from '../../src/renderer/src/locales/en/common.json'
import es from '../../src/renderer/src/locales/es/common.json'

/**
 * Arnés común de los specs de vistas (ficha 0069; antes, la cabecera de `views.spec.ts`): las
 * primeras vistas core (Problemas, Métricas, Inicio y las páginas de entidad) sobre la app compilada
 * (`out/`) contra un Dynatrace simulado (HTTPS en 127.0.0.1), con exportación CSV/XLSX/TXT,
 * capturas, consultas guardadas, rango personalizado, módulos no disponibles y sin auto-refresco.
 *
 * Reparto en `e2e/views/` (ningún fichero acaba en `.spec.ts` ni `.test.ts`, así que Playwright
 * no los toma como tests):
 * - `fixtures.ts`: los datos simulados y las respuestas que se arman con ellos;
 * - `sim-state.ts`: el estado del simulador (`sim`, `defaultSim`);
 * - `simulator.ts`: el servidor HTTPS (`startServer`, `server`, `port`);
 * - `harness.ts` (este): el estado de la app, los ayudantes de los tests y `setupViewsApp`.
 *
 * Cada spec de vistas llama a `setupViewsApp()` una vez, en el nivel superior, antes de sus tests:
 * registra los ganchos. Los ganchos no se registran al importar el módulo porque un worker carga el
 * módulo una sola vez aunque ejecute varios specs, y el segundo se quedaría sin ellos.
 * `scripts/e2e-views-harness.test.ts` vigila que se llame bien y que ningún spec de vistas lance la
 * app por su cuenta.
 *
 * Estado compartido (app, página, carpetas, entornos, simulador): se exporta tal cual, con
 * `export let`. Los `import` de ES son enlaces vivos y de solo lectura: el spec lee siempre el valor
 * actual (`page` tras el `beforeAll`) y no puede reasignarlo; solo lo asignan los ganchos de aquí.
 * Así los cuerpos de los tests siguen igual que cuando todo estaba en `views.spec.ts`.
 *
 * Los entornos usan el nivel 'ignore' para no tener que fijar huellas (eso ya lo prueba tls.spec).
 * Las exportaciones van a una carpeta temporal (VIGIA_EXPORT_DIR). El portapapeles del sistema se
 * guarda y se restaura.
 *
 * Cada test es independiente: `beforeEach` (resetState) deja el simulador, los ajustes de
 * exportación y las consultas guardadas como al principio, activa Producción, pone la interfaz en
 * español y la recarga en Inicio (sin caché ni filtros en memoria). Así se pueden ejecutar en
 * cualquier orden o sueltos con --grep. La app se lanza una sola vez por worker y spec (beforeAll):
 * relanzarla por test sería mucho más lento.
 *
 * Sin modo serie: el único recurso compartido es el portapapeles del sistema, y los tests de un
 * mismo fichero ya corren de uno en uno en su worker (sin fullyParallel); ningún otro spec lo usa
 * (ver e2e/CLAUDE.md).
 */

export let app: ElectronApplication
export let page: Page
export let userDataDir: string
export let exportDir: string
export const env: Record<string, string> = {}
export const consoleErrors: string[] = []
export const rendererRemote: string[] = []
export const ipcOutputs: string[] = []

/**
 * Portapapeles de Electron 44 (al estilo W3C y asíncrono). El de Dani se guarda en
 * main (globalThis) al empezar y se restaura al terminar.
 */
export type ClipboardItemLike = { types: readonly string[]; getType(type: string): Promise<Blob> }
export type ElectronClipboard = {
  clear(): void
  has(mimetype: string): Promise<boolean>
  read(): Promise<ClipboardItemLike[]>
  write(items: unknown[]): Promise<void>
}
export const SAVED_CLIPBOARD = '__vigiaE2eSavedClipboard'

/** Llama a un canal IPC desde la interfaz y guarda la respuesta para buscar secretos. */
export async function invoke<T = unknown>(channel: string, input?: unknown): Promise<T> {
  const result = await page.evaluate(
    ([name, payload]) => {
      const api = (
        window as unknown as { vigia: { invoke: (...args: unknown[]) => Promise<unknown> } }
      ).vigia
      return payload === undefined ? api.invoke(name) : api.invoke(name, payload)
    },
    [channel, input] as const
  )
  ipcOutputs.push(`${channel}: ${JSON.stringify(result)}`)
  const envelope = result as { ok: boolean; data?: unknown; error?: unknown }
  if (!envelope.ok) throw new Error(`${channel} falló: ${JSON.stringify(envelope.error)}`)
  return envelope.data as T
}

export async function reloadUi(): Promise<void> {
  await page.reload()
  await page.waitForLoadState('domcontentloaded')
}

export async function createEnvironment(
  clientId: string,
  name: string,
  type: string,
  token: string | null
): Promise<string> {
  const created = await invoke<{ id: string }>('environments:create', {
    clientId,
    name,
    type,
    deployment: 'saas',
    classicApiUrl: `https://127.0.0.1:${port}`,
    platformUrl: null,
    ssoUrl: null,
    oauthClientId: null,
    oauthScopes: [],
    accountUuid: null,
    certificateLevel: 'ignore',
    captureUrlPatterns: [],
    tags: [],
    readOnly: false
  })
  if (token !== null)
    await invoke('secrets:set', { environmentId: created.id, kind: 'classicToken', value: token })
  return created.id
}

export async function activate(name: string): Promise<void> {
  await invoke('environments:setActive', { environmentId: env[name] })
  await reloadUi()
}

export async function goTo(id: string): Promise<void> {
  await page.getByTestId(`nav-${id}`).click()
}

/**
 * Estado de partida de cada test (ver la cabecera). Restaura el simulador, los
 * ajustes de exportación y las consultas guardadas, activa el entorno pedido,
 * pone las preferencias por defecto (español) y recarga la interfaz en Inicio:
 * la caché de datos, los filtros y el rango de tiempo viven en memoria del
 * renderer y se pierden con la recarga.
 */
export async function resetState(active: string | null = 'Producción'): Promise<void> {
  Object.assign(sim, defaultSim())
  await invoke('export:setSettings', { csvSeparator: ';', captureFooter: true })
  for (const environmentId of Object.values(env)) {
    const saved = await invoke<{ id: string }[]>('savedQueries:list', { environmentId })
    for (const query of saved) await invoke('savedQueries:delete', { id: query.id })
  }
  await invoke('environments:setActive', {
    environmentId: active === null ? null : env[active]
  })
  await page.evaluate(() => {
    localStorage.setItem(
      'vigia.preferences',
      JSON.stringify({
        state: { theme: 'system', language: 'es', sidebarCollapsed: false },
        version: 1
      })
    )
    window.location.hash = '#/'
  })
  await reloadUi()
  await expect(page.locator('html')).toHaveAttribute('lang', 'es')
  await expect(page.getByTestId('nav-home')).toBeVisible()
}

/** Va a Problemas y espera a que lleguen los 3 problemas de Producción. */
export async function openProblems(): Promise<void> {
  await goTo('problems')
  await expect(page.getByTestId('problem-row')).toHaveCount(3)
}

/** La ruta actual (el hash, sin '#'). */
export async function currentRoute(): Promise<string> {
  return page.evaluate(() => window.location.hash.replace(/^#/, ''))
}

/** Entra por URL, como un enlace guardado (sin pasar por la lista). */
export async function goToRoute(route: string): Promise<void> {
  await page.evaluate((hash) => {
    window.location.hash = hash
  }, route)
}

/** Abre un problema desde la lista con un clic en su fila (en el título) y espera su página. */
export async function openProblem(displayId: string): Promise<Locator> {
  await page
    .getByTestId('problem-row')
    .filter({ hasText: displayId })
    .getByRole('gridcell')
    .nth(1)
    .click()
  const problemPage = page.getByTestId('problem-page')
  await expect(problemPage).toBeVisible()
  await expect(page.getByTestId('problem-page-title')).toContainText(displayId)
  return problemPage
}

/**
 * data-index de la primera fila visible bajo la cabecera fija del grid (la primera
 * cuyo borde inferior queda por debajo de la cabecera), como la guarda la lista.
 */
export async function firstVisibleIndex(): Promise<number> {
  return page.getByTestId('problems-scroll').evaluate((scroller) => {
    const header = scroller.querySelector('[data-grid-header]')
    const top = header?.getBoundingClientRect().bottom ?? scroller.getBoundingClientRect().top
    const rows = [...scroller.querySelectorAll<HTMLElement>('[data-testid="problem-row"]')]
      .filter((row) => row.getBoundingClientRect().bottom > top + 1)
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)
    return Number(rows[0]?.dataset['index'] ?? -1)
  })
}

/** Tamaño del contenido de la ventana tal y como lo ve la página. */
export async function viewportSize(): Promise<WindowSize> {
  return pageViewportSize(page)
}

/**
 * Ejecuta `body` con el contenido de la ventana a `size` (desde main, con setContentSize; la
 * app no cambia) y al acabar la deja en FIXED_WINDOW (ficha 0021), aunque el test falle. Con el
 * escritorio escalado,
 * Windows redondea y el contenido puede quedar hasta 2 px más grande o más pequeño
 * (`fitsContentSize`, ficha 0011): `body` recibe el tamaño real.
 */
export async function withContentSize(
  size: WindowSize,
  body: (actual: WindowSize) => Promise<void>
): Promise<void> {
  await app.evaluate(({ BrowserWindow }, wanted) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win === undefined) throw new Error('withContentSize: no hay ventana')
    win.setContentSize(wanted.width, wanted.height)
  }, size)
  try {
    await expect.poll(async () => fitsContentSize(await viewportSize(), size)).toBe(true)
    await body(await viewportSize())
  } finally {
    await app.evaluate(({ BrowserWindow }, back) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(back.width, back.height)
    }, FIXED_WINDOW)
    await expect.poll(async () => fitsContentSize(await viewportSize(), FIXED_WINDOW)).toBe(true)
  }
}

/** Espera dos frames del renderer (lo que la lista hace con requestAnimationFrame ya ha corrido). */
export async function nextFrames(): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      })
  )
}

/**
 * data-index de las filas de Problemas enteras a la vista: bajo la cabecera fija del grid, dentro
 * de la zona de scroll y dentro de la ventana.
 */
export async function fullyVisibleRows(): Promise<number[]> {
  return page.getByTestId('problems-scroll').evaluate((scroller) => {
    const box = scroller.getBoundingClientRect()
    const top =
      scroller.querySelector('[data-grid-header]')?.getBoundingClientRect().bottom ?? box.top
    const bottom = Math.min(box.bottom, window.innerHeight)
    return [...scroller.querySelectorAll<HTMLElement>('[data-testid="problem-row"]')]
      .filter((row) => {
        const rect = row.getBoundingClientRect()
        return rect.top >= top && rect.bottom <= bottom
      })
      .map((row) => Number(row.dataset['index']))
      .sort((a, b) => a - b)
  })
}

/**
 * Si un clic normal en el centro del elemento le llega a él: el elemento que hay en ese punto
 * es él o algo de dentro. Es la misma comprobación que hace Playwright antes de hacer clic, pero
 * sin esperar los 60 s del test.
 */
export async function receivesClick(target: Locator): Promise<boolean> {
  return target.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return false
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    return hit !== null && element.contains(hit)
  })
}

/**
 * Caja del elemento cuando ya no se mueve: la misma en dos lecturas seguidas, separadas por dos
 * frames. Al volver a la lista, la página aún se recoloca un momento (por ejemplo, aparece la
 * barra de scroll de `main`).
 */
export async function settledBox(
  target: Locator
): Promise<{ x: number; y: number; width: number; height: number }> {
  let last = ''
  let box: { x: number; y: number; width: number; height: number } | null = null
  await expect
    .poll(async () => {
      await nextFrames()
      box = await target.boundingBox()
      const now = JSON.stringify(box)
      const same = box !== null && now === last
      last = now
      return same
    }, 'el elemento deja de moverse')
    .toBe(true)
  if (box === null) throw new Error('settledBox: el elemento no tiene caja')
  return box
}

/**
 * Clic con el ratón en el centro del elemento, donde está, cuando ya no se mueve y nada lo tapa.
 * Locator.click, si el primer intento no acierta (la página aún se recoloca), reintenta haciendo
 * scroll para alinear el elemento abajo, y ese scroll cambia lo que se está probando.
 *
 * Con `scroll` (ficha 0013), antes desplaza sus contenedores para traerlo al centro de la vista,
 * como haría el usuario: con una ventana pequeña (la del CI) el elemento puede empezar fuera.
 * Sin él, un elemento fuera de la vista hace fallar el test: es lo que se quiere en las listas.
 */
export async function clickInPlace(
  target: Locator,
  options: { scroll?: boolean } = {}
): Promise<void> {
  if (options.scroll === true) {
    await target.evaluate((element) =>
      element.scrollIntoView({ block: 'center', inline: 'nearest' })
    )
  }
  const box = await settledBox(target)
  expect(await receivesClick(target), 'el elemento recibe el clic donde está').toBe(true)
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
}

/** Va a Métricas, pone el selector y la resolución, consulta y espera el gráfico. */
export async function runMetric(
  selector = 'builtin:host.cpu.usage',
  resolution = '5m'
): Promise<void> {
  await goTo('metrics')
  await page.getByTestId('metric-selector').fill(selector)
  await page.getByTestId('metric-resolution').selectOption(resolution)
  await page.getByTestId('metric-run').click()
  await expect(page.getByTestId('metric-chart').locator('canvas').first()).toBeVisible()
}

/**
 * Menú de exportación de `target`. Ficha 0030: si ya es un locator (un menú dentro de su
 * contenedor, como el del mini gráfico de evidencias), ese.
 */
export function exportMenu(target: string | Locator): Locator {
  if (typeof target !== 'string') return target
  return page.locator(`[data-testid="export-menu"][data-export-target="${target}"]`)
}

/**
 * Lanza una opción del menú de exportación y devuelve el fichero nuevo de la carpeta de exportación,
 * quizá aún vacío. Ficha 0030: solo la usa exportSaved; para leer el fichero, exportSaved.
 */
export async function exportTo(target: string | Locator, option: string): Promise<string> {
  const before = new Set(readdirSync(exportDir))
  await exportMenu(target).click()
  await page.getByTestId(option).click()
  let created = ''
  await expect
    .poll(() => {
      created = readdirSync(exportDir).find((name) => !before.has(name)) ?? ''
      return created
    })
    .not.toBe('')
  return join(exportDir, created)
}

/** Aviso de la exportación junto al menú de `target` («Guardado: <fichero>»). */
export function exportNotice(target: string | Locator): Locator {
  return exportMenu(target).locator('xpath=..').getByRole('status')
}

/**
 * Ficha 0005: como exportTo, pero devuelve el fichero cuando ya está escrito. El nombre aparece en
 * la carpeta en cuanto main empieza a escribirlo (writeFile directo); el aviso «Guardado: …» sale
 * cuando writeFile ha terminado. Y además, con contenido. Ficha 0030: el aviso vale en es o en en
 * (hay tests que exportan con la interfaz en inglés).
 */
export async function exportSaved(target: string | Locator, option: string): Promise<string> {
  const file = await exportTo(target, option)
  const notices = [es, en].map((locale) => locale.export.saved.replace('{{file}}', basename(file)))
  await expect
    .poll(async () => notices.includes((await exportNotice(target).textContent()) ?? ''), {
      message: `aviso «${notices.join('» o «')}»`
    })
    .toBe(true)
  expect(statSync(file).size, `${basename(file)} vacío`).toBeGreaterThan(0)
  return file
}

/** Tamaño CSS del canvas de un gráfico. */
export async function canvasSize(testId: string): Promise<{ width: number; height: number }> {
  return page
    .getByTestId(testId)
    .locator('canvas')
    .first()
    .evaluate((canvas) => ({
      width: (canvas as HTMLCanvasElement).clientWidth,
      height: (canvas as HTMLCanvasElement).clientHeight
    }))
}

/** Tamaño y alpha de la esquina superior izquierda de un PNG, leído con nativeImage en main. */
export async function pngInfo(
  path: string
): Promise<{ width: number; height: number; cornerAlpha: number }> {
  return app.evaluate(({ nativeImage }, file) => {
    const image = nativeImage.createFromPath(file)
    const { width, height } = image.getSize()
    // toBitmap: BGRA, 4 bytes por píxel.
    return { width, height, cornerAlpha: image.toBitmap()[3] ?? 0 }
  }, path)
}

export async function restoreClipboardAndClose(): Promise<void> {
  await app
    ?.evaluate(async ({ clipboard, ClipboardItem }, key) => {
      const cb = clipboard as unknown as ElectronClipboard
      const saved = (globalThis as Record<string, unknown>)[key] as ClipboardItemLike[] | undefined
      if (saved === undefined) return
      cb.clear()
      if (saved.length === 0) return
      try {
        await cb.write(saved)
      } catch {
        // Si no se pueden reescribir tal cual, se reconstruyen tipo a tipo.
        const rebuilt = await Promise.all(
          saved.map(async (item) => {
            const parts: Record<string, Blob> = {}
            for (const type of item.types) parts[type] = await item.getType(type)
            return new (ClipboardItem as unknown as new (parts: Record<string, Blob>) => unknown)(
              parts
            )
          })
        )
        await cb.write(rebuilt)
      }
    }, SAVED_CLIPBOARD)
    .catch(() => undefined)
  try {
    await app?.close()
  } finally {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()))
  }
}

/**
 * Registra los ganchos de un spec de vistas: la captura si falla un test, lanzar la app y crear los
 * entornos (beforeAll), dejarla como al principio (beforeEach), las comprobaciones de seguridad
 * (afterEach) y cerrarla restaurando el portapapeles (afterAll). Se llama una vez, en el nivel
 * superior del spec (ver la cabecera). No empieza por «use» para no chocar con
 * `react-hooks/rules-of-hooks`.
 */
export function setupViewsApp(): void {
  captureOnFailure(() => ({ page, userDataDir }))

  test.beforeAll(async () => {
    test.setTimeout(120_000)
    await startServer()
    userDataDir = mkdtempSync(join(tmpdir(), 'vigia-e2e-views-'))
    exportDir = mkdtempSync(join(tmpdir(), 'vigia-e2e-export-'))
    app = await electron.launch({
      // VIGIA_E2E_NO_SANDBOX solo hace falta en contenedores Linux que ejecutan como root.
      args: ['.', ...(process.env['VIGIA_E2E_NO_SANDBOX'] ? ['--no-sandbox'] : [])],
      env: {
        ...process.env,
        VIGIA_USER_DATA_DIR: userDataDir,
        VIGIA_EXPORT_DIR: exportDir,
        VIGIA_E2E: '1'
      }
    })
    await useCiWindow(app)
    page = await app.firstWindow()
    // Nunca la carpeta real de datos: la temporal de esta prueba.
    expect(await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'))).toBe(
      userDataDir
    )
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    page.on('pageerror', (error) => consoleErrors.push(error.message))
    page.on('request', (request) => {
      if (/^(https?|wss?):/i.test(request.url())) rendererRemote.push(request.url())
    })
    await page.waitForLoadState('domcontentloaded')

    // El portapapeles es el del sistema: se guarda para restaurarlo al final.
    await app.evaluate(async ({ clipboard }, key) => {
      const items = await (clipboard as unknown as ElectronClipboard).read()
      ;(globalThis as Record<string, unknown>)[key] = items
    }, SAVED_CLIPBOARD)

    const client = await invoke<{ id: string }>('clients:create', {
      name: 'Cliente A',
      color: '#336699'
    })
    env['Producción'] = await createEnvironment(client.id, 'Producción', 'production', TOKEN_A)
    env['Desarrollo'] = await createEnvironment(client.id, 'Desarrollo', 'development', TOKEN_B)
    env['Sin métricas'] = await createEnvironment(
      client.id,
      'Sin métricas',
      'integration',
      TOKEN_NO_METRICS
    )
    env['Sin token'] = await createEnvironment(client.id, 'Sin token', 'other', null)
    env['Prohibido'] = await createEnvironment(client.id, 'Prohibido', 'other', TOKEN_FORBIDDEN)
    await reloadUi()
  })

  test.beforeEach(async () => {
    await resetState()
  })

  /**
   * Comprobaciones de seguridad después de CADA test (antes era un test final que
   * dependía de ir el último): sin secretos en las respuestas IPC ni en la página,
   * sin errores de consola y sin peticiones remotas del renderer.
   */
  test.afterEach(async () => {
    const outputs = ipcOutputs.splice(0)
    const errors = consoleErrors.splice(0)
    const remote = rendererRemote.splice(0)
    for (const output of outputs) {
      for (const mark of SECRET_MARKS) expect(output, 'respuesta IPC').not.toContain(mark)
    }
    if (!page.isClosed()) {
      const html = await page.content()
      for (const mark of SECRET_MARKS) expect(html, 'HTML de la página').not.toContain(mark)
    }
    expect(errors, 'errores de consola').toEqual([])
    expect(remote, 'peticiones remotas del renderer').toEqual([])
  })

  test.afterAll(async () => {
    try {
      await restoreClipboardAndClose()
    } finally {
      // Aunque falle el cierre, las carpetas temporales no se quedan en disco.
      removeDir(userDataDir)
      removeDir(exportDir)
    }
  })
}
