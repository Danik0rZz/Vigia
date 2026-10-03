/**
 * Endpoints con lista paginada de la API v2 clásica (relativos a `<url>/api/v2`).
 *
 * `keepOnNextPage`: parámetros que se repiten al pedir la página siguiente. La
 * API v2 exige omitir todos salvo `nextPageKey`; la única excepción es
 * /problems, que admite (y necesita) repetir `fields` (APIv2.json, parámetro
 * nextPageKey de cada endpoint). Es obligatorio para que nadie lo olvide.
 */
export interface DtListEndpoint {
  path: string
  /** Propiedad de la respuesta con la lista. */
  itemsKey: string
  keepOnNextPage: readonly string[]
}

export const DT_ENDPOINTS = {
  problems: { path: '/problems', itemsKey: 'problems', keepOnNextPage: ['fields'] },
  entities: { path: '/entities', itemsKey: 'entities', keepOnNextPage: [] },
  entityTypes: { path: '/entityTypes', itemsKey: 'types', keepOnNextPage: [] },
  slo: { path: '/slo', itemsKey: 'slo', keepOnNextPage: [] },
  events: { path: '/events', itemsKey: 'events', keepOnNextPage: [] },
  eventTypes: { path: '/eventTypes', itemsKey: 'eventTypeInfos', keepOnNextPage: [] },
  metrics: { path: '/metrics', itemsKey: 'metrics', keepOnNextPage: [] }
} as const satisfies Record<string, DtListEndpoint>

export type DtQueryValue = string | number | boolean | readonly string[] | undefined

/** Parámetros de la página siguiente: `nextPageKey` y lo que el endpoint permite repetir. */
export function nextPageQuery(
  endpoint: DtListEndpoint,
  firstQuery: Readonly<Record<string, DtQueryValue>> | undefined,
  nextPageKey: string
): Record<string, Exclude<DtQueryValue, undefined>> {
  const query: Record<string, Exclude<DtQueryValue, undefined>> = { nextPageKey }
  for (const key of endpoint.keepOnNextPage) {
    const value = firstQuery?.[key]
    if (value !== undefined) query[key] = value
  }
  return query
}
