import { describe, expect, it } from 'vitest'
import { DtError } from './errors'

/**
 * Errores del cliente de Dynatrace: el mensaje siempre sale enmascarado y
 * truncado, porque puede acabar en el log o en la interfaz.
 */

const PUBLIC_ID = 'PUBLICAPRUEBA0000000000A'
const SECRET_PART = 'SECRETOPRUEBA'.padEnd(64, 'X')
const TOKEN = `dt0c01.${PUBLIC_ID}.${SECRET_PART}`

describe('DtError', () => {
  it('es un Error con código y estado HTTP opcional', () => {
    const error = new DtError('NOT_FOUND', 'No existe', 404)
    expect(error).toBeInstanceOf(Error)
    expect(error.code).toBe('NOT_FOUND')
    expect(error.status).toBe(404)
    expect(error.message).toBe('No existe')
    expect(new DtError('NETWORK', 'Sin red').status).toBeUndefined()
  })

  it('enmascara los tokens del mensaje', () => {
    const error = new DtError(
      'UNAUTHORIZED',
      `Token ${TOKEN} no válido; Authorization: Bearer abc.def`
    )
    expect(error.message).not.toContain('SECRETOPRUEBA')
    expect(error.message).not.toContain('abc.def')
    expect(error.message).toContain(`dt0c01.${PUBLIC_ID}.***`)
  })

  it('trunca el mensaje a 300 caracteres', () => {
    expect(new DtError('SERVER_ERROR', 'x'.repeat(1000)).message.length).toBeLessThanOrEqual(300)
  })

  it('enmascara antes de truncar: un token cortado en el carácter 300 no deja ver el secreto', () => {
    // El token empieza de forma que el corte a 300 cae dentro de su parte secreta.
    const prefix = 'y'.repeat(300 - `dt0c01.${PUBLIC_ID}.SECRE`.length)
    const error = new DtError('UNAUTHORIZED', `${prefix}${TOKEN} resto`)
    expect(error.message.length).toBeLessThanOrEqual(300)
    expect(error.message).not.toContain('SECRE')
  })

  it('el JSON del error tampoco lleva el token', () => {
    const error = new DtError('FORBIDDEN', `Api-Token ${TOKEN}`, 403)
    const json = JSON.stringify({ ...error, message: error.message })
    expect(json).not.toContain('SECRETOPRUEBA')
  })
})
