import { describe, expect, it } from 'vitest'
import { changedEnvironment } from './tenants'

/**
 * AUD-10: tras una mutación de tenants, qué datos de módulo dejan de valer.
 * Un id → se quitan las consultas de ese entorno; 'all' → las de todos; null → ninguna.
 */

const ENV = '0b5c2a8e-1f3d-4c6b-9a7e-2d4f6a8c0e1b'

describe('changedEnvironment', () => {
  it.each(['environments:update', 'environments:delete'] as const)('%s → input.id', (channel) => {
    expect(changedEnvironment(channel, { id: ENV, name: 'x' })).toBe(ENV)
  })

  it.each(['secrets:set', 'secrets:delete'] as const)('%s → input.environmentId', (channel) => {
    expect(changedEnvironment(channel, { environmentId: ENV, kind: 'classicToken' })).toBe(ENV)
  })

  it.each(['clients:delete', 'config:import'] as const)('%s → all', (channel) => {
    expect(changedEnvironment(channel, { id: ENV })).toBe('all')
    expect(changedEnvironment(channel, undefined)).toBe('all')
  })

  it.each([
    'clients:create',
    'clients:update',
    'environments:create',
    'environments:setActive'
  ] as const)('%s → null', (channel) => {
    expect(changedEnvironment(channel, { id: ENV, environmentId: ENV })).toBeNull()
  })

  it('sin el campo esperado, o con otro tipo, → null (no se borra nada a ciegas)', () => {
    expect(changedEnvironment('environments:update', { environmentId: ENV })).toBeNull()
    expect(changedEnvironment('secrets:set', { id: ENV })).toBeNull()
    expect(changedEnvironment('environments:delete', { id: 42 })).toBeNull()
    expect(changedEnvironment('secrets:delete', undefined)).toBeNull()
  })
})
