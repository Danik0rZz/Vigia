import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: { '@shared': resolve('src/shared') }
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    // Las pruebas en vivo van aparte (npm run test:live).
    exclude: ['**/node_modules/**', '**/*.live.test.ts'],
    // Zona fija: las fechas y los cambios de hora no dependen de la máquina.
    env: { TZ: 'Europe/Madrid' }
  }
})
