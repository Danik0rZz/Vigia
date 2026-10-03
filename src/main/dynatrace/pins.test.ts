import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppDatabase } from '../db/database'
import { createTenantRepository } from '../tenants/repository'
import { createPinStore } from './pins'
import { createTestDb } from '../../test/fixtures'

/** Huellas de certificado fijadas por entorno y host (tabla certificate_pins, migración 0001). */

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000'
const PIN_A = 'sha256/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
const PIN_B = 'sha256/BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB='

let db: AppDatabase
let repo: ReturnType<typeof createTenantRepository>
let pins: ReturnType<typeof createPinStore>

beforeEach(() => {
  db = createTestDb()
  repo = createTenantRepository(db)
  pins = createPinStore(db)
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
    certificateLevel: 'pinned',
    captureUrlPatterns: [],
    tags: [],
    readOnly: false
  }).id
}

describe('migración 0001', () => {
  it('crea certificate_pins con clave (environment_id, host) y borrado en cascada', () => {
    const table = db.$client
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'certificate_pins'")
      .get() as { sql: string } | undefined
    expect(table?.sql).toBeDefined()
    expect(table?.sql).toMatch(/PRIMARY KEY\s*\(\s*`?environment_id`?\s*,\s*`?host`?\s*\)/i)
    expect(table?.sql).toMatch(/ON DELETE cascade/i)
  })
})

describe('createPinStore', () => {
  it('empieza vacío', () => {
    const envId = createEnvironment('Producción')
    expect(pins.list(envId)).toEqual([])
    expect(pins.forHost(envId, 'abc12345.live.dynatrace.com')).toEqual([])
  })

  it('fija, lista y devuelve la huella de un host', () => {
    const envId = createEnvironment('Producción')
    pins.pin(envId, 'abc12345.live.dynatrace.com', PIN_A)
    pins.pin(envId, 'sso.dynatrace.com', PIN_B)

    expect([...pins.list(envId)].sort((x, y) => x.host.localeCompare(y.host))).toEqual([
      { host: 'abc12345.live.dynatrace.com', fingerprint: PIN_A },
      { host: 'sso.dynatrace.com', fingerprint: PIN_B }
    ])
    expect(pins.forHost(envId, 'abc12345.live.dynatrace.com')).toEqual([PIN_A])
    expect(pins.forHost(envId, 'otro.host')).toEqual([])
  })

  it('una sola huella por host: fijar otra sustituye la anterior', () => {
    const envId = createEnvironment('Producción')
    pins.pin(envId, '127.0.0.1:8443', PIN_A)
    pins.pin(envId, '127.0.0.1:8443', PIN_B)
    expect(pins.list(envId)).toEqual([{ host: '127.0.0.1:8443', fingerprint: PIN_B }])
  })

  it('unpin quita solo ese host y es idempotente', () => {
    const envId = createEnvironment('Producción')
    pins.pin(envId, 'a.host', PIN_A)
    pins.pin(envId, 'b.host', PIN_B)
    pins.unpin(envId, 'a.host')
    pins.unpin(envId, 'a.host')
    expect(pins.list(envId)).toEqual([{ host: 'b.host', fingerprint: PIN_B }])
  })

  it('las huellas de un entorno no se ven desde otro', () => {
    const prod = createEnvironment('Producción')
    const dev = createEnvironment('Desarrollo')
    pins.pin(prod, 'a.host', PIN_A)
    expect(pins.forHost(dev, 'a.host')).toEqual([])
    expect(pins.list(UNKNOWN_ID)).toEqual([])
  })

  it('borrar el entorno o su cliente borra sus huellas', () => {
    const prod = createEnvironment('Producción')
    const dev = createEnvironment('Desarrollo')
    const other = createEnvironment('Producción', 'Cliente B')
    pins.pin(prod, 'a.host', PIN_A)
    pins.pin(dev, 'a.host', PIN_A)
    pins.pin(other, 'a.host', PIN_B)

    repo.deleteEnvironment(prod)
    expect(pins.list(prod)).toEqual([])
    expect(pins.list(dev)).toHaveLength(1)

    const clientA = repo.listClients().find((c) => c.name === 'Cliente A')
    repo.deleteClient(clientA?.id ?? UNKNOWN_ID)
    expect(pins.list(dev)).toEqual([])
    expect(pins.list(other)).toEqual([{ host: 'a.host', fingerprint: PIN_B }])

    const rows = db.$client.prepare('SELECT count(*) AS n FROM certificate_pins').get() as {
      n: number
    }
    expect(rows.n).toBe(1)
  })
})
