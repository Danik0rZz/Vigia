import type { TFunction } from 'i18next'
import { describe, expect, it } from 'vitest'
import { MAX_EXPORT_ROWS, type ProblemDetail } from '@shared/modules'
import type { EvidenceWire } from '@shared/problem-evidence'
import { PROBLEM_EXPORT_COLUMNS } from '@shared/problem-row'
import { problemWorkbook } from './problem-workbook'

/**
 * Hojas de la exportación del detalle de un problema. v0.9.1: Resumen y
 * Entidades siempre (son las principales); Evidencias y Comentarios solo con
 * filas; sin hoja Impacto. Las evidencias van todas, salvo el límite global,
 * y lo que la API no ha mandado (totalCount) se avisa en Info.
 */

/** t falso: devuelve la clave (y los parámetros, si los hay) para ver qué se pidió. */
const t = ((key: string, options?: Record<string, unknown>) =>
  options === undefined ? key : `${key}${JSON.stringify(options)}`) as unknown as TFunction

const LOADED = new Date('2026-10-04T10:00:00.000Z')

function evidence(overrides: Partial<EvidenceWire> = {}): EvidenceWire {
  return {
    evidenceType: 'EVENT',
    displayName: 'Lento',
    entity: { id: 'SERVICE-1', name: 'pagos', type: 'SERVICE' },
    groupingEntity: null,
    rootCauseRelevant: false,
    startTime: 1,
    endTime: 2,
    eventType: null,
    properties: [],
    metricId: null,
    unit: null,
    valueBefore: null,
    valueAfter: null,
    ...overrides
  }
}

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
    evidenceTotal: null,
    comments: [],
    commentTotal: null,
    invalid: 0,
    ...overrides
  } as ProblemDetail
}

const names = (result: ReturnType<typeof problemWorkbook>): string[] =>
  result.sheets.map((sheet) => sheet.name)

const sheet = (
  result: ReturnType<typeof problemWorkbook>,
  name: string
): ReturnType<typeof problemWorkbook>['sheets'][number] | undefined =>
  result.sheets.find((item) => item.name === `problems.sheets.${name}`)

describe('problemWorkbook', () => {
  it('sin evidencias ni comentarios: solo Resumen y Entidades (las dos primary)', () => {
    const result = problemWorkbook(detail(), LOADED, t)
    expect(names(result)).toEqual(['problems.sheets.summary', 'problems.sheets.entities'])
    expect(result.sheets.every((item) => item.primary)).toBe(true)
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

  it('v0.9.1: con todo, el orden es Resumen, Entidades, Evidencias y Comentarios; sin Impacto', () => {
    const result = problemWorkbook(
      detail({
        evidence: [evidence()],
        comments: [{ author: 'op', content: 'Mirando', context: null, createdAt: 2 }]
      }),
      LOADED,
      t
    )
    expect(names(result)).toEqual([
      'problems.sheets.summary',
      'problems.sheets.entities',
      'problems.sheets.evidence',
      'problems.sheets.comments'
    ])
    expect(names(result).some((name) => name.includes('impact'))).toBe(false)
    expect(result.sheets.slice(2).every((item) => !item.primary)).toBe(true)
  })

  it('Evidencias: columnas, tipos (fechas y números) y una fila METRIC completa', () => {
    const result = problemWorkbook(
      detail({
        evidence: [
          evidence({
            evidenceType: 'METRIC',
            displayName: 'Tiempo de respuesta',
            entity: { id: 'SERVICE-1', name: null, type: 'SERVICE' },
            rootCauseRelevant: true,
            startTime: 1000,
            endTime: 5000,
            metricId: 'builtin:service.response.time',
            unit: 'MicroSecond',
            valueBefore: 1200.5,
            valueAfter: 9800
          })
        ]
      }),
      LOADED,
      t
    )
    const evidenceSheet = sheet(result, 'evidence')
    expect(evidenceSheet?.columns.map((c) => [c.key, c.type])).toEqual([
      ['type', 'string'],
      ['name', 'string'],
      ['entity', 'string'],
      ['rootCause', 'string'],
      ['start', 'date'],
      ['end', 'date'],
      ['before', 'number'],
      ['after', 'number'],
      ['unit', 'string'],
      ['metricId', 'string'],
      ['eventType', 'string']
    ])
    expect(evidenceSheet?.columns.map((c) => c.header)).toEqual(
      evidenceSheet?.columns.map((c) => `problems.evidenceColumns.${c.key}`)
    )
    expect(evidenceSheet?.rows).toEqual([
      {
        type: 'METRIC',
        name: 'Tiempo de respuesta',
        // Sin nombre: la etiqueta es el id.
        entity: 'SERVICE-1',
        rootCause: 'problems.yes',
        start: 1000,
        end: 5000,
        // Los valores tal cual (número, sin formatear ni escalar).
        before: 1200.5,
        after: 9800,
        unit: 'MicroSecond',
        metricId: 'builtin:service.response.time',
        eventType: null
      }
    ])
  })

  it.each([
    ['-1', -1],
    ['null', null]
  ])('Evidencias: endTime %s → "activa" traducido; causa raíz no → "no"', (_label, endTime) => {
    const row = sheet(
      problemWorkbook(detail({ evidence: [evidence({ endTime })] }), LOADED, t),
      'evidence'
    )?.rows[0]
    expect(row?.['end']).toBe('problems.evidenceActive')
    expect(row?.['rootCause']).toBe('problems.no')
  })

  it('Evidencias: EVENT con su eventType; sin entidad, entity null; sin valores, null', () => {
    const row = sheet(
      problemWorkbook(
        detail({ evidence: [evidence({ eventType: 'PROCESS_RESTART', entity: null })] }),
        LOADED,
        t
      ),
      'evidence'
    )?.rows[0]
    expect(row).toMatchObject({
      eventType: 'PROCESS_RESTART',
      entity: null,
      before: null,
      after: null,
      unit: null,
      metricId: null
    })
  })

  it('Comentarios: autor, fecha, contexto y contenido (sin autor ni contexto → null)', () => {
    const comments = sheet(
      problemWorkbook(
        detail({
          comments: [
            { author: 'op', content: 'Mirando', context: 'ui', createdAt: 2 },
            { author: null, content: '', context: null, createdAt: 3 }
          ]
        }),
        LOADED,
        t
      ),
      'comments'
    )
    expect(comments?.columns.map((c) => [c.key, c.type])).toEqual([
      ['author', 'string'],
      ['date', 'date'],
      ['context', 'string'],
      ['content', 'string']
    ])
    expect(comments?.rows).toEqual([
      { author: 'op', date: 2, context: 'ui', content: 'Mirando' },
      { author: null, date: 3, context: null, content: '' }
    ])
  })

  it('una hoja secundaria sin filas no se envía (solo comentarios → sin Evidencias)', () => {
    const result = problemWorkbook(
      detail({ comments: [{ author: null, content: 'x', context: null, createdAt: 1 }] }),
      LOADED,
      t
    )
    expect(names(result)).toEqual([
      'problems.sheets.summary',
      'problems.sheets.entities',
      'problems.sheets.comments'
    ])
  })

  it('v0.9.1: la API recortó evidencias y comentarios (totalCount mayor) → avisos en Info', () => {
    const result = problemWorkbook(
      detail({
        evidence: [evidence(), evidence()],
        evidenceTotal: 250,
        comments: [{ author: null, content: 'x', context: null, createdAt: 1 }],
        commentTotal: 40
      }),
      LOADED,
      t
    )
    expect(result.warnings).toEqual([
      `problems.apiTruncatedEvidence${JSON.stringify({ shown: 2, total: 250 })}`,
      `problems.apiTruncatedComments${JSON.stringify({ shown: 1, total: 40 })}`
    ])
  })

  it.each([
    ['null', null],
    ['igual a lo recibido', 2],
    ['menor que lo recibido', 1]
  ])('totalCount %s → sin aviso de la API', (_label, total) => {
    const result = problemWorkbook(
      detail({
        evidence: [evidence(), evidence()],
        evidenceTotal: total,
        comments: [
          { author: null, content: 'a', context: null, createdAt: 1 },
          { author: null, content: 'b', context: null, createdAt: 2 }
        ],
        commentTotal: total
      }),
      LOADED,
      t
    )
    expect(result.warnings).toEqual([])
  })

  it('las evidencias van TODAS (no solo las 50 de la página)', () => {
    const items = Array.from({ length: 300 }, (_, i) => evidence({ displayName: `ev-${i}` }))
    expect(
      sheet(problemWorkbook(detail({ evidence: items }), LOADED, t), 'evidence')?.rows
    ).toHaveLength(300)
  })

  it('si las evidencias pasan del límite global, se recortan y se avisa con shown y total', () => {
    const total = MAX_EXPORT_ROWS + 5
    const items = Array.from({ length: total }, () => evidence())
    const result = problemWorkbook(
      detail({
        evidence: items,
        comments: [{ author: null, content: 'x', context: null, createdAt: 1 }]
      }),
      LOADED,
      t
    )
    const rows = result.sheets.reduce((sum, item) => sum + item.rows.length, 0)
    expect(rows).toBe(MAX_EXPORT_ROWS)
    // Resumen (1) + Entidades (3) + Comentarios (1): quedan MAX - 5 para las evidencias.
    const shown = MAX_EXPORT_ROWS - 5
    expect(sheet(result, 'evidence')?.rows).toHaveLength(shown)
    expect(result.warnings).toEqual([
      `problems.evidenceTruncated${JSON.stringify({ shown, total })}`
    ])
  })

  it('no muta el detalle de entrada', () => {
    const input = detail({ evidence: [evidence({ endTime: -1 })], evidenceTotal: 9 })
    const copy = structuredClone(input)
    problemWorkbook(input, LOADED, t)
    expect(input).toEqual(copy)
  })
})
