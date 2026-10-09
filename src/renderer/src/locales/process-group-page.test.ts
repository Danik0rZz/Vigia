import { describe, expect, it } from 'vitest'
import en from './en/common.json'
import es from './es/common.json'

/**
 * Ficha 0032, CA7: los textos nuevos de la página del process group (PROCESS_GROUP) van en
 * `entities.processGroup` (common), en es y en (decisión del test-writer, delegada por Dani y
 * refinable): los marcadores en `markers`, los gráficos en `charts`, la tabla en `instances`
 * (título, columnas y aviso de recorte) y la tarjeta «Información» en `info` (filas en `rows` y
 * grupos de relaciones en `groups`). Los textos comunes de la tarjeta (título, «Ver nombres»…)
 * pueden seguir donde los dejó la 0015. La paridad general ya la mira `locales.test.ts`; esto
 * comprueba que los textos de esta ficha existen de verdad en los dos idiomas.
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

function processGroupTexts(messages: unknown): Record<string, unknown> {
  const entities = (messages as Messages)['entities'] as Messages | undefined
  return flatten(entities?.['processGroup'])
}

const esGroup = processGroupTexts(es)
const enGroup = processGroupTexts(en)

/** Los textos que la ficha nombra, con su texto en español. */
const LABELS_ES: Record<string, string | RegExp> = {
  'markers.instances': 'Instancias',
  'markers.cpu': 'CPU',
  'markers.memory': 'Memoria',
  'markers.network': 'Red',
  'markers.problems': 'Problemas',
  'charts.cpu': 'CPU',
  'charts.memory': 'Memoria',
  'charts.network': 'Red',
  'charts.cpuByInstance': 'CPU por instancia',
  'instances.title': 'Instancias',
  'info.groups.instances': 'Instancias',
  'info.groups.hosts': 'Hosts',
  'info.groups.services': 'Servicios',
  'info.groups.other': /^Otras/
}

/** Los que solo tienen que existir (texto libre), en es y en. */
const REQUIRED = [
  'instances.columns.name',
  'instances.columns.host',
  'instances.columns.cpu',
  'instances.columns.memory',
  'instances.partial',
  'info.rows.technologies',
  'info.rows.listenPorts',
  'info.rows.detectedName'
]

describe('CA7 (0032): textos de la página del process group en es y en', () => {
  it('los marcadores, los gráficos, la tabla y los grupos de relaciones tienen su texto en español, como en la ficha', () => {
    for (const [key, label] of Object.entries(LABELS_ES)) {
      const text = esGroup[key]
      if (label instanceof RegExp) {
        expect(String(text), `entities.processGroup.${key} (es)`).toMatch(label)
      } else {
        expect(text, `entities.processGroup.${key} (es)`).toBe(label)
      }
    }
  })

  it('las columnas, el aviso de recorte y las filas de «Información», en es y en, sin vacíos', () => {
    for (const key of [...Object.keys(LABELS_ES), ...REQUIRED]) {
      for (const [lang, messages] of [
        ['es', esGroup],
        ['en', enGroup]
      ] as const) {
        const text = messages[key]
        expect(typeof text, `entities.processGroup.${key} (${lang})`).toBe('string')
        expect(String(text).trim(), `entities.processGroup.${key} (${lang})`).not.toBe('')
      }
    }
  })

  it('las mismas claves en es y en, ninguna vacía', () => {
    expect(Object.keys(esGroup).length).toBeGreaterThan(0)
    expect(Object.keys(enGroup).sort()).toEqual(Object.keys(esGroup).sort())
    for (const [key, value] of [...Object.entries(esGroup), ...Object.entries(enGroup)]) {
      expect(typeof value, key).toBe('string')
      expect(String(value).trim(), key).not.toBe('')
    }
  })
})
