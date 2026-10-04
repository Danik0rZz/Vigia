import { describe, expect, it } from 'vitest'
import { cellText, toDate } from './format'

/** AUD-09: texto plano de una celda (base del CSV y del TXT). */

const number = { key: 'n', header: 'n', type: 'number' } as const
const date = { key: 'd', header: 'd', type: 'date' } as const
const text = { key: 's', header: 's', type: 'string' } as const

describe('cellText', () => {
  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY]
  ])('%s → vacío, en cualquier tipo de columna', (_name, value) => {
    for (const column of [number, date, text]) expect(cellText(column, value)).toBe('')
  })

  it('null y undefined → vacío', () => {
    expect(cellText(number, null)).toBe('')
    expect(cellText(text, undefined)).toBe('')
  })

  it('números finitos con punto decimal', () => {
    expect(cellText(number, -3.5)).toBe('-3.5')
    expect(cellText(number, 0)).toBe('0')
  })

  it('fechas en ISO UTC, vengan en ms o en ISO; un texto que no es fecha, tal cual', () => {
    expect(cellText(date, Date.UTC(2026, 9, 3, 8, 5))).toBe('2026-10-03T08:05:00.000Z')
    expect(cellText(date, '2026-10-03T10:05:00+02:00')).toBe('2026-10-03T08:05:00.000Z')
    expect(cellText(date, '=1+1')).toBe('=1+1')
  })
})

describe('toDate', () => {
  it('null, vacío o no fecha → null', () => {
    expect(toDate(null)).toBeNull()
    expect(toDate('')).toBeNull()
    expect(toDate('ayer')).toBeNull()
    expect(toDate(Number.NaN)).toBeNull()
  })
})
