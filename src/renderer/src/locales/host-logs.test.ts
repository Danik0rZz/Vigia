import i18next, { type TFunction } from 'i18next'
import { describe, expect, it } from 'vitest'
import { I18N_INTERPOLATION, numberFormatter } from '../app/i18n-numbers'
import en from './en/common.json'
import es from './es/common.json'

/**
 * Ficha 0041: los textos de la tarjeta «Logs» del host van en `entities.host.logs` (common), en
 * es y en, con las mismas claves y ninguna vacía. La paridad general ya la mira
 * `locales.test.ts`; esto comprueba que los de la ficha existen en los dos idiomas.
 *
 * Claves (decisión del test-writer, delegada y refinable; en la ficha): `title` («Logs»),
 * `summary` (con `withLogs` y `count`, el total de procesos: «3 de 12 procesos con logs»),
 * `empty` («Sin logs detectados»), el texto de cada estado del fichero en
 * `fileStatus.<enum>` (los tres vistos en vivo) más `fileStatus.unknown`, y el de la fuente en
 * `sourceState.<enum>` (el visto en vivo) más `sourceState.unknown`.
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

function logsTexts(messages: unknown): Record<string, unknown> {
  const entities = (messages as Messages)['entities'] as Messages | undefined
  const host = entities?.['host'] as Messages | undefined
  return flatten(host?.['logs'])
}

const esLogs = logsTexts(es)
const enLogs = logsTexts(en)

async function appT(lng: 'es' | 'en'): Promise<TFunction> {
  const instance = i18next.createInstance()
  await instance.use(numberFormatter).init({
    lng,
    resources: { [lng]: { common: lng === 'es' ? es : en } },
    defaultNS: 'common',
    interpolation: I18N_INTERPOLATION
  })
  return instance.getFixedT(lng)
}

/** Estados vistos en vivo en el paso 0 (son de Dynatrace). */
const FILE_STATUSES = [
  'FILE_STATUS_OK',
  'FILE_STATUS_NOT_EXIST',
  'FILE_STATUS_NOT_MONITORED_ANY_MORE',
  'unknown'
]
const SOURCE_STATES = ['LOG_STORAGE_CONFIGURATION_STATUS_SEND_TO_STORAGE', 'unknown']
const STATUS_KEYS = [
  ...FILE_STATUSES.map((s) => `fileStatus.${s}`),
  ...SOURCE_STATES.map((s) => `sourceState.${s}`)
]

describe('CA6 (0041): textos de la tarjeta «Logs» del host en es y en', () => {
  it('título, vacío y resumen en español, como en la ficha', async () => {
    expect(esLogs['title'], 'entities.host.logs.title (es)').toBe('Logs')
    expect(esLogs['empty'], 'entities.host.logs.empty (es)').toBe('Sin logs detectados')
    const t = await appT('es')
    expect(t('entities.host.logs.summary', { withLogs: 3, count: 12 })).toBe(
      '3 de 12 procesos con logs'
    )
  })

  it('el resumen también en inglés, con los números y sin claves sin traducir', async () => {
    const t = await appT('en')
    const text = t('entities.host.logs.summary', { withLogs: 3, count: 12 })
    expect(text).toContain('3')
    expect(text).toContain('12')
    expect(text).not.toContain('entities.host')
    expect(text).not.toBe('3 de 12 procesos con logs')
  })

  it('cada estado del fichero y de la fuente tiene su texto, que no es el enum', () => {
    for (const key of STATUS_KEYS) {
      for (const [lng, texts] of [
        ['es', esLogs],
        ['en', enLogs]
      ] as const) {
        const text = texts[key]
        expect(typeof text, `entities.host.logs.${key} (${lng})`).toBe('string')
        expect(String(text).trim(), `entities.host.logs.${key} (${lng})`).not.toBe('')
        expect(String(text), `entities.host.logs.${key} (${lng}) traducido`).not.toMatch(
          /^[A-Z_]+$/
        )
      }
    }
    expect(enLogs['empty'], 'entities.host.logs.empty (en) traducido').not.toBe(esLogs['empty'])
  })

  it('las mismas claves en es y en, ninguna vacía', () => {
    expect(Object.keys(esLogs).length).toBeGreaterThan(0)
    expect(Object.keys(enLogs).sort()).toEqual(Object.keys(esLogs).sort())
    for (const [key, value] of [...Object.entries(esLogs), ...Object.entries(enLogs)]) {
      expect(typeof value, key).toBe('string')
      expect(String(value).trim(), key).not.toBe('')
    }
  })
})
