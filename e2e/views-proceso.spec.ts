import { expect, type Locator, test } from '@playwright/test'
import {
  byCpu,
  INFO_FEW_ID,
  pgItem,
  PROCESS_BAND_CLOSED,
  PROCESS_BAND_OPEN,
  PROCESS_GROUP_BAND_CLOSED,
  PROCESS_GROUP_BAND_OPEN,
  PROCESS_GROUP_BY_INSTANCE,
  PROCESS_GROUP_CUT_ID,
  PROCESS_GROUP_CUT_INSTANCES,
  PROCESS_GROUP_CUT_TOTAL,
  PROCESS_GROUP_FEW_ID,
  PROCESS_GROUP_ID,
  PROCESS_GROUP_INFO_SECRET_PARTS,
  PROCESS_GROUP_INSTANCES,
  PROCESS_GROUP_MANY_ID,
  PROCESS_GROUP_MANY_INSTANCES,
  PROCESS_GROUP_PAGE_BY_CPU,
  PROCESS_GROUP_PAGE_HOSTS,
  PROCESS_GROUP_PAGE_ID,
  PROCESS_GROUP_PAGE_INSTANCES,
  PROCESS_GROUP_PAGE_SELECTOR,
  PROCESS_GROUP_SELECTOR,
  PROCESS_INFO_CGI,
  PROCESS_INFO_HOST,
  PROCESS_INFO_PG,
  PROCESS_INFO_SECRET_PARTS,
  PROCESS_INFO_SERVICE_2,
  PROCESS_METRICS_ID,
  PROCESS_TIMESTAMPS,
  processGroupSelector,
  TOKEN_NO_ENTITIES
} from './views/fixtures'
import {
  clickInPlace,
  createEnvironment,
  currentRoute,
  env,
  goTo,
  goToRoute,
  invoke,
  page,
  reloadUi,
  resetState,
  settledBox,
  setupViewsApp
} from './views/harness'
import { sim } from './views/sim-state'
import {
  settledRequests,
  loneNumber,
  dataKeys,
  openHostPage,
  processRow,
  tableOrder,
  gridColumns,
  HOST_PAGE_TOP,
  expectHostTablesLoaded,
  processPage,
  openProcessPage,
  processInfoCard,
  processInfoProperty,
  openProcessInfo,
  visibleNeighbours
} from './views/helpers'

/**
 * Specs de vistas por zona (ficha 0070): las páginas del proceso y del process group (`@proceso`). Arnés en
 * `e2e/views/` (ver su cabecera).
 */

setupViewsApp()

test(
  'CA6 (0027): entities:processMetrics por IPC con un id inventado: dos consultas, series por papel y marcadores',
  { tag: '@proceso' },
  async () => {
    const data = await invoke<Record<string, unknown>>('entities:processMetrics', {
      environmentId: env['Producción'],
      entityId: PROCESS_METRICS_ID,
      timeRange: '2h'
    })
    // Dos consultas al simulador (series y marcadores con Inf), acotadas al proceso y con el rango.
    expect(sim.processMetricQueries).toHaveLength(2)
    for (const query of sim.processMetricQueries) {
      expect(query.get('from')).toBe('now-2h')
      expect(query.get('entitySelector')).toBe(`entityId("${PROCESS_METRICS_ID}")`)
    }
    expect(sim.processMetricQueries.map((q) => q.get('resolution') ?? 'API').sort()).toEqual([
      'API',
      'Inf'
    ])
    // Red en las dos consultas; salud de red, solo en la de series.
    const selectorOf = (resolution: string | null): string =>
      sim.processMetricQueries
        .find((q) => q.get('resolution') === resolution)
        ?.get('metricSelector') ?? ''
    expect(selectorOf(null)).toContain('builtin:tech.generic.network.bytesRx')
    expect(selectorOf(null)).toContain('builtin:tech.generic.network.packets.retransmission')
    expect(selectorOf('Inf')).toContain('builtin:tech.generic.network.bytesTx:avg')
    expect(selectorOf('Inf')).not.toContain('retransmission')

    const series = (values: (number | null)[]): { timestamps: number[]; values: unknown[] } => ({
      timestamps: PROCESS_TIMESTAMPS,
      values
    })
    expect(data).toMatchObject({
      resolution: '10m',
      series: {
        cpu: series([8, null, 22.5]),
        memory: series([300_000_000, null, 320_000_000]),
        availability: series([100, null, 50]),
        resources: series([0.5, null, 0.8]),
        network: { in: series([4_096, null, 1_024.5]), out: series([512, 256, null]) },
        networkHealth: series([0.5, null, 2])
      },
      totals: {
        cpu: { avg: 15.25, max: 91 },
        memory: { avg: 310_000_000, max: 330_000_000 },
        network: { in: 2_560, out: 384 },
        availability: 83.5,
        resources: 0.9
      },
      warnings: [],
      partial: []
    })
  }
)

test(
  'CA6 (0031): entities:processGroupMetrics por IPC con ids inventados: dos consultas, total del grupo e instancias',
  { tag: '@proceso' },
  async () => {
    const data = await invoke<Record<string, unknown>>('entities:processGroupMetrics', {
      environmentId: env['Producción'],
      entityId: PROCESS_GROUP_ID,
      timeRange: '2h'
    })
    // Dos consultas al simulador (series y marcadores con Inf), con el selector de las instancias
    // del grupo y con el rango.
    expect(sim.processGroupMetricQueries).toHaveLength(2)
    for (const query of sim.processGroupMetricQueries) {
      expect(query.get('from')).toBe('now-2h')
      expect(query.get('entitySelector')).toBe(PROCESS_GROUP_SELECTOR)
    }
    expect(sim.processGroupMetricQueries.map((q) => q.get('resolution') ?? 'API').sort()).toEqual([
      'API',
      'Inf'
    ])
    // Las medias por instancia, solo en la de marcadores.
    const selectorOf = (resolution: string | null): string =>
      sim.processGroupMetricQueries
        .find((q) => q.get('resolution') === resolution)
        ?.get('metricSelector') ?? ''
    expect(selectorOf(null)).not.toContain(PROCESS_GROUP_BY_INSTANCE)
    expect(selectorOf('Inf')).toContain(
      `builtin:tech.generic.cpu.usage${PROCESS_GROUP_BY_INSTANCE}`
    )

    const series = (values: (number | null)[]): { timestamps: number[]; values: unknown[] } => ({
      timestamps: PROCESS_TIMESTAMPS,
      values
    })
    const [one, two] = PROCESS_GROUP_INSTANCES
    expect(data).toMatchObject({
      resolution: '10m',
      series: {
        cpu: series([18, null, 112.5]),
        memory: series([900_000_000, null, 950_000_000]),
        network: { in: series([8_192, null, 2_048.5]), out: series([1_024, 512, null]) }
      },
      totals: {
        // La máxima, de la serie del total.
        cpu: { avg: 64.5, max: 112.5 },
        memory: { avg: 925_000_000 },
        network: { in: 5_120, out: 768 }
      },
      // Por CPU media, de más a menos.
      instances: {
        items: [
          {
            id: two!.id,
            name: two!.name,
            hostId: two!.hostId,
            hostName: two!.hostName,
            cpu: 44,
            memory: 525_000_000
          },
          {
            id: one!.id,
            name: one!.name,
            hostId: one!.hostId,
            hostName: one!.hostName,
            cpu: 20.5,
            memory: 400_000_000
          }
        ],
        total: 2
      },
      warnings: [],
      partial: []
    })
  }
)

test(
  'CA6 (0050): entities:processGroupMetrics de un grupo de 30 instancias: las 20 de más CPU y el total real',
  { tag: '@proceso' },
  async () => {
    const data = await invoke<{ instances: Record<string, unknown> }>(
      'entities:processGroupMetrics',
      { environmentId: env['Producción'], entityId: PROCESS_GROUP_MANY_ID, timeRange: '2h' }
    )
    // La CPU por instancia, ordenada y limitada a 20 en la consulta de marcadores (Inf).
    const markers =
      sim.processGroupMetricQueries
        .find((q) => q.get('resolution') === 'Inf')
        ?.get('metricSelector') ?? ''
    expect(markers).toContain(
      `builtin:tech.generic.cpu.usage${PROCESS_GROUP_BY_INSTANCE}:sort(value(avg,descending)):limit(20)`
    )
    // El total, de totalCount de /entities con el selector del grupo.
    expect(sim.processGroupEntityQueries).toHaveLength(1)
    expect(sim.processGroupEntityQueries[0]?.get('pageSize')).toBe('1')
    expect(data.instances).toEqual({
      items: byCpu(PROCESS_GROUP_MANY_INSTANCES).slice(0, 20).map(pgItem),
      total: 30,
      totalKnown: true
    })
  }
)

test(
  'CA6 (0050): entities:processGroupMetrics de un grupo recortado: 20 instancias, total real y partial',
  { tag: '@proceso' },
  async () => {
    const data = await invoke<{ instances: Record<string, unknown>; partial: unknown[] }>(
      'entities:processGroupMetrics',
      { environmentId: env['Producción'], entityId: PROCESS_GROUP_CUT_ID, timeRange: '2h' }
    )
    expect(data.instances).toEqual({
      items: byCpu(PROCESS_GROUP_CUT_INSTANCES).slice(0, 20).map(pgItem),
      total: PROCESS_GROUP_CUT_TOTAL,
      totalKnown: true
    })
    expect(data.partial.length).toBeGreaterThan(0)
  }
)

test(
  'CA6 (0050): entities:processGroupInstances del grupo de 30: la lista completa por CPU, sin recorte',
  { tag: '@proceso' },
  async () => {
    const data = await invoke<Record<string, unknown>>('entities:processGroupInstances', {
      environmentId: env['Producción'],
      entityId: PROCESS_GROUP_MANY_ID,
      timeRange: '2h'
    })
    // Una consulta de métricas con Inf, con el selector del grupo y el rango, y una a /entities.
    expect(sim.processGroupMetricQueries).toHaveLength(1)
    const query = sim.processGroupMetricQueries[0]
    expect(query?.get('resolution')).toBe('Inf')
    expect(query?.get('entitySelector')).toBe(processGroupSelector(PROCESS_GROUP_MANY_ID))
    expect(query?.get('from')).toBe('now-2h')
    expect(sim.processGroupEntityQueries).toHaveLength(1)
    expect(data).toMatchObject({
      items: byCpu(PROCESS_GROUP_MANY_INSTANCES).map(pgItem),
      total: 30,
      truncated: false
    })
  }
)

test(
  'CA6 (0050): entities:processGroupInstances de un grupo recortado: truncated y el total real',
  { tag: '@proceso' },
  async () => {
    const data = await invoke<Record<string, unknown>>('entities:processGroupInstances', {
      environmentId: env['Producción'],
      entityId: PROCESS_GROUP_CUT_ID,
      timeRange: '2h'
    })
    expect(data).toMatchObject({
      items: byCpu(PROCESS_GROUP_CUT_INSTANCES).map(pgItem),
      total: PROCESS_GROUP_CUT_TOTAL,
      truncated: true
    })
  }
)
const PROCESS_METRIC_MARKERS = ['cpu', 'memory', 'network'] as const
type ProcessFourthMarker = 'availability' | 'resources'
type ProcessChartKind = 'cpu' | 'memory' | 'network' | 'network-health' | 'resources'
const PROCESS_MARKER_LABELS: Record<string, string> = {
  cpu: 'CPU',
  memory: 'Memoria',
  network: 'Red',
  availability: 'Disponibilidad',
  resources: 'Recursos',
  problems: 'Problemas'
}
const PROCESS_CHART_TITLES: Record<ProcessChartKind, string> = {
  cpu: 'CPU',
  memory: 'Memoria',
  network: 'Red',
  'network-health': 'Salud de red',
  resources: 'Recursos'
}
/** Las series de cada gráfico, en su orden: una por papel y la red con entrada y salida. */
const PROCESS_CHART_SERIES: Record<ProcessChartKind, RegExp[]> = {
  cpu: [/./],
  memory: [/./],
  network: [/entrada/i, /salida/i],
  'network-health': [/./],
  resources: [/./]
}
/** Claves de métrica de cada papel (las de PROCESS_SERIES), para dejarlas sin datos. */
const PROCESS_ROLE_METRICS = {
  network: ['builtin:tech.generic.network.bytesRx', 'builtin:tech.generic.network.bytesTx'],
  networkHealth: ['builtin:tech.generic.network.packets.retransmission'],
  availability: ['builtin:pgi.availability'],
  resources: ['builtin:tech.generic.handles.fileDescriptorsPercentUsed']
} as const
const processMarker = (id: string): Locator => page.getByTestId(`process-marker-${id}`)
const processChartPanel = (kind: ProcessChartKind): Locator =>
  page.locator(`[data-testid="process-chart-panel"][data-kind="${kind}"]`)
const processChartPlot = (kind: ProcessChartKind): Locator =>
  processChartPanel(kind).getByTestId(`process-chart-${kind}`)
const processBand = (): Locator => processChartPanel('cpu').getByTestId('process-problem-band')
const processSegment = (problemId: string): Locator =>
  processBand().locator(`[data-testid="process-problem-segment"][data-problem-id="${problemId}"]`)

/** Ficha 0028: espera a que el gráfico tenga sus series (se monta vacío mientras carga). */
async function processChartSeries(kind: ProcessChartKind): Promise<string[]> {
  const plot = processChartPlot(kind)
  await expect(plot.locator('canvas').first()).toBeVisible()
  await expect(plot).toHaveAttribute('data-series', /\[.+\]/)
  return JSON.parse((await plot.getAttribute('data-series')) ?? '[]') as string[]
}

/** Ficha 0028: comprueba las series de un gráfico del proceso. */
async function expectProcessChartSeries(kind: ProcessChartKind): Promise<void> {
  const series = await processChartSeries(kind)
  expect(series, kind).toHaveLength(PROCESS_CHART_SERIES[kind].length)
  for (const [i, pattern] of PROCESS_CHART_SERIES[kind].entries()) {
    expect(series[i], `${kind}[${i}]`).toMatch(pattern)
  }
}

/** Ficha 0028: los `data-kind` de los paneles de gráficos, en el orden en que se pintan. */
async function processChartKinds(): Promise<string[]> {
  return processPage()
    .getByTestId('process-charts')
    .getByTestId('process-chart-panel')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-kind') ?? ''))
}

/** Ficha 0028: valor del cuarto marcador, según cuál sea (0027: 83,5 % y 0,9). */
async function expectProcessFourthMarker(id: ProcessFourthMarker): Promise<void> {
  const value = processMarker(id).getByTestId('process-marker-value')
  if (id === 'availability') await expect(value).toHaveText(/^83,5\s?%$/)
  else await expect(value).toHaveText(/^0,9\s?%$/)
}

/**
 * Ficha 0028: los marcadores de métricas con los valores del simulador, ya formateados (es). Con
 * `network: false`, el de red no se comprueba (se comprueba aparte que no sale).
 */
async function expectProcessMetricMarkers(options: { network?: boolean } = {}): Promise<void> {
  // CPU: media 15,25 % (un decimal) y máxima 91 %; normal, sin texto de nivel.
  const cpu = processMarker('cpu')
  await expect(cpu.getByTestId('process-marker-value')).toHaveText(/^15,[23]\s?%$/)
  await expect(cpu.getByTestId('process-marker-secondary')).toContainText(/(^|[^\d.,])91(,0)?\s?%/)
  await expect(cpu.getByTestId('process-marker-value')).toHaveAttribute('data-level', 'normal')
  await expect(cpu.getByTestId('process-marker-level')).toHaveCount(0)
  // Memoria (working set): media 310 MB y máxima 330 MB.
  const memory = processMarker('memory')
  await expect(memory.getByTestId('process-marker-value')).toHaveText(/^310(,0)?\sMB$/)
  await expect(memory.getByTestId('process-marker-secondary')).toContainText(
    /(^|[^\d.,])330(,0)?\sMB/
  )
  if (options.network === false) return
  // Red: entrada media 2560 B/s y salida media 384 B/s, en bits por segundo como el host
  // (20 480 y 3072 bit/s).
  const network = processMarker('network')
  await expect(network.getByTestId('process-marker-value')).toHaveText(/^20,5\skbit\/s$/)
  await expect(network.getByTestId('process-marker-secondary')).toContainText(
    /(^|[^\d.,])3,1\skbit\/s/
  )
}

/** Ficha 0028: el marcador de problemas, con sus recuentos. */
async function expectProcessProblems(open: string, closed: string): Promise<void> {
  const problems = processMarker('problems')
  await expect(problems.getByTestId('process-marker-open')).toHaveText(loneNumber(open))
  await expect(problems.getByTestId('process-marker-closed')).toHaveText(loneNumber(closed))
}

/**
 * Ficha 0028: con datos de disponibilidad, el cuarto marcador es el de disponibilidad y el de
 * recursos no sale (decisión del Orquestador).
 */
async function shownFourthMarker(): Promise<ProcessFourthMarker> {
  const row = processPage().getByTestId('process-markers')
  await expect(row.getByTestId('process-marker-availability')).toHaveCount(1)
  await expect(row.getByTestId('process-marker-resources')).toHaveCount(0)
  return 'availability'
}

/** Ficha 0028: todos los marcadores del proceso inventado con todos sus datos. */
async function expectProcessMarkers(): Promise<void> {
  await expectProcessMetricMarkers()
  await expectProcessFourthMarker(await shownFourthMarker())
  await expectProcessProblems('1', '1')
}

test(
  'CA1 (0028): la página de un proceso enseña sus marcadores y sus cuatro gráficos con los valores y las series del simulador, sin «Página en construcción»',
  { tag: '@proceso' },
  async () => {
    const entityPage = await openProcessPage()
    const row = entityPage.getByTestId('process-markers')
    await expect(row).toBeVisible()

    // Cinco marcadores: CPU, memoria, red, disponibilidad (antes que recursos) y problemas.
    const fourth = await shownFourthMarker()
    for (const id of [...PROCESS_METRIC_MARKERS, fourth, 'problems']) {
      await expect(row.getByTestId(`process-marker-${id}`), id).toBeVisible()
      await expect(row.getByTestId(`process-marker-${id}`), id).toContainText(
        PROCESS_MARKER_LABELS[id] ?? id
      )
    }
    await expectProcessMarkers()

    // Cuatro gráficos en su orden: CPU, memoria, red y salud de red (antes que recursos).
    const section = entityPage.getByTestId('process-charts')
    await expect(section).toBeVisible()
    const panels = section.getByTestId('process-chart-panel')
    await expect(panels).toHaveCount(4)
    const kinds = await processChartKinds()
    expect(kinds).toEqual(['cpu', 'memory', 'network', 'network-health'])
    for (const [index, kind] of (kinds as ProcessChartKind[]).entries()) {
      await expect(panels.nth(index).getByRole('heading').first(), kind).toContainText(
        PROCESS_CHART_TITLES[kind]
      )
      await expectProcessChartSeries(kind)
    }

    // Ni el bloque ni el texto de «Página en construcción», ni marcadores de otro tipo.
    await expect(entityPage.getByTestId('entity-under-construction')).toHaveCount(0)
    await expect(entityPage).not.toContainText('Página en construcción')
    for (const other of ['service-markers', 'host-markers', 'monitor-markers']) {
      await expect(page.getByTestId(other), other).toHaveCount(0)
    }

    // Marcadores y gráficos comparten una sola llamada al canal (sus dos consultas), con el proceso
    // y el rango global.
    await settledRequests()
    expect(sim.processMetricQueries).toHaveLength(2)
    for (const query of sim.processMetricQueries) {
      expect(query.get('entitySelector')).toBe(`entityId("${PROCESS_METRICS_ID}")`)
      expect(query.get('from')).toBe('now-2h')
    }
  }
)

test(
  'CA2 (0028): sin datos de red ni de salud de red, el marcador y el gráfico de red no salen, el cuarto gráfico es el de recursos y el resto sigue',
  { tag: '@proceso' },
  async () => {
    sim.processEmpty = [...PROCESS_ROLE_METRICS.network, ...PROCESS_ROLE_METRICS.networkHealth]
    const entityPage = await openProcessPage()

    // Marcadores: CPU, memoria, el cuarto y problemas, con sus valores; el de red, no.
    await expectProcessMetricMarkers({ network: false })
    await expectProcessFourthMarker(await shownFourthMarker())
    await expectProcessProblems('1', '1')
    await expect(processMarker('network')).toHaveCount(0)

    // Gráficos: CPU, memoria y recursos (el que hay de «salud de red o recursos»).
    await expectProcessChartSeries('cpu')
    await expectProcessChartSeries('resources')
    await expect(entityPage.getByTestId('process-chart-panel')).toHaveCount(3)
    expect(await processChartKinds()).toEqual(['cpu', 'memory', 'resources'])
    await expect(processChartPanel('network')).toHaveCount(0)
    await expect(processChartPanel('network-health')).toHaveCount(0)
    await expect(page.getByTestId('process-chart-network')).toHaveCount(0)
  }
)

test(
  'CA2 (0028): sin datos de disponibilidad, el cuarto marcador es el de recursos',
  { tag: '@proceso' },
  async () => {
    sim.processEmpty = [...PROCESS_ROLE_METRICS.availability]
    await openProcessPage()
    await expectProcessMetricMarkers()
    await expectProcessFourthMarker('resources')
    await expectProcessProblems('1', '1')
    await expect(processMarker('availability')).toHaveCount(0)
    // Los gráficos no dependen de la disponibilidad: los cuatro.
    await expectProcessChartSeries('cpu')
    await expect(processPage().getByTestId('process-chart-panel')).toHaveCount(4)
  }
)

test(
  'CA2 (0028): sin datos de recursos, el cuarto marcador es el de disponibilidad y el cuarto gráfico, el de salud de red',
  { tag: '@proceso' },
  async () => {
    sim.processEmpty = [...PROCESS_ROLE_METRICS.resources]
    await openProcessPage()
    await expectProcessMetricMarkers()
    await expectProcessFourthMarker('availability')
    await expectProcessProblems('1', '1')
    await expect(processMarker('resources')).toHaveCount(0)

    await expectProcessChartSeries('network-health')
    expect(await processChartKinds()).toEqual(['cpu', 'memory', 'network', 'network-health'])
    await expect(processChartPanel('resources')).toHaveCount(0)
  }
)

test(
  'CA2 (0028): sin disponibilidad, recursos ni salud de red, ni cuarto marcador ni cuarto gráfico; el resto sí',
  { tag: '@proceso' },
  async () => {
    sim.processEmpty = [
      ...PROCESS_ROLE_METRICS.availability,
      ...PROCESS_ROLE_METRICS.resources,
      ...PROCESS_ROLE_METRICS.networkHealth
    ]
    const entityPage = await openProcessPage()
    await expectProcessMetricMarkers()
    await expectProcessProblems('1', '1')
    await expect(processMarker('availability')).toHaveCount(0)
    await expect(processMarker('resources')).toHaveCount(0)

    for (const kind of ['cpu', 'memory', 'network'] as const) await expectProcessChartSeries(kind)
    await expect(entityPage.getByTestId('process-chart-panel')).toHaveCount(3)
    expect(await processChartKinds()).toEqual(['cpu', 'memory', 'network'])
  }
)

test(
  'CA3 (0028): la franja de problemas sale sobre el gráfico de CPU con los problemas del proceso, y pulsar un tramo abre el problema',
  { tag: '@proceso' },
  async () => {
    await openProcessPage()
    await processChartSeries('cpu')
    const band = processBand()
    await expect(band).toBeVisible()
    await expect(band.getByTestId('process-problem-segment')).toHaveCount(2)
    for (const { problemId } of [PROCESS_BAND_OPEN, PROCESS_BAND_CLOSED]) {
      await expect(processSegment(problemId), problemId).toHaveCount(1)
    }
    // Solo en el panel de la CPU.
    await expect(page.getByTestId('process-problem-band')).toHaveCount(1)

    // La lista se pide con el proceso y el rango global.
    await settledRequests()
    const lists = sim.entityProblemListQueries.filter((query) =>
      (query.get('problemSelector') ?? '').includes(PROCESS_METRICS_ID)
    )
    expect(lists).toHaveLength(1)
    expect(lists[0]?.get('problemSelector')).toBe(`affectedEntities("${PROCESS_METRICS_ID}")`)
    expect(lists[0]?.get('from')).toBe('now-2h')

    // Encima del gráfico: la franja acaba antes de que empiece el canvas.
    const bandBox = await settledBox(band)
    const plotBox = await settledBox(processChartPlot('cpu'))
    expect(bandBox.y + bandBox.height).toBeLessThanOrEqual(plotBox.y + 1)

    // Pulsar un tramo (trayéndolo a la vista) abre ese problema.
    await clickInPlace(processSegment(PROCESS_BAND_CLOSED.problemId), { scroll: true })
    await expect(page.getByTestId('problem-page')).toBeVisible()
    await expect(page.getByTestId('problem-page-title')).toContainText(
      PROCESS_BAND_CLOSED.displayId
    )
    expect(await currentRoute()).toBe(`/problems/${PROCESS_BAND_CLOSED.problemId}`)

    // «Volver» regresa a la página del proceso.
    await page.getByTestId('problem-back').click()
    await expect(processPage()).toBeVisible()
    expect(await currentRoute()).toBe(`/entities/PROCESS_GROUP_INSTANCE/${PROCESS_METRICS_ID}`)
  }
)

test(
  'CA4 (0028): cambiar el rango global vuelve a pedir los datos; «Actualizar» también; volver a la página sin cambios, no',
  { tag: '@proceso' },
  async () => {
    await openProcessPage()
    await expectProcessMarkers()
    await settledRequests()
    // Al entrar: las dos consultas de métricas y las dos de recuentos, con el rango global.
    expect(sim.processMetricQueries).toHaveLength(2)
    expect(sim.entityProblemQueries).toHaveLength(2)
    for (const query of [...sim.processMetricQueries, ...sim.entityProblemQueries]) {
      expect(query.get('from')).toBe('now-2h')
    }

    // Rango nuevo: otra vez, con now-24h.
    await page.getByTestId('time-range-24h').click()
    await expect.poll(() => sim.processMetricQueries.length).toBe(4)
    await expect.poll(() => sim.entityProblemQueries.length).toBe(4)
    for (const query of [
      ...sim.processMetricQueries.slice(2),
      ...sim.entityProblemQueries.slice(2)
    ]) {
      expect(query.get('from')).toBe('now-24h')
    }
    await expectProcessMarkers()
    await settledRequests()
    expect(sim.processMetricQueries).toHaveLength(4)

    // Fuera y vuelta, sin cambiar nada: ninguna petición nueva.
    await goTo('metrics')
    await expect(processPage()).toHaveCount(0)
    const before = await settledRequests()
    await openProcessPage()
    await expectProcessMarkers()
    await page.waitForTimeout(1500)
    expect(sim.requests.slice(before), 'peticiones al volver a la página').toEqual([])

    // «Actualizar», en la cabecera de la página: otra vez, con el rango actual.
    await processPage().getByTestId('module-refresh').click()
    await expect.poll(() => sim.processMetricQueries.length).toBe(6)
    await expect.poll(() => sim.entityProblemQueries.length).toBe(6)
    for (const query of [
      ...sim.processMetricQueries.slice(4),
      ...sim.entityProblemQueries.slice(4)
    ]) {
      expect(query.get('from')).toBe('now-24h')
    }
    await expectProcessMarkers()
  }
)

test(
  'CA4 (0028): si falla el canal de métricas, sus marcadores y cada gráfico enseñan el aviso con Reintentar y el marcador de problemas sigue',
  { tag: '@proceso' },
  async () => {
    sim.processMetricsFail = true
    await openProcessPage()

    // El de problemas, con sus recuentos y sin aviso.
    await expectProcessProblems('1', '1')
    await expect(processMarker('problems').getByRole('button', { name: 'Reintentar' })).toHaveCount(
      0
    )

    // Cada marcador de métricas, en su sitio, con el aviso y Reintentar y sin valor.
    for (const id of PROCESS_METRIC_MARKERS) {
      const marker = processMarker(id)
      await expect(marker, id).toBeVisible()
      await expect(marker.getByRole('alert').first(), id).toBeVisible()
      await expect(marker.getByRole('button', { name: 'Reintentar' }), id).toBeVisible()
      await expect(marker.getByTestId('process-marker-value'), id).toHaveCount(0)
    }
    // Cada gráfico (al menos CPU, memoria y red), con su aviso y Reintentar, sin gráfico.
    for (const kind of ['cpu', 'memory', 'network'] as const) {
      await expect(processChartPanel(kind), kind).toBeVisible()
    }
    for (const kind of (await processChartKinds()) as ProcessChartKind[]) {
      const panel = processChartPanel(kind)
      await expect(panel.getByRole('alert').first(), kind).toBeVisible()
      await expect(panel.getByRole('button', { name: 'Reintentar' }), kind).toBeVisible()
      await expect(panel.getByTestId(`process-chart-${kind}`), kind).toHaveCount(0)
    }

    // Reintentar, con el canal ya bien: llegan valores y los cuatro gráficos.
    sim.processMetricsFail = false
    await clickInPlace(processMarker('cpu').getByRole('button', { name: 'Reintentar' }), {
      scroll: true
    })
    await expectProcessMarkers()
    await expect(processPage().getByTestId('process-chart-panel')).toHaveCount(4)
    expect(await processChartKinds()).toEqual(['cpu', 'memory', 'network', 'network-health'])
    for (const kind of (await processChartKinds()) as ProcessChartKind[]) {
      await expectProcessChartSeries(kind)
    }
    for (const id of PROCESS_METRIC_MARKERS) {
      await expect(processMarker(id).getByRole('button', { name: 'Reintentar' }), id).toHaveCount(0)
    }
  }
)

test(
  'CA5 (0028): desde la tabla de procesos del host, pulsar un proceso abre su página con sus marcadores y gráficos',
  { tag: '@proceso' },
  async () => {
    await openHostPage()
    await expectHostTablesLoaded()
    const target = HOST_PAGE_TOP[2]
    const id = target?.id ?? ''
    const name = target?.name ?? ''
    await settledRequests()
    const processQueriesBefore = sim.processMetricQueries.length

    await clickInPlace(processRow(id).getByRole('link', { name }), { scroll: true })
    const entityPage = processPage()
    await expect(entityPage).toBeVisible()
    expect(await currentRoute()).toBe(`/entities/PROCESS_GROUP_INSTANCE/${id}`)
    await expect(entityPage.getByRole('heading', { level: 1 })).toHaveText(name)

    // Sus datos: los marcadores del simulador (sin problemas) y los cuatro gráficos.
    await expectProcessMetricMarkers()
    await expectProcessFourthMarker(await shownFourthMarker())
    await expectProcessProblems('0', '0')
    await expect(entityPage.getByTestId('process-chart-panel')).toHaveCount(4)
    expect(await processChartKinds()).toEqual(['cpu', 'memory', 'network', 'network-health'])
    for (const kind of (await processChartKinds()) as ProcessChartKind[]) {
      await expectProcessChartSeries(kind)
    }
    await expect(entityPage.getByTestId('entity-under-construction')).toHaveCount(0)

    // Las consultas, de ese proceso.
    await settledRequests()
    const queries = sim.processMetricQueries.slice(processQueriesBefore)
    expect(queries).toHaveLength(2)
    for (const query of queries) expect(query.get('entitySelector')).toBe(`entityId("${id}")`)
  }
)

/**
 * Ficha 0029: tarjeta «Información» de la página de un proceso (PROCESS_METRICS_ID, con
 * processInfoBody), canal entities:get, con la forma de la del servicio (0015), el host (0020) y
 * el monitor (0026) y sus nombres con el prefijo `process-info`.
 *
 * Nombres que fijan estos tests: la tarjeta `process-info`, entre la cabecera y
 * `process-markers`; cada fila, `process-info-row` con `data-key` (las claves de
 * `buildProcessInfo`: technologies, listenPorts, detectedName, executable, firstSeen, lastSeen,
 * managementZones y tags, en ese orden) y su valor en `process-info-value`; los chips,
 * `process-info-chip`. Las relaciones, en `process-info-relations`: cada grupo
 * `process-info-group` con `data-group` (runsOn, processGroup, services y other), con
 * `process-info-group-toggle` (aria-expanded), `process-info-group-count` y, desplegado, sus
 * `process-info-entity` (enlaces, con `data-entity-id`), el botón `process-info-names` («Ver
 * nombres») y cada nombre en `process-info-entity-name`. «Todas las propiedades»,
 * `process-info-properties-toggle` y cada una `process-info-property` con `data-key`.
 */
const PROCESS_INFO_ROWS = [
  'technologies',
  'listenPorts',
  'detectedName',
  'executable',
  'firstSeen',
  'lastSeen',
  // Ficha 0037: sin la fila de etiquetas (van en las píldoras de arriba).
  'managementZones'
]
const processInfoRow = (key: string): Locator =>
  processInfoCard().locator(`[data-testid="process-info-row"][data-key="${key}"]`)
const processInfoValue = (key: string): Locator =>
  processInfoRow(key).getByTestId('process-info-value')
const processInfoGroup = (key: string): Locator =>
  processInfoCard().locator(`[data-testid="process-info-group"][data-group="${key}"]`)
const processInfoEntity = (group: string, id: string): Locator =>
  processInfoGroup(group).locator(`[data-testid="process-info-entity"][data-entity-id="${id}"]`)

/** Ficha 0029: despliega un grupo de relaciones del proceso (si no lo está). */
async function expandProcessGroup(key: string): Promise<Locator> {
  const group = processInfoGroup(key)
  const toggle = group.getByTestId('process-info-group-toggle')
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await clickInPlace(toggle, { scroll: true })
  }
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  return group
}

/**
 * Ficha 0029: ni la línea de comandos ni la ruta completa del simulador aparecen en ningún sitio
 * de la página: ni en el texto ni en el HTML (atributos, títulos, tooltips).
 */
async function expectNoProcessSecrets(where: string): Promise<void> {
  const html = await page.content()
  const text = await page.locator('body').innerText()
  for (const part of PROCESS_INFO_SECRET_PARTS) {
    expect(html, `${where}: HTML con «${part}»`).not.toContain(part)
    expect(text, `${where}: texto con «${part}»`).not.toContain(part)
  }
}

test(
  'CA3 (0029): la página de un proceso enseña su tarjeta «Información» (tecnologías, puertos, ejecutable…), sus relaciones con «Ver nombres» y enlaces al host y a los servicios, y nunca la línea de comandos ni la ruta completa',
  { tag: '@proceso' },
  async () => {
    const card = await openProcessInfo()
    await expect(card).toContainText('Información')

    // Debajo de los marcadores: desde la ficha 0036, «Información» va al final de la página.
    const cardBox = await settledBox(card)
    const markersBox = await settledBox(page.getByTestId('process-markers'))
    expect(cardBox.y, 'la tarjeta va debajo de los marcadores').toBeGreaterThanOrEqual(
      markersBox.y + markersBox.height - 1
    )

    // Las filas, en su orden y con sus valores.
    expect(await dataKeys(card.getByTestId('process-info-row'))).toEqual(PROCESS_INFO_ROWS)
    await expect(processInfoRow('technologies').getByTestId('process-info-chip')).toHaveText([
      'JAVA OpenJDK 17.0.2',
      'APACHE_TOMCAT 10.1'
    ])
    await expect(processInfoValue('listenPorts')).toContainText(loneNumber('8080'))
    await expect(processInfoValue('listenPorts')).toContainText(loneNumber('8443'))
    await expect(processInfoValue('detectedName')).toContainText('pagos-worker-detectado-e2e')
    // Solo el nombre del fichero.
    await expect(processInfoValue('executable')).toHaveText(/^\s*pagos-worker-e2e\s*$/)
    await expect(processInfoValue('firstSeen')).toContainText('2026')
    await expect(processInfoValue('lastSeen')).toContainText('2026')
    await expect(processInfoRow('managementZones').getByTestId('process-info-chip')).toHaveText([
      'Zona proceso A'
    ])
    // Ficha 0037: las etiquetas ya no salen en la tarjeta.
    await expect(processInfoRow('tags')).toHaveCount(0)
    for (const text of ['undefined', 'null', 'NaN', '[object Object]']) {
      await expect(card, text).not.toContainText(text)
    }
    // Sin las tarjetas de otros tipos.
    for (const other of ['service-info', 'host-info', 'monitor-info']) {
      await expect(page.getByTestId(other), other).toHaveCount(0)
    }

    // Relaciones: Se ejecuta en, Process group, Servicios y Otras relaciones (plegada).
    const relations = card.getByTestId('process-info-relations')
    await expect(relations).toContainText('Relaciones')
    const groups = relations.getByTestId('process-info-group')
    await expect(groups).toHaveCount(4)
    expect(await dataKeys(groups, 'data-group')).toEqual([
      'runsOn',
      'processGroup',
      'services',
      'other'
    ])
    for (const [key, title, count] of [
      ['runsOn', 'Se ejecuta en', '1'],
      ['processGroup', 'Process group', '1'],
      ['services', 'Servicios', '2'],
      ['other', 'Otras relaciones', '1']
    ] as const) {
      await expect(processInfoGroup(key), key).toContainText(title)
      await expect(processInfoGroup(key).getByTestId('process-info-group-count'), key).toHaveText(
        new RegExp(`^\\s*${count}\\s*$`)
      )
    }
    await expect(
      processInfoGroup('other').getByTestId('process-info-group-toggle')
    ).toHaveAttribute('aria-expanded', 'false')
    await expect(processInfoGroup('other').getByTestId('process-info-entity')).toHaveCount(0)

    // Desplegados, con sus entidades; ningún nombre pedido aún.
    await expandProcessGroup('runsOn')
    await expandProcessGroup('processGroup')
    const services = await expandProcessGroup('services')
    expect(await dataKeys(services.getByTestId('process-info-entity'), 'data-entity-id')).toEqual([
      INFO_FEW_ID,
      PROCESS_INFO_SERVICE_2
    ])
    const other = await expandProcessGroup('other')
    await expect(other).toContainText('isPgiOfCgi')
    await expect(processInfoEntity('other', PROCESS_INFO_CGI)).toContainText(PROCESS_INFO_CGI)
    await settledRequests()
    expect(sim.entityNamesQueries, 'nombres antes de «Ver nombres»').toHaveLength(0)

    // «Ver nombres» de «Servicios»: una llamada con sus dos ids y los nombres en su sitio.
    const button = services.getByTestId('process-info-names')
    await expect(button).toHaveText('Ver nombres')
    await clickInPlace(button, { scroll: true })
    await expect.poll(() => sim.entityNamesQueries.length).toBe(1)
    const selector = sim.entityNamesQueries[0]?.get('entitySelector') ?? ''
    expect(selector).toContain(INFO_FEW_ID)
    expect(selector).toContain(PROCESS_INFO_SERVICE_2)
    await expect(
      processInfoEntity('services', INFO_FEW_ID).getByTestId('process-info-entity-name')
    ).toHaveText('info-pocas-e2e')
    await expect(
      processInfoEntity('services', PROCESS_INFO_SERVICE_2).getByTestId('process-info-entity-name')
    ).toHaveText('servicio-proceso-e2e')
    // Los de otros grupos, sin pedir; «Ver nombres» del host, aparte.
    await settledRequests()
    expect(sim.entityNamesQueries).toHaveLength(1)
    await expect(
      processInfoEntity('runsOn', PROCESS_INFO_HOST).getByTestId('process-info-entity-name')
    ).toHaveCount(0)
    await clickInPlace(processInfoGroup('runsOn').getByTestId('process-info-names'), {
      scroll: true
    })
    await expect(
      processInfoEntity('runsOn', PROCESS_INFO_HOST).getByTestId('process-info-entity-name')
    ).toHaveText('host-proceso-e2e')

    // «Todas las propiedades», plegada; desplegada, con metadata pero sin la línea de comandos.
    await expect(card.getByTestId('process-info-property')).toHaveCount(0)
    const toggle = card.getByTestId('process-info-properties-toggle')
    await expect(toggle).toContainText('Todas las propiedades')
    await clickInPlace(toggle, { scroll: true })
    await expect(processInfoProperty('detectedName')).toContainText('pagos-worker-detectado-e2e')
    await expect(processInfoProperty('metadata')).toContainText('pagos-worker-e2e')

    // Con todo desplegado: ni la línea de comandos ni la ruta completa en ningún sitio.
    await expectNoProcessSecrets('todo desplegado')

    // Enlaces: el host, el process group y los servicios, a su página.
    const host = processInfoEntity('runsOn', PROCESS_INFO_HOST)
    await expect(host).toHaveRole('link')
    await expect(host).toHaveAttribute('href', new RegExp(`#/entities/HOST/${PROCESS_INFO_HOST}$`))
    await expect(processInfoEntity('processGroup', PROCESS_INFO_PG)).toHaveAttribute(
      'href',
      new RegExp(`#/entities/PROCESS_GROUP/${PROCESS_INFO_PG}$`)
    )
    const service = processInfoEntity('services', INFO_FEW_ID)
    await expect(service).toHaveRole('link')
    await expect(service).toHaveAttribute('href', new RegExp(`#/entities/SERVICE/${INFO_FEW_ID}$`))

    const processQueries = (): number =>
      sim.requests.filter((request) => request.includes(`/entities/${PROCESS_METRICS_ID}`)).length
    const before = processQueries()

    // Pulsar el host abre su página; «Volver» regresa al proceso.
    await clickInPlace(host, { scroll: true })
    const hostPage = page.getByTestId('entity-page-host')
    await expect(hostPage).toBeVisible()
    expect(await currentRoute()).toBe(`/entities/HOST/${PROCESS_INFO_HOST}`)
    await expect(page.getByTestId('process-info')).toHaveCount(0)
    await clickInPlace(hostPage.getByTestId('entity-back'), { scroll: true })
    await expect(processPage()).toBeVisible()
    expect(await currentRoute()).toBe(`/entities/PROCESS_GROUP_INSTANCE/${PROCESS_METRICS_ID}`)
    await expect(processInfoValue('executable')).toContainText('pagos-worker-e2e')

    // Pulsar un servicio abre la suya; «Volver» regresa al proceso sin volver a pedir sus datos.
    await expandProcessGroup('services')
    await clickInPlace(processInfoEntity('services', INFO_FEW_ID), { scroll: true })
    const servicePage = page.getByTestId('entity-page-service')
    await expect(servicePage).toBeVisible()
    expect(await currentRoute()).toBe(`/entities/SERVICE/${INFO_FEW_ID}`)
    await expect(servicePage.getByTestId('entity-page-id')).toHaveText(INFO_FEW_ID)
    await clickInPlace(servicePage.getByTestId('entity-back'), { scroll: true })
    await expect(processPage()).toBeVisible()
    await expect(processInfoValue('executable')).toContainText('pagos-worker-e2e')
    await settledRequests()
    expect(processQueries(), 'entities:get del proceso al volver').toBe(before)

    // Tampoco al volver, con la tarjeta recién pintada.
    await expectNoProcessSecrets('al volver')
  }
)

test(
  'CA4 (0029): sin entities.read, la tarjeta del proceso dice qué scope falta y los marcadores y gráficos siguen',
  { tag: '@proceso' },
  async () => {
    const tenants = await invoke<{ clients: { id: string; name: string }[] }>('tenants:list')
    const clientId = tenants.clients.find((client) => client.name === 'Cliente A')?.id ?? ''
    const noEntities = await createEnvironment(
      clientId,
      'Sin entidades proceso',
      'other',
      TOKEN_NO_ENTITIES
    )
    try {
      await invoke('connection:test', { environmentId: noEntities })
      await invoke('environments:setActive', { environmentId: noEntities })
      await reloadUi()
      await openProcessPage()
      const unavailable = processInfoCard().getByTestId('module-unavailable')
      await expect(unavailable).toBeVisible()
      await expect(unavailable).toContainText('entities.read')
      await expect(processInfoCard().getByTestId('process-info-row')).toHaveCount(0)
      // Marcadores y gráficos, con sus datos.
      await expectProcessMarkers()
      await expect(processPage().getByTestId('process-chart-panel')).toHaveCount(4)
      for (const kind of (await processChartKinds()) as ProcessChartKind[]) {
        await expectProcessChartSeries(kind)
      }
      await settledRequests()
      expect(sim.entityInfoQueries, 'entities:get sin el scope').toHaveLength(0)
    } finally {
      await invoke('environments:setActive', { environmentId: env['Producción'] })
      await invoke('environments:delete', { id: noEntities })
      await reloadUi()
    }
  }
)

// ---------------------------------------------------------------------------
// Ficha 0032: página de un PROCESS_GROUP (marcadores, gráficos, instancias e «Información»).
// ---------------------------------------------------------------------------

/**
 * Página del process group inventado de la ficha 0032 (PROCESS_GROUP_PAGE_ID, siete instancias en
 * tres hosts), con el canal entities:processGroupMetrics de la 0031 (totales PROCESS_GROUP_SERIES
 * y PROCESS_GROUP_MARKERS), sus problemas (processGroupBandProblems: uno abierto y uno cerrado) y
 * entities:get (processGroupInfoBody).
 *
 * Nombres que fijan estos tests (la ficha no los da; decisión del test-writer, delegada por Dani y
 * refinable), los del proceso (0028 y 0029) con el prefijo `process-group`:
 * - Marcadores: la fila `process-group-markers`; cada marcador `process-group-marker-<id>`
 *   (instances, cpu, memory, network y problems); el valor principal en
 *   `process-group-marker-value` (el de la CPU con `data-level`), lo de debajo en
 *   `process-group-marker-secondary` (máxima y salida) y los recuentos en
 *   `process-group-marker-open` y `process-group-marker-closed`.
 * - Gráficos: la sección `process-group-charts`; cada uno en un `process-group-chart-panel` con
 *   `data-kind` (cpu, memory, network y cpu-instances, en ese orden) y su título en un
 *   encabezado; dentro, el `Chart` con testid `process-group-chart-<kind>` (con `data-series`).
 *   La franja, `process-group-problem-band`, en el panel de la CPU; cada tramo,
 *   `process-group-problem-segment` con `data-problem-id`.
 * - Tabla: la tarjeta `process-group-instances`, con el `DataGrid` `process-group-instances-grid`
 *   (columnas name, host, cpu y memory, en ese orden) y filas `process-group-instance-row` con
 *   `data-instance-id`; la barra de CPU, `process-group-instance-cpu-bar`. El nombre de la
 *   instancia y el de su host son enlaces a su página. Con `partial`, el aviso
 *   `process-group-instances-partial`.
 * - «Información»: `process-group-info`, con `process-group-info-row` (`data-key`: al menos
 *   technologies, listenPorts y detectedName), `process-group-info-value`,
 *   `process-group-info-chip`, `process-group-info-relations`, `process-group-info-group`
 *   (`data-group`: instances, hosts, services y other), `-group-toggle`, `-group-count`,
 *   `-entity` (`data-entity-id`), `-names`, `-entity-name` y `-properties-toggle`.
 *
 * Formato, como el proceso (0028): CPU en % con un decimal; memoria en MB; red en bits por segundo
 * (bytes/s × 8). Los marcadores enseñan los `totals` del canal: la CPU, la media del total del
 * grupo (la suma de sus instancias, 64,5 %) y debajo la máxima (112,5 %).
 *
 * «CPU por instancia»: la ficha no dice de dónde salen las series; el simulador las da de dos
 * formas (decisión del test-writer): en entities:processGroupMetrics, una expresión de
 * `cpu.usage` partida por `dt.entity.process_group_instance` (de más a menos CPU, con
 * `:limit(N)` si se pide), o en entities:processMetrics de cada instancia. Los tests solo miran el
 * gráfico: una serie por instancia, las cinco de más CPU, con su nombre.
 */
const PG_PAGE_TEST_ID = 'entity-page-process_group'
type PgChartKind = 'cpu' | 'memory' | 'network' | 'cpu-instances'
const PG_METRIC_MARKERS = ['instances', 'cpu', 'memory', 'network'] as const
const PG_MARKER_LABELS: Record<string, string> = {
  instances: 'Instancias',
  cpu: 'CPU',
  memory: 'Memoria',
  network: 'Red',
  problems: 'Problemas'
}
const PG_CHART_KINDS: PgChartKind[] = ['cpu', 'memory', 'network', 'cpu-instances']
const PG_CHART_TITLES: Record<PgChartKind, string> = {
  cpu: 'CPU',
  memory: 'Memoria',
  network: 'Red',
  'cpu-instances': 'CPU por instancia'
}
const PG_INSTANCE_COLUMNS = ['name', 'host', 'cpu', 'memory'] as const
/** Las cinco instancias de más CPU, las del gráfico «CPU por instancia». */
const PG_TOP_FIVE = PROCESS_GROUP_PAGE_BY_CPU.slice(0, 5)

const pgPage = (): Locator => page.getByTestId(PG_PAGE_TEST_ID)
const pgMarker = (id: string): Locator => pgPage().getByTestId(`process-group-marker-${id}`)
const pgChartPanel = (kind: PgChartKind): Locator =>
  pgPage().locator(`[data-testid="process-group-chart-panel"][data-kind="${kind}"]`)
const pgChartPlot = (kind: PgChartKind): Locator =>
  pgChartPanel(kind).getByTestId(`process-group-chart-${kind}`)
const pgBand = (): Locator => pgChartPanel('cpu').getByTestId('process-group-problem-band')
const pgSegment = (problemId: string): Locator =>
  pgBand().locator(`[data-testid="process-group-problem-segment"][data-problem-id="${problemId}"]`)
const pgInstances = (): Locator => pgPage().getByTestId('process-group-instances')
const pgInstanceRow = (id: string): Locator =>
  pgInstances().locator(`[data-testid="process-group-instance-row"][data-instance-id="${id}"]`)
const pgInfoCard = (): Locator => pgPage().getByTestId('process-group-info')
const pgInfoRow = (key: string): Locator =>
  pgInfoCard().locator(`[data-testid="process-group-info-row"][data-key="${key}"]`)
const pgInfoValue = (key: string): Locator => pgInfoRow(key).getByTestId('process-group-info-value')
const pgInfoGroup = (key: string): Locator =>
  pgInfoCard().locator(`[data-testid="process-group-info-group"][data-group="${key}"]`)
const pgInfoEntity = (group: string, id: string): Locator =>
  pgInfoGroup(group).locator(`[data-testid="process-group-info-entity"][data-entity-id="${id}"]`)

/** Ficha 0032: abre por URL la página del process group de la ficha. */
async function openProcessGroupPage(): Promise<Locator> {
  await goToRoute(`/entities/PROCESS_GROUP/${PROCESS_GROUP_PAGE_ID}`)
  const entityPage = pgPage()
  await expect(entityPage).toBeVisible()
  return entityPage
}

/** Ficha 0032: espera a que el gráfico tenga sus series y las devuelve. */
async function pgChartSeries(kind: PgChartKind): Promise<string[]> {
  const plot = pgChartPlot(kind)
  await expect(plot.locator('canvas').first()).toBeVisible()
  await expect(plot).toHaveAttribute('data-series', /\[.+\]/)
  return JSON.parse((await plot.getAttribute('data-series')) ?? '[]') as string[]
}

/** Ficha 0032: los `data-kind` de los paneles de gráficos, en el orden en que se pintan. */
async function pgChartKinds(): Promise<string[]> {
  return pgPage()
    .getByTestId('process-group-charts')
    .getByTestId('process-group-chart-panel')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-kind') ?? ''))
}

/** Ficha 0032: las series de los cuatro gráficos, con sus nombres. */
async function expectPgChartSeries(): Promise<void> {
  expect(await pgChartSeries('cpu'), 'cpu').toHaveLength(1)
  expect(await pgChartSeries('memory'), 'memory').toHaveLength(1)
  const network = await pgChartSeries('network')
  expect(network, 'network').toHaveLength(2)
  expect(network[0]).toMatch(/entrada/i)
  expect(network[1]).toMatch(/salida/i)
  // Una línea por instancia: las cinco de más CPU (de siete), con su nombre.
  const instances = await pgChartSeries('cpu-instances')
  expect(instances, 'cpu-instances').toHaveLength(5)
  expect(instances.slice().sort()).toEqual(PG_TOP_FIVE.map((instance) => instance.name).sort())
}

/** Ficha 0032: los marcadores con los valores del simulador, ya formateados (es). */
async function expectPgMarkers(): Promise<void> {
  // Instancias: siete.
  await expect(pgMarker('instances').getByTestId('process-group-marker-value')).toHaveText(
    /^\s*7\s*$/
  )
  // CPU: media del total 64,5 % y, debajo, la máxima de la serie, 112,5 %; normal, sin texto.
  const cpu = pgMarker('cpu')
  await expect(cpu.getByTestId('process-group-marker-value')).toHaveText(/^64,5\s?%$/)
  await expect(cpu.getByTestId('process-group-marker-secondary')).toContainText(
    /(^|[^\d.,])112,5\s?%/
  )
  await expect(cpu.getByTestId('process-group-marker-value')).toHaveAttribute(
    'data-level',
    'normal'
  )
  // Memoria: media del total, 925 MB.
  await expect(pgMarker('memory').getByTestId('process-group-marker-value')).toHaveText(
    /^925(,0)?\sMB$/
  )
  // Red: entrada 5120 B/s y salida 768 B/s, en bits por segundo (40 960 y 6144 bit/s).
  const network = pgMarker('network')
  await expect(network.getByTestId('process-group-marker-value')).toHaveText(/^41(,0)?\skbit\/s$/)
  await expect(network.getByTestId('process-group-marker-secondary')).toContainText(
    /(^|[^\d.,])6,1\skbit\/s/
  )
  // Problemas: uno abierto y uno cerrado.
  await expect(pgMarker('problems').getByTestId('process-group-marker-open')).toHaveText(
    loneNumber('1')
  )
  await expect(pgMarker('problems').getByTestId('process-group-marker-closed')).toHaveText(
    loneNumber('1')
  )
}

/** Ficha 0032: la CPU de una instancia en la tabla (es): 41,5 %; las enteras, con o sin «,0». */
const cpuText = (cpu: number): RegExp =>
  Number.isInteger(cpu)
    ? new RegExp(`(^|[^\\d,.])${cpu}(,0)?\\s?%`)
    : new RegExp(`(^|[^\\d,.])${String(cpu).replace('.', ',')}\\s?%`)

/** Ficha 0032: los ids de las filas de la tabla de instancias, en el orden en que se pintan. */
const pgInstanceOrder = (): Promise<string[]> =>
  tableOrder(pgInstances(), 'process-group-instance-row', 'data-instance-id')

/** Ficha 0032: ni la línea de comandos ni la ruta completa del grupo, en ningún sitio. */
async function expectNoProcessGroupSecrets(where: string): Promise<void> {
  const html = await page.content()
  const text = await page.locator('body').innerText()
  for (const part of PROCESS_GROUP_INFO_SECRET_PARTS) {
    expect(html, `${where}: HTML con «${part}»`).not.toContain(part)
    expect(text, `${where}: texto con «${part}»`).not.toContain(part)
  }
}

/** Ficha 0032: despliega un grupo de relaciones del process group (si no lo está). */
async function expandPgInfoGroup(key: string): Promise<Locator> {
  const group = pgInfoGroup(key)
  const toggle = group.getByTestId('process-group-info-group-toggle')
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await clickInPlace(toggle, { scroll: true })
  }
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  return group
}

test(
  'CA1 (0032): la página de un process group enseña sus marcadores, sus cuatro gráficos y la tabla de instancias con los valores del simulador, sin «Página en construcción»',
  { tag: '@proceso' },
  async () => {
    const entityPage = await openProcessGroupPage()

    // Cinco marcadores: instancias, CPU, memoria, red y problemas, con su nombre y sus valores.
    const row = entityPage.getByTestId('process-group-markers')
    await expect(row).toBeVisible()
    for (const id of [...PG_METRIC_MARKERS, 'problems']) {
      await expect(row.getByTestId(`process-group-marker-${id}`), id).toBeVisible()
      await expect(row.getByTestId(`process-group-marker-${id}`), id).toContainText(
        PG_MARKER_LABELS[id] ?? id
      )
    }
    await expectPgMarkers()

    // Cuatro gráficos en su orden: CPU, memoria, red y CPU por instancia.
    const section = entityPage.getByTestId('process-group-charts')
    await expect(section).toBeVisible()
    const panels = section.getByTestId('process-group-chart-panel')
    await expect(panels).toHaveCount(4)
    expect(await pgChartKinds()).toEqual(PG_CHART_KINDS)
    for (const [index, kind] of PG_CHART_KINDS.entries()) {
      await expect(panels.nth(index).getByRole('heading').first(), kind).toContainText(
        PG_CHART_TITLES[kind]
      )
    }
    await expectPgChartSeries()

    // Tabla «Instancias»: las siete, de más a menos CPU, con nombre, host, CPU (con barra) y memoria.
    const card = pgInstances()
    await expect(card).toBeVisible()
    await expect(card).toContainText('Instancias')
    const grid = card.getByTestId('process-group-instances-grid')
    await expect(grid).toHaveAttribute('role', 'grid')
    expect(await gridColumns(grid)).toEqual(PG_INSTANCE_COLUMNS.map((c) => `col-${c}`))
    await expect(card.getByTestId('process-group-instance-row')).toHaveCount(7)
    expect(await pgInstanceOrder()).toEqual(PROCESS_GROUP_PAGE_BY_CPU.map((i) => i.id))
    for (const instance of PROCESS_GROUP_PAGE_INSTANCES) {
      const cells = pgInstanceRow(instance.id).getByRole('gridcell')
      await expect(cells, instance.name).toHaveCount(PG_INSTANCE_COLUMNS.length)
      await expect(cells.nth(0), instance.name).toHaveText(instance.name)
      await expect(cells.nth(1), instance.name).toHaveText(instance.hostName)
      await expect(cells.nth(2), instance.name).toContainText(cpuText(instance.cpu))
      await expect(
        cells.nth(2).getByTestId('process-group-instance-cpu-bar'),
        instance.name
      ).toHaveCount(1)
      await expect(cells.nth(3), instance.name).toHaveText(
        new RegExp(`^${instance.memory / 1_000_000},0\\sMB$`)
      )
    }
    // Sin recorte, sin aviso.
    await expect(card.getByTestId('process-group-instances-partial')).toHaveCount(0)

    // Ni el bloque ni el texto de «Página en construcción», ni marcadores de otro tipo.
    await expect(entityPage.getByTestId('entity-under-construction')).toHaveCount(0)
    await expect(entityPage).not.toContainText('Página en construcción')
    for (const other of ['service-markers', 'host-markers', 'monitor-markers', 'process-markers']) {
      await expect(page.getByTestId(other), other).toHaveCount(0)
    }

    // Las consultas del canal, con el selector de las instancias del grupo y el rango global.
    await settledRequests()
    expect(sim.processGroupMetricQueries.length).toBeGreaterThanOrEqual(2)
    for (const query of sim.processGroupMetricQueries) {
      expect(query.get('entitySelector')).toBe(PROCESS_GROUP_PAGE_SELECTOR)
      expect(query.get('from')).toBe('now-2h')
    }
  }
)

test(
  'CA1 (0032), nota del Orquestador: con las instancias recortadas (partial), la tabla avisa del recorte y el marcador «Instancias» no presenta el total como real',
  { tag: '@proceso' },
  async () => {
    sim.processGroupTruncated = true
    // Ficha 0051 (nota del revisor de la 0050): con el total real de /entities, el marcador es
    // exacto aunque llegue `partial`; el «como mínimo» solo vale si no se sabe el total.
    sim.processGroupEntitiesFail = true
    await openProcessGroupPage()
    const card = pgInstances()
    await expect(card.getByTestId('process-group-instance-row').first()).toBeVisible()

    // El aviso, como el del desglose del host; las filas siguen.
    const notice = card.getByTestId('process-group-instances-partial')
    await expect(notice).toBeVisible()
    await expect(notice).toContainText(/incomplet|recort/i)
    await expect(card.getByTestId('process-group-instance-row')).toHaveCount(7)

    // «Instancias»: el número que llegó, pero no como total real («7+» o «como mínimo 7»).
    const marker = pgMarker('instances')
    await expect(marker).toContainText(loneNumber('7'))
    await expect(marker.getByTestId('process-group-marker-value')).not.toHaveText(/^\s*7\s*$/)
    await expect(marker).toContainText(/7\s*\+|mínimo|al menos/i)
  }
)

test(
  'CA2 (0032): pulsar una instancia abre su página de proceso y «Volver» regresa al grupo; pulsar su host abre la del host',
  { tag: '@proceso' },
  async () => {
    await openProcessGroupPage()
    const target = PROCESS_GROUP_PAGE_BY_CPU[1]
    const id = target?.id ?? ''
    const name = target?.name ?? ''
    const hostId = target?.hostId ?? ''
    const hostName = target?.hostName ?? ''
    const row = pgInstanceRow(id)
    await expect(row).toBeVisible()

    // La instancia: enlace a su página de proceso.
    const link = row.getByRole('link', { name })
    await expect(link).toHaveAttribute(
      'href',
      new RegExp(`#/entities/PROCESS_GROUP_INSTANCE/${id}$`)
    )
    await clickInPlace(link, { scroll: true })
    const processEntityPage = page.getByTestId('entity-page-process_group_instance')
    await expect(processEntityPage).toBeVisible()
    expect(await currentRoute()).toBe(`/entities/PROCESS_GROUP_INSTANCE/${id}`)
    await expect(processEntityPage.getByTestId('entity-page-id')).toHaveText(id)

    // «Volver» regresa al grupo, con su tabla.
    await clickInPlace(processEntityPage.getByTestId('entity-back'), { scroll: true })
    await expect(pgPage()).toBeVisible()
    expect(await currentRoute()).toBe(`/entities/PROCESS_GROUP/${PROCESS_GROUP_PAGE_ID}`)
    await expect(pgInstanceRow(id)).toBeVisible()

    // Su host: enlace a la página del host.
    const hostLink = pgInstanceRow(id).getByRole('link', { name: hostName })
    await expect(hostLink).toHaveAttribute('href', new RegExp(`#/entities/HOST/${hostId}$`))
    await clickInPlace(hostLink, { scroll: true })
    const hostEntityPage = page.getByTestId('entity-page-host')
    await expect(hostEntityPage).toBeVisible()
    expect(await currentRoute()).toBe(`/entities/HOST/${hostId}`)
    await expect(hostEntityPage.getByTestId('entity-page-id')).toHaveText(hostId)
  }
)

test(
  'CA3 (0032): la franja de problemas sale sobre el gráfico de CPU con los problemas del grupo, y pulsar un tramo abre el problema',
  { tag: '@proceso' },
  async () => {
    await openProcessGroupPage()
    await pgChartSeries('cpu')
    const band = pgBand()
    await expect(band).toBeVisible()
    await expect(band.getByTestId('process-group-problem-segment')).toHaveCount(2)
    for (const { problemId } of [PROCESS_GROUP_BAND_OPEN, PROCESS_GROUP_BAND_CLOSED]) {
      await expect(pgSegment(problemId), problemId).toHaveCount(1)
    }
    // Solo en el panel de la CPU.
    await expect(page.getByTestId('process-group-problem-band')).toHaveCount(1)

    // La lista se pide con el grupo y el rango global.
    await settledRequests()
    const lists = sim.entityProblemListQueries.filter((query) =>
      (query.get('problemSelector') ?? '').includes(PROCESS_GROUP_PAGE_ID)
    )
    expect(lists).toHaveLength(1)
    expect(lists[0]?.get('problemSelector')).toBe(`affectedEntities("${PROCESS_GROUP_PAGE_ID}")`)
    expect(lists[0]?.get('from')).toBe('now-2h')

    // Encima del gráfico: la franja acaba antes de que empiece el canvas.
    const bandBox = await settledBox(band)
    const plotBox = await settledBox(pgChartPlot('cpu'))
    expect(bandBox.y + bandBox.height).toBeLessThanOrEqual(plotBox.y + 1)

    // Pulsar un tramo abre ese problema; «Volver» regresa al grupo.
    await clickInPlace(pgSegment(PROCESS_GROUP_BAND_CLOSED.problemId), { scroll: true })
    await expect(page.getByTestId('problem-page')).toBeVisible()
    await expect(page.getByTestId('problem-page-title')).toContainText(
      PROCESS_GROUP_BAND_CLOSED.displayId
    )
    expect(await currentRoute()).toBe(`/problems/${PROCESS_GROUP_BAND_CLOSED.problemId}`)
    await page.getByTestId('problem-back').click()
    await expect(pgPage()).toBeVisible()
    expect(await currentRoute()).toBe(`/entities/PROCESS_GROUP/${PROCESS_GROUP_PAGE_ID}`)
  }
)

/**
 * Ficha 0032, CA4 (unitario): en `src/main/ipc/handlers/entity-detail.test.ts`. Este e2e es el
 * CA5: la tarjeta, la última, y nada de la línea de comandos en la página.
 */
test(
  'CA5 (0032): la tarjeta «Información» del process group sale la última, con sus filas y relaciones, y sin la línea de comandos ni la ruta completa en ningún sitio de la página',
  { tag: '@proceso' },
  async () => {
    const entityPage = await openProcessGroupPage()
    const card = pgInfoCard()
    await expect(card).toBeVisible()
    await expect(card).toContainText('Información')
    await expect(card.getByTestId('process-group-info-row').first()).toBeVisible()
    for (const id of ['process-group-markers', 'process-group-charts', 'process-group-instances']) {
      await expect(entityPage.getByTestId(id), id).toBeVisible()
    }

    // La última sección: nada visible detrás; gráficos e instancias, encima.
    expect(await visibleNeighbours(PG_PAGE_TEST_ID, 'process-group-info', 'after')).toEqual([])
    const infoBox = await settledBox(card)
    for (const id of ['process-group-markers', 'process-group-charts', 'process-group-instances']) {
      const box = await settledBox(entityPage.getByTestId(id))
      expect(box.y + box.height, `${id} encima de «Información»`).toBeLessThanOrEqual(infoBox.y + 1)
    }

    // Filas con las claves vistas en vivo: tecnologías, puertos y nombre detectado.
    await expect(pgInfoRow('technologies').getByTestId('process-group-info-chip')).toHaveText([
      'JAVA OpenJDK 21.0.1',
      'APACHE_TOMCAT 10.1'
    ])
    await expect(pgInfoValue('listenPorts')).toContainText(loneNumber('9090'))
    await expect(pgInfoValue('listenPorts')).toContainText(loneNumber('9443'))
    await expect(pgInfoValue('detectedName')).toContainText('pagos-grupo-detectado-e2e')
    for (const text of ['undefined', 'null', 'NaN', '[object Object]']) {
      await expect(card, text).not.toContainText(text)
    }

    // Relaciones: Instancias, Hosts, Servicios y Otras.
    const relations = card.getByTestId('process-group-info-relations')
    const groups = relations.getByTestId('process-group-info-group')
    await expect(groups).toHaveCount(4)
    expect(await dataKeys(groups, 'data-group')).toEqual([
      'instances',
      'hosts',
      'services',
      'other'
    ])
    for (const [key, title, count] of [
      ['instances', 'Instancias', '7'],
      ['hosts', 'Hosts', '3'],
      ['services', 'Servicios', '2'],
      ['other', 'Otras', '1']
    ] as const) {
      await expect(pgInfoGroup(key), key).toContainText(title)
      await expect(pgInfoGroup(key).getByTestId('process-group-info-group-count'), key).toHaveText(
        new RegExp(`^\\s*${count}\\s*$`)
      )
    }

    // «Ver nombres» de los hosts: una llamada con sus tres ids y los nombres en su sitio.
    const hosts = await expandPgInfoGroup('hosts')
    await settledRequests()
    const namesBefore = sim.entityNamesQueries.length
    await clickInPlace(hosts.getByTestId('process-group-info-names'), { scroll: true })
    await expect.poll(() => sim.entityNamesQueries.length).toBe(namesBefore + 1)
    const selector = sim.entityNamesQueries[namesBefore]?.get('entitySelector') ?? ''
    for (const host of PROCESS_GROUP_PAGE_HOSTS) {
      expect(selector).toContain(host.hostId)
      await expect(
        pgInfoEntity('hosts', host.hostId).getByTestId('process-group-info-entity-name')
      ).toHaveText(host.hostName)
    }

    // Enlaces: una instancia a su página de proceso y un servicio a la suya.
    await expandPgInfoGroup('instances')
    const instance = PROCESS_GROUP_PAGE_INSTANCES[0]?.id ?? ''
    await expect(pgInfoEntity('instances', instance)).toHaveAttribute(
      'href',
      new RegExp(`#/entities/PROCESS_GROUP_INSTANCE/${instance}$`)
    )
    await expandPgInfoGroup('services')
    await expect(pgInfoEntity('services', INFO_FEW_ID)).toHaveAttribute(
      'href',
      new RegExp(`#/entities/SERVICE/${INFO_FEW_ID}$`)
    )
    const other = await expandPgInfoGroup('other')
    await expect(other).toContainText('isNetworkClientOfProcessGroup')

    // «Todas las propiedades», desplegada: metadata sin la línea de comandos ni la ruta.
    await clickInPlace(card.getByTestId('process-group-info-properties-toggle'), { scroll: true })
    await expect(
      card.locator('[data-testid="process-group-info-property"][data-key="metadata"]')
    ).toContainText('pagos-grupo-e2e')

    // Con todo desplegado: ni la línea de comandos ni la ruta completa en ningún sitio.
    await expectNoProcessGroupSecrets('todo desplegado')
  }
)

test(
  'CA6 (0032): cambiar el rango global vuelve a pedir los datos; «Actualizar» también; volver a la página sin cambios, no',
  { tag: '@proceso' },
  async () => {
    await openProcessGroupPage()
    await expectPgMarkers()
    await expectPgChartSeries()
    await settledRequests()
    // Al entrar: las consultas del grupo y los recuentos de problemas, con el rango global.
    const groupQueries = sim.processGroupMetricQueries.length
    const instanceQueries = sim.processMetricQueries.length
    expect(groupQueries).toBeGreaterThanOrEqual(2)
    expect(sim.entityProblemQueries).toHaveLength(2)
    for (const query of [
      ...sim.processGroupMetricQueries,
      ...sim.processMetricQueries,
      ...sim.entityProblemQueries
    ]) {
      expect(query.get('from')).toBe('now-2h')
    }

    // Rango nuevo: otra vez, con now-24h.
    await page.getByTestId('time-range-24h').click()
    await expect.poll(() => sim.processGroupMetricQueries.length).toBe(groupQueries * 2)
    await expect.poll(() => sim.processMetricQueries.length).toBe(instanceQueries * 2)
    await expect.poll(() => sim.entityProblemQueries.length).toBe(4)
    for (const query of [
      ...sim.processGroupMetricQueries.slice(groupQueries),
      ...sim.processMetricQueries.slice(instanceQueries),
      ...sim.entityProblemQueries.slice(2)
    ]) {
      expect(query.get('from')).toBe('now-24h')
    }
    await expectPgMarkers()

    // Fuera y vuelta, sin cambiar nada: ninguna petición nueva.
    await goTo('metrics')
    await expect(pgPage()).toHaveCount(0)
    const before = await settledRequests()
    await openProcessGroupPage()
    await expectPgMarkers()
    await page.waitForTimeout(1500)
    expect(sim.requests.slice(before), 'peticiones al volver a la página').toEqual([])

    // «Actualizar», en la cabecera de la página: otra vez, con el rango actual.
    await pgPage().getByTestId('module-refresh').click()
    await expect.poll(() => sim.processGroupMetricQueries.length).toBe(groupQueries * 3)
    await expect.poll(() => sim.entityProblemQueries.length).toBe(6)
    for (const query of [
      ...sim.processGroupMetricQueries.slice(groupQueries * 2),
      ...sim.entityProblemQueries.slice(4)
    ]) {
      expect(query.get('from')).toBe('now-24h')
    }
    await expectPgMarkers()
  }
)

test(
  'CA6 (0032): si falla el canal de métricas, sus marcadores, cada gráfico y la tabla enseñan el aviso con Reintentar y el marcador de problemas sigue',
  { tag: '@proceso' },
  async () => {
    sim.processGroupMetricsFail = true
    await openProcessGroupPage()

    // El de problemas, con sus recuentos y sin aviso.
    await expect(pgMarker('problems').getByTestId('process-group-marker-open')).toHaveText(
      loneNumber('1')
    )
    await expect(pgMarker('problems').getByRole('button', { name: 'Reintentar' })).toHaveCount(0)

    // Cada marcador de métricas, en su sitio, con el aviso y Reintentar y sin valor.
    for (const id of PG_METRIC_MARKERS) {
      const marker = pgMarker(id)
      await expect(marker, id).toBeVisible()
      await expect(marker.getByRole('alert').first(), id).toBeVisible()
      await expect(marker.getByRole('button', { name: 'Reintentar' }), id).toBeVisible()
      await expect(marker.getByTestId('process-group-marker-value'), id).toHaveCount(0)
    }
    // Cada gráfico, con su aviso y Reintentar, sin gráfico.
    for (const kind of PG_CHART_KINDS) {
      const panel = pgChartPanel(kind)
      await expect(panel, kind).toBeVisible()
      await expect(panel.getByRole('alert').first(), kind).toBeVisible()
      await expect(panel.getByRole('button', { name: 'Reintentar' }), kind).toBeVisible()
      await expect(panel.getByTestId(`process-group-chart-${kind}`), kind).toHaveCount(0)
    }
    // La tabla de instancias, también, sin filas.
    await expect(pgInstances().getByRole('alert').first()).toBeVisible()
    await expect(pgInstances().getByRole('button', { name: 'Reintentar' })).toBeVisible()
    await expect(pgInstances().getByTestId('process-group-instance-row')).toHaveCount(0)

    // Reintentar, con el canal ya bien: llegan valores, los cuatro gráficos y la tabla.
    sim.processGroupMetricsFail = false
    await clickInPlace(pgMarker('cpu').getByRole('button', { name: 'Reintentar' }), {
      scroll: true
    })
    await expectPgMarkers()
    await expect(pgPage().getByTestId('process-group-chart-panel')).toHaveCount(4)
    await expectPgChartSeries()
    await expect(pgInstances().getByTestId('process-group-instance-row')).toHaveCount(7)
    for (const id of PG_METRIC_MARKERS) {
      await expect(pgMarker(id).getByRole('button', { name: 'Reintentar' }), id).toHaveCount(0)
    }
  }
)

// ---------------------------------------------------------------------------
// Ficha 0051: las 20 de más CPU en la tabla «Instancias», el aviso «20 de N» y el modal
// «Ver todas» con la lista completa (canal entities:processGroupInstances, a demanda).
// ---------------------------------------------------------------------------

/**
 * Grupos inventados de la 0050 (PROCESS_GROUP_MANY_ID, 30 instancias; PROCESS_GROUP_CUT_ID, 25
 * que llegan recortadas de 600) y el de 12 de esta ficha (PROCESS_GROUP_FEW_ID).
 *
 * Nombres que fijan estos tests (la ficha no los da; decisión del developer en una ficha ligera,
 * delegada por Dani y refinable):
 * - Debajo de la tabla, el aviso `process-group-instances-more` (role="status") y el botón
 *   `process-group-instances-all` («Ver todas»).
 * - El modal: `process-group-instances-dialog` (el role="dialog" de Radix, con `data-state`),
 *   su fondo `process-group-instances-dialog-overlay`, el buscador
 *   `process-group-instances-dialog-search`, el aviso de recorte
 *   `process-group-instances-dialog-truncated` y la tabla `process-group-instances-dialog-grid`
 *   con las mismas filas (`process-group-instance-row` con `data-instance-id`) y columnas.
 * - La consulta del modal se reconoce en el simulador por la expresión de CPU con
 *   `:sort(value(avg,descending))` y sin `:limit` (la de la 0050).
 */
const pgDialog = (): Locator => page.getByTestId('process-group-instances-dialog')
const pgViewAll = (): Locator => pgInstances().getByTestId('process-group-instances-all')
const pgMore = (): Locator => pgInstances().getByTestId('process-group-instances-more')
const pgDialogRows = (): Locator => pgDialog().getByTestId('process-group-instance-row')
const pgDialogOrder = (): Promise<string[]> =>
  tableOrder(pgDialog(), 'process-group-instance-row', 'data-instance-id')

/** Ficha 0051: las consultas de la lista completa (entities:processGroupInstances). */
const pgFullListQueries = (): URLSearchParams[] =>
  sim.processGroupMetricQueries.filter((query) => {
    const selector = query.get('metricSelector') ?? ''
    return (
      query.get('resolution') === 'Inf' &&
      selector.includes(':sort(value(avg,descending))') &&
      !selector.includes(':limit(')
    )
  })

/** Ficha 0051: abre por URL la página de un process group inventado y espera sus filas. */
async function openPgGroup(groupId: string): Promise<void> {
  await goToRoute(`/entities/PROCESS_GROUP/${groupId}`)
  await expect(pgPage()).toBeVisible()
  await expect(pgInstances().getByTestId('process-group-instance-row').first()).toBeVisible()
}

/** Ficha 0051: pulsa «Ver todas» y espera el modal abierto con sus filas. */
async function openPgDialog(): Promise<Locator> {
  await clickInPlace(pgViewAll(), { scroll: true })
  const dialog = pgDialog()
  await expect(dialog).toBeVisible()
  await expect(dialog).toHaveAttribute('role', 'dialog')
  await expect(dialog).toHaveAttribute('data-state', 'open')
  await expect(pgDialogRows().first()).toBeVisible()
  return dialog
}

/** Ficha 0051: animación de entrada de un elemento (nombre, duración, curva y fotogramas). */
async function entranceMotion(target: Locator): Promise<{
  name: string
  duration: number
  timing: string
  keyframes: string
}> {
  return target.evaluate((el) => {
    const style = getComputedStyle(el)
    const name = style.animationName
    const names = name.split(',').map((n) => n.trim())
    const seconds = (value: string): number =>
      Math.max(
        0,
        ...value.split(',').map((part) => {
          const v = part.trim()
          return v.endsWith('ms') ? parseFloat(v) / 1000 : parseFloat(v)
        })
      )
    const texts: string[] = []
    const visit = (rules: CSSRuleList): void => {
      for (const rule of Array.from(rules)) {
        if (rule instanceof CSSKeyframesRule) {
          if (names.includes(rule.name)) texts.push(rule.cssText)
        } else if ('cssRules' in rule) {
          visit((rule as CSSGroupingRule).cssRules)
        }
      }
    }
    for (const sheet of Array.from(document.styleSheets)) visit(sheet.cssRules)
    return {
      name,
      duration: seconds(style.animationDuration),
      timing: style.animationTimingFunction,
      keyframes: texts.join('\n')
    }
  })
}

test(
  'CA1 (0051): con 30 instancias la tabla enseña las 20 de más CPU y el aviso «20 de 30» con «Ver todas»; con 12, ni aviso ni botón; sin el total real, «puede haber más»',
  { tag: '@proceso' },
  async () => {
    await openPgGroup(PROCESS_GROUP_MANY_ID)
    const card = pgInstances()
    await expect(card.getByTestId('process-group-instance-row')).toHaveCount(20)
    expect(await pgInstanceOrder()).toEqual(
      byCpu(PROCESS_GROUP_MANY_INSTANCES)
        .slice(0, 20)
        .map((instance) => instance.id)
    )
    await expect(pgMore()).toBeVisible()
    await expect(pgMore()).toHaveAttribute('role', 'status')
    await expect(pgMore()).toContainText(/(^|[^\d.,])20 de 30([^\d.,]|$)/)
    await expect(pgMore()).toContainText(/más CPU/)
    await expect(pgViewAll()).toBeVisible()
    await expect(pgViewAll()).toHaveText(/^\s*Ver todas\s*$/)
    // El total real, exacto en el marcador (de /entities), sin «como mínimo».
    await expect(pgMarker('instances').getByTestId('process-group-marker-value')).toHaveText(
      /^\s*30\s*$/
    )

    // Con 12 instancias: las 12, ni aviso ni botón.
    await openPgGroup(PROCESS_GROUP_FEW_ID)
    await expect(pgInstances().getByTestId('process-group-instance-row')).toHaveCount(12)
    await expect(pgMore()).toHaveCount(0)
    await expect(pgViewAll()).toHaveCount(0)

    // Sin el total real (403 en /entities): «20 instancias…; puede haber más» y el botón.
    await resetState()
    sim.processGroupEntitiesFail = true
    await openPgGroup(PROCESS_GROUP_MANY_ID)
    await expect(pgInstances().getByTestId('process-group-instance-row')).toHaveCount(20)
    await expect(pgMore()).toContainText(/(^|[^\d.,])20 instancias/)
    await expect(pgMore()).toContainText(/puede haber más/)
    await expect(pgMore()).not.toContainText(/ de 30/)
    await expect(pgViewAll()).toBeVisible()
  }
)

test(
  'CA2 (0051): «Ver todas» abre el modal con las 30 y pide entities:processGroupInstances una sola vez, no antes de pulsar ni al volver a abrirlo',
  { tag: '@proceso' },
  async () => {
    await openPgGroup(PROCESS_GROUP_MANY_ID)
    await settledRequests()
    // La página no pide la lista completa.
    expect(pgFullListQueries()).toHaveLength(0)

    const dialog = await openPgDialog()
    await expect(dialog.getByRole('heading')).toContainText(
      `Instancias de ${PROCESS_GROUP_MANY_ID}`
    )
    await expect(pgDialogRows()).toHaveCount(30)
    expect(await pgDialogOrder()).toEqual(
      byCpu(PROCESS_GROUP_MANY_INSTANCES).map((instance) => instance.id)
    )
    // Mismas columnas que la tabla de la página.
    expect(await gridColumns(dialog.getByTestId('process-group-instances-dialog-grid'))).toEqual(
      PG_INSTANCE_COLUMNS.map((c) => `col-${c}`)
    )
    // Sin recorte, sin aviso.
    await expect(dialog.getByTestId('process-group-instances-dialog-truncated')).toHaveCount(0)
    await settledRequests()
    expect(pgFullListQueries()).toHaveLength(1)
    expect(pgFullListQueries()[0]?.get('entitySelector')).toBe(
      processGroupSelector(PROCESS_GROUP_MANY_ID)
    )
    expect(pgFullListQueries()[0]?.get('from')).toBe('now-2h')

    // Cerrar y volver a abrir: de la caché, sin pedir otra vez.
    await page.keyboard.press('Escape')
    await expect(pgDialog()).toHaveCount(0)
    await openPgDialog()
    await expect(pgDialogRows()).toHaveCount(30)
    await settledRequests()
    expect(pgFullListQueries()).toHaveLength(1)
  }
)

test(
  'CA3 (0051): con un grupo recortado, el modal avisa arriba del recorte con los números (25 de 600) y el marcador da el total real',
  { tag: '@proceso' },
  async () => {
    await openPgGroup(PROCESS_GROUP_CUT_ID)
    // Con el total real de /entities, el marcador es exacto aunque llegue `partial`.
    await expect(pgMarker('instances').getByTestId('process-group-marker-value')).toHaveText(
      /^\s*600\s*$/
    )
    await expect(pgMore()).toContainText(/(^|[^\d.,])20 de 600([^\d.,]|$)/)

    const dialog = await openPgDialog()
    await expect(pgDialogRows()).toHaveCount(25)
    const notice = dialog.getByTestId('process-group-instances-dialog-truncated')
    await expect(notice).toBeVisible()
    await expect(notice).toContainText(/(^|[^\d.,])25 de 600([^\d.,]|$)/)
    await expect(notice).toContainText(loneNumber('498'))
    // Arriba: antes que la tabla.
    const noticeBox = await settledBox(notice)
    const gridBox = await settledBox(dialog.getByTestId('process-group-instances-dialog-grid'))
    expect(noticeBox.y + noticeBox.height).toBeLessThanOrEqual(gridBox.y + 1)
  }
)

test(
  'CA3 (0051), revisión ronda 1: con el grupo recortado y el total real, la tabla avisa de que la lista puede estar incompleta y el marcador da 600 exacto',
  { tag: '@proceso' },
  async () => {
    await openPgGroup(PROCESS_GROUP_CUT_ID)
    // El marcador, exacto: el total sale de /entities aunque llegue `partial`.
    const marker = pgMarker('instances')
    await expect(marker.getByTestId('process-group-marker-value')).toHaveText(/^\s*600\s*$/)
    await expect(marker).not.toContainText(/\+|mínimo|al menos/i)
    // La tabla sí avisa del recorte: la lista puede estar incompleta, el total no.
    const notice = pgInstances().getByTestId('process-group-instances-partial')
    await expect(notice).toBeVisible()
    await expect(notice).toContainText(/recort/i)
    await expect(notice).toContainText(/lista puede estar incompleta/)
    await expect(notice).not.toContainText(/total/i)
  }
)

test(
  'CA2 (0051), revisión ronda 1: con el modal cerrado, ni un rango nuevo ni «Actualizar» piden la lista completa; al volver a abrirlo, sí',
  { tag: '@proceso' },
  async () => {
    await openPgGroup(PROCESS_GROUP_MANY_ID)
    await openPgDialog()
    await settledRequests()
    expect(pgFullListQueries()).toHaveLength(1)
    await page.keyboard.press('Escape')
    await expect(pgDialog()).toHaveCount(0)

    // Rango nuevo con el modal cerrado: la página pide lo suyo, la lista completa no.
    const groupQueries = sim.processGroupMetricQueries.length
    await page.getByTestId('time-range-24h').click()
    await expect.poll(() => sim.processGroupMetricQueries.length).toBeGreaterThan(groupQueries)
    await settledRequests()
    expect(pgFullListQueries()).toHaveLength(1)
    // Al abrir, la del rango nuevo.
    await openPgDialog()
    await settledRequests()
    expect(pgFullListQueries()).toHaveLength(2)
    expect(pgFullListQueries()[1]?.get('from')).toBe('now-24h')
    await page.keyboard.press('Escape')
    await expect(pgDialog()).toHaveCount(0)

    // «Actualizar» con el modal cerrado: no la pide; al abrir, ya no vale la de antes.
    const beforeRefresh = sim.processGroupMetricQueries.length
    await clickInPlace(pgPage().getByTestId('module-refresh'), { scroll: true })
    await expect.poll(() => sim.processGroupMetricQueries.length).toBeGreaterThan(beforeRefresh)
    await settledRequests()
    expect(pgFullListQueries()).toHaveLength(2)
    await openPgDialog()
    await settledRequests()
    expect(pgFullListQueries()).toHaveLength(3)
  }
)

test(
  'Especificación (0051): si falla la lista completa, el modal enseña el aviso con Reintentar, y Reintentar la carga',
  { tag: '@proceso' },
  async () => {
    sim.processGroupInstancesFail = true
    await openPgGroup(PROCESS_GROUP_MANY_ID)
    await clickInPlace(pgViewAll(), { scroll: true })
    const dialog = pgDialog()
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('alert').first()).toBeVisible()
    const retry = dialog.getByRole('button', { name: 'Reintentar' })
    await expect(retry).toBeVisible()
    await expect(pgDialogRows()).toHaveCount(0)
    // La tabla de la página sigue con sus 20.
    await expect(pgInstances().getByTestId('process-group-instance-row')).toHaveCount(20)

    sim.processGroupInstancesFail = false
    await clickInPlace(retry)
    await expect(pgDialogRows()).toHaveCount(30)
    await expect(dialog.getByRole('button', { name: 'Reintentar' })).toHaveCount(0)
  }
)

test(
  'CA4 (0051): en el modal, el buscador filtra por nombre o host, el orden por columna funciona, Escape y clic fuera cierran con el foco en «Ver todas», y pulsar un proceso abre su página',
  { tag: '@proceso' },
  async () => {
    await openPgGroup(PROCESS_GROUP_MANY_ID)
    const dialog = await openPgDialog()
    const search = dialog.getByTestId('process-group-instances-dialog-search')

    // Por nombre.
    await search.fill('instancia-e2e7-25')
    await expect(pgDialogRows()).toHaveCount(1)
    expect(await pgDialogOrder()).toEqual([PROCESS_GROUP_MANY_INSTANCES[24]?.id])
    // Por host, sin distinguir mayúsculas.
    await search.fill('HOST-E2E7-7')
    await expect(pgDialogRows()).toHaveCount(1)
    expect(await pgDialogOrder()).toEqual([PROCESS_GROUP_MANY_INSTANCES[6]?.id])
    // Sin coincidencias, ninguna fila; vacío, las 30.
    await search.fill('no-existe-ninguna')
    await expect(pgDialogRows()).toHaveCount(0)
    await search.fill('')
    await expect(pgDialogRows()).toHaveCount(30)

    // Orden por nombre (ascendente, con los números en su orden) y por memoria.
    await clickInPlace(dialog.getByTestId('sort-name'))
    await expect
      .poll(async () => (await pgDialogOrder()).slice(0, 3))
      .toEqual(PROCESS_GROUP_MANY_INSTANCES.slice(0, 3).map((instance) => instance.id))
    await clickInPlace(dialog.getByTestId('sort-memory'))
    await expect
      .poll(async () => (await pgDialogOrder())[0])
      .toBe(PROCESS_GROUP_MANY_INSTANCES[29]?.id)

    // Escape cierra y el foco vuelve a «Ver todas».
    await page.keyboard.press('Escape')
    await expect(pgDialog()).toHaveCount(0)
    await expect(pgViewAll()).toBeFocused()

    // Clic fuera (en el fondo) también cierra.
    await openPgDialog()
    await expect(page.getByTestId('process-group-instances-dialog-overlay')).toBeVisible()
    const box = await settledBox(pgDialog())
    await page.mouse.click(Math.max(2, box.x / 2), box.y + box.height / 2)
    await expect(pgDialog()).toHaveCount(0)

    // Pulsar un proceso cierra el modal y abre su página; «Volver» regresa al grupo.
    await openPgDialog()
    const target = byCpu(PROCESS_GROUP_MANY_INSTANCES)[25]
    const id = target?.id ?? ''
    const row = pgDialog().locator(
      `[data-testid="process-group-instance-row"][data-instance-id="${id}"]`
    )
    const link = row.getByRole('link', { name: target?.name ?? '' })
    await expect(link).toHaveAttribute(
      'href',
      new RegExp(`#/entities/PROCESS_GROUP_INSTANCE/${id}$`)
    )
    await clickInPlace(link, { scroll: true })
    const processEntityPage = page.getByTestId('entity-page-process_group_instance')
    await expect(processEntityPage).toBeVisible()
    await expect(pgDialog()).toHaveCount(0)
    expect(await currentRoute()).toBe(`/entities/PROCESS_GROUP_INSTANCE/${id}`)
    await clickInPlace(processEntityPage.getByTestId('entity-back'), { scroll: true })
    await expect(pgPage()).toBeVisible()
    expect(await currentRoute()).toBe(`/entities/PROCESS_GROUP/${PROCESS_GROUP_MANY_ID}`)
    await expect(pgDialog()).toHaveCount(0)

    // El host de una instancia, desde el modal, abre la página del host.
    await openPgDialog()
    const hostLink = pgDialog()
      .locator(`[data-testid="process-group-instance-row"][data-instance-id="${id}"]`)
      .getByRole('link', { name: target?.hostName ?? '' })
    await expect(hostLink).toHaveAttribute(
      'href',
      new RegExp(`#/entities/HOST/${target?.hostId ?? ''}$`)
    )
    await clickInPlace(hostLink, { scroll: true })
    await expect(page.getByTestId('entity-page-host')).toBeVisible()
    await expect(pgDialog()).toHaveCount(0)
    expect(await currentRoute()).toBe(`/entities/HOST/${target?.hostId ?? ''}`)
  }
)

test(
  'CA5 (0051): el panel del modal entra con escala, desplazamiento y opacidad con rebote (unos 300 ms) y el fondo se desenfoca; con movimiento reducido, solo un fundido corto',
  { tag: '@proceso' },
  async () => {
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    try {
      await openPgGroup(PROCESS_GROUP_MANY_ID)
      await openPgDialog()
      const panel = await entranceMotion(pgDialog())
      expect(panel.name, 'animación de entrada').not.toBe('none')
      expect(panel.duration).toBeGreaterThanOrEqual(0.2)
      expect(panel.duration).toBeLessThanOrEqual(0.5)
      expect(panel.keyframes).toMatch(/scale/)
      expect(panel.keyframes).toMatch(/translate/)
      expect(panel.keyframes).toMatch(/opacity/)
      // Curva con rebote: un cubic-bezier con un punto de control por encima de 1.
      const bezier = /cubic-bezier\(([^)]+)\)/.exec(panel.timing)
      expect(bezier, panel.timing).not.toBeNull()
      const [, y1, , y2] = (bezier?.[1] ?? '').split(',').map((v) => Number(v.trim()))
      expect(Math.max(y1 ?? 0, y2 ?? 0)).toBeGreaterThan(1)
      // El fondo se oscurece con desenfoque.
      const overlay = page.getByTestId('process-group-instances-dialog-overlay')
      expect(await overlay.evaluate((el) => getComputedStyle(el).backdropFilter)).toMatch(/blur/)
      expect((await entranceMotion(overlay)).name).not.toBe('none')
      await page.keyboard.press('Escape')
      await expect(pgDialog()).toHaveCount(0)

      // Con «reducir el movimiento»: solo un fundido corto, sin escala ni desplazamiento.
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await openPgDialog()
      const reduced = await entranceMotion(pgDialog())
      expect(reduced.name, 'fundido').not.toBe('none')
      expect(reduced.keyframes).toMatch(/opacity/)
      expect(reduced.keyframes).not.toMatch(/scale|translate/)
      expect(reduced.duration).toBeGreaterThan(0.01)
      expect(reduced.duration).toBeLessThanOrEqual(0.2)
    } finally {
      await page.emulateMedia({ reducedMotion: null })
    }
  }
)
