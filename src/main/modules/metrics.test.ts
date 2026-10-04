import { describe, expect, it } from 'vitest'
import { metricDataSchema, metricSearchSchema, resolutionSchema, toMetricSeries } from './metrics'

/** Métricas de la API v2: respuesta de /metrics/query, resolución y búsqueda. */

function queryResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    resolution: '1m',
    totalCount: 2,
    warnings: ['La consulta se ha recortado'],
    result: [
      {
        metricId: 'builtin:host.cpu.usage',
        data: [
          {
            dimensionMap: { 'dt.entity.host': 'HOST-1' },
            dimensions: ['HOST-1'],
            timestamps: [1, 2, 3],
            values: [10.5, null, 12]
          },
          {
            dimensionMap: { 'dt.entity.host': 'HOST-2' },
            timestamps: [1, 2, 3],
            values: [1, 2, 3]
          }
        ]
      }
    ],
    ...overrides
  }
}

describe('metricDataSchema y toMetricSeries', () => {
  it('aplana el resultado en series con sus dimensiones y respeta los null', () => {
    expect(toMetricSeries(metricDataSchema.parse(queryResponse()))).toEqual({
      resolution: '1m',
      series: [
        {
          metricId: 'builtin:host.cpu.usage',
          dimensions: { 'dt.entity.host': 'HOST-1' },
          timestamps: [1, 2, 3],
          values: [10.5, null, 12]
        },
        {
          metricId: 'builtin:host.cpu.usage',
          dimensions: { 'dt.entity.host': 'HOST-2' },
          timestamps: [1, 2, 3],
          values: [1, 2, 3]
        }
      ],
      warnings: ['La consulta se ha recortado'],
      partial: []
    })
  })

  describe('AUD-13: partial con dataPointCountRatio y dimensionCountRatio', () => {
    const withRatios = (ratios: Record<string, unknown>[]): Record<string, unknown> =>
      queryResponse({
        result: ratios.map((ratio, i) => ({
          metricId: `m${i + 1}`,
          data: [{ dimensionMap: {}, timestamps: [1], values: [1] }],
          ...ratio
        }))
      })
    const partialOf = (ratios: Record<string, unknown>[]): unknown =>
      toMetricSeries(metricDataSchema.parse(withRatios(ratios))).partial

    it('solo los resultados con algún ratio < 1; el otro ratio va a null', () => {
      expect(
        partialOf([
          { dataPointCountRatio: 0.5, dimensionCountRatio: 1 },
          { dataPointCountRatio: 1, dimensionCountRatio: 0.25 },
          { dataPointCountRatio: 0.1, dimensionCountRatio: 0.2 }
        ])
      ).toEqual([
        { metricId: 'm1', dataPoints: 0.5, dimensions: null },
        { metricId: 'm2', dataPoints: null, dimensions: 0.25 },
        { metricId: 'm3', dataPoints: 0.1, dimensions: 0.2 }
      ])
    })

    it('ratios 1 o ausentes → fuera', () => {
      expect(
        partialOf([
          { dataPointCountRatio: 1, dimensionCountRatio: 1 },
          {},
          { dataPointCountRatio: 1 }
        ])
      ).toEqual([])
    })

    it('ratio 0 también es recorte', () => {
      expect(partialOf([{ dataPointCountRatio: 0 }])).toEqual([
        { metricId: 'm1', dataPoints: 0, dimensions: null }
      ])
    })

    it('un ratio que no es número → la respuesta no vale', () => {
      expect(metricDataSchema.safeParse(withRatios([{ dataPointCountRatio: '0.5' }])).success).toBe(
        false
      )
    })
  })

  it('sin warnings devuelve una lista vacía', () => {
    const parsed = metricDataSchema.parse(queryResponse({ warnings: undefined }))
    expect(toMetricSeries(parsed).warnings).toEqual([])
  })

  it('junta las series de varias métricas', () => {
    const response = queryResponse({
      result: [
        { metricId: 'a', data: [{ dimensionMap: {}, timestamps: [1], values: [1] }] },
        { metricId: 'b', data: [{ dimensionMap: {}, timestamps: [1], values: [2] }] }
      ]
    })
    expect(toMetricSeries(metricDataSchema.parse(response)).series.map((s) => s.metricId)).toEqual([
      'a',
      'b'
    ])
  })

  it.each([
    ['values con texto', { values: ['x'] }],
    ['timestamps con texto', { timestamps: ['ayer'] }]
  ])('rechaza %s', (_case, change) => {
    const response = queryResponse({
      result: [
        {
          metricId: 'a',
          data: [{ dimensionMap: {}, timestamps: [1], values: [1], ...change }]
        }
      ]
    })
    expect(metricDataSchema.safeParse(response).success).toBe(false)
  })

  it('rechaza una respuesta sin result', () => {
    expect(metricDataSchema.safeParse({ resolution: '1m', totalCount: 0 }).success).toBe(false)
  })
})

describe('resolutionSchema', () => {
  it.each(['Inf', '120', '1', '1m', '5m', '1h', '1d', '1w', '1M', '1q', '1y'])(
    'acepta %s',
    (value) => {
      expect(resolutionSchema.safeParse(value).success).toBe(true)
    }
  )

  it.each(['10s', '-1', '', '1.5h', 'inf', '1H', 'm', '1 m', '1mm'])('rechaza %j', (value) => {
    expect(resolutionSchema.safeParse(value).success).toBe(false)
  })
})

describe('metricSearchSchema', () => {
  it('devuelve las métricas con null en lo que no viene', () => {
    const parsed = metricSearchSchema.parse({
      totalCount: 2,
      nextPageKey: null,
      metrics: [
        {
          metricId: 'builtin:host.cpu.usage',
          displayName: 'CPU',
          unit: 'Percent',
          description: 'Uso de CPU'
        },
        { metricId: 'ext:custom.metric' }
      ]
    })
    expect(parsed).toEqual([
      {
        metricId: 'builtin:host.cpu.usage',
        displayName: 'CPU',
        unit: 'Percent',
        description: 'Uso de CPU'
      },
      { metricId: 'ext:custom.metric', displayName: null, unit: null, description: null }
    ])
  })

  it('rechaza una métrica sin metricId', () => {
    expect(
      metricSearchSchema.safeParse({ metrics: [{ displayName: 'x' }], totalCount: 1 }).success
    ).toBe(false)
  })
})
