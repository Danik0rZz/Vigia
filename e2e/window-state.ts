import { expect } from '@playwright/test'

/** Lo que main dice de la ventana: si se ve y si tiene el foco del sistema. */
export type WindowState = { visible: boolean; focused: boolean }

/**
 * Ficha 0045: espera a que la ventana se vea y comprueba que, en esa misma lectura, no tiene el
 * foco del sistema. main la enseña (showInactive) en `ready-to-show`, que puede llegar después de
 * que la página cargue; con carga, bastante después. La espera cubre solo la visibilidad: no se
 * vuelve a leer, así que una ventana que se ve con el foco falla aunque lo pierda luego.
 */
export async function expectShownWithoutFocus(
  read: () => Promise<WindowState>,
  timeoutMs = 10_000
): Promise<void> {
  let state: WindowState = { visible: false, focused: false }
  await expect
    .poll(
      async () => {
        state = await read()
        return state.visible
      },
      { message: 'la ventana de la prueba no llega a verse', timeout: timeoutMs }
    )
    .toBe(true)
  expect(state, 'la ventana se ve, pero con el foco del sistema').toEqual({
    visible: true,
    focused: false
  })
}
