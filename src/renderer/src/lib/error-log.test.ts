import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * v0.10.1: la interfaz manda sus errores al log de main (app:logRendererError)
 * con su propio límite (la misma pareja una vez por minuto, 10 por minuto en
 * total) y nunca lanza: informar de un error no puede romper nada más.
 */

const invoke = vi.fn()
vi.mock('./ipc', () => ({ invoke: (...args: unknown[]) => invoke(...args) }))

type ReportError = (error: unknown, route: string) => unknown

/** Módulo nuevo en cada test: el límite es de módulo. */
async function load(): Promise<ReportError> {
  vi.resetModules()
  const module = (await import('./error-log')) as { reportError: ReportError }
  return module.reportError
}

const calls = (): Record<string, unknown>[] =>
  invoke.mock.calls
    .filter(([channel]) => channel === 'app:logRendererError')
    .map(([, payload]) => payload as Record<string, unknown>)

/** Deja correr lo pendiente (reportError puede ser asíncrono). */
const settle = async (): Promise<void> => {
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(() => {
  invoke.mockReset()
  invoke.mockResolvedValue({ logged: true })
})

describe('reportError', () => {
  it('manda app:logRendererError con el mensaje, el stack y la ruta', async () => {
    const reportError = await load()
    const error = new Error('se rompió algo')
    reportError(error, '/problems/p-1')
    await settle()
    expect(calls()).toHaveLength(1)
    const [payload] = calls()
    expect(payload).toMatchObject({ message: 'se rompió algo', route: '/problems/p-1' })
    expect(String(payload?.['stack'] ?? '')).toContain('se rompió algo')
    expect(typeof payload?.['version']).toBe('string')
  })

  it('el mismo error en la misma ruta, una sola vez por minuto', async () => {
    const reportError = await load()
    for (let i = 0; i < 5; i += 1) reportError(new Error('igual'), '/a')
    reportError(new Error('igual'), '/b')
    await settle()
    expect(calls().map((c) => c['route'])).toEqual(['/a', '/b'])
  })

  it('un error en bucle (mensajes distintos): como mucho 10 envíos', async () => {
    const reportError = await load()
    for (let i = 0; i < 40; i += 1) reportError(new Error(`error ${i}`), '/x')
    await settle()
    expect(calls()).toHaveLength(10)
  })

  it('nunca lanza: ni con un error raro ni si el IPC falla', async () => {
    const reportError = await load()
    invoke.mockRejectedValue(new Error('IPC caído'))
    expect(() => reportError(new Error('x'), '/')).not.toThrow()
    expect(() => reportError(null, '/')).not.toThrow()
    expect(() => reportError('texto', '/')).not.toThrow()
    expect(() => reportError({ message: 42 }, '/')).not.toThrow()
    invoke.mockImplementation(() => {
      throw new Error('síncrono')
    })
    expect(() => reportError(new Error('y'), '/')).not.toThrow()
    await settle()
  })

  it('respeta los límites del contrato: recorta mensaje, stack y ruta largos', async () => {
    const reportError = await load()
    const error = new Error('m'.repeat(5000))
    error.stack = 's'.repeat(20_000)
    reportError(error, `/${'r'.repeat(1000)}`)
    await settle()
    const [payload] = calls()
    expect(String(payload?.['message']).length).toBeLessThanOrEqual(2000)
    expect(String(payload?.['stack']).length).toBeLessThanOrEqual(8000)
    expect(String(payload?.['route']).length).toBeLessThanOrEqual(500)
  })
})
