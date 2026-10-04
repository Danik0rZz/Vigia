import type { Locator, Page } from '@playwright/test'

/**
 * Hover que siempre dispara los eventos de entrada (tooltips de Radix). Si el
 * puntero ya estaba sobre el elemento, o llega de un salto, Radix no ve un
 * pointerenter/pointermove y el tooltip no sale. Por eso, primero se lleva el
 * ratón en varios pasos a un punto neutro y después, también en pasos, al
 * centro del elemento.
 *
 * El punto neutro es la esquina interior de `main` (el contenido, con su
 * relleno): nunca la barra de título, que es arrastrable y no recibe el ratón.
 */
export async function hoverFresh(page: Page, target: Locator): Promise<void> {
  await moveToNeutral(page)
  await target.scrollIntoViewIfNeeded()
  const box = await target.boundingBox()
  if (box === null) throw new Error('hoverFresh: el elemento no tiene caja (¿no es visible?)')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 10 })
}

/** Lleva el ratón, en varios pasos, al punto neutro (sin tooltip) del contenido. */
export async function moveToNeutral(page: Page): Promise<void> {
  const main = await page.locator('main').first().boundingBox()
  if (main === null) throw new Error('moveToNeutral: no hay <main> visible')
  await page.mouse.move(main.x + 4, main.y + 4, { steps: 10 })
}
