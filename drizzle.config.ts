import { defineConfig } from 'drizzle-kit'

/** Generación de migraciones (`npm run db:generate`). La app las aplica al arrancar. */
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/main/db/schema.ts',
  out: './src/main/db/migrations'
})
