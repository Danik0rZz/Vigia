import {
  QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult
} from '@tanstack/react-query'
import type { IpcArgs, IpcChannel, IpcOutput } from '@shared/ipc'
import type { Client, EnvironmentView } from '@shared/tenants'
import { invoke } from '../lib/ipc'

/**
 * Datos de main vía IPC con TanStack Query. Las claves de clientes y entornos
 * son globales; las de datos de un entorno (Fase 4 en adelante) incluyen su `envId`.
 */
export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } }
})

export const queryKeys = {
  tenants: ['tenants'] as const,
  activeEnvironment: ['activeEnvironment'] as const,
  secretsAvailability: ['secretsAvailability'] as const
}

export function useTenants(): { clients: Client[]; environments: EnvironmentView[] } {
  const { data } = useQuery({ queryKey: queryKeys.tenants, queryFn: () => invoke('tenants:list') })
  return data ?? { clients: [], environments: [] }
}

export interface ActiveEnvironment {
  environment: EnvironmentView
  client: Client
}

/** Entorno activo con su cliente, o `null` si no hay ninguno. */
export function useActiveEnvironment(): ActiveEnvironment | null {
  const { clients, environments } = useTenants()
  const { data } = useQuery({
    queryKey: queryKeys.activeEnvironment,
    queryFn: () => invoke('environments:getActive')
  })
  const environment = environments.find((env) => env.id === data?.environmentId)
  const client = clients.find((candidate) => candidate.id === environment?.clientId)
  return environment !== undefined && client !== undefined ? { environment, client } : null
}

/** Se consulta cada vez que se monta quien lo usa: el cifrado puede dejar de estar disponible. */
export function useSecretsAvailable(): boolean {
  const { data } = useQuery({
    queryKey: queryKeys.secretsAvailability,
    queryFn: () => invoke('secrets:availability'),
    refetchOnMount: 'always'
  })
  return data?.available ?? true
}

/**
 * Mutación sobre un canal que cambia clientes, entornos o secretos: al terminar
 * se recargan la lista y el entorno activo.
 */
export function useTenantMutation<C extends IpcChannel>(
  channel: C
): UseMutationResult<IpcOutput<C>, Error, IpcArgs<C>> {
  const client = useQueryClient()
  return useMutation<IpcOutput<C>, Error, IpcArgs<C>>({
    mutationFn: (args) => invoke(channel, ...args),
    onSettled: async () => {
      await client.invalidateQueries({ queryKey: queryKeys.tenants })
      await client.invalidateQueries({ queryKey: queryKeys.activeEnvironment })
    }
  })
}

/** "Cliente › Entorno", el nombre con que se elige un entorno. */
export function environmentLabel(client: Client, environment: EnvironmentView): string {
  return `${client.name} › ${environment.name}`
}
