import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Ficha 0064 (C-10): `main.tsx` espera a `app:getInfo` antes del primer render, pero no para
 * siempre: con unos 2 s sin respuesta pinta la app con los valores por defecto (sin disparador
 * de errores ni contador de renders). Se importa el punto de entrada con todo lo de alrededor
 * simulado y con temporizadores falsos.
 */
const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  render: vi.fn(),
  createRoot: vi.fn(),
  enableRenderCount: vi.fn(),
  setErrorLogVersion: vi.fn(),
  App: function App(): null {
    return null
  }
}))

vi.mock('./assets/main.css', () => ({}))
vi.mock('./App', () => ({ default: mocks.App }))
vi.mock('./app/i18n', () => ({ initI18n: vi.fn() }))
vi.mock('./app/theme', () => ({ initTheme: vi.fn() }))
vi.mock('./lib/error-log', () => ({ setErrorLogVersion: mocks.setErrorLogVersion }))
vi.mock('./lib/render-count', () => ({ enableRenderCount: mocks.enableRenderCount }))
vi.mock('./lib/ipc', () => ({
  invoke: (...args: unknown[]) => mocks.invoke(...args),
  IpcError: class IpcError extends Error {}
}))
vi.mock('react-dom/client', () => ({
  createRoot: (...args: unknown[]) => mocks.createRoot(...args)
}))

/** El elemento App que se pintó (busca en el árbol: puede ir dentro de proveedores). */
function renderedApp(): ReactElement<{ errorTrigger?: boolean }> | null {
  const visit = (node: ReactNode): ReactElement<{ errorTrigger?: boolean }> | null => {
    if (Array.isArray(node)) {
      for (const child of node as ReactNode[]) {
        const found = visit(child)
        if (found !== null) return found
      }
      return null
    }
    if (!isValidElement(node)) return null
    if (node.type === mocks.App) return node as ReactElement<{ errorTrigger?: boolean }>
    return visit((node.props as { children?: ReactNode }).children)
  }
  const first = mocks.render.mock.calls[0]?.[0] as ReactNode
  return visit(first)
}

async function start(): Promise<void> {
  vi.resetModules()
  await import('./main')
}

beforeEach(() => {
  vi.useFakeTimers()
  mocks.invoke.mockReset()
  mocks.render.mockReset()
  mocks.enableRenderCount.mockReset()
  mocks.setErrorLogVersion.mockReset()
  mocks.createRoot.mockReset()
  mocks.createRoot.mockReturnValue({ render: mocks.render, unmount: vi.fn() })
  vi.stubGlobal('document', { getElementById: () => ({ id: 'root' }) })
  vi.stubGlobal('window', {
    location: { hash: '#/' },
    history: { replaceState: vi.fn() },
    vigia: { invoke: vi.fn() }
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('CA5 (0064): sin respuesta de app:getInfo, el primer render llega a los ~2 s', () => {
  it('app:getInfo no responde nunca: nada antes de 1,5 s; a los 2,5 s, render con los valores por defecto', async () => {
    mocks.invoke.mockImplementation((channel: string) =>
      channel === 'app:getInfo' ? new Promise(() => {}) : Promise.resolve(null)
    )
    await start()
    await vi.advanceTimersByTimeAsync(1500)
    expect(mocks.render, 'render antes de tiempo').not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1000)
    expect(mocks.render).toHaveBeenCalledTimes(1)
    // Valores por defecto: sin disparador de errores ni contador de renders.
    expect(renderedApp()?.props.errorTrigger).toBe(false)
    expect(mocks.enableRenderCount).not.toHaveBeenCalled()
  })

  it('si app:getInfo responde enseguida, el render no espera los 2 s y usa lo que dice main', async () => {
    mocks.invoke.mockImplementation((channel: string) =>
      channel === 'app:getInfo'
        ? Promise.resolve({ errorTrigger: true, version: '9.9.9', packaged: false })
        : Promise.resolve(null)
    )
    await start()
    await vi.advanceTimersByTimeAsync(50)
    expect(mocks.render).toHaveBeenCalledTimes(1)
    expect(renderedApp()?.props.errorTrigger).toBe(true)
    expect(mocks.setErrorLogVersion).toHaveBeenCalledWith('9.9.9')
    // Y el tiempo máximo, al cumplirse, no vuelve a pintar.
    await vi.advanceTimersByTimeAsync(3000)
    expect(mocks.render).toHaveBeenCalledTimes(1)
  })
})
