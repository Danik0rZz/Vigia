import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: { '@shared': resolve('src/shared') }
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts'],
    // Cobertura de main y shared (npm run test:coverage, dentro de check). Los
    // umbrales son los medidos el 2026-10-04 (tras AUD-20) menos unos 3 puntos: si bajan, algo
    // se ha quedado sin test. Se suben a mano cuando la cobertura crezca.
    coverage: {
      provider: 'v8',
      include: ['src/main/**/*.ts', 'src/shared/**/*.ts'],
      exclude: ['**/*.test.{ts,tsx}', '**/*.live.test.ts'],
      reporter: ['text-summary'],
      thresholds: { statements: 86, branches: 84, functions: 81, lines: 86 }
    },
    // Las pruebas en vivo van aparte (npm run test:live).
    exclude: ['**/node_modules/**', '**/*.live.test.ts'],
    // Zona fija: las fechas y los cambios de hora no dependen de la máquina.
    env: { TZ: 'Europe/Madrid' }
  }
})
