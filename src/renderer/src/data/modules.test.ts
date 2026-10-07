import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConnectionReport } from '@shared/dynatrace'

/**
 * Ficha 0015 (lo pidió el revisor de la 0014): `useModuleAccess('entities')`. Sin el scope
 * `entities.read` en el último «Probar conexión», la tarjeta «Información» enseña el aviso de
 * "falta el scope" con ese scope; los demás módulos no dependen de él.
 *
 * `useModuleAccess` (importado como `moduleAccess` para que la regla de hooks no lo tome por
 * uno llamado en un bucle) solo combina `useActiveEnvironment` y `useConnectionStatus`: con los dos
 * simulados se llama como una función, sin React.
 */
const state = vi.hoisted(() => ({
  active: null as unknown,
  report: null as unknown
}))

vi.mock('./tenants', () => ({
  useActiveEnvironment: () => state.active,
  useConnectionStatus: () => state.report
}))

const { useModuleAccess: moduleAccess, unavailableReason } = await import('./modules')

const ENV_ID = '0b5c2a8e-1f3d-4c6b-9a7e-2d4f6a8c0e1b'

function activeWith(classicToken: boolean): unknown {
  return {
    environment: { id: ENV_ID, secrets: { classicToken } },
    client: { id: 'c1' },
    label: 'Entorno'
  }
}

function reportMissing(missingScopes: string[]): ConnectionReport {
  return {
    checkedAt: '2026-10-08T08:00:00.000Z',
    oauthExpiresAt: null,
    mechanisms: [{ id: 'classic', state: 'connected', error: null, missingScopes, tokenInfo: null }]
  }
}

beforeEach(() => {
  state.active = activeWith(true)
  state.report = null
})

describe("useModuleAccess('entities') (0015, pedido en la revisión de la 0014)", () => {
  it('sin entities.read en la última prueba: missingScope con ese scope, y su texto lo nombra', () => {
    state.report = reportMissing(['entities.read'])
    const access = moduleAccess('entities')
    expect(access).toEqual({ available: false, reason: 'missingScope', scopes: ['entities.read'] })
    if (access.available) throw new Error('debería no estar disponible')
    expect(unavailableReason(access)).toEqual({
      key: 'module.missingScope',
      params: { scopes: 'entities.read' }
    })
  })

  it('con entities.read (o sin probar la conexión), disponible con el entorno', () => {
    state.report = reportMissing(['metrics.read'])
    expect(moduleAccess('entities')).toEqual({ available: true, envId: ENV_ID })
    state.report = null
    expect(moduleAccess('entities')).toEqual({ available: true, envId: ENV_ID })
  })

  it('sin entities.read, los demás módulos siguen disponibles', () => {
    state.report = reportMissing(['entities.read'])
    for (const module of ['home', 'problems', 'metrics'] as const) {
      expect(moduleAccess(module), module).toEqual({ available: true, envId: ENV_ID })
    }
  })

  it('sin entorno o sin token clásico, el motivo de siempre', () => {
    state.active = null
    expect(moduleAccess('entities')).toEqual({ available: false, reason: 'noEnvironment' })
    state.active = activeWith(false)
    expect(moduleAccess('entities')).toEqual({ available: false, reason: 'classicToken' })
  })
})
