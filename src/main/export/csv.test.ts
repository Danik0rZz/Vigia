import { describe, expect, it } from 'vitest'
import { buildCsv } from './index'

/**
 * AUD-09: el CSV neutraliza (con ' delante) todo valor que llegue como TEXTO y
 * empiece por = + - @ tabulador o retorno, sea cual sea el tipo de la columna.
 * Main no se fía del renderer. Un número de verdad no se toca.
 */

type Column = { key: string; header: string; type: 'string' | 'number' | 'date' }

const TAB = String.fromCharCode(9)
const CR = String.fromCharCode(13)

/** Texto de la única celda de datos de un CSV de una columna. */
function cell(type: Column['type'], value: unknown, separator: ';' | ',' = ';'): string {
  const csv = buildCsv(
    [{ key: 'v', header: 'v', type }],
    [{ v: value as string | number | null }],
    { separator }
  )
  const lines = csv
    .subarray(3)
    .toString('utf8')
    .split(CR + String.fromCharCode(10))
  return lines[1] ?? ''
}

describe('AUD-09: neutralización en todas las columnas', () => {
  it.each(['string', 'number', 'date'] as const)(
    'columna %s: un texto que empieza por fórmula lleva comilla delante',
    (type) => {
      for (const start of ['=', '+', '-', '@']) {
        expect(cell(type, `${start}1+1`), `${type} ${start}`).toBe(`'${start}1+1`)
      }
    }
  )

  it.each(['string', 'number', 'date'] as const)(
    'columna %s: también con tabulador o retorno al principio',
    (type) => {
      expect(cell(type, `${TAB}x`)).toBe(`'${TAB}x`)
      // Con retorno, además, va entre comillas (RFC 4180).
      expect(cell(type, `${CR}x`)).toBe(`"'${CR}x"`)
    }
  )

  it("'=1+1' en una columna number → «'=1+1»", () => {
    expect(cell('number', '=1+1')).toBe("'=1+1")
  })

  it("el texto «-5» en una columna number es texto: «'-5»", () => {
    expect(cell('number', '-5')).toBe("'-5")
  })

  it('un número de verdad negativo no se toca', () => {
    expect(cell('number', -5)).toBe('-5')
    expect(cell('number', -3.5, ';')).toBe('-3,5')
    expect(cell('number', -3.5, ',')).toBe('-3.5')
  })

  it('=HYPERLINK(…) en una columna date (no es una fecha) sale tal cual con comilla', () => {
    // Lleva comillas dobles: además va entre comillas (RFC 4180), con la ' dentro.
    expect(cell('date', '=HYPERLINK("http://x","y")')).toBe(`"'=HYPERLINK(""http://x"",""y"")"`)
  })

  it('un texto que no es fecha ni fórmula, en una columna date, sale tal cual', () => {
    expect(cell('date', 'ayer')).toBe('ayer')
  })

  it('una fecha ISO válida como texto en una columna date sale en ISO UTC, sin comilla', () => {
    expect(cell('date', '2026-10-03T10:05:00+02:00')).toBe('2026-10-03T08:05:00.000Z')
    expect(cell('date', Date.UTC(2026, 9, 3, 8, 5))).toBe('2026-10-03T08:05:00.000Z')
  })

  it('un texto inofensivo no cambia en ninguna columna', () => {
    expect(cell('string', 'pagos')).toBe('pagos')
    expect(cell('number', '12')).toBe('12')
  })

  it('NaN e infinitos en una columna number → celda vacía', () => {
    expect(cell('number', Number.NaN)).toBe('')
    expect(cell('number', Number.POSITIVE_INFINITY)).toBe('')
    expect(cell('number', Number.NEGATIVE_INFINITY)).toBe('')
  })

  it('la cabecera también se neutraliza', () => {
    const csv = buildCsv([{ key: 'v', header: '=SUM(A1)', type: 'number' }], [], {
      separator: ';'
    })
    expect(csv.subarray(3).toString('utf8').split(CR)[0]).toBe("'=SUM(A1)")
  })
})
