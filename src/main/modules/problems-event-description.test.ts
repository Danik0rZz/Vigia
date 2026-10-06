import { describe, expect, it } from 'vitest'
import { MAX_DESCRIPTION_LENGTH, evidenceWireSchema } from '@shared/problem-evidence'
import { problemDetailSchema, toProblemDetail } from './problems'

/**
 * Ficha 0001: main extrae `dt.event.description` de las propiedades EN CRUDO de
 * un EVENT y la manda aparte (`description: { text, truncated } | null`), fuera
 * de las 8 propiedades genéricas. Fixtures inventados, sin datos del tenant.
 */

const DESCRIPTION_KEY = 'dt.event.description'

/** Markdown de más de 300 caracteres (el recorte de las propiedades genéricas). */
const MARKDOWN = [
  '# Uso de CPU alto',
  '',
  'El proceso **supera** el umbral durante *5 minutos*.',
  '',
  '- Revisar `top` en el host',
  '- Comprobar los despliegues recientes',
  '',
  '| Métrica | Valor |',
  '| --- | --- |',
  '| CPU | 97 % |',
  '',
  'Más información en [la guía](https://ejemplo.test/guia).',
  '',
  'x'.repeat(400)
].join('\n')

/** Problema sintético mínimo con una sola evidencia. */
function problemWith(evidence: Record<string, unknown>): Record<string, unknown> {
  return {
    problemId: 'p-0001',
    displayId: 'P-1',
    title: 'Respuesta lenta',
    status: 'OPEN',
    severityLevel: 'PERFORMANCE',
    impactLevel: 'SERVICES',
    startTime: 1791050000000,
    endTime: -1,
    affectedEntities: [],
    impactedEntities: [],
    managementZones: [],
    problemFilters: [],
    evidenceDetails: { details: [evidence] }
  }
}

/** EVENT con esas propiedades en data.properties, tal como llegan de la API v2. */
function event(properties: unknown[]): Record<string, unknown> {
  return {
    evidenceType: 'EVENT',
    displayName: 'Uso de CPU alto',
    eventType: 'CPU_SATURATED',
    startTime: 1791050000000,
    endTime: -1,
    data: { eventId: 'ev-1', status: 'OPEN', properties }
  }
}

/** La evidencia normalizada por main (campo nuevo incluido), sin tipos para no atarse a la forma. */
function normalize(evidence: Record<string, unknown>): Record<string, unknown> {
  const detail = toProblemDetail(problemDetailSchema.parse(problemWith(evidence)))
  const result = detail.evidence[0] as unknown as Record<string, unknown> | undefined
  expect(result).toBeDefined()
  return result as Record<string, unknown>
}

const propertyKeys = (wire: Record<string, unknown>): string[] =>
  (wire['properties'] as { key: string }[]).map((property) => property.key)

const others = (count: number, prefix = 'p'): { key: string; value: string }[] =>
  Array.from({ length: count }, (_, i) => ({ key: `${prefix}${i}`, value: `v${i}` }))

describe('CA2 (0001): la descripción llega entera en su campo propio, en cualquier posición', () => {
  it.each([
    ['la primera', 0],
    ['en medio', 4],
    ['la octava', 7],
    ['después de la octava', 10],
    ['la última de 20', 19]
  ])('%s (índice %d)', (_label, index) => {
    const list: unknown[] = others(19)
    list.splice(index, 0, { key: DESCRIPTION_KEY, value: MARKDOWN })
    const wire = normalize(event(list))
    expect(wire['description']).toEqual({ text: MARKDOWN, truncated: false })
    expect(propertyKeys(wire)).not.toContain(DESCRIPTION_KEY)
    expect(evidenceWireSchema.safeParse(wire).success).toBe(true)
  })

  it('la clave deja de ocupar sitio: con 9 propiedades más, salen las 8 primeras de las otras', () => {
    const list: unknown[] = others(9)
    list.splice(3, 0, { key: DESCRIPTION_KEY, value: MARKDOWN })
    const wire = normalize(event(list))
    expect(propertyKeys(wire)).toEqual(['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'])
    expect(wire['description']).toEqual({ text: MARKDOWN, truncated: false })
  })

  it('no se recorta a 300 como las propiedades genéricas', () => {
    expect(MARKDOWN.length).toBeGreaterThan(300)
    const wire = normalize(event([{ key: DESCRIPTION_KEY, value: MARKDOWN }]))
    expect((wire['description'] as { text: string }).text).toHaveLength(MARKDOWN.length)
  })

  it('si la clave se repite, vale la primera con texto no vacío', () => {
    const wire = normalize(
      event([
        { key: DESCRIPTION_KEY, value: 42 },
        { key: DESCRIPTION_KEY, value: '   ' },
        { key: DESCRIPTION_KEY, value: 'Primera válida' },
        { key: DESCRIPTION_KEY, value: 'Segunda válida' }
      ])
    )
    expect(wire['description']).toEqual({ text: 'Primera válida', truncated: false })
    expect(propertyKeys(wire)).not.toContain(DESCRIPTION_KEY)
  })
})

describe('CA3 (0001): recorte a MAX_DESCRIPTION_LENGTH con truncated', () => {
  it('MAX_DESCRIPTION_LENGTH está entre 5 000 y 20 000', () => {
    expect(Number.isInteger(MAX_DESCRIPTION_LENGTH)).toBe(true)
    expect(MAX_DESCRIPTION_LENGTH).toBeGreaterThanOrEqual(5000)
    expect(MAX_DESCRIPTION_LENGTH).toBeLessThanOrEqual(20_000)
  })

  it('una de más de MAX llega recortada a MAX con truncated: true', () => {
    const long = `# Título\n\n${'abcdefghij'.repeat(Math.ceil(MAX_DESCRIPTION_LENGTH / 10) + 5)}`
    expect(long.length).toBeGreaterThan(MAX_DESCRIPTION_LENGTH)
    const wire = normalize(event([{ key: DESCRIPTION_KEY, value: long }]))
    expect(wire['description']).toEqual({
      text: long.slice(0, MAX_DESCRIPTION_LENGTH),
      truncated: true
    })
    expect(evidenceWireSchema.safeParse(wire).success).toBe(true)
  })

  it('una de MAX + 1 llega recortada (el límite es exacto)', () => {
    const text = 'm'.repeat(MAX_DESCRIPTION_LENGTH + 1)
    const wire = normalize(event([{ key: DESCRIPTION_KEY, value: text }]))
    expect(wire['description']).toEqual({ text: text.slice(0, -1), truncated: true })
  })

  it.each([
    ['exactamente MAX', 0],
    ['MAX − 1', 1]
  ])('una de %s llega entera con truncated: false', (_label, less) => {
    const text = 'm'.repeat(MAX_DESCRIPTION_LENGTH - less)
    const wire = normalize(event([{ key: DESCRIPTION_KEY, value: text }]))
    expect(wire['description']).toEqual({ text, truncated: false })
    expect(evidenceWireSchema.safeParse(wire).success).toBe(true)
  })
})

describe('CA4 (0001): sin descripción utilizable, el campo es null', () => {
  it('sin la clave', () => {
    expect(normalize(event(others(3)))['description']).toBeNull()
    expect(normalize(event([]))['description']).toBeNull()
  })

  it('sin data ni properties', () => {
    expect(
      normalize({ evidenceType: 'EVENT', displayName: 'Sin data', eventType: 'CUSTOM_INFO' })[
        'description'
      ]
    ).toBeNull()
    expect(
      normalize({ evidenceType: 'EVENT', displayName: 'Data vacía', data: {} })['description']
    ).toBeNull()
  })

  it.each([
    ['un número', 42],
    ['un booleano', true],
    ['un objeto', { text: 'no' }],
    ['una lista', ['a', 'b']],
    ['null', null],
    ['sin value', undefined]
  ])('con value que no es texto: %s', (_label, value) => {
    const property =
      value === undefined ? { key: DESCRIPTION_KEY } : { key: DESCRIPTION_KEY, value }
    const wire = normalize(event([property]))
    expect(wire['description']).toBeNull()
    expect(evidenceWireSchema.safeParse(wire).success).toBe(true)
  })

  it.each([
    ['vacío', ''],
    ['solo espacios', '     '],
    ['solo saltos y tabuladores', ' \n\t\r\n ']
  ])('con texto %s', (_label, value) => {
    const wire = normalize(event([{ key: DESCRIPTION_KEY, value }]))
    expect(wire['description']).toBeNull()
  })
})
