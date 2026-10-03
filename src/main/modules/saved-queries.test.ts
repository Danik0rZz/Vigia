import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type AppDatabase } from '../db/database'
import { DomainError } from '../errors'
import { createTenantRepository } from '../tenants/repository'
import { createSavedQueryStore } from './saved-queries'

/** Consultas de métricas guardadas por entorno (migración 0002, tabla saved_metric_queries). */

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000'

let db: AppDatabase
let repo: ReturnType<typeof createTenantRepository>
let store: ReturnType<typeof createSavedQueryStore>

beforeEach(() => {
  db = openDatabase(':memory:', 'src/main/db/migrations')
  repo = createTenantRepository(db)
  store = createSavedQueryStore(db)
})

afterEach(() => {
  db.$client.close()
})

function createEnvironment(name: string, clientName = 'Cliente A'): string {
  const client =
    repo.listClients().find((c) => c.name === clientName) ??
    repo.createClient({ name: clientName, color: '#111111' })
  return repo.createEnvironment({
    clientId: client.id,
    name,
    type: 'production',
    deployment: 'saas',
    classicApiUrl: 'https://abc12345.live.dynatrace.com',
    platformUrl: null,
    ssoUrl: null,
    oauthClientId: null,
    oauthScopes: [],
    accountUuid: null,
    certificateLevel: 'system',
    captureUrlPatterns: [],
    tags: [],
    readOnly: false
  }).id
}

function expectDomainError(action: () => unknown, code: string): void {
  let caught: unknown
  try {
    action()
  } catch (error) {
    caught = error
  }
  expect(caught, `se esperaba DomainError ${code}`).toBeInstanceOf(DomainError)
  expect((caught as DomainError).code).toBe(code)
}

const cpu = { name: 'CPU', metricSelector: 'builtin:host.cpu.usage:avg', resolution: '5m' }

describe('migración 0002', () => {
  it('crea saved_metric_queries con borrado en cascada desde environments', () => {
    const table = db.$client
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'saved_metric_queries'"
      )
      .get() as { sql: string } | undefined
    expect(table?.sql).toMatch(/REFERENCES\s+`?environments`?/i)
    expect(table?.sql).toMatch(/ON DELETE cascade/i)
  })
})

describe('createSavedQueryStore', () => {
  it('crea, lista por nombre y devuelve la consulta con su id', () => {
    const envId = createEnvironment('Producción')
    const saved = store.save(envId, cpu)
    store.save(envId, { name: 'Alfa', metricSelector: 'builtin:host.mem.usage', resolution: 'Inf' })

    expect(saved).toMatchObject({ ...cpu, environmentId: envId })
    expect(saved.id).toMatch(/^[0-9a-f-]{36}$/i)
    expect(store.list(envId).map((q) => q.name)).toEqual(['Alfa', 'CPU'])
  })

  it('con id actualiza la existente', () => {
    const envId = createEnvironment('Producción')
    const saved = store.save(envId, cpu)
    const updated = store.save(envId, {
      id: saved.id,
      name: 'CPU media',
      metricSelector: 'x',
      resolution: '1h'
    })

    expect(updated).toMatchObject({
      id: saved.id,
      name: 'CPU media',
      metricSelector: 'x',
      resolution: '1h'
    })
    expect(store.list(envId)).toHaveLength(1)
  })

  it('no admite dos consultas con el mismo nombre en un entorno (sin distinguir mayúsculas)', () => {
    const envId = createEnvironment('Producción')
    const saved = store.save(envId, cpu)
    expectDomainError(() => store.save(envId, { ...cpu, name: 'cpu' }), 'CONFLICT')

    const other = store.save(envId, { ...cpu, name: 'Memoria' })
    expectDomainError(() => store.save(envId, { ...cpu, id: other.id, name: 'CPU' }), 'CONFLICT')
    // Renombrarse a sí misma cambiando mayúsculas no es conflicto.
    expect(store.save(envId, { ...cpu, id: saved.id, name: 'CPU' }).name).toBe('CPU')
  })

  it('el mismo nombre sí vale en otro entorno', () => {
    const prod = createEnvironment('Producción')
    const dev = createEnvironment('Desarrollo')
    store.save(prod, cpu)
    expect(store.save(dev, cpu).environmentId).toBe(dev)
    expect(store.list(prod)).toHaveLength(1)
    expect(store.list(dev)).toHaveLength(1)
  })

  it('da NOT_FOUND con un id que no existe o que es de otro entorno', () => {
    const prod = createEnvironment('Producción')
    const dev = createEnvironment('Desarrollo')
    const saved = store.save(prod, cpu)
    expectDomainError(() => store.save(prod, { ...cpu, id: UNKNOWN_ID }), 'NOT_FOUND')
    expectDomainError(() => store.save(dev, { ...cpu, id: saved.id, name: 'robada' }), 'NOT_FOUND')
    expect(store.list(prod)[0]?.name).toBe('CPU')
  })

  it('delete borra y es idempotente', () => {
    const envId = createEnvironment('Producción')
    const saved = store.save(envId, cpu)
    store.delete(saved.id)
    store.delete(saved.id)
    store.delete(UNKNOWN_ID)
    expect(store.list(envId)).toEqual([])
  })

  it('borrar el entorno o su cliente borra sus consultas', () => {
    const prod = createEnvironment('Producción')
    const dev = createEnvironment('Desarrollo')
    const other = createEnvironment('Producción', 'Cliente B')
    store.save(prod, cpu)
    store.save(dev, cpu)
    store.save(other, cpu)

    repo.deleteEnvironment(prod)
    expect(store.list(prod)).toEqual([])
    expect(store.list(dev)).toHaveLength(1)

    const clientA = repo.listClients().find((c) => c.name === 'Cliente A')
    repo.deleteClient(clientA?.id ?? UNKNOWN_ID)
    expect(store.list(dev)).toEqual([])
    expect(store.list(other)).toHaveLength(1)
  })
})
