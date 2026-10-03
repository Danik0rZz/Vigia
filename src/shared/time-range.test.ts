import { describe, expect, it } from 'vitest'
import { timeRangeSchema, timeRangeToDates, timeRangeToDt } from './time-range'

/** Rango temporal global → parámetros de la API v2 y fechas absolutas para la hoja Info. */

describe('timeRangeToDt', () => {
  it.each([
    ['2h', 'now-2h'],
    ['24h', 'now-24h'],
    ['7d', 'now-7d']
  ] as const)('%s → from %s, sin to (hasta ahora)', (id, from) => {
    expect(timeRangeToDt(id)).toEqual({ from })
  })

  it('un rango personalizado pasa from y to en ISO', () => {
    expect(
      timeRangeToDt({ from: '2026-10-01T08:00:00.000Z', to: '2026-10-02T08:00:00.000Z' })
    ).toEqual({ from: '2026-10-01T08:00:00.000Z', to: '2026-10-02T08:00:00.000Z' })
  })
})

describe('timeRangeToDates', () => {
  const now = new Date('2026-10-03T10:00:00.000Z')

  it.each([
    ['2h', '2026-10-03T08:00:00.000Z'],
    ['24h', '2026-10-02T10:00:00.000Z'],
    ['7d', '2026-09-26T10:00:00.000Z']
  ] as const)('%s cuenta hacia atrás desde now', (id, from) => {
    const range = timeRangeToDates(id, now)
    expect(range.from.toISOString()).toBe(from)
    expect(range.to.toISOString()).toBe(now.toISOString())
  })

  it('un rango personalizado da sus propias fechas, sin depender de now', () => {
    const range = timeRangeToDates(
      { from: '2026-10-01T08:00:00.000Z', to: '2026-10-02T08:00:00.000Z' },
      now
    )
    expect(range.from.toISOString()).toBe('2026-10-01T08:00:00.000Z')
    expect(range.to.toISOString()).toBe('2026-10-02T08:00:00.000Z')
  })

  it('no modifica la fecha que recibe', () => {
    const copy = new Date(now)
    timeRangeToDates('7d', copy)
    expect(copy.toISOString()).toBe(now.toISOString())
  })

  it('7 días son 7 × 24 h exactas, aunque haya un cambio de hora en medio', () => {
    // El 25 de octubre de 2026 Europa cambia de horario de verano a invierno.
    const afterDst = new Date('2026-10-28T12:00:00.000Z')
    const { from } = timeRangeToDates('7d', afterDst)
    expect(afterDst.getTime() - from.getTime()).toBe(7 * 24 * 3600 * 1000)
  })
})

describe('timeRangeSchema', () => {
  it.each(['2h', '24h', '7d'])('acepta %s', (id) => {
    expect(timeRangeSchema.safeParse(id).success).toBe(true)
  })

  it('acepta un rango personalizado de hasta 1 año', () => {
    expect(
      timeRangeSchema.safeParse({
        from: '2025-10-03T10:00:00.000Z',
        to: '2026-10-03T10:00:00.000Z'
      }).success
    ).toBe(true)
  })

  it.each([
    ['otro id', '30d'],
    ['custom sin fechas', 'custom'],
    ['from igual a to', { from: '2026-10-03T10:00:00.000Z', to: '2026-10-03T10:00:00.000Z' }],
    ['from después de to', { from: '2026-10-03T11:00:00.000Z', to: '2026-10-03T10:00:00.000Z' }],
    ['más de 1 año', { from: '2025-10-03T09:59:59.000Z', to: '2026-10-03T10:00:00.000Z' }],
    ['fechas que no son ISO', { from: 'ayer', to: 'hoy' }],
    ['sin to', { from: '2026-10-03T10:00:00.000Z' }]
  ])('rechaza %s', (_case, value) => {
    expect(timeRangeSchema.safeParse(value).success).toBe(false)
  })
})
