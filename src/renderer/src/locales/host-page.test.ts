import { describe, expect, it } from 'vitest'
import en from './en/common.json'
import es from './es/common.json'

/**
 * Ficha 0018: los textos nuevos de la página de un HOST van en `entities.host` (common): los
 * marcadores en `entities.host.markers` (con los textos de nivel en `levels.warning` y
 * `levels.error`) y los gráficos en `entities.host.charts`, en es y en, con las mismas claves y
 * ninguna vacía. La paridad general de todos los namespaces ya la mira `locales.test.ts`; esto
 * comprueba que los textos de esta ficha existen de verdad en los dos idiomas.
 */
type Messages = { [key: string]: string | Messages }

/** Aplana el subárbol a `{ 'cpu': 'CPU', 'x.y': '…' }`. */
function flatten(messages: unknown, prefix = ''): Record<string, unknown> {
  const flat: Record<string, unknown> = {}
  for (const [key, value] of Object.entries((messages ?? {}) as Messages)) {
    const path = prefix === '' ? key : `${prefix}.${key}`
    if (value !== null && typeof value === 'object') Object.assign(flat, flatten(value, path))
    else flat[path] = value
  }
  return flat
}

function hostTexts(messages: unknown): Record<string, unknown> {
  const entities = (messages as Messages)['entities'] as Messages | undefined
  return flatten(entities?.['host'])
}

const esHost = hostTexts(es)
const enHost = hostTexts(en)

/** Los cinco marcadores y los cuatro gráficos de la ficha, con su nombre en español. */
const LABELS_ES: Record<string, string> = {
  'markers.cpu': 'CPU',
  'markers.memory': 'Memoria',
  'markers.network': 'Red',
  'markers.disk': 'Disco',
  'markers.problems': 'Problemas',
  'charts.cpu': 'CPU',
  'charts.memory': 'Memoria',
  'charts.network': 'Red',
  'charts.disk': 'Disco'
}

describe('CA5 (0018): los niveles de aviso y de error llevan texto además del color', () => {
  it('en es y en, sin vacíos y distintos entre sí', () => {
    for (const texts of [esHost, enHost]) {
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

describe('CA9 (0018): textos de la página del HOST en es y en', () => {
  it('los marcadores y los gráficos tienen su nombre en español, como en la ficha', () => {
    for (const [key, label] of Object.entries(LABELS_ES)) {
      expect(esHost[key], `entities.host.${key} (es)`).toBe(label)
    }
  })

  it('y también en inglés, sin vacíos', () => {
    for (const key of Object.keys(LABELS_ES)) {
      const text = enHost[key]
      expect(typeof text, `entities.host.${key} (en)`).toBe('string')
      expect(String(text).trim(), `entities.host.${key} (en)`).not.toBe('')
    }
  })

  it('las mismas claves en es y en, ninguna vacía', () => {
    expect(Object.keys(enHost).sort()).toEqual(Object.keys(esHost).sort())
    for (const [key, value] of [...Object.entries(esHost), ...Object.entries(enHost)]) {
      expect(typeof value, key).toBe('string')
      expect(String(value).trim(), key).not.toBe('')
    }
  })
})

/**
 * Ficha 0019: textos de las tablas de discos y procesos, en `entities.host.disks` y
 * `entities.host.processes` (decisión delegada por Dani, refinable): título, vacío y cabecera de
 * cada columna (`columns.<id>`, con los ids de los e2e); en procesos, además, el recuento
 * («10 de N procesos», `count` o sus plurales `count_*`) y el aviso de recorte (`partial`).
 */
const DISK_COLUMN_IDS = ['name', 'usage', 'used', 'free', 'read', 'write']
const PROCESS_COLUMN_IDS = ['name', 'cpu', 'cpuMax', 'memory']

describe('CA7 (0019): textos de las tablas de discos y procesos en es y en', () => {
  it('títulos y vacíos en español, como en la ficha', () => {
    expect(esHost['disks.title']).toBe('Discos')
    expect(String(esHost['processes.title'])).toMatch(/^Procesos/)
    expect(esHost['disks.empty']).toBe('Sin discos')
    expect(esHost['processes.empty']).toBe('Sin procesos')
    expect(String(esHost['processes.partial'])).toMatch(/incomplet/i)
  })

  it('las mismas claves, sin vacíos, en es y en', () => {
    const keys = [
      'disks.title',
      'disks.empty',
      'processes.title',
      'processes.empty',
      'processes.partial',
      ...DISK_COLUMN_IDS.map((id) => `disks.columns.${id}`),
      ...PROCESS_COLUMN_IDS.map((id) => `processes.columns.${id}`)
    ]
    for (const texts of [esHost, enHost]) {
      for (const key of keys) {
        expect(typeof texts[key], key).toBe('string')
        expect(String(texts[key]).trim(), key).not.toBe('')
      }
    }
    expect(enHost['disks.empty']).not.toBe(esHost['disks.empty'])
    expect(enHost['processes.empty']).not.toBe(esHost['processes.empty'])
  })

  it('el recuento de procesos, con sus dos valores, en es y en', () => {
    for (const texts of [esHost, enHost]) {
      const count = Object.keys(texts).filter((key) => /^processes\.count(_\w+)?$/.test(key))
      expect(count.length).toBeGreaterThan(0)
      for (const key of count) {
        expect((String(texts[key]).match(/\{\{\s*\w+[^}]*\}\}/g) ?? []).length, key).toBe(2)
      }
    }
  })
})

/**
 * Ficha 0039: textos de la memoria total y recuperable, en `entities.host` de es y en. No se
 * fijan las claves (las elige el developer); sí que existan: la palabra «recuperable» en los
 * marcadores, su ayuda (lo que el sistema puede liberar si hace falta, como cachés) y, en las
 * series del gráfico, la usada, la recuperable y la total. La ayuda en inglés se redacta a partir
 * de la `description` del descriptor, sin copiarla tal cual.
 */
const keysMatching = (texts: Record<string, unknown>, prefix: string, pattern: RegExp): string[] =>
  Object.keys(texts).filter((key) => key.startsWith(prefix) && pattern.test(String(texts[key])))

describe('CA5 (0039): textos de la memoria recuperable y total en es y en', () => {
  it('marcador: «recuperable» y su ayuda (liberar, cachés) en español', () => {
    expect(keysMatching(esHost, 'markers.', /recuperable/i).length).toBeGreaterThan(0)
    const help = keysMatching(esHost, 'markers.', /liberar/i)
    expect(help.length, 'ayuda de la recuperable').toBeGreaterThan(0)
    expect(help.some((key) => /cach[ée]/i.test(String(esHost[key])))).toBe(true)
  })

  it('las mismas claves en inglés, traducidas y sin copiar la descripción de Dynatrace', () => {
    const keys = [
      ...keysMatching(esHost, 'markers.', /recuperable|liberar/i),
      ...keysMatching(esHost, 'charts.series.', /recuperable/i)
    ]
    expect(keys.length).toBeGreaterThan(1)
    for (const key of keys) {
      const text = String(enHost[key] ?? '')
      expect(text.trim(), `${key} (en)`).not.toBe('')
      expect(text, `${key} (en)`).not.toBe(esHost[key])
      expect(text, `${key} (en)`).not.toContain('calculated as available memory')
    }
    expect(keysMatching(enHost, 'markers.', /reclaimable/i).length).toBeGreaterThan(0)
  })

  it('series del gráfico: usada, recuperable y una total de memoria distinta del «Uso total» de la CPU', () => {
    expect(keysMatching(esHost, 'charts.series.', /usad/i).length).toBeGreaterThan(0)
    expect(keysMatching(esHost, 'charts.series.', /recuperable/i).length).toBeGreaterThan(0)
    const totals = keysMatching(esHost, 'charts.series.', /total/i).filter(
      (key) => key !== 'charts.series.total'
    )
    expect(totals.length, 'serie de la memoria total').toBeGreaterThan(0)
    for (const key of totals) expect(String(enHost[key] ?? '').trim(), key).not.toBe('')
  })
})
