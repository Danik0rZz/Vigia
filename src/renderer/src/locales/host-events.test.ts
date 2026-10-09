import i18next, { type TFunction } from 'i18next'
import { describe, expect, it } from 'vitest'
import { I18N_INTERPOLATION, numberFormatter } from '../app/i18n-numbers'
import en from './en/common.json'
import es from './es/common.json'

/**
 * Ficha 0042: los textos de la tarjeta «Eventos» del host van en `entities.host.events` (common),
 * en es y en, con las mismas claves y ninguna vacía. La paridad general ya la mira
 * `locales.test.ts`; esto comprueba que los de la ficha existen en los dos idiomas.
 *
 * Claves (decisión del test-writer, delegada y refinable; en la ficha): `title` («Eventos»),
 * `summary` (con `shown` y `count`: «20 de 31»), `active` («Activo», en lugar del fin), `empty`
 * (sin eventos en el rango) y el texto de cada estado de Dynatrace en `status.OPEN` y
 * `status.CLOSED` (los de la OpenAPI).
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

function eventsTexts(messages: unknown): Record<string, unknown> {
  const entities = (messages as Messages)['entities'] as Messages | undefined
  const host = entities?.['host'] as Messages | undefined
  return flatten(host?.['events'])
}

const esEvents = eventsTexts(es)
const enEvents = eventsTexts(en)

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

const REQUIRED = ['title', 'summary', 'active', 'empty', 'status.OPEN', 'status.CLOSED']

describe('CA6 (0042): textos de la tarjeta «Eventos» del host en es y en', () => {
  it('título, «Activo» y «20 de N» en español, como en la ficha', async () => {
    expect(esEvents['title'], 'entities.host.events.title (es)').toBe('Eventos')
    expect(esEvents['active'], 'entities.host.events.active (es)').toBe('Activo')
    const t = await appT('es')
    expect(t('entities.host.events.summary', { shown: 20, count: 31 })).toContain('20 de 31')
  })

  it('el resumen también en inglés, con los números y sin claves sin traducir', async () => {
    const t = await appT('en')
    const text = t('entities.host.events.summary', { shown: 20, count: 31 })
    expect(text).toContain('20')
    expect(text).toContain('31')
    expect(text).not.toContain('entities.host')
    expect(text).not.toContain('20 de 31')
  })

  it('cada clave de la ficha tiene texto en los dos idiomas; los estados no son el enum', () => {
    for (const key of REQUIRED) {
      for (const [lng, texts] of [
        ['es', esEvents],
        ['en', enEvents]
      ] as const) {
        const text = texts[key]
        expect(typeof text, `entities.host.events.${key} (${lng})`).toBe('string')
        expect(String(text).trim(), `entities.host.events.${key} (${lng})`).not.toBe('')
        if (key.startsWith('status.')) {
          expect(String(text), `entities.host.events.${key} (${lng}) traducido`).not.toMatch(
            /^(OPEN|CLOSED)$/
          )
        }
      }
    }
    expect(esEvents['status.OPEN']).not.toBe(esEvents['status.CLOSED'])
    expect(enEvents['active'], 'entities.host.events.active (en) traducido').not.toBe('Activo')
  })

  it('las mismas claves en es y en, ninguna vacía', () => {
    expect(Object.keys(esEvents).length).toBeGreaterThan(0)
    expect(Object.keys(enEvents).sort()).toEqual(Object.keys(esEvents).sort())
    for (const [key, value] of [...Object.entries(esEvents), ...Object.entries(enEvents)]) {
      expect(typeof value, key).toBe('string')
      expect(String(value).trim(), key).not.toBe('')
    }
  })
})
