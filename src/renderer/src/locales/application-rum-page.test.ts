import { describe, expect, it } from 'vitest'
import en from './en/common.json'
import es from './es/common.json'

/**
 * Ficha 0053, CA6: los textos nuevos de la página de la aplicación web (marcadores de usuarios y
 * sesiones, secciones «Actividad», «Errores», «Apdex» y «Acciones clave», gráficos por tipo y la
 * nota de errores sin separar) van en `entities.application` (common), en es y en (decisión del
 * test-writer, delegada por Dani y refinable): las secciones en `sections`, los marcadores en
 * `markers` y los gráficos en `charts`, con las series por tipo en `charts.series`. La paridad
 * general ya la mira `locales.test.ts`; esto comprueba que los textos de esta ficha existen de
 * verdad en los dos idiomas.
 */
type Messages = { [key: string]: string | Messages }

/** Aplana el subárbol a `{ 'markers.users': 'Usuarios activos', … }`. */
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
  'sections.activity': 'Actividad',
  'sections.errors': 'Errores',
  'sections.apdex': 'Apdex',
  'sections.keyActions': 'Acciones clave',
  'markers.users': 'Usuarios activos',
  'markers.usersEstimated': /estimad/i,
  'markers.sessions': 'Sesiones',
  'charts.actionsByType': 'Acciones por tipo',
  'charts.durationByType': 'Duración por tipo',
  'charts.errorsByType': 'Errores por tipo',
  'charts.affectedActions': 'Acciones afectadas por errores',
  'charts.series.javascript': 'JavaScript',
  'charts.series.http': 'HTTP'
}

/** Los que solo tienen que existir (texto libre), en es y en. */
const REQUIRED = [
  'markers.usersEstimatedHint',
  'charts.errorsNotSeparated',
  'charts.series.load',
  'charts.series.xhr',
  'charts.series.custom',
  'charts.series.other'
]

describe('CA6 (0053): textos nuevos de la página de la aplicación en es y en', () => {
  it('las secciones, los marcadores y los gráficos nuevos tienen su texto en español, como en la ficha', () => {
    for (const [key, label] of Object.entries(LABELS_ES)) {
      const text = esApp[key]
      if (label instanceof RegExp) {
        expect(String(text), `entities.application.${key} (es)`).toMatch(label)
      } else {
        expect(text, `entities.application.${key} (es)`).toBe(label)
      }
    }
  })

  it('el tooltip de «estimado», la nota de errores sin separar y las series por tipo, en es y en, sin vacíos', () => {
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

  it('el inglés no copia el español en los títulos de las secciones y los gráficos', () => {
    for (const key of [
      'sections.activity',
      'sections.keyActions',
      'markers.users',
      'charts.actionsByType',
      'charts.durationByType',
      'charts.errorsByType',
      'charts.affectedActions',
      'charts.errorsNotSeparated'
    ]) {
      expect(enApp[key], `entities.application.${key} (en)`).not.toBe(esApp[key])
    }
  })
})
