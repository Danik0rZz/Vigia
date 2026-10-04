import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ipcContract } from '@shared/ipc'
import type { AppDatabase } from '../db/database'
import { createTenantRepository } from '../tenants/repository'
import { createConnectionHandlers } from './handlers/connection'
import { createExportHandlers } from './handlers/export'
import { createModuleHandlers } from './handlers/modules'
import { createTenantHandlers } from './handlers/tenants'
import { createTestDb } from '../../test/fixtures'

/**
 * Cada canal del contrato IPC tiene que estar cubierto por un test que
 * comprueba que no devuelve secretos, o estar exento con su motivo. Un canal
 * nuevo sin decidir hace fallar este test.
 *
 * Cubiertos:
 * - createTenantHandlers → src/main/ipc/handlers/tenants.test.ts
 * - createConnectionHandlers → src/main/ipc/handlers/connection.test.ts
 * - createModuleHandlers → src/main/ipc/handlers/modules.test.ts
 * - createExportHandlers → src/main/ipc/handlers/export.test.ts
 */

/** Canales que no pasan por esas pruebas, con el motivo. Añadir uno es una decisión. */
const EXEMPT_CHANNELS: Record<string, string> = {
  'app:getInfo': 'Fase 1: nombre, versión y plataforma del runtime; sin datos de tenants',
  'app:ping': 'Fase 1: canal de ejemplo que devuelve el texto recibido',
  'ui:setTheme': 'Fase 2: aplica el tema a nativeTheme; solo recibe light/dark/system',
  'app:openExternal':
    'v0.9.0: abre una URL http(s) validada en el navegador; devuelve { ok: true } sin datos (probado en handlers/app.test.ts)'
}

let db: AppDatabase

beforeEach(() => {
  db = createTestDb()
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
    ),
    modules: Object.keys(
      createModuleHandlers({
        client: { dtRequest: unused, paginate: unused },
        savedQueries: unused,
        repo
      } as unknown as Parameters<typeof createModuleHandlers>[0])
    ),
    export: Object.keys(
      createExportHandlers({
        repo,
        settings: { get: unused, set: unused },
        exportDir: null,
        dialogs: { chooseSaveFile: unused },
        writeFile: unused,
        clipboard: { writeImage: unused },
        window: { size: unused, capturePage: unused },
        now: unused,
        timeZone: unused
      } as unknown as Parameters<typeof createExportHandlers>[0])
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

  it('los canales de módulos y de exportación están en sus factorías', () => {
    const byFactory = coveredByFactory()
    expect([...(byFactory['modules'] ?? [])].sort()).toEqual([
      'metrics:query',
      'metrics:search',
      'problems:get',
      'problems:list',
      'savedQueries:delete',
      'savedQueries:list',
      'savedQueries:save',
      'slos:list'
    ])
    expect([...(byFactory['export'] ?? [])].sort()).toEqual([
      'capture:image',
      'capture:region',
      'export:getSettings',
      'export:setSettings',
      'export:table'
    ])
  })
})
