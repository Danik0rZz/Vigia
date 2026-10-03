import { describe, expect, it } from 'vitest'
import { createConnectionStatusStore } from './status'

/** Último resultado de "Probar conexión" por entorno, solo en memoria. */

const report = (
  checkedAt: string
): { checkedAt: string; mechanisms: never[]; oauthExpiresAt: null } => ({
  checkedAt,
  mechanisms: [],
  oauthExpiresAt: null
})

describe('createConnectionStatusStore', () => {
  it('empieza vacío, guarda, sustituye y borra por entorno', () => {
    const status = createConnectionStatusStore()
    expect(status.get('env-1')).toBeNull()

    status.set('env-1', report('2026-10-03T10:00:00.000Z'))
    status.set('env-2', report('2026-10-03T11:00:00.000Z'))
    status.set('env-1', report('2026-10-03T12:00:00.000Z'))
    expect(status.get('env-1')).toEqual(report('2026-10-03T12:00:00.000Z'))

    status.clear('env-1')
    expect(status.get('env-1')).toBeNull()
    expect(status.get('env-2')).toEqual(report('2026-10-03T11:00:00.000Z'))
    status.clear('no-existe')
  })

  it('cada store es independiente (no hay estado global)', () => {
    const a = createConnectionStatusStore()
    a.set('env-1', report('2026-10-03T10:00:00.000Z'))
    expect(createConnectionStatusStore().get('env-1')).toBeNull()
  })
})
