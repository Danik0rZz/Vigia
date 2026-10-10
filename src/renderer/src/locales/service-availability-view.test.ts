import { describe, expect, it } from 'vitest'
import en from './en/common.json'
import es from './es/common.json'

/**
 * Ficha 0048: textos nuevos de la disponibilidad (SLO calculado) de la página del servicio, en
 * `common`, en es y en, bajo `entities.service.availability`:
 * - `title`: el nombre del gráfico («SLO» desde la ficha 0065, igual en los dos idiomas: es un
 *   nombre del glosario);
 * - `hint`: el tooltip del nombre, con la fórmula y que lo calcula Vigía;
 * - `critical`: la etiqueta de la línea del umbral («Crítico 90 %»);
 * - `series`: el nombre de la serie;
 * - `markerCritical`: el texto que acompaña al color cuando baja del 90 % (bajo el valor del
 *   marcador «SLO» desde la ficha 0066).
 * La línea `marker` («Disponibilidad {{value}}») bajo «Tasa de error» desapareció con la ficha
 * 0066: la disponibilidad tiene su propio marcador, titulado con `title`.
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

const KEYS = ['title', 'hint', 'critical', 'series', 'markerCritical'] as const
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
      // El título es «SLO» en los dos (ficha 0065): nombre propio del glosario.
      if (key !== 'title') expect(textEn, `${path}: en igual que es`).not.toBe(textEs)
    }
  })

  it('los textos que da la ficha, en español', () => {
    expect(at(es, `${base}.critical`)).toMatch(/^Crítico 90\s?%$/)
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

describe('CA1 (0065): el gráfico de disponibilidad del servicio se titula «SLO»', () => {
  it('el título vale «SLO» en es y en en', () => {
    expect(at(es, `${base}.title`)).toBe('SLO')
    expect(at(en, `${base}.title`)).toBe('SLO')
  })

  it('el tooltip sigue explicando la fórmula (peticiones, errores y Vigía)', () => {
    const hintEs = at(es, `${base}.hint`) as string
    expect(hintEs).toMatch(/peticiones/i)
    expect(hintEs).toMatch(/errores/i)
    expect(hintEs).toContain('Vigía')
    const hintEn = at(en, `${base}.hint`) as string
    expect(hintEn).toMatch(/requests/i)
    expect(hintEn).toMatch(/errors/i)
    expect(hintEn).toContain('Vigía')
  })
})
