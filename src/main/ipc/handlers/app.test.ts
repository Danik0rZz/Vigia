import { describe, expect, it, vi } from 'vitest'
import { createAppHandlers } from './app'

/**
 * v0.10.1: app:logRendererError (al log de main, enmascarado y con freno) y
 * app:copyText (al portapapeles desde main). Datos inventados.
 */

function setup(start = Date.parse('2026-10-04T20:00:00Z')): {
  handlers: ReturnType<typeof createAppHandlers>
  logError: ReturnType<typeof vi.fn>
  writeClipboardText: ReturnType<typeof vi.fn>
  advance: (ms: number) => void
} {
  let now = start
  const logError = vi.fn()
  const writeClipboardText = vi.fn()
  const handlers = createAppHandlers({
    getInfo: () => ({
      name: 'Vigía',
      version: '0.10.1',
      packaged: true,
      platform: 'win32',
      versions: { electron: '44.0.0', chrome: '140.0.0', node: '22.0.0' },
      errorTrigger: false
    }),
    logError,
    writeClipboardText,
    now: () => new Date(now)
  })
  return { handlers, logError, writeClipboardText, advance: (ms) => (now += ms) }
}

const report = (
  handlers: ReturnType<typeof createAppHandlers>,
  message: string,
  route = '/problems',
  stack: string | null = null
): unknown => handlers['app:logRendererError']({ message, stack, route, version: '0.10.1' })

describe('app:logRendererError', () => {
  it('escribe en el log con el mensaje, el stack y la ruta enmascarados', () => {
    const { handlers, logError } = setup()
    const result = report(
      handlers,
      'Fallo con dt0c01.PUBLICO.SECRETOSECRETO en C:\\Users\\alguien\\AppData\\Roaming\\vigia',
      '/metrics?selector=x&api-token=abc123',
      'at f (C:/Users/alguien/app.js:1:1)\nBearer eyJabc.def'
    )
    expect(result).toEqual({ logged: true })
    expect(logError).toHaveBeenCalledTimes(1)
    const [message, details] = logError.mock.calls[0] as [
      string,
      { stack: string; route: string; version: string }
    ]
    const all = `${message}\n${details.stack}\n${details.route}`
    expect(all).not.toContain('SECRETOSECRETO')
    expect(all).not.toContain('alguien')
    expect(all).not.toContain('abc123')
    expect(all).not.toContain('eyJabc')
    expect(message).toContain('dt0c01.PUBLICO.***')
    expect(details.route).toContain('api-token=***')
    expect(details.version).toBe('0.10.1')
  })

  it('freno propio de main: la misma pareja una vez por minuto, 10 en total por minuto', () => {
    const { handlers, logError, advance } = setup()
    expect(report(handlers, 'igual')).toEqual({ logged: true })
    expect(report(handlers, 'igual')).toEqual({ logged: false })
    for (let i = 0; i < 20; i += 1) report(handlers, `distinto ${i}`)
    expect(logError).toHaveBeenCalledTimes(10)
    // Pasado el minuto, vuelve a dejar.
    advance(60_001)
    expect(report(handlers, 'igual')).toEqual({ logged: true })
  })
})

describe('app:copyText', () => {
  it('copia el texto con el portapapeles de main', async () => {
    const { handlers, writeClipboardText } = setup()
    await expect(handlers['app:copyText']({ text: 'detalles' })).resolves.toEqual({ ok: true })
    expect(writeClipboardText).toHaveBeenCalledWith('detalles')
  })
})

describe('app:getInfo', () => {
  it('lleva errorTrigger', () => {
    const { handlers } = setup()
    expect(handlers['app:getInfo'](undefined)).toMatchObject({
      errorTrigger: false
    })
  })
})
