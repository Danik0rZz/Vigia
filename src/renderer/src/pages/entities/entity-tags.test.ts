import { describe, expect, it } from 'vitest'
import type { EntityTag } from '@shared/modules'
import { TAG_TONE_COUNT, fittingTags, lineCount, sortTags, tagText, tagTone } from './entity-tags'

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

/**
 * Ficha 0049 (CA1): el tono de la mitad de la clave sale de la clave con una función pura
 * (`tagTone`), un índice de la paleta de `TAG_TONE_COUNT` (8) tonos del tema.
 */
describe('CA1 (0049): color de la clave de la cápsula', () => {
  const inPalette = (tone: number): void => {
    expect(Number.isInteger(tone)).toBe(true)
    expect(tone).toBeGreaterThanOrEqual(0)
    expect(tone).toBeLessThan(TAG_TONE_COUNT)
  }

  it('la paleta tiene 8 tonos', () => {
    expect(TAG_TONE_COUNT).toBe(8)
  })

  it('la misma clave da siempre el mismo tono', () => {
    for (const key of ['equipo', 'app', 'zona', 'etiqueta-larga-01']) {
      const first = tagTone(key)
      for (let i = 0; i < 5; i += 1) expect(tagTone(key), key).toBe(first)
    }
  })

  it('cualquier texto da un tono de la paleta, también vacío o con caracteres raros', () => {
    const keys = ['', ' ', 'a', 'ñandú', 'Ä€😀', '[AWS]', 'x'.repeat(2000), '🏳️‍🌈']
    // Controles, NUL y un sustituto suelto (UTF-16 inválido).
    keys.push(String.fromCharCode(10, 9), String.fromCharCode(0), String.fromCharCode(0xd800))
    for (const key of keys) inPalette(tagTone(key))
  })

  it('reparte claves distintas por varios tonos (no siempre el mismo)', () => {
    const tones = new Set(Array.from({ length: 64 }, (_, i) => tagTone(`clave-${i}`)))
    expect(tones.size).toBeGreaterThan(4)
  })
})
