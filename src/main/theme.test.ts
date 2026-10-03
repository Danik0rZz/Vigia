import { describe, expect, it } from 'vitest'
import { TITLE_BAR_HEIGHT, titleBarColors } from './theme'

describe('titleBarColors', () => {
  it('los botones nativos contrastan con su fondo en ambos temas', () => {
    for (const dark of [true, false]) {
      const { overlay } = titleBarColors(dark)
      expect(overlay.color).not.toBe(overlay.symbolColor)
      expect(overlay.height).toBe(TITLE_BAR_HEIGHT)
    }
  })

  it('el fondo de la ventana coincide con el de la barra de título', () => {
    for (const dark of [true, false]) {
      const colors = titleBarColors(dark)
      expect(colors.background).toBe(colors.overlay.color)
    }
    expect(titleBarColors(true).background).not.toBe(titleBarColors(false).background)
  })
})
