import type {
  MonitorBreakdownResult,
  MonitorKind,
  MonitorLocation,
  MonitorStep
} from '@shared/modules'
import { truncatedResults, type MetricData } from './metrics'
import { monitorEntitySelector } from './monitor-metrics'

/**
 * Desglose de un browser monitor (SYNTHETIC_TEST) o de un HTTP monitor (HTTP_CHECK)
 * por localización y por paso o petición (ficha 0023, canal
 * `entities:monitorBreakdown`). Lo observado en vivo (tabla de "Verificación" de la
 * ficha 0023), que obliga a enviar EXACTAMENTE estas expresiones con este ámbito:
 * - `browser.duration` y `browser.step.duration` no se acotan con `entityId(...)`:
 *   traen las series de todos los monitores. Las acota
 *   `filter(eq("dt.entity.synthetic_test","<id>"))`;
 * - `browser.availability` y las de localización de HTTP sí se acotan con `entityId`;
 * - `http.request.duration.geo` no tiene la dimensión del monitor: con `entityId`
 *   sale vacía; la acota `type("HTTP_CHECK_STEP"),fromRelationships.isStepOf(...)`;
 * - con `:names`, `dimensionMap` trae `<dimensión>.name`; ninguna dimensión trae el
 *   número de secuencia del paso, así que los pasos van por duración;
 * - las series de cada métrica no llegan en el mismo orden: se casan por id;
 * - el `metricId` devuelto quita las comillas de los valores del filtro: los
 *   resultados se casan por posición;
 * - el browser monitor no tiene métrica de fallidas por localización; en HTTP, sin
 *   fallos la localización no trae serie de FAILURE (0 fallidas).
 * Todas con `resolution=Inf` (valor del rango, sin `fold`).
 */

const B = 'builtin:synthetic.browser.'
const H = 'builtin:synthetic.http.'
const LOCATION_DIM = 'dt.entity.synthetic_location'
const BY_LOCATION = `:splitBy("${LOCATION_DIM}")`
const STEP_DIM: Record<MonitorKind, string> = {
  browser: 'dt.entity.synthetic_test_step',
  http: 'dt.entity.http_check_step'
}

/** Una consulta del desglose: selector, ámbito y qué papel tiene cada posición. */
export interface BreakdownQuery {
  metricSelector: string
  entitySelector: string
  roles: ('availability' | 'duration' | 'failed' | 'steps')[]
}

/**
 * Filtro por el monitor para las métricas de browser que no se acotan con
 * `entityId`. El id ya viene validado (`monitorEntityIdSchema`): no puede cerrar la
 * comilla ni el paréntesis.
 */
const browserFilter = (entityId: string): string =>
  `:filter(eq("dt.entity.synthetic_test","${entityId}"))`

/** entitySelector de las peticiones de un HTTP monitor, por la relación isStepOf. */
export function httpStepSelector(entityId: string): string {
  return `type("HTTP_CHECK_STEP"),fromRelationships.isStepOf(entityId("${entityId}"))`
}

/** Las consultas de cada tipo, con las expresiones confirmadas en vivo. */
export function monitorBreakdownQueries(kind: MonitorKind, entityId: string): BreakdownQuery[] {
  const monitor = monitorEntitySelector(entityId)
  if (kind === 'browser') {
    return [
      {
        metricSelector: [
          `${B}availability${BY_LOCATION}:avg:names`,
          `${B}duration${browserFilter(entityId)}${BY_LOCATION}:avg:names`,
          `${B}step.duration${browserFilter(entityId)}:splitBy("${STEP_DIM.browser}"):avg:names`
        ].join(','),
        entitySelector: monitor,
        roles: ['availability', 'duration', 'steps']
      }
    ]
  }
  return [
    {
      metricSelector: [
        `${H}availability${BY_LOCATION}:avg:names`,
        `${H}duration.geo${BY_LOCATION}:avg:names`,
        `${H}resultStatus:filter(eq("Result status","FAILURE"))${BY_LOCATION}:sum:names`
      ].join(','),
      entitySelector: monitor,
      roles: ['availability', 'duration', 'failed']
    },
    {
      metricSelector: `${H}request.duration.geo:splitBy("${STEP_DIM.http}"):avg:names`,
      entitySelector: httpStepSelector(entityId),
      roles: ['steps']
    }
  ]
}

interface Entry {
  name: string | null
  value: number | null
}

/** Las series de un resultado, por id de la dimensión; una serie sin el id se descarta. */
function byEntity(data: MetricData, index: number, dimension: string): Map<string, Entry> {
  const entries = new Map<string, Entry>()
  for (const series of data.result[index]?.data ?? []) {
    const id = series.dimensionMap[dimension]
    if (id === undefined || id === '') continue
    entries.set(id, {
      name: series.dimensionMap[`${dimension}.name`] ?? null,
      value: series.values[0] ?? null
    })
  }
  return entries
}

/** Ids de todas las series, en el orden en que aparecen, con su nombre (o el id). */
function entitiesOf(maps: Map<string, Entry>[]): Map<string, string> {
  const names = new Map<string, string | null>()
  for (const map of maps) {
    for (const [id, entry] of map) {
      if (!names.has(id) || names.get(id) === null) names.set(id, entry.name)
    }
  }
  return new Map([...names].map(([id, name]) => [id, name ?? id]))
}

/** De menor a mayor; los null, al final. `sort` es estable. */
function ascending(a: number | null, b: number | null): number {
  if (a === null) return b === null ? 0 : 1
  if (b === null) return -1
  return a - b
}

/** De mayor a menor; los null, al final. */
function descending(a: number | null, b: number | null): number {
  if (a === null) return b === null ? 0 : 1
  if (b === null) return -1
  return b - a
}

const EMPTY = new Map<string, Entry>()

/**
 * Junta las respuestas (una por consulta de `monitorBreakdownQueries`, en el mismo
 * orden) en localizaciones y pasos.
 */
export function toMonitorBreakdown(
  kind: MonitorKind,
  queries: BreakdownQuery[],
  responses: MetricData[]
): MonitorBreakdownResult {
  const role = (name: BreakdownQuery['roles'][number], dimension: string): Map<string, Entry> => {
    for (const [q, query] of queries.entries()) {
      const index = query.roles.indexOf(name)
      const data = responses[q]
      if (index !== -1 && data !== undefined) return byEntity(data, index, dimension)
    }
    return EMPTY
  }
  const availability = role('availability', LOCATION_DIM)
  const duration = role('duration', LOCATION_DIM)
  // Browser no tiene métrica de fallidas por localización: null. HTTP: sin serie, 0.
  const hasFailed = queries.some((query) => query.roles.includes('failed'))
  const failed = role('failed', LOCATION_DIM)

  const locations: MonitorLocation[] = [...entitiesOf([availability, duration, failed])].map(
    ([id, name]) => ({
      id,
      name,
      availability: availability.get(id)?.value ?? null,
      duration: duration.get(id)?.value ?? null,
      failed: hasFailed ? (failed.get(id)?.value ?? 0) : null
    })
  )
  locations.sort((a, b) => ascending(a.availability, b.availability))

  const stepMap = role('steps', STEP_DIM[kind])
  const total = [...stepMap.values()].reduce((sum, entry) => sum + (entry.value ?? 0), 0)
  const steps: MonitorStep[] = [...entitiesOf([stepMap])].map(([id, name]) => {
    const value = stepMap.get(id)?.value ?? null
    return {
      id,
      name,
      duration: value,
      share: value === null || total <= 0 ? null : (value / total) * 100
    }
  })
  steps.sort((a, b) => descending(a.duration, b.duration))

  return {
    locations,
    steps,
    warnings: [...new Set(responses.flatMap((data) => data.warnings ?? []))],
    partial: responses.flatMap(truncatedResults)
  }
}
