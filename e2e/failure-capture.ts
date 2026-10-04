import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, type Page } from '@playwright/test'

/** Líneas del final del log de main que se adjuntan a un test que falla. */
const LOG_LINES = 80

/**
 * Registra un afterEach que, si el test ha fallado, adjunta una captura de la
 * ventana y el final del log de main de la carpeta temporal del spec (van a
 * test-results/, ignorada). Los e2e usan servidores simulados: no hay datos del
 * tenant. `trace` y `screenshot` de playwright.config no sirven aquí, porque
 * los specs lanzan Electron con electron.launch y no usan las fixtures de página.
 */
export function captureOnFailure(
  current: () => { page: Page | undefined; userDataDir: string | undefined }
): void {
  // Playwright exige desestructurar el primer argumento aunque no use fixtures.
  // eslint-disable-next-line no-empty-pattern
  test.afterEach(async ({}, testInfo) => {
    if (testInfo.status === testInfo.expectedStatus) return
    const { page, userDataDir } = current()
    if (page !== undefined && !page.isClosed()) {
      try {
        await testInfo.attach('captura-fallo', {
          body: await page.screenshot(),
          contentType: 'image/png'
        })
      } catch {
        // La ventana puede haberse cerrado con el fallo: no tapa el error real.
      }
    }
    if (userDataDir !== undefined) {
      const logFile = join(userDataDir, 'logs', 'main.log')
      if (existsSync(logFile)) {
        const tail = readFileSync(logFile, 'utf8').split(/\r?\n/).slice(-LOG_LINES).join('\n')
        await testInfo.attach('log-main', { body: tail, contentType: 'text/plain' })
      }
    }
  })
}
