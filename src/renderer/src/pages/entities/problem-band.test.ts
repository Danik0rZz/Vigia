import { describe, expect, it } from 'vitest'
import { problemBandLayout } from './problem-band'

/**
 * Ficha 0010: cálculo de los tramos de la franja de problemas sobre el gráfico «Tasa de
 * error». Función pura: `problemBandLayout(problems, { from, to })`, con los problemas tal
 * como llegan de `entities:problems` (endTime ya normalizado: `null` si sigue abierto) y el
 * rango visible en milisegundos.
 *
 * Lo que fijan estos tests (la ficha no lo daba): devuelve `{ segments, overflow }`. Cada
 * tramo lleva el `problemId` de su problema, `start` y `end` (ms, ya recortados al rango) y
 * `row` (0, 1 o 2). `overflow` es cuántos problemas del rango no se dibujan por no caber en
 * las 3 filas (el «+N» de la última fila); 0 si caben todos.
 */

type BandProblem = {
  problemId: string
  displayId: string
  title: string
  status: 'OPEN' | 'CLOSED'
  severityLevel: string
  startTime: number
  endTime: number | null
}

type Segment = { problemId: string; start: number; end: number; row: number }

const MIN = 60_000
/** Rango visible inventado: 2 h, de 08:00 a 10:00 UTC del 3 de octubre de 2026. */
const FROM = Date.UTC(2026, 9, 3, 8, 0)
const TO = Date.UTC(2026, 9, 3, 10, 0)
const RANGE = { from: FROM, to: TO }

function problem(id: string, startTime: number, endTime: number | null): BandProblem {
  return {
    problemId: id,
    displayId: `P-${id}`,
    title: `Problema ${id}`,
    status: endTime === null ? 'OPEN' : 'CLOSED',
    severityLevel: 'ERROR',
    startTime,
    endTime
  }
}

function layout(problems: BandProblem[]): { segments: Segment[]; overflow: number } {
  return problemBandLayout(problems as never, RANGE) as unknown as {
    segments: Segment[]
    overflow: number
  }
}

function segmentOf(segments: Segment[], id: string): Segment {
  const found = segments.find((segment) => segment.problemId === id)
  expect(found, `tramo de ${id}`).toBeDefined()
  return found as Segment
}

const overlaps = (a: Segment, b: Segment): boolean => a.start < b.end && b.start < a.end

describe('CA3 (0010): los tramos se recortan al rango', () => {
  it('un problema dentro del rango va de su inicio a su fin', () => {
    const { segments, overflow } = layout([problem('a', FROM + 10 * MIN, FROM + 40 * MIN)])
    expect(segments).toHaveLength(1)
    expect(segmentOf(segments, 'a')).toMatchObject({
      start: FROM + 10 * MIN,
      end: FROM + 40 * MIN,
      row: 0
    })
    expect(overflow).toBe(0)
  })

  it('uno que empezó antes del rango empieza en el inicio del rango', () => {
    const { segments } = layout([problem('a', FROM - 3 * 60 * MIN, FROM + 20 * MIN)])
    expect(segmentOf(segments, 'a')).toMatchObject({ start: FROM, end: FROM + 20 * MIN })
  })

  it('uno cerrado que acaba después del rango acaba en el final del rango', () => {
    const { segments } = layout([problem('a', FROM + 100 * MIN, TO + 30 * MIN)])
    expect(segmentOf(segments, 'a')).toMatchObject({ start: FROM + 100 * MIN, end: TO })
  })

  it('uno que cubre todo el rango por los dos lados ocupa el rango entero', () => {
    const { segments } = layout([problem('a', FROM - 60 * MIN, TO + 60 * MIN)])
    expect(segmentOf(segments, 'a')).toMatchObject({ start: FROM, end: TO })
  })

  it('los que quedan enteros fuera del rango no tienen tramo ni cuentan en el «+N»', () => {
    const { segments, overflow } = layout([
      problem('antes', FROM - 90 * MIN, FROM - 30 * MIN),
      problem('dentro', FROM + 30 * MIN, FROM + 50 * MIN),
      problem('despues', TO + 10 * MIN, TO + 20 * MIN)
    ])
    expect(segments.map((segment) => segment.problemId)).toEqual(['dentro'])
    expect(overflow).toBe(0)
  })
})

describe('CA3 (0010): los abiertos llegan hasta el final del rango', () => {
  it('un abierto (endTime null) va de su inicio al final del rango', () => {
    const { segments } = layout([problem('a', FROM + 90 * MIN, null)])
    expect(segmentOf(segments, 'a')).toMatchObject({ start: FROM + 90 * MIN, end: TO })
  })

  it('un abierto que empezó antes del rango lo cubre entero', () => {
    const { segments } = layout([problem('a', FROM - 24 * 60 * MIN, null)])
    expect(segmentOf(segments, 'a')).toMatchObject({ start: FROM, end: TO })
  })
})

describe('CA3 (0010): los solapados van en filas, como mucho 3, y el resto es «+N»', () => {
  it('los que no se solapan comparten la primera fila', () => {
    const { segments, overflow } = layout([
      problem('c', FROM + 80 * MIN, null),
      problem('b', FROM + 40 * MIN, FROM + 60 * MIN),
      problem('a', FROM + 0 * MIN, FROM + 20 * MIN)
    ])
    expect(segments).toHaveLength(3)
    for (const segment of segments) expect(segment.row, segment.problemId).toBe(0)
    expect(overflow).toBe(0)
  })

  it('dos que se solapan van en filas distintas', () => {
    const { segments, overflow } = layout([
      problem('b', FROM + 30 * MIN, null),
      problem('a', FROM + 10 * MIN, FROM + 60 * MIN)
    ])
    expect(segments).toHaveLength(2)
    expect(segmentOf(segments, 'a').row).not.toBe(segmentOf(segments, 'b').row)
    expect(overflow).toBe(0)
  })

  it('tres solapados caben en tres filas, sin «+N»', () => {
    const { segments, overflow } = layout([
      problem('c', FROM + 30 * MIN, null),
      problem('b', FROM + 20 * MIN, FROM + 90 * MIN),
      problem('a', FROM + 10 * MIN, FROM + 100 * MIN)
    ])
    expect(segments).toHaveLength(3)
    expect(new Set(segments.map((segment) => segment.row))).toEqual(new Set([0, 1, 2]))
    expect(overflow).toBe(0)
  })

  it('con cinco solapados a la vez, no pasa de 3 filas y los que no caben son el «+N»', () => {
    const problems = ['a', 'b', 'c', 'd', 'e'].map((id, i) =>
      problem(id, FROM + (10 + i) * MIN, FROM + 100 * MIN)
    )
    const { segments, overflow } = layout(problems)
    for (const segment of segments) {
      expect(segment.row, segment.problemId).toBeGreaterThanOrEqual(0)
      expect(segment.row, segment.problemId).toBeLessThanOrEqual(2)
    }
    expect(overflow).toBeGreaterThan(0)
    // Todo problema del rango se dibuja o cuenta en el «+N», nunca los dos ni ninguno.
    expect(segments.length + overflow).toBe(problems.length)
    expect(new Set(segments.map((segment) => segment.problemId)).size).toBe(segments.length)
  })

  it('nunca hay dos tramos solapados en la misma fila', () => {
    const problems = [
      problem('a', FROM + 0 * MIN, FROM + 50 * MIN),
      problem('b', FROM + 10 * MIN, FROM + 30 * MIN),
      problem('c', FROM + 40 * MIN, FROM + 70 * MIN),
      problem('d', FROM + 60 * MIN, null),
      problem('e', FROM + 80 * MIN, FROM + 90 * MIN),
      problem('f', FROM - 30 * MIN, FROM + 5 * MIN)
    ]
    const { segments, overflow } = layout(problems)
    expect(segments.length + overflow).toBe(problems.length)
    for (const a of segments) {
      for (const b of segments) {
        if (a === b || a.row !== b.row) continue
        expect(overlaps(a, b), `${a.problemId} y ${b.problemId} en la fila ${a.row}`).toBe(false)
      }
    }
    for (const segment of segments) expect(segment.row).toBeLessThanOrEqual(2)
  })

  it('el «+N» solo cuenta los que no caben: con muchos sin solaparse, todos en la primera fila', () => {
    const problems = Array.from({ length: 10 }, (_, i) =>
      problem(`p${i}`, FROM + i * 10 * MIN, FROM + i * 10 * MIN + 5 * MIN)
    )
    const { segments, overflow } = layout(problems)
    expect(segments).toHaveLength(10)
    for (const segment of segments) expect(segment.row).toBe(0)
    expect(overflow).toBe(0)
  })

  it('sin problemas, ni tramos ni «+N»', () => {
    expect(layout([])).toEqual({ segments: [], overflow: 0 })
  })
})
