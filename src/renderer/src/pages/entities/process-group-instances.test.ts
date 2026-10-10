import { describe, expect, it } from 'vitest'
import { sortRows } from '@shared/grid-sort'
import type {
  ProcessGroupInstance,
  ProcessGroupInstancesResult,
  ProcessGroupMetricsResult
} from '@shared/modules'
import {
  DEFAULT_INSTANCE_SORT,
  filterInstances,
  fullListNotice,
  hostLabel,
  hostLinkId,
  instanceComparators,
  instanceLinkId,
  instancesNotice,
  instancesTruncated
} from './process-group-instances'

/** Ficha 0032: orden, enlaces y recorte de la tabla «Instancias» del process group. */
const instance = (overrides: Partial<ProcessGroupInstance>): ProcessGroupInstance => ({
  id: 'PROCESS_GROUP_INSTANCE-0000000000000001',
  name: 'a',
  hostId: 'HOST-0000000000000001',
  hostName: 'host-a',
  cpu: 1,
  memory: 1,
  ...overrides
})

describe('tabla «Instancias» (0032)', () => {
  it('por defecto, de más a menos CPU, con las de sin dato al final', () => {
    const items = [
      instance({ id: 'A', cpu: 3 }),
      instance({ id: 'B', cpu: null }),
      instance({ id: 'C', cpu: 41.5 })
    ]
    const sorted = sortRows(items, DEFAULT_INSTANCE_SORT, instanceComparators('es'), [])
    expect(sorted.map((item) => item.id)).toEqual(['C', 'A', 'B'])
  })

  it('por host, por su nombre o, sin nombre, por su id', () => {
    const items = [
      instance({ id: 'A', hostName: 'zeta' }),
      instance({ id: 'B', hostName: null, hostId: 'HOST-000000000000000A' }),
      instance({ id: 'C', hostName: null, hostId: null })
    ]
    const sorted = sortRows(items, { key: 'host', direction: 'asc' }, instanceComparators('es'), [])
    expect(sorted.map((item) => item.id)).toEqual(['C', 'B', 'A'])
    expect(hostLabel(items[2] as ProcessGroupInstance)).toBeNull()
  })

  it('por nombre y por memoria', () => {
    const items = [
      instance({ id: 'A', name: 'b', memory: 1 }),
      instance({ id: 'B', name: 'a', memory: 2 })
    ]
    const comparators = instanceComparators('es')
    expect(sortRows(items, { key: 'name', direction: 'asc' }, comparators, [])[0]?.id).toBe('B')
    expect(sortRows(items, { key: 'memory', direction: 'desc' }, comparators, [])[0]?.id).toBe('B')
  })

  it('enlaces solo con ids válidos: la instancia, de PROCESS_GROUP_INSTANCE; el host, de HOST', () => {
    expect(instanceLinkId(instance({}))).toBe('PROCESS_GROUP_INSTANCE-0000000000000001')
    expect(instanceLinkId(instance({ id: 'otra' }))).toBeNull()
    expect(hostLinkId(instance({}))).toBe('HOST-0000000000000001')
    expect(hostLinkId(instance({ hostId: 'SERVICE-0000000000000001' }))).toBeNull()
    expect(hostLinkId(instance({ hostId: null }))).toBeNull()
  })

  // Ficha 0051 (nota del revisor de la 0050): solo sin el total real; con él, el total es exacto.
  it('recortada si main avisa en partial y no se conoce el total real', () => {
    const data = {
      partial: [],
      instances: { items: [], total: 0, totalKnown: false }
    } as unknown as ProcessGroupMetricsResult
    expect(instancesTruncated(data)).toBe(false)
    expect(
      instancesTruncated({
        partial: [{ metricId: 'x', dataPointCountRatio: 0, dimensionCountRatio: 1.5 }],
        instances: { items: [], total: 7, totalKnown: false }
      } as unknown as ProcessGroupMetricsResult)
    ).toBe(true)
    expect(
      instancesTruncated({
        partial: [{ metricId: 'x', dataPointCountRatio: 0, dimensionCountRatio: 1.5 }],
        instances: { items: [], total: 600, totalKnown: true }
      } as unknown as ProcessGroupMetricsResult)
    ).toBe(false)
  })
})

/** Ficha 0051: aviso «20 de N», buscador del modal y aviso de recorte del modal. */
const many = (n: number): ProcessGroupInstance[] =>
  Array.from({ length: n }, (_, i) => instance({ id: `I${i}`, name: `n-${i}`, cpu: n - i }))
const metrics = (
  items: ProcessGroupInstance[],
  total: number,
  totalKnown: boolean,
  partial = false
): ProcessGroupMetricsResult =>
  ({
    instances: { items, total, totalKnown },
    partial: partial ? [{ metricId: 'x', dataPointCountRatio: 0, dimensionCountRatio: 1.5 }] : []
  }) as unknown as ProcessGroupMetricsResult

describe('CA1 (0051): aviso de la tabla «Instancias»', () => {
  it('con el total real mayor que las enseñadas, «N de total»', () => {
    expect(instancesNotice(metrics(many(20), 30, true))).toEqual({
      kind: 'of',
      shown: 20,
      total: 30
    })
    expect(instancesNotice(metrics(many(20), 600, true, true))).toEqual({
      kind: 'of',
      shown: 20,
      total: 600
    })
  })

  it('con todas a la vista, sin aviso', () => {
    expect(instancesNotice(metrics(many(12), 12, true))).toBeNull()
    expect(instancesNotice(metrics(many(20), 20, true))).toBeNull()
    expect(instancesNotice(metrics(many(5), 5, false))).toBeNull()
  })

  it('sin el total real, con 20 (el tope) o recortada, «puede haber más»', () => {
    expect(instancesNotice(metrics(many(20), 20, false))).toEqual({ kind: 'maybeMore', shown: 20 })
    expect(instancesNotice(metrics(many(7), 7, false, true))).toEqual({
      kind: 'maybeMore',
      shown: 7
    })
  })
})

describe('CA4 (0051): buscador del modal', () => {
  const items = [
    instance({ id: 'A', name: 'pagos-1', hostName: 'web-01' }),
    instance({ id: 'B', name: 'cobros-2', hostName: 'BD-02' }),
    instance({ id: 'C', name: 'otro', hostName: null, hostId: 'HOST-00000000000000AB' })
  ]
  const ids = (list: ProcessGroupInstance[]): string[] => list.map((item) => item.id)

  it('por nombre o por host, sin distinguir mayúsculas ni espacios de los lados', () => {
    expect(ids(filterInstances(items, 'PAGOS'))).toEqual(['A'])
    expect(ids(filterInstances(items, ' bd-0 '))).toEqual(['B'])
    expect(ids(filterInstances(items, '000AB'))).toEqual(['C'])
    expect(ids(filterInstances(items, 'nada'))).toEqual([])
  })

  it('vacío, todas', () => {
    expect(ids(filterInstances(items, ''))).toEqual(['A', 'B', 'C'])
    expect(ids(filterInstances(items, '   '))).toEqual(['A', 'B', 'C'])
  })
})

describe('CA3 (0051): aviso de recorte del modal', () => {
  const full = (items: number, total: number, truncated: boolean): ProcessGroupInstancesResult => ({
    items: many(items),
    total,
    truncated
  })

  it('sin recorte, sin aviso', () => {
    expect(fullListNotice(full(30, 30, false))).toBeNull()
  })

  it('con el total mayor que lo recibido, «N de total»', () => {
    expect(fullListNotice(full(25, 600, true))).toEqual({ kind: 'of', shown: 25, total: 600 })
  })

  it('recortada sin un total mayor, «puede haber más»', () => {
    expect(fullListNotice(full(498, 498, true))).toEqual({ kind: 'maybeMore', shown: 498 })
  })
})
