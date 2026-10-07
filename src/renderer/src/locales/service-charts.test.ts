import { describe, expect, it } from 'vitest'
import en from './en/common.json'
import es from './es/common.json'

/**
 * Ficha 0009: los textos nuevos de los gráficos de un SERVICE van en
 * `entities.service.charts` (common), en es y en, con las mismas claves y ninguna vacía.
 * La paridad general de todos los namespaces ya la mira `locales.test.ts`; esto comprueba que
 * los textos de esta ficha existen de verdad en los dos idiomas.
 */
type Messages = { [key: string]: string | Messages }

/** Aplana el subárbol a `{ 'title': 'Métricas de peticiones', 'x.y': '…' }`. */
function flatten(messages: unknown, prefix = ''): Record<string, unknown> {
  const flat: Record<string, unknown> = {}
  for (const [key, value] of Object.entries((messages ?? {}) as Messages)) {
    const path = prefix === '' ? key : `${prefix}.${key}`
    if (value !== null && typeof value === 'object') Object.assign(flat, flatten(value, path))
    else flat[path] = value
  }
  return flat
}

function charts(messages: unknown): Record<string, unknown> {
  const entities = (messages as Messages)['entities'] as Messages | undefined
  const service = entities?.['service'] as Messages | undefined
  return flatten(service?.['charts'])
}

const esCharts = charts(es)
const enCharts = charts(en)

/** La sección y los cuatro gráficos de la tabla de la ficha, con su nombre en español. */
const LABELS_ES: Record<string, string> = {
  title: 'Métricas de peticiones',
  responseTime: 'Tiempo de respuesta',
  activity: 'Actividad',
  errorRate: 'Tasa de error',
  errors: 'Errores'
}

describe('CA9 (0009): textos de los gráficos en es y en', () => {
  it('la sección y los cuatro gráficos tienen su nombre en español, como en la ficha', () => {
    for (const [key, label] of Object.entries(LABELS_ES)) {
      expect(esCharts[key], `entities.service.charts.${key} (es)`).toBe(label)
    }
  })

  it('y también en inglés, sin vacíos', () => {
    for (const key of Object.keys(LABELS_ES)) {
      const text = enCharts[key]
      expect(typeof text, `entities.service.charts.${key} (en)`).toBe('string')
      expect(String(text).trim(), `entities.service.charts.${key} (en)`).not.toBe('')
    }
  })

  it('las mismas claves en es y en, ninguna vacía', () => {
    expect(Object.keys(enCharts).sort()).toEqual(Object.keys(esCharts).sort())
    for (const [key, value] of [...Object.entries(esCharts), ...Object.entries(enCharts)]) {
      expect(typeof value, key).toBe('string')
      expect(String(value).trim(), key).not.toBe('')
    }
  })
})
