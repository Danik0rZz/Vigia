import { describe, expect, it } from 'vitest'
import { MAX_DESCRIPTION_LENGTH, evidenceWireSchema } from './problem-evidence'

/**
 * Ficha 0001: el contrato del IPC de una evidencia admite la descripción del
 * evento (`description: { text, truncated } | null`) y no deja pasar un texto
 * de más de MAX_DESCRIPTION_LENGTH. Fixtures inventados.
 */

/** Evidencia EVENT válida del contrato, con la descripción que se pase. */
function wireWith(description: unknown): Record<string, unknown> {
  return {
    evidenceType: 'EVENT',
    displayName: 'Uso de CPU alto',
    entity: { id: 'HOST-1', name: 'host-prueba', type: 'HOST' },
    groupingEntity: null,
    rootCauseRelevant: false,
    startTime: 1000,
    endTime: 2000,
    eventType: 'CPU_SATURATED',
    properties: [{ key: 'cpu.usage', text: '97' }],
    metricId: null,
    unit: null,
    valueBefore: null,
    valueAfter: null,
    eventMetric: null,
    data: null,
    description
  }
}

describe('CA5 (0001): evidenceWireSchema y el campo description', () => {
  it('acepta la descripción con texto y truncated, y null', () => {
    const parsed = evidenceWireSchema.safeParse(
      wireWith({ text: '# Título\n\n- uno\n- **dos**', truncated: false })
    )
    expect(parsed.success).toBe(true)
    // El campo no se pierde al validar (no lo quita un esquema que no lo conozca).
    expect((parsed.data as Record<string, unknown> | undefined)?.['description']).toEqual({
      text: '# Título\n\n- uno\n- **dos**',
      truncated: false
    })
    expect(evidenceWireSchema.safeParse(wireWith(null)).success).toBe(true)
  })

  it('acepta un texto de MAX_DESCRIPTION_LENGTH caracteres, recortado', () => {
    const text = 'a'.repeat(MAX_DESCRIPTION_LENGTH)
    expect(evidenceWireSchema.safeParse(wireWith({ text, truncated: true })).success).toBe(true)
  })

  it('rechaza un texto de más de MAX_DESCRIPTION_LENGTH caracteres', () => {
    const text = 'a'.repeat(MAX_DESCRIPTION_LENGTH + 1)
    expect(evidenceWireSchema.safeParse(wireWith({ text, truncated: true })).success).toBe(false)
    expect(evidenceWireSchema.safeParse(wireWith({ text, truncated: false })).success).toBe(false)
  })

  it('rechaza formas que no son la del campo', () => {
    expect(evidenceWireSchema.safeParse(wireWith({ text: 'sin truncated' })).success).toBe(false)
    expect(evidenceWireSchema.safeParse(wireWith({ text: 5, truncated: false })).success).toBe(
      false
    )
    expect(evidenceWireSchema.safeParse(wireWith('texto suelto')).success).toBe(false)
  })
})
