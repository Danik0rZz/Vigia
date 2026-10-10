import type { ApplicationRumResult, ProcessSeries } from '@shared/modules'
import { truncatedResults, type MetricData } from './metrics'

/**
 * Datos de RUM de una aplicación web, entidad APPLICATION (ficha 0052, canal
 * `entities:applicationRum`). Solo API clásica: métricas `builtin:apps.web.*` por
 * `GET /api/v2/metrics/query` (nada de Grail ni DQL, decisión de Dani). Lo observado en
 * vivo (paso 0, en la "Verificación" de la ficha y en `docs/notas-api-v2.md`):
 * - todas tienen la dimensión `dt.entity.application` y se acotan con `entityId(...)`;
 *   con `:splitBy()` llega una serie sin dimensiones;
 * - `countOfErrors:splitBy("Error type"):sum` da una serie por tipo (`JavaScript` y
 *   `Request`) que suman el total: los HTTP son los de `Request`;
 * - `activeUsersEst:splitBy()` con `resolution=Inf` es la estimación de usuarios
 *   distintos del rango; porcentajes sin agregación (`:avg` es la media sin ponderar de
 *   los tipos de usuario); Core Web Vitals con el percentil 75 (INP no admite media);
 * - unidades sin convertir: duración de sesión en µs, LCP e INP en ms, CLS sin unidad,
 *   porcentajes de 0 a 100;
 * - como mucho 10 expresiones por consulta (OpenAPI v2, `metricSelector`).
 */

const W = 'builtin:apps.web.'

/** Valor de «Error type» de los errores de JavaScript y de los de petición (HTTP). */
const ERROR_TYPE_DIMENSION = 'Error type'
const ERROR_TYPE_JAVASCRIPT = 'JavaScript'
const ERROR_TYPE_REQUEST = 'Request'

/** Límite de expresiones por consulta de /metrics/query (OpenAPI v2). */
export const METRIC_SELECTOR_MAX = 10

/** Las 18 expresiones exactas del paso 0, por clave interna. El orden no importa al casar. */
const RUM_EXPRESSIONS = {
  actionsLoad: `${W}actionCount.load.browser:splitBy():sum`,
  actionsXhr: `${W}actionCount.xhr.browser:splitBy():sum`,
  actionsCustom: `${W}actionCount.custom.browser:splitBy():sum`,
  durationLoad: `${W}actionDuration.load.browser:splitBy():avg`,
  durationXhr: `${W}actionDuration.xhr.browser:splitBy():avg`,
  durationCustom: `${W}actionDuration.custom.browser:splitBy():avg`,
  errors: `${W}countOfErrors:splitBy("${ERROR_TYPE_DIMENSION}"):sum`,
  affected: `${W}percentageOfUserActionsAffectedByErrors:splitBy()`,
  users: `${W}activeUsersEst:splitBy()`,
  started: `${W}startedSessions:splitBy():sum`,
  ended: `${W}endedSessions:splitBy():sum`,
  sessionDuration: `${W}sessionDuration:splitBy():avg`,
  actionsPerSession: `${W}actionsPerSession:splitBy():avg`,
  bounce: `${W}bouncedSessionRatio:splitBy()`,
  lcp: `${W}largestContentfulPaint.load.browser:splitBy():percentile(75)`,
  cls: `${W}cumulativeLayoutShift.load.browser:splitBy():percentile(75)`,
  inp: `${W}interactionToNextPaint:splitBy():percentile(75)`,
  rage: `${W}event.count.rageClick:splitBy():sum`
} as const

type RumKey = keyof typeof RUM_EXPRESSIONS

const RUM_KEYS = Object.keys(RUM_EXPRESSIONS) as RumKey[]

/** Las claves repartidas en consultas de como mucho 10 expresiones, en orden. */
export const RUM_KEY_CHUNKS: RumKey[][] = Array.from(
  { length: Math.ceil(RUM_KEYS.length / METRIC_SELECTOR_MAX) },
  (_, index) => RUM_KEYS.slice(index * METRIC_SELECTOR_MAX, (index + 1) * METRIC_SELECTOR_MAX)
)

/** metricSelector de cada consulta (las mismas para las series y para los totales). */
export const RUM_SELECTORS: string[] = RUM_KEY_CHUNKS.map((keys) =>
  keys.map((key) => RUM_EXPRESSIONS[key]).join(',')
)

const EMPTY: ProcessSeries = { timestamps: [], values: [] }

type Item = MetricData['result'][number]['data'][number]

/**
 * Las respuestas de cada consulta, casadas por posición con sus claves (el `metricId`
 * puede llegar sin las comillas: ficha 0040). Una clave sin resultado, sin series.
 */
function itemsByKey(responses: MetricData[]): Record<RumKey, Item[]> {
  const byKey = {} as Record<RumKey, Item[]>
  RUM_KEY_CHUNKS.forEach((keys, chunk) => {
    keys.forEach((key, index) => {
      byKey[key] = responses[chunk]?.result[index]?.data ?? []
    })
  })
  return byKey
}

function seriesOf(items: Item[]): ProcessSeries {
  const item = items[0]
  return item === undefined ? EMPTY : { timestamps: item.timestamps, values: item.values }
}

function totalOf(items: Item[]): number | null {
  return items[0]?.values[0] ?? null
}

/** Suma intervalo a intervalo; null solo si todos los sumandos de ese intervalo lo son. */
function sumSeries(list: ProcessSeries[]): ProcessSeries {
  const first = list[0]
  if (first === undefined) return EMPTY
  const values = first.timestamps.map((_, index) =>
    list.reduce<number | null>((sum, series) => {
      const value = series.values[index] ?? null
      return value === null ? sum : (sum ?? 0) + value
    }, null)
  )
  return { timestamps: first.timestamps, values }
}

function sumTotals(list: (number | null)[]): number | null {
  return list.reduce<number | null>(
    (sum, value) => (value === null ? sum : (sum ?? 0) + value),
    null
  )
}

/**
 * Errores por tipo (regla del paso 0): `JavaScript` → javascript, `Request` → http y los
 * demás tipos (ninguno visto en vivo) sumados en other. Un tipo sin series, vacío y su
 * total a null.
 */
function errorsByType<T>(
  items: Item[],
  pick: (items: Item[]) => T,
  sum: (list: T[]) => T
): { javascript: T; http: T; other: T } {
  const ofType = (type: string): Item[] =>
    items.filter((item) => item.dimensionMap[ERROR_TYPE_DIMENSION] === type)
  const others = items.filter((item) => {
    const type = item.dimensionMap[ERROR_TYPE_DIMENSION]
    return type !== ERROR_TYPE_JAVASCRIPT && type !== ERROR_TYPE_REQUEST
  })
  return {
    javascript: pick(ofType(ERROR_TYPE_JAVASCRIPT)),
    http: pick(ofType(ERROR_TYPE_REQUEST)),
    other: others.length === 0 ? pick([]) : sum(others.map((item) => pick([item])))
  }
}

/** Los papeles de la salida, con `of` aplicado a las series de cada clave. */
function byRole<T>(
  items: Record<RumKey, Item[]>,
  of: (items: Item[]) => T,
  sum: (list: T[]) => T
): ApplicationRumRoles<T> {
  return {
    actionsByType: {
      load: of(items.actionsLoad),
      xhr: of(items.actionsXhr),
      custom: of(items.actionsCustom)
    },
    durationByType: {
      load: of(items.durationLoad),
      xhr: of(items.durationXhr),
      custom: of(items.durationCustom)
    },
    errorsByType: errorsByType(items.errors, of, sum),
    affectedActionsPct: of(items.affected),
    activeUsers: of(items.users),
    sessions: { started: of(items.started), ended: of(items.ended) },
    sessionDuration: of(items.sessionDuration),
    actionsPerSession: of(items.actionsPerSession),
    bounceRate: of(items.bounce),
    vitals: { lcp: of(items.lcp), cls: of(items.cls), inp: of(items.inp) },
    rageClicks: of(items.rage)
  }
}

interface ApplicationRumRoles<T> {
  actionsByType: { load: T; xhr: T; custom: T }
  durationByType: { load: T; xhr: T; custom: T }
  errorsByType: { javascript: T; http: T; other: T }
  affectedActionsPct: T
  activeUsers: T
  sessions: { started: T; ended: T }
  sessionDuration: T
  actionsPerSession: T
  bounceRate: T
  vitals: { lcp: T; cls: T; inp: T }
  rageClicks: T
}

/**
 * Junta las respuestas (las de las series y las de los totales, cada lista en el orden de
 * `RUM_SELECTORS`) en series y totales por papel para la interfaz.
 */
export function toApplicationRum(series: MetricData[], totals: MetricData[]): ApplicationRumResult {
  const all = [...series, ...totals]
  return {
    resolution: series[0]?.resolution ?? '',
    series: byRole(itemsByKey(series), seriesOf, sumSeries),
    totals: byRole(itemsByKey(totals), totalOf, sumTotals),
    warnings: [...new Set(all.flatMap((data) => data.warnings ?? []))],
    partial: all.flatMap((data) => truncatedResults(data))
  }
}
