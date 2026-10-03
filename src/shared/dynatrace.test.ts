import { describe, expect, it } from 'vitest'
import { MODULE_SCOPES, REQUIRED_CLASSIC_SCOPES } from './dynatrace'

/** Scopes que necesita cada módulo, por mecanismo. */

describe('MODULE_SCOPES', () => {
  it('tiene los scopes acordados para problems, metrics y slos', () => {
    expect(MODULE_SCOPES).toEqual({
      problems: { classic: ['problems.read'], oauth: ['environment-api:problems:read'] },
      metrics: { classic: ['metrics.read'], oauth: ['environment-api:metrics:read'] },
      slos: { classic: ['slo.read'], oauth: ['environment-api:slo:read'] }
    })
  })

  it('REQUIRED_CLASSIC_SCOPES es la unión ordenada y sin repetidos de los classic', () => {
    const union = [...new Set(Object.values(MODULE_SCOPES).flatMap((m) => m.classic))].sort()
    expect(REQUIRED_CLASSIC_SCOPES).toEqual(union)
    expect(REQUIRED_CLASSIC_SCOPES).toEqual(['metrics.read', 'problems.read', 'slo.read'])
  })
})
