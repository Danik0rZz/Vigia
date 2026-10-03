import { describe, expect, it } from 'vitest'
import type { ProblemSummary } from './modules'
import {
  NA,
  PROBLEM_EXPORT_COLUMNS,
  displayList,
  joinValues,
  naIfEmpty,
  toProblemExport,
  toProblemRow
} from './problem-row'

/**
 * Fila de problema común a la tabla y a la exportación: N/A uniforme, nombre o
 * id de las entidades, duración en minutos (por diferencia de ms) y en curso.
 */

const MIN = 60_000
const START = Date.parse('2026-10-03T08:00:00Z')
const NOW = new Date(START + 95 * MIN)

function summary(overrides: Partial<ProblemSummary> = {}): ProblemSummary {
  return {
    problemId: 'p-1',
    displayId: 'P-1',
    title: 'Respuesta lenta',
    status: 'CLOSED',
    severityLevel: 'PERFORMANCE',
    impactLevel: 'SERVICES',
    startTime: START,
    endTime: START + 42 * MIN,
    affectedEntities: [
      { id: 'SERVICE-1', type: 'SERVICE', name: 'pagos' },
      { id: 'HOST-1', type: 'HOST', name: null }
    ],
    impactedEntities: [],
    rootCause: { id: 'SERVICE-1', type: 'SERVICE', name: 'pagos' },
    managementZones: ['Producción'],
    clusters: ['cluster-norte'],
    namespaces: ['pagos-ns', 'comun-ns'],
    ...overrides
  } as ProblemSummary
}

describe('helpers de N/A', () => {
  it('NA es "N/A"', () => {
    expect(NA).toBe('N/A')
  })

  it.each([null, undefined, '', '   '])('naIfEmpty(%j) → N/A', (value) => {
    expect(naIfEmpty(value as string | null | undefined)).toBe('N/A')
  })

  it('naIfEmpty deja un valor con texto', () => {
    expect(naIfEmpty('pagos')).toBe('pagos')
  })

  it('displayList: el primero, o N/A si la lista está vacía', () => {
    expect(displayList(['a', 'b', 'c'])).toBe('a')
    expect(displayList([])).toBe('N/A')
  })

  it('joinValues: unidos con " | ", o N/A si la lista está vacía', () => {
    expect(joinValues(['a', 'b', 'c'])).toBe('a | b | c')
    expect(joinValues(['solo'])).toBe('solo')
    expect(joinValues([])).toBe('N/A')
  })
})

describe('toProblemRow', () => {
  it('un problema cerrado: entidades por nombre o id, causa raíz, namespaces y duración', () => {
    expect(toProblemRow(summary(), NOW)).toEqual({
      problemId: 'p-1',
      displayId: 'P-1',
      title: 'Respuesta lenta',
      status: 'CLOSED',
      impactLevel: 'SERVICES',
      severityLevel: 'PERFORMANCE',
      affectedNames: ['pagos', 'HOST-1'],
      affectedTypes: ['SERVICE', 'HOST'],
      affectedIds: ['SERVICE-1', 'HOST-1'],
      rootCauseName: 'pagos',
      rootCauseType: 'SERVICE',
      rootCauseId: 'SERVICE-1',
      clusters: ['cluster-norte'],
      namespaces: ['pagos-ns', 'comun-ns'],
      startTime: START,
      endTime: START + 42 * MIN,
      durationMinutes: 42,
      ongoing: false
    })
  })

  it('un problema abierto: endTime null, en curso y duración hasta now', () => {
    const row = toProblemRow(summary({ status: 'OPEN', endTime: null }), NOW)
    expect(row).toMatchObject({ status: 'OPEN', endTime: null, ongoing: true, durationMinutes: 95 })
  })

  it('la duración redondea a minutos enteros', () => {
    expect(toProblemRow(summary({ endTime: START + 90_400 }), NOW).durationMinutes).toBe(2)
    expect(toProblemRow(summary({ endTime: START + 89_000 }), NOW).durationMinutes).toBe(1)
  })

  it('la duración se calcula con ms, no con horas locales: 60 min aunque cruce el cambio de marzo', () => {
    // 01:30 → 03:30 en hora de Madrid, pero solo pasa una hora real.
    const start = Date.parse('2026-03-29T00:30:00Z')
    const end = Date.parse('2026-03-29T01:30:00Z')
    expect(toProblemRow(summary({ startTime: start, endTime: end }), NOW).durationMinutes).toBe(60)
  })

  it('sin causa raíz, todo null; sin namespaces, []', () => {
    expect(toProblemRow(summary({ rootCause: null, namespaces: [] }), NOW)).toMatchObject({
      rootCauseName: null,
      rootCauseType: null,
      rootCauseId: null,
      namespaces: []
    })
  })

  it('una causa raíz sin nombre usa su id', () => {
    expect(
      toProblemRow(
        summary({ rootCause: { id: 'PROCESS_GROUP-9', type: 'PROCESS_GROUP', name: null } }),
        NOW
      ).rootCauseName
    ).toBe('PROCESS_GROUP-9')
  })

  it('severidad e impacto desconocidos se conservan tal cual', () => {
    const row = toProblemRow(
      summary({ severityLevel: 'NUEVA_SEVERIDAD', impactLevel: 'OTRO_IMPACTO' }),
      NOW
    )
    expect(row.severityLevel).toBe('NUEVA_SEVERIDAD')
    expect(row.impactLevel).toBe('OTRO_IMPACTO')
  })

  it('sin entidades afectadas: listas vacías (la tabla y la exportación muestran N/A)', () => {
    const row = toProblemRow(summary({ affectedEntities: [] }), NOW)
    expect(row.affectedNames).toEqual([])
    expect(displayList(row.affectedNames)).toBe('N/A')
    expect(joinValues(row.affectedNames)).toBe('N/A')
  })
})

describe('exportación desde la misma fila', () => {
  it('columnas en el orden acordado, con su tipo', () => {
    expect(PROBLEM_EXPORT_COLUMNS.map((c) => c.key)).toEqual([
      'displayId',
      'title',
      'status',
      'impactLevel',
      'severityLevel',
      'affectedNames',
      'affectedTypes',
      'affectedIds',
      'rootCauseName',
      'rootCauseType',
      'rootCauseId',
      'clusters',
      'namespaces',
      'startTime',
      'endTime',
      'durationMinutes',
      'problemId'
    ])
    const types = Object.fromEntries(PROBLEM_EXPORT_COLUMNS.map((c) => [c.key, c.type]))
    expect(types).toMatchObject({ startTime: 'date', endTime: 'date', durationMinutes: 'number' })
  })

  it('valores múltiples con " | ", fin vacío si está abierto y duración hasta now', () => {
    const row = toProblemRow(summary({ status: 'OPEN', endTime: null }), NOW)
    expect(toProblemExport(row)).toEqual({
      displayId: 'P-1',
      title: 'Respuesta lenta',
      status: 'OPEN',
      impactLevel: 'SERVICES',
      severityLevel: 'PERFORMANCE',
      affectedNames: 'pagos | HOST-1',
      affectedTypes: 'SERVICE | HOST',
      affectedIds: 'SERVICE-1 | HOST-1',
      rootCauseName: 'pagos',
      rootCauseType: 'SERVICE',
      rootCauseId: 'SERVICE-1',
      clusters: 'cluster-norte',
      namespaces: 'pagos-ns | comun-ns',
      startTime: START,
      endTime: null,
      durationMinutes: 95,
      problemId: 'p-1'
    })
  })

  it('lo que falta sale como N/A, igual que en la tabla', () => {
    const row = toProblemRow(
      summary({ rootCause: null, namespaces: [], clusters: [], affectedEntities: [] }),
      NOW
    )
    expect(toProblemExport(row)).toMatchObject({
      affectedNames: 'N/A',
      affectedTypes: 'N/A',
      affectedIds: 'N/A',
      rootCauseName: 'N/A',
      rootCauseType: 'N/A',
      rootCauseId: 'N/A',
      clusters: 'N/A',
      namespaces: 'N/A'
    })
  })

  it('17 columnas, con clusters justo antes de namespaces', () => {
    const keys = PROBLEM_EXPORT_COLUMNS.map((c) => c.key)
    expect(keys).toHaveLength(17)
    expect(keys.indexOf('clusters')).toBe(keys.indexOf('namespaces') - 1)
    expect(PROBLEM_EXPORT_COLUMNS.find((c) => c.key === 'clusters')?.type).toBe('string')
  })

  it('varios clústeres se unen con " | " y la fila los conserva', () => {
    const row = toProblemRow(summary({ clusters: ['cluster-norte', 'cluster-sur'] }), NOW)
    expect(row.clusters).toEqual(['cluster-norte', 'cluster-sur'])
    expect(toProblemExport(row)['clusters']).toBe('cluster-norte | cluster-sur')
    expect(displayList(row.clusters)).toBe('cluster-norte')
  })

  it('tabla y exportación salen de la misma fila: el primer valor de la tabla es el primero exportado', () => {
    const row = toProblemRow(summary(), NOW)
    const exported = toProblemExport(row)
    expect(String(exported['affectedNames']).split(' | ')[0]).toBe(displayList(row.affectedNames))
    expect(String(exported['namespaces']).split(' | ')[0]).toBe(displayList(row.namespaces))
  })
})
