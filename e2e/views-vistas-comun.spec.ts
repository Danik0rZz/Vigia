import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { HOUR, TOKEN_A } from './views/fixtures'
import {
  activate,
  app,
  currentRoute,
  exportDir,
  exportSaved,
  goTo,
  openProblem,
  openProblems,
  page,
  resetState,
  setupViewsApp,
  userDataDir,
  viewportSize,
  withContentSize
} from './views/harness'
import { sim } from './views/sim-state'
import { fitsContentSize, FIXED_WINDOW, SMALL_WINDOW } from './window-size'
import ExcelJS from 'exceljs'
import es from '../src/renderer/src/locales/es/common.json'
import { port, server } from './views/simulator'
import { workerResources } from './worker-resources'
import { resolve } from 'node:path'
import type { AddressInfo } from 'node:net'

/**
 * Specs de vistas por zona (ficha 0070): lo común a las vistas (`@vistas-comun`). Arnés en
 * `e2e/views/` (ver su cabecera).
 */

setupViewsApp()

/** Ficha 0021: todos los e2e corren con el contenido de la ventana del CI (useCiWindow). */
test(
  'CA2 (0021): al empezar, el contenido de la ventana mide 1024×720 (con el margen de 2 px)',
  { tag: '@vistas-comun' },
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

/**
 * Ficha 0021: withContentSize deja la ventana en FIXED_WINDOW al acabar, no en el tamaño que
 * tuviera antes. Se parte de otro tamaño (dentro de los mínimos de la app) para distinguirlo.
 */
test(
  'CA3 (0021): tras un withContentSize(SMALL_WINDOW), el contenido vuelve a 1024×720',
  { tag: '@vistas-comun' },
  async () => {
    const other = { width: 1000, height: 650 }
    await app.evaluate(({ BrowserWindow }, size) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(size.width, size.height)
    }, other)
    await expect.poll(async () => fitsContentSize(await viewportSize(), other)).toBe(true)
    await withContentSize(SMALL_WINDOW, async (actual) => {
      expect(fitsContentSize(actual, SMALL_WINDOW)).toBe(true)
    })
    const after = await viewportSize()
    expect(
      fitsContentSize(after, FIXED_WINDOW),
      `contenido de ${after.width}×${after.height}`
    ).toBe(true)
  }
)

// Va justo detrás del anterior (views corre en un solo worker, en orden): empieza donde él acabó.
test(
  'CA3 (0021): el test siguiente a un withContentSize(SMALL_WINDOW) empieza con 1024×720',
  { tag: '@vistas-comun' },
  async () => {
    const size = await viewportSize()
    expect(fitsContentSize(size, FIXED_WINDOW), `contenido de ${size.width}×${size.height}`).toBe(
      true
    )
  }
)

test(
  'sin entorno activo, las tres vistas dicen que no hay entorno',
  { tag: '@vistas-comun' },
  async () => {
    await resetState(null)
    const before = sim.problemsRequests
    for (const id of ['home', 'problems', 'metrics']) {
      await goTo(id)
      await expect(page.getByTestId('module-unavailable'), id).toContainText('Sin entorno')
    }
    expect(sim.problemsRequests).toBe(before)
  }
)

test(
  'v0.9.0: cambiar de entorno estando en el detalle lleva a la lista del entorno nuevo',
  { tag: '@vistas-comun' },
  async () => {
    await openProblems()
    await openProblem('P-101')
    await page.getByTestId('env-selector').click()
    await page.getByRole('option', { name: 'Cliente A › Desarrollo' }).click()

    await expect(page.getByTestId('problem-page')).toHaveCount(0)
    const table = page.getByTestId('problems-grid')
    await expect(table).toContainText('P-900')
    await expect(table).not.toContainText('P-101')
    expect(await currentRoute()).toBe('/problems')
    await expect(page.getByTestId('breadcrumb-detail')).toHaveCount(0)
  }
)

test(
  'AUD-10: guardar un secreto del entorno descarta sus datos y Problemas los vuelve a pedir',
  { tag: '@vistas-comun' },
  async () => {
    const rows = page.getByTestId('problem-row')
    await openProblems()
    const before = sim.problemsRequests

    // secrets:set desde Ajustes (la mutación del renderer, no IPC directo).
    await goTo('settings')
    await page
      .getByTestId('environment-row')
      .filter({ hasText: 'Producción' })
      .getByTestId('environment-edit')
      .click()
    const form = page.getByTestId('environment-form')
    await form.getByTestId('secret-input-classicToken').fill(TOKEN_A)
    await form.getByTestId('secret-save-classicToken').click()
    await expect(form.getByTestId('secret-status-classicToken')).toHaveText('Configurado')
    await form.getByTestId('form-cancel').click()
    await expect(form).toBeHidden()

    // Se retiene la respuesta: mientras llega, no se ven los problemas de antes.
    let release = (): void => undefined
    sim.problemsGate = new Promise<void>((resolve) => {
      release = resolve
    })
    try {
      await goTo('problems')
      await expect.poll(() => sim.problemsRequests).toBeGreaterThan(before)
      await expect(rows).toHaveCount(0)
      await expect(page.getByTestId('problems-grid')).not.toContainText('P-101')
    } finally {
      release()
      sim.problemsGate = null
    }
    await expect(rows).toHaveCount(3)
  }
)

test(
  'sin auto-refresco: ni volver a la vista, ni el foco, ni la reconexión piden datos; module-refresh sí',
  { tag: '@vistas-comun' },
  async () => {
    await openProblems()
    const before = sim.problemsRequests
    await goTo('metrics')
    await goTo('problems')
    await expect(page.getByTestId('problem-row')).toHaveCount(3)

    // Lo que dispararía un refresco automático (refetchOnWindowFocus, refetchOnReconnect).
    await page.evaluate(() => {
      window.dispatchEvent(new Event('focus'))
      window.dispatchEvent(new Event('visibilitychange'))
      document.dispatchEvent(new Event('visibilitychange'))
      window.dispatchEvent(new Event('online'))
    })
    await page.evaluate(() => window.blur())
    // Sin page.bringToFront(): activaría la ventana y le quitaría el foco a quien usa el PC
    // (VIGIA_E2E). Los eventos de foco ya se simulan arriba.
    expect(
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isFocused())
    ).toBe(false)
    // Aserción negativa: no hay ninguna condición que esperar, solo un margen de tiempo.
    await page.waitForTimeout(1500)
    expect(sim.problemsRequests).toBe(before)

    await page.getByTestId('module-refresh').click()
    await expect.poll(() => sim.problemsRequests).toBeGreaterThan(before)
  }
)

test(
  'AUD-08: elementos ilegibles y avisos de la API se ven en Problemas y en Inicio',
  { tag: '@vistas-comun' },
  async () => {
    await openProblems()
    await expect(page.getByTestId('api-warnings')).toHaveCount(0)

    sim.invalidOne = true
    sim.warnings = ['Aviso de prueba de la API']
    await page.getByTestId('module-refresh').click()
    const warnings = page.getByTestId('api-warnings')
    await expect(warnings).toBeVisible()
    await expect(warnings).toContainText('1 elemento')
    await expect(warnings).toContainText('Aviso de prueba de la API')
    // El problema ilegible no sale en la tabla; los demás sí.
    await expect(page.getByTestId('problem-row')).toHaveCount(3)
    await expect(page.getByTestId('problems-grid')).not.toContainText('P-ROTO')

    await goTo('home')
    await page.getByTestId('module-refresh').click()
    await expect(page.getByTestId('api-warnings').first()).toContainText('1 elemento')

    // El XLSX de Problemas lleva la fila «Elementos descartados» con 1, aparte de los avisos.
    await goTo('problems')
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(
      readFileSync(await exportSaved('problems-table', 'export-xlsx')) as unknown as ArrayBuffer
    )
    const info: [string, unknown][] = []
    workbook.getWorksheet('Info')?.eachRow((r) => {
      info.push([String(r.getCell(1).value), r.getCell(2).value])
    })
    expect(info.filter(([label]) => label === 'Elementos descartados')).toEqual([
      ['Elementos descartados', 1]
    ])
    expect(info.filter(([label]) => label === 'Aviso').map(([, value]) => value)).toEqual([
      'Aviso de prueba de la API'
    ])

    // Sin elementos ilegibles ni avisos, al refrescar el aviso desaparece.
    sim.invalidOne = false
    sim.warnings = []
    await page.getByTestId('module-refresh').click()
    await expect(page.getByTestId('api-warnings')).toHaveCount(0)
  }
)

test(
  'BAD_REQUEST: un 400 se muestra como «La consulta no es válida» con el mensaje de la API',
  { tag: '@vistas-comun' },
  async () => {
    await openProblems()
    sim.badRequest = true
    await page.getByTestId('module-refresh').click()
    await expect(page.getByText('La consulta no es válida').first()).toBeVisible()
    await expect(page.getByText(/Selector mal formado en la prueba/).first()).toBeVisible()
    sim.badRequest = false
    await page.getByTestId('module-refresh').click()
    await expect(page.getByTestId('problem-row')).toHaveCount(3)
  }
)

test(
  'capture:region rechaza un rectángulo que no cabe en la ventana',
  { tag: '@vistas-comun' },
  async () => {
    const result = await page.evaluate(() =>
      (
        window as unknown as { vigia: { invoke: (...args: unknown[]) => Promise<unknown> } }
      ).vigia.invoke('capture:region', {
        module: 'problems',
        rect: { x: 0, y: 0, width: 100_000, height: 100_000 },
        action: 'save'
      })
    )
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
  }
)

test(
  'rango personalizado: valida las fechas y se usa en las peticiones',
  { tag: '@vistas-comun' },
  async () => {
    await openProblems()
    await page.getByTestId('time-range-custom').click()
    const popover = page.getByTestId('custom-range')
    await expect(popover).toBeVisible()

    // Desde posterior a hasta: no vale.
    await popover.getByTestId('custom-range-from').fill('2026-10-02T12:00')
    await popover.getByTestId('custom-range-to').fill('2026-10-02T10:00')
    await popover.getByTestId('form-save').click()
    await expect(popover).toBeVisible()
    await expect(popover.getByRole('alert')).toBeVisible()
    await expect(
      popover.locator('[data-testid^="custom-range-"][aria-invalid="true"]').first()
    ).toBeVisible()

    await popover.getByTestId('custom-range-to').fill('2026-10-02T14:00')
    await popover.getByTestId('form-save').click()
    await expect(popover).toBeHidden()
    await page.getByTestId('module-refresh').click()

    await expect.poll(() => sim.lastProblemsQuery.get('to')).not.toBeNull()
    const from = new Date(sim.lastProblemsQuery.get('from') ?? '').getTime()
    const to = new Date(sim.lastProblemsQuery.get('to') ?? '').getTime()
    expect(to - from).toBe(2 * HOUR)

    await page.getByTestId('time-range-2h').click()
    await page.getByTestId('module-refresh').click()
    await expect.poll(() => sim.lastProblemsQuery.get('from')).toBe('now-2h')
  }
)

test('cambiar de entorno no mezcla datos', { tag: '@vistas-comun' }, async () => {
  await openProblems()
  await page.getByTestId('env-selector').click()
  await page.getByRole('option', { name: 'Cliente A › Desarrollo' }).click()
  const table = page.getByTestId('problems-grid')
  await expect(table).toContainText('P-900')
  await expect(table).not.toContainText('P-101')

  await page.getByTestId('env-selector').click()
  await page.getByRole('option', { name: 'Cliente A › Producción' }).click()
  await expect(table).toContainText('P-101')
  await expect(table).not.toContainText('P-900')
})

test(
  'un error de Dynatrace se muestra con el texto traducido del código',
  { tag: '@vistas-comun' },
  async () => {
    await activate('Prohibido')
    await goTo('problems')
    await expect(page.getByText(es.dtErrors.FORBIDDEN).first()).toBeVisible()
  }
)

/** Rutas comparables en Windows: absolutas y sin distinguir mayúsculas. */
const same = (path: string): string => resolve(path).toLowerCase()

test(
  'CA7 (0070): la app del worker usa la carpeta de datos y el puerto del simulador de workerResources',
  { tag: '@vistas-comun' },
  async () => {
    const expected = workerResources(test.info().workerIndex)

    // Carpeta de datos: la que ve Electron en main, no solo la que guarda el arnés.
    const appUserData = await app.evaluate(({ app: electronApp }) =>
      electronApp.getPath('userData')
    )
    expect(same(appUserData)).toBe(same(expected.userDataDir))
    expect(same(userDataDir)).toBe(same(expected.userDataDir))

    // Carpeta de exportación (punto 4 de la ficha): la que recibe main por VIGIA_EXPORT_DIR.
    const appExportDir = await app.evaluate(() => process.env['VIGIA_EXPORT_DIR'] ?? '')
    expect(same(appExportDir)).toBe(same(expected.exportDir))
    expect(same(exportDir)).toBe(same(expected.exportDir))

    // Puerto del simulador: el que escucha de verdad y el que usan los entornos del arnés.
    expect((server.address() as AddressInfo).port).toBe(expected.port)
    expect(port).toBe(expected.port)
  }
)
