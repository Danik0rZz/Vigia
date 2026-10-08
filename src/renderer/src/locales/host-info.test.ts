import { describe, expect, it } from 'vitest'
import en from './en/common.json'
import es from './es/common.json'

/**
 * Ficha 0020: los textos nuevos de la tarjeta «Información» del HOST van en `entities.host.info`
 * (common), en es y en (decisión delegada por Dani, refinable): el nombre de cada grupo de filas
 * en `sections.<key>`, la etiqueta de cada fila en `rows.<key>` (las mismas claves que
 * `buildHostInfo`) y el nombre de cada grupo de relaciones en `groups.<key>`. Los textos comunes
 * con la tarjeta del servicio (título, «Ver nombres», «Todas las propiedades»…) pueden seguir
 * donde los dejó la 0015. La paridad general ya la mira `locales.test.ts`.
 */
type Messages = { [key: string]: string | Messages }

/** Aplana el subárbol a `{ 'sections.system': 'Sistema', … }`. */
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
  const host = entities?.['host'] as Messages | undefined
  return flatten(host?.['info'])
}

const esInfo = info(es)
const enInfo = info(en)

/** Los nombres que da la ficha, en español. */
const LABELS_ES: Record<string, string> = {
  'sections.system': 'Sistema',
  'sections.capacity': 'Capacidad',
  'sections.network': 'Red',
  'sections.monitoring': 'Monitorización',
  'sections.grouping': 'Agrupación',
  'sections.cloud': 'Nube o virtualización',
  'groups.processes': 'Procesos',
  'groups.services': 'Servicios',
  'groups.runsOn': 'Se ejecuta en',
  'groups.hostGroup': 'Grupo de hosts',
  'groups.other': 'Otras relaciones'
}

/** Una etiqueta por fila (las claves de `buildHostInfo`). */
const ROWS = [
  'osType',
  'osVersion',
  'osArchitecture',
  'bitness',
  'cpuCores',
  'logicalCpuCores',
  'memory',
  'ipAddress',
  'networkZone',
  'monitoringMode',
  'state',
  'installerVersion',
  'firstSeen',
  'lastSeen',
  'hostGroupName',
  // Ficha 0037: sin la fila de etiquetas (van en las píldoras de arriba).
  'managementZones',
  'cloudType',
  'hypervisorType'
]

describe('CA6 (0020): textos de la tarjeta «Información» del HOST en es y en', () => {
  it('los grupos de filas y de relaciones, con su nombre en español, como en la ficha', () => {
    for (const [key, label] of Object.entries(LABELS_ES)) {
      expect(esInfo[key], `entities.host.info.${key} (es)`).toBe(label)
    }
  })

  it('y en inglés, sin vacíos', () => {
    for (const key of Object.keys(LABELS_ES)) {
      const text = enInfo[key]
      expect(typeof text, `entities.host.info.${key} (en)`).toBe('string')
      expect(String(text).trim(), `entities.host.info.${key} (en)`).not.toBe('')
    }
  })

  it('una etiqueta por fila, en es y en', () => {
    for (const row of ROWS) {
      for (const [lang, messages] of [
        ['es', esInfo],
        ['en', enInfo]
      ] as const) {
        const text = messages[`rows.${row}`]
        expect(typeof text, `entities.host.info.rows.${row} (${lang})`).toBe('string')
        expect(String(text).trim(), `entities.host.info.rows.${row} (${lang})`).not.toBe('')
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
