import { spawn } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { removeDir } from './cleanup'
import { captureOnFailure } from './failure-capture'
import { FIXED_WINDOW, fitsContentSize, useCiWindow } from './window-size'
import { expectShownWithoutFocus, type WindowState } from './window-state'

/**
 * Prueba de humo sobre la app compilada (`out/`): la ventana
 * arranca, el canal IPC de ejemplo funciona de punta a punta y las barreras de
 * seguridad están activas.
 */
let app: ElectronApplication
let page: Page
let userDataDir: string
captureOnFailure(() => ({ page, userDataDir }))

test.beforeAll(async () => {
  // Carpeta de datos propia: el bloqueo de instancia única va por carpeta, así
  // que un `npm run dev` abierto (que usa vigia-dev) no impide arrancar la prueba.
  userDataDir = mkdtempSync(join(tmpdir(), 'vigia-e2e-smoke-'))
  app = await electron.launch({
    // VIGIA_E2E_NO_SANDBOX solo hace falta en contenedores Linux que ejecutan como root.
    args: ['.', ...(process.env['VIGIA_E2E_NO_SANDBOX'] ? ['--no-sandbox'] : [])],
    env: { ...process.env, VIGIA_USER_DATA_DIR: userDataDir, VIGIA_E2E: '1' }
  })
  await useCiWindow(app)
  page = await app.firstWindow()
  // Nunca la carpeta real de datos: la temporal de esta prueba.
  expect(await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'))).toBe(
    userDataDir
  )
  await page.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  try {
    await app?.close()
  } finally {
    removeDir(userDataDir)
  }
})

/** Llama a un canal IPC desde la interfaz, como lo haría la app. */
function invoke(channel: string, input?: unknown): Promise<unknown> {
  return page.evaluate(
    ([name, payload]) => {
      const api = (
        window as unknown as { vigia: { invoke: (...args: unknown[]) => Promise<unknown> } }
      ).vigia
      return payload === undefined ? api.invoke(name) : api.invoke(name, payload)
    },
    [channel, input] as const
  )
}

/** Ficha 0021: todos los e2e corren con el contenido de la ventana del CI (useCiWindow). */
test('CA2 (0021): al empezar, el contenido de la ventana mide 1024×720 (con el margen de 2 px)', async () => {
  const size = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))
  expect(fitsContentSize(size, FIXED_WINDOW), `contenido de ${size.width}×${size.height}`).toBe(
    true
  )
})

test('la ventana carga la interfaz por el protocolo app://', async () => {
  expect(page.url()).toBe('app://vigia/index.html#/')
  await expect(page).toHaveTitle('Vigía')
  await expect(page.getByTestId('app-name')).toHaveText('Vigía')
})

test('app:getInfo devuelve los datos del runtime', async () => {
  const runtime = await app.evaluate(({ app: electronApp }) => ({
    version: electronApp.getVersion(),
    electron: process.versions.electron
  }))
  const result = await invoke('app:getInfo')

  expect(result).toMatchObject({
    ok: true,
    data: {
      name: 'Vigía',
      version: runtime.version,
      packaged: false,
      versions: { electron: runtime.electron }
    }
  })
})

test('el User-Agent solo tiene caracteres ASCII', async () => {
  const userAgent = await page.evaluate(() => navigator.userAgent)
  expect(userAgent).toMatch(/^[\x20-\x7E]+$/)
  expect(userAgent).toContain('vigia/')
})

test('el canal de ejemplo app:ping responde desde main', async () => {
  const result = await invoke('app:ping', { message: 'desde la prueba' })

  expect(result).toMatchObject({ ok: true, data: { reply: 'pong: desde la prueba' } })
  const receivedAt = (result as { data: { receivedAt: string } }).data.receivedAt
  expect(Number.isNaN(Date.parse(receivedAt))).toBe(false)
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

test('CA1 (0045): VIGIA_E2E: la ventana de la prueba se ve, pero no le quita el foco del sistema a quien usa el PC', async () => {
  // main la enseña (showInactive) en ready-to-show, que puede llegar después de que la página
  // cargue: se espera a verla y, entonces, no debe tener el foco.
  await expectShownWithoutFocus(() =>
    app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      return { visible: window?.isVisible() ?? false, focused: window?.isFocused() ?? true }
    })
  )
  // Aun así, el teclado de Playwright llega (va por CDP, no por el foco del sistema).
  await page.keyboard.press('Control+K')
  await expect(page.getByTestId('command-palette')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('command-palette')).toBeHidden()
  // Y sigue sin el foco del sistema después de usar el teclado.
  expect(
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isFocused())
  ).toBe(false)
})

/** Lecturas sucesivas de la ventana, como las daría main; la última se repite. */
function readings(...states: WindowState[]): () => Promise<WindowState> {
  let call = 0
  return () => Promise.resolve(states[Math.min(call++, states.length - 1)] as WindowState)
}

test('CA1 (0045): la espera acepta una ventana que se ve un poco después y sin el foco', async () => {
  const hidden = { visible: false, focused: false }
  await expectShownWithoutFocus(readings(hidden, hidden, { visible: true, focused: false }))
})

test('CA2 (0045): si la ventana tiene el foco al verse, falla aunque después lo pierda', async () => {
  // La espera cubre la visibilidad, no el foco: no puede seguir leyendo hasta que se vaya.
  const read = readings(
    { visible: false, focused: false },
    { visible: true, focused: true },
    { visible: true, focused: false }
  )
  await expect(expectShownWithoutFocus(read)).rejects.toThrow()
})

test('CA2 (0045): si la ventana nunca se ve, falla en un tiempo acotado', async () => {
  const started = Date.now()
  await expect(
    expectShownWithoutFocus(readings({ visible: false, focused: false }), 500)
  ).rejects.toThrow()
  expect(Date.now() - started).toBeLessThan(5_000)
})

test('v0.10.1: el código de desarrollo (recarga en caliente de Vite) no está en el bundle de producción', async () => {
  // out/ es la build de producción con la que corren estos e2e (sin el servidor de Vite).
  const assets = join(process.cwd(), 'out', 'renderer', 'assets')
  const bundle = readdirSync(assets)
    .filter((name) => name.endsWith('.js'))
    .map((name) => readFileSync(join(assets, name), 'utf8'))
    .join('\n')
  expect(bundle.length).toBeGreaterThan(0)
  for (const devOnly of [
    'vite:afterUpdate',
    'vite:beforeUpdate',
    'import.meta.hot',
    '/@vite/client'
  ]) {
    expect(bundle, devOnly).not.toContain(devOnly)
  }
})

test('una segunda instancia no abre otra ventana', async () => {
  test.setTimeout(60_000)
  expect(app.windows()).toHaveLength(1)
  const locked = await app.evaluate(({ app: electronApp }) => electronApp.hasSingleInstanceLock())
  expect(locked).toBe(true)

  // La primera cuenta los avisos de segunda instancia que recibe.
  await app.evaluate(({ app: electronApp }) => {
    const state = globalThis as unknown as { __secondInstances?: number }
    state.__secondInstances = 0
    electronApp.on('second-instance', () => {
      state.__secondInstances = (state.__secondInstances ?? 0) + 1
    })
  })

  // Se lanza DE VERDAD otra instancia con la misma carpeta de datos.
  const electronPath = createRequire(join(process.cwd(), 'package.json'))(
    'electron'
  ) as unknown as string
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    VIGIA_USER_DATA_DIR: userDataDir,
    VIGIA_E2E: '1'
  }
  delete env['ELECTRON_RUN_AS_NODE']
  const second = spawn(
    electronPath,
    ['.', ...(process.env['VIGIA_E2E_NO_SANDBOX'] ? ['--no-sandbox'] : [])],
    { env, stdio: 'ignore' }
  )
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    const timer = setTimeout(() => {
      second.kill()
      reject(new Error('la segunda instancia no ha terminado sola en 30 s'))
    }, 30_000)
    second.on('exit', (code) => {
      clearTimeout(timer)
      resolve(code)
    })
    second.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })

  // Termina sola y sin error, avisa a la primera, y sigue habiendo una sola ventana.
  expect(exitCode).toBe(0)
  await expect
    .poll(() =>
      app.evaluate(
        () => (globalThis as unknown as { __secondInstances?: number }).__secondInstances ?? 0
      )
    )
    .toBe(1)
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
  expect(app.windows()).toHaveLength(1)
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
  expect(url).toBe('app://vigia/index.html#/')
  expect(
    await page.evaluate(
      () => document.querySelector('[data-testid="app-name"]')?.textContent ?? null
    )
  ).toBe('Vigía')
})
