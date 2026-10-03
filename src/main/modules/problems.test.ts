import { describe, expect, it } from 'vitest'
import {
  buildProblemSelector,
  problemSchema,
  problemsPageSchema,
  toProblemSummary
} from './problems'

/** Problemas de la API v2: selector de filtros, validación y resumen para la interfaz. */

/** Problema sintético mínimo (no copiado de la documentación). */
function problem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    problemId: 'p-0001',
    displayId: 'P-1',
    title: 'Respuesta lenta',
    status: 'OPEN',
    severityLevel: 'PERFORMANCE',
    impactLevel: 'SERVICES',
    startTime: 1791050000000,
    endTime: -1,
    affectedEntities: [
      { entityId: { id: 'SERVICE-1', type: 'SERVICE' }, name: 'pagos' },
      { entityId: { id: 'HOST-1', type: 'HOST' } }
    ],
    impactedEntities: [{ entityId: { id: 'APPLICATION-1', type: 'APPLICATION' }, name: 'web' }],
    rootCauseEntity: { entityId: { id: 'SERVICE-1', type: 'SERVICE' }, name: 'pagos' },
    managementZones: [
      { id: '1', name: 'Producción' },
      { id: '2', name: 'Pagos' }
    ],
    ...overrides
  }
}

describe('buildProblemSelector', () => {
  it('sin criterios devuelve undefined', () => {
    expect(buildProblemSelector({})).toBeUndefined()
    expect(buildProblemSelector({ severity: [], impact: [], text: '   ' })).toBeUndefined()
  })

  it('une los criterios con coma y los valores entre comillas', () => {
    expect(
      buildProblemSelector({
        status: 'open',
        severity: ['AVAILABILITY', 'ERROR'],
        impact: ['SERVICES']
      })
    ).toBe('status("open"),severityLevel("AVAILABILITY","ERROR"),impactLevel("SERVICES")')
  })

  it.each([
    ['status cerrado', { status: 'closed' }, 'status("closed")'],
    ['una severidad', { severity: ['INFO'] }, 'severityLevel("INFO")'],
    ['texto simple', { text: 'db' }, 'text("db")']
  ] as const)('%s', (_case, input, expected) => {
    expect(buildProblemSelector(input)).toBe(expected)
  })

  describe('escapado de text()', () => {
    it('escapa " con ~', () => {
      expect(buildProblemSelector({ text: 'db "x"' })).toBe('text("db ~"x~"")')
    })

    it('escapa ~ con ~', () => {
      expect(buildProblemSelector({ text: 'a~b' })).toBe('text("a~~b")')
    })

    it('escapa primero ~ y luego ": la ~ que se añade a las comillas no se duplica', () => {
      // Si se escapara primero ", el resultado sería ~~~" en vez de ~~~".
      expect(buildProblemSelector({ text: '~"' })).toBe('text("~~~"")')
      expect(buildProblemSelector({ text: 'db ~"x"' })).toBe('text("db ~~~"x~"")')
    })

    it('recorta espacios y limita a 30 caracteres antes de escapar', () => {
      expect(buildProblemSelector({ text: `  ${'a'.repeat(40)}  ` })).toBe(
        `text("${'a'.repeat(30)}")`
      )
      // El corte cae justo después de una comilla: se escapa la que queda.
      expect(buildProblemSelector({ text: `${'a'.repeat(29)}"bbb` })).toBe(
        `text("${'a'.repeat(29)}~"")`
      )
    })

    it('el texto va junto al resto de criterios', () => {
      expect(buildProblemSelector({ status: 'open', text: 'x"y' })).toBe(
        'status("open"),text("x~"y")'
      )
    })
  })
})

describe('problemSchema y toProblemSummary', () => {
  it('convierte un problema abierto: endTime -1 → null y zonas por nombre', () => {
    expect(toProblemSummary(problemSchema.parse(problem()))).toEqual({
      problemId: 'p-0001',
      displayId: 'P-1',
      title: 'Respuesta lenta',
      status: 'OPEN',
      severityLevel: 'PERFORMANCE',
      impactLevel: 'SERVICES',
      startTime: 1791050000000,
      endTime: null,
      affectedEntities: [
        { id: 'SERVICE-1', type: 'SERVICE', name: 'pagos' },
        { id: 'HOST-1', type: 'HOST', name: null }
      ],
      impactedEntities: [{ id: 'APPLICATION-1', type: 'APPLICATION', name: 'web' }],
      rootCause: { id: 'SERVICE-1', type: 'SERVICE', name: 'pagos' },
      managementZones: ['Producción', 'Pagos']
    })
  })

  it('un problema cerrado conserva su endTime y puede no tener causa raíz', () => {
    const summary = toProblemSummary(
      problemSchema.parse(
        problem({
          status: 'CLOSED',
          endTime: 1791053600000,
          rootCauseEntity: undefined,
          managementZones: []
        })
      )
    )
    expect(summary).toMatchObject({
      status: 'CLOSED',
      endTime: 1791053600000,
      rootCause: null,
      managementZones: []
    })
  })

  it.each([
    ['status desconocido', { status: 'RESOLVED' }],
    ['severidad desconocida', { severityLevel: 'CRITICAL' }],
    ['impacto desconocido', { impactLevel: 'GALAXY' }],
    ['startTime no numérico', { startTime: 'ayer' }],
    ['sin problemId', { problemId: undefined }]
  ])('rechaza %s', (_case, overrides) => {
    expect(problemSchema.safeParse(problem(overrides)).success).toBe(false)
  })

  it('acepta todas las severidades e impactos de la API', () => {
    for (const severityLevel of [
      'AVAILABILITY',
      'CUSTOM_ALERT',
      'ERROR',
      'INFO',
      'MONITORING_UNAVAILABLE',
      'PERFORMANCE',
      'RESOURCE_CONTENTION'
    ]) {
      expect(problemSchema.safeParse(problem({ severityLevel })).success, severityLevel).toBe(true)
    }
    for (const impactLevel of ['APPLICATION', 'ENVIRONMENT', 'INFRASTRUCTURE', 'SERVICES']) {
      expect(problemSchema.safeParse(problem({ impactLevel })).success, impactLevel).toBe(true)
    }
  })
})

describe('problemsPageSchema', () => {
  it('acepta una página con nextPageKey o sin él', () => {
    expect(
      problemsPageSchema.safeParse({ problems: [problem()], totalCount: 1, nextPageKey: 'k' })
        .success
    ).toBe(true)
    expect(problemsPageSchema.safeParse({ problems: [], totalCount: 0 }).success).toBe(true)
  })

  it('rechaza una página sin la lista de problemas', () => {
    expect(problemsPageSchema.safeParse({ totalCount: 0 }).success).toBe(false)
  })
})
