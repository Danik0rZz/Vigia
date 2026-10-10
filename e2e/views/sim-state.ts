/**
 * Arnés de las vistas (ficha 0069): estado y registro del Dynatrace simulado. Va aparte de
 * `fixtures.ts` y `simulator.ts` porque los dos lo leen, y así no se importan entre sí en ciclo.
 */

/**
 * Estado y registro del Dynatrace simulado. Cada test parte de estos valores
 * (`resetState` los restaura); los contadores solo se comparan con un «antes»
 * tomado dentro del propio test.
 */
// El tipo del simulador es el de este objeto: escribirlo aparte solo lo duplicaría.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export const defaultSim = () => ({
  problemsRequests: 0,
  truncate: false,
  many: false,
  /** AUD-08: mete un problema inválido (sin problemId) y avisos de la API. */
  invalidOne: false,
  warnings: [] as string[],
  badRequest: false,
  /** Si no es null, /problems no responde hasta que se cumpla (para ver qué hay mientras carga). */
  problemsGate: null as Promise<void> | null,
  /** AUD-12: igual para /problems/{id} (detalle lento). */
  detailGate: null as Promise<void> | null,
  /** AUD-12: el detalle falla (400, un error que no es «no existe»). */
  detailFails: false,
  lastDetailQuery: new URLSearchParams(),
  /** v0.9.2: consultas de los mini gráficos (sus query), en vuelo ahora, máximo y retardo. */
  eventMetricQueries: [] as URLSearchParams[],
  eventMetricInFlight: 0,
  eventMetricMaxInFlight: 0,
  eventMetricDelayMs: 150,
  /** v0.10.2: Métricas devuelve puntos por todo el rango pedido (eje de días). */
  metricsSpread: false,
  /** v0.9.1: peticiones a /problems/{id}/comments y la última query. */
  commentsRequests: 0,
  lastCommentsQuery: new URLSearchParams(),
  lastProblemsQuery: new URLSearchParams(),
  lastMetricsQuery: new URLSearchParams(),
  /** AUD-13: peticiones a /metrics/query. */
  metricsQueries: 0,
  /** AUD-13: dataPointCountRatio / dimensionCountRatio de cada resultado. */
  metricRatios: {} as { dataPointCountRatio?: number; dimensionCountRatio?: number },
  /** AUD-13: warnings de /metrics/query. */
  metricWarnings: [] as string[],
  /** SLOs: «Errores de login» con relatedOpenProblems -1 (no calculado) o 0. */
  sloRelatedFailed: true,
  /** Ficha 0007: query de las peticiones a /problems con affectedEntities en el selector. */
  entityProblemQueries: [] as URLSearchParams[],
  /** Ficha 0003: todas las peticiones que llegan al simulador («MÉTODO /ruta»), en orden. */
  requests: [] as string[],
  /** Ficha 0006: consultas de métricas del servicio inventado (sus query). */
  serviceMetricQueries: [] as URLSearchParams[],
  /**
   * Ficha 0046: peticiones a /entities/{id} de entities:serviceMetrics (las que piden
   * `+properties.serviceType`), aparte de las de entities:get, como «id fields».
   */
  serviceEntityQueries: [] as string[],
  /** Ficha 0016: consultas de métricas del host inventado (sus query). */
  hostMetricQueries: [] as URLSearchParams[],
  /** Ficha 0022: consultas de métricas de los monitores inventados (sus query). */
  monitorMetricQueries: [] as URLSearchParams[],
  /** Ficha 0027: consultas de métricas del proceso inventado (sus query). */
  processMetricQueries: [] as URLSearchParams[],
  /** Ficha 0031: consultas de métricas del process group inventado (sus query). */
  processGroupMetricQueries: [] as URLSearchParams[],
  /** Ficha 0050: consultas a /entities con el selector de las instancias de un grupo inventado. */
  processGroupEntityQueries: [] as URLSearchParams[],
  /** Ficha 0033: consultas de métricas de la aplicación inventada (sus query). */
  applicationMetricQueries: [] as URLSearchParams[],
  /** Ficha 0034: las consultas de métricas de la aplicación inventada fallan con un 400. */
  applicationMetricsFail: false,
  /**
   * Ficha 0034: papeles de la aplicación que llegan sin datos (series vacías y total null en el
   * canal): apdex, actions, duration, errors o sessions.
   */
  applicationEmpty: [] as string[],
  /** Ficha 0034: las consultas de las acciones de usuario llegan sin series (lista vacía). */
  applicationActionsEmpty: false,
  /** Ficha 0053: las consultas del canal entities:applicationRum fallan con un 400. */
  applicationRumFail: false,
  /** Ficha 0053: las métricas de custom (acciones y duración) traen datos. */
  applicationRumCustom: false,
  /** Ficha 0053: los errores llegan en una sola serie sin «Error type» (sin separar). */
  applicationRumErrorsUntyped: false,
  /** Ficha 0054: los rage clicks (`event.count.rageClick`) traen datos. */
  applicationRumRageClicks: false,
  /** Ficha 0032: las consultas de métricas de los process groups inventados fallan con un 400. */
  processGroupMetricsFail: false,
  /** Ficha 0032: las expresiones por instancia del process group llegan recortadas (ratio > 1). */
  processGroupTruncated: false,
  /** Ficha 0051: /entities de las instancias de un grupo responde 403 (total no conocido). */
  processGroupEntitiesFail: false,
  /** Ficha 0051: la consulta de la lista completa del modal «Ver todas» falla con un 400. */
  processGroupInstancesFail: false,
  /** Ficha 0028: las consultas de métricas de los procesos inventados fallan con un 400. */
  processMetricsFail: false,
  /** Ficha 0028: métricas (sin agregación) que llegan sin series a los procesos inventados. */
  processEmpty: [] as string[],
  /** Ficha 0023: consultas del desglose de los monitores inventados (sus query). */
  monitorBreakdownQueries: [] as URLSearchParams[],
  /** Ficha 0040: consultas de métricas de los discos inventados (sus query). */
  diskMetricQueries: [] as URLSearchParams[],
  /** Ficha 0040: métricas (sin filtro ni agregación) que llegan sin series al disco. */
  diskEmpty: [] as string[],
  /** Ficha 0017: consultas de discos y procesos del host inventado (sus query). */
  hostBreakdownQueries: [] as URLSearchParams[],
  /** Ficha 0019: las consultas de discos y procesos fallan con un 400. */
  hostBreakdownFail: false,
  /** Ficha 0019: las consultas de discos y procesos responden sin series. */
  hostBreakdownEmpty: false,
  /** Ficha 0019: qué métricas llegan recortadas (dimensionCountRatio > 1). */
  hostBreakdownTruncated: null as 'processes' | 'disks' | null,
  /** Ficha 0018: las consultas de métricas del host inventado fallan con un 400. */
  hostMetricsFail: false,
  /** Ficha 0024: las consultas de métricas de los monitores inventados fallan con un 400. */
  monitorMetricsFail: false,
  /** Ficha 0024: las consultas del desglose de los monitores inventados fallan con un 400. */
  monitorBreakdownFail: false,
  /** Ficha 0024: las métricas de rendimiento del browser monitor llegan sin series. */
  monitorPerformanceEmpty: false,
  /**
   * Ficha 0025: las páginas de MONITOR_BROWSER_ID y MONITOR_HTTP_ID responden al desglose con
   * MONITOR_TABLE_DATA (4 localizaciones y 5 pasos o 2 peticiones) en vez de con BREAKDOWN_DATA.
   */
  monitorTables: false,
  /** Ficha 0025: el desglose de los monitores llega sin series de pasos ni de peticiones. */
  monitorStepsEmpty: false,
  /** Ficha 0008: las consultas de métricas del servicio fallan con un 400. */
  serviceMetricsFail: false,
  /** Ficha 0008: los recuentos de problemas de una entidad (affectedEntities) fallan con un 400. */
  entityProblemsFail: false,
  /**
   * Ficha 0010: query de las peticiones a /problems con affectedEntities y SIN status (la lista
   * de la franja, canal entities:problems). Las de los recuentos siguen en entityProblemQueries.
   */
  entityProblemListQueries: [] as URLSearchParams[],
  /** Ficha 0010: la lista de problemas de una entidad (sin status) falla con un 400. */
  entityProblemListFail: false,
  /** Ficha 0010: «ahora» de los problemas de la franja, fijado al empezar cada test. */
  bandNow: Date.now(),
  /** Ficha 0013: duración, en minutos, del problema de id largo de SVC_LONG_ID. */
  bandLongMinutes: 30,
  /** Ficha 0014: query de las peticiones a /entities/{id} (entities:get). */
  entityInfoQueries: [] as URLSearchParams[],
  /** Ficha 0014: query de las peticiones a /entities (entities:names). */
  entityNamesQueries: [] as URLSearchParams[],
  /** Ficha 0015: las peticiones a /entities/{id} (entities:get) fallan con un 400. */
  entityInfoFail: false,
  /** Ficha 0041: query de las consultas de logs de un host (entities:hostLogs). */
  hostLogsQueries: [] as URLSearchParams[],
  /** Ficha 0041: las consultas de logs de un host fallan con un 400. */
  hostLogsFail: false,
  /** Ficha 0041: los procesos del host llegan sin ninguna propiedad de logs. */
  hostLogsEmpty: false,
  /** Ficha 0042: query de las peticiones a /events (entities:hostEvents). */
  hostEventsQueries: [] as URLSearchParams[],
  /** Ficha 0042: las peticiones a /events fallan con un 400. */
  hostEventsFail: false
})
export const sim = defaultSim()
