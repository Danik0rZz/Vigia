import { timeRangeToDt } from '@shared/time-range'
import type { DtClient } from '../../dynatrace/client'
import {
  metricDataSchema,
  metricSearchPageSchema,
  toMetricInfo,
  toMetricSeries
} from '../../modules/metrics'
import { buildProblemSelector, problemSchema, toProblemSummary } from '../../modules/problems'
import type { SavedQueryStore } from '../../modules/saved-queries'
import { slosPageSchema, toSloSummary } from '../../modules/slos'
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
const METRIC_SEARCH_PAGE_SIZE = 50
/** Máximo de /api/v2/slo con evaluate=true. */
const SLO_PAGE_SIZE = 25

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
        path: '/problems',
        query: {
          ...timeRangeToDt(timeRange),
          problemSelector: buildProblemSelector({ status, severity, impact, text }),
          pageSize: PROBLEMS_PAGE_SIZE
        },
        schema: problemSchema,
        itemsKey: 'problems',
        maxPages: PROBLEMS_MAX_PAGES
      })
      return {
        problems: page.items.map(toProblemSummary),
        totalCount: page.items.length,
        truncated: page.truncated
      }
    },

    'problems:get': async ({ environmentId, problemId }) => {
      repo.getEnvironment(environmentId)
      const problem = await client.dtRequest({
        envId: environmentId,
        api: 'classic',
        path: `/problems/${encodeURIComponent(problemId)}`,
        schema: problemSchema
      })
      return toProblemSummary(problem)
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
        truncated: page.nextPageKey !== null && page.nextPageKey !== undefined
      }
    },

    'slos:list': async ({ environmentId }) => {
      repo.getEnvironment(environmentId)
      const page = await client.dtRequest({
        envId: environmentId,
        api: 'classic',
        path: '/slo',
        query: { evaluate: 'true', pageSize: SLO_PAGE_SIZE },
        schema: slosPageSchema
      })
      return {
        slos: page.slo.map(toSloSummary),
        truncated: page.nextPageKey !== null && page.nextPageKey !== undefined
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
