import { describe, expect, it } from 'vitest'
import en from './en/common.json'
import es from './es/common.json'

/**
 * Ficha 0054, CA5: los textos nuevos de la página de la aplicación web (secciones «Usuarios y
 * sesiones» y «Experiencia», sus gráficos y series, los datos pequeños bajo el gráfico de
 * sesiones y las tarjetas de Core Web Vitals con su tooltip) van en `entities.application`
 * (common), en es y en (decisión del test-writer, delegada por Dani y refinable), junto a los de
 * la 0053: secciones en `sections`, gráficos en `charts` (series en `charts.series`), datos
 * pequeños en `sessionStats` y Core Web Vitals en `vitals` (nombre, `<vital>Hint` del tooltip y
 * la calificación en `vitals.rating`, que mira CA2). La paridad general ya la mira
 * `locales.test.ts`; esto comprueba que los textos de esta ficha existen de verdad en los dos
 * idiomas.
 */
type Messages = { [key: string]: string | Messages }

/** Aplana el subárbol a `{ 'sections.users': 'Usuarios y sesiones', … }`. */
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
  'sections.users': 'Usuarios y sesiones',
  'sections.experience': 'Experiencia',
  'charts.activeUsers': 'Usuarios activos',
  'charts.sessions': 'Sesiones',
  'charts.series.startedSessions': /iniciadas/i,
  'charts.series.endedSessions': /terminadas/i,
  'charts.series.sessionDuration': /duración/i,
  'sessionStats.actionsPerSession': /acciones por sesión/i,
  'sessionStats.bounceRate': /rebote/i,
  'sessionStats.rageClicks': /frustración|rage/i,
  'vitals.lcp': /LCP/,
  'vitals.cls': /CLS/,
  'vitals.inp': /INP/
}

/** Los que solo tienen que existir (texto libre), en es y en. */
const REQUIRED = [
  'charts.vitals',
  'charts.series.lcp',
  'charts.series.cls',
  'charts.series.inp',
  'vitals.lcpHint',
  'vitals.clsHint',
  'vitals.inpHint'
]

describe('CA5 (0054): textos nuevos de la página de la aplicación en es y en', () => {
  it('las secciones, los gráficos, los datos pequeños y las tarjetas nuevas tienen su texto en español, como en la ficha', () => {
    for (const [key, label] of Object.entries(LABELS_ES)) {
      const text = esApp[key]
      if (label instanceof RegExp) {
        expect(String(text), `entities.application.${key} (es)`).toMatch(label)
      } else {
        expect(text, `entities.application.${key} (es)`).toBe(label)
      }
    }
  })

  it('el título del gráfico de Core Web Vitals, sus series y el tooltip de cada métrica, en es y en, sin vacíos', () => {
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

  it('el tooltip de cada métrica es una frase distinta, que no repite el nombre a secas', () => {
    for (const messages of [esApp, enApp]) {
      const hints = ['lcp', 'cls', 'inp'].map((vital) => String(messages[`vitals.${vital}Hint`]))
      expect(new Set(hints).size).toBe(3)
      for (const vital of ['lcp', 'cls', 'inp']) {
        expect(messages[`vitals.${vital}Hint`]).not.toBe(messages[`vitals.${vital}`])
      }
    }
  })

  it('el inglés no copia el español en los títulos de las secciones, los gráficos y los datos pequeños', () => {
    for (const key of [
      'sections.users',
      'sections.experience',
      'charts.activeUsers',
      'charts.sessions',
      'charts.series.startedSessions',
      'charts.series.endedSessions',
      'charts.series.sessionDuration',
      'sessionStats.actionsPerSession',
      'sessionStats.bounceRate',
      'vitals.lcpHint',
      'vitals.clsHint',
      'vitals.inpHint'
    ]) {
      expect(enApp[key], `entities.application.${key} (en)`).not.toBe(esApp[key])
    }
  })
})
