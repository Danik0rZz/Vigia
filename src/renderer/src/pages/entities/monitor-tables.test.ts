import { describe, expect, it } from 'vitest'
import type { MonitorBreakdownResult } from '@shared/modules'
import { monitorStepsShown } from './monitor-tables'

/**
 * Ficha 0025, CA3 (decisión del Orquestador): sin pasos que enseñar, con `steps: null` (tipo sin
 * métrica de pasos) o con la lista vacía, la tarjeta de pasos no sale. Mientras carga o si falla
 * (sin datos), sí sale, con su estado de carga o de error (CA4).
 */
const base: MonitorBreakdownResult = {
  locations: [
    {
      id: 'SYNTHETIC_LOCATION-0000000000000001',
      name: 'Uno',
      availability: 99,
      duration: 250,
      failed: 0
    }
  ],
  steps: [],
  warnings: [],
  partial: []
}

describe('CA3 (0025): la tarjeta de pasos solo sale si hay pasos que enseñar', () => {
  it('con steps: null, no sale', () => {
    expect(monitorStepsShown({ ...base, steps: null })).toBe(false)
  })

  it('con la lista de pasos vacía, no sale', () => {
    expect(monitorStepsShown({ ...base, steps: [] })).toBe(false)
  })

  it('con algún paso, sale', () => {
    expect(
      monitorStepsShown({
        ...base,
        steps: [
          {
            id: 'SYNTHETIC_TEST_STEP-0000000000000001',
            name: 'Paso uno',
            duration: 100,
            share: 100
          }
        ]
      })
    ).toBe(true)
  })

  it('sin datos todavía (carga o error), sale para enseñar su estado', () => {
    expect(monitorStepsShown(undefined)).toBe(true)
  })
})
