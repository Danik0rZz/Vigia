import { describe, expect, it } from 'vitest'
import en from '../locales/en/common.json'
import es from '../locales/es/common.json'
import { apdexCategory, apdexLevel, type ApdexCategory } from './application-format'

/**
 * Ficha 0034, CA2: categoría, color y texto del Apdex de una aplicación web. Cortes de la ficha:
 * excelente ≥ 0,94, buena ≥ 0,85, aceptable ≥ 0,70, pobre ≥ 0,50 y, por debajo, inaceptable
 * (los «≥» incluyen el corte). Sin dato, sin categoría.
 *
 * Decisiones del test-writer (delegadas por Dani, refinables):
 * - API: `apdexCategory(valor)` (`'excellent' | 'good' | 'fair' | 'poor' | 'unacceptable'`, o
 *   null sin dato) y `apdexLevel(valor)`, el nivel de color, en `lib/application-format.ts`
 *   (como `availabilityLevel` de `monitor-format.ts`).
 * - Color, con los tokens que ya hay: excelente y buena, `success` (verde); aceptable, `warning`;
 *   pobre e inaceptable, `error`; sin dato, `normal` (sin color).
 * - Texto: `entities.application.apdex.<categoría>` (common), en es y en.
 */
const TEXT_ES: Record<ApdexCategory, string> = {
  excellent: 'Excelente',
  good: 'Buena',
  fair: 'Aceptable',
  poor: 'Pobre',
  unacceptable: 'Inaceptable'
}

type Messages = { [key: string]: string | Messages }
function apdexTexts(messages: unknown): Record<string, unknown> {
  const entities = (messages as Messages)['entities'] as Messages | undefined
  const application = entities?.['application'] as Messages | undefined
  return (application?.['apdex'] ?? {}) as Record<string, unknown>
}

describe('CA2 (0034): categoría, color y texto del Apdex en los cortes (0,94; 0,85; 0,70; 0,50)', () => {
  it('desde 0,94 incluido, excelente', () => {
    for (const value of [0.94, 0.95, 0.99, 1]) {
      expect(apdexCategory(value), `${value}`).toBe('excellent')
    }
  })

  it('desde 0,85 incluido y por debajo de 0,94, buena', () => {
    for (const value of [0.85, 0.88, 0.9399]) expect(apdexCategory(value), `${value}`).toBe('good')
  })

  it('desde 0,70 incluido y por debajo de 0,85, aceptable', () => {
    for (const value of [0.7, 0.77, 0.8499]) expect(apdexCategory(value), `${value}`).toBe('fair')
  })

  it('desde 0,50 incluido y por debajo de 0,70, pobre', () => {
    for (const value of [0.5, 0.6, 0.6999]) expect(apdexCategory(value), `${value}`).toBe('poor')
  })

  it('por debajo de 0,50, inaceptable', () => {
    for (const value of [0.4999, 0.3, 0]) {
      expect(apdexCategory(value), `${value}`).toBe('unacceptable')
    }
  })

  it('sin dato, sin categoría', () => {
    expect(apdexCategory(null)).toBeNull()
    expect(apdexCategory(Number.NaN)).toBeNull()
  })

  it('el color sigue a la categoría en cada corte', () => {
    const cases: [number, string][] = [
      [1, 'success'],
      [0.94, 'success'],
      [0.9399, 'success'],
      [0.85, 'success'],
      [0.8499, 'warning'],
      [0.7, 'warning'],
      [0.6999, 'error'],
      [0.5, 'error'],
      [0.4999, 'error'],
      [0, 'error']
    ]
    for (const [value, level] of cases) expect(apdexLevel(value), `${value}`).toBe(level)
    expect(apdexLevel(null)).toBe('normal')
  })

  it('cada categoría tiene su texto en español, como en la ficha, y en inglés', () => {
    const esTexts = apdexTexts(es)
    const enTexts = apdexTexts(en)
    for (const [category, text] of Object.entries(TEXT_ES)) {
      expect(esTexts[category], `entities.application.apdex.${category} (es)`).toBe(text)
      const english = enTexts[category]
      expect(typeof english, `entities.application.apdex.${category} (en)`).toBe('string')
      expect(String(english).trim(), `entities.application.apdex.${category} (en)`).not.toBe('')
    }
  })
})
