import { describe, expect, it, vi } from 'vitest'
import { createCrashPolicy, crashTexts, type CrashLanguage } from './crash-policy'

/**
 * Ficha 0061 (C-05): política ante la caída del proceso de la interfaz. Es
 * pura: recibe el reloj, el log y las acciones de Electron inyectados, y
 * `window.ts` solo la llama. Primera caída → log y recarga; otra antes de un
 * minuto → diálogo que remite al log y cierre. `clean-exit` y `killed` no
 * cuentan como caída.
 */

const MINUTE = 60_000
const START = Date.parse('2026-10-10T10:00:00.000+02:00')

type Fn = ReturnType<typeof vi.fn>

interface Setup {
  deps: {
    now: () => number
    logger: Record<'info' | 'warn' | 'error', Fn>
    reload: Fn
    showErrorBox: Fn
    quit: Fn
    language: () => CrashLanguage
  }
  policy: ReturnType<typeof createCrashPolicy>
  advance: (ms: number) => void
}

function setup(language: CrashLanguage = 'es'): Setup {
  let clock = START
  const deps = {
    now: () => clock,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    reload: vi.fn(),
    showErrorBox: vi.fn(),
    quit: vi.fn(),
    language: () => language
  }
  const policy = createCrashPolicy(deps)
  const advance = (ms: number): void => {
    clock += ms
  }
  return { deps, policy, advance }
}

/** Todo lo que se ha escrito en el log, en un solo texto. */
function logged(logger: Record<string, ReturnType<typeof vi.fn>>): string {
  return Object.values(logger)
    .flatMap((fn) => fn.mock.calls.flat())
    .map((value) => (typeof value === 'string' ? value : JSON.stringify(value)))
    .join(' ')
}

describe('CA1 (0061): la política recarga una vez y cierra si vuelve a caer antes de un minuto', () => {
  it('primera caída: recarga, sin diálogo ni cierre', () => {
    const { deps, policy } = setup()
    policy.renderProcessGone({ reason: 'crashed', exitCode: -1073741819 })

    expect(deps.reload).toHaveBeenCalledTimes(1)
    expect(deps.showErrorBox).not.toHaveBeenCalled()
    expect(deps.quit).not.toHaveBeenCalled()
  })

  it('registra en el log el reason y el exitCode de la caída', () => {
    const { deps, policy } = setup()
    policy.renderProcessGone({ reason: 'oom', exitCode: 4242 })

    const text = logged(deps.logger)
    expect(text).toContain('oom')
    expect(text).toContain('4242')
  })

  it('segunda caída antes de un minuto: diálogo de error y cierre, sin recargar otra vez', () => {
    const { deps, policy, advance } = setup()
    policy.renderProcessGone({ reason: 'crashed', exitCode: 1 })
    advance(MINUTE - 1_000)
    policy.renderProcessGone({ reason: 'crashed', exitCode: 1 })

    expect(deps.reload).toHaveBeenCalledTimes(1)
    expect(deps.showErrorBox).toHaveBeenCalledTimes(1)
    expect(deps.quit).toHaveBeenCalledTimes(1)
  })

  it('el diálogo va antes del cierre', () => {
    const { deps, policy, advance } = setup()
    policy.renderProcessGone({ reason: 'crashed', exitCode: 1 })
    advance(5_000)
    policy.renderProcessGone({ reason: 'crashed', exitCode: 1 })

    const dialogOrder = deps.showErrorBox.mock.invocationCallOrder[0] ?? Infinity
    const quitOrder = deps.quit.mock.invocationCallOrder[0] ?? -Infinity
    expect(dialogOrder).toBeLessThan(quitOrder)
  })

  it('segunda caída pasado más de un minuto: vuelve a recargar', () => {
    const { deps, policy, advance } = setup()
    policy.renderProcessGone({ reason: 'crashed', exitCode: 1 })
    advance(MINUTE + 1_000)
    policy.renderProcessGone({ reason: 'crashed', exitCode: 1 })

    expect(deps.reload).toHaveBeenCalledTimes(2)
    expect(deps.showErrorBox).not.toHaveBeenCalled()
    expect(deps.quit).not.toHaveBeenCalled()
  })

  it('el minuto cuenta desde la última recarga: tras recargar dos veces, otra caída a los 30 s cierra', () => {
    const { deps, policy, advance } = setup()
    policy.renderProcessGone({ reason: 'crashed', exitCode: 1 })
    advance(MINUTE + 1_000)
    policy.renderProcessGone({ reason: 'crashed', exitCode: 1 })
    advance(30_000)
    policy.renderProcessGone({ reason: 'crashed', exitCode: 1 })

    expect(deps.reload).toHaveBeenCalledTimes(2)
    expect(deps.showErrorBox).toHaveBeenCalledTimes(1)
    expect(deps.quit).toHaveBeenCalledTimes(1)
  })

  it.each(['clean-exit', 'killed'])('%s: no hace nada', (reason) => {
    const { deps, policy } = setup()
    policy.renderProcessGone({ reason, exitCode: 0 })
    policy.renderProcessGone({ reason, exitCode: 0 })

    expect(deps.reload).not.toHaveBeenCalled()
    expect(deps.showErrorBox).not.toHaveBeenCalled()
    expect(deps.quit).not.toHaveBeenCalled()
  })

  it('clean-exit y killed no cuentan como caída para el minuto', () => {
    const { deps, policy, advance } = setup()
    policy.renderProcessGone({ reason: 'killed', exitCode: 0 })
    advance(1_000)
    policy.renderProcessGone({ reason: 'crashed', exitCode: 1 })

    expect(deps.reload).toHaveBeenCalledTimes(1)
    expect(deps.quit).not.toHaveBeenCalled()
  })
})

describe('CA4 (0061): textos de los diálogos en es y en', () => {
  const languages: CrashLanguage[] = ['es', 'en']

  it('es y en tienen las mismas claves, ninguna vacía, y todas traducidas', () => {
    const es = crashTexts('es')
    const en = crashTexts('en')
    expect(Object.keys(en).sort()).toEqual(Object.keys(es).sort())
    for (const key of Object.keys(es) as (keyof typeof es)[]) {
      expect(es[key].trim(), `es.${key}`).not.toBe('')
      expect(en[key].trim(), `en.${key}`).not.toBe('')
      expect(en[key], `en.${key} sin traducir`).not.toBe(es[key])
    }
  })

  it.each(languages)('%s: el mensaje de la caída remite al log', (language) => {
    expect(crashTexts(language).goneMessage.toLowerCase()).toContain('log')
  })

  it('botones del diálogo de «no responde»: Esperar y Cerrar / Wait y Close', () => {
    expect(crashTexts('es')).toMatchObject({ wait: 'Esperar', close: 'Cerrar' })
    expect(crashTexts('en')).toMatchObject({ wait: 'Wait', close: 'Close' })
    for (const language of languages) {
      expect(crashTexts(language).unresponsiveMessage.trim()).not.toBe('')
    }
  })

  it.each(languages)('el diálogo de error de la política sale en %s', (language) => {
    const { deps, policy, advance } = setup(language)
    policy.renderProcessGone({ reason: 'crashed', exitCode: 1 })
    advance(1_000)
    policy.renderProcessGone({ reason: 'crashed', exitCode: 1 })

    expect(deps.showErrorBox).toHaveBeenCalledWith(
      expect.any(String),
      crashTexts(language).goneMessage
    )
  })
})
