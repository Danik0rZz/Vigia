import { describe, expect, it } from 'vitest'
import { SEVERITY_ORDER, severityRank, type ProblemSummary } from './modules'
import { serviceHealth } from './service-health'

/**
 * AUD-04: orden de severidades único (en shared) y salud de servicios de Inicio:
 * solo problemas abiertos y entidades SERVICE, la peor severidad por servicio
 * y de más a menos grave.
 */

let seq = 0
function problem(
  severityLevel: string,
  services: { id: string; name: string | null }[],
  status: 'OPEN' | 'CLOSED' = 'OPEN',
  others: { id: string; type: string }[] = []
): ProblemSummary {
  seq += 1
  return {
    problemId: `p-${seq}`,
    displayId: `P-${seq}`,
    title: `Problema ${seq}`,
    status,
    severityLevel,
    impactLevel: 'SERVICES',
    startTime: 0,
    endTime: status === 'OPEN' ? null : 1,
    affectedEntities: [
      ...services.map((s) => ({ id: s.id, type: 'SERVICE', name: s.name })),
      ...others.map((o) => ({ ...o, name: null }))
    ],
    impactedEntities: [],
    rootCause: null,
    managementZones: [],
    namespaces: [],
    clusters: []
  } as ProblemSummary
}

const A = { id: 'SERVICE-A', name: 'svc-a' }
const B = { id: 'SERVICE-B', name: 'svc-b' }
const C = { id: 'SERVICE-C', name: 'svc-c' }

describe('SEVERITY_ORDER y severityRank', () => {
  it('va de más a menos grave, en el orden acordado', () => {
    expect(SEVERITY_ORDER).toEqual([
      'AVAILABILITY',
      'ERROR',
      'PERFORMANCE',
      'RESOURCE_CONTENTION',
      'CUSTOM_ALERT',
      'MONITORING_UNAVAILABLE',
      'INFO'
    ])
  })

  it('el rango es el índice; lo desconocido va al final', () => {
    SEVERITY_ORDER.forEach((severity, index) => expect(severityRank(severity)).toBe(index))
    expect(severityRank('NUEVA_SEVERIDAD')).toBe(SEVERITY_ORDER.length)
    expect(severityRank('')).toBe(SEVERITY_ORDER.length)
    // Distingue mayúsculas: "error" no es ERROR.
    expect(severityRank('error')).toBe(SEVERITY_ORDER.length)
  })
})

describe('serviceHealth', () => {
  it('sin problemas, lista vacía', () => {
    expect(serviceHealth([])).toEqual([])
  })

  it.each([
    ['INFO + PERFORMANCE → PERFORMANCE', ['INFO', 'PERFORMANCE'], 'PERFORMANCE'],
    [
      'PERFORMANCE + INFO → PERFORMANCE (el orden de llegada no importa)',
      ['PERFORMANCE', 'INFO'],
      'PERFORMANCE'
    ],
    ['CUSTOM_ALERT + ERROR → ERROR', ['CUSTOM_ALERT', 'ERROR'], 'ERROR'],
    ['desconocida + INFO → INFO', ['NUEVA_SEVERIDAD', 'INFO'], 'INFO'],
    ['INFO + desconocida → INFO', ['INFO', 'NUEVA_SEVERIDAD'], 'INFO'],
    ['solo desconocidas → la primera', ['NUEVA_UNO', 'NUEVA_DOS'], 'NUEVA_UNO'],
    ['AVAILABILITY gana a todas', ['INFO', 'ERROR', 'AVAILABILITY', 'PERFORMANCE'], 'AVAILABILITY']
  ])('peor severidad por servicio: %s', (_case, severities, expected) => {
    const result = serviceHealth(severities.map((s) => problem(s, [A])))
    expect(result).toEqual([
      { id: 'SERVICE-A', name: 'svc-a', severity: expected, problems: severities.length }
    ])
  })

  it('solo cuenta los problemas OPEN', () => {
    const result = serviceHealth([
      problem('AVAILABILITY', [A], 'CLOSED'),
      problem('INFO', [A]),
      problem('ERROR', [B], 'CLOSED')
    ])
    expect(result).toEqual([{ id: 'SERVICE-A', name: 'svc-a', severity: 'INFO', problems: 1 }])
  })

  it('solo cuenta las entidades de tipo SERVICE', () => {
    const result = serviceHealth([
      problem('ERROR', [], 'OPEN', [
        { id: 'HOST-1', type: 'HOST' },
        { id: 'PROCESS_GROUP-1', type: 'PROCESS_GROUP' }
      ]),
      problem('INFO', [A], 'OPEN', [{ id: 'HOST-1', type: 'HOST' }])
    ])
    expect(result.map((s) => s.id)).toEqual(['SERVICE-A'])
  })

  it('un problema con varios servicios cuenta en cada uno', () => {
    const result = serviceHealth([problem('ERROR', [A, B]), problem('INFO', [B])])
    expect(result).toEqual([
      { id: 'SERVICE-A', name: 'svc-a', severity: 'ERROR', problems: 1 },
      { id: 'SERVICE-B', name: 'svc-b', severity: 'ERROR', problems: 2 }
    ])
  })

  it('ordena de más a menos grave; con la misma severidad, en orden de llegada', () => {
    const result = serviceHealth([
      problem('INFO', [C]),
      problem('PERFORMANCE', [B]),
      problem('NUEVA_SEVERIDAD', [{ id: 'SERVICE-D', name: 'svc-d' }]),
      problem('PERFORMANCE', [A]),
      problem('AVAILABILITY', [{ id: 'SERVICE-E', name: 'svc-e' }])
    ])
    expect(result.map((s) => `${s.id}:${s.severity}`)).toEqual([
      'SERVICE-E:AVAILABILITY',
      'SERVICE-B:PERFORMANCE',
      'SERVICE-A:PERFORMANCE',
      'SERVICE-C:INFO',
      'SERVICE-D:NUEVA_SEVERIDAD'
    ])
  })

  it('un servicio sin nombre usa su id como nombre', () => {
    const result = serviceHealth([problem('ERROR', [{ id: 'SERVICE-SIN', name: null }])])
    expect(result[0]).toMatchObject({ id: 'SERVICE-SIN', name: 'SERVICE-SIN' })
  })

  it('no modifica la lista de entrada', () => {
    const input = [problem('INFO', [A]), problem('ERROR', [B])]
    const copy = JSON.parse(JSON.stringify(input)) as unknown
    serviceHealth(input)
    expect(input).toEqual(copy)
  })
})
