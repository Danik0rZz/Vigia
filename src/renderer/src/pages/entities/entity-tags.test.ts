import { describe, expect, it } from 'vitest'
import type { EntityTag } from '@shared/modules'
import { fittingTags, lineCount, sortTags, tagText } from './entity-tags'

/** Ficha 0037: lógica de la fila de píldoras (orden, texto completo y cuántas caben). */
const tag = (key: string, value: string | null = null, context = 'CONTEXTLESS'): EntityTag => ({
  context,
  key,
  value
})

describe('ficha 0037: fila de píldoras de etiquetas', () => {
  it('ordena por clave, sin distinguir mayúsculas y con los números en su orden', () => {
    const sorted = sortTags([tag('zona'), tag('App'), tag('k10'), tag('k2'), tag('critico')], 'es')
    expect(sorted.map((item) => item.key)).toEqual(['App', 'critico', 'k2', 'k10', 'zona'])
  })

  it('el texto completo, como stringRepresentation', () => {
    expect(tagText(tag('equipo', 'pagos'))).toBe('equipo:pagos')
    expect(tagText(tag('critico'))).toBe('critico')
    expect(tagText(tag('app', 'web', 'KUBERNETES'))).toBe('[KUBERNETES]app:web')
  })

  it('cuenta las líneas de un flex-wrap, con las cajas más anchas que la fila recortadas', () => {
    expect(lineCount([], 100, 4)).toBe(0)
    expect(lineCount([40, 40], 100, 4)).toBe(1)
    expect(lineCount([40, 40, 40], 100, 4)).toBe(2)
    expect(lineCount([500, 10], 100, 4)).toBe(2)
  })

  it('todas si caben en dos líneas; si no, las que caben junto a «+N»', () => {
    expect(fittingTags([40, 40, 40, 40], 20, 100, 4)).toBe(4)
    // Línea 1: 40 + 40; línea 2: 40 y «+N» (40 + 4 + 20 < 100).
    expect(fittingTags([40, 40, 40, 40, 40], 20, 100, 4)).toBe(3)
    // Cada una llena su línea: la primera y, en la segunda, «+N».
    expect(fittingTags([100, 100, 100], 20, 100, 4)).toBe(1)
    // Sin ancho medido (fila oculta), todas.
    expect(fittingTags([40, 40, 40], 20, 0, 4)).toBe(3)
  })
})
