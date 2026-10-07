import { describe, expect, it } from 'vitest'
import { MODULE_SCOPES, REQUIRED_CLASSIC_SCOPES, REQUIRED_OAUTH_SCOPES } from './dynatrace'

/** Scopes que necesita cada módulo, por mecanismo. */

describe('MODULE_SCOPES', () => {
  it('tiene los scopes acordados para problems, metrics, slos y entities', () => {
    expect(MODULE_SCOPES).toEqual({
      problems: { classic: ['problems.read'], oauth: ['environment-api:problems:read'] },
      metrics: { classic: ['metrics.read'], oauth: ['environment-api:metrics:read'] },
      slos: { classic: ['slo.read'], oauth: ['environment-api:slo:read'] },
      entities: { classic: ['entities.read'], oauth: ['environment-api:entities:read'] }
    })
  })

  it('REQUIRED_CLASSIC_SCOPES es la unión ordenada y sin repetidos de los classic', () => {
    const union = [...new Set(Object.values(MODULE_SCOPES).flatMap((m) => m.classic))].sort()
    expect(REQUIRED_CLASSIC_SCOPES).toEqual(union)
    expect(REQUIRED_CLASSIC_SCOPES).toEqual([
      'entities.read',
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
      'environment-api:metrics:read',
      'environment-api:problems:read',
      'environment-api:slo:read'
    ])
  })
})
