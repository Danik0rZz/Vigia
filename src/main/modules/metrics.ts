import { z } from 'zod'
import type { MetricInfo, MetricResult } from '@shared/modules'

export { resolutionSchema } from '@shared/modules'

/**
 * Respuesta de GET /api/v2/metrics/query (MetricData). Los valores pueden venir
 * a null cuando falta un dato, aunque la spec no los marque como nullable.
 */
export const metricDataSchema = z.object({
  resolution: z.string(),
  totalCount: z.number(),
  warnings: z.array(z.string()).optional(),
  result: z.array(
    z.object({
      metricId: z.string(),
      /**
       * Pedido / máximo permitido (OpenAPI v2): > 1 si la API ha recortado puntos o
       * dimensiones. En vivo llegan siempre, entre 0 y 0,01 en consultas normales.
       */
      dataPointCountRatio: z.number().optional(),
      dimensionCountRatio: z.number().optional(),
      data: z.array(
        z.object({
          dimensionMap: z.record(z.string(), z.string()),
          timestamps: z.array(z.number()),
          values: z.array(z.number().nullable())
        })
      )
    })
  )
})

export type MetricData = z.output<typeof metricDataSchema>

/**
 * Regla única de recorte (ficha 0006, CA6 y CA8): un ratio es de recorte si es
 * mayor que 1 (se pidieron más puntos o dimensiones de los permitidos). Si no lo
 * es, o no llega, va a null.
 */
const truncatedRatio = (value: number | undefined): number | null =>
  value !== undefined && value > 1 ? value : null

/** Solo los resultados recortados, con el ratio que no lo es a null. */
export function truncatedResults(data: MetricData): MetricResult['partial'] {
  return data.result.flatMap((metric) => {
    const dataPoints = truncatedRatio(metric.dataPointCountRatio)
    const dimensions = truncatedRatio(metric.dimensionCountRatio)
    return dataPoints === null && dimensions === null
      ? []
      : [{ metricId: metric.metricId, dataPoints, dimensions }]
  })
}

/** Una serie por combinación de métrica y dimensiones. */
export function toMetricSeries(data: MetricData): MetricResult {
  return {
    resolution: data.resolution,
    series: data.result.flatMap((metric) =>
      metric.data.map((series) => ({
        metricId: metric.metricId,
        dimensions: series.dimensionMap,
        timestamps: series.timestamps,
        values: series.values
      }))
    ),
    warnings: data.warnings ?? [],
    partial: truncatedResults(data)
  }
}

export const metricDescriptorSchema = z.object({
  metricId: z.string(),
  displayName: z.string().nullable().optional(),
  unit: z.string().nullable().optional(),
  description: z.string().nullable().optional()
})

/** Página de GET /api/v2/metrics (búsqueda por texto). */
export const metricSearchPageSchema = z.object({
  metrics: z.array(metricDescriptorSchema),
  totalCount: z.number(),
  nextPageKey: z.string().nullable().optional()
})

/** La misma página, con las métricas sin validar: se validan una a una (parseItems). */
export const metricSearchRawPageSchema = z.object({
  metrics: z.array(z.unknown()),
  totalCount: z.number(),
  nextPageKey: z.string().nullable().optional()
})

export function toMetricInfo(descriptor: z.output<typeof metricDescriptorSchema>): MetricInfo {
  return {
    metricId: descriptor.metricId,
    displayName: descriptor.displayName ?? null,
    unit: descriptor.unit ?? null,
    description: descriptor.description ?? null
  }
}

/** La página de búsqueda convertida directamente en la lista de métricas. */
export const metricSearchSchema = metricSearchPageSchema.transform((page) =>
  page.metrics.map(toMetricInfo)
)
