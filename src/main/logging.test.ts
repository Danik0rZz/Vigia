import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LogMessage } from 'electron-log'

/**
 * Ficha 0060 (S-03): `initLogging` registra en `log.hooks` el filtro final de
 * secretos. Electron y electron-log se simulan. Token inventado.
 */

const fake = vi.hoisted(() => ({
  log: {
    transports: { file: {} as Record<string, unknown>, console: {} as Record<string, unknown> },
    errorHandler: { startCatching: (): void => undefined },
    hooks: [] as ((message: LogMessage, transport?: unknown, name?: string) => LogMessage | false)[]
  }
}))

vi.mock('electron', () => ({ app: { isPackaged: true } }))
vi.mock('electron-log/main', () => ({ default: fake.log }))
vi.mock('./paths', () => ({ logsDir: () => 'C:\\datos-de-prueba\\logs' }))

const { initLogging } = await import('./logging')

const SECRET_PART = 'SECRETOCLASICO'.padEnd(64, 'X')
const TOKEN = `dt0c01.PUBLICAPRUEBA0000000000A.${SECRET_PART}`

beforeEach(() => {
  fake.log.hooks = []
})

describe('CA4 (0060): initLogging registra el hook que enmascara secretos', () => {
  it('añade un hook a log.hooks', () => {
    initLogging()
    expect(fake.log.hooks).toHaveLength(1)
  })

  it('el hook registrado enmascara un token y devuelve el mensaje', () => {
    initLogging()
    const hook = fake.log.hooks[0]
    expect(hook).toBeTypeOf('function')
    const result = hook?.(
      {
        data: [`Api-Token ${TOKEN}`, new Error(`fallo con ${TOKEN}`)],
        date: new Date('2026-10-10T08:00:00.000Z'),
        level: 'error'
      },
      undefined,
      'file'
    )
    expect(result).not.toBe(false)
    const data = (result as LogMessage).data
    expect(JSON.stringify(data)).not.toContain(SECRET_PART)
    expect((data[1] as Error).message).not.toContain(SECRET_PART)
    expect((data[1] as Error).stack ?? '').not.toContain(SECRET_PART)
  })
})
