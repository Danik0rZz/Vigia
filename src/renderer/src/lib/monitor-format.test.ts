import { describe, expect, it } from 'vitest'
import {
  AVAILABILITY_ERROR_PCT,
  AVAILABILITY_WARNING_PCT,
  availabilityLevel
} from './monitor-format'

/**
 * Ficha 0024: nivel de color de la disponibilidad de un monitor (decisión de Dani, 2026-10-07):
 * error por debajo del 95 % y aviso por debajo del 99 %, los dos estrictos (95 es aviso y 99 es
 * normal). Sin dato, normal (sin color). El texto que acompaña al color lo comprueban
 * `locales/monitor-page.test.ts` y el e2e de CA1 (0024).
 */
describe('CA4 (0024): colores de disponibilidad (95 y 99 %)', () => {
  it('los umbrales son 95 (error) y 99 (aviso)', () => {
    expect(AVAILABILITY_ERROR_PCT).toBe(95)
    expect(AVAILABILITY_WARNING_PCT).toBe(99)
  })

  it('desde el 99 % incluido, normal', () => {
    for (const value of [99, 99.5, 100]) expect(availabilityLevel(value), `${value}`).toBe('normal')
  })

  it('desde el 95 % incluido y por debajo del 99 %, aviso', () => {
    for (const value of [95, 97, 98.9]) expect(availabilityLevel(value), `${value}`).toBe('warning')
  })

  it('por debajo del 95 %, error', () => {
    for (const value of [94.9, 87.5, 50, 0]) {
      expect(availabilityLevel(value), `${value}`).toBe('error')
    }
  })

  it('sin dato, normal (sin color)', () => {
    expect(availabilityLevel(null)).toBe('normal')
  })
})
