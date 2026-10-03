import { defineConfig } from '@playwright/test'

/** Pruebas de extremo a extremo sobre la app compilada (`npm run test:e2e`). */
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  // Un spec por worker (sin fullyParallel): cada uno lanza su app con su carpeta de
  // datos. Solo views usa el portapapeles del sistema; otro que lo use debe ir en serie con él.
  workers: 4,
  reporter: 'list'
})
