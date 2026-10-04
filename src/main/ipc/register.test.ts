import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ipcContract, type IpcChannel } from '@shared/ipc'
import type { IpcImplementations } from './handler'

/**
 * AUD-20: registerIpcHandlers registra en ipcMain todos los canales del
 * contrato, y solo esos, y describe al remitente a partir de senderFrame.
 * Un senderFrame nulo (frame destruido o que ha navegado) no es de confianza.
 */

const fake = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, input: unknown) => Promise<unknown>>()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, input: unknown) => Promise<unknown>) => {
      fake.handlers.set(channel, fn)
    }
  }
}))

const { registerIpcHandlers } = await import('./register')

const TRUSTED_URL = 'app://vigia/index.html'
let called: string[]
let senders: unknown[]

/** Implementaciones falsas: app:ping devuelve lo que pide el contrato y anota la llamada. */
const implementations = new Proxy(
  {},
  {
    get: (_target, channel: string) => () => {
      called.push(channel)
      return channel === 'app:ping'
        ? { reply: 'pong', receivedAt: new Date(0).toISOString() }
        : undefined
    }
  }
) as unknown as IpcImplementations

beforeEach(() => {
  fake.handlers.clear()
  called = []
  senders = []
  registerIpcHandlers(implementations, {
    isTrustedSender: (sender) => {
      senders.push(sender)
      return sender.url === TRUSTED_URL && sender.isMainFrame
    },
    logger: { warn: vi.fn(), error: vi.fn() }
  })
})

async function invokePing(senderFrame: unknown): Promise<unknown> {
  const handler = fake.handlers.get('app:ping')
  if (handler === undefined) throw new Error('app:ping sin registrar')
  return handler({ senderFrame }, { message: 'hola' })
}

describe('registerIpcHandlers', () => {
  it('registra exactamente los canales del contrato', () => {
    expect([...fake.handlers.keys()].sort()).toEqual(
      (Object.keys(ipcContract) as IpcChannel[]).sort()
    )
  })

  it('frame principal de la app → se atiende', async () => {
    const result = await invokePing({ url: TRUSTED_URL, parent: null })
    expect(senders).toEqual([{ url: TRUSTED_URL, isMainFrame: true }])
    expect(result).toMatchObject({ ok: true, data: { reply: 'pong' } })
    expect(called).toEqual(['app:ping'])
  })

  it('senderFrame nulo → remitente no fiable, sin llamar a la implementación', async () => {
    const result = await invokePing(null)
    expect(senders).toEqual([{ url: undefined, isMainFrame: false }])
    expect(result).toMatchObject({ ok: false, error: { code: 'UNTRUSTED_SENDER' } })
    expect(called).toEqual([])
  })

  it('un subframe (con parent), aunque sea de la app → no es el principal y se rechaza', async () => {
    const result = await invokePing({ url: TRUSTED_URL, parent: { url: TRUSTED_URL } })
    expect(senders).toEqual([{ url: TRUSTED_URL, isMainFrame: false }])
    expect(result).toMatchObject({ ok: false, error: { code: 'UNTRUSTED_SENDER' } })
    expect(called).toEqual([])
  })

  it('un frame principal de otro origen → se rechaza', async () => {
    const result = await invokePing({ url: 'https://example.com/', parent: null })
    expect(result).toMatchObject({ ok: false, error: { code: 'UNTRUSTED_SENDER' } })
    expect(called).toEqual([])
  })
})
