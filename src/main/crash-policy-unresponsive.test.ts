import { describe, expect, it, vi } from 'vitest'
import {
  crashLanguageFromLocale,
  crashTexts,
  createUnresponsivePolicy,
  UNRESPONSIVE_DELAY_MS,
  type UnresponsiveChoice,
  type UnresponsivePolicy,
  type UnresponsivePolicyDeps
} from './crash-policy'

/**
 * Ficha 0061: interfaz colgada (`unresponsive`) e idioma de los diálogos de
 * main. Sin criterio propio en la ficha; tests del developer.
 */

function setup(choices: UnresponsiveChoice[] = []): {
  deps: UnresponsivePolicyDeps & {
    schedule: ReturnType<typeof vi.fn>
    cancel: ReturnType<typeof vi.fn>
    ask: ReturnType<typeof vi.fn>
    close: ReturnType<typeof vi.fn>
    logger: Record<'info' | 'warn' | 'error', ReturnType<typeof vi.fn>>
  }
  policy: UnresponsivePolicy
  fire: () => Promise<void>
} {
  const timers: { fn: () => void; ms: number; cancelled: boolean }[] = []
  const deps = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    schedule: vi.fn((fn: () => void, ms: number) => {
      const timer = { fn, ms, cancelled: false }
      timers.push(timer)
      return timer
    }),
    cancel: vi.fn((handle: unknown) => {
      ;(handle as { cancelled: boolean }).cancelled = true
    }),
    ask: vi.fn(() => Promise.resolve(choices.shift() ?? 'wait')),
    close: vi.fn(),
    language: () => 'en' as const
  }
  const policy = createUnresponsivePolicy(deps)
  const fire = async (): Promise<void> => {
    const timer = timers.filter((t) => !t.cancelled).at(-1)
    timers.splice(0, timers.length)
    timer?.fn()
    await Promise.resolve()
    await Promise.resolve()
  }
  return { deps, policy, fire }
}

describe('0061: interfaz que no responde', () => {
  it('pregunta tras unos segundos, en el idioma dado, y cierra con «Cerrar»', async () => {
    const { deps, policy, fire } = setup(['close'])
    policy.unresponsive()
    expect(deps.schedule).toHaveBeenCalledWith(expect.any(Function), UNRESPONSIVE_DELAY_MS)
    expect(deps.ask).not.toHaveBeenCalled()

    await fire()
    expect(deps.ask).toHaveBeenCalledWith(crashTexts('en'))
    expect(deps.close).toHaveBeenCalledTimes(1)
  })

  it('si se recupera antes de preguntar, no pregunta', async () => {
    const { deps, policy, fire } = setup()
    policy.unresponsive()
    policy.responsive()
    expect(deps.cancel).toHaveBeenCalledTimes(1)
    await fire()
    expect(deps.ask).not.toHaveBeenCalled()
  })

  it('con «Esperar» vuelve a preguntar si sigue colgada, y no si se recupera', async () => {
    const { deps, policy, fire } = setup(['wait', 'wait'])
    policy.unresponsive()
    await fire()
    expect(deps.close).not.toHaveBeenCalled()
    expect(deps.schedule).toHaveBeenCalledTimes(2)

    await fire()
    expect(deps.ask).toHaveBeenCalledTimes(2)

    policy.responsive()
    await fire()
    expect(deps.ask).toHaveBeenCalledTimes(2)
    expect(deps.close).not.toHaveBeenCalled()
  })

  it('un segundo aviso mientras sigue colgada no programa otra pregunta', () => {
    const { deps, policy } = setup()
    policy.unresponsive()
    policy.unresponsive()
    expect(deps.schedule).toHaveBeenCalledTimes(1)
  })

  it('si el diálogo falla, lo registra sin cerrar', async () => {
    const { deps, policy, fire } = setup()
    deps.ask.mockImplementationOnce(() => Promise.reject(new Error('sin ventana')))
    policy.unresponsive()
    await fire()
    expect(deps.logger.error).toHaveBeenCalled()
    expect(deps.close).not.toHaveBeenCalled()
  })
})

describe('0061: idioma de los diálogos de main', () => {
  it.each([
    ['en-US', 'en'],
    ['en', 'en'],
    ['es-ES', 'es'],
    ['fr', 'es'],
    ['', 'es']
  ])('%s → %s', (locale, expected) => {
    expect(crashLanguageFromLocale(locale)).toBe(expected)
  })
})
