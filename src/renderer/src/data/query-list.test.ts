import { describe, expect, it, vi } from 'vitest'
import type { UseQueryResult } from '@tanstack/react-query'
import { combineQueries } from './query-list'

/** Ficha 0032: varias consultas como una («CPU por instancia» del process group). */
function query(overrides: Partial<UseQueryResult<number>>): UseQueryResult<number> {
  return {
    data: undefined,
    dataUpdatedAt: 0,
    isError: false,
    error: null,
    isFetching: false,
    refetch: vi.fn(() => Promise.resolve()),
    ...overrides
  } as unknown as UseQueryResult<number>
}

describe('combineQueries (0032)', () => {
  it('sin consultas, lista vacía y sin error', () => {
    expect(combineQueries([])).toMatchObject({ data: [], isError: false, dataUpdatedAt: 0 })
  })

  it('los datos, en orden, solo cuando han llegado todos; la hora, la del último', () => {
    const a = query({ data: 1, dataUpdatedAt: 10 })
    expect(combineQueries([a, query({})]).data).toBeUndefined()
    const both = combineQueries([a, query({ data: 2, dataUpdatedAt: 20, isFetching: true })])
    expect(both.data).toEqual([1, 2])
    expect(both.dataUpdatedAt).toBe(20)
    expect(both.isFetching).toBe(true)
  })

  it('con alguna fallida: su error y Reintentar repite solo las fallidas', async () => {
    const ok = query({ data: 1 })
    const failed = query({ isError: true, error: new Error('x') })
    const state = combineQueries([ok, failed])
    expect(state.isError).toBe(true)
    expect(state.error).toBeInstanceOf(Error)
    await state.refetch()
    expect(failed.refetch).toHaveBeenCalledTimes(1)
    expect(ok.refetch).not.toHaveBeenCalled()
  })

  it('sin fallos, Reintentar las repite todas', async () => {
    const a = query({ data: 1 })
    const b = query({ data: 2 })
    await combineQueries([a, b]).refetch()
    expect(a.refetch).toHaveBeenCalledTimes(1)
    expect(b.refetch).toHaveBeenCalledTimes(1)
  })
})
