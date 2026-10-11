import { expect, type Locator, test } from '@playwright/test'
import {
  COUNT_EMPTY_ID,
  COUNT_ENTITY_ID,
  ENTITY_INFO_CALLS,
  ENTITY_INFO_FIRST_SEEN,
  ENTITY_INFO_HOST,
  ENTITY_INFO_ID,
  ENTITY_INFO_LAST_SEEN,
  HOST_INFO_FULL_ID,
  HOUR,
  INFO_FEW_ID,
  INFO_FULL_ID,
  INFO_TAGS,
  NOW,
  TAGS_CAPSULE_ID,
  TAGS_ID,
  TAGS_MANY_ID,
  TAGS_MANY_KEYS,
  TAGS_SORTED_KEYS,
  TOKEN_NO_ENTITIES,
  ENT_ID,
  ENT_HOST_ID,
  ENT_HOST_NAME,
  ENT_EV_HOST,
  ENT_EV_METRIC,
  ENT_EV_NONE,
  ENT_EV_NOTYPE,
  MK_PROBLEM_ID,
  MK_EV_HOST
} from './views/fixtures'
import {
  clickInPlace,
  createEnvironment,
  currentRoute,
  env,
  goToRoute,
  invoke,
  page,
  reloadUi,
  settledBox,
  setupViewsApp
} from './views/harness'
import { sim } from './views/sim-state'
import en from '../src/renderer/src/locales/en/common.json'
import es from '../src/renderer/src/locales/es/common.json'
import {
  evidenceRows,
  evidenceRow,
  detailOf,
  expandRow,
  focusedTestId,
  analyzeButton,
  settledRequests,
  INFO_ROW_ORDER,
  infoCard,
  openServiceInfo,
  dataKeys,
  HOST_INFO_SECTIONS,
  openHostInfo,
  MONITOR_PAGES,
  openMonitorInfo,
  openProcessInfo,
  visibleNeighbours
} from './views/helpers'

/**
 * Specs de vistas por zona (ficha 0070): lo común a las páginas de entidad (`@entidad`). Arnés en
 * `e2e/views/` (ver su cabecera).
 */

setupViewsApp()

/** Ficha 0003: abre P-786 por URL y espera sus 4 evidencias. */
async function openEntityProblem(): Promise<void> {
  await goToRoute(`/problems/${ENT_ID}`)
  await expect(page.getByTestId('problem-page-title')).toContainText('P-786')
  await expect(evidenceRows()).toHaveCount(4)
}

/** Ficha 0003: peticiones al detalle (GET /problems/{id}) que ha recibido el simulador. */
const detailRequests = (): number =>
  sim.requests.filter((request) => /^GET \/api\/v2\/problems\/[^/]+$/.test(request)).length

test(
  'CA1 (0003): «Analizar entidad» sale en las evidencias con entidad (EVENT y METRIC) y no en las que no tienen entidad o tipo',
  { tag: '@entidad' },
  async () => {
    await openEntityProblem()
    for (const title of [ENT_EV_HOST, ENT_EV_METRIC]) {
      const button = analyzeButton(await expandRow(title))
      await expect(button, title).toBeVisible()
      await expect(button, title).toHaveText('Analizar entidad')
      await expect(button, title).toHaveRole('button')
    }
    for (const title of [ENT_EV_NONE, ENT_EV_NOTYPE]) {
      const detail = await expandRow(title)
      // El detalle sí se pinta (sus propiedades), pero sin el botón.
      await expect(detail.getByTestId('evidence-properties'), title).toBeVisible()
      await expect(analyzeButton(detail), title).toHaveCount(0)
      await expect(detail.getByText('Analizar entidad'), title).toHaveCount(0)
    }
  }
)

// Ficha 0018: la página del HOST ya no está en construcción; el bloque «Página en construcción»
// con el faro se sigue comprobando en los tipos que lo conservan (CA7 de la 0008).
test(
  'CA2 (0003): «Analizar entidad» en una evidencia HOST lleva a #/entities/HOST/<id> con su página',
  { tag: '@entidad' },
  async () => {
    await openEntityProblem()
    await analyzeButton(await expandRow(ENT_EV_HOST)).click()
    const hostPage = page.getByTestId('entity-page-host')
    await expect(hostPage).toBeVisible()
    expect(await currentRoute()).toBe(`/entities/HOST/${ENT_HOST_ID}`)
    await expect(page.getByTestId('problem-page')).toHaveCount(0)
    await expect(page.getByTestId('entity-page-generic')).toHaveCount(0)
    // Cabecera: el nombre como título y, debajo, el tipo y el id.
    await expect(hostPage.getByRole('heading', { level: 1 })).toHaveText(ENT_HOST_NAME)
    await expect(hostPage.getByTestId('entity-page-type')).toHaveText('Host')
    await expect(hostPage.getByTestId('entity-page-id')).toHaveText(ENT_HOST_ID)
  }
)

test(
  'CA4 (0003): un tipo que no está en el registro (inventado o personalizado) va a la página genérica, nunca al 404',
  { tag: '@entidad' },
  async () => {
    for (const type of ['TIPO_ESTANDAR_INVENTADO', 'algo:otro']) {
      const id = `ID-${type.length}`
      await goToRoute(`/entities/${encodeURIComponent(type)}/${encodeURIComponent(id)}`)
      const generic = page.getByTestId('entity-page-generic')
      await expect(generic, type).toBeVisible()
      await expect(generic.getByTestId('entity-page-type'), type).toHaveText(type)
      await expect(generic.getByTestId('entity-page-id'), type).toHaveText(id)
      await expect(generic.getByTestId('entity-under-construction'), type).toBeVisible()
      await expect(page.getByTestId('error-screen'), type).toHaveCount(0)
      // Ninguna página por tipo a la vez que la genérica.
      await expect(page.getByTestId('entity-page-host'), type).toHaveCount(0)
    }
  }
)

test(
  'CA6 (0003): «Volver» regresa al detalle del problema con la fila desplegada y sin volver a pedir el detalle',
  { tag: '@entidad' },
  async () => {
    await openEntityProblem()
    await expandRow(ENT_EV_HOST)
    await settledRequests()
    const detailsBefore = detailRequests()
    await analyzeButton(await detailOf(evidenceRow(ENT_EV_HOST))).click()
    const hostPage = page.getByTestId('entity-page-host')
    await expect(hostPage).toBeVisible()

    await hostPage.getByTestId('entity-back').click()
    await expect(page.getByTestId('problem-page')).toBeVisible()
    expect(await currentRoute()).toBe(`/problems/${ENT_ID}`)
    await expect(evidenceRow(ENT_EV_HOST)).toHaveAttribute('aria-expanded', 'true')
    await expect(analyzeButton(await detailOf(evidenceRow(ENT_EV_HOST)))).toBeVisible()
    await settledRequests()
    expect(detailRequests(), 'peticiones nuevas del detalle').toBe(detailsBefore)
  }
)

test(
  'CA7 (0003): con la ruta abierta directamente, el título es el id y «Volver» lleva a Problemas',
  { tag: '@entidad' },
  async () => {
    // Desde Inicio (resetState), sin pasar por el problema: sin estado de navegación.
    await goToRoute(`/entities/HOST/${ENT_HOST_ID}`)
    const hostPage = page.getByTestId('entity-page-host')
    await expect(hostPage).toBeVisible()
    await expect(hostPage.getByRole('heading', { level: 1 })).toHaveText(ENT_HOST_ID)
    await expect(hostPage.getByTestId('entity-page-type')).toHaveText('Host')
    await expect(hostPage.getByTestId('entity-page-id')).toHaveText(ENT_HOST_ID)

    // Volver atrás en el historial llevaría a Inicio: tiene que ir a Problemas.
    await hostPage.getByTestId('entity-back').click()
    await expect(page.getByTestId('problem-row')).toHaveCount(3)
    expect(await currentRoute()).toBe('/problems')
  }
)

// Ficha 0018: la página del HOST ya pide sus métricas y sus problemas; lo que no puede hacer es
// volver a pedir el detalle del problema del que viene.
test(
  'CA8 (0003): mientras está en la página de entidad, el simulador no recibe más peticiones que las de sus canales (ninguna en construcción)',
  { tag: '@entidad' },
  async () => {
    await openEntityProblem()
    await expandRow(ENT_EV_HOST)
    const before = await settledRequests()
    await analyzeButton(await detailOf(evidenceRow(ENT_EV_HOST))).click()
    await expect(page.getByTestId('entity-page-host')).toBeVisible()
    // Un rato en la página (y lo que tarde en pintarse): solo los canales del host.
    await page.waitForTimeout(1500)
    for (const request of sim.requests.slice(before)) {
      expect(request, 'peticiones en la página del host').toMatch(
        /^GET \/api\/v2\/(metrics\/query|problems)$/
      )
    }

    // Y por URL, sin venir del problema (genérica y por tipo): tampoco.
    const direct = await settledRequests()
    await goToRoute(`/entities/${encodeURIComponent('algo:otro')}/ID-1`)
    await expect(page.getByTestId('entity-page-generic')).toBeVisible()
    await goToRoute('/entities/SERVICE/SERVICE-AN1')
    await expect(page.getByTestId('entity-page-service')).toBeVisible()
    await page.waitForTimeout(1500)
    expect(sim.requests.slice(direct), 'peticiones en la página por URL').toEqual([])
  }
)

test(
  'CA9 (0003): «Analizar entidad» y «Volver» se alcanzan con Tab y se activan con Enter; Escape sigue plegando la fila',
  { tag: '@entidad' },
  async () => {
    await openEntityProblem()
    const row = evidenceRow(ENT_EV_HOST)
    await row.scrollIntoViewIfNeeded()
    await row.focus()
    await page.keyboard.press('Enter')
    await expect(row).toHaveAttribute('aria-expanded', 'true')

    /** Tab hasta el elemento con ese data-testid (como mucho 40 pasos). */
    async function tabTo(testId: string): Promise<void> {
      for (let i = 0; i < 40 && (await focusedTestId()) !== testId; i += 1) {
        await page.keyboard.press('Tab')
      }
      expect(await focusedTestId(), `Tab hasta ${testId}`).toBe(testId)
    }

    // Con el foco en el botón, Escape pliega la fila y devuelve el foco a la fila.
    await tabTo('evidence-analyze-entity')
    await page.keyboard.press('Escape')
    await expect(row).toHaveAttribute('aria-expanded', 'false')
    await expect(row).toBeFocused()

    // Enter despliega otra vez; Tab hasta el botón y Enter lo activa.
    await page.keyboard.press('Enter')
    await expect(row).toHaveAttribute('aria-expanded', 'true')
    await tabTo('evidence-analyze-entity')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('entity-page-host')).toBeVisible()

    // En la página de entidad: Tab hasta «Volver» y Enter vuelve al problema.
    await tabTo('entity-back')
    await expect(page.getByTestId('entity-back')).toContainText('Volver')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('problem-page')).toBeVisible()
    expect(await currentRoute()).toBe(`/problems/${ENT_ID}`)
    await expect(row).toHaveAttribute('aria-expanded', 'true')
  }
)

test(
  'CA6 (0007): entities:problemCounts por IPC con un id inventado: dos consultas con pageSize=1 y los recuentos del simulador',
  { tag: '@entidad' },
  async () => {
    const counts = await invoke<{ open: number | null; closed: number | null }>(
      'entities:problemCounts',
      { environmentId: env['Producción'], entityId: COUNT_ENTITY_ID, timeRange: '2h' }
    )
    expect(counts).toEqual({ open: 2, closed: 3 })

    // Dos consultas, las dos con pageSize=1, el rango global y la entidad pedida.
    expect(sim.entityProblemQueries).toHaveLength(2)
    for (const query of sim.entityProblemQueries) {
      expect(query.get('pageSize')).toBe('1')
      expect(query.get('from')).toBe('now-2h')
      expect(query.get('problemSelector')).toContain(`affectedEntities("${COUNT_ENTITY_ID}")`)
    }
    expect(
      sim.entityProblemQueries
        .map((q) => /status\("(\w+)"\)/.exec(q.get('problemSelector') ?? '')?.[1])
        .sort()
    ).toEqual(['closed', 'open'])

    // Una entidad sin problemas da 0 y 0 (no null), también con rango absoluto.
    const empty = await invoke<{ open: number | null; closed: number | null }>(
      'entities:problemCounts',
      {
        environmentId: env['Producción'],
        entityId: COUNT_EMPTY_ID,
        timeRange: { from: new Date(NOW - 3 * HOUR).toISOString(), to: new Date(NOW).toISOString() }
      }
    )
    expect(empty).toEqual({ open: 0, closed: 0 })
    expect(sim.entityProblemQueries).toHaveLength(4)
    for (const query of sim.entityProblemQueries.slice(2)) {
      expect(query.get('from')).toBe(new Date(NOW - 3 * HOUR).toISOString())
      expect(query.get('to')).toBe(new Date(NOW).toISOString())
    }
  }
)

test(
  'CA8 (0014): entities:get y entities:names por IPC con ids inventados: lo que pide main y lo que llega del simulador',
  { tag: '@entidad' },
  async () => {
    // entities:get: una petición a /entities/{id} con los fields de la ficha.
    const data = await invoke<{
      properties: { key: string; text: string }[]
      relationships: {
        direction: string
        name: string
        entities: { id: string; type: string }[]
        total: number
      }[]
    }>('entities:get', { environmentId: env['Producción'], entityId: ENTITY_INFO_ID })
    expect(sim.entityInfoQueries).toHaveLength(1)
    expect((sim.entityInfoQueries[0]?.get('fields') ?? '').split(',').sort()).toEqual(
      [
        '+properties',
        '+tags',
        '+managementZones',
        '+fromRelationships',
        '+toRelationships',
        '+firstSeenTms',
        '+lastSeenTms',
        '+icon'
      ].sort()
    )
    expect(data).toMatchObject({
      displayName: 'pagos-e2e',
      type: 'SERVICE',
      firstSeen: ENTITY_INFO_FIRST_SEEN,
      lastSeen: ENTITY_INFO_LAST_SEEN,
      iconType: 'java',
      managementZones: ['Zona e2e'],
      // Ficha 0037: las etiquetas llegan separadas en contexto, clave y valor.
      tags: [{ context: 'CONTEXTLESS', key: 'equipo', value: 'pagos' }]
    })
    expect(data.properties.map((p) => p.key)).toEqual(['serviceType', 'port', 'webServiceName'])
    expect(data.properties[0]?.text).toBe('WEB_REQUEST_SERVICE')
    expect(data.properties[1]?.text).toBe('8443')
    expect(data.properties[2]?.text).toHaveLength(300)
    const relation = (direction: string, name: string): unknown =>
      data.relationships.find((r) => r.direction === direction && r.name === name)
    expect(data.relationships).toHaveLength(3)
    expect(relation('from', 'calls')).toEqual({
      direction: 'from',
      name: 'calls',
      entities: ENTITY_INFO_CALLS.slice(0, 50),
      total: 55
    })
    expect(relation('from', 'runsOnHost')).toEqual({
      direction: 'from',
      name: 'runsOnHost',
      entities: [{ id: ENTITY_INFO_HOST, type: 'HOST' }],
      total: 1
    })
    expect(relation('to', 'isServiceMethodOfService')).toEqual({
      direction: 'to',
      name: 'isServiceMethodOfService',
      entities: [{ id: 'SERVICE_METHOD-00000000000E2E17', type: 'SERVICE_METHOD' }],
      total: 1
    })

    // entities:names: una petición a /entities con entityId(...) y pageSize 50; el que no
    // devuelve el simulador va a missing.
    const ids = [ENTITY_INFO_HOST, 'HOST-00000000000E2E16', 'HOST-00000000000E2E18']
    const names = await invoke<{ names: { id: string; name: string }[]; missing: string[] }>(
      'entities:names',
      { environmentId: env['Producción'], entityIds: ids }
    )
    expect(sim.entityNamesQueries).toHaveLength(1)
    expect(sim.entityNamesQueries[0]?.get('entitySelector')).toBe(
      `entityId(${ids.map((id) => `"${id}"`).join(',')})`
    )
    expect(sim.entityNamesQueries[0]?.get('pageSize')).toBe('50')
    expect([...names.names].sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      { id: 'HOST-00000000000E2E15', name: 'servidor-e2e' },
      { id: 'HOST-00000000000E2E16', name: 'servidor-e2e-2' }
    ])
    expect(names.missing).toEqual(['HOST-00000000000E2E18'])

    // Una entidad que no existe: NOT_FOUND con un reason que se traduce.
    const missing = (await page.evaluate(
      (entityId) =>
        (
          window as unknown as { vigia: { invoke: (...args: unknown[]) => Promise<unknown> } }
        ).vigia.invoke('entities:get', { environmentId: entityId.env, entityId: entityId.id }),
      { env: env['Producción'], id: 'HOST-00000000000E2E19' }
    )) as { ok: boolean; error?: { code: string; reason?: { key: string } } }
    expect(missing).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
    const key = missing.error?.reason?.key ?? ''
    expect((es.errorReasons as Record<string, string>)[key] ?? '').toMatch(/entidad/i)
    expect((en.errorReasons as Record<string, string>)[key] ?? '').not.toBe('')
  }
)

// Ficha 0018: el HOST ya tiene su página (sus marcadores, no los del servicio); sale de la lista
// de tipos en construcción. Ficha 0024: también salen SYNTHETIC_TEST y HTTP_CHECK (los prueban
// los e2e de la 0024). Ficha 0028: también sale PROCESS_GROUP_INSTANCE (lo prueban los e2e de
// la 0028). Ficha 0032: también sale PROCESS_GROUP (lo prueban los e2e de la 0032). Ficha 0034:
// también sale APPLICATION (lo prueban los e2e de la 0034).
test(
  'CA7 (0008): las páginas de los otros tipos de entidad siguen en construcción, sin marcadores ni peticiones',
  { tag: '@entidad' },
  async () => {
    // Desde «Analizar entidad» de una evidencia HOST del mismo problema: la del host, sin los
    // marcadores del servicio.
    await goToRoute(`/problems/${MK_PROBLEM_ID}`)
    await expect(evidenceRows()).toHaveCount(4)
    await expandRow(MK_EV_HOST)
    await analyzeButton(await detailOf(evidenceRow(MK_EV_HOST))).click()
    const hostPage = page.getByTestId('entity-page-host')
    await expect(hostPage).toBeVisible()
    await expect(page.getByTestId('service-markers')).toHaveCount(0)

    // Por URL, el resto de tipos del registro y uno que no está (genérica).
    const others = [
      ['CLOUD_APPLICATION', 'cloud_application'],
      ['ENVIRONMENT', 'environment'],
      ['TIPO_ESTANDAR_INVENTADO', 'generic']
    ] as const
    const before = await settledRequests()
    for (const [type, suffix] of others) {
      await goToRoute(`/entities/${type}/${type}-00000000000E2E82`)
      const entityPage = page.getByTestId(`entity-page-${suffix}`)
      await expect(entityPage, type).toBeVisible()
      await expect(entityPage.getByTestId('entity-under-construction'), type).toContainText(
        'Página en construcción'
      )
      await expect(page.getByTestId('service-markers'), type).toHaveCount(0)
      await expect(page.locator('[data-testid^="service-marker-"]'), type).toHaveCount(0)
    }
    await page.waitForTimeout(1000)
    expect(sim.requests.slice(before), 'peticiones en las otras páginas').toEqual([])
  }
)

test(
  'CA4 (0026): las tarjetas del servicio y del host siguen igual (sus filas y sus grupos, sin nada del monitor); sus e2e de la 0015 y la 0020 siguen sin tocar',
  { tag: '@entidad' },
  async () => {
    const serviceCard = await openServiceInfo(INFO_FULL_ID)
    expect(
      await dataKeys(
        serviceCard.getByTestId('service-info-service').getByTestId('service-info-row')
      )
    ).toEqual(INFO_ROW_ORDER)
    expect(await dataKeys(serviceCard.getByTestId('service-info-group'), 'data-group')).toEqual([
      'runsOn',
      'calls',
      'calledBy',
      'other'
    ])
    await expect(page.locator('[data-testid^="monitor-info"]')).toHaveCount(0)

    const hostCard = await openHostInfo(HOST_INFO_FULL_ID)
    expect(await dataKeys(hostCard.getByTestId('host-info-section'), 'data-section')).toEqual(
      HOST_INFO_SECTIONS.map(([key]) => key)
    )
    expect(await dataKeys(hostCard.getByTestId('host-info-group'), 'data-group')).toEqual([
      'processes',
      'services',
      'runsOn',
      'hostGroup',
      'other'
    ])
    await expect(page.locator('[data-testid^="monitor-info"]')).toHaveCount(0)
    await expect(page.getByTestId('service-info')).toHaveCount(0)
  }
)

// ---------------------------------------------------------------------------
// Ficha 0036: en las páginas de entidad, marcadores primero e «Información» al final.
// ---------------------------------------------------------------------------

interface OrderedEntityPage {
  /** Nombre de la página en los mensajes. */
  name: string
  /** Abre la página y espera la tarjeta «Información» con sus filas. */
  open: () => Promise<Locator>
  pageTestId: string
  markers: string
  info: string
  charts: string
  /** Las demás tarjetas de la página, que van detrás de los gráficos. */
  cards: string[]
}

const ORDERED_ENTITY_PAGES: OrderedEntityPage[] = [
  {
    name: 'servicio',
    open: () => openServiceInfo(INFO_FULL_ID),
    pageTestId: 'entity-page-service',
    markers: 'service-markers',
    info: 'service-info',
    charts: 'service-charts',
    cards: []
  },
  {
    name: 'host',
    open: () => openHostInfo(HOST_INFO_FULL_ID),
    pageTestId: 'entity-page-host',
    markers: 'host-markers',
    info: 'host-info',
    charts: 'host-charts',
    cards: ['host-disks', 'host-processes']
  },
  {
    name: 'browser monitor',
    open: () => openMonitorInfo('browser'),
    pageTestId: MONITOR_PAGES.browser.testId,
    markers: 'monitor-markers',
    info: 'monitor-info',
    charts: 'monitor-charts',
    cards: ['monitor-locations', 'monitor-steps']
  },
  {
    name: 'HTTP monitor',
    open: () => openMonitorInfo('http'),
    pageTestId: MONITOR_PAGES.http.testId,
    markers: 'monitor-markers',
    info: 'monitor-info',
    charts: 'monitor-charts',
    cards: ['monitor-locations', 'monitor-steps']
  },
  {
    name: 'proceso',
    open: () => openProcessInfo(),
    pageTestId: 'entity-page-process_group_instance',
    markers: 'process-markers',
    info: 'process-info',
    charts: 'process-charts',
    cards: []
  }
]

/** Ficha 0036: abre la página y espera sus secciones (marcadores, gráficos y tarjetas). */
async function openOrderedPage(entry: OrderedEntityPage): Promise<void> {
  await entry.open()
  for (const id of [entry.markers, entry.charts, ...entry.cards]) {
    await expect(page.getByTestId(entry.pageTestId).getByTestId(id), id).toBeVisible()
  }
}

test(
  'CA1 (0036): en las páginas de servicio, host, browser monitor, HTTP monitor y proceso, la tarjeta «Información» es la última sección, después de los gráficos y de las demás tarjetas',
  { tag: '@entidad' },
  async () => {
    for (const entry of ORDERED_ENTITY_PAGES) {
      await openOrderedPage(entry)
      // Nada visible detrás de la tarjeta, por mucho que se envuelvan las secciones.
      expect(
        await visibleNeighbours(entry.pageTestId, entry.info, 'after'),
        `${entry.name}: nada después de «Información»`
      ).toEqual([])

      // Y en la pantalla: los gráficos y las demás tarjetas, encima de ella; los gráficos, antes que
      // las tarjetas.
      const infoBox = await settledBox(page.getByTestId(entry.info))
      const chartsBox = await settledBox(page.getByTestId(entry.charts))
      expect(
        chartsBox.y + chartsBox.height,
        `${entry.name}: gráficos encima de «Información»`
      ).toBeLessThanOrEqual(infoBox.y + 1)
      for (const id of entry.cards) {
        const box = await settledBox(page.getByTestId(id))
        expect(
          box.y + box.height,
          `${entry.name}: ${id} encima de «Información»`
        ).toBeLessThanOrEqual(infoBox.y + 1)
        expect(box.y, `${entry.name}: ${id} debajo de los gráficos`).toBeGreaterThanOrEqual(
          chartsBox.y + chartsBox.height - 1
        )
      }
    }
  }
)

test(
  'CA2 (0036): en esas cinco páginas, los marcadores son la primera sección después de la cabecera',
  { tag: '@entidad' },
  async () => {
    for (const entry of ORDERED_ENTITY_PAGES) {
      await openOrderedPage(entry)
      // Antes de los marcadores, solo la cabecera (y, desde la ficha 0037, la fila de etiquetas).
      expect(
        (await visibleNeighbours(entry.pageTestId, entry.markers, 'before')).filter(
          (name) => name !== 'entity-tags'
        ),
        `${entry.name}: solo la cabecera antes de los marcadores`
      ).toEqual(['header'])

      // Y en la pantalla, los marcadores encima de los gráficos, de las tarjetas y de «Información».
      const markersBox = await settledBox(page.getByTestId(entry.markers))
      for (const id of [entry.charts, ...entry.cards, entry.info]) {
        const box = await settledBox(page.getByTestId(id))
        expect(box.y, `${entry.name}: ${id} debajo de los marcadores`).toBeGreaterThanOrEqual(
          markersBox.y + markersBox.height - 1
        )
      }
    }
  }
)

// ---------------------------------------------------------------------------
// Ficha 0037: etiquetas arriba del todo, como píldoras clave:valor.
// ---------------------------------------------------------------------------

/**
 * Nombres que fijan estos tests (la ficha no los daba; decisión del test-writer, delegada por
 * Dani y refinable): la fila de píldoras es `entity-tags`, común a todas las páginas de entidad;
 * cada píldora, `entity-tag`, con su clave en `entity-tag-key`, su valor (si lo hay) en
 * `entity-tag-value` y su contexto (si no es CONTEXTLESS) en `entity-tag-context`; el «+N» que
 * despliega el resto, `entity-tags-more`. La cabecera de la página es su `header`.
 */
const entityTags = (pageTestId: string): Locator =>
  page.getByTestId(pageTestId).getByTestId('entity-tags')

/** Ficha 0037: la clave de un elemento de píldora, sin espacios ni los dos puntos de «clave:». */
const cleanTagKey = (text: string | null): string => (text ?? '').replace(/:\s*$/, '').trim()

/** Ficha 0037: la clave de cada píldora de la fila, en el orden del DOM. */
async function tagKeys(row: Locator): Promise<string[]> {
  return (await row.getByTestId('entity-tag-key').allTextContents()).map(cleanTagKey)
}

/**
 * Ficha 0037: las píldoras que se ven dentro de la fila (caja no vacía, sin `visibility: hidden` y
 * dentro de la caja de la fila: una píldora recortada por la fila no se ve), con su clave y su
 * línea (arriba y alto).
 */
async function shownTags(row: Locator): Promise<{ key: string; top: number; height: number }[]> {
  return row.evaluate((element) => {
    const rowRect = element.getBoundingClientRect()
    return [...element.querySelectorAll('[data-testid="entity-tag"]')].flatMap((pill) => {
      const rect = pill.getBoundingClientRect()
      const inside =
        rect.top >= rowRect.top - 1 &&
        rect.bottom <= rowRect.bottom + 1 &&
        rect.left >= rowRect.left - 1 &&
        rect.right <= rowRect.right + 1
      const hidden = getComputedStyle(pill).visibility === 'hidden'
      if (rect.width === 0 || rect.height === 0 || hidden || !inside) return []
      const key = (pill.querySelector('[data-testid="entity-tag-key"]')?.textContent ?? '')
        .replace(/:\s*$/, '')
        .trim()
      return [{ key, top: rect.top, height: rect.height }]
    })
  })
}

/** Ficha 0037: ¿va `first` antes que `second` en el DOM, dentro de `root`? */
async function comesBefore(root: Locator, first: string, second: string): Promise<boolean> {
  return root.evaluate(
    (element, [a, b]) => {
      const nodeA = element.querySelector(`[data-testid="${a}"]`)
      const nodeB = element.querySelector(`[data-testid="${b}"]`)
      if (nodeA === null || nodeB === null) return false
      return (nodeA.compareDocumentPosition(nodeB) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    },
    [first, second] as const
  )
}

/** Ficha 0037: abre la página del servicio, espera su tarjeta (los datos ya han llegado) y la fila. */
async function openTagsPage(id: string): Promise<Locator> {
  await openServiceInfo(id)
  const row = entityTags('entity-page-service')
  await expect(row).toBeVisible()
  return row
}

test(
  'CA2 (0037): en la página de un servicio, las píldoras salen entre la cabecera y los marcadores, en orden alfabético; la de solo clave enseña solo la clave y las de contexto llevan su prefijo',
  { tag: '@entidad' },
  async () => {
    const row = await openTagsPage(TAGS_ID)
    const pageTestId = 'entity-page-service'
    const root = page.getByTestId(pageTestId)

    // Entre la cabecera y los marcadores: antes de los marcadores, solo la cabecera y la fila (que
    // puede ir dentro de la cabecera, debajo del título); la fila, antes que los marcadores en el
    // DOM y encima de ellos en la pantalla.
    const before = await visibleNeighbours(pageTestId, 'service-markers', 'before')
    expect(before, 'antes de los marcadores, la cabecera').toContain('header')
    expect(
      before.filter((name) => name !== 'entity-tags' && name !== 'header'),
      'nada más antes de los marcadores'
    ).toEqual([])
    expect(await comesBefore(root, 'entity-tags', 'service-markers'), 'orden en el DOM').toBe(true)
    const headerBox = await settledBox(root.locator('header').first())
    const rowBox = await settledBox(row)
    const markersBox = await settledBox(page.getByTestId('service-markers'))
    expect(rowBox.y, 'la fila, por debajo del principio de la cabecera').toBeGreaterThan(
      headerBox.y
    )
    expect(rowBox.y + rowBox.height, 'la fila, encima de los marcadores').toBeLessThanOrEqual(
      markersBox.y + 1
    )

    // Cinco píldoras, por clave en orden alfabético (no en el de la respuesta).
    const pills = row.getByTestId('entity-tag')
    await expect(pills).toHaveCount(TAGS_SORTED_KEYS.length)
    expect(await tagKeys(row)).toEqual(TAGS_SORTED_KEYS)
    // Las píldoras ya están en el orden de TAGS_SORTED_KEYS (comprobado justo arriba).
    const pill = (key: string): Locator => pills.nth(TAGS_SORTED_KEYS.indexOf(key))

    // Clave y valor, con el valor aparte y en otro tono que la clave.
    const zona = pill('zona')
    await expect(zona.getByTestId('entity-tag-value')).toHaveText(/^\s*norte\s*$/)
    await expect(zona).toHaveText(/zona\s*:\s*norte/)
    const colors = await zona.evaluate((element) => {
      const color = (id: string): string => {
        const target = element.querySelector(`[data-testid="${id}"]`)
        return target === null ? '' : getComputedStyle(target).color
      }
      return { key: color('entity-tag-key'), value: color('entity-tag-value') }
    })
    expect(colors.key, 'la clave tiene color').not.toBe('')
    expect(colors.value, 'la clave y el valor, en tonos distintos').not.toBe(colors.key)

    // Solo clave: ni valor ni dos puntos.
    const critico = pill('critico')
    await expect(critico.getByTestId('entity-tag-value')).toHaveCount(0)
    await expect(critico).not.toContainText(':')
    await expect(critico).toHaveText(/^\s*critico\s*$/)

    // Sin contexto (CONTEXTLESS), sin prefijo; con contexto, su prefijo antes de la clave.
    for (const key of ['zona', 'critico']) {
      await expect(pill(key).getByTestId('entity-tag-context'), key).toHaveCount(0)
      await expect(pill(key), key).not.toContainText(/contextless/i)
    }
    const withContext: [string, RegExp, string][] = [
      ['app', /kubernetes/i, 'pagos-k8s-e2e'],
      ['equipo', /environment/i, 'pagos-entorno-e2e'],
      ['nombre', /aws/i, 'pagos-aws-e2e']
    ]
    for (const [key, context, value] of withContext) {
      const target = pill(key)
      await expect(target.getByTestId('entity-tag-context'), key).toHaveText(context)
      await expect(target.getByTestId('entity-tag-value'), key).toHaveText(
        new RegExp(`^\\s*${value}\\s*$`)
      )
      expect(
        await comesBefore(target, 'entity-tag-context', 'entity-tag-key'),
        `${key}: el contexto va antes de la clave`
      ).toBe(true)
    }
  }
)

test(
  'CA2 (0037): en las páginas de host, browser monitor y proceso, sus etiquetas también salen como píldoras entre la cabecera y los marcadores, por orden alfabético',
  { tag: '@entidad' },
  async () => {
    const cases: [string, string[]][] = [
      ['host', ['entorno', 'equipo']],
      ['browser monitor', ['entorno', 'equipo']],
      ['proceso', ['equipo']]
    ]
    for (const [name, keys] of cases) {
      const entry = ORDERED_ENTITY_PAGES.find((candidate) => candidate.name === name)
      expect(entry, name).toBeDefined()
      if (entry === undefined) continue
      await entry.open()
      const root = page.getByTestId(entry.pageTestId)
      const row = entityTags(entry.pageTestId)
      await expect(row, name).toBeVisible()
      expect(await tagKeys(row), name).toEqual(keys)
      expect(
        await comesBefore(root, 'entity-tags', entry.markers),
        `${name}: orden en el DOM`
      ).toBe(true)
      const rowBox = await settledBox(row)
      const markersBox = await settledBox(root.getByTestId(entry.markers))
      expect(rowBox.y + rowBox.height, `${name}: encima de los marcadores`).toBeLessThanOrEqual(
        markersBox.y + 1
      )
    }
  }
)

test(
  'CA3 (0037): con muchas etiquetas, se ven las que caben en dos líneas y «+N» despliega el resto, en orden',
  { tag: '@entidad' },
  async () => {
    const row = await openTagsPage(TAGS_MANY_ID)
    await expect(row.getByTestId('entity-tag').first()).toBeVisible()
    const more = row.getByTestId('entity-tags-more')
    await expect(more).toBeVisible()
    await expect(more).toHaveText(/^\s*\+\d+\s*$/)
    const hidden = Number(((await more.textContent()) ?? '').replace(/\D/g, ''))

    // Plegada: las primeras por orden alfabético, en dos líneas como mucho, y «+N» con las demás.
    await settledBox(row)
    const shown = await shownTags(row)
    expect(shown.length, 'alguna se ve').toBeGreaterThan(0)
    expect(hidden, 'N > 0').toBeGreaterThan(0)
    expect(shown.length + hidden, 'las que se ven más N son todas').toBe(TAGS_MANY_KEYS.length)
    expect(shown.map((tag) => tag.key)).toEqual(TAGS_MANY_KEYS.slice(0, shown.length))
    const lines: number[] = []
    for (const tag of shown) {
      if (!lines.some((top) => Math.abs(top - tag.top) < tag.height / 2)) lines.push(tag.top)
    }
    expect(lines.length, 'como mucho dos líneas').toBeLessThanOrEqual(2)

    // Desplegada: todas, en orden.
    await clickInPlace(more, { scroll: true })
    await expect
      .poll(async () => (await shownTags(row)).map((tag) => tag.key))
      .toEqual(TAGS_MANY_KEYS)
  }
)

test(
  'CA4 (0037): la tarjeta «Información» ya no enseña etiquetas en las páginas de servicio, host, browser monitor y proceso; la fila de píldoras sí',
  { tag: '@entidad' },
  async () => {
    const cases: [string, string, string[]][] = [
      ['servicio', 'service-info-row', INFO_TAGS],
      ['host', 'host-info-row', ['equipo:sistemas', 'entorno:pre', 'sistemas']],
      ['browser monitor', 'monitor-info-row', ['equipo:web', 'entorno:pro']],
      ['proceso', 'process-info-row', ['equipo:proceso']]
    ]
    for (const [name, rowTestId, texts] of cases) {
      const entry = ORDERED_ENTITY_PAGES.find((candidate) => candidate.name === name)
      expect(entry, name).toBeDefined()
      if (entry === undefined) continue
      const card = await entry.open()
      await expect(card.getByTestId(rowTestId).first(), name).toBeVisible()
      await expect(card.locator(`[data-testid="${rowTestId}"][data-key="tags"]`), name).toHaveCount(
        0
      )
      await expect(card.getByTestId('entity-tags'), name).toHaveCount(0)
      await expect(card.getByTestId('entity-tag'), name).toHaveCount(0)
      for (const text of texts) await expect(card, `${name}: ${text}`).not.toContainText(text)
      // Las etiquetas siguen en la página, en la fila de píldoras.
      await expect(
        entityTags(entry.pageTestId).getByTestId('entity-tag').first(),
        name
      ).toBeVisible()
    }
  }
)

test(
  'CA5 (0037): sin etiquetas, o sin el scope entities.read, no hay fila de píldoras y los marcadores siguen justo debajo de la cabecera',
  { tag: '@entidad' },
  async () => {
    // Servicio y HTTP monitor sin etiquetas (con la tarjeta ya cargada: los datos han llegado).
    await openServiceInfo(INFO_FEW_ID)
    await expect(entityTags('entity-page-service')).toHaveCount(0)
    await expect(page.getByTestId('entity-tag')).toHaveCount(0)
    expect(await visibleNeighbours('entity-page-service', 'service-markers', 'before')).toEqual([
      'header'
    ])
    const http = ORDERED_ENTITY_PAGES.find((candidate) => candidate.name === 'HTTP monitor')
    expect(http).toBeDefined()
    if (http !== undefined) {
      await http.open()
      await expect(entityTags(http.pageTestId)).toHaveCount(0)
      await expect(page.getByTestId('entity-tag')).toHaveCount(0)
    }

    // Sin entities.read: la tarjeta dice qué scope falta y no hay fila (aunque la entidad tenga).
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
      await goToRoute(`/entities/SERVICE/${TAGS_ID}`)
      await expect(page.getByTestId('entity-page-service')).toBeVisible()
      await expect(infoCard().getByTestId('module-unavailable')).toContainText('entities.read')
      await expect(page.getByTestId('service-markers')).toBeVisible()
      await expect(entityTags('entity-page-service')).toHaveCount(0)
      await expect(page.getByTestId('entity-tag')).toHaveCount(0)
    } finally {
      await invoke('environments:setActive', { environmentId: env['Producción'] })
      await invoke('environments:delete', { id: noEntities })
      await reloadUi()
    }
  }
)

// ---------------------------------------------------------------------------
// Ficha 0049: etiquetas como cápsula de dos colores (clave | valor).
// ---------------------------------------------------------------------------

/**
 * Nombres que fija este test (la ficha pide un `data-testid` por mitad sin darlo; decisión del
 * developer, delegada por Dani y refinable): la mitad de la clave es `entity-tag-key-part` (con el
 * contexto y `entity-tag-key` dentro) y la del valor, `entity-tag-value-part` (con
 * `entity-tag-value` dentro). Los de la 0037 siguen igual.
 */
async function capsuleParts(pill: Locator): Promise<{
  pill: { left: number; right: number; top: number }
  key: { left: number; right: number; top: number; background: string } | null
  value: { left: number; right: number; top: number; background: string } | null
}> {
  return pill.evaluate((element) => {
    const part = (
      id: string
    ): { left: number; right: number; top: number; background: string } | null => {
      const target = element.querySelector(`[data-testid="${id}"]`)
      if (target === null) return null
      const rect = target.getBoundingClientRect()
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        background: getComputedStyle(target).backgroundColor
      }
    }
    const rect = element.getBoundingClientRect()
    return {
      pill: { left: rect.left, right: rect.right, top: rect.top },
      key: part('entity-tag-key-part'),
      value: part('entity-tag-value-part')
    }
  })
}

const TRANSPARENT = ['rgba(0, 0, 0, 0)', 'transparent', '']

test(
  'CA3 (0049): una etiqueta clave:valor sale como cápsula de dos mitades y una de solo clave con una sola; la misma clave lleva el mismo color',
  { tag: '@entidad' },
  async () => {
    const row = await openTagsPage(TAGS_CAPSULE_ID)
    const pills = row.getByTestId('entity-tag')
    await expect(pills).toHaveCount(4)
    expect(await tagKeys(row)).toEqual(['critico', 'equipo', 'equipo', 'zona'])
    await settledBox(row)

    // Con valor: dos mitades, la clave a la izquierda y el valor a su derecha, en la misma línea,
    // cada una con su texto y con fondos distintos (ninguno transparente).
    const withValue: [number, string, string][] = [
      [1, 'equipo', 'pagos'],
      [2, 'equipo', 'web'],
      [3, 'zona', 'norte']
    ]
    const keyBackgrounds: Record<number, string> = {}
    for (const [index, key, value] of withValue) {
      const pill = pills.nth(index)
      await expect(pill.getByTestId('entity-tag-key-part'), key).toHaveCount(1)
      await expect(pill.getByTestId('entity-tag-value-part'), key).toHaveCount(1)
      await expect(
        pill.getByTestId('entity-tag-key-part').getByTestId('entity-tag-key'),
        key
      ).toHaveText(new RegExp(`^\\s*${key}\\s*$`))
      await expect(
        pill.getByTestId('entity-tag-value-part').getByTestId('entity-tag-value'),
        key
      ).toHaveText(new RegExp(`^\\s*${value}\\s*$`))
      const parts = await capsuleParts(pill)
      expect(parts.key, `${key}: mitad de la clave`).not.toBeNull()
      expect(parts.value, `${key}: mitad del valor`).not.toBeNull()
      if (parts.key === null || parts.value === null) continue
      expect(parts.key.right, `${key}: la clave, a la izquierda del valor`).toBeLessThanOrEqual(
        parts.value.left + 1.5
      )
      expect(Math.abs(parts.key.top - parts.value.top), `${key}: misma línea`).toBeLessThan(2)
      expect(TRANSPARENT, `${key}: la clave tiene fondo`).not.toContain(parts.key.background)
      expect(TRANSPARENT, `${key}: el valor tiene fondo`).not.toContain(parts.value.background)
      expect(parts.key.background, `${key}: dos colores`).not.toBe(parts.value.background)
      keyBackgrounds[index] = parts.key.background
    }

    // La misma clave (equipo), el mismo color.
    expect(keyBackgrounds[1]).toBe(keyBackgrounds[2])

    // Solo clave: una sola mitad, del color de la clave, que ocupa la cápsula entera.
    const critico = pills.nth(0)
    await expect(critico.getByTestId('entity-tag-key-part')).toHaveCount(1)
    await expect(critico.getByTestId('entity-tag-value-part')).toHaveCount(0)
    const single = await capsuleParts(critico)
    expect(single.key).not.toBeNull()
    if (single.key !== null) {
      expect(TRANSPARENT, 'solo clave: con fondo').not.toContain(single.key.background)
      // Entera: como mucho el borde (1 px por lado) y redondeo.
      expect(single.key.left - single.pill.left).toBeLessThanOrEqual(2)
      expect(single.pill.right - single.key.right).toBeLessThanOrEqual(2)
    }
  }
)
