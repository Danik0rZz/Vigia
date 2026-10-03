import { describe, expect, it } from 'vitest'
import { formatDateTime } from './format-date'

/**
 * Fechas de la interfaz en hora local, 24 h y sin Intl. Vitest fija
 * TZ=Europe/Madrid para que los cambios de hora sean deterministas.
 */

const ms = (iso: string): number => new Date(iso).getTime()

describe('zona horaria de los tests', () => {
  it('es Europe/Madrid', () => {
    expect(process.env['TZ']).toBe('Europe/Madrid')
    // 1 de enero: invierno (UTC+1); 1 de julio: verano (UTC+2).
    expect(new Date('2026-01-01T12:00:00Z').getHours()).toBe(13)
    expect(new Date('2026-07-01T12:00:00Z').getHours()).toBe(14)
  })
})

describe('formatDateTime', () => {
  it('es: dd/mm/aaaa HH:mm con ceros a la izquierda', () => {
    expect(formatDateTime(ms('2026-01-02T03:04:00Z'), 'es')).toBe('02/01/2026 04:04')
  })

  it('en: yyyy-mm-dd HH:mm', () => {
    expect(formatDateTime(ms('2026-01-02T03:04:00Z'), 'en')).toBe('2026-01-02 04:04')
  })

  it('24 h: la tarde no lleva AM/PM', () => {
    expect(formatDateTime(ms('2026-06-15T21:30:00Z'), 'es')).toBe('15/06/2026 23:30')
  })

  it('medianoche local cambia de día', () => {
    expect(formatDateTime(ms('2026-12-31T23:00:00Z'), 'es')).toBe('01/01/2027 00:00')
  })

  describe('cambio de hora de octubre (02:59 → 02:00)', () => {
    it.each([
      ['2026-10-25T00:59:00Z', 'es', '25/10/2026 02:59'],
      ['2026-10-25T01:00:00Z', 'es', '25/10/2026 02:00'],
      ['2026-10-25T00:59:00Z', 'en', '2026-10-25 02:59'],
      ['2026-10-25T01:00:00Z', 'en', '2026-10-25 02:00']
    ] as const)('%s en %s → %s', (iso, lang, expected) => {
      expect(formatDateTime(ms(iso), lang)).toBe(expected)
    })
  })

  describe('cambio de hora de marzo (01:59 → 03:00)', () => {
    it.each([
      ['2026-03-29T00:59:00Z', '29/03/2026 01:59'],
      ['2026-03-29T01:00:00Z', '29/03/2026 03:00']
    ])('%s → %s', (iso, expected) => {
      expect(formatDateTime(ms(iso), 'es')).toBe(expected)
    })
  })

  it('no usa Intl (no depende del idioma del sistema)', () => {
    const original = Intl.DateTimeFormat
    try {
      // Si la función usara Intl, este reemplazo la rompería.
      ;(Intl as unknown as { DateTimeFormat: unknown }).DateTimeFormat = () => {
        throw new Error('Intl no permitido')
      }
      expect(formatDateTime(ms('2026-01-02T03:04:00Z'), 'es')).toBe('02/01/2026 04:04')
    } finally {
      ;(Intl as unknown as { DateTimeFormat: unknown }).DateTimeFormat = original
    }
  })
})
