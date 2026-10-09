import { describe, expect, it } from 'vitest'
import { MODULE_SCOPES, REQUIRED_CLASSIC_SCOPES, REQUIRED_OAUTH_SCOPES } from './dynatrace'

/** Scopes que necesita cada módulo, por mecanismo. */

describe('MODULE_SCOPES', () => {
  it('tiene los scopes acordados para problems, metrics, slos, entities y events (0042)', () => {
    expect(MODULE_SCOPES).toEqual({
      problems: { classic: ['problems.read'], oauth: ['environment-api:problems:read'] },
      metrics: { classic: ['metrics.read'], oauth: ['environment-api:metrics:read'] },
      slos: { classic: ['slo.read'], oauth: ['environment-api:slo:read'] },
      entities: { classic: ['entities.read'], oauth: ['environment-api:entities:read'] },
      events: { classic: ['events.read'], oauth: ['environment-api:events:read'] }
    })
  })

  it('REQUIRED_CLASSIC_SCOPES es la unión ordenada y sin repetidos de los classic', () => {
    const union = [...new Set(Object.values(MODULE_SCOPES).flatMap((m) => m.classic))].sort()
    expect(REQUIRED_CLASSIC_SCOPES).toEqual(union)
    expect(REQUIRED_CLASSIC_SCOPES).toEqual([
      'entities.read',
      'events.read',
      'metrics.read',
      'problems.read',
      'slo.read'
    ])
  })
})

/**
 * Ficha 0014: `GET /entities/{entityId}` y `GET /entities` piden `entities.read`
 * (`x-token-scopes`) y `environment-api:entities:read` (`ssoAuth`) en la OpenAPI v2.
 */
describe('CA2 (0014): el módulo entities y sus scopes', () => {
  it('MODULE_SCOPES.entities tiene entities.read y environment-api:entities:read', () => {
    const scopes = (MODULE_SCOPES as Record<string, { classic: unknown; oauth: unknown }>)[
      'entities'
    ]
    expect(scopes, 'MODULE_SCOPES.entities').toBeDefined()
    expect(scopes?.classic).toEqual(['entities.read'])
    expect(scopes?.oauth).toEqual(['environment-api:entities:read'])
  })

  it('entran en REQUIRED_CLASSIC_SCOPES y REQUIRED_OAUTH_SCOPES, sin repetidos y ordenados', () => {
    expect(REQUIRED_CLASSIC_SCOPES).toContain('entities.read')
    expect(REQUIRED_OAUTH_SCOPES).toContain('environment-api:entities:read')
    expect(REQUIRED_OAUTH_SCOPES).toEqual(
      [...new Set(Object.values(MODULE_SCOPES).flatMap((m) => m.oauth))].sort()
    )
    expect(REQUIRED_OAUTH_SCOPES).toEqual([
      'environment-api:entities:read',
      'environment-api:events:read',
      'environment-api:metrics:read',
      'environment-api:problems:read',
      'environment-api:slo:read'
    ])
  })
})

/**
 * Ficha 0042: `GET /events` pide `events.read` (`x-token-scopes`) y
 * `environment-api:events:read` (`ssoAuth`) en la OpenAPI v2 (Environment API v2).
 */
describe('CA2 (0042): el módulo events y sus scopes', () => {
  it('MODULE_SCOPES.events tiene events.read y environment-api:events:read', () => {
    const scopes = (MODULE_SCOPES as Record<string, { classic: unknown; oauth: unknown }>)['events']
    expect(scopes, 'MODULE_SCOPES.events').toBeDefined()
    expect(scopes?.classic).toEqual(['events.read'])
    expect(scopes?.oauth).toEqual(['environment-api:events:read'])
  })

  it('entran en REQUIRED_CLASSIC_SCOPES y REQUIRED_OAUTH_SCOPES, una vez y en orden', () => {
    expect(REQUIRED_CLASSIC_SCOPES.filter((s) => s === 'events.read')).toHaveLength(1)
    expect(REQUIRED_OAUTH_SCOPES.filter((s) => s === 'environment-api:events:read')).toHaveLength(1)
    expect([...REQUIRED_CLASSIC_SCOPES]).toEqual([...REQUIRED_CLASSIC_SCOPES].sort())
    expect([...REQUIRED_OAUTH_SCOPES]).toEqual([...REQUIRED_OAUTH_SCOPES].sort())
  })
})
