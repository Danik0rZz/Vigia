import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type AppDatabase } from '../db/database'
import { DomainError } from '../errors'
import { createTenantRepository } from './repository'

/**
 * Repositorio de clientes y entornos sobre SQLite en memoria, con las
 * migraciones reales. Los métodos se llaman con `await` para no depender de
 * si son síncronos o asíncronos.
 */

type Repo = ReturnType<typeof createTenantRepository>
type EnvironmentInput = Parameters<Repo['createEnvironment']>[0]

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

let db: AppDatabase
let repo: Repo

beforeEach(() => {
  db = openDatabase(':memory:', 'src/main/db/migrations')
  repo = createTenantRepository(db)
})

afterEach(() => {
  db.$client.close()
})

function environmentInput(
  clientId: string,
  overrides: Partial<EnvironmentInput> = {}
): EnvironmentInput {
  return {
    clientId,
    name: 'Producción',
    type: 'production',
    deployment: 'saas',
    classicApiUrl: 'https://abc12345.live.dynatrace.com',
    platformUrl: 'https://abc12345.apps.dynatrace.com',
    ssoUrl: null,
    oauthClientId: 'dt0s02.EJEMPLO',
    oauthScopes: ['storage:logs:read', 'storage:buckets:read'],
    accountUuid: null,
    certificateLevel: 'system',
    captureUrlPatterns: ['https://abc12345.apps.dynatrace.com/platform/*'],
    tags: ['core', 'pagos'],
    readOnly: true,
    ...overrides
  } as EnvironmentInput
}

/** Comprueba que `action` lanza (o rechaza con) un DomainError con ese código. */
async function expectDomainError(action: () => unknown, code: string): Promise<void> {
  let caught: unknown
  try {
    await action()
  } catch (error) {
    caught = error
  }
  expect(caught, `se esperaba DomainError ${code}`).toBeInstanceOf(DomainError)
  expect((caught as DomainError).code).toBe(code)
}

describe('openDatabase', () => {
  it('activa las claves foráneas', () => {
    expect(db.$client.pragma('foreign_keys', { simple: true })).toBe(1)
  })

  it('crea la tabla de secretos con las migraciones', () => {
    const tables = db.$client
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as { name: string }[]
    expect(tables.map((table) => table.name)).toContain('secrets')
  })
})

describe('clientes', () => {
  it('crea, lista ordenados por nombre, actualiza y borra', async () => {
    const b = await repo.createClient({ name: 'Cliente B', color: '#222222' })
    const a = await repo.createClient({ name: 'Cliente A', color: '#111111' })
    expect(a.id).toMatch(UUID)
    expect(a).toEqual({ id: a.id, name: 'Cliente A', color: '#111111' })

    expect((await repo.listClients()).map((client) => client.name)).toEqual([
      'Cliente A',
      'Cliente B'
    ])

    const updated = await repo.updateClient(b.id, { name: 'Cliente C', color: '#333333' })
    expect(updated).toEqual({ id: b.id, name: 'Cliente C', color: '#333333' })

    await repo.deleteClient(a.id)
    expect(await repo.listClients()).toEqual([updated])
  })

  it('no admite dos clientes con el mismo nombre, sin distinguir mayúsculas', async () => {
    const a = await repo.createClient({ name: 'Cliente A', color: '#111111' })
    await expectDomainError(
      () => repo.createClient({ name: 'cliente a', color: '#222222' }),
      'CONFLICT'
    )

    const b = await repo.createClient({ name: 'Cliente B', color: '#222222' })
    await expectDomainError(
      () => repo.updateClient(b.id, { name: 'CLIENTE A', color: '#222222' }),
      'CONFLICT'
    )
    // Renombrarse a sí mismo (cambiando mayúsculas) no es un conflicto.
    expect(await repo.updateClient(a.id, { name: 'CLIENTE A', color: '#111111' })).toMatchObject({
      name: 'CLIENTE A'
    })
  })

  it('da NOT_FOUND al actualizar o borrar un cliente que no existe', async () => {
    await expectDomainError(
      () => repo.updateClient(UNKNOWN_ID, { name: 'X', color: '#111111' }),
      'NOT_FOUND'
    )
    await expectDomainError(() => repo.deleteClient(UNKNOWN_ID), 'NOT_FOUND')
  })
})

describe('entornos', () => {
  it('crea con todos los campos, lista, actualiza y borra', async () => {
    const client = await repo.createClient({ name: 'Cliente A', color: '#111111' })
    const input = environmentInput(client.id)

    const created = await repo.createEnvironment(input)
    expect(created.id).toMatch(UUID)
    expect(created).toEqual({ id: created.id, ...input })
    expect(await repo.listEnvironments()).toEqual([created])

    const changes = environmentInput(client.id, {
      name: 'Desarrollo',
      type: 'development',
      deployment: 'managed',
      classicApiUrl: 'https://dt.ejemplo.local/e/abc-123',
      platformUrl: null,
      oauthClientId: null,
      oauthScopes: [],
      accountUuid: null,
      certificateLevel: 'pinned',
      captureUrlPatterns: [],
      tags: [],
      readOnly: false
    })
    const updated = await repo.updateEnvironment(created.id, changes)
    expect(updated).toEqual({ id: created.id, ...changes })
    expect(await repo.listEnvironments()).toEqual([updated])

    await repo.deleteEnvironment(created.id)
    expect(await repo.listEnvironments()).toEqual([])
  })

  it('no repite el nombre dentro de un cliente (sin distinguir mayúsculas), sí entre clientes', async () => {
    const a = await repo.createClient({ name: 'Cliente A', color: '#111111' })
    const b = await repo.createClient({ name: 'Cliente B', color: '#222222' })
    await repo.createEnvironment(environmentInput(a.id, { name: 'Producción' }))

    await expectDomainError(
      () => repo.createEnvironment(environmentInput(a.id, { name: 'producción' })),
      'CONFLICT'
    )
    expect(
      await repo.createEnvironment(environmentInput(b.id, { name: 'Producción' }))
    ).toMatchObject({ clientId: b.id })

    const dev = await repo.createEnvironment(environmentInput(a.id, { name: 'Desarrollo' }))
    await expectDomainError(
      () => repo.updateEnvironment(dev.id, environmentInput(a.id, { name: 'PRODUCCIÓN' })),
      'CONFLICT'
    )
  })

  it('da NOT_FOUND con un cliente o un entorno que no existen', async () => {
    const client = await repo.createClient({ name: 'Cliente A', color: '#111111' })
    await expectDomainError(() => repo.createEnvironment(environmentInput(UNKNOWN_ID)), 'NOT_FOUND')
    await expectDomainError(
      () => repo.updateEnvironment(UNKNOWN_ID, environmentInput(client.id)),
      'NOT_FOUND'
    )
    await expectDomainError(() => repo.deleteEnvironment(UNKNOWN_ID), 'NOT_FOUND')
  })

  it('borrar un cliente borra sus entornos, y solo los suyos', async () => {
    const a = await repo.createClient({ name: 'Cliente A', color: '#111111' })
    const b = await repo.createClient({ name: 'Cliente B', color: '#222222' })
    await repo.createEnvironment(environmentInput(a.id, { name: 'Producción' }))
    await repo.createEnvironment(environmentInput(a.id, { name: 'Desarrollo' }))
    const keep = await repo.createEnvironment(environmentInput(b.id, { name: 'Producción' }))

    await repo.deleteClient(a.id)
    expect(await repo.listEnvironments()).toEqual([keep])
  })
})

describe('entorno activo', () => {
  it('empieza sin entorno activo y guarda el elegido', async () => {
    const client = await repo.createClient({ name: 'Cliente A', color: '#111111' })
    const env = await repo.createEnvironment(environmentInput(client.id))

    expect(await repo.getActiveEnvironmentId()).toBeNull()
    await repo.setActiveEnvironmentId(env.id)
    expect(await repo.getActiveEnvironmentId()).toBe(env.id)
    await repo.setActiveEnvironmentId(null)
    expect(await repo.getActiveEnvironmentId()).toBeNull()
  })

  it('da NOT_FOUND al activar un entorno que no existe y no cambia el activo', async () => {
    const client = await repo.createClient({ name: 'Cliente A', color: '#111111' })
    const env = await repo.createEnvironment(environmentInput(client.id))
    await repo.setActiveEnvironmentId(env.id)

    await expectDomainError(() => repo.setActiveEnvironmentId(UNKNOWN_ID), 'NOT_FOUND')
    expect(await repo.getActiveEnvironmentId()).toBe(env.id)
  })

  it('pasa a null al borrar el entorno activo', async () => {
    const client = await repo.createClient({ name: 'Cliente A', color: '#111111' })
    const env = await repo.createEnvironment(environmentInput(client.id))
    await repo.setActiveEnvironmentId(env.id)

    await repo.deleteEnvironment(env.id)
    expect(await repo.getActiveEnvironmentId()).toBeNull()
  })

  it('pasa a null al borrar el cliente del entorno activo', async () => {
    const client = await repo.createClient({ name: 'Cliente A', color: '#111111' })
    const env = await repo.createEnvironment(environmentInput(client.id))
    await repo.setActiveEnvironmentId(env.id)

    await repo.deleteClient(client.id)
    expect(await repo.getActiveEnvironmentId()).toBeNull()
  })

  it('se mantiene al borrar otro entorno u otro cliente', async () => {
    const a = await repo.createClient({ name: 'Cliente A', color: '#111111' })
    const b = await repo.createClient({ name: 'Cliente B', color: '#222222' })
    const active = await repo.createEnvironment(environmentInput(a.id, { name: 'Producción' }))
    const other = await repo.createEnvironment(environmentInput(a.id, { name: 'Desarrollo' }))
    await repo.createEnvironment(environmentInput(b.id, { name: 'Producción' }))
    await repo.setActiveEnvironmentId(active.id)

    await repo.deleteEnvironment(other.id)
    await repo.deleteClient(b.id)
    expect(await repo.getActiveEnvironmentId()).toBe(active.id)
  })
})

describe('transaction', () => {
  it('deshace todo si la función lanza', async () => {
    expect(() =>
      repo.transaction(() => {
        repo.createClient({ name: 'Cliente A', color: '#111111' })
        throw new Error('fallo a mitad')
      })
    ).toThrow('fallo a mitad')
    expect(await repo.listClients()).toEqual([])
  })
})
