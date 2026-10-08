import { z } from 'zod'
import { evidenceWireSchema } from './problem-evidence'

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
 * Id de entidad estándar de Dynatrace (`SERVICE-0123456789ABCDEF`): tipo en
 * mayúsculas y 16 hexadecimales. Va dentro de un selector que construye main,
 * así que no admite comillas, paréntesis, comas ni tipos personalizados (`:`).
 */
export const entityIdSchema = z.string().regex(/^[A-Z][A-Z0-9_]*-[0-9A-F]{16}$/)

/** Máximo de ids por relación en `entities:get` y por petición en `entities:names` (ficha 0014). */
export const MAX_ENTITY_IDS = 50
/** Largo máximo del texto de una propiedad de entidad (`entities:get`). */
export const MAX_ENTITY_PROPERTY_LENGTH = 300

/** Tipo de un id de entidad estándar: lo que va antes del guion (`SERVICE`, `HOST`…). */
export function entityTypeOf(entityId: string): string {
  return entityId.slice(0, entityId.lastIndexOf('-'))
}

/**
 * Ids para resolver sus nombres (`entities:names`): de 1 a 50, cada uno con el
 * formato estricto de `entityIdSchema` y todos del mismo tipo, porque la API
 * rechaza con 400 un `entityId(...)` con tipos mezclados (ficha 0014, paso 0).
 */
export const entityIdBatchSchema = z
  .array(entityIdSchema)
  .min(1)
  .max(MAX_ENTITY_IDS)
  .refine((ids) => new Set(ids.map(entityTypeOf)).size === 1, {
    message: 'Todos los ids deben ser del mismo tipo'
  })

/** Una relación de la entidad: dirección, nombre, hasta 50 ids y cuántos había. */
export const entityRelationshipSchema = z.object({
  direction: z.enum(['from', 'to']),
  name: z.string(),
  entities: z.array(z.object({ id: z.string(), type: z.string() })).max(MAX_ENTITY_IDS),
  total: z.number().int().min(0)
})
export type EntityRelationship = z.output<typeof entityRelationshipSchema>

/**
 * Datos de una entidad (canal `entities:get`, ficha 0014), ya preparados para la
 * vista. Las propiedades son texto del tenant: la vista las pinta como texto,
 * nunca como HTML.
 */
export const entityDataSchema = z.object({
  displayName: z.string(),
  type: z.string(),
  /** Epoch ms; null si la API no lo da. */
  firstSeen: z.number().nullable(),
  lastSeen: z.number().nullable(),
  /** `icon.primaryIconType`; null si no viene. */
  iconType: z.string().nullable(),
  managementZones: z.array(z.string()),
  tags: z.array(z.string()),
  /** Todas, en el orden de la respuesta, con el valor a texto y recortado a 300. */
  properties: z.array(
    z.object({ key: z.string(), text: z.string().max(MAX_ENTITY_PROPERTY_LENGTH) })
  ),
  relationships: z.array(entityRelationshipSchema)
})
export type EntityData = z.output<typeof entityDataSchema>

/** Nombres de una lista de ids (canal `entities:names`); `missing`, los que la API no da. */
export const entityNamesSchema = z.object({
  names: z.array(z.object({ id: z.string(), name: z.string() })),
  missing: z.array(z.string())
})
export type EntityNames = z.output<typeof entityNamesSchema>

/** Problemas abiertos y cerrados de una entidad; null si la API no da `totalCount`. */
export const entityProblemCountsSchema = z.object({
  open: z.number().int().min(0).nullable(),
  closed: z.number().int().min(0).nullable()
})
export type EntityProblemCounts = z.output<typeof entityProblemCountsSchema>

/**
 * Problema que afecta a una entidad, con lo justo para la franja del gráfico
 * «Tasa de error» (ficha 0010). `endTime` es null si sigue abierto.
 */
export const entityProblemSchema = z.object({
  problemId: z.string(),
  displayId: z.string(),
  title: z.string(),
  status: z.enum(problemStatuses),
  severityLevel: z.string(),
  startTime: z.number(),
  endTime: z.number().nullable()
})
export type EntityProblem = z.output<typeof entityProblemSchema>

/** Lista de problemas de una entidad en el rango (canal `entities:problems`). */
export const entityProblemListSchema = z.object({
  problems: z.array(entityProblemSchema),
  /** Total real según la API (puede ser mayor que lo traído); null si no lo da. */
  totalCount: z.number().nullable(),
  truncated: z.boolean(),
  /** Elementos descartados por no cumplir el esquema. */
  invalid: z.number().int().min(0)
})
export type EntityProblemList = z.output<typeof entityProblemListSchema>

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

/** Comentario de un problema: solo la fecha es obligatoria (OpenAPI). */
export const problemCommentSchema = z.object({
  author: z.string().nullable(),
  content: z.string(),
  context: z.string().nullable(),
  createdAt: z.number()
})
export type ProblemComment = z.output<typeof problemCommentSchema>

/** Detalle de un problema: el resumen más lo que llega con `fields`. */
export const problemDetailOutputSchema = problemSummarySchema.extend({
  entityTags: z.array(z.string()),
  linkedProblem: z
    .object({ displayId: z.string().nullable(), problemId: z.string().nullable() })
    .nullable(),
  evidence: z.array(evidenceWireSchema),
  /** totalCount de evidenceDetails: si es mayor que lo recibido, la API ha recortado. */
  evidenceTotal: z.number().int().min(0).nullable(),
  /** Evidencias que mandó la API, también las ilegibles: el recorte se mide con esto. */
  evidenceReceived: z.number().int().min(0),
  comments: z.array(problemCommentSchema),
  /** totalCount de recentComments: los recientes son solo una parte. */
  commentTotal: z.number().int().min(0).nullable(),
  /** Comentarios que mandó la API, también los ilegibles. */
  commentReceived: z.number().int().min(0),
  /** Evidencias y comentarios descartados por no cumplir el esquema. */
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
  /**
   * Resultados que la API ha recortado: ratio de puntos o de dimensiones > 1
   * (la OpenAPI los define como «pedido / máximo permitido»; ficha 0006).
   */
  partial: z.array(
    z.object({
      metricId: z.string(),
      dataPoints: z.number().nullable(),
      dimensions: z.number().nullable()
    })
  )
})
export type MetricResult = z.output<typeof metricResultSchema>

/**
 * Id de una entidad SERVICE de Dynatrace. Main construye los selectores con él,
 * así que el formato estricto impide inyectar nada en ellos (ficha 0006).
 */
export const serviceEntityIdSchema = z.string().regex(/^SERVICE-[0-9A-F]{16}$/)

/** Una serie del servicio: `values[i]` es el valor en `timestamps[i]` (null sin dato). */
const serviceSeriesSchema = z.object({
  timestamps: z.array(z.number()),
  values: z.array(z.number().nullable())
})
export type ServiceSeries = z.output<typeof serviceSeriesSchema>

/** Métricas de un servicio en el rango (canal `entities:serviceMetrics`). */
export const serviceMetricsResultSchema = z.object({
  /** Resolución que devolvió la API para las series (por ejemplo, 1m o 1h). */
  resolution: z.string(),
  series: z.object({
    /** Tiempos de respuesta en milisegundos. */
    responseTime: z.object({
      median: serviceSeriesSchema,
      p90: serviceSeriesSchema,
      p99: serviceSeriesSchema
    }),
    requests: serviceSeriesSchema,
    errors: serviceSeriesSchema,
    /** Peticiones sin error (peticiones − errores, nunca negativo). */
    ok: serviceSeriesSchema,
    /** Tasa de error en porcentaje (0–100). */
    errorRate: serviceSeriesSchema
  }),
  totals: z.object({
    requests: z.number().min(0),
    errors: z.number().min(0),
    ok: z.number().min(0),
    /** errors / requests × 100; null sin peticiones. */
    errorRate: z.number().nullable(),
    /** Tiempos del rango completo, en milisegundos; null sin dato. */
    responseTime: z.object({
      median: z.number().nullable(),
      p90: z.number().nullable(),
      p99: z.number().nullable()
    })
  }),
  warnings: z.array(z.string()),
  partial: metricResultSchema.shape.partial
})
export type ServiceMetricsResult = z.output<typeof serviceMetricsResultSchema>

/**
 * Id de una entidad HOST de Dynatrace (ficha 0016). Como el del servicio: main
 * construye el entitySelector con él y el formato estricto impide inyectar nada.
 */
export const hostEntityIdSchema = z.string().regex(/^HOST-[0-9A-F]{16}$/)

/** Una serie del host: `values[i]` es el valor en `timestamps[i]` (null sin dato). */
export type HostSeries = ServiceSeries

/**
 * Métricas de un host en el rango (canal `entities:hostMetrics`, ficha 0016).
 * Unidades sin convertir: % en 0–100, bytes y bits/s (la interfaz los formatea).
 */
export const hostMetricsResultSchema = z.object({
  /** Resolución que devolvió la API para las series (por ejemplo, 1m o 1h). */
  resolution: z.string(),
  series: z.object({
    /** CPU total, en %. */
    cpu: serviceSeriesSchema,
    /** Componentes de la CPU, en %; no suman el total (hay más componentes). */
    cpuBreakdown: z.object({
      user: serviceSeriesSchema,
      system: serviceSeriesSchema,
      iowait: serviceSeriesSchema
    }),
    /** Memoria usada, en %. */
    memory: serviceSeriesSchema,
    /** Tráfico de todas las interfaces sumadas, en bits/s. */
    network: z.object({ in: serviceSeriesSchema, out: serviceSeriesSchema }),
    /** El % de uso del disco más lleno en cada punto. */
    disk: serviceSeriesSchema
  }),
  /** Marcadores del rango completo; null sin dato. */
  totals: z.object({
    cpu: z.object({ avg: z.number().nullable(), max: z.number().nullable() }),
    /** avg en %; used y total en bytes, del último punto con dato. */
    memory: z.object({
      avg: z.number().nullable(),
      used: z.number().nullable(),
      total: z.number().nullable()
    }),
    /** Medias del rango, en bits/s. */
    network: z.object({ in: z.number().nullable(), out: z.number().nullable() }),
    /** Máximo del rango del disco más lleno, en %. */
    disk: z.object({ max: z.number().nullable() }),
    /** Carga media (sin unidad). */
    load: z.object({ avg: z.number().nullable() })
  }),
  warnings: z.array(z.string()),
  partial: metricResultSchema.shape.partial
})
export type HostMetricsResult = z.output<typeof hostMetricsResultSchema>

/** Un disco del host (ficha 0017). Unidades sin convertir: % en 0–100, bytes y bytes/s. */
export const hostDiskSchema = z.object({
  id: z.string(),
  /** De dimensionMap; si no llega, el id. */
  name: z.string(),
  /** Uso en %: último dato con valor y máximo del rango. */
  usedPct: z.object({ last: z.number().nullable(), max: z.number().nullable() }),
  /** Bytes usados y libres, del último dato con valor. */
  used: z.number().nullable(),
  avail: z.number().nullable(),
  /** Lectura y escritura medias del rango, en bytes/s. */
  read: z.number().nullable(),
  write: z.number().nullable()
})
export type HostDisk = z.output<typeof hostDiskSchema>

/** Un proceso del host (ficha 0017): CPU media y máxima (%) y memoria media (bytes). */
export const hostProcessSchema = z.object({
  id: z.string(),
  name: z.string(),
  cpu: z.object({ avg: z.number().nullable(), max: z.number().nullable() }),
  memory: z.number().nullable()
})
export type HostProcess = z.output<typeof hostProcessSchema>

/**
 * Discos y procesos de un host en el rango (canal `entities:hostBreakdown`, ficha
 * 0017): todos los discos, del más lleno al menos, y los 10 procesos con más CPU
 * media, con `total` de procesos del host.
 */
export const hostBreakdownResultSchema = z.object({
  disks: z.array(hostDiskSchema),
  processes: z.object({
    items: z.array(hostProcessSchema),
    total: z.number().int().nonnegative()
  }),
  warnings: z.array(z.string()),
  partial: metricResultSchema.shape.partial
})
export type HostBreakdownResult = z.output<typeof hostBreakdownResultSchema>

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
