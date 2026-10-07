import type { EntityProblem } from '@shared/modules'

/** Filas como mucho de la franja de problemas (ficha 0010). */
export const PROBLEM_BAND_MAX_ROWS = 3

/** Tramo de un problema en la franja, en milisegundos ya recortados al rango. */
export interface ProblemBandSegment {
  problemId: string
  start: number
  end: number
  /** Fila (0 arriba), como mucho `PROBLEM_BAND_MAX_ROWS - 1`. */
  row: number
}

export interface ProblemBandLayout {
  segments: ProblemBandSegment[]
  /** Problemas del rango que no caben en las filas (el «+N»); 0 si caben todos. */
  overflow: number
}

/**
 * Tramos de la franja de problemas sobre el gráfico «Tasa de error» (ficha 0010).
 * Cada problema va de su inicio a su fin (los abiertos, hasta el final del rango),
 * recortado al rango visible; los que quedan fuera no tienen tramo. Los que se
 * solapan van en filas distintas, de arriba abajo y en orden de inicio; el que no
 * cabe en ninguna de las 3 filas cuenta en `overflow`.
 */
export function problemBandLayout(
  problems: readonly EntityProblem[],
  range: { from: number; to: number }
): ProblemBandLayout {
  const visible = problems
    .map((problem) => {
      const end = problem.endTime ?? range.to
      return {
        problemId: problem.problemId,
        rawStart: problem.startTime,
        rawEnd: end,
        start: Math.max(problem.startTime, range.from),
        end: Math.min(end, range.to)
      }
    })
    .filter((item) => isInRange(item.rawStart, item.rawEnd, range))
    // Por inicio y, a igual inicio, el más largo antes (queda arriba).
    .sort((a, b) => a.start - b.start || b.end - a.end || a.problemId.localeCompare(b.problemId))

  // Fin del último tramo de cada fila.
  const rowEnds: number[] = []
  const segments: ProblemBandSegment[] = []
  let overflow = 0
  for (const item of visible) {
    let row = rowEnds.findIndex((rowEnd) => rowEnd <= item.start)
    if (row === -1 && rowEnds.length < PROBLEM_BAND_MAX_ROWS) {
      row = rowEnds.length
      rowEnds.push(item.end)
    }
    if (row === -1) {
      overflow += 1
      continue
    }
    rowEnds[row] = item.end
    segments.push({ problemId: item.problemId, start: item.start, end: item.end, row })
  }
  return { segments, overflow }
}

/**
 * Si el problema toca el rango visible. Uno sin duración (inicio igual al fin) cuenta
 * si cae dentro; si no, tiene que solaparse con el rango (tocar el borde no basta).
 */
function isInRange(start: number, end: number, range: { from: number; to: number }): boolean {
  if (end < start) return false
  if (start === end) return start >= range.from && start <= range.to
  return start < range.to && end > range.from
}
