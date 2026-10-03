import { defineConfig } from '@playwright/test'

/** Pruebas de extremo a extremo sobre la app compilada (`npm run test:e2e`). */
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  workers: 1,
  reporter: 'list'
})
