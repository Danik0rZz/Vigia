import { describe, expect, it } from 'vitest'
import type { LogMessage } from 'electron-log'
import { maskLogMessage } from './log-mask'

/**
 * Ficha 0060 (S-03): filtro final del log. `maskLogMessage` recibe el mensaje
 * de electron-log (el que llega a `log.hooks`) y enmascara los textos de
 * `data`: cadenas, `Error` (mensaje y pila, en una copia) y los valores de
 * texto de los objetos planos. Tokens inventados.
 */

const PUBLIC_ID = 'PUBLICAPRUEBA0000000000A'
const SECRET_PART = 'SECRETOCLASICO'.padEnd(64, 'X')
const TOKEN = `dt0c01.${PUBLIC_ID}.${SECRET_PART}`
const DATE = new Date('2026-10-10T08:00:00.000Z')

function message(...data: unknown[]): LogMessage {
  return { data, date: DATE, level: 'error' }
}

function masked(...data: unknown[]): unknown[] {
  const result = maskLogMessage(message(...data))
  expect(result).not.toBe(false)
  return (result as LogMessage).data
}

describe('CA3 (0060): maskLogMessage enmascara los secretos del mensaje', () => {
  it('un Error: enmascara el Api-Token del mensaje y de la pila', () => {
    const error = new Error(`fallo de la librería con Api-Token ${TOKEN}`)
    const [out] = masked(error)
    expect(out).toBeInstanceOf(Error)
    const copy = out as Error
    expect(copy.message).not.toContain(SECRET_PART)
    expect(copy.message).toContain('Api-Token ***')
    expect(copy.stack ?? '').not.toContain(SECRET_PART)
    expect(copy.stack ?? '').not.toBe('')
  })

  it('un Error con el secreto solo en la pila también se enmascara', () => {
    const error = new Error('fallo sin datos')
    error.stack = `Error: fallo sin datos\n    at llamar (Bearer ${SECRET_PART})`
    const copy = masked(error)[0] as Error
    expect(copy.stack).not.toContain(SECRET_PART)
    expect(copy.stack).toContain('Bearer ***')
  })

  it('un Error: conserva name y cause, y no modifica el original', () => {
    const cause = new Error('causa')
    const error = new Error(`token ${TOKEN}`, { cause })
    error.name = 'FetchError'
    const originalMessage = error.message
    const copy = masked(error)[0] as Error
    expect(copy.name).toBe('FetchError')
    expect(copy.cause).toBe(cause)
    expect(error.message).toBe(originalMessage)
  })

  it('una cadena: conserva la parte pública de dt0c01.<pública>.<secreta>', () => {
    const [out] = masked(`token caducado: ${TOKEN} (renovar)`)
    expect(out).toBe(`token caducado: dt0c01.${PUBLIC_ID}.*** (renovar)`)
  })

  it('un objeto plano: enmascara sus valores de texto y deja el resto igual', () => {
    const [out] = masked({
      header: `Bearer ${SECRET_PART}`,
      token: TOKEN,
      status: 401,
      retried: true,
      missing: null
    })
    expect(out).toEqual({
      header: 'Bearer ***',
      token: `dt0c01.${PUBLIC_ID}.***`,
      status: 401,
      retried: true,
      missing: null
    })
  })

  it('los valores que no son texto no cambian', () => {
    const when = new Date('2026-10-10T09:30:00.000Z')
    const out = masked(42, true, null, undefined, when)
    expect(out).toEqual([42, true, null, undefined, when])
    expect(out[4]).toBe(when)
  })

  it('conserva el resto del mensaje (nivel y fecha) y varios argumentos', () => {
    const result = maskLogMessage(message('primero', `Api-Token ${TOKEN}`)) as LogMessage
    expect(result.level).toBe('error')
    expect(result.date).toEqual(DATE)
    expect(result.data).toEqual(['primero', 'Api-Token ***'])
  })
})
