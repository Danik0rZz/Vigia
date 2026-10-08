import i18next, { type TFunction } from 'i18next'
import { describe, expect, it } from 'vitest'
import { I18N_INTERPOLATION, numberFormatter } from '../app/i18n-numbers'
import en from './en/common.json'
import es from './es/common.json'

/**
 * Ficha 0037, CA6: los textos de la fila de píldoras de etiquetas van en `entities.tags`
 * (common), en es y en (decisión del test-writer, delegada por Dani y refinable):
 *
 * - `label`: el nombre accesible de la fila («Etiquetas»).
 * - `more_one` / `more_other`: el del «+N» que despliega el resto, en singular y en plural (los
 *   mismos textos que tenía el «+N» de las etiquetas de la tarjeta «Información»).
 *
 * La paridad general de es y en ya la mira `locales.test.ts`.
 */
type Messages = { [key: string]: string | Messages }

function tags(messages: unknown): Messages {
  const entities = (messages as Messages)['entities'] as Messages | undefined
  return (entities?.['tags'] as Messages | undefined) ?? {}
}

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

describe('CA6 (0037): textos de la fila de etiquetas en es y en', () => {
  it('las mismas claves en es y en, sin vacíos', () => {
    const esTags = tags(es)
    const enTags = tags(en)
    const keys = Object.keys(esTags).sort()
    expect(keys).toEqual(expect.arrayContaining(['label', 'more_one', 'more_other']))
    expect(Object.keys(enTags).sort()).toEqual(keys)
    for (const key of keys) {
      expect(typeof esTags[key], `entities.tags.${key} (es)`).toBe('string')
      expect(typeof enTags[key], `entities.tags.${key} (en)`).toBe('string')
      expect(String(esTags[key]).trim(), `entities.tags.${key} (es)`).not.toBe('')
      expect(String(enTags[key]).trim(), `entities.tags.${key} (en)`).not.toBe('')
    }
  })

  it('en español: el nombre de la fila y el «+N» en singular y en plural', async () => {
    const t = await appT('es')
    expect(t('entities.tags.label')).toBe('Etiquetas')
    expect(t('entities.tags.more', { count: 1 })).toBe('Ver la etiqueta restante')
    expect(t('entities.tags.more', { count: 3 })).toBe('Ver las 3 etiquetas restantes')
  })

  it('en inglés: el nombre de la fila y el «+N» en singular y en plural', async () => {
    const t = await appT('en')
    expect(t('entities.tags.label')).toBe('Tags')
    expect(t('entities.tags.more', { count: 1 })).toBe('Show the remaining tag')
    expect(t('entities.tags.more', { count: 3 })).toBe('Show the remaining 3 tags')
  })
})
