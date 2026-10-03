import { describe, expect, it, vi } from 'vitest'
import { createIpcHandler } from '../handler'
import { createUiHandlers } from './ui'

const deps = {
  isTrustedSender: () => true,
  logger: { warn: vi.fn(), error: vi.fn() }
}
const sender = { url: 'app://vigia/index.html', isMainFrame: true }

describe('canal ui:setTheme', () => {
  it('aplica la preferencia a nativeTheme y devuelve si el tema es oscuro', async () => {
    const setThemeSource = vi.fn((theme: string) => theme === 'dark')
    const handlers = createUiHandlers({ setThemeSource })
    const handler = createIpcHandler('ui:setTheme', handlers['ui:setTheme'], deps)

    expect(await handler(sender, { theme: 'dark' })).toEqual({ ok: true, data: { dark: true } })
    expect(await handler(sender, { theme: 'system' })).toEqual({ ok: true, data: { dark: false } })
    expect(setThemeSource.mock.calls).toEqual([['dark'], ['system']])
  })

  it('rechaza valores fuera de light, dark o system', async () => {
    const setThemeSource = vi.fn(() => false)
    const handler = createIpcHandler(
      'ui:setTheme',
      createUiHandlers({ setThemeSource })['ui:setTheme'],
      deps
    )

    const result = await handler(sender, { theme: 'sepia' })
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
    expect(setThemeSource).not.toHaveBeenCalled()
  })
})
