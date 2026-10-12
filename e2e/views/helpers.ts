import { expect, type Locator } from '@playwright/test'
import {
  DESC_ID,
  HOST_METRICS_ID,
  HOST_PAGE_PROCESSES,
  MONITOR_BROWSER_ID,
  MONITOR_HTTP_ID,
  PROCESS_METRICS_ID,
  ALL_ID
} from './fixtures'
import { consoleErrors, goToRoute, nextFrames, page } from './harness'
import { sim } from './sim-state'

/**
 * Ayudantes de los specs de vistas que usan varios specs de zona (ficha 0070; antes estaban en
 * `views.spec.ts`). Los que solo usa un spec siguen en él. Arnés en `harness.ts` (ver su cabecera).
 */

/** v0.10.0: filas principales de la tabla de evidencias (sin las de detalle). */
export const evidenceRows = (): Locator => page.getByTestId('evidence-row')

/** v0.10.0: la fila de la evidencia con ese título. */
export function evidenceRow(title: string): Locator {
  return evidenceRows().filter({ has: page.getByRole('gridcell', { name: title, exact: true }) })
}

/** v0.10.0: el detalle de una fila (por su aria-controls). */
export async function detailOf(row: Locator): Promise<Locator> {
  const id = (await row.getAttribute('aria-controls')) ?? ''
  expect(id).toMatch(/^evidence-detail-/)
  return page.locator(`[id="${id}"]`)
}

/** v0.10.0: despliega la fila (si no lo está) y devuelve su detalle. */
export async function expandRow(title: string): Promise<Locator> {
  const row = evidenceRow(title)
  await row.scrollIntoViewIfNeeded()
  if ((await row.getAttribute('aria-expanded')) !== 'true') await row.click()
  await expect(row).toHaveAttribute('aria-expanded', 'true')
  const detail = await detailOf(row)
  await expect(detail).toBeVisible()
  return detail
}

/**
 * Ficha 0059: cuántas veces se ha pintado cada fila de un DataGrid. Contrato (decisión del
 * test-writer, refinable): con VIGIA_E2E, cada fila principal (la de `rowTestId`) lleva
 * `data-render-count`, las veces que se ha pintado desde que se montó. Devuelve id → renders
 * (-1 si falta el atributo) de las filas montadas, por el atributo `idAttr` de cada fila.
 */
export async function rowRenders(
  rowTestId: string,
  idAttr: string
): Promise<Record<string, number>> {
  return page.evaluate(
    ({ testId, attr }) => {
      const out: Record<string, number> = {}
      for (const row of document.querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`)) {
        const id = row.getAttribute(attr)
        const count = row.getAttribute('data-render-count')
        if (id !== null) out[id] = count === null || count === '' ? -1 : Number(count)
      }
      return out
    },
    { testId: rowTestId, attr: idAttr }
  )
}

/** Ficha 0059: espera a que los renders de las filas no cambien entre dos frames y los devuelve. */
export async function settledRowRenders(
  rowTestId: string,
  idAttr: string
): Promise<Record<string, number>> {
  let last: Record<string, number> = {}
  await expect
    .poll(async () => {
      const before = await rowRenders(rowTestId, idAttr)
      await nextFrames()
      last = await rowRenders(rowTestId, idAttr)
      return JSON.stringify(before) === JSON.stringify(last)
    })
    .toBe(true)
  return last
}

/**
 * Ficha 0059: guarda el elemento de cada fila montada. Si una fila se desmonta y se vuelve a montar,
 * su contador empieza de cero y podría coincidir con el de antes: `sameRows` lo descubre.
 */
export async function markRows(rowTestId: string, idAttr: string): Promise<void> {
  await page.evaluate(
    ({ testId, attr }) => {
      const marks = new Map<string, Element>()
      for (const row of document.querySelectorAll(`[data-testid="${testId}"]`)) {
        const id = row.getAttribute(attr)
        if (id !== null) marks.set(id, row)
      }
      ;(window as unknown as { __rows0059?: Map<string, Element> }).__rows0059 = marks
    },
    { testId: rowTestId, attr: idAttr }
  )
}

/** Ficha 0059: ids marcados con `markRows` cuya fila sigue siendo el mismo elemento montado. */
export async function sameRows(rowTestId: string, idAttr: string): Promise<string[]> {
  return page.evaluate(
    ({ testId, attr }) => {
      const marks = (window as unknown as { __rows0059?: Map<string, Element> }).__rows0059
      if (marks === undefined) return []
      const now = new Map<string, Element>()
      for (const row of document.querySelectorAll(`[data-testid="${testId}"]`)) {
        const id = row.getAttribute(attr)
        if (id !== null) now.set(id, row)
      }
      return [...marks]
        .filter(([id, row]) => row.isConnected && now.get(id) === row)
        .map(([id]) => id)
    },
    { testId: rowTestId, attr: idAttr }
  )
}

/** v0.10.2: lo que el gráfico expone tras pintarse (etiquetas del eje, rango y markLines). */
export async function axisOf(chart: Locator): Promise<{
  labels: string[]
  from: number
  to: number
  markLines: number
}> {
  await expect(chart).toHaveAttribute('data-x-labels', /\[.+\]/)
  return {
    labels: JSON.parse((await chart.getAttribute('data-x-labels')) ?? '[]') as string[],
    from: Number(await chart.getAttribute('data-range-from')),
    to: Number(await chart.getAttribute('data-range-to')),
    markLines: Number(await chart.getAttribute('data-mark-lines'))
  }
}

/** Fecha corta del eje en español (dd/MM). */
export const ES_DAY = /^\d\d\/\d\d$/

/** Ficha 0001: abre P-785 (descripciones en Markdown) por URL y espera sus 5 evidencias. */
export async function openDescriptionProblem(): Promise<void> {
  await goToRoute(`/problems/${DESC_ID}`)
  await expect(page.getByTestId('problem-page-title')).toContainText('P-785')
  await expect(evidenceRows()).toHaveCount(5)
}

/** Fichas 0001 y 0002: las partes de la sección «Descripción» de un detalle desplegado. */
export function descriptionParts(detail: Locator): {
  section: Locator
  copy: Locator
  status: Locator
  truncated: Locator
} {
  const section = detail.getByTestId('evidence-description')
  return {
    section,
    copy: section.getByTestId('evidence-description-copy'),
    status: section.getByTestId('evidence-description-copy-status'),
    truncated: detail.getByTestId('evidence-description-truncated')
  }
}

/** data-testid del elemento con el foco. */
export const focusedTestId = (): Promise<string | null> =>
  page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? null)

/** Ficha 0035: abre P-835 por URL y espera sus 6 evidencias. */
export async function openAllDescriptionsProblem(): Promise<void> {
  await goToRoute(`/problems/${ALL_ID}`)
  await expect(page.getByTestId('problem-page-title')).toContainText('P-835')
  await expect(evidenceRows()).toHaveCount(6)
}

/** Ficha 0003: el botón «Analizar entidad» dentro del detalle desplegado de una evidencia. */
export const analyzeButton = (detail: Locator): Locator =>
  detail.getByTestId('evidence-analyze-entity')

/** Ficha 0003: espera a que el simulador deje de recibir peticiones y devuelve cuántas lleva. */
export async function settledRequests(): Promise<number> {
  let last = -1
  await expect
    .poll(
      () => {
        const now = sim.requests.length
        const stable = now === last
        last = now
        return stable
      },
      { intervals: [400] }
    )
    .toBe(true)
  return sim.requests.length
}

/** Ficha 0008: el número suelto dentro del texto (no parte de otro número). */
export const loneNumber = (value: string): RegExp =>
  new RegExp(`(^|[^\\d.,])${value.replace(/\./g, '\\.')}([^\\d.,]|$)`)

/**
 * Ficha 0015: tarjeta «Información» de la página de un SERVICE (entre la cabecera y los
 * marcadores), con los datos de entities:get y los nombres de entities:names a demanda.
 *
 * Nombres que fijan estos tests: la tarjeta `service-info`; sus columnas `service-info-service`
 * («Servicio») y `service-info-relations` («Relaciones»); cada fila de «Servicio» es un
 * `service-info-row` con `data-key` (serviceType, technologies, webServerName, webService,
 * contextRoot, port, isExternalService, remoteEndpoint, databaseVendor, databaseName,
 * applicationName, applicationEnvironment, applicationReleaseVersion, publicCloudId,
 * publicCloudRegion, firstSeen, lastSeen, managementZones y tags, en ese orden), con su valor en
 * `service-info-value` y los chips en `service-info-chip`; el «+N» de las etiquetas,
 * `service-info-tags-more`. Cada grupo de relaciones es un `service-info-group` con `data-group`
 * (runsOn, calls, calledBy y other), su número en `service-info-group-count`, el botón que lo
 * despliega `service-info-group-toggle` (con `aria-expanded`), el aviso «Mostrando 50 de N»
 * `service-info-group-truncated`, el botón «Ver nombres» `service-info-names` y cada entidad,
 * un enlace `service-info-entity` con `data-entity-id`, con su nombre (si se conoce) en
 * `service-info-entity-name`. «Todas las propiedades»: el botón
 * `service-info-properties-toggle` y cada propiedad, `service-info-property` con `data-key`.
 */
export const INFO_ROW_ORDER = [
  'serviceType',
  'technologies',
  'webServerName',
  'webService',
  'contextRoot',
  'port',
  'isExternalService',
  'remoteEndpoint',
  'databaseVendor',
  'databaseName',
  'applicationName',
  'applicationEnvironment',
  'applicationReleaseVersion',
  'publicCloudId',
  'publicCloudRegion',
  'firstSeen',
  'lastSeen',
  // Ficha 0037: las etiquetas ya no son fila de la tarjeta (van en las píldoras de arriba).
  'managementZones'
]
export const infoCard = (): Locator => page.getByTestId('service-info')

/** Ficha 0015: abre la página del servicio por URL y espera la tarjeta con sus filas. */
export async function openServiceInfo(id: string): Promise<Locator> {
  await goToRoute(`/entities/SERVICE/${id}`)
  await expect(page.getByTestId('entity-page-service')).toBeVisible()
  const card = infoCard()
  await expect(card).toBeVisible()
  await expect(card.getByTestId('service-info-row').first()).toBeVisible()
  return card
}

/** Ficha 0015: valor de un atributo (data-key por defecto) de cada elemento, en el orden del DOM. */
export async function dataKeys(target: Locator, attribute = 'data-key'): Promise<string[]> {
  return target.evaluateAll(
    (elements, name) => elements.map((element) => element.getAttribute(name) ?? ''),
    attribute
  )
}

/** Ficha 0018: abre la página de HOST_METRICS_ID por URL. */
export async function openHostPage(): Promise<Locator> {
  await goToRoute(`/entities/HOST/${HOST_METRICS_ID}`)
  const hostPage = page.getByTestId('entity-page-host')
  await expect(hostPage).toBeVisible()
  return hostPage
}
export const hostDisks = (): Locator => page.getByTestId('host-disks')
export const hostProcesses = (): Locator => page.getByTestId('host-processes')
export const processRow = (id: string): Locator =>
  hostProcesses().locator(`[data-testid="host-process-row"][data-process-id="${id}"]`)

/** Ficha 0019: ids de las filas de la tabla, en el orden en que se pintan. */
export async function tableOrder(
  card: Locator,
  rowTestId: string,
  attribute: string
): Promise<string[]> {
  return card
    .getByTestId(rowTestId)
    .evaluateAll(
      (els, attr) =>
        els
          .sort(
            (a, b) => Number(a.getAttribute('data-index')) - Number(b.getAttribute('data-index'))
          )
          .map((el) => el.getAttribute(attr) ?? ''),
      attribute
    )
}

/** Ficha 0019: las columnas del grid (sus testid), en orden. */
export async function gridColumns(grid: Locator): Promise<(string | null)[]> {
  return grid
    .locator('[role="columnheader"]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')))
}

/** Los 10 procesos de HOST_PAGE_PROCESSES con más CPU media, de más a menos. */
export const HOST_PAGE_TOP = HOST_PAGE_PROCESSES.slice()
  .sort((a, b) => b.cpu.avg - a.cpu.avg)
  .slice(0, 10)

/** Ficha 0019: espera a que las dos tablas tengan sus filas (3 discos y 10 procesos). */
export async function expectHostTablesLoaded(): Promise<void> {
  await expect(hostDisks().getByTestId('host-disk-row')).toHaveCount(3)
  await expect(hostProcesses().getByTestId('host-process-row')).toHaveCount(10)
}

/**
 * Ficha 0020: tarjeta «Información» de la página de un HOST (HOST_INFO_FULL_ID y HOST_METRICS_ID,
 * canal entities:get), con la misma forma que la del servicio (0015) y sus nombres con el prefijo
 * `host-info`.
 *
 * Nombres que fijan estos tests: la tarjeta `host-info`, entre la cabecera y `host-markers`;
 * dentro, cada grupo de filas en un `host-info-section` con `data-section` (system, capacity,
 * network, monitoring, grouping y cloud, en ese orden y solo los que tengan filas) y su nombre
 * en un encabezado; cada fila, `host-info-row` con `data-key` (las claves de `buildHostInfo`) y
 * su valor en `host-info-value`; los chips, `host-info-chip`; las IPs, las 2 primeras y un botón
 * `host-info-more` con «+N» que enseña el resto. Las relaciones, en `host-info-relations`: cada
 * grupo `host-info-group` con `data-group` (processes, services, runsOn, hostGroup y other), con
 * `host-info-group-toggle` (aria-expanded), `host-info-group-count` y, desplegado, sus
 * `host-info-entity` (enlaces, con `data-entity-id`), el botón `host-info-names` («Ver nombres»)
 * y cada nombre en `host-info-entity-name`. «Todas las propiedades», `host-info-properties-toggle`
 * y cada una `host-info-property` con `data-key`. La memoria, en GB (10^9 bytes, como la 0018).
 */
export const HOST_INFO_SECTIONS: [string, string, string[]][] = [
  ['system', 'Sistema', ['osType', 'osVersion', 'osArchitecture', 'bitness']],
  ['capacity', 'Capacidad', ['cpuCores', 'logicalCpuCores', 'memory']],
  ['network', 'Red', ['ipAddress', 'networkZone']],
  [
    'monitoring',
    'Monitorización',
    ['monitoringMode', 'state', 'installerVersion', 'firstSeen', 'lastSeen']
  ],
  // Ficha 0037: sin la fila de etiquetas (van en las píldoras de arriba).
  ['grouping', 'Agrupación', ['hostGroupName', 'managementZones']],
  ['cloud', 'Nube o virtualización', ['cloudType', 'hypervisorType']]
]
export const hostInfoCard = (): Locator => page.getByTestId('host-info')

/** Ficha 0020: abre la página de un host por URL y espera la tarjeta con sus filas. */
export async function openHostInfo(id: string): Promise<Locator> {
  await goToRoute(`/entities/HOST/${id}`)
  await expect(page.getByTestId('entity-page-host')).toBeVisible()
  const card = hostInfoCard()
  await expect(card).toBeVisible()
  await expect(card.getByTestId('host-info-row').first()).toBeVisible()
  return card
}

/**
 * Ficha 0024: marcadores y gráficos de las páginas de un browser monitor (MONITOR_BROWSER_ID) y
 * de un HTTP monitor (MONITOR_HTTP_ID), con sus métricas (canal entities:monitorMetrics de la
 * 0022), su desglose (entities:monitorBreakdown de la 0023, para «Localizaciones») y sus
 * problemas (monitorBandProblems).
 *
 * Nombres que fijan estos tests (las dos páginas comparten componentes y testids): la fila
 * `monitor-markers`; cada marcador `monitor-marker-<id>` (availability, duration, executions,
 * locations y problems); dentro, el valor principal en `monitor-marker-value` (el de la
 * disponibilidad con `data-level`: `normal`, `warning` o `error`, umbrales del 99 y el 95 %) y lo
 * de debajo en `monitor-marker-secondary` (mediana, fallidas con `data-level` `error` si hay
 * alguna y `normal` si no, y localizaciones por debajo del 100 %); el texto del nivel, cuando no es
 * `normal`, en `monitor-marker-level`; los recuentos, en `monitor-marker-open` y
 * `monitor-marker-closed`. La sección `monitor-charts`; cada gráfico en un `monitor-chart-panel`
 * con `data-kind` (availability, duration, executions y performance, en ese orden; el cuarto es
 * el de rendimiento en browser y el de tiempos HTTP en HTTP) y su título en un encabezado;
 * dentro, el `Chart` con testid `monitor-chart-<kind>` (con `data-series`). La franja,
 * `monitor-problem-band`, dentro del panel de la disponibilidad; cada tramo,
 * `monitor-problem-segment` con `data-problem-id`.
 */
export type MonitorPageKind = 'browser' | 'http'
export const MONITOR_PAGES: Record<MonitorPageKind, { type: string; id: string; testId: string }> =
  {
    browser: {
      type: 'SYNTHETIC_TEST',
      id: MONITOR_BROWSER_ID,
      testId: 'entity-page-synthetic_test'
    },
    http: { type: 'HTTP_CHECK', id: MONITOR_HTTP_ID, testId: 'entity-page-http_check' }
  }

export const monitorPage = (kind: MonitorPageKind): Locator =>
  page.getByTestId(MONITOR_PAGES[kind].testId)

/** Ficha 0024: abre por URL la página del monitor inventado de ese tipo. */
export async function openMonitorPage(kind: MonitorPageKind): Promise<Locator> {
  const { type, id } = MONITOR_PAGES[kind]
  await goToRoute(`/entities/${type}/${id}`)
  const entityPage = monitorPage(kind)
  await expect(entityPage).toBeVisible()
  return entityPage
}
export const monitorInfoCard = (): Locator => page.getByTestId('monitor-info')

/** Ficha 0026: abre la página del monitor y espera su tarjeta con filas. */
export async function openMonitorInfo(kind: MonitorPageKind): Promise<Locator> {
  await openMonitorPage(kind)
  const card = monitorInfoCard()
  await expect(card).toBeVisible()
  await expect(card.getByTestId('monitor-info-row').first()).toBeVisible()
  return card
}

/**
 * Ficha 0028: marcadores y gráficos de la página de un proceso (PROCESS_GROUP_INSTANCE), con las
 * métricas del canal entities:processMetrics (0027: PROCESS_SERIES y PROCESS_MARKERS) y sus
 * problemas (processBandProblems: uno abierto y uno cerrado).
 *
 * Con la decisión del Orquestador de la 0027, el canal tiene métrica para los seis papeles: un
 * papel sin datos llega con series vacías y su marcador a null, y eso es lo que el simulador puede
 * dejar «sin métrica» (`sim.processEmpty`). Ese papel no se pinta. «Disponibilidad o Recursos» y
 * «Salud de red o Recursos» son «el que haya»; con los dos, por la decisión del Orquestador en la
 * ficha 0028, el cuarto marcador es Disponibilidad y el cuarto gráfico, Salud de red; sin el
 * primero, sale el segundo.
 *
 * Nombres que fijan estos tests (los del host con el prefijo `process`): la fila
 * `process-markers`; cada marcador `process-marker-<id>` (cpu, memory, network, availability o
 * resources, y problems); dentro, el valor principal en `process-marker-value` (el de la CPU con
 * `data-level`: `normal`, `warning` o `error`, umbrales del 80 y el 90 %) y lo de debajo en
 * `process-marker-secondary` (máxima y salida); el texto del nivel, cuando no es `normal`, en
 * `process-marker-level`; los recuentos, en `process-marker-open` y `process-marker-closed`. La
 * sección `process-charts`; cada gráfico en un `process-chart-panel` con `data-kind` (cpu,
 * memory, network y network-health o resources, en ese orden) y su título en un encabezado;
 * dentro, el `Chart` con testid `process-chart-<kind>` (con `data-series`). La franja,
 * `process-problem-band`, dentro del panel de la CPU; cada tramo, `process-problem-segment` con
 * `data-problem-id`.
 *
 * Formato (decisión del Orquestador, ficha 0028): Recursos, como porcentaje tal cual (0,9 →
 * «0,9 %»); la red, como en el host, en bits por segundo (`formatBitRate`): bytesRx y bytesTx
 * llegan en BytePerSecond (docs/notas-api-v2.md), así que se multiplican por 8.
 */
export const PROCESS_PAGE_TEST_ID = 'entity-page-process_group_instance'

export const processPage = (): Locator => page.getByTestId(PROCESS_PAGE_TEST_ID)

/** Ficha 0028: abre por URL la página del proceso (por defecto, el inventado de la 0027). */
export async function openProcessPage(id: string = PROCESS_METRICS_ID): Promise<Locator> {
  await goToRoute(`/entities/PROCESS_GROUP_INSTANCE/${id}`)
  const entityPage = processPage()
  await expect(entityPage).toBeVisible()
  return entityPage
}
export const processInfoCard = (): Locator => page.getByTestId('process-info')
export const processInfoProperty = (key: string): Locator =>
  processInfoCard().locator(`[data-testid="process-info-property"][data-key="${key}"]`)

/** Ficha 0029: abre la página del proceso y espera su tarjeta con filas. */
export async function openProcessInfo(): Promise<Locator> {
  await openProcessPage()
  const card = processInfoCard()
  await expect(card).toBeVisible()
  await expect(card.getByTestId('process-info-row').first()).toBeVisible()
  return card
}

/**
 * Ficha 0036: lo que se ve en la página antes (o después) de `testId`, subiendo desde él hasta la
 * raíz de la página y mirando los hermanos con caja de cada nivel. Cada uno se nombra por su
 * `data-testid`, por el primero que tenga dentro o por su etiqueta (`header` para la cabecera).
 * No depende de cómo se envuelvan las secciones.
 */
export async function visibleNeighbours(
  pageTestId: string,
  testId: string,
  side: 'before' | 'after'
): Promise<string[]> {
  return page.getByTestId(pageTestId).evaluate(
    (root, [id, where]) => {
      const target = root.querySelector(`[data-testid="${id}"]`)
      if (target === null) return [`sin ${id}`]
      const describe = (element: Element): string => {
        if (element.tagName === 'HEADER') return 'header'
        const own = element.getAttribute('data-testid')
        if (own !== null) return own
        const inner = element.querySelector('[data-testid]')?.getAttribute('data-testid')
        return inner ?? element.tagName.toLowerCase()
      }
      const found: string[] = []
      for (let node: Element = target; node !== root;) {
        let sibling = where === 'after' ? node.nextElementSibling : node.previousElementSibling
        while (sibling !== null) {
          const rect = sibling.getBoundingClientRect()
          if (rect.width > 0 && rect.height > 0) found.push(describe(sibling))
          sibling = where === 'after' ? sibling.nextElementSibling : sibling.previousElementSibling
        }
        if (node.parentElement === null) break
        node = node.parentElement
      }
      return found
    },
    [testId, side] as const
  )
}

// ---------------------------------------------------------------------------
// Ficha 0034: página de una APPLICATION (marcadores, gráficos, acciones de usuario e
// «Información»).
// ---------------------------------------------------------------------------

/**
 * Página de la aplicación inventada de la ficha 0033 (APPLICATION_METRICS_ID), con el canal
 * entities:applicationMetrics (series APPLICATION_SERIES, totales APPLICATION_TOTALS y las tres
 * acciones de APPLICATION_ACTIONS), el canal entities:applicationRum de la 0052 (APPLICATION_RUM
 * y APPLICATION_RUM_ERRORS), sus problemas (applicationBandProblems: uno abierto y uno cerrado) y
 * entities:get (applicationInfoBody).
 *
 * Nombres que fijan estos tests (la ficha no los da; decisión del test-writer, delegada por Dani y
 * refinable), los del process group (0032) con el prefijo `application`:
 * - Marcadores (ficha 0053): la fila `application-markers`; cada marcador
 *   `application-marker-<id>` (apdex, users, sessions, actions, errors y problems, en ese orden);
 *   el valor principal en `application-marker-value`, con `data-level` en el Apdex
 *   (`apdexLevel` de `lib/application-format.ts`: success, warning o error) y en los errores
 *   (error si > 0); lo de debajo en `application-marker-secondary`; el texto de la categoría del
 *   Apdex, dentro del marcador; los recuentos de problemas en `application-marker-open` y
 *   `application-marker-closed`.
 * - Secciones (ficha 0053): cada una en un `application-section` con `data-section` (activity,
 *   errors, users, experience, apdex y key-actions, en ese orden, entre los marcadores e
 *   «Información») y su título en el primer encabezado. Ficha 0054: users («Usuarios y
 *   sesiones») y experience («Experiencia») van justo después de errors.
 * - Gráficos: cada uno en un `application-chart-panel` con `data-kind` y su título en un
 *   encabezado; dentro, el `Chart` con testid `application-chart-<kind>` (con `data-series`).
 *   «Actividad»: actionsByType y durationByType; «Errores»: errorsByType y affectedActions;
 *   «Apdex»: apdex. La franja, `application-problem-band`, en los paneles del Apdex y de la
 *   duración por tipo; cada tramo, `application-problem-segment` con `data-problem-id`. La nota
 *   de errores sin separar, `application-errors-note`, en el panel errorsByType.
 * - Tabla: la tarjeta `application-actions` (en la sección key-actions), con el `DataGrid`
 *   `application-actions-grid` (columnas name, count y duration, en ese orden; de más a menos
 *   acciones al entrar; botones `sort-<columna>`) y filas `application-action-row` con
 *   `data-action-id`; la barra de la duración, `application-action-duration-bar`. Sin acciones,
 *   el aviso `application-actions-empty` (en vivo la lista de acciones clave suele venir vacía).
 * - «Información»: `application-info`, con `application-info-row` (`data-key`: al menos
 *   applicationType, applicationInjectionType, customizedName y detectedName),
 *   `application-info-value`, `application-info-relations`, `application-info-group`
 *   (`data-group`: calls, synthetic y other), `-group-toggle`, `-group-count`, `-entity`
 *   (`data-entity-id`), `-names` y `-entity-name`.
 *
 * Formato, como el servicio: Apdex con dos decimales; recuentos con separador de miles;
 * duraciones con `formatDurationMs` (ms o s con un decimal); porcentajes con un decimal.
 *
 * Ficha 0053 (decisiones del test-writer, refinables): los marcadores de usuarios, sesiones,
 * acciones y errores salen del canal de RUM; el total de acciones y el de errores son la suma de
 * sus tipos (así cuadra con lo de debajo). Errores «sin separar»: el canal trae `javascript` y
 * `http` sin datos (total null) y los errores en `other`. Custom y «otros», solo si traen datos.
 */
export const APP_PAGE_TEST_ID = 'entity-page-application'

export const appPage = (): Locator => page.getByTestId(APP_PAGE_TEST_ID)

/**
 * Ficha 0064 (C-03): «Reintentar» de un panel roto (PanelBoundary) ya no pide todas las consultas
 * activas de la app. Por defecto solo limpia el error y vuelve a pintar con la caché; los paneles
 * que deben recargar datos (gráfico de entidad, de Métricas, mini gráfico de evidencia, línea de
 * tiempo y tabla de Problemas) pasan su `refetch`. Se cuentan las peticiones al simulador.
 *
 * Para romper un panel sin tocar la app, se hace fallar una vez una llamada del DOM que el panel
 * hace en un efecto (los límites de error de React recogen los errores de los efectos):
 * `ResizeObserver.observe` del contenedor de un gráfico (`Chart`) o `scrollIntoView` de la tabla
 * de evidencias al desplegar una fila. El parche se quita solo tras fallar y `resetState` recarga.
 */
export const PANEL_FAILURE = 'Fallo de prueba del panel (0064)'

/** Ficha 0064: el siguiente `observe` del gráfico con ese testid (dentro de `scope`) lanza, una vez. */
export async function failChartMountOnce(
  testId: string,
  scope: string | null = null
): Promise<void> {
  await page.evaluate(
    ({ id, within, message }) => {
      const proto = ResizeObserver.prototype
      const original = proto.observe
      proto.observe = function (this: ResizeObserver, target, options) {
        if (
          target instanceof HTMLElement &&
          target.dataset['testid'] === id &&
          (within === null || target.closest(within) !== null)
        ) {
          proto.observe = original
          throw new Error(message)
        }
        return original.call(this, target, options)
      }
    },
    { id: testId, within: scope, message: PANEL_FAILURE }
  )
}

/** Ficha 0064: el error provocado lo escriben React y el log en consola: es el esperado y se quita. */
export function dropPanelFailureErrors(): void {
  const others = consoleErrors.filter((line) => !line.includes(PANEL_FAILURE))
  consoleErrors.splice(0, consoleErrors.length, ...others)
}

/** Ficha 0102: lo que se sale de una tarjeta de marcador y las palabras partidas en dos líneas. */
export type MarkerLayout = {
  /** `scrollWidth` y `clientWidth` de la tarjeta. */
  scrollWidth: number
  clientWidth: number
  /** Textos y elementos cuyo rectángulo se sale del de la tarjeta, con sus bordes. */
  outside: string[]
  /** Palabras (separadas por espacios) que ocupan más de una línea. */
  split: string[]
}

/**
 * Ficha 0102: mide una tarjeta de marcador ya pintada, con las cajas reales (no con el ancho
 * supuesto). Cada texto y cada elemento visible de dentro, contra el rectángulo de la tarjeta
 * (`Range.getClientRects` y `getBoundingClientRect`, con medio píxel de redondeo); y cada palabra
 * de los textos que no están dentro de `skipWords` (el título), con un `Range` propio: si da más
 * de un rectángulo, se ha partido.
 */
export async function markerLayout(card: Locator, skipWords = 'h2'): Promise<MarkerLayout> {
  await card.scrollIntoViewIfNeeded()
  await nextFrames()
  return card.evaluate(async (el, skip) => {
    await document.fonts.ready
    const box = el.getBoundingClientRect()
    const slack = 0.5
    const fits = (r: DOMRect): boolean =>
      r.left >= box.left - slack &&
      r.right <= box.right + slack &&
      r.top >= box.top - slack &&
      r.bottom <= box.bottom + slack
    const where = (r: DOMRect): string =>
      `[${r.left.toFixed(1)}, ${r.right.toFixed(1)}] × [${r.top.toFixed(1)}, ${r.bottom.toFixed(1)}]`
    const cardWhere = where(box)
    const outside: string[] = []
    const split: string[] = []

    // Elementos visibles (los de 1 px o menos, como los ocultos para lectores, no cuentan).
    for (const child of el.querySelectorAll<HTMLElement | SVGElement>('*')) {
      if (!child.checkVisibility()) continue
      const r = child.getBoundingClientRect()
      if (r.width <= 1 || r.height <= 1) continue
      if (!fits(r)) {
        const name = child.getAttribute('data-testid') ?? child.tagName.toLowerCase()
        outside.push(
          `<${name}> «${(child.textContent ?? '').trim()}» ${where(r)} fuera de ${cardWhere}`
        )
      }
    }

    // Textos, con sus rectángulos de línea, y sus palabras, una a una.
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const text = node.textContent ?? ''
      const parent = node.parentElement
      if (text.trim() === '' || parent === null || !parent.checkVisibility()) continue
      const whole = document.createRange()
      whole.selectNodeContents(node)
      for (const r of whole.getClientRects()) {
        if (r.width > 0 && !fits(r))
          outside.push(`«${text.trim()}» ${where(r)} fuera de ${cardWhere}`)
      }
      if (parent.closest(skip) !== null) continue
      for (const match of text.matchAll(/\S+/g)) {
        const word = document.createRange()
        word.setStart(node, match.index)
        word.setEnd(node, match.index + match[0].length)
        const lines = [...word.getClientRects()].filter((r) => r.width > 0)
        if (lines.length !== 1)
          split.push(`«${match[0]}» en «${text.trim()}»: ${lines.length} líneas`)
      }
    }
    return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, outside, split }
  }, skipWords)
}

/**
 * Ficha 0102 (CA1): en cada tarjeta, nada se sale de su caja: `scrollWidth <= clientWidth` y cada
 * rectángulo de texto o de elemento dentro del de la tarjeta.
 */
export async function expectMarkersInside(cards: Record<string, Locator>): Promise<void> {
  for (const [id, card] of Object.entries(cards)) {
    const layout = await markerLayout(card)
    expect(layout.scrollWidth, `scrollWidth de ${id}`).toBeLessThanOrEqual(layout.clientWidth)
    expect(layout.outside, `fuera de la tarjeta ${id}`).toEqual([])
  }
}

/**
 * Ficha 0102 (CA2): en cada tarjeta, ninguna palabra (número o unidad) del valor ni de las líneas
 * de debajo ocupa más de una línea.
 */
export async function expectMarkersUnsplit(cards: Record<string, Locator>): Promise<void> {
  for (const [id, card] of Object.entries(cards)) {
    const layout = await markerLayout(card)
    expect(layout.split, `palabras partidas en ${id}`).toEqual([])
  }
}
