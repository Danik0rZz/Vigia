import { describe, expect, it } from 'vitest'
import { sortRows } from '@shared/grid-sort'
import type { ProcessGroupInstance, ProcessGroupMetricsResult } from '@shared/modules'
import {
  DEFAULT_INSTANCE_SORT,
  hostLabel,
  hostLinkId,
  instanceComparators,
  instanceLinkId,
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

  it('recortada si main avisa en partial', () => {
    const data = { partial: [] } as unknown as ProcessGroupMetricsResult
    expect(instancesTruncated(data)).toBe(false)
    expect(
      instancesTruncated({
        partial: [{ metricId: 'x', dataPointCountRatio: 0, dimensionCountRatio: 1.5 }]
      } as unknown as ProcessGroupMetricsResult)
    ).toBe(true)
  })
})
