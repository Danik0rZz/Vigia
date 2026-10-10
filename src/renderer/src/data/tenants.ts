import {
  QueryCache,
  QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult
} from '@tanstack/react-query'
import type { ConnectionReport } from '@shared/dynatrace'
import type { IpcArgs, IpcChannel, IpcOutput } from '@shared/ipc'
import type { Client, EnvironmentView } from '@shared/tenants'
import { useTranslation } from 'react-i18next'
import { invoke, IpcError } from '../lib/ipc'
import { compareEnvironments, environmentLabel } from './environment-label'

/**
 * Datos de main vía IPC con TanStack Query. Las claves de clientes y entornos
 * son globales; las de datos de un entorno (Fase 4 en adelante) incluyen su `envId`.
 */
export const queryClient: QueryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  // Una credencial que no se puede descifrar queda marcada en main: se vuelve a
  // pedir la lista de entornos para que Ajustes diga "Hay que volver a introducirla".
  queryCache: new QueryCache({
    onError: (error) => {
      if (error instanceof IpcError && error.code === 'SECRET_UNREADABLE') {
        void queryClient.invalidateQueries({ queryKey: queryKeys.tenants })
      }
    }
  })
})

export const queryKeys = {
  tenants: ['tenants'] as const,
  activeEnvironment: ['activeEnvironment'] as const,
  secretsAvailability: ['secretsAvailability'] as const,
  /** Datos de un entorno: la clave lleva su `envId`. */
  connectionStatus: (envId: string) => ['connectionStatus', envId] as const,
  certificatePins: (envId: string) => ['certificatePins', envId] as const
}

/** Último resultado de "Probar conexión" del entorno (`null` si no se ha probado o ha cambiado algo). */
export function useConnectionStatus(envId: string | null): ConnectionReport | null {
  const { data } = useQuery({
    queryKey: queryKeys.connectionStatus(envId ?? 'none'),
    queryFn: () => invoke('connection:status', { environmentId: envId ?? '' }),
    enabled: envId !== null
  })
  return envId === null ? null : (data ?? null)
}

/**
 * Si ya se sabe el resultado de la última prueba de conexión (lo haya o no). Mientras
 * `connection:status` no responde, `useModuleAccess` no sabe qué scopes faltan y da el módulo
 * por disponible: un canal que no debe pedirse sin su scope espera a esto (ficha 0015).
 */
export function useConnectionStatusKnown(envId: string | null): boolean {
  const { isPending } = useQuery({
    queryKey: queryKeys.connectionStatus(envId ?? 'none'),
    queryFn: () => invoke('connection:status', { environmentId: envId ?? '' }),
    enabled: envId !== null
  })
  return envId !== null && !isPending
}

export function useTenants(): { clients: Client[]; environments: EnvironmentView[] } {
  const { data } = useQuery({ queryKey: queryKeys.tenants, queryFn: () => invoke('tenants:list') })
  return data ?? { clients: [], environments: [] }
}

export interface ActiveEnvironment {
  environment: EnvironmentView
  client: Client
  /** Etiqueta del entorno (tipo, o nombre si hace falta); ver environmentLabel. */
  label: string
}

/** Etiqueta de un entorno entre los de su cliente, con los tipos traducidos. */
function useLabeller(environments: EnvironmentView[]): (environment: EnvironmentView) => string {
  const { t } = useTranslation()
  return (environment) =>
    environmentLabel(
      environment,
      environments.filter((other) => other.clientId === environment.clientId),
      (type) => t(`environmentTypes.${type}`)
    )
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
  const label = useLabeller(environments)
  return environment !== undefined && client !== undefined
    ? { environment, client, label: label(environment) }
    : null
}

export interface EnvironmentOption {
  environment: EnvironmentView
  client: Client
  label: string
  /** "Cliente › etiqueta": el nombre con que se elige un entorno. */
  full: string
}

/**
 * Entornos para el selector y Ctrl+K: agrupados por cliente (por nombre) y, en
 * cada cliente, en el orden fijo de tipos (Producción, Preproducción,
 * Integración, Desarrollo, Otro).
 */
export function useEnvironmentOptions(): { client: Client; options: EnvironmentOption[] }[] {
  const { clients, environments } = useTenants()
  const label = useLabeller(environments)
  return clients.map((client) => ({
    client,
    options: environments
      .filter((environment) => environment.clientId === client.id)
      .sort(compareEnvironments)
      .map((environment) => ({
        environment,
        client,
        label: label(environment),
        full: environmentPath(client, label(environment))
      }))
  }))
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Las claves de datos de un entorno empiezan por su id (ver moduleKey). */
function isEnvironmentKey(first: unknown): boolean {
  return typeof first === 'string' && UUID.test(first)
}

/**
 * Entorno cuyos datos de módulo dejan de valer tras la mutación: su id, 'all'
 * si pueden ser varios (borrar un cliente, importar) o null si ninguno.
 */
export function changedEnvironment(channel: IpcChannel, input: unknown): string | 'all' | null {
  const value = (input ?? {}) as { id?: unknown; environmentId?: unknown }
  switch (channel) {
    case 'environments:update':
    case 'environments:delete':
      return typeof value.id === 'string' ? value.id : null
    case 'secrets:set':
    case 'secrets:delete':
      return typeof value.environmentId === 'string' ? value.environmentId : null
    case 'clients:delete':
    case 'config:import':
      return 'all'
    default:
      return null
  }
}

/**
 * Mutación sobre un canal que cambia clientes, entornos o secretos: al terminar
 * se recargan la lista y el entorno activo. `gcTime`: cuánto se queda la mutación (con sus
 * variables) en la caché de mutaciones tras soltarla; la de un secreto pasa 0 para que su valor
 * no se quede ahí tras `reset()` (ficha 0064).
 */
export function useTenantMutation<C extends IpcChannel>(
  channel: C,
  options: { gcTime?: number } = {}
): UseMutationResult<IpcOutput<C>, Error, IpcArgs<C>> {
  const client = useQueryClient()
  return useMutation<IpcOutput<C>, Error, IpcArgs<C>>({
    ...(options.gcTime === undefined ? {} : { gcTime: options.gcTime }),
    mutationFn: (args) => invoke(channel, ...args),
    onSuccess: (_data, args) => {
      // Datos de módulo en caché de un entorno que ha cambiado (otra URL u otro
      // token pueden apuntar a otro tenant): se quitan para no mostrarlos ni
      // exportarlos. Las consultas de módulo empiezan por el envId.
      const target = changedEnvironment(channel, args[0])
      if (target === 'all') {
        client.removeQueries({ predicate: (query) => isEnvironmentKey(query.queryKey[0]) })
      } else if (target !== null) {
        client.removeQueries({ queryKey: [target] })
      }
    },
    onSettled: async () => {
      // Cambiar un entorno, sus secretos o sus certificados deja sin valor su estado de conexión.
      await Promise.all(
        ['tenants', 'activeEnvironment', 'connectionStatus', 'certificatePins'].map((key) =>
          client.invalidateQueries({ queryKey: [key] })
        )
      )
    }
  })
}

/** "Cliente › etiqueta del entorno". */
export function environmentPath(client: Client, label: string): string {
  return `${client.name} › ${label}`
}
