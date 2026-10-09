import type { UseQueryResult } from '@tanstack/react-query'

/** Estado de una lista de consultas como si fuera una: los datos, en orden, solo con todos. */
export interface QueryListState<T> {
  /** Los datos de cada consulta, en el orden pedido; undefined mientras falte alguno. */
  data: T[] | undefined
  /** Cuándo llegó el último. */
  dataUpdatedAt: number
  isError: boolean
  /** El error de la primera que falló. */
  error: unknown
  isFetching: boolean
  /** Con alguna fallida, solo esas; si no, todas. */
  refetch: () => Promise<unknown>
}

/** Junta varias consultas en una (`combine` de `useQueries`: el resultado no cambia sin datos nuevos). */
export function combineQueries<T>(results: UseQueryResult<T>[]): QueryListState<T> {
  const failed = results.filter((result) => result.isError)
  const data = results.map((result) => result.data)
  return {
    data: data.every((item) => item !== undefined) ? (data as T[]) : undefined,
    dataUpdatedAt: Math.max(0, ...results.map((result) => result.dataUpdatedAt)),
    isError: failed.length > 0,
    error: failed[0]?.error ?? null,
    isFetching: results.some((result) => result.isFetching),
    refetch: () =>
      Promise.all((failed.length > 0 ? failed : results).map((result) => result.refetch()))
  }
}
