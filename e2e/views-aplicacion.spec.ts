import { expect, type Locator, test } from '@playwright/test'
import {
  APPLICATION_ACTIONS,
  APPLICATION_BAND_CLOSED,
  APPLICATION_BAND_OPEN,
  APPLICATION_INFO_HTTP,
  APPLICATION_METHODS_SELECTOR,
  APPLICATION_METRICS_ID,
  APPLICATION_RUM,
  APPLICATION_SELECTOR,
  APPLICATION_TOP,
  INFO_FEW_ID,
  isRumQuery,
  METRIC_SELECTOR_MAX,
  MONITOR_BROWSER_ID,
  MONITOR_HTTP_ID,
  PROCESS_INFO_SERVICE_2,
  PROCESS_TIMESTAMPS,
  RUM_ERRORS,
  RUM_W,
  splitSelector
} from './views/fixtures'
import {
  clickInPlace,
  currentRoute,
  env,
  goTo,
  goToRoute,
  invoke,
  page,
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
  visibleNeighbours,
  APP_PAGE_TEST_ID,
  appPage
} from './views/helpers'

/**
 * Specs de vistas por zona (ficha 0070): la página de la aplicación web (`@aplicacion`). Arnés en
 * `e2e/views/` (ver su cabecera).
 */

setupViewsApp()

test(
  'CA6 (0033): entities:applicationMetrics por IPC con ids inventados: tres consultas, series, totales y las 10 acciones',
  { tag: '@aplicacion' },
  async () => {
    const data = await invoke<Record<string, unknown>>('entities:applicationMetrics', {
      environmentId: env['Producción'],
      entityId: APPLICATION_METRICS_ID,
      timeRange: '2h'
    })
    // Tres consultas al simulador, todas con el rango: series y totales (Inf) con entityId de la
    // aplicación, y las acciones (Inf) con el selector de sus acciones.
    expect(sim.applicationMetricQueries).toHaveLength(3)
    for (const query of sim.applicationMetricQueries) expect(query.get('from')).toBe('now-2h')
    const app = sim.applicationMetricQueries.filter(
      (q) => q.get('entitySelector') === APPLICATION_SELECTOR
    )
    expect(app.map((q) => q.get('resolution') ?? 'API').sort()).toEqual(['API', 'Inf'])
    const actions = sim.applicationMetricQueries.filter(
      (q) => q.get('entitySelector') === APPLICATION_METHODS_SELECTOR
    )
    expect(actions).toHaveLength(1)
    expect(actions[0]?.get('resolution')).toBe('Inf')
    expect(actions[0]?.get('metricSelector')).toContain(
      `builtin:apps.web.action.duration.xhr.browser${APPLICATION_TOP}:count:names`
    )

    const series = (values: (number | null)[]): { timestamps: number[]; values: unknown[] } => ({
      timestamps: PROCESS_TIMESTAMPS,
      values
    })
    const [load] = APPLICATION_ACTIONS['load']!
    const [catalog, cart] = APPLICATION_ACTIONS['xhr']!
    expect(data).toMatchObject({
      resolution: '10m',
      series: {
        apdex: series([0.95, null, 0.81]),
        actions: series([60, 75, null]),
        duration: series([1_200, null, 1_640.5]),
        errors: series([2, null, 5]),
        sessions: series([8, 11, null])
      },
      totals: { apdex: 0.88, actions: 135, duration: 1_420.75, errors: 7, sessions: 19 },
      // Las de los tres tipos juntas, de más a menos recuento.
      topActions: [
        { id: catalog!.id, name: catalog!.name, count: 140, duration: 320.5 },
        { id: load!.id, name: load!.name, count: 90, duration: 1_510 },
        { id: cart!.id, name: cart!.name, count: 25, duration: 410 }
      ],
      warnings: [],
      partial: []
    })
  }
)

test(
  'CA5 (0052): entities:applicationRum por IPC con ids inventados: solo métricas clásicas, de 10 en 10, series y totales por papel',
  { tag: '@aplicacion' },
  async () => {
    const data = await invoke<Record<string, unknown>>('entities:applicationRum', {
      environmentId: env['Producción'],
      entityId: APPLICATION_METRICS_ID,
      timeRange: '2h'
    })
    // Las consultas llegan al simulador (métricas clásicas), con el id, el rango y como mucho 10
    // expresiones; cada expresión, una vez en las series y otra en los totales (Inf).
    const queries = sim.applicationMetricQueries
    expect(queries.length).toBeGreaterThanOrEqual(4)
    const expressions = (inf: boolean): string[] =>
      queries
        .filter((q) => (q.get('resolution') === 'Inf') === inf)
        .flatMap((q) => splitSelector(q.get('metricSelector') ?? ''))
        .sort()
    const expected = [
      ...Object.keys(APPLICATION_RUM),
      RUM_ERRORS,
      `${RUM_W}actionCount.custom.browser:splitBy():sum`,
      `${RUM_W}actionDuration.custom.browser:splitBy():avg`,
      `${RUM_W}event.count.rageClick:splitBy():sum`
    ].sort()
    expect(expressions(false)).toEqual(expected)
    expect(expressions(true)).toEqual(expected)
    for (const query of queries) {
      expect(query.get('entitySelector')).toBe(APPLICATION_SELECTOR)
      expect(query.get('from')).toBe('now-2h')
      expect(splitSelector(query.get('metricSelector') ?? '').length).toBeLessThanOrEqual(
        METRIC_SELECTOR_MAX
      )
    }

    const rum = (expression: string): { timestamps: number[]; values: unknown[] } => ({
      timestamps: PROCESS_TIMESTAMPS,
      values: APPLICATION_RUM[`${RUM_W}${expression}`]!.series
    })
    const total = (expression: string): number => APPLICATION_RUM[`${RUM_W}${expression}`]!.total
    const none = { timestamps: [], values: [] }
    expect(data).toMatchObject({
      resolution: '10m',
      series: {
        actionsByType: {
          load: rum('actionCount.load.browser:splitBy():sum'),
          xhr: rum('actionCount.xhr.browser:splitBy():sum'),
          custom: none
        },
        durationByType: {
          load: rum('actionDuration.load.browser:splitBy():avg'),
          xhr: rum('actionDuration.xhr.browser:splitBy():avg'),
          custom: none
        },
        errorsByType: {
          javascript: { timestamps: PROCESS_TIMESTAMPS, values: [1, null, 4] },
          http: { timestamps: PROCESS_TIMESTAMPS, values: [6, 3, null] },
          other: none
        },
        affectedActionsPct: rum('percentageOfUserActionsAffectedByErrors:splitBy()'),
        activeUsers: rum('activeUsersEst:splitBy()'),
        sessions: {
          started: rum('startedSessions:splitBy():sum'),
          ended: rum('endedSessions:splitBy():sum')
        },
        sessionDuration: rum('sessionDuration:splitBy():avg'),
        actionsPerSession: rum('actionsPerSession:splitBy():avg'),
        bounceRate: rum('bouncedSessionRatio:splitBy()'),
        vitals: {
          lcp: rum('largestContentfulPaint.load.browser:splitBy():percentile(75)'),
          cls: rum('cumulativeLayoutShift.load.browser:splitBy():percentile(75)'),
          inp: rum('interactionToNextPaint:splitBy():percentile(75)')
        },
        rageClicks: none
      },
      totals: {
        actionsByType: {
          load: total('actionCount.load.browser:splitBy():sum'),
          xhr: total('actionCount.xhr.browser:splitBy():sum'),
          custom: null
        },
        durationByType: {
          load: total('actionDuration.load.browser:splitBy():avg'),
          xhr: total('actionDuration.xhr.browser:splitBy():avg'),
          custom: null
        },
        errorsByType: { javascript: 5, http: 9, other: null },
        affectedActionsPct: total('percentageOfUserActionsAffectedByErrors:splitBy()'),
        activeUsers: total('activeUsersEst:splitBy()'),
        sessions: {
          started: total('startedSessions:splitBy():sum'),
          ended: total('endedSessions:splitBy():sum')
        },
        sessionDuration: total('sessionDuration:splitBy():avg'),
        actionsPerSession: total('actionsPerSession:splitBy():avg'),
        bounceRate: total('bouncedSessionRatio:splitBy()'),
        vitals: {
          lcp: total('largestContentfulPaint.load.browser:splitBy():percentile(75)'),
          cls: total('cumulativeLayoutShift.load.browser:splitBy():percentile(75)'),
          inp: total('interactionToNextPaint:splitBy():percentile(75)')
        },
        rageClicks: null
      }
    })
  }
)

test(
  'CA5 (0052): entities:applicationRum con un 400 del simulador acaba en error con reason',
  { tag: '@aplicacion' },
  async () => {
    sim.applicationMetricsFail = true
    // invoke lanza con el error del sobre: lleva el reason de la 0033.
    await expect(
      invoke('entities:applicationRum', {
        environmentId: env['Producción'],
        entityId: APPLICATION_METRICS_ID,
        timeRange: '2h'
      })
    ).rejects.toThrow(/"key":"applicationMetricsRejected"/)
  }
)
type AppChartKind =
  | 'apdex'
  | 'actionsByType'
  | 'durationByType'
  | 'errorsByType'
  | 'affectedActions'
  | 'activeUsers'
  | 'sessions'
  | 'vitals'
type AppSection = 'activity' | 'errors' | 'users' | 'experience' | 'apdex' | 'key-actions'
const APP_MARKERS = ['apdex', 'users', 'sessions', 'actions', 'errors', 'problems'] as const
const APP_MARKER_LABELS: Record<string, string> = {
  apdex: 'Apdex',
  users: 'Usuarios activos',
  sessions: 'Sesiones',
  actions: 'Acciones',
  errors: 'Errores',
  problems: 'Problemas'
}
const APP_SECTIONS: AppSection[] = [
  'activity',
  'errors',
  'users',
  'experience',
  'apdex',
  'key-actions'
]
const APP_SECTION_TITLES: Record<AppSection, string> = {
  activity: 'Actividad',
  errors: 'Errores',
  users: 'Usuarios y sesiones',
  experience: 'Experiencia',
  apdex: 'Apdex',
  'key-actions': 'Acciones clave'
}
const APP_SECTION_CHARTS: Record<AppSection, AppChartKind[]> = {
  activity: ['actionsByType', 'durationByType'],
  errors: ['errorsByType', 'affectedActions'],
  users: ['activeUsers', 'sessions'],
  experience: ['vitals'],
  apdex: ['apdex'],
  'key-actions': []
}
const APP_CHART_TITLES: Record<AppChartKind, RegExp> = {
  apdex: /Apdex/,
  actionsByType: /Acciones por tipo/,
  durationByType: /Duración por tipo/,
  errorsByType: /Errores por tipo/,
  affectedActions: /Acciones afectadas por errores/,
  activeUsers: /Usuarios activos/,
  sessions: /Sesiones/,
  vitals: /Core Web Vitals|LCP|Experiencia/
}
/** Los nombres de las series por tipo (es): load, XHR, custom, JavaScript, HTTP y otros. */
const APP_SERIES = {
  load: /load|carga/i,
  xhr: /xhr/i,
  custom: /custom|personalizad/i,
  javascript: /javascript/i,
  http: /http/i
}
const APP_ACTION_COLUMNS = ['name', 'count', 'duration'] as const
/** Las acciones del simulador, de más a menos recuento (como las da el canal). */
const APP_ACTIONS_BY_COUNT = Object.values(APPLICATION_ACTIONS)
  .flat()
  .sort((a, b) => b.count - a.count)
/** La duración media de cada acción en la tabla (es). */
const APP_ACTION_DURATION: Record<string, RegExp> = {
  'APPLICATION_METHOD-00000000000E2E35': /(^|[^\d,.])321\sms/,
  'APPLICATION_METHOD-00000000000E2E34': /(^|[^\d,.])1,5\ss/,
  'APPLICATION_METHOD-00000000000E2E36': /(^|[^\d,.])410\sms/
}
const appMarker = (id: string): Locator => appPage().getByTestId(`application-marker-${id}`)
const appMarkerValue = (id: string): Locator =>
  appMarker(id).getByTestId('application-marker-value')
const appMarkerSecondary = (id: string): Locator =>
  appMarker(id).getByTestId('application-marker-secondary')
const appSection = (id: AppSection): Locator =>
  appPage().locator(`[data-testid="application-section"][data-section="${id}"]`)
const appChartPanel = (kind: AppChartKind): Locator =>
  appPage().locator(`[data-testid="application-chart-panel"][data-kind="${kind}"]`)
const appChartPlot = (kind: AppChartKind): Locator =>
  appChartPanel(kind).getByTestId(`application-chart-${kind}`)
const appBand = (kind: AppChartKind = 'apdex'): Locator =>
  appChartPanel(kind).getByTestId('application-problem-band')
const appSegment = (problemId: string, kind: AppChartKind = 'apdex'): Locator =>
  appBand(kind).locator(
    `[data-testid="application-problem-segment"][data-problem-id="${problemId}"]`
  )
const appActions = (): Locator => appPage().getByTestId('application-actions')
const appActionRow = (id: string): Locator =>
  appActions().locator(`[data-testid="application-action-row"][data-action-id="${id}"]`)
const appInfoCard = (): Locator => appPage().getByTestId('application-info')
const appInfoRow = (key: string): Locator =>
  appInfoCard().locator(`[data-testid="application-info-row"][data-key="${key}"]`)
const appInfoValue = (key: string): Locator => appInfoRow(key).getByTestId('application-info-value')
const appInfoGroup = (key: string): Locator =>
  appInfoCard().locator(`[data-testid="application-info-group"][data-group="${key}"]`)
const appInfoEntity = (group: string, id: string): Locator =>
  appInfoGroup(group).locator(`[data-testid="application-info-entity"][data-entity-id="${id}"]`)

/** Ficha 0034: abre por URL la página de la aplicación de la ficha. */
async function openApplicationPage(): Promise<Locator> {
  await goToRoute(`/entities/APPLICATION/${APPLICATION_METRICS_ID}`)
  const entityPage = appPage()
  await expect(entityPage).toBeVisible()
  return entityPage
}

/** Ficha 0034: espera a que el gráfico tenga sus series y las devuelve. */
async function appChartSeries(kind: AppChartKind): Promise<string[]> {
  const plot = appChartPlot(kind)
  await expect(plot.locator('canvas').first(), kind).toBeVisible()
  await expect(plot, kind).toHaveAttribute('data-series', /\[.+\]/)
  return JSON.parse((await plot.getAttribute('data-series')) ?? '[]') as string[]
}

/** Ficha 0053: comprueba que el gráfico lleva exactamente esas series, en ese orden. */
async function expectAppChartSeries(kind: AppChartKind, patterns: RegExp[]): Promise<void> {
  const series = await appChartSeries(kind)
  expect(series, kind).toHaveLength(patterns.length)
  for (const [index, pattern] of patterns.entries()) {
    expect(series[index], `${kind}[${index}]`).toMatch(pattern)
  }
}

/** Los `data-kind` de los paneles de gráficos de la página (o de una sección), en su orden. */
async function appChartKinds(section?: AppSection): Promise<string[]> {
  const root = section === undefined ? appPage() : appSection(section)
  return root
    .getByTestId('application-chart-panel')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-kind') ?? ''))
}

/** Ficha 0053: los `data-section` de las secciones, en el orden en que se pintan. */
async function appSectionIds(): Promise<string[]> {
  return appPage()
    .getByTestId('application-section')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-section') ?? ''))
}

/** Ficha 0053: los marcadores de la fila (sus ids), en el orden en que se pintan. */
async function appMarkerIds(): Promise<string[]> {
  const known = APP_MARKERS.map((id) => `application-marker-${id}`)
  return appPage()
    .getByTestId('application-markers')
    .locator('[data-testid^="application-marker-"]')
    .evaluateAll(
      (els, ids) =>
        els
          .map((el) => el.getAttribute('data-testid') ?? '')
          .filter((testId) => ids.includes(testId))
          .map((testId) => testId.replace('application-marker-', '')),
      known
    )
}

/** Ficha 0034: los ids de las filas de la tabla de acciones, en el orden en que se pintan. */
const appActionOrder = (): Promise<string[]> =>
  tableOrder(appActions(), 'application-action-row', 'data-action-id')

/** Ficha 0034: despliega un grupo de relaciones de la aplicación (si no lo está). */
async function expandAppInfoGroup(key: string): Promise<Locator> {
  const group = appInfoGroup(key)
  const toggle = group.getByTestId('application-info-group-toggle')
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await clickInPlace(toggle, { scroll: true })
  }
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  return group
}

/** Ficha 0034: el marcador del Apdex con el valor del simulador (0,88, «Buena»). */
async function expectAppApdexMarker(): Promise<void> {
  // Apdex: 0,88 del rango, categoría «Buena» (≥ 0,85 y < 0,94), con su color.
  await expect(appMarkerValue('apdex')).toHaveText(/^\s*0,88\s*$/)
  await expect(appMarker('apdex')).toContainText('Buena')
  await expect(appMarkerValue('apdex')).toHaveAttribute('data-level', 'success')
}

/** Ficha 0053: usuarios activos, 1234 en el rango, con «estimado» debajo. */
async function expectAppUsersMarker(): Promise<void> {
  await expect(appMarkerValue('users')).toHaveText(loneNumber('1.234'))
  await expect(appMarkerSecondary('users')).toContainText(/estimad/i)
}

/** Ficha 0053: sesiones iniciadas (19); debajo, duración media (45,6 s) y rebote (28,4 %). */
async function expectAppSessionsMarker(): Promise<void> {
  await expect(appMarkerValue('sessions')).toHaveText(loneNumber('19'))
  const secondary = appMarkerSecondary('sessions')
  // 45 600 000 µs de media → 45,6 s.
  await expect(secondary).toContainText(/(^|[^\d,.])45,6\ss/)
  await expect(secondary).toContainText(/(^|[^\d,.])28,4\s?%/)
}

/** Ficha 0053: acciones, 9640 load + 21 400 XHR; sin custom (no trae datos). */
async function expectAppActionsMarker(): Promise<void> {
  await expect(appMarkerValue('actions')).toHaveText(loneNumber('31.040'))
  const secondary = appMarkerSecondary('actions')
  await expect(secondary).toContainText(APP_SERIES.load)
  await expect(secondary).toContainText(loneNumber('9.640'))
  await expect(secondary).toContainText(APP_SERIES.xhr)
  await expect(secondary).toContainText(loneNumber('21.400'))
  await expect(secondary).not.toContainText(APP_SERIES.custom)
}

/** Ficha 0053: errores, 5 de JavaScript + 9 HTTP, con el color de error. */
async function expectAppErrorsMarker(): Promise<void> {
  await expect(appMarkerValue('errors')).toHaveText(loneNumber('14'))
  await expect(appMarkerValue('errors')).toHaveAttribute('data-level', 'error')
  const secondary = appMarkerSecondary('errors')
  await expect(secondary).toContainText('JavaScript')
  await expect(secondary).toContainText(loneNumber('5'))
  await expect(secondary).toContainText('HTTP')
  await expect(secondary).toContainText(loneNumber('9'))
}

/** Ficha 0034: el marcador de problemas, uno abierto y uno cerrado. */
async function expectAppProblemsMarker(): Promise<void> {
  await expect(appMarker('problems').getByTestId('application-marker-open')).toHaveText(
    loneNumber('1')
  )
  await expect(appMarker('problems').getByTestId('application-marker-closed')).toHaveText(
    loneNumber('1')
  )
}

/** Ficha 0053: los seis marcadores con los valores del simulador. */
async function expectAppMarkers(): Promise<void> {
  await expectAppApdexMarker()
  await expectAppUsersMarker()
  await expectAppSessionsMarker()
  await expectAppActionsMarker()
  await expectAppErrorsMarker()
  await expectAppProblemsMarker()
}

/**
 * Ficha 0054: secciones «Usuarios y sesiones» y «Experiencia». Nombres que fijan estos tests (la
 * ficha no los da; decisión del test-writer, delegada por Dani y refinable):
 * - Gráficos, como los de la 0053 (`application-chart-panel` con `data-kind`): activeUsers
 *   (una serie de usuarios, con la nota de estimación `application-users-note` en el panel) y
 *   sessions (series iniciadas, terminadas y duración media, en ese orden); vitals (LCP, CLS e
 *   INP, en ese orden, con `data-thresholds` en los cortes de «bueno»: 2500 ms, 0,1 y 200 ms).
 *   Ninguno lleva la franja de problemas (la ficha no la pide).
 * - Datos pequeños bajo el gráfico de sesiones: `application-session-stat` con `data-stat`
 *   (actionsPerSession, bounceRate y rageClicks, en ese orden), dentro del panel sessions, con
 *   su valor en `application-session-stat-value`.
 * - Tarjetas de Core Web Vitals, en la sección experience y encima del gráfico:
 *   `application-vital` con `data-vital` (lcp, cls e inp, en ese orden), el valor del rango en
 *   `application-vital-value` (LCP e INP con `formatDurationMs`, CLS con dos decimales) y la
 *   calificación en `application-vital-rating`, con `data-rating` (good, needsImprovement o
 *   poor), `data-level` (success, warning o error) y su texto.
 * - Una sección sin nada con datos no sale (como en la 0053).
 */
type AppVital = 'lcp' | 'cls' | 'inp'
const APP_VITALS: AppVital[] = ['lcp', 'cls', 'inp']
/** Totales del simulador: LCP 2310 ms, CLS 0,18 e INP 640 ms. */
const APP_VITAL_EXPECTED: Record<
  AppVital,
  { label: RegExp; value: RegExp; rating: string; level: string; text: string }
> = {
  lcp: {
    label: /LCP/,
    value: /(^|[^\d,.])2,3\ss/,
    rating: 'good',
    level: 'success',
    text: 'Bueno'
  },
  cls: {
    label: /CLS/,
    value: /(^|[^\d,.])0,18([^\d,.]|$)/,
    rating: 'needsImprovement',
    level: 'warning',
    text: 'Mejorable'
  },
  inp: {
    label: /INP/,
    value: /(^|[^\d,.])640\sms/,
    rating: 'poor',
    level: 'error',
    text: 'Pobre'
  }
}
const APP_SESSION_STATS = ['actionsPerSession', 'bounceRate', 'rageClicks'] as const
const appVital = (vital: AppVital): Locator =>
  appPage().locator(`[data-testid="application-vital"][data-vital="${vital}"]`)
const appSessionStat = (stat: string): Locator =>
  appChartPanel('sessions').locator(`[data-testid="application-session-stat"][data-stat="${stat}"]`)
/** Ficha 0054: los `data-stat` de los datos pequeños de sesiones, en su orden. */
async function appSessionStatIds(): Promise<string[]> {
  return appChartPanel('sessions')
    .getByTestId('application-session-stat')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-stat') ?? ''))
}
/** Ficha 0054: los `data-vital` de las tarjetas, en su orden. */
async function appVitalIds(): Promise<string[]> {
  return appPage()
    .getByTestId('application-vital')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-vital') ?? ''))
}

/** Ficha 0053: las consultas del canal de RUM que ha recibido el simulador. */
const appRumQueries = (): URLSearchParams[] => sim.applicationMetricQueries.filter(isRumQuery)

test(
  'CA1 (0034): la página de una aplicación enseña sus marcadores, el gráfico del Apdex y la tabla de acciones de usuario con los valores del simulador, sin «Página en construcción»',
  { tag: '@aplicacion' },
  async () => {
    const entityPage = await openApplicationPage()

    // Marcadores (ficha 0053: los seis los mira CA1 de la 0053): Apdex y problemas.
    const row = entityPage.getByTestId('application-markers')
    await expect(row).toBeVisible()
    await expectAppApdexMarker()
    await expectAppProblemsMarker()

    // El gráfico del Apdex se queda (ficha 0053), en su sección, con una serie.
    await expect(appSection('apdex')).toBeVisible()
    expect(await appChartKinds('apdex')).toEqual(['apdex'])
    await expect(appChartPanel('apdex').getByRole('heading').first()).toContainText('Apdex')
    expect(await appChartSeries('apdex')).toHaveLength(1)
    // Los gráficos de la 0034 de acciones, duración y errores totales ya no están (ficha 0053).
    for (const old of ['actions', 'duration', 'errors']) {
      await expect(
        entityPage.locator(`[data-testid="application-chart-panel"][data-kind="${old}"]`),
        old
      ).toHaveCount(0)
    }

    // Tabla de acciones (en «Acciones clave», ficha 0053): las tres, de más a menos acciones, con
    // nombre, recuento y duración media (con barra).
    const card = appActions()
    await expect(card).toBeVisible()
    await expect(appSection('key-actions').getByTestId('application-actions')).toHaveCount(1)
    const grid = card.getByTestId('application-actions-grid')
    await expect(grid).toHaveAttribute('role', 'grid')
    expect(await gridColumns(grid)).toEqual(APP_ACTION_COLUMNS.map((c) => `col-${c}`))
    await expect(grid.getByTestId('col-count')).toHaveAttribute('aria-sort', 'descending')
    await expect(card.getByTestId('application-action-row')).toHaveCount(3)
    expect(await appActionOrder()).toEqual(APP_ACTIONS_BY_COUNT.map((a) => a.id))
    for (const action of APP_ACTIONS_BY_COUNT) {
      const cells = appActionRow(action.id).getByRole('gridcell')
      await expect(cells, action.name).toHaveCount(APP_ACTION_COLUMNS.length)
      await expect(cells.nth(0), action.name).toHaveText(action.name)
      await expect(cells.nth(1), action.name).toHaveText(loneNumber(String(action.count)))
      await expect(cells.nth(2), action.name).toContainText(APP_ACTION_DURATION[action.id] ?? /^$/)
      await expect(
        cells.nth(2).getByTestId('application-action-duration-bar'),
        action.name
      ).toHaveCount(1)
    }
    await expect(card.getByTestId('application-actions-empty')).toHaveCount(0)

    // Orden por columna: por duración media, y al revés pulsando otra vez.
    const byDuration = APP_ACTIONS_BY_COUNT.slice()
      .sort((a, b) => a.avg - b.avg)
      .map((a) => a.id)
    expect(byDuration).not.toEqual(APP_ACTIONS_BY_COUNT.map((a) => a.id))
    expect(byDuration.slice().reverse()).not.toEqual(APP_ACTIONS_BY_COUNT.map((a) => a.id))
    await clickInPlace(grid.getByTestId('sort-duration'), { scroll: true })
    const durationCol = grid.getByTestId('col-duration')
    await expect(durationCol).toHaveAttribute('aria-sort', /^(ascending|descending)$/)
    await expect(grid.getByTestId('col-count')).toHaveAttribute('aria-sort', 'none')
    const durationAsc = (await durationCol.getAttribute('aria-sort')) === 'ascending'
    expect(await appActionOrder()).toEqual(durationAsc ? byDuration : byDuration.slice().reverse())
    await clickInPlace(grid.getByTestId('sort-duration'), { scroll: true })
    await expect(durationCol).toHaveAttribute('aria-sort', durationAsc ? 'descending' : 'ascending')
    expect(await appActionOrder()).toEqual(durationAsc ? byDuration.slice().reverse() : byDuration)

    // Ni el bloque ni el texto de «Página en construcción», ni marcadores de otro tipo.
    await expect(entityPage.getByTestId('entity-under-construction')).toHaveCount(0)
    await expect(entityPage).not.toContainText('Página en construcción')
    for (const other of [
      'service-markers',
      'host-markers',
      'monitor-markers',
      'process-markers',
      'process-group-markers'
    ]) {
      await expect(page.getByTestId(other), other).toHaveCount(0)
    }

    // Las consultas del canal, con el rango global.
    await settledRequests()
    expect(sim.applicationMetricQueries.length).toBeGreaterThanOrEqual(2)
    for (const query of sim.applicationMetricQueries) {
      expect(query.get('from')).toBe('now-2h')
    }
  }
)

test(
  'CA1 (0034), nota del Orquestador: sin acciones de usuario en el rango (lo habitual en vivo), la tabla lo dice y el resto de la página sale igual',
  { tag: '@aplicacion' },
  async () => {
    sim.applicationActionsEmpty = true
    await openApplicationPage()

    const card = appActions()
    await expect(card).toBeVisible()
    const empty = card.getByTestId('application-actions-empty')
    await expect(empty).toBeVisible()
    await expect(empty).not.toHaveText(/^\s*$/)
    await expect(card.getByTestId('application-action-row')).toHaveCount(0)
    // Sin aviso de error ni Reintentar: no es un fallo.
    await expect(card.getByRole('alert')).toHaveCount(0)
    await expect(card.getByRole('button', { name: 'Reintentar' })).toHaveCount(0)
    for (const text of ['undefined', 'null', 'NaN', '[object Object]']) {
      await expect(card, text).not.toContainText(text)
    }

    // Marcadores y gráficos, como siempre (ficha 0053: seis marcadores y cinco gráficos; ficha
    // 0054: tres más, usuarios, sesiones y Core Web Vitals).
    await expectAppMarkers()
    await expect(appPage().getByTestId('application-chart-panel')).toHaveCount(8)
  }
)

test(
  'CA3 (0034): con papeles sin datos (Apdex y errores), sus marcadores y gráficos no salen y el resto sí',
  { tag: '@aplicacion' },
  async () => {
    // Ficha 0053: 'errors' deja sin series countOfErrors en los dos canales (total y por tipo).
    sim.applicationEmpty = ['apdex', 'errors']
    const entityPage = await openApplicationPage()

    // Los de usuarios, sesiones y acciones, con sus valores; el de problemas, también.
    await expectAppUsersMarker()
    await expectAppSessionsMarker()
    await expectAppActionsMarker()
    await expectAppProblemsMarker()
    expect(await appMarkerIds()).toEqual(['users', 'sessions', 'actions', 'problems'])
    // Gráficos: la actividad entera y las acciones afectadas, con sus series (ficha 0054: y los de
    // usuarios, sesiones y Core Web Vitals).
    expect(await appChartKinds()).toEqual([
      'actionsByType',
      'durationByType',
      'affectedActions',
      'activeUsers',
      'sessions',
      'vitals'
    ])
    for (const kind of ['actionsByType', 'durationByType', 'affectedActions'] as const) {
      expect((await appChartSeries(kind)).length, kind).toBeGreaterThan(0)
    }

    // Los del Apdex y los errores no salen (ni marcador ni gráfico), ni un «—» en su lugar.
    for (const role of ['apdex', 'errors'] as const) {
      await expect(appMarker(role), role).toHaveCount(0)
    }
    for (const kind of ['apdex', 'errorsByType'] as const) {
      await expect(appChartPanel(kind), kind).toHaveCount(0)
      await expect(entityPage.getByTestId(`application-chart-${kind}`), kind).toHaveCount(0)
    }
    // La tabla de acciones sigue.
    await expect(appActions().getByTestId('application-action-row')).toHaveCount(3)
    // Ningún aviso de error en la página: faltar datos no es un fallo.
    await expect(entityPage.getByRole('button', { name: 'Reintentar' })).toHaveCount(0)
  }
)

test(
  'CA4 (0034): la franja de problemas sale sobre el gráfico del Apdex con los problemas de la aplicación, y pulsar un tramo abre el problema',
  { tag: '@aplicacion' },
  async () => {
    await openApplicationPage()
    await appChartSeries('apdex')
    const band = appBand()
    await expect(band).toBeVisible()
    await expect(band.getByTestId('application-problem-segment')).toHaveCount(2)
    for (const { problemId } of [APPLICATION_BAND_OPEN, APPLICATION_BAND_CLOSED]) {
      await expect(appSegment(problemId), problemId).toHaveCount(1)
    }
    // En el panel del Apdex y (ficha 0053) en el de la duración por tipo; en ningún otro.
    await expect(page.getByTestId('application-problem-band')).toHaveCount(2)
    await expect(appBand('durationByType')).toHaveCount(1)

    // La lista se pide con la aplicación y el rango global.
    await settledRequests()
    const lists = sim.entityProblemListQueries.filter((query) =>
      (query.get('problemSelector') ?? '').includes(APPLICATION_METRICS_ID)
    )
    expect(lists).toHaveLength(1)
    expect(lists[0]?.get('problemSelector')).toBe(`affectedEntities("${APPLICATION_METRICS_ID}")`)
    expect(lists[0]?.get('from')).toBe('now-2h')

    // Encima del gráfico: la franja acaba antes de que empiece el canvas.
    const bandBox = await settledBox(band)
    const plotBox = await settledBox(appChartPlot('apdex'))
    expect(bandBox.y + bandBox.height).toBeLessThanOrEqual(plotBox.y + 1)

    // Pulsar un tramo abre ese problema; «Volver» regresa a la aplicación.
    await clickInPlace(appSegment(APPLICATION_BAND_CLOSED.problemId), { scroll: true })
    await expect(page.getByTestId('problem-page')).toBeVisible()
    await expect(page.getByTestId('problem-page-title')).toContainText(
      APPLICATION_BAND_CLOSED.displayId
    )
    expect(await currentRoute()).toBe(`/problems/${APPLICATION_BAND_CLOSED.problemId}`)
    await page.getByTestId('problem-back').click()
    await expect(appPage()).toBeVisible()
    expect(await currentRoute()).toBe(`/entities/APPLICATION/${APPLICATION_METRICS_ID}`)
  }
)

test(
  'CA5 (0034): la tarjeta «Información» de la aplicación sale la última, con sus filas, sus relaciones («Llama a», «Monitores sintéticos» y «Otras»), «Ver nombres» y enlaces',
  { tag: '@aplicacion' },
  async () => {
    const entityPage = await openApplicationPage()
    const card = appInfoCard()
    await expect(card).toBeVisible()
    await expect(card).toContainText('Información')
    await expect(card.getByTestId('application-info-row').first()).toBeVisible()
    // Ficha 0053: marcadores y secciones (actividad, errores, Apdex y acciones clave).
    const sections: [string, Locator][] = [
      ['application-markers', entityPage.getByTestId('application-markers')],
      ...APP_SECTIONS.map((id): [string, Locator] => [id, appSection(id)])
    ]
    for (const [id, section] of sections) await expect(section, id).toBeVisible()

    // La última sección: nada visible detrás; marcadores y secciones, encima.
    expect(await visibleNeighbours(APP_PAGE_TEST_ID, 'application-info', 'after')).toEqual([])
    const infoBox = await settledBox(card)
    for (const [id, section] of sections) {
      const box = await settledBox(section)
      expect(box.y + box.height, `${id} encima de «Información»`).toBeLessThanOrEqual(infoBox.y + 1)
    }

    // Filas con las claves vistas en vivo.
    await expect(appInfoValue('applicationType')).toContainText('MANUALLY_INJECTED')
    await expect(appInfoValue('applicationInjectionType')).toContainText('AUTO_INJECTED')
    await expect(appInfoValue('customizedName')).toContainText('tienda-personalizada-e2e')
    await expect(appInfoValue('detectedName')).toContainText('tienda-detectada-e2e')
    for (const text of ['undefined', 'null', 'NaN', '[object Object]']) {
      await expect(card, text).not.toContainText(text)
    }

    // Relaciones: «Llama a» (servicios), «Monitores sintéticos» y «Otras».
    const relations = card.getByTestId('application-info-relations')
    const groups = relations.getByTestId('application-info-group')
    await expect(groups).toHaveCount(3)
    expect(await dataKeys(groups, 'data-group')).toEqual(['calls', 'synthetic', 'other'])
    for (const [key, title, count] of [
      ['calls', 'Llama a', '2'],
      ['synthetic', 'Monitores sintéticos', '3'],
      ['other', 'Otras', '4']
    ] as const) {
      await expect(appInfoGroup(key), key).toContainText(title)
      await expect(appInfoGroup(key).getByTestId('application-info-group-count'), key).toHaveText(
        new RegExp(`^\\s*${count}\\s*$`)
      )
    }

    // «Ver nombres» de los servicios: una llamada con sus dos ids y los nombres en su sitio.
    const calls = await expandAppInfoGroup('calls')
    await settledRequests()
    const namesBefore = sim.entityNamesQueries.length
    await clickInPlace(calls.getByTestId('application-info-names'), { scroll: true })
    await expect.poll(() => sim.entityNamesQueries.length).toBe(namesBefore + 1)
    const selector = sim.entityNamesQueries[namesBefore]?.get('entitySelector') ?? ''
    for (const [id, name] of [
      [INFO_FEW_ID, 'info-pocas-e2e'],
      [PROCESS_INFO_SERVICE_2, 'servicio-proceso-e2e']
    ] as const) {
      expect(selector).toContain(id)
      await expect(
        appInfoEntity('calls', id).getByTestId('application-info-entity-name')
      ).toHaveText(name)
    }

    // Enlaces: un servicio a su página y los monitores a la suya (browser y HTTP).
    await expect(appInfoEntity('calls', INFO_FEW_ID)).toHaveAttribute(
      'href',
      new RegExp(`#/entities/SERVICE/${INFO_FEW_ID}$`)
    )
    await expandAppInfoGroup('synthetic')
    for (const [id, type] of [
      [MONITOR_BROWSER_ID, 'SYNTHETIC_TEST'],
      [MONITOR_HTTP_ID, 'HTTP_CHECK'],
      [APPLICATION_INFO_HTTP, 'HTTP_CHECK']
    ] as const) {
      await expect(appInfoEntity('synthetic', id), id).toHaveAttribute(
        'href',
        new RegExp(`#/entities/${type}/${id}$`)
      )
    }
    const other = await expandAppInfoGroup('other')
    await expect(other).toContainText('isApplicationMethodOf')
    await expect(other).toContainText('isGroupOf')

    // Pulsar el servicio abre su página.
    await clickInPlace(appInfoEntity('calls', INFO_FEW_ID), { scroll: true })
    await expect(page.getByTestId('entity-page-service')).toBeVisible()
    expect(await currentRoute()).toBe(`/entities/SERVICE/${INFO_FEW_ID}`)
  }
)

// ---------------------------------------------------------------------------
// Ficha 0053: página de la aplicación con los marcadores nuevos y las secciones «Actividad» y
// «Errores» (canal entities:applicationRum de la 0052). Nombres y decisiones, en el comentario
// de la página de la aplicación (ficha 0034).
// ---------------------------------------------------------------------------

test(
  'CA1 (0053): la página de una aplicación enseña los seis marcadores, en su orden, con sus valores formateados y sus líneas de debajo',
  { tag: '@aplicacion' },
  async () => {
    const entityPage = await openApplicationPage()
    const row = entityPage.getByTestId('application-markers')
    await expect(row).toBeVisible()
    for (const id of APP_MARKERS) {
      await expect(appMarker(id), id).toBeVisible()
      await expect(appMarker(id), id).toContainText(APP_MARKER_LABELS[id] ?? id)
    }
    expect(await appMarkerIds()).toEqual([...APP_MARKERS])
    // Ni el de duración de la 0034.
    await expect(appMarker('duration')).toHaveCount(0)

    // Valores: Apdex 0,88 «Buena»; usuarios 1.234 «estimado»; sesiones 19 con 45,6 s · 28,4 %;
    // acciones 31.040 con load 9.640 · XHR 21.400; errores 14 con JavaScript 5 · HTTP 9;
    // problemas 1 abierto y 1 cerrado.
    await expectAppMarkers()
    for (const text of ['undefined', 'null', 'NaN', '[object Object]']) {
      await expect(row, text).not.toContainText(text)
    }

    // Las consultas de RUM, con el rango global.
    await settledRequests()
    expect(appRumQueries().length).toBeGreaterThanOrEqual(4)
    for (const query of appRumQueries()) expect(query.get('from')).toBe('now-2h')
  }
)

test(
  'CA1 (0053): con acciones custom, el marcador de acciones las suma y las enseña debajo',
  { tag: '@aplicacion' },
  async () => {
    sim.applicationRumCustom = true
    await openApplicationPage()
    // 9640 + 21 400 + 1250.
    await expect(appMarkerValue('actions')).toHaveText(loneNumber('32.290'))
    const secondary = appMarkerSecondary('actions')
    await expect(secondary).toContainText(APP_SERIES.load)
    await expect(secondary).toContainText(loneNumber('9.640'))
    await expect(secondary).toContainText(APP_SERIES.xhr)
    await expect(secondary).toContainText(loneNumber('21.400'))
    await expect(secondary).toContainText(APP_SERIES.custom)
    await expect(secondary).toContainText(loneNumber('1.250'))
  }
)

test(
  'CA2 (0053): las secciones «Actividad» y «Errores» enseñan sus dos gráficos con sus series, en su orden, y la franja de problemas sobre la duración por tipo',
  { tag: '@aplicacion' },
  async () => {
    const entityPage = await openApplicationPage()

    // Secciones con título, en su orden; los marcadores, encima de todas.
    expect(await appSectionIds()).toEqual(APP_SECTIONS)
    const markersBox = await settledBox(entityPage.getByTestId('application-markers'))
    for (const id of APP_SECTIONS) {
      const section = appSection(id)
      await expect(section, id).toBeVisible()
      await expect(section.getByRole('heading').first(), id).toContainText(APP_SECTION_TITLES[id])
      const box = await settledBox(section)
      expect(markersBox.y + markersBox.height, `marcadores encima de ${id}`).toBeLessThanOrEqual(
        box.y + 1
      )
      expect(await appChartKinds(id), id).toEqual(APP_SECTION_CHARTS[id])
    }
    for (const kind of APP_SECTION_CHARTS.activity.concat(APP_SECTION_CHARTS.errors)) {
      await expect(appChartPanel(kind).getByRole('heading').first(), kind).toContainText(
        APP_CHART_TITLES[kind]
      )
    }

    // «Actividad»: load y XHR (custom no trae datos en el simulador, como en vivo).
    await expectAppChartSeries('actionsByType', [APP_SERIES.load, APP_SERIES.xhr])
    await expectAppChartSeries('durationByType', [APP_SERIES.load, APP_SERIES.xhr])
    // «Errores»: JavaScript y HTTP (sin «otros»: no traen datos), y el % de acciones afectadas.
    await expectAppChartSeries('errorsByType', [APP_SERIES.javascript, APP_SERIES.http])
    expect(await appChartSeries('affectedActions')).toHaveLength(1)
    // Separados: sin nota.
    await expect(appChartPanel('errorsByType').getByTestId('application-errors-note')).toHaveCount(
      0
    )

    // La franja de problemas, sobre la duración por tipo, con los dos problemas.
    const band = appBand('durationByType')
    await expect(band).toBeVisible()
    await expect(band.getByTestId('application-problem-segment')).toHaveCount(2)
    for (const { problemId } of [APPLICATION_BAND_OPEN, APPLICATION_BAND_CLOSED]) {
      await expect(appSegment(problemId, 'durationByType'), problemId).toHaveCount(1)
    }
    const bandBox = await settledBox(band)
    const plotBox = await settledBox(appChartPlot('durationByType'))
    expect(bandBox.y + bandBox.height).toBeLessThanOrEqual(plotBox.y + 1)
  }
)

test(
  'CA2 (0053): con acciones custom, los dos gráficos de «Actividad» llevan load, XHR y custom',
  { tag: '@aplicacion' },
  async () => {
    sim.applicationRumCustom = true
    await openApplicationPage()
    const all = [APP_SERIES.load, APP_SERIES.xhr, APP_SERIES.custom]
    await expectAppChartSeries('actionsByType', all)
    await expectAppChartSeries('durationByType', all)
  }
)

test(
  'CA3 (0053): con los errores sin separar por tipo, el gráfico de errores lleva una sola serie y la nota, y el marcador no enseña la línea JavaScript · HTTP',
  { tag: '@aplicacion' },
  async () => {
    sim.applicationRumErrorsUntyped = true
    await openApplicationPage()

    // El gráfico: una sola serie, con la nota.
    expect(await appChartSeries('errorsByType')).toHaveLength(1)
    const note = appChartPanel('errorsByType').getByTestId('application-errors-note')
    await expect(note).toBeVisible()
    await expect(note).not.toHaveText(/^\s*$/)

    // El marcador: el total (14), sin JavaScript ni HTTP.
    await expect(appMarkerValue('errors')).toHaveText(loneNumber('14'))
    await expect(appMarkerValue('errors')).toHaveAttribute('data-level', 'error')
    await expect(appMarker('errors')).not.toContainText('JavaScript')
    await expect(appMarker('errors')).not.toContainText('HTTP')

    // El resto, como siempre.
    expect(await appChartSeries('affectedActions')).toHaveLength(1)
    await expectAppActionsMarker()
  }
)

test(
  'CA4 (0053): con papeles sin datos (usuarios, acciones por tipo y acciones afectadas), su marcador o gráfico no sale y el resto sí',
  { tag: '@aplicacion' },
  async () => {
    sim.applicationEmpty = [
      `${RUM_W}activeUsersEst`,
      `${RUM_W}actionCount.load`,
      `${RUM_W}actionCount.xhr`,
      `${RUM_W}percentageOfUserActionsAffectedByErrors`
    ]
    const entityPage = await openApplicationPage()

    // Marcadores: sin usuarios ni acciones; el resto con sus valores.
    expect(await appMarkerIds()).toEqual(['apdex', 'sessions', 'errors', 'problems'])
    await expect(appMarker('users')).toHaveCount(0)
    await expect(appMarker('actions')).toHaveCount(0)
    await expectAppApdexMarker()
    await expectAppSessionsMarker()
    await expectAppErrorsMarker()
    await expectAppProblemsMarker()

    // Gráficos: sin acciones por tipo ni acciones afectadas (ni, ficha 0054, el de usuarios
    // activos); el resto con sus series.
    expect(await appChartKinds()).toEqual([
      'durationByType',
      'errorsByType',
      'sessions',
      'vitals',
      'apdex'
    ])
    for (const kind of ['actionsByType', 'affectedActions'] as const) {
      await expect(appChartPanel(kind), kind).toHaveCount(0)
      await expect(entityPage.getByTestId(`application-chart-${kind}`), kind).toHaveCount(0)
    }
    await expectAppChartSeries('durationByType', [APP_SERIES.load, APP_SERIES.xhr])
    await expectAppChartSeries('errorsByType', [APP_SERIES.javascript, APP_SERIES.http])
    expect(await appChartSeries('apdex')).toHaveLength(1)

    // Faltar datos no es un fallo.
    await expect(entityPage.getByRole('button', { name: 'Reintentar' })).toHaveCount(0)
    await expect(appActions().getByTestId('application-action-row')).toHaveCount(3)
  }
)

test(
  'CA5 (0053): cambiar el rango global vuelve a pedir los datos de RUM; «Actualizar» también; volver a la página sin cambios, no',
  { tag: '@aplicacion' },
  async () => {
    await openApplicationPage()
    await expectAppMarkers()
    await appChartSeries('actionsByType')
    await settledRequests()
    const rum = appRumQueries().length
    expect(rum).toBeGreaterThanOrEqual(4)
    for (const query of appRumQueries()) expect(query.get('from')).toBe('now-2h')

    // Rango nuevo: otra vez, con now-24h.
    await page.getByTestId('time-range-24h').click()
    await expect.poll(() => appRumQueries().length).toBe(rum * 2)
    for (const query of appRumQueries().slice(rum)) expect(query.get('from')).toBe('now-24h')
    await expectAppMarkers()

    // Fuera y vuelta, sin cambiar nada: ninguna petición nueva.
    await goTo('metrics')
    await expect(appPage()).toHaveCount(0)
    const before = await settledRequests()
    await openApplicationPage()
    await expectAppMarkers()
    await page.waitForTimeout(1500)
    expect(sim.requests.slice(before), 'peticiones al volver a la página').toEqual([])

    // «Actualizar», en la cabecera de la página: otra vez, con el rango actual.
    await appPage().getByTestId('module-refresh').click()
    await expect.poll(() => appRumQueries().length).toBe(rum * 3)
    for (const query of appRumQueries().slice(rum * 2)) expect(query.get('from')).toBe('now-24h')
    await expectAppMarkers()
  }
)

test(
  'CA5 (0053): si falla el canal de RUM, sus marcadores y cada gráfico de «Actividad» y «Errores» enseñan el aviso con Reintentar, y el Apdex, los problemas y la tabla siguen',
  { tag: '@aplicacion' },
  async () => {
    sim.applicationRumFail = true
    await openApplicationPage()
    const rumMarkers = ['users', 'sessions', 'actions', 'errors'] as const
    const rumCharts = [
      'actionsByType',
      'durationByType',
      'errorsByType',
      'affectedActions'
    ] as const

    // Lo que no es de RUM, con sus valores y sin aviso.
    await expectAppApdexMarker()
    await expectAppProblemsMarker()
    expect(await appChartSeries('apdex')).toHaveLength(1)
    await expect(appActions().getByTestId('application-action-row')).toHaveCount(3)
    for (const id of ['apdex', 'problems']) {
      await expect(appMarker(id).getByRole('button', { name: 'Reintentar' }), id).toHaveCount(0)
    }
    await expect(appChartPanel('apdex').getByRole('button', { name: 'Reintentar' })).toHaveCount(0)

    // Cada marcador de RUM, en su sitio, con el aviso y Reintentar y sin valor.
    for (const id of rumMarkers) {
      const marker = appMarker(id)
      await expect(marker, id).toBeVisible()
      await expect(marker.getByRole('alert').first(), id).toBeVisible()
      await expect(marker.getByRole('button', { name: 'Reintentar' }), id).toBeVisible()
      await expect(marker.getByTestId('application-marker-value'), id).toHaveCount(0)
    }
    // Cada gráfico de RUM, con su aviso y Reintentar, sin gráfico.
    for (const kind of rumCharts) {
      const panel = appChartPanel(kind)
      await expect(panel, kind).toBeVisible()
      await expect(panel.getByRole('alert').first(), kind).toBeVisible()
      await expect(panel.getByRole('button', { name: 'Reintentar' }), kind).toBeVisible()
      await expect(panel.getByTestId(`application-chart-${kind}`), kind).toHaveCount(0)
    }

    // Reintentar, con el canal ya bien: llegan los valores y los gráficos.
    sim.applicationRumFail = false
    await clickInPlace(appChartPanel('actionsByType').getByRole('button', { name: 'Reintentar' }), {
      scroll: true
    })
    await expectAppMarkers()
    await expectAppChartSeries('actionsByType', [APP_SERIES.load, APP_SERIES.xhr])
    await expectAppChartSeries('errorsByType', [APP_SERIES.javascript, APP_SERIES.http])
    for (const kind of rumCharts) {
      await expect(appChartPanel(kind).getByRole('alert'), kind).toHaveCount(0)
    }
  }
)

// ---------------------------------------------------------------------------
// Ficha 0054: secciones «Usuarios y sesiones» y «Experiencia» (Core Web Vitals) de la página de
// la aplicación, con el canal entities:applicationRum de la 0052 (solo API clásica). Nombres y
// decisiones, en el comentario de APP_VITALS.
// ---------------------------------------------------------------------------

test(
  'CA1 (0054): la página de una aplicación enseña «Usuarios y sesiones» con sus dos gráficos y los tres datos pequeños bajo el de sesiones',
  { tag: '@aplicacion' },
  async () => {
    sim.applicationRumRageClicks = true
    const entityPage = await openApplicationPage()

    // La sección, con su título, justo después de «Errores».
    const section = appSection('users')
    await expect(section).toBeVisible()
    await expect(section.getByRole('heading').first()).toContainText(APP_SECTION_TITLES.users)
    expect(await appSectionIds()).toEqual(APP_SECTIONS)
    expect(await appChartKinds('users')).toEqual(['activeUsers', 'sessions'])
    for (const kind of ['activeUsers', 'sessions'] as const) {
      await expect(appChartPanel(kind).getByRole('heading').first(), kind).toContainText(
        APP_CHART_TITLES[kind]
      )
    }

    // Usuarios activos: una línea, con la nota de que es una estimación.
    await expectAppChartSeries('activeUsers', [/usuarios/i])
    const note = appChartPanel('activeUsers').getByTestId('application-users-note')
    await expect(note).toBeVisible()
    await expect(note).toContainText(/estimad|aproximaci/i)

    // Sesiones: iniciadas y terminadas, y la duración media (en su eje).
    await expectAppChartSeries('sessions', [/iniciadas/i, /terminadas/i, /duración/i])

    // Debajo, los tres datos del rango: 5,9 acciones por sesión, 28,4 % de rebote y 37 rage clicks.
    expect(await appSessionStatIds()).toEqual([...APP_SESSION_STATS])
    const stats: Record<(typeof APP_SESSION_STATS)[number], [RegExp, RegExp]> = {
      actionsPerSession: [/acciones por sesión/i, /^\s*5,9\s*$/],
      bounceRate: [/rebote/i, /^\s*28,4\s?%\s*$/],
      rageClicks: [/frustración|rage/i, loneNumber('37')]
    }
    for (const [stat, [label, value]] of Object.entries(stats)) {
      await expect(appSessionStat(stat), stat).toBeVisible()
      await expect(appSessionStat(stat), stat).toContainText(label)
      await expect(
        appSessionStat(stat).getByTestId('application-session-stat-value'),
        stat
      ).toHaveText(value)
    }
    // Debajo del gráfico: el primer dato empieza donde acaba el canvas.
    const plotBox = await settledBox(appChartPlot('sessions'))
    const statBox = await settledBox(appSessionStat('actionsPerSession'))
    expect(plotBox.y + plotBox.height).toBeLessThanOrEqual(statBox.y + 1)

    for (const text of ['undefined', 'null', 'NaN', '[object Object]']) {
      await expect(section, text).not.toContainText(text)
    }
    // Nada de aviso: hay datos.
    await expect(section.getByRole('button', { name: 'Reintentar' })).toHaveCount(0)
    await expect(entityPage.getByTestId('entity-under-construction')).toHaveCount(0)
  }
)

test(
  'CA3 (0054): la sección «Experiencia» enseña las tarjetas de LCP, CLS e INP con su calificación y el gráfico con sus tres series y las líneas de umbral',
  { tag: '@aplicacion' },
  async () => {
    await openApplicationPage()

    // La sección, con su título, después de «Usuarios y sesiones».
    const section = appSection('experience')
    await expect(section).toBeVisible()
    await expect(section.getByRole('heading').first()).toContainText(APP_SECTION_TITLES.experience)
    expect(await appSectionIds()).toEqual(APP_SECTIONS)

    // Tres tarjetas, en su orden, con el valor del rango y su calificación (texto y color): LCP
    // 2,3 s «Bueno», CLS 0,18 «Mejorable» e INP 640 ms «Pobre».
    expect(await appVitalIds()).toEqual(APP_VITALS)
    await expect(section.getByTestId('application-vital')).toHaveCount(3)
    for (const vital of APP_VITALS) {
      const expected = APP_VITAL_EXPECTED[vital]
      const card = appVital(vital)
      await expect(card, vital).toBeVisible()
      await expect(card, vital).toContainText(expected.label)
      await expect(card.getByTestId('application-vital-value'), vital).toContainText(expected.value)
      const rating = card.getByTestId('application-vital-rating')
      await expect(rating, vital).toHaveAttribute('data-rating', expected.rating)
      await expect(rating, vital).toHaveAttribute('data-level', expected.level)
      await expect(rating, vital).toHaveText(new RegExp(`^\\s*${expected.text}\\s*$`))
    }

    // El gráfico: un solo panel, con LCP, CLS e INP y las líneas en los cortes de «bueno».
    expect(await appChartKinds('experience')).toEqual(['vitals'])
    await expect(appChartPanel('vitals').getByRole('heading').first()).toContainText(
      APP_CHART_TITLES.vitals
    )
    await expectAppChartSeries('vitals', [/LCP/, /CLS/, /INP/])
    const plot = appChartPlot('vitals')
    await expect(plot).toHaveAttribute('data-thresholds', /\[.+\]/)
    const thresholds = JSON.parse((await plot.getAttribute('data-thresholds')) ?? '[]') as number[]
    expect(thresholds.slice().sort((a, b) => a - b)).toEqual([0.1, 200, 2_500])

    for (const text of ['undefined', 'null', 'NaN', '[object Object]']) {
      await expect(section, text).not.toContainText(text)
    }
    await expect(section.getByRole('button', { name: 'Reintentar' })).toHaveCount(0)
  }
)

test(
  'CA4 (0054): sin datos de experiencia (LCP, CLS e INP), la sección «Experiencia» no sale y el resto sí',
  { tag: '@aplicacion' },
  async () => {
    sim.applicationEmpty = [
      `${RUM_W}largestContentfulPaint`,
      `${RUM_W}cumulativeLayoutShift`,
      `${RUM_W}interactionToNextPaint`
    ]
    const entityPage = await openApplicationPage()

    // «Usuarios y sesiones» sale con sus dos gráficos; las demás secciones, en su orden.
    await expect(appSection('users')).toBeVisible()
    await expectAppChartSeries('activeUsers', [/usuarios/i])
    await expectAppChartSeries('sessions', [/iniciadas/i, /terminadas/i, /duración/i])
    expect(await appSectionIds()).toEqual(APP_SECTIONS.filter((id) => id !== 'experience'))

    // Ni la sección, ni las tarjetas, ni el gráfico, ni un «—» en su lugar.
    await expect(appSection('experience')).toHaveCount(0)
    await expect(entityPage.getByTestId('application-vital')).toHaveCount(0)
    await expect(appChartPanel('vitals')).toHaveCount(0)
    await expect(entityPage.getByTestId('application-chart-vitals')).toHaveCount(0)

    // Faltar datos no es un fallo.
    await expect(entityPage.getByRole('button', { name: 'Reintentar' })).toHaveCount(0)
    await expectAppMarkers()
  }
)

test(
  'CA4 (0054): sin rage clicks (lo habitual en vivo), su dato no sale y los otros dos sí',
  { tag: '@aplicacion' },
  async () => {
    // Por defecto, el simulador no trae rage clicks (como en vivo).
    expect(sim.applicationRumRageClicks).toBe(false)
    await openApplicationPage()
    await expectAppChartSeries('sessions', [/iniciadas/i, /terminadas/i, /duración/i])

    expect(await appSessionStatIds()).toEqual(['actionsPerSession', 'bounceRate'])
    await expect(appSessionStat('rageClicks')).toHaveCount(0)
    await expect(
      appSessionStat('actionsPerSession').getByTestId('application-session-stat-value')
    ).toHaveText(/^\s*5,9\s*$/)
    await expect(
      appSessionStat('bounceRate').getByTestId('application-session-stat-value')
    ).toHaveText(/^\s*28,4\s?%\s*$/)
    const panel = appChartPanel('sessions')
    await expect(panel).not.toContainText(/frustración|rage/i)
    for (const text of ['undefined', 'null', 'NaN']) {
      await expect(panel, text).not.toContainText(text)
    }
  }
)
