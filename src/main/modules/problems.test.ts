import { describe, expect, it } from 'vitest'
import {
  buildProblemSelector,
  problemDetailSchema,
  problemSchema,
  problemsPageSchema,
  toProblemDetail,
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
    problemFilters: [{ id: 'f-1', name: 'Filtro de alertas' }],
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
  it('convierte un problema abierto: endTime -1 → null, zonas por nombre y sin namespaces', () => {
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
      managementZones: ['Producción', 'Pagos'],
      clusters: [],
      namespaces: []
    })
  })

  it('un problema cerrado conserva su endTime; la causa raíz puede faltar o ser null', () => {
    for (const rootCauseEntity of [undefined, null]) {
      const summary = toProblemSummary(
        problemSchema.parse(
          problem({
            status: 'CLOSED',
            endTime: 1791053600000,
            rootCauseEntity,
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
    }
  })

  it('lee los namespaces de "k8s.namespace.name"', () => {
    const summary = toProblemSummary(
      problemSchema.parse(problem({ 'k8s.namespace.name': ['pagos-ns', 'comun-ns'] }))
    )
    expect(summary.namespaces).toEqual(['pagos-ns', 'comun-ns'])
  })

  it.each([
    'affectedEntities',
    'displayId',
    'endTime',
    'impactLevel',
    'impactedEntities',
    'managementZones',
    'problemFilters',
    'problemId',
    'severityLevel',
    'startTime',
    'status',
    'title'
  ])('sin el campo obligatorio %s no valida', (field) => {
    const raw = problem()
    delete raw[field]
    expect(problemSchema.safeParse(raw).success).toBe(false)
  })

  it.each([
    ['status desconocido', { status: 'RESOLVED' }],
    ['startTime no numérico', { startTime: 'ayer' }],
    ['namespaces que no son texto', { 'k8s.namespace.name': [1, 2] }]
  ])('rechaza %s', (_case, overrides) => {
    expect(problemSchema.safeParse(problem(overrides)).success).toBe(false)
  })

  it('acepta severidades e impactos desconocidos (son texto, no enum) y los conserva', () => {
    const parsed = problemSchema.safeParse(
      problem({ severityLevel: 'NUEVA_SEVERIDAD', impactLevel: 'NUEVO_IMPACTO' })
    )
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(toProblemSummary(parsed.data)).toMatchObject({
        severityLevel: 'NUEVA_SEVERIDAD',
        impactLevel: 'NUEVO_IMPACTO'
      })
    }
  })

  it('acepta todas las severidades e impactos conocidos de la API', () => {
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

  it('tolera campos desconocidos y problemFilters con cualquier forma de objeto', () => {
    expect(
      problemSchema.safeParse(
        problem({ campoNuevo: { x: 1 }, problemFilters: [{ id: 'f', otro: true }, {}] })
      ).success
    ).toBe(true)
  })
})

describe('problemDetailSchema y toProblemDetail', () => {
  function detail(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      ...problem(),
      entityTags: [
        {
          context: 'CONTEXTLESS',
          key: 'equipo',
          value: 'pagos',
          stringRepresentation: 'equipo:pagos'
        },
        { context: 'CONTEXTLESS', key: 'critico' },
        { context: 'CONTEXTLESS', key: 'zona', value: 'eu' }
      ],
      linkedProblemInfo: { displayId: 'P-0', problemId: 'p-0000' },
      evidenceDetails: {
        totalCount: 2,
        details: [
          {
            evidenceType: 'EVENT',
            displayName: 'Respuesta lenta',
            entity: { entityId: { id: 'SERVICE-1', type: 'SERVICE' }, name: 'pagos' },
            startTime: 1791050000000
          },
          {
            evidenceType: 'TIPO_RARO_NUEVO',
            displayName: 'Algo nuevo',
            entity: { entityId: { id: 'HOST-1', type: 'HOST' } },
            campoDesconocido: 1
          }
        ]
      },
      impactAnalysis: {
        impacts: [
          {
            impactType: 'SERVICE',
            impactedEntity: { entityId: { id: 'SERVICE-2', type: 'SERVICE' }, name: 'carrito' },
            estimatedAffectedUsers: 12
          },
          { impactType: 'APPLICATION' }
        ]
      },
      recentComments: {
        totalCount: 2,
        comments: [
          { authorName: 'operador', content: 'Mirando', createdAtTimestamp: 1791051000000 },
          { content: 'Sin autor ni fecha' }
        ]
      },
      ...overrides
    }
  }

  it('mapea el detalle completo', () => {
    const result = toProblemDetail(problemDetailSchema.parse(detail()))
    expect(result).toMatchObject({
      problemId: 'p-0001',
      displayId: 'P-1',
      impactedEntities: [{ id: 'APPLICATION-1', type: 'APPLICATION', name: 'web' }],
      entityTags: ['equipo:pagos', 'critico', 'zona:eu'],
      linkedProblem: { displayId: 'P-0', problemId: 'p-0000' },
      evidence: [
        { type: 'EVENT', name: 'Respuesta lenta', entity: 'pagos', startTime: 1791050000000 },
        { type: 'TIPO_RARO_NUEVO', name: 'Algo nuevo', entity: 'HOST-1', startTime: null }
      ],
      impacts: [
        { type: 'SERVICE', entity: 'carrito', estimatedAffectedUsers: 12 },
        { type: 'APPLICATION', entity: null, estimatedAffectedUsers: null }
      ],
      comments: [
        { author: 'operador', content: 'Mirando', createdAt: 1791051000000 },
        { author: null, content: 'Sin autor ni fecha', createdAt: null }
      ]
    })
  })

  it('sin las partes opcionales: listas vacías y linkedProblem null', () => {
    const raw = detail()
    for (const key of [
      'entityTags',
      'linkedProblemInfo',
      'evidenceDetails',
      'impactAnalysis',
      'recentComments'
    ]) {
      delete raw[key]
    }
    expect(toProblemDetail(problemDetailSchema.parse(raw))).toMatchObject({
      entityTags: [],
      linkedProblem: null,
      evidence: [],
      impacts: [],
      comments: []
    })
  })

  it('partes anidadas vacías o a medias no rompen: listas vacías', () => {
    const raw = detail({
      evidenceDetails: {},
      impactAnalysis: {},
      recentComments: { totalCount: 0 }
    })
    expect(toProblemDetail(problemDetailSchema.parse(raw))).toMatchObject({
      evidence: [],
      impacts: [],
      comments: []
    })
  })

  it('el detalle también es un resumen válido (con namespaces)', () => {
    const result = toProblemDetail(
      problemDetailSchema.parse(detail({ 'k8s.namespace.name': ['ns-a'] }))
    )
    expect(result).toMatchObject({ status: 'OPEN', endTime: null, namespaces: ['ns-a'] })
  })
})

describe('k8s.cluster.name y k8s.cluster.uid (opcionales, fuera de la OpenAPI)', () => {
  it('se aceptan como listas de texto; el nombre va al resumen como clusters y el uid no', () => {
    const parsed = problemSchema.safeParse(
      problem({ 'k8s.cluster.name': ['cluster-a', 'cluster-b'], 'k8s.cluster.uid': ['uid-a'] })
    )
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      const summary = toProblemSummary(parsed.data)
      expect(summary.clusters).toEqual(['cluster-a', 'cluster-b'])
      expect(JSON.stringify(summary)).not.toContain('uid-a')
    }
  })

  it('sin k8s.cluster.name, clusters []', () => {
    expect(toProblemSummary(problemSchema.parse(problem())).clusters).toEqual([])
  })

  it('sin ellos sigue validando, y con un tipo raro no', () => {
    expect(problemSchema.safeParse(problem()).success).toBe(true)
    expect(problemSchema.safeParse(problem({ 'k8s.cluster.name': [1] })).success).toBe(false)
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
