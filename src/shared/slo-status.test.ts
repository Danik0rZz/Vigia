import { describe, expect, it } from 'vitest'
import { sloDisplayStatus, sloStatuses } from './modules'

/**
 * Estado que muestra Inicio: el de la API, salvo que el SLO no esté evaluado
 * (evaluatedPercentage null, la API dio -1). Entonces UNEVALUATED, aunque la
 * API diga SUCCESS.
 */

describe('sloDisplayStatus', () => {
  it.each(sloStatuses)('evaluado: %s tal cual', (status) => {
    expect(sloDisplayStatus({ status, evaluatedPercentage: 99.1 })).toBe(status)
  })

  it.each(sloStatuses)('sin evaluar (null) con %s → UNEVALUATED', (status) => {
    expect(sloDisplayStatus({ status, evaluatedPercentage: null })).toBe('UNEVALUATED')
  })

  it('0 % es un valor evaluado, no "sin evaluar"', () => {
    expect(sloDisplayStatus({ status: 'FAILURE', evaluatedPercentage: 0 })).toBe('FAILURE')
  })
})
