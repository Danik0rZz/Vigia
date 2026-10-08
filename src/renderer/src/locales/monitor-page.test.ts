import { describe, expect, it } from 'vitest'
import en from './en/common.json'
import es from './es/common.json'

/**
 * Ficha 0024: los textos nuevos de las páginas de browser monitor y HTTP monitor (que comparten
 * componentes) van en `entities.monitor` (common): los marcadores en `entities.monitor.markers`
 * (con los textos de nivel de la disponibilidad en `levels.warning` y `levels.error`) y los
 * gráficos en `entities.monitor.charts`, en es y en, con las mismas claves y ninguna vacía. La
 * paridad general de todos los namespaces ya la mira `locales.test.ts`; esto comprueba que los
 * textos de esta ficha existen de verdad en los dos idiomas.
 */
type Messages = { [key: string]: string | Messages }

/** Aplana el subárbol a `{ 'markers.duration': 'Duración', … }`. */
function flatten(messages: unknown, prefix = ''): Record<string, unknown> {
  const flat: Record<string, unknown> = {}
  for (const [key, value] of Object.entries((messages ?? {}) as Messages)) {
    const path = prefix === '' ? key : `${prefix}.${key}`
    if (value !== null && typeof value === 'object') Object.assign(flat, flatten(value, path))
    else flat[path] = value
  }
  return flat
}

function monitorTexts(messages: unknown): Record<string, unknown> {
  const entities = (messages as Messages)['entities'] as Messages | undefined
  return flatten(entities?.['monitor'])
}

const esMonitor = monitorTexts(es)
const enMonitor = monitorTexts(en)

/** Los cinco marcadores y los cuatro gráficos de la ficha, con su nombre en español. */
const LABELS_ES: Record<string, string> = {
  'markers.availability': 'Disponibilidad',
  'markers.duration': 'Duración',
  'markers.executions': 'Ejecuciones',
  'markers.locations': 'Localizaciones',
  'markers.problems': 'Problemas',
  'charts.availability': 'Disponibilidad',
  'charts.duration': 'Duración',
  'charts.executions': 'Ejecuciones',
  'charts.performance': 'Rendimiento'
}

describe('CA4 (0024): los niveles de la disponibilidad llevan texto además del color', () => {
  it('en es y en, sin vacíos y distintos entre sí', () => {
    for (const texts of [esMonitor, enMonitor]) {
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

describe('CA7 (0024): textos de las páginas de monitor en es y en', () => {
  it('los marcadores y los gráficos tienen su nombre en español, como en la ficha', () => {
    for (const [key, label] of Object.entries(LABELS_ES)) {
      expect(esMonitor[key], `entities.monitor.${key} (es)`).toBe(label)
    }
  })

  it('y también en inglés, sin vacíos', () => {
    for (const key of Object.keys(LABELS_ES)) {
      const text = enMonitor[key]
      expect(typeof text, `entities.monitor.${key} (en)`).toBe('string')
      expect(String(text).trim(), `entities.monitor.${key} (en)`).not.toBe('')
    }
  })

  it('las mismas claves en es y en, ninguna vacía', () => {
    expect(Object.keys(enMonitor).sort()).toEqual(Object.keys(esMonitor).sort())
    for (const [key, value] of [...Object.entries(esMonitor), ...Object.entries(enMonitor)]) {
      expect(typeof value, key).toBe('string')
      expect(String(value).trim(), key).not.toBe('')
    }
  })
})
