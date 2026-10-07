import { expect, type ElectronApplication, type Page } from '@playwright/test'

/** Tamaño del contenido de una ventana, en px CSS. */
export type WindowSize = { width: number; height: number }

/**
 * Ficha 0011: diferencia máxima (px) entre el tamaño pedido con setContentSize y el que queda.
 * Con el escritorio al 150 %, Windows redondea al escalar: en la VPS, 960×600 queda en 960×602.
 */
export const CONTENT_SIZE_TOLERANCE_PX = 2

/** Si el contenido `actual` es el pedido (`wanted`), salvo el redondeo de Windows al escalar. */
export function fitsContentSize(actual: WindowSize, wanted: WindowSize): boolean {
  return (
    Math.abs(actual.width - wanted.width) <= CONTENT_SIZE_TOLERANCE_PX &&
    Math.abs(actual.height - wanted.height) <= CONTENT_SIZE_TOLERANCE_PX
  )
}

/**
 * Ficha 0005: tamaño fijo del contenido de la ventana. Cabe en la pantalla del runner del CI
 * (1024×768 menos la barra de tareas), así que es el mismo en la VPS y en el CI; con la ventana
 * por defecto (1280×800), el CI la recorta. Desde la 0021, todos los specs corren con él.
 */
export const FIXED_WINDOW: WindowSize = { width: 1024, height: 720 }
/** La ventana más pequeña que permite la app (minWidth y minHeight de src/main/window.ts). */
export const SMALL_WINDOW: WindowSize = { width: 960, height: 600 }

/** Tamaño del contenido de la ventana tal y como lo ve la página. */
export async function viewportSize(page: Page): Promise<WindowSize> {
  return page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))
}

/**
 * Ficha 0021: fija el contenido de la ventana a FIXED_WINDOW desde main (setContentSize; la app no
 * cambia) y espera a tenerlo, con el margen de `fitsContentSize`. Se llama justo después de lanzar
 * la app en cada spec (lo comprueba scripts/e2e-ci-window.test.ts): así la VPS corre los e2e con
 * la misma ventana que el CI.
 */
export async function useCiWindow(app: ElectronApplication): Promise<void> {
  const page = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }, wanted) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win === undefined) throw new Error('useCiWindow: no hay ventana')
    win.setContentSize(wanted.width, wanted.height)
  }, FIXED_WINDOW)
  await expect.poll(async () => fitsContentSize(await viewportSize(page), FIXED_WINDOW)).toBe(true)
}
