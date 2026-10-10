import { describe, expect, it } from 'vitest'
import en from './en/common.json'
import es from './es/common.json'

/**
 * Ficha 0048: textos nuevos de la disponibilidad (SLO calculado) de la página del servicio, en
 * `common`, en es y en, bajo `entities.service.availability`:
 * - `title`: el nombre del gráfico («Disponibilidad (SLO calculado)»);
 * - `hint`: el tooltip del nombre, con la fórmula y que lo calcula Vigía;
 * - `critical`: la etiqueta de la línea del umbral («Crítico 90 %»);
 * - `series`: el nombre de la serie;
 * - `marker`: la línea bajo «Tasa de error» («Disponibilidad {{value}}»);
 * - `markerCritical`: el texto que acompaña al color cuando baja del 90 %.
 * La paridad general ya la mira `locales.test.ts`; esto comprueba que existen en los dos idiomas.
 */
type Messages = { [key: string]: string | Messages }

function at(messages: unknown, path: string): unknown {
  let node: unknown = messages
  for (const part of path.split('.')) {
    node = (node as Messages | undefined)?.[part]
  }
  return node
}

const KEYS = ['title', 'hint', 'critical', 'series', 'marker', 'markerCritical'] as const
const base = 'entities.service.availability'

describe('CA6 (0048): textos nuevos de la disponibilidad en es y en', () => {
  it('cada texto en los dos idiomas, sin vacíos y el inglés traducido', () => {
    for (const key of KEYS) {
      const path = `${base}.${key}`
      const textEs = at(es, path)
      const textEn = at(en, path)
      expect(typeof textEs, `${path} (es)`).toBe('string')
      expect(typeof textEn, `${path} (en)`).toBe('string')
      expect((textEs as string).trim(), `${path} (es)`).not.toBe('')
      expect((textEn as string).trim(), `${path} (en)`).not.toBe('')
      expect(textEn, `${path}: en igual que es`).not.toBe(textEs)
    }
  })

  it('los textos que da la ficha, en español', () => {
    expect(at(es, `${base}.title`)).toBe('Disponibilidad (SLO calculado)')
    expect(at(es, `${base}.critical`)).toMatch(/^Crítico 90\s?%$/)
    expect(at(es, `${base}.marker`)).toMatch(/^Disponibilidad \{\{value\}\}$/)
    expect(at(es, `${base}.markerCritical`)).toMatch(/por debajo del 90\s?%/)
  })

  it('el tooltip da la fórmula y aclara que lo calcula Vigía, no un SLO de Dynatrace', () => {
    const hintEs = at(es, `${base}.hint`) as string
    expect(hintEs).toMatch(/peticiones/i)
    expect(hintEs).toMatch(/errores/i)
    expect(hintEs).toMatch(/×\s?100|x\s?100|\* ?100/)
    expect(hintEs).toContain('Vigía')
    expect(hintEs).toContain('Dynatrace')
    const hintEn = at(en, `${base}.hint`) as string
    expect(hintEn).toMatch(/requests/i)
    expect(hintEn).toMatch(/errors/i)
    expect(hintEn).toContain('Vigía')
  })
})
