import { describe, expect, it } from 'vitest'
import { problemDetailOutputSchema } from '@shared/modules'
import { evidenceWireSchema, type EvidenceWire } from '@shared/problem-evidence'
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
      recentComments: {
        totalCount: 2,
        comments: [
          {
            id: 'c-1',
            authorName: 'operador',
            content: 'Mirando',
            context: 'dynatrace-problem-ui',
            createdAtTimestamp: 1791051000000
          },
          { createdAtTimestamp: 1791052000000 }
        ]
      },
      ...overrides
    }
  }

  /** Evidencia normalizada con todos los campos a su valor vacío. */
  const emptyWire = {
    entity: null,
    groupingEntity: null,
    rootCauseRelevant: false,
    startTime: null,
    endTime: null,
    eventType: null,
    properties: [],
    metricId: null,
    unit: null,
    valueBefore: null,
    valueAfter: null
  }

  it('mapea el detalle completo (v0.9.1: sin impactos, con totales)', () => {
    const result = toProblemDetail(problemDetailSchema.parse(detail()))
    expect(result).toMatchObject({
      problemId: 'p-0001',
      displayId: 'P-1',
      impactedEntities: [{ id: 'APPLICATION-1', type: 'APPLICATION', name: 'web' }],
      entityTags: ['equipo:pagos', 'critico', 'zona:eu'],
      linkedProblem: { displayId: 'P-0', problemId: 'p-0000' },
      evidenceTotal: 2,
      commentTotal: 2,
      invalid: 0
    })
    expect(result.evidence).toEqual([
      {
        ...emptyWire,
        evidenceType: 'EVENT',
        displayName: 'Respuesta lenta',
        entity: { id: 'SERVICE-1', name: 'pagos', type: 'SERVICE' },
        startTime: 1791050000000
      },
      {
        ...emptyWire,
        evidenceType: 'TIPO_RARO_NUEVO',
        displayName: 'Algo nuevo',
        entity: { id: 'HOST-1', name: null, type: 'HOST' }
      }
    ])
    expect(result.comments).toEqual([
      {
        author: 'operador',
        content: 'Mirando',
        context: 'dynatrace-problem-ui',
        createdAt: 1791051000000
      },
      { author: null, content: '', context: null, createdAt: 1791052000000 }
    ])
    expect(result).not.toHaveProperty('impacts')
    // La salida cumple el contrato del IPC.
    expect(problemDetailOutputSchema.safeParse(result).success).toBe(true)
  })

  it('v0.9.1: impactAnalysis, si llegara, se ignora (no sale en el detalle)', () => {
    const result = toProblemDetail(
      problemDetailSchema.parse(
        detail({ impactAnalysis: { impacts: [{ impactType: 'SERVICE', secreto: 'x' }] } })
      )
    )
    expect(result).not.toHaveProperty('impacts')
    expect(result).not.toHaveProperty('impactAnalysis')
    expect(JSON.stringify(result)).not.toContain('secreto')
  })

  it('sin las partes opcionales: listas vacías, totales null y linkedProblem null', () => {
    const raw = detail()
    for (const key of ['entityTags', 'linkedProblemInfo', 'evidenceDetails', 'recentComments']) {
      delete raw[key]
    }
    expect(toProblemDetail(problemDetailSchema.parse(raw))).toMatchObject({
      entityTags: [],
      linkedProblem: null,
      evidence: [],
      evidenceTotal: null,
      comments: [],
      commentTotal: null
    })
  })

  it('partes anidadas vacías o a medias no rompen: listas vacías', () => {
    const raw = detail({
      evidenceDetails: {},
      recentComments: { totalCount: 0 }
    })
    expect(toProblemDetail(problemDetailSchema.parse(raw))).toMatchObject({
      evidence: [],
      evidenceTotal: null,
      comments: [],
      commentTotal: 0
    })
  })

  it('v0.9.1: totalCount mayor que lo recibido se conserva (la vista avisa del recorte)', () => {
    const result = toProblemDetail(
      problemDetailSchema.parse(
        detail({
          evidenceDetails: {
            totalCount: 250,
            details: [{ evidenceType: 'EVENT', displayName: 'una' }]
          },
          recentComments: { totalCount: 40, comments: [{ createdAtTimestamp: 1 }] }
        })
      )
    )
    expect(result).toMatchObject({ evidenceTotal: 250, commentTotal: 40 })
    expect(result.evidence).toHaveLength(1)
    expect(result.comments).toHaveLength(1)
  })

  it('v0.9.0: sin elementos raros, invalid = 0', () => {
    expect(toProblemDetail(problemDetailSchema.parse(detail())).invalid).toBe(0)
  })

  it.each([
    [
      'una evidencia que no es objeto',
      {
        evidenceDetails: {
          details: ['texto suelto', { evidenceType: 'EVENT', displayName: 'Buena' }]
        }
      },
      'evidence'
    ],
    [
      'una evidencia con startTime de texto',
      {
        evidenceDetails: {
          details: [
            { evidenceType: 'EVENT', displayName: 'Mala', startTime: 'ayer' },
            { evidenceType: 'EVENT', displayName: 'Buena' }
          ]
        }
      },
      'evidence'
    ],
    [
      'una evidencia sin displayName',
      {
        evidenceDetails: {
          details: [{ evidenceType: 'EVENT' }, { evidenceType: 'EVENT', displayName: 'Buena' }]
        }
      },
      'evidence'
    ],
    [
      'una evidencia sin evidenceType',
      {
        evidenceDetails: {
          details: [{ displayName: 'Sin tipo' }, { evidenceType: 'METRIC', displayName: 'Buena' }]
        }
      },
      'evidence'
    ],
    [
      'una evidencia con evidenceType numérico',
      {
        evidenceDetails: {
          details: [
            { evidenceType: 3, displayName: 'Mala' },
            { evidenceType: 'EVENT', displayName: 'Buena' }
          ]
        }
      },
      'evidence'
    ],
    [
      'una evidencia con valueBeforeChangePoint de texto',
      {
        evidenceDetails: {
          details: [
            { evidenceType: 'METRIC', displayName: 'Mala', valueBeforeChangePoint: '10' },
            { evidenceType: 'METRIC', displayName: 'Buena' }
          ]
        }
      },
      'evidence'
    ],
    [
      'un comentario null',
      { recentComments: { comments: [null, { content: 'Bueno', createdAtTimestamp: 1 }] } },
      'comments'
    ],
    [
      'un comentario sin fecha (createdAtTimestamp es obligatorio)',
      {
        recentComments: {
          comments: [{ authorName: 'a', content: 'Sin fecha' }, { createdAtTimestamp: 1 }]
        }
      },
      'comments'
    ]
  ] as const)(
    'v0.9.0: %s → el detalle llega igual, sin ese elemento, e invalid = 1',
    (_case, override, part) => {
      const result = toProblemDetail(
        problemDetailSchema.parse(detail(override as unknown as Record<string, unknown>))
      )
      expect(result.invalid).toBe(1)
      expect(result[part]).toHaveLength(1)
      // El resto del detalle no se toca.
      expect(result).toMatchObject({ problemId: 'p-0001', displayId: 'P-1' })
    }
  )

  it('v0.9.1: los descartes de evidencias y comentarios se suman', () => {
    const result = toProblemDetail(
      problemDetailSchema.parse(
        detail({
          evidenceDetails: { details: [42, 'x'] },
          recentComments: { comments: [{ createdAtTimestamp: 'hoy' }] }
        })
      )
    )
    expect(result.invalid).toBe(3)
    expect(result.evidence).toEqual([])
    expect(result.comments).toEqual([])
  })

  it('v0.9.1: un tipo de evidencia desconocido se conserva tal cual y no cuenta como invalid', () => {
    const result = toProblemDetail(
      problemDetailSchema.parse(
        detail({
          evidenceDetails: {
            details: [{ evidenceType: 'TIPO_FUTURO', displayName: 'Nueva', otroCampo: [1, 2] }]
          }
        })
      )
    )
    expect(result.invalid).toBe(0)
    expect(result.evidence[0]?.evidenceType).toBe('TIPO_FUTURO')
  })

  it('el detalle también es un resumen válido (con namespaces)', () => {
    const result = toProblemDetail(
      problemDetailSchema.parse(detail({ 'k8s.namespace.name': ['ns-a'] }))
    )
    expect(result).toMatchObject({ status: 'OPEN', endTime: null, namespaces: ['ns-a'] })
  })
})

describe('toEvidenceWire (v0.9.1)', () => {
  /** Pasa una evidencia cruda por el esquema del detalle y devuelve la normalizada. */
  function normalize(raw: Record<string, unknown>): EvidenceWire | undefined {
    const parsed = problemDetailSchema.parse({ ...problem(), evidenceDetails: { details: [raw] } })
    return toProblemDetail(parsed).evidence[0]
  }

  it('METRIC: entidad, agrupación, unidad, métrica y valores antes y después', () => {
    const result = normalize({
      evidenceType: 'METRIC',
      displayName: 'Tiempo de respuesta',
      entity: { entityId: { id: 'SERVICE-1', type: 'SERVICE' }, name: 'pagos' },
      groupingEntity: { entityId: { id: 'PROCESS_GROUP-1', type: 'PROCESS_GROUP' } },
      rootCauseRelevant: true,
      startTime: 100,
      endTime: -1,
      metricId: 'builtin:service.response.time',
      unit: 'MicroSecond',
      valueBeforeChangePoint: 1200.5,
      valueAfterChangePoint: 9800
    })
    expect(result).toEqual({
      evidenceType: 'METRIC',
      displayName: 'Tiempo de respuesta',
      entity: { id: 'SERVICE-1', name: 'pagos', type: 'SERVICE' },
      groupingEntity: { id: 'PROCESS_GROUP-1', name: null, type: 'PROCESS_GROUP' },
      rootCauseRelevant: true,
      startTime: 100,
      endTime: -1,
      eventType: null,
      properties: [],
      metricId: 'builtin:service.response.time',
      unit: 'MicroSecond',
      valueBefore: 1200.5,
      valueAfter: 9800
    })
  })

  it('endTime -1 y null pasan tal cual; ausente → null', () => {
    const base = { evidenceType: 'EVENT', displayName: 'e' }
    expect(normalize({ ...base, endTime: -1 })?.endTime).toBe(-1)
    expect(normalize({ ...base, endTime: null })?.endTime).toBeNull()
    expect(normalize(base)?.endTime).toBeNull()
  })

  it('rootCauseRelevant ausente → false', () => {
    expect(normalize({ evidenceType: 'EVENT', displayName: 'e' })?.rootCauseRelevant).toBe(false)
  })

  it('una entidad sin entityId.id (o null) → null, sin descartar la evidencia', () => {
    const result = normalize({
      evidenceType: 'EVENT',
      displayName: 'e',
      entity: { entityId: { type: 'HOST' }, name: 'sin id' },
      groupingEntity: null
    })
    expect(result?.entity).toBeNull()
    expect(result?.groupingEntity).toBeNull()
    expect(normalize({ evidenceType: 'EVENT', displayName: 'e', entity: {} })?.entity).toBeNull()
  })

  it('EVENT: las 8 primeras propiedades con clave, como texto y recortadas a 300', () => {
    const properties = [
      { value: 'sin clave' },
      { key: 'texto', value: 'hola' },
      { key: 'numero', value: 42 },
      { key: 'booleano', value: false },
      { key: 'objeto', value: { a: 1 } },
      { key: 'nulo', value: null },
      { key: 'largo', value: 'x'.repeat(1000) },
      { key: 'sin-valor' },
      { key: 'p8', value: '8' },
      { key: 'p9', value: '9' }
    ]
    const result = normalize({
      evidenceType: 'EVENT',
      displayName: 'Reinicio',
      eventType: 'PROCESS_RESTART',
      data: { properties, otroCampo: true }
    })
    expect(result?.eventType).toBe('PROCESS_RESTART')
    expect(result?.properties.map((p) => p.key)).toEqual([
      'texto',
      'numero',
      'booleano',
      'objeto',
      'nulo',
      'largo',
      'sin-valor',
      'p8'
    ])
    const value = (key: string): string | undefined =>
      result?.properties.find((p) => p.key === key)?.text
    expect(value('texto')).toBe('hola')
    expect(value('numero')).toBe('42')
    expect(value('booleano')).toBe('false')
    expect(value('objeto')).toBe('{"a":1}')
    expect(value('nulo')).toBe('null')
    expect(value('largo')).toHaveLength(300)
    expect(value('sin-valor')).toBe('')
    // Cumple el máximo del contrato del IPC.
    expect(evidenceWireSchema.safeParse(result).success).toBe(true)
  })

  it('data null o sin properties: lista vacía', () => {
    expect(normalize({ evidenceType: 'EVENT', displayName: 'e', data: null })?.properties).toEqual(
      []
    )
    expect(normalize({ evidenceType: 'EVENT', displayName: 'e', data: {} })?.properties).toEqual([])
  })

  it('valores antes y después null se quedan null', () => {
    const result = normalize({
      evidenceType: 'TRANSACTIONAL',
      displayName: 't',
      valueBeforeChangePoint: null,
      valueAfterChangePoint: null
    })
    expect(result).toMatchObject({ valueBefore: null, valueAfter: null, unit: null })
  })

  it('sin startTime → null', () => {
    expect(normalize({ evidenceType: 'EVENT', displayName: 'e' })?.startTime).toBeNull()
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
