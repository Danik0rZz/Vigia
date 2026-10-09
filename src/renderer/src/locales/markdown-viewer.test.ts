import { describe, expect, it } from 'vitest'
import enCommon from './en/common.json'
import esCommon from './es/common.json'

/**
 * Ficha 0038 (CA8): textos nuevos del visor de Markdown en es y en. Contrato elegido al escribir
 * los tests (anotado en la ficha): bloque `markdown` de `common` con `copyCode` («Copiar» del
 * bloque de código) y `alerts.<tipo>` para el título de cada aviso de GitHub. El aviso de copiado
 * reutiliza `errorScreen.copied`. La paridad completa es/en la sigue comprobando `locales.test.ts`.
 */

type Messages = { [key: string]: unknown }

const TITLES = {
  es: {
    note: 'Información',
    tip: 'Consejo',
    important: 'Importante',
    warning: 'Aviso',
    caution: 'Peligro'
  },
  en: { note: 'Note', tip: 'Tip', important: 'Important', warning: 'Warning', caution: 'Caution' }
} as const

function markdownBlock(messages: unknown): Messages {
  const block = (messages as Messages)['markdown'] as Messages | undefined
  expect(block, 'markdown').toBeTypeOf('object')
  return block ?? {}
}

describe('CA8 (0038): textos del visor de Markdown en es y en', () => {
  for (const [locale, messages] of [
    ['es', esCommon],
    ['en', enCommon]
  ] as const) {
    it(`${locale}: «Copiar» del bloque de código`, () => {
      const copy = markdownBlock(messages)['copyCode']
      expect(copy).toBeTypeOf('string')
      expect(String(copy).trim()).not.toBe('')
    })

    it(`${locale}: título de los cinco avisos de GitHub`, () => {
      const alerts = markdownBlock(messages)['alerts'] as Messages | undefined
      expect(alerts, 'markdown.alerts').toBeTypeOf('object')
      for (const [type, title] of Object.entries(TITLES[locale])) {
        expect(String(alerts?.[type] ?? '').toLowerCase(), type).toBe(title.toLowerCase())
      }
    })
  }

  it('es: «Copiar», como el «Copiar» de la descripción', () => {
    expect(markdownBlock(esCommon)['copyCode']).toBe('Copiar')
  })
})
