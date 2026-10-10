import { describe, expect, it } from 'vitest'
import type { MetricData } from './metrics'
import {
  ascending,
  descending,
  lastValue,
  mergeMeta,
  namesOf,
  seriesAt,
  seriesByDimension,
  singleValue
} from './metric-series'

/**
 * Ficha 0057: código común para transformar las respuestas de `GET /metrics/query`
 * (forma `MetricData` de la Environment API v2) en todos los canales de entidad.
 *
 * Forma de las funciones (decisión del test-writer, delegada y refinable; en la ficha):
 * - `seriesAt(data, index)`: la primera serie del resultado en la posición `index` (los
 *   resultados se casan por posición, no por `metricId`, ficha 0040), o una vacía. Admite
 *   `index` undefined (la métrica no está en la consulta);
 * - `singleValue(data, index)`: el único valor de una consulta con `resolution=Inf`, o null;
 * - `lastValue(values)`: el último punto con dato de una lista de valores, o null;
 * - `seriesByDimension(data, index, dimension)`: las series del resultado `index` por id de la
 *   dimensión, con `{ name, values }` (el nombre de `<dimension>.name`, que solo llega con
 *   `:names`); una serie sin id se descarta;
 * - `namesOf(maps)`: id → nombre de todas las series, en orden de aparición, con el primer
 *   nombre que llegue y el id si no llega ninguno;
 * - `ascending`/`descending`: comparadores con los null al final;
 * - `mergeMeta(responses)`: `{ warnings, partial }` de varias respuestas (avisos sin repetir y
 *   resultados recortados, con ratio > 1, de todas).
 */

const T0 = Date.parse('2026-10-03T08:00:00.000Z')
const T = [T0, T0 + 60_000, T0 + 120_000]
const HOST_A = 'HOST-0123456789ABCDEF'
const HOST_B = 'HOST-FEDCBA9876543210'
const DIM = 'dt.entity.host'

type Result = MetricData['result'][number]
type Series = Result['data'][number]

function series(values: (number | null)[], dimensionMap: Record<string, string> = {}): Series {
  return { dimensionMap, timestamps: T.slice(0, values.length), values }
}

function result(metricId: string, data: Series[], extra: Partial<Result> = {}): Result {
  return { metricId, data, ...extra }
}

function metricData(results: Result[], warnings?: string[]): MetricData {
  return {
    resolution: '1m',
    totalCount: results.length,
    ...(warnings === undefined ? {} : { warnings }),
    result: results
  }
}

describe('CA1 (0057): seriesAt casa por posición y cubre los bordes', () => {
  it('devuelve la serie de la posición pedida aunque el metricId no sea la expresión enviada', () => {
    // Dynatrace quita las comillas del filtro: el metricId no sirve para casar (ficha 0040).
    const data = metricData([
      result('builtin:host.cpu.usage:filter(eq(dt.entity.host,HOST-0123456789ABCDEF))', [
        series([1, 2, 3])
      ]),
      result('builtin:host.mem.usage', [series([4, 5, 6])])
    ])
    expect(seriesAt(data, 1)).toEqual({ timestamps: T, values: [4, 5, 6] })
    expect(seriesAt(data, 0)).toEqual({ timestamps: T, values: [1, 2, 3] })
  })

  it('serie vacía: sin series en la posición, fuera de rango o sin posición, vacía', () => {
    const data = metricData([result('builtin:host.cpu.usage', [])])
    const empty = { timestamps: [], values: [] }
    expect(seriesAt(data, 0)).toEqual(empty)
    expect(seriesAt(data, 5)).toEqual(empty)
    expect(seriesAt(data, undefined)).toEqual(empty)
  })

  it('con varias series en la posición, toma la primera', () => {
    const data = metricData([result('builtin:host.cpu.usage', [series([7]), series([8])])])
    expect(seriesAt(data, 0).values).toEqual([7])
  })
})

describe('CA1 (0057): singleValue con resolution=Inf', () => {
  it('devuelve el único valor de la serie de la posición', () => {
    const data = metricData([result('a', [series([10])]), result('b', [series([42])])])
    expect(singleValue(data, 1)).toBe(42)
  })

  it('serie vacía, punto null, posición ausente o undefined: null (nunca undefined)', () => {
    const data = metricData([result('a', []), result('b', [series([null])])])
    expect(singleValue(data, 0)).toBeNull()
    expect(singleValue(data, 1)).toBeNull()
    expect(singleValue(data, 9)).toBeNull()
    expect(singleValue(data, undefined)).toBeNull()
  })

  it('un 0 es un dato, no un null', () => {
    const data = metricData([result('a', [series([0])])])
    expect(singleValue(data, 0)).toBe(0)
  })
})

describe('CA1 (0057): lastValue busca el último punto con dato', () => {
  it('último punto null: devuelve el anterior con dato', () => {
    expect(lastValue([1, 2, null])).toBe(2)
    expect(lastValue([5, null, null])).toBe(5)
  })

  it('serie vacía, todo null o sin valores: null', () => {
    expect(lastValue([])).toBeNull()
    expect(lastValue([null, null])).toBeNull()
    expect(lastValue(undefined)).toBeNull()
  })

  it('un 0 al final es un dato', () => {
    expect(lastValue([3, 0])).toBe(0)
  })
})

describe('CA1 (0057): seriesByDimension y namesOf', () => {
  it('agrupa las series por id de la dimensión, con su nombre si llega (:names)', () => {
    const data = metricData([
      result('a', [
        series([1, 2], { [DIM]: HOST_A, [`${DIM}.name`]: 'host-a' }),
        series([3], { [DIM]: HOST_B })
      ])
    ])
    const map = seriesByDimension(data, 0, DIM)
    expect([...map.keys()]).toEqual([HOST_A, HOST_B])
    expect(map.get(HOST_A)).toEqual({ name: 'host-a', values: [1, 2] })
    expect(map.get(HOST_B)).toEqual({ name: null, values: [3] })
  })

  it('dimensión ausente o vacía: la serie se descarta', () => {
    const data = metricData([
      result('a', [
        series([1], { 'dt.entity.process_group_instance': 'PROCESS_GROUP_INSTANCE-01' }),
        series([2], { [DIM]: '' }),
        series([3], { [DIM]: HOST_A })
      ])
    ])
    const map = seriesByDimension(data, 0, DIM)
    expect([...map.keys()]).toEqual([HOST_A])
  })

  it('posición sin resultado: mapa vacío', () => {
    expect(seriesByDimension(metricData([]), 3, DIM).size).toBe(0)
  })

  it('namesOf junta los ids en orden de aparición, con el primer nombre que llegue o el id', () => {
    const first = seriesByDimension(
      metricData([result('a', [series([1], { [DIM]: HOST_B })])]),
      0,
      DIM
    )
    const second = seriesByDimension(
      metricData([
        result('b', [
          series([1], { [DIM]: HOST_A, [`${DIM}.name`]: 'host-a' }),
          series([1], { [DIM]: HOST_B, [`${DIM}.name`]: 'host-b' })
        ])
      ]),
      0,
      DIM
    )
    const third = seriesByDimension(
      metricData([result('c', [series([1], { [DIM]: HOST_A, [`${DIM}.name`]: 'otro' })])]),
      0,
      DIM
    )
    const names = namesOf([first, second, third])
    expect([...names]).toEqual([
      [HOST_B, 'host-b'],
      [HOST_A, 'host-a']
    ])
    const onlyIds = namesOf([first])
    expect(onlyIds.get(HOST_B)).toBe(HOST_B)
  })
})

describe('CA1 (0057): comparadores con los null al final', () => {
  it('descending: de mayor a menor y los null al final, estable en empates', () => {
    const items = [
      { id: 'a', v: 1 },
      { id: 'b', v: null },
      { id: 'c', v: 3 },
      { id: 'd', v: 3 },
      { id: 'e', v: null }
    ]
    const sorted = [...items].sort((x, y) => descending(x.v, y.v)).map((x) => x.id)
    expect(sorted).toEqual(['c', 'd', 'a', 'b', 'e'])
  })

  it('ascending: de menor a mayor y los null al final', () => {
    const values = [3, null, 1, 2]
    expect([...values].sort(ascending)).toEqual([1, 2, 3, null])
  })
})

describe('CA1 (0057): mergeMeta junta avisos y recortes de varias respuestas', () => {
  it('avisos duplicados: aparecen una vez, en orden de llegada', () => {
    const a = metricData([], ['aviso 1', 'aviso 2'])
    const b = metricData([], ['aviso 2', 'aviso 3', 'aviso 1'])
    const c = metricData([])
    expect(mergeMeta([a, b, c]).warnings).toEqual(['aviso 1', 'aviso 2', 'aviso 3'])
  })

  it('resultados recortados: solo los de ratio > 1, de todas las respuestas, en orden', () => {
    const a = metricData([
      result('a.ok', [], { dataPointCountRatio: 0.01, dimensionCountRatio: 0.001 }),
      result('a.cut', [], { dataPointCountRatio: 1.5, dimensionCountRatio: 0.2 })
    ])
    const b = metricData([
      result('b.cut', [], { dimensionCountRatio: 2 }),
      result('b.one', [], { dataPointCountRatio: 1, dimensionCountRatio: 1 })
    ])
    expect(mergeMeta([a, b]).partial).toEqual([
      { metricId: 'a.cut', dataPoints: 1.5, dimensions: null },
      { metricId: 'b.cut', dataPoints: null, dimensions: 2 }
    ])
  })

  it('sin respuestas o sin avisos ni recortes: listas vacías', () => {
    expect(mergeMeta([])).toEqual({ warnings: [], partial: [] })
    expect(mergeMeta([metricData([result('x', [])])])).toEqual({ warnings: [], partial: [] })
  })
})
