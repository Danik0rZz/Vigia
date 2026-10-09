import { describe, expect, it } from 'vitest'
import en from './en/common.json'
import es from './es/common.json'

/**
 * Ficha 0040: los textos nuevos de la página del disco (DISK) van en `entities.disk` (common):
 * marcadores en `entities.disk.markers`, gráficos en `entities.disk.charts` y la información en
 * `entities.disk.info`, en es y en, con las mismas claves y ninguna vacía. La paridad general ya
 * la mira `locales.test.ts`; esto comprueba que los textos de la ficha existen en los dos idiomas.
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

function diskTexts(messages: unknown): Record<string, unknown> {
  const entities = (messages as Messages)['entities'] as Messages | undefined
  return flatten(entities?.['disk'])
}

const esDisk = diskTexts(es)
const enDisk = diskTexts(en)

/** Los marcadores y los gráficos de la ficha, con su nombre en español. */
const LABELS_ES: Record<string, string> = {
  'markers.usage': 'Uso',
  'markers.free': 'Libre',
  'markers.read': 'Lectura',
  'markers.write': 'Escritura',
  'markers.latency': 'Latencia',
  'markers.queue': 'Cola',
  'markers.problems': 'Problemas',
  'charts.space': 'Espacio',
  'charts.throughput': 'Lectura y escritura',
  'charts.latency': 'Latencia',
  'charts.queue': 'Cola'
}

describe('CA6 (0040): textos de la página del disco en es y en', () => {
  it('los marcadores y los gráficos tienen su nombre en español, como en la ficha', () => {
    for (const [key, label] of Object.entries(LABELS_ES)) {
      expect(esDisk[key], `entities.disk.${key} (es)`).toBe(label)
    }
    // «Uso %» en la ficha: el gráfico de uso empieza por «Uso».
    expect(String(esDisk['charts.usage'] ?? ''), 'entities.disk.charts.usage (es)').toMatch(/^Uso/)
  })

  it('la información dice «Disco de» para la relación con el host', () => {
    const info = Object.entries(esDisk).filter(([key]) => key.startsWith('info.'))
    expect(
      info.some(([, value]) => value === 'Disco de'),
      'algún texto de entities.disk.info es «Disco de»'
    ).toBe(true)
  })

  it('y también en inglés, sin vacíos ni sin traducir', () => {
    for (const key of [...Object.keys(LABELS_ES), 'charts.usage']) {
      const text = enDisk[key]
      expect(typeof text, `entities.disk.${key} (en)`).toBe('string')
      expect(String(text).trim(), `entities.disk.${key} (en)`).not.toBe('')
    }
    for (const key of ['markers.free', 'markers.read', 'markers.write', 'charts.space']) {
      expect(enDisk[key], `entities.disk.${key} (en) traducido`).not.toBe(esDisk[key])
    }
  })

  it('las mismas claves en es y en, ninguna vacía', () => {
    expect(Object.keys(esDisk).length).toBeGreaterThan(0)
    expect(Object.keys(enDisk).sort()).toEqual(Object.keys(esDisk).sort())
    for (const [key, value] of [...Object.entries(esDisk), ...Object.entries(enDisk)]) {
      expect(typeof value, key).toBe('string')
      expect(String(value).trim(), key).not.toBe('')
    }
  })
})
