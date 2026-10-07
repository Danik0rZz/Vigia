import { describe, expect, it } from 'vitest'
import { formatDurationMs, parseResolution } from './service-format'

/** Ficha 0008 (developer): la resolución de la línea bajo los marcadores y el borde de 1 s. */
describe('parseResolution (0008)', () => {
  it('cantidad y unidad de las resoluciones de la API', () => {
    expect(parseResolution('1m')).toEqual({ amount: 1, unit: 'm' })
    expect(parseResolution('5m')).toEqual({ amount: 5, unit: 'm' })
    expect(parseResolution('1h')).toEqual({ amount: 1, unit: 'h' })
    expect(parseResolution('1d')).toEqual({ amount: 1, unit: 'd' })
    expect(parseResolution('2w')).toEqual({ amount: 2, unit: 'w' })
    expect(parseResolution('10s')).toEqual({ amount: 10, unit: 's' })
  })

  it('lo que no reconoce da null', () => {
    expect(parseResolution('Inf')).toBeNull()
    expect(parseResolution('')).toBeNull()
    expect(parseResolution('0m')).toBeNull()
    expect(parseResolution('1M')).toBeNull()
  })
})

describe('formatDurationMs en el borde de 1 s (0008)', () => {
  it('999,6 ms ya es «1,0 s»', () => {
    expect(formatDurationMs(999.6, 'es').replace(/\u00a0/g, ' ')).toBe('1,0 s')
  })
  it('un valor no finito es «—»', () => {
    expect(formatDurationMs(Number.NaN, 'es')).toBe('—')
  })
})
