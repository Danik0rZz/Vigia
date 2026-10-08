import { describe, expect, it } from 'vitest'
import en from './en/common.json'
import es from './es/common.json'

/**
 * Ficha 0018: los textos nuevos de la página de un HOST van en `entities.host` (common): los
 * marcadores en `entities.host.markers` (con los textos de nivel en `levels.warning` y
 * `levels.error`) y los gráficos en `entities.host.charts`, en es y en, con las mismas claves y
 * ninguna vacía. La paridad general de todos los namespaces ya la mira `locales.test.ts`; esto
 * comprueba que los textos de esta ficha existen de verdad en los dos idiomas.
 */
type Messages = { [key: string]: string | Messages }

/** Aplana el subárbol a `{ 'cpu': 'CPU', 'x.y': '…' }`. */
function flatten(messages: unknown, prefix = ''): Record<string, unknown> {
  const flat: Record<string, unknown> = {}
  for (const [key, value] of Object.entries((messages ?? {}) as Messages)) {
    const path = prefix === '' ? key : `${prefix}.${key}`
    if (value !== null && typeof value === 'object') Object.assign(flat, flatten(value, path))
    else flat[path] = value
  }
  return flat
}

function hostTexts(messages: unknown): Record<string, unknown> {
  const entities = (messages as Messages)['entities'] as Messages | undefined
  return flatten(entities?.['host'])
}

const esHost = hostTexts(es)
const enHost = hostTexts(en)

/** Los cinco marcadores y los cuatro gráficos de la ficha, con su nombre en español. */
const LABELS_ES: Record<string, string> = {
  'markers.cpu': 'CPU',
  'markers.memory': 'Memoria',
  'markers.network': 'Red',
  'markers.disk': 'Disco',
  'markers.problems': 'Problemas',
  'charts.cpu': 'CPU',
  'charts.memory': 'Memoria',
  'charts.network': 'Red',
  'charts.disk': 'Disco'
}

describe('CA5 (0018): los niveles de aviso y de error llevan texto además del color', () => {
  it('en es y en, sin vacíos y distintos entre sí', () => {
    for (const texts of [esHost, enHost]) {
      const warning = texts['markers.levels.warning']
      const error = texts['markers.levels.error']
      expect(typeof warning).toBe('string')
      expect(typeof error).toBe('string')
      expect(String(warning).trim()).not.toBe('')
      expect(String(error).trim()).not.toBe('')
      expect(warning).not.toBe(error)
    }
  })
})

describe('CA9 (0018): textos de la página del HOST en es y en', () => {
  it('los marcadores y los gráficos tienen su nombre en español, como en la ficha', () => {
    for (const [key, label] of Object.entries(LABELS_ES)) {
      expect(esHost[key], `entities.host.${key} (es)`).toBe(label)
    }
  })

  it('y también en inglés, sin vacíos', () => {
    for (const key of Object.keys(LABELS_ES)) {
      const text = enHost[key]
      expect(typeof text, `entities.host.${key} (en)`).toBe('string')
      expect(String(text).trim(), `entities.host.${key} (en)`).not.toBe('')
    }
  })

  it('las mismas claves en es y en, ninguna vacía', () => {
    expect(Object.keys(enHost).sort()).toEqual(Object.keys(esHost).sort())
    for (const [key, value] of [...Object.entries(esHost), ...Object.entries(enHost)]) {
      expect(typeof value, key).toBe('string')
      expect(String(value).trim(), key).not.toBe('')
    }
  })
})
