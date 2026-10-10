import type { ApplicationAction, ApplicationMetricsResult } from '@shared/modules'
import { descending, mergeMeta, seriesAt, singleValue } from './metric-series'
import type { MetricData } from './metrics'

/**
 * Métricas de una aplicación web, entidad APPLICATION (ficha 0033, canal
 * `entities:applicationMetrics`). Lo observado en vivo (paso 0, en la "Verificación"
 * de la ficha):
 * - las métricas de la aplicación tienen la dimensión `dt.entity.application` y se
 *   acotan con `entityId("<aplicación>")`; con `:splitBy()` llega una serie sin
 *   dimensiones y, con `resolution=Inf`, el valor del rango (media ponderada en Apdex
 *   y duración);
 * - las de acción (`builtin:apps.web.action.*`) solo tienen la dimensión
 *   `dt.entity.application_method`: con `entityId("<aplicación>")` no traen nada; las
 *   acciones se eligen con `fromRelationships.isApplicationMethodOf`;
 * - por tipo (load, xhr y custom), `:sort(value(count,descending)):limit(10)` antes de
 *   `:count` y de `:avg`, con `:names`: las dos del mismo tipo traen las mismas
 *   acciones y una acción no sale en dos tipos;
 * - cada expresión vuelve en el orden pedido, con `metricId` igual a la expresión: se
 *   casan por posición, como en el process group.
 */

const W = 'builtin:apps.web.'

/** Series y totales de la aplicación, en el orden de los papeles. */
const APP_EXPRESSIONS = [
  `${W}apdex.userType:splitBy():avg`,
  `${W}actionCount.summary:splitBy():sum`,
  `${W}visuallyComplete.load.browser:splitBy():avg`,
  `${W}countOfErrors:splitBy():sum`,
  `${W}startedSessions:splitBy():sum`
]

const ACTION_DIMENSION = 'dt.entity.application_method'
const BY_ACTION = `:splitBy("${ACTION_DIMENSION}"):sort(value(count,descending)):limit(10)`
const ACTION_TYPES = ['load', 'xhr', 'custom'] as const

/** Máximo de acciones que llegan a la interfaz. */
const TOP_ACTIONS = 10

/** Consulta 1 (series, sin resolution) y 2 (totales, con `resolution=Inf`). */
export const APPLICATION_SELECTOR = APP_EXPRESSIONS.join(',')

/**
 * Consulta 3 (las acciones, con `resolution=Inf`): por tipo, el recuento y la duración
 * media, en este orden (load, xhr, custom).
 */
export const APPLICATION_ACTIONS_SELECTOR = ACTION_TYPES.flatMap((type) => [
  `${W}action.duration.${type}.browser${BY_ACTION}:count:names`,
  `${W}action.duration.${type}.browser${BY_ACTION}:avg:names`
]).join(',')

/**
 * entitySelector de la aplicación y de sus acciones (paso 0). El id ya viene validado
 * por `applicationEntityIdSchema` (tipo y 16 hexadecimales): no puede cerrar la
 * comilla ni el paréntesis.
 */
export function applicationEntitySelector(entityId: string): string {
  return `entityId("${entityId}")`
}

export function applicationActionsEntitySelector(entityId: string): string {
  return `type("APPLICATION_METHOD"),fromRelationships.isApplicationMethodOf(entityId("${entityId}"))`
}

/**
 * Las acciones de los tres tipos juntas, casadas por id: de más a menos recuento (las
 * de recuento null, al final; en empate, en el orden de la API) y solo las 10
 * primeras. Sin nombre en dimensionMap, el id.
 */
function topActionsOf(actions: MetricData): ApplicationAction[] {
  const byId = new Map<string, ApplicationAction>()
  actions.result.forEach((result, index) => {
    const role = index % 2 === 0 ? 'count' : 'duration'
    for (const series of result.data) {
      const map = series.dimensionMap
      const id = map[ACTION_DIMENSION]
      if (id === undefined) continue
      const action = byId.get(id) ?? { id, name: id, count: null, duration: null }
      const name = map[`${ACTION_DIMENSION}.name`]
      if (name !== undefined) action.name = name
      action[role] = series.values[0] ?? null
      byId.set(id, action)
    }
  })
  return [...byId.values()].sort((a, b) => descending(a.count, b.count)).slice(0, TOP_ACTIONS)
}

/** Junta las tres respuestas en series, totales y acciones para la interfaz. */
export function toApplicationMetrics(
  series: MetricData,
  totals: MetricData,
  actions: MetricData
): ApplicationMetricsResult {
  const roles = ['apdex', 'actions', 'duration', 'errors', 'sessions'] as const
  const pick = <T>(of: (index: number) => T): Record<(typeof roles)[number], T> =>
    Object.fromEntries(roles.map((role, index) => [role, of(index)])) as Record<
      (typeof roles)[number],
      T
    >
  return {
    resolution: series.resolution,
    series: pick((index) => seriesAt(series, index)),
    totals: pick((index) => singleValue(totals, index)),
    topActions: topActionsOf(actions),
    ...mergeMeta([series, totals, actions])
  }
}
