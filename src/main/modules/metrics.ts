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
      /** < 1 si la API ha recortado puntos o dimensiones (observado en vivo). */
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

/** Una serie por combinación de métrica y dimensiones. */
export function toMetricSeries(data: z.output<typeof metricDataSchema>): MetricResult {
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
    // Solo los resultados recortados: un ratio < 1 (el que no lo sea, a null).
    partial: data.result.flatMap((metric) => {
      const ratio = (value: number | undefined): number | null =>
        value !== undefined && value < 1 ? value : null
      const dataPoints = ratio(metric.dataPointCountRatio)
      const dimensions = ratio(metric.dimensionCountRatio)
      return dataPoints === null && dimensions === null
        ? []
        : [{ metricId: metric.metricId, dataPoints, dimensions }]
    })
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
