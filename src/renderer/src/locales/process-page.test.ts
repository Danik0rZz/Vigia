import { describe, expect, it } from 'vitest'
import en from './en/common.json'
import es from './es/common.json'

/**
 * Ficha 0028: los textos nuevos de la página del proceso (PROCESS_GROUP_INSTANCE) van en
 * `entities.process` (common): los marcadores en `entities.process.markers` y los gráficos en
 * `entities.process.charts`, en es y en, con las mismas claves y ninguna vacía. La paridad general
 * de todos los namespaces ya la mira `locales.test.ts`; esto comprueba que los textos de esta
 * ficha existen de verdad en los dos idiomas.
 */
type Messages = { [key: string]: string | Messages }

/** Aplana el subárbol a `{ 'markers.cpu': 'CPU', … }`. */
function flatten(messages: unknown, prefix = ''): Record<string, unknown> {
  const flat: Record<string, unknown> = {}
  for (const [key, value] of Object.entries((messages ?? {}) as Messages)) {
    const path = prefix === '' ? key : `${prefix}.${key}`
    if (value !== null && typeof value === 'object') Object.assign(flat, flatten(value, path))
    else flat[path] = value
  }
  return flat
}

function processTexts(messages: unknown): Record<string, unknown> {
  const entities = (messages as Messages)['entities'] as Messages | undefined
  return flatten(entities?.['process'])
}

const esProcess = processTexts(es)
const enProcess = processTexts(en)

/** Los marcadores y los gráficos de la ficha, con su nombre en español. */
const LABELS_ES: Record<string, string> = {
  'markers.cpu': 'CPU',
  'markers.memory': 'Memoria',
  'markers.network': 'Red',
  'markers.availability': 'Disponibilidad',
  'markers.resources': 'Recursos',
  'markers.problems': 'Problemas',
  'charts.cpu': 'CPU',
  'charts.memory': 'Memoria',
  'charts.network': 'Red',
  'charts.networkHealth': 'Salud de red',
  'charts.resources': 'Recursos'
}

describe('CA6 (0028): textos de la página del proceso en es y en', () => {
  it('los marcadores y los gráficos tienen su nombre en español, como en la ficha', () => {
    for (const [key, label] of Object.entries(LABELS_ES)) {
      expect(esProcess[key], `entities.process.${key} (es)`).toBe(label)
    }
  })

  it('y también en inglés, sin vacíos', () => {
    for (const key of Object.keys(LABELS_ES)) {
      const text = enProcess[key]
      expect(typeof text, `entities.process.${key} (en)`).toBe('string')
      expect(String(text).trim(), `entities.process.${key} (en)`).not.toBe('')
    }
  })

  it('las mismas claves en es y en, ninguna vacía', () => {
    expect(Object.keys(esProcess).length).toBeGreaterThan(0)
    expect(Object.keys(enProcess).sort()).toEqual(Object.keys(esProcess).sort())
    for (const [key, value] of [...Object.entries(esProcess), ...Object.entries(enProcess)]) {
      expect(typeof value, key).toBe('string')
      expect(String(value).trim(), key).not.toBe('')
    }
  })
})
