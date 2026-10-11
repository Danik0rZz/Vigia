import { expect, type Locator, test } from '@playwright/test'
import { hoverFresh, moveToNeutral } from './hover'
import {
  BREAKDOWN_HOST_ID,
  BREAKDOWN_PROCESSES,
  DISK_PAGE_FILESYSTEM,
  DISK_PAGE_ID,
  DISK_PAGE_NAME,
  diskOfExpression,
  expectHostQueriesWithinLimit,
  HOST_BAND_CLOSED,
  HOST_BAND_CLOSED_2,
  HOST_BAND_OPEN,
  HOST_EVENTS_DISK_NAME,
  HOST_EVENTS_EXCLUDED,
  HOST_EVENTS_HOST,
  HOST_EVENTS_HTML_TITLE,
  HOST_EVENTS_IDS,
  HOST_INFO_DISK,
  HOST_INFO_EC2,
  HOST_INFO_FULL_ID,
  HOST_INFO_FULL_PROPERTY_COUNT,
  HOST_INFO_GROUP,
  HOST_INFO_IPS,
  HOST_INFO_OTHER,
  HOST_INFO_PEER,
  HOST_INFO_PG,
  HOST_INFO_PGIS,
  HOST_INFO_SERVICE_2,
  HOST_LOGS_FRAGMENTS,
  HOST_LOGS_IDS,
  HOST_LOGS_PAGE,
  HOST_LOGS_SELECTOR,
  HOST_MAX_EXPRESSIONS,
  HOST_METRICS_ID,
  HOST_PAGE_PROCESSES,
  HOST_TIMESTAMPS,
  hostEventsSelectorIds,
  hostEventTitle,
  hostMetricCalls,
  INFO_FEW_ID,
  splitSelector,
  TOKEN_NO_ENTITIES,
  TOKEN_NO_EVENTS
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
  settledBox,
  setupViewsApp
} from './views/harness'
import { sim } from './views/sim-state'
import es from '../src/renderer/src/locales/es/common.json'
import {
  settledRequests,
  loneNumber,
  dataKeys,
  openHostPage,
  hostDisks,
  hostProcesses,
  processRow,
  tableOrder,
  gridColumns,
  HOST_PAGE_TOP,
  expectHostTablesLoaded,
  HOST_INFO_SECTIONS,
  hostInfoCard,
  openHostInfo,
  processInfoCard,
  processInfoProperty,
  failChartMountOnce,
  dropPanelFailureErrors
} from './views/helpers'

/**
 * Specs de vistas por zona (ficha 0070): las páginas del host y del disco (`@host`). Arnés en
 * `e2e/views/` (ver su cabecera).
 */

setupViewsApp()

test(
  'CA7 (0016): entities:hostMetrics por IPC con un id inventado: consultas, series y totales',
  { tag: '@host' },
  async () => {
    const data = await invoke<Record<string, unknown>>('entities:hostMetrics', {
      environmentId: env['Producción'],
      entityId: HOST_METRICS_ID,
      timeRange: '2h'
    })
    // Series (una o más consultas, ficha 0039) y marcadores con Inf (una), todas con el rango
    // global y ninguna con más de 10 expresiones.
    expect(hostMetricCalls()).toBe(1)
    expect(sim.hostMetricQueries.length).toBeGreaterThanOrEqual(2)
    expectHostQueriesWithinLimit()
    for (const query of sim.hostMetricQueries) expect(query.get('from')).toBe('now-2h')
    expect(
      [...new Set(sim.hostMetricQueries.map((q) => q.get('resolution') ?? 'API'))].sort()
    ).toEqual(['API', 'Inf'])

    const series = (values: (number | null)[]): { timestamps: number[]; values: unknown[] } => ({
      timestamps: HOST_TIMESTAMPS,
      values
    })
    expect(data).toMatchObject({
      resolution: '1m',
      series: {
        cpu: series([12, null, 48]),
        cpuBreakdown: {
          user: series([8, null, 30]),
          system: series([3, null, 15]),
          iowait: series([1, null, 3])
        },
        memory: series([50, null, 62.5]),
        // Todas las interfaces sumadas (bits/s) y el disco más lleno en cada punto (%).
        network: { in: series([2000, null, 5000]), out: series([400, null, 900]) },
        disk: series([81, null, 91])
      },
      totals: {
        cpu: { avg: 33.5, max: 95 },
        // Usada y total del último punto con dato, en bytes.
        memory: { avg: 57, used: 10_000_000_000, total: 16_000_000_000 },
        network: { in: 3600, out: 650 },
        disk: { max: 92 },
        load: { avg: 2.25 }
      },
      warnings: [],
      partial: []
    })
  }
)

test(
  'CA6 (0017): entities:hostBreakdown por IPC con un id inventado: discos por uso y los 10 procesos con más CPU',
  { tag: '@host' },
  async () => {
    const data = await invoke<{
      disks: Record<string, unknown>[]
      processes: { items: Record<string, unknown>[]; total: number }
    }>('entities:hostBreakdown', {
      environmentId: env['Producción'],
      entityId: BREAKDOWN_HOST_ID,
      timeRange: '2h'
    })
    // Las consultas llegan al simulador, todas con el rango global.
    expect(sim.hostBreakdownQueries.length).toBeGreaterThan(0)
    for (const query of sim.hostBreakdownQueries) expect(query.get('from')).toBe('now-2h')

    // Discos del más lleno al menos, con su nombre de dimensionMap.
    expect(data.disks).toMatchObject([
      {
        id: 'DISK-00000000000E2E02',
        name: '/datos',
        usedPct: { last: 88, max: 90 },
        used: 880_000_000_000,
        avail: 120_000_000_000,
        read: 8000,
        write: 2000
      },
      {
        id: 'DISK-00000000000E2E01',
        name: '/',
        usedPct: { last: 40, max: 44 },
        used: 40_000_000_000,
        avail: 60_000_000_000,
        read: 300,
        write: 400
      }
    ])

    // Los 10 con más CPU media de los 12, de más a menos; el 5 (sin nombre) con su id.
    const top = BREAKDOWN_PROCESSES.slice()
      .sort((a, b) => b.cpu.avg - a.cpu.avg)
      .slice(0, 10)
    expect(top.map((p) => p.cpu.avg)).toEqual([55, 30, 26, 18, 14, 11, 9, 7, 4, 3])
    expect(data.processes.items).toMatchObject(
      top.map((p) => ({
        id: p.id,
        name: p.name ?? p.id,
        cpu: { avg: p.cpu.avg, max: p.cpu.max },
        memory: p.memory.avg
      }))
    )
    expect(data.processes.total).toBe(12)
  }
)

/**
 * Ficha 0018: marcadores y gráficos de la página de un HOST, con los datos de HOST_METRICS_ID
 * (canal entities:hostMetrics de la 0016) y sus problemas (hostBandProblems: uno abierto y dos
 * cerrados).
 *
 * Nombres que fijan estos tests: la fila `host-markers`; cada marcador `host-marker-<id>` (cpu,
 * memory, network, disk y problems); dentro, el valor principal en `host-marker-value` (con
 * `data-level`: `normal`, `warning` o `error`, umbrales del 80 y el 90 %) y lo de debajo en
 * `host-marker-secondary` (máxima, usada / total y salida); el texto del nivel, cuando no es
 * `normal`, en `host-marker-level`; los recuentos, en `host-marker-open` y `host-marker-closed`.
 * La sección `host-charts`; cada gráfico en un `host-chart-panel` con `data-kind` (cpu, memory,
 * network y disk, en ese orden) y su título en un encabezado; dentro, el `Chart` con testid
 * `host-chart-<kind>` (con `data-series`). La franja, `host-problem-band`, dentro del panel de la
 * CPU; cada tramo, `host-problem-segment` con `data-problem-id`.
 */
const HOST_MARKER_IDS = ['cpu', 'memory', 'network', 'disk'] as const
const HOST_CHART_KINDS = ['cpu', 'memory', 'network', 'disk'] as const
type HostChartKind = (typeof HOST_CHART_KINDS)[number]
const HOST_CHART_TITLES: Record<HostChartKind, string> = {
  cpu: 'CPU',
  memory: 'Memoria',
  network: 'Red',
  disk: 'Disco'
}
/** Las series de cada gráfico, en su orden: CPU con el total y su desglose, y red con las dos. */
const HOST_CHART_SERIES: Record<HostChartKind, RegExp[]> = {
  cpu: [/total/i, /user/i, /system/i, /iowait/i],
  // Ficha 0039: usada y recuperable apiladas, y la total.
  memory: [/usad/i, /recuperable/i, /total/i],
  network: [/entrada/i, /salida/i],
  disk: [/./]
}

const hostMarker = (id: string): Locator => page.getByTestId(`host-marker-${id}`)
const hostChartPanel = (kind: HostChartKind): Locator =>
  page.locator(`[data-testid="host-chart-panel"][data-kind="${kind}"]`)
const hostChartPlot = (kind: HostChartKind): Locator =>
  hostChartPanel(kind).getByTestId(`host-chart-${kind}`)
const hostBand = (): Locator => hostChartPanel('cpu').getByTestId('host-problem-band')
const hostSegment = (problemId: string): Locator =>
  hostBand().locator(`[data-testid="host-problem-segment"][data-problem-id="${problemId}"]`)

/** Ficha 0018: espera a que el gráfico tenga sus series (se monta vacío mientras carga). */
async function hostChartSeries(kind: HostChartKind): Promise<string[]> {
  const plot = hostChartPlot(kind)
  await expect(plot.locator('canvas').first()).toBeVisible()
  await expect(plot).toHaveAttribute('data-series', /\[.+\]/)
  return JSON.parse((await plot.getAttribute('data-series')) ?? '[]') as string[]
}

/** Ficha 0018: los valores de los marcadores de HOST_METRICS_ID, ya formateados (es). */
async function expectHostMarkerValues(): Promise<void> {
  // CPU: media 33,5 % y máxima 95 %.
  const cpu = hostMarker('cpu')
  await expect(cpu.getByTestId('host-marker-value')).toHaveText(/^33,5\s?%$/)
  await expect(cpu.getByTestId('host-marker-secondary')).toContainText(/(^|[^\d.,])95(,0)?\s?%/)
  // Memoria: media 57 % y usada / total del último punto (10 y 16 GB).
  const memory = hostMarker('memory')
  await expect(memory.getByTestId('host-marker-value')).toHaveText(/^57(,0)?\s?%$/)
  await expect(memory.getByTestId('host-marker-secondary')).toContainText(/(^|[^\d.,])10,0\sGB/)
  await expect(memory.getByTestId('host-marker-secondary')).toContainText(/(^|[^\d.,])16,0\sGB/)
  // Red: entrada media 3600 bit/s y salida media 650 bit/s, con su unidad adaptada.
  const network = hostMarker('network')
  await expect(network.getByTestId('host-marker-value')).toHaveText(/^3,6\skbit\/s$/)
  await expect(network.getByTestId('host-marker-secondary')).toContainText(/(^|[^\d.,])650\sbit\/s/)
  // Disco: el más lleno, 92 %.
  await expect(hostMarker('disk').getByTestId('host-marker-value')).toHaveText(/^92(,0)?\s?%$/)
  // Problemas: 1 abierto y 2 cerrados.
  const problems = hostMarker('problems')
  await expect(problems.getByTestId('host-marker-open')).toHaveText(loneNumber('1'))
  await expect(problems.getByTestId('host-marker-closed')).toHaveText(loneNumber('2'))
}

test(
  'CA1 (0018): la página de un HOST enseña los cinco marcadores con los valores del simulador formateados, sin «Página en construcción»',
  { tag: '@host' },
  async () => {
    const hostPage = await openHostPage()
    const row = hostPage.getByTestId('host-markers')
    await expect(row).toBeVisible()

    // Los cinco, con su nombre.
    const labels = [
      ['cpu', 'CPU'],
      ['memory', 'Memoria'],
      ['network', 'Red'],
      ['disk', 'Disco'],
      ['problems', 'Problemas']
    ] as const
    for (const [id, label] of labels) {
      await expect(row.getByTestId(`host-marker-${id}`), id).toBeVisible()
      await expect(row.getByTestId(`host-marker-${id}`), id).toContainText(label)
    }
    await expectHostMarkerValues()

    // Niveles (CA5): CPU (33,5 %) y memoria (57 %), normales y sin texto de nivel; el disco
    // (92 %), de error y con su texto además del color.
    for (const id of ['cpu', 'memory'] as const) {
      await expect(hostMarker(id).getByTestId('host-marker-value'), id).toHaveAttribute(
        'data-level',
        'normal'
      )
      await expect(hostMarker(id).getByTestId('host-marker-level'), id).toHaveCount(0)
    }
    const disk = hostMarker('disk')
    await expect(disk.getByTestId('host-marker-value')).toHaveAttribute('data-level', 'error')
    await expect(disk.getByTestId('host-marker-level')).toBeVisible()
    await expect(disk.getByTestId('host-marker-level')).toHaveText(/\S/)

    // Ni el bloque ni el texto de «Página en construcción», ni los marcadores del servicio.
    await expect(hostPage.getByTestId('entity-under-construction')).toHaveCount(0)
    await expect(hostPage).not.toContainText('Página en construcción')
    await expect(page.getByTestId('service-markers')).toHaveCount(0)
  }
)

test(
  'CA2 (0018): salen los cuatro gráficos en su orden (CPU, memoria, red y disco), con su título y sus series',
  { tag: '@host' },
  async () => {
    const hostPage = await openHostPage()
    const section = hostPage.getByTestId('host-charts')
    await expect(section).toBeVisible()

    const panels = section.getByTestId('host-chart-panel')
    await expect(panels).toHaveCount(4)
    for (const [index, kind] of HOST_CHART_KINDS.entries()) {
      const panel = panels.nth(index)
      await expect(panel, `posición ${index + 1}`).toHaveAttribute('data-kind', kind)
      await expect(panel.getByRole('heading').first(), kind).toContainText(HOST_CHART_TITLES[kind])
      const series = await hostChartSeries(kind)
      expect(series, kind).toHaveLength(HOST_CHART_SERIES[kind].length)
      for (const [i, pattern] of HOST_CHART_SERIES[kind].entries()) {
        expect(series[i], `${kind}[${i}]`).toMatch(pattern)
      }
    }

    // Marcadores y gráficos comparten una sola llamada al canal (una consulta de marcadores).
    await settledRequests()
    expect(hostMetricCalls()).toBe(1)
    expectHostQueriesWithinLimit()
  }
)

test(
  'CA3 (0018): la franja de problemas sale sobre el gráfico de CPU con los problemas del host, y pulsar un tramo abre el problema',
  { tag: '@host' },
  async () => {
    await openHostPage()
    await hostChartSeries('cpu')
    const band = hostBand()
    await expect(band).toBeVisible()
    await expect(band.getByTestId('host-problem-segment')).toHaveCount(3)
    for (const { problemId } of [HOST_BAND_OPEN, HOST_BAND_CLOSED, HOST_BAND_CLOSED_2]) {
      await expect(hostSegment(problemId), problemId).toHaveCount(1)
    }
    // Solo en el panel de la CPU.
    await expect(page.getByTestId('host-problem-band')).toHaveCount(1)

    // La lista se pide con el host y el rango global.
    await settledRequests()
    const lists = sim.entityProblemListQueries.filter((query) =>
      (query.get('problemSelector') ?? '').includes(HOST_METRICS_ID)
    )
    expect(lists).toHaveLength(1)
    expect(lists[0]?.get('problemSelector')).toBe(`affectedEntities("${HOST_METRICS_ID}")`)
    expect(lists[0]?.get('from')).toBe('now-2h')

    // Encima del gráfico: la franja acaba antes de que empiece el canvas.
    const bandBox = await settledBox(band)
    const plotBox = await settledBox(hostChartPlot('cpu'))
    expect(bandBox.y + bandBox.height).toBeLessThanOrEqual(plotBox.y + 1)

    // Pulsar un tramo (trayéndolo a la vista) abre ese problema.
    await clickInPlace(hostSegment(HOST_BAND_CLOSED.problemId), { scroll: true })
    await expect(page.getByTestId('problem-page')).toBeVisible()
    await expect(page.getByTestId('problem-page-title')).toContainText(HOST_BAND_CLOSED.displayId)
    expect(await currentRoute()).toBe(`/problems/${HOST_BAND_CLOSED.problemId}`)

    // «Volver» regresa a la página del host.
    await page.getByTestId('problem-back').click()
    await expect(page.getByTestId('entity-page-host')).toBeVisible()
    expect(await currentRoute()).toBe(`/entities/HOST/${HOST_METRICS_ID}`)
  }
)

test(
  'CA6 (0018): cambiar el rango global vuelve a pedir los datos; «Actualizar» también; volver a la página sin cambios, no',
  { tag: '@host' },
  async () => {
    await openHostPage()
    await expectHostMarkerValues()
    await settledRequests()
    // Al entrar: una llamada al canal de métricas (sus consultas, que pueden ser más de dos desde
    // la 0039) y las dos de recuentos, con el rango global.
    expect(hostMetricCalls()).toBe(1)
    const perCall = sim.hostMetricQueries.length
    expect(perCall).toBeGreaterThanOrEqual(2)
    expect(sim.entityProblemQueries).toHaveLength(2)
    for (const query of [...sim.hostMetricQueries, ...sim.entityProblemQueries]) {
      expect(query.get('from')).toBe('now-2h')
    }

    // Rango nuevo: otra vez, con now-24h.
    await page.getByTestId('time-range-24h').click()
    await expect.poll(() => sim.hostMetricQueries.length).toBe(2 * perCall)
    await expect.poll(() => sim.entityProblemQueries.length).toBe(4)
    for (const query of [
      ...sim.hostMetricQueries.slice(perCall),
      ...sim.entityProblemQueries.slice(2)
    ]) {
      expect(query.get('from')).toBe('now-24h')
    }
    await expectHostMarkerValues()
    await settledRequests()
    expect(sim.hostMetricQueries).toHaveLength(2 * perCall)

    // Fuera y vuelta, sin cambiar nada: ninguna petición nueva.
    await goTo('metrics')
    await expect(page.getByTestId('entity-page-host')).toHaveCount(0)
    const before = await settledRequests()
    await openHostPage()
    await expectHostMarkerValues()
    await page.waitForTimeout(1500)
    expect(sim.requests.slice(before), 'peticiones al volver a la página').toEqual([])

    // «Actualizar», en la cabecera de la página: otra vez, con el rango actual.
    await page.getByTestId('entity-page-host').getByTestId('module-refresh').click()
    await expect.poll(() => sim.hostMetricQueries.length).toBe(3 * perCall)
    await expect.poll(() => sim.entityProblemQueries.length).toBe(6)
    for (const query of [
      ...sim.hostMetricQueries.slice(2 * perCall),
      ...sim.entityProblemQueries.slice(4)
    ]) {
      expect(query.get('from')).toBe('now-24h')
    }
    await expectHostMarkerValues()
  }
)

test(
  'CA7 (0018): si falla el canal de métricas, marcadores y gráficos enseñan el aviso con Reintentar y el marcador de problemas sigue',
  { tag: '@host' },
  async () => {
    sim.hostMetricsFail = true
    await openHostPage()

    // El de problemas, con sus recuentos y sin aviso.
    const problems = hostMarker('problems')
    await expect(problems.getByTestId('host-marker-open')).toHaveText(loneNumber('1'))
    await expect(problems.getByTestId('host-marker-closed')).toHaveText(loneNumber('2'))
    await expect(problems.getByRole('button', { name: 'Reintentar' })).toHaveCount(0)

    // Cada marcador de métricas, en su sitio, con el aviso y Reintentar y sin valor.
    for (const id of HOST_MARKER_IDS) {
      const marker = hostMarker(id)
      await expect(marker, id).toBeVisible()
      await expect(marker.getByRole('button', { name: 'Reintentar' }), id).toBeVisible()
      await expect(marker.getByTestId('host-marker-value'), id).toHaveCount(0)
    }
    // Cada gráfico, en su sitio, con su aviso (role=alert) y Reintentar, sin gráfico.
    for (const kind of HOST_CHART_KINDS) {
      const panel = hostChartPanel(kind)
      await expect(panel, kind).toBeVisible()
      await expect(panel.getByRole('alert').first(), kind).toBeVisible()
      await expect(panel.getByRole('button', { name: 'Reintentar' }), kind).toBeVisible()
      await expect(panel.getByTestId(`host-chart-${kind}`), kind).toHaveCount(0)
    }

    // Reintentar, con el canal ya bien: llegan valores y gráficos.
    sim.hostMetricsFail = false
    await clickInPlace(hostMarker('cpu').getByRole('button', { name: 'Reintentar' }), {
      scroll: true
    })
    await expectHostMarkerValues()
    for (const kind of HOST_CHART_KINDS) {
      expect(await hostChartSeries(kind), kind).toHaveLength(HOST_CHART_SERIES[kind].length)
    }
    for (const id of HOST_MARKER_IDS) {
      await expect(hostMarker(id).getByRole('button', { name: 'Reintentar' }), id).toHaveCount(0)
    }
  }
)

/**
 * Ficha 0039: memoria total y recuperable en el marcador y el gráfico «Memoria» del HOST, con los
 * datos de HOST_METRICS_ID (usada 10 GB, total 16 GB y recuperable 2,5 GB en el último punto).
 *
 * Nombres que fijan estos tests (decisión delegada, refinable): dentro de `host-marker-memory`,
 * la recuperable en `host-marker-reclaimable` (la palabra y su valor) y, junto a la palabra, el
 * icono de ayuda `host-marker-reclaimable-help` (enfocable); su tooltip,
 * `host-marker-reclaimable-tooltip`.
 */
const reclaimableHelp = (): Locator =>
  hostMarker('memory').getByTestId('host-marker-reclaimable-help')
const reclaimableTooltip = (): Locator => page.getByTestId('host-marker-reclaimable-tooltip')

test(
  'CA3 (0039): el marcador de memoria enseña usada / total y recuperable, y el gráfico tiene usada, recuperable y total',
  { tag: '@host' },
  async () => {
    await openHostPage()
    const memory = hostMarker('memory')
    // El valor principal sigue siendo el % usado.
    await expect(memory.getByTestId('host-marker-value')).toHaveText(/^57(,0)?\s?%$/)
    // Debajo, usada / total (10 y 16 GB) y la recuperable (2,5 GB, del último punto con dato).
    const secondary = memory.getByTestId('host-marker-secondary')
    await expect(secondary).toContainText(/(^|[^\d.,])10,0\sGB/)
    await expect(secondary).toContainText(/(^|[^\d.,])16,0\sGB/)
    const reclaimable = memory.getByTestId('host-marker-reclaimable')
    await expect(reclaimable).toBeVisible()
    await expect(reclaimable).toContainText(/recuperable/i)
    await expect(reclaimable).toContainText(/(^|[^\d.,])2,5\sGB/)

    // El gráfico: tres series, usada, recuperable y total (cada una, una vez).
    const series = await hostChartSeries('memory')
    expect(series).toHaveLength(3)
    for (const pattern of [/usad/i, /recuperable/i, /total/i]) {
      expect(
        series.filter((name) => pattern.test(name)),
        String(pattern)
      ).toHaveLength(1)
    }

    // La recuperable llega en la misma llamada al canal, sin pasar de 10 expresiones por consulta.
    await settledRequests()
    expect(hostMetricCalls()).toBe(1)
    expectHostQueriesWithinLimit()
    expect(
      sim.hostMetricQueries.some((query) =>
        (query.get('metricSelector') ?? '').includes('builtin:host.mem.recl')
      )
    ).toBe(true)
  }
)

test(
  'CA4 (0039): el tooltip de ayuda de «recuperable» sale con el ratón y con el foco',
  { tag: '@host' },
  async () => {
    await openHostPage()
    const help = reclaimableHelp()
    await expect(help).toBeVisible()
    await expect(reclaimableTooltip()).toHaveCount(0)

    // Con el ratón: lo que el sistema puede liberar si hace falta (como cachés).
    await hoverFresh(page, help)
    await expect(reclaimableTooltip()).toBeVisible()
    await expect(reclaimableTooltip()).toContainText(/liberar/i)
    await moveToNeutral(page)
    await page.keyboard.press('Escape')
    await expect(reclaimableTooltip()).toHaveCount(0)

    // Con el foco, ya a la vista (Radix cierra el tooltip si su contenedor se desplaza).
    await help.evaluate((element) => element.scrollIntoView({ block: 'center' }))
    await settledBox(help)
    await help.focus()
    await expect(help).toBeFocused()
    await expect(reclaimableTooltip()).toBeVisible()
    await expect(reclaimableTooltip()).toContainText(/liberar/i)
    await page.keyboard.press('Escape')
    await expect(reclaimableTooltip()).toHaveCount(0)
  }
)

/**
 * Ficha 0019: tablas de discos y de los procesos que más consumen en la página de un HOST, con los
 * datos de HOST_METRICS_ID (HOST_PAGE_DISKS y HOST_PAGE_PROCESSES, canal entities:hostBreakdown).
 *
 * Nombres que fijan estos tests: las tarjetas `host-disks` y `host-processes`, debajo de
 * `host-charts`; dentro, el `DataGrid` con `gridTestId` `host-disks-grid` y `host-processes-grid`
 * y filas `host-disk-row` (con `data-disk-id`) y `host-process-row` (con `data-process-id`).
 * Columnas, en este orden: discos `name`, `usage`, `used` (usado / total), `free`, `read` y
 * `write`; procesos `name`, `cpu` (media, con su barra `host-process-cpu-bar`), `cpuMax` y
 * `memory`. La barra de uso del disco, `host-disk-usage` con `data-level`. El nombre del proceso
 * es un enlace a su página. Debajo de los procesos, `host-processes-count` («10 de N procesos»)
 * y, si la métrica de procesos llega recortada (`partial`), `host-processes-partial`.
 */
const DISK_COLUMNS = ['name', 'usage', 'used', 'free', 'read', 'write'] as const
const PROCESS_COLUMNS = ['name', 'cpu', 'cpuMax', 'memory'] as const
const diskRow = (id: string): Locator =>
  hostDisks().locator(`[data-testid="host-disk-row"][data-disk-id="${id}"]`)
const diskOrder = (): Promise<string[]> => tableOrder(hostDisks(), 'host-disk-row', 'data-disk-id')
const processOrder = (): Promise<string[]> =>
  tableOrder(hostProcesses(), 'host-process-row', 'data-process-id')

test(
  'CA1 (0019): con 3 discos, la tabla los enseña del más lleno al menos, con su %, usado/total, libre, lectura y escritura formateados',
  { tag: '@host' },
  async () => {
    await openHostPage()
    const card = hostDisks()
    await expect(card).toBeVisible()
    const grid = card.getByTestId('host-disks-grid')
    await expect(grid).toHaveAttribute('role', 'grid')
    await expect(card.getByTestId('host-disk-row')).toHaveCount(3)
    expect(await gridColumns(grid)).toEqual(DISK_COLUMNS.map((c) => `col-${c}`))
    await expect(grid.getByTestId('col-usage')).toHaveAttribute('aria-sort', 'descending')

    // Del más lleno (último dato) al menos; el simulador los da en otro orden.
    expect(await diskOrder()).toEqual([
      'DISK-00000000000E2E12',
      'DISK-00000000000E2E13',
      'DISK-00000000000E2E11'
    ])

    const levels = es.entities.host.markers.levels
    const expected = [
      {
        id: 'DISK-00000000000E2E12',
        name: '/datos',
        pct: /(^|[^\d,.])91\s?%/,
        level: 'error',
        used: /(^|[^\d,.])455,0\sGB.*(^|[^\d,.])500,0\sGB/,
        free: /^45,0\sGB$/,
        read: /^2,5\sMB\/s$/,
        write: /^12,0\skB\/s$/
      },
      {
        id: 'DISK-00000000000E2E13',
        name: '/var',
        pct: /(^|[^\d,.])85\s?%/,
        level: 'warning',
        used: /(^|[^\d,.])170,0\sGB.*(^|[^\d,.])200,0\sGB/,
        free: /^30,0\sGB$/,
        read: /^0\sB\/s$/,
        write: /^800\sB\/s$/
      },
      {
        id: 'DISK-00000000000E2E11',
        name: '/',
        pct: /(^|[^\d,.])40\s?%/,
        level: 'normal',
        used: /(^|[^\d,.])40,0\sGB.*(^|[^\d,.])100,0\sGB/,
        free: /^60,0\sGB$/,
        read: /^300\sB\/s$/,
        write: /^1,5\skB\/s$/
      }
    ] as const
    for (const disk of expected) {
      const cells = diskRow(disk.id).getByRole('gridcell')
      await expect(cells, disk.name).toHaveCount(DISK_COLUMNS.length)
      await expect(cells.nth(0), disk.name).toHaveText(disk.name)
      // Barra de uso con su % y su nivel (color en data-level y, si no es normal, texto).
      const usage = cells.nth(1)
      await expect(usage, disk.name).toContainText(disk.pct)
      await expect(usage.getByTestId('host-disk-usage'), disk.name).toHaveAttribute(
        'data-level',
        disk.level
      )
      if (disk.level === 'normal') {
        await expect(usage, disk.name).not.toContainText(levels.warning)
        await expect(usage, disk.name).not.toContainText(levels.error)
      } else {
        await expect(usage, disk.name).toContainText(levels[disk.level])
      }
      await expect(cells.nth(2), disk.name).toContainText(disk.used)
      await expect(cells.nth(3), disk.name).toHaveText(disk.free)
      await expect(cells.nth(4), disk.name).toHaveText(disk.read)
      await expect(cells.nth(5), disk.name).toHaveText(disk.write)
    }

    // Debajo de los gráficos.
    const charts = await settledBox(page.getByTestId('host-charts'))
    const disks = await settledBox(card)
    expect(disks.y).toBeGreaterThanOrEqual(charts.y + charts.height - 1)
    // Con el rango global.
    await settledRequests()
    expect(sim.hostBreakdownQueries.length).toBeGreaterThan(0)
    for (const query of sim.hostBreakdownQueries) expect(query.get('from')).toBe('now-2h')
  }
)

test(
  'CA2 (0019): con 15 procesos, la tabla enseña los 10 con más CPU, ordenados, y «10 de 15 procesos»',
  { tag: '@host' },
  async () => {
    await openHostPage()
    const card = hostProcesses()
    await expect(card).toBeVisible()
    const grid = card.getByTestId('host-processes-grid')
    await expect(grid).toHaveAttribute('role', 'grid')
    await expect(card.getByTestId('host-process-row')).toHaveCount(10)
    expect(await gridColumns(grid)).toEqual(PROCESS_COLUMNS.map((c) => `col-${c}`))
    await expect(grid.getByTestId('col-cpu')).toHaveAttribute('aria-sort', 'descending')

    // Los 10 con más CPU media, de más a menos (los de 7, 5, 3, 2 y 1 % se quedan fuera).
    expect(HOST_PAGE_TOP.map((p) => p.cpu.avg)).toEqual([61, 47, 40, 35, 28, 24, 19, 15, 12, 9])
    expect(await processOrder()).toEqual(HOST_PAGE_TOP.map((p) => p.id))

    // Cada fila: nombre, CPU media con su barra, máxima y memoria media.
    for (const process of HOST_PAGE_TOP) {
      const cells = processRow(process.id).getByRole('gridcell')
      await expect(cells, process.name).toHaveCount(PROCESS_COLUMNS.length)
      await expect(cells.nth(0), process.name).toHaveText(process.name)
      await expect(cells.nth(1), process.name).toContainText(
        new RegExp(`(^|[^\\d,.])${process.cpu.avg}\\s?%`)
      )
      await expect(cells.nth(1).getByTestId('host-process-cpu-bar'), process.name).toHaveCount(1)
      await expect(cells.nth(2), process.name).toHaveText(new RegExp(`^${process.cpu.max}\\s?%$`))
    }
    // Memoria en su unidad: 300 MB y 750 MB.
    const first = HOST_PAGE_TOP[0]
    const second = HOST_PAGE_TOP[1]
    expect(first?.memory.avg).toBe(300_000_000)
    expect(second?.memory.avg).toBe(750_000_000)
    await expect(
      processRow(first?.id ?? '')
        .getByRole('gridcell')
        .nth(3)
    ).toHaveText(/^300,0\sMB$/)
    await expect(
      processRow(second?.id ?? '')
        .getByRole('gridcell')
        .nth(3)
    ).toHaveText(/^750,0\sMB$/)

    await expect(card.getByTestId('host-processes-count')).toHaveText(/^10 de 15 procesos$/)
    // Sin recorte, sin aviso.
    await expect(card.getByTestId('host-processes-partial')).toHaveCount(0)

    // Debajo de los gráficos, como los discos.
    const charts = await settledBox(page.getByTestId('host-charts'))
    const processes = await settledBox(card)
    expect(processes.y).toBeGreaterThanOrEqual(charts.y + charts.height - 1)
  }
)

test(
  'CA3 (0019): pulsar un proceso abre su página de entidad con su nombre, y «Volver» regresa al host sin volver a pedir sus datos',
  { tag: '@host' },
  async () => {
    await openHostPage()
    await expectHostTablesLoaded()
    const target = HOST_PAGE_TOP[4]
    const id = target?.id ?? ''
    const name = target?.name ?? ''
    const link = processRow(id).getByRole('link', { name })
    await expect(link).toHaveAttribute(
      'href',
      new RegExp(`#/entities/PROCESS_GROUP_INSTANCE/${id}$`)
    )

    await settledRequests()
    const breakdownBefore = sim.hostBreakdownQueries.length
    const metricsBefore = sim.hostMetricQueries.length
    await clickInPlace(link, { scroll: true })
    const processPage = page.getByTestId('entity-page-process_group_instance')
    await expect(processPage).toBeVisible()
    expect(await currentRoute()).toBe(`/entities/PROCESS_GROUP_INSTANCE/${id}`)
    await expect(processPage.getByRole('heading', { level: 1 })).toHaveText(name)
    await expect(processPage.getByTestId('entity-page-id')).toHaveText(id)

    const before = await settledRequests()
    await clickInPlace(processPage.getByTestId('entity-back'), { scroll: true })
    await expect(page.getByTestId('entity-page-host')).toBeVisible()
    expect(await currentRoute()).toBe(`/entities/HOST/${HOST_METRICS_ID}`)
    await expectHostTablesLoaded()
    await expectHostMarkerValues()
    await page.waitForTimeout(1500)
    expect(sim.requests.slice(before), 'peticiones al volver al host').toEqual([])
    expect(sim.hostBreakdownQueries).toHaveLength(breakdownBefore)
    expect(sim.hostMetricQueries).toHaveLength(metricsBefore)
  }
)

test(
  'CA4 (0019): ordenar por otra columna (libre en discos, memoria en procesos) reordena las filas',
  { tag: '@host' },
  async () => {
    await openHostPage()
    await expectHostTablesLoaded()

    // Discos por libre: /var 30 GB, /datos 45 GB y / 60 GB.
    const disksGrid = hostDisks().getByTestId('host-disks-grid')
    const byFree = ['DISK-00000000000E2E13', 'DISK-00000000000E2E12', 'DISK-00000000000E2E11']
    await clickInPlace(disksGrid.getByTestId('sort-free'), { scroll: true })
    const freeCol = disksGrid.getByTestId('col-free')
    await expect(freeCol).toHaveAttribute('aria-sort', /^(ascending|descending)$/)
    await expect(disksGrid.getByTestId('col-usage')).toHaveAttribute('aria-sort', 'none')
    const freeAsc = (await freeCol.getAttribute('aria-sort')) === 'ascending'
    expect(await diskOrder()).toEqual(freeAsc ? byFree : byFree.slice().reverse())
    // La misma columna otra vez: al revés.
    await clickInPlace(disksGrid.getByTestId('sort-free'), { scroll: true })
    await expect(freeCol).toHaveAttribute('aria-sort', freeAsc ? 'descending' : 'ascending')
    expect(await diskOrder()).toEqual(freeAsc ? byFree.slice().reverse() : byFree)

    // Procesos por memoria media (los mismos 10, en otro orden que por CPU).
    const processesGrid = hostProcesses().getByTestId('host-processes-grid')
    const byMemory = HOST_PAGE_TOP.slice()
      .sort((a, b) => a.memory.avg - b.memory.avg)
      .map((p) => p.id)
    expect(byMemory).not.toEqual(HOST_PAGE_TOP.map((p) => p.id))
    expect(byMemory.slice().reverse()).not.toEqual(HOST_PAGE_TOP.map((p) => p.id))
    await clickInPlace(processesGrid.getByTestId('sort-memory'), { scroll: true })
    const memoryCol = processesGrid.getByTestId('col-memory')
    await expect(memoryCol).toHaveAttribute('aria-sort', /^(ascending|descending)$/)
    await expect(processesGrid.getByTestId('col-cpu')).toHaveAttribute('aria-sort', 'none')
    const memoryAsc = (await memoryCol.getAttribute('aria-sort')) === 'ascending'
    expect(await processOrder()).toEqual(memoryAsc ? byMemory : byMemory.slice().reverse())
    await clickInPlace(processesGrid.getByTestId('sort-memory'), { scroll: true })
    await expect(memoryCol).toHaveAttribute('aria-sort', memoryAsc ? 'descending' : 'ascending')
    expect(await processOrder()).toEqual(memoryAsc ? byMemory.slice().reverse() : byMemory)
    // Ordenar no cambia qué procesos salen ni el total.
    await expect(hostProcesses().getByTestId('host-process-row')).toHaveCount(10)
    await expect(hostProcesses().getByTestId('host-processes-count')).toHaveText(
      /^10 de 15 procesos$/
    )
  }
)

test(
  'CA6 (0019): si falla el canal, las dos tarjetas enseñan el aviso con Reintentar y los gráficos siguen',
  { tag: '@host' },
  async () => {
    sim.hostBreakdownFail = true
    await openHostPage()

    for (const card of [hostDisks(), hostProcesses()]) {
      await expect(card).toBeVisible()
      await expect(card.getByRole('alert').first()).toBeVisible()
      await expect(card.getByRole('button', { name: 'Reintentar' })).toBeVisible()
    }
    await expect(hostDisks().getByTestId('host-disk-row')).toHaveCount(0)
    await expect(hostProcesses().getByTestId('host-process-row')).toHaveCount(0)

    // Marcadores y gráficos, con sus datos y sin aviso.
    await expectHostMarkerValues()
    for (const kind of HOST_CHART_KINDS) {
      expect(await hostChartSeries(kind), kind).toHaveLength(HOST_CHART_SERIES[kind].length)
      await expect(
        hostChartPanel(kind).getByRole('button', { name: 'Reintentar' }),
        kind
      ).toHaveCount(0)
    }

    // Reintentar, con el canal ya bien: llegan las dos tablas (un mismo canal).
    sim.hostBreakdownFail = false
    await clickInPlace(hostDisks().getByRole('button', { name: 'Reintentar' }), { scroll: true })
    await expectHostTablesLoaded()
    for (const card of [hostDisks(), hostProcesses()]) {
      await expect(card.getByRole('button', { name: 'Reintentar' })).toHaveCount(0)
    }
  }
)

test('CA6 (0019): sin datos, «Sin discos» y «Sin procesos»', { tag: '@host' }, async () => {
  sim.hostBreakdownEmpty = true
  await openHostPage()
  await expect(hostDisks()).toContainText('Sin discos')
  await expect(hostProcesses()).toContainText('Sin procesos')
  await expect(hostDisks().getByTestId('host-disk-row')).toHaveCount(0)
  await expect(hostProcesses().getByTestId('host-process-row')).toHaveCount(0)
  for (const card of [hostDisks(), hostProcesses()]) {
    await expect(card.getByRole('alert')).toHaveCount(0)
    await expect(card.getByRole('button', { name: 'Reintentar' })).toHaveCount(0)
  }
  // Los gráficos siguen.
  expect(await hostChartSeries('cpu')).toHaveLength(HOST_CHART_SERIES.cpu.length)
})

test(
  'Aviso de recorte de procesos (0019): con la métrica de procesos en partial, la tabla avisa de que la lista y el total pueden estar incompletos',
  { tag: '@host' },
  async () => {
    // Recortada solo una de discos: la de procesos no avisa.
    sim.hostBreakdownTruncated = 'disks'
    await openHostPage()
    await expectHostTablesLoaded()
    await settledRequests()
    await expect(hostProcesses().getByTestId('host-processes-partial')).toHaveCount(0)

    // Con la de procesos recortada, tras «Actualizar»: el aviso, sin quitar las filas ni el total.
    sim.hostBreakdownTruncated = 'processes'
    const before = sim.hostBreakdownQueries.length
    await page.getByTestId('entity-page-host').getByTestId('module-refresh').click()
    await expect.poll(() => sim.hostBreakdownQueries.length).toBeGreaterThan(before)
    const notice = hostProcesses().getByTestId('host-processes-partial')
    await expect(notice).toBeVisible()
    await expect(notice).toContainText(/incomplet/i)
    await expect(hostProcesses().getByTestId('host-process-row')).toHaveCount(10)
    await expect(hostProcesses().getByTestId('host-processes-count')).toHaveText(
      /^10 de 15 procesos$/
    )
  }
)
const hostInfoSection = (key: string): Locator =>
  hostInfoCard().locator(`[data-testid="host-info-section"][data-section="${key}"]`)
const hostInfoRow = (key: string): Locator =>
  hostInfoCard().locator(`[data-testid="host-info-row"][data-key="${key}"]`)
const hostInfoValue = (key: string): Locator => hostInfoRow(key).getByTestId('host-info-value')
const hostInfoGroup = (key: string): Locator =>
  hostInfoCard().locator(`[data-testid="host-info-group"][data-group="${key}"]`)
const hostInfoEntity = (group: string, id: string): Locator =>
  hostInfoGroup(group).locator(`[data-testid="host-info-entity"][data-entity-id="${id}"]`)

/** Ficha 0020: despliega un grupo de relaciones del host (si no lo está), trayéndolo a la vista. */
async function expandHostGroup(key: string): Promise<Locator> {
  const group = hostInfoGroup(key)
  const toggle = group.getByTestId('host-info-group-toggle')
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await clickInPlace(toggle, { scroll: true })
  }
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  return group
}

test(
  'CA2 (0020): la página de un HOST enseña la tarjeta «Información» con sus grupos (Sistema, Capacidad, Red…), memoria en GB, IPs con «+N» y lo demás solo en «Todas las propiedades»',
  { tag: '@host' },
  async () => {
    const card = await openHostInfo(HOST_INFO_FULL_ID)
    await expect(card).toContainText('Información')

    // Debajo de los marcadores: desde la ficha 0036, «Información» va al final de la página.
    const cardBox = await settledBox(card)
    const markersBox = await settledBox(page.getByTestId('host-markers'))
    expect(cardBox.y, 'la tarjeta va debajo de los marcadores').toBeGreaterThanOrEqual(
      markersBox.y + markersBox.height - 1
    )

    // Los grupos de filas, en su orden y con su nombre; las filas de cada uno, en el suyo.
    const sections = card.getByTestId('host-info-section')
    await expect(sections).toHaveCount(HOST_INFO_SECTIONS.length)
    expect(await dataKeys(sections, 'data-section')).toEqual(HOST_INFO_SECTIONS.map(([key]) => key))
    for (const [key, title, rows] of HOST_INFO_SECTIONS) {
      await expect(hostInfoSection(key).getByRole('heading').first(), key).toContainText(title)
      expect(await dataKeys(hostInfoSection(key).getByTestId('host-info-row')), key).toEqual(rows)
    }

    // Los valores.
    const texts: [string, string][] = [
      ['osType', 'LINUX'],
      ['osVersion', 'Ubuntu 24.04 e2e'],
      ['osArchitecture', 'X86'],
      ['bitness', '64'],
      ['cpuCores', '4'],
      ['logicalCpuCores', '8'],
      ['networkZone', 'zona-red-e2e'],
      ['monitoringMode', 'FULL_STACK'],
      ['state', 'RUNNING'],
      ['installerVersion', '1.300.12.20260901-e2e'],
      ['hostGroupName', 'grupo-hosts-e2e'],
      ['cloudType', 'EC2'],
      ['hypervisorType', 'KVM'],
      ['firstSeen', '2026'],
      ['lastSeen', '2026']
    ]
    for (const [key, text] of texts) {
      await expect(hostInfoValue(key), key).toContainText(text)
    }
    // Memoria: physicalMemory (16 GB), no memoryTotal (15,5 GB), en GB y sin bytes.
    await expect(hostInfoValue('memory')).toHaveText(/^16,0\sGB$/)

    // IPs: las 2 primeras y «+2», que enseña el resto.
    const ipChips = hostInfoRow('ipAddress').getByTestId('host-info-chip')
    await expect(ipChips).toHaveText(HOST_INFO_IPS.slice(0, 2))
    const more = hostInfoRow('ipAddress').getByTestId('host-info-more')
    await expect(more).toHaveText('+2')
    await clickInPlace(more, { scroll: true })
    await expect(ipChips).toHaveText(HOST_INFO_IPS)

    // Zonas, como chips; las etiquetas ya no salen en la tarjeta (ficha 0037).
    await expect(hostInfoRow('managementZones').getByTestId('host-info-chip')).toHaveText([
      'Zona host A',
      'Zona host B'
    ])
    await expect(hostInfoRow('tags')).toHaveCount(0)

    // Lo que la ficha no nombra, fuera de las filas; «Todas las propiedades» empieza plegada.
    const otherTexts = [
      ...Object.keys(HOST_INFO_OTHER),
      'nombre-detectado-host-e2e',
      'nombre-propio-host-e2e',
      '00-00-5E-00-53-01',
      'memoryTotal',
      'physicalMemory',
      '15,5',
      '16000000000'
    ]
    const allSections = card.locator('[data-testid="host-info-section"]')
    for (const text of otherTexts) {
      for (const [key] of HOST_INFO_SECTIONS) {
        await expect(hostInfoSection(key), `${key}: ${text}`).not.toContainText(text)
      }
    }
    await expect(allSections).toHaveCount(HOST_INFO_SECTIONS.length)
    await expect(card.getByTestId('host-info-property')).toHaveCount(0)
    const toggle = card.getByTestId('host-info-properties-toggle')
    await expect(toggle).toContainText('Todas las propiedades')
    await clickInPlace(toggle, { scroll: true })
    await expect(card.getByTestId('host-info-property')).toHaveCount(HOST_INFO_FULL_PROPERTY_COUNT)
    const property = (key: string): Locator =>
      card.locator(`[data-testid="host-info-property"][data-key="${key}"]`)
    await expect(property('detectedName')).toContainText('nombre-detectado-host-e2e')
    await expect(property('macAddresses')).toContainText('00-00-5E-00-53-01')
    await expect(property('memoryTotal')).toContainText('memoryTotal')

    // Sin la tarjeta del servicio en la página del host.
    await expect(page.getByTestId('service-info')).toHaveCount(0)
  }
)

test(
  'CA2 (0020): con un HOST con pocas claves solo salen los grupos y las filas con dato, sin «undefined»',
  { tag: '@host' },
  async () => {
    const card = await openHostInfo(HOST_METRICS_ID)
    // osType, memoryTotal (8 GB) y la última vez visto; osVersion, ipAddress y hostGroupName
    // vacíos, sin primera vez, sin zonas, sin etiquetas y sin nube: ninguna de esas filas.
    await expect(card.getByTestId('host-info-row')).toHaveCount(3)
    expect(await dataKeys(card.getByTestId('host-info-section'), 'data-section')).toEqual([
      'system',
      'capacity',
      'monitoring'
    ])
    expect(await dataKeys(card.getByTestId('host-info-row'))).toEqual([
      'osType',
      'memory',
      'lastSeen'
    ])
    await expect(hostInfoValue('osType')).toContainText('WINDOWS')
    await expect(hostInfoValue('memory')).toHaveText(/^8,0\sGB$/)
    await expect(hostInfoValue('lastSeen')).toHaveText(/\S/)
    // Sin relaciones, ningún grupo.
    await expect(card.getByTestId('host-info-group')).toHaveCount(0)
    await clickInPlace(card.getByTestId('host-info-properties-toggle'), { scroll: true })
    await expect(card.getByTestId('host-info-property').first()).toBeVisible()
    for (const text of ['undefined', 'null', 'NaN', '[object Object]']) {
      await expect(card, text).not.toContainText(text)
    }
    // El resto de la página sigue: marcadores con sus valores.
    await expectHostMarkerValues()
  }
)

test(
  'CA3 (0020): las relaciones salen en su orden con su número; «Ver nombres» los trae a demanda; pulsar un servicio abre su página y «Volver» regresa al host',
  { tag: '@host' },
  async () => {
    const card = await openHostInfo(HOST_INFO_FULL_ID)
    const relations = card.getByTestId('host-info-relations')
    await expect(relations).toContainText('Relaciones')

    const groups = relations.getByTestId('host-info-group')
    await expect(groups).toHaveCount(5)
    expect(await dataKeys(groups, 'data-group')).toEqual([
      'processes',
      'services',
      'runsOn',
      'hostGroup',
      'other'
    ])
    const expected = [
      ['processes', 'Procesos', '2'],
      ['services', 'Servicios', '2'],
      ['runsOn', 'Se ejecuta en', '1'],
      ['hostGroup', 'Grupo de hosts', '1'],
      ['other', 'Otras relaciones', '3']
    ] as const
    for (const [key, title, count] of expected) {
      await expect(hostInfoGroup(key), key).toContainText(title)
      await expect(hostInfoGroup(key).getByTestId('host-info-group-count'), key).toHaveText(
        new RegExp(`^\\s*${count}\\s*$`)
      )
    }
    // «Otras relaciones», plegada.
    await expect(hostInfoGroup('other').getByTestId('host-info-group-toggle')).toHaveAttribute(
      'aria-expanded',
      'false'
    )
    await expect(hostInfoGroup('other').getByTestId('host-info-entity')).toHaveCount(0)

    // Desplegados, con sus entidades en el orden de la respuesta; ningún nombre pedido aún.
    const processes = await expandHostGroup('processes')
    expect(await dataKeys(processes.getByTestId('host-info-entity'), 'data-entity-id')).toEqual(
      HOST_INFO_PGIS
    )
    const services = await expandHostGroup('services')
    expect(await dataKeys(services.getByTestId('host-info-entity'), 'data-entity-id')).toEqual([
      INFO_FEW_ID,
      HOST_INFO_SERVICE_2
    ])
    await expandHostGroup('runsOn')
    await expect(hostInfoEntity('runsOn', HOST_INFO_EC2)).toContainText(HOST_INFO_EC2)
    await expandHostGroup('hostGroup')
    await expect(hostInfoEntity('hostGroup', HOST_INFO_GROUP)).toContainText(HOST_INFO_GROUP)
    const other = await expandHostGroup('other')
    for (const name of ['runsOn', 'isDiskOf', 'isNetworkClientOfHost']) {
      await expect(other, name).toContainText(name)
    }
    expect(
      [...(await dataKeys(other.getByTestId('host-info-entity'), 'data-entity-id'))].sort()
    ).toEqual([HOST_INFO_DISK, HOST_INFO_PEER, HOST_INFO_PG].sort())
    await settledRequests()
    expect(sim.entityNamesQueries, 'nombres antes de «Ver nombres»').toHaveLength(0)

    // «Ver nombres» de «Servicios»: una llamada con sus dos ids y los nombres en su sitio.
    const button = services.getByTestId('host-info-names')
    await expect(button).toHaveText('Ver nombres')
    await clickInPlace(button, { scroll: true })
    await expect.poll(() => sim.entityNamesQueries.length).toBe(1)
    const selector = sim.entityNamesQueries[0]?.get('entitySelector') ?? ''
    expect(selector).toContain(INFO_FEW_ID)
    expect(selector).toContain(HOST_INFO_SERVICE_2)
    const service = hostInfoEntity('services', INFO_FEW_ID)
    await expect(service.getByTestId('host-info-entity-name')).toHaveText('info-pocas-e2e')
    await expect(
      hostInfoEntity('services', HOST_INFO_SERVICE_2).getByTestId('host-info-entity-name')
    ).toHaveText('servicio-host-e2e')
    // Los de otros grupos, sin pedir.
    await settledRequests()
    expect(sim.entityNamesQueries).toHaveLength(1)
    await expect(
      hostInfoEntity('processes', HOST_INFO_PGIS[0] ?? '').getByTestId('host-info-entity-name')
    ).toHaveCount(0)

    // Cada entidad es un enlace a su página; pulsar el servicio abre la del servicio.
    await expect(service).toHaveRole('link')
    await expect(service).toHaveAttribute('href', new RegExp(`#/entities/SERVICE/${INFO_FEW_ID}$`))
    await expect(hostInfoEntity('processes', HOST_INFO_PGIS[0] ?? '')).toHaveAttribute(
      'href',
      new RegExp(`#/entities/PROCESS_GROUP_INSTANCE/${HOST_INFO_PGIS[0]}$`)
    )
    const hostQueries = (): number =>
      sim.requests.filter((request) => request.includes(`/entities/${HOST_INFO_FULL_ID}`)).length
    const hostQueriesBefore = hostQueries()
    await clickInPlace(service, { scroll: true })
    const servicePage = page.getByTestId('entity-page-service')
    await expect(servicePage).toBeVisible()
    expect(await currentRoute()).toBe(`/entities/SERVICE/${INFO_FEW_ID}`)
    await expect(servicePage.getByTestId('entity-page-id')).toHaveText(INFO_FEW_ID)
    await expect(page.getByTestId('host-info')).toHaveCount(0)

    // «Volver» regresa al host, sin volver a pedir sus datos.
    await clickInPlace(servicePage.getByTestId('entity-back'), { scroll: true })
    await expect(page.getByTestId('entity-page-host')).toBeVisible()
    expect(await currentRoute()).toBe(`/entities/HOST/${HOST_INFO_FULL_ID}`)
    await expect(hostInfoValue('osType')).toContainText('LINUX')
    await settledRequests()
    expect(hostQueries(), 'entities:get del host al volver').toBe(hostQueriesBefore)
  }
)

test(
  'CA4 (0020): sin entities.read, la tarjeta del host dice qué scope falta y los marcadores y gráficos siguen',
  { tag: '@host' },
  async () => {
    const tenants = await invoke<{ clients: { id: string; name: string }[] }>('tenants:list')
    const clientId = tenants.clients.find((client) => client.name === 'Cliente A')?.id ?? ''
    const noEntities = await createEnvironment(
      clientId,
      'Sin entidades host',
      'other',
      TOKEN_NO_ENTITIES
    )
    try {
      await invoke('connection:test', { environmentId: noEntities })
      await invoke('environments:setActive', { environmentId: noEntities })
      await reloadUi()
      await goToRoute(`/entities/HOST/${HOST_METRICS_ID}`)
      await expect(page.getByTestId('entity-page-host')).toBeVisible()
      const unavailable = hostInfoCard().getByTestId('module-unavailable')
      await expect(unavailable).toBeVisible()
      await expect(unavailable).toContainText('entities.read')
      await expect(hostInfoCard().getByTestId('host-info-row')).toHaveCount(0)
      // Marcadores y gráficos, con sus datos.
      await expectHostMarkerValues()
      for (const kind of HOST_CHART_KINDS) {
        expect(await hostChartSeries(kind), kind).toHaveLength(HOST_CHART_SERIES[kind].length)
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

/**
 * Ficha 0040: página del disco (DISK), a la que se llega desde la tabla de discos del host (0019).
 * Datos del canal entities:diskMetrics del simulador (DISK_PAGE_SERIES y DISK_PAGE_MARKERS, de
 * /datos) y de su entidad (diskInfoBody).
 *
 * Nombres que fijan estos tests (decisión del test-writer, refinable; los del proceso con el
 * prefijo `disk`): la página `entity-page-disk`; la fila `disk-markers`; cada marcador
 * `disk-marker-<id>` (usage, free, read, write, latency o queue, y problems); dentro, el valor
 * principal en `disk-marker-value` (el de uso con `data-level`: `normal`, `warning` o `error`,
 * umbrales del 80 y el 90 %), lo de debajo en `disk-marker-secondary` y el texto del nivel, si no
 * es `normal`, en `disk-marker-level`; los recuentos, en `disk-marker-open` y
 * `disk-marker-closed`. La sección `disk-charts`; cada gráfico en un `disk-chart-panel` con
 * `data-kind` (usage, space, throughput y latency o queue, en ese orden) y su título en un
 * encabezado; dentro, el `Chart` con testid `disk-chart-<kind>` (con `data-series`). La tarjeta
 * `disk-info`, al final.
 *
 * Formato (como la tabla de discos del host, 0019): espacio en GB, lectura y escritura en bytes
 * por segundo (kB/s, MB/s) y latencia en ms. Con latencia y cola, sale Latencia (decisión del
 * test-writer, como Disponibilidad antes que Recursos en la 0028); sin latencia, Cola.
 */
type DiskChartKind = 'usage' | 'space' | 'throughput' | 'latency' | 'queue'
const DISK_PAGE_TEST_ID = 'entity-page-disk'
const DISK_MARKER_LABELS: Record<string, string> = {
  usage: 'Uso',
  free: 'Libre',
  read: 'Lectura',
  write: 'Escritura',
  latency: 'Latencia',
  queue: 'Cola',
  problems: 'Problemas'
}
const DISK_CHART_TITLES: Record<DiskChartKind, RegExp> = {
  usage: /^Uso/,
  space: /^Espacio/,
  throughput: /^Lectura y escritura/,
  latency: /^Latencia/,
  queue: /^Cola/
}
/** Las series de cada gráfico, en su orden. */
const DISK_CHART_SERIES: Record<DiskChartKind, RegExp[]> = {
  usage: [/./],
  space: [/usad/i, /libre/i],
  throughput: [/lectura/i, /escritura/i],
  latency: [/lectura/i, /escritura/i],
  queue: [/./]
}

const diskPage = (): Locator => page.getByTestId(DISK_PAGE_TEST_ID)
const diskMarker = (id: string): Locator => diskPage().getByTestId(`disk-marker-${id}`)
const diskChartPanel = (kind: DiskChartKind): Locator =>
  diskPage().locator(`[data-testid="disk-chart-panel"][data-kind="${kind}"]`)

/** Ficha 0040: abre por URL la página del disco /datos. */
async function openDiskPage(): Promise<Locator> {
  await goToRoute(`/entities/DISK/${DISK_PAGE_ID}`)
  await expect(diskPage()).toBeVisible()
  return diskPage()
}

/** Ficha 0040: comprueba las series de un gráfico del disco (se monta vacío mientras carga). */
async function expectDiskChartSeries(kind: DiskChartKind): Promise<void> {
  const plot = diskChartPanel(kind).getByTestId(`disk-chart-${kind}`)
  await expect(plot.locator('canvas').first(), kind).toBeVisible()
  await expect(plot, kind).toHaveAttribute('data-series', /\[.+\]/)
  const series = JSON.parse((await plot.getAttribute('data-series')) ?? '[]') as string[]
  expect(series, kind).toHaveLength(DISK_CHART_SERIES[kind].length)
  for (const [i, pattern] of DISK_CHART_SERIES[kind].entries()) {
    expect(series[i], `${kind}[${i}]`).toMatch(pattern)
  }
}

/** Ficha 0040: los `data-kind` de los paneles de gráficos, en el orden en que se pintan. */
async function diskChartKinds(): Promise<string[]> {
  return diskPage()
    .getByTestId('disk-charts')
    .getByTestId('disk-chart-panel')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-kind') ?? ''))
}

/** Ficha 0040: los marcadores comunes (uso, libre, lectura, escritura y problemas). */
async function expectDiskCommonMarkers(): Promise<void> {
  const levels = es.entities.host.markers.levels
  // Uso: % máximo del rango (92,5 %), en error (≥ 90 %) y con su texto.
  const usage = diskMarker('usage')
  await expect(usage.getByTestId('disk-marker-value')).toHaveText(/^92,5\s?%$/)
  await expect(usage.getByTestId('disk-marker-value')).toHaveAttribute('data-level', 'error')
  await expect(usage.getByTestId('disk-marker-level')).toContainText(levels.error)
  // Libre: último dato de avail (45 GB; el último punto llega a null).
  await expect(diskMarker('free').getByTestId('disk-marker-value')).toHaveText(/^45,0\sGB$/)
  // Lectura y escritura: medias del rango, en bytes por segundo.
  await expect(diskMarker('read').getByTestId('disk-marker-value')).toHaveText(/^2,5\sMB\/s$/)
  await expect(diskMarker('write').getByTestId('disk-marker-value')).toHaveText(/^12,0\skB\/s$/)
  // Problemas: el disco no tiene ninguno.
  const problems = diskMarker('problems')
  await expect(problems.getByTestId('disk-marker-open')).toHaveText(loneNumber('0'))
  await expect(problems.getByTestId('disk-marker-closed')).toHaveText(loneNumber('0'))
}

test(
  'CA4 (0040): pulsar un disco en la tabla del host abre su página con su nombre, y «Volver» regresa al host sin volver a pedir sus datos',
  { tag: '@host' },
  async () => {
    await openHostPage()
    await expectHostTablesLoaded()
    const link = diskRow(DISK_PAGE_ID).getByRole('link', { name: DISK_PAGE_NAME })
    await expect(link).toHaveAttribute('href', new RegExp(`#/entities/DISK/${DISK_PAGE_ID}$`))

    await settledRequests()
    const breakdownBefore = sim.hostBreakdownQueries.length
    const metricsBefore = sim.hostMetricQueries.length
    await clickInPlace(link, { scroll: true })
    await expect(diskPage()).toBeVisible()
    expect(await currentRoute()).toBe(`/entities/DISK/${DISK_PAGE_ID}`)
    await expect(diskPage().getByRole('heading', { level: 1 })).toHaveText(DISK_PAGE_NAME)
    await expect(diskPage().getByTestId('entity-page-id')).toHaveText(DISK_PAGE_ID)
    // Es la página del disco, no la genérica.
    await expect(diskPage().getByTestId('disk-markers')).toBeVisible()

    const before = await settledRequests()
    await clickInPlace(diskPage().getByTestId('entity-back'), { scroll: true })
    await expect(page.getByTestId('entity-page-host')).toBeVisible()
    expect(await currentRoute()).toBe(`/entities/HOST/${HOST_METRICS_ID}`)
    await expectHostTablesLoaded()
    await expectHostMarkerValues()
    await page.waitForTimeout(1500)
    expect(sim.requests.slice(before), 'peticiones al volver al host').toEqual([])
    expect(sim.hostBreakdownQueries).toHaveLength(breakdownBefore)
    expect(sim.hostMetricQueries).toHaveLength(metricsBefore)
  }
)

test(
  'CA5 (0040): la página del disco enseña sus marcadores, sus cuatro gráficos y su «Información» con los valores del simulador',
  { tag: '@host' },
  async () => {
    const entityPage = await openDiskPage()
    const row = entityPage.getByTestId('disk-markers')
    await expect(row).toBeVisible()

    // Marcadores: uso, libre, lectura, escritura, latencia (antes que cola) y problemas.
    for (const id of ['usage', 'free', 'read', 'write', 'latency', 'problems']) {
      await expect(row.getByTestId(`disk-marker-${id}`), id).toBeVisible()
      await expect(row.getByTestId(`disk-marker-${id}`), id).toContainText(
        DISK_MARKER_LABELS[id] ?? id
      )
    }
    await expect(row.getByTestId('disk-marker-queue')).toHaveCount(0)
    await expectDiskCommonMarkers()
    // Latencia: media de lectura (12 ms) y, debajo, la de escritura (18 ms).
    const latency = diskMarker('latency')
    await expect(latency.getByTestId('disk-marker-value')).toHaveText(/^12(,0)?\s?ms$/)
    await expect(latency.getByTestId('disk-marker-secondary')).toContainText(
      /(^|[^\d.,])18(,0)?\s?ms/
    )

    // Cuatro gráficos en su orden: uso, espacio, lectura y escritura, y latencia.
    const section = entityPage.getByTestId('disk-charts')
    await expect(section).toBeVisible()
    const panels = section.getByTestId('disk-chart-panel')
    await expect(panels).toHaveCount(4)
    const kinds = await diskChartKinds()
    expect(kinds).toEqual(['usage', 'space', 'throughput', 'latency'])
    for (const [index, kind] of (kinds as DiskChartKind[]).entries()) {
      await expect(panels.nth(index).getByRole('heading').first(), kind).toHaveText(
        DISK_CHART_TITLES[kind]
      )
      await expectDiskChartSeries(kind)
    }

    // «Información», al final: el sistema de ficheros y el host del que es el disco, con enlace.
    const info = entityPage.getByTestId('disk-info')
    await expect(info).toBeVisible()
    await expect(info).toContainText('Información')
    await expect(info).toContainText(DISK_PAGE_FILESYSTEM)
    await expect(info).toContainText('Disco de')
    const host = info.locator(`a[href$="#/entities/HOST/${HOST_METRICS_ID}"]`)
    await expect(host).toHaveCount(1)
    for (const text of ['undefined', 'null', 'NaN', '[object Object]']) {
      await expect(info, text).not.toContainText(text)
    }
    const markersBox = await settledBox(row)
    const chartsBox = await settledBox(section)
    const infoBox = await settledBox(info)
    expect(
      markersBox.y + markersBox.height,
      'marcadores encima de los gráficos'
    ).toBeLessThanOrEqual(chartsBox.y + 1)
    expect(chartsBox.y + chartsBox.height, 'gráficos encima de «Información»').toBeLessThanOrEqual(
      infoBox.y + 1
    )

    // Ni «Página en construcción» ni marcadores de otro tipo.
    await expect(entityPage.getByTestId('entity-under-construction')).toHaveCount(0)
    await expect(entityPage).not.toContainText('Página en construcción')
    for (const other of ['host-markers', 'process-markers', 'service-markers']) {
      await expect(page.getByTestId(other), other).toHaveCount(0)
    }

    // Las consultas del canal: acotadas al disco con el filtro, con el rango global y sin pasar de
    // 10 expresiones.
    await settledRequests()
    expect(sim.diskMetricQueries.length).toBeGreaterThan(0)
    for (const query of sim.diskMetricQueries) {
      const expressions = splitSelector(query.get('metricSelector') ?? '')
      expect(expressions.length).toBeLessThanOrEqual(HOST_MAX_EXPRESSIONS)
      for (const expression of expressions) expect(diskOfExpression(expression)).toBe(DISK_PAGE_ID)
      expect(query.get('entitySelector') ?? '').not.toContain(DISK_PAGE_ID)
      expect(query.get('from')).toBe('now-2h')
    }
  }
)

test(
  'CA5 (0040): sin latencia, el marcador y el gráfico de cola ocupan su sitio y el resto sigue',
  { tag: '@host' },
  async () => {
    sim.diskEmpty = ['builtin:host.disk.readTime', 'builtin:host.disk.writeTime']
    const entityPage = await openDiskPage()
    const row = entityPage.getByTestId('disk-markers')
    await expect(row.getByTestId('disk-marker-queue')).toBeVisible()
    await expect(row.getByTestId('disk-marker-queue')).toContainText(
      DISK_MARKER_LABELS['queue'] ?? ''
    )
    await expect(row.getByTestId('disk-marker-latency')).toHaveCount(0)
    await expectDiskCommonMarkers()
    // Cola: longitud media del rango (0,75).
    await expect(diskMarker('queue').getByTestId('disk-marker-value')).toHaveText(/^0,(75|8)$/)

    await expect(entityPage.getByTestId('disk-chart-panel')).toHaveCount(4)
    expect(await diskChartKinds()).toEqual(['usage', 'space', 'throughput', 'queue'])
    await expect(diskChartPanel('queue').getByRole('heading').first()).toHaveText(
      DISK_CHART_TITLES.queue
    )
    await expectDiskChartSeries('queue')
    await expect(entityPage.getByTestId('disk-info')).toBeVisible()
  }
)

/**
 * Ficha 0041: tarjeta «Logs» en la página del host (HOST_METRICS_ID), canal entities:hostLogs,
 * con HOST_LOGS_ENTRIES: 3 de los 15 procesos de HOST_PAGE_PROCESSES tienen logs.
 *
 * Nombres que fijan estos tests (decisión del test-writer, refinable; en la ficha): la tarjeta
 * `host-logs`, antes de «Información» (`host-info`); dentro, el resumen `host-logs-summary` y una
 * fila `host-log-row` (con `data-process-id`) por proceso con logs, con el nombre como enlace a su
 * página, el estado en `host-log-status` (con `data-status`, el enum de Dynatrace, su texto y su
 * color) y la última actualización en `host-log-updated`. Regla de Dani: ninguna ruta de log se ve
 * en la app (ni en la tarjeta ni en «Todas las propiedades» del proceso).
 */
const hostLogsCard = (): Locator => page.getByTestId('host-logs')
const hostLogRow = (id: string): Locator =>
  hostLogsCard().locator(`[data-testid="host-log-row"][data-process-id="${id}"]`)

/** Ficha 0041: ninguna ruta (ni trozo de ella) en el HTML del elemento, atributos incluidos. */
async function expectNoLogPaths(target: Locator, where: string): Promise<void> {
  const html = await target.evaluate((element) => element.outerHTML)
  for (const fragment of HOST_LOGS_FRAGMENTS) {
    expect(html.includes(fragment), `${where}: ${fragment}`).toBe(false)
  }
}

test(
  'CA4 (0041): la tarjeta «Logs» del host enseña el resumen y los procesos con logs, sin rutas; pulsar uno abre su página, y su «Todas las propiedades» tampoco enseña rutas',
  { tag: '@host' },
  async () => {
    const hostPage = await openHostPage()
    const card = hostLogsCard()
    await expect(card).toBeVisible()
    await expect(card.getByTestId('host-logs-summary')).toHaveText('3 de 15 procesos con logs')
    await expect(card.getByTestId('host-log-row')).toHaveCount(3)

    // La consulta: el selector con el id del host y pageSize 500.
    expect(sim.hostLogsQueries.length).toBeGreaterThan(0)
    const query = sim.hostLogsQueries[0]!
    expect(query.get('entitySelector')).toBe(HOST_LOGS_SELECTOR(HOST_METRICS_ID))
    expect(query.get('pageSize')).toBe('500')

    // Cada proceso con logs: su nombre, enlace a su página y la última actualización (una fecha).
    for (const id of HOST_LOGS_IDS) {
      const process = HOST_PAGE_PROCESSES.find((p) => p.id === id)!
      const row = hostLogRow(id)
      await expect(row, process.name).toBeVisible()
      await expect(row.getByRole('link', { name: process.name })).toHaveAttribute(
        'href',
        new RegExp(`#/entities/PROCESS_GROUP_INSTANCE/${id}$`)
      )
      await expect(row.getByTestId('host-log-updated'), process.name).toContainText('2026')
    }
    // Los procesos sin logs no salen.
    for (const process of HOST_PAGE_PROCESSES.filter((p) => !HOST_LOGS_IDS.includes(p.id))) {
      await expect(hostLogRow(process.id), process.name).toHaveCount(0)
    }

    // Estado, con texto (no el enum) y color: el fichero que se lee y el que no existe se distinguen.
    const ok = hostLogRow(HOST_PAGE_PROCESSES[2]!.id).getByTestId('host-log-status')
    const missing = hostLogRow(HOST_PAGE_PROCESSES[5]!.id).getByTestId('host-log-status')
    await expect(ok).toHaveAttribute('data-status', 'FILE_STATUS_OK')
    await expect(missing).toHaveAttribute('data-status', 'FILE_STATUS_NOT_EXIST')
    for (const status of [ok, missing]) {
      await expect(status).toHaveText(/\S/)
      await expect(status).not.toHaveText(/FILE_STATUS/)
    }
    expect(await ok.innerText()).not.toBe(await missing.innerText())
    const colorOf = (target: Locator): Promise<string> =>
      target.evaluate((element) => getComputedStyle(element).color)
    expect(await colorOf(ok), 'color de OK frente a NOT_EXIST').not.toBe(await colorOf(missing))

    // Antes de «Información».
    const info = hostInfoCard()
    await expect(info).toBeVisible()
    const logsBox = await settledBox(card)
    const infoBox = await settledBox(info)
    expect(logsBox.y + logsBox.height, '«Logs» encima de «Información»').toBeLessThanOrEqual(
      infoBox.y + 1
    )

    // Ninguna ruta de log en toda la página del host.
    await expectNoLogPaths(hostPage, 'página del host')

    // Pulsar un proceso abre su página.
    const link = hostLogRow(HOST_LOGS_PAGE.id).getByRole('link', { name: HOST_LOGS_PAGE.name })
    await clickInPlace(link, { scroll: true })
    const processPage = page.getByTestId('entity-page-process_group_instance')
    await expect(processPage).toBeVisible()
    expect(await currentRoute()).toBe(`/entities/PROCESS_GROUP_INSTANCE/${HOST_LOGS_PAGE.id}`)
    await expect(processPage.getByRole('heading', { level: 1 })).toHaveText(HOST_LOGS_PAGE.name)
    await expect(processPage.getByTestId('entity-page-id')).toHaveText(HOST_LOGS_PAGE.id)

    // Su «Información», con «Todas las propiedades» desplegada: sin rutas de log (sus properties
    // traen las mismas listas con rutas, como en vivo).
    const processCard = processInfoCard()
    await expect(processCard.getByTestId('process-info-row').first()).toBeVisible()
    const toggle = processCard.getByTestId('process-info-properties-toggle')
    await expect(toggle).toContainText('Todas las propiedades')
    await clickInPlace(toggle, { scroll: true })
    await expect(processInfoProperty('detectedName')).toContainText('proceso-logs-detectado-e2e')
    await expectNoLogPaths(processPage, 'página del proceso')
  }
)

test(
  'CA5 (0041): sin procesos con logs, la tarjeta dice «Sin logs detectados», sin aviso de error',
  { tag: '@host' },
  async () => {
    sim.hostLogsEmpty = true
    await openHostPage()
    const card = hostLogsCard()
    await expect(card).toBeVisible()
    await expect(card).toContainText('Sin logs detectados')
    await expect(card.getByTestId('host-log-row')).toHaveCount(0)
    await expect(card.getByRole('alert')).toHaveCount(0)
    await expect(card.getByRole('button', { name: 'Reintentar' })).toHaveCount(0)
  }
)

test(
  'CA5 (0041): con el canal caído, la tarjeta «Logs» enseña el aviso con Reintentar y lo demás sigue; Reintentar la carga',
  { tag: '@host' },
  async () => {
    sim.hostLogsFail = true
    await openHostPage()
    const card = hostLogsCard()
    await expect(card).toBeVisible()
    await expect(card.getByRole('alert').first()).toBeVisible()
    await expect(card.getByRole('button', { name: 'Reintentar' })).toBeVisible()
    await expect(card.getByTestId('host-log-row')).toHaveCount(0)
    // Marcadores y gráficos del host, con sus datos.
    await expectHostMarkerValues()
    expect(await hostChartSeries('cpu')).toHaveLength(HOST_CHART_SERIES.cpu.length)

    sim.hostLogsFail = false
    await clickInPlace(card.getByRole('button', { name: 'Reintentar' }), { scroll: true })
    await expect(card.getByTestId('host-log-row')).toHaveCount(3)
    await expect(card.getByTestId('host-logs-summary')).toHaveText('3 de 15 procesos con logs')
    await expect(card.getByRole('button', { name: 'Reintentar' })).toHaveCount(0)
  }
)

test(
  'Aviso del scope (0041): sin entities.read, la tarjeta «Logs» dice qué scope falta y no se pide nada',
  { tag: '@host' },
  async () => {
    const tenants = await invoke<{ clients: { id: string; name: string }[] }>('tenants:list')
    const clientId = tenants.clients.find((client) => client.name === 'Cliente A')?.id ?? ''
    const noEntities = await createEnvironment(
      clientId,
      'Sin entidades logs',
      'other',
      TOKEN_NO_ENTITIES
    )
    try {
      await invoke('connection:test', { environmentId: noEntities })
      await invoke('environments:setActive', { environmentId: noEntities })
      await reloadUi()
      await goToRoute(`/entities/HOST/${HOST_METRICS_ID}`)
      await expect(page.getByTestId('entity-page-host')).toBeVisible()
      const unavailable = hostLogsCard().getByTestId('module-unavailable')
      await expect(unavailable).toBeVisible()
      await expect(unavailable).toContainText('entities.read')
      await expect(hostLogsCard().getByTestId('host-log-row')).toHaveCount(0)
      await settledRequests()
      expect(sim.hostLogsQueries, 'entities:hostLogs sin el scope').toHaveLength(0)
    } finally {
      await invoke('environments:setActive', { environmentId: env['Producción'] })
      await invoke('environments:delete', { id: noEntities })
      await reloadUi()
    }
  }
)

/**
 * Ficha 0042: tarjeta «Eventos» en la página del host HOST_INFO_FULL_ID, canal
 * entities:hostEvents, con HOST_EVENTS (22 del host y de lo que corre en él; uno más de un
 * servicio, que no se pide).
 *
 * Nombres que fijan estos tests (decisión del test-writer, refinable; en la ficha): la tarjeta
 * `host-events`, antes de «Información» (`host-info`); dentro, «20 de N» en
 * `host-events-summary` y una fila `host-event-row` por evento (del más reciente al más antiguo)
 * con el tipo en una píldora (`host-event-type`), el título (`host-event-title`), la entidad
 * (`host-event-entity`: enlace a su página si su tipo tiene página, texto si no), el inicio
 * (`host-event-start`), el fin o «Activo» (`host-event-end`) y el estado (`host-event-status`,
 * con `data-status`, el de Dynatrace). Sin el scope, `module-unavailable` dentro de la tarjeta.
 */
const hostEventsCard = (): Locator => page.getByTestId('host-events')
const hostEventRows = (): Locator => hostEventsCard().getByTestId('host-event-row')
const hostEventEntity = (n: number): Locator =>
  hostEventRows()
    .nth(n - 1)
    .getByTestId('host-event-entity')

test(
  'CA5 (0042): la tarjeta «Eventos» del host enseña los 20 más recientes del host y de lo que corre en él, con enlaces; «20 de 22»',
  { tag: '@host' },
  async () => {
    await openHostInfo(HOST_EVENTS_HOST)
    const card = hostEventsCard()
    await expect(card).toBeVisible()
    await expect(hostEventRows()).toHaveCount(20)
    await expect(card.getByTestId('host-events-summary')).toContainText('20 de 22')

    // La consulta: eventSelector con el host y sus relacionados, sin los que no entran. Solo las
    // de este host: una recarga del test anterior puede dejar una consulta tardía de otro.
    const queries = sim.hostEventsQueries.filter((query) =>
      (hostEventsSelectorIds(query) ?? []).includes(HOST_EVENTS_HOST)
    )
    expect(queries.length).toBeGreaterThan(0)
    const asked = queries.flatMap((query) => hostEventsSelectorIds(query) ?? [])
    expect([...new Set(asked)].sort()).toEqual([...HOST_EVENTS_IDS].sort())
    for (const id of HOST_EVENTS_EXCLUDED) expect(asked, id).not.toContain(id)
    for (const query of queries) {
      expect(query.has('optionalEntitySelector')).toBe(false)
      expect(query.has('entitySelector')).toBe(false)
      expect(query.get('from')).toBe('now-2h')
    }

    // Del más reciente al más antiguo: los eventos 1 a 20; el del servicio no sale.
    const titles = await hostEventRows().getByTestId('host-event-title').allTextContents()
    expect(titles.map((title) => title.trim())).toEqual(
      Array.from({ length: 20 }, (_, i) => hostEventTitle(i + 1))
    )
    await expect(card).not.toContainText('Evento e2e 0')
    await expect(card).not.toContainText('servicio-host-e2e')

    // El título con HTML se ve como texto: ni negrita ni imagen dentro de la tarjeta.
    await expect(hostEventRows().nth(1).getByTestId('host-event-title')).toHaveText(
      HOST_EVENTS_HTML_TITLE
    )
    await expect(card.locator('b, img')).toHaveCount(0)

    // Cada fila: tipo en su píldora, inicio, fin o «Activo», y estado.
    for (const n of [1, 5]) {
      const row = hostEventRows().nth(n - 1)
      await expect(row.getByTestId('host-event-type'), `tipo del ${n}`).toHaveText(/\S/)
      await expect(row.getByTestId('host-event-start'), `inicio del ${n}`).toHaveText(/\d/)
      await expect(row.getByTestId('host-event-status'), `estado del ${n}`).toHaveAttribute(
        'data-status',
        n === 5 ? 'OPEN' : 'CLOSED'
      )
    }
    await expect(hostEventRows().nth(4).getByTestId('host-event-end')).toHaveText('Activo')
    await expect(hostEventRows().nth(0).getByTestId('host-event-end')).toHaveText(/\d/)
    await expect(hostEventRows().nth(0).getByTestId('host-event-end')).not.toHaveText('Activo')

    // La entidad: enlace a su página si su tipo la tiene (host, proceso, disco); la EC2, texto.
    await expect(hostEventEntity(2).getByRole('link', { name: 'proceso-host-1' })).toHaveAttribute(
      'href',
      new RegExp(`#/entities/PROCESS_GROUP_INSTANCE/${HOST_INFO_PGIS[0]}$`)
    )
    await expect(
      hostEventEntity(4).getByRole('link', { name: HOST_EVENTS_DISK_NAME })
    ).toHaveAttribute('href', new RegExp(`#/entities/DISK/${HOST_INFO_DISK}$`))
    await expect(hostEventEntity(5)).toContainText('instancia-e2e')
    await expect(hostEventEntity(5).getByRole('link')).toHaveCount(0)

    // Antes de «Información».
    const eventsBox = await settledBox(card)
    const infoBox = await settledBox(hostInfoCard())
    expect(eventsBox.y + eventsBox.height, '«Eventos» encima de «Información»').toBeLessThanOrEqual(
      infoBox.y + 1
    )

    // Pulsar la entidad de un evento abre su página.
    await clickInPlace(hostEventEntity(3).getByRole('link', { name: 'proceso-host-2' }), {
      scroll: true
    })
    await expect.poll(currentRoute).toBe(`/entities/PROCESS_GROUP_INSTANCE/${HOST_INFO_PGIS[1]}`)
  }
)

test(
  'CA5 (0042): con el canal caído, la tarjeta «Eventos» enseña el aviso con Reintentar y lo demás sigue; Reintentar la carga',
  { tag: '@host' },
  async () => {
    sim.hostEventsFail = true
    await openHostInfo(HOST_EVENTS_HOST)
    const card = hostEventsCard()
    await expect(card).toBeVisible()
    await expect(card.getByRole('alert').first()).toBeVisible()
    await expect(card.getByRole('button', { name: 'Reintentar' })).toBeVisible()
    await expect(hostEventRows()).toHaveCount(0)
    // La «Información» del host sigue con sus datos.
    await expect(hostInfoValue('osType')).toContainText('LINUX')

    sim.hostEventsFail = false
    await clickInPlace(card.getByRole('button', { name: 'Reintentar' }), { scroll: true })
    await expect(hostEventRows()).toHaveCount(20)
    await expect(card.getByTestId('host-events-summary')).toContainText('20 de 22')
    await expect(card.getByRole('button', { name: 'Reintentar' })).toHaveCount(0)
  }
)

test(
  'CA5 (0042): sin events.read, la tarjeta «Eventos» dice qué scope falta y no se pide nada',
  { tag: '@host' },
  async () => {
    const tenants = await invoke<{ clients: { id: string; name: string }[] }>('tenants:list')
    const clientId = tenants.clients.find((client) => client.name === 'Cliente A')?.id ?? ''
    const noEvents = await createEnvironment(clientId, 'Sin eventos', 'other', TOKEN_NO_EVENTS)
    try {
      await invoke('connection:test', { environmentId: noEvents })
      await invoke('environments:setActive', { environmentId: noEvents })
      await reloadUi()
      await goToRoute(`/entities/HOST/${HOST_EVENTS_HOST}`)
      await expect(page.getByTestId('entity-page-host')).toBeVisible()
      const unavailable = hostEventsCard().getByTestId('module-unavailable')
      await expect(unavailable).toBeVisible()
      await expect(unavailable).toContainText('events.read')
      await expect(hostEventRows()).toHaveCount(0)
      // La «Información» del host no depende de events.read.
      await expect(hostInfoValue('osType')).toContainText('LINUX')
      await settledRequests()
      expect(sim.hostEventsQueries, 'entities:hostEvents sin el scope').toHaveLength(0)
    } finally {
      await invoke('environments:setActive', { environmentId: env['Producción'] })
      await invoke('environments:delete', { id: noEvents })
      await reloadUi()
    }
  }
)

test(
  'CA2 (0064): en un host, «Reintentar» del gráfico de memoria roto pide solo su canal (entities:hostMetrics), una vez; los demás canales, nada',
  { tag: '@host' },
  async () => {
    await openHostPage()
    await hostChartSeries('memory')
    await settledRequests()
    // Una llamada al canal (una o más consultas de series y una de marcadores, ficha 0039).
    expect(hostMetricCalls()).toBe(1)
    const perCall = sim.hostMetricQueries.length

    // Fuera y vuelta (desde la caché, sin peticiones): al volver a montarse, el gráfico de
    // memoria falla.
    await goTo('metrics')
    await expect(page.getByTestId('entity-page-host')).toHaveCount(0)
    await failChartMountOnce('host-chart-memory')
    await openHostPage()
    const panel = hostChartPanel('memory').getByTestId('panel-error')
    await expect(panel).toBeVisible()
    dropPanelFailureErrors()
    await expect(hostChartPlot('cpu')).toBeVisible()
    const before = await settledRequests()
    const channels = (): Record<string, number> => ({
      hostMetrics: hostMetricCalls(),
      hostBreakdown: sim.hostBreakdownQueries.length,
      problemCounts: sim.entityProblemQueries.length,
      problemList: sim.entityProblemListQueries.length,
      info: sim.entityInfoQueries.length,
      logs: sim.hostLogsQueries.length,
      events: sim.hostEventsQueries.length
    })
    const start = channels()

    await panel.getByTestId('panel-retry').click()
    // Sube el canal del panel reintentado: una llamada más.
    await expect.poll(hostMetricCalls).toBe((start['hostMetrics'] ?? 0) + 1)
    await expect(panel).toHaveCount(0)
    expect((await hostChartSeries('memory')).length).toBeGreaterThan(0)
    await page.waitForTimeout(800)
    // Los demás canales, no; y el suyo, una sola vez.
    expect(channels()).toEqual({ ...start, hostMetrics: (start['hostMetrics'] ?? 0) + 1 })
    const after = sim.requests.slice(before)
    expect(after, 'peticiones tras Reintentar').toHaveLength(perCall)
    for (const request of after) expect(request).toBe('GET /api/v2/metrics/query')
    dropPanelFailureErrors()
  }
)
