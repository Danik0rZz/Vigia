import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import {
  clientInputSchema,
  environmentInputSchema,
  type Client,
  type ClientInput,
  type Environment,
  type EnvironmentInput
} from '@shared/tenants'
import type { AppDatabase } from '../db/database'
import { clients, environments } from '../db/schema'
import { DomainError } from '../errors'
import { createSettingsStore } from '../settings/store'

const ACTIVE_ENVIRONMENT = 'activeEnvironmentId'

/** Comparación de nombres sin distinguir mayúsculas (también con tildes, que `lower()` de SQLite no cubre). */
function sameName(a: string, b: string): boolean {
  return a.toLocaleLowerCase('es') === b.toLocaleLowerCase('es')
}

/** Orden por nombre con la colación española (tildes y mayúsculas como en un índice). */
function byName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name, 'es')
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
  /** Entorno activo (se guarda en los ajustes); vuelve a `null` si se borra. */
  getActiveEnvironmentId(): string | null
  setActiveEnvironmentId(id: string | null): void
}

/** Clientes, entornos y entorno activo, sobre SQLite. */
export function createTenantRepository(db: AppDatabase): TenantRepository {
  const settingsStore = createSettingsStore(db)
  const getSetting = settingsStore.get
  const setSetting = settingsStore.set

  function listClients(): Client[] {
    return db.select().from(clients).all().sort(byName)
  }

  function listEnvironments(): Environment[] {
    // Misma colación que los clientes: la binaria de SQLite pondría «Zeta» antes que «ámbito».
    return db.select().from(environments).all().sort(byName).map(toEnvironment)
  }

  function requireClient(id: string): Client {
    const client = db.select().from(clients).where(eq(clients.id, id)).get()
    if (client === undefined)
      throw new DomainError('NOT_FOUND', 'El cliente no existe.', { key: 'clientMissing' })
    return client
  }

  function requireEnvironment(id: string): Environment {
    const row = db.select().from(environments).where(eq(environments.id, id)).get()
    if (row === undefined)
      throw new DomainError('NOT_FOUND', 'El entorno no existe.', { key: 'environmentMissing' })
    return toEnvironment(row)
  }

  function checkClientName(name: string, exceptId: string | null): void {
    if (listClients().some((client) => client.id !== exceptId && sameName(client.name, name))) {
      throw new DomainError('CONFLICT', 'Ya existe un cliente con ese nombre.', {
        key: 'clientNameTaken'
      })
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
      throw new DomainError('CONFLICT', 'Ya existe un entorno con ese nombre en el cliente.', {
        key: 'environmentNameTaken'
      })
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
    }
  }
}
