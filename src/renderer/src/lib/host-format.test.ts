import { describe, expect, it } from 'vitest'
import {
  USAGE_ERROR_PCT,
  USAGE_WARNING_PCT,
  formatBitRate,
  formatGigabytes,
  usageLevel
} from './host-format'

/**
 * Ficha 0018: formato de los marcadores y gráficos de la página de un HOST. Red en bits/s con la
 * unidad adaptada (bit/s, kbit/s, Mbit/s y Gbit/s, de 1000 en 1000) y un decimal desde kbit/s;
 * memoria de bytes a GB (10^9 bytes) con un decimal; separador de miles siempre (ficha 0012) y,
 * sin dato, «—». Umbrales de uso fijos: aviso por encima del 80 % y error por encima del 90 %.
 *
 * Los espacios se normalizan: Intl puede poner un espacio duro (U+00A0 o U+202F) delante de
 * la unidad, y la ficha no fija cuál.
 */
const plain = (text: string): string => text.replace(/[\u00a0\u202f]/g, ' ')

describe('CA4 (0018): unidades de red (bits/s)', () => {
  it('por debajo de 1000, en bit/s y sin decimales', () => {
    expect(plain(formatBitRate(650, 'es'))).toBe('650 bit/s')
    expect(plain(formatBitRate(650, 'en'))).toBe('650 bit/s')
    expect(plain(formatBitRate(0, 'es'))).toBe('0 bit/s')
  })

  it('desde 1000, en kbit/s con un decimal y la coma o el punto del idioma', () => {
    expect(plain(formatBitRate(3600, 'es'))).toBe('3,6 kbit/s')
    expect(plain(formatBitRate(3600, 'en'))).toBe('3.6 kbit/s')
    expect(plain(formatBitRate(1000, 'es'))).toBe('1,0 kbit/s')
  })

  it('desde un millón, en Mbit/s', () => {
    expect(plain(formatBitRate(1_500_000, 'es'))).toBe('1,5 Mbit/s')
    expect(plain(formatBitRate(1_500_000, 'en'))).toBe('1.5 Mbit/s')
    expect(plain(formatBitRate(250_000_000, 'es'))).toBe('250,0 Mbit/s')
  })

  it('desde mil millones, en Gbit/s, con separador de miles si hace falta', () => {
    expect(plain(formatBitRate(2_000_000_000, 'es'))).toBe('2,0 Gbit/s')
    expect(plain(formatBitRate(2_000_000_000, 'en'))).toBe('2.0 Gbit/s')
    expect(plain(formatBitRate(1_234_500_000_000, 'es'))).toBe('1.234,5 Gbit/s')
    expect(plain(formatBitRate(1_234_500_000_000, 'en'))).toBe('1,234.5 Gbit/s')
  })

  it('sin dato, «—» (nunca 0)', () => {
    expect(formatBitRate(null, 'es')).toBe('—')
    expect(formatBitRate(null, 'en')).toBe('—')
  })
})

describe('CA4 (0018): unidades de memoria (bytes a GB)', () => {
  it('en GB (10^9 bytes) con un decimal', () => {
    expect(plain(formatGigabytes(16_000_000_000, 'es'))).toBe('16,0 GB')
    expect(plain(formatGigabytes(16_000_000_000, 'en'))).toBe('16.0 GB')
    expect(plain(formatGigabytes(1_500_000_000, 'es'))).toBe('1,5 GB')
    expect(plain(formatGigabytes(200_000_000, 'en'))).toBe('0.2 GB')
  })

  it('con separador de miles', () => {
    expect(plain(formatGigabytes(1_234_000_000_000, 'es'))).toBe('1.234,0 GB')
    expect(plain(formatGigabytes(1_234_000_000_000, 'en'))).toBe('1,234.0 GB')
  })

  it('sin dato, «—»', () => {
    expect(formatGigabytes(null, 'es')).toBe('—')
    expect(formatGigabytes(null, 'en')).toBe('—')
  })
})

describe('CA5 (0018): umbrales de color de CPU, memoria y disco', () => {
  it('fijos: aviso al 80 % y error al 90 %', () => {
    expect(USAGE_WARNING_PCT).toBe(80)
    expect(USAGE_ERROR_PCT).toBe(90)
  })

  it('hasta el 80 % incluido, normal', () => {
    for (const value of [0, 33.5, 57, 79.9, 80])
      expect(usageLevel(value), `${value}`).toBe('normal')
  })

  it('por encima del 80 % y hasta el 90 % incluido, aviso', () => {
    for (const value of [80.1, 85, 90]) expect(usageLevel(value), `${value}`).toBe('warning')
  })

  it('por encima del 90 %, error', () => {
    for (const value of [90.1, 92, 95, 100]) expect(usageLevel(value), `${value}`).toBe('error')
  })

  it('sin dato, normal (sin color)', () => {
    expect(usageLevel(null)).toBe('normal')
  })
})
