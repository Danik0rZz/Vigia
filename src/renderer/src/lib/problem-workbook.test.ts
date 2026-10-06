import type { TFunction } from 'i18next'
import { describe, expect, it } from 'vitest'
import { MAX_EXPORT_ROWS, type ProblemDetail } from '@shared/modules'
import {
  DEFAULT_EVIDENCE_SORT,
  EMPTY_EVIDENCE_FILTERS,
  type EvidenceFilters,
  type EvidenceWire
} from '@shared/problem-evidence'
import { PROBLEM_EXPORT_COLUMNS } from '@shared/problem-row'
import { problemWorkbook } from './problem-workbook'

/**
 * Hojas de la exportación del detalle de un problema. v0.10.0: Resumen,
 * Entidades y Evidencias son principales (van también en CSV y TXT); las
 * evidencias son exactamente las de la tabla (filtradas y en su orden), y la
 * hoja Info dice si van todas o qué filtro se aplicó. Comentarios, solo con
 * filas. Lo que la API no mandó (totalCount) se avisa en Info.
 */

/** t falso: devuelve la clave (y los parámetros, si los hay) para ver qué se pidió. */
const t = ((key: string, options?: Record<string, unknown>) =>
  options === undefined ? key : `${key}${JSON.stringify(options)}`) as unknown as TFunction

const LOADED = new Date('2026-10-04T10:00:00.000Z')
const NOW = Date.UTC(2026, 9, 4, 12, 0)
const MIN = 60_000

type EventData = NonNullable<EvidenceWire['data']>
const eventData = (overrides: Partial<EventData> = {}): EventData => ({
  status: null,
  endTime: null,
  title: null,
  eventId: null,
  tags: [],
  managementZones: [],
  flags: { maintenance: false, frequent: false, suppressed: false },
  ...overrides
})

function evidence(overrides: Partial<EvidenceWire> = {}): EvidenceWire {
  return {
    evidenceType: 'EVENT',
    displayName: 'Lento',
    entity: { id: 'SERVICE-1', name: 'pagos', type: 'SERVICE' },
    groupingEntity: null,
    rootCauseRelevant: false,
    startTime: NOW - 60 * MIN,
    endTime: NOW - 30 * MIN,
    eventType: null,
    properties: [],
    metricId: null,
    unit: null,
    valueBefore: null,
    valueAfter: null,
    eventMetric: null,
    description: null,
    data: null,
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
    // Por defecto, lo recibido es lo legible (sin descartes).
    evidenceReceived: overrides.evidence?.length ?? 0,
    commentReceived: overrides.comments?.length ?? 0,
    ...overrides
  } as ProblemDetail
}

/** El estado de la tabla que pasa la página: sin filtros y el orden por defecto. */
const table = (
  filters: Partial<EvidenceFilters> = {},
  sort = DEFAULT_EVIDENCE_SORT
): Parameters<typeof problemWorkbook>[3] => ({
  filters: { ...EMPTY_EVIDENCE_FILTERS, ...filters },
  sort,
  now: NOW,
  lang: 'es'
})

const build = (
  input: ProblemDetail,
  filters: Partial<EvidenceFilters> = {}
): ReturnType<typeof problemWorkbook> => problemWorkbook(input, LOADED, t, table(filters))

const names = (result: ReturnType<typeof problemWorkbook>): string[] =>
  result.sheets.map((item) => item.name)

const sheet = (
  result: ReturnType<typeof problemWorkbook>,
  name: string
): ReturnType<typeof problemWorkbook>['sheets'][number] | undefined =>
  result.sheets.find((item) => item.name === `problems.sheets.${name}`)

/** La línea fija de Info sobre las evidencias (todas o filtradas). */
const exportLine = (result: ReturnType<typeof problemWorkbook>): string[] =>
  result.warnings.filter((line) => line.startsWith('problems.evidenceExport'))

/** Parámetros de una línea de t falso: 'clave{"a":1}' → { a: 1 }. */
const params = (line: string | undefined): Record<string, unknown> =>
  JSON.parse((line ?? '').replace(/^[^{]*/, '') || '{}') as Record<string, unknown>

const EVIDENCE_KEYS = [
  'status',
  'title',
  'type',
  'entity',
  'entityType',
  'start',
  'end',
  'durationMinutes',
  'tags',
  'rootCause',
  'maintenance',
  'frequent',
  'eventId',
  'before',
  'after',
  'unit',
  'metricId'
]

describe('problemWorkbook: hojas', () => {
  it('sin evidencias ni comentarios: Resumen, Entidades y Evidencias (vacía), las tres primary', () => {
    const result = build(detail())
    expect(names(result)).toEqual([
      'problems.sheets.summary',
      'problems.sheets.entities',
      'problems.sheets.evidence'
    ])
    expect(result.sheets.every((item) => item.primary)).toBe(true)
    expect(sheet(result, 'evidence')?.rows).toEqual([])
    // Solo la línea de "todas" (0).
    expect(result.warnings).toEqual([`problems.evidenceExportAll${JSON.stringify({ total: 0 })}`])
  })

  it('Resumen: las 17 columnas de siempre y una sola fila', () => {
    const [summary] = build(detail()).sheets
    expect(summary?.columns.map((c) => c.key)).toEqual(PROBLEM_EXPORT_COLUMNS.map((c) => c.key))
    expect(summary?.columns).toHaveLength(17)
    expect(summary?.rows).toHaveLength(1)
    expect(summary?.rows[0]?.['displayId']).toBe('P-101')
  })

  it('Entidades: primero las afectadas y después las impactadas, con su rol', () => {
    const entities = build(detail()).sheets[1]
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

  it('con todo: Resumen, Entidades, Evidencias y Comentarios; solo Comentarios no es primary', () => {
    const result = build(
      detail({
        evidence: [evidence()],
        comments: [{ author: 'op', content: 'Mirando', context: null, createdAt: 2 }]
      })
    )
    expect(names(result)).toEqual([
      'problems.sheets.summary',
      'problems.sheets.entities',
      'problems.sheets.evidence',
      'problems.sheets.comments'
    ])
    expect(result.sheets.map((item) => item.primary)).toEqual([true, true, true, false])
    expect(names(result).some((name) => name.includes('impact'))).toBe(false)
  })

  it('Comentarios: autor, fecha, contexto y contenido (sin autor ni contexto → null)', () => {
    const comments = sheet(
      build(
        detail({
          comments: [
            { author: 'op', content: 'Mirando', context: 'ui', createdAt: 2 },
            { author: null, content: '', context: null, createdAt: 3 }
          ]
        })
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
})

describe('problemWorkbook: hoja Evidencias (v0.10.0)', () => {
  it('columnas por key y en orden, con sus tipos y sus cabeceras', () => {
    const evidenceSheet = sheet(build(detail({ evidence: [evidence()] })), 'evidence')
    expect(evidenceSheet?.columns.map((c) => c.key)).toEqual(EVIDENCE_KEYS)
    const types = Object.fromEntries(evidenceSheet?.columns.map((c) => [c.key, c.type]) ?? [])
    expect(types).toMatchObject({
      start: 'date',
      end: 'date',
      durationMinutes: 'number',
      before: 'number',
      after: 'number',
      status: 'string',
      title: 'string',
      tags: 'string',
      eventId: 'string'
    })
    expect(evidenceSheet?.columns.map((c) => c.header)).toEqual(
      EVIDENCE_KEYS.map((key) => `problems.evidenceColumns.${key}`)
    )
    // Se van name y eventType (los sustituyen title y type).
    expect(evidenceSheet?.columns.map((c) => c.key)).not.toContain('name')
    expect(evidenceSheet?.columns.map((c) => c.key)).not.toContain('eventType')
  })

  it('un EVENT completo (con data): estado, título, tags, flags, eventId y duración', () => {
    const row = sheet(
      build(
        detail({
          evidence: [
            evidence({
              displayName: 'Nombre de la evidencia',
              eventType: 'CUSTOM_ALERT',
              entity: { id: 'HOST-9', name: null, type: 'HOST' },
              rootCauseRelevant: true,
              startTime: NOW - 90 * MIN,
              endTime: NOW - 30 * MIN,
              data: eventData({
                status: 'CLOSED',
                endTime: NOW - 30 * MIN,
                title: 'Título del evento',
                eventId: 'ev-abc',
                tags: ['equipo:pagos', 'critico'],
                flags: { maintenance: true, frequent: false, suppressed: true }
              })
            })
          ]
        })
      ),
      'evidence'
    )?.rows[0]
    expect(row).toMatchObject({
      status: 'problems.status.CLOSED',
      title: 'Título del evento',
      // Sin nombre: la etiqueta es el id.
      entity: 'HOST-9',
      entityType: 'HOST',
      start: NOW - 90 * MIN,
      end: NOW - 30 * MIN,
      durationMinutes: 60,
      tags: 'equipo:pagos | critico',
      rootCause: 'problems.yes',
      maintenance: 'problems.yes',
      frequent: 'problems.no',
      eventId: 'ev-abc',
      before: null,
      after: null,
      unit: null,
      metricId: null
    })
    expect(typeof row?.['type']).toBe('string')
  })

  it('activa: fin = "Activo" (texto) y duración hasta ahora; sin inicio, duración null', () => {
    const rows = sheet(
      build(
        detail({
          evidence: [
            evidence({ displayName: 'activa', startTime: NOW - 45 * MIN, endTime: -1 }),
            evidence({ displayName: 'sin inicio', startTime: null, endTime: -1 })
          ]
        })
      ),
      'evidence'
    )?.rows
    const byTitle = (title: string): Record<string, unknown> | undefined =>
      rows?.find((row) => row['title'] === title)
    expect(byTitle('activa')).toMatchObject({
      status: 'problems.status.OPEN',
      end: 'problems.eventTable.active',
      durationMinutes: 45
    })
    expect(byTitle('sin inicio')).toMatchObject({ start: null, durationMinutes: null })
  })

  it('duración redondeada a minutos', () => {
    const row = sheet(
      build(
        detail({
          evidence: [evidence({ startTime: NOW - 10 * MIN, endTime: NOW - 10 * MIN + 89_000 })]
        })
      ),
      'evidence'
    )?.rows[0]
    // 89 s → 1 min.
    expect(row?.['durationMinutes']).toBe(1)
  })

  it('un EVENT sin data: título = displayName, sin tags (null), flags "no" y eventId null', () => {
    const row = sheet(
      build(detail({ evidence: [evidence({ displayName: 'Sin data', data: null })] })),
      'evidence'
    )?.rows[0]
    expect(row).toMatchObject({
      status: 'problems.status.CLOSED',
      title: 'Sin data',
      tags: null,
      maintenance: 'problems.no',
      frequent: 'problems.no',
      rootCause: 'problems.no',
      eventId: null
    })
  })

  it('un METRIC: antes y después numéricos, unidad y métrica; sin entidad, null', () => {
    const row = sheet(
      build(
        detail({
          evidence: [
            evidence({
              evidenceType: 'METRIC',
              displayName: 'Tiempo de respuesta',
              entity: null,
              endTime: -1,
              metricId: 'builtin:service.response.time',
              unit: 'MicroSecond',
              valueBefore: 1200.5,
              valueAfter: 9800
            })
          ]
        })
      ),
      'evidence'
    )?.rows[0]
    expect(row).toMatchObject({
      title: 'Tiempo de respuesta',
      entity: null,
      entityType: null,
      before: 1200.5,
      after: 9800,
      unit: 'MicroSecond',
      metricId: 'builtin:service.response.time',
      eventId: null
    })
  })

  it('las filas van en el orden de la tabla (por defecto: abiertos primero, startTime desc)', () => {
    const rows = sheet(
      build(
        detail({
          evidence: [
            evidence({ displayName: 'cerrada reciente', startTime: NOW - 5 * MIN, endTime: NOW }),
            evidence({ displayName: 'abierta antigua', startTime: NOW - 90 * MIN, endTime: -1 }),
            evidence({ displayName: 'abierta reciente', startTime: NOW - 10 * MIN, endTime: -1 })
          ]
        })
      ),
      'evidence'
    )?.rows
    expect(rows?.map((row) => row['title'])).toEqual([
      'abierta reciente',
      'abierta antigua',
      'cerrada reciente'
    ])
  })

  it('con otro orden de la tabla, la exportación lo sigue', () => {
    const result = problemWorkbook(
      detail({
        evidence: [
          evidence({ displayName: 'b' }),
          evidence({ displayName: 'a' }),
          evidence({ displayName: 'c' })
        ]
      }),
      LOADED,
      t,
      table({}, { key: 'title', direction: 'desc' })
    )
    expect(sheet(result, 'evidence')?.rows.map((row) => row['title'])).toEqual(['c', 'b', 'a'])
  })
})

describe('problemWorkbook: filtro de la tabla y línea de Info (v0.10.0)', () => {
  const items = [
    evidence({
      displayName: 'CPU alta',
      endTime: -1,
      entity: { id: 'HOST-1', name: 'host-1', type: 'HOST' },
      data: eventData({ status: 'OPEN', eventId: 'e1', tags: ['equipo:pagos'] })
    }),
    evidence({
      displayName: 'Respuesta lenta',
      data: eventData({ status: 'CLOSED', eventId: 'e2', tags: ['equipo:pagos'] })
    }),
    evidence({
      displayName: 'Errores',
      endTime: -1,
      rootCauseRelevant: true,
      data: eventData({ status: 'OPEN', eventId: 'e3' })
    })
  ]

  it('sin filtros: todas y la línea de "todas" con el total', () => {
    const result = build(detail({ evidence: items }))
    expect(sheet(result, 'evidence')?.rows).toHaveLength(3)
    expect(exportLine(result)).toEqual([
      `problems.evidenceExportAll${JSON.stringify({ total: 3 })}`
    ])
  })

  it('con filtros: solo las filtradas, y la línea dice shown, total y los filtros activos', () => {
    const result = build(detail({ evidence: items }), { status: 'OPEN', text: 'cpu' })
    expect(sheet(result, 'evidence')?.rows.map((row) => row['eventId'])).toEqual(['e1'])
    const [line] = exportLine(result)
    expect(line?.startsWith('problems.evidenceExportFiltered')).toBe(true)
    const p = params(line)
    expect(p['shown']).toBe(1)
    expect(p['total']).toBe(3)
    // Los activos, en orden: estado y después texto; el texto, tal cual.
    const filters = String(p['filters'])
    expect(filters).toContain('cpu')
    expect(filters.split('; ')).toHaveLength(2)
  })

  it.each([
    ['tipos', { types: ['CUSTOM_ALERT'] }],
    ['entidad', { entity: 'HOST-1' }],
    ['etiqueta', { tag: 'equipo:pagos' }],
    ['solo causa raíz', { rootCauseOnly: true }],
    ['estado', { status: 'CLOSED' as const }]
  ])('un solo filtro (%s): línea de filtradas con una parte', (_label, filters) => {
    const [line] = exportLine(build(detail({ evidence: items }), filters))
    expect(line?.startsWith('problems.evidenceExportFiltered')).toBe(true)
    expect(String(params(line)['filters']).split('; ')).toHaveLength(1)
  })

  it('la entidad sale por su etiqueta, no por su id', () => {
    const [line] = exportLine(build(detail({ evidence: items }), { entity: 'HOST-1' }))
    expect(String(params(line)['filters'])).toContain('host-1')
  })

  it('todos los filtros a la vez: seis partes, en el orden estado, texto, tipos, entidad, etiqueta y causa raíz', () => {
    const [line] = exportLine(
      build(detail({ evidence: items }), {
        status: 'OPEN',
        text: 'zzz',
        types: ['CUSTOM_ALERT'],
        entity: 'HOST-1',
        tag: 'equipo:pagos',
        rootCauseOnly: true
      })
    )
    const parts = String(params(line)['filters']).split('; ')
    expect(parts).toHaveLength(6)
    expect(parts[1]).toContain('zzz')
    expect(parts[3]).toContain('host-1')
    expect(parts[4]).toContain('equipo:pagos')
  })

  it('un filtro que no deja nada: la hoja va igual, solo con la cabecera, y la línea dice 0', () => {
    const result = build(detail({ evidence: items }), { text: 'no existe' })
    const evidenceSheet = sheet(result, 'evidence')
    expect(evidenceSheet).toBeDefined()
    expect(evidenceSheet?.primary).toBe(true)
    expect(evidenceSheet?.rows).toEqual([])
    expect(evidenceSheet?.columns.map((c) => c.key)).toEqual(EVIDENCE_KEYS)
    expect(params(exportLine(result)[0])).toMatchObject({ shown: 0, total: 3 })
  })

  it('la línea de las evidencias va después de los avisos de la API', () => {
    const result = build(detail({ evidence: items, evidenceTotal: 10, evidenceReceived: 3 }), {
      status: 'OPEN'
    })
    const api = result.warnings.findIndex((line) =>
      line.startsWith('problems.apiTruncatedEvidence')
    )
    const own = result.warnings.findIndex((line) => line.startsWith('problems.evidenceExport'))
    expect(api).toBeGreaterThanOrEqual(0)
    expect(own).toBeGreaterThan(api)
  })
})

describe('problemWorkbook: avisos de la API y límite de filas', () => {
  it('la API recortó evidencias y comentarios (totalCount mayor que lo recibido) → avisos', () => {
    const result = build(
      detail({
        evidence: [evidence(), evidence()],
        evidenceTotal: 250,
        comments: [{ author: null, content: 'x', context: null, createdAt: 1 }],
        commentTotal: 40
      })
    )
    expect(result.warnings).toContain(
      `problems.apiTruncatedEvidence${JSON.stringify({ shown: 2, total: 250 })}`
    )
    expect(result.warnings).toContain(
      `problems.apiTruncatedComments${JSON.stringify({ shown: 1, total: 40 })}`
    )
  })

  it('el aviso compara con lo RECIBIDO (ilegibles incluidos) y shown es lo recibido', () => {
    const complete = build(
      detail({
        evidence: Array.from({ length: 300 }, () => evidence()),
        evidenceTotal: 301,
        evidenceReceived: 301,
        comments: [{ author: null, content: 'x', context: null, createdAt: 1 }],
        commentTotal: 2,
        commentReceived: 2,
        invalid: 2
      })
    )
    expect(complete.warnings.filter((line) => line.startsWith('problems.apiTruncated'))).toEqual([])
    const cut = build(
      detail({
        evidence: [evidence(), evidence(), evidence()],
        evidenceTotal: 9,
        evidenceReceived: 5,
        comments: [{ author: null, content: 'x', context: null, createdAt: 1 }],
        commentTotal: 4,
        commentReceived: 3,
        invalid: 4
      })
    )
    expect(cut.warnings.filter((line) => line.startsWith('problems.apiTruncated'))).toEqual([
      `problems.apiTruncatedEvidence${JSON.stringify({ shown: 5, total: 9 })}`,
      `problems.apiTruncatedComments${JSON.stringify({ shown: 3, total: 4 })}`
    ])
  })

  it('las evidencias van TODAS (no solo las que se ven en pantalla)', () => {
    const items = Array.from({ length: 300 }, (_, i) => evidence({ displayName: `ev-${i}` }))
    expect(sheet(build(detail({ evidence: items })), 'evidence')?.rows).toHaveLength(300)
  })

  it('si las filtradas pasan del límite global, se recortan y se avisa con shown y el total filtrado', () => {
    const open = Array.from({ length: MAX_EXPORT_ROWS + 5 }, () => evidence({ endTime: -1 }))
    const closed = Array.from({ length: 7 }, () => evidence({ endTime: NOW - MIN }))
    const result = build(
      detail({
        evidence: [...open, ...closed],
        comments: [{ author: null, content: 'x', context: null, createdAt: 1 }]
      }),
      { status: 'OPEN' }
    )
    const rows = result.sheets.reduce((sum, item) => sum + item.rows.length, 0)
    expect(rows).toBe(MAX_EXPORT_ROWS)
    // Resumen (1) + Entidades (3) + Comentarios (1): quedan MAX - 5 para las evidencias.
    const shown = MAX_EXPORT_ROWS - 5
    expect(sheet(result, 'evidence')?.rows).toHaveLength(shown)
    // El total es el de las filtradas (abiertas), no el de todas.
    expect(result.warnings).toContain(
      `problems.evidenceTruncated${JSON.stringify({ shown, total: MAX_EXPORT_ROWS + 5 })}`
    )
  })

  it('no muta el detalle de entrada', () => {
    const input = detail({ evidence: [evidence({ endTime: -1 })], evidenceTotal: 9 })
    const copy = structuredClone(input)
    build(input, { status: 'OPEN' })
    expect(input).toEqual(copy)
  })
})
