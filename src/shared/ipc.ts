import { z } from 'zod'
import { errorReasonSchema, type ErrorReason } from './error-reasons'
import { ERROR_REPORT_LIMITS } from './error-report'
import {
  clientInputSchema,
  clientSchema,
  environmentInputSchema,
  environmentViewSchema,
  importSummarySchema,
  secretKinds
} from './tenants'
import {
  exportColumnSchema,
  exportModules,
  exportSettingsSchema,
  MAX_CAPTURE_DATA_URL,
  MAX_EXPORT_ROWS,
  entityDataSchema,
  entityIdBatchSchema,
  entityIdSchema,
  entityNamesSchema,
  entityProblemCountsSchema,
  entityProblemListSchema,
  hostEntityIdSchema,
  hostMetricsResultSchema,
  hostBreakdownResultSchema,
  impactLevels,
  metricInfoSchema,
  metricResultSchema,
  monitorBreakdownResultSchema,
  monitorEntityIdSchema,
  monitorMetricsResultSchema,
  problemCommentSchema,
  problemDetailOutputSchema,
  problemSummarySchema,
  resolutionSchema,
  savedQuerySchema,
  serviceEntityIdSchema,
  serviceMetricsResultSchema,
  severityLevels,
  sloSummarySchema,
  xlsxLabelsSchema
} from './modules'
import { timeRangeSchema } from './time-range'
import {
  dtErrorCodes,
  certificatePinSchema,
  connectionReportSchema,
  untrustedCertificateSchema
} from './dynatrace'

/**
 * Nombre de hoja que Excel acepta: 1-31 caracteres, sin []:*?/\, sin apóstrofo
 * al principio ni al final y distinto de "History" (reservado).
 */
export const sheetNameSchema = z
  .string()
  .min(1)
  .max(31)
  .refine((name) => !/[[\]:*?/\\]/.test(name), 'Carácter no válido en el nombre de hoja')
  .refine((name) => !name.startsWith("'") && !name.endsWith("'"), 'Apóstrofo al borde')
  .refine((name) => name.toLowerCase() !== 'history', 'Nombre de hoja reservado')

const exportRowsSchema = z
  .array(z.record(z.string(), z.union([z.string(), z.number(), z.null()])))
  .max(MAX_EXPORT_ROWS)

/** Hoja de un libro exportado. Las `primary` son las que van también en CSV y TXT. */
export const exportSheetSchema = z.object({
  name: sheetNameSchema,
  primary: z.boolean(),
  columns: z.array(exportColumnSchema).min(1).max(100),
  rows: exportRowsSchema
})

/** Preferencia de tema: "system" sigue al tema de Windows. */
export const themePreferences = ['light', 'dark', 'system'] as const
export type ThemePreference = (typeof themePreferences)[number]

/**
 * Contrato IPC: la única vía por la que la interfaz habla con el proceso main.
 *
 * Cada canal declara un esquema de entrada y otro de salida. El preload valida
 * la entrada antes de enviarla y main valida de nuevo todo lo que recibe y todo
 * lo que devuelve. Para añadir un canal: declararlo aquí e implementarlo en
 * `src/main/ipc/handlers`; el compilador avisa si falta la implementación.
 */
export const ipcContract = {
  /** Datos de la app y de su runtime, para la pantalla de inicio y "Acerca de". */
  'app:getInfo': {
    input: z.void(),
    output: z.object({
      name: z.string(),
      version: z.string(),
      packaged: z.boolean(),
      platform: z.string(),
      versions: z.object({
        electron: z.string(),
        chrome: z.string(),
        node: z.string()
      }),
      /**
       * Disparador de pantallas de error (/__errors/:variante): solo sin empaquetar
       * y con VIGIA_E2E=1. Lo decide main; en la app empaquetada es siempre false.
       */
      errorTrigger: z.boolean()
    })
  },
  /**
   * Un error de la interfaz al log de main: enmascarado (secretos, usuario en
   * rutas, credenciales en URLs) y con freno (sin repetidos, 10 por minuto).
   */
  'app:logRendererError': {
    input: z.object({
      message: z.string().max(ERROR_REPORT_LIMITS.message),
      stack: z.string().max(ERROR_REPORT_LIMITS.stack).nullable(),
      route: z.string().max(ERROR_REPORT_LIMITS.route),
      version: z.string().max(ERROR_REPORT_LIMITS.version)
    }),
    output: z.object({ logged: z.boolean() })
  },
  /**
   * Copia texto al portapapeles desde main: los permisos web de la interfaz
   * están denegados. Para "Copiar detalles" de las pantallas de error.
   */
  'app:copyText': {
    input: z.object({ text: z.string().max(20_000) }),
    output: z.object({ ok: z.literal(true) })
  },
  /** Canal de ejemplo de la Fase 1: comprueba el recorrido renderer → preload → main. */
  'app:ping': {
    input: z.object({
      message: z.string().trim().min(1).max(200)
    }),
    output: z.object({
      reply: z.string(),
      receivedAt: z.iso.datetime()
    })
  },
  /**
   * Aplica la preferencia de tema a `nativeTheme`, para que los controles nativos
   * y la barra de título coincidan con la interfaz. El CSS lo resuelve el renderer.
   */
  'ui:setTheme': {
    input: z.object({ theme: z.enum(themePreferences) }),
    output: z.object({ dark: z.boolean() })
  },

  /** Clientes y entornos (con qué secretos tiene cada uno, nunca su valor). */
  'tenants:list': {
    input: z.void(),
    output: z.object({
      clients: z.array(clientSchema),
      environments: z.array(environmentViewSchema)
    })
  },
  'clients:create': { input: clientInputSchema, output: clientSchema },
  'clients:update': { input: clientInputSchema.extend({ id: z.uuid() }), output: clientSchema },
  /** Borra el cliente con sus entornos y los secretos de estos. */
  'clients:delete': {
    input: z.object({ id: z.uuid() }),
    output: z.object({ ok: z.literal(true) })
  },
  'environments:create': { input: environmentInputSchema, output: environmentViewSchema },
  /**
   * Al pasar de SaaS a Managed con secretos de plataforma, exige
   * dropPlatformSecrets (confirmado en la interfaz); si no, CONFLICT.
   */
  'environments:update': {
    input: z.intersection(
      z.object({ id: z.uuid(), dropPlatformSecrets: z.literal(true).optional() }),
      environmentInputSchema
    ),
    output: environmentViewSchema
  },
  /** Borra el entorno y sus secretos. */
  'environments:delete': {
    input: z.object({ id: z.uuid() }),
    output: z.object({ ok: z.literal(true) })
  },
  'environments:getActive': {
    input: z.void(),
    output: z.object({ environmentId: z.uuid().nullable() })
  },
  'environments:setActive': {
    input: z.object({ environmentId: z.uuid().nullable() }),
    output: z.object({ environmentId: z.uuid().nullable() })
  },

  /**
   * Secretos: el renderer solo puede guardarlos, borrarlos y saber si hay
   * cifrado disponible. No existe ningún canal para leerlos.
   */
  'secrets:set': {
    input: z.object({
      environmentId: z.uuid(),
      kind: z.enum(secretKinds),
      value: z.string().trim().min(1).max(4096)
    }),
    output: z.object({ configured: z.literal(true) })
  },
  'secrets:delete': {
    input: z.object({ environmentId: z.uuid(), kind: z.enum(secretKinds) }),
    output: z.object({ configured: z.literal(false) })
  },
  'secrets:availability': { input: z.void(), output: z.object({ available: z.boolean() }) },

  /** Exportar e importar clientes y entornos (sin secretos); main abre los diálogos. */
  'config:export': {
    input: z.void(),
    output: z.object({ status: z.enum(['saved', 'cancelled']) })
  },
  /**
   * "Probar conexión" por mecanismo, con los scopes que faltan y los
   * certificados no aceptados. Nunca devuelve tokens, tampoco el de OAuth.
   */
  'connection:test': {
    input: z.object({ environmentId: z.uuid() }),
    output: connectionReportSchema.extend({
      untrustedCertificates: z.array(untrustedCertificateSchema)
    })
  },
  /** Último resultado de "Probar conexión" (en memoria); null si no hay o ha cambiado algo. */
  'connection:status': {
    input: z.object({ environmentId: z.uuid() }),
    output: connectionReportSchema.nullable()
  },
  'certificates:list': {
    input: z.object({ environmentId: z.uuid() }),
    output: z.array(certificatePinSchema)
  },
  /** Fija la huella de un host; solo por aceptación explícita del usuario. */
  'certificates:pin': {
    input: z.object({
      environmentId: z.uuid(),
      host: z.string().min(1).max(300),
      fingerprint: z.string().regex(/^sha256\/[A-Za-z0-9+/]+=*$/)
    }),
    output: z.object({ ok: z.literal(true) })
  },
  'certificates:unpin': {
    input: z.object({ environmentId: z.uuid(), host: z.string().min(1).max(300) }),
    output: z.object({ ok: z.literal(true) })
  },

  /** Problemas del entorno en el rango (API clásica, /api/v2/problems). */
  'problems:list': {
    input: z.object({
      environmentId: z.uuid(),
      timeRange: timeRangeSchema,
      status: z.enum(['open', 'closed']).optional(),
      severity: z.array(z.enum(severityLevels)).max(severityLevels.length).optional(),
      impact: z.array(z.enum(impactLevels)).max(impactLevels.length).optional(),
      text: z.string().max(30).optional()
    }),
    output: z.object({
      problems: z.array(problemSummarySchema),
      /** Total real según la API (puede ser mayor que lo traído); null si no lo da. */
      totalCount: z.number().nullable(),
      truncated: z.boolean(),
      /** Elementos descartados por no cumplir el esquema (se avisa en la vista). */
      invalid: z.number().int().min(0),
      /** Avisos de Dynatrace (`warnings`), sin duplicados. */
      warnings: z.array(z.string()).max(20)
    })
  },
  /**
   * Problemas abiertos y cerrados que afectan a una entidad en el rango (ficha
   * 0007). Main construye el selector; la interfaz solo manda el id.
   */
  'entities:problemCounts': {
    input: z.object({
      environmentId: z.uuid(),
      entityId: entityIdSchema,
      timeRange: timeRangeSchema
    }),
    output: entityProblemCountsSchema
  },
  /**
   * Problemas que afectan a una entidad en el rango, para la franja del gráfico
   * «Tasa de error» (ficha 0010). Una sola página de 100, los más recientes primero.
   */
  'entities:problems': {
    input: z.object({
      environmentId: z.uuid(),
      entityId: entityIdSchema,
      timeRange: timeRangeSchema
    }),
    output: entityProblemListSchema
  },
  /**
   * Datos de una entidad: propiedades, etiquetas, zonas y relaciones (ficha 0014).
   * El id va validado a la ruta de `GET /entities/{entityId}`.
   */
  'entities:get': {
    input: z.object({ environmentId: z.uuid(), entityId: entityIdSchema }),
    output: entityDataSchema
  },
  /**
   * Nombres de los ids de una relación, a demanda (ficha 0014): de 1 a 50 ids del
   * mismo tipo. Main construye el `entityId(...)` del selector.
   */
  'entities:names': {
    input: z.object({ environmentId: z.uuid(), entityIds: entityIdBatchSchema }),
    output: entityNamesSchema
  },
  /** Detalle con evidencias, impacto y comentarios recientes. */
  'problems:get': {
    input: z.object({ environmentId: z.uuid(), problemId: z.string().min(1).max(200) }),
    output: problemDetailOutputSchema
  },
  /** Todos los comentarios de un problema ("Ver todos"); el detalle solo trae los recientes. */
  'problems:comments': {
    input: z.object({ environmentId: z.uuid(), problemId: z.string().min(1).max(200) }),
    output: z.object({
      comments: z.array(problemCommentSchema),
      totalCount: z.number().int().min(0).nullable(),
      truncated: z.boolean(),
      invalid: z.number().int().min(0)
    })
  },
  'metrics:query': {
    input: z.object({
      environmentId: z.uuid(),
      timeRange: timeRangeSchema,
      metricSelector: z.string().trim().min(1).max(2000),
      resolution: resolutionSchema.optional()
    }),
    output: metricResultSchema
  },
  /**
   * Métricas de una entidad SERVICE en el rango (ficha 0006): series y totales para
   * los marcadores. La interfaz manda el id, nunca un selector: main lo construye.
   */
  'entities:serviceMetrics': {
    input: z.object({
      environmentId: z.uuid(),
      entityId: serviceEntityIdSchema,
      timeRange: timeRangeSchema
    }),
    output: serviceMetricsResultSchema
  },
  /**
   * Métricas de una entidad HOST en el rango (ficha 0016): series de CPU, memoria,
   * red y disco y totales para los marcadores. Como el del servicio, la interfaz
   * manda el id y main construye los selectores.
   */
  'entities:hostMetrics': {
    input: z.object({
      environmentId: z.uuid(),
      entityId: hostEntityIdSchema,
      timeRange: timeRangeSchema
    }),
    output: hostMetricsResultSchema
  },
  /**
   * Discos y los 10 procesos con más CPU de una entidad HOST en el rango (ficha
   * 0017). La interfaz manda el id y main construye los selectores.
   */
  'entities:hostBreakdown': {
    input: z.object({
      environmentId: z.uuid(),
      entityId: hostEntityIdSchema,
      timeRange: timeRangeSchema
    }),
    output: hostBreakdownResultSchema
  },
  /**
   * Métricas de un browser monitor o de un HTTP monitor en el rango (ficha 0022):
   * series y marcadores por papel. La interfaz manda el id; main saca el tipo de él,
   * elige su catálogo y construye los selectores.
   */
  'entities:monitorMetrics': {
    input: z.object({
      environmentId: z.uuid(),
      entityId: monitorEntityIdSchema,
      timeRange: timeRangeSchema
    }),
    output: monitorMetricsResultSchema
  },
  /**
   * Desglose de un browser monitor o de un HTTP monitor por localización y por paso o
   * petición en el rango (ficha 0023). La interfaz manda el id; main saca el tipo de
   * él y construye los selectores.
   */
  'entities:monitorBreakdown': {
    input: z.object({
      environmentId: z.uuid(),
      entityId: monitorEntityIdSchema,
      timeRange: timeRangeSchema
    }),
    output: monitorBreakdownResultSchema
  },
  'metrics:search': {
    input: z.object({ environmentId: z.uuid(), text: z.string().trim().min(1).max(100) }),
    output: z.object({
      metrics: z.array(metricInfoSchema),
      truncated: z.boolean(),
      totalCount: z.number().nullable(),
      invalid: z.number().int().min(0)
    })
  },
  'slos:list': {
    input: z.object({ environmentId: z.uuid() }),
    output: z.object({
      slos: z.array(sloSummarySchema),
      truncated: z.boolean(),
      totalCount: z.number().nullable(),
      invalid: z.number().int().min(0)
    })
  },
  'savedQueries:list': {
    input: z.object({ environmentId: z.uuid() }),
    output: z.array(savedQuerySchema)
  },
  'savedQueries:save': {
    input: z.object({
      environmentId: z.uuid(),
      id: z.uuid().optional(),
      name: z.string().trim().min(1).max(80),
      metricSelector: z.string().trim().min(1).max(2000),
      resolution: resolutionSchema.nullable().optional()
    }),
    output: savedQuerySchema
  },
  'savedQueries:delete': {
    input: z.object({ id: z.uuid() }),
    output: z.object({ ok: z.literal(true) })
  },

  /** Exporta una tabla; main escribe el fichero (diálogo de guardado). */
  'export:table': {
    input: z.object({
      environmentId: z.uuid(),
      module: z.enum(exportModules),
      format: z.enum(['csv', 'xlsx', 'txt', 'txt-tabs']),
      columns: z.array(exportColumnSchema).min(1).max(100),
      rows: z
        .array(z.record(z.string(), z.union([z.string(), z.number(), z.null()])))
        .max(MAX_EXPORT_ROWS),
      query: z.string().max(2000).optional(),
      timeRange: timeRangeSchema.optional(),
      /**
       * Cuándo se cargaron los datos (ms desde epoch): las fechas del rango de la
       * hoja Info se calculan con ese momento, no con el de exportar.
       */
      loadedAt: z.number().int().positive().optional(),
      /** Nota para la hoja Info del XLSX, en el idioma de la interfaz. */
      note: z.string().max(500).optional(),
      /** Avisos de Dynatrace (`warnings`) para la hoja Info, una fila por aviso. */
      warnings: z.array(z.string().max(500)).max(20).optional(),
      /** Elementos descartados por no cumplir el esquema: fila propia en la hoja Info. */
      invalidCount: z.number().int().min(0).optional(),
      /** Resolución aplicada por la API (Métricas): fila propia en la hoja Info. */
      resolution: z.string().min(1).max(20).optional(),
      /** Clústeres del filtro local activo: la exportación no es el total. */
      clusterFilter: z.array(z.string().min(1).max(200)).min(1).max(100).optional(),
      /** Etiquetas del XLSX en el idioma de la interfaz (solo con format xlsx). */
      xlsxLabels: xlsxLabelsSchema.optional()
    }),
    output: z.object({
      status: z.enum(['saved', 'cancelled']),
      fileName: z.string().optional()
    })
  },
  /**
   * Varias tablas en un libro (detalle de un problema): XLSX con una hoja por
   * tabla y la hoja Info; CSV y TXT con las hojas `primary`, una tras otra.
   */
  'export:workbook': {
    input: z
      .object({
        environmentId: z.uuid(),
        module: z.enum(exportModules),
        format: z.enum(['csv', 'xlsx', 'txt', 'txt-tabs']),
        sheets: z.array(exportSheetSchema).min(1).max(10),
        query: z.string().max(2000).optional(),
        timeRange: timeRangeSchema.optional(),
        loadedAt: z.number().int().positive().optional(),
        note: z.string().max(500).optional(),
        warnings: z.array(z.string().max(500)).max(20).optional(),
        invalidCount: z.number().int().min(0).optional(),
        xlsxLabels: xlsxLabelsSchema.optional()
      })
      .refine(
        (input) =>
          input.sheets.reduce((total, sheet) => total + sheet.rows.length, 0) <= MAX_EXPORT_ROWS,
        'Demasiadas filas en total'
      )
      .refine((input) => input.sheets.some((sheet) => sheet.primary), 'Ninguna hoja principal')
      .refine((input) => {
        const names = input.sheets.map((sheet) => sheet.name.toLowerCase())
        const info = (input.xlsxLabels?.infoSheet ?? 'Info').toLowerCase()
        return new Set(names).size === names.length && !names.includes(info)
      }, 'Nombres de hoja repetidos'),
    output: z.object({
      status: z.enum(['saved', 'cancelled']),
      fileName: z.string().optional()
    })
  },
  'export:getSettings': { input: z.void(), output: exportSettingsSchema },
  'export:setSettings': { input: exportSettingsSchema.partial(), output: exportSettingsSchema },
  /** Captura de un gráfico (PNG ya compuesto por el renderer): al portapapeles o a fichero. */
  'capture:image': {
    input: z.object({
      environmentId: z.uuid().optional(),
      module: z.enum(exportModules),
      dataUrl: z.string().max(MAX_CAPTURE_DATA_URL),
      action: z.enum(['clipboard', 'save'])
    }),
    /** fileName: el nombre con el que se guardó de verdad (el elegido en el diálogo). */
    output: z.object({
      status: z.enum(['copied', 'saved', 'cancelled']),
      fileName: z.string().optional()
    })
  },
  /** Captura de una zona de la ventana (webContents.capturePage), validada contra su tamaño. */
  'capture:region': {
    input: z.object({
      environmentId: z.uuid().optional(),
      module: z.enum(exportModules),
      rect: z.object({
        x: z.number().int().min(0),
        y: z.number().int().min(0),
        width: z.number().int().min(1),
        height: z.number().int().min(1)
      }),
      action: z.enum(['clipboard', 'save'])
    }),
    output: z.object({
      status: z.enum(['copied', 'saved', 'cancelled']),
      fileName: z.string().optional()
    })
  },

  'config:import': {
    input: z.void(),
    output: z.discriminatedUnion('status', [
      z.object({ status: z.literal('cancelled') }),
      z.object({ status: z.literal('done'), summary: importSummarySchema })
    ])
  }
} as const

export type IpcChannel = keyof typeof ipcContract

/** Lo que escribe quien llama (antes de validar). */
export type IpcInput<C extends IpcChannel> = z.input<(typeof ipcContract)[C]['input']>
/** Lo que recibe la implementación en main (ya validado y normalizado). */
export type IpcParsedInput<C extends IpcChannel> = z.output<(typeof ipcContract)[C]['input']>
/** Lo que devuelve el canal. */
export type IpcOutput<C extends IpcChannel> = z.output<(typeof ipcContract)[C]['output']>

/** Los canales sin entrada se llaman sin segundo argumento. */
export type IpcArgs<C extends IpcChannel> = [IpcInput<C>] extends [void] ? [] : [input: IpcInput<C>]

export const ipcErrorCodes = [
  'UNKNOWN_CHANNEL',
  'UNTRUSTED_SENDER',
  'INVALID_INPUT',
  'INVALID_OUTPUT',
  'INTERNAL',
  'CONFLICT',
  'NOT_FOUND',
  'ENCRYPTION_UNAVAILABLE',
  // Errores de Dynatrace: la interfaz los traduce por código.
  ...dtErrorCodes
] as const
export type IpcErrorCode = (typeof ipcErrorCodes)[number]

/** Fallo de un canal. Main valida el `reason` con este esquema antes de enviarlo. */
export const ipcFailureSchema = z.object({
  code: z.enum(ipcErrorCodes),
  /** Mensaje apto para registrar o, sin `reason`, mostrar: nunca incluye secretos ni trazas. */
  message: z.string(),
  /** Motivo para que la interfaz lo traduzca (`errorReasons.<key>`). */
  reason: errorReasonSchema.optional()
})
export type IpcFailure = z.output<typeof ipcFailureSchema>

/**
 * Sobre de respuesta. Los errores viajan como datos porque las excepciones
 * pierden su información al cruzar IPC y el puente de contexto.
 */
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: IpcFailure }

/**
 * Esquemas de un canal con sus tipos concretos. TypeScript no relaciona por sí
 * solo el canal genérico con su esquema, así que la conversión se hace aquí,
 * en un único sitio.
 */
export function ipcSchemas<C extends IpcChannel>(
  channel: C
): { input: z.ZodType<IpcParsedInput<C>>; output: z.ZodType<IpcOutput<C>> } {
  return ipcContract[channel] as unknown as {
    input: z.ZodType<IpcParsedInput<C>>
    output: z.ZodType<IpcOutput<C>>
  }
}

export function isIpcChannel(value: unknown): value is IpcChannel {
  return typeof value === 'string' && Object.hasOwn(ipcContract, value)
}

export function ipcFailure(
  code: IpcErrorCode,
  message: string,
  reason?: ErrorReason
): IpcResult<never> {
  return { ok: false, error: reason === undefined ? { code, message } : { code, message, reason } }
}

/** Resume un error de validación de Zod sin volcar los datos recibidos. */
export function describeValidationError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '(raíz)'
      return `${path}: ${issue.message}`
    })
    .join('; ')
}

/** API que el preload expone en `window.vigia`. */
export interface VigiaApi {
  invoke<C extends IpcChannel>(channel: C, ...args: IpcArgs<C>): Promise<IpcResult<IpcOutput<C>>>
}
