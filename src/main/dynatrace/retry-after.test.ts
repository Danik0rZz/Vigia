import { describe, expect, it } from 'vitest'
import { parseRetryAfter } from './retry-after'

/** Cabecera Retry-After de un 429: segundos o fecha HTTP. Devuelve milisegundos. */

const NOW = new Date('2026-10-03T10:00:00.000Z')

describe('parseRetryAfter', () => {
  it.each([
    ['0', 0],
    ['5', 5000],
    ['120', 120_000]
  ])('"%s" segundos → %d ms', (header, ms) => {
    expect(parseRetryAfter(header, NOW)).toBe(ms)
  })

  it('una fecha HTTP futura da la diferencia', () => {
    expect(parseRetryAfter('Sat, 03 Oct 2026 10:00:30 GMT', NOW)).toBe(30_000)
  })

  it('una fecha HTTP pasada da 0', () => {
    expect(parseRetryAfter('Sat, 03 Oct 2026 09:59:00 GMT', NOW)).toBe(0)
  })

  it.each([null, '', 'pronto', '-5', '1.5x'])('con %j devuelve null', (header) => {
    expect(parseRetryAfter(header, NOW)).toBeNull()
  })
})
