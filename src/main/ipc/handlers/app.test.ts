import { describe, expect, it, vi } from 'vitest'
import type { IpcChannel } from '@shared/ipc'
import { createIpcHandler, type IpcHandlerDeps, type IpcImplementation } from '../handler'
import { createAppHandlers } from './app'

/**
 * v0.9.0, app:openExternal: el renderer pide abrir una URL en el navegador
 * del sistema. Main la valida (isSafeExternalUrl) y solo entonces llama a
 * shell.openExternal (aquí, una dep simulada) con la URL normalizada.
 */

const TRUSTED = { url: 'app://vigia/index.html', isMainFrame: true }

function setup(): {
  call: (input: unknown) => Promise<unknown>
  openExternal: ReturnType<typeof vi.fn>
  deps: IpcHandlerDeps
} {
  const openExternal = vi.fn(async () => undefined)
  const handlers = createAppHandlers({
    getInfo: () => ({
      name: 'Vigía',
      version: '0.9.0',
      packaged: false,
      platform: 'win32',
      versions: { electron: '44.0.0', chrome: '140.0.0', node: '22.0.0' }
    }),
    openExternal
  } as unknown as Parameters<typeof createAppHandlers>[0])
  const deps: IpcHandlerDeps = {
    isTrustedSender: () => true,
    logger: { warn: vi.fn(), error: vi.fn() }
  }
  const channel = 'app:openExternal' as IpcChannel
  const implementation = (handlers as Record<string, unknown>)[channel] as IpcImplementation<
    typeof channel
  >
  return {
    call: (input) => createIpcHandler(channel, implementation, deps)(TRUSTED, input),
    openExternal,
    deps
  }
}

describe('app:openExternal', () => {
  it('https válida → ok y shell.openExternal con la URL normalizada', async () => {
    const { call, openExternal } = setup()
    expect(await call({ url: 'HTTPS://Docs.Dynatrace.com/docs' })).toEqual({
      ok: true,
      data: { ok: true }
    })
    expect(openExternal).toHaveBeenCalledExactlyOnceWith('https://docs.dynatrace.com/docs')
  })

  it('http con host también se acepta', async () => {
    const { call, openExternal } = setup()
    expect(await call({ url: 'http://dt.ejemplo.local/e/abc' })).toMatchObject({ ok: true })
    expect(openExternal).toHaveBeenCalledOnce()
  })

  it.each([
    'javascript:alert(1)',
    'file:///C:/Windows/System32/calc.exe',
    'data:text/html,<script>alert(1)</script>',
    'http:///sin-host',
    'https://usuario:clave@example.com/',
    'no es una url'
  ])('%s → INVALID_INPUT externalUrlRejected, sin abrir nada', async (url) => {
    const { call, openExternal } = setup()
    expect(await call({ url })).toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT', reason: { key: 'externalUrlRejected' } }
    })
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('el motivo no lleva la URL rechazada (puede traer credenciales)', async () => {
    const { call } = setup()
    const result = await call({ url: 'https://usuario:CLAVESECRETA@example.com/' })
    expect(JSON.stringify(result)).not.toContain('CLAVESECRETA')
  })

  it.each([
    ['sin url', {}],
    ['url que no es texto', { url: 42 }],
    ['url de más de 2048 caracteres', { url: `https://example.com/${'a'.repeat(2048)}` }]
  ])('%s → INVALID_INPUT del contrato, sin abrir nada', async (_case, input) => {
    const { call, openExternal } = setup()
    expect(await call(input)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
    expect(openExternal).not.toHaveBeenCalled()
  })
})
