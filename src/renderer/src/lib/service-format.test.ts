import { describe, expect, it } from 'vitest'
import { formatCount, formatDurationMs, formatErrorRate } from './service-format'

/**
 * Ficha 0008: formato de los marcadores de la página de un SERVICE. Tiempos en ms («850 ms»)
 * o en s con un decimal («1,2 s»; en inglés «1.2 s»), recuentos con separador de miles y tasa
 * de error en % con un decimal, con el idioma de la interfaz. Sin dato, «—».
 *
 * Los espacios se normalizan: Intl puede poner un espacio duro (U+00A0 o U+202F) delante de
 * la unidad, y la ficha no fija cuál.
 */
const plain = (text: string): string => text.replace(/[\u00a0\u202f]/g, ' ')

describe('CA2 (0008): formato de los tiempos de respuesta', () => {
  it('por debajo de un segundo, en ms y sin decimales', () => {
    expect(plain(formatDurationMs(850, 'es'))).toBe('850 ms')
    expect(plain(formatDurationMs(850, 'en'))).toBe('850 ms')
    expect(plain(formatDurationMs(105, 'es'))).toBe('105 ms')
    expect(plain(formatDurationMs(0, 'es'))).toBe('0 ms')
    expect(plain(formatDurationMs(849.6, 'es'))).toBe('850 ms')
  })

  it('desde un segundo, en s con un decimal y la coma o el punto del idioma', () => {
    expect(plain(formatDurationMs(1200, 'es'))).toBe('1,2 s')
    expect(plain(formatDurationMs(1200, 'en'))).toBe('1.2 s')
    expect(plain(formatDurationMs(2500, 'es'))).toBe('2,5 s')
    expect(plain(formatDurationMs(2500, 'en'))).toBe('2.5 s')
  })

  it('sin dato, «—» (nunca 0)', () => {
    expect(formatDurationMs(null, 'es')).toBe('—')
    expect(formatDurationMs(null, 'en')).toBe('—')
  })
})

describe('CA2 (0008): formato de los recuentos', () => {
  it('con el separador de miles del idioma', () => {
    expect(formatCount(12_345, 'es')).toBe('12.345')
    expect(formatCount(12_345, 'en')).toBe('12,345')
    expect(formatCount(1_234_567, 'es')).toBe('1.234.567')
    expect(formatCount(1_234_567, 'en')).toBe('1,234,567')
  })

  it('0 es 0 (lo dice Dynatrace) y los pequeños, tal cual', () => {
    expect(formatCount(0, 'es')).toBe('0')
    expect(formatCount(0, 'en')).toBe('0')
    expect(formatCount(135, 'es')).toBe('135')
  })

  it('sin dato, «—»', () => {
    expect(formatCount(null, 'es')).toBe('—')
    expect(formatCount(null, 'en')).toBe('—')
  })
})

describe('CA2 (0008): formato de la tasa de error', () => {
  it('en % con un decimal (el valor llega ya en %, de 0 a 100)', () => {
    expect(plain(formatErrorRate(5, 'es'))).toMatch(/^5,0 ?%$/)
    expect(plain(formatErrorRate(5, 'en'))).toMatch(/^5\.0 ?%$/)
    expect(plain(formatErrorRate(12.34, 'es'))).toMatch(/^12,3 ?%$/)
    expect(plain(formatErrorRate(12.34, 'en'))).toMatch(/^12\.3 ?%$/)
    expect(plain(formatErrorRate(0, 'es'))).toMatch(/^0,0 ?%$/)
    expect(plain(formatErrorRate(100, 'en'))).toMatch(/^100\.0 ?%$/)
  })

  it('sin dato, «—»', () => {
    expect(formatErrorRate(null, 'es')).toBe('—')
    expect(formatErrorRate(null, 'en')).toBe('—')
  })
})
