import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { ipcContract, type IpcChannel } from '@shared/ipc'
import { openDatabase, type AppDatabase } from '../../db/database'
import { createSecretStore } from '../../secrets/store'
import { MAX_CONFIG_FILE_BYTES } from '../../tenants/config-file'
import { createTenantRepository } from '../../tenants/repository'
import { createIpcHandler, type IpcHandlerDeps, type IpcImplementation } from '../handler'
import { createTenantHandlers } from './tenants'

/**
 * ACEPTACIÓN DE LA FASE 3: ningún canal IPC devuelve secretos al renderer.
 *
 * Se llama a todos los canales del contrato (salvo `app:*`) pasando por
 * `createIpcHandler`, como en la app, con SQLite en memoria, un cifrado falso
 * y diálogos falsos, y con un secreto conocido guardado.
 */

const SECRET = 'dt0c01.SECRETOPRUEBA'
const TRUSTED = { url: 'app://vigia/index.html', isMainFrame: true }

function fakeCrypto(available: boolean): Parameters<typeof createSecretStore>[1] {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (value: string) => Buffer.from(`enc:${[...value].reverse().join('')}`, 'utf8'),
    decryptString: (buffer: Buffer) => [...buffer.toString('utf8').slice(4)].reverse().join('')
  }
}

/** Texto de todo lo registrado en el log, para buscar el secreto. */
function loggedText(deps: IpcHandlerDeps): string {
  const calls = [
    ...vi.mocked(deps.logger.warn).mock.calls,
    ...vi.mocked(deps.logger.error).mock.calls
  ]
  return calls
    .flat()
    .map((arg) =>
      arg instanceof Error ? `${arg.message} ${arg.stack ?? ''}` : (JSON.stringify(arg) ?? '')
    )
    .join('\n')
}

let db: AppDatabase
let files: Map<string, string>
/** Tamaño que devuelve statFile si se quiere simular otro distinto del contenido. */
let fakeSizes: Map<string, number>
let readCalls: string[]
let saveTarget: string | null
let openTarget: string | null
let deps: IpcHandlerDeps
let calledChannels: Set<string>
let environmentChanged: Mock<(envId: string) => void>
let outputs: string[]

function buildHandlers(encryptionAvailable: boolean): ReturnType<typeof createTenantHandlers> {
  const repo = createTenantRepository(db)
  return createTenantHandlers({
    repo,
    secrets: createSecretStore(db, fakeCrypto(encryptionAvailable)),
    dialogs: {
      chooseSaveFile: async () => saveTarget,
      chooseOpenFile: async () => openTarget
    },
    statFile: async (path: string) => {
      const content = files.get(path)
      if (content === undefined) throw new Error(`no existe ${path}`)
      return { size: fakeSizes.get(path) ?? Buffer.byteLength(content, 'utf8') }
    },
    readFile: async (path: string) => {
      readCalls.push(path)
      const content = files.get(path)
      if (content === undefined) throw new Error(`no existe ${path}`)
      return content
    },
    writeFile: async (path: string, content: string) => {
      files.set(path, content)
    },
    onEnvironmentChanged: environmentChanged
  })
}

/** Llama a un canal como lo haría el renderer y guarda la salida para revisarla. */
async function call(
  handlers: ReturnType<typeof createTenantHandlers>,
  channel: IpcChannel,
  input?: unknown
): Promise<{ ok: boolean; data?: unknown; error?: { code: string; message: string } }> {
  const implementation = (handlers as Record<string, unknown>)[channel] as IpcImplementation<
    typeof channel
  >
  expect(implementation, `implementación de ${channel}`).toBeTypeOf('function')
  const handler = createIpcHandler(channel, implementation, deps)
  const result = (await handler(TRUSTED, input)) as {
    ok: boolean
    data?: unknown
    error?: { code: string; message: string }
  }
  calledChannels.add(channel)
  outputs.push(`${channel}: ${JSON.stringify(result)}`)
  return result
}

beforeEach(() => {
  db = openDatabase(':memory:', 'src/main/db/migrations')
  files = new Map()
  fakeSizes = new Map()
  readCalls = []
  saveTarget = 'C:/datos/vigia-config.json'
  openTarget = 'C:/datos/vigia-config.json'
  deps = {
    isTrustedSender: () => true,
    logger: { warn: vi.fn(), error: vi.fn() }
  }
  calledChannels = new Set()
  environmentChanged = vi.fn<(envId: string) => void>()
  outputs = []
})

afterEach(() => {
  db.$client.close()
})

const environmentFields = {
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
  tags: [],
  readOnly: false
}

describe('aceptación de la Fase 3: ningún canal devuelve secretos', () => {
  it('recorre todos los canales con un secreto guardado y ninguna salida lo contiene', async () => {
    const handlers = buildHandlers(true)

    // Clientes y entornos.
    expect(await call(handlers, 'tenants:list')).toEqual({
      ok: true,
      data: { clients: [], environments: [] }
    })
    const created = await call(handlers, 'clients:create', { name: 'Cliente A', color: '#111111' })
    expect(created).toMatchObject({ ok: true, data: { name: 'Cliente A', color: '#111111' } })
    const clientId = (created.data as { id: string }).id

    expect(
      await call(handlers, 'clients:update', { id: clientId, name: 'Cliente A', color: '#222222' })
    ).toMatchObject({ ok: true, data: { id: clientId, color: '#222222' } })

    const env = await call(handlers, 'environments:create', { clientId, ...environmentFields })
    expect(env).toMatchObject({
      ok: true,
      data: {
        clientId,
        name: 'Producción',
        secrets: { classicToken: false, oauthClientSecret: false, platformToken: false }
      }
    })
    const environmentId = (env.data as { id: string }).id

    expect(
      await call(handlers, 'environments:update', {
        id: environmentId,
        clientId,
        ...environmentFields,
        tags: ['core']
      })
    ).toMatchObject({ ok: true, data: { id: environmentId, tags: ['core'] } })

    // Secretos.
    expect(await call(handlers, 'secrets:availability')).toEqual({
      ok: true,
      data: { available: true }
    })
    expect(
      await call(handlers, 'secrets:set', { environmentId, kind: 'classicToken', value: SECRET })
    ).toEqual({ ok: true, data: { configured: true } })
    expect(
      await call(handlers, 'secrets:set', {
        environmentId,
        kind: 'platformToken',
        value: 'dt0s16.SECRETOPLATFORM'
      })
    ).toEqual({ ok: true, data: { configured: true } })

    const listed = await call(handlers, 'tenants:list')
    expect(listed).toMatchObject({
      ok: true,
      data: {
        environments: [
          {
            id: environmentId,
            secrets: { classicToken: true, oauthClientSecret: false, platformToken: true }
          }
        ]
      }
    })

    // Entorno activo.
    expect(await call(handlers, 'environments:getActive')).toEqual({
      ok: true,
      data: { environmentId: null }
    })
    expect(await call(handlers, 'environments:setActive', { environmentId })).toEqual({
      ok: true,
      data: { environmentId }
    })
    expect(await call(handlers, 'environments:getActive')).toEqual({
      ok: true,
      data: { environmentId }
    })

    // Exportar: cancelado y guardado. El fichero escrito tampoco lleva secretos.
    saveTarget = null
    expect(await call(handlers, 'config:export')).toEqual({
      ok: true,
      data: { status: 'cancelled' }
    })
    expect(files.size).toBe(0)
    saveTarget = 'C:/datos/vigia-config.json'
    expect(await call(handlers, 'config:export')).toEqual({ ok: true, data: { status: 'saved' } })
    const written = files.get('C:/datos/vigia-config.json') ?? ''
    expect(JSON.parse(written)).toMatchObject({ format: 'vigia-config', version: 1 })
    expect(written).not.toContain(SECRET)
    expect(written).not.toContain('SECRETOPLATFORM')

    // Importar: cancelado, y el mismo fichero (todo existe ya, así que todo se salta).
    openTarget = null
    expect(await call(handlers, 'config:import')).toEqual({
      ok: true,
      data: { status: 'cancelled' }
    })
    openTarget = 'C:/datos/vigia-config.json'
    expect(await call(handlers, 'config:import')).toMatchObject({
      ok: true,
      data: {
        status: 'done',
        summary: {
          created: { clients: 0, environments: 0 },
          skipped: expect.arrayContaining([
            { kind: 'client', name: 'Cliente A' },
            { kind: 'environment', name: 'Producción' }
          ]),
          errors: []
        }
      }
    })

    // Errores de dominio: llegan con su código y sin el secreto.
    expect(
      await call(handlers, 'clients:create', { name: 'cliente a', color: '#333333' })
    ).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
    expect(
      await call(handlers, 'secrets:set', {
        environmentId: '00000000-0000-4000-8000-000000000000',
        kind: 'classicToken',
        value: SECRET
      })
    ).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
    expect(
      await call(handlers, 'environments:delete', { id: '00000000-0000-4000-8000-000000000000' })
    ).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })

    // Sin cifrado disponible.
    const noCrypto = buildHandlers(false)
    expect(await call(noCrypto, 'secrets:availability')).toEqual({
      ok: true,
      data: { available: false }
    })
    expect(
      await call(noCrypto, 'secrets:set', {
        environmentId,
        kind: 'oauthClientSecret',
        value: SECRET
      })
    ).toMatchObject({ ok: false, error: { code: 'ENCRYPTION_UNAVAILABLE' } })

    // Borrados.
    expect(
      await call(handlers, 'secrets:delete', { environmentId, kind: 'platformToken' })
    ).toEqual({ ok: true, data: { configured: false } })
    expect(await call(handlers, 'environments:delete', { id: environmentId })).toEqual({
      ok: true,
      data: { ok: true }
    })
    expect(await call(handlers, 'environments:getActive')).toEqual({
      ok: true,
      data: { environmentId: null }
    })
    expect(await call(handlers, 'clients:delete', { id: clientId })).toEqual({
      ok: true,
      data: { ok: true }
    })

    // Ninguna salida, ni el log, contiene el secreto ni su cifrado.
    for (const output of outputs) {
      expect(output).not.toContain(SECRET)
      expect(output).not.toContain('SECRETOPLATFORM')
      expect(output).not.toContain('enc:')
    }
    expect(loggedText(deps)).not.toContain(SECRET)

    // Todos los canales de createTenantHandlers se han llamado. La cobertura del
    // contrato completo (cubiertos + exentos) está en src/main/ipc/channel-coverage.test.ts.
    expect(
      Object.keys(handlers).filter((channel) => !calledChannels.has(channel)),
      'canales sin llamar'
    ).toEqual([])
  })
})

describe('onEnvironmentChanged', () => {
  it('se avisa al cambiar un entorno o sus secretos, con su id', async () => {
    const handlers = buildHandlers(true)
    const client = await call(handlers, 'clients:create', { name: 'Cliente A', color: '#111111' })
    const clientId = (client.data as { id: string }).id
    const env = await call(handlers, 'environments:create', { clientId, ...environmentFields })
    const environmentId = (env.data as { id: string }).id
    environmentChanged.mockClear()

    await call(handlers, 'environments:update', {
      id: environmentId,
      clientId,
      ...environmentFields,
      tags: ['x']
    })
    expect(environmentChanged).toHaveBeenLastCalledWith(environmentId)

    await call(handlers, 'secrets:set', { environmentId, kind: 'classicToken', value: SECRET })
    expect(environmentChanged).toHaveBeenLastCalledWith(environmentId)

    await call(handlers, 'secrets:delete', { environmentId, kind: 'classicToken' })
    expect(environmentChanged).toHaveBeenLastCalledWith(environmentId)

    await call(handlers, 'environments:delete', { id: environmentId })
    expect(environmentChanged).toHaveBeenLastCalledWith(environmentId)
    expect(environmentChanged).toHaveBeenCalledTimes(4)
  })

  it('borrar un cliente avisa por cada uno de sus entornos, y solo por los suyos', async () => {
    const handlers = buildHandlers(true)
    const a = await call(handlers, 'clients:create', { name: 'Cliente A', color: '#111111' })
    const b = await call(handlers, 'clients:create', { name: 'Cliente B', color: '#222222' })
    const clientA = (a.data as { id: string }).id
    const clientB = (b.data as { id: string }).id
    const ids: string[] = []
    for (const name of ['Producción', 'Desarrollo']) {
      const env = await call(handlers, 'environments:create', {
        clientId: clientA,
        ...environmentFields,
        name
      })
      ids.push((env.data as { id: string }).id)
    }
    const other = await call(handlers, 'environments:create', {
      clientId: clientB,
      ...environmentFields
    })
    const otherId = (other.data as { id: string }).id
    environmentChanged.mockClear()

    await call(handlers, 'clients:delete', { id: clientA })

    expect(environmentChanged.mock.calls.map((c) => c[0]).sort()).toEqual([...ids].sort())
    expect(environmentChanged).not.toHaveBeenCalledWith(otherId)
  })

  it('borrar un cliente sin entornos no avisa', async () => {
    const handlers = buildHandlers(true)
    const a = await call(handlers, 'clients:create', { name: 'Cliente A', color: '#111111' })
    environmentChanged.mockClear()
    await call(handlers, 'clients:delete', { id: (a.data as { id: string }).id })
    expect(environmentChanged).not.toHaveBeenCalled()
  })

  it('no se avisa si la operación falla', async () => {
    const handlers = buildHandlers(false)
    const client = await call(handlers, 'clients:create', { name: 'Cliente A', color: '#111111' })
    const clientId = (client.data as { id: string }).id
    const env = await call(handlers, 'environments:create', { clientId, ...environmentFields })
    const environmentId = (env.data as { id: string }).id
    environmentChanged.mockClear()

    // Sin cifrado, secrets:set falla y no hay nada que invalidar.
    await call(handlers, 'secrets:set', { environmentId, kind: 'classicToken', value: SECRET })
    await call(handlers, 'environments:delete', { id: '00000000-0000-4000-8000-000000000000' })
    expect(environmentChanged).not.toHaveBeenCalled()
  })
})

describe('config:import: límite de tamaño', () => {
  const PATH = 'C:/datos/grande.json'

  async function exportedConfig(): Promise<string> {
    const handlers = buildHandlers(true)
    await call(handlers, 'clients:create', { name: 'Cliente A', color: '#111111' })
    saveTarget = PATH
    await call(handlers, 'config:export')
    return files.get(PATH) ?? ''
  }

  it(`rechaza un fichero de más de ${MAX_CONFIG_FILE_BYTES} bytes sin leerlo`, async () => {
    expect(MAX_CONFIG_FILE_BYTES).toBe(1024 * 1024)
    await exportedConfig()
    fakeSizes.set(PATH, MAX_CONFIG_FILE_BYTES + 1)
    openTarget = PATH

    const result = await call(buildHandlers(true), 'config:import')

    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
    expect(readCalls).toEqual([])
    // El mensaje no lleva la ruta del usuario.
    expect(result.error?.message ?? '').not.toContain('C:/datos')
  })

  it('acepta un fichero de exactamente el límite', async () => {
    await exportedConfig()
    fakeSizes.set(PATH, MAX_CONFIG_FILE_BYTES)
    openTarget = PATH

    const result = await call(buildHandlers(true), 'config:import')

    expect(result).toMatchObject({ ok: true, data: { status: 'done' } })
    expect(readCalls).toEqual([PATH])
  })
})

describe('contrato IPC de secretos', () => {
  it('solo hay canales para guardar, borrar y saber si hay cifrado, ninguno para leer', () => {
    const channels = Object.keys(ipcContract)
    const aboutSecrets = channels.filter((channel) => /secret|credential/i.test(channel))
    expect(aboutSecrets.sort()).toEqual(['secrets:availability', 'secrets:delete', 'secrets:set'])
    // Ninguno de esos canales lee, muestra ni descifra.
    expect(
      aboutSecrets.filter((channel) => /(get|read|reveal|show|decrypt|value|list)/i.test(channel))
    ).toEqual([])
    // Ni existe en todo el contrato un canal para revelar o descifrar nada.
    expect(channels.filter((channel) => /(reveal|decrypt)/i.test(channel))).toEqual([])
  })

  it('ninguna salida de canal tiene un campo de texto con nombre de secreto', () => {
    // Recorre los esquemas de salida de Zod (objetos, listas, uniones, opcionales).
    // Los estados booleanos (`secrets.classicToken: boolean`) sí se permiten.
    type Node = {
      shape?: Record<string, unknown>
      element?: unknown
      options?: unknown[]
      def?: { type?: string; innerType?: unknown; valueType?: unknown }
    }
    const isString = (schema: unknown): boolean => {
      const node = schema as Node | undefined
      if (node?.def?.type === 'string') return true
      return node?.def?.innerType !== undefined ? isString(node.def.innerType) : false
    }
    const suspicious: string[] = []
    const walk = (schema: unknown, path: string): void => {
      const node = schema as Node | undefined
      if (node === undefined || node === null) return
      for (const [key, child] of Object.entries(node.shape ?? {})) {
        if (/(token|secret|password|value|plain|decrypted)/i.test(key) && isString(child)) {
          suspicious.push(`${path}.${key}`)
        }
        walk(child, `${path}.${key}`)
      }
      if (node.element !== undefined) walk(node.element, `${path}[]`)
      for (const option of node.options ?? []) walk(option, path)
      if (node.def?.innerType !== undefined) walk(node.def.innerType, path)
      if (node.def?.valueType !== undefined) walk(node.def.valueType, `${path}{}`)
    }
    for (const [channel, { output }] of Object.entries(ipcContract)) walk(output, channel)
    expect(suspicious).toEqual([])
  })
})
