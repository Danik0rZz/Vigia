import { DT_ENDPOINTS, problemCommentsEndpoint } from '@shared/dt-endpoints'
import { HOST_EVENTS_LIMIT } from '@shared/modules'
import { timeRangeToDt } from '@shared/time-range'
import type { DtClient } from '../../dynatrace/client'
import { DtError } from '../../dynatrace/errors'
import { parseItems } from '../../dynatrace/parse-items'
import {
  metricDataSchema,
  metricDescriptorSchema,
  metricSearchRawPageSchema,
  toMetricInfo,
  toMetricSeries
} from '../../modules/metrics'
import {
  buildProblemSelector,
  commentItemSchema,
  entityProblemItemSchema,
  entityProblemListSelector,
  entityProblemSelector,
  problemCountPageSchema,
  problemDetailSchema,
  problemSchema,
  toEntityProblem,
  toProblemComment,
  toProblemDetail,
  toProblemCount,
  toProblemSummary
} from '../../modules/problems'
import {
  ENTITY_FIELDS,
  entityIdSelector,
  entityListResponseSchema,
  entityResponseSchema,
  toEntityData,
  toEntityNames
} from '../../modules/entities'
import { markerSelector, seriesSelector, toServiceMetrics } from '../../modules/service-metrics'
import {
  KNOWN_SERVICE_TYPES,
  SERVICE_TYPE_FIELDS,
  serviceMetricSet,
  serviceTypeEntitySchema
} from '../../modules/service-metric-set'
import {
  HOST_MARKER_SELECTOR,
  HOST_SERIES_SELECTORS,
  hostEntitySelector,
  toHostMetrics
} from '../../modules/host-metrics'
import {
  monitorEntitySelector,
  monitorKind,
  monitorMarkerSelector,
  monitorSeriesSelector,
  toMonitorMetrics
} from '../../modules/monitor-metrics'
import {
  PROCESS_MARKER_SELECTOR,
  PROCESS_SERIES_SELECTOR,
  processEntitySelector,
  toProcessMetrics
} from '../../modules/process-metrics'
import {
  PROCESS_GROUP_INSTANCES_SELECTOR,
  PROCESS_GROUP_MARKER_SELECTOR,
  PROCESS_GROUP_SERIES_SELECTOR,
  entityCountSchema,
  processGroupEntitySelector,
  toProcessGroupInstances,
  toProcessGroupMetrics,
  totalCountOf
} from '../../modules/process-group-metrics'
import {
  APPLICATION_ACTIONS_SELECTOR,
  APPLICATION_SELECTOR,
  applicationActionsEntitySelector,
  applicationEntitySelector,
  toApplicationMetrics
} from '../../modules/application-metrics'
import { RUM_SELECTORS, toApplicationRum } from '../../modules/application-rum'
import { diskMarkerSelector, diskSeriesSelector, toDiskMetrics } from '../../modules/disk-metrics'
import {
  HOST_LOGS_FIELDS,
  HOST_LOGS_MAX_PAGES,
  HOST_LOGS_PAGE_SIZE,
  hostLogsEntitySchema,
  hostLogsSelector,
  toHostLogs
} from '../../modules/host-logs'
import {
  HOST_EVENTS_ENTITY_FIELDS,
  hostEventIds,
  hostEventSelectors,
  hostEventsEntitySchema,
  hostEventsPageSchema,
  toHostEvents
} from '../../modules/host-events'
import { monitorBreakdownQueries, toMonitorBreakdown } from '../../modules/monitor-breakdown'
import {
  DISK_RANGE_SELECTOR,
  DISK_SERIES_SELECTOR,
  PROCESS_RANGE_SELECTOR,
  hostProcessSelector,
  toHostBreakdown
} from '../../modules/host-breakdown'
import type { SavedQueryStore } from '../../modules/saved-queries'
import { sloSchema, toSloSummary } from '../../modules/slos'
import type { TenantRepository } from '../../tenants/repository'
import type { IpcImplementations } from '../handler'
import { createMetricsQuery, rethrowRejected } from './metrics-query'

type ModuleChannels =
  | 'problems:list'
  | 'problems:get'
  | 'problems:comments'
  | 'entities:problemCounts'
  | 'entities:problems'
  | 'entities:get'
  | 'entities:names'
  | 'metrics:query'
  | 'metrics:search'
  | 'entities:serviceMetrics'
  | 'entities:hostMetrics'
  | 'entities:hostBreakdown'
  | 'entities:hostLogs'
  | 'entities:hostEvents'
  | 'entities:monitorMetrics'
  | 'entities:monitorBreakdown'
  | 'entities:processMetrics'
  | 'entities:processGroupMetrics'
  | 'entities:processGroupInstances'
  | 'entities:applicationMetrics'
  | 'entities:applicationRum'
  | 'entities:diskMetrics'
  | 'slos:list'
  | 'savedQueries:list'
  | 'savedQueries:save'
  | 'savedQueries:delete'

/** Problemas: hasta 5 páginas de 100 (500); más allá se avisa de que la lista está truncada. */
const PROBLEMS_PAGE_SIZE = 100
const PROBLEMS_MAX_PAGES = 5
/** Franja de problemas de una entidad (ficha 0010): una sola página de 100. */
const ENTITY_PROBLEMS_PAGE_SIZE = 100
/** Nombres de entidades: una página basta (como mucho 50 ids por petición). */
const ENTITY_NAMES_PAGE_SIZE = 50
/** Partes del detalle que no vienen por defecto en GET /problems/{id}. */
const PROBLEM_DETAIL_FIELDS = 'evidenceDetails,recentComments'
/** "Ver todos" los comentarios: hasta 4 páginas de 500 (el máximo de la API). */
const COMMENTS_PAGE_SIZE = 500
const COMMENTS_MAX_PAGES = 4
const METRIC_SEARCH_PAGE_SIZE = 50
/** Máximo de /api/v2/slo con evaluate=true (es caro): hasta 4 páginas, 100 SLO. */
const SLO_PAGE_SIZE = 25
const SLO_MAX_PAGES = 4

export interface ModuleHandlerDeps {
  client: DtClient
  savedQueries: SavedQueryStore
  repo: TenantRepository
}

/**
 * Datos de los módulos Inicio, Problemas y Métricas, siempre con la API clásica
 * (es la que existe en SaaS y en Managed, y /metrics no acepta platform token).
 */
export function createModuleHandlers(
  deps: ModuleHandlerDeps
): Pick<IpcImplementations, ModuleChannels> {
  const { client, repo } = deps

  /**
   * Total real de instancias de un process group (ficha 0050): `totalCount` de `GET /entities`
   * con el selector de sus instancias y `pageSize=1`. Sin `entities.read` (403) o con cualquier
   * error de Dynatrace, null: el canal responde igual, con el número recibido.
   */
  const processGroupTotal = async (
    environmentId: string,
    entitySelector: string,
    range: { from: string; to?: string }
  ): Promise<number | null> => {
    try {
      const count = await client.dtRequest({
        envId: environmentId,
        api: 'classic',
        path: DT_ENDPOINTS.entities.path,
        query: { entitySelector, pageSize: 1, ...range },
        schema: entityCountSchema
      })
      return totalCountOf(count)
    } catch (error) {
      if (error instanceof DtError) return null
      throw error
    }
  }

  return {
    'problems:list': async ({ environmentId, timeRange, status, severity, impact, text }) => {
      repo.requireEnvironment(environmentId)
      const page = await client.paginate({
        envId: environmentId,
        api: 'classic',
        endpoint: DT_ENDPOINTS.problems,
        query: {
          ...timeRangeToDt(timeRange),
          problemSelector: buildProblemSelector({ status, severity, impact, text }),
          // Los más recientes primero: si la lista se recorta (500), lo que falta es
          // lo más antiguo. La página 2 lo arrastra con nextPageKey.
          sort: '-startTime',
          pageSize: PROBLEMS_PAGE_SIZE
        },
        schema: problemSchema,
        maxPages: PROBLEMS_MAX_PAGES
      })
      return {
        problems: page.items.map(toProblemSummary),
        // El total real de la API (puede ser mayor que lo traído), no items.length.
        totalCount: page.totalCount,
        truncated: page.truncated,
        invalid: page.invalid,
        warnings: page.warnings
      }
    },

    'problems:get': async ({ environmentId, problemId }) => {
      repo.requireEnvironment(environmentId)
      try {
        const problem = await client.dtRequest({
          envId: environmentId,
          api: 'classic',
          path: `/problems/${encodeURIComponent(problemId)}`,
          query: { fields: PROBLEM_DETAIL_FIELDS },
          schema: problemDetailSchema
        })
        return toProblemDetail(problem)
      } catch (error) {
        // La página de detalle se abre por URL: un id que no existe es un caso normal.
        if (error instanceof DtError && error.code === 'NOT_FOUND') {
          throw new DtError(
            'NOT_FOUND',
            'No existe un problema con ese ID en este entorno.',
            error.status,
            { key: 'problemNotFound' }
          )
        }
        throw error
      }
    },

    'problems:comments': async ({ environmentId, problemId }) => {
      repo.requireEnvironment(environmentId)
      const page = await client.paginate({
        envId: environmentId,
        api: 'classic',
        endpoint: problemCommentsEndpoint(problemId),
        query: { pageSize: COMMENTS_PAGE_SIZE },
        schema: commentItemSchema,
        maxPages: COMMENTS_MAX_PAGES
      })
      return {
        comments: page.items.map(toProblemComment),
        totalCount: page.totalCount,
        truncated: page.truncated,
        invalid: page.invalid
      }
    },

    'entities:problemCounts': async ({ environmentId, entityId, timeRange }) => {
      repo.requireEnvironment(environmentId)
      // Solo el recuento: pageSize=1 y totalCount, una petición por estado (status
      // admite un solo valor).
      const count = async (status: 'open' | 'closed'): Promise<number | null> => {
        try {
          const page = await client.dtRequest({
            envId: environmentId,
            api: 'classic',
            path: DT_ENDPOINTS.problems.path,
            query: {
              ...timeRangeToDt(timeRange),
              problemSelector: entityProblemSelector(entityId, status),
              pageSize: 1
            },
            schema: problemCountPageSchema
          })
          return toProblemCount(page)
        } catch (error) {
          // Un rechazo de Dynatrace (por ejemplo, 400) llega con su texto y sin
          // motivo: se le da uno para la interfaz, con ese texto como detalle.
          if (
            error instanceof DtError &&
            error.reason === undefined &&
            error.status !== undefined
          ) {
            throw new DtError(
              error.code,
              `Dynatrace ha rechazado el recuento de problemas de la entidad: ${error.message}`,
              error.status,
              {
                key: 'entityProblemsRejected',
                params: { status: error.status, detail: error.message }
              }
            )
          }
          throw error
        }
      }
      const [open, closed] = await Promise.all([count('open'), count('closed')])
      return { open, closed }
    },

    'entities:problems': async ({ environmentId, entityId, timeRange }) => {
      repo.requireEnvironment(environmentId)
      try {
        // Una sola página: si hay más, se dice (truncated) y no se pide el resto.
        const page = await client.paginate({
          envId: environmentId,
          api: 'classic',
          endpoint: DT_ENDPOINTS.problems,
          query: {
            ...timeRangeToDt(timeRange),
            problemSelector: entityProblemListSelector(entityId),
            // Los más recientes primero: si se recorta, lo que falta es lo más antiguo.
            sort: '-startTime',
            pageSize: ENTITY_PROBLEMS_PAGE_SIZE
          },
          schema: entityProblemItemSchema,
          maxPages: 1
        })
        const received = page.items.length + page.invalid
        return {
          problems: page.items.map(toEntityProblem),
          totalCount: page.totalCount,
          truncated: page.truncated || (page.totalCount !== null && page.totalCount > received),
          invalid: page.invalid
        }
      } catch (error) {
        // Un rechazo de Dynatrace (por ejemplo, 400) llega con su texto y sin motivo:
        // se le da uno para la interfaz, con ese texto como detalle.
        if (error instanceof DtError && error.reason === undefined && error.status !== undefined) {
          throw new DtError(
            error.code,
            `Dynatrace ha rechazado la lista de problemas de la entidad: ${error.message}`,
            error.status,
            {
              key: 'entityProblemListRejected',
              params: { status: error.status, detail: error.message }
            }
          )
        }
        throw error
      }
    },

    'entities:get': async ({ environmentId, entityId }) => {
      repo.requireEnvironment(environmentId)
      try {
        const entity = await client.dtRequest({
          envId: environmentId,
          api: 'classic',
          // El id ya viene validado (entityIdSchema); se codifica igual por ser ruta.
          path: `/entities/${encodeURIComponent(entityId)}`,
          query: { fields: ENTITY_FIELDS },
          schema: entityResponseSchema
        })
        return toEntityData(entity, entityId)
      } catch (error) {
        // La página de una entidad se abre por URL: un id que no existe es un caso normal.
        if (error instanceof DtError && error.code === 'NOT_FOUND') {
          throw new DtError('NOT_FOUND', 'La entidad no existe en este entorno.', error.status, {
            key: 'entityNotFound'
          })
        }
        throw error
      }
    },

    'entities:names': async ({ environmentId, entityIds }) => {
      repo.requireEnvironment(environmentId)
      const ids = [...new Set(entityIds)]
      try {
        // Sin from: el de por defecto (now-3d) resolvió todos los ids en el paso 0.
        const page = await client.dtRequest({
          envId: environmentId,
          api: 'classic',
          path: DT_ENDPOINTS.entities.path,
          query: { entitySelector: entityIdSelector(ids), pageSize: ENTITY_NAMES_PAGE_SIZE },
          schema: entityListResponseSchema
        })
        return toEntityNames(page, ids)
      } catch (error) {
        // Un rechazo de Dynatrace llega con su texto y sin motivo: se le da uno.
        if (error instanceof DtError && error.reason === undefined && error.status !== undefined) {
          throw new DtError(
            error.code,
            `Dynatrace ha rechazado la consulta de nombres de entidades: ${error.message}`,
            error.status,
            {
              key: 'entityNamesRejected',
              params: { status: error.status, detail: error.message }
            }
          )
        }
        throw error
      }
    },

    'metrics:query': async ({ environmentId, timeRange, metricSelector, resolution }) => {
      repo.requireEnvironment(environmentId)
      const data = await client.dtRequest({
        envId: environmentId,
        api: 'classic',
        path: '/metrics/query',
        query: { metricSelector, resolution, ...timeRangeToDt(timeRange) },
        schema: metricDataSchema
      })
      return toMetricSeries(data)
    },

    'entities:serviceMetrics': async ({ environmentId, entityId, timeRange }) => {
      repo.requireEnvironment(environmentId)
      const query = createMetricsQuery(client, environmentId, timeRangeToDt(timeRange))
      // Ficha 0046: primero la entidad, para elegir las métricas por su serviceType. Si falla
      // (sin entities.read, 404…), las de Servidor, como antes, y un aviso: la página sigue.
      const warnings: string[] = []
      let serviceType: string | null = null
      let properties: Record<string, unknown> = {}
      try {
        const entity = await client.dtRequest({
          envId: environmentId,
          api: 'classic',
          // El id ya viene validado (serviceEntityIdSchema); se codifica igual por ser ruta.
          path: `/entities/${encodeURIComponent(entityId)}`,
          query: { fields: SERVICE_TYPE_FIELDS },
          schema: serviceTypeEntitySchema
        })
        properties = entity.properties ?? {}
        const type = properties['serviceType']
        serviceType = typeof type === 'string' && type !== '' ? type : null
        if (serviceType === null) {
          warnings.push('La entidad no trae serviceType: se usan las métricas de servidor.')
        } else if (!KNOWN_SERVICE_TYPES.has(serviceType)) {
          warnings.push(
            `serviceType ${serviceType} fuera de la tabla de la ficha 0046: se usan las métricas de servidor.`
          )
        }
      } catch (error) {
        if (!(error instanceof DtError)) throw error
        // Solo el estado: el texto de Dynatrace no hace falta para el aviso.
        warnings.push(
          `No se ha podido leer la entidad (${error.status ?? error.code}): se usan las métricas de servidor.`
        )
      }
      const set = serviceMetricSet(serviceType, properties)
      const context = { set, serviceType, warnings }
      try {
        // Series con la resolución que elija la API; tiempos del rango con Inf (sin fold:
        // mezclarlos da 400). Los recuentos totales salen de sumar la serie. Solo actividad
        // no mide tiempos: sin consulta de marcadores.
        const markerQuery = markerSelector(set, entityId)
        const [series, markers] = await Promise.all([
          query(seriesSelector(set, entityId)),
          markerQuery === null ? Promise.resolve(null) : query(markerQuery, 'Inf')
        ])
        return toServiceMetrics(context, series, markers)
      } catch (error) {
        rethrowRejected(error, 'serviceMetricsRejected')
      }
    },

    'entities:hostMetrics': async ({ environmentId, entityId, timeRange }) => {
      repo.requireEnvironment(environmentId)
      const query = createMetricsQuery(client, environmentId, {
        ...timeRangeToDt(timeRange),
        entitySelector: hostEntitySelector(entityId)
      })
      try {
        // Series con la resolución que elija la API, en dos consultas (como mucho 10
        // expresiones cada una, ficha 0039); marcadores del rango con Inf (sin fold:
        // mezclarlos da 400). Todas en paralelo.
        const [main, memory, markers] = await Promise.all([
          query(HOST_SERIES_SELECTORS[0]),
          query(HOST_SERIES_SELECTORS[1]),
          query(HOST_MARKER_SELECTOR, 'Inf')
        ])
        return toHostMetrics([main, memory], markers)
      } catch (error) {
        rethrowRejected(error, 'hostMetricsRejected')
      }
    },

    'entities:processMetrics': async ({ environmentId, entityId, timeRange }) => {
      repo.requireEnvironment(environmentId)
      const query = createMetricsQuery(client, environmentId, {
        ...timeRangeToDt(timeRange),
        entitySelector: processEntitySelector(entityId)
      })
      try {
        // Series con la resolución que elija la API; marcadores del rango con Inf
        // (sin fold: mezclarlos da 400).
        const [series, markers] = await Promise.all([
          query(PROCESS_SERIES_SELECTOR),
          query(PROCESS_MARKER_SELECTOR, 'Inf')
        ])
        return toProcessMetrics(series, markers)
      } catch (error) {
        rethrowRejected(error, 'processMetricsRejected')
      }
    },

    'entities:diskMetrics': async ({ environmentId, entityId, timeRange }) => {
      repo.requireEnvironment(environmentId)
      // Sin entitySelector: la entidad de estas métricas es el HOST y con entityId del disco no
      // llega ninguna serie (paso 0 de la 0040). El disco va en el filtro de cada expresión.
      const query = createMetricsQuery(client, environmentId, timeRangeToDt(timeRange))
      try {
        // Series con la resolución que elija la API; marcadores del rango con Inf (sin fold ni
        // last: dan 400). Las dos en paralelo y ninguna pasa de 10 expresiones.
        const [series, markers] = await Promise.all([
          query(diskSeriesSelector(entityId)),
          query(diskMarkerSelector(entityId), 'Inf')
        ])
        return toDiskMetrics(series, markers)
      } catch (error) {
        rethrowRejected(error, 'diskMetricsRejected')
      }
    },

    'entities:processGroupMetrics': async ({ environmentId, entityId, timeRange }) => {
      repo.requireEnvironment(environmentId)
      const range = timeRangeToDt(timeRange)
      const entitySelector = processGroupEntitySelector(entityId)
      const query = createMetricsQuery(client, environmentId, { ...range, entitySelector })
      try {
        // Series del total con la resolución que elija la API; medias del total y por
        // instancia con Inf (sin fold: mezclarlos da 400); y el total real de instancias.
        const [series, markers, totalCount] = await Promise.all([
          query(PROCESS_GROUP_SERIES_SELECTOR),
          query(PROCESS_GROUP_MARKER_SELECTOR, 'Inf'),
          processGroupTotal(environmentId, entitySelector, range)
        ])
        return toProcessGroupMetrics(series, markers, totalCount)
      } catch (error) {
        rethrowRejected(error, 'processGroupMetricsRejected')
      }
    },

    'entities:processGroupInstances': async ({ environmentId, entityId, timeRange }) => {
      repo.requireEnvironment(environmentId)
      const range = timeRangeToDt(timeRange)
      const entitySelector = processGroupEntitySelector(entityId)
      const query = createMetricsQuery(client, environmentId, { ...range, entitySelector })
      try {
        // Una consulta con Inf (CPU de todas, ordenada, y memoria de todas) y el total real.
        const [data, totalCount] = await Promise.all([
          query(PROCESS_GROUP_INSTANCES_SELECTOR, 'Inf'),
          processGroupTotal(environmentId, entitySelector, range)
        ])
        return toProcessGroupInstances(data, totalCount)
      } catch (error) {
        // El mismo motivo que las métricas del grupo: es la misma consulta, más larga.
        rethrowRejected(error, 'processGroupMetricsRejected')
      }
    },

    'entities:applicationMetrics': async ({ environmentId, entityId, timeRange }) => {
      repo.requireEnvironment(environmentId)
      const range = timeRangeToDt(timeRange)
      const appQuery = createMetricsQuery(client, environmentId, {
        ...range,
        entitySelector: applicationEntitySelector(entityId)
      })
      const actionsQuery = createMetricsQuery(client, environmentId, {
        ...range,
        entitySelector: applicationActionsEntitySelector(entityId)
      })
      try {
        // Series con la resolución que elija la API; totales y acciones con Inf (sin
        // fold: mezclarlos da 400). Las acciones, con el selector de sus acciones.
        const [series, totals, actions] = await Promise.all([
          appQuery(APPLICATION_SELECTOR),
          appQuery(APPLICATION_SELECTOR, 'Inf'),
          actionsQuery(APPLICATION_ACTIONS_SELECTOR, 'Inf')
        ])
        return toApplicationMetrics(series, totals, actions)
      } catch (error) {
        rethrowRejected(error, 'applicationMetricsRejected')
      }
    },

    'entities:applicationRum': async ({ environmentId, entityId, timeRange }) => {
      repo.requireEnvironment(environmentId)
      const query = createMetricsQuery(client, environmentId, {
        ...timeRangeToDt(timeRange),
        entitySelector: applicationEntitySelector(entityId)
      })
      try {
        // Todas en paralelo, de 10 en 10 (límite de la API): series con la resolución que
        // elija la API y totales con Inf (sin fold: mezclarlos da 400).
        const [series, totals] = await Promise.all([
          Promise.all(RUM_SELECTORS.map((selector) => query(selector))),
          Promise.all(RUM_SELECTORS.map((selector) => query(selector, 'Inf')))
        ])
        return toApplicationRum(series, totals)
      } catch (error) {
        // El texto de la 0033 («la consulta de métricas de la aplicación») vale aquí.
        rethrowRejected(error, 'applicationMetricsRejected')
      }
    },

    'entities:monitorMetrics': async ({ environmentId, entityId, timeRange }) => {
      repo.requireEnvironment(environmentId)
      const kind = monitorKind(entityId)
      const query = createMetricsQuery(client, environmentId, {
        ...timeRangeToDt(timeRange),
        entitySelector: monitorEntitySelector(entityId)
      })
      try {
        // Series con la resolución que elija la API; marcadores del rango con Inf
        // (sin fold: mezclarlos da 400). Cada tipo, con su catálogo.
        const [series, markers] = await Promise.all([
          query(monitorSeriesSelector(kind)),
          query(monitorMarkerSelector(kind), 'Inf')
        ])
        return toMonitorMetrics(kind, series, markers)
      } catch (error) {
        rethrowRejected(error, 'monitorMetricsRejected')
      }
    },

    'entities:monitorBreakdown': async ({ environmentId, entityId, timeRange }) => {
      repo.requireEnvironment(environmentId)
      const kind = monitorKind(entityId)
      const range = timeRangeToDt(timeRange)
      // Cada consulta, con las expresiones y el ámbito confirmados en vivo (ficha 0023):
      // en browser una sola con entityId; en HTTP, las de localización con entityId y
      // las peticiones por la relación isStepOf. Todas con Inf (valor del rango).
      const queries = monitorBreakdownQueries(kind, entityId)
      try {
        const responses = await Promise.all(
          queries.map(({ metricSelector, entitySelector }) =>
            createMetricsQuery(client, environmentId, { ...range, entitySelector })(
              metricSelector,
              'Inf'
            )
          )
        )
        return toMonitorBreakdown(kind, queries, responses)
      } catch (error) {
        rethrowRejected(error, 'monitorBreakdownRejected')
      }
    },

    'entities:hostBreakdown': async ({ environmentId, entityId, timeRange }) => {
      repo.requireEnvironment(environmentId)
      const range = timeRangeToDt(timeRange)
      const diskQuery = createMetricsQuery(client, environmentId, {
        ...range,
        entitySelector: hostEntitySelector(entityId)
      })
      const processQuery = createMetricsQuery(client, environmentId, {
        ...range,
        entitySelector: hostProcessSelector(entityId)
      })
      try {
        // Discos acotados con entityId del host; procesos, por la relación isProcessOf
        // (sus métricas no tienen la dimensión del host). Último dato de la serie
        // (:last con Inf da 400); máximo y medias del rango con Inf.
        const [diskSeries, diskRange, processRange] = await Promise.all([
          diskQuery(DISK_SERIES_SELECTOR),
          diskQuery(DISK_RANGE_SELECTOR, 'Inf'),
          processQuery(PROCESS_RANGE_SELECTOR, 'Inf')
        ])
        return toHostBreakdown(diskSeries, diskRange, processRange)
      } catch (error) {
        rethrowRejected(error, 'hostBreakdownRejected')
      }
    },
    'entities:hostLogs': async ({ environmentId, entityId, timeRange }) => {
      repo.requireEnvironment(environmentId)
      try {
        // Con nextPageKey, la página siguiente lleva solo la clave (OpenAPI; DT_ENDPOINTS).
        const page = await client.paginate({
          envId: environmentId,
          api: 'classic',
          endpoint: DT_ENDPOINTS.entities,
          query: {
            entitySelector: hostLogsSelector(entityId),
            fields: HOST_LOGS_FIELDS,
            ...timeRangeToDt(timeRange),
            pageSize: HOST_LOGS_PAGE_SIZE
          },
          schema: hostLogsEntitySchema,
          maxPages: HOST_LOGS_MAX_PAGES
        })
        return toHostLogs(page.items, page.totalCount, page.invalid, page.truncated)
      } catch (error) {
        // Un rechazo de Dynatrace llega con su texto y sin motivo: se le da uno.
        if (error instanceof DtError && error.reason === undefined && error.status !== undefined) {
          throw new DtError(
            error.code,
            `Dynatrace ha rechazado la consulta de logs del host: ${error.message}`,
            error.status,
            {
              key: 'hostLogsRejected',
              params: { status: error.status, detail: error.message }
            }
          )
        }
        throw error
      }
    },

    'entities:hostEvents': async ({ environmentId, entityId, timeRange }) => {
      repo.requireEnvironment(environmentId)
      try {
        // 1. Las relaciones del host: de ahí salen los ids de lo que corre en él.
        const host = await client.dtRequest({
          envId: environmentId,
          api: 'classic',
          // El id ya viene validado (hostEntityIdSchema); se codifica igual por ser ruta.
          path: `/entities/${encodeURIComponent(entityId)}`,
          query: { fields: HOST_EVENTS_ENTITY_FIELDS },
          schema: hostEventsEntitySchema
        })
        // 2. Una consulta de eventos por cada eventSelector (casi siempre, una). Cada una trae
        // sus 20 más recientes: entre todas están los 20 más recientes del conjunto.
        const range = timeRangeToDt(timeRange)
        const pages = await Promise.all(
          hostEventSelectors(hostEventIds(entityId, host)).map((eventSelector) =>
            client.dtRequest({
              envId: environmentId,
              api: 'classic',
              path: DT_ENDPOINTS.events.path,
              query: { eventSelector, ...range, pageSize: HOST_EVENTS_LIMIT },
              schema: hostEventsPageSchema
            })
          )
        )
        return toHostEvents(pages)
      } catch (error) {
        // Un rechazo de Dynatrace llega con su texto y sin motivo: se le da uno.
        if (error instanceof DtError && error.reason === undefined && error.status !== undefined) {
          throw new DtError(
            error.code,
            `Dynatrace ha rechazado la consulta de eventos del host: ${error.message}`,
            error.status,
            {
              key: 'hostEventsRejected',
              params: { status: error.status, detail: error.message }
            }
          )
        }
        throw error
      }
    },

    'metrics:search': async ({ environmentId, text }) => {
      repo.requireEnvironment(environmentId)
      const page = await client.dtRequest({
        envId: environmentId,
        api: 'classic',
        path: '/metrics',
        query: { text, pageSize: METRIC_SEARCH_PAGE_SIZE },
        schema: metricSearchRawPageSchema
      })
      // Una métrica inesperada se descarta y se cuenta (AUD-08), no tumba la búsqueda.
      const parsed = parseItems(metricDescriptorSchema, page.metrics)
      return {
        metrics: parsed.items.map(toMetricInfo),
        truncated: page.nextPageKey !== null && page.nextPageKey !== undefined,
        totalCount: page.totalCount,
        invalid: parsed.invalid
      }
    },

    'slos:list': async ({ environmentId }) => {
      repo.requireEnvironment(environmentId)
      const page = await client.paginate({
        envId: environmentId,
        api: 'classic',
        endpoint: DT_ENDPOINTS.slo,
        query: { evaluate: 'true', pageSize: SLO_PAGE_SIZE },
        schema: sloSchema,
        maxPages: SLO_MAX_PAGES
      })
      return {
        slos: page.items.map(toSloSummary),
        truncated: page.truncated,
        totalCount: page.totalCount,
        invalid: page.invalid
      }
    },

    'savedQueries:list': ({ environmentId }) => deps.savedQueries.list(environmentId),
    'savedQueries:save': ({ environmentId, ...input }) =>
      deps.savedQueries.save(environmentId, input),
    'savedQueries:delete': ({ id }) => {
      deps.savedQueries.delete(id)
      return { ok: true }
    }
  }
}
