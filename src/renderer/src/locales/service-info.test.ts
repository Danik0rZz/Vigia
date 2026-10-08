import { describe, expect, it } from 'vitest'
import en from './en/common.json'
import es from './es/common.json'

/**
 * Ficha 0015: los textos nuevos de la tarjeta «Información» van en `entities.service.info`
 * (common), en es y en, con las mismas claves y ninguna vacía. Las etiquetas de las filas de
 * «Servicio» van en `entities.service.info.rows.<key>` (las mismas claves que `buildServiceInfo`)
 * y los nombres de los grupos, en `entities.service.info.groups.<key>`. La paridad general ya la
 * mira `locales.test.ts`; esto comprueba que los de esta ficha existen en los dos idiomas.
 */
type Messages = { [key: string]: string | Messages }

/** Aplana el subárbol a `{ 'title': 'Información', 'groups.calls': 'Llama a', … }`. */
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
  const service = entities?.['service'] as Messages | undefined
  return flatten(service?.['info'])
}

const esInfo = info(es)
const enInfo = info(en)

/** Los textos que da la ficha, en español. */
const LABELS_ES: Record<string, string> = {
  title: 'Información',
  service: 'Servicio',
  relations: 'Relaciones',
  allProperties: 'Todas las propiedades',
  showNames: 'Ver nombres',
  noName: 'sin nombre',
  'groups.runsOn': 'Se ejecuta en',
  'groups.calls': 'Llama a',
  'groups.calledBy': 'Lo llaman',
  'groups.other': 'Otras relaciones'
}

/** Una etiqueta por fila de la columna «Servicio». */
const ROWS = [
  'serviceType',
  'technologies',
  'webServerName',
  'webService',
  'contextRoot',
  'port',
  'isExternalService',
  'remoteEndpoint',
  'databaseVendor',
  'databaseName',
  'applicationName',
  'applicationEnvironment',
  'applicationReleaseVersion',
  'publicCloudId',
  'publicCloudRegion',
  'firstSeen',
  'lastSeen',
  // Ficha 0037: sin la fila de etiquetas (van en las píldoras de arriba).
  'managementZones'
]

describe('CA9 (0015): textos de la tarjeta «Información» en es y en', () => {
  it('los textos de la ficha, en español', () => {
    for (const [key, label] of Object.entries(LABELS_ES)) {
      expect(esInfo[key], `entities.service.info.${key} (es)`).toBe(label)
    }
  })

  it('y en inglés, sin vacíos', () => {
    for (const key of Object.keys(LABELS_ES)) {
      const text = enInfo[key]
      expect(typeof text, `entities.service.info.${key} (en)`).toBe('string')
      expect(String(text).trim(), `entities.service.info.${key} (en)`).not.toBe('')
    }
  })

  it('una etiqueta por fila de «Servicio», en es y en', () => {
    for (const row of ROWS) {
      for (const [lang, messages] of [
        ['es', esInfo],
        ['en', enInfo]
      ] as const) {
        const text = messages[`rows.${row}`]
        expect(typeof text, `entities.service.info.rows.${row} (${lang})`).toBe('string')
        expect(String(text).trim(), `entities.service.info.rows.${row} (${lang})`).not.toBe('')
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
