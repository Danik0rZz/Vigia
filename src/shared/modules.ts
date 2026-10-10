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
 * Etiqueta de una entidad, separada en sus partes (ficha 0037), de `EnrichedTagDto` de la API v2:
 * `context` es `CONTEXTLESS` en las propias; `value` es null en las de solo clave.
 */
export const entityTagSchema = z.object({
  context: z.string(),
  key: z.string().min(1),
  value: z.string().nullable()
})
export type EntityTag = z.output<typeof entityTagSchema>

/** Contexto de las etiquetas propias (sin origen externo), según la OpenAPI v2. */
export const CONTEXTLESS_TAG = 'CONTEXTLESS'

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
  /** En el orden de la respuesta (ordena la vista, ficha 0037). */
  tags: z.array(entityTagSchema),
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

/**
 * Conjunto de métricas de un servicio según su `serviceType` (ficha 0046): Servidor,
 * Cliente, Unificadas o Solo actividad.
 */
export const serviceMetricSetSchema = z.enum(['server', 'client', 'unified', 'activity'])
export type ServiceMetricSet = z.output<typeof serviceMetricSetSchema>

const responseTimeSeriesSchema = z.object({
  median: serviceSeriesSchema,
  p90: serviceSeriesSchema,
  p99: serviceSeriesSchema
})

/** Métricas de un servicio en el rango (canal `entities:serviceMetrics`). */
export const serviceMetricsResultSchema = z.object({
  /** Resolución que devolvió la API para las series (por ejemplo, 1m o 1h). */
  resolution: z.string(),
  /** `serviceType` de la entidad tal cual; null si la entidad falla o no lo trae (ficha 0046). */
  serviceType: z.string().nullable(),
  /** Conjunto de métricas usado (ficha 0046). */
  metricSet: serviceMetricSetSchema,
  /**
   * Clave de métrica usada para cada papel (para «Abrir en Métricas»); null si el conjunto no
   * tiene ese papel o se calcula en main (la tasa de las unificadas).
   */
  metricKeys: z.object({
    responseTime: z.string().nullable(),
    requests: z.string().nullable(),
    errors: z.string().nullable(),
    errorRate: z.string().nullable()
  }),
  /** En Solo actividad, tiempos, errores, OK y tasa son null: ese conjunto no los mide. */
  series: z.object({
    /** Tiempos de respuesta en milisegundos. */
    responseTime: responseTimeSeriesSchema.nullable(),
    requests: serviceSeriesSchema,
    errors: serviceSeriesSchema.nullable(),
    /** Peticiones sin error (peticiones − errores, nunca negativo). */
    ok: serviceSeriesSchema.nullable(),
    /** Tasa de error en porcentaje (0–100). */
    errorRate: serviceSeriesSchema.nullable()
  }),
  totals: z.object({
    requests: z.number().min(0),
    errors: z.number().min(0).nullable(),
    ok: z.number().min(0).nullable(),
    /** errors / requests × 100; null sin peticiones. */
    errorRate: z.number().nullable(),
    /** Tiempos del rango completo, en milisegundos; null sin dato. */
    responseTime: z
      .object({
        median: z.number().nullable(),
        p90: z.number().nullable(),
        p99: z.number().nullable()
      })
      .nullable()
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
    /** Memoria usada, recuperable y total, en bytes (ficha 0039). */
    memoryBytes: z.object({
      used: serviceSeriesSchema,
      reclaimable: serviceSeriesSchema,
      total: serviceSeriesSchema
    }),
    /** Tráfico de todas las interfaces sumadas, en bits/s. */
    network: z.object({ in: serviceSeriesSchema, out: serviceSeriesSchema }),
    /** El % de uso del disco más lleno en cada punto. */
    disk: serviceSeriesSchema
  }),
  /** Marcadores del rango completo; null sin dato. */
  totals: z.object({
    cpu: z.object({ avg: z.number().nullable(), max: z.number().nullable() }),
    /** avg en %; used, total y reclaimable en bytes, del último punto con dato. */
    memory: z.object({
      avg: z.number().nullable(),
      used: z.number().nullable(),
      total: z.number().nullable(),
      reclaimable: z.number().nullable()
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

/**
 * Estado de una fuente de log tal como lo da Dynatrace (un enum en mayúsculas). Lo que no tenga
 * esa forma (una ruta, un texto libre) no sale de main (ficha 0041).
 */
export const dtLogEnumSchema = z.string().regex(/^[A-Z][A-Z0-9_]*$/)

/**
 * Un proceso del host con logs detectados (ficha 0041). Nunca lleva las rutas ni los nombres de
 * las fuentes de log (pueden llevar el usuario o el cliente): solo cuántas hay.
 */
export const hostLogProcessSchema = z.object({
  id: entityIdSchema,
  name: z.string(),
  /** `logFileStatus` (`FILE_STATUS_OK`, `FILE_STATUS_NOT_EXIST`…); null si no llega. */
  fileStatus: dtLogEnumSchema.nullable(),
  /** `storageStatus` de `logSourceState`; null si no llega. */
  sourceState: dtLogEnumSchema.nullable(),
  /** La más reciente de `logPathLastUpdate`, en epoch ms; null si no llega. */
  lastUpdate: z.number().nullable(),
  /** Fuentes de log distintas del proceso (se cuentan, no se enseñan). */
  logCount: z.number().int().nonnegative()
})
export type HostLogProcess = z.output<typeof hostLogProcessSchema>

/** Procesos del host con logs (canal `entities:hostLogs`, ficha 0041). */
export const hostLogsResultSchema = z.object({
  /** Solo los procesos con logs. */
  processes: z.array(hostLogProcessSchema),
  /** Cuántos procesos tienen logs (`processes.length`). */
  withLogs: z.number().int().nonnegative(),
  /** Cuántos procesos tiene el host. */
  total: z.number().int().nonnegative(),
  /**
   * `true` si se llegó al tope de páginas y quedaban procesos: la lista y `withLogs` pueden
   * estar cortos. Solo llega cuando es `true` (sin recorte, no viene).
   */
  truncated: z.literal(true).optional()
})
export type HostLogsResult = z.output<typeof hostLogsResultSchema>

/** Eventos que enseña la tarjeta «Eventos» del host (ficha 0042): los más recientes del rango. */
export const HOST_EVENTS_LIMIT = 20

/**
 * Un evento del host o de lo que corre en él (ficha 0042, `GET /events`). `title` es texto del
 * tenant: la interfaz lo pinta como texto, nunca como HTML.
 */
export const hostEventSchema = z.object({
  /** `eventType` de Dynatrace (`HIGH_CPU`, `PROCESS_RESTART`…). */
  eventType: z.string(),
  title: z.string(),
  /** `OPEN` o `CLOSED` (OpenAPI); otro valor se enseña tal cual. */
  status: z.string(),
  /** Inicio, en epoch ms. */
  startTime: z.number(),
  /** Fin, en epoch ms; null si el evento sigue activo (en vivo llega -1). */
  endTime: z.number().nullable(),
  entity: z.object({
    id: z.string().min(1),
    /** null si Dynatrace no trae el nombre. */
    name: z.string().nullable(),
    type: z.string()
  })
})
export type HostEvent = z.output<typeof hostEventSchema>

/** Eventos del host (canal `entities:hostEvents`, ficha 0042). */
export const hostEventsResultSchema = z.object({
  /** Como mucho `HOST_EVENTS_LIMIT`, del más reciente al más antiguo. */
  events: z.array(hostEventSchema).max(HOST_EVENTS_LIMIT),
  /** Eventos del rango según Dynatrace (la suma, si se repartió en varias consultas). */
  totalCount: z.number().int().nonnegative()
})
export type HostEventsResult = z.output<typeof hostEventsResultSchema>

/**
 * Id de un browser monitor (SYNTHETIC_TEST) o de un HTTP monitor (HTTP_CHECK) de
 * Dynatrace (ficha 0022). Como el del servicio: main construye los selectores con
 * él y el formato estricto impide inyectar nada. El tipo sale del prefijo.
 */
export const monitorEntityIdSchema = z.string().regex(/^(SYNTHETIC_TEST|HTTP_CHECK)-[0-9A-F]{16}$/)

/** Tipo de monitor: browser (SYNTHETIC_TEST) o HTTP (HTTP_CHECK). */
export const monitorKinds = ['browser', 'http'] as const
export type MonitorKind = (typeof monitorKinds)[number]

/** Una serie del monitor: `values[i]` es el valor en `timestamps[i]` (null sin dato). */
export type MonitorSeries = ServiceSeries

/**
 * Métricas de un monitor en el rango (canal `entities:monitorMetrics`, ficha 0022).
 * Unidades sin convertir: disponibilidad en % (0–100), tiempos en ms, CLS sin
 * unidad y ejecuciones en recuento. Los papeles sin métrica en el tipo llegan a null.
 */
export const monitorMetricsResultSchema = z.object({
  kind: z.enum(monitorKinds),
  /** Resolución que devolvió la API para las series (por ejemplo, 10m o 1h). */
  resolution: z.string(),
  series: z.object({
    /** Disponibilidad de todas las localizaciones juntas, en %. */
    availability: serviceSeriesSchema,
    /** Duración de la ejecución, en ms. */
    duration: serviceSeriesSchema,
    executions: z.object({ ok: serviceSeriesSchema, failed: serviceSeriesSchema }),
    /** Experiencia del browser monitor (ms; CLS sin unidad); null en HTTP. */
    performance: z
      .object({
        largestContentfulPaint: serviceSeriesSchema,
        visuallyComplete: serviceSeriesSchema,
        cumulativeLayoutShift: serviceSeriesSchema,
        speedIndex: serviceSeriesSchema
      })
      .nullable(),
    /** Tiempos del HTTP monitor, en ms; null en browser. */
    httpTimings: z
      .object({
        dns: serviceSeriesSchema,
        tcpConnect: serviceSeriesSchema,
        tlsHandshake: serviceSeriesSchema,
        timeToFirstByte: serviceSeriesSchema
      })
      .nullable()
  }),
  /** Marcadores del rango completo; null sin dato (los recuentos, 0). */
  totals: z.object({
    availability: z.number().nullable(),
    /** En ms. El HTTP monitor no tiene mediana: siempre null. */
    duration: z.object({ avg: z.number().nullable(), median: z.number().nullable() }),
    executions: z.object({ ok: z.number().min(0), failed: z.number().min(0) })
  }),
  warnings: z.array(z.string()),
  partial: metricResultSchema.shape.partial
})
export type MonitorMetricsResult = z.output<typeof monitorMetricsResultSchema>

/**
 * Id de una entidad PROCESS_GROUP_INSTANCE de Dynatrace (ficha 0027). Como el del
 * host: main construye el entitySelector con él y el formato estricto impide
 * inyectar nada.
 */
export const processEntityIdSchema = z.string().regex(/^PROCESS_GROUP_INSTANCE-[0-9A-F]{16}$/)

/** Una serie del proceso: `values[i]` es el valor en `timestamps[i]` (null sin dato). */
export type ProcessSeries = ServiceSeries

/**
 * Métricas de un proceso en el rango (canal `entities:processMetrics`, ficha 0027).
 * Unidades sin convertir: CPU, disponibilidad, retransmisiones y descriptores de
 * fichero en %, memoria en bytes y red en bytes/s. Los seis papeles tienen métrica:
 * un papel sin datos en el proceso llega con series vacías, y su marcador, a null.
 */
export const processMetricsResultSchema = z.object({
  /** Resolución que devolvió la API para las series (por ejemplo, 10m o 1h). */
  resolution: z.string(),
  series: z.object({
    /** Uso de CPU del proceso, en %. */
    cpu: serviceSeriesSchema,
    /** Working set del proceso, en bytes. */
    memory: serviceSeriesSchema,
    /** Bytes recibidos y enviados, en bytes/s. */
    network: z.object({ in: serviceSeriesSchema, out: serviceSeriesSchema }),
    /** Retransmisiones de paquetes, en %. */
    networkHealth: serviceSeriesSchema,
    /** Disponibilidad del proceso, en %. */
    availability: serviceSeriesSchema,
    /** Descriptores de fichero usados, en % (en vivo, valores en [0, 1]). */
    resources: serviceSeriesSchema
  }),
  /** Marcadores del rango completo; null sin dato. Salud de red no lleva marcador. */
  totals: z.object({
    cpu: z.object({ avg: z.number().nullable(), max: z.number().nullable() }),
    memory: z.object({ avg: z.number().nullable(), max: z.number().nullable() }),
    /** Medias del rango, en bytes/s. */
    network: z.object({ in: z.number().nullable(), out: z.number().nullable() }),
    /** Disponibilidad media, en %. */
    availability: z.number().nullable(),
    /** Máximo de descriptores de fichero usados, en %. */
    resources: z.number().nullable()
  }),
  warnings: z.array(z.string()),
  partial: metricResultSchema.shape.partial
})
export type ProcessMetricsResult = z.output<typeof processMetricsResultSchema>

/**
 * Id de una entidad PROCESS_GROUP de Dynatrace (ficha 0031). Como el del proceso:
 * main construye el entitySelector con él y el formato estricto impide inyectar nada.
 */
export const processGroupEntityIdSchema = z.string().regex(/^PROCESS_GROUP-[0-9A-F]{16}$/)

/** Una instancia del grupo (ficha 0031): medias del rango, CPU en % y memoria en bytes. */
export const processGroupInstanceSchema = z.object({
  id: z.string(),
  /** De dimensionMap; si no llega, el id. */
  name: z.string(),
  /** Host de la instancia, de dimensionMap; null si no llega. */
  hostId: z.string().nullable(),
  hostName: z.string().nullable(),
  cpu: z.number().nullable(),
  memory: z.number().nullable()
})
export type ProcessGroupInstance = z.output<typeof processGroupInstanceSchema>

/**
 * Métricas de un process group en el rango (canal `entities:processGroupMetrics`,
 * ficha 0031): el total de sus instancias (CPU en %, que puede pasar de 100;
 * memoria en bytes; red en bytes/s) y sus instancias, de más a menos CPU media. Los
 * cuatro papeles tienen métrica: sin datos, series vacías y totales a null.
 */
export const processGroupMetricsResultSchema = z.object({
  /** Resolución que devolvió la API para las series (por ejemplo, 10m o 1h). */
  resolution: z.string(),
  series: z.object({
    cpu: serviceSeriesSchema,
    memory: serviceSeriesSchema,
    network: z.object({ in: serviceSeriesSchema, out: serviceSeriesSchema })
  }),
  /** Medias del total en el rango; la CPU máxima, de la serie. Null sin dato. */
  totals: z.object({
    cpu: z.object({ avg: z.number().nullable(), max: z.number().nullable() }),
    memory: z.object({ avg: z.number().nullable() }),
    network: z.object({ in: z.number().nullable(), out: z.number().nullable() })
  }),
  /**
   * Ficha 0050: las 20 de más CPU, el total real de instancias del grupo (de `totalCount` de
   * `GET /entities`) y si se conoce; con `totalKnown` false, `total` es el número recibido.
   */
  instances: z.object({
    items: z.array(processGroupInstanceSchema),
    total: z.number().int().nonnegative(),
    totalKnown: z.boolean()
  }),
  warnings: z.array(z.string()),
  partial: metricResultSchema.shape.partial
})
export type ProcessGroupMetricsResult = z.output<typeof processGroupMetricsResultSchema>

/**
 * Lista completa de instancias de un process group (canal `entities:processGroupInstances`,
 * ficha 0050), de más a menos CPU media. `total`: el real (de `totalCount`) o, si no se pudo
 * saber, el número recibido. `truncated`: la API recortó la respuesta o llegan menos que el total.
 */
export const processGroupInstancesResultSchema = z.object({
  items: z.array(processGroupInstanceSchema),
  total: z.number().int().nonnegative(),
  truncated: z.boolean()
})
export type ProcessGroupInstancesResult = z.output<typeof processGroupInstancesResultSchema>

/**
 * Id de una entidad APPLICATION de Dynatrace, una aplicación web (ficha 0033). Como el
 * del process group: main construye los entitySelector con él y el formato estricto
 * impide inyectar nada.
 */
export const applicationEntityIdSchema = z.string().regex(/^APPLICATION-[0-9A-F]{16}$/)

/** Una acción de usuario de la aplicación en el rango (ficha 0033). */
export const applicationActionSchema = z.object({
  id: z.string(),
  /** De dimensionMap; si no llega, el id. */
  name: z.string(),
  /** Número de acciones en el rango; null sin dato. */
  count: z.number().nullable(),
  /** Duración media en ms en el rango; null sin dato. */
  duration: z.number().nullable()
})
export type ApplicationAction = z.output<typeof applicationActionSchema>

/**
 * Métricas de una aplicación web en el rango (canal `entities:applicationMetrics`,
 * ficha 0033). Unidades sin convertir: Apdex de 0 a 1, recuentos por intervalo y
 * duraciones en ms. Los cinco papeles tienen métrica: sin datos, series vacías y
 * totales a null.
 */
export const applicationMetricsResultSchema = z.object({
  /** Resolución que devolvió la API para las series (por ejemplo, 10m o 1h). */
  resolution: z.string(),
  series: z.object({
    apdex: serviceSeriesSchema,
    actions: serviceSeriesSchema,
    /** Visually complete de las acciones de carga, media en ms. */
    duration: serviceSeriesSchema,
    /** Errores de JavaScript, de peticiones y personalizados, juntos. */
    errors: serviceSeriesSchema,
    /** Sesiones empezadas. */
    sessions: serviceSeriesSchema
  }),
  /** Valores del rango completo (resolution=Inf); null sin dato. */
  totals: z.object({
    apdex: z.number().nullable(),
    actions: z.number().nullable(),
    duration: z.number().nullable(),
    errors: z.number().nullable(),
    sessions: z.number().nullable()
  }),
  /** Las 10 acciones de más recuento entre load, xhr y custom; las de recuento null, al final. */
  topActions: z.array(applicationActionSchema).max(10),
  warnings: z.array(z.string()),
  partial: metricResultSchema.shape.partial
})
export type ApplicationMetricsResult = z.output<typeof applicationMetricsResultSchema>

/**
 * Id de una entidad DISK de Dynatrace (ficha 0040). Main lo mete dentro del filtro
 * `:filter(eq("dt.entity.disk","<id>"))`: el formato estricto (tipo y 16 hexadecimales)
 * impide cerrar la comilla o el paréntesis.
 */
export const diskEntityIdSchema = z.string().regex(/^DISK-[0-9A-F]{16}$/)

/** Una serie del disco: `values[i]` es el valor en `timestamps[i]` (null sin dato). */
export type DiskSeries = ServiceSeries

/** Lectura y escritura de un disco: series y valores del rango. */
const diskReadWriteSeriesSchema = z.object({
  read: serviceSeriesSchema,
  write: serviceSeriesSchema
})
const diskReadWriteTotalsSchema = z.object({
  read: z.number().nullable(),
  write: z.number().nullable()
})

/**
 * Métricas de un disco en el rango (canal `entities:diskMetrics`, ficha 0040). Unidades sin
 * convertir: uso e inodos libres en %, espacio en bytes, lectura y escritura en bytes/s,
 * latencia en ms y cola en longitud media. Uso, espacio y rendimiento siempre llegan (vacíos,
 * sin datos); latencia, cola e inodos son null si Dynatrace no trae ninguna serie de sus
 * métricas para ese disco (no todos los discos las tienen).
 */
export const diskMetricsResultSchema = z.object({
  /** Resolución que devolvió la API para las series (por ejemplo, 1m). */
  resolution: z.string(),
  series: z.object({
    /** % usado (`usedPct`). */
    usage: serviceSeriesSchema,
    /** Bytes usados y libres (`used` y `avail`). */
    space: z.object({ used: serviceSeriesSchema, free: serviceSeriesSchema }),
    /** Bytes leídos y escritos por segundo. */
    throughput: diskReadWriteSeriesSchema,
    /** Tiempo de lectura y escritura, en ms. */
    latency: diskReadWriteSeriesSchema.nullable(),
    /** Longitud de la cola. */
    queue: serviceSeriesSchema.nullable(),
    /** % de inodos libres. */
    inodes: serviceSeriesSchema.nullable()
  }),
  /** Marcadores del rango completo; null sin dato. Los inodos no llevan marcador. */
  totals: z.object({
    /** % usado máximo del rango. */
    usage: z.number().nullable(),
    /** Bytes libres: último punto con dato de la serie. */
    free: z.number().nullable(),
    /** Medias del rango, en bytes/s. */
    throughput: diskReadWriteTotalsSchema,
    /** Medias del rango, en ms. */
    latency: diskReadWriteTotalsSchema.nullable(),
    /** Longitud media de la cola. */
    queue: z.number().nullable()
  }),
  warnings: z.array(z.string()),
  partial: metricResultSchema.shape.partial
})
export type DiskMetricsResult = z.output<typeof diskMetricsResultSchema>

/** Una localización del monitor en el rango (ficha 0023). */
export const monitorLocationSchema = z.object({
  id: z.string(),
  /** De dimensionMap; si no llega, el id. */
  name: z.string(),
  /** Disponibilidad del rango, en % (0–100); null sin dato. */
  availability: z.number().nullable(),
  /** Duración media del rango, en ms; null sin dato. */
  duration: z.number().nullable(),
  /** Ejecuciones fallidas del rango; null si el tipo no tiene métrica (browser). */
  failed: z.number().min(0).nullable()
})
export type MonitorLocation = z.output<typeof monitorLocationSchema>

/** Un paso (browser) o una petición (HTTP) del monitor en el rango (ficha 0023). */
export const monitorStepSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Duración media del rango, en ms; null sin dato. */
  duration: z.number().nullable(),
  /** Peso en % (0–100) sobre la suma de las duraciones de los pasos; null sin dato. */
  share: z.number().nullable()
})
export type MonitorStep = z.output<typeof monitorStepSchema>

/**
 * Desglose de un monitor por localización y por paso o petición en el rango (canal
 * `entities:monitorBreakdown`, ficha 0023). Localizaciones de peor a mejor
 * disponibilidad (sin dato, al final); pasos de mayor a menor duración (la dimensión
 * no trae número de secuencia). `steps` es null solo para un tipo sin métrica de
 * pasos (hoy ninguno).
 */
export const monitorBreakdownResultSchema = z.object({
  locations: z.array(monitorLocationSchema),
  steps: z.array(monitorStepSchema).nullable(),
  warnings: z.array(z.string()),
  partial: metricResultSchema.shape.partial
})
export type MonitorBreakdownResult = z.output<typeof monitorBreakdownResultSchema>

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
