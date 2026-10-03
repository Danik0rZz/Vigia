import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ipcContract } from '@shared/ipc'
import { openDatabase, type AppDatabase } from '../db/database'
import { createTenantRepository } from '../tenants/repository'
import { createConnectionHandlers } from './handlers/connection'
import { createTenantHandlers } from './handlers/tenants'

/**
 * Cada canal del contrato IPC tiene que estar cubierto por un test que
 * comprueba que no devuelve secretos, o estar exento con su motivo. Un canal
 * nuevo sin decidir hace fallar este test.
 *
 * Cubiertos:
 * - createTenantHandlers → src/main/ipc/handlers/tenants.test.ts
 * - createConnectionHandlers → src/main/ipc/handlers/connection.test.ts
 */

/** Canales que no pasan por esas pruebas, con el motivo. Añadir uno es una decisión. */
const EXEMPT_CHANNELS: Record<string, string> = {
  'app:getInfo': 'Fase 1: nombre, versión y plataforma del runtime; sin datos de tenants',
  'app:ping': 'Fase 1: canal de ejemplo que devuelve el texto recibido',
  'ui:setTheme': 'Fase 2: aplica el tema a nativeTheme; solo recibe light/dark/system'
}

let db: AppDatabase

beforeEach(() => {
  db = openDatabase(':memory:', 'src/main/db/migrations')
})

afterEach(() => {
  db.$client.close()
})

/** Canales que implementa cada factoría (las dependencias no se usan al construirlas). */
function coveredByFactory(): Record<string, string[]> {
  const repo = createTenantRepository(db)
  const unused = (): never => {
    throw new Error('no se usa al construir')
  }
  return {
    tenants: Object.keys(
      createTenantHandlers({
        repo,
        secrets: unused,
        dialogs: { chooseSaveFile: unused, chooseOpenFile: unused },
        statFile: unused,
        readFile: unused,
        writeFile: unused
      } as unknown as Parameters<typeof createTenantHandlers>[0])
    ),
    connection: Object.keys(
      createConnectionHandlers({
        testConnection: unused,
        status: { get: unused, set: unused, clear: unused },
        pins: unused,
        repo,
        onChanged: unused
      } as unknown as Parameters<typeof createConnectionHandlers>[0])
    )
  }
}

describe('cobertura de los canales IPC', () => {
  it('todo canal del contrato está cubierto por un test de secretos o exento con motivo', () => {
    const contract = Object.keys(ipcContract)
    const byFactory = coveredByFactory()
    const covered = Object.values(byFactory).flat()
    const exempt = Object.keys(EXEMPT_CHANNELS)

    expect(
      contract.filter((channel) => !covered.includes(channel) && !exempt.includes(channel)),
      'canales sin cubrir ni eximir'
    ).toEqual([])
    expect(
      covered.filter((channel) => !contract.includes(channel)),
      'handlers fuera del contrato'
    ).toEqual([])
    expect(
      exempt.filter((channel) => !contract.includes(channel)),
      'exentos que ya no existen'
    ).toEqual([])
    expect(
      covered.filter((channel) => exempt.includes(channel)),
      'cubiertos y exentos a la vez'
    ).toEqual([])
    expect(new Set(covered).size, 'un canal en dos factorías').toBe(covered.length)
  })

  it('cada exento tiene un motivo', () => {
    for (const [channel, reason] of Object.entries(EXEMPT_CHANNELS)) {
      expect(reason.trim().length, channel).toBeGreaterThan(10)
    }
  })

  it('los canales de conexión y certificados están en createConnectionHandlers', () => {
    expect([...(coveredByFactory()['connection'] ?? [])].sort()).toEqual([
      'certificates:list',
      'certificates:pin',
      'certificates:unpin',
      'connection:status',
      'connection:test'
    ])
  })
})
