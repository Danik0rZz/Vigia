import { describe, expect, it } from 'vitest'
import { redactQueryEcho } from './log-redact'

/**
 * v0.9.2: el log de main nunca lleva el selector de métrica (ni otro valor
 * largo de la query) aunque Dynatrace lo repita en su mensaje de error.
 */

const SELECTOR = 'builtin:service.response.time:filter(eq("dt.entity.service","SERVICE-1")):avg'

describe('redactQueryEcho', () => {
  it('un valor largo de la query que aparece en el mensaje → «<clave> (N caracteres)»', () => {
    const message = `Constraints violated: metricSelector ${SELECTOR} is invalid`
    const result = redactQueryEcho(message, { metricSelector: SELECTOR, resolution: '1m' })
    expect(result).not.toContain(SELECTOR)
    expect(result).not.toContain('SERVICE-1')
    expect(result).toBe(
      `Constraints violated: metricSelector metricSelector (${SELECTOR.length} caracteres) is invalid`
    )
  })

  it('todas las apariciones, no solo la primera', () => {
    const result = redactQueryEcho(`${SELECTOR} y otra vez ${SELECTOR}`, {
      metricSelector: SELECTOR
    })
    expect(result).not.toContain(SELECTOR)
    expect(result.match(/metricSelector \(\d+ caracteres\)/g)).toHaveLength(2)
  })

  it('también la versión sin espacios a los lados (Dynatrace a veces la devuelve así)', () => {
    const padded = `  ${SELECTOR}  `
    const result = redactQueryEcho(`Selector ${SELECTOR} no válido`, { metricSelector: padded })
    expect(result).toBe(`Selector metricSelector (${SELECTOR.length} caracteres) no válido`)
  })

  it('caracteres especiales de regex en el valor no rompen nada', () => {
    const tricky = 'builtin:x:filter(and(eq(a,"[.*+?^${}()|\\]")))'
    expect(redactQueryEcho(`mal: ${tricky}`, { metricSelector: tricky })).toBe(
      `mal: metricSelector (${tricky.length} caracteres)`
    )
  })

  it('16 caracteres o más se tapan; 15 o menos (o lo que no es texto) se dejan', () => {
    const sixteen = 'abcdefghijklmnop'
    const fifteen = 'abcdefghijklmno'
    expect(redactQueryEcho(`x ${sixteen}`, { q: sixteen })).toBe('x q (16 caracteres)')
    expect(redactQueryEcho(`x ${fifteen}`, { q: fifteen })).toBe(`x ${fifteen}`)
    expect(redactQueryEcho('pageSize 500', { pageSize: 500 })).toBe('pageSize 500')
    expect(redactQueryEcho('now-2h', { from: 'now-2h' })).toBe('now-2h')
  })

  it('sin query, o sin eco en el mensaje: el mensaje igual', () => {
    expect(redactQueryEcho('Error 400', undefined)).toBe('Error 400')
    expect(redactQueryEcho('Error 400', { metricSelector: SELECTOR })).toBe('Error 400')
    expect(redactQueryEcho('', { metricSelector: SELECTOR })).toBe('')
  })

  it('varias claves largas a la vez: cada una con su nombre', () => {
    const text = 'un texto de búsqueda bastante largo'
    const result = redactQueryEcho(`${SELECTOR} | ${text}`, { metricSelector: SELECTOR, text })
    expect(result).toBe(
      `metricSelector (${SELECTOR.length} caracteres) | text (${text.length} caracteres)`
    )
  })
})
