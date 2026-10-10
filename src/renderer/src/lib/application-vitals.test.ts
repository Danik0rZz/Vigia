import { describe, expect, it } from 'vitest'
import en from '../locales/en/common.json'
import es from '../locales/es/common.json'
import { webVitalLevel, webVitalRating } from './application-format'

/**
 * Ficha 0054, CA2: calificación de los Core Web Vitals de una aplicación web con los umbrales
 * públicos de Google, en los cortes (los «≤» incluyen el corte): LCP bueno ≤ 2,5 s y mejorable
 * ≤ 4 s; CLS ≤ 0,1 y ≤ 0,25; INP ≤ 200 ms y ≤ 500 ms; por encima, pobre. Con texto además del
 * color.
 *
 * Decisiones del test-writer (delegadas por Dani, refinables):
 * - API, en `lib/application-format.ts` (como `apdexCategory` y `apdexLevel`):
 *   `webVitalRating(vital, valor)` con `vital` `'lcp' | 'cls' | 'inp'` y el valor en la unidad
 *   del canal de la 0052 (LCP e INP en ms, CLS sin unidad); da `'good' | 'needsImprovement' |
 *   'poor'`, o null sin dato. `webVitalLevel(vital, valor)`, el nivel de color.
 * - Color, con los tokens que ya hay: bueno `success`, mejorable `warning`, pobre `error`; sin
 *   dato, `normal`.
 * - Texto: `entities.application.vitals.rating.<calificación>` (common), «Bueno», «Mejorable» y
 *   «Pobre» en español, y en inglés.
 */
type Vital = 'lcp' | 'cls' | 'inp'
type Rating = 'good' | 'needsImprovement' | 'poor'

/** Por vital: valores en cada lado de los dos cortes, con su calificación. */
const CASES: Record<Vital, [number, Rating][]> = {
  lcp: [
    [0, 'good'],
    [1_200, 'good'],
    [2_500, 'good'],
    [2_500.1, 'needsImprovement'],
    [3_200, 'needsImprovement'],
    [4_000, 'needsImprovement'],
    [4_000.1, 'poor'],
    [9_000, 'poor']
  ],
  cls: [
    [0, 'good'],
    [0.05, 'good'],
    [0.1, 'good'],
    [0.1001, 'needsImprovement'],
    [0.18, 'needsImprovement'],
    [0.25, 'needsImprovement'],
    [0.2501, 'poor'],
    [0.8, 'poor']
  ],
  inp: [
    [0, 'good'],
    [120, 'good'],
    [200, 'good'],
    [200.1, 'needsImprovement'],
    [350, 'needsImprovement'],
    [500, 'needsImprovement'],
    [500.1, 'poor'],
    [1_400, 'poor']
  ]
}

const LEVEL: Record<Rating, string> = {
  good: 'success',
  needsImprovement: 'warning',
  poor: 'error'
}

const TEXT_ES: Record<Rating, string> = {
  good: 'Bueno',
  needsImprovement: 'Mejorable',
  poor: 'Pobre'
}

type Messages = { [key: string]: string | Messages }
function ratingTexts(messages: unknown): Record<string, unknown> {
  const entities = (messages as Messages)['entities'] as Messages | undefined
  const application = entities?.['application'] as Messages | undefined
  const vitals = application?.['vitals'] as Messages | undefined
  return (vitals?.['rating'] ?? {}) as Record<string, unknown>
}

describe('CA2 (0054): calificación de LCP, CLS e INP en los cortes (2,5 s y 4 s; 0,1 y 0,25; 200 ms y 500 ms), con texto además del color', () => {
  for (const vital of ['lcp', 'cls', 'inp'] as const) {
    it(`${vital}: bueno hasta el primer corte incluido, mejorable hasta el segundo incluido y pobre por encima`, () => {
      for (const [value, rating] of CASES[vital]) {
        expect(webVitalRating(vital, value), `${vital} ${value}`).toBe(rating)
      }
    })

    it(`${vital}: el color sigue a la calificación en cada corte`, () => {
      for (const [value, rating] of CASES[vital]) {
        expect(webVitalLevel(vital, value), `${vital} ${value}`).toBe(LEVEL[rating])
      }
    })

    it(`${vital}: sin dato, sin calificación ni color`, () => {
      expect(webVitalRating(vital, null)).toBeNull()
      expect(webVitalRating(vital, Number.NaN)).toBeNull()
      expect(webVitalLevel(vital, null)).toBe('normal')
    })
  }

  it('los cortes son de cada vital: el mismo número se califica distinto en LCP, CLS e INP', () => {
    // 0,2: CLS mejorable; LCP e INP (ms), buenos. 300: INP mejorable; LCP bueno; CLS pobre.
    expect(webVitalRating('cls', 0.2)).toBe('needsImprovement')
    expect(webVitalRating('lcp', 0.2)).toBe('good')
    expect(webVitalRating('inp', 0.2)).toBe('good')
    expect(webVitalRating('inp', 300)).toBe('needsImprovement')
    expect(webVitalRating('lcp', 300)).toBe('good')
    expect(webVitalRating('cls', 300)).toBe('poor')
  })

  it('cada calificación tiene su texto en español, como en la ficha, y en inglés', () => {
    const esTexts = ratingTexts(es)
    const enTexts = ratingTexts(en)
    for (const [rating, text] of Object.entries(TEXT_ES)) {
      expect(esTexts[rating], `entities.application.vitals.rating.${rating} (es)`).toBe(text)
      const english = enTexts[rating]
      expect(typeof english, `entities.application.vitals.rating.${rating} (en)`).toBe('string')
      expect(String(english).trim(), `entities.application.vitals.rating.${rating} (en)`).not.toBe(
        ''
      )
      expect(english, `entities.application.vitals.rating.${rating} (en)`).not.toBe(text)
    }
  })
})
