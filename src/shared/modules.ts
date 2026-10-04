import { z } from 'zod'

/** Datos de los módulos tal como los ve la interfaz (salida de los canales IPC). */

export const problemStatuses = ['OPEN', 'CLOSED'] as const
export const severityLevels = [
  'AVAILABILITY',
  'CUSTOM_ALERT',
  'ERROR',
  'INFO',
  'MONITORING_UNAVAILABLE',
  'PERFORMANCE',
  'RESOURCE_CONTENTION'
] as const
export const impactLevels = ['APPLICATION', 'ENVIRONMENT', 'INFRASTRUCTURE', 'SERVICES'] as const
export type SeverityLevel = (typeof severityLevels)[number]

/**
 * Orden de gravedad, de peor a menos grave (severityLevels es alfabético, el
 * del enum de la API, y no sirve para ordenar). Lo decidió peticiones.
 */
export const SEVERITY_ORDER: readonly SeverityLevel[] = [
  'AVAILABILITY',
  'ERROR',
  'PERFORMANCE',
  'RESOURCE_CONTENTION',
  'CUSTOM_ALERT',
  'MONITORING_UNAVAILABLE',
  'INFO'
]

/** Posición en SEVERITY_ORDER (menor = más grave); un valor desconocido va al final. */
export function severityRank(severity: string): number {
  const index = (SEVERITY_ORDER as readonly string[]).indexOf(severity)
  return index === -1 ? SEVERITY_ORDER.length : index
}
export type ImpactLevel = (typeof impactLevels)[number]

export const entityRefSchema = z.object({
  id: z.string(),
  type: z.string(),
  name: z.string().nullable()
})
export type EntityRef = z.output<typeof entityRefSchema>

export const problemSummarySchema = z.object({
  problemId: z.string(),
  displayId: z.string(),
  title: z.string(),
  status: z.enum(problemStatuses),
  /**
   * Texto, no enum: Dynatrace puede añadir valores. Los conocidos se traducen
   * (severityLevels, impactLevels); uno nuevo se muestra tal cual.
   */
  severityLevel: z.string(),
  impactLevel: z.string(),
  startTime: z.number(),
  /** null si el problema sigue abierto. */
  endTime: z.number().nullable(),
  affectedEntities: z.array(entityRefSchema),
  impactedEntities: z.array(entityRefSchema),
  rootCause: entityRefSchema.nullable(),
  managementZones: z.array(z.string()),
  /** De "k8s.namespace.name"; vacío si no viene. */
  namespaces: z.array(z.string()),
  /** De "k8s.cluster.name" (no lo declara la OpenAPI); vacío si no viene. */
  clusters: z.array(z.string())
})
export type ProblemSummary = z.output<typeof problemSummarySchema>

/** Detalle de un problema: el resumen más lo que llega con `fields`. */
export const problemDetailOutputSchema = problemSummarySchema.extend({
  entityTags: z.array(z.string()),
  linkedProblem: z
    .object({ displayId: z.string().nullable(), problemId: z.string().nullable() })
    .nullable(),
  evidence: z.array(
    z.object({
      type: z.string(),
      name: z.string(),
      entity: z.string().nullable(),
      startTime: z.number().nullable()
    })
  ),
  impacts: z.array(
    z.object({
      type: z.string(),
      entity: z.string().nullable(),
      estimatedAffectedUsers: z.number().nullable()
    })
  ),
  comments: z.array(
    z.object({
      author: z.string().nullable(),
      content: z.string(),
      createdAt: z.number().nullable()
    })
  ),
  /** Evidencias, impactos y comentarios descartados por no cumplir el esquema. */
  invalid: z.number().int().min(0)
})
export type ProblemDetail = z.output<typeof problemDetailOutputSchema>

export const metricResultSchema = z.object({
  resolution: z.string(),
  series: z.array(
    z.object({
      metricId: z.string(),
      dimensions: z.record(z.string(), z.string()),
      timestamps: z.array(z.number()),
      values: z.array(z.number().nullable())
    })
  ),
  warnings: z.array(z.string()),
  /** Resultados que la API ha recortado (ratio de puntos o de dimensiones < 1). */
  partial: z.array(
    z.object({
      metricId: z.string(),
      dataPoints: z.number().nullable(),
      dimensions: z.number().nullable()
    })
  )
})
export type MetricResult = z.output<typeof metricResultSchema>

export const metricInfoSchema = z.object({
  metricId: z.string(),
  displayName: z.string().nullable(),
  unit: z.string().nullable(),
  description: z.string().nullable()
})
export type MetricInfo = z.output<typeof metricInfoSchema>

export const sloStatuses = ['SUCCESS', 'WARNING', 'FAILURE'] as const

export const sloSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(sloStatuses),
  target: z.number(),
  warning: z.number(),
  /** null si no se ha evaluado o hubo un error de cálculo. */
  evaluatedPercentage: z.number().nullable(),
  errorBudget: z.number().nullable(),
  error: z.string().nullable(),
  /** Problemas abiertos relacionados con el SLO; null si la API no lo da (sin evaluar). */
  relatedOpenProblems: z.number().nullable()
})
export type SloSummary = z.output<typeof sloSummarySchema>

/**
 * Estado que se muestra de un SLO. Sin evaluar (la API da -1, que se guarda
 * como null) el `status` no significa nada: llega SUCCESS aunque no se haya
 * calculado (observado en vivo). Entonces es UNEVALUATED, nunca SUCCESS.
 */
export function sloDisplayStatus(
  slo: Pick<SloSummary, 'status' | 'evaluatedPercentage'>
): SloSummary['status'] | 'UNEVALUATED' {
  return slo.evaluatedPercentage === null ? 'UNEVALUATED' : slo.status
}

export const savedQuerySchema = z.object({
  id: z.uuid(),
  environmentId: z.uuid(),
  name: z.string(),
  metricSelector: z.string(),
  resolution: z.string().nullable()
})
export type SavedQuery = z.output<typeof savedQuerySchema>

/** Resolución de /metrics/query: N puntos, un intervalo (10m, 1h…) o Inf. */
export const resolutionSchema = z.string().regex(/^(Inf|\d+|\d+[mhdwMqy])$/)

/** Módulos con exportación (el nombre va en el fichero exportado). */
export const exportModules = ['home', 'problems', 'metrics', 'slos'] as const
export type ExportModule = (typeof exportModules)[number]

export const exportColumnSchema = z.object({
  key: z.string().min(1).max(100),
  header: z.string().max(200),
  type: z.enum(['string', 'number', 'date'])
})
export type ExportColumn = z.output<typeof exportColumnSchema>
export type ExportRow = Record<string, string | number | null>

/** Límites de lo que el renderer puede mandar a exportar por IPC. */
export const MAX_EXPORT_ROWS = 100_000
export const MAX_EXPORT_JSON_BYTES = 20 * 1024 * 1024
/** PNG en data URL: unos 15 MB de imagen (base64 ocupa 4/3). */
export const MAX_CAPTURE_BYTES = 15 * 1024 * 1024
export const MAX_CAPTURE_DATA_URL = Math.ceil((MAX_CAPTURE_BYTES * 4) / 3) + 100

/** Etiquetas del XLSX (hojas y filas de Info), en el idioma de la interfaz. */
export const xlsxLabelsSchema = z.object({
  dataSheet: z.string().min(1).max(60),
  infoSheet: z.string().min(1).max(60),
  client: z.string().min(1).max(60),
  environment: z.string().min(1).max(60),
  module: z.string().min(1).max(60),
  query: z.string().min(1).max(60),
  exported: z.string().min(1).max(60),
  timeZone: z.string().min(1).max(60),
  range: z.string().min(1).max(60),
  from: z.string().min(1).max(60),
  to: z.string().min(1).max(60),
  /** Opcional: solo hace falta si la exportación lleva nota. */
  note: z.string().min(1).max(60).optional(),
  /** Opcional: etiqueta de cada aviso de los datos. */
  warning: z.string().min(1).max(60).optional(),
  /** Opcional: etiqueta de la fila con los elementos descartados. */
  invalidItems: z.string().min(1).max(60).optional(),
  /** Opcional: etiqueta de la fila del filtro de clúster. */
  clusterFilter: z.string().min(1).max(60).optional(),
  /** Opcional: etiqueta de la fila de la resolución (Métricas). */
  resolution: z.string().min(1).max(60).optional()
})
export type XlsxLabels = z.output<typeof xlsxLabelsSchema>

export const exportSettingsSchema = z.object({
  csvSeparator: z.enum([';', ',']),
  /** Pie con cliente, entorno y fecha en las capturas de gráficos. */
  captureFooter: z.boolean()
})
export type ExportSettings = z.output<typeof exportSettingsSchema>
