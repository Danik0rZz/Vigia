import { randomUUID } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, isAbsolute, join, resolve } from 'node:path'
import { expect, type Locator, test } from '@playwright/test'
import { captureEvidence } from './evidence'
import { hoverFresh, moveToNeutral } from './hover'
import {
  activate,
  env,
  exportSaved,
  goTo,
  goToRoute,
  invoke,
  page,
  runMetric,
  setupViewsApp,
  viewportSize
} from './views/harness'
import { sim } from './views/sim-state'
import ExcelJS from 'exceljs'
import en from '../src/renderer/src/locales/en/common.json'
import es from '../src/renderer/src/locales/es/common.json'
import { axisOf, ES_DAY } from './views/helpers'

/**
 * Specs de vistas por zona (ficha 0070): Métricas (`@metricas`). Arnés en
 * `e2e/views/` (ver su cabecera).
 */

setupViewsApp()

test('v0.9.1: Métricas por URL: con basura no hace nada', { tag: '@metricas' }, async () => {
  const before = sim.metricsQueries
  await goToRoute('/metrics?selector=&from=ayer&to=2026-10-04T10:00:00.000Z')
  await expect(page.getByTestId('metric-selector')).toBeVisible()
  await expect(page.getByTestId('metric-selector')).toHaveValue('')
  // Aserción negativa: un margen para que una consulta, si la hubiera, saliera.
  await page.waitForTimeout(500)
  expect(sim.metricsQueries).toBe(before)
})

test(
  'v0.10.2: Métricas con 7 días: etiquetas del eje variadas con fechas (no todas iguales) y tooltip con fecha y hora',
  { tag: '@metricas' },
  async () => {
    sim.metricsSpread = true
    await goTo('metrics')
    await page.getByTestId('time-range-7d').click()
    await runMetric('builtin:host.cpu.usage', '1h')
    const chart = page.getByTestId('metric-chart')
    const axis = await axisOf(chart)
    expect(axis.labels.length).toBeGreaterThan(2)
    expect(new Set(axis.labels).size).toBeGreaterThan(1)
    expect(axis.labels.some((label) => ES_DAY.test(label))).toBe(true)
    const box = await chart.locator('canvas').first().boundingBox()
    await page.mouse.move(
      (box?.x ?? 0) + (box?.width ?? 0) * 0.5,
      (box?.y ?? 0) + (box?.height ?? 0) / 2,
      {
        steps: 10
      }
    )
    await expect(
      page.locator('.vigia-chart-tooltip').filter({ visible: true }).first()
    ).toContainText(/\d\d\/\d\d\/\d{4} \d\d:\d\d/)
    await moveToNeutral(page)
    await page.getByTestId('time-range-2h').click()
  }
)

test('Métricas: búsqueda, consulta con resolución y gráfico', { tag: '@metricas' }, async () => {
  await goTo('metrics')
  await page.getByTestId('metric-search').fill('cpu')
  const options = page.getByTestId('metric-search-results').getByRole('option')
  await expect(options).toHaveCount(2)
  await options.filter({ hasText: 'CPU usage' }).click()
  await expect(page.getByTestId('metric-selector')).toHaveValue('builtin:host.cpu.usage')

  await page.getByTestId('metric-resolution').selectOption('5m')
  await page.getByTestId('metric-run').click()
  await expect(page.getByTestId('metric-chart').locator('canvas').first()).toBeVisible()
  expect(sim.lastMetricsQuery.get('metricSelector')).toBe('builtin:host.cpu.usage')
  expect(sim.lastMetricsQuery.get('resolution')).toBe('5m')
})

test('AUD-13: resolución aplicada bajo el gráfico', { tag: '@metricas' }, async () => {
  await runMetric('builtin:host.cpu.usage', '5m')
  await expect(page.getByTestId('metric-resolution-applied')).toHaveText(/Resolución aplicada: 5m/)

  // Sin resolución, la que diga la API (el simulador responde 1m).
  await page.getByTestId('metric-resolution').selectOption('')
  await page.getByTestId('metric-run').click()
  await expect.poll(() => sim.lastMetricsQuery.has('resolution')).toBe(false)
  await expect(page.getByTestId('metric-resolution-applied')).toHaveText(/Resolución aplicada: 1m/)
})

test(
  'AUD-13: aviso de puntos antes de consultar y resolución sugerida',
  { tag: '@metricas' },
  async () => {
    await goTo('metrics')
    await page.getByTestId('metric-selector').fill('builtin:host.cpu.usage')
    const estimate = page.getByTestId('points-estimate')
    const resolution = page.getByTestId('metric-resolution')
    await page.getByTestId('time-range-7d').click()

    // Sin resolución (120 puntos) o Inf (1): sin aviso.
    for (const value of ['', 'Inf', '1h']) {
      await resolution.selectOption(value)
      await expect(estimate).toHaveCount(0)
    }

    // 1m en 7 días son 10 081 puntos por serie.
    await resolution.selectOption('1m')
    await expect(estimate).toBeVisible()
    await expect(estimate).toContainText(/10\D?081/)
    const use = page.getByTestId('use-resolution')
    await expect(use).toHaveText(/Usar 10m/)

    // No bloquea: con el aviso, la consulta sale igual con 1m.
    const before = sim.metricsQueries
    await page.getByTestId('metric-run').click()
    await expect.poll(() => sim.metricsQueries).toBeGreaterThan(before)
    expect(sim.lastMetricsQuery.get('resolution')).toBe('1m')
    expect(sim.lastMetricsQuery.get('from')).toBe('now-7d')

    // «Usar 10m» cambia la resolución y el aviso desaparece.
    await use.click()
    await expect(resolution).toHaveValue('10m')
    await expect(estimate).toHaveCount(0)

    // En 2 h, 1m son 121 puntos: sin aviso.
    await page.getByTestId('time-range-2h').click()
    await resolution.selectOption('1m')
    await expect(estimate).toHaveCount(0)
  }
)

test(
  'AUD-13 y CA8 (0006): recortes (ratio > 1) y warnings de la API bajo el gráfico; con ratios ≤ 1, ninguno',
  { tag: '@metricas' },
  async () => {
    await goTo('metrics')
    await page.getByTestId('metric-selector').fill('builtin:host.cpu.usage')
    const warnings = page.getByTestId('api-warnings')
    // CA8 (0006): recortado es un ratio > 1 (pedido / máximo permitido).
    sim.metricRatios = { dataPointCountRatio: 1.5 }
    sim.metricWarnings = ['Aviso de métricas de la prueba']
    // Cada paso con una resolución nueva: una clave ya consultada sale de la caché sin petición.
    const resolution = page.getByTestId('metric-resolution')
    try {
      await resolution.selectOption('10m')
      await page.getByTestId('metric-run').click()
      await expect(warnings).toContainText(
        'builtin:host.cpu.usage: la API ha devuelto solo parte de los puntos'
      )
      await expect(warnings).toContainText('Aviso de métricas de la prueba')
      await expect(warnings).not.toContainText('dimensiones')

      sim.metricRatios = { dimensionCountRatio: 4 }
      sim.metricWarnings = []
      await resolution.selectOption('1h')
      await page.getByTestId('metric-run').click()
      await expect(warnings).toContainText('parte de las dimensiones')
      await expect(warnings).not.toContainText('parte de los puntos')

      // El XLSX lleva la resolución y los recortes como Aviso.
      const workbook = new ExcelJS.Workbook()
      await workbook.xlsx.load(
        readFileSync(await exportSaved('metric-chart', 'export-xlsx')) as unknown as ArrayBuffer
      )
      const info: [string, unknown][] = []
      workbook.getWorksheet('Info')?.eachRow((r) => {
        info.push([String(r.getCell(1).value), r.getCell(2).value])
      })
      expect(info.filter(([label]) => label === 'Resolución')).toEqual([['Resolución', '1h']])
      expect(
        info.filter(([label, value]) => label === 'Aviso' && String(value).includes('dimensiones'))
      ).toHaveLength(1)
    } finally {
      sim.metricRatios = {}
      sim.metricWarnings = []
    }
    // Una consulta sin recortes (ratios como los de vivo, muy por debajo de 1): solo queda la
    // resolución aplicada.
    sim.metricRatios = { dataPointCountRatio: 0.005, dimensionCountRatio: 0.005 }
    await resolution.selectOption('5m')
    await page.getByTestId('metric-run').click()
    await expect(page.getByText(/la API ha devuelto solo parte/)).toHaveCount(0)
    await expect(page.getByTestId('metric-resolution-applied')).toBeVisible()
  }
)

test(
  'AUD-13: el buscador elige con Enter sin lanzar la consulta, y dice «Sin resultados»',
  { tag: '@metricas' },
  async () => {
    await goTo('metrics')
    const search = page.getByTestId('metric-search')
    const selector = page.getByTestId('metric-selector')
    await expect(search).toHaveAttribute('maxlength', '100')
    await selector.fill('otra.metrica')

    const before = sim.metricsQueries
    await search.fill('idle')
    const results = page.getByTestId('metric-search-result')
    await expect(results).toHaveCount(1)
    await search.press('Enter')
    await expect(selector).toHaveValue('builtin:host.cpu.idle')
    await expect(search).toHaveValue('')
    // Aserción negativa: un margen para que una consulta indebida llegara.
    await page.waitForTimeout(500)
    expect(sim.metricsQueries).toBe(before)

    // Un click en un resultado hace lo mismo.
    await search.fill('cpu')
    await expect(results).toHaveCount(2)
    await results.filter({ hasText: 'CPU usage' }).click()
    await expect(selector).toHaveValue('builtin:host.cpu.usage')
    await expect(search).toHaveValue('')
    expect(sim.metricsQueries).toBe(before)

    await search.fill('nada-que-casar')
    await expect(page.getByTestId('metric-search-empty')).toBeVisible()
    await expect(results).toHaveCount(0)
    await search.fill('')
  }
)

test(
  'AUD-13: con varias métricas, la leyenda lleva el metricId delante',
  { tag: '@metricas' },
  async () => {
    await goTo('metrics')
    const chart = page.getByTestId('metric-chart')
    await page.getByTestId('metric-selector').fill('builtin:host.cpu.usage,builtin:host.cpu.idle')
    await page.getByTestId('metric-run').click()
    await expect
      .poll(async () => JSON.parse((await chart.getAttribute('data-series')) ?? '[]') as string[])
      .toEqual(['builtin:host.cpu.usage · HOST-AAA1', 'builtin:host.cpu.idle · HOST-AAA1'])

    // Con una sola, solo las dimensiones.
    await page.getByTestId('metric-selector').fill('builtin:host.cpu.usage')
    await page.getByTestId('metric-run').click()
    await expect
      .poll(async () => JSON.parse((await chart.getAttribute('data-series')) ?? '[]') as string[])
      .toEqual(['HOST-AAA1'])
  }
)

test(
  'CA3 (0005): i18n: cambiar de idioma con el gráfico de Métricas abierto lo rehace con el locale nuevo y la misma serie',
  { tag: '@metricas' },
  async () => {
    await runMetric('builtin:host.cpu.usage', '5m')
    const chart = page.getByTestId('metric-chart')
    // El canvas sale al montar el gráfico, antes de que llegue la consulta: la serie se lee con
    // espera (toHaveAttribute reintenta), nunca con una lectura suelta tras runMetric.
    const SERIES = JSON.stringify(['HOST-AAA1'])
    await expect(chart).toHaveAttribute('data-series', SERIES)
    await expect(chart).toHaveAttribute('data-locale', 'ES')

    // Botón de idioma de la barra superior: la página no se desmonta.
    await page.getByRole('button', { name: es.topbar.language }).click()
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await expect(chart).toHaveAttribute('data-locale', 'EN')
    await expect(chart.locator('canvas').first()).toBeVisible()
    await expect(chart).toHaveAttribute('data-series', SERIES)

    // Y de vuelta.
    await page.getByRole('button', { name: en.topbar.language }).click()
    await expect(page.locator('html')).toHaveAttribute('lang', 'es')
    await expect(chart).toHaveAttribute('data-locale', 'ES')
    await expect(chart.locator('canvas').first()).toBeVisible()
    await expect(chart).toHaveAttribute('data-series', SERIES)
    // Los errores de consola los comprueba el afterEach.
  }
)

test(
  'AUD-13: guardar con un nombre repetido dice que ya existe; cancelar limpia',
  { tag: '@metricas' },
  async () => {
    await goTo('metrics')
    await page.getByTestId('metric-selector').fill('builtin:host.cpu.usage')
    const dialogName = page.getByTestId('saved-query-name')
    await page.getByTestId('saved-query-save').click()
    await dialogName.fill('Consulta repetida')
    await page.getByTestId('form-save').click()
    const saved = page.getByTestId('saved-query').filter({ hasText: 'Consulta repetida' })
    await expect(saved).toHaveCount(1)

    await page.getByTestId('saved-query-save').click()
    await dialogName.fill('Consulta repetida')
    await page.getByTestId('form-save').click()
    await expect(page.getByText(es.errors.nameTaken)).toBeVisible()
    await expect(saved).toHaveCount(1)

    // Cancelar limpia el nombre y el error.
    await page.getByTestId('form-cancel').click()
    await expect(dialogName).toHaveCount(0)
    await page.getByTestId('saved-query-save').click()
    await expect(dialogName).toHaveValue('')
    await expect(page.getByText(es.errors.nameTaken)).toHaveCount(0)
    await page.getByTestId('form-cancel').click()

    await saved.getByTestId('saved-query-delete').click()
    const confirm = page.getByTestId('confirm-dialog')
    // Siempre pide confirmación (AUD-15: aserción fija, no condicional).
    await expect(confirm).toBeVisible()
    await expect(confirm).toHaveAttribute('role', 'alertdialog')
    await confirm.getByTestId('confirm-accept').click()
    await expect(confirm).toBeHidden()
    await expect(saved).toHaveCount(0)
  }
)

test(
  'Métricas: guardar, cargar desde la lista y desde Ctrl+K, y borrar una consulta',
  { tag: '@metricas' },
  async () => {
    await goTo('metrics')
    await page.getByTestId('metric-selector').fill('builtin:host.cpu.usage')
    await page.getByTestId('saved-query-save').click()
    await page.getByTestId('saved-query-name').fill('CPU producción')
    await page.getByTestId('form-save').click()
    const saved = page.getByTestId('saved-query').filter({ hasText: 'CPU producción' })
    await expect(saved).toHaveCount(1)

    await page.getByTestId('metric-selector').fill('builtin:host.mem.usage')
    await saved.click()
    await expect(page.getByTestId('metric-selector')).toHaveValue('builtin:host.cpu.usage')

    await goTo('home')
    await page.keyboard.press('Control+K')
    const palette = page.getByTestId('command-palette')
    await expect(palette.getByRole('option', { name: /CPU producción/ })).toHaveCount(1)
    await page.keyboard.type('CPU producción')
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/#\/metrics/)
    await expect(page.getByTestId('metric-selector')).toHaveValue('builtin:host.cpu.usage')

    await saved.getByTestId('saved-query-delete').click()
    const confirm = page.getByTestId('confirm-dialog')
    // Siempre pide confirmación (AUD-15: aserción fija, no condicional).
    await expect(confirm).toBeVisible()
    await expect(confirm).toHaveAttribute('role', 'alertdialog')
    await confirm.getByTestId('confirm-accept').click()
    await expect(confirm).toBeHidden()
    await expect(page.getByTestId('saved-query').filter({ hasText: 'CPU producción' })).toHaveCount(
      0
    )
  }
)

test(
  'Métricas no disponible: sin metrics.read tras probar la conexión, o sin token clásico',
  { tag: '@metricas' },
  async () => {
    await invoke('connection:test', { environmentId: env['Sin métricas'] })
    await activate('Sin métricas')
    await goTo('metrics')
    await expect(page.getByTestId('module-unavailable')).toContainText('metrics.read')
    await goTo('problems')
    await expect(page.getByTestId('module-unavailable')).toHaveCount(0)
    await expect(page.getByTestId('problem-row')).toHaveCount(3)

    await activate('Sin token')
    await goTo('metrics')
    await expect(page.getByTestId('module-unavailable')).toContainText(
      'Este módulo usa el token clásico'
    )
  }
)

/**
 * Ficha 0107: capturas de evidencias (`captureEvidence`, de `e2e/evidence.ts`). Se prueban sobre
 * Métricas porque tiene un gráfico de ECharts que anima al pintarse, un campo de texto
 * (`metric-selector`) y, en el menú, enlaces con tooltip de Radix.
 *
 * Contrato que fijan estos tests (sacado de la ficha):
 * - `captureEvidence(page, { criterio, zona, nota?, conservarFoco?, conservarRaton? })`: con
 *   `VIGIA_EVIDENCIAS=1` en el entorno del proceso de Playwright (se lee al llamarla), guarda en
 *   `test-results/evidencias/<ficha>/` la captura de la zona (`…-zona.png`), la de la ventana
 *   (`…-ventana.png`) y una entrada en `manifiesto.json` con `criterio`, el título del test, `nota`,
 *   las dos rutas y `estable`. La ficha sale del criterio («CA1 (0107)» → `0107`).
 * - Sin `VIGIA_EVIDENCIAS`, no hace nada.
 *
 * El manifiesto se lee sin suponer más nombres de campo que los de la ficha (`criterio`, `nota`,
 * `estable`): el título y las rutas se buscan por su valor. Vale un array JSON, un objeto con un
 * array dentro o una entrada JSON por línea.
 *
 * Con `--repeat-each` y varios workers, varias copias del mismo test escriben a la vez en la
 * carpeta de la 0107. Por eso no se borra la carpeta antes de cada test (Playwright ya vacía
 * `test-results` al empezar la tirada) y cada copia lee solo sus entradas: las marca con una
 * `nota` propia (`copyNote`), única por copia, y filtra el manifiesto por criterio y nota.
 */
const EVIDENCE_ROOT = join(process.cwd(), 'test-results', 'evidencias')
const EVIDENCE_DIR = join(EVIDENCE_ROOT, '0107')
const EVIDENCE_ENV = 'VIGIA_EVIDENCIAS'
const SHOT = { caret: 'hide', animations: 'disabled' } as const

type EvidenceEntry = Record<string, unknown>

/** Ejecuta `body` con `VIGIA_EVIDENCIAS` puesta a 1 (o quitada) y la deja como estaba. */
async function withEvidenceEnv(on: boolean, body: () => Promise<void>): Promise<void> {
  const before = process.env[EVIDENCE_ENV]
  if (on) process.env[EVIDENCE_ENV] = '1'
  else delete process.env[EVIDENCE_ENV]
  try {
    await body()
  } finally {
    if (before === undefined) delete process.env[EVIDENCE_ENV]
    else process.env[EVIDENCE_ENV] = before
  }
}

/** Entradas del manifiesto de la 0107 (vacío si no existe). */
function readManifest(): EvidenceEntry[] {
  const file = join(EVIDENCE_DIR, 'manifiesto.json')
  if (!existsSync(file)) return []
  const text = readFileSync(file, 'utf8').trim()
  if (text === '') return []
  try {
    const data = JSON.parse(text) as unknown
    if (Array.isArray(data)) return data as EvidenceEntry[]
    if (data !== null && typeof data === 'object') {
      const inner = Object.values(data).find((value) => Array.isArray(value))
      return (inner ?? [data]) as EvidenceEntry[]
    }
    return []
  } catch {
    return text
      .split(/\r?\n/)
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as EvidenceEntry)
  }
}

/** Entradas de este criterio con esta nota: las que ha dejado esta copia del test. */
function entriesOf(criterio: string, nota: string): EvidenceEntry[] {
  return readManifest().filter((entry) => entry['criterio'] === criterio && entry['nota'] === nota)
}

/** Una `nota` única para esta copia del test (repeat-each, reintento y tirada). */
function copyNote(label: string): string {
  const info = test.info()
  return `${label} [${info.repeatEachIndex}.${info.retry}.${randomUUID()}]`
}

/** Ruta en disco de un valor del manifiesto (absoluta, relativa a la carpeta o a la raíz). */
function onDisk(path: string): string {
  if (isAbsolute(path)) return path
  const inDir = join(EVIDENCE_DIR, path)
  return existsSync(inDir) ? inDir : resolve(path)
}

/** La ruta del manifiesto que acaba en `-<kind>.png`, que tiene que existir. */
function shotPath(entry: EvidenceEntry, kind: 'zona' | 'ventana'): string {
  const found = Object.values(entry).find(
    (value): value is string => typeof value === 'string' && value.endsWith(`-${kind}.png`)
  )
  expect(found, `ruta …-${kind}.png en ${JSON.stringify(entry)}`).toBeDefined()
  const path = onDisk(found as string)
  expect(existsSync(path), path).toBe(true)
  return path
}

/** Ancho y alto de un PNG (cabecera IHDR). */
function pngSize(path: string): { width: number; height: number } {
  const bytes = readFileSync(path)
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

/**
 * El PNG mide lo mismo que la caja (CSS) por la escala de la pantalla. Playwright redondea el
 * recorte de `locator.screenshot()` a píxeles CSS enteros (hasta 1 px CSS de más o de menos, que
 * son `dpr` píxeles físicos) y luego a píxeles físicos (1 px más). Con escala 1 (el CI), 1 px.
 */
async function expectPngFits(
  path: string,
  box: { width: number; height: number },
  what: string
): Promise<void> {
  const dpr = await page.evaluate(() => window.devicePixelRatio)
  const size = pngSize(path)
  const tolerance = dpr === 1 ? 1 : dpr + 1
  const detail = `(PNG ${size.width}×${size.height}, caja ${box.width}×${box.height}, escala ${dpr})`
  expect(Math.abs(size.width - box.width * dpr), `${what}: ancho ${detail}`).toBeLessThanOrEqual(
    tolerance
  )
  expect(Math.abs(size.height - box.height * dpr), `${what}: alto ${detail}`).toBeLessThanOrEqual(
    tolerance
  )
}

async function zoneBox(zona: Locator): Promise<{ width: number; height: number }> {
  const box = await zona.boundingBox()
  expect(box, 'la zona tiene caja').not.toBeNull()
  return box as { width: number; height: number }
}

/** Todos los ficheros bajo `test-results/evidencias`. */
function evidenceFiles(): string[] {
  if (!existsSync(EVIDENCE_ROOT)) return []
  return readdirSync(EVIDENCE_ROOT, { recursive: true, withFileTypes: true })
    .filter((item) => item.isFile())
    .map((item) => join(item.parentPath, item.name))
    .sort()
}

/** Métricas con su gráfico ya con series y una evidencia de la zona del gráfico, con `nota`. */
async function chartEvidence(criterio: string, nota: string): Promise<Locator> {
  await runMetric('builtin:host.cpu.usage', '5m')
  const chart = page.getByTestId('metric-chart')
  await expect(chart).not.toHaveAttribute('data-series', '[]')
  await captureEvidence(page, { criterio, zona: chart, nota })
  return chart
}

test.describe('ficha 0107: capturas de evidencias', { tag: '@metricas' }, () => {
  test('CA1 (0107): con VIGIA_EVIDENCIAS=1 deja la zona, la ventana y su entrada en el manifiesto', async () => {
    await withEvidenceEnv(true, async () => {
      const nota = copyNote('gráfico de Métricas')
      const chart = await chartEvidence('CA1 (0107)', nota)
      const entries = entriesOf('CA1 (0107)', nota)
      expect(entries, 'una entrada de CA1 (0107)').toHaveLength(1)
      const entry = entries[0] as EvidenceEntry
      const title = test.info().title
      expect(
        Object.values(entry).some((value) => typeof value === 'string' && value.includes(title)),
        `el título del test en ${JSON.stringify(entry)}`
      ).toBe(true)
      expect(entry['nota']).toBe(nota)
      await expectPngFits(shotPath(entry, 'zona'), await zoneBox(chart), 'zona')
      await expectPngFits(shotPath(entry, 'ventana'), await viewportSize(), 'ventana')
    })
  })

  test('CA1b (0107): dos evidencias del mismo criterio con zonas distintas no se pisan', async () => {
    await withEvidenceEnv(true, async () => {
      const nota = copyNote('gráfico y selector de Métricas')
      const chart = await chartEvidence('CA1b (0107)', nota)
      const selector = page.getByTestId('metric-selector')
      await captureEvidence(page, { criterio: 'CA1b (0107)', zona: selector, nota })
      const entries = entriesOf('CA1b (0107)', nota)
      expect(entries, 'dos entradas de CA1b (0107)').toHaveLength(2)
      const paths = entries.flatMap((entry) => [
        shotPath(entry, 'zona'),
        shotPath(entry, 'ventana')
      ])
      expect(new Set(paths).size, `cuatro PNG distintos: ${paths.join(', ')}`).toBe(4)
      for (const path of paths) expect(path).toMatch(/CA1b-\d+-(zona|ventana)\.png$/)
      // Cada zona conserva su tamaño: la segunda no ha sobrescrito la primera.
      const [first, second] = entries as [EvidenceEntry, EvidenceEntry]
      await expectPngFits(shotPath(first, 'zona'), await zoneBox(chart), 'zona 1')
      await expectPngFits(shotPath(second, 'zona'), await zoneBox(selector), 'zona 2')
    })
  })

  test('CA2 (0107): sin VIGIA_EVIDENCIAS no deja ningún fichero en test-results/evidencias', async () => {
    await withEvidenceEnv(false, async () => {
      // Otras copias de los tests de la 0107 pueden estar escribiendo en paralelo: se miran los
      // ficheros que dejaría este test (`CA2-…`) y sus entradas en el manifiesto.
      const nota = copyNote('gráfico de Métricas')
      const ownFiles = (): string[] =>
        evidenceFiles().filter((file) => basename(file).startsWith('CA2-'))
      const before = ownFiles()
      await chartEvidence('CA2 (0107)', nota)
      expect(ownFiles()).toEqual(before)
      expect(entriesOf('CA2 (0107)', nota)).toEqual([])
    })
  })

  test('CA3 (0107): con un gráfico de ECharts en la zona, la captura no sale a media animación', async () => {
    await withEvidenceEnv(true, async () => {
      // Se captura nada más tener series: ECharts aún está animando el gráfico.
      const nota = copyNote('gráfico de Métricas')
      const chart = await chartEvidence('CA3 (0107)', nota)
      const entries = entriesOf('CA3 (0107)', nota)
      expect(entries).toHaveLength(1)
      const entry = entries[0] as EvidenceEntry
      expect(entry['estable']).toBe(true)
      // Otra captura justo después da los mismos bytes: la guardada ya era la imagen final.
      const zone = readFileSync(shotPath(entry, 'zona'))
      const whole = readFileSync(shotPath(entry, 'ventana'))
      expect(Buffer.compare(await chart.screenshot(SHOT), zone), 'zona').toBe(0)
      expect(Buffer.compare(await page.screenshot(SHOT), whole), 'ventana').toBe(0)
    })
  })

  test('CA3b (0107): si la zona no deja de cambiar, guarda la última con estable: false y no falla', async () => {
    test.setTimeout(120_000)
    await withEvidenceEnv(true, async () => {
      await goTo('metrics')
      // Zona de prueba que cambia sin parar (con un temporizador, que animations: 'disabled' no para).
      await page.evaluate(() => {
        const ticker = document.createElement('div')
        ticker.dataset['testid'] = 'evidence-0107-ticker'
        Object.assign(ticker.style, {
          position: 'fixed',
          top: '120px',
          left: '320px',
          width: '200px',
          height: '60px',
          zIndex: '9999',
          color: '#fff',
          font: '20px sans-serif'
        })
        let tick = 0
        const timer = window.setInterval(() => {
          tick += 1
          ticker.textContent = String(tick)
          ticker.style.background = tick % 2 === 0 ? '#b00020' : '#0040b0'
        }, 20)
        ;(window as unknown as Record<string, number>)['__evidence0107Timer'] = timer
        document.body.appendChild(ticker)
      })
      try {
        const ticker = page.getByTestId('evidence-0107-ticker')
        const nota = copyNote('zona que no para')
        await captureEvidence(page, { criterio: 'CA3b (0107)', zona: ticker, nota })
        const entries = entriesOf('CA3b (0107)', nota)
        expect(entries).toHaveLength(1)
        const entry = entries[0] as EvidenceEntry
        expect(entry['estable']).toBe(false)
        await expectPngFits(shotPath(entry, 'zona'), await zoneBox(ticker), 'zona')
        shotPath(entry, 'ventana')
      } finally {
        await page.evaluate(() => {
          window.clearInterval((window as unknown as Record<string, number>)['__evidence0107Timer'])
          document.querySelector('[data-testid="evidence-0107-ticker"]')?.remove()
        })
      }
    })
  })

  test('CA3c (0107): quita el foco y el tooltip antes de capturar, salvo con conservarFoco', async () => {
    await withEvidenceEnv(true, async () => {
      await runMetric('builtin:host.cpu.usage', '5m')
      await expect(page.getByTestId('metric-chart')).not.toHaveAttribute('data-series', '[]')
      const field = page.getByTestId('metric-selector')
      const focused = (): Promise<boolean> =>
        field.evaluate((element) => element === document.activeElement)
      const tooltip = page.getByRole('tooltip')

      // Foco en el campo (cursor de texto) y ratón sobre un enlace del menú con tooltip.
      await field.focus()
      await hoverFresh(page, page.getByTestId('nav-topology'))
      await expect(tooltip).toBeVisible()
      expect(await focused(), 'el campo tiene el foco antes de capturar').toBe(true)

      const nota = copyNote('campo del selector')
      await captureEvidence(page, { criterio: 'CA3c (0107)', zona: field, nota })
      const [entry] = entriesOf('CA3c (0107)', nota)
      expect(entry?.['estable']).toBe(true)
      // Sin esperas: lo que hay justo al acabar de capturar es lo que salió en la captura.
      expect(await tooltip.count(), 'tooltip al acabar de capturar').toBe(0)
      expect(await focused(), 'por defecto quita el foco').toBe(false)

      // Con conservarFoco, el campo sigue con el foco después de capturar.
      await field.focus()
      await captureEvidence(page, {
        criterio: 'CA3c (0107)',
        zona: field,
        nota,
        conservarFoco: true
      })
      const entries = entriesOf('CA3c (0107)', nota)
      expect(entries).toHaveLength(2)
      expect(entries[1]?.['estable']).toBe(true)
      expect(await focused(), 'con conservarFoco, el campo sigue con el foco').toBe(true)
      await moveToNeutral(page)
    })
  })
})
