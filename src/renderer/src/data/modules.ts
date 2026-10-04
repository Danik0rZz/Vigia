import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { MODULE_SCOPES } from '@shared/dynatrace'
import type { IpcOutput } from '@shared/ipc'
import type { ImpactLevel, SeverityLevel } from '@shared/modules'
import type { TimeRangeValue } from '@shared/time-range'
import { useTimeRangeValue } from '../app/time-range'
import { invoke } from '../lib/ipc'
import { createRequestQueue } from '../lib/request-queue'
import { useActiveEnvironment, useConnectionStatus } from './tenants'

/** Módulos con datos de Dynatrace; cada uno necesita los scopes de MODULE_SCOPES. */
export type DataModule = 'home' | 'problems' | 'metrics'

const REQUIRED_SCOPES: Record<DataModule, readonly string[]> = {
  home: [...MODULE_SCOPES.problems.classic, ...MODULE_SCOPES.slos.classic],
  problems: MODULE_SCOPES.problems.classic,
  metrics: MODULE_SCOPES.metrics.classic
}

export type ModuleAccess =
  | { available: true; envId: string }
  | { available: false; reason: 'noEnvironment' | 'classicToken' }
  | { available: false; reason: 'missingScope'; scopes: string[] }

/**
 * Si el módulo puede pedir datos: hace falta entorno activo y token clásico (las
 * vistas usan la API clásica). Si el último "Probar conexión" dice que faltan
 * sus scopes, el módulo se muestra desactivado; si no se ha probado, se intenta
 * y un FORBIDDEN se muestra como error.
 */
export function useModuleAccess(module: DataModule): ModuleAccess {
  const active = useActiveEnvironment()
  const report = useConnectionStatus(active?.environment.id ?? null)
  if (active === null) return { available: false, reason: 'noEnvironment' }
  if (!active.environment.secrets.classicToken) return { available: false, reason: 'classicToken' }
  const missing =
    report?.mechanisms.find((mechanism) => mechanism.id === 'classic')?.missingScopes ?? []
  const scopes = REQUIRED_SCOPES[module].filter((scope) => missing.includes(scope))
  if (scopes.length > 0) return { available: false, reason: 'missingScope', scopes }
  return { available: true, envId: active.environment.id }
}

/** Clave i18n y parámetros del motivo por el que un módulo no está disponible. */
export function unavailableReason(access: Exclude<ModuleAccess, { available: true }>): {
  key: string
  params?: Record<string, string>
} {
  if (access.reason === 'missingScope') {
    return { key: 'module.missingScope', params: { scopes: access.scopes.join(', ') } }
  }
  return { key: access.reason === 'classicToken' ? 'module.classicToken' : 'module.noEnvironment' }
}

/**
 * Sin auto-refresco: los datos se piden al entrar con una clave nueva y al pulsar
 * "Actualizar", nunca solos (cada petición gasta cuota de la API).
 */
const MANUAL = {
  staleTime: Infinity,
  refetchOnMount: false,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  retry: false
} as const

/** Clave de los datos de un módulo: [envId, módulo, parámetros, rango]. */
const moduleKey = (envId: string, module: string, params: unknown, range?: TimeRangeValue) =>
  [envId, module, params, range ?? null] as const

/**
 * "Actualizar": vuelve a pedir solo los datos que se están viendo. Las demás
 * consultas en caché (otros filtros o rangos) no se piden: gastarían cuota.
 */
export function useModuleRefresh(envId: string | null, module: string): () => void {
  const client = useQueryClient()
  return () => {
    if (envId !== null) void client.refetchQueries({ queryKey: [envId, module], type: 'active' })
  }
}

export interface ProblemFilterValues {
  status?: 'open' | 'closed' | undefined
  severity?: SeverityLevel[] | undefined
  impact?: ImpactLevel[] | undefined
  text?: string | undefined
}

export function useProblems(
  envId: string | null,
  filters: ProblemFilterValues
): UseQueryResult<IpcOutput<'problems:list'>> {
  const timeRange = useTimeRangeValue()
  return useQuery({
    queryKey: moduleKey(envId ?? '', 'problems', filters, timeRange),
    queryFn: () => invoke('problems:list', { environmentId: envId ?? '', timeRange, ...filters }),
    enabled: envId !== null,
    ...MANUAL
  })
}

export function useProblem(
  envId: string | null,
  problemId: string | null
): UseQueryResult<IpcOutput<'problems:get'>> {
  return useQuery({
    queryKey: moduleKey(envId ?? '', 'problems', { problemId }),
    queryFn: () =>
      invoke('problems:get', { environmentId: envId ?? '', problemId: problemId ?? '' }),
    enabled: envId !== null && problemId !== null,
    ...MANUAL
  })
}

/**
 * Una sola cola para los mini gráficos de las evidencias: como mucho 3
 * consultas a la vez, por muchas que haya en la página. Al salir, TanStack
 * cancela la señal y las que esperaban salen de la cola sin pedirse.
 */
const evidenceMetricQueue = createRequestQueue(3)

/** Serie de la métrica de un evento (dt.event.metric_selector), en su rango y resolución. */
export function useEvidenceMetric(
  envId: string | null,
  request: { selector: string; from: number; to: number; resolution: string },
  enabled: boolean
): UseQueryResult<IpcOutput<'metrics:query'>> {
  const { selector, from, to, resolution } = request
  return useQuery({
    queryKey: [envId ?? '', 'evidenceMetric', selector, from, to] as const,
    queryFn: ({ signal }) =>
      evidenceMetricQueue.run(
        () =>
          invoke('metrics:query', {
            environmentId: envId ?? '',
            metricSelector: selector,
            timeRange: { from: new Date(from).toISOString(), to: new Date(to).toISOString() },
            resolution
          }),
        signal
      ),
    enabled: enabled && envId !== null,
    ...MANUAL
  })
}

/** Todos los comentarios de un problema, solo cuando se piden ("Ver todos"). */
export function useProblemComments(
  envId: string | null,
  problemId: string,
  enabled: boolean
): UseQueryResult<IpcOutput<'problems:comments'>> {
  return useQuery({
    queryKey: moduleKey(envId ?? '', 'problems', { problemId, comments: 'all' }),
    queryFn: () => invoke('problems:comments', { environmentId: envId ?? '', problemId }),
    enabled: enabled && envId !== null,
    ...MANUAL
  })
}

export function useSlos(envId: string | null): UseQueryResult<IpcOutput<'slos:list'>> {
  return useQuery({
    queryKey: moduleKey(envId ?? '', 'home', 'slos'),
    queryFn: () => invoke('slos:list', { environmentId: envId ?? '' }),
    enabled: envId !== null,
    ...MANUAL
  })
}

export interface MetricQueryParams {
  metricSelector: string
  resolution: string | undefined
}

export function useMetricQuery(
  envId: string | null,
  params: MetricQueryParams | null
): UseQueryResult<IpcOutput<'metrics:query'>> {
  const timeRange = useTimeRangeValue()
  return useQuery({
    queryKey: moduleKey(envId ?? '', 'metrics', params, timeRange),
    queryFn: () =>
      invoke('metrics:query', {
        environmentId: envId ?? '',
        timeRange,
        metricSelector: params?.metricSelector ?? '',
        ...(params?.resolution === undefined ? {} : { resolution: params.resolution })
      }),
    enabled: envId !== null && params !== null,
    ...MANUAL
  })
}

export function useMetricSearch(
  envId: string | null,
  text: string
): UseQueryResult<IpcOutput<'metrics:search'>> {
  return useQuery({
    queryKey: moduleKey(envId ?? '', 'metrics', { search: text }),
    queryFn: () => invoke('metrics:search', { environmentId: envId ?? '', text }),
    enabled: envId !== null && text.trim() !== '',
    ...MANUAL
  })
}

export function useSavedQueries(
  envId: string | null
): UseQueryResult<IpcOutput<'savedQueries:list'>> {
  return useQuery({
    queryKey: ['savedQueries', envId],
    queryFn: () => invoke('savedQueries:list', { environmentId: envId ?? '' }),
    enabled: envId !== null
  })
}

export function useExportSettings(): IpcOutput<'export:getSettings'> {
  const { data } = useQuery({
    queryKey: ['exportSettings'],
    queryFn: () => invoke('export:getSettings')
  })
  return data ?? { csvSeparator: ';', captureFooter: true }
}
