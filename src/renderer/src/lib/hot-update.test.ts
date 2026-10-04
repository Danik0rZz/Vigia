import { describe, expect, it } from 'vitest'
import { isRecentHotUpdate, lastHotUpdate } from './hot-update'

/**
 * v0.10.1: en desarrollo, un error justo después de una recarga en caliente de
 * Vite (código a medias) se explica con su propio texto y sin recarga
 * automática. Ventana de 10 s.
 */

const NOW = 1_800_000_000_000

describe('isRecentHotUpdate', () => {
  it.each([
    ['sin actualización', null, false],
    ['en el mismo instante', NOW, true],
    ['hace 9 999 ms', NOW - 9_999, true],
    ['hace 10 000 ms (justo fuera)', NOW - 10_000, false],
    ['hace un minuto', NOW - 60_000, false],
    ['en el futuro (negativo)', NOW + 1, false]
  ] as const)('%s → %s', (_label, last, expected) => {
    expect(isRecentHotUpdate(last, NOW)).toBe(expected)
  })
})

describe('lastHotUpdate', () => {
  it('sin HMR (Vitest, como el build) no hay ninguna: null', () => {
    expect(lastHotUpdate()).toBeNull()
  })
})
