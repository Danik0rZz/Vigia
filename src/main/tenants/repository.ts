import { randomUUID } from 'node:crypto'
import { asc, eq } from 'drizzle-orm'
import {
  clientInputSchema,
  environmentInputSchema,
  type Client,
  type ClientInput,
  type Environment,
  type EnvironmentInput
} from '@shared/tenants'
import type { AppDatabase } from '../db/database'
import { clients, environments, settings } from '../db/schema'
import { DomainError } from '../errors'

const ACTIVE_ENVIRONMENT = 'activeEnvironmentId'

/** Comparación de nombres sin distinguir mayúsculas (también con tildes, que `lower()` de SQLite no cubre). */
function sameName(a: string, b: string): boolean {
  return a.toLocaleLowerCase('es') === b.toLocaleLowerCase('es')
}

function toEnvironment(row: typeof environments.$inferSelect): Environment {
  return {
    ...row,
    type: row.type as Environment['type'],
    deployment: row.deployment as Environment['deployment'],
    certificateLevel: row.certificateLevel as Environment['certificateLevel']
  }
}

export interface TenantRepository {
  /** Ejecuta `fn` en una transacción: si lanza, no queda nada de lo hecho dentro. */
  transaction<T>(fn: () => T): T
  listClients(): Client[]
  listEnvironments(): Environment[]
  createClient(input: ClientInput): Client
  updateClient(id: string, input: ClientInput): Client
  /** Borra el cliente con sus entornos (y los secretos de estos, por cascada). */
  deleteClient(id: string): void
  createEnvironment(input: EnvironmentInput): Environment
  updateEnvironment(id: string, input: EnvironmentInput): Environment
  deleteEnvironment(id: string): void
  getEnvironment(id: string): Environment
  getActiveEnvironmentId(): string | null
  setActiveEnvironmentId(id: string | null): void
  getSetting(key: string): string | null
  setSetting(key: string, value: string): void
}

/** Clientes, entornos, entorno activo y ajustes de la app, sobre SQLite. */
export function createTenantRepository(db: AppDatabase): TenantRepository {
  function getSetting(key: string): string | null {
    return db.select().from(settings).where(eq(settings.key, key)).get()?.value ?? null
  }

  function setSetting(key: string, value: string | null): void {
    if (value === null) {
      db.delete(settings).where(eq(settings.key, key)).run()
      return
    }
    db.insert(settings)
      .values({ key, value })
      .onConflictDoUpdate({ target: settings.key, set: { value } })
      .run()
  }

  function listClients(): Client[] {
    return db
      .select()
      .from(clients)
      .all()
      .sort((a, b) => a.name.localeCompare(b.name, 'es'))
  }

  function listEnvironments(): Environment[] {
    return db.select().from(environments).orderBy(asc(environments.name)).all().map(toEnvironment)
  }

  function requireClient(id: string): Client {
    const client = db.select().from(clients).where(eq(clients.id, id)).get()
    if (client === undefined) throw new DomainError('NOT_FOUND', 'El cliente no existe.')
    return client
  }

  function requireEnvironment(id: string): Environment {
    const row = db.select().from(environments).where(eq(environments.id, id)).get()
    if (row === undefined) throw new DomainError('NOT_FOUND', 'El entorno no existe.')
    return toEnvironment(row)
  }

  function checkClientName(name: string, exceptId: string | null): void {
    if (listClients().some((client) => client.id !== exceptId && sameName(client.name, name))) {
      throw new DomainError('CONFLICT', 'Ya existe un cliente con ese nombre.')
    }
  }

  function checkEnvironmentName(clientId: string, name: string, exceptId: string | null): void {
    const taken = db
      .select({ id: environments.id, name: environments.name })
      .from(environments)
      .where(eq(environments.clientId, clientId))
      .all()
      .some((row) => row.id !== exceptId && sameName(row.name, name))
    if (taken)
      throw new DomainError('CONFLICT', 'Ya existe un entorno con ese nombre en el cliente.')
  }

  /** Si el entorno activo ya no existe (borrado o en cascada), se deja sin entorno activo. */
  function clearDanglingActive(): void {
    const active = getSetting(ACTIVE_ENVIRONMENT)
    if (active === null) return
    const exists = db
      .select({ id: environments.id })
      .from(environments)
      .where(eq(environments.id, active))
      .get()
    if (exists === undefined) setSetting(ACTIVE_ENVIRONMENT, null)
  }

  return {
    transaction<T>(fn: () => T): T {
      return db.$client.transaction(fn)()
    },

    listClients,
    listEnvironments,

    createClient(input: ClientInput): Client {
      const data = clientInputSchema.parse(input)
      checkClientName(data.name, null)
      const client = { id: randomUUID(), ...data }
      db.insert(clients).values(client).run()
      return client
    },

    updateClient(id: string, input: ClientInput): Client {
      const data = clientInputSchema.parse(input)
      requireClient(id)
      checkClientName(data.name, id)
      db.update(clients).set(data).where(eq(clients.id, id)).run()
      return { id, ...data }
    },

    deleteClient(id: string): void {
      requireClient(id)
      db.delete(clients).where(eq(clients.id, id)).run()
      clearDanglingActive()
    },

    createEnvironment(input: EnvironmentInput): Environment {
      const data = environmentInputSchema.parse(input)
      requireClient(data.clientId)
      checkEnvironmentName(data.clientId, data.name, null)
      const environment: Environment = { id: randomUUID(), ...data }
      db.insert(environments).values(environment).run()
      return environment
    },

    updateEnvironment(id: string, input: EnvironmentInput): Environment {
      const data = environmentInputSchema.parse(input)
      requireEnvironment(id)
      requireClient(data.clientId)
      checkEnvironmentName(data.clientId, data.name, id)
      db.update(environments).set(data).where(eq(environments.id, id)).run()
      return { id, ...data }
    },

    deleteEnvironment(id: string): void {
      requireEnvironment(id)
      db.delete(environments).where(eq(environments.id, id)).run()
      clearDanglingActive()
    },

    getEnvironment: requireEnvironment,

    getActiveEnvironmentId(): string | null {
      return getSetting(ACTIVE_ENVIRONMENT)
    },

    setActiveEnvironmentId(id: string | null): void {
      if (id !== null) requireEnvironment(id)
      setSetting(ACTIVE_ENVIRONMENT, id)
    },

    getSetting,
    setSetting(key: string, value: string): void {
      setSetting(key, value)
    }
  }
}
