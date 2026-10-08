import { describe, expect, it } from 'vitest'
import en from './en/common.json'
import es from './es/common.json'

/**
 * Ficha 0026, CA5: los textos nuevos de la tarjeta «Información» de los monitores van en
 * `entities.monitor.info` (common), en es y en (decisión delegada por Dani, refinable): la
 * etiqueta de cada fila en `rows.<key>` (al menos las obligatorias de `buildMonitorInfo`) y el
 * nombre de cada grupo de relaciones en `groups.<key>`. Los textos comunes de la tarjeta (título,
 * «Ver nombres», «Todas las propiedades»…) pueden seguir donde los dejó la 0015. La paridad
 * general ya la mira `locales.test.ts`.
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
  const monitor = entities?.['monitor'] as Messages | undefined
  return flatten(monitor?.['info'])
}

const esInfo = info(es)
const enInfo = info(en)

/** Los grupos de relaciones, con el nombre que da la ficha. */
const GROUPS_ES: Record<string, string> = {
  'groups.monitors': 'Monitoriza',
  'groups.locations': 'Localizaciones',
  'groups.steps': 'Pasos',
  'groups.requests': 'Peticiones',
  'groups.other': 'Otras relaciones'
}

/** Las filas obligatorias de `buildMonitorInfo`. */
const ROWS = [
  'monitorType',
  'enabled',
  'frequency',
  'locations',
  'steps',
  'requests',
  'firstSeen',
  'lastSeen',
  'managementZones',
  'tags'
]

describe('CA5 (0026): textos de la tarjeta «Información» de los monitores en es y en', () => {
  it('los grupos de relaciones, con su nombre en español, como en la ficha', () => {
    for (const [key, label] of Object.entries(GROUPS_ES)) {
      expect(esInfo[key], `entities.monitor.info.${key} (es)`).toBe(label)
    }
  })

  it('y en inglés, sin vacíos', () => {
    for (const key of Object.keys(GROUPS_ES)) {
      const text = enInfo[key]
      expect(typeof text, `entities.monitor.info.${key} (en)`).toBe('string')
      expect(String(text).trim(), `entities.monitor.info.${key} (en)`).not.toBe('')
    }
  })

  it('una etiqueta por fila obligatoria, en es y en', () => {
    for (const row of ROWS) {
      for (const [lang, messages] of [
        ['es', esInfo],
        ['en', enInfo]
      ] as const) {
        const text = messages[`rows.${row}`]
        expect(typeof text, `entities.monitor.info.rows.${row} (${lang})`).toBe('string')
        expect(String(text).trim(), `entities.monitor.info.rows.${row} (${lang})`).not.toBe('')
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
