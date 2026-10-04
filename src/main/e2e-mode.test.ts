import { describe, expect, it, vi } from 'vitest'
import { E2E_ENV, isE2eMode } from './e2e-mode'

/**
 * Modo e2e: la ventana se muestra sin tomar el foco del sistema (una tecla de
 * quien usa el PC no acaba en la ventana de un test). Solo sin empaquetar.
 */

describe('isE2eMode', () => {
  it('la variable se llama VIGIA_E2E', () => {
    expect(E2E_ENV).toBe('VIGIA_E2E')
  })

  it("sin empaquetar y con '1' → true", () => {
    expect(isE2eMode({ packaged: false, value: '1' })).toBe(true)
  })

  it.each(['0', '', 'true', 'TRUE', ' 1', '1 ', 'yes', undefined])(
    'sin empaquetar y con %j → false (solo vale exactamente "1")',
    (value) => {
      expect(isE2eMode({ packaged: false, value })).toBe(false)
    }
  )

  it.each(['1', '0', undefined])('empaquetada, con %j → siempre false', (value) => {
    expect(isE2eMode({ packaged: true, value })).toBe(false)
  })
})

describe('showWindow', async () => {
  // window.ts importa Electron; aquí solo se prueba showWindow con una ventana falsa.
  vi.doMock('electron', () => ({
    app: { isPackaged: false },
    BrowserWindow: class {},
    nativeTheme: {}
  }))
  const { showWindow } = await import('./window')

  const fakeWindow = (): {
    show: ReturnType<typeof vi.fn>
    showInactive: ReturnType<typeof vi.fn>
  } => ({
    show: vi.fn(),
    showInactive: vi.fn()
  })

  it('en modo e2e: showInactive, nunca show', () => {
    const window = fakeWindow()
    showWindow(window as never, true)
    expect(window.showInactive).toHaveBeenCalledOnce()
    expect(window.show).not.toHaveBeenCalled()
  })

  it('en uso normal: show, que activa la ventana', () => {
    const window = fakeWindow()
    showWindow(window as never, false)
    expect(window.show).toHaveBeenCalledOnce()
    expect(window.showInactive).not.toHaveBeenCalled()
  })
})
