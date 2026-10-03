import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import en from '../src/renderer/src/locales/en/common.json'
import es from '../src/renderer/src/locales/es/common.json'

/**
 * Fase 2, esqueleto de la interfaz, sobre la app compilada (`out/`): barra
 * lateral y rutas hash, páginas vacías con su título, pie de estado, Ajustes
 * (tema e idioma), paleta Ctrl+K, rango temporal global, lo que NO debe
 * aparecer y la CSP.
 *
 * Las pruebas comparten una ventana y van en orden: cada una parte del estado
 * en que la dejó la anterior.
 */
test.describe.configure({ mode: 'serial' })

type Locale = 'es' | 'en'
const MESSAGES: Record<Locale, unknown> = { es, en }

/** Texto de una clave con puntos (`nav.groups.monitoring`) leído del JSON. */
function t(locale: Locale, key: string): string {
  const value = key
    .split('.')
    .reduce<unknown>(
      (node, part) =>
        node !== null && typeof node === 'object'
          ? (node as Record<string, unknown>)[part]
          : undefined,
      MESSAGES[locale]
    )
  if (typeof value !== 'string') throw new Error(`Falta la clave ${key} en ${locale}.json`)
  return value
}

/** Las 11 secciones acordadas, en el orden del menú (igual que `NAV_SECTIONS`). */
const SECTIONS = [
  { id: 'home', path: '/', group: 'monitoring' },
  { id: 'problems', path: '/problems', group: 'monitoring' },
  { id: 'topology', path: '/topology', group: 'monitoring' },
  { id: 'metrics', path: '/metrics', group: 'monitoring' },
  { id: 'logs', path: '/logs', group: 'monitoring' },
  { id: 'slos', path: '/slos', group: 'monitoring' },
  { id: 'serviceFlows', path: '/service-flows', group: 'analysis' },
  { id: 'businessView', path: '/business', group: 'analysis' },
  { id: 'configuration', path: '/configuration', group: 'administration' },
  { id: 'integrations', path: '/integrations', group: 'administration' },
  { id: 'settings', path: '/settings', group: null }
] as const
const GROUPS = ['monitoring', 'analysis', 'administration'] as const

/** Elementos ocultos hasta estar definidos y huecos de "próximamente", en es y en. */
const FORBIDDEN =
  /favorit|perfil|profile|próximamente|proximamente|coming soon|backup|notificaci|notification/i

const ENTRY = 'app://vigia/index.html'

let app: ElectronApplication
let page: Page
let userDataDir: string
const consoleErrors: string[] = []
const remoteRequests: string[] = []

test.beforeAll(async () => {
  // Carpeta de datos nueva en cada ejecución, para que las preferencias
  // guardadas por otras pruebas o por `npm run dev` no cambien los valores por defecto.
  userDataDir = mkdtempSync(join(tmpdir(), 'vigia-e2e-'))
  app = await electron.launch({
    // VIGIA_E2E_NO_SANDBOX solo hace falta en contenedores Linux que ejecutan como root.
    args: ['.', ...(process.env['VIGIA_E2E_NO_SANDBOX'] ? ['--no-sandbox'] : [])],
    env: { ...process.env, VIGIA_USER_DATA_DIR: userDataDir }
  })
  page = await app.firstWindow()

  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(error.message))
  page.on('request', (request) => {
    if (/^(https?|wss?):/i.test(request.url())) remoteRequests.push(request.url())
  })

  // Recarga con los escuchadores ya puestos, para ver también los errores del arranque.
  await page.waitForLoadState('domcontentloaded')
  await page.reload()
  await page.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  await app?.close()
  rmSync(userDataDir, { recursive: true, force: true })
})

async function goTo(id: string): Promise<void> {
  await page.getByTestId(`nav-${id}`).click()
}

async function expectPage(locale: Locale, section: (typeof SECTIONS)[number]): Promise<void> {
  await expect(page).toHaveURL(`${ENTRY}#${section.path}`)
  const heading = page.getByRole('heading', { level: 1 })
  await expect(heading).toHaveCount(1)
  await expect(heading).toHaveText(t(locale, `nav.${section.id}`))
}

async function expectNothingForbidden(): Promise<void> {
  await expect(page.locator('body')).not.toHaveText(FORBIDDEN)
  const labelled = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[aria-label], [title], [placeholder]')).flatMap((el) =>
      ['aria-label', 'title', 'placeholder'].flatMap((name) => el.getAttribute(name) ?? [])
    )
  )
  expect(labelled.filter((text) => FORBIDDEN.test(text))).toEqual([])
}

async function tour(locale: Locale): Promise<void> {
  for (const section of SECTIONS) {
    await goTo(section.id)
    await expectPage(locale, section)
    await expectNothingForbidden()
  }
}

async function expectPalette(locale: Locale, query: string): Promise<void> {
  const palette = page.getByTestId('command-palette')

  // Se abre con Ctrl+K, con el foco en la búsqueda y las mismas secciones que el menú.
  await page.keyboard.press('Control+K')
  await expect(palette).toBeVisible()
  await expect(palette).toHaveAttribute('role', 'dialog')
  await expect(palette.locator('input')).toBeFocused()
  await expect(palette.getByRole('option')).toHaveCount(SECTIONS.length)
  for (const section of SECTIONS) {
    await expect(palette.getByRole('option', { name: t(locale, `nav.${section.id}`) })).toHaveCount(
      1
    )
  }

  // Escape la cierra sin navegar.
  const before = page.url()
  await page.keyboard.press('Escape')
  await expect(palette).toBeHidden()
  expect(page.url()).toBe(before)

  // Buscar y pulsar Enter navega a la sección y la cierra.
  await page.keyboard.press('Control+K')
  await expect(palette).toBeVisible()
  await page.keyboard.type(query)
  await page.keyboard.press('Enter')
  await expect(palette).toBeHidden()
  await expectPage(locale, SECTIONS[3])
}

const TIME_RANGES = ['2h', '24h', '7d'] as const

/** Comprueba que solo está marcada la opción `selected` del rango temporal. */
async function expectTimeRange(selected: (typeof TIME_RANGES)[number]): Promise<void> {
  for (const id of TIME_RANGES) {
    const option = page.getByTestId(`time-range-${id}`)
    if (id === selected) await expect(option).toBeChecked()
    else await expect(option).not.toBeChecked()
  }
}

test('usa una carpeta de datos aislada', async () => {
  const userData = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'))
  expect(userData).toBe(userDataDir)
})

test('arranca en Inicio (#/) en español', async () => {
  await expect(page).toHaveURL(`${ENTRY}#/`)
  await expect(page.locator('html')).toHaveAttribute('lang', 'es')
  await expect(page.getByTestId('app-name')).toHaveText('Vigía')
  await expectPage('es', SECTIONS[0])
})

test('el rango temporal de la barra superior empieza en 2 h', async () => {
  const group = page.getByTestId('time-range')
  await expect(group).toBeVisible()
  await expect(group).toHaveAttribute('aria-label', t('es', 'timeRange.label'))
  await expect(group.getByRole('radio')).toHaveCount(TIME_RANGES.length)
  for (const id of TIME_RANGES) {
    await expect(group.getByTestId(`time-range-${id}`)).toHaveText(
      t('es', `timeRange.options.${id}`)
    )
  }
  await expectTimeRange('2h')
})

test('la barra lateral tiene los grupos y las secciones de la lista única', async () => {
  const nav = page.getByRole('navigation', { name: t('es', 'nav.aria') })
  await expect(nav).toBeVisible()

  // Cada sección con grupo está dentro de su grupo, y el grupo muestra su nombre.
  for (const group of GROUPS) {
    const container = page.getByTestId(`nav-group-${group}`)
    await expect(container).toBeVisible()
    await expect(container).toContainText(t('es', `nav.groups.${group}`))
    const inGroup = SECTIONS.filter((section) => section.group === group)
    await expect(
      container.locator('[data-testid^="nav-"]:not([data-testid^="nav-group-"])')
    ).toHaveCount(inGroup.length)
    for (const section of inGroup) {
      await expect(container.getByTestId(`nav-${section.id}`)).toHaveText(
        new RegExp(t('es', `nav.${section.id}`))
      )
    }
  }

  // Configuración, dentro de Administración.
  await expect(
    page.getByTestId('nav-group-administration').getByTestId('nav-configuration')
  ).toBeVisible()

  // Ajustes va fuera de los grupos.
  await expect(page.getByTestId('nav-settings')).toBeVisible()
  await expect(
    page.locator('[data-testid^="nav-group-"] [data-testid="nav-settings"]')
  ).toHaveCount(0)

  // El orden del menú es el de la lista única.
  const order = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid^="nav-"]')).map(
      (el) => el.getAttribute('data-testid') ?? ''
    )
  )
  const ids: string[] = SECTIONS.map((section) => `nav-${section.id}`)
  expect(order.filter((id) => ids.includes(id))).toEqual(ids)
})

test('el pie muestra un estado neutro sin entorno y sin backups', async () => {
  const status = page.getByTestId('env-status')
  await expect(status).toBeVisible()
  await expect(status).toContainText('Sin entorno configurado')
  await expect(status).not.toHaveText(/backup/i)
})

test('no aparecen elementos sin definir ni "próximamente" (es)', async () => {
  await expectNothingForbidden()
})

test('Ajustes: tema Sistema e idioma español por defecto', async () => {
  await goTo('settings')
  await expectPage('es', SECTIONS[10])
  await expect(page.getByTestId('theme-system')).toBeChecked()
  await expect(page.getByTestId('theme-light')).not.toBeChecked()
  await expect(page.getByTestId('theme-dark')).not.toBeChecked()
  await expect(page.getByTestId('language-es')).toBeChecked()
  await expect(page.getByTestId('language-en')).not.toBeChecked()

  const prefersDark = await page.evaluate(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches
  )
  await expect(page.locator('html')).toHaveAttribute('data-theme', prefersDark ? 'dark' : 'light')
})

test('recorre las 11 secciones en español', async () => {
  await tour('es')
})

test('la paleta Ctrl+K busca y navega en español', async () => {
  await expectPalette('es', 'Métricas')
})

test('cambiar a inglés traduce la interfaz', async () => {
  await goTo('settings')
  await page.getByTestId('language-en').click()
  await expect(page.getByTestId('language-en')).toBeChecked()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expectPage('en', SECTIONS[10])
  await expect(page.getByRole('navigation', { name: t('en', 'nav.aria') })).toBeVisible()
  await expect(page.getByTestId('nav-group-administration')).toContainText(
    t('en', 'nav.groups.administration')
  )
  await expect(page.getByTestId('env-status')).toContainText('No environment configured')
  await expectNothingForbidden()
})

test('recorre las 11 secciones en inglés', async () => {
  await tour('en')
})

test('la paleta Ctrl+K busca y navega en inglés', async () => {
  await expectPalette('en', 'Metrics')
})

test('el tema cambia entre claro y oscuro', async () => {
  await goTo('settings')
  const html = page.locator('html')

  await page.getByTestId('theme-dark').click()
  await expect(page.getByTestId('theme-dark')).toBeChecked()
  await expect(html).toHaveAttribute('data-theme', 'dark')

  await page.getByTestId('theme-light').click()
  await expect(page.getByTestId('theme-light')).toBeChecked()
  await expect(html).toHaveAttribute('data-theme', 'light')

  await page.getByTestId('theme-dark').click()
  await expect(html).toHaveAttribute('data-theme', 'dark')
})

test('el tema Sistema sigue a prefers-color-scheme en caliente', async () => {
  const html = page.locator('html')
  await page.getByTestId('theme-system').click()
  await expect(page.getByTestId('theme-system')).toBeChecked()

  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(html).toHaveAttribute('data-theme', 'dark')
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(html).toHaveAttribute('data-theme', 'light')
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(html).toHaveAttribute('data-theme', 'dark')

  // Con un tema fijo, el del sistema ya no manda.
  await page.getByTestId('theme-light').click()
  await expect(html).toHaveAttribute('data-theme', 'light')
  await page.emulateMedia({ colorScheme: null })
})

test('las preferencias se conservan al recargar', async () => {
  await page.getByTestId('theme-dark').click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  // El idioma sigue en inglés desde la prueba anterior.

  await page.reload()
  await page.waitForLoadState('domcontentloaded')

  await expect(page).toHaveURL(`${ENTRY}#/settings`)
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.getByTestId('theme-dark')).toBeChecked()
  await expect(page.getByTestId('language-en')).toBeChecked()
  await expectPage('en', SECTIONS[10])
})

test('el rango temporal cambia y no se puede dejar sin selección', async () => {
  // El idioma sigue en inglés desde las pruebas anteriores.
  await expect(page.getByTestId('time-range')).toHaveAttribute(
    'aria-label',
    t('en', 'timeRange.label')
  )

  await page.getByTestId('time-range-24h').click()
  await expectTimeRange('24h')
  await page.getByTestId('time-range-7d').click()
  await expectTimeRange('7d')

  // Pulsar la opción ya marcada no la desmarca.
  await page.getByTestId('time-range-7d').click()
  await expectTimeRange('7d')

  // El rango es global: se mantiene al cambiar de sección.
  await goTo('problems')
  await expectTimeRange('7d')
  await expectNothingForbidden()
})

test('el rango temporal no se guarda: al recargar vuelve a 2 h', async () => {
  // Fija un valor distinto del de por defecto, para no depender de las pruebas anteriores.
  await page.getByTestId('time-range-24h').click()
  await expectTimeRange('24h')

  await page.reload()
  await page.waitForLoadState('domcontentloaded')

  await expectTimeRange('2h')
})

test('la CSP llega como cabecera, sin unsafe-eval ni orígenes remotos', async () => {
  // En e2e la app corre sin empaquetar y sin servidor de Vite: la interfaz la
  // sirve el protocolo app://, que es quien añade la cabecera.
  const csp = await page.evaluate(async () => {
    const response = await fetch('/index.html')
    return response.headers.get('content-security-policy')
  })

  expect(csp).toBeTruthy()

  // Cada directiva por separado: { 'script-src': ["'self'"], ... }.
  const directives = Object.fromEntries(
    (csp ?? '')
      .split(';')
      .map((directive) => directive.trim().split(/\s+/))
      .filter(([name]) => name !== undefined && name !== '')
      .map(([name, ...sources]) => [name as string, sources])
  )
  // Sin default-src, todo lo que no tenga directiva propia queda sin restringir.
  expect(directives['default-src'], 'default-src').toBeDefined()

  const allowed = new Set(["'self'", "'none'", "'unsafe-inline'", 'data:', 'blob:'])
  const problems: string[] = []
  for (const [name, sources] of Object.entries(directives)) {
    for (const source of sources) {
      if (source.includes('unsafe-eval')) problems.push(`${name}: ${source}`)
      else if (!allowed.has(source)) problems.push(`${name}: origen no permitido ${source}`)
      // 'unsafe-inline' solo en estilos; en script-src o en default-src (que
      // hace de respaldo para los scripts) permitiría ejecutar código en línea.
      else if (source === "'unsafe-inline'" && !name.startsWith('style-src')) {
        problems.push(`${name}: 'unsafe-inline' fuera de style-src`)
      }
    }
  }
  expect(problems).toEqual([])
})

test('las animaciones respetan prefers-reduced-motion', async () => {
  /** Duración máxima (s) de transiciones y animaciones CSS de los elementos indicados. */
  const maxDuration = (selector: string): Promise<number> =>
    page.evaluate((sel) => {
      const seconds = (value: string): number[] =>
        value
          .split(',')
          .map((part) => part.trim())
          .map((part) => (part.endsWith('ms') ? parseFloat(part) / 1000 : parseFloat(part) || 0))
      let max = 0
      for (const el of Array.from(document.querySelectorAll(sel))) {
        for (const pseudo of [null, '::before', '::after']) {
          const style = getComputedStyle(el, pseudo)
          max = Math.max(
            max,
            ...seconds(style.transitionDuration),
            ...seconds(style.animationDuration)
          )
        }
      }
      return max
    }, selector)

  // Sin preferencia, la barra lateral tiene transición: si no, la prueba no comprobaría nada.
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await expect(page.getByTestId('sidebar')).toBeVisible()
  expect(await maxDuration('[data-testid="sidebar"]')).toBeGreaterThan(0.01)

  // Con movimiento reducido, ningún elemento anima más de 10 ms.
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect.poll(() => maxDuration('[data-testid="sidebar"]')).toBeLessThanOrEqual(0.01)
  expect(await maxDuration('*')).toBeLessThanOrEqual(0.01)

  await page.emulateMedia({ reducedMotion: null })
})

test('sin errores en consola ni peticiones remotas en todo el recorrido', async () => {
  // Va la última: resume lo ocurrido en todas las pruebas anteriores.
  expect(consoleErrors).toEqual([])
  expect(remoteRequests).toEqual([])
})
