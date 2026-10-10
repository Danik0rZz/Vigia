import { MutationObserver, QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Ficha 0064 (C-09): el token guardado con `secrets:set` no se queda en la caché de mutaciones
 * de TanStack Query. `reset()` solo suelta el observador: la mutación sigue en la caché (con sus
 * variables, el valor del secreto) hasta que pasa su `gcTime`. `useTenantMutation` acepta
 * `gcTime` (segundo argumento, `{ gcTime }`) y la fila del secreto pasa `0`.
 *
 * Sin React: `useMutation` se sustituye por un `MutationObserver` real sobre un `QueryClient`
 * real, que es lo que hace el hook por dentro; `invoke` está simulado.
 */
const state = vi.hoisted(() => ({ client: null as unknown as QueryClient }))

const invoke = vi.fn()
vi.mock('../lib/ipc', () => ({
  invoke: (...args: unknown[]) => invoke(...args),
  IpcError: class IpcError extends Error {}
}))

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...actual,
    useQueryClient: () => state.client,
    useMutation: (options: ConstructorParameters<typeof actual.MutationObserver>[1]) =>
      new actual.MutationObserver(state.client, options)
  }
})

const { useTenantMutation } = await import('./tenants')

const ENV = '0b5c2a8e-1f3d-4c6b-9a7e-2d4f6a8c0e1b'
const VALUE = 'dt0c01.FALSO0064.CACHEMUTACIONES'

type SecretSet = (channel: 'secrets:set', options?: { gcTime?: number }) => unknown

/** Deja correr los temporizadores de la recogida (gcTime 0 → setTimeout 0). */
const settle = async (): Promise<void> => {
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 10))
}

/** Mutaciones de la caché que llevan el valor del secreto en sus variables. */
const withValue = (): unknown[] =>
  state.client
    .getMutationCache()
    .getAll()
    .filter((mutation) => JSON.stringify(mutation.state.variables ?? null).includes(VALUE))

beforeEach(() => {
  state.client = new QueryClient()
  invoke.mockReset()
  invoke.mockResolvedValue({ ok: true })
})

afterEach(() => {
  state.client.clear()
})

describe('CA4 (0064): tras guardar un secreto y reset(), la caché de mutaciones no lo guarda', () => {
  it('con gcTime 0: guardado y reset(), ninguna mutación de la caché contiene el valor', async () => {
    const save = (useTenantMutation as unknown as SecretSet)('secrets:set', {
      gcTime: 0
    }) as MutationObserver<unknown, Error, unknown>
    await save.mutate([{ environmentId: ENV, kind: 'platformToken', value: VALUE }])
    expect(invoke).toHaveBeenCalledWith('secrets:set', {
      environmentId: ENV,
      kind: 'platformToken',
      value: VALUE
    })
    save.reset()
    await settle()
    expect(withValue()).toEqual([])
  })

  it('también si el guardado falla: tras reset(), nada con el valor', async () => {
    invoke.mockRejectedValue(new Error('fallo de prueba'))
    const save = (useTenantMutation as unknown as SecretSet)('secrets:set', {
      gcTime: 0
    }) as MutationObserver<unknown, Error, unknown>
    await expect(
      save.mutate([{ environmentId: ENV, kind: 'classicToken', value: VALUE }])
    ).rejects.toThrow()
    save.reset()
    await settle()
    expect(withValue()).toEqual([])
  })
})
