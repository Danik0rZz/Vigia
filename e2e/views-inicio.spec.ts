import { readFileSync } from 'node:fs'
import { expect, type Locator, test } from '@playwright/test'
import { hoverFresh, moveToNeutral } from './hover'
import {
  exportMenu,
  exportSaved,
  goTo,
  page,
  receivesClick,
  setupViewsApp,
  withContentSize
} from './views/harness'
import { sim } from './views/sim-state'
import { FIXED_WINDOW, SMALL_WINDOW } from './window-size'
import ExcelJS from 'exceljs'

/**
 * Specs de vistas por zona (ficha 0070): Inicio (`@inicio`). Arnés en
 * `e2e/views/` (ver su cabecera).
 */

setupViewsApp()

test('Inicio: problemas abiertos, SLOs y salud de servicios', { tag: '@inicio' }, async () => {
  await goTo('home')
  await expect(page.getByTestId('kpi-open-problems')).toContainText('2')
  const slos = page.getByTestId('kpi-slos')
  await expect(slos).toContainText('Disponibilidad pagos')
  await expect(slos).toContainText('Latencia carrito')
  await expect(slos).toContainText(/99[.,]5/)
  const health = page.getByTestId('service-health')
  await expect(health).toContainText('pagos')
  await expect(health).toContainText('carrito')
  // Los servicios de problemas cerrados y las entidades que no son servicios no salen.
  await expect(health).not.toContainText('host-pagos-01')
})

test(
  'CA4 (0005): Inicio: estado de cada SLO (con texto y color), sin evaluar, problemas relacionados con su plural y tooltip con el ratón y con el foco',
  { tag: '@inicio' },
  async () => {
    await withContentSize(FIXED_WINDOW, async () => {
      await goTo('home')
      const card = page.getByTestId('kpi-slos')
      const item = (name: string): Locator => card.locator('li').filter({ hasText: name })
      const status = (name: string): Locator => item(name).getByTestId('slo-status')

      const expected = [
        ['Disponibilidad pagos', 'SUCCESS', 'text-muted-foreground'],
        ['Latencia carrito', 'FAILURE', 'text-danger'],
        ['Errores de login', 'WARNING', 'text-status-warning'],
        ['Búsqueda sin datos', 'UNEVALUATED', 'text-muted-foreground']
      ] as const
      for (const [name, value, cls] of expected) {
        await expect(status(name), name).toHaveAttribute('data-status', value)
        await expect(status(name), name).toHaveClass(new RegExp(`\\b${cls}\\b`))
        // El color nunca es la única señal: siempre hay texto.
        await expect(status(name), name).toHaveText(/\S/)
      }
      // WARNING no se pinta como FAILURE, ni con su color.
      await expect(status('Errores de login')).not.toHaveClass(/\btext-danger\b/)

      // Sin evaluar: «Sin evaluar», nunca «Correcto», y los valores con «—».
      await expect(status('Búsqueda sin datos')).toHaveText('Sin evaluar')
      await expect(item('Búsqueda sin datos')).not.toContainText('Correcto')
      await expect(item('Búsqueda sin datos')).toContainText('—')

      // Problemas abiertos relacionados: solo donde hay más de 0, con plural. Con -1 (Dynatrace
      // no pudo calcularlo, «Errores de login») o 0, nada.
      await expect(card.getByTestId('slo-related-problems')).toHaveCount(1)
      await expect(item('Errores de login').getByTestId('slo-related-problems')).toHaveCount(0)
      await expect(item('Errores de login')).not.toContainText('-1')
      const related = item('Latencia carrito').getByTestId('slo-related-problems')
      await expect(related).toHaveText('2 problemas abiertos')

      // Explica de dónde sale el número: tooltip con el ratón y con el foco.
      const hint = page.getByTestId('slo-related-problems-tooltip')
      const HINT = 'Lo calcula Dynatrace con el filtro de problemas del SLO'
      await expect(hint).toHaveCount(0)
      await hoverFresh(page, related)
      await expect(hint).toBeVisible()
      await expect(hint).toContainText(HINT)
      await moveToNeutral(page)
      await page.keyboard.press('Escape')
      await expect(hint).toHaveCount(0)
      await expect(related).toHaveAttribute('tabindex', '0')
      await related.focus()
      await expect(hint).toBeVisible()
      await expect(hint).toContainText(HINT)
      await page.keyboard.press('Escape')
      await expect(hint).toHaveCount(0)

      // La exportación lleva la columna numérica: vacía sin dato y también con -1 (no calculado),
      // y en ese caso una nota en Info que lo explica. Cada XLSX se lee ya escrito.
      const NOTE =
        'Celdas vacías en «Problemas abiertos relacionados»: Dynatrace no pudo calcularlo'
      const exported = async (): Promise<{ values: Map<string, unknown>; info: string[] }> => {
        const workbook = new ExcelJS.Workbook()
        await workbook.xlsx.load(
          readFileSync(await exportSaved('kpi-slos', 'export-xlsx')) as unknown as ArrayBuffer
        )
        const sheet = workbook.getWorksheet('Datos')
        const header = (sheet?.getRow(1).values as unknown[]).slice(1).map(String)
        const column = header.indexOf('Problemas abiertos relacionados') + 1
        expect(column, `cabeceras: ${header.join(' | ')}`).toBeGreaterThan(0)
        const values = new Map<string, unknown>()
        sheet?.eachRow((row, n) => {
          if (n > 1) values.set(String(row.getCell(1).value), row.getCell(column).value)
        })
        const info: string[] = []
        workbook.getWorksheet('Info')?.eachRow((row) => {
          info.push(String(row.getCell(2).value ?? ''))
        })
        return { values, info }
      }

      const withFailed = await exported()
      expect(withFailed.values.get('Latencia carrito')).toBe(2)
      expect(withFailed.values.get('Disponibilidad pagos')).toBe(0)
      expect(withFailed.values.get('Errores de login') ?? null).toBeNull()
      expect(withFailed.values.get('Búsqueda sin datos') ?? null).toBeNull()
      expect(withFailed.info).toContain(NOTE)

      // Sin ningún -1, sin la nota.
      sim.sloRelatedFailed = false
      try {
        await page.getByTestId('module-refresh').click()
        await expect(card).toContainText('Errores de login')
        await expect.poll(async () => (await exported()).values.get('Errores de login')).toBe(0)
        expect((await exported()).info).not.toContain(NOTE)
      } finally {
        sim.sloRelatedFailed = true
      }
      await page.getByTestId('module-refresh').click()
    })
  }
)

test(
  'CA4 (0005): con la ventana más pequeña que permite la app, tras exportar los SLOs el aviso no tapa el menú y se puede volver a exportar',
  { tag: '@inicio' },
  async () => {
    await withContentSize(SMALL_WINDOW, async () => {
      await goTo('home')
      await expect(page.getByTestId('kpi-slos')).toContainText('Errores de login')
      const first = await exportSaved('kpi-slos', 'export-xlsx')
      // El aviso «Guardado: …» ocupa sitio en la cabecera de la tarjeta: el menú sigue a la vista
      // y nada (la tarjeta de al lado) lo tapa.
      await expect(exportMenu('kpi-slos')).toBeVisible()
      await expect
        .poll(() => receivesClick(exportMenu('kpi-slos')), 'el menú recibe el clic')
        .toBe(true)
      const second = await exportSaved('kpi-slos', 'export-xlsx')
      expect(second).not.toBe(first)
    })
  }
)
