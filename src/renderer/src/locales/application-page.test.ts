import { describe, expect, it } from 'vitest'
import en from './en/common.json'
import es from './es/common.json'

/**
 * Ficha 0034, CA6: los textos nuevos de la página de la aplicación web (APPLICATION) van en
 * `entities.application` (common), en es y en (decisión del test-writer, delegada por Dani y
 * refinable): los marcadores en `markers`, los gráficos en `charts`, las categorías del Apdex en
 * `apdex`, la tabla en `actions` (título, columnas y aviso sin acciones) y la tarjeta
 * «Información» en `info` (filas en `rows` y grupos de relaciones en `groups`). Los textos
 * comunes de la tarjeta (título, «Ver nombres»…) pueden seguir donde los dejó la 0015. La paridad
 * general ya la mira `locales.test.ts`; esto comprueba que los textos de esta ficha existen de
 * verdad en los dos idiomas.
 */
type Messages = { [key: string]: string | Messages }

/** Aplana el subárbol a `{ 'markers.apdex': 'Apdex', … }`. */
function flatten(messages: unknown, prefix = ''): Record<string, unknown> {
  const flat: Record<string, unknown> = {}
  for (const [key, value] of Object.entries((messages ?? {}) as Messages)) {
    const path = prefix === '' ? key : `${prefix}.${key}`
    if (value !== null && typeof value === 'object') Object.assign(flat, flatten(value, path))
    else flat[path] = value
  }
  return flat
}

function applicationTexts(messages: unknown): Record<string, unknown> {
  const entities = (messages as Messages)['entities'] as Messages | undefined
  return flatten(entities?.['application'])
}

const esApp = applicationTexts(es)
const enApp = applicationTexts(en)

/** Los textos que la ficha nombra, con su texto en español. */
const LABELS_ES: Record<string, string | RegExp> = {
  'markers.apdex': 'Apdex',
  'markers.actions': 'Acciones',
  'markers.duration': 'Duración',
  'markers.errors': 'Errores',
  'markers.problems': 'Problemas',
  'charts.apdex': 'Apdex',
  'charts.actions': 'Acciones',
  'charts.duration': 'Duración',
  'charts.errors': 'Errores',
  'apdex.excellent': 'Excelente',
  'apdex.good': 'Buena',
  'apdex.fair': 'Aceptable',
  'apdex.poor': 'Pobre',
  'apdex.unacceptable': 'Inaceptable',
  'actions.title': 'Acciones de usuario',
  'info.groups.calls': 'Llama a',
  'info.groups.synthetic': 'Monitores sintéticos',
  'info.groups.other': /^Otras/
}

/** Los que solo tienen que existir (texto libre), en es y en. */
const REQUIRED = [
  'actions.columns.name',
  'actions.columns.count',
  'actions.columns.duration',
  'actions.empty',
  'info.rows.applicationType',
  'info.rows.applicationInjectionType',
  'info.rows.customizedName',
  'info.rows.detectedName'
]

describe('CA6 (0034): textos de la página de la aplicación en es y en', () => {
  it('los marcadores, los gráficos, el Apdex, la tabla y los grupos de relaciones tienen su texto en español, como en la ficha', () => {
    for (const [key, label] of Object.entries(LABELS_ES)) {
      const text = esApp[key]
      if (label instanceof RegExp) {
        expect(String(text), `entities.application.${key} (es)`).toMatch(label)
      } else {
        expect(text, `entities.application.${key} (es)`).toBe(label)
      }
    }
  })

  it('las columnas, el aviso sin acciones y las filas de «Información», en es y en, sin vacíos', () => {
    for (const key of [...Object.keys(LABELS_ES), ...REQUIRED]) {
      for (const [lang, messages] of [
        ['es', esApp],
        ['en', enApp]
      ] as const) {
        const text = messages[key]
        expect(typeof text, `entities.application.${key} (${lang})`).toBe('string')
        expect(String(text).trim(), `entities.application.${key} (${lang})`).not.toBe('')
      }
    }
  })

  it('las mismas claves en es y en, ninguna vacía', () => {
    expect(Object.keys(esApp).length).toBeGreaterThan(0)
    expect(Object.keys(enApp).sort()).toEqual(Object.keys(esApp).sort())
    for (const [key, value] of [...Object.entries(esApp), ...Object.entries(enApp)]) {
      expect(typeof value, key).toBe('string')
      expect(String(value).trim(), key).not.toBe('')
    }
  })
})
