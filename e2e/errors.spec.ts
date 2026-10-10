import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Locator,
  type Page
} from '@playwright/test'
import { removeDir } from './cleanup'
import { captureOnFailure } from './failure-capture'
import { FIXED_WINDOW, fitsContentSize, useCiWindow } from './window-size'
import en from '../src/renderer/src/locales/en/common.json'
import es from '../src/renderer/src/locales/es/common.json'

/**
 * v0.10.1: pantallas de error propias en lugar de la de React Router. Se
 * provocan con el disparador /__errors/<variante>, que solo existe sin
 * empaquetar y con VIGIA_E2E=1 (el de estas pruebas). Nunca debe verse el
 * texto por defecto de React Router.
 */

let app: ElectronApplication
let page: Page
let userDataDir: string
captureOnFailure(() => ({ page, userDataDir }))
const pageErrors: string[] = []

/** Textos por defecto de React Router (y de su pantalla de desarrollo). */
const ROUTER_DEFAULT = /Unexpected Application Error|Hey developer|errorElement|ErrorBoundary/i

test.beforeAll(async () => {
  userDataDir = mkdtempSync(join(tmpdir(), 'vigia-e2e-errors-'))
  app = await electron.launch({
    args: ['.', ...(process.env['VIGIA_E2E_NO_SANDBOX'] ? ['--no-sandbox'] : [])],
    env: { ...process.env, VIGIA_USER_DATA_DIR: userDataDir, VIGIA_E2E: '1' }
  })
  await useCiWindow(app)
  page = await app.firstWindow()
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  try {
    await app?.close()
  } finally {
    removeDir(userDataDir)
  }
})

test.beforeEach(async () => {
  // Sin marca anti-bucle de otra prueba, en español y con movimiento normal.
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.evaluate(() => {
    sessionStorage.clear()
    localStorage.setItem(
      'vigia.preferences',
      JSON.stringify({
        state: { theme: 'system', language: 'es', sidebarCollapsed: false },
        version: 1
      })
    )
    window.location.hash = '#/'
  })
  await page.reload()
  await page.waitForLoadState('domcontentloaded')
  await expect(page.getByTestId('nav-home')).toBeVisible()
})

test.afterEach(async () => {
  // Nunca el texto por defecto de React Router, en ninguna variante.
  await expect(page.locator('body')).not.toHaveText(ROUTER_DEFAULT)
})

async function goToRoute(route: string): Promise<void> {
  await page.evaluate((hash) => {
    window.location.hash = hash
  }, route)
}

const screen = (): Locator => page.getByTestId('error-screen')
const lighthouse = (scope: Locator = page.locator('body')): Locator =>
  scope.getByTestId('lighthouse')

/** Ficha 0021: todos los e2e corren con el contenido de la ventana del CI (useCiWindow). */
test(
  'CA2 (0021): al empezar, el contenido de la ventana mide 1024×720 (con el margen de 2 px)',
  { tag: '@errors' },
  async () => {
    const size = await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight
    }))
    expect(fitsContentSize(size, FIXED_WINDOW), `contenido de ${size.width}×${size.height}`).toBe(
      true
    )
  }
)

test(
  'el disparador está activo en modo e2e (app:getInfo.errorTrigger)',
  { tag: '@errors' },
  async () => {
    const info = await page.evaluate(() =>
      (window as unknown as { vigia: { invoke: (c: string) => Promise<unknown> } }).vigia.invoke(
        'app:getInfo'
      )
    )
    expect(info).toMatchObject({ ok: true, data: { errorTrigger: true, packaged: false } })
  }
)

test(
  'error en una sección: pantalla propia dentro del layout (menú vivo), role=alert, foco en Reintentar y faro "bulb"',
  { tag: '@errors' },
  async () => {
    await goToRoute('/__errors/unexpected')
    await expect(screen()).toBeVisible()
    await expect(screen()).toHaveAttribute('data-variant', 'unexpected')
    await expect(screen()).toHaveAttribute('role', 'alert')
    await expect(screen()).toContainText(es.errorScreen.unexpected.title)
    await expect(page.getByTestId('error-retry')).toHaveText(es.errorScreen.retry)
    await expect(page.getByTestId('error-retry')).toBeFocused()
    await expect(page.getByTestId('error-home')).toBeVisible()
    await expect(page.getByTestId('error-reload')).toBeVisible()
    await expect(lighthouse(screen())).toHaveAttribute('data-scene', 'bulb')
    await expect(lighthouse(screen())).toHaveAttribute('aria-hidden', 'true')
    // Detalles técnicos plegados, con el error de prueba y la ruta.
    const details = page.getByTestId('error-details')
    await expect(details).not.toHaveAttribute('open', /.*/)
    await details.locator('summary').click()
    const detailsText = page.getByTestId('error-details-text')
    await expect(detailsText).toContainText('/__errors/unexpected')
    // La ruta de usuario inventada del mensaje de prueba sale enmascarada.
    await expect(detailsText).toContainText('C:\\Users\\<usuario>\\')
    await expect(detailsText).not.toContainText('persona-prueba')
    // El layout sigue vivo: el menú navega.
    await page.getByTestId('nav-settings').click()
    await expect(screen()).toHaveCount(0)
    expect(await page.evaluate(() => window.location.hash)).toBe('#/settings')
  }
)

test('«Ir a Inicio» desde la pantalla de error', { tag: '@errors' }, async () => {
  await goToRoute('/__errors/unexpected')
  await expect(screen()).toBeVisible()
  await page.getByTestId('error-home').click()
  await expect(screen()).toHaveCount(0)
  expect(await page.evaluate(() => window.location.hash)).toBe('#/')
})

test('Reintentar recupera cuando el error ya no se repite', { tag: '@errors' }, async () => {
  // 'once': lanza solo la primera vez que se pinta.
  await goToRoute('/__errors/once')
  await expect(screen()).toBeVisible()
  await page.getByTestId('error-retry').click()
  await expect(screen()).toHaveCount(0)
  await expect(page.getByTestId('error-trigger-page')).toBeVisible()
})

test(
  'error en un panel: tarjeta compacta (role=alert, faro "shake") y el resto de la página sigue',
  { tag: '@errors' },
  async () => {
    await goToRoute('/__errors/panel')
    const panel = page.getByTestId('panel-error')
    await expect(panel).toBeVisible()
    await expect(panel).toHaveAttribute('role', 'alert')
    await expect(panel).toContainText(es.errorScreen.panel.title)
    await expect(panel.getByTestId('panel-retry')).toBeVisible()
    await expect(lighthouse(panel)).toHaveAttribute('data-scene', 'shake')
    // Fuera del panel, la página y el layout siguen.
    await expect(page.getByTestId('error-trigger-page')).toBeVisible()
    await expect(screen()).toHaveCount(0)
    await expect(page.getByTestId('nav-home')).toBeVisible()
  }
)

test(
  '404 propio en una ruta que no existe: dentro del layout, foco en «Ir a Inicio», faro "search", sin detalles',
  { tag: '@errors' },
  async () => {
    await goToRoute('/esto-no-existe')
    await expect(screen()).toBeVisible()
    await expect(screen()).toHaveAttribute('data-variant', 'notFound')
    await expect(screen()).toContainText(es.errorScreen.notFound.title)
    await expect(page.getByTestId('error-home')).toBeFocused()
    await expect(lighthouse(screen())).toHaveAttribute('data-scene', 'search')
    await expect(page.getByTestId('error-details')).toHaveCount(0)
    await expect(page.getByTestId('error-retry')).toHaveCount(0)
    await expect(page.getByTestId('nav-home')).toBeVisible()
    // Ya no redirige a Inicio sin decir nada.
    expect(await page.evaluate(() => window.location.hash)).toBe('#/esto-no-existe')
    await page.getByTestId('error-home').click()
    expect(await page.evaluate(() => window.location.hash)).toBe('#/')
  }
)

test(
  'una variante desconocida del disparador da la pantalla de error inesperado',
  { tag: '@errors' },
  async () => {
    await goToRoute('/__errors/variante-rara')
    await expect(screen()).toHaveAttribute('data-variant', 'unexpected')
  }
)

test(
  'fallo de chunk: variante «actualizada» con cuenta atrás cancelable; un segundo fallo en menos de 60 s ya no recarga',
  { tag: '@errors' },
  async () => {
    await goToRoute('/__errors/chunk')
    await expect(screen()).toHaveAttribute('data-variant', 'updated')
    // En el build no hay recarga en caliente: el motivo es siempre el chunk.
    await expect(screen()).toHaveAttribute('data-reason', 'chunk')
    await expect(screen()).toContainText(es.errorScreen.updated.title)
    await expect(screen()).not.toContainText(es.errorScreen.hot.title)
    await expect(page.getByTestId('error-reload')).toBeFocused()
    await expect(lighthouse(screen())).toHaveAttribute('data-scene', 'sweep')
    const countdown = page.getByTestId('error-countdown')
    await expect(countdown).toContainText(/[1-5]/)
    // Cancelar: la cuenta se para y la pantalla se queda.
    await page.getByTestId('error-countdown-cancel').click()
    const stopped = await countdown.textContent().catch(() => null)
    await page.waitForTimeout(2500)
    await expect(screen()).toHaveAttribute('data-variant', 'updated')
    if (stopped !== null && (await countdown.count()) > 0) {
      expect(await countdown.textContent()).toBe(stopped)
    }
    // Marca puesta: otro fallo de chunk antes de 60 s da la variante inesperada con detalles.
    await goToRoute('/')
    await goToRoute('/__errors/chunk')
    await expect(screen()).toHaveAttribute('data-variant', 'unexpected')
    await expect(page.getByTestId('error-details')).toBeVisible()
  }
)

test(
  'fallo de chunk sin cancelar: a los 5 s recarga sola (una vez)',
  { tag: '@errors' },
  async () => {
    await goToRoute('/__errors/chunk')
    await expect(screen()).toHaveAttribute('data-variant', 'updated')
    // Se marca la página actual para saber si ha habido recarga.
    await page.evaluate(() => {
      ;(window as unknown as { __antes?: boolean }).__antes = true
    })
    await page.waitForEvent('load', { timeout: 10_000 })
    await page.waitForLoadState('domcontentloaded')
    expect(
      await page.evaluate(() => (window as unknown as { __antes?: boolean }).__antes ?? false)
    ).toBe(false)
    // Tras recargar sigue en la misma ruta; con la marca reciente, ya no hay otra cuenta atrás.
    await expect(screen()).toHaveAttribute('data-variant', 'unexpected')
    await expect(page.getByTestId('error-countdown')).toHaveCount(0)
  }
)

test(
  'fallo de chunk sin poder escribir la marca anti-bucle: nunca recarga sola (no hay bucle)',
  { tag: '@errors' },
  async () => {
    // Leer funciona, escribir falla (cuota llena o política): sin marca no se puede evitar el bucle.
    await page.evaluate(() => {
      const holder = window as unknown as { __setItem?: Storage['setItem']; __antes?: boolean }
      holder.__setItem = Storage.prototype.setItem
      Storage.prototype.setItem = () => {
        throw new Error('QuotaExceededError de prueba')
      }
      holder.__antes = true
    })
    try {
      await goToRoute('/__errors/chunk')
      // Sin poder dejar la marca: el error con detalles, sin cuenta atrás.
      await expect(screen()).toHaveAttribute('data-variant', 'unexpected')
      await expect(page.getByTestId('error-details')).toBeVisible()
      await expect(page.getByTestId('error-countdown')).toHaveCount(0)
      // Pasado el tiempo de la cuenta atrás (5 s) y un margen, la página es la misma: sin recarga.
      await page.waitForTimeout(6500)
      expect(
        await page.evaluate(() => (window as unknown as { __antes?: boolean }).__antes ?? false)
      ).toBe(true)
      await expect(page.getByTestId('error-countdown')).toHaveCount(0)
    } finally {
      // Se restaura siempre: el beforeEach de la siguiente escribe en localStorage.
      await page.evaluate(() => {
        const holder = window as unknown as { __setItem?: Storage['setItem'] }
        if (holder.__setItem !== undefined) Storage.prototype.setItem = holder.__setItem
      })
    }
  }
)

test(
  'error por encima del router: AppErrorBoundary con textos propios, recargar y detalles',
  { tag: '@errors' },
  async () => {
    await goToRoute('/__errors/fatal')
    const fatal = page.getByTestId('fatal-error')
    await expect(fatal).toBeVisible()
    await expect(page.getByTestId('fatal-reload')).toBeVisible()
    await expect(page.getByTestId('fatal-details')).toHaveCount(1)
    // Fuera del router y de i18next: el menú no está, pero el texto tampoco es el de React.
    await expect(page.getByTestId('nav-home')).toHaveCount(0)
    expect((await fatal.innerText()).trim().length).toBeGreaterThan(10)
    await page.evaluate(() => {
      window.location.hash = '#/'
    })
    await page.getByTestId('fatal-reload').click()
    await page.waitForLoadState('domcontentloaded')
    await expect(page.getByTestId('nav-home')).toBeVisible()
  }
)

test(
  'con reduced motion, el faro está quieto (data-reduced) en cada variante',
  { tag: '@errors' },
  async () => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    for (const [route, scene] of [
      ['/__errors/unexpected', 'bulb'],
      ['/esto-no-existe', 'search'],
      ['/__errors/panel', 'shake']
    ] as const) {
      await goToRoute(route)
      const svg = page.locator(`[data-testid="lighthouse"][data-scene="${scene}"]`)
      await expect(svg, route).toHaveAttribute('data-reduced', 'true')
    }
    // Sin reduced motion, no.
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await goToRoute('/__errors/unexpected')
    await expect(lighthouse(screen())).toHaveAttribute('data-reduced', 'false')
  }
)

test(
  'en inglés, los textos de la pantalla cambian (y nunca los de React Router)',
  { tag: '@errors' },
  async () => {
    await goToRoute('/__errors/unexpected')
    const spanish = await screen().innerText()
    await page.getByRole('button', { name: es.topbar.language }).click()
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await expect(screen()).toBeVisible()
    await expect(screen()).toContainText(en.errorScreen.unexpected.title)
    const english = await screen().innerText()
    expect(english).not.toBe(spanish)
    expect(spanish).toContain(es.errorScreen.unexpected.title)
    await expect(page.getByRole('button', { name: en.topbar.language })).toBeVisible()
  }
)

test(
  'un error en bucle no manda más de 10 registros por minuto al log de main, y van enmascarados',
  { tag: '@errors' },
  async () => {
    const logFile = join(userDataDir, 'logs', 'main.log')
    const linesBefore = existsSync(logFile)
      ? readFileSync(logFile, 'utf8')
          .split('\n')
          .filter((l) => l.includes('Error en la interfaz')).length
      : 0
    // 30 errores distintos por IPC directo (sin el freno del renderer): main deja pasar 10.
    const results = await page.evaluate(async () => {
      const api = (
        window as unknown as { vigia: { invoke: (c: string, i: unknown) => Promise<unknown> } }
      ).vigia
      const out: unknown[] = []
      for (let i = 0; i < 30; i += 1) {
        out.push(
          await api.invoke('app:logRendererError', {
            message: `bucle ${i} en C:\\Users\\persona\\x?token=SECRETOE2E`,
            stack: null,
            route: '/__errors/bucle',
            version: '0.0.0'
          })
        )
      }
      return out
    })
    const logged = results.filter(
      (r) => (r as { ok: boolean; data?: { logged: boolean } }).data?.logged === true
    )
    expect(logged.length).toBeLessThanOrEqual(10)
    await expect
      .poll(() => {
        if (!existsSync(logFile)) return -1
        return readFileSync(logFile, 'utf8')
          .split('\n')
          .filter((l) => l.includes('bucle ')).length
      })
      .toBe(logged.length)
    const text = readFileSync(logFile, 'utf8')
    expect(text).not.toContain('SECRETOE2E')
    expect(text).not.toContain('persona')
    const after = text.split('\n').filter((l) => l.includes('Error en la interfaz')).length
    expect(after - linesBefore).toBeLessThanOrEqual(10)

    // Y la pantalla de error en bucle (el mismo error en la misma ruta), una sola vez.
    for (let i = 0; i < 5; i += 1) {
      await goToRoute('/')
      await goToRoute('/__errors/unexpected')
      await expect(screen()).toBeVisible()
    }
    await expect
      .poll(
        () =>
          readFileSync(logFile, 'utf8')
            .split('\n')
            .filter((l) => l.includes('Error en la interfaz') && l.includes('__errors/unexpected'))
            .length
      )
      .toBeLessThanOrEqual(1)
  }
)

test('sin errores de página no previstos fuera de los provocados', { tag: '@errors' }, async () => {
  // Los provocados por el disparador sí pueden salir como pageerror; nada más.
  const unexpected = pageErrors.filter(
    (message) => !/prueba|test|dynamically imported module|__errors|Error de prueba/i.test(message)
  )
  expect(unexpected).toEqual([])
})
