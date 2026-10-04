import { describe, expect, it, vi } from 'vitest'
import { DtError } from '../dynatrace/errors'
import { createIpcHandler, type IpcHandlerDeps, type IpcSender } from './handler'
import { createAppHandlers } from './handlers/app'

const trusted: IpcSender = { url: 'app://vigia/index.html', isMainFrame: true }
const untrusted: IpcSender = { url: 'https://example.com/', isMainFrame: true }

function makeDeps(): IpcHandlerDeps {
  return {
    isTrustedSender: (sender) => sender.url === trusted.url && sender.isMainFrame,
    logger: { warn: vi.fn(), error: vi.fn() }
  }
}

const appHandlers = createAppHandlers({
  getInfo: () => ({
    name: 'Vigía',
    version: '0.1.0',
    packaged: false,
    platform: 'win32',
    versions: { electron: '44.0.0', chrome: '140.0.0', node: '22.0.0' }
  }),
  now: () => new Date('2026-10-03T10:00:00.000Z'),
  // Aquí no se abre nada fuera (app:openExternal se prueba en handlers/app.test.ts).
  openExternal: vi.fn(async () => undefined)
})

describe('canal de ejemplo app:ping', () => {
  it('responde al remitente de confianza con la entrada normalizada', async () => {
    const handler = createIpcHandler('app:ping', appHandlers['app:ping'], makeDeps())

    const result = await handler(trusted, { message: '  hola  ' })

    expect(result).toEqual({
      ok: true,
      data: { reply: 'pong: hola', receivedAt: '2026-10-03T10:00:00.000Z' }
    })
  })

  it('rechaza una entrada que no cumple el esquema sin ejecutar la implementación', async () => {
    const implementation = vi.fn(appHandlers['app:ping'])
    const handler = createIpcHandler('app:ping', implementation, makeDeps())

    for (const rawInput of [undefined, {}, { message: '' }, { message: 42 }, 'hola']) {
      const result = await handler(trusted, rawInput)
      expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
    }
    expect(implementation).not.toHaveBeenCalled()
  })
})

describe('canal app:getInfo', () => {
  it('devuelve los datos de la app', async () => {
    const handler = createIpcHandler('app:getInfo', appHandlers['app:getInfo'], makeDeps())

    const result = await handler(trusted, undefined)

    expect(result).toMatchObject({ ok: true, data: { name: 'Vigía', version: '0.1.0' } })
  })
})

describe('comprobaciones comunes de createIpcHandler', () => {
  it('rechaza a un remitente que no es de confianza y lo registra', async () => {
    const deps = makeDeps()
    const implementation = vi.fn(appHandlers['app:ping'])
    const handler = createIpcHandler('app:ping', implementation, deps)

    const result = await handler(untrusted, { message: 'hola' })

    expect(result).toEqual({
      ok: false,
      error: { code: 'UNTRUSTED_SENDER', message: 'Remitente no autorizado.' }
    })
    expect(implementation).not.toHaveBeenCalled()
    expect(deps.logger.warn).toHaveBeenCalledOnce()
  })

  it('rechaza un mensaje cuyo frame ya no existe', async () => {
    const handler = createIpcHandler('app:ping', appHandlers['app:ping'], makeDeps())

    const result = await handler({ url: undefined, isMainFrame: false }, { message: 'hola' })

    expect(result).toMatchObject({ ok: false, error: { code: 'UNTRUSTED_SENDER' } })
  })

  it('no filtra al renderer el detalle de un error interno', async () => {
    const deps = makeDeps()
    const handler = createIpcHandler(
      'app:ping',
      () => {
        throw new Error('token dt0c01.SECRETO en /ruta/interna')
      },
      deps
    )

    const result = await handler(trusted, { message: 'hola' })

    expect(result).toEqual({
      ok: false,
      error: { code: 'INTERNAL', message: 'Error interno al procesar la petición.' }
    })
    expect(JSON.stringify(result)).not.toContain('SECRETO')
    expect(deps.logger.error).toHaveBeenCalledOnce()
  })

  it('rechaza una respuesta que no cumple el contrato', async () => {
    const handler = createIpcHandler(
      'app:ping',
      // Respuesta deliberadamente incorrecta para comprobar la validación de salida.
      () => ({ reply: 'pong', receivedAt: 'ayer' }),
      makeDeps()
    )

    const result = await handler(trusted, { message: 'hola' })

    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_OUTPUT' } })
  })
})

describe('errores de Dynatrace hacia el renderer', () => {
  const TOKEN = `dt0c01.PUBLICAPRUEBA0000000000A.${'SECRETODTERROR'.padEnd(64, 'X')}`

  it.each(['FORBIDDEN', 'UNAUTHORIZED', 'NO_CREDENTIAL', 'RATE_LIMITED', 'TLS_UNTRUSTED'] as const)(
    'un DtError %s llega con su código y el mensaje enmascarado',
    async (code) => {
      const deps = makeDeps()
      const handler = createIpcHandler(
        'app:ping',
        () => {
          throw new DtError(code, `Falta el scope metrics.read; Api-Token ${TOKEN}`, 403)
        },
        deps
      )

      const result = await handler(trusted, { message: 'hola' })

      expect(result).toMatchObject({ ok: false, error: { code } })
      const message = (result as { error: { message: string } }).error.message
      expect(message).toContain('metrics.read')
      expect(JSON.stringify(result)).not.toContain('SECRETODTERROR')
    }
  )

  it('un Error normal sigue saliendo como INTERNAL sin detalle', async () => {
    const handler = createIpcHandler(
      'app:ping',
      () => {
        throw new Error('fallo con FORBIDDEN en el texto')
      },
      makeDeps()
    )
    expect(await handler(trusted, { message: 'hola' })).toEqual({
      ok: false,
      error: { code: 'INTERNAL', message: 'Error interno al procesar la petición.' }
    })
  })

  it('un Error con una propiedad code que imita a un DtError no pasa como tal', async () => {
    const handler = createIpcHandler(
      'app:ping',
      () => {
        throw Object.assign(new Error(`secreto ${TOKEN}`), { code: 'FORBIDDEN' })
      },
      makeDeps()
    )
    const result = await handler(trusted, { message: 'hola' })
    expect(result).toMatchObject({ ok: false, error: { code: 'INTERNAL' } })
    expect(JSON.stringify(result)).not.toContain('SECRETODTERROR')
  })
})
