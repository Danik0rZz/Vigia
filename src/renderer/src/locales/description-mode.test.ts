import { describe, expect, it } from 'vitest'
import esCommon from './es/common.json'
import enCommon from './en/common.json'

/**
 * Ficha 0002: la descripción del evento se ve siempre con formato. El conmutador
 * «Con formato · Texto original» desaparece, y con él sus textos en es y en.
 * «Copiar», el título y la nota de recorte se quedan. La paridad es/en la sigue
 * comprobando `locales.test.ts`.
 */

type Messages = { [key: string]: unknown }

/** El bloque `problems.eventTable.description` de un idioma. */
function descriptionBlock(messages: unknown): Messages {
  const problems = (messages as Messages)['problems'] as Messages | undefined
  const eventTable = problems?.['eventTable'] as Messages | undefined
  const description = eventTable?.['description'] as Messages | undefined
  expect(description, 'problems.eventTable.description').toBeTypeOf('object')
  return description ?? {}
}

describe('CA4 (0002): las claves del conmutador ya no existen ni en es ni en en', () => {
  for (const [locale, messages] of [
    ['es', esCommon],
    ['en', enCommon]
  ] as const) {
    it(`${locale}: sin mode, formatted ni original`, () => {
      const block = descriptionBlock(messages)
      expect(Object.keys(block)).not.toContain('mode')
      expect(Object.keys(block)).not.toContain('formatted')
      expect(Object.keys(block)).not.toContain('original')
    })

    it(`${locale}: se quedan el título, «Copiar» y la nota de recorte`, () => {
      const block = descriptionBlock(messages)
      for (const key of ['title', 'copy', 'truncated']) {
        expect(block[key], key).toBeTypeOf('string')
        expect(String(block[key]).trim(), key).not.toBe('')
      }
    })
  }
})
