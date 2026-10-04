import { describe, expect, it } from 'vitest'
import { sloSchema, toSloSummary } from './slos'

/** SLOs de la API v2 evaluados: -1 y "NONE" significan "sin dato" y pasan a null. */

function slo(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'slo-1',
    name: 'Disponibilidad de pagos',
    enabled: true,
    status: 'SUCCESS',
    target: 99.5,
    warning: 99.8,
    evaluatedPercentage: 99.91,
    errorBudget: 82.3,
    error: 'NONE',
    ...overrides
  }
}

describe('sloSchema y toSloSummary', () => {
  it('convierte un SLO evaluado', () => {
    expect(toSloSummary(sloSchema.parse(slo()))).toEqual({
      id: 'slo-1',
      name: 'Disponibilidad de pagos',
      status: 'SUCCESS',
      target: 99.5,
      warning: 99.8,
      evaluatedPercentage: 99.91,
      errorBudget: 82.3,
      error: null,
      relatedOpenProblems: null
    })
  })

  describe('relatedOpenProblems (solo llega evaluando)', () => {
    it.each([
      ['presente', { relatedOpenProblems: 2 }, 2],
      ['0', { relatedOpenProblems: 0 }, 0],
      // -1: Dynatrace no pudo calcularlo (OpenAPI). Pasa tal cual; la interfaz lo trata.
      ['-1', { relatedOpenProblems: -1 }, -1],
      ['ausente', {}, null]
    ])('%s → %s', (_case, extra, expected) => {
      expect(toSloSummary(sloSchema.parse(slo(extra))).relatedOpenProblems).toBe(expected)
    })

    it('si no es un número, el SLO no vale (no se cuela texto en la tarjeta)', () => {
      expect(sloSchema.safeParse(slo({ relatedOpenProblems: '2' })).success).toBe(false)
    })
  })

  it('-1 y un error se conservan como null y como texto', () => {
    expect(
      toSloSummary(
        sloSchema.parse(
          slo({ status: 'FAILURE', evaluatedPercentage: -1, errorBudget: -1, error: 'NO_DATA' })
        )
      )
    ).toMatchObject({
      status: 'FAILURE',
      evaluatedPercentage: null,
      errorBudget: null,
      error: 'NO_DATA'
    })
  })

  it('un presupuesto negativo distinto de -1 es un valor real (presupuesto agotado)', () => {
    expect(toSloSummary(sloSchema.parse(slo({ errorBudget: -12.5 }))).errorBudget).toBe(-12.5)
  })

  it.each(['SUCCESS', 'WARNING', 'FAILURE'])('acepta el estado %s', (status) => {
    expect(sloSchema.safeParse(slo({ status })).success).toBe(true)
  })

  it.each([
    ['estado desconocido', { status: 'OK' }],
    ['target no numérico', { target: '99' }],
    ['sin id', { id: undefined }]
  ])('rechaza %s', (_case, overrides) => {
    expect(sloSchema.safeParse(slo(overrides)).success).toBe(false)
  })
})
