import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page
} from '@playwright/test'

/**
 * Prueba de humo de la Fase 1 sobre la app compilada (`out/`): la ventana
 * arranca, el canal IPC de ejemplo funciona de punta a punta y las barreras de
 * seguridad están activas.
 */
let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  app = await electron.launch({
    // VIGIA_E2E_NO_SANDBOX solo hace falta en contenedores Linux que ejecutan como root.
    args: ['.', ...(process.env['VIGIA_E2E_NO_SANDBOX'] ? ['--no-sandbox'] : [])]
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  await app.close()
})

test('la ventana carga la interfaz por el protocolo app://', async () => {
  expect(page.url()).toBe('app://vigia/index.html')
  await expect(page).toHaveTitle('Vigía')
  await expect(page.getByRole('heading', { level: 1, name: 'Vigía' })).toBeVisible()
})

test('app:getInfo devuelve los datos del runtime', async () => {
  const info = page.getByTestId('app-info')
  await expect(info).toContainText('Electron')
  const version = await app.evaluate(({ app: electronApp }) => electronApp.getVersion())
  await expect(info).toContainText(version)
})

test('el User-Agent solo tiene caracteres ASCII', async () => {
  const userAgent = await page.evaluate(() => navigator.userAgent)
  expect(userAgent).toMatch(/^[\x20-\x7E]+$/)
  expect(userAgent).toContain('vigia/')
})

test('el canal de ejemplo app:ping responde desde main', async () => {
  await page.getByLabel('Mensaje').fill('desde la prueba')
  await page.getByRole('button', { name: 'Enviar a main' }).click()
  await expect(page.getByTestId('ping-reply')).toContainText('pong: desde la prueba')
})

test('el preload valida la entrada y rechaza canales fuera del contrato', async () => {
  const results = await page.evaluate(async () => {
    const api = (
      window as unknown as { vigia: { invoke: (...args: unknown[]) => Promise<unknown> } }
    ).vigia
    return {
      invalid: await api.invoke('app:ping', { message: '' }),
      unknown: await api.invoke('fs:readFile', { path: 'C:/secreto.txt' })
    }
  })

  expect(results.invalid).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
  expect(results.unknown).toMatchObject({ ok: false, error: { code: 'UNKNOWN_CHANNEL' } })
})

test('la interfaz no tiene acceso a Node ni a Electron', async () => {
  const exposed = await page.evaluate(() => ({
    require: typeof (window as unknown as Record<string, unknown>)['require'],
    process: typeof (window as unknown as Record<string, unknown>)['process'],
    api: Object.keys((window as unknown as { vigia: object }).vigia)
  }))

  expect(exposed).toEqual({ require: 'undefined', process: 'undefined', api: ['invoke'] })
})

test('la CSP bloquea los scripts en línea', async () => {
  const ran = await page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        const marker = '__vigiaInlineScriptRan'
        const script = document.createElement('script')
        script.textContent = `window.${marker} = true`
        document.head.appendChild(script)
        setTimeout(
          () => resolve(Boolean((window as unknown as Record<string, unknown>)[marker])),
          100
        )
      })
  )

  expect(ran).toBe(false)
})

test('una segunda instancia no abre otra ventana', async () => {
  expect(app.windows()).toHaveLength(1)
  const locked = await app.evaluate(({ app: electronApp }) => electronApp.hasSingleInstanceLock())
  expect(locked).toBe(true)
})

test('la navegación fuera de la app queda bloqueada', async () => {
  // Va la última: Playwright se queda esperando una navegación que main cancela.
  await page.evaluate(() => {
    window.location.href = 'https://example.com/'
  })
  await page.waitForTimeout(500)

  const url = await app.evaluate(
    ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.getURL() ?? null
  )
  expect(url).toBe('app://vigia/index.html')
  expect(await page.evaluate(() => document.querySelector('h1')?.textContent)).toBe('Vigía')
})
