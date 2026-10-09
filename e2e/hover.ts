import type { Locator, Page } from '@playwright/test'

type Box = { x: number; y: number; width: number; height: number }

/** Tiempo máximo para que un elemento deje de moverse antes de pasar el ratón. */
const STABLE_TIMEOUT_MS = 3_000

/** Pausa entre dos lecturas de la caja: varios fotogramas, menos que la transición del menú (200 ms). */
const STABLE_INTERVAL_MS = 50

/**
 * Hover que siempre dispara los eventos de entrada (tooltips de Radix). Si el
 * puntero ya estaba sobre el elemento, o llega de un salto, Radix no ve un
 * pointerenter/pointermove y el tooltip no sale. Por eso, primero se lleva el
 * ratón en varios pasos a un punto neutro y después, también en pasos, al
 * centro del elemento.
 *
 * La caja se lee cuando el elemento está quieto (`stableBox`): al plegar el
 * menú, la anchura del `aside` se anima y una caja leída a mitad de la
 * transición deja el puntero fuera del enlace cuando el menú termina de
 * plegarse (0044).
 *
 * El punto neutro es la esquina interior de `main` (el contenido, con su
 * relleno): nunca la barra de título, que es arrastrable y no recibe el ratón.
 */
export async function hoverFresh(page: Page, target: Locator): Promise<void> {
  await moveToNeutral(page)
  await target.scrollIntoViewIfNeeded()
  const box = await stableBox(target)
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 10 })
}

/** Lleva el ratón, en varios pasos, al punto neutro (sin tooltip) del contenido. */
export async function moveToNeutral(page: Page): Promise<void> {
  const main = await stableBox(page.locator('main').first())
  await page.mouse.move(main.x + 4, main.y + 4, { steps: 10 })
}

/**
 * Caja del elemento cuando no cambia entre dos lecturas separadas por
 * `STABLE_INTERVAL_MS` (más que un fotograma: ninguna transición ni
 * recolocación en curso). Falla si no se queda quieto en `STABLE_TIMEOUT_MS`
 * o si no tiene caja (no es visible).
 */
export async function stableBox(target: Locator): Promise<Box> {
  const deadline = Date.now() + STABLE_TIMEOUT_MS
  let previous: Box | null = null
  for (;;) {
    const box = await target.boundingBox()
    if (box === null) throw new Error('stableBox: el elemento no tiene caja (¿no es visible?)')
    if (
      previous !== null &&
      box.x === previous.x &&
      box.y === previous.y &&
      box.width === previous.width &&
      box.height === previous.height
    ) {
      return box
    }
    if (Date.now() > deadline) {
      throw new Error(`stableBox: el elemento sigue moviéndose tras ${STABLE_TIMEOUT_MS} ms`)
    }
    previous = box
    await new Promise((resolve) => setTimeout(resolve, STABLE_INTERVAL_MS))
  }
}
