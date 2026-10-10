import { describe, expect, it } from 'vitest'
import type { ModuleAccess } from '../../data/modules'
import { resolveEntityPageAccess } from './entity-access'

/**
 * Ficha 0058, CA1: el bloque de acceso que repetían las páginas de entidad, en
 * `useEntityPageAccess(id, schema)`. Su lógica pura (`resolveEntityPageAccess`, decisión del
 * test-writer) recibe el id ya validado (o `null`), los accesos de metrics, problems y entities y
 * si ya se conoce `connection:status` (`useConnectionStatusKnown`, ficha 0015), y da los entornos
 * de cada módulo y `canFetch`. Hasta conocer el estado no se sabe si falta algún scope: ni se
 * pide `entities:get` ni se ofrece «Actualizar».
 */

const ENV_ID = '0b5c2a8e-1f3d-4c6b-9a7e-2d4f6a8c0e1b'
const HOST_ID = 'HOST-0000000000000001'

const available: ModuleAccess = { available: true, envId: ENV_ID }
const missingEntities: ModuleAccess = {
  available: false,
  reason: 'missingScope',
  scopes: ['entities.read']
}
const noEnvironment: ModuleAccess = { available: false, reason: 'noEnvironment' }

describe('CA1 (0058): canFetch espera a conocer el estado de la conexión', () => {
  it('CA1 (0058): con el scope de entities, falso hasta conocer el estado y verdadero después', () => {
    const before = resolveEntityPageAccess({
      id: HOST_ID,
      metrics: available,
      problems: available,
      entities: available,
      statusKnown: false
    })
    expect(before.canFetch).toBe(false)
    expect(before.entitiesEnv).toBeNull()

    const after = resolveEntityPageAccess({
      id: HOST_ID,
      metrics: available,
      problems: available,
      entities: available,
      statusKnown: true
    })
    expect(after.canFetch).toBe(true)
    expect(after.metricsEnv).toBe(ENV_ID)
    expect(after.problemsEnv).toBe(ENV_ID)
    expect(after.entitiesEnv).toBe(ENV_ID)
  })

  it('CA1 (0058): sin el scope de entities, falso hasta conocer el estado y verdadero después, sin pedir entities', () => {
    const before = resolveEntityPageAccess({
      id: HOST_ID,
      metrics: available,
      problems: available,
      entities: missingEntities,
      statusKnown: false
    })
    expect(before.canFetch).toBe(false)
    expect(before.entitiesEnv).toBeNull()

    const after = resolveEntityPageAccess({
      id: HOST_ID,
      metrics: available,
      problems: available,
      entities: missingEntities,
      statusKnown: true
    })
    expect(after.canFetch).toBe(true)
    expect(after.metricsEnv).toBe(ENV_ID)
    expect(after.problemsEnv).toBe(ENV_ID)
    expect(after.entitiesEnv).toBeNull()
  })

  it('CA1 (0058): solo con entities disponible, también espera al estado', () => {
    const only = {
      id: HOST_ID,
      metrics: noEnvironment,
      problems: noEnvironment,
      entities: available
    }
    expect(resolveEntityPageAccess({ ...only, statusKnown: false }).canFetch).toBe(false)
    const after = resolveEntityPageAccess({ ...only, statusKnown: true })
    expect(after.canFetch).toBe(true)
    expect(after.metricsEnv).toBeNull()
    expect(after.problemsEnv).toBeNull()
    expect(after.entitiesEnv).toBe(ENV_ID)
  })

  it('CA1 (0058): con un id no válido o sin ningún módulo disponible, nunca', () => {
    expect(
      resolveEntityPageAccess({
        id: null,
        metrics: available,
        problems: available,
        entities: available,
        statusKnown: true
      }).canFetch
    ).toBe(false)
    expect(
      resolveEntityPageAccess({
        id: HOST_ID,
        metrics: noEnvironment,
        problems: noEnvironment,
        entities: noEnvironment,
        statusKnown: true
      }).canFetch
    ).toBe(false)
  })
})
