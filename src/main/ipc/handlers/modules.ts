import { DT_ENDPOINTS } from '@shared/dt-endpoints'
import { timeRangeToDt } from '@shared/time-range'
import type { DtClient } from '../../dynatrace/client'
import {
  metricDataSchema,
  metricSearchPageSchema,
  toMetricInfo,
  toMetricSeries
} from '../../modules/metrics'
import {
  buildProblemSelector,
  problemDetailSchema,
  problemSchema,
  toProblemDetail,
  toProblemSummary
} from '../../modules/problems'
import type { SavedQueryStore } from '../../modules/saved-queries'
import { sloSchema, toSloSummary } from '../../modules/slos'
import type { TenantRepository } from '../../tenants/repository'
import type { IpcImplementations } from '../handler'

type ModuleChannels =
  | 'problems:list'
  | 'problems:get'
  | 'metrics:query'
  | 'metrics:search'
  | 'slos:list'
  | 'savedQueries:list'
  | 'savedQueries:save'
  | 'savedQueries:delete'

/** Problemas: hasta 5 páginas de 100 (500); más allá se avisa de que la lista está truncada. */
const PROBLEMS_PAGE_SIZE = 100
const PROBLEMS_MAX_PAGES = 5
/** Partes del detalle que no vienen por defecto en GET /problems/{id}. */
const PROBLEM_DETAIL_FIELDS = 'evidenceDetails,impactAnalysis,recentComments'
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
      const problem = await client.dtRequest({
        envId: environmentId,
        api: 'classic',
        path: `/problems/${encodeURIComponent(problemId)}`,
        query: { fields: PROBLEM_DETAIL_FIELDS },
        schema: problemDetailSchema
      })
      return toProblemDetail(problem)
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

    'metrics:search': async ({ environmentId, text }) => {
      repo.getEnvironment(environmentId)
      const page = await client.dtRequest({
        envId: environmentId,
        api: 'classic',
        path: '/metrics',
        query: { text, pageSize: METRIC_SEARCH_PAGE_SIZE },
        schema: metricSearchPageSchema
      })
      return {
        metrics: page.metrics.map(toMetricInfo),
        truncated: page.nextPageKey !== null && page.nextPageKey !== undefined,
        totalCount: page.totalCount
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
