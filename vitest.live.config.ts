import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

/**
 * Pruebas en vivo contra el tenant de pruebas (`npm run test:live`), SOLO
 * lectura. Fuera de `npm run check`, de los e2e y de CI. Las credenciales están
 * en `.env.live.local` (ignorado) y no se imprimen nunca.
 */
export default defineConfig({
  resolve: {
    alias: { '@shared': resolve('src/shared') }
  },
  test: {
    environment: 'node',
    include: ['src/**/*.live.test.ts'],
    passWithNoTests: true,
    env: { TZ: 'Europe/Madrid' },
    // Concurrencia 1: una petición detrás de otra, para no cargar el tenant.
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 60_000,
    hookTimeout: 60_000
  }
})
