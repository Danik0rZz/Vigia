import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppDatabase } from '../db/database'
import { DomainError } from '../errors'
import { createTenantRepository } from './repository'
import { createTestDb, environmentInput } from '../../test/fixtures'

/**
 * Ficha 0057, CA2: `repo.requireEnvironment(id)`, el nombre que dice lo que hace (los
 * handlers lo llamaban como `getEnvironment` sin usar el resultado, solo para que lance).
 */

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000'

let db: AppDatabase
let repo: ReturnType<typeof createTenantRepository>

beforeEach(() => {
  db = createTestDb()
  repo = createTenantRepository(db)
})

afterEach(() => {
  db.$client.close()
})

describe('CA2 (0057): requireEnvironment', () => {
  it('lanza NOT_FOUND con el motivo environmentMissing si el entorno no existe', async () => {
    let caught: unknown
    try {
      await repo.requireEnvironment(UNKNOWN_ID)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(DomainError)
    expect((caught as DomainError).code).toBe('NOT_FOUND')
    expect((caught as DomainError).reason?.key).toBe('environmentMissing')
  })

  it('con un entorno que existe, no lanza', async () => {
    const client = await repo.createClient({ name: 'Cliente A', color: '#111111' })
    const environment = await repo.createEnvironment(environmentInput(client.id))
    // Si lanzara, el test falla aquí.
    await repo.requireEnvironment(environment.id)
  })

  it('los canales de modules.ts ya no llaman a getEnvironment sin usar el resultado', () => {
    const text = readFileSync(resolve('src/main/ipc/handlers/modules.ts'), 'utf8')
    const bare = text
      .split('\n')
      .filter((line) => /^\s*(?:await\s+)?repo\.getEnvironment\(/.test(line))
    expect(bare).toEqual([])
  })
})
