import { describe, expect, it } from 'vitest'
import en from './en/common.json'
import es from './es/common.json'

/**
 * Ficha 0010: los textos nuevos de la franja de problemas del gráfico «Tasa de error» van en
 * `entities.service.problemBand` (common), en es y en, con las mismas claves y ninguna vacía.
 * La paridad general de todos los namespaces ya la mira `locales.test.ts`; esto comprueba que
 * los textos de esta ficha existen de verdad en los dos idiomas.
 *
 * Claves que fija este test (la ficha no las daba): `active` («Activo», el fin de un problema
 * abierto en el tooltip), `more` (el «+N», con `{{count}}`) y `truncated` (la nota de lista
 * recortada).
 */
type Messages = { [key: string]: string | Messages }

function flatten(messages: unknown, prefix = ''): Record<string, unknown> {
  const flat: Record<string, unknown> = {}
  for (const [key, value] of Object.entries((messages ?? {}) as Messages)) {
    const path = prefix === '' ? key : `${prefix}.${key}`
    if (value !== null && typeof value === 'object') Object.assign(flat, flatten(value, path))
    else flat[path] = value
  }
  return flat
}

function band(messages: unknown): Record<string, unknown> {
  const entities = (messages as Messages)['entities'] as Messages | undefined
  const service = entities?.['service'] as Messages | undefined
  return flatten(service?.['problemBand'])
}

const esBand = band(es)
const enBand = band(en)
const KEYS = ['active', 'more', 'truncated']

describe('CA8 (0010): textos de la franja de problemas en es y en', () => {
  it('existen las claves de la franja en los dos idiomas', () => {
    for (const key of KEYS) {
      for (const [language, texts] of [
        ['es', esBand],
        ['en', enBand]
      ] as const) {
        expect(typeof texts[key], `entities.service.problemBand.${key} (${language})`).toBe(
          'string'
        )
      }
    }
  })

  it('«Activo» en español y el «+N» con su número en los dos', () => {
    expect(esBand['active']).toBe('Activo')
    expect(String(esBand['more'])).toContain('+{{count}}')
    expect(String(enBand['more'])).toContain('+{{count}}')
  })

  it('las mismas claves en es y en, ninguna vacía', () => {
    expect(Object.keys(esBand).length).toBeGreaterThan(0)
    expect(Object.keys(enBand).sort()).toEqual(Object.keys(esBand).sort())
    for (const [key, value] of [...Object.entries(esBand), ...Object.entries(enBand)]) {
      expect(typeof value, key).toBe('string')
      expect(String(value).trim(), key).not.toBe('')
    }
  })
})
