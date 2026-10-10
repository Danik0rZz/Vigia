import { useQueries, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { MODULE_SCOPES } from '@shared/dynatrace'
import type { IpcOutput } from '@shared/ipc'
import type { ImpactLevel, SeverityLevel } from '@shared/modules'
import type { TimeRangeValue } from '@shared/time-range'
import { useTimeRangeValue } from '../app/time-range'
import { invoke } from '../lib/ipc'
import { createRequestQueue } from '../lib/request-queue'
import { combineQueries, type QueryListState } from './query-list'
import { useActiveEnvironment, useConnectionStatus } from './tenants'

export type { QueryListState } from './query-list'

/** Módulos con datos de Dynatrace; cada uno necesita los scopes de MODULE_SCOPES. */
export type DataModule = 'home' | 'problems' | 'metrics' | 'entities' | 'events'

const REQUIRED_SCOPES: Record<DataModule, readonly string[]> = {
  home: [...MODULE_SCOPES.problems.classic, ...MODULE_SCOPES.slos.classic],
  problems: MODULE_SCOPES.problems.classic,
  metrics: MODULE_SCOPES.metrics.classic,
  /** Datos de una entidad (ficha 0014): solo lo pide su sección; no cambia los demás módulos. */
  entities: MODULE_SCOPES.entities.classic,
  /**
   * Eventos del host (ficha 0042): el canal lee también las relaciones del host
   * (`GET /entities/{id}`), así que pide entities.read además de events.read.
   */
  events: [...MODULE_SCOPES.entities.classic, ...MODULE_SCOPES.events.classic]
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

/** Los motivos de no disponible, sin repetir el mismo texto (por ejemplo, sin entorno). */
export function uniqueUnavailable(
  accesses: ModuleAccess[],
  t: (key: string, params?: Record<string, string>) => string
): Exclude<ModuleAccess, { available: true }>[] {
  const seen = new Set<string>()
  const result: Exclude<ModuleAccess, { available: true }>[] = []
  for (const access of accesses) {
    if (access.available) continue
    const reason = unavailableReason(access)
    const text = t(reason.key, reason.params)
    if (seen.has(text)) continue
    seen.add(text)
    result.push(access)
  }
  return result
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

/**
 * Métricas de un SERVICE en el rango global (ficha 0008). Con `entityId` null
 * (id que no es de un servicio) no se pide nada.
 */
export function useServiceMetrics(
  envId: string | null,
  entityId: string | null
): UseQueryResult<IpcOutput<'entities:serviceMetrics'>> {
  const timeRange = useTimeRangeValue()
  return useQuery({
    queryKey: moduleKey(envId ?? '', 'entities', { serviceMetrics: entityId }, timeRange),
    queryFn: () =>
      invoke('entities:serviceMetrics', {
        environmentId: envId ?? '',
        entityId: entityId ?? '',
        timeRange
      }),
    enabled: envId !== null && entityId !== null,
    ...MANUAL
  })
}

/**
 * Métricas de un HOST en el rango global (canal de la ficha 0016; marcadores y gráficos de la
 * 0018, una sola llamada). Con `entityId` null (id que no es de un host) no se pide nada.
 */
export function useHostMetrics(
  envId: string | null,
  entityId: string | null
): UseQueryResult<IpcOutput<'entities:hostMetrics'>> {
  const timeRange = useTimeRangeValue()
  return useQuery({
    queryKey: moduleKey(envId ?? '', 'entities', { hostMetrics: entityId }, timeRange),
    queryFn: () =>
      invoke('entities:hostMetrics', {
        environmentId: envId ?? '',
        entityId: entityId ?? '',
        timeRange
      }),
    enabled: envId !== null && entityId !== null,
    ...MANUAL
  })
}

/**
 * Discos y los 10 procesos con más CPU de un host en el rango global (canal de la ficha 0017,
 * tablas de la 0019). Una sola llamada para las dos tablas.
 */
export function useHostBreakdown(
  envId: string | null,
  entityId: string | null
): UseQueryResult<IpcOutput<'entities:hostBreakdown'>> {
  const timeRange = useTimeRangeValue()
  return useQuery({
    queryKey: moduleKey(envId ?? '', 'entities', { hostBreakdown: entityId }, timeRange),
    queryFn: () =>
      invoke('entities:hostBreakdown', {
        environmentId: envId ?? '',
        entityId: entityId ?? '',
        timeRange
      }),
    enabled: envId !== null && entityId !== null,
    ...MANUAL
  })
}

/**
 * Procesos de un HOST con logs detectados en el rango global (ficha 0041, tarjeta «Logs»). Con
 * `envId` null (sin `entities.read`) o `entityId` null no se pide nada.
 */
export function useHostLogs(
  envId: string | null,
  entityId: string | null
): UseQueryResult<IpcOutput<'entities:hostLogs'>> {
  const timeRange = useTimeRangeValue()
  return useQuery({
    queryKey: moduleKey(envId ?? '', 'entities', { hostLogs: entityId }, timeRange),
    queryFn: () =>
      invoke('entities:hostLogs', {
        environmentId: envId ?? '',
        entityId: entityId ?? '',
        timeRange
      }),
    enabled: envId !== null && entityId !== null,
    ...MANUAL
  })
}

/**
 * Eventos de un HOST y de lo que corre en él en el rango global (ficha 0042, tarjeta «Eventos»).
 * Con `envId` null (sin events.read o entities.read) o `entityId` null no se pide nada.
 */
export function useHostEvents(
  envId: string | null,
  entityId: string | null
): UseQueryResult<IpcOutput<'entities:hostEvents'>> {
  const timeRange = useTimeRangeValue()
  return useQuery({
    queryKey: moduleKey(envId ?? '', 'entities', { hostEvents: entityId }, timeRange),
    queryFn: () =>
      invoke('entities:hostEvents', {
        environmentId: envId ?? '',
        entityId: entityId ?? '',
        timeRange
      }),
    enabled: envId !== null && entityId !== null,
    ...MANUAL
  })
}

/**
 * Métricas de un PROCESS_GROUP_INSTANCE en el rango global (canal de la ficha 0027; marcadores y
 * gráficos de la 0028, una sola llamada). Con `entityId` null (id que no es de un proceso) no se
 * pide nada.
 */
export function useProcessMetrics(
  envId: string | null,
  entityId: string | null
): UseQueryResult<IpcOutput<'entities:processMetrics'>> {
  const timeRange = useTimeRangeValue()
  return useQuery(processMetricsQuery(envId, entityId, timeRange))
}

/**
 * Consulta de `entities:processMetrics` de un proceso: la misma clave en la página del proceso y
 * en «CPU por instancia» del process group (ficha 0032), así que una no vuelve a pedir lo que ya
 * trajo la otra con el mismo rango.
 */
function processMetricsQuery(
  envId: string | null,
  entityId: string | null,
  timeRange: TimeRangeValue
): {
  queryKey: ReturnType<typeof moduleKey>
  queryFn: () => Promise<IpcOutput<'entities:processMetrics'>>
  enabled: boolean
} & typeof MANUAL {
  return {
    queryKey: moduleKey(envId ?? '', 'entities', { processMetrics: entityId }, timeRange),
    queryFn: () =>
      invoke('entities:processMetrics', {
        environmentId: envId ?? '',
        entityId: entityId ?? '',
        timeRange
      }),
    enabled: envId !== null && entityId !== null,
    ...MANUAL
  }
}

/**
 * Métricas de un DISK en el rango global (ficha 0040; marcadores y gráficos, una sola llamada).
 * Con `entityId` null (id que no es de un disco) no se pide nada.
 */
export function useDiskMetrics(
  envId: string | null,
  entityId: string | null
): UseQueryResult<IpcOutput<'entities:diskMetrics'>> {
  const timeRange = useTimeRangeValue()
  return useQuery({
    queryKey: moduleKey(envId ?? '', 'entities', { diskMetrics: entityId }, timeRange),
    queryFn: () =>
      invoke('entities:diskMetrics', {
        environmentId: envId ?? '',
        entityId: entityId ?? '',
        timeRange
      }),
    enabled: envId !== null && entityId !== null,
    ...MANUAL
  })
}

/**
 * Métricas de varios procesos en el rango global, una llamada a `entities:processMetrics` por
 * cada uno (ficha 0032: las cinco instancias de más CPU de un process group), juntas en un solo
 * estado. Sin entorno no se pide nada; con la lista vacía, tampoco (datos: lista vacía).
 */
export function useProcessMetricsList(
  envId: string | null,
  entityIds: readonly string[]
): QueryListState<IpcOutput<'entities:processMetrics'>> {
  const timeRange = useTimeRangeValue()
  return useQueries({
    queries: entityIds.map((entityId) => processMetricsQuery(envId, entityId, timeRange)),
    combine: combineQueries
  })
}

/**
 * Métricas de un process group en el rango global (canal de la ficha 0031; marcadores, gráficos
 * y tabla de instancias de la 0032, una sola llamada). Con `entityId` null (id que no es de un
 * process group) no se pide nada.
 */
export function useProcessGroupMetrics(
  envId: string | null,
  entityId: string | null
): UseQueryResult<IpcOutput<'entities:processGroupMetrics'>> {
  const timeRange = useTimeRangeValue()
  return useQuery({
    queryKey: moduleKey(envId ?? '', 'entities', { processGroupMetrics: entityId }, timeRange),
    queryFn: () =>
      invoke('entities:processGroupMetrics', {
        environmentId: envId ?? '',
        entityId: entityId ?? '',
        timeRange
      }),
    enabled: envId !== null && entityId !== null,
    ...MANUAL
  })
}

/**
 * Lista completa de instancias de un process group en el rango global (canal de la ficha 0050),
 * para el modal «Ver todas» de la 0051. Solo se pide con `enabled` (con el modal abierto: lo pide
 * el usuario, ADR-0004); queda en caché con la misma clave y volver a abrirlo no pide nada. Con el
 * modal cerrado, ni un rango nuevo ni «Actualizar» la piden (ver
 * `useInvalidateProcessGroupInstances`).
 */
export function useProcessGroupInstances(
  envId: string | null,
  entityId: string | null,
  enabled: boolean
): UseQueryResult<IpcOutput<'entities:processGroupInstances'>> {
  const timeRange = useTimeRangeValue()
  return useQuery({
    queryKey: moduleKey(envId ?? '', 'entities', { processGroupInstances: entityId }, timeRange),
    queryFn: () =>
      invoke('entities:processGroupInstances', {
        environmentId: envId ?? '',
        entityId: entityId ?? '',
        timeRange
      }),
    enabled: enabled && envId !== null && entityId !== null,
    ...MANUAL
  })
}

/**
 * Para «Actualizar» de la página del process group (ficha 0051): marca como vieja la lista
 * completa del grupo (todos los rangos) sin pedirla; se vuelve a pedir al abrir el modal.
 */
export function useInvalidateProcessGroupInstances(
  envId: string | null,
  entityId: string | null
): () => void {
  const client = useQueryClient()
  return () => {
    if (envId === null || entityId === null) return
    void client.invalidateQueries({
      queryKey: [envId, 'entities', { processGroupInstances: entityId }],
      refetchType: 'none'
    })
  }
}

/**
 * Métricas de una aplicación web (APPLICATION) en el rango global (canal de la ficha 0033;
 * marcadores, gráficos y tabla de acciones de la 0034, una sola llamada). Con `entityId` null
 * (id que no es de una aplicación) no se pide nada.
 */
export function useApplicationMetrics(
  envId: string | null,
  entityId: string | null
): UseQueryResult<IpcOutput<'entities:applicationMetrics'>> {
  const timeRange = useTimeRangeValue()
  return useQuery({
    queryKey: moduleKey(envId ?? '', 'entities', { applicationMetrics: entityId }, timeRange),
    queryFn: () =>
      invoke('entities:applicationMetrics', {
        environmentId: envId ?? '',
        entityId: entityId ?? '',
        timeRange
      }),
    enabled: envId !== null && entityId !== null,
    ...MANUAL
  })
}

/**
 * Datos de RUM de una aplicación web en el rango global (canal de la ficha 0052; marcadores de
 * usuarios, sesiones, acciones y errores y secciones «Actividad» y «Errores» de la 0053, una sola
 * llamada). Con `entityId` null (id que no es de una aplicación) no se pide nada.
 */
export function useApplicationRum(
  envId: string | null,
  entityId: string | null
): UseQueryResult<IpcOutput<'entities:applicationRum'>> {
  const timeRange = useTimeRangeValue()
  return useQuery({
    queryKey: moduleKey(envId ?? '', 'entities', { applicationRum: entityId }, timeRange),
    queryFn: () =>
      invoke('entities:applicationRum', {
        environmentId: envId ?? '',
        entityId: entityId ?? '',
        timeRange
      }),
    enabled: envId !== null && entityId !== null,
    ...MANUAL
  })
}

/**
 * Métricas de un browser monitor o de un HTTP monitor en el rango global (canal de la ficha 0022;
 * marcadores y gráficos de la 0024, una sola llamada). Con `entityId` null (id que no es de un
 * monitor) no se pide nada.
 */
export function useMonitorMetrics(
  envId: string | null,
  entityId: string | null
): UseQueryResult<IpcOutput<'entities:monitorMetrics'>> {
  const timeRange = useTimeRangeValue()
  return useQuery({
    queryKey: moduleKey(envId ?? '', 'entities', { monitorMetrics: entityId }, timeRange),
    queryFn: () =>
      invoke('entities:monitorMetrics', {
        environmentId: envId ?? '',
        entityId: entityId ?? '',
        timeRange
      }),
    enabled: envId !== null && entityId !== null,
    ...MANUAL
  })
}

/**
 * Desglose de un monitor por localización y por paso o petición en el rango global (canal de la
 * ficha 0023; el marcador «Localizaciones» de la 0024).
 */
export function useMonitorBreakdown(
  envId: string | null,
  entityId: string | null
): UseQueryResult<IpcOutput<'entities:monitorBreakdown'>> {
  const timeRange = useTimeRangeValue()
  return useQuery({
    queryKey: moduleKey(envId ?? '', 'entities', { monitorBreakdown: entityId }, timeRange),
    queryFn: () =>
      invoke('entities:monitorBreakdown', {
        environmentId: envId ?? '',
        entityId: entityId ?? '',
        timeRange
      }),
    enabled: envId !== null && entityId !== null,
    ...MANUAL
  })
}

/** Problemas abiertos y cerrados de una entidad en el rango global (fichas 0007 y 0008). */
export function useEntityProblemCounts(
  envId: string | null,
  entityId: string | null
): UseQueryResult<IpcOutput<'entities:problemCounts'>> {
  const timeRange = useTimeRangeValue()
  return useQuery({
    queryKey: moduleKey(envId ?? '', 'entities', { problemCounts: entityId }, timeRange),
    queryFn: () =>
      invoke('entities:problemCounts', {
        environmentId: envId ?? '',
        entityId: entityId ?? '',
        timeRange
      }),
    enabled: envId !== null && entityId !== null,
    ...MANUAL
  })
}

/** Problemas que afectan a una entidad en el rango global, para la franja (ficha 0010). */
export function useEntityProblems(
  envId: string | null,
  entityId: string | null
): UseQueryResult<IpcOutput<'entities:problems'>> {
  const timeRange = useTimeRangeValue()
  return useQuery({
    queryKey: moduleKey(envId ?? '', 'entities', { problemList: entityId }, timeRange),
    queryFn: () =>
      invoke('entities:problems', {
        environmentId: envId ?? '',
        entityId: entityId ?? '',
        timeRange
      }),
    enabled: envId !== null && entityId !== null,
    ...MANUAL
  })
}

/**
 * Datos de una entidad (canal `entities:get`, ficha 0015): propiedades, zonas, etiquetas y
 * relaciones. Va bajo el módulo `entities`, así que «Actualizar» de la página la recarga. Con
 * `entityId` null no se pide nada.
 */
export function useEntityInfo(
  envId: string | null,
  entityId: string | null
): UseQueryResult<IpcOutput<'entities:get'>> {
  return useQuery({
    queryKey: moduleKey(envId ?? '', 'entities', { info: entityId }),
    queryFn: () => invoke('entities:get', { environmentId: envId ?? '', entityId: entityId ?? '' }),
    enabled: envId !== null && entityId !== null,
    ...MANUAL
  })
}

/**
 * Nombres de lotes de ids (canal `entities:names`), uno por petición y solo cuando se piden
 * («Ver nombres», ficha 0015). Cada lote, de 1 a 50 ids del mismo tipo. Su clave no cuelga del
 * módulo `entities`: «Actualizar» no los vuelve a pedir (gastaría cuota por algo que no cambia).
 */
export function useEntityNames(
  envId: string | null,
  batches: readonly string[][],
  enabled: boolean
): UseQueryResult<IpcOutput<'entities:names'>>[] {
  return useQueries({
    queries: batches.map((entityIds) => ({
      queryKey: [envId ?? '', 'entityNames', entityIds] as const,
      queryFn: () => invoke('entities:names', { environmentId: envId ?? '', entityIds }),
      enabled: enabled && envId !== null,
      ...MANUAL
    }))
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
