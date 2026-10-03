import { describe, expect, it } from 'vitest'
import { environmentFormSchema, NEW_ENVIRONMENT, normalizedClassicUrl } from './forms'

/**
 * AUD-06: una URL con "?" tiene su propio error en el formulario
 * (errors.urlQuery), distinto del de URL no válida (errors.httpsUrl). Sin DOM.
 */

const valid = {
  ...NEW_ENVIRONMENT,
  name: 'Producción',
  classicApiUrl: 'https://abc12345.live.dynatrace.com'
}

function issuesFor(field: 'classicApiUrl' | 'platformUrl' | 'ssoUrl', value: string): string[] {
  const result = environmentFormSchema.safeParse({ ...valid, [field]: value })
  if (result.success) return []
  return result.error.issues
    .filter((issue) => issue.path[0] === field)
    .map((issue) => issue.message)
}

describe('environmentFormSchema: URLs', () => {
  it('un formulario válido pasa, y las URLs vacías son opcionales', () => {
    expect(environmentFormSchema.safeParse(valid).success).toBe(true)
    expect(issuesFor('platformUrl', '')).toEqual([])
    expect(issuesFor('ssoUrl', '   ')).toEqual([])
  })

  it.each(['classicApiUrl', 'platformUrl', 'ssoUrl'] as const)(
    '%s con "?" → errors.urlQuery',
    (field) => {
      for (const value of [
        'https://abc12345.live.dynatrace.com?x=1',
        'https://abc12345.live.dynatrace.com/?',
        `https://abc12345.live.dynatrace.com/api/v2?Api-Token=dt0c01.FALSO.${'Q'.repeat(20)}`,
        'https://abc12345.live.dynatrace.com/api/v2?x=1'
      ]) {
        expect(issuesFor(field, value), `${field} ${value.slice(0, 50)}`).toEqual([
          'errors.urlQuery'
        ])
      }
    }
  )

  it.each(['classicApiUrl', 'platformUrl', 'ssoUrl'] as const)(
    '%s inválida sin "?" → errors.httpsUrl',
    (field) => {
      for (const value of [
        'http://abc12345.live.dynatrace.com',
        'no es una url',
        'https://u:p@abc12345.live.dynatrace.com'
      ]) {
        expect(issuesFor(field, value), `${field} ${value}`).toEqual(['errors.httpsUrl'])
      }
    }
  )

  it('normalizedClassicUrl quita /api/v2 de una URL válida y deja tal cual una con "?"', () => {
    expect(normalizedClassicUrl('https://abc12345.live.dynatrace.com/api/v2')).toBe(
      'https://abc12345.live.dynatrace.com'
    )
    expect(normalizedClassicUrl('https://abc12345.live.dynatrace.com/api/v2?x=1')).toBe(
      'https://abc12345.live.dynatrace.com/api/v2?x=1'
    )
  })
})
