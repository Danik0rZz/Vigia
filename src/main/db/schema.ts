import { sql } from 'drizzle-orm'
import { blob, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

/**
 * Esquema de la base local. Tras cambiarlo: `npm run db:generate` y commitear la
 * migración nueva de `src/main/db/migrations`.
 */

export const clients = sqliteTable(
  'clients',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    color: text('color').notNull()
  },
  (table) => [uniqueIndex('clients_name_unique').on(sql`lower(${table.name})`)]
)

export const environments = sqliteTable(
  'environments',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    type: text('type').notNull(),
    deployment: text('deployment').notNull(),
    classicApiUrl: text('classic_api_url'),
    platformUrl: text('platform_url'),
    ssoUrl: text('sso_url'),
    oauthClientId: text('oauth_client_id'),
    oauthScopes: text('oauth_scopes', { mode: 'json' }).$type<string[]>().notNull(),
    accountUuid: text('account_uuid'),
    certificateLevel: text('certificate_level').notNull(),
    captureUrlPatterns: text('capture_url_patterns', { mode: 'json' }).$type<string[]>().notNull(),
    tags: text('tags', { mode: 'json' }).$type<string[]>().notNull(),
    readOnly: integer('read_only', { mode: 'boolean' }).notNull()
  },
  (table) => [
    uniqueIndex('environments_client_name_unique').on(table.clientId, sql`lower(${table.name})`)
  ]
)

/** Secretos cifrados con safeStorage. Se borran con su entorno. */
export const secrets = sqliteTable(
  'secrets',
  {
    environmentId: text('environment_id')
      .notNull()
      .references(() => environments.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    ciphertext: blob('ciphertext', { mode: 'buffer' }).notNull()
  },
  (table) => [primaryKey({ columns: [table.environmentId, table.kind] })]
)

/** Huella SHA-256 aceptada por host para el nivel de certificados "huella fijada". */
export const certificatePins = sqliteTable(
  'certificate_pins',
  {
    environmentId: text('environment_id')
      .notNull()
      .references(() => environments.id, { onDelete: 'cascade' }),
    host: text('host').notNull(),
    fingerprint: text('fingerprint').notNull()
  },
  (table) => [primaryKey({ columns: [table.environmentId, table.host] })]
)

/** Consultas de métricas guardadas por entorno. */
export const savedMetricQueries = sqliteTable('saved_metric_queries', {
  id: text('id').primaryKey(),
  environmentId: text('environment_id')
    .notNull()
    .references(() => environments.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  metricSelector: text('metric_selector').notNull(),
  resolution: text('resolution')
})

/** Ajustes de la app (clave y valor): entorno activo, tema… */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull()
})
