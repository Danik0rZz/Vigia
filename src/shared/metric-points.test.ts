import { describe, expect, it } from 'vitest'
import {
  estimatePoints,
  POINTS_WARNING,
  RESOLUTION_STEPS,
  resolutionMs,
  seriesName,
  suggestResolution
} from './metric-points'

/**
 * AUD-13: puntos por serie de /metrics/query. La API no rebaja la resolución ni
 * avisa (1m en 7 días → 10 081 puntos, observado en vivo): lo hace la interfaz.
 */

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

describe('constantes', () => {
  it('pasos de más fino a más grueso y umbral de aviso en 2000', () => {
    expect(RESOLUTION_STEPS).toEqual(['1m', '5m', '10m', '1h', '6h', '1d'])
    expect(POINTS_WARNING).toBe(2000)
  })
})

describe('resolutionMs', () => {
  it.each([
    ['1m', MINUTE],
    ['5m', 5 * MINUTE],
    ['10m', 10 * MINUTE],
    ['1h', HOUR],
    ['6h', 6 * HOUR],
    ['1d', DAY],
    ['1w', 7 * DAY]
  ])('%s → %d ms', (resolution, ms) => {
    expect(resolutionMs(resolution)).toBe(ms)
  })

  it.each(['120', '1', 'Inf', '', 'xyz', '1 m', '10s'])(
    '%j → null (no es un intervalo)',
    (value) => {
      expect(resolutionMs(value)).toBeNull()
    }
  )
})

describe('estimatePoints', () => {
  it('sin resolución (undefined o vacía) → 120, el defecto de la API', () => {
    expect(estimatePoints(7 * DAY, undefined)).toBe(120)
    expect(estimatePoints(7 * DAY, '')).toBe(120)
  })

  it("'Inf' → 1", () => {
    expect(estimatePoints(30 * DAY, 'Inf')).toBe(1)
  })

  it('un número suelto N son N puntos', () => {
    expect(estimatePoints(7 * DAY, '120')).toBe(120)
    expect(estimatePoints(2 * HOUR, '5000')).toBe(5000)
  })

  it('intervalo: ceil(rango / paso) + 1 (los dos extremos)', () => {
    expect(estimatePoints(7 * DAY, '1m')).toBe(10_081)
    expect(estimatePoints(7 * DAY, '1h')).toBe(169)
    expect(estimatePoints(2 * HOUR, '1m')).toBe(121)
    expect(estimatePoints(30 * DAY, '1h')).toBe(721)
    // Un rango que no es múltiplo del paso redondea hacia arriba.
    expect(estimatePoints(90 * MINUTE, '1h')).toBe(3)
  })
})

describe('suggestResolution', () => {
  it.each([
    ['2 h', 2 * HOUR, '1m'],
    ['7 días', 7 * DAY, '10m'],
    ['30 días', 30 * DAY, '1h']
  ])('%s → %s', (_name, span, expected) => {
    expect(suggestResolution(span)).toBe(expected)
  })

  it('7 días: 5m daría 2017 (> 2000) y 10m da 1009', () => {
    expect(estimatePoints(7 * DAY, '5m')).toBe(2017)
    expect(estimatePoints(7 * DAY, '10m')).toBe(1009)
  })

  it('el límite es inclusivo (≤)', () => {
    // 1m con 1999 minutos de rango son exactamente 2000 puntos.
    expect(estimatePoints(1999 * MINUTE, '1m')).toBe(2000)
    expect(suggestResolution(1999 * MINUTE)).toBe('1m')
    expect(suggestResolution(2000 * MINUTE)).toBe('5m')
  })

  it("si ninguna cabe, '1d'", () => {
    expect(suggestResolution(20 * 365 * DAY)).toBe('1d')
    expect(suggestResolution(7 * DAY, 1)).toBe('1d')
  })

  it('con otro límite', () => {
    expect(suggestResolution(7 * DAY, 200)).toBe('1h')
  })

  it('la sugerencia nunca pasa del límite salvo con el último recurso', () => {
    for (const span of [HOUR, 6 * HOUR, DAY, 3 * DAY, 14 * DAY, 90 * DAY, 365 * DAY]) {
      const suggested = suggestResolution(span)
      if (suggested !== '1d') {
        expect(estimatePoints(span, suggested)).toBeLessThanOrEqual(POINTS_WARNING)
      }
    }
  })
})

describe('seriesName', () => {
  const series = {
    metricId: 'builtin:host.cpu.usage',
    dimensions: { 'dt.entity.host': 'HOST-AAA1', 'dt.entity.process_group': 'PG-1' }
  }

  it('una métrica: las dimensiones unidas con " · "', () => {
    expect(seriesName(series, false)).toBe('HOST-AAA1 · PG-1')
  })

  it('varias métricas: el metricId delante', () => {
    expect(seriesName(series, true)).toBe('builtin:host.cpu.usage · HOST-AAA1 · PG-1')
  })

  it('sin dimensiones: el metricId, haya una métrica o varias', () => {
    const bare = { metricId: 'builtin:host.cpu.usage', dimensions: {} }
    expect(seriesName(bare, false)).toBe('builtin:host.cpu.usage')
    expect(seriesName(bare, true)).toBe('builtin:host.cpu.usage')
  })
})
