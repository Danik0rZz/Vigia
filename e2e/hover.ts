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
 * Si el camino cruza otro disparador y su tooltip llega a abrirse (con la
 * máquina cargada, los pasos son lentos y pasa el retardo), al salir de él
 * Radix marca el puntero «en tránsito» e ignora los `pointermove` sobre el
 * elemento hasta que ese otro tooltip se cierra, y eso puede llegar después
 * del último paso: sin otro movimiento, el tooltip del elemento no sale. Por
 * eso, al llegar, `settleOnTarget` mueve el ratón 1 px dentro del elemento
 * hasta que no queda abierto ningún otro tooltip, y una vez más después (0044).
 *
 * El punto neutro es la esquina interior de `main` (el contenido, con su
 * relleno): nunca la barra de título, que es arrastrable y no recibe el ratón.
 */
export async function hoverFresh(page: Page, target: Locator): Promise<void> {
  await moveToNeutral(page)
  await target.scrollIntoViewIfNeeded()
  const box = await stableBox(target)
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y, { steps: 10 })
  await settleOnTarget(page, target, x, y)
}

/**
 * Con el ratón ya sobre el elemento, lo mueve 1 px (ida y vuelta) cada
 * `STABLE_INTERVAL_MS` mientras haya abierto el tooltip de otro disparador de
 * Radix (`data-state` distinto de `closed`, fuera del elemento), y una vez más
 * cuando ya no queda ninguno. Si en `STABLE_TIMEOUT_MS` no se cierra, sigue: lo
 * que espere el test dará el fallo.
 */
async function settleOnTarget(page: Page, target: Locator, x: number, y: number): Promise<void> {
  const deadline = Date.now() + STABLE_TIMEOUT_MS
  for (let i = 1; ; i++) {
    const otherOpen = await target.evaluate((el) =>
      // Disparadores de tooltip de Radix abiertos fuera del elemento.
      Array.from(
        el.ownerDocument.querySelectorAll(
          '[data-state="delayed-open"], [data-state="instant-open"]'
        )
      ).some(
        (node) =>
          // El propio contenido del tooltip lleva el mismo data-state: no es un disparador.
          node.closest('[data-radix-popper-content-wrapper]') === null &&
          !el.contains(node) &&
          !node.contains(el)
      )
    )
    if (!otherOpen || Date.now() > deadline) break
    await page.mouse.move(x + (i % 2), y)
    await new Promise((resolve) => setTimeout(resolve, STABLE_INTERVAL_MS))
  }
  await page.mouse.move(x + 1, y)
  await page.mouse.move(x, y)
}

/** Lleva el ratón, en varios pasos, al punto neutro (sin tooltip) del contenido. */
export async function moveToNeutral(page: Page): Promise<void> {
  const main = await stableBox(page.locator('main').first())
  await page.mouse.move(main.x + 4, main.y + 4, { steps: 10 })
}

/**
 * Caja del elemento cuando está quieto: primero espera a que acaben las
 * animaciones y transiciones CSS finitas del documento (las infinitas, como un
 * spinner, no mueven nada y se ignoran) y después a que la caja no cambie
 * entre dos lecturas separadas por `STABLE_INTERVAL_MS`. Lo segundo solo no
 * basta: con la máquina cargada, el renderer puede no pintar fotogramas en
 * esa pausa y las dos lecturas dan la caja de antes de la transición. Falla si
 * no se queda quieto en `STABLE_TIMEOUT_MS` o si no tiene caja (no es
 * visible).
 */
export async function stableBox(target: Locator): Promise<Box> {
  const deadline = Date.now() + STABLE_TIMEOUT_MS
  const settled = await target.evaluate(
    (el, timeoutMs) =>
      Promise.race([
        Promise.all(
          el.ownerDocument
            .getAnimations()
            .filter((a) => Number.isFinite(a.effect?.getComputedTiming().endTime ?? Infinity))
            .map((a) => a.finished.catch(() => undefined))
        ).then(() => true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs))
      ]),
    STABLE_TIMEOUT_MS
  )
  if (!settled) {
    throw new Error(`stableBox: las animaciones no acaban tras ${STABLE_TIMEOUT_MS} ms`)
  }
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
