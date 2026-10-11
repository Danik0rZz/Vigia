import { readFileSync } from 'node:fs'
import { expect, type Locator, test } from '@playwright/test'
import { hoverFresh, moveToNeutral } from './hover'
import { wallTimeToEpoch } from './local-time'
import {
  BIG_ID,
  BIG_ROOT,
  CHART_ENTITY,
  CHART_ID,
  chartEventId,
  DAY_MS,
  EV_ID,
  EV_METRIC,
  EV_START,
  HOSTILE_COMMENT,
  HOUR,
  LAZY_ID,
  LONG_DAYS,
  LONG_ID,
  MIN,
  MIXED_ID,
  NOW,
  ODD_ID,
  SEL_ACTIVE,
  SEL_BIG,
  SEL_DESC,
  SEL_DONE,
  SEL_LAZY,
  SEL_LONG,
  SEL_MANY,
  SEL_OK,
  TABLE_HTML,
  TABLE_ID,
  LONG_END,
  DESC_12K,
  ALL_METRIC,
  ALL_AVAILABILITY,
  ALL_TRANSACTIONAL,
  ALL_EVENT,
  ALL_PLAIN,
  ALL_OTHER_EVENT,
  OTHER_KEY,
  OTHER_KEY_EVENT,
  THOUSANDS_PROBLEM_ID
} from './views/fixtures'
import {
  currentRoute,
  exportSaved,
  goToRoute,
  openProblem,
  openProblems,
  page,
  pngInfo,
  receivesClick,
  setupViewsApp,
  withContentSize
} from './views/harness'
import { sim } from './views/sim-state'
import { SMALL_WINDOW } from './window-size'
import ExcelJS from 'exceljs'
import es from '../src/renderer/src/locales/es/common.json'
import { MAX_DESCRIPTION_LENGTH } from '../src/shared/problem-evidence'
import {
  evidenceRows,
  evidenceRow,
  detailOf,
  expandRow,
  rowRenders,
  settledRowRenders,
  markRows,
  sameRows,
  axisOf,
  ES_DAY,
  openDescriptionProblem,
  descriptionParts,
  openAllDescriptionsProblem,
  settledRequests,
  PANEL_FAILURE,
  failChartMountOnce,
  dropPanelFailureErrors
} from './views/helpers'

/**
 * Specs de vistas por zona (ficha 0070): el detalle del problema (`@problema-detalle`). Arnés en
 * `e2e/views/` (ver su cabecera).
 */

setupViewsApp()

test(
  'CA2 (0005): con la ventana más pequeña que permite la app, el enlace «Problemas» de la barra superior se ve y recibe un clic normal',
  { tag: '@problema-detalle' },
  async () => {
    await withContentSize(SMALL_WINDOW, async () => {
      await openProblems()
      await openProblem('P-102')
      const crumbSection = page.getByTestId('breadcrumb-section')
      await expect(crumbSection).toHaveText('Problemas')
      await expect(crumbSection).toBeVisible()
      await expect.poll(() => receivesClick(crumbSection), 'el enlace recibe el clic').toBe(true)
      await crumbSection.click()
      await expect(page.getByTestId('problem-row')).toHaveCount(3)
      expect(await currentRoute()).toBe('/problems')
    })
  }
)

test(
  'AUD-12: mientras el detalle carga, la página ya muestra los datos de la fila',
  { tag: '@problema-detalle' },
  async () => {
    await openProblems()
    let release = (): void => undefined
    sim.detailGate = new Promise<void>((resolve) => {
      release = resolve
    })
    try {
      const detail = await openProblem('P-103')
      // Lo de la fila, al instante: título, entidad afectada y severidad.
      await expect(detail).toContainText('errores')
      await expect(detail).toContainText('carrito')
      await expect(detail.getByTestId('detail-summary')).toContainText('NUEVA_SEVERIDAD')
      // Lo que solo trae el detalle, cargando.
      await expect(detail.getByTestId('detail-loading').first()).toBeVisible()
    } finally {
      release()
      sim.detailGate = null
    }
    const detail = page.getByTestId('problem-page')
    await expect(detail.getByTestId('detail-loading')).toHaveCount(0)
    await expect(detail).toContainText('carrito')
  }
)

test(
  'AUD-12: si el detalle falla, el error va dentro de la página y los datos de la fila se quedan',
  { tag: '@problema-detalle' },
  async () => {
    await openProblems()
    sim.detailFails = true
    const detail = await openProblem('P-102')
    await expect(detail.getByRole('alert').first()).toBeVisible()
    await expect(detail).toContainText('Detalle no disponible en la prueba')
    await expect(detail).toContainText('Disco lleno')
    await expect(detail).toContainText('host-bd-01')
    // Con error, las secciones del detalle no se quedan en «Cargando…»: dicen que no están.
    await expect(detail.getByTestId('detail-loading')).toHaveCount(0)
    await expect(detail.getByText(es.problems.detailUnavailable).first()).toBeVisible()
    // No es un 404: no sale «no existe».
    await expect(page.getByTestId('problem-not-found')).toHaveCount(0)
  }
)

test(
  'v0.9.0: entrar por URL a un problema con un id raro (- y _) y volver a la lista',
  { tag: '@problema-detalle' },
  async () => {
    // Desde Inicio, sin la lista en caché: la ruta lleva el problemId codificado.
    await goToRoute(`/problems/${encodeURIComponent(ODD_ID)}`)
    const detail = page.getByTestId('problem-page')
    await expect(detail).toBeVisible()
    await expect(page.getByTestId('problem-page-title')).toContainText('P-777')
    await expect(page.getByTestId('problem-page-title')).toContainText('Problema solo del detalle')
    await expect(page.getByTestId('breadcrumb-detail')).toHaveText('P-777')
    await expect(detail.getByTestId('detail-affected')).toContainText('raro')

    // Sin venir de la lista, «Volver» va a la lista (reemplazando la entrada).
    await page.getByTestId('problem-back').click()
    await expect(page.getByTestId('problem-row')).toHaveCount(3)
    expect(await currentRoute()).toBe('/problems')
  }
)

test(
  'v0.9.0: un problema que no existe da un 404 con enlace a la lista',
  { tag: '@problema-detalle' },
  async () => {
    await goToRoute(`/problems/${encodeURIComponent('no-existe-en-este-entorno')}`)
    const notFound = page.getByTestId('problem-not-found')
    await expect(notFound).toBeVisible()
    await expect(notFound).toContainText('No existe un problema con ese ID en este entorno.')
    await expect(page.getByTestId('problem-page')).toHaveCount(0)

    await page.getByTestId('problem-not-found-back').click()
    await expect(page.getByTestId('problem-row')).toHaveCount(3)
    expect(await currentRoute()).toBe('/problems')
  }
)

test(
  'v0.9.0: detalle: clúster y namespace, y las secciones sin datos no se pintan',
  { tag: '@problema-detalle' },
  async () => {
    await openProblems()

    // P-101: un clúster y ningún namespace → solo la fila «Clúster».
    let detail = await openProblem('P-101')
    const cluster = detail.getByTestId('detail-cluster')
    await expect(cluster).toContainText('Clúster y namespace')
    await expect(cluster).toContainText('cluster-norte')
    await expect(cluster.locator('dt')).toHaveText(['Clúster'])
    await page.getByTestId('problem-back').click()

    // P-103: dos clústeres (unidos con «, ») y dos namespaces.
    detail = await openProblem('P-103')
    await expect(detail.getByTestId('detail-cluster')).toContainText('cluster-sur, cluster-norte')
    await expect(detail.getByTestId('detail-cluster')).toContainText('carrito-ns, comun-ns')
    await expect(detail.getByTestId('detail-cluster').locator('dt')).toHaveText([
      'Clúster',
      'Namespace'
    ])
    await page.getByTestId('problem-back').click()

    // P-102: sin clúster, sin impactadas, sin zonas y, cargado el detalle, sin evidencias,
    // impactos, comentarios, etiquetas ni vinculado → ninguna de esas secciones (ni «Ninguno»).
    detail = await openProblem('P-102')
    await expect(detail.getByTestId('detail-affected')).toContainText('host-bd-01')
    await expect(detail.getByTestId('detail-loading')).toHaveCount(0)
    for (const id of [
      'detail-cluster',
      'detail-impacted',
      'detail-zones',
      'detail-evidence',
      'detail-impacts',
      'detail-comments',
      'detail-tags',
      'detail-linked'
    ]) {
      await expect(detail.getByTestId(id), id).toHaveCount(0)
    }
    await expect(detail).not.toContainText('Ninguno')
  }
)

test(
  'CA2 (0059): escribir en el buscador de evidencias solo vuelve a pintar las filas que cambian',
  { tag: '@problema-detalle' },
  async () => {
    await goToRoute(`/problems/${BIG_ID}`)
    await expect(page.getByTestId('problem-page-title')).toContainText('P-778')
    await expect(evidenceRows().first()).toHaveAttribute('data-event-id', 'big-299')

    const before = await settledRowRenders('evidence-row', 'data-event-id')
    const mounted = Object.keys(before)
    expect(mounted.length, 'evidencias montadas').toBeGreaterThan(5)
    for (const [id, count] of Object.entries(before)) {
      expect(count, `data-render-count de ${id}`).toBeGreaterThanOrEqual(1)
    }
    await markRows('evidence-row', 'data-event-id')

    // Letra a letra, un texto que cumplen las 300: ninguna fila cambia, así que ninguna se repinta.
    const search = page.getByTestId('evidence-search')
    await search.click()
    await search.pressSequentially('Evidencia')
    await expect(search).toHaveValue('Evidencia')
    await expect(evidenceRows().first()).toHaveAttribute('data-event-id', 'big-299')
    const after = await settledRowRenders('evidence-row', 'data-event-id')
    expect(Object.keys(after).sort(), 'las mismas filas montadas').toEqual([...mounted].sort())
    const kept = await sameRows('evidence-row', 'data-event-id')
    expect(kept.sort(), 'ninguna fila se ha vuelto a montar').toEqual([...mounted].sort())
    expect(after, 'renders de las filas que no han cambiado').toEqual(before)

    // Una fila que sí cambia (se despliega) se vuelve a pintar: el contador sube.
    const target = page.locator('[data-testid="evidence-row"][data-event-id="big-297"]')
    await target.click()
    await expect(target).toHaveAttribute('aria-expanded', 'true')
    await expect
      .poll(async () => (await rowRenders('evidence-row', 'data-event-id'))['big-297'] ?? -1)
      .toBeGreaterThan(after['big-297'] ?? Number.MAX_SAFE_INTEGER)
  }
)

test(
  'v0.10.0: 300 evidencias en la tabla virtualizada; la vista responde',
  { tag: '@problema-detalle' },
  async () => {
    await goToRoute(`/problems/${BIG_ID}`)
    const detail = page.getByTestId('problem-page')
    await expect(page.getByTestId('problem-page-title')).toContainText('P-778')
    await expect(evidenceRows().first()).toBeVisible()
    // Virtualizada: no se pintan las 300 filas.
    expect(await evidenceRows().count()).toBeLessThan(300)
    // La evidencia ilegible no sale y se avisa; la API mandó las 301 (no es un recorte).
    await expect(detail.getByTestId('api-warnings')).toContainText('1 elemento')
    await expect(detail.getByTestId('evidence-api-truncated')).toHaveCount(0)
    // Contadores: 150 abiertas y 150 cerradas.
    await expect(page.getByTestId('evidence-status-ALL')).toHaveAttribute('data-count', '300')
    await expect(page.getByTestId('evidence-status-OPEN')).toHaveAttribute('data-count', '150')
    await expect(page.getByTestId('evidence-status-CLOSED')).toHaveAttribute('data-count', '150')
    // Orden por defecto: abiertas primero y la más reciente arriba (la 299).
    await expect(evidenceRows().first()).toHaveAttribute('data-event-id', 'big-299')

    // La vista responde: ir al final del grid y volver.
    const started = Date.now()
    await evidenceRows().first().focus()
    await page.keyboard.press('End')
    const last = page.locator('[data-testid="evidence-row"][data-event-id="big-2"]')
    await expect(last).toBeInViewport()
    await expect(last).toBeFocused()
    await page.keyboard.press('Home')
    await expect(evidenceRows().first()).toBeFocused()
    expect(Date.now() - started, 'recorrer 300 evidencias').toBeLessThan(5000)
    await page.getByTestId('problem-back').click()
    await expect(page.getByTestId('problem-page')).toHaveCount(0)
  }
)

test(
  'v0.10.0: tabla virtualizada: desplegar una fila con gráfico recalcula la altura (la siguiente no se solapa)',
  { tag: '@problema-detalle' },
  async () => {
    sim.eventMetricDelayMs = 600
    await goToRoute(`/problems/${BIG_ID}`)
    const first = page.locator('[data-testid="evidence-row"][data-event-id="big-299"]')
    const next = page.locator('[data-testid="evidence-row"][data-event-id="big-297"]')
    await expect(first).toBeVisible()
    const bottomOf = async (locator: Locator): Promise<number> => {
      const box = await locator.boundingBox()
      return (box?.y ?? 0) + (box?.height ?? 0)
    }
    const topOf = async (locator: Locator): Promise<number> => (await locator.boundingBox())?.y ?? 0

    await first.click()
    const detail = await detailOf(first)
    // Mientras carga: la siguiente fila va debajo del detalle.
    await expect(detail.getByTestId('evidence-metric-loading')).toBeVisible()
    expect(await topOf(next)).toBeGreaterThanOrEqual((await bottomOf(detail)) - 1)
    const loadingBottom = await bottomOf(detail)
    // Con el gráfico pintado (más alto): se vuelve a medir y la siguiente baja con él.
    await expect(detail.getByTestId('evidence-metric')).toBeVisible()
    await expect
      .poll(async () => (await topOf(next)) - (await bottomOf(detail)))
      .toBeGreaterThanOrEqual(-1)
    expect(await bottomOf(detail)).toBeGreaterThan(loadingBottom)
    expect(eventQueries(SEL_BIG)).toHaveLength(1)
    // Plegar: la siguiente vuelve justo debajo de la fila.
    await first.click()
    await expect(page.getByTestId('evidence-detail')).toHaveCount(0)
    await expect
      .poll(async () => Math.abs((await topOf(next)) - (await bottomOf(first))))
      .toBeLessThan(2)
  }
)

test(
  'v0.10.0: el resumen de causa raíz salta a su fila aunque un filtro la oculte: quita el filtro, scroll, la despliega y le da el foco',
  { tag: '@problema-detalle' },
  async () => {
    await goToRoute(`/problems/${BIG_ID}`)
    await expect(evidenceRows().first()).toBeVisible()
    // La causa raíz (cerrada) queda oculta: filtro de abiertas y un texto que no casa.
    await page.getByTestId('evidence-status-OPEN').click()
    await page.getByTestId('evidence-search').fill('Evidencia 1')
    const target = page.locator(`[data-testid="evidence-row"][data-event-id="big-${BIG_ROOT}"]`)
    await expect(target).toHaveCount(0)

    const link = page.getByTestId('root-cause-summary').getByTestId('root-cause-link')
    await expect(link).toHaveCount(1)
    await expect(link).toHaveAttribute('data-id', `big-${BIG_ROOT}`)
    await link.click()

    // Los filtros que la ocultaban se han quitado.
    await expect(page.getByTestId('evidence-status-ALL')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('evidence-search')).toHaveValue('')
    // Su fila, en pantalla, desplegada y con el foco.
    await expect(target).toBeInViewport()
    await expect(target).toHaveAttribute('aria-expanded', 'true')
    await expect(target).toBeFocused()
    await expect(await detailOf(target)).toBeVisible()
  }
)

test(
  'v0.9.0: seguridad: un comentario con <script> e <img onerror> se ve literal y no ejecuta nada',
  { tag: '@problema-detalle' },
  async () => {
    const dialogs: string[] = []
    const onDialog = (dialog: { message: () => string; dismiss: () => Promise<void> }): void => {
      dialogs.push(dialog.message())
      void dialog.dismiss()
    }
    page.on('dialog', onDialog)
    try {
      await goToRoute(`/problems/${BIG_ID}`)
      const comments = page.getByTestId('detail-comments')
      // El texto, tal cual, con sus etiquetas.
      await expect(comments).toContainText('<script>window.__xss = "script"</script>')
      await expect(comments).toContainText('<img src="x" onerror=')
      await expect(comments).toContainText('fin')
      // Nada de eso se ha convertido en elementos ni se ha ejecutado.
      const page_ = page.getByTestId('problem-page')
      await expect(page_.locator('script')).toHaveCount(0)
      await expect(page_.locator('img')).toHaveCount(0)
      // Un margen para que un onerror o un script, si los hubiera, se ejecutaran.
      await page.waitForTimeout(300)
      expect(await page.evaluate(() => (window as { __xss?: unknown }).__xss ?? null)).toBeNull()
      expect(dialogs).toEqual([])
    } finally {
      page.off('dialog', onDialog)
    }
    // Los errores de consola (una imagen rota daría uno) los comprueba el afterEach.
  }
)

test(
  'v0.9.0: exportación del detalle: XLSX con sus hojas e Info, en es y en; CSV solo con las principales',
  { tag: '@problema-detalle' },
  async () => {
    await goToRoute(`/problems/${BIG_ID}`)
    await expect(page.getByTestId('problem-page').getByTestId('detail-evidence')).toBeVisible()

    const workbook = async (): Promise<ExcelJS.Workbook> => {
      const book = new ExcelJS.Workbook()
      await book.xlsx.load(
        readFileSync(await exportSaved('problem-page', 'export-xlsx')) as unknown as ArrayBuffer
      )
      return book
    }
    const header = (sheet: ExcelJS.Worksheet | undefined): string[] =>
      ((sheet?.getRow(1).values as unknown[] | undefined) ?? []).slice(1).map(String)

    const es1 = await workbook()
    // v0.9.1: sin hoja Impacto.
    expect(es1.worksheets.map((s) => s.name)).toEqual([
      'Resumen',
      'Entidades',
      'Evidencias',
      'Comentarios',
      'Info'
    ])
    expect(es1.getWorksheet('Resumen')?.actualRowCount).toBe(2)
    expect(header(es1.getWorksheet('Resumen'))).toHaveLength(17)
    // Entidades: la afectada y la impactada, con su rol.
    const entityRows: string[] = []
    es1.getWorksheet('Entidades')?.eachRow((row, n) => {
      if (n > 1) entityRows.push(`${String(row.getCell(1).value)}|${String(row.getCell(4).value)}`)
    })
    expect(entityRows).toEqual(['Afectada|SERVICE-BIG1', 'Impactada|APPLICATION-BIG1'])
    // v0.10.0: TODAS las evidencias (sin filtro), en el orden de la tabla y con las columnas nuevas.
    const evidence = es1.getWorksheet('Evidencias')
    expect(evidence?.actualRowCount).toBe(301)
    const evidenceHeader = header(evidence)
    expect(evidenceHeader).toEqual([
      'Estado',
      'Evento',
      'Tipo',
      'Entidad',
      'Tipo de entidad',
      'Inicio',
      'Fin',
      'Duración (min)',
      'Etiquetas',
      'Causa raíz',
      'En mantenimiento',
      'Frecuente',
      'ID del evento',
      'Antes',
      'Después',
      'Unidad',
      'Métrica'
    ])
    const col = (name: string): number => evidenceHeader.indexOf(name) + 1
    // La primera fila es la de la tabla: big-299 (abierta y la más reciente).
    const firstRow = evidence?.getRow(2)
    expect(firstRow?.getCell(col('ID del evento')).value).toBe('big-299')
    expect(firstRow?.getCell(col('Estado')).value).toBe('Abierto')
    expect(firstRow?.getCell(col('Inicio')).value).toBeInstanceOf(Date)
    // Activa: "Activo" (texto en una columna de fecha) y la duración como número.
    expect(firstRow?.getCell(col('Fin')).value).toBe('Activo')
    expect(typeof firstRow?.getCell(col('Duración (min)')).value).toBe('number')
    // Info: van todas.
    const evidenceNote = (book: ExcelJS.Workbook): string => {
      const lines: string[] = []
      book.getWorksheet('Info')?.eachRow((row) => {
        lines.push(((row.values as unknown[] | undefined) ?? []).map(String).join('|'))
      })
      return lines.find((line) => line.includes('Evidencias:')) ?? ''
    }
    expect(evidenceNote(es1)).toContain('Evidencias: todas (300), en el orden de la tabla.')
    // Comentario como texto (ni fórmula ni HTML interpretado); columnas Autor, Fecha, Contexto, Comentario.
    const commentSheet = es1.getWorksheet('Comentarios')
    expect(header(commentSheet)).toEqual(['Autor', 'Fecha', 'Contexto', 'Comentario'])
    expect(String(commentSheet?.getRow(2).getCell(4).value)).toBe(HOSTILE_COMMENT)
    // Info con el contexto y la nota de siempre.
    const info: Record<string, unknown> = {}
    es1.getWorksheet('Info')?.eachRow((row) => {
      info[String(row.getCell(1).value)] = row.getCell(2).value
    })
    expect(info).toMatchObject({ Cliente: 'Cliente A', Entorno: 'Producción' })
    expect(String(info['Nota'])).toContain('Problemas abiertos: sin fin')

    // v0.10.0: con un filtro en la tabla, la hoja Evidencias trae solo lo filtrado y la Info lo dice.
    await page.getByTestId('evidence-status-CLOSED').click()
    await page.getByTestId('evidence-search').fill('Evidencia 25')
    // Cerradas (las pares) cuyo título contiene «Evidencia 25»: 250, 252, 254, 256 y 258 → 5
    // (la 25 es impar: abierta).
    await expect(page.getByTestId('evidence-row')).toHaveCount(5)
    const filtered = await workbook()
    const filteredSheet = filtered.getWorksheet('Evidencias')
    expect(filteredSheet?.actualRowCount).toBe(6)
    const ids: string[] = []
    filteredSheet?.eachRow((row, n) => {
      if (n > 1) ids.push(String(row.getCell(col('ID del evento')).value))
    })
    // En el orden de la tabla (cerradas, startTime desc).
    expect(ids).toEqual(['big-258', 'big-256', 'big-254', 'big-252', 'big-250'])
    const note = evidenceNote(filtered)
    expect(note).toContain('Evidencias: las 5 de 300 que deja el filtro de la tabla')
    expect(note).toContain('Cerrados')
    expect(note).toContain('Evidencia 25')

    // CSV: ahora también Evidencias (es principal), con lo filtrado; sin Comentarios.
    const csv = readFileSync(await exportSaved('problem-page', 'export-csv'))
    expect([...csv.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    const text = csv.subarray(3).toString('utf8')
    expect(text).toContain('Resumen')
    expect(text).toContain('Entidades')
    expect(text).toContain('Evidencias')
    expect(text.indexOf('Resumen')).toBeLessThan(text.indexOf('Entidades'))
    expect(text.indexOf('Entidades')).toBeLessThan(text.indexOf('Evidencias'))
    expect(text).toContain('big-250')
    expect(text).not.toContain('big-299')
    expect(text).not.toContain('Comentarios')
    await page.getByTestId('evidence-status-ALL').click()
    await page.getByTestId('evidence-search').fill('')

    // En inglés, las hojas en inglés.
    await page.getByRole('button', { name: es.topbar.language }).click()
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    const en1 = await workbook()
    expect(en1.worksheets.map((s) => s.name)).toEqual([
      'Summary',
      'Entities',
      'Evidence',
      'Comments',
      'Info'
    ])
    expect(en1.getWorksheet('Evidence')?.getRow(2).getCell(col('Fin')).value).toBe('Active')
  }
)

/** v0.9.1: abre P-779 (evidencias variadas) por URL y espera a que se pinten. */
async function openEvidenceProblem(): Promise<Locator> {
  await goToRoute(`/problems/${EV_ID}`)
  const detail = page.getByTestId('problem-page')
  await expect(page.getByTestId('problem-page-title')).toContainText('P-779')
  await expect(detail.getByTestId('evidence-row').first()).toBeVisible()
  return detail
}

/** v0.10.0: abre P-783 (tabla: problema cerrado con eventos abiertos y cerrados). */
async function openTableProblem(): Promise<Locator> {
  await goToRoute(`/problems/${TABLE_ID}`)
  const detail = page.getByTestId('problem-page')
  await expect(page.getByTestId('problem-page-title')).toContainText('P-783')
  await expect(evidenceRows()).toHaveCount(6)
  return detail
}

const rowTitles = async (): Promise<string[]> =>
  evidenceRows().evaluateAll((rows) =>
    rows.map((row) => row.querySelectorAll('[role="gridcell"]')[1]?.textContent?.trim() ?? '')
  )

test(
  'v0.10.0: tabla de evidencias: estado propio por evento en un problema cerrado, columnas y celdas',
  { tag: '@problema-detalle' },
  async () => {
    await openTableProblem()
    const grid = page.getByTestId('evidence-grid')
    await expect(grid).toHaveAttribute('role', 'grid')
    await expect(page.getByTestId('evidence-scroll').getByTestId('evidence-grid')).toHaveCount(1)
    // El problema está cerrado, pero cada fila tiene su estado.
    await expect(page.getByTestId('detail-summary')).toContainText('Cerrado')
    // Columnas en orden; tags y flags sin orden.
    const columns = [
      'status',
      'title',
      'type',
      'entity',
      'start',
      'end',
      'duration',
      'tags',
      'rootCause',
      'flags'
    ]
    expect(
      await grid
        .locator('[data-testid^="col-"]')
        .evaluateAll((cols) => cols.map((col) => col.getAttribute('data-testid')))
    ).toEqual(columns.map((c) => `col-${c}`))
    for (const c of ['tags', 'flags']) await expect(grid.getByTestId(`sort-${c}`)).toHaveCount(0)
    for (const c of columns.filter((c) => c !== 'tags' && c !== 'flags')) {
      await expect(grid.getByTestId(`sort-${c}`), c).toHaveCount(1)
    }

    // Orden por defecto: abiertos primero, startTime desc.
    expect(await rowTitles()).toEqual([
      'Errores 5xx',
      'CPU saturada',
      'Tiempo de respuesta tabla',
      'Respuesta lenta',
      'Sin datos de evento',
      'Estado manda'
    ])
    const expected: [string, 'OPEN' | 'CLOSED'][] = [
      ['Errores 5xx', 'OPEN'], // sin status: data.endTime -1
      ['CPU saturada', 'OPEN'],
      ['Tiempo de respuesta tabla', 'OPEN'], // METRIC sin data: endTime -1
      ['Respuesta lenta', 'CLOSED'],
      ['Sin datos de evento', 'CLOSED'], // sin data: endTime numérico
      ['Estado manda', 'CLOSED'] // status CLOSED aunque endTime sea -1
    ]
    for (const [title, status] of expected) {
      const row = evidenceRow(title)
      await expect(row, title).toHaveAttribute('data-status', status)
      await expect(row.getByTestId('status-bar'), title).toHaveAttribute('data-status', status)
      const cell = row.getByTestId('evidence-status')
      await expect(cell, title).toHaveAttribute('data-status', status)
      await expect(cell, title).toHaveText(status === 'OPEN' ? 'Abierto' : 'Cerrado')
      await expect(row, title).toHaveAttribute('aria-expanded', 'false')
    }
    await expect(evidenceRow('CPU saturada')).toHaveAttribute('data-event-id', 'tbl-1')
    // Sin eventId: sin data-event-id.
    await expect(evidenceRow('Sin datos de evento')).not.toHaveAttribute('data-event-id', /.*/)

    // Fin y duración de una activa; una cerrada con su duración.
    await expect(evidenceRow('Errores 5xx').getByTestId('evidence-end')).toHaveText('Activo')
    await expect(evidenceRow('Errores 5xx').getByTestId('evidence-duration')).toHaveText('en curso')
    await expect(evidenceRow('Respuesta lenta').getByTestId('evidence-duration')).toHaveText(
      '20 min'
    )
    // Tipo traducido si existe; si no, el código.
    await expect(evidenceRow('Tiempo de respuesta tabla')).toContainText('Métrica')
    await expect(evidenceRow('Sin datos de evento')).toContainText('CUSTOM_INFO')
    // Causa raíz y flags (solo los true).
    await expect(evidenceRow('CPU saturada').getByTestId('evidence-root')).toHaveText('Sí')
    await expect(evidenceRow('Respuesta lenta').getByTestId('evidence-root')).toHaveText('')
    const flags = evidenceRow('CPU saturada').getByTestId('evidence-flags')
    await expect(flags.getByTestId('flag-maintenance')).toHaveCount(1)
    await expect(flags.getByTestId('flag-frequent')).toHaveCount(0)
    await expect(flags.getByTestId('flag-suppressed')).toHaveCount(0)
    await expect(evidenceRow('Estado manda').getByTestId('flag-frequent')).toHaveCount(1)

    // Tags: 2 visibles y «+2» con un tooltip con todos (sin stringRepresentation → key:value o key).
    const tags = evidenceRow('CPU saturada').getByTestId('evidence-tags')
    await expect(tags).toContainText('equipo:pagos')
    await expect(tags).toContainText('zona:eu')
    const more = tags.getByTestId('evidence-tags-more')
    await expect(more).toHaveText('+2')
    await hoverFresh(page, more)
    const tooltip = page.getByTestId('evidence-tags-tooltip')
    await expect(tooltip).toBeVisible()
    for (const tag of ['equipo:pagos', 'zona:eu', 'critico', 'capa:infra']) {
      await expect(tooltip).toContainText(tag)
    }
    await moveToNeutral(page)
    await page.keyboard.press('Escape')
    await expect(tooltip).toHaveCount(0)
    // Tooltip de la entidad, con su tipo.
    await hoverFresh(
      page,
      evidenceRow('CPU saturada').getByRole('gridcell', { name: /host-tabla/ })
    )
    await expect(page.getByTestId('evidence-entity-tooltip')).toContainText('HOST')
    await moveToNeutral(page)
    await page.keyboard.press('Escape')

    // Orden por título (clic en la cabecera) y vuelta al de estado.
    await grid.getByTestId('sort-title').click()
    expect((await rowTitles())[0]).toBe('CPU saturada')
    await grid.getByTestId('sort-status').click()
    await grid.getByTestId('sort-status').click()
  }
)

test(
  'v0.10.0: contadores Abiertos/Cerrados/Todos filtran y se combinan con el resto de filtros',
  { tag: '@problema-detalle' },
  async () => {
    await openTableProblem()
    const button = (s: 'ALL' | 'OPEN' | 'CLOSED'): Locator =>
      page.getByTestId(`evidence-status-${s}`)
    await expect(button('ALL')).toHaveAttribute('data-count', '6')
    await expect(button('OPEN')).toHaveAttribute('data-count', '3')
    await expect(button('CLOSED')).toHaveAttribute('data-count', '3')
    await expect(button('ALL')).toHaveAttribute('aria-pressed', 'true')

    await button('OPEN').click()
    await expect(button('OPEN')).toHaveAttribute('aria-pressed', 'true')
    await expect(button('ALL')).toHaveAttribute('aria-pressed', 'false')
    await expect(evidenceRows()).toHaveCount(3)
    for (const row of await evidenceRows().all())
      await expect(row).toHaveAttribute('data-status', 'OPEN')
    // Los contadores no dependen del filtro de estado.
    await expect(button('CLOSED')).toHaveAttribute('data-count', '3')

    await button('CLOSED').click()
    await expect(evidenceRows()).toHaveCount(3)
    for (const row of await evidenceRows().all()) {
      await expect(row).toHaveAttribute('data-status', 'CLOSED')
    }

    // Combinados: el texto cambia los contadores (todos los filtros menos el de estado).
    await button('ALL').click()
    await page.getByTestId('evidence-search').fill('servicio-tabla')
    await expect(button('ALL')).toHaveAttribute('data-count', '5')
    await expect(button('OPEN')).toHaveAttribute('data-count', '2')
    await expect(button('CLOSED')).toHaveAttribute('data-count', '3')
    await button('OPEN').click()
    await expect(evidenceRows()).toHaveCount(2)
    expect(await rowTitles()).toEqual(['Errores 5xx', 'Tiempo de respuesta tabla'])
  }
)

test(
  'v0.10.0: filtros de texto, tipo, entidad, tag y «solo causa raíz»; sin resultados y limpiar',
  { tag: '@problema-detalle' },
  async () => {
    await openTableProblem()
    // Texto: sin tildes ni mayúsculas.
    await page.getByTestId('evidence-search').fill('ESTADO')
    expect(await rowTitles()).toEqual(['Estado manda'])
    await page.getByTestId('evidence-search').fill('')
    await expect(evidenceRows()).toHaveCount(6)

    // Tipos: popover con opciones (menuitemcheckbox) y su cuenta.
    const types = page.getByTestId('evidence-types')
    await expect(types).toHaveAttribute('aria-haspopup', /.+/)
    await types.click()
    const option = (type: string): Locator =>
      page.locator(`[data-testid="evidence-type-option"][data-type="${type}"]`)
    await expect(option('CUSTOM_ALERT')).toHaveAttribute('role', 'menuitemcheckbox')
    await expect(option('CUSTOM_ALERT')).toContainText('3')
    await expect(option('CPU_SATURATED')).toContainText('1')
    await expect(option('METRIC')).toContainText('1')
    await option('METRIC').click()
    await expect(option('METRIC')).toHaveAttribute('aria-checked', 'true')
    await page.keyboard.press('Escape')
    expect(await rowTitles()).toEqual(['Tiempo de respuesta tabla'])
    await types.click()
    await option('CUSTOM_INFO').click()
    await page.keyboard.press('Escape')
    expect(await rowTitles()).toEqual(['Tiempo de respuesta tabla', 'Sin datos de evento'])
    await types.click()
    await option('METRIC').click()
    await option('CUSTOM_INFO').click()
    await page.keyboard.press('Escape')
    await expect(evidenceRows()).toHaveCount(6)

    // Entidad (select nativo; '' = todas).
    await page.getByTestId('evidence-entity').selectOption('HOST-T1')
    expect(await rowTitles()).toEqual(['CPU saturada'])
    await page.getByTestId('evidence-entity').selectOption('')
    await expect(evidenceRows()).toHaveCount(6)

    // Tag exacto.
    await page.getByTestId('evidence-tag').selectOption('equipo:pagos')
    expect(await rowTitles()).toEqual(['CPU saturada', 'Respuesta lenta'])
    await page.getByTestId('evidence-tag').selectOption('')

    // Solo causa raíz.
    await page.getByTestId('evidence-root-only').check()
    expect(await rowTitles()).toEqual(['CPU saturada'])
    await page.getByTestId('evidence-root-only').uncheck()
    await expect(evidenceRows()).toHaveCount(6)

    // Sin resultados: el aviso y "limpiar filtros" lo deja todo como al principio.
    await page.getByTestId('evidence-search').fill('no existe nada así')
    await page.getByTestId('evidence-entity').selectOption('HOST-T1')
    await expect(evidenceRows()).toHaveCount(0)
    await expect(page.getByTestId('evidence-empty')).toBeVisible()
    await page.getByTestId('evidence-clear-filters').click()
    await expect(evidenceRows()).toHaveCount(6)
    await expect(page.getByTestId('evidence-search')).toHaveValue('')
    await expect(page.getByTestId('evidence-entity')).toHaveValue('')
  }
)

test(
  'v0.10.0: desplegar con clic y con Enter, aria-expanded y aria-controls, Tab dentro y Escape pliega y devuelve el foco',
  { tag: '@problema-detalle' },
  async () => {
    await openTableProblem()
    const row = evidenceRow('CPU saturada')
    // Clic: despliega; el detalle es la fila siguiente, con su id en aria-controls.
    await row.click()
    await expect(row).toHaveAttribute('aria-expanded', 'true')
    const detail = await detailOf(row)
    await expect(detail).toHaveAttribute('data-testid', 'evidence-detail')
    await expect(detail).toHaveAttribute('role', 'row')
    // Propiedades siempre visibles, como texto (el HTML no se interpreta ni se ejecuta).
    const properties = detail.getByTestId('evidence-properties')
    await expect(properties).toBeVisible()
    await expect(properties).toContainText('97')
    // Ficha 0001: dt.event.description va en su sección y no en propiedades. CA6 (0043): el HTML de
    // formato (b) se interpreta; el peligroso (img con onerror) no se crea ni se ejecuta.
    await expect(properties).not.toContainText(TABLE_HTML)
    await expect(properties).not.toContainText('negrita')
    const description = detail.getByTestId('evidence-description')
    await expect(description).toContainText('negrita')
    await expect(description).not.toContainText('<b>')
    await expect(detail.locator('b')).toHaveText(['negrita'])
    await expect(detail.locator('img, script, iframe')).toHaveCount(0)
    expect(await page.evaluate(() => (window as { __xss?: unknown }).__xss ?? null)).toBeNull()
    await expect(detail.getByTestId('evidence-zones')).toContainText('Producción')
    for (const tag of ['equipo:pagos', 'zona:eu', 'critico', 'capa:infra']) {
      await expect(detail.getByTestId('evidence-all-tags')).toContainText(tag)
    }
    await expect(detail.getByTestId('evidence-more')).toHaveCount(0)
    // Clic otra vez: pliega.
    await row.click()
    await expect(row).toHaveAttribute('aria-expanded', 'false')
    await expect(page.getByTestId('evidence-detail')).toHaveCount(0)

    // Enter con el foco en la fila: despliega.
    await row.focus()
    await page.keyboard.press('Enter')
    await expect(row).toHaveAttribute('aria-expanded', 'true')
    // Tab entra en el contenido del detalle.
    await page.keyboard.press('Tab')
    const focusedInDetail = await page.evaluate(
      () => document.activeElement?.closest('[data-testid="evidence-detail"]') !== null
    )
    expect(focusedInDetail).toBe(true)
    // Escape dentro: pliega y devuelve el foco a la fila.
    await page.keyboard.press('Escape')
    await expect(row).toHaveAttribute('aria-expanded', 'false')
    await expect(row).toBeFocused()
    // Escape en la fila desplegada también pliega.
    await page.keyboard.press('Enter')
    await expect(row).toHaveAttribute('aria-expanded', 'true')
    await page.keyboard.press('Escape')
    await expect(row).toHaveAttribute('aria-expanded', 'false')
    await expect(row).toBeFocused()

    // METRIC: el detalle es la tarjeta antes → después.
    const metric = await expandRow('Tiempo de respuesta tabla')
    await expect(metric.getByTestId('evidence-change')).toContainText('100 ms → 300 ms')
    await expect(metric.getByTestId('evidence-variation')).toContainText('+200 %')
  }
)

test(
  'v0.10.0: volver al problema deja la tabla como estaba (filtros, orden y desplegadas); otro problema empieza limpio',
  { tag: '@problema-detalle' },
  async () => {
    await openTableProblem()
    await page.getByTestId('evidence-status-CLOSED').click()
    await expandRow('Respuesta lenta')
    await page.getByTestId('problem-back').click()
    await expect(page.getByTestId('problem-page')).toHaveCount(0)
    // Otro problema: sin filtros ni desplegadas.
    await goToRoute(`/problems/${BIG_ID}`)
    await expect(page.getByTestId('evidence-status-ALL')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('[data-testid="evidence-row"][aria-expanded="true"]')).toHaveCount(0)
    // De vuelta: como se dejó.
    await goToRoute(`/problems/${TABLE_ID}`)
    await expect(page.getByTestId('evidence-status-CLOSED')).toHaveAttribute('aria-pressed', 'true')
    await expect(evidenceRows()).toHaveCount(3)
    await expect(evidenceRow('Respuesta lenta')).toHaveAttribute('aria-expanded', 'true')
  }
)

test(
  'v0.9.1: evidencias: aviso de la API (retirado: chips y grupos se van en la 0.10.0)',
  { tag: '@problema-detalle' },
  async () => {
    const detail = await openEvidenceProblem()
    const section = detail.getByTestId('detail-evidence')
    // La API mandó 8 de 12: se dice.
    await expect(section.getByTestId('evidence-api-truncated')).toHaveText(
      'La API ha devuelto 8 de 12 evidencias.'
    )
    await expect(section.getByTestId('evidence-api-truncated')).toHaveAttribute('role', 'status')
    await expect(evidenceRows()).toHaveCount(8)
    // Ya no existen los grupos, los chips ni el bloque de causa raíz.
    for (const id of [
      'evidence-group',
      'evidence-filter',
      'evidence-root-cause',
      'evidence-item'
    ]) {
      await expect(section.getByTestId(id), id).toHaveCount(0)
    }
    // El resumen de causa raíz enlaza las dos rootCauseRelevant.
    await expect(page.getByTestId('root-cause-link')).toHaveCount(2)
  }
)

test(
  'v0.9.1: tarjetas de cambio (METRIC y TRANSACTIONAL), N/A y propiedades de un EVENT, en la fila desplegada',
  { tag: '@problema-detalle' },
  async () => {
    await openEvidenceProblem()
    // v0.10.0: la tarjeta y las propiedades van en el detalle de la fila desplegada.
    const item = expandRow

    // METRIC: antes → después con la unidad formateada (µs → ms y s), flecha y variación.
    const metric = await item('Tiempo de respuesta')
    const change = metric.getByTestId('evidence-change')
    await expect(change).toContainText('Tiempo de respuesta en pagos-ev:')
    await expect(change).toContainText('200 ms → 1,5 s')
    const variation = change.getByTestId('evidence-variation')
    // 200 ms → 1500 ms: ×7,5 → +650 %; la flecha es un svg y la dirección va en sr-only.
    await expect(variation).toContainText('+650 %')
    await expect(variation.locator('.sr-only')).toHaveText('sube')
    await expect(variation.locator('svg')).toHaveCount(1)
    await expect(variation).toHaveClass(/text-danger/)
    await expect(change.getByTestId('evidence-metric-id')).toHaveText(EV_METRIC)
    await expect(change.getByTestId('evidence-open-metrics')).toHaveText('Abrir en Métricas')
    // Sin fin: "Activo" en la fila.
    await expect(evidenceRow('Tiempo de respuesta').getByTestId('evidence-end')).toHaveText(
      'Activo'
    )

    // TRANSACTIONAL: antes 0 → sin cociente, con la diferencia y su unidad; sin métrica.
    const transactional = await item('Tasa de fallos')
    await expect(transactional.getByTestId('evidence-change')).toContainText('0 % → 12,5 %')
    await expect(transactional.getByTestId('evidence-variation')).toContainText('+12,5 %')
    await expect(transactional.getByTestId('evidence-variation').locator('.sr-only')).toHaveText(
      'sube'
    )
    await expect(transactional.getByTestId('evidence-metric-id')).toHaveCount(0)
    await expect(transactional.getByTestId('evidence-open-metrics')).toHaveCount(0)

    // METRIC sin valores: N/A (antes, después y variación), sin romper la tarjeta.
    const empty = await item('Uso de CPU')
    await expect(empty.getByTestId('evidence-change')).toContainText('N/A → N/A')
    await expect(empty.getByTestId('evidence-variation')).toHaveText('N/A')
    // Sin datos no hay dirección: ni flecha ni «sin cambio» para el lector de pantalla.
    await expect(empty.getByTestId('evidence-variation').locator('svg')).toHaveCount(0)
    await expect(empty.getByTestId('evidence-variation').locator('.sr-only')).toHaveCount(0)
    await expect(empty.getByTestId('evidence-metric-id')).toHaveText('builtin:host.cpu.usage')

    // EVENT con propiedades: siempre visibles en el detalle.
    await expect(evidenceRow('Reinicio del proceso')).toContainText('PROCESS_RESTART')
    const event = await item('Reinicio del proceso')
    await expect(event.getByTestId('evidence-more')).toHaveCount(0)
    const properties = event.getByTestId('evidence-properties')
    // Ficha 0001: dt.event.description sale en su sección, no en las propiedades.
    await expect(properties.locator('dt')).toHaveText(['exit.code'])
    await expect(properties.locator('dd')).toHaveText(['137'])
    // CA6 (0043): el <b> de la descripción se interpreta (formato permitido) y no se ve como texto.
    await expect(event.getByTestId('evidence-description')).toContainText('reinicio manual')
    await expect(event.getByTestId('evidence-description')).not.toContainText('<b>')
    await expect(event.locator('b')).toHaveText(['reinicio'])
    // EVENT sin propiedades: sin bloque de propiedades.
    await expect(evidenceRow('Despliegue')).toContainText('CUSTOM_DEPLOYMENT')
    await expect((await item('Despliegue')).getByTestId('evidence-properties')).toHaveCount(0)
  }
)

test(
  'v0.9.1: «Abrir en Métricas» lleva a Métricas con la métrica, el rango del problema y la consulta hecha',
  { tag: '@problema-detalle' },
  async () => {
    await openEvidenceProblem()
    const metric = await expandRow('Tiempo de respuesta')
    const before = sim.metricsQueries
    const clickedAt = Date.now()
    await metric.getByTestId('evidence-open-metrics').click()

    // Consulta hecha, con la métrica y el rango personalizado: inicio − 30 min hasta ahora
    // (el problema sigue abierto). Sin filtro por entidad.
    await expect.poll(() => sim.metricsQueries).toBe(before + 1)
    expect(sim.lastMetricsQuery.get('metricSelector')).toBe(EV_METRIC)
    expect(sim.lastMetricsQuery.get('from')).toBe(new Date(EV_START - 30 * MIN).toISOString())
    const to = Date.parse(sim.lastMetricsQuery.get('to') ?? '')
    expect(to).toBeGreaterThanOrEqual(clickedAt - 1000)
    expect(to).toBeLessThanOrEqual(Date.now())
    // En la página: el selector en el formulario y la URL limpia (sin ?selector=).
    await expect(page.getByTestId('metric-selector')).toHaveValue(EV_METRIC)
    await expect.poll(currentRoute).toBe('/metrics')
    // Volver no repite la consulta (la URL ya no la lleva).
    await page.getByTestId('module-refresh').waitFor()
    expect(sim.metricsQueries).toBe(before + 1)
  }
)

test(
  'v0.9.1: comentarios: aviso de recientes, «Ver todos (7)», contexto y HTML literal',
  { tag: '@problema-detalle' },
  async () => {
    const dialogs: string[] = []
    const onDialog = (dialog: { message: () => string; dismiss: () => Promise<void> }): void => {
      dialogs.push(dialog.message())
      void dialog.dismiss()
    }
    page.on('dialog', onDialog)
    try {
      const detail = await openEvidenceProblem()
      const section = detail.getByTestId('detail-comments')
      const comments = section.getByTestId('problem-comment')
      await expect(comments).toHaveCount(2)
      await expect(section.getByTestId('comments-api-truncated')).toHaveText(
        'Se ven los 2 más recientes de 7 comentarios.'
      )
      const showAll = section.getByTestId('comments-show-all')
      await expect(showAll).toHaveText('Ver todos (7)')
      // No se piden hasta pulsar.
      expect(sim.commentsRequests).toBe(0)
      // El contexto, como etiqueta; sin autor → N/A.
      await expect(comments.nth(0).getByTestId('comment-context')).toHaveText(
        'dynatrace-problem-ui'
      )
      await expect(comments.nth(1).getByTestId('comment-context')).toHaveCount(0)
      await expect(comments.nth(1)).toContainText('N/A')

      await showAll.click()
      await expect(comments).toHaveCount(7)
      expect(sim.commentsRequests).toBe(1)
      expect(Object.fromEntries(sim.lastCommentsQuery)).toEqual({ pageSize: '500' })
      await expect(section.getByTestId('comments-api-truncated')).toHaveCount(0)
      await expect(showAll).toHaveCount(0)
      await expect(section.getByTestId('comments-all-truncated')).toHaveCount(0)
      await expect(section.getByTestId('comment-context')).toHaveText([
        'dynatrace-problem-ui',
        'api'
      ])
      await expect(section).toContainText('Primer comentario')
      // El que viene sin contenido no rompe nada.
      await expect(comments.nth(3)).toContainText('luis')

      // HTML literal: el texto tal cual, sin elementos ni ejecución.
      await expect(section).toContainText('<script>window.__xss = "script"</script>')
      await expect(section.locator('script, img')).toHaveCount(0)
      await page.waitForTimeout(300)
      expect(await page.evaluate(() => (window as { __xss?: unknown }).__xss ?? null)).toBeNull()
      expect(dialogs).toEqual([])
    } finally {
      page.off('dialog', onDialog)
    }
  }
)

test(
  'v0.9.1: XLSX de evidencias variadas: números, "Activa", causa raíz y avisos de la API en Info',
  { tag: '@problema-detalle' },
  async () => {
    await openEvidenceProblem()
    const book = new ExcelJS.Workbook()
    await book.xlsx.load(
      readFileSync(await exportSaved('problem-page', 'export-xlsx')) as unknown as ArrayBuffer
    )
    expect(book.worksheets.map((s) => s.name)).toEqual([
      'Resumen',
      'Entidades',
      'Evidencias',
      'Comentarios',
      'Info'
    ])
    const evidence = book.getWorksheet('Evidencias')
    // v0.10.0: las columnas se buscan por su cabecera.
    const headers = ((evidence?.getRow(1).values as unknown[] | undefined) ?? []).map(String)
    const col = (name: string): number => headers.indexOf(name)
    const rows = new Map<string, ExcelJS.Row>()
    evidence?.eachRow((row, n) => {
      if (n > 1) rows.set(String(row.getCell(col('Evento')).value), row)
    })
    expect(rows.size).toBe(8)
    const metric = rows.get('Tiempo de respuesta')
    // Antes y después como números, sin formatear ni escalar; la unidad aparte.
    expect(metric?.getCell(col('Antes')).value).toBe(200_000)
    expect(metric?.getCell(col('Después')).value).toBe(1_500_000)
    expect(metric?.getCell(col('Unidad')).value).toBe('MicroSecond')
    expect(metric?.getCell(col('Métrica')).value).toBe(EV_METRIC)
    expect(metric?.getCell(col('Fin')).value).toBe('Activo')
    expect(metric?.getCell(col('Causa raíz')).value).toBe('No')
    const root = rows.get('Reinicio del proceso')
    expect(root?.getCell(col('Causa raíz')).value).toBe('Sí')
    expect(root?.getCell(col('Inicio')).value).toBeInstanceOf(Date)
    expect(root?.getCell(col('Fin')).value).toBeInstanceOf(Date)
    expect(root?.getCell(col('Duración (min)')).value).toBe(60)
    expect(root?.getCell(col('Tipo')).value).toBe('PROCESS_RESTART')
    // Sin entidad: celda vacía. Tipo desconocido, tal cual.
    expect(rows.get('Ventana de mantenimiento')?.getCell(col('Entidad')).value ?? null).toBeNull()
    expect(rows.get('Algo nuevo')?.getCell(col('Tipo')).value).toBe('TIPO_NUEVO_E2E')
    // Comentarios: los 2 recientes del detalle.
    expect(book.getWorksheet('Comentarios')?.actualRowCount).toBe(3)
    // Info: los dos recortes de la API.
    const info: string[] = []
    book.getWorksheet('Info')?.eachRow((row) => {
      info.push(row.values ? (row.values as unknown[]).map(String).join('|') : '')
    })
    expect(info.join('\n')).toContain('La API ha devuelto 8 de 12 evidencias.')
    expect(info.join('\n')).toContain('La API ha devuelto 2 de 7 comentarios.')
  }
)

/** v0.9.2: consultas de un mini gráfico al simulador, por selector. */
const eventQueries = (selector: string): URLSearchParams[] =>
  sim.eventMetricQueries.filter((query) => query.get('metricSelector') === selector)

/**
 * v0.9.2: el mini gráfico de la evidencia con ese nombre. Desde la 0.10.0 vive en el
 * detalle de su fila: hay que desplegarla antes (openChart).
 */
function metricChart(name: string): Locator {
  return page
    .locator(`[data-testid="evidence-detail"][data-id="${chartEventId(name)}"]`)
    .getByTestId('evidence-metric-chart')
}

/** v0.10.0: despliega la fila de ese evento y devuelve su mini gráfico. */
async function openChart(name: string): Promise<Locator> {
  await expandRow(name)
  return metricChart(name)
}

test(
  'v0.9.2: mini gráfico de un EVENT con selector: una consulta, rango y resolución; la serie de la entidad primero',
  { tag: '@problema-detalle' },
  async () => {
    const mountedAt = Date.now()
    await goToRoute(`/problems/${CHART_ID}`)
    await expect(page.getByTestId('problem-page-title')).toContainText('P-780')
    // Plegada, la fila no pide nada.
    await expect(evidenceRows().first()).toBeVisible()
    await page.waitForTimeout(300)
    expect(eventQueries(SEL_OK)).toHaveLength(0)
    const chart = await openChart('Respuesta lenta')
    await chart.scrollIntoViewIfNeeded()
    const drawn = chart.getByTestId('evidence-metric')
    await expect(drawn).toBeVisible()
    await expect(drawn.locator('canvas').first()).toBeVisible()
    // Dos series; la de la entidad de la evidencia (SERVICE-MC1) va la primera.
    const series = JSON.parse((await drawn.getAttribute('data-series')) ?? '[]') as string[]
    expect(series).toHaveLength(2)
    expect(series[0]).toContain(CHART_ENTITY)
    expect(series[1]).toContain('SERVICE-OTRO')
    await expect(chart.getByTestId('evidence-metric-truncated')).toHaveCount(0)

    // Una sola consulta, con el selector tal cual, el rango personalizado y la resolución.
    const queries = eventQueries(SEL_OK)
    expect(queries).toHaveLength(1)
    const query = queries[0] as URLSearchParams
    const from = Date.parse(query.get('from') ?? '')
    const to = Date.parse(query.get('to') ?? '')
    const start = NOW - 90 * 60_000
    // Activa: hasta "ahora" (el del montaje) y antes del inicio tanto como lleva (~90 min).
    expect(to).toBeGreaterThanOrEqual(mountedAt - 1000)
    expect(to).toBeLessThanOrEqual(Date.now())
    expect(start - from).toBe(to - start)
    // ~3 h → 1m (unos 180 puntos).
    expect(query.get('resolution')).toBe('1m')
    // Sin entitySelector ni nada que no sea la consulta.
    expect([...query.keys()].sort()).toEqual(['from', 'metricSelector', 'resolution', 'to'])
  }
)

test(
  'v0.9.2: estados del mini gráfico: 400, 403, sin datos, 25 series y selector demasiado largo; la página sigue',
  { tag: '@problema-detalle' },
  async () => {
    await goToRoute(`/problems/${CHART_ID}`)
    await expect(page.getByTestId('problem-page-title')).toContainText('P-780')
    const state = (name: string): Locator => metricChart(name).getByTestId('evidence-metric-state')

    for (const [name, expected, text] of [
      ['Selector no compatible', 'incompatible', es.problems.metricState.incompatible],
      ['Sin permiso', 'forbidden', es.problems.metricState.forbidden],
      ['Sin datos', 'noData', es.problems.metricState.noData]
    ] as const) {
      await openChart(name)
      await metricChart(name).scrollIntoViewIfNeeded()
      await expect(state(name), name).toHaveAttribute('data-state', expected)
      await expect(state(name), name).toHaveText(text)
      // Ni gráfico ni exportación, pero sí "Abrir en Métricas".
      await expect(metricChart(name).getByTestId('evidence-metric')).toHaveCount(0)
      await expect(metricChart(name).getByTestId('export-menu')).toHaveCount(0)
      await expect(metricChart(name).getByTestId('evidence-metric-open')).toBeVisible()
    }
    expect(es.problems.metricState.noData).toBe('Sin datos en el periodo.')

    // 25 series: se dibujan 10, la de la entidad (SERVICE-MC20) la primera, y se avisa.
    const many = await openChart('Muchas series')
    await many.scrollIntoViewIfNeeded()
    await expect(many.getByTestId('evidence-metric-truncated')).toHaveText(
      'Mostrando 10 de 25 series.'
    )
    const series = JSON.parse(
      (await many.getByTestId('evidence-metric').getAttribute('data-series')) ?? '[]'
    ) as string[]
    expect(series).toHaveLength(10)
    expect(series[0]).toContain('SERVICE-MC20')

    // Selector de más de 2000: el texto, sin gráfico ni consulta.
    const long = await expandRow('Selector largo')
    await expect(long.getByTestId('evidence-metric-too-long')).toHaveText(
      'Selector demasiado largo para mostrarlo.'
    )
    await expect(long.getByTestId('evidence-metric-chart')).toHaveCount(0)
    expect(
      sim.eventMetricQueries.some((q) => (q.get('metricSelector') ?? '').includes('xxxx'))
    ).toBe(false)
    // Un EVENT sin selector: ni gráfico ni aviso.
    const none = await expandRow('Sin selector')
    await expect(none.getByTestId('evidence-metric-chart')).toHaveCount(0)
    await expect(none.getByTestId('evidence-metric-too-long')).toHaveCount(0)

    // La página sigue: título, el resto de las evidencias y volver.
    await expect(page.getByTestId('problem-page-title')).toContainText('P-780')
    await expect(evidenceRows()).toHaveCount(7)
    await page.getByTestId('problem-back').click()
    await expect(page.getByTestId('problem-page')).toHaveCount(0)
  }
)

test(
  'v0.9.2: carga diferida y cola: una fila plegada no pide; al desplegar 20 deprisa, nunca más de 3 consultas a la vez',
  { tag: '@problema-detalle' },
  async () => {
    sim.eventMetricDelayMs = 400
    await goToRoute(`/problems/${LAZY_ID}`)
    await expect(page.getByTestId('problem-page-title')).toContainText('P-781')
    // v0.10.0: plegadas por defecto, ningún gráfico ni consulta.
    await expect(evidenceRows()).toHaveCount(20)
    const charts = page.getByTestId('evidence-metric-chart')
    await expect(charts).toHaveCount(0)
    await page.waitForTimeout(600)
    expect(sim.eventMetricQueries).toHaveLength(0)

    // Se despliegan las 20 seguidas: cada una se pide al verse, y la cola nunca deja más de 3.
    for (const row of await evidenceRows().all()) {
      await row.scrollIntoViewIfNeeded()
      await row.click()
    }
    await expect(charts).toHaveCount(20)
    for (const chart of await charts.all()) await chart.scrollIntoViewIfNeeded()
    await expect.poll(() => sim.eventMetricQueries.length, { timeout: 15_000 }).toBe(20)
    expect(eventQueries(SEL_LAZY(20))).toHaveLength(1)
    expect(sim.eventMetricMaxInFlight).toBeLessThanOrEqual(3)
    // Y la cola sí se usa en paralelo (no de uno en uno).
    expect(sim.eventMetricMaxInFlight).toBe(3)
    await expect(page.getByTestId('evidence-metric')).toHaveCount(20, { timeout: 15_000 })
  }
)

test(
  'v0.9.2: «Actualizar» vuelve a pedir los gráficos de un problema abierto, y no los de uno cerrado',
  { tag: '@problema-detalle' },
  async () => {
    await goToRoute(`/problems/${CHART_ID}`)
    const chart = await openChart('Respuesta lenta')
    await expect(chart.getByTestId('evidence-metric')).toBeVisible()
    expect(eventQueries(SEL_OK)).toHaveLength(1)
    await page.getByTestId('module-refresh').click()
    await expect.poll(() => eventQueries(SEL_OK).length).toBe(2)
    await expect(chart.getByTestId('evidence-metric')).toBeVisible()

    // Cerrado: Actualizar repite el detalle, pero no los gráficos.
    await goToRoute(`/problems/${LAZY_ID}`)
    await expect(page.getByTestId('problem-page-title')).toContainText('P-781')
    await expect((await openChart('Gráfico 1')).getByTestId('evidence-metric')).toBeVisible()
    const before = sim.eventMetricQueries.length
    const detailBefore = sim.lastDetailQuery
    await page.getByTestId('module-refresh').click()
    // El detalle sí se ha vuelto a pedir.
    await expect.poll(() => sim.lastDetailQuery !== detailBefore).toBe(true)
    // Aserción negativa: un margen para que una consulta, si la hubiera, saliera.
    await page.waitForTimeout(800)
    expect(sim.eventMetricQueries.length).toBe(before)
  }
)

test(
  'v0.9.2: volver a un problema cerrado no repite las consultas de sus gráficos',
  { tag: '@problema-detalle' },
  async () => {
    await goToRoute(`/problems/${LAZY_ID}`)
    await expect((await openChart('Gráfico 1')).getByTestId('evidence-metric')).toBeVisible()
    const first = eventQueries(SEL_LAZY(1)).length
    expect(first).toBe(1)
    await page.getByTestId('problem-back').click()
    await expect(page.getByTestId('problem-page')).toHaveCount(0)
    await goToRoute(`/problems/${LAZY_ID}`)
    // v0.10.0: la fila sigue desplegada (el estado de la tabla se conserva).
    await expect(evidenceRow('Gráfico 1')).toHaveAttribute('aria-expanded', 'true')
    await expect(metricChart('Gráfico 1').getByTestId('evidence-metric')).toBeVisible()
    await page.waitForTimeout(500)
    expect(eventQueries(SEL_LAZY(1))).toHaveLength(1)
  }
)

test(
  'v0.9.2: volver a un problema ABIERTO (lista y vuelta) no pide ningún gráfico; Actualizar pide solo la evidencia activa',
  { tag: '@problema-detalle' },
  async () => {
    await goToRoute(`/problems/${MIXED_ID}`)
    await expect(page.getByTestId('problem-page-title')).toContainText('P-782')
    const done = await openChart('Evidencia terminada')
    const active = await openChart('Evidencia activa')
    await expect(done.getByTestId('evidence-metric')).toBeVisible()
    await expect(active.getByTestId('evidence-metric')).toBeVisible()
    expect(eventQueries(SEL_DONE)).toHaveLength(1)
    expect(eventQueries(SEL_ACTIVE)).toHaveLength(1)
    const activeFirst = eventQueries(SEL_ACTIVE)[0] as URLSearchParams
    const doneFirst = eventQueries(SEL_DONE)[0] as URLSearchParams

    // A la lista y de vuelta, pasado un rato: el «ahora» del problema se conserva → caché.
    await page.getByTestId('problem-back').click()
    await expect(page.getByTestId('problem-page')).toHaveCount(0)
    expect(await currentRoute()).toBe('/problems')
    await page.waitForTimeout(1100)
    await goToRoute(`/problems/${MIXED_ID}`)
    await expect(done.getByTestId('evidence-metric')).toBeVisible()
    await expect(active.getByTestId('evidence-metric')).toBeVisible()
    // Aserción negativa: un margen para que una consulta, si la hubiera, saliera.
    await page.waitForTimeout(800)
    expect(eventQueries(SEL_DONE)).toHaveLength(1)
    expect(eventQueries(SEL_ACTIVE)).toHaveLength(1)

    // Actualizar: el problema está abierto → solo la activa (su «to» es ahora) se pide otra vez.
    await page.getByTestId('module-refresh').click()
    await expect.poll(() => eventQueries(SEL_ACTIVE).length).toBe(2)
    await page.waitForTimeout(800)
    expect(eventQueries(SEL_DONE)).toHaveLength(1)
    const activeSecond = eventQueries(SEL_ACTIVE)[1] as URLSearchParams
    // El rango de la activa avanza (el nuevo «ahora»); el de la terminada no ha cambiado.
    expect(Date.parse(activeSecond.get('to') ?? '')).toBeGreaterThan(
      Date.parse(activeFirst.get('to') ?? '')
    )
    expect(doneFirst.get('to')).toBe(new Date(NOW - 2 * HOUR + 15 * 60_000).toISOString())
    await expect(active.getByTestId('evidence-metric')).toBeVisible()
    await expect(done.getByTestId('evidence-metric')).toBeVisible()

    // Y volver otra vez tras Actualizar tampoco pide nada (el reloj nuevo se guarda).
    await page.getByTestId('problem-back').click()
    await goToRoute(`/problems/${MIXED_ID}`)
    await expect(active.getByTestId('evidence-metric')).toBeVisible()
    await page.waitForTimeout(800)
    expect(eventQueries(SEL_ACTIVE)).toHaveLength(2)
    expect(eventQueries(SEL_DONE)).toHaveLength(1)
  }
)

test(
  'v0.9.2: «Abrir en Métricas» del gráfico abre Métricas con ese selector y el rango del gráfico',
  { tag: '@problema-detalle' },
  async () => {
    await goToRoute(`/problems/${CHART_ID}`)
    const chart = await openChart('Respuesta lenta')
    await expect(chart.getByTestId('evidence-metric')).toBeVisible()
    const chartQuery = eventQueries(SEL_OK)[0] as URLSearchParams
    const before = sim.metricsQueries
    await chart.getByTestId('evidence-metric-open').click()

    await expect.poll(() => sim.metricsQueries).toBeGreaterThan(before)
    await expect.poll(currentRoute).toBe('/metrics')
    await expect(page.getByTestId('metric-selector')).toHaveValue(SEL_OK)
    // El mismo rango que el gráfico (la vista Métricas la pide como cualquier consulta).
    const metricsQuery = sim.eventMetricQueries.at(-1) as URLSearchParams
    expect(metricsQuery.get('metricSelector')).toBe(SEL_OK)
    expect(Date.parse(metricsQuery.get('from') ?? '')).toBe(
      Date.parse(chartQuery.get('from') ?? '')
    )
    expect(Date.parse(metricsQuery.get('to') ?? '')).toBe(Date.parse(chartQuery.get('to') ?? ''))
  }
)

test(
  'v0.9.2: exportar las series del mini gráfico (CSV con hora, serie y valor) y capturarlo',
  { tag: '@problema-detalle' },
  async () => {
    await goToRoute(`/problems/${CHART_ID}`)
    const chart = await openChart('Respuesta lenta')
    await expect(chart.getByTestId('evidence-metric')).toBeVisible()
    const menu = chart.locator('[data-testid="export-menu"][data-export-target="evidence-metric"]')
    await expect(menu).toBeVisible()

    // Ficha 0030: tras el aviso «Guardado» y con contenido.
    const save = (option: string): Promise<string> => exportSaved(menu, option)

    const csv = readFileSync(await save('export-csv'))
      .subarray(3)
      .toString('utf8')
    const lines = csv.split(/\r?\n/).filter((line) => line.trim() !== '')
    const headerIndex = lines.findIndex((line) => line.includes('Serie'))
    expect(headerIndex).toBeGreaterThanOrEqual(0)
    const header = (lines[headerIndex] ?? '').split(';')
    expect(header).toHaveLength(3)
    expect(header[1]).toBe('Serie')
    // 2 series × 5 puntos; la de la entidad primero.
    const rows = lines.slice(headerIndex + 1).filter((line) => line.split(';').length === 3)
    expect(rows).toHaveLength(10)
    expect(rows[0]).toContain(CHART_ENTITY)
    expect(rows[0]).toMatch(/;400$/)
    expect(rows.at(-1)).toContain('SERVICE-OTRO')

    // XLSX: Info lleva la consulta (el selector) como contexto, y los valores son números.
    const book = new ExcelJS.Workbook()
    await book.xlsx.load(readFileSync(await save('export-xlsx')) as unknown as ArrayBuffer)
    const info: string[] = []
    book.getWorksheet('Info')?.eachRow((row) => {
      info.push(((row.values as unknown[] | undefined) ?? []).map(String).join('|'))
    })
    expect(info.join('\n')).toContain(SEL_OK)
    const data = book.worksheets[0]
    expect(data?.getRow(2).getCell(1).value).toBeInstanceOf(Date)
    expect(data?.getRow(2).getCell(3).value).toBe(400)

    const png = await pngInfo(await save('capture-save'))
    expect(png.width).toBeGreaterThan(0)
    expect(png.cornerAlpha).toBe(255)
  }
)

test(
  'v0.10.2: evidencia de 45 días: últimos 7 por defecto, etiquetas de fecha variadas (no «00:00»), nota y sin línea de inicio',
  { tag: '@problema-detalle' },
  async () => {
    await goToRoute(`/problems/${LONG_ID}`)
    await expect(page.getByTestId('problem-page-title')).toContainText('P-784')
    const container = await openChart('Evento largo')
    const drawn = container.getByTestId('evidence-metric')
    await expect(drawn.locator('canvas').first()).toBeVisible()

    // Ventana de 7 días por defecto, con su selector y la nota de recorte.
    const window7 = container.getByTestId('evidence-metric-window-7d')
    await expect(container.getByTestId('evidence-metric-window')).toHaveAttribute('role', 'group')
    await expect(window7).toHaveAttribute('aria-pressed', 'true')
    await expect(container.getByTestId('evidence-metric-window-all')).toHaveAttribute(
      'aria-pressed',
      'false'
    )
    const note = container.getByTestId('evidence-metric-window-note')
    await expect(note).toContainText('7 días')
    await expect(note).toContainText(String(LONG_DAYS))

    // La consulta: 7 días hasta ahora.
    const first = eventQueries(SEL_LONG).at(-1) as URLSearchParams
    const span = Date.parse(first.get('to') ?? '') - Date.parse(first.get('from') ?? '')
    expect(span).toBe(7 * DAY_MS)

    // El eje: varias etiquetas, distintas, alguna con la fecha del idioma, y nunca todas «00:00».
    const axis = await axisOf(drawn)
    expect(axis.to - axis.from).toBe(7 * DAY_MS)
    expect(axis.labels.length).toBeGreaterThan(2)
    expect(new Set(axis.labels).size).toBeGreaterThan(1)
    expect(axis.labels.every((label) => label === '00:00')).toBe(false)
    // Regresión: sin el arreglo salían 17 «00:00» (y solo los extremos con otra hora), así que
    // «no todas iguales» no basta: ninguna «00:00» y alguna fecha.
    expect(axis.labels.filter((label) => label === '00:00')).toHaveLength(0)
    expect(axis.labels.some((label) => ES_DAY.test(label))).toBe(true)
    // El inicio del problema (hace 45 días) queda fuera: sin línea vertical de inicio.
    expect(axis.markLines).toBe(0)

    // Tooltip con fecha y hora completas.
    const box = await drawn.locator('canvas').first().boundingBox()
    await page.mouse.move(
      (box?.x ?? 0) + (box?.width ?? 0) * 0.6,
      (box?.y ?? 0) + (box?.height ?? 0) / 2,
      {
        steps: 10
      }
    )
    const tooltip = page.locator('.vigia-chart-tooltip').filter({ visible: true }).first()
    await expect(tooltip).toContainText(/\d\d\/\d\d\/\d{4} \d\d:\d\d/)
    await moveToNeutral(page)

    // «Todo»: otra consulta con el rango completo (más de 45 días), sin nota y con la línea.
    const before = eventQueries(SEL_LONG).length
    await container.getByTestId('evidence-metric-window-all').click()
    await expect.poll(() => eventQueries(SEL_LONG).length).toBe(before + 1)
    const all = eventQueries(SEL_LONG).at(-1) as URLSearchParams
    expect(Date.parse(all.get('to') ?? '') - Date.parse(all.get('from') ?? '')).toBeGreaterThan(
      LONG_DAYS * DAY_MS
    )
    await expect(container.getByTestId('evidence-metric-window-note')).toHaveCount(0)
    // El gráfico se repinta con el rango nuevo.
    await expect(drawn).toHaveAttribute(
      'data-range-from',
      String(Date.parse(all.get('from') ?? ''))
    )
    const wide = await axisOf(drawn)
    expect(wide.to - wide.from).toBeGreaterThan(LONG_DAYS * DAY_MS)
    // Con resolución diaria (la devuelta), solo fechas: ninguna hora.
    expect(wide.labels.every((label) => ES_DAY.test(label) || /^\d{4}$/.test(label))).toBe(true)
    expect(new Set(wide.labels).size).toBeGreaterThan(1)
    expect(wide.markLines).toBe(1)

    // 30 días: el rango cambia y vuelve la nota.
    await container.getByTestId('evidence-metric-window-30d').click()
    await expect(container.getByTestId('evidence-metric-window-note')).toContainText('30 días')
    await expect
      .poll(async () => {
        const current = await axisOf(drawn)
        return current.to - current.from
      })
      .toBe(30 * DAY_MS)
    // El inicio (hace 45 días) vuelve a quedar fuera: sin línea de inicio.
    expect((await axisOf(drawn)).markLines).toBe(0)
  }
)

test(
  'v0.10.2: «Abrir en Métricas» y la exportación del mini gráfico usan el rango visible (7 días)',
  { tag: '@problema-detalle' },
  async () => {
    await goToRoute(`/problems/${LONG_ID}`)
    const container = await openChart('Evento largo')
    const drawn = container.getByTestId('evidence-metric')
    const axis = await axisOf(drawn)
    expect(axis.to - axis.from).toBe(7 * DAY_MS)

    // Exportación: Info dice el rango visible y la duración de la evidencia.
    const menu = container.locator(
      '[data-testid="export-menu"][data-export-target="evidence-metric"]'
    )
    const book = new ExcelJS.Workbook()
    await book.xlsx.load(
      readFileSync(await exportSaved(menu, 'export-xlsx')) as unknown as ArrayBuffer
    )
    const info: string[] = []
    book.getWorksheet('Info')?.eachRow((row) => {
      info.push(((row.values as unknown[] | undefined) ?? []).map(String).join('|'))
    })
    const infoText = info.join('\n')
    expect(infoText).toContain('Rango visible')
    expect(infoText).toContain(`${LONG_DAYS} días`)
    // Los puntos exportados, dentro del rango visible.
    const data = book.worksheets[0]
    const times: number[] = []
    // Las fechas del XLSX van en hora local (ficha 0063): ExcelJS devuelve la hora de pared como si
    // fuera UTC, y se pasa a instante con la zona del renderer, la del equipo (el CI va en UTC y la
    // VPS en Europe/Madrid). Se pierden los segundos: cabe en el margen de un minuto de abajo.
    const zone = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)
    data?.eachRow((row, n) => {
      const value = row.getCell(1).value
      if (n > 1 && value instanceof Date) {
        times.push(wallTimeToEpoch(value.toISOString().slice(0, 16), zone))
      }
    })
    expect(times.length).toBeGreaterThan(0)
    expect(Math.min(...times)).toBeGreaterThanOrEqual(axis.from - 60_000)
    expect(Math.max(...times)).toBeLessThanOrEqual(axis.to + 60_000)

    // Abrir en Métricas: el mismo rango visible.
    await container.getByTestId('evidence-metric-open').click()
    await expect.poll(currentRoute).toBe('/metrics')
    await expect(page.getByTestId('metric-selector')).toHaveValue(SEL_LONG)
    const metricsQuery = sim.eventMetricQueries.at(-1) as URLSearchParams
    expect(Date.parse(metricsQuery.get('from') ?? '')).toBe(axis.from)
    expect(Date.parse(metricsQuery.get('to') ?? '')).toBe(axis.to)
  }
)

/** Ficha 0002: textos del conmutador que ya no existe (es y en), para comprobar que no está. */
const MODE_LABELS = [
  'Con formato',
  'Texto original',
  'Cómo se ve la descripción',
  'Formatted',
  'Original text',
  'How the description is shown'
]

test(
  'CA6 (0001): al desplegar un evento con descripción, «Descripción» sale la primera y renderizada',
  { tag: '@problema-detalle' },
  async () => {
    await openDescriptionProblem()
    const detail = await expandRow('Descripción con formato')
    const { section } = descriptionParts(detail)
    await expect(section).toBeVisible()
    await expect(section).toContainText('Descripción')

    // La primera sección del detalle del evento.
    const order = await detail.evaluate((root) =>
      [...root.querySelectorAll('[data-testid]')]
        .map((element) => element.getAttribute('data-testid') ?? '')
        .filter((id) =>
          [
            'evidence-description',
            'evidence-properties',
            'evidence-zones',
            'evidence-all-tags',
            'evidence-metric-chart',
            'evidence-metric-too-long',
            'evidence-change'
          ].includes(id)
        )
    )
    expect(order[0]).toBe('evidence-description')
    expect(order).toContain('evidence-properties')

    // Los elementos renderizados, no los símbolos.
    await expect(section.locator('p[role="heading"]')).toHaveText(['Uso de CPU alto'])
    await expect(section.locator('li')).toHaveText(['primer paso', 'segundo paso'])
    await expect(section.locator('strong')).toHaveText(['negrita'])
    await expect(section.locator('code')).toHaveText(['código'])
    await expect(section.locator('table')).toHaveCount(2)
    await expect(section.locator('table').nth(0).locator('th')).toHaveText(['Métrica', 'Valor'])
    await expect(section.locator('table').nth(0).locator('td')).toHaveText(['CPU', '97 %'])
    // Tabla compacta con alineación, y escapes que se ven sin la barra invertida.
    const compact = section.locator('table').nth(1)
    await expect(compact.locator('th')).toHaveText(['Host', 'Valor', 'Estado'])
    await expect(compact.locator('td')).toHaveText(['web', '9', 'alto (9)'])
    await expect(section).toContainText('Umbral superado en 9.5 puntos')
    const text = await section.innerText()
    expect(text).not.toContain('\\')
    expect(text).not.toContain('|:--|')
    expect(text).not.toContain('**')
    expect(text).not.toContain('`')
    expect(text).not.toMatch(/^\s*#/m)
    expect(text).not.toMatch(/^\s*- /m)
    expect(text).not.toContain('| --- |')

    // CA2 visto en la interfaz: la descripción iba después de la octava propiedad y ya no se
    // repite en la lista de propiedades.
    const keys = await detail.getByTestId('evidence-properties').locator('dt').allInnerTexts()
    expect(keys).not.toContain('dt.event.description')
    expect(keys).toContain('paso.0')
  }
)

test(
  'CA10 (0001), actualizado por CA6 (0043): el HTML peligroso de la descripción no crea img, script ni iframe ni se ejecuta',
  { tag: '@problema-detalle' },
  async () => {
    await openDescriptionProblem()
    const detail = await expandRow('Descripción con HTML')
    const { section } = descriptionParts(detail)
    // El texto de alrededor se sigue viendo; el HTML peligroso no se crea (ni como elemento ni
    // ejecutándose). Desde la 0043 no se exige verlo como texto.
    await expect(section).toContainText('Texto')
    await expect(section).toContainText('fin')
    await expect(section.locator('p[role="heading"]')).toHaveText(['Aviso'])
    await expect(detail.locator('img, script, iframe')).toHaveCount(0)
    expect(
      await page.evaluate(() => (window as { __xssDesc?: unknown }).__xssDesc ?? null)
    ).toBeNull()
  }
)

test(
  'CA13 (0001): una descripción recortada lleva la nota de recorte; una entera, no',
  { tag: '@problema-detalle' },
  async () => {
    await openDescriptionProblem()
    const long = descriptionParts(await expandRow('Descripción recortada'))
    await expect(long.section).toContainText('Descripción larga')
    await expect(long.truncated).toBeVisible()
    await expect(long.truncated).not.toHaveText('')

    const whole = descriptionParts(await expandRow('Descripción con formato'))
    await expect(whole.section).toBeVisible()
    await expect(whole.truncated).toHaveCount(0)
  }
)

test(
  'CA14 (0001): un evento sin descripción no tiene la sección y el resto del detalle sigue igual',
  { tag: '@problema-detalle' },
  async () => {
    await openDescriptionProblem()
    const detail = await expandRow('Sin descripción')
    await expect(detail.getByTestId('evidence-description')).toHaveCount(0)
    await expect(detail.getByTestId('evidence-description-truncated')).toHaveCount(0)
    const properties = detail.getByTestId('evidence-properties')
    await expect(properties).toContainText('exit.code')
    await expect(properties).toContainText('137')
    await expect(detail.getByTestId('evidence-zones')).toContainText('Zona descripción')
    await expect(detail.getByTestId('evidence-all-tags')).toContainText('equipo:pagos')
    // El mini gráfico de su selector se pide y se pinta.
    await expect(detail.getByTestId('evidence-metric-chart')).toBeVisible()
    await expect(detail.getByTestId('evidence-metric').locator('canvas').first()).toBeVisible()
    await expect
      .poll(() => sim.eventMetricQueries.some((q) => q.get('metricSelector') === SEL_DESC))
      .toBe(true)
  }
)

test(
  'CA1 (0002): sin conmutador de modo; la descripción sale siempre renderizada',
  { tag: '@problema-detalle' },
  async () => {
    await openDescriptionProblem()
    for (const name of ['Descripción con formato', 'Otra con descripción']) {
      const detail = await expandRow(name)
      const { section } = descriptionParts(detail)
      await expect(section).toBeVisible()
      // Ningún control de modo: ni sus data-testid, ni un grupo o botón con sus textos.
      await expect(detail.locator('[data-testid^="evidence-description-mode"]')).toHaveCount(0)
      await expect(section.locator('[aria-pressed]')).toHaveCount(0)
      for (const label of MODE_LABELS) {
        await expect(section.getByRole('group', { name: label })).toHaveCount(0)
        await expect(section.getByRole('radiogroup', { name: label })).toHaveCount(0)
        await expect(section.getByRole('button', { name: label })).toHaveCount(0)
        await expect(section.getByRole('radio', { name: label })).toHaveCount(0)
        await expect(section.getByRole('tab', { name: label })).toHaveCount(0)
        await expect(section).not.toContainText(label)
      }
      // Solo queda «Copiar» como control de la sección.
      await expect(section.getByRole('button')).toHaveCount(1)
      await expect(section.getByRole('button')).toHaveText('Copiar')
    }

    // Renderizada: los elementos, no los símbolos de Markdown.
    const { section } = descriptionParts(await expandRow('Descripción con formato'))
    await expect(section.locator('p[role="heading"]')).toHaveText(['Uso de CPU alto'])
    await expect(section.locator('li')).toHaveText(['primer paso', 'segundo paso'])
    await expect(section.locator('strong')).toHaveText(['negrita'])
    await expect(section.locator('code')).toHaveText(['código'])
    await expect(section.locator('table')).toHaveCount(2)
    const text = await section.innerText()
    expect(text).not.toContain('**')
    expect(text).not.toContain('`')
    expect(text).not.toMatch(/^\s*#/m)
    expect(text).not.toMatch(/^\s*- /m)
    expect(text).not.toContain('| --- |')
  }
)

/** Ficha 0035: el texto de la sección no lleva los símbolos de Markdown. */
async function expectRenderedText(section: Locator): Promise<void> {
  const text = await section.innerText()
  expect(text).not.toContain('**')
  expect(text).not.toContain('`')
  expect(text).not.toMatch(/^\s*#/m)
  expect(text).not.toMatch(/^\s*- /m)
}

test(
  'CA4 (0035): una evidencia METRIC con descripción enseña «Descripción» renderizada al desplegarla',
  { tag: '@problema-detalle' },
  async () => {
    await openAllDescriptionsProblem()
    const detail = await expandRow(ALL_METRIC)
    const { section, copy, truncated } = descriptionParts(detail)
    await expect(section).toBeVisible()
    await expect(section).toContainText('Descripción')
    await expect(section.locator('p[role="heading"]')).toHaveText(['Cambio en la métrica'])
    await expect(section.locator('li')).toHaveText(['subida brusca', 'revisar pool'])
    await expect(section.locator('strong')).toHaveText(['subida'])
    await expect(section.locator('code')).toHaveText(['pool'])
    await expect(section.locator('blockquote')).toHaveText('Avisado por el equipo')
    await expectRenderedText(section)
    // Con su «Copiar» y sin nota de recorte (es corta).
    await expect(copy).toBeVisible()
    await expect(truncated).toHaveCount(0)
    // La clave no se repite como propiedad genérica.
    const keys = await detail.locator('[data-testid="evidence-properties"] dt').allInnerTexts()
    expect(keys).not.toContain('dt.event.description')
  }
)

test(
  'CA4 (0035): una evidencia AVAILABILITY_EVIDENCE con descripción también la enseña renderizada',
  { tag: '@problema-detalle' },
  async () => {
    await openAllDescriptionsProblem()
    const { section } = descriptionParts(await expandRow(ALL_AVAILABILITY))
    await expect(section).toBeVisible()
    await expect(section.locator('p[role="heading"]')).toHaveText(['Host caído'])
    await expect(section.locator('ol li')).toHaveText(['reiniciar', 'comprobar'])
    await expectRenderedText(section)
  }
)

test(
  'CA4 (0035): una evidencia que no es EVENT y no trae descripción no tiene la sección',
  { tag: '@problema-detalle' },
  async () => {
    await openAllDescriptionsProblem()
    const detail = await expandRow(ALL_PLAIN)
    await expect(detail.getByTestId('evidence-description')).toHaveCount(0)
    await expect(detail.getByTestId('evidence-description-truncated')).toHaveCount(0)
  }
)

/**
 * Decisión del Orquestador (0035): la sección de otra clave con «description», localizada por su
 * título (la clave) sin atarse a un data-testid: el contenedor más cercano que tiene el título y
 * el Markdown renderizado.
 */
function otherDescription(detail: Locator, key: string): Locator {
  return detail
    .locator('section, div')
    .filter({ has: page.getByText(key, { exact: true }) })
    .filter({ has: page.locator('strong', { hasText: 'reiniciar' }) })
    .last()
}

test(
  'Decisión del Orquestador (0035): otra clave con «description» en un METRIC se pinta como Markdown en su sección, debajo de «Descripción»',
  { tag: '@problema-detalle' },
  async () => {
    await openAllDescriptionsProblem()
    const detail = await expandRow(ALL_METRIC)
    const main = descriptionParts(detail).section
    await expect(main).toBeVisible()

    // Su título es la clave, visible y fuera de la lista de propiedades.
    const title = detail.getByText(OTHER_KEY, { exact: true })
    await expect(title).toBeVisible()
    const section = otherDescription(detail, OTHER_KEY)
    await expect(section).toBeVisible()
    await expect(section.locator('p[role="heading"]')).toHaveText(['Pasos'])
    await expect(section.locator('li')).toHaveText(['reiniciar el pool', 'avisar al equipo'])
    await expect(section.locator('strong')).toHaveText(['reiniciar'])
    await expect(section.locator('code')).toHaveText(['equipo'])
    const text = await section.innerText()
    expect(text).not.toContain('**')
    expect(text).not.toContain('`')
    expect(text).not.toContain('###')
    // Con su «Copiar», como la «Descripción».
    await expect(section.getByRole('button', { name: 'Copiar' })).toHaveCount(1)
    // No está dentro de «Descripción» y va después de ella.
    await expect(main.getByText(OTHER_KEY, { exact: true })).toHaveCount(0)
    await expect(main.locator('strong', { hasText: 'reiniciar' })).toHaveCount(0)
    const after = await main.evaluate(
      (first, second) =>
        second !== null &&
        (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
      await title.elementHandle()
    )
    expect(after).toBe(true)

    // Deja de salir como texto en la lista; la clave sin «description» sigue en ella como texto.
    const properties = detail.getByTestId('evidence-properties')
    const keys = await properties.locator('dt').allInnerTexts()
    expect(keys).not.toContain(OTHER_KEY)
    expect(keys).toContain('custom.owner')
    await expect(properties).toContainText('equipo-pagos')
    await expect(properties).not.toContainText('reiniciar')
  }
)

test(
  'Decisión del Orquestador (0035): en un EVENT sin dt.event.description, otra clave con «Description» (mayúsculas) también se pinta',
  { tag: '@problema-detalle' },
  async () => {
    await openAllDescriptionsProblem()
    const detail = await expandRow(ALL_OTHER_EVENT)
    // Sin dt.event.description no hay «Descripción» principal.
    await expect(detail.getByTestId('evidence-description')).toHaveCount(0)
    await expect(detail.getByText(OTHER_KEY_EVENT, { exact: true })).toBeVisible()
    const section = otherDescription(detail, OTHER_KEY_EVENT)
    await expect(section.locator('p[role="heading"]')).toHaveText(['Pasos'])
    await expect(section.locator('li')).toHaveText(['reiniciar el pool', 'avisar al equipo'])
    expect(await section.innerText()).not.toContain('**')

    const properties = detail.getByTestId('evidence-properties')
    const keys = await properties.locator('dt').allInnerTexts()
    expect(keys).not.toContain(OTHER_KEY_EVENT)
    expect(keys).toContain('custom.owner')
    await expect(properties).toContainText('equipo-pagos')
  }
)

for (const name of [ALL_TRANSACTIONAL, ALL_EVENT]) {
  test(
    `CA5 (0035): una descripción de 12 000 caracteres con un bloque de código llega y se renderiza (${name})`,
    { tag: '@problema-detalle' },
    async () => {
      expect(DESC_12K).toHaveLength(12_000)
      await openAllDescriptionsProblem()
      const { section, truncated } = descriptionParts(await expandRow(name))
      await expect(section).toBeVisible()
      await expect(section.locator('p[role="heading"]')).toHaveText([
        'Configuración del despliegue'
      ])
      // El bloque de código YAML, como bloque y sin las vallas.
      const block = section.locator('pre')
      await expect(block).toHaveCount(1)
      await expect(block).toContainText('servicio:')
      await expect(block).toContainText('replicas: 3')
      expect(await section.innerText()).not.toContain('```')
      if (MAX_DESCRIPTION_LENGTH >= DESC_12K.length) {
        // El límite lo permite: llega entera, con su final y sin nota de recorte.
        await expect(section).toContainText(LONG_END)
        await expect(truncated).toHaveCount(0)
      } else {
        await expect(section).not.toContainText(LONG_END)
        await expect(truncated).toBeVisible()
      }
    }
  )
}

test(
  'Separador en textos (0012): los números de los avisos (textos de i18next) también llevan separador: 1234 → «1.234»',
  { tag: '@problema-detalle' },
  async () => {
    await goToRoute(`/problems/${THOUSANDS_PROBLEM_ID}`)
    await expect(page.getByTestId('problem-page-title')).toContainText('P-792')
    const section = page.getByTestId('detail-comments')
    await expect(section.getByTestId('comments-api-truncated')).toHaveText(
      'Se ven los 1 más recientes de 1.234 comentarios.'
    )
    await expect(section.getByTestId('comments-show-all')).toHaveText('Ver todos (1.234)')
  }
)

/**
 * Ficha 0064: el siguiente `scrollIntoView` de un elemento de la tabla de evidencias (fuera del
 * detalle de una fila, que tiene su propio límite en el mini gráfico) lanza, una vez.
 */
async function failEvidenceGridOnce(): Promise<void> {
  await page.evaluate((message) => {
    const proto = Element.prototype
    const original = proto.scrollIntoView
    proto.scrollIntoView = function (this: Element, arg?: boolean | ScrollIntoViewOptions) {
      if (
        this.closest('[data-testid="evidence-grid"], [data-testid="evidence-scroll"]') !== null &&
        this.closest('[data-testid="evidence-detail"]') === null
      ) {
        proto.scrollIntoView = original
        throw new Error(message)
      }
      return original.call(this, arg)
    }
  }, PANEL_FAILURE)
}

test(
  'CA1 (0064): con varias evidencias con métrica, «Reintentar» de un panel roto no pide ninguna GET /api/v2/metrics/query (ni nada más): repinta con la caché',
  { tag: '@problema-detalle' },
  async () => {
    await goToRoute(`/problems/${CHART_ID}`)
    await expect(page.getByTestId('problem-page-title')).toContainText('P-780')
    for (const name of ['Respuesta lenta', 'Muchas series']) {
      const chart = await openChart(name)
      await chart.scrollIntoViewIfNeeded()
      await expect(chart.getByTestId('evidence-metric'), name).toBeVisible()
    }
    expect(eventQueries(SEL_OK)).toHaveLength(1)
    expect(eventQueries(SEL_MANY)).toHaveLength(1)

    // Se rompe el panel de la tabla de evidencias (sin onRetry: comportamiento por defecto) al
    // desplegar una fila sin gráfico.
    await failEvidenceGridOnce()
    await evidenceRow('Sin selector').click()
    const panel = page.getByTestId('problem-page').getByTestId('panel-error')
    await expect(panel).toBeVisible()
    dropPanelFailureErrors()
    await expect(evidenceRows()).toHaveCount(0)
    const before = await settledRequests()

    await panel.getByTestId('panel-retry').click()
    await expect(panel).toHaveCount(0)
    await expect(evidenceRows()).toHaveCount(7)
    for (const name of ['Respuesta lenta', 'Muchas series']) {
      await expect(metricChart(name).getByTestId('evidence-metric'), name).toBeVisible()
    }
    // Aserción negativa: un margen para que una petición, si la hubiera, saliera.
    await page.waitForTimeout(800)
    const after = sim.requests.slice(before)
    expect(
      after.filter((request) => request === 'GET /api/v2/metrics/query'),
      'consultas de métricas tras Reintentar'
    ).toEqual([])
    // Por defecto, solo limpia el error y repinta con la caché: ni el detalle ni nada más.
    expect(after, 'peticiones tras Reintentar').toEqual([])
    dropPanelFailureErrors()
  }
)

test(
  'Espec. 1 (0064): «Reintentar» del mini gráfico roto de una evidencia pide solo su métrica, una vez; los demás gráficos y el detalle, nada',
  { tag: '@problema-detalle' },
  async () => {
    await goToRoute(`/problems/${CHART_ID}`)
    await expect(page.getByTestId('problem-page-title')).toContainText('P-780')
    const ok = await openChart('Respuesta lenta')
    await ok.scrollIntoViewIfNeeded()
    await expect(ok.getByTestId('evidence-metric')).toBeVisible()

    // El gráfico de «Muchas series» falla al montarse (tras llegar su consulta).
    await failChartMountOnce(
      'evidence-metric',
      `[data-testid="evidence-detail"][data-id="${chartEventId('Muchas series')}"]`
    )
    const detail = await expandRow('Muchas series')
    const panel = detail.getByTestId('panel-error')
    await expect(panel).toBeVisible()
    dropPanelFailureErrors()
    // El otro mini gráfico sigue.
    await expect(ok.getByTestId('evidence-metric')).toBeVisible()
    expect(eventQueries(SEL_MANY)).toHaveLength(1)
    const before = await settledRequests()
    const okBefore = eventQueries(SEL_OK).length

    await panel.getByTestId('panel-retry').click()
    // Sube la del panel reintentado: una consulta más de su selector.
    await expect.poll(() => eventQueries(SEL_MANY).length).toBe(2)
    await expect(metricChart('Muchas series').getByTestId('evidence-metric')).toBeVisible()
    await page.waitForTimeout(800)
    expect(eventQueries(SEL_MANY)).toHaveLength(2)
    // Las de los demás, no: ni el otro gráfico ni el detalle del problema.
    expect(eventQueries(SEL_OK)).toHaveLength(okBefore)
    expect(sim.requests.slice(before), 'peticiones tras Reintentar').toEqual([
      'GET /api/v2/metrics/query'
    ])
    dropPanelFailureErrors()
  }
)
