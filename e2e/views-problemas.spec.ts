import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { expect, type Locator, test } from '@playwright/test'
import { hoverFresh, moveToNeutral } from './hover'
import { problemsA } from './views/fixtures'
import {
  canvasSize,
  clickInPlace,
  currentRoute,
  exportMenu,
  exportSaved,
  firstVisibleIndex,
  fullyVisibleRows,
  goTo,
  invoke,
  nextFrames,
  openProblem,
  openProblems,
  page,
  pngInfo,
  receivesClick,
  settledBox,
  setupViewsApp,
  withContentSize
} from './views/harness'
import { sim } from './views/sim-state'
import { FIXED_WINDOW, SMALL_WINDOW } from './window-size'
import ExcelJS from 'exceljs'
import { rowRenders, settledRowRenders, markRows, sameRows } from './views/helpers'

/**
 * Specs de vistas por zona (ficha 0070): la lista de Problemas (`@problemas`). Arnés en
 * `e2e/views/` (ver su cabecera).
 */

setupViewsApp()

test(
  'CA2 (0005): Problemas: tabla, línea de tiempo y página de detalle con las entidades afectadas; se vuelve con «Volver a Problemas» y con la ruta de la barra superior',
  { tag: '@problemas' },
  async () => {
    await withContentSize(FIXED_WINDOW, async () => {
      await openProblems()
      const rows = page.getByTestId('problem-row')
      for (const p of problemsA) {
        await expect(page.getByTestId('problems-grid')).toContainText(p.displayId)
      }
      await expect(page.getByTestId('problems-grid')).toContainText('Respuesta lenta en pagos')
      await expect(page.getByTestId('problems-timeline').locator('canvas').first()).toBeVisible()

      // Sin rango personalizado, la petición va con el rango global (2 h por defecto).
      expect(sim.lastProblemsQuery.get('from')).toBe('now-2h')

      // v0.9.0: el detalle es una página propia, /problems/<problemId>.
      const detail = await openProblem('P-101')
      expect(await currentRoute()).toBe('/problems/pa-1')
      // Al entrar, el foco va al título (los lectores de pantalla anuncian la página).
      await expect(page.getByTestId('problem-page-title')).toBeFocused()
      await expect(page.getByTestId('problem-page-title')).toContainText('Respuesta lenta en pagos')
      // Barra superior: … › Problemas (enlace) › P-101 (página actual).
      const crumbSection = page.getByTestId('breadcrumb-section')
      await expect(crumbSection).toHaveText('Problemas')
      await expect(page.getByTestId('breadcrumb-detail')).toHaveText('P-101')
      await expect(page.getByTestId('breadcrumb-detail')).toHaveAttribute('aria-current', 'page')
      // Resumen con lo de la fila: estado, severidad, impacto e inicio.
      await expect(detail.getByTestId('detail-summary')).toContainText('Rendimiento')
      await expect(detail.getByTestId('detail-root-cause')).toContainText('pagos')
      // Todas las entidades afectadas, con nombre, tipo e id.
      const entities = detail.getByTestId('problem-entity')
      await expect(entities).toHaveCount(2)
      // Cada entidad se identifica por su id (los nombres pueden contenerse unos a otros).
      const byId = (id: string): Locator =>
        entities.filter({ has: page.getByTestId('entity-id').filter({ hasText: id }) })
      await expect(byId('SERVICE-AAA1')).toContainText('pagos')
      await expect(byId('SERVICE-AAA1').getByTestId('entity-type')).toHaveText(/SERVICE/)
      await expect(byId('HOST-AAA1')).toContainText('host-pagos-01')
      await expect(byId('HOST-AAA1').getByTestId('entity-type')).toHaveText(/HOST/)

      // El detalle se pide con fields y muestra cada parte que llega.
      // v0.9.1: sin impactAnalysis.
      await expect
        .poll(() => sim.lastDetailQuery.get('fields'))
        .toBe('evidenceDetails,recentComments')
      await expect(detail.getByTestId('detail-evidence')).toContainText(
        'Tiempo de respuesta degradado'
      )
      await expect(detail.getByTestId('detail-impacts')).toHaveCount(0)
      await expect(detail.getByTestId('detail-comments')).toContainText(
        'Revisando el pool de conexiones'
      )
      await expect(detail.getByTestId('detail-zones')).toContainText('Producción')
      await expect(detail.getByTestId('detail-impacted')).toContainText('web')
      await expect(detail.getByTestId('detail-tags')).toContainText('equipo:pagos')
      await expect(detail.getByTestId('detail-linked')).toContainText('P-099')
      await expect(
        page.locator('[data-testid="export-menu"][data-export-target="problem-page"]')
      ).toBeVisible()
      // Ya no hay panel lateral.
      await expect(page.getByTestId('problem-detail')).toHaveCount(0)

      // «Volver a Problemas» vuelve a la lista; la fila abierta queda marcada (data-selected,
      // sin aria-selected).
      await detail.getByTestId('problem-back').click()
      await expect(rows).toHaveCount(3)
      expect(await currentRoute()).toBe('/problems')
      await expect(page.getByTestId('breadcrumb-detail')).toHaveCount(0)
      const p101 = rows.filter({ hasText: 'P-101' })
      await expect(p101).toHaveAttribute('data-selected', 'true')
      await expect(p101).not.toHaveAttribute('aria-selected', /.*/)

      // El enlace «Problemas» de la barra superior también lleva a la lista, con un clic normal
      // (sin force ni dispatchEvent): nada lo tapa ni lo recorta.
      await openProblem('P-102')
      await expect(crumbSection).toBeVisible()
      await expect.poll(() => receivesClick(crumbSection), 'el enlace recibe el clic').toBe(true)
      await crumbSection.click()
      await expect(rows).toHaveCount(3)
      expect(await currentRoute()).toBe('/problems')
    })
  }
)

test(
  'AUD-12: el detalle se abre con el teclado y, al volver, el foco vuelve a la fila',
  { tag: '@problemas' },
  async () => {
    const detail = page.getByTestId('problem-page')
    await openProblems()

    // Ya no hay botón problem-open: se navega por las filas del grid.
    await expect(page.getByTestId('problem-open')).toHaveCount(0)
    // Roving tabindex: una sola fila con tabIndex 0 (la activa, la 0 al empezar).
    await expect(page.locator('[data-testid="problem-row"][tabindex="0"]')).toHaveCount(1)
    await expect(page.locator('[data-testid="problem-row"][tabindex="0"]')).toHaveAttribute(
      'data-index',
      '0'
    )

    // Tab desde el filtro de texto llega a la fila activa.
    await page.getByTestId('problems-filter-text').focus()
    let reached = false
    for (let i = 0; i < 40 && !reached; i++) {
      await page.keyboard.press('Tab')
      reached = await page.evaluate(
        () => document.activeElement?.getAttribute('data-testid') === 'problem-row'
      )
    }
    expect(reached, 'Tab llega a una fila del grid').toBe(true)
    const activeIndex = (): Promise<number> =>
      page.evaluate(() => Number((document.activeElement as HTMLElement | null)?.dataset['index']))
    expect(await activeIndex()).toBe(0)

    // Flechas, Inicio/Fin y RePág/AvPág mueven el foco (3 filas: de 0 a 2, sin salirse).
    const steps: [string, number][] = [
      ['ArrowDown', 1],
      ['ArrowDown', 2],
      ['ArrowDown', 2],
      ['ArrowUp', 1],
      ['Home', 0],
      ['ArrowUp', 0],
      ['End', 2],
      ['PageUp', 0],
      ['PageDown', 2],
      ['ArrowUp', 1]
    ]
    for (const [key, index] of steps) {
      await page.keyboard.press(key)
      expect(await activeIndex(), key).toBe(index)
    }
    // Al moverse, la activa pasa a ser la única con tabIndex 0.
    await expect(page.locator('[data-testid="problem-row"][tabindex="0"]')).toHaveAttribute(
      'data-index',
      '1'
    )

    // Enter abre la fila activa (la 1: por defecto, Inicio desc → P-103, P-101, P-102).
    const opener = page.locator('[data-testid="problem-row"][data-index="1"]')
    const openedId = await opener.getAttribute('data-problem-id')
    const opened = problemsA.find((p) => p['problemId'] === openedId)?.displayId ?? '?'
    expect(opened).toBe('P-101')
    await page.keyboard.press('Enter')
    await expect(detail).toBeVisible()
    await expect(page.getByTestId('problem-page-title')).toContainText(opened)
    await expect(page.getByTestId('problem-page-title')).toBeFocused()

    // «Volver» (con el teclado) vuelve a la lista con el foco en esa misma fila.
    await page.getByTestId('problem-back').focus()
    await page.keyboard.press('Enter')
    await expect(detail).toHaveCount(0)
    await expect(
      page.locator(`[data-testid="problem-row"][data-problem-id="${openedId}"]`)
    ).toBeFocused()

    // Escape ya no hace nada en la lista (no hay panel que cerrar).
    await page.keyboard.press('Escape')
    expect(await currentRoute()).toBe('/problems')

    // Un clic en cualquier parte de la fila sigue abriendo.
    await page
      .getByTestId('problem-row')
      .filter({ hasText: 'P-102' })
      .getByText('Disco lleno')
      .click()
    await expect(detail).toBeVisible()
    await expect(page.getByTestId('problem-page-title')).toContainText('P-102')
  }
)

for (const size of [FIXED_WINDOW, SMALL_WINDOW]) {
  test(
    `CA1 (0005): con 300 filas virtualizadas, volver del detalle (botón e historial) conserva el filtro, la primera fila visible y la abierta marcada y a la vista (${size.width}×${size.height})`,
    { tag: '@problemas' },
    async () => {
      await withContentSize(size, async () => {
        sim.many = true
        await goTo('problems')
        const rows = page.getByTestId('problem-row')
        await expect(rows.first()).toContainText('P-M')
        const row = (index: number): Locator =>
          page.locator(`[data-testid="problem-row"][data-index="${index}"]`)

        // Un filtro (lo aplica Dynatrace: todos los masivos lo cumplen).
        await page.getByTestId('problems-filter-text').fill('masivo')
        await expect
          .poll(() => sim.lastProblemsQuery.get('problemSelector') ?? '')
          .toContain('masivo')
        // La lista entera a la vista (en una ventana pequeña queda por debajo) y scroll a mitad:
        // al final, el scroll se recorta y no hay «primera fila» exacta.
        const scroller = page.getByTestId('problems-scroll')
        await scroller.evaluate((el) => el.scrollIntoView({ block: 'end' }))
        await scroller.evaluate((el) => {
          el.scrollTop = el.scrollHeight / 2
        })
        await expect.poll(firstVisibleIndex).toBeGreaterThan(100)
        // La lista guarda el índice en un requestAnimationFrame tras el scroll.
        await nextFrames()
        const before = await firstVisibleIndex()

        /**
         * Abre una fila del centro de las que se ven enteras (no la del borde de la cabecera) con
         * un clic donde está, sin que el clic mueva la lista, y devuelve su id.
         */
        const openMiddleRow = async (): Promise<string> => {
          await settledBox(scroller)
          const visible = await fullyVisibleRows()
          expect(visible.length, 'filas enteras a la vista').toBeGreaterThan(2)
          const index = visible[Math.floor(visible.length / 2)] ?? -1
          const id = (await row(index).getAttribute('data-problem-id')) ?? ''
          expect(id).toMatch(/^pm-\d+$/)
          await clickInPlace(row(index))
          await expect(page.getByTestId('problem-page')).toBeVisible()
          await expect(page.getByTestId('problem-page-title')).toContainText(
            `P-M${id.slice('pm-'.length)}`
          )
          return id
        }

        /** Lo que se conserva al volver: filtro, primera fila (por índice) y la abierta. */
        const expectRestored = async (openedId: string): Promise<void> => {
          await expect(page.getByTestId('problem-page')).toHaveCount(0)
          await expect(page.getByTestId('problems-filter-text')).toHaveValue('masivo')
          await expect.poll(firstVisibleIndex).toBe(before)
          const opened = page.locator(`[data-testid="problem-row"][data-problem-id="${openedId}"]`)
          await expect(opened).toHaveAttribute('data-selected', 'true')
          const openedIndex = Number(await opened.getAttribute('data-index'))
          expect(await fullyVisibleRows(), 'la fila abierta, a la vista').toContain(openedIndex)
        }

        // Se vuelve con el botón.
        const first = await openMiddleRow()
        await page.getByTestId('problem-back').click()
        await expectRestored(first)

        // Lo mismo con la flecha atrás del historial (history.back).
        const second = await openMiddleRow()
        await page.goBack()
        await expectRestored(second)
      })
    }
  )
}

/** Ficha 0059: el subconjunto de `renders` con esos ids. */
function pick(renders: Record<string, number>, ids: readonly string[]): Record<string, number> {
  return Object.fromEntries(ids.map((id) => [id, renders[id] ?? -1]))
}

test(
  'CA1 (0059): en Problemas con 300 filas, hacer scroll de diez filas no vuelve a pintar las que ya estaban montadas y no han cambiado',
  { tag: '@problemas' },
  async () => {
    sim.many = true
    await goTo('problems')
    const rows = page.getByTestId('problem-row')
    await expect(rows.first()).toContainText('P-M')
    const scroller = page.getByTestId('problems-scroll')
    const row = (index: number): Locator =>
      page.locator(`[data-testid="problem-row"][data-index="${index}"]`)
    await expect(row(10)).toHaveCount(1)
    expect(await firstVisibleIndex()).toBe(0)

    // Antes del scroll: cada fila montada lleva su contador.
    const before = await settledRowRenders('problem-row', 'data-problem-id')
    const mounted = Object.keys(before)
    expect(mounted.length, 'filas montadas').toBeGreaterThan(10)
    expect(mounted.length, 'virtualizada: no están las 300').toBeLessThan(300)
    for (const [id, count] of Object.entries(before)) {
      expect(count, `data-render-count de ${id}`).toBeGreaterThanOrEqual(1)
    }
    await markRows('problem-row', 'data-problem-id')

    // Scroll de diez filas exactas (lo que separa la fila 10 de la 0).
    const tops = await Promise.all(
      [0, 10].map((i) => row(i).evaluate((el) => el.getBoundingClientRect().top))
    )
    const delta = (tops[1] ?? 0) - (tops[0] ?? 0)
    expect(delta).toBeGreaterThan(0)
    await scroller.evaluate((el, by) => {
      el.scrollTop += by
    }, delta)
    await expect.poll(firstVisibleIndex).toBe(10)
    const after = await settledRowRenders('problem-row', 'data-problem-id')

    // Las que siguen montadas (el mismo elemento) no se han vuelto a pintar.
    const kept = await sameRows('problem-row', 'data-problem-id')
    expect(kept.length, 'filas que siguen montadas tras el scroll').toBeGreaterThan(5)
    expect(pick(after, kept), 'renders de las filas que no han cambiado').toEqual(
      pick(before, kept)
    )
    // Las nuevas sí se pintan (el contador está vivo).
    const fresh = Object.keys(after).filter((id) => before[id] === undefined)
    expect(fresh.length, 'filas nuevas tras el scroll').toBeGreaterThan(0)
    for (const id of fresh)
      expect(after[id], `data-render-count de ${id}`).toBeGreaterThanOrEqual(1)

    // Una fila que sí cambia (pasa a ser la del foco) se vuelve a pintar: el contador sube.
    const target = page.locator(`[data-testid="problem-row"][data-index="12"]`)
    const targetId = (await target.getAttribute('data-problem-id')) ?? ''
    expect(kept).toContain(targetId)
    await target.evaluate((el) => (el as HTMLElement).focus({ preventScroll: true }))
    await expect(target).toHaveAttribute('tabindex', '0')
    await expect
      .poll(async () => (await rowRenders('problem-row', 'data-problem-id'))[targetId] ?? -1)
      .toBeGreaterThan(after[targetId] ?? Number.MAX_SAFE_INTEGER)
  }
)

test('AUD-12: filtros de severidad e impacto, en el servidor', { tag: '@problemas' }, async () => {
  const rows = page.getByTestId('problem-row')
  const selectorParam = (): string => sim.lastProblemsQuery.get('problemSelector') ?? ''
  const pick = async (filter: string, option: string, value: string): Promise<void> => {
    await page.getByTestId(filter).click()
    await page.locator(`[data-testid="${option}"][value="${value}"]`).click()
    await page.keyboard.press('Escape')
  }
  await openProblems()

  // Opciones con los valores de la API.
  await page.getByTestId('problems-filter-severity').click()
  const severityValues = await page
    .getByTestId('severity-option')
    .evaluateAll((els) => els.map((el) => el.getAttribute('value')))
  expect(severityValues).toEqual(
    expect.arrayContaining(['AVAILABILITY', 'ERROR', 'PERFORMANCE', 'RESOURCE_CONTENTION'])
  )
  await page.keyboard.press('Escape')

  const severityTrigger = page.getByTestId('problems-filter-severity')
  // Sin nada marcado, «Todos».
  await expect(severityTrigger).toContainText('Todos')

  await pick('problems-filter-severity', 'severity-option', 'PERFORMANCE')
  await expect.poll(selectorParam).toMatch(/severityLevel\([^)]*"PERFORMANCE"[^)]*\)/)
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('P-101')
  // Con uno marcado, el nombre de esa opción (no un recuento).
  await expect(severityTrigger).toContainText('Rendimiento')
  await expect(severityTrigger).not.toContainText('seleccionado')

  // Dos severidades: las dos en el mismo criterio (OR).
  await pick('problems-filter-severity', 'severity-option', 'RESOURCE_CONTENTION')
  await expect.poll(selectorParam).toMatch(/severityLevel\([^)]*"RESOURCE_CONTENTION"[^)]*\)/)
  expect(selectorParam()).toMatch(/severityLevel\([^)]*"PERFORMANCE"[^)]*\)/)
  await expect(rows).toHaveCount(2)
  // i18n: plural con dos.
  await expect(severityTrigger).toContainText('2 seleccionados')

  // AVAILABILITY va como valor de la API.
  await pick('problems-filter-severity', 'severity-option', 'AVAILABILITY')
  await expect.poll(selectorParam).toMatch(/severityLevel\([^)]*"AVAILABILITY"[^)]*\)/)

  // Se quitan las tres: vuelve la consulta sin severidad (ya en caché, sin petición nueva).
  for (const value of ['PERFORMANCE', 'RESOURCE_CONTENTION', 'AVAILABILITY']) {
    await pick('problems-filter-severity', 'severity-option', value)
  }
  await expect(rows).toHaveCount(3)

  // Impacto.
  await pick('problems-filter-impact', 'impact-option', 'INFRASTRUCTURE')
  await expect.poll(selectorParam).toMatch(/impactLevel\([^)]*"INFRASTRUCTURE"[^)]*\)/)
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('P-102')

  // Van por entorno, como los demás filtros: Desarrollo empieza sin ellos (con
  // INFRASTRUCTURE, P-900, de impacto APPLICATION, no saldría).
  await page.getByTestId('env-selector').click()
  await page.getByRole('option', { name: 'Cliente A › Desarrollo' }).click()
  await expect(page.getByTestId('problems-grid')).toContainText('P-900')
  await page.getByTestId('env-selector').click()
  await page.getByRole('option', { name: 'Cliente A › Producción' }).click()
  await expect(rows).toHaveCount(1)

  await pick('problems-filter-impact', 'impact-option', 'INFRASTRUCTURE')
  await expect(rows).toHaveCount(3)
})

test(
  'grid de Problemas: ARIA, orden por columna, barra de estado y afectados',
  { tag: '@problemas' },
  async () => {
    await openProblems()
    const grid = page.getByTestId('problems-grid')
    const row = (id: string): Locator => page.getByTestId('problem-row').filter({ hasText: id })
    /** IDs de las filas en el orden en que se ven. */
    const order = (): Promise<string[]> =>
      page
        .getByTestId('problem-row')
        .evaluateAll((els) =>
          els
            .sort(
              (a, b) => Number(a.getAttribute('data-index')) - Number(b.getAttribute('data-index'))
            )
            .map((el) => el.getAttribute('data-problem-id') ?? '')
        )

    // La lista se pide ya ordenada por inicio descendente.
    expect(sim.lastProblemsQuery.get('sort')).toBe('-startTime')

    // ARIA: grid con nombre y recuento (3 filas + la cabecera); la cabecera es la fila 1.
    await expect(grid).toHaveAttribute('role', 'grid')
    await expect(grid).toHaveAttribute('aria-label', 'Problemas')
    await expect(grid).toHaveAttribute('aria-rowcount', '4')
    await expect(grid.locator('[data-grid-header] [role="row"]')).toHaveAttribute(
      'aria-rowindex',
      '1'
    )
    const rowIndexes = await page
      .getByTestId('problem-row')
      .evaluateAll((els) => els.map((el) => el.getAttribute('aria-rowindex')).sort())
    expect(rowIndexes).toEqual(['2', '3', '4'])
    for (const r of await page.getByTestId('problem-row').all()) {
      await expect(r).toHaveAttribute('role', 'row')
      await expect(r.getByRole('gridcell')).toHaveCount(4)
    }

    // Cuatro columnas, y por defecto Inicio descendente.
    const headers = await grid
      .locator('[role="columnheader"]')
      .evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')))
    expect(headers).toEqual(['col-displayId', 'col-title', 'col-affected', 'col-start'])
    await expect(page.getByTestId('col-start')).toHaveAttribute('aria-sort', 'descending')
    for (const key of ['displayId', 'title', 'affected']) {
      await expect(page.getByTestId(`col-${key}`)).toHaveAttribute('aria-sort', 'none')
    }
    await expect(page.getByTestId('col-affected')).toContainText('Afectados')
    expect(await order()).toEqual(['pa-3', 'pa-1', 'pa-2'])

    // Ordenar por ID: una columna nueva de texto empieza ascendente; la misma, invierte.
    await page.getByTestId('sort-displayId').click()
    await expect(page.getByTestId('col-displayId')).toHaveAttribute('aria-sort', 'ascending')
    await expect(page.getByTestId('col-start')).toHaveAttribute('aria-sort', 'none')
    expect(await order()).toEqual(['pa-1', 'pa-2', 'pa-3'])
    await page.getByTestId('sort-displayId').click()
    await expect(page.getByTestId('col-displayId')).toHaveAttribute('aria-sort', 'descending')
    expect(await order()).toEqual(['pa-3', 'pa-2', 'pa-1'])

    // Afectados empieza descendente; empate (P-102 y P-103, 1 cada uno) → inicio desc.
    await page.getByTestId('sort-affected').focus()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('col-affected')).toHaveAttribute('aria-sort', 'descending')
    expect(await order()).toEqual(['pa-1', 'pa-3', 'pa-2'])

    // Con Espacio también; Título empieza ascendente.
    await page.getByTestId('sort-title').focus()
    await page.keyboard.press('Space')
    await expect(page.getByTestId('col-title')).toHaveAttribute('aria-sort', 'ascending')

    // El orden se conserva al ir al detalle y volver.
    await page.getByTestId('sort-displayId').click()
    await expect(page.getByTestId('col-displayId')).toHaveAttribute('aria-sort', 'ascending')
    await openProblem('P-102')
    await page.getByTestId('problem-back').click()
    await expect(page.getByTestId('col-displayId')).toHaveAttribute('aria-sort', 'ascending')
    expect(await order()).toEqual(['pa-1', 'pa-2', 'pa-3'])

    // La exportación sale en el mismo orden que el grid.
    const csv = readFileSync(await exportSaved('problems-table', 'export-csv'))
      .subarray(3)
      .toString('utf8')
      .split('\r\n')
      .filter((line) => line !== '')
    expect(csv.slice(1).map((line) => /P-\d+/.exec(line)?.[0])).toEqual(['P-101', 'P-102', 'P-103'])

    // La 1.ª celda dice el estado en texto (para lectores de pantalla) y el ID.
    await expect(row('P-101').getByRole('gridcell').first()).toHaveText('Abierto: P-101')
    await expect(row('P-102').getByRole('gridcell').first()).toHaveText('Cerrado: P-102')

    // Barra de estado: abierto y cerrado, cerrado más fina.
    const bar = (id: string): Locator => row(id).getByTestId('status-bar')
    await expect(bar('P-101')).toHaveAttribute('data-status', 'OPEN')
    await expect(bar('P-102')).toHaveAttribute('data-status', 'CLOSED')
    const width = (id: string): Promise<number> =>
      bar(id).evaluate((el) => el.getBoundingClientRect().width)
    expect(await width('P-102')).toBeLessThan(await width('P-101'))
    // Contraste de la barra (elemento gráfico, WCAG 1.4.11) calculado sobre lo pintado.
    const barContrast = (id: string): Promise<number> =>
      bar(id).evaluate((el) => {
        const rgb = (value: string): number[] =>
          (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number)
        const luminance = ([r = 0, g = 0, b = 0]: number[]): number => {
          const [R, G, B] = [r, g, b].map((c) => {
            const s = c / 255
            return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
          }) as [number, number, number]
          return 0.2126 * R + 0.7152 * G + 0.0722 * B
        }
        // La barra: su color pintado. El fondo: el token --background (#rrggbb).
        const fg = luminance(rgb(getComputedStyle(el).backgroundColor))
        const background = getComputedStyle(document.documentElement)
          .getPropertyValue('--background')
          .trim()
        const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(background) ?? []
        const bg = luminance(hex.slice(1, 4).map((part) => parseInt(part, 16)))
        const [hi, lo] = [fg, bg].sort((a, b) => b - a) as [number, number]
        return (hi + 0.05) / (lo + 0.05)
      })
    expect(await barContrast('P-101')).toBeGreaterThanOrEqual(3)
    expect(await barContrast('P-102')).toBeGreaterThanOrEqual(3)
    // Tooltip de la barra con el estado. El ratón se quita llevándolo, en pasos, a un punto
    // neutro del contenido: la esquina (0, 0) es la barra de título arrastrable.
    const away = (): Promise<void> => moveToNeutral(page)
    await hoverFresh(page, bar('P-102'))
    await expect(page.getByRole('tooltip')).toContainText('Cerrado')
    await away()
    await expect(page.getByRole('tooltip')).toHaveCount(0)

    // Afectados: el número de únicos y un tooltip con sus nombres.
    await expect(row('P-101').getByTestId('affected-count')).toHaveText('2')
    await expect(row('P-102').getByTestId('affected-count')).toHaveText('1')
    await hoverFresh(page, row('P-101').getByTestId('affected-count'))
    const tooltip = page.getByTestId('affected-tooltip')
    await expect(tooltip).toContainText('pagos')
    await expect(tooltip).toContainText('host-pagos-01')
    await away()

    // Fuera del grid: severidad, clúster, namespace, duración y los ids de las entidades.
    await expect(grid).not.toContainText('NUEVA_SEVERIDAD')
    await expect(grid).not.toContainText('cluster-norte')
    await expect(grid).not.toContainText('carrito-ns')
    await expect(grid).not.toContainText('(en curso)')
    await expect(grid).not.toContainText('SERVICE-AAA1')
  }
)

test(
  'grid con 300 filas: Fin, RePág e Inicio mueven el foco y hacen scroll hasta la fila',
  { tag: '@problemas' },
  async () => {
    sim.many = true
    await goTo('problems')
    const rows = page.getByTestId('problem-row')
    await expect(rows.first()).toContainText('P-M')
    await expect(page.getByTestId('problems-grid')).toHaveAttribute('aria-rowcount', '301')

    await page.locator('[data-testid="problem-row"][data-index="0"]').focus()
    const active = (): Promise<{ index: number; rowindex: string | null }> =>
      page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null
        return {
          index: Number(el?.dataset['index']),
          rowindex: el?.getAttribute('aria-rowindex') ?? null
        }
      })

    // El foco se mueve después del scroll de la virtualización: se espera, no se lee al instante.
    await page.keyboard.press('End')
    await expect.poll(active).toEqual({ index: 299, rowindex: '301' })
    await expect(page.locator('[data-testid="problem-row"][data-index="299"]')).toBeInViewport()
    await page.keyboard.press('PageUp')
    await expect.poll(async () => (await active()).index).toBe(289)
    await page.keyboard.press('PageDown')
    await expect.poll(async () => (await active()).index).toBe(299)
    await page.keyboard.press('Home')
    await expect.poll(active).toEqual({ index: 0, rowindex: '2' })
    await expect(page.locator('[data-testid="problem-row"][data-index="0"]')).toBeInViewport()
    await page.keyboard.press('PageDown')
    await expect.poll(async () => (await active()).index).toBe(10)
    // Virtualizada: no están las 300 en el DOM.
    expect(await rows.count()).toBeLessThan(300)
  }
)

test(
  'clúster: filtro local, aviso y exportación filtrada (la columna ya no está en el grid)',
  { tag: '@problemas' },
  async () => {
    const rows = page.getByTestId('problem-row')
    const row = (id: string): Locator => rows.filter({ hasText: id })
    await openProblems()

    // Filtro: una casilla por clúster de los datos cargados, ordenadas.
    await page.getByTestId('problems-filter-cluster').click()
    const options = page.getByTestId('cluster-option')
    await expect(options).toHaveCount(2)
    expect(await options.evaluateAll((els) => els.map((el) => el.getAttribute('value')))).toEqual([
      'cluster-norte',
      'cluster-sur'
    ])

    // Solo cluster-sur → P-103; el aviso dice que hay filtro y cuántos se cargaron.
    await page.locator('[data-testid="cluster-option"][value="cluster-sur"]').click()
    await page.keyboard.press('Escape')
    await expect(rows).toHaveCount(1)
    await expect(row('P-103')).toHaveCount(1)
    const notice = page.getByTestId('list-truncated')
    await expect(notice).toContainText('filtro de clúster')
    await expect(notice).toContainText('de 3')

    // La exportación sale filtrada.
    const lines = readFileSync(await exportSaved('problems-table', 'export-csv'))
      .subarray(3)
      .toString('utf8')
      .split('\r\n')
      .filter((line) => line !== '')
    expect(lines).toHaveLength(2)
    expect(lines[1]).toContain('P-103')

    // El XLSX filtrado lo dice en Info, con su fila propia.
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(
      readFileSync(await exportSaved('problems-table', 'export-xlsx')) as unknown as ArrayBuffer
    )
    const info: [string, unknown][] = []
    workbook.getWorksheet('Info')?.eachRow((r) => {
      info.push([String(r.getCell(1).value), r.getCell(2).value])
    })
    expect(info.filter(([label]) => label === 'Filtro de clúster')).toEqual([
      ['Filtro de clúster', 'cluster-sur']
    ])
    expect(workbook.getWorksheet('Datos')?.actualRowCount).toBe(2)

    // Con las dos marcadas (OR) salen P-101 y P-103; P-102 no tiene clúster.
    await page.getByTestId('problems-filter-cluster').click()
    await page.locator('[data-testid="cluster-option"][value="cluster-norte"]').click()
    await page.keyboard.press('Escape')
    await expect(rows).toHaveCount(2)
    await expect(row('P-102')).toHaveCount(0)

    // Sin filtro: vuelven las 3 y el aviso desaparece.
    await page.getByTestId('problems-filter-cluster').click()
    for (const name of ['cluster-norte', 'cluster-sur']) {
      await page.locator(`[data-testid="cluster-option"][value="${name}"]`).click()
    }
    await page.keyboard.press('Escape')
    await expect(rows).toHaveCount(3)
    await expect(notice).toHaveCount(0)
  }
)

test('tabla de Problemas virtualizada con 300 problemas', { tag: '@problemas' }, async () => {
  sim.many = true
  await goTo('problems')
  const rows = page.getByTestId('problem-row')
  await expect(rows.first()).toContainText('P-M')

  const visible = async (): Promise<string[]> =>
    rows.evaluateAll((els) => els.map((el) => /P-M\d+/.exec(el.textContent ?? '')?.[0] ?? ''))
  const before = await visible()
  expect(before.length, 'filas en el DOM').toBeGreaterThan(0)
  expect(before.length, 'menos filas en el DOM que problemas').toBeLessThan(300)

  await page.getByTestId('problems-scroll').evaluate((el) => {
    el.scrollTop = el.scrollHeight
  })
  await expect.poll(async () => (await visible()).some((id) => !before.includes(id))).toBe(true)
  expect((await visible()).length).toBeLessThan(300)

  sim.many = false
  await page.getByTestId('module-refresh').click()
  await expect(rows).toHaveCount(3)
})

test('Problemas: filtros de estado y de texto', { tag: '@problemas' }, async () => {
  await openProblems()
  const rows = page.getByTestId('problem-row')
  await page.getByTestId('problems-filter-status').selectOption('open')
  await expect(rows).toHaveCount(2)
  await expect(page.getByTestId('problems-grid')).not.toContainText('P-102')

  await page.getByTestId('problems-filter-text').fill('pagos')
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('P-101')

  await page.getByTestId('problems-filter-text').fill('')
  await page.getByTestId('problems-filter-status').selectOption('all')
  await expect(rows).toHaveCount(3)
})

test(
  'AUD-21: los filtros de Problemas se conservan al cambiar de sección',
  { tag: '@problemas' },
  async () => {
    await openProblems()
    const rows = page.getByTestId('problem-row')
    await page.getByTestId('problems-filter-status').selectOption('open')
    await page.getByTestId('problems-filter-text').fill('pagos')
    await expect(rows).toHaveCount(1)

    await goTo('metrics')
    await expect(page).toHaveURL(/#\/metrics/)
    await goTo('problems')
    await expect(page.getByTestId('problems-filter-status')).toHaveValue('open')
    await expect(page.getByTestId('problems-filter-text')).toHaveValue('pagos')
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toContainText('P-101')

    await page.getByTestId('problems-filter-text').fill('')
    await page.getByTestId('problems-filter-status').selectOption('all')
    await expect(rows).toHaveCount(3)
  }
)

test('AUD-21: los filtros de Problemas van por entorno', { tag: '@problemas' }, async () => {
  await openProblems()
  const status = page.getByTestId('problems-filter-status')
  const table = page.getByTestId('problems-grid')
  const switchTo = async (name: string): Promise<void> => {
    await page.getByTestId('env-selector').click()
    await page.getByRole('option', { name: `Cliente A › ${name}` }).click()
  }

  await status.selectOption('open')
  await expect(page.getByTestId('problem-row')).toHaveCount(2)

  // Desarrollo no hereda el «open» de Producción.
  await switchTo('Desarrollo')
  await expect(table).toContainText('P-900')
  await expect(status).toHaveValue('all')
  await expect(page.getByTestId('problems-filter-text')).toHaveValue('')

  // Al volver, Producción recupera el suyo.
  await switchTo('Producción')
  await expect(status).toHaveValue('open')
  await expect(page.getByTestId('problem-row')).toHaveCount(2)
  await expect(table).not.toContainText('P-900')

  await status.selectOption('all')
  await expect(page.getByTestId('problem-row')).toHaveCount(3)
})

test(
  'una lista truncada lo indica, con el total real de la API',
  { tag: '@problemas' },
  async () => {
    await openProblems()
    await expect(page.getByTestId('list-truncated')).toHaveCount(0)
    sim.truncate = true
    await page.getByTestId('module-refresh').click()
    const notice = page.getByTestId('list-truncated')
    await expect(notice).toBeVisible()
    await expect(notice).toContainText('de 999')

    // Inicio: el KPI de problemas abiertos muestra el total de la API, no los que han llegado.
    await goTo('home')
    await page.getByTestId('module-refresh').click()
    await expect(page.getByTestId('kpi-open-problems')).toContainText('999')
    await goTo('problems')

    // Sin truncar, el aviso desaparece al refrescar.
    sim.truncate = false
    await page.getByTestId('module-refresh').click()
    await expect(page.getByTestId('list-truncated')).toHaveCount(0)
  }
)

test(
  'exporta problemas a CSV: BOM, ";", una fila por problema y fórmulas neutralizadas',
  { tag: '@problemas' },
  async () => {
    await openProblems()
    const file = await exportSaved('problems-table', 'export-csv')
    // Si en el mismo minuto ya se exportó otro (por ejemplo, el CSV filtrado del test del clúster), lleva -N.
    expect(file).toMatch(/Cliente_A_Producción_problems_\d{8}-\d{4}(-\d+)?\.csv$/)

    const buffer = readFileSync(file)
    expect([...buffer.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    const lines = buffer
      .subarray(3)
      .toString('utf8')
      .split('\r\n')
      .filter((line) => line !== '')
    expect(lines).toHaveLength(1 + problemsA.length)
    expect(lines[0]).toContain(';')
    for (const p of problemsA) expect(buffer.toString('utf8')).toContain(p.displayId)
    expect(buffer.toString('utf8')).toContain(`'=HYPERLINK`)
    expect(buffer.toString('utf8')).not.toMatch(/(^|;|")=HYPERLINK/m)
  }
)

test(
  'CA5 (0005): exporta problemas a XLSX con sus hojas Datos e Info, a TXT alineado y a TXT con tabuladores, cada fichero leído ya escrito',
  { tag: '@problemas' },
  async () => {
    await openProblems()
    const xlsx = await exportSaved('problems-table', 'export-xlsx')
    expect(xlsx).toMatch(/\.xlsx$/)
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(readFileSync(xlsx) as unknown as ArrayBuffer)
    const data = workbook.getWorksheet('Datos')
    const info = workbook.getWorksheet('Info')
    expect(data?.actualRowCount).toBe(1 + problemsA.length)
    const infoText: Record<string, unknown> = {}
    info?.eachRow((row) => {
      infoText[String(row.getCell(1).value)] = row.getCell(2).value
    })
    expect(infoText['Cliente']).toBe('Cliente A')
    expect(infoText['Entorno']).toBe('Producción')
    expect(infoText['Rango']).toBe('now-2h')
    expect(infoText['Desde']).toBeInstanceOf(Date)
    expect(infoText['Hasta']).toBeInstanceOf(Date)
    expect(String(infoText['Nota'])).toContain('Problemas abiertos: sin fin')
    const header = (data?.getRow(1).values as unknown[]).slice(1).map(String)
    expect(header).toHaveLength(17)
    // La fila de un problema abierto: fin vacío y duración en número.
    let openRow: unknown[] = []
    data?.eachRow((r, n) => {
      if (n > 1 && String(r.getCell(1).value) === 'P-101')
        openRow = (r.values as unknown[]).slice(1)
    })
    expect(String(openRow[11]), 'clusters antes de namespaces').toBe('cluster-norte')
    expect(openRow[14] ?? null, 'endTime vacío si está abierto').toBeNull()
    expect(typeof openRow[15], 'durationMinutes es número').toBe('number')
    expect(String(openRow[5]), 'afectadas unidas con " | "').toBe('pagos | host-pagos-01')
    expect(String(openRow[7])).toBe('SERVICE-AAA1 | HOST-AAA1')

    const txtFile = await exportSaved('problems-table', 'export-txt')
    expect(txtFile).toMatch(/\.txt$/)
    const txt = readFileSync(txtFile, 'utf8')
    expect(txt).toContain('P-101')
    expect(txt).not.toContain('\t')
    const tabsFile = await exportSaved('problems-table', 'export-txt-tabs')
    expect(tabsFile).toMatch(/\.txt$/)
    const tabs = readFileSync(tabsFile, 'utf8')
    expect(tabs.split(/\r?\n/)[0]).toContain('\t')
  }
)

test(
  'con la interfaz en inglés, el XLSX lleva las hojas y la Info en inglés',
  { tag: '@problemas' },
  async () => {
    await goTo('settings')
    await page.getByTestId('language-en').click()
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await openProblems()

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(
      readFileSync(await exportSaved('problems-table', 'export-xlsx')) as unknown as ArrayBuffer
    )
    expect(workbook.worksheets.map((sheet) => sheet.name).sort()).toEqual(['Data', 'Info'])
    const info: Record<string, unknown> = {}
    workbook.getWorksheet('Info')?.eachRow((row) => {
      info[String(row.getCell(1).value)] = row.getCell(2).value
    })
    expect(info['Client']).toBe('Cliente A')
    expect(info['Environment']).toBe('Producción')
    expect(info['Cliente']).toBeUndefined()

    await goTo('settings')
    await page.getByTestId('language-es').click()
    await expect(page.locator('html')).toHaveAttribute('lang', 'es')
  }
)

test('con el separador "," en Ajustes, el CSV usa coma', { tag: '@problemas' }, async () => {
  await goTo('settings')
  await page.getByTestId('csv-separator-comma').click()
  await expect(page.getByTestId('csv-separator-comma')).toBeChecked()
  expect(await invoke('export:getSettings')).toMatchObject({ csvSeparator: ',' })

  await openProblems()
  const lines = readFileSync(await exportSaved('problems-table', 'export-csv'))
    .subarray(3)
    .toString('utf8')
    .split('\r\n')
  expect(lines[0]).toContain(',')
  expect(lines[0]).not.toContain(';')

  await goTo('settings')
  await page.getByTestId('csv-separator-semicolon').click()
  expect(await invoke('export:getSettings')).toMatchObject({ csvSeparator: ';' })
})

test(
  'captura del gráfico a PNG: x2, fondo sólido y pie según Ajustes',
  { tag: '@problemas' },
  async () => {
    await openProblems()
    await expect(page.getByTestId('problems-timeline').locator('canvas').first()).toBeVisible()
    const size = await canvasSize('problems-timeline')

    const withFooter = await pngInfo(await exportSaved('problems-timeline', 'capture-save'))
    expect(withFooter.width).toBeGreaterThanOrEqual(2 * size.width)
    expect(withFooter.height).toBeGreaterThan(2 * size.height)
    expect(withFooter.cornerAlpha).toBe(255)

    await goTo('settings')
    await expect(page.getByTestId('capture-footer-on')).toBeChecked()
    await page.getByTestId('capture-footer-off').click()
    await goTo('problems')

    const file = await exportSaved('problems-timeline', 'capture-save')
    expect(file).toMatch(/Cliente_A_Producción_problems_\d{8}-\d{4}.*\.png$/)
    // AUD-14: el aviso dice el nombre del fichero escrito (con su -N si lo hay), no «Guardado:» vacío.
    await expect(
      exportMenu('problems-timeline').locator('xpath=..').getByRole('status')
    ).toHaveText(`Guardado: ${basename(file)}`)
    const withoutFooter = await pngInfo(file)
    expect(Math.abs(withoutFooter.height - 2 * size.height)).toBeLessThanOrEqual(1)
    expect(withoutFooter.cornerAlpha).toBe(255)

    await goTo('settings')
    await page.getByTestId('capture-footer-on').click()
  }
)
