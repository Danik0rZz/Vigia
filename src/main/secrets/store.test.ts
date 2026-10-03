import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDatabase, type AppDatabase } from '../db/database'
import { DomainError } from '../errors'
import { createTenantRepository } from '../tenants/repository'
import { createSecretStore } from './store'

/**
 * Secretos cifrados con safeStorage (aquí, un cifrado falso). En la base solo
 * se guarda el valor cifrado, y sin cifrado disponible no se guarda nada.
 */

const SECRET = 'dt0c01.SECRETOPRUEBA'
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000'

/** Cifrado falso y reversible: invierte el texto y le pone un prefijo. */
function fakeCrypto(available = true): Parameters<typeof createSecretStore>[1] {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (value: string) => Buffer.from(`enc:${[...value].reverse().join('')}`, 'utf8'),
    decryptString: (buffer: Buffer) => [...buffer.toString('utf8').slice(4)].reverse().join('')
  }
}

let db: AppDatabase
let repo: ReturnType<typeof createTenantRepository>

beforeEach(() => {
  db = openDatabase(':memory:', 'src/main/db/migrations')
  repo = createTenantRepository(db)
})

afterEach(() => {
  db.$client.close()
})

async function createEnvironment(
  clientName = 'Cliente A',
  envName = 'Producción'
): Promise<string> {
  const existing = (await repo.listClients()).find((client) => client.name === clientName)
  const client = existing ?? (await repo.createClient({ name: clientName, color: '#111111' }))
  const env = await repo.createEnvironment({
    clientId: client.id,
    name: envName,
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
  })
  return env.id
}

/** Todas las filas de la tabla `secrets`, tal como están en disco. */
function secretRows(): Record<string, unknown>[] {
  return db.$client.prepare('SELECT * FROM secrets').all() as Record<string, unknown>[]
}

/** Texto de todas las columnas de las filas, para buscar el secreto en claro. */
function dumpRows(rows: Record<string, unknown>[]): string {
  return rows
    .flatMap((row) =>
      Object.values(row).map((value) =>
        Buffer.isBuffer(value)
          ? `${value.toString('utf8')} ${value.toString('latin1')}`
          : String(value)
      )
    )
    .join('\n')
}

async function expectDomainError(action: () => unknown, code: string): Promise<DomainError> {
  let caught: unknown
  try {
    await action()
  } catch (error) {
    caught = error
  }
  expect(caught, `se esperaba DomainError ${code}`).toBeInstanceOf(DomainError)
  expect((caught as DomainError).code).toBe(code)
  return caught as DomainError
}

const NONE = { classicToken: false, oauthClientSecret: false, platformToken: false }

describe('createSecretStore', () => {
  it('guarda, informa del estado, lee y borra un secreto', async () => {
    const envId = await createEnvironment()
    const store = createSecretStore(db, fakeCrypto())

    expect(await store.isAvailable()).toBe(true)
    expect(await store.status(envId)).toEqual(NONE)

    await store.set(envId, 'classicToken', `  ${SECRET}  `)
    expect(await store.status(envId)).toEqual({ ...NONE, classicToken: true })
    expect(await store.read(envId, 'classicToken')).toBe(SECRET)
    expect(await store.read(envId, 'platformToken')).toBeNull()

    await store.set(envId, 'classicToken', 'dt0c01.OTRO')
    expect(await store.read(envId, 'classicToken')).toBe('dt0c01.OTRO')

    await store.delete(envId, 'classicToken')
    expect(await store.status(envId)).toEqual(NONE)
    expect(await store.read(envId, 'classicToken')).toBeNull()
  })

  it('en la base solo está el valor cifrado, nunca en claro', async () => {
    const envId = await createEnvironment()
    const store = createSecretStore(db, fakeCrypto())

    await store.set(envId, 'classicToken', SECRET)
    await store.set(envId, 'oauthClientSecret', 'dt0s02.SECRETOOAUTH')

    const rows = secretRows()
    expect(rows).toHaveLength(2)
    const dump = dumpRows(rows)
    expect(dump).not.toContain(SECRET)
    expect(dump).not.toContain('SECRETOOAUTH')
    // El cifrado falso sí está: se guardó lo que devolvió encryptString.
    expect(dump).toContain('enc:')
  })

  it('sin cifrado disponible no guarda nada y da ENCRYPTION_UNAVAILABLE', async () => {
    const envId = await createEnvironment()
    const store = createSecretStore(db, fakeCrypto(false))

    expect(await store.isAvailable()).toBe(false)
    const error = await expectDomainError(
      () => store.set(envId, 'classicToken', SECRET),
      'ENCRYPTION_UNAVAILABLE'
    )
    expect(error.message).not.toContain(SECRET)
    expect(secretRows()).toEqual([])
    expect(await store.status(envId)).toEqual(NONE)
  })

  it.each([
    ['vacío', ''],
    ['solo espacios', '    '],
    ['de más de 4096 caracteres', 'x'.repeat(4097)]
  ])('rechaza un valor %s', async (_case, value) => {
    const envId = await createEnvironment()
    const store = createSecretStore(db, fakeCrypto())

    let caught: unknown
    try {
      await store.set(envId, 'classicToken', value)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeDefined()
    expect(secretRows()).toEqual([])
  })

  it('acepta un valor de 4096 caracteres', async () => {
    const envId = await createEnvironment()
    const store = createSecretStore(db, fakeCrypto())
    await store.set(envId, 'classicToken', 'x'.repeat(4096))
    expect(await store.status(envId)).toEqual({ ...NONE, classicToken: true })
  })

  it('da NOT_FOUND al guardar en un entorno que no existe', async () => {
    const store = createSecretStore(db, fakeCrypto())
    await expectDomainError(() => store.set(UNKNOWN_ID, 'classicToken', SECRET), 'NOT_FOUND')
    expect(secretRows()).toEqual([])
  })

  it('status de un entorno que no existe es todo false y delete es idempotente', async () => {
    const store = createSecretStore(db, fakeCrypto())
    expect(await store.status(UNKNOWN_ID)).toEqual(NONE)
    // Si lanzara, la prueba fallaría aquí.
    await store.delete(UNKNOWN_ID, 'classicToken')
  })

  it('borrar el entorno borra sus secretos, y solo los suyos', async () => {
    const envId = await createEnvironment('Cliente A', 'Producción')
    const otherId = await createEnvironment('Cliente A', 'Desarrollo')
    const store = createSecretStore(db, fakeCrypto())
    await store.set(envId, 'classicToken', SECRET)
    await store.set(envId, 'platformToken', 'dt0s16.OTRO')
    await store.set(otherId, 'classicToken', 'dt0c01.QUEDA')

    await repo.deleteEnvironment(envId)

    expect(await store.status(envId)).toEqual(NONE)
    expect(await store.status(otherId)).toEqual({ ...NONE, classicToken: true })
    expect(secretRows()).toHaveLength(1)
  })

  it('borrar el cliente borra los secretos de todos sus entornos', async () => {
    const envId = await createEnvironment('Cliente A', 'Producción')
    const otherId = await createEnvironment('Cliente A', 'Desarrollo')
    const keepId = await createEnvironment('Cliente B', 'Producción')
    const store = createSecretStore(db, fakeCrypto())
    await store.set(envId, 'classicToken', SECRET)
    await store.set(otherId, 'oauthClientSecret', 'dt0s02.OTRO')
    await store.set(keepId, 'classicToken', 'dt0c01.QUEDA')

    const clientA = (await repo.listClients()).find((client) => client.name === 'Cliente A')
    await repo.deleteClient(clientA?.id ?? UNKNOWN_ID)

    expect(await store.status(envId)).toEqual(NONE)
    expect(await store.status(otherId)).toEqual(NONE)
    expect(await store.status(keepId)).toEqual({ ...NONE, classicToken: true })
    expect(secretRows()).toHaveLength(1)
  })
})

describe('AUD-05: secretos que no se pueden descifrar', () => {
  /** Cifrado que guarda bien pero no sabe descifrar (otro equipo u otro usuario de Windows). */
  function brokenCrypto(): Parameters<typeof createSecretStore>[1] & {
    decryptString: ReturnType<typeof vi.fn>
  } {
    return {
      ...fakeCrypto(),
      decryptString: vi.fn(() => {
        throw new Error(`DPAPI: clave de otro usuario; datos ${SECRET}`)
      })
    }
  }

  it('read lanza SECRET_UNREADABLE sin el error original y lo marca', async () => {
    const envId = await createEnvironment()
    const store = createSecretStore(db, brokenCrypto())
    await store.set(envId, 'classicToken', SECRET)

    const error = await expectDomainError(
      () => store.read(envId, 'classicToken'),
      'SECRET_UNREADABLE'
    )
    expect(error.message).not.toContain(SECRET)
    expect(error.message).not.toContain('DPAPI')
    expect(JSON.stringify({ ...error, message: error.message })).not.toContain(SECRET)
    expect(await store.unreadable(envId)).toEqual(['classicToken'])
  })

  it('unreadable() sigue el orden de secretKinds y es por entorno', async () => {
    const envId = await createEnvironment('Cliente A', 'Producción')
    const otherId = await createEnvironment('Cliente A', 'Desarrollo')
    const store = createSecretStore(db, brokenCrypto())
    for (const kind of ['platformToken', 'classicToken'] as const) {
      await store.set(envId, kind, SECRET)
      await expectDomainError(() => store.read(envId, kind), 'SECRET_UNREADABLE')
    }
    expect(await store.unreadable(envId)).toEqual(['classicToken', 'platformToken'])
    expect(await store.unreadable(otherId)).toEqual([])
  })

  it('set y delete del mismo secreto borran la marca', async () => {
    const envId = await createEnvironment()
    const store = createSecretStore(db, brokenCrypto())
    await store.set(envId, 'classicToken', SECRET)
    await store.set(envId, 'platformToken', SECRET)
    await expectDomainError(() => store.read(envId, 'classicToken'), 'SECRET_UNREADABLE')
    await expectDomainError(() => store.read(envId, 'platformToken'), 'SECRET_UNREADABLE')

    await store.set(envId, 'classicToken', 'dt0c01.NUEVO')
    expect(await store.unreadable(envId)).toEqual(['platformToken'])
    await store.delete(envId, 'platformToken')
    expect(await store.unreadable(envId)).toEqual([])
  })

  it('status no descifra nunca y sigue devolviendo booleanos', async () => {
    const envId = await createEnvironment()
    const crypto = brokenCrypto()
    const store = createSecretStore(db, crypto)
    await store.set(envId, 'classicToken', SECRET)
    expect(await store.status(envId)).toEqual({ ...NONE, classicToken: true })
    expect(crypto.decryptString).not.toHaveBeenCalled()
  })

  it('un read que funciona no marca nada', async () => {
    const envId = await createEnvironment()
    const store = createSecretStore(db, fakeCrypto())
    await store.set(envId, 'classicToken', SECRET)
    expect(await store.read(envId, 'classicToken')).toBe(SECRET)
    expect(await store.unreadable(envId)).toEqual([])
  })
})
