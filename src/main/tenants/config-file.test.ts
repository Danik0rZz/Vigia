import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppDatabase } from '../db/database'
import { DomainError } from '../errors'
import { createSecretStore } from '../secrets/store'
import { applyConfigImport, buildConfigExport, parseConfigFile } from './config-file'
import { createTenantRepository } from './repository'
import { createTestDb, fakeCrypto } from '../../test/fixtures'

/**
 * Exportar e importar la configuración de clientes y entornos en JSON, sin
 * ids ni secretos.
 */

type Repo = ReturnType<typeof createTenantRepository>
type EnvironmentInput = Parameters<Repo['createEnvironment']>[0]

const SECRET = 'dt0c01.SECRETOPRUEBA'
const NOW = new Date('2026-10-03T10:00:00.000Z')

let databases: AppDatabase[] = []

function freshRepo(): { db: AppDatabase; repo: Repo } {
  const db = createTestDb()
  databases.push(db)
  return { db, repo: createTenantRepository(db) }
}

beforeEach(() => {
  databases = []
})

afterEach(() => {
  for (const db of databases) db.$client.close()
})

/** Entorno sin clientId, tal como va en el fichero. */
function fileEnvironment(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'Producción',
    type: 'production',
    deployment: 'saas',
    classicApiUrl: 'https://abc12345.live.dynatrace.com',
    platformUrl: 'https://abc12345.apps.dynatrace.com',
    ssoUrl: null,
    oauthClientId: 'dt0s02.EJEMPLO',
    oauthScopes: ['storage:logs:read'],
    accountUuid: null,
    certificateLevel: 'system',
    captureUrlPatterns: [],
    tags: ['core'],
    readOnly: false,
    ...overrides
  }
}

function configFile(clients: unknown[]): Record<string, unknown> {
  return { format: 'vigia-config', version: 1, exportedAt: NOW.toISOString(), clients }
}

/** Claves de todos los objetos anidados. */
function allKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(allKeys)
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) => [key, ...allKeys(child)])
  }
  return []
}

async function seed(repo: Repo): Promise<void> {
  const a = await repo.createClient({ name: 'Cliente A', color: '#111111' })
  const b = await repo.createClient({ name: 'Cliente B', color: '#222222' })
  await repo.createEnvironment({ clientId: a.id, ...fileEnvironment() } as EnvironmentInput)
  await repo.createEnvironment({
    clientId: a.id,
    ...fileEnvironment({ name: 'Desarrollo', type: 'development', tags: [] })
  } as EnvironmentInput)
  await repo.createEnvironment({
    clientId: b.id,
    ...fileEnvironment({
      name: 'Integración',
      type: 'integration',
      deployment: 'managed',
      classicApiUrl: 'https://dt.ejemplo.local/e/abc-123',
      platformUrl: null,
      oauthClientId: null,
      oauthScopes: [],
      readOnly: true
    })
  } as EnvironmentInput)
}

describe('buildConfigExport', () => {
  it('agrupa los entornos por cliente, sin ids', async () => {
    const { repo } = freshRepo()
    await seed(repo)

    const file = buildConfigExport(await repo.listClients(), await repo.listEnvironments(), NOW)

    expect(file).toEqual({
      format: 'vigia-config',
      version: 1,
      exportedAt: NOW.toISOString(),
      clients: [
        {
          name: 'Cliente A',
          color: '#111111',
          environments: expect.arrayContaining([
            fileEnvironment(),
            fileEnvironment({ name: 'Desarrollo', type: 'development', tags: [] })
          ])
        },
        {
          name: 'Cliente B',
          color: '#222222',
          environments: [
            fileEnvironment({
              name: 'Integración',
              type: 'integration',
              deployment: 'managed',
              classicApiUrl: 'https://dt.ejemplo.local/e/abc-123',
              platformUrl: null,
              oauthClientId: null,
              oauthScopes: [],
              readOnly: true
            })
          ]
        }
      ]
    })
    expect(file.clients[0]?.environments).toHaveLength(2)
    expect(allKeys(file).filter((key) => /^(id|clientId)$/.test(key))).toEqual([])
  })

  it('no contiene secretos aunque los haya guardados (OBLIGATORIO)', async () => {
    const { db, repo } = freshRepo()
    await seed(repo)
    const store = createSecretStore(db, fakeCrypto())
    for (const env of await repo.listEnvironments()) {
      await store.set(env.id, 'classicToken', SECRET)
      await store.set(env.id, 'oauthClientSecret', 'dt0s02.SECRETOOAUTH')
      await store.set(env.id, 'platformToken', 'dt0s16.SECRETOPLATFORM')
    }

    const json = JSON.stringify(
      buildConfigExport(await repo.listClients(), await repo.listEnvironments(), NOW)
    )

    for (const secret of [SECRET, 'SECRETOOAUTH', 'SECRETOPLATFORM', 'enc:']) {
      expect(json).not.toContain(secret)
    }
    const keys = allKeys(JSON.parse(json))
    expect(keys.filter((key) => /token|secret/i.test(key))).toEqual([])
  })

  it('el fichero exportado pasa parseConfigFile y se importa igual en otra base', async () => {
    const source = freshRepo()
    await seed(source.repo)
    const exported = JSON.parse(
      JSON.stringify(
        buildConfigExport(
          await source.repo.listClients(),
          await source.repo.listEnvironments(),
          NOW
        )
      )
    ) as unknown

    const target = freshRepo()
    const summary = await applyConfigImport(target.repo, parseConfigFile(exported))

    expect(summary).toEqual({
      created: { clients: 2, environments: 3 },
      skipped: [],
      errors: []
    })
    const strip = (envs: Record<string, unknown>[]): unknown[] =>
      envs
        .map((env) => {
          const rest: Record<string, unknown> = { ...env }
          delete rest['id']
          delete rest['clientId']
          return rest
        })
        .sort((x, y) => String(x['name']).localeCompare(String(y['name'])))
    expect(strip(await target.repo.listEnvironments())).toEqual(
      strip(await source.repo.listEnvironments())
    )
    expect((await target.repo.listClients()).map(({ name, color }) => ({ name, color }))).toEqual(
      (await source.repo.listClients()).map(({ name, color }) => ({ name, color }))
    )
  })
})

describe('parseConfigFile', () => {
  const valid = configFile([
    { name: 'Cliente A', color: '#111111', environments: [fileEnvironment()] }
  ])

  it('acepta un fichero válido', () => {
    expect(parseConfigFile(valid)).toMatchObject({ format: 'vigia-config', version: 1 })
  })

  it.each([
    ['versión 2', { ...valid, version: 2 }],
    ['otro formato', { ...valid, format: 'otra-app' }],
    ['exportedAt que no es ISO', { ...valid, exportedAt: 'ayer' }],
    ['un cliente sin nombre', configFile([{ color: '#111111', environments: [] }])],
    ['un cliente con color inválido', configFile([{ name: 'A', color: 'rojo', environments: [] }])],
    ['algo que no es un objeto', 'texto'],
    ['null', null]
  ])('lanza INVALID_INPUT con %s', (_case, raw) => {
    let caught: unknown
    try {
      parseConfigFile(raw)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(DomainError)
    expect((caught as DomainError).code).toBe('INVALID_INPUT')
  })

  it('una URL http en un entorno no hace fallar el fichero (va a errors al importar)', () => {
    const raw = configFile([
      {
        name: 'Cliente A',
        color: '#111111',
        environments: [fileEnvironment({ classicApiUrl: 'http://abc12345.live.dynatrace.com' })]
      }
    ])
    expect(() => parseConfigFile(raw)).not.toThrow()
  })
})

describe('applyConfigImport', () => {
  it('crea clientes y entornos en una base vacía', async () => {
    const { repo } = freshRepo()
    const summary = await applyConfigImport(
      repo,
      parseConfigFile(
        configFile([
          {
            name: 'Cliente A',
            color: '#111111',
            environments: [fileEnvironment(), fileEnvironment({ name: 'Desarrollo' })]
          },
          { name: 'Cliente B', color: '#222222', environments: [] }
        ])
      )
    )

    expect(summary).toEqual({ created: { clients: 2, environments: 2 }, skipped: [], errors: [] })
    expect((await repo.listClients()).map((client) => client.name)).toEqual([
      'Cliente A',
      'Cliente B'
    ])
    expect(await repo.listEnvironments()).toHaveLength(2)
  })

  it('un cliente que ya existe (sin distinguir mayúsculas) no se toca y recibe los entornos nuevos', async () => {
    const { repo } = freshRepo()
    const existing = await repo.createClient({ name: 'Cliente A', color: '#abcdef' })

    const summary = await applyConfigImport(
      repo,
      parseConfigFile(
        configFile([{ name: 'CLIENTE A', color: '#111111', environments: [fileEnvironment()] }])
      )
    )

    // Ha recibido un entorno nuevo: no cuenta como saltado.
    expect(summary.created).toEqual({ clients: 0, environments: 1 })
    expect(summary.skipped).toEqual([])
    expect(await repo.listClients()).toEqual([existing])
    expect(await repo.listEnvironments()).toEqual([
      expect.objectContaining({ clientId: existing.id, name: 'Producción' })
    ])
  })

  it('un entorno que ya existe en ese cliente (sin distinguir mayúsculas) se salta', async () => {
    const { repo } = freshRepo()
    const client = await repo.createClient({ name: 'Cliente A', color: '#111111' })
    const env = await repo.createEnvironment({
      clientId: client.id,
      ...fileEnvironment({ tags: ['original'] })
    } as EnvironmentInput)

    const summary = await applyConfigImport(
      repo,
      parseConfigFile(
        configFile([
          {
            name: 'Cliente A',
            color: '#111111',
            environments: [
              fileEnvironment({ name: 'PRODUCCIÓN', tags: ['importado'] }),
              fileEnvironment({ name: 'Desarrollo' })
            ]
          }
        ])
      )
    )

    // El cliente recibe Desarrollo, así que solo se salta el entorno repetido.
    expect(summary.created).toEqual({ clients: 0, environments: 1 })
    expect(summary.skipped).toEqual([{ kind: 'environment', name: 'PRODUCCIÓN' }])
    // El existente no se modifica.
    expect((await repo.listEnvironments()).find((e) => e.id === env.id)).toEqual(env)
  })

  it.each([
    ['todos sus entornos ya existen', [fileEnvironment({ name: 'producción' })]],
    [
      'todos sus entornos dan error',
      [fileEnvironment({ name: 'Mal', classicApiUrl: 'http://abc12345.live.dynatrace.com' })]
    ],
    ['no trae entornos', []]
  ])(
    'un cliente que ya existe va a skipped si no recibe ningún entorno nuevo: %s',
    async (_case, environments) => {
      const { repo } = freshRepo()
      const client = await repo.createClient({ name: 'Cliente A', color: '#111111' })
      await repo.createEnvironment({
        clientId: client.id,
        ...fileEnvironment()
      } as EnvironmentInput)

      const summary = await applyConfigImport(
        repo,
        parseConfigFile(configFile([{ name: 'cliente a', color: '#222222', environments }]))
      )

      expect(summary.created).toEqual({ clients: 0, environments: 0 })
      expect(summary.skipped).toContainEqual({ kind: 'client', name: 'cliente a' })
      expect(await repo.listClients()).toEqual([client])
    }
  )

  it('un entorno inválido va a errors y el resto se importa', async () => {
    const { repo } = freshRepo()

    const summary = await applyConfigImport(
      repo,
      parseConfigFile(
        configFile([
          {
            name: 'Cliente A',
            color: '#111111',
            environments: [
              fileEnvironment({ name: 'Mal', classicApiUrl: 'http://abc12345.live.dynatrace.com' }),
              fileEnvironment({ name: 'Managed con plataforma', deployment: 'managed' }),
              fileEnvironment({ name: 'Bien' })
            ]
          }
        ])
      )
    )

    expect(summary.created).toEqual({ clients: 1, environments: 1 })
    expect(summary.errors.map((error) => error.name).sort()).toEqual([
      'Mal',
      'Managed con plataforma'
    ])
    for (const error of summary.errors) {
      expect(typeof error.message).toBe('string')
      expect(error.message.length).toBeGreaterThan(0)
    }
    expect((await repo.listEnvironments()).map((e) => e.name)).toEqual(['Bien'])
  })

  it('un error inesperado deshace toda la importación y se relanza', async () => {
    const { repo } = freshRepo()
    let calls = 0
    // Repositorio real con createEnvironment roto en la segunda llamada.
    const broken = new Proxy(repo, {
      get(target, property, receiver) {
        if (property === 'createEnvironment') {
          return (input: EnvironmentInput) => {
            calls += 1
            if (calls === 2) throw new Error('disco lleno')
            return target.createEnvironment(input)
          }
        }
        const value = Reflect.get(target, property, receiver) as unknown
        return typeof value === 'function' ? value.bind(target) : value
      }
    })

    let caught: unknown
    try {
      await applyConfigImport(
        broken,
        parseConfigFile(
          configFile([
            {
              name: 'Cliente A',
              color: '#111111',
              environments: [fileEnvironment(), fileEnvironment({ name: 'Desarrollo' })]
            }
          ])
        )
      )
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(Error)
    expect(caught).not.toBeInstanceOf(DomainError)
    expect(await repo.listClients()).toEqual([])
    expect(await repo.listEnvironments()).toEqual([])
  })
})
