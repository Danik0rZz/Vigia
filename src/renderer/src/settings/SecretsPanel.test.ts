import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { EnvironmentView } from '@shared/tenants'

/**
 * Ficha 0064 (C-09), segunda mitad de CA4: la fila de cada secreto pide su mutación
 * `secrets:set` con `gcTime: 0`, para que el valor no se quede en la caché de mutaciones
 * tras `reset()` (la otra mitad, en `data/tenants-mutation-cache.test.ts`). Se pinta el panel
 * en servidor con `useTenantMutation` simulado y se mira con qué opciones se llamó.
 */
const useTenantMutation = vi.fn<(channel: string, options?: { gcTime?: number }) => unknown>(
  () => ({ isPending: false, mutate: vi.fn(), mutateAsync: vi.fn(), reset: vi.fn() })
)

vi.mock('../data/tenants', () => ({
  useSecretsAvailable: () => true,
  useTenantMutation: (channel: string, options?: { gcTime?: number }) =>
    useTenantMutation(channel, options)
}))

const { SecretsPanel } = await import('./SecretsPanel')

const environment = {
  id: '0b5c2a8e-1f3d-4c6b-9a7e-2d4f6a8c0e1b',
  deployment: 'saas',
  secrets: { classicToken: false, oauthClientSecret: false, platformToken: false },
  unreadableSecrets: []
} as unknown as EnvironmentView

describe('CA4 (0064): la fila del secreto pide secrets:set con gcTime 0', () => {
  it('cada fila (clásico, OAuth y plataforma) pasa gcTime 0 a su mutación de guardado', () => {
    renderToStaticMarkup(createElement(SecretsPanel, { environment }))
    const saves = useTenantMutation.mock.calls.filter(([channel]) => channel === 'secrets:set')
    // Una por tipo de secreto en SaaS.
    expect(saves).toHaveLength(3)
    for (const [, options] of saves) expect(options).toMatchObject({ gcTime: 0 })
  })
})
