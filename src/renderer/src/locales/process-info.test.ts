import { describe, expect, it } from 'vitest'
import en from './en/common.json'
import es from './es/common.json'

/**
 * Ficha 0029, CA5: los textos nuevos de la tarjeta «Información» del proceso van en
 * `entities.process.info` (common), en es y en (decisión del test-writer, delegada por Dani y
 * refinable): la etiqueta de cada fila de `buildProcessInfo` en `rows.<key>` y el nombre de cada
 * grupo de relaciones en `groups.<key>`. Los textos comunes de la tarjeta (título, «Ver nombres»,
 * «Todas las propiedades»…) pueden seguir donde los dejó la 0015. La paridad general ya la mira
 * `locales.test.ts`.
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

function info(messages: unknown): Record<string, unknown> {
  const entities = (messages as Messages)['entities'] as Messages | undefined
  const process = entities?.['process'] as Messages | undefined
  return flatten(process?.['info'])
}

const esInfo = info(es)
const enInfo = info(en)

/** Los grupos de relaciones, con el nombre que da la ficha. */
const GROUPS_ES: Record<string, string> = {
  'groups.runsOn': 'Se ejecuta en',
  'groups.processGroup': 'Process group',
  'groups.services': 'Servicios',
  'groups.other': 'Otras relaciones'
}

/** Las filas de `buildProcessInfo`. */
const ROWS = [
  'technologies',
  'listenPorts',
  'detectedName',
  'executable',
  'firstSeen',
  'lastSeen',
  'managementZones',
  'tags'
]

describe('CA5 (0029): textos de la tarjeta «Información» del proceso en es y en', () => {
  it('los grupos de relaciones, con su nombre en español, como en la ficha', () => {
    for (const [key, label] of Object.entries(GROUPS_ES)) {
      expect(esInfo[key], `entities.process.info.${key} (es)`).toBe(label)
    }
  })

  it('y en inglés, sin vacíos', () => {
    for (const key of Object.keys(GROUPS_ES)) {
      const text = enInfo[key]
      expect(typeof text, `entities.process.info.${key} (en)`).toBe('string')
      expect(String(text).trim(), `entities.process.info.${key} (en)`).not.toBe('')
    }
  })

  it('una etiqueta por fila, en es y en', () => {
    for (const row of ROWS) {
      for (const [lang, messages] of [
        ['es', esInfo],
        ['en', enInfo]
      ] as const) {
        const text = messages[`rows.${row}`]
        expect(typeof text, `entities.process.info.rows.${row} (${lang})`).toBe('string')
        expect(String(text).trim(), `entities.process.info.rows.${row} (${lang})`).not.toBe('')
      }
    }
  })

  it('las mismas claves en es y en, ninguna vacía', () => {
    expect(Object.keys(esInfo).length).toBeGreaterThan(0)
    expect(Object.keys(enInfo).sort()).toEqual(Object.keys(esInfo).sort())
    for (const [key, value] of [...Object.entries(esInfo), ...Object.entries(enInfo)]) {
      expect(typeof value, key).toBe('string')
      expect(String(value).trim(), key).not.toBe('')
    }
  })
})
