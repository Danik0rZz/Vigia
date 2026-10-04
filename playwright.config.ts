import { defineConfig } from '@playwright/test'

/** Pruebas de extremo a extremo sobre la app compilada (`npm run test:e2e`). */
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  // Un spec por worker (sin fullyParallel): cada uno lanza su app con su carpeta de
  // datos. Solo views usa el portapapeles del sistema; otro que lo use debe ir en serie con él.
  workers: 4,
  // Sin reintentos: un test inestable tiene que fallar y arreglarse, no pasar a la segunda.
  retries: 0,
  // Un test.only olvidado haría pasar la suite con un solo test: se rechaza.
  forbidOnly: true,
  // Traza y captura solo si falla. Ojo: los specs lanzan Electron con electron.launch,
  // así que esto solo se aplica a las páginas de las fixtures de Playwright.
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  reporter: 'list'
})
