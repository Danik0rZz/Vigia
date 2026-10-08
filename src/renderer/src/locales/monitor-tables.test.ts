import { describe, expect, it } from 'vitest'
import en from './en/common.json'
import es from './es/common.json'

/**
 * Ficha 0025: textos de las tablas de localizaciones y de pasos o peticiones de las páginas de
 * monitor, en `entities.monitor.locations` y `entities.monitor.steps` (common; decisión delegada
 * por Dani, refinable): título (en pasos, uno por tipo: `titleBrowser` «Pasos» y `titleHttp`
 * «Peticiones»), cabecera de cada columna (`columns.<id>`, con los ids de los e2e) y, en pasos, el
 * texto que resalta el más lento (`slowest`). La paridad general de todos los namespaces ya la
 * mira `locales.test.ts`; esto comprueba que los textos de esta ficha existen en los dos idiomas.
 */
type Messages = { [key: string]: string | Messages }

/** Aplana el subárbol a `{ 'locations.title': 'Localizaciones', … }`. */
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

const LOCATION_COLUMN_IDS = ['name', 'availability', 'duration', 'failed']
const STEP_COLUMN_IDS = ['name', 'duration', 'share']

const KEYS = [
  'locations.title',
  'steps.titleBrowser',
  'steps.titleHttp',
  'steps.slowest',
  ...LOCATION_COLUMN_IDS.map((id) => `locations.columns.${id}`),
  ...STEP_COLUMN_IDS.map((id) => `steps.columns.${id}`)
]

describe('CA5 (0025): textos de las tablas de localizaciones y de pasos o peticiones en es y en', () => {
  it('títulos en español, como en la ficha', () => {
    expect(esMonitor['locations.title']).toBe('Localizaciones')
    expect(esMonitor['steps.titleBrowser']).toBe('Pasos')
    expect(esMonitor['steps.titleHttp']).toBe('Peticiones')
  })

  it('las mismas claves, sin vacíos, en es y en', () => {
    for (const texts of [esMonitor, enMonitor]) {
      for (const key of KEYS) {
        expect(typeof texts[key], `entities.monitor.${key}`).toBe('string')
        expect(String(texts[key]).trim(), `entities.monitor.${key}`).not.toBe('')
      }
    }
  })

  it('en inglés, traducidos (no los de español) y con pasos y peticiones distintos', () => {
    for (const key of ['locations.title', 'steps.titleBrowser', 'steps.titleHttp']) {
      expect(enMonitor[key], `entities.monitor.${key} (en)`).not.toBe(esMonitor[key])
    }
    expect(enMonitor['steps.titleBrowser']).not.toBe(enMonitor['steps.titleHttp'])
  })
})
