import { expect, type Locator, test } from '@playwright/test'
import {
  BREAKDOWN_BROWSER_ID,
  BREAKDOWN_HTTP_ID,
  breakdownLocation,
  breakdownStep,
  INFO_FEW_ID,
  MONITOR_BAND_CLOSED,
  MONITOR_BAND_OPEN,
  MONITOR_BROWSER_ID,
  MONITOR_HTTP_ID,
  MONITOR_INFO_APP,
  MONITOR_INFO_HIDDEN,
  MONITOR_INFO_HTTP_APP,
  MONITOR_INFO_LOCATIONS,
  MONITOR_INFO_OTHER,
  MONITOR_INFO_REQUESTS,
  MONITOR_INFO_STEPS,
  MONITOR_TIMESTAMPS,
  monitorInfoBrowserPropertyCount,
  TOKEN_NO_ENTITIES
} from './views/fixtures'
import {
  clickInPlace,
  createEnvironment,
  currentRoute,
  env,
  goTo,
  invoke,
  page,
  reloadUi,
  settledBox,
  setupViewsApp
} from './views/harness'
import { sim } from './views/sim-state'
import {
  settledRequests,
  loneNumber,
  dataKeys,
  tableOrder,
  gridColumns,
  MonitorPageKind,
  MONITOR_PAGES,
  monitorPage,
  openMonitorPage,
  monitorInfoCard,
  openMonitorInfo
} from './views/helpers'

/**
 * Specs de vistas por zona (ficha 0070): las páginas de los monitores (`@monitor`). Arnés en
 * `e2e/views/` (ver su cabecera).
 */

setupViewsApp()

test(
  'CA6 (0022): entities:monitorMetrics por IPC con ids inventados de browser y HTTP monitor',
  { tag: '@monitor' },
  async () => {
    const series = (values: (number | null)[]): { timestamps: number[]; values: unknown[] } => ({
      timestamps: MONITOR_TIMESTAMPS,
      values
    })

    const browser = await invoke<Record<string, unknown>>('entities:monitorMetrics', {
      environmentId: env['Producción'],
      entityId: MONITOR_BROWSER_ID,
      timeRange: '2h'
    })
    // Dos consultas al simulador (series y marcadores con Inf), las dos con el rango global y
    // solo con el catálogo de su tipo.
    expect(sim.monitorMetricQueries).toHaveLength(2)
    for (const query of sim.monitorMetricQueries) {
      expect(query.get('from')).toBe('now-2h')
      expect(query.get('metricSelector') ?? '').not.toContain('builtin:synthetic.http.')
    }
    expect(sim.monitorMetricQueries.map((q) => q.get('resolution') ?? 'API').sort()).toEqual([
      'API',
      'Inf'
    ])
    expect(browser).toMatchObject({
      kind: 'browser',
      resolution: '10m',
      series: {
        availability: series([100, null, 50]),
        duration: series([4200, null, 4800]),
        executions: { ok: series([3, null, 1]), failed: series([0, null, 1]) },
        performance: {
          largestContentfulPaint: series([1900, null, 2300]),
          visuallyComplete: series([2500, null, 2900]),
          cumulativeLayoutShift: series([0.05, null, 0.2]),
          speedIndex: series([1600, null, 1800])
        },
        httpTimings: null
      },
      totals: {
        availability: 87.5,
        duration: { avg: 4550, median: 4400 },
        executions: { ok: 4, failed: 1 }
      },
      warnings: [],
      partial: []
    })

    const http = await invoke<Record<string, unknown>>('entities:monitorMetrics', {
      environmentId: env['Producción'],
      entityId: MONITOR_HTTP_ID,
      timeRange: '2h'
    })
    expect(sim.monitorMetricQueries).toHaveLength(4)
    for (const query of sim.monitorMetricQueries.slice(2)) {
      expect(query.get('from')).toBe('now-2h')
      expect(query.get('metricSelector') ?? '').not.toContain('builtin:synthetic.browser.')
    }
    expect(http).toMatchObject({
      kind: 'http',
      resolution: '10m',
      series: {
        // Todas las localizaciones juntas.
        availability: series([100, null, 75]),
        duration: series([280, null, 350]),
        executions: { ok: series([6, null, 4]), failed: series([0, null, 2]) },
        httpTimings: {
          dns: series([3, null, 5]),
          tcpConnect: series([10, null, 12]),
          tlsHandshake: series([20, null, 25]),
          timeToFirstByte: series([120, null, 160])
        },
        performance: null
      },
      // Sin mediana en HTTP (paso 0 de la ficha).
      totals: {
        availability: 92.5,
        duration: { avg: 310, median: null },
        executions: { ok: 10, failed: 2 }
      },
      warnings: [],
      partial: []
    })
  }
)

test(
  'CA5 (0023): entities:monitorBreakdown por IPC con ids inventados de browser y HTTP monitor',
  { tag: '@monitor' },
  async () => {
    const browser = await invoke<Record<string, unknown>>('entities:monitorBreakdown', {
      environmentId: env['Producción'],
      entityId: BREAKDOWN_BROWSER_ID,
      timeRange: '2h'
    })
    // Las consultas llegan al simulador, con el rango global y solo con el catálogo de su tipo.
    expect(sim.monitorBreakdownQueries.length).toBeGreaterThan(0)
    const browserQueries = sim.monitorBreakdownQueries.length
    for (const query of sim.monitorBreakdownQueries) {
      expect(query.get('from')).toBe('now-2h')
      expect(query.get('resolution')).toBe('Inf')
      expect(query.get('metricSelector') ?? '').not.toContain('builtin:synthetic.http.')
    }
    expect(browser).toMatchObject({
      // De peor a mejor disponibilidad; el browser monitor no tiene fallidas por localización.
      locations: [
        {
          id: breakdownLocation(2),
          name: 'Localización dos',
          availability: 80,
          duration: 6300,
          failed: null
        },
        {
          id: breakdownLocation(3),
          name: breakdownLocation(3),
          availability: 97.5,
          duration: 5200,
          failed: null
        },
        {
          id: breakdownLocation(1),
          name: 'Localización uno',
          availability: 100,
          duration: 4100,
          failed: null
        }
      ],
      // Por duración (la dimensión no trae número de secuencia), con su peso en el total.
      steps: [
        {
          id: breakdownStep('SYNTHETIC_TEST_STEP', 2),
          name: 'Paso dos',
          duration: 2500,
          share: 62.5
        },
        {
          id: breakdownStep('SYNTHETIC_TEST_STEP', 1),
          name: 'Paso uno',
          duration: 1000,
          share: 25
        },
        {
          id: breakdownStep('SYNTHETIC_TEST_STEP', 3),
          name: 'Paso tres',
          duration: 500,
          share: 12.5
        }
      ]
    })
    expect((browser['locations'] as unknown[]).length).toBe(3)
    expect((browser['steps'] as unknown[]).length).toBe(3)

    const http = await invoke<Record<string, unknown>>('entities:monitorBreakdown', {
      environmentId: env['Producción'],
      entityId: BREAKDOWN_HTTP_ID,
      timeRange: '2h'
    })
    expect(sim.monitorBreakdownQueries.length).toBeGreaterThan(browserQueries)
    for (const query of sim.monitorBreakdownQueries.slice(browserQueries)) {
      expect(query.get('from')).toBe('now-2h')
      expect(query.get('resolution')).toBe('Inf')
      expect(query.get('metricSelector') ?? '').not.toContain('builtin:synthetic.browser.')
    }
    expect(http).toMatchObject({
      locations: [
        {
          id: breakdownLocation(3),
          name: 'Localización tres',
          availability: 90,
          duration: 420,
          failed: 4
        },
        {
          id: breakdownLocation(1),
          name: 'Localización uno',
          availability: 99,
          duration: 310,
          failed: 1
        },
        // Sin serie de FAILURE: 0 fallidas.
        {
          id: breakdownLocation(2),
          name: 'Localización dos',
          availability: 100,
          duration: 250,
          failed: 0
        }
      ],
      steps: [
        {
          id: breakdownStep('HTTP_CHECK_STEP', 3),
          name: 'Petición tres',
          duration: 200,
          share: 50
        },
        { id: breakdownStep('HTTP_CHECK_STEP', 2), name: 'Petición dos', duration: 120, share: 30 },
        { id: breakdownStep('HTTP_CHECK_STEP', 1), name: 'Petición uno', duration: 80, share: 20 }
      ]
    })
    expect((http['locations'] as unknown[]).length).toBe(3)
    expect((http['steps'] as unknown[]).length).toBe(3)
  }
)
const MONITOR_MARKER_LABELS = [
  ['availability', 'Disponibilidad'],
  ['duration', 'Duración'],
  ['executions', 'Ejecuciones'],
  ['locations', 'Localizaciones'],
  ['problems', 'Problemas']
] as const
const MONITOR_METRIC_MARKERS = ['availability', 'duration', 'executions'] as const
const MONITOR_CHART_KINDS = ['availability', 'duration', 'executions', 'performance'] as const
type MonitorChartKind = (typeof MONITOR_CHART_KINDS)[number]
const MONITOR_CHART_TITLES: Record<MonitorChartKind, string> = {
  availability: 'Disponibilidad',
  duration: 'Duración',
  executions: 'Ejecuciones',
  performance: 'Rendimiento'
}
/**
 * Las series de cada gráfico (`data-series`, en es). Las de rendimiento, por nombre y sin orden:
 * en browser, LCP, visually complete y speed index (el CLS, sin unidad de tiempo, puede ir o no);
 * en HTTP, DNS, TCP y TLS (el primer byte puede ir o no).
 */
const MONITOR_PERFORMANCE_SERIES: Record<MonitorPageKind, RegExp[]> = {
  browser: [/LCP|largest\s*contentful\s*paint/i, /visually\s*complete/i, /speed\s*index/i],
  http: [/DNS/i, /TCP/i, /TLS/i]
}
const monitorMarker = (id: string): Locator => page.getByTestId(`monitor-marker-${id}`)
const monitorChartPanel = (kind: MonitorChartKind): Locator =>
  page.locator(`[data-testid="monitor-chart-panel"][data-kind="${kind}"]`)
const monitorChartPlot = (kind: MonitorChartKind): Locator =>
  monitorChartPanel(kind).getByTestId(`monitor-chart-${kind}`)
const monitorBand = (): Locator =>
  monitorChartPanel('availability').getByTestId('monitor-problem-band')
const monitorSegment = (problemId: string): Locator =>
  monitorBand().locator(`[data-testid="monitor-problem-segment"][data-problem-id="${problemId}"]`)

/** Ficha 0024: espera a que el gráfico tenga sus series (se monta vacío mientras carga). */
async function monitorChartSeries(kind: MonitorChartKind): Promise<string[]> {
  const plot = monitorChartPlot(kind)
  await expect(plot.locator('canvas').first()).toBeVisible()
  await expect(plot).toHaveAttribute('data-series', /\[.+\]/)
  return JSON.parse((await plot.getAttribute('data-series')) ?? '[]') as string[]
}

/** Ficha 0024: comprueba las series de un gráfico del monitor de ese tipo. */
async function expectMonitorChartSeries(
  pageKind: MonitorPageKind,
  kind: MonitorChartKind
): Promise<void> {
  const series = await monitorChartSeries(kind)
  if (kind === 'availability' || kind === 'duration') {
    expect(series, kind).toHaveLength(1)
    return
  }
  if (kind === 'executions') {
    expect(series, kind).toHaveLength(2)
    expect(series[0], 'correctas').toMatch(/correctas/i)
    expect(series[1], 'fallidas').toMatch(/fallidas/i)
    return
  }
  const expected = MONITOR_PERFORMANCE_SERIES[pageKind]
  expect(series.length, `${pageKind}: series de rendimiento`).toBeGreaterThanOrEqual(3)
  expect(series.length, `${pageKind}: series de rendimiento`).toBeLessThanOrEqual(4)
  for (const pattern of expected) {
    expect(
      series.some((name) => pattern.test(name)),
      `${pageKind}: ${String(pattern)} en ${JSON.stringify(series)}`
    ).toBe(true)
  }
}

/** Ficha 0024: los valores de los marcadores del browser monitor inventado, ya formateados (es). */
async function expectBrowserMonitorMarkers(): Promise<void> {
  // Disponibilidad del rango: 87,5 %, por debajo del 95 % (error, con texto además del color).
  const availability = monitorMarker('availability')
  await expect(availability.getByTestId('monitor-marker-value')).toHaveText(/^87,5\s?%$/)
  await expect(availability.getByTestId('monitor-marker-value')).toHaveAttribute(
    'data-level',
    'error'
  )
  await expect(availability.getByTestId('monitor-marker-level')).toBeVisible()
  await expect(availability.getByTestId('monitor-marker-level')).toHaveText(/\S/)
  // Duración: media 4550 ms (en s, con un decimal) y mediana 4400 ms.
  const duration = monitorMarker('duration')
  await expect(duration.getByTestId('monitor-marker-value')).toHaveText(/^4,[56]\s?s$/)
  await expect(duration.getByTestId('monitor-marker-secondary')).toContainText(/mediana/i)
  await expect(duration.getByTestId('monitor-marker-secondary')).toContainText(/(^|[^\d.,])4,4\s?s/)
  // Ejecuciones: 4 correctas y 1 fallida, en color de error.
  const executions = monitorMarker('executions')
  await expect(executions.getByTestId('monitor-marker-value')).toHaveText(/^4$/)
  await expect(executions.getByTestId('monitor-marker-secondary')).toContainText(loneNumber('1'))
  await expect(executions.getByTestId('monitor-marker-secondary')).toHaveAttribute(
    'data-level',
    'error'
  )
  // Localizaciones (0023): 3, dos por debajo del 100 %.
  const locations = monitorMarker('locations')
  await expect(locations.getByTestId('monitor-marker-value')).toHaveText(/^3$/)
  await expect(locations.getByTestId('monitor-marker-secondary')).toContainText(loneNumber('2'))
  // Problemas: 1 abierto y 1 cerrado.
  const problems = monitorMarker('problems')
  await expect(problems.getByTestId('monitor-marker-open')).toHaveText(loneNumber('1'))
  await expect(problems.getByTestId('monitor-marker-closed')).toHaveText(loneNumber('1'))
}

/** Ficha 0024: los valores de los marcadores del HTTP monitor inventado, ya formateados (es). */
async function expectHttpMonitorMarkers(): Promise<void> {
  // Disponibilidad del rango: 92,5 %, por debajo del 95 % (error, con texto).
  const availability = monitorMarker('availability')
  await expect(availability.getByTestId('monitor-marker-value')).toHaveText(/^92,5\s?%$/)
  await expect(availability.getByTestId('monitor-marker-value')).toHaveAttribute(
    'data-level',
    'error'
  )
  await expect(availability.getByTestId('monitor-marker-level')).toHaveText(/\S/)
  // Duración: media 310 ms; el HTTP monitor no tiene mediana (0022): no se pinta.
  const duration = monitorMarker('duration')
  await expect(duration.getByTestId('monitor-marker-value')).toHaveText(/^310\s?ms$/)
  await expect(duration).not.toContainText(/mediana/i)
  // Ejecuciones: 10 correctas y 2 fallidas, en color de error.
  const executions = monitorMarker('executions')
  await expect(executions.getByTestId('monitor-marker-value')).toHaveText(/^10$/)
  await expect(executions.getByTestId('monitor-marker-secondary')).toContainText(loneNumber('2'))
  await expect(executions.getByTestId('monitor-marker-secondary')).toHaveAttribute(
    'data-level',
    'error'
  )
  // Localizaciones (0023): 4, una por debajo del 100 %.
  const locations = monitorMarker('locations')
  await expect(locations.getByTestId('monitor-marker-value')).toHaveText(/^4$/)
  await expect(locations.getByTestId('monitor-marker-secondary')).toContainText(loneNumber('1'))
  // Problemas: 0 abiertos y 1 cerrado.
  const problems = monitorMarker('problems')
  await expect(problems.getByTestId('monitor-marker-open')).toHaveText(loneNumber('0'))
  await expect(problems.getByTestId('monitor-marker-closed')).toHaveText(loneNumber('1'))
}

/** Ficha 0024: CA1 y CA2, la misma comprobación para cada tipo de monitor. */
async function expectMonitorPage(kind: MonitorPageKind): Promise<void> {
  const entityPage = await openMonitorPage(kind)
  const row = entityPage.getByTestId('monitor-markers')
  await expect(row).toBeVisible()

  // Los cinco marcadores, con su nombre y sus valores.
  for (const [id, label] of MONITOR_MARKER_LABELS) {
    await expect(row.getByTestId(`monitor-marker-${id}`), id).toBeVisible()
    await expect(row.getByTestId(`monitor-marker-${id}`), id).toContainText(label)
  }
  if (kind === 'browser') await expectBrowserMonitorMarkers()
  else await expectHttpMonitorMarkers()

  // Los cuatro gráficos, en su orden, con su título y sus series.
  const section = entityPage.getByTestId('monitor-charts')
  await expect(section).toBeVisible()
  const panels = section.getByTestId('monitor-chart-panel')
  await expect(panels).toHaveCount(4)
  for (const [index, chart] of MONITOR_CHART_KINDS.entries()) {
    const panel = panels.nth(index)
    await expect(panel, `posición ${index + 1}`).toHaveAttribute('data-kind', chart)
    await expect(panel.getByRole('heading').first(), chart).toContainText(
      MONITOR_CHART_TITLES[chart]
    )
    await expectMonitorChartSeries(kind, chart)
  }

  // Ni el bloque ni el texto de «Página en construcción», ni marcadores de otro tipo.
  await expect(entityPage.getByTestId('entity-under-construction')).toHaveCount(0)
  await expect(entityPage).not.toContainText('Página en construcción')
  await expect(page.getByTestId('service-markers')).toHaveCount(0)
  await expect(page.getByTestId('host-markers')).toHaveCount(0)

  // Marcadores y gráficos comparten una sola llamada al canal de métricas (sus dos consultas),
  // con el monitor y el rango global.
  await settledRequests()
  expect(sim.monitorMetricQueries).toHaveLength(2)
  for (const query of sim.monitorMetricQueries) {
    expect(`${query.get('metricSelector')} ${query.get('entitySelector')}`).toContain(
      MONITOR_PAGES[kind].id
    )
    expect(query.get('from')).toBe('now-2h')
  }
}

test(
  'CA1 (0024): la página de un browser monitor enseña los cinco marcadores con sus valores y los cuatro gráficos con sus series, sin «Página en construcción»',
  { tag: '@monitor' },
  async () => {
    await expectMonitorPage('browser')
  }
)

test(
  'CA2 (0024): la página de un HTTP monitor enseña los cinco marcadores con sus valores y los cuatro gráficos, el cuarto con los tiempos HTTP',
  { tag: '@monitor' },
  async () => {
    await expectMonitorPage('http')
  }
)

// Lo que el simulador puede dejar «sin métrica» es el papel entero sin series: main da `null` por
// tipo (rendimiento en HTTP, tiempos en browser), nunca en el gráfico de su propio tipo. Aquí, el
// browser monitor sin ninguna métrica de rendimiento.
test(
  'CA3 (0024): con el rendimiento sin métrica, su gráfico no sale, la rejilla queda en tres y el resto de marcadores y gráficos sí',
  { tag: '@monitor' },
  async () => {
    sim.monitorPerformanceEmpty = true
    const entityPage = await openMonitorPage('browser')

    // Marcadores: los cinco, con sus valores.
    for (const [id] of MONITOR_MARKER_LABELS) {
      await expect(monitorMarker(id), id).toBeVisible()
    }
    await expectBrowserMonitorMarkers()

    // Gráficos: los tres primeros, con sus series; el de rendimiento, ni el panel.
    const panels = entityPage.getByTestId('monitor-charts').getByTestId('monitor-chart-panel')
    for (const kind of ['availability', 'duration', 'executions'] as const) {
      await expectMonitorChartSeries('browser', kind)
    }
    await expect(panels).toHaveCount(3)
    expect(
      await panels.evaluateAll((els) => els.map((el) => el.getAttribute('data-kind')))
    ).toEqual(['availability', 'duration', 'executions'])
    await expect(monitorChartPanel('performance')).toHaveCount(0)
    await expect(page.getByTestId('monitor-chart-performance')).toHaveCount(0)
  }
)

test(
  'CA5 (0024): la franja de problemas sale sobre el gráfico de disponibilidad con los problemas del monitor, y pulsar un tramo abre el problema',
  { tag: '@monitor' },
  async () => {
    await openMonitorPage('browser')
    await monitorChartSeries('availability')
    const band = monitorBand()
    await expect(band).toBeVisible()
    await expect(band.getByTestId('monitor-problem-segment')).toHaveCount(2)
    for (const { problemId } of [MONITOR_BAND_OPEN, MONITOR_BAND_CLOSED]) {
      await expect(monitorSegment(problemId), problemId).toHaveCount(1)
    }
    // Solo en el panel de la disponibilidad.
    await expect(page.getByTestId('monitor-problem-band')).toHaveCount(1)

    // La lista se pide con el monitor y el rango global.
    await settledRequests()
    const lists = sim.entityProblemListQueries.filter((query) =>
      (query.get('problemSelector') ?? '').includes(MONITOR_BROWSER_ID)
    )
    expect(lists).toHaveLength(1)
    expect(lists[0]?.get('problemSelector')).toBe(`affectedEntities("${MONITOR_BROWSER_ID}")`)
    expect(lists[0]?.get('from')).toBe('now-2h')

    // Encima del gráfico: la franja acaba antes de que empiece el canvas.
    const bandBox = await settledBox(band)
    const plotBox = await settledBox(monitorChartPlot('availability'))
    expect(bandBox.y + bandBox.height).toBeLessThanOrEqual(plotBox.y + 1)

    // Pulsar un tramo (trayéndolo a la vista) abre ese problema.
    await clickInPlace(monitorSegment(MONITOR_BAND_CLOSED.problemId), { scroll: true })
    await expect(page.getByTestId('problem-page')).toBeVisible()
    await expect(page.getByTestId('problem-page-title')).toContainText(
      MONITOR_BAND_CLOSED.displayId
    )
    expect(await currentRoute()).toBe(`/problems/${MONITOR_BAND_CLOSED.problemId}`)

    // «Volver» regresa a la página del monitor.
    await page.getByTestId('problem-back').click()
    await expect(monitorPage('browser')).toBeVisible()
    expect(await currentRoute()).toBe(`/entities/SYNTHETIC_TEST/${MONITOR_BROWSER_ID}`)
  }
)

test(
  'CA6 (0024): cambiar el rango global vuelve a pedir los datos; «Actualizar» también; volver a la página sin cambios, no',
  { tag: '@monitor' },
  async () => {
    await openMonitorPage('browser')
    await expectBrowserMonitorMarkers()
    await settledRequests()
    // Al entrar: las dos consultas de métricas, el desglose y los recuentos, con el rango global.
    expect(sim.monitorMetricQueries).toHaveLength(2)
    expect(sim.entityProblemQueries).toHaveLength(2)
    const breakdown = sim.monitorBreakdownQueries.length
    expect(breakdown, 'consultas del desglose al entrar').toBeGreaterThan(0)
    const all = (): URLSearchParams[] => [
      ...sim.monitorMetricQueries,
      ...sim.monitorBreakdownQueries,
      ...sim.entityProblemQueries
    ]
    for (const query of all()) expect(query.get('from')).toBe('now-2h')

    // Rango nuevo: otra vez, con now-24h.
    await page.getByTestId('time-range-24h').click()
    await expect.poll(() => sim.monitorMetricQueries.length).toBe(4)
    await expect.poll(() => sim.entityProblemQueries.length).toBe(4)
    await expect.poll(() => sim.monitorBreakdownQueries.length).toBe(breakdown * 2)
    for (const query of [
      ...sim.monitorMetricQueries.slice(2),
      ...sim.monitorBreakdownQueries.slice(breakdown),
      ...sim.entityProblemQueries.slice(2)
    ]) {
      expect(query.get('from')).toBe('now-24h')
    }
    await expectBrowserMonitorMarkers()
    await settledRequests()
    expect(sim.monitorMetricQueries).toHaveLength(4)

    // Fuera y vuelta, sin cambiar nada: ninguna petición nueva.
    await goTo('metrics')
    await expect(monitorPage('browser')).toHaveCount(0)
    const before = await settledRequests()
    await openMonitorPage('browser')
    await expectBrowserMonitorMarkers()
    await page.waitForTimeout(1500)
    expect(sim.requests.slice(before), 'peticiones al volver a la página').toEqual([])

    // «Actualizar», en la cabecera de la página: otra vez, con el rango actual.
    await monitorPage('browser').getByTestId('module-refresh').click()
    await expect.poll(() => sim.monitorMetricQueries.length).toBe(6)
    await expect.poll(() => sim.entityProblemQueries.length).toBe(6)
    await expect.poll(() => sim.monitorBreakdownQueries.length).toBe(breakdown * 3)
    for (const query of [
      ...sim.monitorMetricQueries.slice(4),
      ...sim.monitorBreakdownQueries.slice(breakdown * 2),
      ...sim.entityProblemQueries.slice(4)
    ]) {
      expect(query.get('from')).toBe('now-24h')
    }
    await expectBrowserMonitorMarkers()
  }
)

test(
  'CA6 (0024): si falla el canal de métricas, sus marcadores y cada gráfico enseñan el aviso con Reintentar; localizaciones y problemas siguen',
  { tag: '@monitor' },
  async () => {
    sim.monitorMetricsFail = true
    await openMonitorPage('browser')

    // Localizaciones y problemas, con su dato y sin aviso.
    const locations = monitorMarker('locations')
    await expect(locations.getByTestId('monitor-marker-value')).toHaveText(/^3$/)
    await expect(locations.getByRole('button', { name: 'Reintentar' })).toHaveCount(0)
    const problems = monitorMarker('problems')
    await expect(problems.getByTestId('monitor-marker-open')).toHaveText(loneNumber('1'))
    await expect(problems.getByTestId('monitor-marker-closed')).toHaveText(loneNumber('1'))
    await expect(problems.getByRole('button', { name: 'Reintentar' })).toHaveCount(0)

    // Cada marcador de métricas, en su sitio, con el aviso y Reintentar y sin valor.
    for (const id of MONITOR_METRIC_MARKERS) {
      const marker = monitorMarker(id)
      await expect(marker, id).toBeVisible()
      await expect(marker.getByRole('alert').first(), id).toBeVisible()
      await expect(marker.getByRole('button', { name: 'Reintentar' }), id).toBeVisible()
      await expect(marker.getByTestId('monitor-marker-value'), id).toHaveCount(0)
    }
    // Cada gráfico (al menos los tres que tiene todo monitor), con su aviso y Reintentar, sin gráfico.
    const panels = page.getByTestId('monitor-chart-panel')
    for (const kind of ['availability', 'duration', 'executions'] as const) {
      await expect(monitorChartPanel(kind), kind).toBeVisible()
    }
    const shown = await panels.evaluateAll((els) => els.map((el) => el.getAttribute('data-kind')))
    for (const kind of shown as MonitorChartKind[]) {
      const panel = monitorChartPanel(kind)
      await expect(panel.getByRole('alert').first(), kind).toBeVisible()
      await expect(panel.getByRole('button', { name: 'Reintentar' }), kind).toBeVisible()
      await expect(panel.getByTestId(`monitor-chart-${kind}`), kind).toHaveCount(0)
    }

    // Reintentar, con el canal ya bien: llegan valores y los cuatro gráficos.
    sim.monitorMetricsFail = false
    await clickInPlace(monitorMarker('availability').getByRole('button', { name: 'Reintentar' }), {
      scroll: true
    })
    await expectBrowserMonitorMarkers()
    for (const kind of MONITOR_CHART_KINDS) await expectMonitorChartSeries('browser', kind)
    for (const id of MONITOR_METRIC_MARKERS) {
      await expect(monitorMarker(id).getByRole('button', { name: 'Reintentar' }), id).toHaveCount(0)
    }
  }
)

test(
  'CA6 (0024): si falla el desglose, el marcador «Localizaciones» enseña el aviso con Reintentar y el resto sigue',
  { tag: '@monitor' },
  async () => {
    sim.monitorBreakdownFail = true
    await openMonitorPage('http')

    const locations = monitorMarker('locations')
    await expect(locations).toBeVisible()
    await expect(locations.getByRole('alert').first()).toBeVisible()
    await expect(locations.getByRole('button', { name: 'Reintentar' })).toBeVisible()
    await expect(locations.getByTestId('monitor-marker-value')).toHaveCount(0)

    // Los demás marcadores y los gráficos, con sus datos.
    await expect(monitorMarker('availability').getByTestId('monitor-marker-value')).toHaveText(
      /^92,5\s?%$/
    )
    await expect(monitorMarker('problems').getByTestId('monitor-marker-closed')).toHaveText(
      loneNumber('1')
    )
    for (const kind of MONITOR_CHART_KINDS) await expectMonitorChartSeries('http', kind)

    // Reintentar, con el canal ya bien.
    sim.monitorBreakdownFail = false
    await clickInPlace(locations.getByRole('button', { name: 'Reintentar' }), { scroll: true })
    await expectHttpMonitorMarkers()
    await expect(locations.getByRole('button', { name: 'Reintentar' })).toHaveCount(0)
  }
)

/**
 * Ficha 0025: tablas de localizaciones y de pasos (browser) o peticiones (HTTP) debajo de los
 * gráficos de las páginas de monitor, con el desglose de MONITOR_TABLE_DATA (sim.monitorTables,
 * canal entities:monitorBreakdown de la 0023).
 *
 * Nombres que fijan estos tests (las dos páginas comparten componentes y testids, como las tablas
 * del host de la 0019): las tarjetas `monitor-locations` y `monitor-steps`, debajo de
 * `monitor-charts`, con su título en un encabezado («Localizaciones»; «Pasos» en browser y
 * «Peticiones» en HTTP); dentro, el `DataGrid` con `gridTestId` `monitor-locations-grid` y
 * `monitor-steps-grid` y filas `monitor-location-row` (con `data-location-id`) y
 * `monitor-step-row` (con `data-step-id`). Columnas, en este orden: localizaciones `name`,
 * `availability` (barra `monitor-location-availability` con `data-level` y su %; si el nivel no es
 * `normal`, su texto en `monitor-location-level`), `duration` y `failed`; pasos `name`,
 * `duration` y `share` (barra `monitor-step-share` y su %). El paso más lento, con
 * `data-slowest="true"` en su fila y un texto en `monitor-step-slowest` (solo en esa fila). El
 * orden por columna, con `sort-<columna>` y `aria-sort` en `col-<columna>`, como en la 0019.
 */
const LOCATION_COLUMNS = ['name', 'availability', 'duration', 'failed'] as const
const STEP_COLUMNS = ['name', 'duration', 'share'] as const
const monitorLocations = (): Locator => page.getByTestId('monitor-locations')
const monitorSteps = (): Locator => page.getByTestId('monitor-steps')
const locationRow = (id: string): Locator =>
  monitorLocations().locator(`[data-testid="monitor-location-row"][data-location-id="${id}"]`)
const stepRow = (id: string): Locator =>
  monitorSteps().locator(`[data-testid="monitor-step-row"][data-step-id="${id}"]`)
const locationOrder = (): Promise<string[]> =>
  tableOrder(monitorLocations(), 'monitor-location-row', 'data-location-id')
const stepOrder = (): Promise<string[]> =>
  tableOrder(monitorSteps(), 'monitor-step-row', 'data-step-id')
/** Un número suelto con su unidad: «90 %» no casa con «190 %» ni con «90,5 %». */
const withUnit = (value: string, unit: string): RegExp =>
  new RegExp(`(^|[^\\d,.])${value}\\s?${unit}($|[^\\d,.])`)

/** Ficha 0025: abre la página del monitor con el desglose de las tablas. */
async function openMonitorTables(kind: MonitorPageKind): Promise<Locator> {
  sim.monitorTables = true
  return openMonitorPage(kind)
}

/** Ficha 0025: las localizaciones del HTTP monitor, de peor a mejor disponibilidad (es). */
const HTTP_LOCATIONS = [
  {
    id: breakdownLocation(3),
    name: 'Localización tres',
    pct: withUnit('90(,0)?', '%'),
    level: 'error',
    duration: /^1,5\s?s$/,
    failed: /^6$/
  },
  {
    id: breakdownLocation(2),
    name: 'Localización dos',
    pct: withUnit('97,5', '%'),
    level: 'warning',
    duration: /^310\s?ms$/,
    failed: /^1$/
  },
  {
    id: breakdownLocation(4),
    name: 'Localización cuatro',
    pct: withUnit('99,5', '%'),
    level: 'normal',
    duration: /^420\s?ms$/,
    failed: /^2$/
  },
  {
    id: breakdownLocation(1),
    name: 'Localización uno',
    pct: withUnit('100(,0)?', '%'),
    level: 'normal',
    duration: /^250\s?ms$/,
    // Sin serie de FAILURE: 0 fallidas.
    failed: /^0$/
  }
] as const

/** Ficha 0025: los 5 pasos del browser monitor, por duración (el orden que da el canal). */
const BROWSER_STEPS = [
  { n: 3, name: 'Paso tres', duration: /^2,5\s?s$/, share: '50(,0)?' },
  { n: 1, name: 'Paso uno', duration: /^1,2\s?s$/, share: '24(,0)?' },
  { n: 4, name: 'Paso cuatro', duration: /^800\s?ms$/, share: '16(,0)?' },
  { n: 2, name: 'Paso dos', duration: /^300\s?ms$/, share: '6(,0)?' },
  { n: 5, name: 'Paso cinco', duration: /^200\s?ms$/, share: '4(,0)?' }
].map((step) => ({ ...step, id: breakdownStep('SYNTHETIC_TEST_STEP', step.n) }))

/** Ficha 0025: espera a que las dos tablas tengan sus filas. */
async function expectMonitorTablesLoaded(locations: number, steps: number): Promise<void> {
  await expect(monitorLocations().getByTestId('monitor-location-row')).toHaveCount(locations)
  await expect(monitorSteps().getByTestId('monitor-step-row')).toHaveCount(steps)
}

test(
  'CA1 (0025): con 4 localizaciones, la tabla las enseña de peor a mejor disponibilidad, con su %, su nivel, la duración media y las fallidas',
  { tag: '@monitor' },
  async () => {
    await openMonitorTables('http')
    const card = monitorLocations()
    await expect(card).toBeVisible()
    await expect(card.getByRole('heading').first()).toContainText('Localizaciones')
    const grid = card.getByTestId('monitor-locations-grid')
    await expect(grid).toHaveAttribute('role', 'grid')
    await expect(card.getByTestId('monitor-location-row')).toHaveCount(4)
    expect(await gridColumns(grid)).toEqual(LOCATION_COLUMNS.map((c) => `col-${c}`))
    await expect(grid.getByTestId('col-availability')).toHaveAttribute('aria-sort', 'ascending')

    // De peor a mejor: el simulador las da en otro orden en cada métrica.
    expect(await locationOrder()).toEqual(HTTP_LOCATIONS.map((l) => l.id))

    for (const location of HTTP_LOCATIONS) {
      const cells = locationRow(location.id).getByRole('gridcell')
      await expect(cells, location.name).toHaveCount(LOCATION_COLUMNS.length)
      await expect(cells.nth(0), location.name).toHaveText(location.name)
      // Barra con su % y su nivel (color en data-level y, si no es normal, también texto).
      const availability = cells.nth(1)
      await expect(availability, location.name).toContainText(location.pct)
      await expect(
        availability.getByTestId('monitor-location-availability'),
        location.name
      ).toHaveAttribute('data-level', location.level)
      const levelText = availability.getByTestId('monitor-location-level')
      if (location.level === 'normal') await expect(levelText, location.name).toHaveCount(0)
      else await expect(levelText, location.name).toHaveText(/\S/)
      await expect(cells.nth(2), location.name).toHaveText(location.duration)
      await expect(cells.nth(3), location.name).toHaveText(location.failed)
    }
    // El aviso y el error no dicen lo mismo.
    const warningText = await locationRow(breakdownLocation(2))
      .getByTestId('monitor-location-level')
      .textContent()
    const errorText = await locationRow(breakdownLocation(3))
      .getByTestId('monitor-location-level')
      .textContent()
    expect(warningText).not.toBe(errorText)

    // Debajo de los gráficos.
    const charts = await settledBox(page.getByTestId('monitor-charts'))
    const locations = await settledBox(card)
    expect(locations.y).toBeGreaterThanOrEqual(charts.y + charts.height - 1)
  }
)

test(
  'CA2 (0025): con 5 pasos, la tabla del browser monitor los enseña en su orden, con su duración y su peso, y marca el más lento; en un HTTP monitor la tarjeta se llama «Peticiones»',
  { tag: '@monitor' },
  async () => {
    await openMonitorTables('browser')
    const card = monitorSteps()
    await expect(card).toBeVisible()
    await expect(card.getByRole('heading').first()).toHaveText(/^Pasos\b/)
    const grid = card.getByTestId('monitor-steps-grid')
    await expect(grid).toHaveAttribute('role', 'grid')
    await expect(card.getByTestId('monitor-step-row')).toHaveCount(5)
    expect(await gridColumns(grid)).toEqual(STEP_COLUMNS.map((c) => `col-${c}`))

    // En el orden que da el canal (por duración: la dimensión no trae secuencia, 0023), no en el
    // que llegan del simulador.
    expect(await stepOrder()).toEqual(BROWSER_STEPS.map((s) => s.id))

    for (const step of BROWSER_STEPS) {
      const row = stepRow(step.id)
      const cells = row.getByRole('gridcell')
      await expect(cells, step.name).toHaveCount(STEP_COLUMNS.length)
      await expect(cells.nth(0), step.name).toContainText(step.name)
      await expect(cells.nth(1), step.name).toHaveText(step.duration)
      await expect(cells.nth(2), step.name).toContainText(withUnit(step.share, '%'))
      await expect(cells.nth(2).getByTestId('monitor-step-share'), step.name).toHaveCount(1)
    }

    // El más lento (Paso tres), resaltado con atributo y con texto; los demás, no.
    const slowest = stepRow(breakdownStep('SYNTHETIC_TEST_STEP', 3))
    await expect(slowest).toHaveAttribute('data-slowest', 'true')
    await expect(slowest.getByTestId('monitor-step-slowest')).toHaveText(/\S/)
    await expect(card.getByTestId('monitor-step-slowest')).toHaveCount(1)
    for (const step of BROWSER_STEPS.slice(1)) {
      await expect(stepRow(step.id), step.name).not.toHaveAttribute('data-slowest', 'true')
    }

    // Debajo de los gráficos, como las localizaciones.
    const charts = await settledBox(page.getByTestId('monitor-charts'))
    const steps = await settledBox(card)
    expect(steps.y).toBeGreaterThanOrEqual(charts.y + charts.height - 1)

    // En un HTTP monitor, «Peticiones» (y no «Pasos»), con sus peticiones y la más lenta marcada.
    await openMonitorPage('http')
    await expect(monitorSteps()).toBeVisible()
    await expect(monitorSteps().getByRole('heading').first()).toHaveText(/^Peticiones\b/)
    await expect(monitorSteps().getByRole('heading').first()).not.toContainText('Pasos')
    await expect(monitorSteps().getByTestId('monitor-step-row')).toHaveCount(2)
    const requests = [breakdownStep('HTTP_CHECK_STEP', 2), breakdownStep('HTTP_CHECK_STEP', 1)]
    expect(await stepOrder()).toEqual(requests)
    const slowestRequest = stepRow(requests[0] ?? '')
    await expect(slowestRequest.getByRole('gridcell').nth(2)).toContainText(
      withUnit('75(,0)?', '%')
    )
    await expect(slowestRequest).toHaveAttribute('data-slowest', 'true')
    await expect(monitorSteps().getByTestId('monitor-step-slowest')).toHaveCount(1)
  }
)

test(
  'CA4 (0025): ordenar por otra columna (nombre en pasos, duración en localizaciones) reordena las filas',
  { tag: '@monitor' },
  async () => {
    await openMonitorTables('browser')
    await expectMonitorTablesLoaded(3, 5)

    // Pasos por nombre: «Paso cinco», «Paso cuatro», «Paso dos», «Paso tres» y «Paso uno».
    const stepsGrid = monitorSteps().getByTestId('monitor-steps-grid')
    const byName = BROWSER_STEPS.slice()
      .sort((a, b) => a.name.localeCompare(b.name, 'es'))
      .map((s) => s.id)
    expect(byName).not.toEqual(BROWSER_STEPS.map((s) => s.id))
    expect(byName.slice().reverse()).not.toEqual(BROWSER_STEPS.map((s) => s.id))
    await clickInPlace(stepsGrid.getByTestId('sort-name'), { scroll: true })
    const nameCol = stepsGrid.getByTestId('col-name')
    await expect(nameCol).toHaveAttribute('aria-sort', /^(ascending|descending)$/)
    const nameAsc = (await nameCol.getAttribute('aria-sort')) === 'ascending'
    expect(await stepOrder()).toEqual(nameAsc ? byName : byName.slice().reverse())
    await clickInPlace(stepsGrid.getByTestId('sort-name'), { scroll: true })
    await expect(nameCol).toHaveAttribute('aria-sort', nameAsc ? 'descending' : 'ascending')
    expect(await stepOrder()).toEqual(nameAsc ? byName.slice().reverse() : byName)
    // Ordenar no quita la marca del más lento.
    await expect(stepRow(breakdownStep('SYNTHETIC_TEST_STEP', 3))).toHaveAttribute(
      'data-slowest',
      'true'
    )

    // Localizaciones del HTTP monitor por duración media: uno 250, dos 310, cuatro 420, tres 1500.
    await openMonitorPage('http')
    await expectMonitorTablesLoaded(4, 2)
    const locationsGrid = monitorLocations().getByTestId('monitor-locations-grid')
    const byDuration = [1, 2, 4, 3].map((n) => breakdownLocation(n))
    await clickInPlace(locationsGrid.getByTestId('sort-duration'), { scroll: true })
    const durationCol = locationsGrid.getByTestId('col-duration')
    await expect(durationCol).toHaveAttribute('aria-sort', /^(ascending|descending)$/)
    await expect(locationsGrid.getByTestId('col-availability')).toHaveAttribute('aria-sort', 'none')
    const durationAsc = (await durationCol.getAttribute('aria-sort')) === 'ascending'
    expect(await locationOrder()).toEqual(durationAsc ? byDuration : byDuration.slice().reverse())
    await clickInPlace(locationsGrid.getByTestId('sort-duration'), { scroll: true })
    await expect(durationCol).toHaveAttribute('aria-sort', durationAsc ? 'descending' : 'ascending')
    expect(await locationOrder()).toEqual(durationAsc ? byDuration.slice().reverse() : byDuration)
  }
)

test(
  'CA4 (0025): si falla el canal, las dos tarjetas enseñan el aviso con Reintentar y los gráficos siguen',
  { tag: '@monitor' },
  async () => {
    sim.monitorBreakdownFail = true
    await openMonitorTables('browser')

    for (const card of [monitorLocations(), monitorSteps()]) {
      await expect(card).toBeVisible()
      await expect(card.getByRole('alert').first()).toBeVisible()
      await expect(card.getByRole('button', { name: 'Reintentar' })).toBeVisible()
    }
    await expect(monitorLocations().getByTestId('monitor-location-row')).toHaveCount(0)
    await expect(monitorSteps().getByTestId('monitor-step-row')).toHaveCount(0)

    // Los gráficos, con sus series y sin aviso.
    for (const kind of MONITOR_CHART_KINDS) {
      await expectMonitorChartSeries('browser', kind)
      await expect(
        monitorChartPanel(kind).getByRole('button', { name: 'Reintentar' }),
        kind
      ).toHaveCount(0)
    }

    // Reintentar, con el canal ya bien: llegan las dos tablas.
    sim.monitorBreakdownFail = false
    await clickInPlace(monitorLocations().getByRole('button', { name: 'Reintentar' }), {
      scroll: true
    })
    await expectMonitorTablesLoaded(3, 5)
    for (const card of [monitorLocations(), monitorSteps()]) {
      await expect(card.getByRole('button', { name: 'Reintentar' })).toHaveCount(0)
    }
  }
)

test(
  'CA3 (0025): sin pasos que enseñar (lista vacía del canal), no sale la tarjeta de pasos y la de localizaciones sí',
  { tag: '@monitor' },
  async () => {
    // Decisión del Orquestador (ficha 0025): el canal siempre da `steps` como lista, así que desde
    // el simulador se prueba con la lista vacía; `steps: null` lo cubre el unitario de
    // monitor-tables.
    sim.monitorStepsEmpty = true
    for (const kind of ['browser', 'http'] as const) {
      await openMonitorTables(kind)
      const rows = kind === 'browser' ? 3 : 4
      await expect(monitorLocations(), kind).toBeVisible()
      await expect(monitorLocations().getByTestId('monitor-location-row'), kind).toHaveCount(rows)
      // Con las localizaciones ya cargadas, el desglose ha respondido: la de pasos no está.
      await expect(monitorSteps(), kind).toHaveCount(0)
      await expect(page.getByTestId('monitor-step-row'), kind).toHaveCount(0)
    }

    // Que con pasos sí sale (no falta siempre) lo prueba CA2 con los mismos testids.
  }
)

/**
 * Ficha 0026: tarjeta «Información» de las páginas de un browser monitor (MONITOR_BROWSER_ID) y
 * de un HTTP monitor (MONITOR_HTTP_ID), canal entities:get, con la forma de la del servicio
 * (0015) y la del host (0020) y sus nombres con el prefijo `monitor-info`.
 *
 * Nombres que fijan estos tests: la tarjeta `monitor-info`, entre la cabecera y
 * `monitor-markers`; cada fila, `monitor-info-row` con `data-key` (las claves de
 * `buildMonitorInfo`) y su valor en `monitor-info-value`; los chips, `monitor-info-chip`. Las
 * relaciones, en `monitor-info-relations`: cada grupo `monitor-info-group` con `data-group`
 * (monitors, locations, steps o requests, y other), con `monitor-info-group-toggle`
 * (aria-expanded), `monitor-info-group-count` y, desplegado, sus `monitor-info-entity` (enlaces,
 * con `data-entity-id`), el botón `monitor-info-names` («Ver nombres») y cada nombre en
 * `monitor-info-entity-name`. «Todas las propiedades», `monitor-info-properties-toggle` y cada
 * una `monitor-info-property` con `data-key`. Las filas obligatorias van en su orden relativo; el
 * developer puede añadir otras entre ellas (la ficha se las deja a él).
 */
const MONITOR_INFO_REQUIRED: Record<MonitorPageKind, string[]> = {
  browser: [
    'monitorType',
    'enabled',
    'frequency',
    'locations',
    'steps',
    'firstSeen',
    'lastSeen',
    // Ficha 0037: sin la fila de etiquetas (van en las píldoras de arriba).
    'managementZones'
  ],
  // Sin etiquetas: no hay fila.
  http: [
    'monitorType',
    'enabled',
    'frequency',
    'locations',
    'requests',
    'firstSeen',
    'lastSeen',
    'managementZones'
  ]
}
const monitorInfoRow = (key: string): Locator =>
  monitorInfoCard().locator(`[data-testid="monitor-info-row"][data-key="${key}"]`)
const monitorInfoValue = (key: string): Locator =>
  monitorInfoRow(key).getByTestId('monitor-info-value')
const monitorInfoGroup = (key: string): Locator =>
  monitorInfoCard().locator(`[data-testid="monitor-info-group"][data-group="${key}"]`)
const monitorInfoEntity = (group: string, id: string): Locator =>
  monitorInfoGroup(group).locator(`[data-testid="monitor-info-entity"][data-entity-id="${id}"]`)

/** Ficha 0026: ¿están las claves `expected` en `actual`, en ese orden relativo? */
function inRelativeOrder(actual: string[], expected: string[]): boolean {
  let index = 0
  for (const key of actual) if (key === expected[index]) index += 1
  return index === expected.length
}

/** Ficha 0026: despliega un grupo de relaciones del monitor (si no lo está). */
async function expandMonitorGroup(key: string): Promise<Locator> {
  const group = monitorInfoGroup(key)
  const toggle = group.getByTestId('monitor-info-group-toggle')
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await clickInPlace(toggle, { scroll: true })
  }
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  return group
}

/** Ficha 0026: filas obligatorias en su orden, sin repetirse, y sin «undefined» en la tarjeta. */
async function expectMonitorInfoRows(kind: MonitorPageKind): Promise<void> {
  const keys = await dataKeys(monitorInfoCard().getByTestId('monitor-info-row'))
  expect(inRelativeOrder(keys, MONITOR_INFO_REQUIRED[kind]), JSON.stringify(keys)).toBe(true)
  expect(new Set(keys).size, JSON.stringify(keys)).toBe(keys.length)
  for (const text of ['undefined', 'null', 'NaN', '[object Object]']) {
    await expect(monitorInfoCard(), text).not.toContainText(text)
  }
}

/** Ficha 0026: los grupos de relaciones, en su orden, con su nombre y su número. */
async function expectMonitorGroups(expected: [string, string, string][]): Promise<void> {
  const relations = monitorInfoCard().getByTestId('monitor-info-relations')
  await expect(relations).toContainText('Relaciones')
  const groups = relations.getByTestId('monitor-info-group')
  await expect(groups).toHaveCount(expected.length)
  expect(await dataKeys(groups, 'data-group')).toEqual(expected.map(([key]) => key))
  for (const [key, title, count] of expected) {
    await expect(monitorInfoGroup(key), key).toContainText(title)
    await expect(monitorInfoGroup(key).getByTestId('monitor-info-group-count'), key).toHaveText(
      new RegExp(`^\\s*${count}\\s*$`)
    )
  }
}

test(
  'CA2 (0026): la página de un browser monitor enseña la tarjeta «Información» con sus filas (tipo, activo, frecuencia, localizaciones, pasos…), sus relaciones con «Ver nombres» a demanda y enlaces que abren cada entidad',
  { tag: '@monitor' },
  async () => {
    const card = await openMonitorInfo('browser')
    await expect(card).toContainText('Información')

    // Debajo de los marcadores: desde la ficha 0036, «Información» va al final de la página.
    const cardBox = await settledBox(card)
    const markersBox = await settledBox(page.getByTestId('monitor-markers'))
    expect(cardBox.y, 'la tarjeta va debajo de los marcadores').toBeGreaterThanOrEqual(
      markersBox.y + markersBox.height - 1
    )

    // Las filas y sus valores.
    await expectMonitorInfoRows('browser')
    await expect(monitorInfoValue('monitorType')).toContainText('CLICKPATH')
    await expect(monitorInfoValue('enabled')).toHaveText(/\S/)
    await expect(monitorInfoValue('enabled')).not.toContainText(/true|false/)
    await expect(monitorInfoValue('frequency')).toContainText(loneNumber('15'))
    await expect(monitorInfoValue('locations')).toContainText(loneNumber('3'))
    await expect(monitorInfoValue('steps')).toContainText(loneNumber('5'))
    await expect(monitorInfoValue('firstSeen')).toContainText('2026')
    await expect(monitorInfoValue('lastSeen')).toContainText('2026')
    await expect(monitorInfoRow('managementZones').getByTestId('monitor-info-chip')).toHaveText([
      'Zona monitor A',
      'Zona monitor B'
    ])
    // Ficha 0037: las etiquetas ya no salen en la tarjeta.
    await expect(monitorInfoRow('tags')).toHaveCount(0)

    // Capturas y nombre detectado, nunca en una fila; «Todas las propiedades» empieza plegada.
    const rows = card.getByTestId('monitor-info-row')
    for (const [key, value] of Object.entries(MONITOR_INFO_HIDDEN)) {
      await expect(rows.filter({ hasText: value }), key).toHaveCount(0)
      await expect(monitorInfoRow(key), key).toHaveCount(0)
    }
    await expect(card.getByTestId('monitor-info-property')).toHaveCount(0)
    const toggle = card.getByTestId('monitor-info-properties-toggle')
    await expect(toggle).toContainText('Todas las propiedades')
    await clickInPlace(toggle, { scroll: true })
    await expect(card.getByTestId('monitor-info-property')).toHaveCount(
      monitorInfoBrowserPropertyCount()
    )
    await expect(
      card.locator('[data-testid="monitor-info-property"][data-key="detectedName"]')
    ).toContainText(MONITOR_INFO_HIDDEN.detectedName)

    // Sin las tarjetas del servicio ni del host.
    await expect(page.getByTestId('service-info')).toHaveCount(0)
    await expect(page.getByTestId('host-info')).toHaveCount(0)

    // Relaciones: Monitoriza, Localizaciones y Pasos (sin otras), con su número.
    await expectMonitorGroups([
      ['monitors', 'Monitoriza', '1'],
      ['locations', 'Localizaciones', '3'],
      ['steps', 'Pasos', '5']
    ])
    const locations = await expandMonitorGroup('locations')
    expect(await dataKeys(locations.getByTestId('monitor-info-entity'), 'data-entity-id')).toEqual(
      MONITOR_INFO_LOCATIONS.slice(0, 3)
    )
    const steps = await expandMonitorGroup('steps')
    expect(await dataKeys(steps.getByTestId('monitor-info-entity'), 'data-entity-id')).toEqual(
      MONITOR_INFO_STEPS
    )
    await expandMonitorGroup('monitors')
    await settledRequests()
    expect(sim.entityNamesQueries, 'nombres antes de «Ver nombres»').toHaveLength(0)

    // «Ver nombres» de «Localizaciones»: una llamada con sus tres ids y los nombres en su sitio.
    const button = locations.getByTestId('monitor-info-names')
    await expect(button).toHaveText('Ver nombres')
    await clickInPlace(button, { scroll: true })
    await expect.poll(() => sim.entityNamesQueries.length).toBe(1)
    const selector = sim.entityNamesQueries[0]?.get('entitySelector') ?? ''
    for (const id of MONITOR_INFO_LOCATIONS.slice(0, 3)) expect(selector).toContain(id)
    for (const [index, id] of MONITOR_INFO_LOCATIONS.slice(0, 3).entries()) {
      await expect(
        monitorInfoEntity('locations', id).getByTestId('monitor-info-entity-name')
      ).toHaveText(`localizacion-info-${index + 1}-e2e`)
    }
    // Los de otros grupos, sin pedir.
    await settledRequests()
    expect(sim.entityNamesQueries).toHaveLength(1)
    await expect(
      monitorInfoEntity('steps', MONITOR_INFO_STEPS[0] ?? '').getByTestId(
        'monitor-info-entity-name'
      )
    ).toHaveCount(0)

    // Cada entidad es un enlace a su página; pulsar la aplicación abre la suya.
    const app = monitorInfoEntity('monitors', MONITOR_INFO_APP)
    await expect(app).toHaveRole('link')
    await expect(app).toHaveAttribute(
      'href',
      new RegExp(`#/entities/APPLICATION/${MONITOR_INFO_APP}$`)
    )
    await expect(monitorInfoEntity('steps', MONITOR_INFO_STEPS[0] ?? '')).toHaveAttribute(
      'href',
      new RegExp(`#/entities/SYNTHETIC_TEST_STEP/${MONITOR_INFO_STEPS[0]}$`)
    )
    const monitorQueries = (): number =>
      sim.requests.filter((request) => request.includes(`/entities/${MONITOR_BROWSER_ID}`)).length
    const before = monitorQueries()
    await clickInPlace(app, { scroll: true })
    const appPage = page.getByTestId('entity-page-application')
    await expect(appPage).toBeVisible()
    expect(await currentRoute()).toBe(`/entities/APPLICATION/${MONITOR_INFO_APP}`)
    await expect(appPage.getByTestId('entity-page-id')).toHaveText(MONITOR_INFO_APP)
    await expect(page.getByTestId('monitor-info')).toHaveCount(0)

    // «Volver» regresa al monitor, sin volver a pedir sus datos.
    await clickInPlace(appPage.getByTestId('entity-back'), { scroll: true })
    await expect(monitorPage('browser')).toBeVisible()
    expect(await currentRoute()).toBe(`/entities/SYNTHETIC_TEST/${MONITOR_BROWSER_ID}`)
    await expect(monitorInfoValue('monitorType')).toContainText('CLICKPATH')
    await settledRequests()
    expect(monitorQueries(), 'entities:get del monitor al volver').toBe(before)
  }
)

test(
  'CA2 (0026): la página de un HTTP monitor enseña su tarjeta con «Peticiones», «Monitoriza» con el servicio y la aplicación, «Otras relaciones» plegada, y pulsar el servicio abre su página',
  { tag: '@monitor' },
  async () => {
    // El «activo» del browser monitor, para compararlo con el «inactivo» de este.
    await openMonitorInfo('browser')
    const enabledText = (await monitorInfoValue('enabled').textContent())?.trim() ?? ''
    expect(enabledText).not.toBe('')

    const card = await openMonitorInfo('http')
    await expect(card).toContainText('Información')
    await expectMonitorInfoRows('http')
    await expect(monitorInfoRow('steps')).toHaveCount(0)
    await expect(monitorInfoRow('tags')).toHaveCount(0)
    await expect(monitorInfoValue('monitorType')).toContainText('MULTI_REQUEST')
    await expect(monitorInfoValue('enabled')).toHaveText(/\S/)
    await expect(monitorInfoValue('enabled')).not.toContainText(/true|false/)
    await expect(monitorInfoValue('enabled')).not.toHaveText(enabledText)
    await expect(monitorInfoValue('frequency')).toContainText(loneNumber('5'))
    await expect(monitorInfoValue('locations')).toContainText(loneNumber('4'))
    await expect(monitorInfoValue('requests')).toContainText(loneNumber('2'))
    await expect(monitorInfoRow('managementZones').getByTestId('monitor-info-chip')).toHaveText([
      'Zona monitor H'
    ])
    await expect(
      card.getByTestId('monitor-info-row').filter({ hasText: 'nombre-detectado-http-e2e' })
    ).toHaveCount(0)

    await expectMonitorGroups([
      ['monitors', 'Monitoriza', '2'],
      ['locations', 'Localizaciones', '4'],
      ['requests', 'Peticiones', '2'],
      ['other', 'Otras relaciones', '1']
    ])
    // «Otras relaciones», plegada.
    await expect(
      monitorInfoGroup('other').getByTestId('monitor-info-group-toggle')
    ).toHaveAttribute('aria-expanded', 'false')
    await expect(monitorInfoGroup('other').getByTestId('monitor-info-entity')).toHaveCount(0)
    const other = await expandMonitorGroup('other')
    await expect(other).toContainText('belongsTo')
    await expect(monitorInfoEntity('other', MONITOR_INFO_OTHER)).toContainText(MONITOR_INFO_OTHER)

    const monitors = await expandMonitorGroup('monitors')
    expect(
      [...(await dataKeys(monitors.getByTestId('monitor-info-entity'), 'data-entity-id'))].sort()
    ).toEqual([INFO_FEW_ID, MONITOR_INFO_HTTP_APP].sort())

    // «Ver nombres» de «Peticiones».
    const requests = await expandMonitorGroup('requests')
    await settledRequests()
    expect(sim.entityNamesQueries, 'nombres antes de «Ver nombres»').toHaveLength(0)
    await clickInPlace(requests.getByTestId('monitor-info-names'), { scroll: true })
    await expect.poll(() => sim.entityNamesQueries.length).toBe(1)
    for (const [index, id] of MONITOR_INFO_REQUESTS.entries()) {
      await expect(
        monitorInfoEntity('requests', id).getByTestId('monitor-info-entity-name')
      ).toHaveText(`peticion-info-${index + 1}-e2e`)
    }

    // Pulsar el servicio abre su página; «Volver» regresa al monitor.
    const service = monitorInfoEntity('monitors', INFO_FEW_ID)
    await expect(service).toHaveRole('link')
    await expect(service).toHaveAttribute('href', new RegExp(`#/entities/SERVICE/${INFO_FEW_ID}$`))
    await clickInPlace(service, { scroll: true })
    const servicePage = page.getByTestId('entity-page-service')
    await expect(servicePage).toBeVisible()
    expect(await currentRoute()).toBe(`/entities/SERVICE/${INFO_FEW_ID}`)
    await expect(page.getByTestId('monitor-info')).toHaveCount(0)
    await clickInPlace(servicePage.getByTestId('entity-back'), { scroll: true })
    await expect(monitorPage('http')).toBeVisible()
    expect(await currentRoute()).toBe(`/entities/HTTP_CHECK/${MONITOR_HTTP_ID}`)
    await expect(monitorInfoValue('monitorType')).toContainText('MULTI_REQUEST')
  }
)

test(
  'CA3 (0026): sin entities.read, la tarjeta del monitor dice qué scope falta y los marcadores y gráficos siguen',
  { tag: '@monitor' },
  async () => {
    const tenants = await invoke<{ clients: { id: string; name: string }[] }>('tenants:list')
    const clientId = tenants.clients.find((client) => client.name === 'Cliente A')?.id ?? ''
    const noEntities = await createEnvironment(
      clientId,
      'Sin entidades monitor',
      'other',
      TOKEN_NO_ENTITIES
    )
    try {
      await invoke('connection:test', { environmentId: noEntities })
      await invoke('environments:setActive', { environmentId: noEntities })
      await reloadUi()
      await openMonitorPage('browser')
      const unavailable = monitorInfoCard().getByTestId('module-unavailable')
      await expect(unavailable).toBeVisible()
      await expect(unavailable).toContainText('entities.read')
      await expect(monitorInfoCard().getByTestId('monitor-info-row')).toHaveCount(0)
      // Marcadores y gráficos, con sus datos.
      await expectBrowserMonitorMarkers()
      for (const kind of MONITOR_CHART_KINDS) await expectMonitorChartSeries('browser', kind)
      await settledRequests()
      expect(sim.entityInfoQueries, 'entities:get sin el scope').toHaveLength(0)
    } finally {
      await invoke('environments:setActive', { environmentId: env['Producción'] })
      await invoke('environments:delete', { id: noEntities })
      await reloadUi()
    }
  }
)
