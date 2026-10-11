import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { moveToNeutral } from './hover'
import {
  activate,
  env,
  exportSaved,
  goTo,
  goToRoute,
  invoke,
  page,
  runMetric,
  setupViewsApp
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
