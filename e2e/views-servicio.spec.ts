import { readFileSync } from 'node:fs'
import { expect, type Locator, test } from '@playwright/test'
import { hoverFresh, moveToNeutral } from './hover'
import { wallTimeToEpoch } from './local-time'
import {
  BAND_CLOSED,
  BAND_OPEN,
  BAND_SHORT,
  BAND_SHORT_END,
  bandTimes,
  HOUR,
  INFO_CALLER_APP,
  INFO_CALLER_NAMED,
  INFO_CALLER_UNNAMED,
  INFO_CALLS,
  INFO_FEW_ID,
  INFO_FULL_ID,
  INFO_FULL_PROPERTY_COUNT,
  INFO_HOSTS,
  INFO_INTERNAL,
  INFO_METHOD,
  INFO_PG,
  INFO_PGI,
  serviceMetricKey,
  splitSelector,
  SVC_BAND_ID,
  SVC_BIG_ID,
  SVC_DB_ID,
  SVC_EMPTY_ID,
  SVC_ID,
  SVC_KO_THOUSANDS_ID,
  SVC_LONG_ID,
  SVC_QUIET_ID,
  SVC_SET_ENTITY,
  SVC_SET_IDS,
  SVC_SHORT_ID,
  SVC_SLO_ID,
  SVC_TIMESTAMPS,
  SVC_UNIFIED_KEYS,
  type SvcSet,
  TOKEN_NO_ENTITIES,
  MK_PROBLEM_ID,
  MK_EV_ERRORS,
  MK_EV_BIG,
  MK_EV_EMPTY
} from './views/fixtures'
import {
  app,
  clickInPlace,
  createEnvironment,
  currentRoute,
  env,
  exportSaved,
  goTo,
  goToRoute,
  invoke,
  nextFrames,
  page,
  receivesClick,
  reloadUi,
  settledBox,
  setupViewsApp,
  viewportSize,
  withContentSize
} from './views/harness'
import { sim } from './views/sim-state'
import { fitsContentSize, FIXED_WINDOW, SMALL_WINDOW } from './window-size'
import ExcelJS from 'exceljs'
import es from '../src/renderer/src/locales/es/common.json'
import {
  evidenceRows,
  expandRow,
  analyzeButton,
  settledRequests,
  loneNumber,
  INFO_ROW_ORDER,
  infoCard,
  openServiceInfo,
  dataKeys
} from './views/helpers'

/**
 * Specs de vistas por zona (ficha 0070): la página del servicio (`@servicio`). Arnés en
 * `e2e/views/` (ver su cabecera).
 */

setupViewsApp()

test(
  'CA7 (0006): entities:serviceMetrics por IPC con un id inventado: dos consultas, series en ms y totales',
  { tag: '@servicio' },
  async () => {
    const data = await invoke<Record<string, unknown>>('entities:serviceMetrics', {
      environmentId: env['Producción'],
      entityId: SVC_ID,
      timeRange: '2h'
    })
    // Dos consultas al simulador, las dos con el rango global.
    expect(sim.serviceMetricQueries).toHaveLength(2)
    for (const query of sim.serviceMetricQueries) expect(query.get('from')).toBe('now-2h')

    const series = (values: (number | null)[]): { timestamps: number[]; values: unknown[] } => ({
      timestamps: SVC_TIMESTAMPS,
      values
    })
    expect(data).toMatchObject({
      resolution: '1m',
      series: {
        responseTime: {
          median: series([100, 120, null, 110]),
          p90: series([300, 320, null, 310]),
          p99: series([800, 900, null, 850])
        },
        requests: series([50, 40, null, 60]),
        errors: series([5, 0, null, 10]),
        ok: series([45, 40, null, 50]),
        errorRate: series([10, 0, null, 16.7])
      },
      // Recuentos: suma de la serie (no los marcadores del simulador); tasa = 15 / 150.
      totals: {
        requests: 150,
        errors: 15,
        ok: 135,
        errorRate: 10,
        responseTime: { median: 105, p90: 305, p99: 820 }
      },
      warnings: [],
      partial: []
    })
  }
)

test(
  'CA7 (0046): entities:serviceMetrics por IPC con un servicio de cada conjunto: entidad primero y las métricas de su conjunto',
  { tag: '@servicio' },
  async () => {
    const setKeys: Record<SvcSet, string[]> = {
      server: [
        'builtin:service.response.server',
        'builtin:service.errors.server.count',
        'builtin:service.errors.server.rate',
        'builtin:service.requestCount.server'
      ],
      client: [
        'builtin:service.response.client',
        'builtin:service.errors.client.count',
        'builtin:service.errors.client.rate',
        'builtin:service.requestCount.client'
      ],
      unified: [SVC_UNIFIED_KEYS.time, SVC_UNIFIED_KEYS.errors, SVC_UNIFIED_KEYS.requests],
      activity: ['builtin:service.response.server']
    }
    const series = (values: (number | null)[]): { timestamps: number[]; values: unknown[] } => ({
      timestamps: SVC_TIMESTAMPS,
      values
    })
    const expected: Record<SvcSet, Record<string, unknown>> = {
      server: {
        series: { requests: series([50, 40, null, 60]), errors: series([5, 0, null, 10]) },
        totals: { requests: 150, errors: 15, responseTime: { median: 105 } }
      },
      client: {
        series: {
          responseTime: { median: series([200, 210, null, 220]) },
          requests: series([30, 20, null, 10]),
          errorRate: series([10, 0, null, 10])
        },
        totals: { requests: 60, errors: 4, ok: 56, responseTime: { median: 210 } }
      },
      unified: {
        series: {
          // Ya en ms: sin dividir.
          responseTime: { median: series([150, 160, null, 170]) },
          requests: series([40, 10, null, 50]),
          errors: series([4, 0, null, 5]),
          ok: series([36, 10, null, 45]),
          // Calculada en main: fallidas / total × 100.
          errorRate: series([10, 0, null, 10])
        },
        totals: { requests: 100, errors: 9, ok: 91, errorRate: 9, responseTime: { median: 160 } }
      },
      activity: {
        series: {
          responseTime: null,
          requests: series([7, 0, null, 3]),
          errors: null,
          ok: null,
          errorRate: null
        },
        totals: { requests: 10, errors: null, ok: null, errorRate: null, responseTime: null }
      }
    }

    for (const set of Object.keys(SVC_SET_IDS) as SvcSet[]) {
      const id = SVC_SET_IDS[set]
      const entityBefore = sim.serviceEntityQueries.length
      const metricsBefore = sim.serviceMetricQueries.length
      const requestsBefore = sim.requests.length
      const data = await invoke<Record<string, unknown>>('entities:serviceMetrics', {
        environmentId: env['Producción'],
        entityId: id,
        timeRange: '2h'
      })

      // Una petición a la entidad, con los fields de la ficha, antes de las métricas.
      const entityQueries = sim.serviceEntityQueries.slice(entityBefore)
      expect(entityQueries, set).toHaveLength(1)
      const [entityId, fields] = (entityQueries[0] ?? '').split(' ')
      expect(entityId, set).toBe(id)
      for (const field of [
        '+properties.serviceType',
        '+properties.webServerName',
        '+properties.remoteEndpoint',
        '+properties.remoteServiceName'
      ]) {
        expect((fields ?? '').split(','), `${set}: ${field}`).toContain(field)
      }
      const calls = sim.requests.slice(requestsBefore)
      expect(calls[0], `${set}: la primera petición es la entidad`).toBe(
        `GET /api/v2/entities/${id}`
      )

      // Las consultas, solo con las métricas del conjunto (todas) y nunca más de 10 expresiones.
      const queries = sim.serviceMetricQueries.slice(metricsBefore)
      expect(queries.length, set).toBeGreaterThan(0)
      const used = new Set<string>()
      for (const query of queries) {
        const expressions = splitSelector(query.get('metricSelector') ?? '')
        expect(expressions.length, set).toBeLessThan(11)
        for (const expression of expressions) used.add(serviceMetricKey(expression))
      }
      expect([...used].sort(), set).toEqual([...setKeys[set]].sort())

      expect(data, set).toMatchObject({
        serviceType: SVC_SET_ENTITY[set].serviceType,
        metricSet: set,
        warnings: [],
        ...expected[set]
      })
    }
  }
)

test(
  'CA7 (0046): entities:serviceMetrics sin entities.read: entidad con 403, conjunto Servidor y aviso',
  { tag: '@servicio' },
  async () => {
    const tenants = await invoke<{ clients: { id: string; name: string }[] }>('tenants:list')
    const clientId = tenants.clients.find((client) => client.name === 'Cliente A')?.id ?? ''
    const noEntities = await createEnvironment(
      clientId,
      'Sin entidades 0046',
      'other',
      TOKEN_NO_ENTITIES
    )
    try {
      await invoke('connection:test', { environmentId: noEntities })
      const data = await invoke<Record<string, unknown>>('entities:serviceMetrics', {
        environmentId: noEntities,
        entityId: SVC_SET_IDS.server,
        timeRange: '2h'
      })
      expect(data).toMatchObject({
        serviceType: null,
        metricSet: 'server',
        series: { requests: { timestamps: SVC_TIMESTAMPS, values: [50, 40, null, 60] } }
      })
      expect((data['warnings'] as string[]).length).toBeGreaterThan(0)
    } finally {
      await invoke('environments:delete', { id: noEntities })
    }
  }
)

/**
 * Ficha 0008: marcadores de la página de un SERVICE (sus datos, P-791, en `views/fixtures.ts`).
 *
 * Nombres que fijan estos tests: la fila `service-markers`; cada marcador `service-marker-<id>`
 * (availability, ok, ko, error-rate, response-time, problems; availability, la primera desde la
 * ficha 0066); dentro, el valor en `service-marker-value` (availability, ok, ko y tasa), `service-marker-median`, `-p90` y `-p99` (tiempos) y `service-marker-open` y
 * `-closed` (problemas). El color de error es la clase `text-danger`.
 */
const serviceMarker = (id: string): Locator => page.getByTestId(`service-marker-${id}`)
// Ficha 0066: la disponibilidad («SLO») es un marcador de métricas más.
const METRIC_MARKERS = ['availability', 'ok', 'ko', 'error-rate', 'response-time'] as const

/** Ficha 0008: abre P-791 y «Analizar entidad» de la evidencia; espera la página del servicio. */
async function analyzeMarkersEvidence(title: string): Promise<Locator> {
  await goToRoute(`/problems/${MK_PROBLEM_ID}`)
  await expect(page.getByTestId('problem-page-title')).toContainText('P-791')
  await expect(evidenceRows()).toHaveCount(4)
  await analyzeButton(await expandRow(title)).click()
  const servicePage = page.getByTestId('entity-page-service')
  await expect(servicePage).toBeVisible()
  return servicePage
}

/** Ficha 0008: espera los valores de los marcadores de SVC_ID (con errores y 1 abierto). */
async function expectErrorServiceValues(): Promise<void> {
  await expect(serviceMarker('ok').getByTestId('service-marker-value')).toHaveText(/^135$/)
  await expect(serviceMarker('ko').getByTestId('service-marker-value')).toHaveText(/^15$/)
  await expect(serviceMarker('error-rate').getByTestId('service-marker-value')).toHaveText(
    /^10,0\s?%$/
  )
  const times = serviceMarker('response-time')
  await expect(times.getByTestId('service-marker-median')).toContainText(/105\sms/)
  await expect(times.getByTestId('service-marker-p90')).toContainText(/305\sms/)
  await expect(times.getByTestId('service-marker-p99')).toContainText(/820\sms/)
  const problems = serviceMarker('problems')
  await expect(problems.getByTestId('service-marker-open')).toHaveText(loneNumber('1'))
  await expect(problems.getByTestId('service-marker-closed')).toHaveText(loneNumber('2'))
}

test(
  'CA1 (0008): desde «Analizar entidad», la página del SERVICE enseña los seis marcadores (con «SLO» desde la 0066) con los valores del simulador ya formateados, sin «Página en construcción»',
  { tag: '@servicio' },
  async () => {
    const servicePage = await analyzeMarkersEvidence(MK_EV_BIG)
    expect(await currentRoute()).toBe(`/entities/SERVICE/${SVC_BIG_ID}`)
    const row = servicePage.getByTestId('service-markers')
    await expect(row).toBeVisible()

    // Los seis, con su nombre (el de la disponibilidad, desde la ficha 0066).
    const labels = [
      ['availability', 'SLO'],
      ['ok', 'Peticiones OK'],
      ['ko', 'Peticiones KO'],
      ['error-rate', 'Tasa de error'],
      ['response-time', 'Tiempo de respuesta'],
      ['problems', 'Problemas']
    ] as const
    for (const [id, label] of labels) {
      await expect(row.getByTestId(`service-marker-${id}`), id).toBeVisible()
      await expect(row.getByTestId(`service-marker-${id}`), id).toContainText(label)
    }

    // Valores: suma de la serie (45 000 peticiones, 0 errores), tasa con un decimal, tiempos en
    // ms o en s según el valor y los recuentos de problemas (0 abiertos, 3 cerrados).
    await expect(serviceMarker('availability').getByTestId('service-marker-value')).toHaveText(
      /^100,0\s?%$/
    )
    await expect(serviceMarker('ok').getByTestId('service-marker-value')).toHaveText(/^45\.000$/)
    await expect(serviceMarker('ko').getByTestId('service-marker-value')).toHaveText(/^0$/)
    await expect(serviceMarker('error-rate').getByTestId('service-marker-value')).toHaveText(
      /^0,0\s?%$/
    )
    const times = serviceMarker('response-time')
    await expect(times.getByTestId('service-marker-median')).toContainText(/850\sms/)
    await expect(times.getByTestId('service-marker-p90')).toContainText(/1,2\ss/)
    await expect(times.getByTestId('service-marker-p99')).toContainText(/2,5\ss/)
    const problems = serviceMarker('problems')
    await expect(problems.getByTestId('service-marker-open')).toHaveText(loneNumber('0'))
    await expect(problems.getByTestId('service-marker-closed')).toHaveText(loneNumber('3'))

    // Ni el bloque ni el texto de «Página en construcción».
    await expect(servicePage.getByTestId('entity-under-construction')).toHaveCount(0)
    await expect(servicePage).not.toContainText('Página en construcción')
  }
)

test(
  'CA3 (0008): con KO > 0 y problemas abiertos > 0 esos marcadores llevan la clase de error y texto; con 0, no',
  { tag: '@servicio' },
  async () => {
    // SVC_ID: 15 KO y 1 problema abierto.
    await analyzeMarkersEvidence(MK_EV_ERRORS)
    await expectErrorServiceValues()
    for (const id of ['ko', 'problems']) {
      const danger = serviceMarker(id).locator('.text-danger')
      await expect(danger.first(), id).toBeVisible()
      // El color nunca es la única señal: lo que va en rojo lleva texto.
      await expect(danger.first(), id).toHaveText(/\S/)
    }
    await expect(serviceMarker('ko').getByTestId('service-marker-value')).toHaveClass(
      /\btext-danger\b/
    )
    await expect(serviceMarker('problems').getByTestId('service-marker-open')).toHaveClass(
      /\btext-danger\b/
    )
    // Los cerrados no van en rojo.
    await expect(serviceMarker('problems').getByTestId('service-marker-closed')).not.toHaveClass(
      /\btext-danger\b/
    )

    // SVC_BIG_ID: 0 KO y 0 abiertos (3 cerrados): ninguno de los dos lleva la clase.
    await page.getByTestId('entity-back').click()
    await expect(page.getByTestId('problem-page')).toBeVisible()
    await analyzeButton(await expandRow(MK_EV_BIG)).click()
    await expect(page.getByTestId('entity-page-service')).toBeVisible()
    await expect(serviceMarker('ko').getByTestId('service-marker-value')).toHaveText(/^0$/)
    await expect(serviceMarker('problems').getByTestId('service-marker-open')).toHaveText(
      loneNumber('0')
    )
    for (const id of ['ko', 'problems']) {
      await expect(serviceMarker(id).locator('.text-danger'), id).toHaveCount(0)
    }
  }
)

test(
  'CA4 (0008): cambiar el rango global vuelve a pedir los dos canales con el rango nuevo; volver a la página sin cambiar nada no pide; «Actualizar» sí',
  { tag: '@servicio' },
  async () => {
    await goToRoute(`/entities/SERVICE/${SVC_ID}`)
    await expect(page.getByTestId('entity-page-service')).toBeVisible()
    await expectErrorServiceValues()
    await settledRequests()
    // Al entrar: una vez cada canal (2 consultas de métricas y 2 de problemas), con el rango global.
    expect(sim.serviceMetricQueries).toHaveLength(2)
    expect(sim.entityProblemQueries).toHaveLength(2)
    for (const query of [...sim.serviceMetricQueries, ...sim.entityProblemQueries]) {
      expect(query.get('from')).toBe('now-2h')
    }

    // Rango nuevo: los dos canales otra vez, con now-24h.
    await page.getByTestId('time-range-24h').click()
    await expect.poll(() => sim.serviceMetricQueries.length).toBe(4)
    await expect.poll(() => sim.entityProblemQueries.length).toBe(4)
    const afterRange = [...sim.serviceMetricQueries.slice(2), ...sim.entityProblemQueries.slice(2)]
    for (const query of afterRange) expect(query.get('from')).toBe('now-24h')
    await expectErrorServiceValues()
    await settledRequests()
    expect(sim.serviceMetricQueries).toHaveLength(4)
    expect(sim.entityProblemQueries).toHaveLength(4)

    // Fuera y vuelta, sin cambiar nada: ninguna petición nueva.
    await goTo('metrics')
    await expect(page.getByTestId('entity-page-service')).toHaveCount(0)
    const before = await settledRequests()
    await goToRoute(`/entities/SERVICE/${SVC_ID}`)
    await expect(page.getByTestId('entity-page-service')).toBeVisible()
    await expectErrorServiceValues()
    await page.waitForTimeout(1500)
    expect(sim.requests.slice(before), 'peticiones al volver a la página').toEqual([])
    expect(sim.serviceMetricQueries).toHaveLength(4)
    expect(sim.entityProblemQueries).toHaveLength(4)

    // «Actualizar», en la cabecera de la página: los dos canales, con el rango actual.
    await page.getByTestId('entity-page-service').getByTestId('module-refresh').click()
    await expect.poll(() => sim.serviceMetricQueries.length).toBe(6)
    await expect.poll(() => sim.entityProblemQueries.length).toBe(6)
    const afterRefresh = [
      ...sim.serviceMetricQueries.slice(4),
      ...sim.entityProblemQueries.slice(4)
    ]
    for (const query of afterRefresh) expect(query.get('from')).toBe('now-24h')
    await expectErrorServiceValues()
  }
)

test(
  'CA5 (0008): si falla el canal de métricas, sus marcadores enseñan el aviso con Reintentar y el de problemas sigue con su dato',
  { tag: '@servicio' },
  async () => {
    sim.serviceMetricsFail = true
    await goToRoute(`/entities/SERVICE/${SVC_ID}`)
    await expect(page.getByTestId('entity-page-service')).toBeVisible()

    // El de problemas, con sus recuentos y sin aviso.
    const problems = serviceMarker('problems')
    await expect(problems.getByTestId('service-marker-open')).toHaveText(loneNumber('1'))
    await expect(problems.getByTestId('service-marker-closed')).toHaveText(loneNumber('2'))
    await expect(problems.getByRole('button', { name: 'Reintentar' })).toHaveCount(0)

    // Cada marcador de métricas, en su sitio, con el aviso y Reintentar y sin valor.
    for (const id of METRIC_MARKERS) {
      const marker = serviceMarker(id)
      await expect(marker, id).toBeVisible()
      await expect(marker.getByRole('button', { name: 'Reintentar' }), id).toBeVisible()
      await expect(marker.getByTestId('service-marker-value'), id).toHaveCount(0)
      await expect(marker.getByTestId('service-marker-median'), id).toHaveCount(0)
    }

    // Reintentar, con el canal ya bien: llegan los valores.
    sim.serviceMetricsFail = false
    await serviceMarker('ok').getByRole('button', { name: 'Reintentar' }).click()
    await expectErrorServiceValues()
    for (const id of METRIC_MARKERS) {
      await expect(serviceMarker(id).getByRole('button', { name: 'Reintentar' }), id).toHaveCount(0)
    }
  }
)

test(
  'CA5 (0008): si falla el canal de problemas, su marcador enseña el aviso con Reintentar y los de métricas siguen con su dato',
  { tag: '@servicio' },
  async () => {
    sim.entityProblemsFail = true
    await goToRoute(`/entities/SERVICE/${SVC_ID}`)
    await expect(page.getByTestId('entity-page-service')).toBeVisible()

    // Los de métricas, con sus valores y sin aviso.
    await expect(serviceMarker('ok').getByTestId('service-marker-value')).toHaveText(/^135$/)
    await expect(serviceMarker('ko').getByTestId('service-marker-value')).toHaveText(/^15$/)
    await expect(serviceMarker('error-rate').getByTestId('service-marker-value')).toHaveText(
      /^10,0\s?%$/
    )
    await expect(serviceMarker('response-time').getByTestId('service-marker-median')).toContainText(
      /105\sms/
    )
    for (const id of METRIC_MARKERS) {
      await expect(serviceMarker(id).getByRole('button', { name: 'Reintentar' }), id).toHaveCount(0)
    }

    // El de problemas, en su sitio, con el aviso y Reintentar y sin recuentos.
    const problems = serviceMarker('problems')
    await expect(problems).toBeVisible()
    await expect(problems.getByRole('button', { name: 'Reintentar' })).toBeVisible()
    await expect(problems.getByTestId('service-marker-open')).toHaveCount(0)
    await expect(problems.getByTestId('service-marker-closed')).toHaveCount(0)

    sim.entityProblemsFail = false
    await problems.getByRole('button', { name: 'Reintentar' }).click()
    await expectErrorServiceValues()
    await expect(problems.getByRole('button', { name: 'Reintentar' })).toHaveCount(0)
  }
)

test(
  'CA6 (0008): un servicio sin datos enseña «—» en los marcadores de métricas, no 0',
  { tag: '@servicio' },
  async () => {
    await analyzeMarkersEvidence(MK_EV_EMPTY)
    // Las consultas se han hecho y han vuelto (vacías).
    await expect.poll(() => sim.serviceMetricQueries.length).toBe(2)
    await expect.poll(() => sim.entityProblemQueries.length).toBe(2)

    for (const id of ['availability', 'ok', 'ko', 'error-rate'] as const) {
      await expect(serviceMarker(id).getByTestId('service-marker-value'), id).toHaveText('—')
    }
    const times = serviceMarker('response-time')
    for (const id of ['median', 'p90', 'p99'] as const) {
      await expect(times.getByTestId(`service-marker-${id}`), id).toContainText('—')
    }
    for (const id of METRIC_MARKERS) {
      const marker = serviceMarker(id)
      await expect(marker, id).not.toContainText(/(^|[^\d.,])0([^\d.,]|$)/)
      await expect(marker.getByRole('button', { name: 'Reintentar' }), id).toHaveCount(0)
    }
    // Problemas: Dynatrace sí dice 0 y 0, y eso se enseña.
    const problems = serviceMarker('problems')
    await expect(problems.getByTestId('service-marker-open')).toHaveText(loneNumber('0'))
    await expect(problems.getByTestId('service-marker-closed')).toHaveText(loneNumber('0'))
  }
)

/**
 * Ficha 0009: los cuatro gráficos de la página de un SERVICE, bajo los marcadores, con los datos
 * de SVC_ID (resolución 1m; tiempos de 100 a 900 ms, peticiones, errores y tasa con un hueco en
 * el tercer punto).
 *
 * Nombres que fijan estos tests: la sección `service-charts`; cada gráfico en un
 * `service-chart-panel` con `data-kind` (response-time, activity, error-rate y errors, en ese
 * orden), con su título en un encabezado; dentro, el `Chart` con testid `service-chart-<kind>`
 * (con `data-series` y su `canvas`), que es también el `target` de su `ExportMenu`, y el botón
 * `service-chart-open` («Abrir en Métricas»).
 */
const CHART_KINDS = ['response-time', 'activity', 'error-rate', 'errors'] as const
type ChartKind = (typeof CHART_KINDS)[number]
const CHART_TITLES: Record<ChartKind, string> = {
  'response-time': 'Tiempo de respuesta',
  activity: 'Actividad',
  'error-rate': 'Tasa de error',
  errors: 'Errores'
}
/** Las series de cada gráfico, en su orden: [mediana, p90, p99], [OK, KO], [tasa] y [KO]. */
const CHART_SERIES: Record<ChartKind, RegExp[]> = {
  'response-time': [/mediana/i, /p90/i, /p99/i],
  activity: [/\bOK\b/, /\bKO\b/],
  'error-rate': [/tasa/i],
  errors: [/\bKO\b/]
}

const chartPanel = (kind: ChartKind): Locator =>
  page.locator(`[data-testid="service-chart-panel"][data-kind="${kind}"]`)
const chartPlot = (kind: ChartKind): Locator =>
  chartPanel(kind).getByTestId(`service-chart-${kind}`)

/** Ficha 0009: abre la página de SVC_ID por URL y espera la sección de gráficos. */
async function openServiceCharts(): Promise<Locator> {
  await goToRoute(`/entities/SERVICE/${SVC_ID}`)
  await expect(page.getByTestId('entity-page-service')).toBeVisible()
  const section = page.getByTestId('service-charts')
  await expect(section).toBeVisible()
  return section
}

/** Ficha 0009: espera a que el gráfico tenga sus series (se monta vacío mientras carga). */
async function chartSeries(kind: ChartKind): Promise<string[]> {
  const plot = chartPlot(kind)
  await expect(plot.locator('canvas').first()).toBeVisible()
  await expect(plot).toHaveAttribute('data-series', /\[.+\]/)
  return JSON.parse((await plot.getAttribute('data-series')) ?? '[]') as string[]
}

test(
  'CA1 (0009): en la página de un SERVICE salen los cuatro gráficos en su orden, con su título, su canvas y sus series',
  { tag: '@servicio' },
  async () => {
    const section = await openServiceCharts()
    await expect(section).toContainText('Métricas de peticiones')

    const panels = section.getByTestId('service-chart-panel')
    await expect(panels).toHaveCount(4)
    for (const [index, kind] of CHART_KINDS.entries()) {
      const panel = panels.nth(index)
      await expect(panel, `posición ${index + 1}`).toHaveAttribute('data-kind', kind)
      await expect(panel.getByRole('heading').first(), kind).toContainText(CHART_TITLES[kind])
      const series = await chartSeries(kind)
      expect(series, kind).toHaveLength(CHART_SERIES[kind].length)
      for (const [i, pattern] of CHART_SERIES[kind].entries()) {
        expect(series[i], `${kind}[${i}]`).toMatch(pattern)
      }
    }

    // Los cuatro gráficos y los marcadores comparten una sola llamada al canal (sus dos consultas).
    await settledRequests()
    expect(sim.serviceMetricQueries).toHaveLength(2)
  }
)

test(
  'CA5 (0009): «Abrir en Métricas» de cada gráfico abre Métricas con la consulta de ese gráfico y el rango que se ve',
  { tag: '@servicio' },
  async () => {
    // Con el rango relativo (2 h): el que se ve, en fechas, hasta ahora.
    const openedAt = Date.now()
    await openServiceCharts()
    await chartSeries('response-time')
    let before = sim.metricsQueries
    await expect(chartPanel('response-time').getByTestId('service-chart-open')).toHaveText(
      'Abrir en Métricas'
    )
    await chartPanel('response-time').getByTestId('service-chart-open').click()
    await expect.poll(currentRoute).toBe('/metrics')
    await expect.poll(() => sim.metricsQueries).toBeGreaterThan(before)
    const relFrom = Date.parse(sim.lastMetricsQuery.get('from') ?? '')
    const relTo = Date.parse(sim.lastMetricsQuery.get('to') ?? '')
    expect(relTo).toBeGreaterThanOrEqual(openedAt - 1000)
    expect(relTo).toBeLessThanOrEqual(Date.now())
    expect(relTo - relFrom).toBe(2 * HOUR)

    // Con un rango personalizado: exactamente el del canal, para cada gráfico.
    await openServiceCharts()
    const queriesBefore = sim.serviceMetricQueries.length
    await page.getByTestId('time-range-custom').click()
    const popover = page.getByTestId('custom-range')
    await popover.getByTestId('custom-range-from').fill('2026-10-03T09:00')
    await popover.getByTestId('custom-range-to').fill('2026-10-03T13:00')
    await popover.getByTestId('form-save').click()
    await expect(popover).toBeHidden()
    await expect.poll(() => sim.serviceMetricQueries.length).toBeGreaterThan(queriesBefore)
    const channelQuery = sim.serviceMetricQueries.at(-1) as URLSearchParams
    const from = Date.parse(channelQuery.get('from') ?? '')
    const to = Date.parse(channelQuery.get('to') ?? '')
    // 09:00 y 13:00 en la zona del renderer, que es en la que la app lee lo escrito (ficha 0011:
    // el CI va en UTC y la VPS en Europe/Madrid).
    const zone = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)
    expect(from).toBe(wallTimeToEpoch('2026-10-03T09:00', zone))
    expect(to).toBe(wallTimeToEpoch('2026-10-03T13:00', zone))

    const expected: Record<ChartKind, { has: string[]; not: string[] }> = {
      'response-time': {
        has: ['builtin:service.response.server', ':median', ':percentile(90', ':percentile(99'],
        not: ['requestCount', 'errors.server']
      },
      activity: {
        has: ['builtin:service.requestCount.server', 'builtin:service.errors.server.count'],
        not: ['response.server', 'errors.server.rate']
      },
      'error-rate': {
        has: ['builtin:service.errors.server.rate'],
        not: ['requestCount', 'response.server', 'errors.server.count']
      },
      errors: {
        has: ['builtin:service.errors.server.count'],
        not: ['requestCount', 'response.server', 'errors.server.rate']
      }
    }
    for (const kind of CHART_KINDS) {
      await openServiceCharts()
      await chartSeries(kind)
      before = sim.metricsQueries
      await chartPanel(kind).getByTestId('service-chart-open').click()
      await expect.poll(currentRoute, kind).toBe('/metrics')
      await expect.poll(() => sim.metricsQueries, kind).toBeGreaterThan(before)
      // El rango que se ve.
      expect(Date.parse(sim.lastMetricsQuery.get('from') ?? ''), kind).toBe(from)
      expect(Date.parse(sim.lastMetricsQuery.get('to') ?? ''), kind).toBe(to)
      // La consulta de ese gráfico, con el id del servicio, en el formulario y en la petición.
      const selector = sim.lastMetricsQuery.get('metricSelector') ?? ''
      await expect(page.getByTestId('metric-selector'), kind).toHaveValue(selector)
      expect(selector, kind).toContain(SVC_ID)
      for (const part of expected[kind].has) expect(selector, `${kind}: ${part}`).toContain(part)
      for (const part of expected[kind].not)
        expect(selector, `${kind}: ${part}`).not.toContain(part)
    }
  }
)

/**
 * Ficha 0047: la página del servicio según el conjunto de métricas de la 0046 (servicios de
 * `SVC_SET_IDS` y `SVC_DB_ID`). Nombres que fijan estos tests: la nota bajo los marcadores en
 * `service-metric-set-note` (con su tooltip al pasar el ratón), el marcador `service-marker-requests`
 * («Peticiones») de Solo actividad y la cabecera «Servicio · <nombre del tipo>» en
 * `entity-page-type`.
 */
async function openServicePage(id: string): Promise<Locator> {
  await goToRoute(`/entities/SERVICE/${id}`)
  const servicePage = page.getByTestId('entity-page-service')
  await expect(servicePage).toBeVisible()
  await expect(servicePage.getByTestId('service-markers')).toBeVisible()
  return servicePage
}

/** Ficha 0047: los marcadores completos de siempre (los de la 0008 y, desde la 0066, «SLO»). */
const FULL_MARKERS = [
  'availability',
  'ok',
  'ko',
  'error-rate',
  'response-time',
  'problems'
] as const

test(
  'CA1 (0047): un QUEUE_LISTENER_SERVICE enseña solo Peticiones y Problemas, el gráfico de actividad sin KO y la nota; no tiempos, errores ni tasa',
  { tag: '@servicio' },
  async () => {
    const servicePage = await openServicePage(SVC_SET_IDS.activity)

    // Marcadores: Peticiones (la suma del recuento, 10) y Problemas; ninguno de tiempos ni errores.
    const requests = serviceMarker('requests')
    await expect(requests).toBeVisible()
    await expect(requests).toContainText('Peticiones')
    await expect(requests.getByTestId('service-marker-value')).toHaveText(/^10$/)
    await expect(serviceMarker('problems')).toBeVisible()
    for (const id of ['ok', 'ko', 'error-rate', 'response-time']) {
      await expect(serviceMarker(id), id).toHaveCount(0)
    }
    const markers = servicePage.getByTestId('service-markers')
    await expect(markers).not.toContainText('Tiempo de respuesta')
    await expect(markers).not.toContainText('Tasa de error')
    await expect(markers).not.toContainText('Peticiones KO')

    // La nota que lo explica.
    const note = servicePage.getByTestId('service-metric-set-note')
    await expect(note).toBeVisible()
    await expect(note).toContainText('Este tipo de servicio solo mide actividad')

    // Gráficos: solo el de actividad, con una serie (sin la parte KO).
    const panels = page.getByTestId('service-chart-panel')
    await expect(panels).toHaveCount(1)
    await expect(panels.first()).toHaveAttribute('data-kind', 'activity')
    const series = await chartSeries('activity')
    expect(series).toHaveLength(1)
    expect(series[0]).not.toMatch(/\bKO\b/)
    for (const kind of ['response-time', 'error-rate', 'errors'] as const) {
      await expect(chartPanel(kind), kind).toHaveCount(0)
    }
  }
)

test(
  'CA2 (0047): un DATABASE_SERVICE enseña los marcadores y gráficos completos, la nota de cliente con su tooltip y «Base de datos» en la cabecera',
  { tag: '@servicio' },
  async () => {
    const servicePage = await openServicePage(SVC_DB_ID)

    // Cabecera: el tipo de entidad y el del servicio.
    await expect(servicePage.getByTestId('entity-page-type')).toHaveText('Servicio · Base de datos')

    // Los seis marcadores, con los datos de Cliente (60 peticiones, 4 KO, mediana 210 ms).
    for (const id of FULL_MARKERS) await expect(serviceMarker(id), id).toBeVisible()
    await expect(serviceMarker('requests')).toHaveCount(0)
    await expect(serviceMarker('ok').getByTestId('service-marker-value')).toHaveText(/^56$/)
    await expect(serviceMarker('ko').getByTestId('service-marker-value')).toHaveText(/^4$/)
    await expect(serviceMarker('response-time').getByTestId('service-marker-median')).toContainText(
      /210\sms/
    )

    // Los cuatro gráficos.
    await expect(page.getByTestId('service-chart-panel')).toHaveCount(4)
    for (const kind of CHART_KINDS) await expect(chartPanel(kind), kind).toHaveCount(1)

    // La nota de cliente y su tooltip.
    const note = servicePage.getByTestId('service-metric-set-note')
    await expect(note).toBeVisible()
    await expect(note).toContainText('Medido desde los clientes')
    await note.scrollIntoViewIfNeeded()
    await hoverFresh(page, note)
    await expect(page.getByRole('tooltip')).toBeVisible()
    await expect(page.getByRole('tooltip')).toContainText(/cliente/i)
    await moveToNeutral(page)
  }
)

test(
  'CA3 (0047): «Abrir en Métricas» de los tiempos abre Métricas con la métrica de cliente o la unificada, no la de servidor',
  { tag: '@servicio' },
  async () => {
    const cases = [
      {
        id: SVC_DB_ID,
        has: 'builtin:service.response.client',
        not: 'builtin:service.response.server'
      },
      {
        id: SVC_SET_IDS.unified,
        has: SVC_UNIFIED_KEYS.time,
        not: 'builtin:service.response.'
      }
    ]
    for (const { id, has, not } of cases) {
      await openServicePage(id)
      await chartSeries('response-time')
      const before = sim.metricsQueries
      await chartPanel('response-time').getByTestId('service-chart-open').click()
      await expect.poll(currentRoute, id).toBe('/metrics')
      await expect.poll(() => sim.metricsQueries, id).toBeGreaterThan(before)
      const selector = sim.lastMetricsQuery.get('metricSelector') ?? ''
      await expect(page.getByTestId('metric-selector'), id).toHaveValue(selector)
      expect(selector, id).toContain(id)
      expect(selector, id).toContain(has)
      expect(selector, `${id}: ${not}`).not.toContain(not)
      for (const part of [':median', ':percentile(90', ':percentile(99']) {
        expect(selector, `${id}: ${part}`).toContain(part)
      }
    }
  }
)

test(
  'CA4 (0047): un WEB_SERVICE se ve como hoy: marcadores y gráficos completos, sin nota y su tipo en la cabecera',
  { tag: '@servicio' },
  async () => {
    const servicePage = await openServicePage(SVC_ID)
    await expect(servicePage.getByTestId('entity-page-type')).toHaveText('Servicio · Servicio web')
    for (const id of FULL_MARKERS) await expect(serviceMarker(id), id).toBeVisible()
    await expect(serviceMarker('requests')).toHaveCount(0)
    await expect(page.getByTestId('service-chart-panel')).toHaveCount(4)
    expect(await chartSeries('activity')).toHaveLength(2)
    await expect(servicePage.getByTestId('service-metric-set-note')).toHaveCount(0)
  }
)

/**
 * Ficha 0048: disponibilidad (SLO calculado por Vigía) de la página del servicio. Nombres que fijan
 * estos tests: el panel `service-slo-panel` (dentro de `service-charts`, encima de la rejilla de
 * los `service-chart-panel`), con su título en `service-slo-title` (disparador del tooltip, con
 * foco) y el `Chart` `service-slo-chart` con `data-series` y `data-thresholds` (los valores de
 * las líneas horizontales de la opción, en JSON). Desde la ficha 0066, la disponibilidad del rango
 * no es una línea dentro de «Tasa de error» sino su propio marcador `service-marker-availability`
 * («SLO»), con el valor en `service-marker-value` y su `data-level`.
 */
const sloPanel = (): Locator => page.getByTestId('service-slo-panel')
const sloChart = (): Locator => sloPanel().getByTestId('service-slo-chart')

test(
  'CA3 (0048): con una caída por debajo del 90 %, el gráfico de disponibilidad sale encima de la rejilla con su serie y el umbral, y el marcador en color de error',
  { tag: '@servicio' },
  async () => {
    const servicePage = await openServicePage(SVC_SLO_ID)
    const section = servicePage.getByTestId('service-charts')

    // El panel, dentro de la sección de gráficos y encima del primero de la rejilla.
    const panel = section.getByTestId('service-slo-panel')
    await expect(panel).toBeVisible()
    // Título «SLO» desde la ficha 0065 (CA2).
    await expect(panel.getByTestId('service-slo-title')).toHaveText('SLO')
    const firstGrid = section.getByTestId('service-chart-panel').first()
    await expect(firstGrid).toBeVisible()
    const sloBox = await panel.boundingBox()
    const gridBox = await firstGrid.boundingBox()
    expect(sloBox).not.toBeNull()
    expect(gridBox).not.toBeNull()
    expect((sloBox?.y ?? 0) + (sloBox?.height ?? 0)).toBeLessThanOrEqual(gridBox?.y ?? 0)
    // A todo el ancho: tan ancho como la rejilla entera.
    const gridRow = await firstGrid.locator('xpath=..').boundingBox()
    expect(Math.abs((sloBox?.width ?? 0) - (gridRow?.width ?? 0))).toBeLessThanOrEqual(2)
    // La rejilla sigue con sus cuatro gráficos.
    await expect(section.getByTestId('service-chart-panel')).toHaveCount(4)

    // Su serie y la línea del umbral del 90 %.
    const chart = sloChart()
    await expect(chart.locator('canvas').first()).toBeVisible()
    await expect(chart).toHaveAttribute('data-series', /\[.+\]/)
    const series = JSON.parse((await chart.getAttribute('data-series')) ?? '[]') as string[]
    expect(series).toHaveLength(1)
    expect(series[0]).toMatch(/disponibilidad/i)
    await expect(chart).toHaveAttribute('data-thresholds', '[90]')

    // Sin «Abrir en Métricas» (es un cálculo de Vigía), pero se puede exportar.
    await expect(panel.getByTestId('service-chart-open')).toHaveCount(0)
    await expect(
      panel.locator('[data-testid="export-menu"][data-export-target="service-slo-chart"]')
    ).toBeVisible()

    // El marcador «SLO» (ficha 0066), con la disponibilidad del rango en color de error y con texto.
    const marker = serviceMarker('availability')
    const value = marker.getByTestId('service-marker-value')
    await expect(value).toHaveText(/^85,3\s?%$/)
    await expect(value).toHaveAttribute('data-level', 'error')
    await expect(value).toHaveClass(/\btext-danger\b/)
    await expect(marker).toContainText(/por debajo del 90\s?%/)
  }
)

test(
  'CA3 (0048): sin bajar del 90 %, la disponibilidad del marcador no va en color de error',
  { tag: '@servicio' },
  async () => {
    await openServicePage(SVC_BIG_ID)
    // El marcador «SLO» (ficha 0066).
    const value = serviceMarker('availability').getByTestId('service-marker-value')
    await expect(value).toHaveText(/^100,0\s?%$/)
    await expect(value).not.toHaveAttribute('data-level', 'error')
    await expect(value).not.toHaveClass(/\btext-danger\b/)
    await expect(sloPanel()).toBeVisible()
  }
)

test(
  'CA4 (0048): en un servicio de solo actividad no salen el gráfico de disponibilidad ni su marcador',
  { tag: '@servicio' },
  async () => {
    const servicePage = await openServicePage(SVC_SET_IDS.activity)
    // Espera a que la página esté pintada con los datos (el gráfico de actividad, con su serie).
    expect(await chartSeries('activity')).toHaveLength(1)
    await expect(servicePage.getByTestId('service-slo-panel')).toHaveCount(0)
    await expect(servicePage.getByTestId('service-slo-chart')).toHaveCount(0)
    await expect(servicePage.getByTestId('service-marker-availability')).toHaveCount(0)
  }
)

/**
 * Ficha 0066: la disponibilidad del rango tiene su propio marcador, `service-marker-availability`
 * («SLO»), el primero de la fila de `service-markers`. El valor va en `service-marker-value` con
 * `data-level` (`error` por debajo del 90 %, `success` del 90 % para arriba, `normal` sin dato) y
 * la clase de color del nivel (`text-danger` o `text-status-closed`); por debajo del 90 %, el texto
 * «por debajo del 90 %» bajo el valor (`service-marker-level`).
 */
test(
  'CA2 (0066): la fila tiene seis marcadores y el primero, a la izquierda, es «SLO», seguido de «Peticiones OK»; «Tasa de error» ya no lleva la disponibilidad',
  { tag: '@servicio' },
  async () => {
    const servicePage = await openServicePage(SVC_ID)
    await expectErrorServiceValues()
    const row = servicePage.getByTestId('service-markers')
    const cards = row.locator(':scope > [data-testid^="service-marker-"]')
    await expect(cards).toHaveCount(6)

    // En el DOM: primero «SLO», después «Peticiones OK».
    await expect(cards.nth(0)).toHaveAttribute('data-testid', 'service-marker-availability')
    await expect(cards.nth(1)).toHaveAttribute('data-testid', 'service-marker-ok')
    const slo = serviceMarker('availability')
    await expect(slo.getByRole('heading')).toHaveText('SLO')

    // En pantalla: en la misma fila y a la izquierda de «Peticiones OK».
    const sloBox = await slo.boundingBox()
    const okBox = await serviceMarker('ok').boundingBox()
    expect(sloBox).not.toBeNull()
    expect(okBox).not.toBeNull()
    expect(Math.abs((sloBox?.y ?? 0) - (okBox?.y ?? -100))).toBeLessThanOrEqual(2)
    expect((sloBox?.x ?? 0) + (sloBox?.width ?? 0)).toBeLessThanOrEqual(okBox?.x ?? 0)

    // «Tasa de error» se queda solo con su valor.
    const errorRate = serviceMarker('error-rate')
    await expect(errorRate.getByTestId('service-marker-value')).toHaveText(/^10,0\s?%$/)
    await expect(errorRate.getByTestId('service-marker-availability')).toHaveCount(0)
    await expect(errorRate).not.toContainText('Disponibilidad')
    await expect(errorRate).not.toContainText(/90\s?%/)
  }
)

test(
  'CA3 (0066): con un 85,3 % el marcador «SLO» va en color de error y con «por debajo del 90 %»; con un 100,0 %, en color de éxito y sin ese texto',
  { tag: '@servicio' },
  async () => {
    await openServicePage(SVC_SLO_ID)
    const critical = serviceMarker('availability')
    const criticalValue = critical.getByTestId('service-marker-value')
    await expect(criticalValue).toHaveText(/^85,3\s?%$/)
    await expect(criticalValue).toHaveAttribute('data-level', 'error')
    await expect(criticalValue).toHaveClass(/\btext-danger\b/)
    const levelText = critical.getByTestId('service-marker-level')
    await expect(levelText).toHaveText(/^por debajo del 90\s?%$/)
    await expect(levelText).toHaveClass(/\btext-danger\b/)
    // El color, el mismo que el de un valor en error de otro marcador (KO con errores).
    const koValue = serviceMarker('ko').getByTestId('service-marker-value')
    await expect(koValue).toHaveAttribute('data-level', 'error')
    const colorOf = (locator: Locator): Promise<string> =>
      locator.evaluate((element) => getComputedStyle(element).color)
    expect(await colorOf(criticalValue)).toBe(await colorOf(koValue))

    await openServicePage(SVC_BIG_ID)
    const healthy = serviceMarker('availability')
    const healthyValue = healthy.getByTestId('service-marker-value')
    await expect(healthyValue).toHaveText(/^100,0\s?%$/)
    await expect(healthyValue).toHaveAttribute('data-level', 'success')
    await expect(healthyValue).toHaveClass(/\btext-status-closed\b/)
    await expect(healthyValue).not.toHaveClass(/\btext-danger\b/)
    await expect(healthy.getByTestId('service-marker-level')).toHaveCount(0)
    await expect(healthy).not.toContainText(/por debajo/)
    expect(await colorOf(healthyValue)).not.toBe(await colorOf(koValue))
  }
)

test(
  'CA4 (0066): en un servicio de solo actividad no sale el marcador «SLO»; sin peticiones en el rango, sale «—» sin color',
  { tag: '@servicio' },
  async () => {
    const activity = await openServicePage(SVC_SET_IDS.activity)
    await expect(serviceMarker('requests').getByTestId('service-marker-value')).toHaveText(/^10$/)
    await expect(activity.getByTestId('service-marker-availability')).toHaveCount(0)
    await expect(activity.getByTestId('service-markers')).not.toContainText('SLO')

    await openServicePage(SVC_EMPTY_ID)
    const empty = serviceMarker('availability')
    await expect(empty).toBeVisible()
    const value = empty.getByTestId('service-marker-value')
    await expect(value).toHaveText('—')
    await expect(value).toHaveAttribute('data-level', 'normal')
    await expect(value).not.toHaveClass(/\btext-(danger|status-closed)\b/)
    await expect(empty.getByTestId('service-marker-level')).toHaveCount(0)
  }
)

test(
  'CA2 (0065) y CA5 (0048): el tooltip del nombre del gráfico explica la fórmula, con ratón y con foco',
  { tag: '@servicio' },
  async () => {
    await openServicePage(SVC_SLO_ID)
    const title = sloPanel().getByTestId('service-slo-title')
    await expect(title).toBeVisible()
    const tooltip = page.getByRole('tooltip')

    // Con el ratón.
    await hoverFresh(page, title)
    await expect(tooltip).toBeVisible()
    await expect(tooltip).toContainText(/peticiones/i)
    await expect(tooltip).toContainText(/errores/i)
    await expect(tooltip).toContainText('Vigía')
    await moveToNeutral(page)
    await page.keyboard.press('Escape')
    await expect(tooltip).toHaveCount(0)

    // Con el foco, ya a la vista (Radix cierra el tooltip si su contenedor se desplaza).
    await title.evaluate((element) => element.scrollIntoView({ block: 'center' }))
    await settledBox(title)
    await title.focus()
    await expect(title).toBeFocused()
    await expect(tooltip).toBeVisible()
    await expect(tooltip).toContainText(/peticiones/i)
    await page.keyboard.press('Escape')
    await expect(tooltip).toHaveCount(0)
  }
)

/**
 * Ficha 0009: ancho del contenido de la ventana fijado desde main (setContentSize), con el alto
 * de FIXED_WINDOW, y de vuelta a FIXED_WINDOW al final aunque el test falle (ficha 0021). Solo se espera al ancho: es lo
 * único de lo que dependen las columnas (withContentSize espera además al alto, con el margen
 * del redondeo de Windows al escalar).
 */
async function withContentWidth(width: number, body: () => Promise<void>): Promise<void> {
  await app.evaluate(
    ({ BrowserWindow }, wanted) => {
      const win = BrowserWindow.getAllWindows()[0]
      if (win === undefined) throw new Error('withContentWidth: no hay ventana')
      win.setContentSize(wanted.width, wanted.height)
    },
    { width, height: FIXED_WINDOW.height }
  )
  try {
    await expect.poll(async () => (await viewportSize()).width).toBe(width)
    await body()
  } finally {
    await app.evaluate(({ BrowserWindow }, back) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(back.width, back.height)
    }, FIXED_WINDOW)
    await expect.poll(async () => fitsContentSize(await viewportSize(), FIXED_WINDOW)).toBe(true)
  }
}

/** Ficha 0009: posición (redondeada) de cada gráfico, en su orden, cuando ya no se mueven. */
async function chartBoxes(): Promise<{ x: number; y: number }[]> {
  const boxes: { x: number; y: number }[] = []
  for (const kind of CHART_KINDS) {
    const box = await settledBox(chartPanel(kind))
    boxes.push({ x: Math.round(box.x), y: Math.round(box.y) })
  }
  return boxes
}

test(
  'CA6 (0009): con la ventana estrecha (la mínima de la app, 960 de ancho), una columna; con la normal (1024), dos',
  { tag: '@servicio' },
  async () => {
    await openServiceCharts()
    for (const kind of CHART_KINDS) await chartSeries(kind)

    await withContentWidth(SMALL_WINDOW.width, async () => {
      const [a, b, c, d] = await chartBoxes()
      // Una columna: todos a la misma x, uno debajo de otro.
      expect(b?.x, 'actividad bajo tiempos').toBe(a?.x)
      expect(c?.x).toBe(a?.x)
      expect(d?.x).toBe(a?.x)
      expect(b?.y ?? 0).toBeGreaterThan(a?.y ?? 0)
      expect(c?.y ?? 0).toBeGreaterThan(b?.y ?? 0)
      expect(d?.y ?? 0).toBeGreaterThan(c?.y ?? 0)
    })

    await withContentWidth(FIXED_WINDOW.width, async () => {
      const [a, b, c, d] = await chartBoxes()
      // Dos columnas: 1 y 2 en la primera fila, 3 y 4 en la segunda.
      expect(b?.y, 'actividad junto a tiempos').toBe(a?.y)
      expect(b?.x ?? 0).toBeGreaterThan(a?.x ?? 0)
      expect(c?.x).toBe(a?.x)
      expect(c?.y ?? 0).toBeGreaterThan(a?.y ?? 0)
      expect(d?.y).toBe(c?.y)
      expect(d?.x).toBe(b?.x)
    })
  }
)

test(
  'CA7 (0009): si el canal falla, los cuatro gráficos enseñan el aviso con Reintentar y los problemas de los marcadores siguen',
  { tag: '@servicio' },
  async () => {
    sim.serviceMetricsFail = true
    await openServiceCharts()

    // El marcador de problemas, con sus recuentos y sin aviso.
    const problems = serviceMarker('problems')
    await expect(problems.getByTestId('service-marker-open')).toHaveText(loneNumber('1'))
    await expect(problems.getByTestId('service-marker-closed')).toHaveText(loneNumber('2'))
    await expect(problems.getByRole('button', { name: 'Reintentar' })).toHaveCount(0)

    // Cada gráfico, en su sitio, con su aviso (role=alert) y Reintentar, sin gráfico.
    for (const kind of CHART_KINDS) {
      const panel = chartPanel(kind)
      await expect(panel, kind).toBeVisible()
      await expect(panel.getByRole('alert').first(), kind).toBeVisible()
      await expect(panel.getByRole('button', { name: 'Reintentar' }), kind).toBeVisible()
      await expect(panel.getByTestId(`service-chart-${kind}`), kind).toHaveCount(0)
    }

    // Reintentar, con el canal ya bien: llega el gráfico.
    sim.serviceMetricsFail = false
    await chartPanel('errors').getByRole('button', { name: 'Reintentar' }).click()
    expect(await chartSeries('errors')).toHaveLength(1)
    await expect(chartPanel('errors').getByRole('button', { name: 'Reintentar' })).toHaveCount(0)
  }
)

test(
  'CA8 (0009): la exportación XLSX de un gráfico trae sus series y la hoja Info con el rango',
  { tag: '@servicio' },
  async () => {
    await openServiceCharts()
    await chartSeries('response-time')
    const file = await exportSaved('service-chart-response-time', 'export-xlsx')
    const book = new ExcelJS.Workbook()
    await book.xlsx.load(readFileSync(file) as unknown as ArrayBuffer)

    // Datos: los valores de mediana, p90 y p99 (en ms) y sus nombres; nada de las otras series.
    const data = book.getWorksheet('Datos')
    expect(data, 'hoja Datos').toBeDefined()
    const numbers: number[] = []
    const texts: string[] = []
    data?.eachRow((row) => {
      row.eachCell((cell) => {
        if (typeof cell.value === 'number') numbers.push(cell.value)
        else if (typeof cell.value === 'string') texts.push(cell.value)
      })
    })
    for (const value of [100, 120, 110, 300, 320, 310, 800, 900, 850]) {
      expect(numbers, `valor ${value}`).toContain(value)
    }
    for (const value of [45, 50, 60]) {
      expect(numbers, `no es de tiempos: ${value}`).not.toContain(value)
    }
    const allText = texts.join('\n')
    expect(allText).toMatch(/mediana/i)
    expect(allText).toMatch(/p90/i)
    expect(allText).toMatch(/p99/i)

    // Info: el rango global y sus fechas.
    const info: Record<string, unknown> = {}
    book.getWorksheet('Info')?.eachRow((row) => {
      info[String(row.getCell(1).value)] = row.getCell(2).value
    })
    expect(info['Rango']).toBe('now-2h')
    expect(info['Desde']).toBeInstanceOf(Date)
    expect(info['Hasta']).toBeInstanceOf(Date)
    const span = (info['Hasta'] as Date).getTime() - (info['Desde'] as Date).getTime()
    expect(span).toBe(2 * HOUR)
  }
)

/**
 * Ficha 0010: franja de los problemas de la entidad sobre el gráfico «Tasa de error» (canal
 * entities:problems). SVC_BAND_ID tiene un problema abierto (P-E2E41, desde hace 30 min) y uno
 * cerrado (P-E2E42, de hace 100 a hace 70 min); SVC_QUIET_ID, ninguno.
 *
 * Nombres que fijan estos tests: la franja `service-problem-band`, dentro del panel de la tasa
 * de error; cada tramo `service-problem-segment`, con `data-problem-id` (el problemId) y
 * `data-status` (`open` o `closed`), enfocable y con su estado en el nombre accesible
 * («Abierto» o «Cerrado»); el tooltip de un tramo, `service-problem-tooltip`, con el id visible,
 * el título, el estado, la hora de inicio y la de fin (HH:MM) o «Activo». Con el canal caído, la
 * franja sigue, con su aviso (`role="alert"`) y «Reintentar».
 */
const problemBand = (): Locator => chartPanel('error-rate').getByTestId('service-problem-band')
const bandSegments = (): Locator => page.getByTestId('service-problem-segment')
const bandSegment = (problemId: string): Locator =>
  problemBand().locator(`[data-testid="service-problem-segment"][data-problem-id="${problemId}"]`)
const bandTooltip = (): Locator => page.getByTestId('service-problem-tooltip')

/** Ficha 0010: abre la página de un servicio por URL y espera el gráfico de la tasa de error. */
async function openBandService(id: string): Promise<void> {
  await goToRoute(`/entities/SERVICE/${id}`)
  await expect(page.getByTestId('entity-page-service')).toBeVisible()
  await chartSeries('error-rate')
}

/** Ficha 0010: hora y minutos (HH:MM) de un instante, en la zona del renderer. */
async function clockOf(time: number): Promise<string> {
  return page.evaluate(
    (t) => new Date(t).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }),
    time
  )
}

/** Ficha 0010: consultas hechas por los tres canales de la página del servicio. */
const serviceQueries = (): number[] => [
  sim.serviceMetricQueries.length,
  sim.entityProblemQueries.length,
  sim.entityProblemListQueries.length
]

test(
  'CA4 (0010): en la página de un SERVICE con un problema abierto y uno cerrado salen dos tramos con su estado (atributo y texto) y el tooltip enseña id, título, estado, inicio y fin',
  { tag: '@servicio' },
  async () => {
    await openBandService(SVC_BAND_ID)
    const band = problemBand()
    await expect(band).toBeVisible()
    await expect(bandSegments()).toHaveCount(2)

    // Una sola consulta de la lista, con la entidad, el rango, pageSize=100 y sort=-startTime.
    await settledRequests()
    expect(sim.entityProblemListQueries).toHaveLength(1)
    const query = sim.entityProblemListQueries[0] as URLSearchParams
    expect(query.get('problemSelector')).toBe(`affectedEntities("${SVC_BAND_ID}")`)
    expect(query.get('from')).toBe('now-2h')
    expect(query.get('pageSize')).toBe('100')
    expect(query.get('sort')).toBe('-startTime')

    // Estado en un atributo y en el texto (no solo el color).
    const open = bandSegment(BAND_OPEN.problemId)
    const closed = bandSegment(BAND_CLOSED.problemId)
    await expect(open).toHaveAttribute('data-status', 'open')
    await expect(closed).toHaveAttribute('data-status', 'closed')
    await expect(open).toHaveAccessibleName(/Abierto/)
    await expect(open).not.toHaveAccessibleName(/Cerrado/)
    await expect(closed).toHaveAccessibleName(/Cerrado/)
    await expect(closed).not.toHaveAccessibleName(/Abierto/)

    // Los dos dentro de la franja; el cerrado (más antiguo) a la izquierda del abierto.
    const bandBox = await settledBox(band)
    const openBox = await settledBox(open)
    const closedBox = await settledBox(closed)
    for (const [name, box] of [
      ['abierto', openBox],
      ['cerrado', closedBox]
    ] as const) {
      expect(box.x, name).toBeGreaterThanOrEqual(bandBox.x - 1)
      expect(box.x + box.width, name).toBeLessThanOrEqual(bandBox.x + bandBox.width + 1)
      expect(box.width, name).toBeGreaterThan(0)
    }
    expect(closedBox.x + closedBox.width).toBeLessThanOrEqual(openBox.x + 1)

    const times = bandTimes()
    // Tooltip con el ratón: el cerrado, con su inicio y su fin.
    await hoverFresh(page, closed)
    const tooltip = bandTooltip()
    await expect(tooltip).toBeVisible()
    for (const text of [
      BAND_CLOSED.displayId,
      BAND_CLOSED.title,
      'Cerrado',
      await clockOf(times.closed[0]),
      await clockOf(times.closed[1])
    ]) {
      await expect(tooltip, text).toContainText(text)
    }
    await expect(tooltip).not.toContainText('Activo')
    await expect(tooltip).not.toContainText(BAND_OPEN.displayId)
    await moveToNeutral(page)
    await expect(tooltip).toHaveCount(0)

    // Tooltip con el foco: el abierto, con su inicio y «Activo» como fin.
    await open.focus()
    await expect(tooltip).toBeVisible()
    for (const text of [
      BAND_OPEN.displayId,
      BAND_OPEN.title,
      'Abierto',
      await clockOf(times.open[0]),
      'Activo'
    ]) {
      await expect(tooltip, text).toContainText(text)
    }
    await expect(tooltip).not.toContainText(BAND_CLOSED.displayId)
    await open.blur()
    await expect(tooltip).toHaveCount(0)
  }
)

test(
  'CA5 (0010): pulsar un tramo (y Enter con el foco) abre el detalle de ese problema; «Volver» vuelve a la página del servicio sin pedir otra vez sus datos',
  { tag: '@servicio' },
  async () => {
    await openBandService(SVC_BAND_ID)
    await expect(bandSegments()).toHaveCount(2)
    await settledRequests()
    const before = serviceQueries()
    // Al entrar: las dos consultas de métricas, las dos de recuentos y la de la lista.
    expect(before).toEqual([2, 2, 1])

    // Clic en el cerrado.
    await clickInPlace(bandSegment(BAND_CLOSED.problemId), { scroll: true })
    await expect(page.getByTestId('problem-page')).toBeVisible()
    await expect(page.getByTestId('problem-page-title')).toContainText(BAND_CLOSED.displayId)
    expect(await currentRoute()).toBe(`/problems/${BAND_CLOSED.problemId}`)

    await page.getByTestId('problem-back').click()
    await expect(page.getByTestId('entity-page-service')).toBeVisible()
    expect(await currentRoute()).toBe(`/entities/SERVICE/${SVC_BAND_ID}`)
    await expect(bandSegments()).toHaveCount(2)
    await settledRequests()
    expect(serviceQueries(), 'consultas del servicio tras volver (clic)').toEqual(before)

    // Enter con el foco en el abierto.
    await bandSegment(BAND_OPEN.problemId).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('problem-page')).toBeVisible()
    await expect(page.getByTestId('problem-page-title')).toContainText(BAND_OPEN.displayId)
    expect(await currentRoute()).toBe(`/problems/${BAND_OPEN.problemId}`)

    await page.getByTestId('problem-back').click()
    await expect(page.getByTestId('entity-page-service')).toBeVisible()
    expect(await currentRoute()).toBe(`/entities/SERVICE/${SVC_BAND_ID}`)
    await expect(bandSegments()).toHaveCount(2)
    await settledRequests()
    expect(serviceQueries(), 'consultas del servicio tras volver (Enter)').toEqual(before)
  }
)

test(
  'CA6 (0010): sin problemas en el rango no hay franja ni hueco sobre la tasa de error',
  { tag: '@servicio' },
  async () => {
    await openBandService(SVC_QUIET_ID)
    await chartSeries('errors')
    // La lista se ha pedido y ha vuelto vacía.
    await expect.poll(() => sim.entityProblemListQueries.length).toBe(1)
    await settledRequests()
    await expect(page.getByTestId('service-problem-band')).toHaveCount(0)
    await expect(bandSegments()).toHaveCount(0)

    // Ni hueco: el gráfico de la tasa de error empieza a la misma altura dentro de su panel que
    // el de Errores (el de al lado, sin franja) y mide lo mismo.
    const placement = async (kind: ChartKind): Promise<{ top: number; height: number }> => {
      const panel = await settledBox(chartPanel(kind))
      const plot = await settledBox(chartPlot(kind))
      return { top: Math.round(plot.y - panel.y), height: Math.round(plot.height) }
    }
    expect(await placement('error-rate')).toEqual(await placement('errors'))
  }
)

test(
  'CA6 (0010): si el canal de la lista falla, la franja enseña el aviso con Reintentar y el gráfico de tasa de error sigue',
  { tag: '@servicio' },
  async () => {
    sim.entityProblemListFail = true
    await openBandService(SVC_BAND_ID)

    // Aviso en la franja, con Reintentar, y ningún tramo.
    const band = problemBand()
    await expect(band).toBeVisible()
    await expect(band.getByRole('alert').first()).toBeVisible()
    await expect(band.getByRole('button', { name: 'Reintentar' })).toBeVisible()
    await expect(bandSegments()).toHaveCount(0)

    // El gráfico sigue, con su serie y sin aviso propio; los marcadores de problemas, también.
    expect(await chartSeries('error-rate')).toHaveLength(1)
    await expect(chartPanel('error-rate').getByRole('button', { name: 'Reintentar' })).toHaveCount(
      1
    )
    const problems = serviceMarker('problems')
    await expect(problems.getByTestId('service-marker-open')).toHaveText(loneNumber('1'))
    await expect(problems.getByTestId('service-marker-closed')).toHaveText(loneNumber('1'))

    // Reintentar, con el canal ya bien: llegan los dos tramos.
    sim.entityProblemListFail = false
    await band.getByRole('button', { name: 'Reintentar' }).click()
    await expect(bandSegments()).toHaveCount(2)
    await expect(problemBand().getByRole('button', { name: 'Reintentar' })).toHaveCount(0)
    await expect(problemBand().getByRole('alert')).toHaveCount(0)
    expect(sim.entityProblemListQueries).toHaveLength(2)
  }
)

/**
 * Ficha 0013: la franja de problemas se ve entera. Lo que se mide de cada tramo: su caja, la del
 * icono (el `svg`) y la del texto que se ve (sus nodos de texto, con un Range). Un texto cuenta
 * como visible si su caja toca la del tramo; si la toca, tiene que caber entera en ella (un texto
 * cortado por el tramo es un recorte). Con zoom 1,5 (`setZoomFactor`, como el escalado al 150 %
 * de la VPS) y con la ventana del CI (pantalla de 1024×768: contenido de unos 1008×705).
 */
const CI_WINDOW = { width: 1008, height: 705 }

interface Rect {
  left: number
  top: number
  right: number
  bottom: number
}

interface SegmentFit {
  problemId: string
  segment: Rect
  icon: Rect | null
  /** Caja del texto que toca el tramo; null si no se ve ningún texto. */
  text: Rect | null
  band: Rect
  /** Ancho natural del id (todo su texto, se vea o no). */
  idWidth: number
  /** Sitio dentro del tramo: su ancho interior, sin borde ni relleno. */
  room: number
  /** Ancho que piden el icono y el id en una línea: relleno de la línea, icono, hueco e id. */
  needed: number
}

/** Ficha 0013: cajas de cada tramo de la franja, de su icono y de su texto visible. */
async function segmentFits(): Promise<SegmentFit[]> {
  return problemBand().evaluate((band) => {
    const rect = (r: DOMRect): Rect => ({
      left: r.left,
      top: r.top,
      right: r.right,
      bottom: r.bottom
    })
    const touches = (a: Rect, b: Rect): boolean =>
      a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
    return [...band.querySelectorAll<HTMLElement>('[data-testid="service-problem-segment"]')].map(
      (segment) => {
        const box = rect(segment.getBoundingClientRect())
        const svg = segment.querySelector('svg')
        const walker = document.createTreeWalker(segment, NodeFilter.SHOW_TEXT)
        let text: Rect | null = null
        let idWidth = 0
        for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
          if ((node.textContent ?? '').trim() === '') continue
          const range = document.createRange()
          range.selectNodeContents(node)
          const r = rect(range.getBoundingClientRect())
          idWidth += r.right - r.left
          if (node.parentElement?.checkVisibility({ visibilityProperty: true }) !== true) continue
          if (r.right - r.left === 0 || !touches(r, box)) continue
          text =
            text === null
              ? r
              : {
                  left: Math.min(text.left, r.left),
                  top: Math.min(text.top, r.top),
                  right: Math.max(text.right, r.right),
                  bottom: Math.max(text.bottom, r.bottom)
                }
        }
        const px = (value: string): number => Number.parseFloat(value) || 0
        const own = getComputedStyle(segment)
        const room = segment.clientWidth - px(own.paddingLeft) - px(own.paddingRight)
        const line = svg?.parentElement
        const lineStyle = line === null || line === undefined ? null : getComputedStyle(line)
        const needed =
          (svg === null ? 0 : svg.getBoundingClientRect().width) +
          idWidth +
          (lineStyle === null
            ? 0
            : px(lineStyle.paddingLeft) + px(lineStyle.paddingRight) + px(lineStyle.columnGap))
        return {
          problemId: segment.dataset['problemId'] ?? '',
          segment: box,
          icon: svg === null ? null : rect(svg.getBoundingClientRect()),
          text,
          band: rect(band.getBoundingClientRect()),
          idWidth,
          room,
          needed
        }
      }
    )
  })
}

/** Ficha 0013: `inner` dentro de `outer`, con medio px de margen por el redondeo. */
function expectInside(inner: Rect, outer: Rect, what: string): void {
  expect(inner.left, `${what} (izquierda)`).toBeGreaterThanOrEqual(outer.left - 0.5)
  expect(inner.right, `${what} (derecha)`).toBeLessThanOrEqual(outer.right + 0.5)
  expect(inner.top, `${what} (arriba)`).toBeGreaterThanOrEqual(outer.top - 0.5)
  expect(inner.bottom, `${what} (abajo)`).toBeLessThanOrEqual(outer.bottom + 0.5)
}

/** Ficha 0013: ejecuta `body` con el zoom de la página a `factor` y lo deja en 1 aunque falle. */
async function withZoom(factor: number, body: () => Promise<void>): Promise<void> {
  const dpr = (): Promise<number> => page.evaluate(() => window.devicePixelRatio)
  const base = await dpr()
  const setZoom = (value: number): Promise<void> =>
    app.evaluate(({ BrowserWindow }, z) => {
      BrowserWindow.getAllWindows()[0]?.webContents.setZoomFactor(z)
    }, value)
  await setZoom(factor)
  try {
    if (factor !== 1) await expect.poll(dpr).not.toBe(base)
    await nextFrames()
    await body()
  } finally {
    await setZoom(1)
    await nextFrames()
  }
}

/** Ficha 0013: cambia el rango de tiempo global y espera los tramos de la franja. */
async function bandRange(range: '2h' | '7d', segments: number): Promise<void> {
  await page.getByTestId(`time-range-${range}`).click()
  await expect(bandSegments()).toHaveCount(segments)
  await settledBox(problemBand())
}

/** Ficha 0013: comprueba que cada tramo, su icono y su texto visible se ven enteros. */
async function expectSegmentsWhole(label: string): Promise<SegmentFit[]> {
  await settledBox(problemBand())
  const fits = await segmentFits()
  expect(fits.length, label).toBeGreaterThan(0)
  for (const fit of fits) {
    const name = `${label} · ${fit.problemId}`
    expect(fit.icon, `${name}: icono`).not.toBeNull()
    expectInside(fit.icon as Rect, fit.segment, `${name}: icono dentro del tramo`)
    if (fit.text !== null) expectInside(fit.text, fit.segment, `${name}: texto dentro del tramo`)
    expectInside(fit.segment, fit.band, `${name}: tramo dentro de la franja`)
  }
  return fits
}

/**
 * Ficha 0013: la regla del id con el ancho real del tramo. Si caben el icono y el id en una
 * línea, se ven los dos y el id entero; si no, solo el icono, entero y centrado. Con menos de 1 px
 * de diferencia entre el sitio y lo que piden (redondeo), vale cualquiera de las dos, pero entera.
 * Devuelve lo que ha visto ('id' o 'icon'), o null si estaba en ese margen.
 */
function expectIdRule(fit: SegmentFit, label: string): 'id' | 'icon' | null {
  const name = `${label} · ${fit.problemId} (sitio ${fit.room.toFixed(1)} px, pide ${fit.needed.toFixed(1)} px)`
  expect(fit.idWidth, `${name}: el id tiene ancho`).toBeGreaterThan(0)
  const fits = fit.room >= fit.needed + 1
  const tight = fit.room <= fit.needed - 1
  if (fits) expect(fit.text, `${name}: cabe, así que enseña su id`).not.toBeNull()
  if (tight) expect(fit.text, `${name}: no cabe, así que no enseña texto`).toBeNull()
  if (fit.text !== null) {
    // El id entero, no un trozo (que esté dentro del tramo ya lo comprueba expectSegmentsWhole).
    expect(fit.text.right - fit.text.left, `${name}: el id se ve entero`).toBeGreaterThanOrEqual(
      fit.idWidth - 0.5
    )
  } else {
    const icon = fit.icon as Rect
    const centre = (a: number, b: number): number => (a + b) / 2
    expect(
      Math.abs(centre(icon.left, icon.right) - centre(fit.segment.left, fit.segment.right)),
      `${name}: icono centrado en horizontal`
    ).toBeLessThanOrEqual(1)
    expect(
      Math.abs(centre(icon.top, icon.bottom) - centre(fit.segment.top, fit.segment.bottom)),
      `${name}: icono centrado en vertical`
    ).toBeLessThanOrEqual(1)
  }
  if (!fits && !tight) return null
  return fit.text === null ? 'icon' : 'id'
}

/**
 * Ficha 0013: un id del largo real (P- y 8 cifras) en un tramo casi tan ancho como lo que pide
 * el id, pero sin sitio para él: solo el icono, centrado. La duración del problema se calcula con
 * lo medido (px por minuto y lo que pide el id, que depende de la fuente del equipo) para que el
 * sitio quede 3 px por debajo de lo que pide, con cualquier ventana y cualquier fuente. Que nunca
 * se vea medio id lo garantiza expectSegmentsWhole (el texto que se ve, entero dentro del tramo).
 */
async function expectLongIdCentred(): Promise<void> {
  await openBandService(SVC_LONG_ID)
  await bandRange('2h', 1)
  const [wide] = await expectSegmentsWhole(`id largo, ${sim.bandLongMinutes} min`)
  expect(wide, 'tramo del id largo').toBeDefined()
  const { segment, room, needed } = wide as SegmentFit
  const outer = segment.right - segment.left
  // El sitio buscado: 3 px menos de lo que pide el id (2 px por debajo del margen de redondeo de
  // expectIdRule); el borde se suma aparte.
  const target = needed - 3 + (outer - room)
  sim.bandLongMinutes = (target / outer) * sim.bandLongMinutes
  await reloadUi()
  await openBandService(SVC_LONG_ID)
  await expect(bandSegments()).toHaveCount(1)
  const label = `id largo, ${sim.bandLongMinutes.toFixed(1)} min`
  const [fit] = await expectSegmentsWhole(label)
  const narrow = fit as SegmentFit
  const where = `${label} (sitio ${narrow.room.toFixed(1)} px, pide ${narrow.needed.toFixed(1)} px)`
  expect(narrow.room, `${where}: el id no cabe`).toBeLessThanOrEqual(narrow.needed - 1)
  expect(expectIdRule(narrow, label)).toBe('icon')
}

test(
  'CA1 (0013): con zoom 1 y 1,5, con la ventana que haya y con la del CI, el icono y el texto de cada tramo quedan dentro de su tramo, cada tramo dentro de la franja, y el id se ve entero si cabe o solo el icono centrado si no, también con un id del largo real',
  { tag: '@servicio' },
  async () => {
    // Lo visto en los tramos de 2 h: con la ventana del CI salen los dos casos (zoom 1, una
    // columna y tramos anchos; zoom 1,5, tramos estrechos), así que el test prueba los dos.
    const seen = new Set<string>()
    const run = async (window: string): Promise<void> => {
      for (const zoom of [1, 1.5]) {
        await withZoom(zoom, async () => {
          // Rango de 2 h: anchos o estrechos según la ventana y el zoom; la regla, con su ancho.
          await openBandService(SVC_BAND_ID)
          await bandRange('2h', 2)
          const label = `${window}, zoom ${zoom}, 2 h`
          for (const fit of await expectSegmentsWhole(label)) {
            const shown = expectIdRule(fit, label)
            if (shown !== null) seen.add(shown)
          }
          // Tramos estrechos (7 días), también el pegado al final del rango.
          await openBandService(SVC_SHORT_ID)
          await bandRange('7d', 2)
          const short = `${window}, zoom ${zoom}, 7 días`
          for (const fit of await expectSegmentsWhole(short)) expectIdRule(fit, short)
          await bandRange('2h', 1)
        })
      }
    }
    try {
      await run('ventana actual')
      await withContentSize(CI_WINDOW, async () => {
        await run('ventana del CI')
        await expectLongIdCentred()
      })
    } finally {
      await page.getByTestId('time-range-2h').click()
    }
    expect([...seen].sort(), 'tramos de 2 h con id y tramos con solo el icono').toEqual([
      'icon',
      'id'
    ])
  }
)

test(
  'CA2 (0013): con zoom 1 y 1,5, la franja no se solapa con el canvas del gráfico de tasa de error',
  { tag: '@servicio' },
  async () => {
    await openBandService(SVC_BAND_ID)
    for (const zoom of [1, 1.5]) {
      await withZoom(zoom, async () => {
        await expect(bandSegments()).toHaveCount(2)
        const band = await settledBox(problemBand())
        const canvas = await settledBox(chartPlot('error-rate').locator('canvas').first())
        const label = `zoom ${zoom}`
        // La franja acaba antes de que empiece el gráfico: no se mete en él.
        expect(
          band.y + band.height,
          `${label}: la franja acaba antes del canvas`
        ).toBeLessThanOrEqual(canvas.y + 0.5)
        // Y el gráfico no la tapa: en el centro de cada tramo está el propio tramo.
        for (const id of [BAND_OPEN.problemId, BAND_CLOSED.problemId]) {
          const segment = bandSegment(id)
          await segment.evaluate((element) => element.scrollIntoView({ block: 'center' }))
          await settledBox(segment)
          expect(await receivesClick(segment), `${label}: ${id} no está tapado`).toBe(true)
        }
      })
    }
  }
)

test(
  'CA3 (0013): un problema de pocos minutos en un rango de 7 días enseña su icono entero y centrado, sin texto, y su nombre accesible lleva el id',
  { tag: '@servicio' },
  async () => {
    try {
      await openBandService(SVC_SHORT_ID)
      await bandRange('7d', 2)
      const fits = await expectSegmentsWhole('7 días')
      for (const ids of [BAND_SHORT, BAND_SHORT_END]) {
        const fit = fits.find((item) => item.problemId === ids.problemId)
        expect(fit, ids.problemId).toBeDefined()
        const { segment, icon, text } = fit as SegmentFit
        const name = ids.displayId
        // Sin texto visible en el tramo; el icono, entero y centrado.
        expect(text, `${name}: sin texto`).toBeNull()
        const iconRect = icon as Rect
        expect(iconRect.right - iconRect.left, `${name}: icono con ancho`).toBeGreaterThan(0)
        const centre = (a: number, b: number): number => (a + b) / 2
        expect(
          Math.abs(centre(iconRect.left, iconRect.right) - centre(segment.left, segment.right)),
          `${name}: icono centrado en horizontal`
        ).toBeLessThanOrEqual(1)
        expect(
          Math.abs(centre(iconRect.top, iconRect.bottom) - centre(segment.top, segment.bottom)),
          `${name}: icono centrado en vertical`
        ).toBeLessThanOrEqual(1)
        // El id sigue en el nombre accesible.
        await expect(bandSegment(ids.problemId), name).toHaveAccessibleName(new RegExp(name))
      }
    } finally {
      await page.getByTestId('time-range-2h').click()
    }
  }
)

test(
  'CA4 (0013): con la ventana del CI, donde la franja empieza fuera de la vista, los tramos de la 0010 siguen en su sitio, con tooltip, y el clic (trayéndolos a la vista) abre el problema',
  { tag: '@servicio' },
  async () => {
    await withContentSize(CI_WINDOW, async (actual) => {
      await openBandService(SVC_BAND_ID)
      await expect(bandSegments()).toHaveCount(2)
      const closed = bandSegment(BAND_CLOSED.problemId)
      const open = bandSegment(BAND_OPEN.problemId)
      // Es la situación del CI: al abrir la página, el tramo está por debajo del borde visible.
      const start = await settledBox(closed)
      expect(start.y, 'el tramo empieza fuera de la vista').toBeGreaterThan(actual.height)

      // Estado y posición, como en la 0010: el cerrado (más antiguo) a la izquierda del abierto.
      await expect(closed).toHaveAttribute('data-status', 'closed')
      await expect(open).toHaveAttribute('data-status', 'open')
      const openBox = await settledBox(open)
      expect(start.x + start.width).toBeLessThanOrEqual(openBox.x + 1)

      // Tooltip con el foco, ya a la vista (Radix cierra el tooltip si su contenedor se desplaza, y
      // el foco desplaza para enseñar el tramo).
      await closed.evaluate((element) => element.scrollIntoView({ block: 'center' }))
      await settledBox(closed)
      await closed.focus()
      await expect(bandTooltip()).toContainText(BAND_CLOSED.displayId)
      await closed.blur()
      await expect(bandTooltip()).toHaveCount(0)

      // Clic donde está, tras traerlo a la vista: abre su detalle.
      await clickInPlace(closed, { scroll: true })
      await expect(page.getByTestId('problem-page')).toBeVisible()
      await expect(page.getByTestId('problem-page-title')).toContainText(BAND_CLOSED.displayId)
      expect(await currentRoute()).toBe(`/problems/${BAND_CLOSED.problemId}`)
      await page.getByTestId('problem-back').click()
      await expect(page.getByTestId('entity-page-service')).toBeVisible()
    })
  }
)

/**
 * Ficha 0012: marcadores del servicio centrados. Se mide el contenido de verdad (un Range sobre
 * lo que hay dentro), no la caja del elemento: un título o un valor de bloque ocupan todo el ancho
 * de la tarjeta aunque su texto vaya a la izquierda.
 */
const CENTER_TOLERANCE_PX = 4

/** Centro horizontal (px) de lo que hay dentro de `inner` (un Range sobre su contenido). */
async function contentCenter(inner: Locator): Promise<number> {
  await expect(inner).toBeVisible()
  const content = await inner.evaluate((element) => {
    const range = document.createRange()
    range.selectNodeContents(element)
    const rect = range.getBoundingClientRect()
    return { left: rect.left, width: rect.width }
  })
  expect(content.width, 'el contenido tiene ancho').toBeGreaterThan(0)
  return content.left + content.width / 2
}

/** Distancia (px) entre el centro horizontal del contenido de `inner` y el de la tarjeta `card`. */
async function centerOffset(card: Locator, inner: Locator): Promise<number> {
  const cardBox = await card.boundingBox()
  if (cardBox === null) throw new Error('centerOffset: la tarjeta no tiene caja')
  return Math.abs((await contentCenter(inner)) - (cardBox.x + cardBox.width / 2))
}

/** Ficha 0012: el valor principal de cada marcador. */
function mainValue(id: string): Locator {
  const card = serviceMarker(id)
  if (id === 'response-time') return card.getByTestId('service-marker-median')
  // Problemas: el grupo de los dos recuentos.
  if (id === 'problems') return card.getByTestId('service-marker-open').locator('xpath=..')
  return card.getByTestId('service-marker-value')
}

const ALL_MARKERS = ['availability', 'ok', 'ko', 'error-rate', 'response-time', 'problems'] as const

for (const size of [FIXED_WINDOW, SMALL_WINDOW]) {
  test(
    `CA2 (0012): en las seis tarjetas (con «SLO», ficha 0066), el título y el valor principal están centrados (${size.width}×${size.height})`,
    { tag: '@servicio' },
    async () => {
      await withContentSize(size, async () => {
        await goToRoute(`/entities/SERVICE/${SVC_ID}`)
        await expect(page.getByTestId('entity-page-service')).toBeVisible()
        await expectErrorServiceValues()
        for (const id of ALL_MARKERS) {
          const card = serviceMarker(id)
          await card.scrollIntoViewIfNeeded()
          const title = card.getByRole('heading')
          expect(await centerOffset(card, title), `título de ${id}`).toBeLessThanOrEqual(
            CENTER_TOLERANCE_PX
          )
          expect(await centerOffset(card, mainValue(id)), `valor de ${id}`).toBeLessThanOrEqual(
            CENTER_TOLERANCE_PX
          )
        }
      })
    }
  )

  test(
    `CA3 (0012): las filas secundarias (p90/p99 y abiertos/cerrados) también están centradas (${size.width}×${size.height})`,
    { tag: '@servicio' },
    async () => {
      await withContentSize(size, async () => {
        await goToRoute(`/entities/SERVICE/${SVC_ID}`)
        await expect(page.getByTestId('entity-page-service')).toBeVisible()
        await expectErrorServiceValues()
        const times = serviceMarker('response-time')
        await times.scrollIntoViewIfNeeded()
        const percentiles = times.getByTestId('service-marker-p90').locator('xpath=..')
        expect(await centerOffset(times, percentiles), 'p90/p99').toBeLessThanOrEqual(
          CENTER_TOLERANCE_PX
        )
        const problems = serviceMarker('problems')
        await problems.scrollIntoViewIfNeeded()
        for (const id of ['service-marker-open', 'service-marker-closed']) {
          // Cada recuento, centrado en su columna: su número y su nombre, uno encima del otro.
          const count = problems.getByTestId(id)
          const number = await contentCenter(count.locator('span').nth(0))
          const label = await contentCenter(count.locator('span').nth(1))
          expect(Math.abs(number - label), id).toBeLessThanOrEqual(CENTER_TOLERANCE_PX)
        }
        const counts = problems.getByTestId('service-marker-open').locator('xpath=..')
        expect(await centerOffset(problems, counts), 'abiertos/cerrados').toBeLessThanOrEqual(
          CENTER_TOLERANCE_PX
        )
      })
    }
  )
}

test(
  'CA6 (0012): el marcador «Peticiones KO» con 9907 enseña «9.907»',
  { tag: '@servicio' },
  async () => {
    await goToRoute(`/entities/SERVICE/${SVC_KO_THOUSANDS_ID}`)
    await expect(page.getByTestId('entity-page-service')).toBeVisible()
    await expect(serviceMarker('ko').getByTestId('service-marker-value')).toHaveText(/^9\.907$/)
    // El de OK, con 5 cifras, ya llevaba separador: 45.000 − 9.907 = 35.093.
    await expect(serviceMarker('ok').getByTestId('service-marker-value')).toHaveText(/^35\.093$/)
  }
)
const infoRow = (key: string): Locator =>
  infoCard().locator(`[data-testid="service-info-row"][data-key="${key}"]`)
const infoGroup = (key: string): Locator =>
  infoCard().locator(`[data-testid="service-info-group"][data-group="${key}"]`)
const infoEntity = (group: string, id: string): Locator =>
  infoGroup(group).locator(`[data-testid="service-info-entity"][data-entity-id="${id}"]`)

/** Ficha 0015: despliega un grupo de relaciones (si no lo está), trayéndolo antes a la vista. */
async function expandGroup(key: string): Promise<Locator> {
  const group = infoGroup(key)
  const toggle = group.getByTestId('service-info-group-toggle')
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await clickInPlace(toggle, { scroll: true })
  }
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  return group
}

test(
  'CA1 (0015): con un servicio con todas las propiedades, la columna «Servicio» enseña sus datos en su orden, con tecnologías y zonas como chips, y las claves internas solo en «Todas las propiedades»',
  { tag: '@servicio' },
  async () => {
    const card = await openServiceInfo(INFO_FULL_ID)
    await expect(card).toContainText('Información')
    const column = card.getByTestId('service-info-service')
    await expect(column).toContainText('Servicio')

    // Debajo de los marcadores: desde la ficha 0036, «Información» va al final de la página.
    const cardBox = await settledBox(card)
    const markersBox = await settledBox(page.getByTestId('service-markers'))
    expect(cardBox.y, 'la tarjeta va debajo de los marcadores').toBeGreaterThanOrEqual(
      markersBox.y + markersBox.height - 1
    )

    // Las filas, en el orden de la ficha (no en el de la respuesta).
    await expect(column.getByTestId('service-info-row')).toHaveCount(INFO_ROW_ORDER.length)
    expect(await dataKeys(column.getByTestId('service-info-row'))).toEqual(INFO_ROW_ORDER)

    const value = (key: string): Locator => infoRow(key).getByTestId('service-info-value')
    await expect(value('serviceType')).toContainText('WEB_REQUEST_SERVICE')
    await expect(value('webServerName')).toContainText('servidor-web-e2e')
    await expect(value('webService')).toContainText('ServicioPagosE2e')
    await expect(value('webService')).toContainText('urn:e2e:pagos')
    await expect(value('contextRoot')).toContainText('/pagos-e2e')
    await expect(value('port')).toContainText('443')
    await expect(infoRow('isExternalService')).toContainText('Externo')
    await expect(value('remoteEndpoint')).toContainText('remoto-e2e.invalid')
    await expect(value('databaseVendor')).toContainText('POSTGRESQL')
    await expect(value('databaseName')).toContainText('pagos_e2e')
    await expect(value('applicationName')).toContainText('app-e2e')
    await expect(value('applicationEnvironment')).toContainText('pre-e2e')
    await expect(value('applicationReleaseVersion')).toContainText('1.2.3')
    await expect(value('publicCloudId')).toContainText('nube-e2e')
    await expect(value('publicCloudRegion')).toContainText('region-e2e')
    await expect(value('firstSeen')).toContainText('2026')
    await expect(value('lastSeen')).toContainText('2026')

    // Tecnologías y zonas, como chips.
    const techChips = infoRow('technologies').getByTestId('service-info-chip')
    await expect(techChips.filter({ hasText: /^Java$/ })).toHaveCount(1)
    await expect(techChips.filter({ hasText: /^Apache Tomcat$/ })).toHaveCount(1)
    await expect(techChips.filter({ hasText: /OpenJDK/ })).toHaveCount(1)
    await expect(techChips.filter({ hasText: /APACHE_TOMCAT/ })).toHaveCount(1)
    await expect(infoRow('managementZones').getByTestId('service-info-chip')).toHaveText([
      'Zona info A',
      'Zona info B'
    ])

    // Ficha 0037: las etiquetas ya no salen en la tarjeta (CA4 de la 0037 lo comprueba).
    await expect(infoRow('tags')).toHaveCount(0)

    // Nada interno fuera de «Todas las propiedades», que empieza plegada.
    const internalTexts = [
      ...Object.keys(INFO_INTERNAL),
      'contexto-interno-e2e',
      'nombre-detectado-e2e',
      'regla-interna-e2e'
    ]
    for (const text of internalTexts) {
      await expect(column, text).not.toContainText(text)
      await expect(card.getByTestId('service-info-relations'), text).not.toContainText(text)
    }
    await expect(card.getByTestId('service-info-property')).toHaveCount(0)

    // Desplegada: todas las propiedades, también las internas, como dato y valor.
    const toggle = card.getByTestId('service-info-properties-toggle')
    await expect(toggle).toContainText('Todas las propiedades')
    await clickInPlace(toggle, { scroll: true })
    await expect(card.getByTestId('service-info-property')).toHaveCount(INFO_FULL_PROPERTY_COUNT)
    const property = (key: string): Locator =>
      card.locator(`[data-testid="service-info-property"][data-key="${key}"]`)
    await expect(property('dt.security_context')).toContainText('dt.security_context')
    await expect(property('dt.security_context')).toContainText('contexto-interno-e2e')
    await expect(property('agentTechnologyType')).toContainText('JAVA')
    await expect(property('detectedName')).toContainText('nombre-detectado-e2e')
    await expect(property('matchedServiceDetectionV2Rules')).toContainText('regla-interna-e2e')
    await expect(property('serviceType')).toContainText('WEB_REQUEST_SERVICE')
  }
)

test(
  'CA2 (0015): con un servicio con pocas propiedades solo salen las filas con dato, sin filas vacías ni «undefined»',
  { tag: '@servicio' },
  async () => {
    const card = await openServiceInfo(INFO_FEW_ID)
    const rows = card.getByTestId('service-info-service').getByTestId('service-info-row')
    // serviceType y la última vez visto; webServerName vacío, isExternalService a false, sin
    // primera vez, sin zonas y sin etiquetas: ninguna de esas filas.
    await expect(rows).toHaveCount(2)
    expect(await dataKeys(rows)).toEqual(['serviceType', 'lastSeen'])
    for (const key of ['serviceType', 'lastSeen']) {
      await expect(infoRow(key).getByTestId('service-info-value'), key).toHaveText(/\S/)
    }
    await expect(infoRow('serviceType')).toContainText('DATABASE_SERVICE')
    // Sin relaciones, ningún grupo.
    await expect(card.getByTestId('service-info-group')).toHaveCount(0)
    // Nada de valores sin dato en toda la tarjeta (con «Todas las propiedades» desplegada).
    await clickInPlace(card.getByTestId('service-info-properties-toggle'), { scroll: true })
    await expect(card.getByTestId('service-info-property').first()).toBeVisible()
    for (const text of ['undefined', 'null', 'NaN', '[object Object]']) {
      await expect(card, text).not.toContainText(text)
    }
  }
)

test(
  'CA3 (0015): las relaciones salen en sus grupos y en su orden, con su número; desplegadas, con tipo e id; con más de 50, «Mostrando 50 de N»',
  { tag: '@servicio' },
  async () => {
    const card = await openServiceInfo(INFO_FULL_ID)
    const column = card.getByTestId('service-info-relations')
    await expect(column).toContainText('Relaciones')

    const groups = column.getByTestId('service-info-group')
    await expect(groups).toHaveCount(4)
    expect(await dataKeys(groups, 'data-group')).toEqual(['runsOn', 'calls', 'calledBy', 'other'])
    const expected = [
      ['runsOn', 'Se ejecuta en', '4'],
      ['calls', 'Llama a', '55'],
      ['calledBy', 'Lo llaman', '3'],
      ['other', 'Otras relaciones', '3']
    ] as const
    for (const [key, title, count] of expected) {
      await expect(infoGroup(key), key).toContainText(title)
      await expect(infoGroup(key).getByTestId('service-info-group-count'), key).toHaveText(
        new RegExp(`^\\s*${count}\\s*$`)
      )
    }
    // «Otras relaciones», plegada.
    await expect(infoGroup('other').getByTestId('service-info-group-toggle')).toHaveAttribute(
      'aria-expanded',
      'false'
    )
    await expect(infoGroup('other').getByTestId('service-info-entity')).toHaveCount(0)

    // «Se ejecuta en»: hosts, proceso y process group, con su tipo (nombre de la 0003) y su id.
    const runsOn = await expandGroup('runsOn')
    const runsOnEntities = runsOn.getByTestId('service-info-entity')
    await expect(runsOnEntities).toHaveCount(4)
    expect(await dataKeys(runsOnEntities, 'data-entity-id')).toEqual([
      ...INFO_HOSTS,
      INFO_PGI,
      INFO_PG
    ])
    const types: [string, string][] = [
      [INFO_HOSTS[0] ?? '', es.entities.types.HOST],
      [INFO_HOSTS[1] ?? '', es.entities.types.HOST],
      [INFO_PGI, es.entities.types.PROCESS_GROUP_INSTANCE],
      [INFO_PG, es.entities.types.PROCESS_GROUP]
    ]
    for (const [id, label] of types) {
      await expect(infoEntity('runsOn', id), id).toContainText(label)
      await expect(infoEntity('runsOn', id), id).toContainText(id)
    }
    await expect(runsOn.getByTestId('service-info-group-truncated')).toHaveCount(0)

    // «Llama a»: 50 de 55.
    const calls = await expandGroup('calls')
    await expect(calls.getByTestId('service-info-entity')).toHaveCount(50)
    expect(await dataKeys(calls.getByTestId('service-info-entity'), 'data-entity-id')).toEqual(
      INFO_CALLS.slice(0, 50).map((entity) => entity.id)
    )
    await expect(calls.getByTestId('service-info-group-truncated')).toContainText(
      /Mostrando 50 de 55/
    )

    // «Lo llaman»: tipos mezclados.
    const calledBy = await expandGroup('calledBy')
    await expect(calledBy.getByTestId('service-info-entity')).toHaveCount(3)
    await expect(infoEntity('calledBy', INFO_CALLER_APP)).toContainText(
      es.entities.types.APPLICATION
    )
    await expect(infoEntity('calledBy', INFO_CALLER_NAMED)).toContainText(es.entities.types.SERVICE)

    // «Otras relaciones»: con el nombre de la relación tal cual.
    const other = await expandGroup('other')
    await expect(other.getByTestId('service-info-entity')).toHaveCount(3)
    for (const name of ['runsOn', 'isServiceOf', 'isServiceMethodOfService']) {
      await expect(other, name).toContainText(name)
    }
    await expect(infoEntity('other', INFO_METHOD)).toContainText(INFO_METHOD)
  }
)

test(
  'CA4 (0015): al abrir la página no se pide ningún nombre; «Ver nombres» llama a entities:names una vez por tipo del grupo y los no resueltos quedan «sin nombre»',
  { tag: '@servicio' },
  async () => {
    await openServiceInfo(INFO_FULL_ID)
    await settledRequests()
    expect(sim.entityNamesQueries, 'nombres al abrir').toHaveLength(0)

    // Desplegar no pide nada.
    const calledBy = await expandGroup('calledBy')
    await expandGroup('runsOn')
    await settledRequests()
    expect(sim.entityNamesQueries, 'nombres al desplegar').toHaveLength(0)

    // «Lo llaman» tiene dos tipos: dos llamadas, cada una con los ids de un solo tipo.
    const button = calledBy.getByTestId('service-info-names')
    await expect(button).toHaveText('Ver nombres')
    await clickInPlace(button, { scroll: true })
    await expect.poll(() => sim.entityNamesQueries.length).toBe(2)
    const idsOf = (query: URLSearchParams): string[] =>
      [...(query.get('entitySelector') ?? '').matchAll(/"([^"]*)"/g)]
        .map((match) => match[1] ?? '')
        .sort()
    const batches = sim.entityNamesQueries.map(idsOf).sort((a, b) => a.length - b.length)
    expect(batches).toEqual([[INFO_CALLER_APP], [INFO_CALLER_NAMED, INFO_CALLER_UNNAMED].sort()])

    // Los nombres, y el que no se resuelve se queda con su id y «sin nombre».
    await expect(
      infoEntity('calledBy', INFO_CALLER_NAMED).getByTestId('service-info-entity-name')
    ).toHaveText('llamante-info')
    await expect(
      infoEntity('calledBy', INFO_CALLER_APP).getByTestId('service-info-entity-name')
    ).toHaveText('web-info')
    const unnamed = infoEntity('calledBy', INFO_CALLER_UNNAMED)
    await expect(unnamed).toContainText('sin nombre')
    await expect(unnamed).toContainText(INFO_CALLER_UNNAMED)
    await expect(unnamed).not.toContainText('llamante-info')

    // Ni más llamadas ni nombres en otros grupos.
    await settledRequests()
    expect(sim.entityNamesQueries).toHaveLength(2)
    await expect(
      infoEntity('runsOn', INFO_HOSTS[0] ?? '').getByTestId('service-info-entity-name')
    ).toHaveCount(0)
  }
)

test(
  'CA5 (0015): pulsar una entidad relacionada abre su página (la del tipo, con el nombre ya conocido) y «Volver» regresa al servicio sin volver a pedir sus datos',
  { tag: '@servicio' },
  async () => {
    await openServiceInfo(INFO_FULL_ID)
    const runsOn = await expandGroup('runsOn')
    const host = INFO_HOSTS[0] ?? ''
    // Cada entidad es un enlace a #/entities/<tipo>/<id>.
    const link = infoEntity('runsOn', host)
    await expect(link).toHaveRole('link')
    await expect(link).toHaveAttribute('href', new RegExp(`#/entities/HOST/${host}$`))
    await expect(infoEntity('runsOn', INFO_PGI)).toHaveAttribute(
      'href',
      new RegExp(`#/entities/PROCESS_GROUP_INSTANCE/${INFO_PGI}$`)
    )

    await clickInPlace(runsOn.getByTestId('service-info-names'), { scroll: true })
    await expect(link.getByTestId('service-info-entity-name')).toHaveText('host-info-1')
    await settledRequests()
    // Solo las de este servicio: la página del host pide su propia entities:get (ficha 0020).
    const serviceInfoQueries = (): number =>
      sim.requests.filter((request) => request.includes(`/entities/${INFO_FULL_ID}`)).length
    const infoBefore = serviceInfoQueries()
    const namesBefore = sim.entityNamesQueries.length

    await clickInPlace(link, { scroll: true })
    const hostPage = page.getByTestId('entity-page-host')
    await expect(hostPage).toBeVisible()
    expect(await currentRoute()).toBe(`/entities/HOST/${host}`)
    await expect(hostPage.getByRole('heading', { level: 1 })).toHaveText('host-info-1')
    await expect(hostPage.getByTestId('entity-page-id')).toHaveText(host)

    await clickInPlace(hostPage.getByTestId('entity-back'), { scroll: true })
    await expect(page.getByTestId('entity-page-service')).toBeVisible()
    expect(await currentRoute()).toBe(`/entities/SERVICE/${INFO_FULL_ID}`)
    await expect(infoRow('serviceType')).toContainText('WEB_REQUEST_SERVICE')
    await settledRequests()
    expect(serviceInfoQueries(), 'entities:get del servicio al volver').toBe(infoBefore)
    expect(sim.entityNamesQueries, 'entities:names al volver').toHaveLength(namesBefore)
  }
)

test(
  'CA6 (0015): sin entities.read, la tarjeta dice qué scope falta y marcadores y gráficos siguen; con el canal caído, aviso con Reintentar',
  { tag: '@servicio' },
  async () => {
    // Un entorno con un token sin entities.read, solo para este test.
    const tenants = await invoke<{ clients: { id: string; name: string }[] }>('tenants:list')
    const clientId = tenants.clients.find((client) => client.name === 'Cliente A')?.id ?? ''
    const noEntities = await createEnvironment(
      clientId,
      'Sin entidades',
      'other',
      TOKEN_NO_ENTITIES
    )
    try {
      await invoke('connection:test', { environmentId: noEntities })
      await invoke('environments:setActive', { environmentId: noEntities })
      await reloadUi()
      await goToRoute(`/entities/SERVICE/${SVC_ID}`)
      await expect(page.getByTestId('entity-page-service')).toBeVisible()
      const unavailable = infoCard().getByTestId('module-unavailable')
      await expect(unavailable).toBeVisible()
      await expect(unavailable).toContainText('entities.read')
      await expect(infoCard().getByTestId('service-info-row')).toHaveCount(0)
      // Marcadores y gráficos, con sus datos.
      await expectErrorServiceValues()
      expect(await chartSeries('error-rate')).toHaveLength(1)
      await settledRequests()
      expect(sim.entityInfoQueries, 'entities:get sin el scope').toHaveLength(0)
    } finally {
      await invoke('environments:setActive', { environmentId: env['Producción'] })
      await invoke('environments:delete', { id: noEntities })
      await reloadUi()
    }

    // Canal caído: aviso compacto con Reintentar; marcadores y gráficos siguen.
    sim.entityInfoFail = true
    await goToRoute(`/entities/SERVICE/${SVC_ID}`)
    await expect(page.getByTestId('entity-page-service')).toBeVisible()
    const retry = infoCard().getByRole('button', { name: 'Reintentar' })
    await expect(infoCard().getByRole('alert').first()).toBeVisible()
    await expect(retry).toBeVisible()
    await expectErrorServiceValues()
    expect(await chartSeries('error-rate')).toHaveLength(1)

    sim.entityInfoFail = false
    await clickInPlace(retry, { scroll: true })
    await expect(infoRow('serviceType')).toContainText('DATABASE_SERVICE')
    await expect(infoCard().getByRole('button', { name: 'Reintentar' })).toHaveCount(0)
  }
)

test(
  'CA7 (0015): con la ventana estrecha, «Servicio» y «Relaciones» en una columna; con la normal, en dos',
  { tag: '@servicio' },
  async () => {
    const card = await openServiceInfo(INFO_FULL_ID)
    const service = card.getByTestId('service-info-service')
    const relations = card.getByTestId('service-info-relations')

    await withContentSize(SMALL_WINDOW, async () => {
      const a = await settledBox(service)
      const b = await settledBox(relations)
      expect(Math.abs(b.x - a.x), 'misma x').toBeLessThanOrEqual(1)
      expect(b.y, 'relaciones debajo').toBeGreaterThanOrEqual(a.y + a.height - 1)
    })

    // De vuelta en FIXED_WINDOW (la del CI, 1024×720): dos columnas.
    const a = await settledBox(service)
    const b = await settledBox(relations)
    expect(b.x, 'relaciones a la derecha').toBeGreaterThanOrEqual(a.x + a.width - 1)
    expect(Math.abs(b.y - a.y), 'misma altura de inicio').toBeLessThanOrEqual(1)
  }
)

test(
  'CA5 (0020): la tarjeta del servicio sigue igual (sus filas, sus grupos y sin nada del host); los e2e de la 0015 siguen sin tocar, salvo el recuento de CA5 (0015)',
  { tag: '@servicio' },
  async () => {
    const card = await openServiceInfo(INFO_FULL_ID)
    expect(
      await dataKeys(card.getByTestId('service-info-service').getByTestId('service-info-row'))
    ).toEqual(INFO_ROW_ORDER)
    expect(await dataKeys(card.getByTestId('service-info-group'), 'data-group')).toEqual([
      'runsOn',
      'calls',
      'calledBy',
      'other'
    ])
    await expect(card.locator('[data-testid^="host-info"]')).toHaveCount(0)
    await expect(page.getByTestId('host-info')).toHaveCount(0)
    await expect(page.getByTestId('service-markers')).toBeVisible()
  }
)
