import { DT_ENDPOINTS, problemCommentsEndpoint } from '@shared/dt-endpoints'
import { timeRangeToDt } from '@shared/time-range'
import type { DtClient } from '../../dynatrace/client'
import { DtError } from '../../dynatrace/errors'
import { parseItems } from '../../dynatrace/parse-items'
import {
  metricDataSchema,
  metricDescriptorSchema,
  metricSearchRawPageSchema,
  type MetricData,
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
  PROCESS_GROUP_MARKER_SELECTOR,
  PROCESS_GROUP_SERIES_SELECTOR,
  processGroupEntitySelector,
  toProcessGroupMetrics
} from '../../modules/process-group-metrics'
import {
  APPLICATION_ACTIONS_SELECTOR,
  APPLICATION_SELECTOR,
  applicationActionsEntitySelector,
  applicationEntitySelector,
  toApplicationMetrics
} from '../../modules/application-metrics'
import { diskMarkerSelector, diskSeriesSelector, toDiskMetrics } from '../../modules/disk-metrics'
import {
  HOST_LOGS_FIELDS,
  HOST_LOGS_MAX_PAGES,
  HOST_LOGS_PAGE_SIZE,
  hostLogsEntitySchema,
  hostLogsSelector,
  toHostLogs
} from '../../modules/host-logs'
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
  | 'entities:monitorMetrics'
  | 'entities:monitorBreakdown'
  | 'entities:processMetrics'
  | 'entities:processGroupMetrics'
  | 'entities:applicationMetrics'
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

  return {
    'problems:list': async ({ environmentId, timeRange, status, severity, impact, text }) => {
      repo.getEnvironment(environmentId)
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
      repo.getEnvironment(environmentId)
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
      repo.getEnvironment(environmentId)
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
      repo.getEnvironment(environmentId)
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
      repo.getEnvironment(environmentId)
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
      repo.getEnvironment(environmentId)
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
      repo.getEnvironment(environmentId)
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
      repo.getEnvironment(environmentId)
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
      repo.getEnvironment(environmentId)
      const range = timeRangeToDt(timeRange)
      const query = (metricSelector: string, resolution?: 'Inf'): Promise<MetricData> =>
        client.dtRequest({
          envId: environmentId,
          api: 'classic',
          path: '/metrics/query',
          query: { metricSelector, resolution, ...range },
          schema: metricDataSchema
        })
      try {
        // Series con la resolución que elija la API; tiempos del rango con Inf (sin fold:
        // mezclarlos da 400). Los recuentos totales salen de sumar la serie.
        const [series, markers] = await Promise.all([
          query(seriesSelector(entityId)),
          query(markerSelector(entityId), 'Inf')
        ])
        return toServiceMetrics(series, markers)
      } catch (error) {
        if (
          error instanceof DtError &&
          (error.code === 'BAD_REQUEST' || error.code === 'NOT_FOUND')
        ) {
          throw new DtError(error.code, error.message, error.status, {
            key: 'serviceMetricsRejected',
            params: { status: error.status ?? 0, detail: error.message }
          })
        }
        throw error
      }
    },

    'entities:hostMetrics': async ({ environmentId, entityId, timeRange }) => {
      repo.getEnvironment(environmentId)
      const range = timeRangeToDt(timeRange)
      const entitySelector = hostEntitySelector(entityId)
      const query = (metricSelector: string, resolution?: 'Inf'): Promise<MetricData> =>
        client.dtRequest({
          envId: environmentId,
          api: 'classic',
          path: '/metrics/query',
          query: { metricSelector, entitySelector, resolution, ...range },
          schema: metricDataSchema
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
        if (
          error instanceof DtError &&
          (error.code === 'BAD_REQUEST' || error.code === 'NOT_FOUND')
        ) {
          throw new DtError(error.code, error.message, error.status, {
            key: 'hostMetricsRejected',
            params: { status: error.status ?? 0, detail: error.message }
          })
        }
        throw error
      }
    },

    'entities:processMetrics': async ({ environmentId, entityId, timeRange }) => {
      repo.getEnvironment(environmentId)
      const range = timeRangeToDt(timeRange)
      const entitySelector = processEntitySelector(entityId)
      const query = (metricSelector: string, resolution?: 'Inf'): Promise<MetricData> =>
        client.dtRequest({
          envId: environmentId,
          api: 'classic',
          path: '/metrics/query',
          query: { metricSelector, entitySelector, resolution, ...range },
          schema: metricDataSchema
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
        if (
          error instanceof DtError &&
          (error.code === 'BAD_REQUEST' || error.code === 'NOT_FOUND')
        ) {
          throw new DtError(error.code, error.message, error.status, {
            key: 'processMetricsRejected',
            params: { status: error.status ?? 0, detail: error.message }
          })
        }
        throw error
      }
    },

    'entities:diskMetrics': async ({ environmentId, entityId, timeRange }) => {
      repo.getEnvironment(environmentId)
      const range = timeRangeToDt(timeRange)
      // Sin entitySelector: la entidad de estas métricas es el HOST y con entityId del disco no
      // llega ninguna serie (paso 0 de la 0040). El disco va en el filtro de cada expresión.
      const query = (metricSelector: string, resolution?: 'Inf'): Promise<MetricData> =>
        client.dtRequest({
          envId: environmentId,
          api: 'classic',
          path: '/metrics/query',
          query: { metricSelector, resolution, ...range },
          schema: metricDataSchema
        })
      try {
        // Series con la resolución que elija la API; marcadores del rango con Inf (sin fold ni
        // last: dan 400). Las dos en paralelo y ninguna pasa de 10 expresiones.
        const [series, markers] = await Promise.all([
          query(diskSeriesSelector(entityId)),
          query(diskMarkerSelector(entityId), 'Inf')
        ])
        return toDiskMetrics(series, markers)
      } catch (error) {
        if (
          error instanceof DtError &&
          (error.code === 'BAD_REQUEST' || error.code === 'NOT_FOUND')
        ) {
          throw new DtError(error.code, error.message, error.status, {
            key: 'diskMetricsRejected',
            params: { status: error.status ?? 0, detail: error.message }
          })
        }
        throw error
      }
    },

    'entities:processGroupMetrics': async ({ environmentId, entityId, timeRange }) => {
      repo.getEnvironment(environmentId)
      const range = timeRangeToDt(timeRange)
      const entitySelector = processGroupEntitySelector(entityId)
      const query = (metricSelector: string, resolution?: 'Inf'): Promise<MetricData> =>
        client.dtRequest({
          envId: environmentId,
          api: 'classic',
          path: '/metrics/query',
          query: { metricSelector, entitySelector, resolution, ...range },
          schema: metricDataSchema
        })
      try {
        // Series del total con la resolución que elija la API; medias del total y por
        // instancia con Inf (sin fold: mezclarlos da 400).
        const [series, markers] = await Promise.all([
          query(PROCESS_GROUP_SERIES_SELECTOR),
          query(PROCESS_GROUP_MARKER_SELECTOR, 'Inf')
        ])
        return toProcessGroupMetrics(series, markers)
      } catch (error) {
        if (
          error instanceof DtError &&
          (error.code === 'BAD_REQUEST' || error.code === 'NOT_FOUND')
        ) {
          throw new DtError(error.code, error.message, error.status, {
            key: 'processGroupMetricsRejected',
            params: { status: error.status ?? 0, detail: error.message }
          })
        }
        throw error
      }
    },

    'entities:applicationMetrics': async ({ environmentId, entityId, timeRange }) => {
      repo.getEnvironment(environmentId)
      const range = timeRangeToDt(timeRange)
      const query = (
        metricSelector: string,
        entitySelector: string,
        resolution?: 'Inf'
      ): Promise<MetricData> =>
        client.dtRequest({
          envId: environmentId,
          api: 'classic',
          path: '/metrics/query',
          query: { metricSelector, entitySelector, resolution, ...range },
          schema: metricDataSchema
        })
      const app = applicationEntitySelector(entityId)
      try {
        // Series con la resolución que elija la API; totales y acciones con Inf (sin
        // fold: mezclarlos da 400). Las acciones, con el selector de sus acciones.
        const [series, totals, actions] = await Promise.all([
          query(APPLICATION_SELECTOR, app),
          query(APPLICATION_SELECTOR, app, 'Inf'),
          query(APPLICATION_ACTIONS_SELECTOR, applicationActionsEntitySelector(entityId), 'Inf')
        ])
        return toApplicationMetrics(series, totals, actions)
      } catch (error) {
        if (
          error instanceof DtError &&
          (error.code === 'BAD_REQUEST' || error.code === 'NOT_FOUND')
        ) {
          throw new DtError(error.code, error.message, error.status, {
            key: 'applicationMetricsRejected',
            params: { status: error.status ?? 0, detail: error.message }
          })
        }
        throw error
      }
    },

    'entities:monitorMetrics': async ({ environmentId, entityId, timeRange }) => {
      repo.getEnvironment(environmentId)
      const kind = monitorKind(entityId)
      const range = timeRangeToDt(timeRange)
      const entitySelector = monitorEntitySelector(entityId)
      const query = (metricSelector: string, resolution?: 'Inf'): Promise<MetricData> =>
        client.dtRequest({
          envId: environmentId,
          api: 'classic',
          path: '/metrics/query',
          query: { metricSelector, entitySelector, resolution, ...range },
          schema: metricDataSchema
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
        if (
          error instanceof DtError &&
          (error.code === 'BAD_REQUEST' || error.code === 'NOT_FOUND')
        ) {
          throw new DtError(error.code, error.message, error.status, {
            key: 'monitorMetricsRejected',
            params: { status: error.status ?? 0, detail: error.message }
          })
        }
        throw error
      }
    },

    'entities:monitorBreakdown': async ({ environmentId, entityId, timeRange }) => {
      repo.getEnvironment(environmentId)
      const kind = monitorKind(entityId)
      const range = timeRangeToDt(timeRange)
      // Cada consulta, con las expresiones y el ámbito confirmados en vivo (ficha 0023):
      // en browser una sola con entityId; en HTTP, las de localización con entityId y
      // las peticiones por la relación isStepOf. Todas con Inf (valor del rango).
      const queries = monitorBreakdownQueries(kind, entityId)
      try {
        const responses = await Promise.all(
          queries.map(({ metricSelector, entitySelector }) =>
            client.dtRequest({
              envId: environmentId,
              api: 'classic',
              path: '/metrics/query',
              query: { metricSelector, entitySelector, resolution: 'Inf', ...range },
              schema: metricDataSchema
            })
          )
        )
        return toMonitorBreakdown(kind, queries, responses)
      } catch (error) {
        if (
          error instanceof DtError &&
          (error.code === 'BAD_REQUEST' || error.code === 'NOT_FOUND')
        ) {
          throw new DtError(error.code, error.message, error.status, {
            key: 'monitorBreakdownRejected',
            params: { status: error.status ?? 0, detail: error.message }
          })
        }
        throw error
      }
    },

    'entities:hostBreakdown': async ({ environmentId, entityId, timeRange }) => {
      repo.getEnvironment(environmentId)
      const range = timeRangeToDt(timeRange)
      const query = (
        metricSelector: string,
        entitySelector: string,
        resolution?: 'Inf'
      ): Promise<MetricData> =>
        client.dtRequest({
          envId: environmentId,
          api: 'classic',
          path: '/metrics/query',
          query: { metricSelector, entitySelector, resolution, ...range },
          schema: metricDataSchema
        })
      try {
        // Discos acotados con entityId del host; procesos, por la relación isProcessOf
        // (sus métricas no tienen la dimensión del host). Último dato de la serie
        // (:last con Inf da 400); máximo y medias del rango con Inf.
        const [diskSeries, diskRange, processRange] = await Promise.all([
          query(DISK_SERIES_SELECTOR, hostEntitySelector(entityId)),
          query(DISK_RANGE_SELECTOR, hostEntitySelector(entityId), 'Inf'),
          query(PROCESS_RANGE_SELECTOR, hostProcessSelector(entityId), 'Inf')
        ])
        return toHostBreakdown(diskSeries, diskRange, processRange)
      } catch (error) {
        if (
          error instanceof DtError &&
          (error.code === 'BAD_REQUEST' || error.code === 'NOT_FOUND')
        ) {
          throw new DtError(error.code, error.message, error.status, {
            key: 'hostBreakdownRejected',
            params: { status: error.status ?? 0, detail: error.message }
          })
        }
        throw error
      }
    },

    'entities:hostLogs': async ({ environmentId, entityId, timeRange }) => {
      repo.getEnvironment(environmentId)
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
        return toHostLogs(page.items, page.totalCount, page.invalid)
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

    'metrics:search': async ({ environmentId, text }) => {
      repo.getEnvironment(environmentId)
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
      repo.getEnvironment(environmentId)
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
