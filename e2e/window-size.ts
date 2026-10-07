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
