import type { TFunction } from 'i18next'
import { describe, expect, it } from 'vitest'
import { MAX_EXPORT_ROWS, type ProblemDetail } from '@shared/modules'
import { PROBLEM_EXPORT_COLUMNS } from '@shared/problem-row'
import { problemWorkbook } from './problem-workbook'

/**
 * v0.9.0: hojas de la exportación del detalle de un problema. Resumen y
 * Entidades siempre (son las principales); Evidencias, Impacto y Comentarios
 * solo con filas. La columna de usuarios afectados, solo si algún impacto la
 * trae. Las evidencias van todas, salvo el límite global, con un aviso.
 */

/** t falso: devuelve la clave (y los parámetros, si los hay) para ver qué se pidió. */
const t = ((key: string, options?: Record<string, unknown>) =>
  options === undefined ? key : `${key}${JSON.stringify(options)}`) as unknown as TFunction

const LOADED = new Date('2026-10-04T10:00:00.000Z')

function detail(overrides: Partial<ProblemDetail> = {}): ProblemDetail {
  return {
    problemId: 'pa-1',
    displayId: 'P-101',
    title: 'Respuesta lenta en pagos',
    status: 'OPEN',
    severityLevel: 'PERFORMANCE',
    impactLevel: 'SERVICES',
    startTime: Date.UTC(2026, 9, 4, 9, 0),
    endTime: null,
    affectedEntities: [
      { id: 'SERVICE-1', type: 'SERVICE', name: 'pagos' },
      { id: 'HOST-1', type: 'HOST', name: null }
    ],
    impactedEntities: [{ id: 'APPLICATION-1', type: 'APPLICATION', name: 'web' }],
    rootCause: { id: 'SERVICE-1', type: 'SERVICE', name: 'pagos' },
    managementZones: [],
    namespaces: [],
    clusters: [],
    entityTags: [],
    linkedProblem: null,
    evidence: [],
    impacts: [],
    comments: [],
    invalid: 0,
    ...overrides
  } as ProblemDetail
}

const names = (result: ReturnType<typeof problemWorkbook>): string[] =>
  result.sheets.map((sheet) => sheet.name)

describe('problemWorkbook', () => {
  it('sin evidencias, impactos ni comentarios: solo Resumen y Entidades (las dos primary)', () => {
    const result = problemWorkbook(detail(), LOADED, t)
    expect(names(result)).toEqual(['problems.sheets.summary', 'problems.sheets.entities'])
    expect(result.sheets.every((sheet) => sheet.primary)).toBe(true)
    expect(result.warnings).toEqual([])
  })

  it('Resumen: las 17 columnas de siempre y una sola fila', () => {
    const [summary] = problemWorkbook(detail(), LOADED, t).sheets
    expect(summary?.columns.map((c) => c.key)).toEqual(PROBLEM_EXPORT_COLUMNS.map((c) => c.key))
    expect(summary?.columns).toHaveLength(17)
    expect(summary?.rows).toHaveLength(1)
    expect(summary?.rows[0]?.['displayId']).toBe('P-101')
  })

  it('Entidades: primero las afectadas y después las impactadas, con su rol', () => {
    const entities = problemWorkbook(detail(), LOADED, t).sheets[1]
    expect(entities?.columns.map((c) => c.key)).toEqual(['role', 'name', 'type', 'id'])
    expect(entities?.rows).toEqual([
      { role: 'problems.entityRole.affected', name: 'pagos', type: 'SERVICE', id: 'SERVICE-1' },
      { role: 'problems.entityRole.affected', name: null, type: 'HOST', id: 'HOST-1' },
      {
        role: 'problems.entityRole.impacted',
        name: 'web',
        type: 'APPLICATION',
        id: 'APPLICATION-1'
      }
    ])
  })

  it('con todo: el orden es Resumen, Entidades, Evidencias, Impacto y Comentarios', () => {
    const result = problemWorkbook(
      detail({
        evidence: [{ type: 'EVENT', name: 'Lento', entity: 'pagos', startTime: 1 }],
        impacts: [{ type: 'SERVICE', entity: 'carrito', estimatedAffectedUsers: null }],
        comments: [{ author: 'op', content: 'Mirando', createdAt: 2 }]
      }),
      LOADED,
      t
    )
    expect(names(result)).toEqual([
      'problems.sheets.summary',
      'problems.sheets.entities',
      'problems.sheets.evidence',
      'problems.sheets.impact',
      'problems.sheets.comments'
    ])
    expect(result.sheets.slice(2).every((sheet) => !sheet.primary)).toBe(true)
    // Fechas con su tipo.
    const evidence = result.sheets[2]
    expect(evidence?.columns.find((c) => c.key === 'start')?.type).toBe('date')
    expect(result.sheets[4]?.columns.find((c) => c.key === 'date')?.type).toBe('date')
  })

  it('una hoja secundaria sin filas no se envía (solo comentarios → sin Evidencias ni Impacto)', () => {
    const result = problemWorkbook(
      detail({ comments: [{ author: null, content: 'x', createdAt: null }] }),
      LOADED,
      t
    )
    expect(names(result)).toEqual([
      'problems.sheets.summary',
      'problems.sheets.entities',
      'problems.sheets.comments'
    ])
  })

  it('Impacto: la columna de usuarios afectados solo si algún impacto la trae', () => {
    const without = problemWorkbook(
      detail({ impacts: [{ type: 'SERVICE', entity: 'a', estimatedAffectedUsers: null }] }),
      LOADED,
      t
    ).sheets.find((s) => s.name === 'problems.sheets.impact')
    expect(without?.columns.map((c) => c.key)).toEqual(['entity', 'type'])
    expect(without?.rows[0]).not.toHaveProperty('users')

    const withUsers = problemWorkbook(
      detail({
        impacts: [
          { type: 'SERVICE', entity: 'a', estimatedAffectedUsers: null },
          { type: 'APPLICATION', entity: 'b', estimatedAffectedUsers: 42 }
        ]
      }),
      LOADED,
      t
    ).sheets.find((s) => s.name === 'problems.sheets.impact')
    expect(withUsers?.columns.map((c) => c.key)).toEqual(['entity', 'type', 'users'])
    expect(withUsers?.columns.find((c) => c.key === 'users')?.type).toBe('number')
    expect(withUsers?.rows.map((r) => r['users'])).toEqual([null, 42])
  })

  it('las evidencias van TODAS (no solo las 50 de la página)', () => {
    const evidence = Array.from({ length: 300 }, (_, i) => ({
      type: 'EVENT',
      name: `ev-${i}`,
      entity: null,
      startTime: null
    }))
    const sheet = problemWorkbook(detail({ evidence }), LOADED, t).sheets.find(
      (s) => s.name === 'problems.sheets.evidence'
    )
    expect(sheet?.rows).toHaveLength(300)
  })

  it('si las evidencias pasan del límite global, se recortan y se avisa con shown y total', () => {
    const total = MAX_EXPORT_ROWS + 5
    const evidence = Array.from({ length: total }, () => ({
      type: 'EVENT',
      name: 'x',
      entity: null,
      startTime: null
    }))
    const result = problemWorkbook(detail({ evidence }), LOADED, t)
    const rows = result.sheets.reduce((sum, sheet) => sum + sheet.rows.length, 0)
    expect(rows).toBe(MAX_EXPORT_ROWS)
    // Resumen (1) + Entidades (3): quedan MAX - 4 para las evidencias.
    const shown = MAX_EXPORT_ROWS - 4
    expect(result.sheets.find((s) => s.name === 'problems.sheets.evidence')?.rows).toHaveLength(
      shown
    )
    expect(result.warnings).toEqual([
      `problems.evidenceTruncated${JSON.stringify({ shown, total })}`
    ])
  })

  it('no muta el detalle de entrada', () => {
    const input = detail({ evidence: [{ type: 'EVENT', name: 'a', entity: null, startTime: 1 }] })
    const copy = structuredClone(input)
    problemWorkbook(input, LOADED, t)
    expect(input).toEqual(copy)
  })
})
