import { describe, expect, it } from 'vitest'
import { maskSecrets } from './mask'

/** Enmascarado de tokens en cualquier texto que pueda acabar en un log, un error o la interfaz. */

// Formato real de Dynatrace: dt0<tipo><versión>.<id público de 24>.<secreto de 64>. Valores inventados.
const PUBLIC_ID = 'PUBLICAPRUEBA0000000000A'
const SECRET_PART = 'SECRETOPRUEBA'.padEnd(64, 'X')
const CLASSIC = `dt0c01.${PUBLIC_ID}.${SECRET_PART}`

describe('maskSecrets', () => {
  it('conserva el id público de un token dt0c01 y oculta el secreto', () => {
    expect(maskSecrets(CLASSIC)).toBe(`dt0c01.${PUBLIC_ID}.***`)
  })

  it.each(['dt0s01', 'dt0s02', 'dt0s16'])('hace lo mismo con %s', (prefix) => {
    expect(maskSecrets(`${prefix}.${PUBLIC_ID}.${SECRET_PART}`)).toBe(`${prefix}.${PUBLIC_ID}.***`)
  })

  it.each([
    ['Bearer', 'Bearer eyJhbGciOiJSUzI1NiJ9.cargautil.firma', 'Bearer ***'],
    ['bearer en minúsculas', 'bearer abc.def', 'bearer ***'],
    ['Api-Token', `Api-Token ${CLASSIC}`, 'Api-Token ***'],
    ['api-token en minúsculas', 'api-token loquesea', 'api-token ***']
  ])('enmascara %s', (_case, input, expected) => {
    expect(maskSecrets(input)).toBe(expected)
  })

  it('enmascara dentro de una frase y en JSON, sin tocar lo de alrededor', () => {
    expect(maskSecrets(`Token ${CLASSIC} rechazado.`)).toBe(
      `Token dt0c01.${PUBLIC_ID}.*** rechazado.`
    )
    expect(maskSecrets(`{"Authorization":"Bearer abc123","x":1}`)).toBe(
      '{"Authorization":"Bearer ***","x":1}'
    )
    expect(maskSecrets(`{"token":"${CLASSIC}"}`)).toBe(`{"token":"dt0c01.${PUBLIC_ID}.***"}`)
  })

  it('enmascara todas las apariciones', () => {
    const masked = maskSecrets(
      `${CLASSIC} y Bearer uno y Api-Token dos y dt0s02.${PUBLIC_ID}.${SECRET_PART}`
    )
    expect(masked).not.toContain('SECRETOPRUEBA')
    expect(masked).not.toContain('uno')
    expect(masked).not.toContain('dos')
    expect(masked.match(/\*\*\*/g)).toHaveLength(4)
  })

  it('deja igual un texto sin tokens', () => {
    const text = 'El entorno respondió 404: Not Found. Scope requerido: problems.read'
    expect(maskSecrets(text)).toBe(text)
    expect(maskSecrets('')).toBe('')
  })

  it('deja igual un id público sin parte secreta', () => {
    expect(maskSecrets(`dt0c01.${PUBLIC_ID}`)).toBe(`dt0c01.${PUBLIC_ID}`)
  })
})
