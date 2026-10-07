import { describe, expect, it } from 'vitest'
import en from './en/common.json'
import es from './es/common.json'

/**
 * Ficha 0008: los textos nuevos de los marcadores de un SERVICE van en
 * `entities.service.markers` (common), en es y en, con las mismas claves y ninguna vacía.
 * La paridad general de todos los namespaces ya la mira `locales.test.ts`; esto comprueba que
 * los textos de esta ficha existen de verdad en los dos idiomas.
 */
type Messages = { [key: string]: string | Messages }

/** Aplana el subárbol a `{ 'ok': 'Peticiones OK', 'x.y': '…' }`. */
function flatten(messages: unknown, prefix = ''): Record<string, unknown> {
  const flat: Record<string, unknown> = {}
  for (const [key, value] of Object.entries((messages ?? {}) as Messages)) {
    const path = prefix === '' ? key : `${prefix}.${key}`
    if (value !== null && typeof value === 'object') Object.assign(flat, flatten(value, path))
    else flat[path] = value
  }
  return flat
}

function markers(messages: unknown): Record<string, unknown> {
  const entities = (messages as Messages)['entities'] as Messages | undefined
  const service = entities?.['service'] as Messages | undefined
  return flatten(service?.['markers'])
}

const esMarkers = markers(es)
const enMarkers = markers(en)

/** Los cinco marcadores de la tabla de la ficha, con su nombre en español. */
const LABELS_ES: Record<string, string> = {
  ok: 'Peticiones OK',
  ko: 'Peticiones KO',
  errorRate: 'Tasa de error',
  responseTime: 'Tiempo de respuesta',
  problems: 'Problemas'
}

describe('CA8 (0008): textos de los marcadores en es y en', () => {
  it('los cinco marcadores tienen su nombre en español, como en la ficha', () => {
    for (const [key, label] of Object.entries(LABELS_ES)) {
      expect(esMarkers[key], `entities.service.markers.${key} (es)`).toBe(label)
    }
  })

  it('y también en inglés, sin vacíos', () => {
    for (const key of Object.keys(LABELS_ES)) {
      const text = enMarkers[key]
      expect(typeof text, `entities.service.markers.${key} (en)`).toBe('string')
      expect(String(text).trim(), `entities.service.markers.${key} (en)`).not.toBe('')
    }
  })

  it('las mismas claves en es y en, ninguna vacía', () => {
    expect(Object.keys(enMarkers).sort()).toEqual(Object.keys(esMarkers).sort())
    for (const [key, value] of [...Object.entries(esMarkers), ...Object.entries(enMarkers)]) {
      expect(typeof value, key).toBe('string')
      expect(String(value).trim(), key).not.toBe('')
    }
  })
})
