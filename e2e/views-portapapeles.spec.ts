import { expect, test } from '@playwright/test'
import { DESC_MD, DESC_SHORT_MD, ALL_EVENT } from './views/fixtures'
import {
  app,
  consoleErrors,
  type ElectronClipboard,
  exportMenu,
  goToRoute,
  openProblems,
  page,
  setupViewsApp
} from './views/harness'
import en from '../src/renderer/src/locales/en/common.json'
import es from '../src/renderer/src/locales/es/common.json'
import {
  evidenceRow,
  detailOf,
  expandRow,
  openDescriptionProblem,
  descriptionParts,
  focusedTestId,
  openAllDescriptionsProblem
} from './views/helpers'

/**
 * Specs de vistas por zona (ficha 0070): los tests que usan el portapapeles del sistema (`@portapapeles`), de cualquier zona, juntos en un solo spec para que no se pisen. Arnés en
 * `e2e/views/` (ver su cabecera).
 */

setupViewsApp()

test(
  'v0.10.1: «Copiar detalles» de la pantalla de error: el portapapeles lleva los detalles enmascarados (sin rutas de usuario)',
  { tag: ['@errors', '@portapapeles'] },
  async () => {
    // Va en views porque es el spec que guarda y restaura el portapapeles de quien usa el PC.
    await goToRoute('/__errors/unexpected')
    const screen = page.getByTestId('error-screen')
    await expect(screen).toBeVisible()
    await page.getByTestId('error-details').locator('summary').click()
    const shown = (await page.getByTestId('error-details-text').innerText()).trim()
    expect(shown).toContain('/__errors/unexpected')
    await app.evaluate(({ clipboard }) => (clipboard as unknown as ElectronClipboard).clear())
    await page.getByTestId('error-copy').click()
    await expect(page.getByTestId('error-copy-status')).toHaveText(es.errorScreen.copied)
    const copied = await app.evaluate(({ clipboard }) =>
      (clipboard as unknown as { readText: () => Promise<string> | string }).readText()
    )
    // Lo mismo que se ve, ya enmascarado: el usuario de las rutas, nunca.
    expect(copied.trim()).toBe(shown)
    expect(copied).toContain('/__errors/unexpected')
    expect(copied).not.toMatch(/[A-Za-z]:[\\/]Users[\\/](?!<usuario>)/i)
    expect(copied).not.toMatch(/\/home\/(?!<usuario>)/)
    // El disparador mete una ruta de usuario inventada en el mensaje: sale tapada.
    expect(copied).not.toContain('persona-prueba')
    expect(copied).toContain('<usuario>')
    // El error provocado lo escriben en consola React y React Router: es el
    // esperado y se quita; cualquier otro sigue haciendo fallar el afterEach.
    const others = consoleErrors.filter((line) => !line.includes('Error de prueba del disparador'))
    consoleErrors.splice(0, consoleErrors.length, ...others)
  }
)

test('captura del gráfico al portapapeles', { tag: ['@problemas', '@portapapeles'] }, async () => {
  await openProblems()
  await expect(page.getByTestId('problems-timeline').locator('canvas').first()).toBeVisible()
  await app.evaluate(({ clipboard }) => (clipboard as unknown as ElectronClipboard).clear())
  expect(
    await app.evaluate(({ clipboard }) =>
      (clipboard as unknown as ElectronClipboard).has('image/png')
    )
  ).toBe(false)
  await exportMenu('problems-timeline').click()
  await page.getByTestId('capture-copy').click()
  await expect
    .poll(() =>
      app.evaluate(async ({ clipboard }) =>
        (await (clipboard as unknown as ElectronClipboard).read()).some((item) =>
          item.types.includes('image/png')
        )
      )
    )
    .toBe(true)
})

/** Lee el portapapeles del sistema (desde main), con los saltos de línea normalizados. */
async function clipboardText(): Promise<string> {
  const text = await app.evaluate(({ clipboard }) =>
    (clipboard as unknown as { readText: () => Promise<string> | string }).readText()
  )
  // Windows puede devolver \r\n: el texto es el mismo.
  return text.replace(/\r\n/g, '\n')
}

async function clearClipboard(): Promise<void> {
  await app.evaluate(({ clipboard }) => (clipboard as unknown as ElectronClipboard).clear())
}

test(
  'CA8 (0001) y CA2 (0002): «Copiar» copia el texto original exacto y avisa de que se ha copiado',
  { tag: ['@problema-detalle', '@portapapeles'] },
  async () => {
    // Va en views porque es el spec que guarda y restaura el portapapeles de quien usa el PC.
    // El renderer no tiene permiso de portapapeles: lo que llega al del sistema solo puede venir
    // de app:copyText.
    await openDescriptionProblem()
    const parts = descriptionParts(await expandRow('Descripción con formato'))
    await expect(parts.copy).toHaveText('Copiar')
    await expect(parts.status).toHaveCount(0)
    // Se ve con formato (ficha 0002: siempre) y se copia el Markdown, no lo que se ve.
    await expect(parts.section.locator('strong')).toHaveText(['negrita'])
    await clearClipboard()
    await parts.copy.click()
    await expect(parts.status).toHaveText(es.errorScreen.copied)
    expect(await clipboardText()).toBe(DESC_MD)

    // Otro evento copia el suyo.
    const other = descriptionParts(await expandRow('Otra con descripción'))
    await clearClipboard()
    await other.copy.click()
    await expect(other.status).toHaveText(es.errorScreen.copied)
    expect(await clipboardText()).toBe(DESC_SHORT_MD)
  }
)

test(
  'CA9 (0001) y CA3 (0002): con el teclado, Tab llega a «Copiar», Enter lo activa y Escape pliega',
  { tag: ['@problema-detalle', '@portapapeles'] },
  async () => {
    await openDescriptionProblem()
    const row = evidenceRow('Descripción con formato')
    await row.scrollIntoViewIfNeeded()
    await row.focus()
    await page.keyboard.press('Enter')
    await expect(row).toHaveAttribute('aria-expanded', 'true')
    const parts = descriptionParts(await detailOf(row))
    await expect(parts.copy).toBeVisible()

    // Tab desde la fila hasta «Copiar», sin pasar por ningún control de modo.
    const visited: (string | null)[] = []
    for (let i = 0; i < 25; i += 1) {
      const current = await focusedTestId()
      visited.push(current)
      if (current === 'evidence-description-copy') break
      await page.keyboard.press('Tab')
    }
    expect(await focusedTestId(), 'Tab hasta evidence-description-copy').toBe(
      'evidence-description-copy'
    )
    expect(visited.filter((id) => id?.startsWith('evidence-description-mode'))).toEqual([])

    // Enter copia sin plegar la fila.
    await clearClipboard()
    await page.keyboard.press('Enter')
    await expect(parts.status).toHaveText(es.errorScreen.copied)
    expect(await clipboardText()).toBe(DESC_MD)
    await expect(row).toHaveAttribute('aria-expanded', 'true')
    await expect(parts.section.locator('strong')).toHaveText(['negrita'])

    // Escape desde dentro del detalle: pliega y devuelve el foco a la fila.
    await page.keyboard.press('Escape')
    await expect(row).toHaveAttribute('aria-expanded', 'false')
    await expect(row).toBeFocused()
  }
)

test(
  'CA15 (0001): los textos nuevos de la sección también están en inglés',
  { tag: ['@problema-detalle', '@portapapeles'] },
  async () => {
    await page.getByRole('button', { name: es.topbar.language }).click()
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await openDescriptionProblem()
    const parts = descriptionParts(await expandRow('Descripción con formato'))
    await expect(parts.section).toBeVisible()
    const spanish: Record<string, string> = { copy: 'Copiar' }
    for (const [name, locator] of [['copy', parts.copy]] as const) {
      const label = (await locator.innerText()).trim()
      expect(label, name).not.toBe('')
      expect(label, name).not.toBe(spanish[name])
      // Ni una clave sin traducir (problems.algo.otra).
      expect(label, name).not.toMatch(/^[\w-]+(\.[\w-]+)+$/)
    }
    await parts.copy.click()
    await expect(parts.status).toHaveText(en.errorScreen.copied)
  }
)

/**
 * Ficha 0038: «Copiar» de cada bloque de código. Usa el bloque YAML de la descripción larga de
 * P-835 (fixture de la 0035). Contrato elegido al escribir los tests (anotado en la ficha): el
 * bloque es `data-testid="md-code-block"`, su botón `md-code-copy` (texto «Copiar») y
 * el aviso `md-code-copy-status` con `errorScreen.copied`, como el «Copiar» de la descripción.
 */
const YAML_BLOCK_CODE = 'servicio:\n  nombre: pagos\n  replicas: 3'

test(
  'CA2 (0038): «Copiar» de un bloque copia su código exacto, sin los números de línea, y avisa',
  { tag: ['@problema-detalle', '@portapapeles'] },
  async () => {
    // Va en views porque es el spec que usa el portapapeles del sistema.
    await openAllDescriptionsProblem()
    const { section } = descriptionParts(await expandRow(ALL_EVENT))
    const block = section.getByTestId('md-code-block')
    await expect(block).toHaveCount(1)
    await block.scrollIntoViewIfNeeded()
    const copy = block.getByTestId('md-code-copy')
    const status = block.getByTestId('md-code-copy-status')
    await expect(copy).toHaveText('Copiar')
    await expect(status).toHaveCount(0)
    // Los números de línea se ven en el bloque (uno por línea)...
    await expect(block.locator('[data-line-number]')).toHaveText(['1', '2', '3'])

    await clearClipboard()
    await copy.click()
    await expect(status).toHaveText(es.errorScreen.copied)
    // ...pero no van al portapapeles: solo el código del bloque, ni la descripción entera.
    expect(await clipboardText()).toBe(YAML_BLOCK_CODE)
  }
)
