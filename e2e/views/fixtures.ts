import { expect } from '@playwright/test'
import { sim } from './sim-state'

/**
 * Arnés de las vistas (ficha 0069), datos del Dynatrace simulado: tokens, problemas, entidades,
 * series de métricas y las respuestas que arma el simulador con ellos (`*Response`, `*Body`).
 * Las respuestas leen el estado del simulador (`sim`, en `sim-state.ts`) en el momento de cada
 * petición. Todo es inventado: nada del tenant de pruebas (ver `e2e/CLAUDE.md`).
 *
 * Los specs pueden añadir datos al cargarse (`detailOnly.push(...)`, `Object.assign(ENTITY_NAMES,
 * ...)`): se comparten los mismos arrays y objetos, y el simulador no arranca hasta el `beforeAll`.
 */

export const tok = (name: string): string =>
  `dt0c01.PUBLICAPRUEBA0000000000A.${name.padEnd(64, 'X')}`
export const TOKEN_A = tok('SECRETOVISTASA')
export const TOKEN_B = tok('SECRETOVISTASB')
export const TOKEN_NO_METRICS = tok('SECRETOVISTASNOMETRICS')
export const TOKEN_FORBIDDEN = tok('SECRETOVISTASFORBIDDEN')
/** Ficha 0015: token con los scopes de siempre menos entities.read. */
export const TOKEN_NO_ENTITIES = tok('SECRETOVISTASNOENTITIES')
/** Ficha 0042: token con los scopes de siempre menos events.read. */
export const TOKEN_NO_EVENTS = tok('SECRETOVISTASNOEVENTS')
export const SECRET_MARKS = ['SECRETOVISTAS']

export const HOUR = 3600_000
export const NOW = Date.now()

export type FakeProblem = Record<string, unknown> & {
  displayId: string
  title: string
  status: string
}

export const problemsA: FakeProblem[] = [
  {
    problemId: 'pa-1',
    displayId: 'P-101',
    'k8s.cluster.name': ['cluster-norte'],
    title: 'Respuesta lenta en pagos',
    status: 'OPEN',
    severityLevel: 'PERFORMANCE',
    impactLevel: 'SERVICES',
    startTime: NOW - HOUR,
    endTime: -1,
    affectedEntities: [
      { entityId: { id: 'SERVICE-AAA1', type: 'SERVICE' }, name: 'pagos' },
      { entityId: { id: 'HOST-AAA1', type: 'HOST' }, name: 'host-pagos-01' }
    ],
    impactedEntities: [{ entityId: { id: 'APPLICATION-AAA1', type: 'APPLICATION' }, name: 'web' }],
    rootCauseEntity: { entityId: { id: 'SERVICE-AAA1', type: 'SERVICE' }, name: 'pagos' },
    managementZones: [{ id: '1', name: 'Producción' }],
    problemFilters: []
  },
  {
    problemId: 'pa-2',
    displayId: 'P-102',
    title: 'Disco lleno',
    status: 'CLOSED',
    severityLevel: 'RESOURCE_CONTENTION',
    impactLevel: 'INFRASTRUCTURE',
    startTime: NOW - 3 * HOUR,
    endTime: NOW - 2 * HOUR,
    affectedEntities: [{ entityId: { id: 'HOST-AAA2', type: 'HOST' }, name: 'host-bd-01' }],
    impactedEntities: [],
    managementZones: [],
    problemFilters: []
  },
  {
    // Título con forma de fórmula: el CSV tiene que neutralizarlo.
    problemId: 'pa-3',
    displayId: 'P-103',
    'k8s.cluster.name': ['cluster-sur', 'cluster-norte'],
    title: '=HYPERLINK("http://x","y") errores',
    status: 'OPEN',
    // Severidad que la app no conoce: se muestra tal cual (con un console.warn, no error).
    severityLevel: 'NUEVA_SEVERIDAD',
    'k8s.namespace.name': ['carrito-ns', 'comun-ns'],
    impactLevel: 'SERVICES',
    startTime: NOW - 30 * 60_000,
    endTime: -1,
    affectedEntities: [{ entityId: { id: 'SERVICE-AAA2', type: 'SERVICE' }, name: 'carrito' }],
    impactedEntities: [],
    managementZones: [],
    problemFilters: []
  }
]

export const problemsB: FakeProblem[] = [
  {
    problemId: 'pb-1',
    displayId: 'P-900',
    title: 'Problema solo de Desarrollo',
    status: 'OPEN',
    severityLevel: 'AVAILABILITY',
    impactLevel: 'APPLICATION',
    startTime: NOW - HOUR,
    endTime: -1,
    affectedEntities: [{ entityId: { id: 'SERVICE-BBB1', type: 'SERVICE' }, name: 'login-dev' }],
    impactedEntities: [],
    managementZones: [],
    problemFilters: []
  }
]

/** 300 problemas sintéticos para la tabla virtualizada. */
/**
 * v0.9.0: un problema que no sale en la lista, solo en el detalle, con un id que
 * empieza por '-' y lleva '_' (como los de Dynatrace): la ruta tiene que
 * codificarlo y decodificarlo bien.
 */
export const ODD_ID = '-1234567890123456789_1700000000000V2'
export const detailOnly: FakeProblem[] = [
  {
    problemId: ODD_ID,
    displayId: 'P-777',
    title: 'Problema solo del detalle',
    status: 'CLOSED',
    severityLevel: 'ERROR',
    impactLevel: 'SERVICES',
    startTime: NOW - 5 * HOUR,
    endTime: NOW - 4 * HOUR,
    affectedEntities: [{ entityId: { id: 'SERVICE-ODD1', type: 'SERVICE' }, name: 'raro' }],
    impactedEntities: [],
    managementZones: [],
    problemFilters: []
  }
]

/**
 * Ficha 0007: problemas de una entidad inventada (2 abiertos y 3 cerrados), solo
 * para las consultas con affectedEntities (no salen en la lista de Problemas).
 */
export const COUNT_ENTITY_ID = 'SERVICE-00000000000E2E07'
/** Otra entidad inventada, sin problemas. */
export const COUNT_EMPTY_ID = 'HOST-00000000000E2E70'
export const entityCountProblems: FakeProblem[] = (
  [
    ['OPEN', COUNT_ENTITY_ID],
    ['OPEN', COUNT_ENTITY_ID],
    ['CLOSED', COUNT_ENTITY_ID],
    ['CLOSED', COUNT_ENTITY_ID],
    ['CLOSED', COUNT_ENTITY_ID],
    // De otra entidad: no cuenta.
    ['OPEN', 'SERVICE-00000000000E2E08']
  ] as const
).map(([status, entityId], i) => ({
  problemId: `pc-${i + 1}`,
  displayId: `P-C${i + 1}`,
  title: `Problema de recuento ${i + 1}`,
  status,
  severityLevel: 'ERROR',
  impactLevel: 'SERVICES',
  startTime: NOW - (i + 2) * HOUR,
  endTime: status === 'OPEN' ? -1 : NOW - (i + 1) * HOUR,
  affectedEntities: [{ entityId: { id: entityId, type: 'SERVICE' }, name: `recuento-${i + 1}` }],
  impactedEntities: [],
  managementZones: [],
  problemFilters: []
}))

/** v0.9.0: comentario con HTML que la página tiene que enseñar como texto, sin ejecutarlo. */
export const HOSTILE_COMMENT =
  '<script>window.__xss = "script"</script><img src="x" onerror="window.__xss = \'img\'; alert(1)"> fin'

/**
 * v0.9.0: problema grande, solo del detalle: 300 evidencias (más una ilegible),
 * un comentario con HTML, un impacto con usuarios estimados, y clúster y namespace.
 */
export const BIG_ID = 'pd-big'
/** v0.10.0: la evidencia de causa raíz de P-778 (cerrada). */
export const BIG_ROOT = 250
/** v0.10.0: selector del gráfico de la evidencia 299 de P-778 (cuenta como de mini gráfico). */
export const SEL_BIG = 'builtin:host.cpu.usage:avg:e2elazy299'
detailOnly.push({
  problemId: BIG_ID,
  displayId: 'P-778',
  title: 'Problema con muchas evidencias',
  status: 'OPEN',
  severityLevel: 'ERROR',
  impactLevel: 'APPLICATION',
  startTime: NOW - 2 * HOUR,
  endTime: -1,
  'k8s.cluster.name': ['cluster-norte', 'cluster-sur'],
  'k8s.namespace.name': ['pagos-ns'],
  affectedEntities: [{ entityId: { id: 'SERVICE-BIG1', type: 'SERVICE' }, name: 'grande' }],
  impactedEntities: [{ entityId: { id: 'APPLICATION-BIG1', type: 'APPLICATION' }, name: 'tienda' }],
  managementZones: [],
  problemFilters: [],
  evidenceDetails: {
    totalCount: 301,
    details: [
      // v0.10.0: cada una con su estado (pares abiertas, impares cerradas) y su eventId; la
      // 250 (cerrada) es la causa raíz: con el orden por defecto queda muy abajo (virtualizada).
      ...Array.from({ length: 300 }, (_, i) => ({
        evidenceType: 'EVENT',
        displayName: `Evidencia ${i + 1}`,
        entity: { entityId: { id: 'SERVICE-BIG1', type: 'SERVICE' }, name: 'grande' },
        startTime: NOW - 2 * HOUR + i * 1000,
        rootCauseRelevant: i + 1 === BIG_ROOT,
        data: {
          eventId: `big-${i + 1}`,
          status: i % 2 === 0 ? 'OPEN' : 'CLOSED',
          endTime: i % 2 === 0 ? -1 : NOW - HOUR,
          title: `Evidencia ${i + 1}`,
          // La 299 (la primera fila por defecto) trae un gráfico: altura que cambia al cargar.
          ...(i + 1 === 299
            ? { properties: [{ key: 'dt.event.metric_selector', value: SEL_BIG }] }
            : {})
        }
      })),
      // Ilegible: se descarta y se cuenta.
      'esto no es una evidencia'
    ]
  },
  recentComments: {
    totalCount: 1,
    comments: [{ authorName: 'operador', content: HOSTILE_COMMENT, createdAtTimestamp: NOW - HOUR }]
  }
})

/**
 * v0.9.1: problema con evidencias de los 5 tipos de la OpenAPI y uno desconocido,
 * la API recortada (8 de 12) y 2 comentarios recientes de 7. Causa raíz: el
 * reinicio (EVENT) y el host no disponible. Grupos, en este orden: pagos-ev (3),
 * host-ev (2, uno por su groupingEntity) y sin entidad (1).
 */
export const EV_ID = 'pd-evid'
export const EV_START = NOW - 3 * HOUR
export const MIN = 60_000
export const EV_METRIC = 'builtin:service.response.time'
export const EV_PROPERTY = '<b>reinicio</b> manual'
export const evEntity = (id: string, type: string, name: string): Record<string, unknown> => ({
  entityId: { id, type },
  name
})
export const EV_SERVICE = evEntity('SERVICE-EV1', 'SERVICE', 'pagos-ev')
export const EV_HOST = evEntity('HOST-EV1', 'HOST', 'host-ev')
detailOnly.push({
  problemId: EV_ID,
  displayId: 'P-779',
  title: 'Problema con evidencias variadas',
  status: 'OPEN',
  severityLevel: 'PERFORMANCE',
  impactLevel: 'SERVICES',
  startTime: EV_START,
  endTime: -1,
  affectedEntities: [EV_SERVICE],
  impactedEntities: [],
  managementZones: [],
  problemFilters: [],
  evidenceDetails: {
    totalCount: 12,
    details: [
      {
        evidenceType: 'EVENT',
        displayName: 'Reinicio del proceso',
        entity: evEntity('PROCESS_GROUP_INSTANCE-EV1', 'PROCESS_GROUP_INSTANCE', 'proc-ev'),
        rootCauseRelevant: true,
        startTime: EV_START,
        endTime: EV_START + HOUR,
        eventType: 'PROCESS_RESTART',
        data: {
          properties: [
            { key: 'dt.event.description', value: EV_PROPERTY },
            { key: 'exit.code', value: 137 }
          ]
        }
      },
      {
        evidenceType: 'METRIC',
        displayName: 'Tiempo de respuesta',
        entity: EV_SERVICE,
        rootCauseRelevant: false,
        startTime: NOW - 170 * MIN,
        endTime: -1,
        metricId: EV_METRIC,
        unit: 'MicroSecond',
        valueBeforeChangePoint: 200_000,
        valueAfterChangePoint: 1_500_000
      },
      {
        evidenceType: 'TRANSACTIONAL',
        displayName: 'Tasa de fallos',
        entity: EV_SERVICE,
        startTime: NOW - 160 * MIN,
        unit: 'Percent',
        valueBeforeChangePoint: 0,
        valueAfterChangePoint: 12.5
      },
      {
        evidenceType: 'METRIC',
        displayName: 'Uso de CPU',
        entity: EV_HOST,
        startTime: NOW - 150 * MIN,
        metricId: 'builtin:host.cpu.usage',
        unit: 'Percent'
      },
      {
        evidenceType: 'AVAILABILITY_EVIDENCE',
        displayName: 'Host no disponible',
        entity: EV_HOST,
        // Segunda causa raíz: va arriba y no en el grupo de host-ev.
        rootCauseRelevant: true,
        startTime: NOW - 140 * MIN,
        endTime: NOW - 130 * MIN
      },
      {
        evidenceType: 'MAINTENANCE_WINDOW',
        displayName: 'Ventana de mantenimiento',
        startTime: NOW - 120 * MIN
      },
      {
        evidenceType: 'TIPO_NUEVO_E2E',
        displayName: 'Algo nuevo',
        // groupingEntity distinta de la entidad: el grupo es el de host-ev, no proc-nuevo.
        entity: evEntity('PROCESS_GROUP_INSTANCE-EV2', 'PROCESS_GROUP_INSTANCE', 'proc-nuevo'),
        groupingEntity: EV_HOST,
        startTime: NOW - 100 * MIN
      },
      {
        evidenceType: 'EVENT',
        displayName: 'Despliegue',
        entity: EV_SERVICE,
        startTime: NOW - 180 * MIN,
        eventType: 'CUSTOM_DEPLOYMENT'
      }
    ]
  },
  recentComments: {
    totalCount: 7,
    comments: [
      {
        authorName: 'ana',
        content: 'Último comentario',
        context: 'dynatrace-problem-ui',
        createdAtTimestamp: NOW - 10 * MIN
      },
      { content: HOSTILE_COMMENT, createdAtTimestamp: NOW - 20 * MIN }
    ]
  }
})

/**
 * v0.9.2: mini gráficos de los EVENT con dt.event.metric_selector (en data.properties,
 * value de texto, como se vio en vivo). Selectores inventados con métricas builtin
 * genéricas, sin comas (el simulador separa por comas las consultas de Métricas).
 */
export const SEL_OK = 'builtin:service.response.time:splitBy("dt.entity.service"):avg'
export const SEL_BAD = 'builtin:service.errors.total.count:splitBy():sum:e2e400'
export const SEL_FORBIDDEN = 'builtin:host.disk.usedPct:avg:e2e403'
export const SEL_EMPTY = 'builtin:host.mem.usage:avg:e2evacio'
export const SEL_MANY = 'builtin:service.requestCount.total:splitBy("dt.entity.service"):sum:e2e25'
export const SEL_LAZY = (i: number): string => `builtin:host.cpu.usage:avg:e2elazy${i}`
export const CHART_ENTITY = 'SERVICE-MC1'

/** v0.10.0: eventId de un evento con gráfico, sacado de su nombre ("Gráfico 1" → mc-gráfico-1). */
export function chartEventId(name: string): string {
  return `mc-${name.toLowerCase().replace(/\s+/g, '-')}`
}

/** Un EVENT con el selector (y el umbral) en data.properties, como llega de la API. */
export function metricEvent(
  name: string,
  selector: string | null,
  extra: Record<string, unknown> = {},
  threshold?: string
): Record<string, unknown> {
  return {
    evidenceType: 'EVENT',
    displayName: name,
    entity: { entityId: { id: CHART_ENTITY, type: 'SERVICE' }, name: 'svc-graficos' },
    startTime: NOW - 90 * 60_000,
    endTime: -1,
    eventType: 'CUSTOM_ALERT',
    data: {
      // v0.10.0: eventId para localizar su fila y su detalle.
      eventId: chartEventId(name),
      properties: [
        { key: 'dt.event.title', value: name },
        ...(selector === null ? [] : [{ key: 'dt.event.metric_selector', value: selector }]),
        ...(threshold === undefined ? [] : [{ key: 'dt.event.metric_threshold', value: threshold }])
      ]
    },
    ...extra
  }
}

export const CHART_ID = 'pd-chart'
detailOnly.push({
  problemId: CHART_ID,
  displayId: 'P-780',
  title: 'Problema con gráficos de métrica',
  status: 'OPEN',
  severityLevel: 'PERFORMANCE',
  impactLevel: 'SERVICES',
  startTime: NOW - 2 * HOUR,
  endTime: -1,
  affectedEntities: [{ entityId: { id: CHART_ENTITY, type: 'SERVICE' }, name: 'svc-graficos' }],
  impactedEntities: [],
  managementZones: [],
  problemFilters: [],
  evidenceDetails: {
    totalCount: 7,
    details: [
      metricEvent('Respuesta lenta', SEL_OK, {}, '850'),
      metricEvent('Selector no compatible', SEL_BAD),
      metricEvent('Sin permiso', SEL_FORBIDDEN),
      metricEvent('Sin datos', SEL_EMPTY),
      metricEvent('Muchas series', SEL_MANY, {
        entity: { entityId: { id: 'SERVICE-MC20', type: 'SERVICE' }, name: 'svc-20' }
      }),
      metricEvent('Selector largo', `builtin:host.cpu.usage:filter(${'x'.repeat(2000)}):avg`),
      metricEvent('Sin selector', null)
    ]
  }
})

/** v0.9.2: problema CERRADO con 20 gráficos, para la carga diferida y la cola. */
export const LAZY_ID = 'pd-lazy'
detailOnly.push({
  problemId: LAZY_ID,
  displayId: 'P-781',
  title: 'Problema con veinte gráficos',
  status: 'CLOSED',
  severityLevel: 'PERFORMANCE',
  impactLevel: 'SERVICES',
  startTime: NOW - 6 * HOUR,
  endTime: NOW - 4 * HOUR,
  affectedEntities: [{ entityId: { id: CHART_ENTITY, type: 'SERVICE' }, name: 'svc-graficos' }],
  impactedEntities: [],
  managementZones: [],
  problemFilters: [],
  evidenceDetails: {
    totalCount: 20,
    details: Array.from({ length: 20 }, (_, i) =>
      metricEvent(`Gráfico ${i + 1}`, SEL_LAZY(i + 1), {
        startTime: NOW - 6 * HOUR + i * 60_000,
        endTime: NOW - 5 * HOUR
      })
    )
  }
})

/** v0.9.2: problema ABIERTO con una evidencia terminada y otra activa (el reloj del problema). */
export const SEL_DONE = 'builtin:service.response.time:avg:e2eterminada'
export const SEL_ACTIVE = 'builtin:service.response.time:avg:e2eactiva'
export const MIXED_ID = 'pd-mixed'
detailOnly.push({
  problemId: MIXED_ID,
  displayId: 'P-782',
  title: 'Problema abierto con una evidencia terminada',
  status: 'OPEN',
  severityLevel: 'PERFORMANCE',
  impactLevel: 'SERVICES',
  startTime: NOW - 3 * HOUR,
  endTime: -1,
  affectedEntities: [{ entityId: { id: CHART_ENTITY, type: 'SERVICE' }, name: 'svc-graficos' }],
  impactedEntities: [],
  managementZones: [],
  problemFilters: [],
  evidenceDetails: {
    totalCount: 2,
    details: [
      metricEvent('Evidencia terminada', SEL_DONE, {
        startTime: NOW - 3 * HOUR,
        endTime: NOW - 2 * HOUR
      }),
      metricEvent('Evidencia activa', SEL_ACTIVE, { startTime: NOW - HOUR, endTime: -1 })
    ]
  }
})

/**
 * v0.10.2: problema ABIERTO hace 45 días con un EVENT igual de largo y un gráfico (el caso
 * real de Dani: un mes abierto, rango de días). Regresión del eje «00:00».
 */
export const SEL_LONG = 'builtin:service.response.time:avg:e2elargo'
export const LONG_ID = 'pd-long'
export const LONG_DAYS = 45
export const DAY_MS = 24 * HOUR
detailOnly.push({
  problemId: LONG_ID,
  displayId: 'P-784',
  title: 'Problema abierto desde hace mes y medio',
  status: 'OPEN',
  severityLevel: 'PERFORMANCE',
  impactLevel: 'SERVICES',
  startTime: NOW - LONG_DAYS * DAY_MS,
  endTime: -1,
  affectedEntities: [{ entityId: { id: CHART_ENTITY, type: 'SERVICE' }, name: 'svc-graficos' }],
  impactedEntities: [],
  managementZones: [],
  problemFilters: [],
  evidenceDetails: {
    totalCount: 1,
    details: [
      metricEvent(
        'Evento largo',
        SEL_LONG,
        { startTime: NOW - LONG_DAYS * DAY_MS, endTime: -1 },
        '50'
      )
    ]
  }
})

/** Si una consulta de /metrics/query es la de un mini gráfico (y no la vista Métricas). */
export function isEventSelector(selector: string): boolean {
  return (
    [
      SEL_OK,
      SEL_BAD,
      SEL_FORBIDDEN,
      SEL_EMPTY,
      SEL_MANY,
      SEL_DONE,
      SEL_ACTIVE,
      SEL_LONG,
      SEL_DESC
    ].includes(selector) || /:e2elazy\d+$/.test(selector)
  )
}

/**
 * v0.10.2: puntos repartidos por todo el rango pedido, con la resolución que devolvería la
 * API: en rangos de más de 30 días, la diaria aunque se pida una más fina.
 */
export function spreadSeries(query: URLSearchParams): { resolution: string; timestamps: number[] } {
  const from = Date.parse(query.get('from') ?? '')
  const to = Date.parse(query.get('to') ?? '') || Date.now()
  const span = to - from
  const resolution = span > 30 * DAY_MS ? '1d' : (query.get('resolution') ?? '1h')
  const count = 24
  return {
    resolution,
    timestamps: Array.from({ length: count }, (_, i) => from + Math.round((span * i) / (count - 1)))
  }
}

/** Respuesta del simulador a la consulta de un mini gráfico, según su selector. */
export function eventMetricResponse(query: URLSearchParams): [number, unknown] {
  const selector = query.get('metricSelector') ?? ''
  if (selector === SEL_BAD) {
    return [
      400,
      { error: { code: 400, message: `Constraints violated: ${selector} not supported` } }
    ]
  }
  if (selector === SEL_FORBIDDEN) {
    return [403, { error: { code: 403, message: 'Token is missing required scope' } }]
  }
  if (selector === SEL_LONG) {
    const spread = spreadSeries(query)
    return [
      200,
      {
        resolution: spread.resolution,
        totalCount: 1,
        result: [
          {
            metricId: selector,
            data: [
              {
                dimensionMap: { 'dt.entity.service': CHART_ENTITY },
                dimensions: [CHART_ENTITY],
                timestamps: spread.timestamps,
                values: spread.timestamps.map((_, i) => 40 + (i % 7) * 3)
              }
            ]
          }
        ]
      }
    ]
  }
  const from = Date.parse(query.get('from') ?? '')
  const timestamps = [0, 1, 2, 3, 4].map((i) => from + i * 10 * 60_000)
  const serie = (entity: string, base: number): Record<string, unknown> => ({
    dimensionMap: { 'dt.entity.service': entity },
    dimensions: [entity],
    timestamps,
    values: [base, base + 5, null, base + 2, base + 9]
  })
  const data =
    selector === SEL_EMPTY
      ? []
      : selector === SEL_MANY
        ? Array.from({ length: 25 }, (_, i) => serie(`SERVICE-MC${i + 1}`, i * 10))
        : // La de la entidad de la evidencia va la segunda: la vista la sube a la primera.
          [serie('SERVICE-OTRO', 100), serie(CHART_ENTITY, 400)]
  return [
    200,
    {
      resolution: query.get('resolution') ?? '1m',
      totalCount: 1,
      result: [{ metricId: selector, data }]
    }
  ]
}

/**
 * v0.10.0: tabla de evidencias. Problema CERRADO con eventos abiertos y cerrados (cada
 * fila, su estado): data.status, data.endTime de respaldo, un EVENT sin data, uno cuyo
 * status no cuadra con su endTime (gana status), tags sin stringRepresentation y más de
 * dos, flags, zonas, propiedades con HTML y un METRIC. 3 abiertos y 3 cerrados.
 */
export const TABLE_ID = 'pd-table'
export const TABLE_HTML = '<b>negrita</b><img src=x onerror="window.__xss=1">'
export const tableEntity = (id: string, type: string, name: string): Record<string, unknown> => ({
  entityId: { id, type },
  name
})
export const T_HOST = tableEntity('HOST-T1', 'HOST', 'host-tabla')
export const T_SERVICE = tableEntity('SERVICE-T1', 'SERVICE', 'servicio-tabla')
export const tableEvent = (
  name: string,
  start: number,
  end: number,
  dataValue: Record<string, unknown> | null,
  extra: Record<string, unknown> = {}
): Record<string, unknown> => ({
  evidenceType: 'EVENT',
  displayName: name,
  eventType: 'CUSTOM_ALERT',
  entity: T_SERVICE,
  startTime: start,
  endTime: end,
  ...(dataValue === null ? {} : { data: dataValue }),
  ...extra
})
export const noFlags = {
  underMaintenance: false,
  frequentEvent: false,
  suppressAlert: false,
  suppressProblem: false
}
detailOnly.push({
  problemId: TABLE_ID,
  displayId: 'P-783',
  title: 'Problema cerrado con eventos abiertos',
  status: 'CLOSED',
  severityLevel: 'ERROR',
  impactLevel: 'SERVICES',
  startTime: NOW - 2 * HOUR,
  endTime: NOW - 10 * 60_000,
  affectedEntities: [T_SERVICE],
  impactedEntities: [],
  managementZones: [],
  problemFilters: [],
  evidenceDetails: {
    totalCount: 6,
    details: [
      tableEvent(
        'CPU saturada',
        NOW - 50 * 60_000,
        -1,
        {
          eventId: 'tbl-1',
          status: 'OPEN',
          endTime: -1,
          title: 'CPU saturada',
          entityTags: [
            {
              context: 'CONTEXTLESS',
              key: 'equipo',
              value: 'pagos',
              stringRepresentation: 'equipo:pagos'
            },
            { context: 'CONTEXTLESS', key: 'zona', value: 'eu' },
            { context: 'CONTEXTLESS', key: 'critico' },
            { context: 'CONTEXTLESS', key: 'capa', value: 'infra' }
          ],
          managementZones: [{ id: 'mz-1', name: 'Producción' }],
          ...noFlags,
          underMaintenance: true,
          properties: [
            { key: 'dt.event.description', value: TABLE_HTML },
            { key: 'cpu.usage', value: 97 }
          ]
        },
        { entity: T_HOST, eventType: 'CPU_SATURATED', rootCauseRelevant: true }
      ),
      tableEvent('Respuesta lenta', NOW - 40 * 60_000, NOW - 20 * 60_000, {
        eventId: 'tbl-2',
        status: 'CLOSED',
        endTime: NOW - 20 * 60_000,
        title: 'Respuesta lenta',
        entityTags: [
          {
            context: 'CONTEXTLESS',
            key: 'equipo',
            value: 'pagos',
            stringRepresentation: 'equipo:pagos'
          }
        ],
        ...noFlags
      }),
      // Sin status: decide data.endTime (-1) → abierto.
      tableEvent('Errores 5xx', NOW - 30 * 60_000, -1, {
        eventId: 'tbl-3',
        endTime: -1,
        title: 'Errores 5xx',
        ...noFlags
      }),
      // Sin data: decide el endTime de la evidencia → cerrado.
      tableEvent('Sin datos de evento', NOW - 45 * 60_000, NOW - 35 * 60_000, null, {
        eventType: 'CUSTOM_INFO'
      }),
      // status CLOSED aunque el endTime diga activo: gana status.
      tableEvent('Estado manda', NOW - 55 * 60_000, -1, {
        eventId: 'tbl-5',
        status: 'CLOSED',
        endTime: -1,
        title: 'Estado manda',
        ...noFlags,
        frequentEvent: true
      }),
      {
        evidenceType: 'METRIC',
        displayName: 'Tiempo de respuesta tabla',
        entity: T_SERVICE,
        startTime: NOW - 60 * 60_000,
        endTime: -1,
        metricId: 'builtin:service.response.time',
        unit: 'MicroSecond',
        valueBeforeChangePoint: 100_000,
        valueAfterChangePoint: 300_000
      }
    ]
  }
})

/**
 * Ficha 0001: descripción del evento (dt.event.description) en Markdown. Problema ABIERTO con
 * cinco EVENT: uno con título, lista, negrita, código y tabla, DESPUÉS de la octava propiedad;
 * otro corto; uno de más de 20 000 caracteres (recortado sea cual sea MAX_DESCRIPTION_LENGTH);
 * uno con HTML en crudo; y uno sin descripción con propiedades, zonas, tags y mini gráfico.
 */
export const DESC_ID = 'pd-desc'
export const DESC_MD = [
  '# Uso de CPU alto',
  '',
  'El proceso supera el umbral con **negrita** y `código`.',
  '',
  '- primer paso',
  '- segundo paso',
  '',
  '| Métrica | Valor |',
  '| --- | --- |',
  '| CPU | 97 % |',
  '',
  // Forma vista en un problema real: escapes con barra invertida y tabla compacta (sin
  // espacios junto a las barras) con fila de alineación.
  'Umbral superado en 9\\.5 puntos',
  '',
  '|Host|Valor|Estado|',
  '|:--|--:|:-:|',
  '|web|9|alto \\(9\\)|'
].join('\n')
export const DESC_SHORT_MD = '## Segundo evento\n\n- **uno**\n- dos'
export const DESC_LONG = `# Descripción larga\n\n${'palabra '.repeat(3200)}`
export const DESC_HTML = [
  '# Aviso',
  '',
  '<img src=x onerror="window.__xssDesc=1">',
  '',
  'Texto <script>window.__xssDesc=2</script> fin'
].join('\n')
export const SEL_DESC = 'builtin:host.cpu.usage:avg:e2edescripcion'
export const DESC_SERVICE = {
  entityId: { id: 'SERVICE-DS1', type: 'SERVICE' },
  name: 'svc-descripcion'
}
export const descEvent = (
  name: string,
  index: number,
  properties: { key: string; value: unknown }[],
  extra: Record<string, unknown> = {}
): Record<string, unknown> => ({
  evidenceType: 'EVENT',
  displayName: name,
  eventType: 'CUSTOM_ALERT',
  entity: DESC_SERVICE,
  startTime: NOW - (60 + index) * 60_000,
  endTime: -1,
  data: {
    eventId: `desc-${index}`,
    status: 'OPEN',
    endTime: -1,
    title: name,
    ...noFlags,
    properties,
    ...extra
  }
})
/** Nueve propiedades genéricas: la descripción va después de la octava. */
export const DESC_OTHERS = Array.from({ length: 9 }, (_, i) => ({
  key: `paso.${i}`,
  value: `valor-${i}`
}))
detailOnly.push({
  problemId: DESC_ID,
  displayId: 'P-785',
  title: 'Problema con descripciones en Markdown',
  status: 'OPEN',
  severityLevel: 'PERFORMANCE',
  impactLevel: 'SERVICES',
  startTime: NOW - 2 * HOUR,
  endTime: -1,
  affectedEntities: [DESC_SERVICE],
  impactedEntities: [],
  managementZones: [],
  problemFilters: [],
  evidenceDetails: {
    totalCount: 5,
    details: [
      descEvent('Descripción con formato', 1, [
        ...DESC_OTHERS,
        { key: 'dt.event.description', value: DESC_MD }
      ]),
      descEvent('Otra con descripción', 2, [{ key: 'dt.event.description', value: DESC_SHORT_MD }]),
      descEvent('Descripción recortada', 3, [{ key: 'dt.event.description', value: DESC_LONG }]),
      descEvent('Descripción con HTML', 4, [{ key: 'dt.event.description', value: DESC_HTML }]),
      descEvent(
        'Sin descripción',
        5,
        [
          { key: 'exit.code', value: 137 },
          { key: 'dt.event.metric_selector', value: SEL_DESC }
        ],
        {
          entityTags: [
            {
              context: 'CONTEXTLESS',
              key: 'equipo',
              value: 'pagos',
              stringRepresentation: 'equipo:pagos'
            }
          ],
          managementZones: [{ id: 'mz-d1', name: 'Zona descripción' }]
        }
      )
    ]
  }
})

/** v0.9.1: los 7 comentarios de P-779 (GET /problems/{id}/comments). */
export const EV_ALL_COMMENTS = [
  {
    authorName: 'ana',
    content: 'Último comentario',
    context: 'dynatrace-problem-ui',
    createdAtTimestamp: NOW - 10 * MIN
  },
  { content: HOSTILE_COMMENT, createdAtTimestamp: NOW - 20 * MIN },
  { authorName: 'luis', content: 'Escalado a red', createdAtTimestamp: NOW - 30 * MIN },
  { authorName: 'luis', createdAtTimestamp: NOW - 40 * MIN },
  { authorName: 'ana', content: 'Mirando', context: 'api', createdAtTimestamp: NOW - 50 * MIN },
  { authorName: 'bot', content: 'Abierto', createdAtTimestamp: NOW - 60 * MIN },
  { authorName: 'bot', content: 'Primer comentario', createdAtTimestamp: NOW - 70 * MIN }
]

export const manyProblems: FakeProblem[] = Array.from({ length: 300 }, (_, i) => ({
  problemId: `pm-${i + 1}`,
  displayId: `P-M${i + 1}`,
  title: `Problema masivo ${i + 1}`,
  status: 'OPEN',
  severityLevel: 'ERROR',
  impactLevel: 'SERVICES',
  startTime: NOW - (i + 1) * 60_000,
  endTime: -1,
  affectedEntities: [
    { entityId: { id: `SERVICE-M${i + 1}`, type: 'SERVICE' }, name: `svc-${i + 1}` }
  ],
  impactedEntities: [],
  managementZones: [],
  problemFilters: []
}))

/** Partes del detalle de P-101 que llegan con fields (evidencias, impactos, comentarios…). */
export const detailExtras = {
  entityTags: [
    { context: 'CONTEXTLESS', key: 'equipo', value: 'pagos', stringRepresentation: 'equipo:pagos' }
  ],
  linkedProblemInfo: { displayId: 'P-099', problemId: 'pa-0' },
  evidenceDetails: {
    totalCount: 1,
    details: [
      {
        evidenceType: 'EVENT',
        displayName: 'Tiempo de respuesta degradado',
        entity: { entityId: { id: 'SERVICE-AAA1', type: 'SERVICE' }, name: 'pagos' },
        rootCauseRelevant: true,
        startTime: NOW - HOUR
      }
    ]
  },
  recentComments: {
    totalCount: 1,
    comments: [
      {
        authorName: 'operador',
        content: 'Revisando el pool de conexiones',
        createdAtTimestamp: NOW
      }
    ]
  }
}

/**
 * Ficha 0006: métricas de una entidad SERVICE (canal entities:serviceMetrics), con un id
 * inventado. Imita lo observado en vivo: un resultado por expresión, en el orden pedido y
 * con el metricId sin las comillas del id; tiempos en µs y tasa en %; fold con
 * resolution=Inf da 400.
 */
export const SVC_ID = 'SERVICE-00000000000E2E01'
export const SVC_T0 = Date.parse('2026-10-03T08:00:00.000Z')
export const SVC_TIMESTAMPS = [0, 1, 2, 3].map((i) => SVC_T0 + i * 60_000)
export type SvcKind = 'median' | 'p90' | 'p99' | 'requests' | 'errors' | 'rate'
export const SVC_SERIES: Record<SvcKind, (number | null)[]> = {
  median: [100_000, 120_000, null, 110_000],
  p90: [300_000, 320_000, null, 310_000],
  p99: [800_000, 900_000, null, 850_000],
  requests: [50, 40, null, 60],
  errors: [5, 0, null, 10],
  rate: [10, 0, null, 16.7]
}
export const SVC_MARKERS: Record<SvcKind, number> = {
  median: 105_000,
  p90: 305_000,
  p99: 820_000,
  requests: 1000,
  errors: 50,
  rate: 5
}

/**
 * Ficha 0014: datos de una entidad (canal entities:get, GET /api/v2/entities/{id}) y nombres
 * de sus relaciones (canal entities:names, GET /api/v2/entities con entityId(...)). Datos
 * inventados con la forma de `Entity` y `EntitiesList` de la OpenAPI v2; solo tipos estándar.
 * Un id que no es ENTITY_INFO_ID da 404; en /entities solo vuelven los de ENTITY_NAMES.
 */
export const ENTITY_INFO_ID = 'SERVICE-00000000000E2E14'
export const ENTITY_INFO_FIRST_SEEN = Date.parse('2026-09-01T08:00:00.000Z')
export const ENTITY_INFO_LAST_SEEN = Date.parse('2026-10-03T09:30:00.000Z')
export const ENTITY_INFO_HOST = 'HOST-00000000000E2E15'
/** 55 servicios llamados: más de los 50 que se devuelven por relación. */
export const ENTITY_INFO_CALLS = Array.from({ length: 55 }, (_, i) => ({
  id: `SERVICE-${(0xe2e100 + i).toString(16).toUpperCase().padStart(16, '0')}`,
  type: 'SERVICE'
}))
export const ENTITY_NAMES: Record<string, string> = {
  [ENTITY_INFO_HOST]: 'servidor-e2e',
  'HOST-00000000000E2E16': 'servidor-e2e-2'
}
export function entityInfoBody(): Record<string, unknown> {
  return {
    entityId: ENTITY_INFO_ID,
    displayName: 'pagos-e2e',
    type: 'SERVICE',
    firstSeenTms: ENTITY_INFO_FIRST_SEEN,
    lastSeenTms: ENTITY_INFO_LAST_SEEN,
    icon: { primaryIconType: 'java' },
    managementZones: [{ id: '1414', name: 'Zona e2e' }],
    tags: [
      {
        context: 'CONTEXTLESS',
        key: 'equipo',
        value: 'pagos',
        stringRepresentation: 'equipo:pagos'
      }
    ],
    properties: {
      serviceType: 'WEB_REQUEST_SERVICE',
      port: 8443,
      webServiceName: 'y'.repeat(350)
    },
    fromRelationships: {
      calls: ENTITY_INFO_CALLS,
      runsOnHost: [{ id: ENTITY_INFO_HOST, type: 'HOST' }]
    },
    toRelationships: {
      isServiceMethodOfService: [{ id: 'SERVICE_METHOD-00000000000E2E17', type: 'SERVICE_METHOD' }]
    }
  }
}

/**
 * Ficha 0015: servicios inventados para la tarjeta «Información» (canal entities:get) y los
 * nombres de sus relaciones (entities:names). Solo tipos estándar e ids inventados.
 *
 * - INFO_FULL_ID: todas las propiedades de la columna «Servicio» (en otro orden que el de la
 *   ficha, mezcladas con internas), dos zonas, 8 etiquetas y relaciones de todos los grupos:
 *   «Se ejecuta en» (2 hosts, 1 proceso y 1 process group), «Llama a» (55 servicios: más de 50),
 *   «Lo llaman» (tipos mezclados: 2 servicios y 1 aplicación, como se vio en vivo en la 0014) y
 *   otras (runsOn, isServiceOf e isServiceMethodOfService).
 * - INFO_FEW_ID: pocas propiedades (una vacía y isExternalService a false), sin fecha de primera
 *   vez, sin zonas, sin etiquetas y sin relaciones.
 * - SVC_ID (el de los marcadores, 0008): las pocas de INFO_FEW_ID, para que su página tenga la
 *   tarjeta sin error.
 *
 * Nombres: los resuelve el simulador salvo INFO_CALLER_UNNAMED («sin nombre»).
 */
export const INFO_FULL_ID = 'SERVICE-00000000000E2E20'
export const INFO_FEW_ID = 'SERVICE-00000000000E2E21'
export const INFO_HOSTS = ['HOST-00000000000E2E22', 'HOST-00000000000E2E23']
export const INFO_PGI = 'PROCESS_GROUP_INSTANCE-00000000000E2E24'
export const INFO_PG = 'PROCESS_GROUP-00000000000E2E25'
export const INFO_CALLER_NAMED = 'SERVICE-00000000000E2E26'
export const INFO_CALLER_UNNAMED = 'SERVICE-00000000000E2E27'
export const INFO_CALLER_APP = 'APPLICATION-00000000000E2E28'
export const INFO_METHOD = 'SERVICE_METHOD-00000000000E2E29'
export const INFO_CALLS = Array.from({ length: 55 }, (_, i) => ({
  id: `SERVICE-${(0xe2e200 + i).toString(16).toUpperCase().padStart(16, '0')}`,
  type: 'SERVICE'
}))
export const INFO_FIRST_SEEN = Date.parse('2026-09-01T10:00:00.000Z')
export const INFO_LAST_SEEN = Date.parse('2026-10-03T10:00:00.000Z')
export const INFO_TAGS = Array.from({ length: 8 }, (_, i) => `etiqueta${i + 1}:valor${i + 1}`)
Object.assign(ENTITY_NAMES, {
  [INFO_HOSTS[0] ?? '']: 'host-info-1',
  [INFO_HOSTS[1] ?? '']: 'host-info-2',
  [INFO_PGI]: 'proceso-info',
  [INFO_PG]: 'grupo-info',
  [INFO_CALLER_NAMED]: 'llamante-info',
  [INFO_CALLER_APP]: 'web-info'
})
/** Propiedades internas de INFO_FULL_ID: solo en «Todas las propiedades». */
export const INFO_INTERNAL = {
  agentTechnologyType: 'JAVA',
  'dt.security_context': 'contexto-interno-e2e',
  detectedName: 'nombre-detectado-e2e',
  matchedServiceDetectionV2Rules: ['regla-interna-e2e']
}
export function infoFullBody(): Record<string, unknown> {
  return {
    entityId: INFO_FULL_ID,
    displayName: 'info-completo-e2e',
    type: 'SERVICE',
    firstSeenTms: INFO_FIRST_SEEN,
    lastSeenTms: INFO_LAST_SEEN,
    icon: { primaryIconType: 'java' },
    managementZones: [
      { id: '1501', name: 'Zona info A' },
      { id: '1502', name: 'Zona info B' }
    ],
    tags: INFO_TAGS.map((text) => {
      const [key, value] = text.split(':')
      return { context: 'CONTEXTLESS', key, value, stringRepresentation: text }
    }),
    properties: {
      agentTechnologyType: INFO_INTERNAL.agentTechnologyType,
      'dt.security_context': INFO_INTERNAL['dt.security_context'],
      publicCloudRegion: 'region-e2e',
      port: 443,
      databaseName: 'pagos_e2e',
      serviceType: 'WEB_REQUEST_SERVICE',
      softwareTechnologies: [
        { type: 'JAVA', edition: 'OpenJDK', version: '17.0.2' },
        { type: 'APACHE_TOMCAT', version: '10.1' }
      ],
      applicationReleaseVersion: ['1.2.3'],
      serviceTechnologyTypes: ['Java', 'Apache Tomcat'],
      contextRoot: '/pagos-e2e',
      webServerName: 'servidor-web-e2e',
      webServiceNamespace: 'urn:e2e:pagos',
      webServiceName: 'ServicioPagosE2e',
      isExternalService: true,
      remoteEndpoint: 'remoto-e2e.invalid',
      detectedName: INFO_INTERNAL.detectedName,
      databaseVendor: 'POSTGRESQL',
      applicationName: ['app-e2e'],
      applicationEnvironment: ['pre-e2e'],
      publicCloudId: 'nube-e2e',
      matchedServiceDetectionV2Rules: INFO_INTERNAL.matchedServiceDetectionV2Rules
    },
    fromRelationships: {
      calls: INFO_CALLS,
      isServiceOfProcessGroup: [{ id: INFO_PG, type: 'PROCESS_GROUP' }],
      runsOn: [{ id: INFO_PG, type: 'PROCESS_GROUP' }],
      runsOnProcessGroupInstance: [{ id: INFO_PGI, type: 'PROCESS_GROUP_INSTANCE' }],
      runsOnHost: INFO_HOSTS.map((id) => ({ id, type: 'HOST' })),
      isServiceOf: [{ id: INFO_PG, type: 'PROCESS_GROUP' }]
    },
    toRelationships: {
      isServiceMethodOfService: [{ id: INFO_METHOD, type: 'SERVICE_METHOD' }],
      calls: [
        { id: INFO_CALLER_NAMED, type: 'SERVICE' },
        { id: INFO_CALLER_APP, type: 'APPLICATION' },
        { id: INFO_CALLER_UNNAMED, type: 'SERVICE' }
      ]
    }
  }
}
/** Número de propiedades de INFO_FULL_ID (todas salen en «Todas las propiedades»). */
export const INFO_FULL_PROPERTY_COUNT = Object.keys(
  (infoFullBody()['properties'] ?? {}) as Record<string, unknown>
).length
export function infoFewBody(entityId: string): Record<string, unknown> {
  return {
    entityId,
    displayName: 'info-pocas-e2e',
    type: 'SERVICE',
    lastSeenTms: INFO_LAST_SEEN,
    managementZones: [],
    tags: [],
    properties: {
      serviceType: 'DATABASE_SERVICE',
      webServerName: '',
      isExternalService: false,
      detectedName: 'solo-detectado-e2e'
    },
    fromRelationships: {},
    toRelationships: {}
  }
}
/**
 * Ficha 0020: hosts inventados para la tarjeta «Información» del HOST (canal entities:get) y los
 * nombres de sus relaciones (entities:names). Solo tipos estándar e ids inventados; las claves
 * y las relaciones son las que se vieron en vivo en la 0020 (en sus mismas direcciones).
 *
 * - HOST_INFO_FULL_ID: todas las claves de la ficha (en otro orden y mezcladas con otras), las
 *   dos memorias (physicalMemory manda), 4 IPs, dos zonas, dos etiquetas y relaciones de todos
 *   los grupos: «Procesos» (isProcessOf de to: 2 procesos), «Servicios» (runsOnHost de to: 2
 *   servicios, uno INFO_FEW_ID para abrir su página), «Se ejecuta en» (runsOn de from: una
 *   instancia EC2), «Grupo de hosts» (isInstanceOf de from) y otras (runsOn de to, isDiskOf e
 *   isNetworkClientOfHost).
 * - HOST_METRICS_ID (el de la 0018 y la 0019): pocas claves (osType, memoryTotal y unas vacías),
 *   solo la última vez visto, sin zonas, etiquetas ni relaciones.
 */
export const HOST_INFO_FULL_ID = 'HOST-00000000000E2E60'
export const HOST_INFO_PGIS = [
  'PROCESS_GROUP_INSTANCE-00000000000E2E61',
  'PROCESS_GROUP_INSTANCE-00000000000E2E62'
]
export const HOST_INFO_SERVICE_2 = 'SERVICE-00000000000E2E63'
export const HOST_INFO_EC2 = 'EC2_INSTANCE-00000000000E2E64'
export const HOST_INFO_GROUP = 'HOST_GROUP-00000000000E2E65'
export const HOST_INFO_PG = 'PROCESS_GROUP-00000000000E2E66'
export const HOST_INFO_DISK = 'DISK-00000000000E2E67'
export const HOST_INFO_PEER = 'HOST-00000000000E2E68'
export const HOST_INFO_FIRST_SEEN = Date.parse('2026-08-20T07:15:00.000Z')
export const HOST_INFO_LAST_SEEN = Date.parse('2026-10-03T11:00:00.000Z')
export const HOST_INFO_IPS = ['192.0.2.10', '192.0.2.11', '198.51.100.7', '2001:db8::10']
Object.assign(ENTITY_NAMES, {
  [HOST_INFO_PGIS[0] ?? '']: 'proceso-host-1',
  [HOST_INFO_PGIS[1] ?? '']: 'proceso-host-2',
  [INFO_FEW_ID]: 'info-pocas-e2e',
  [HOST_INFO_SERVICE_2]: 'servicio-host-e2e',
  [HOST_INFO_EC2]: 'instancia-e2e',
  [HOST_INFO_GROUP]: 'grupo-hosts-e2e'
})
/** Claves de HOST_INFO_FULL_ID que la ficha no nombra: solo en «Todas las propiedades». */
export const HOST_INFO_OTHER = {
  detectedName: 'nombre-detectado-host-e2e',
  macAddresses: ['00-00-5E-00-53-01'],
  standalone: false,
  oneAgentCustomHostName: 'nombre-propio-host-e2e'
}
export function hostInfoFullBody(): Record<string, unknown> {
  return {
    entityId: HOST_INFO_FULL_ID,
    displayName: 'host-info-completo-e2e',
    type: 'HOST',
    firstSeenTms: HOST_INFO_FIRST_SEEN,
    lastSeenTms: HOST_INFO_LAST_SEEN,
    icon: { primaryIconType: 'linux' },
    managementZones: [
      { id: '2001', name: 'Zona host A' },
      { id: '2002', name: 'Zona host B' }
    ],
    tags: [
      {
        context: 'CONTEXTLESS',
        key: 'equipo',
        value: 'sistemas',
        stringRepresentation: 'equipo:sistemas'
      },
      { context: 'CONTEXTLESS', key: 'entorno', value: 'pre', stringRepresentation: 'entorno:pre' }
    ],
    properties: {
      detectedName: HOST_INFO_OTHER.detectedName,
      hypervisorType: 'KVM',
      state: 'RUNNING',
      memoryTotal: 15_500_000_000,
      ipAddress: HOST_INFO_IPS,
      osVersion: 'Ubuntu 24.04 e2e',
      macAddresses: HOST_INFO_OTHER.macAddresses,
      cpuCores: 4,
      standalone: HOST_INFO_OTHER.standalone,
      installerVersion: '1.300.12.20260901-e2e',
      cloudType: 'EC2',
      osType: 'LINUX',
      physicalMemory: 16_000_000_000,
      networkZone: 'zona-red-e2e',
      hostGroupName: 'grupo-hosts-e2e',
      bitness: '64',
      logicalCpuCores: 8,
      monitoringMode: 'FULL_STACK',
      osArchitecture: 'X86',
      oneAgentCustomHostName: HOST_INFO_OTHER.oneAgentCustomHostName
    },
    fromRelationships: {
      isNetworkClientOfHost: [{ id: HOST_INFO_PEER, type: 'HOST' }],
      runsOn: [{ id: HOST_INFO_EC2, type: 'EC2_INSTANCE' }],
      isInstanceOf: [{ id: HOST_INFO_GROUP, type: 'HOST_GROUP' }]
    },
    toRelationships: {
      isDiskOf: [{ id: HOST_INFO_DISK, type: 'DISK' }],
      runsOn: [{ id: HOST_INFO_PG, type: 'PROCESS_GROUP' }],
      runsOnHost: [
        { id: INFO_FEW_ID, type: 'SERVICE' },
        { id: HOST_INFO_SERVICE_2, type: 'SERVICE' }
      ],
      isProcessOf: HOST_INFO_PGIS.map((id) => ({ id, type: 'PROCESS_GROUP_INSTANCE' }))
    }
  }
}
/** Número de propiedades de HOST_INFO_FULL_ID (todas salen en «Todas las propiedades»). */
export const HOST_INFO_FULL_PROPERTY_COUNT = Object.keys(
  (hostInfoFullBody()['properties'] ?? {}) as Record<string, unknown>
).length
export function hostInfoFewBody(entityId: string): Record<string, unknown> {
  return {
    entityId,
    displayName: 'host-metricas',
    type: 'HOST',
    lastSeenTms: HOST_INFO_LAST_SEEN,
    managementZones: [],
    tags: [],
    properties: {
      osType: 'WINDOWS',
      osVersion: '',
      memoryTotal: 8_000_000_000,
      ipAddress: [],
      hostGroupName: '',
      detectedName: 'solo-detectado-host-e2e'
    },
    fromRelationships: {},
    toRelationships: {}
  }
}

/**
 * Ficha 0026: los dos monitores de la 0024 (MONITOR_BROWSER_ID y MONITOR_HTTP_ID) en
 * /entities/{id}, para la tarjeta «Información». Claves y relaciones, las que la 0022 vio en vivo
 * (en sus mismas direcciones); valores e ids inventados y solo tipos estándar. Las localizaciones
 * y los pasos de la tarjeta tienen sus propios ids (no los del desglose de la 0023 y la 0025).
 *
 * - Browser: todas las claves de SYNTHETIC_TEST (capturas y nombre detectado incluidos), activo,
 *   cada 15, 3 localizaciones (runsOn de from), 5 pasos (isStepOf de to), la aplicación que
 *   monitoriza (monitors de from), dos zonas y dos etiquetas; sin otras relaciones.
 * - HTTP: las de HTTP_CHECK, inactivo, cada 5, 4 localizaciones, 2 peticiones, «Monitoriza» con un
 *   servicio (calls de from: INFO_FEW_ID, para abrir su página) y una aplicación
 *   (isApplicationOfSyntheticTest de to), y una relación más (belongsTo) para «Otras relaciones».
 */
export const MONITOR_INFO_APP = 'APPLICATION-00000000000E2EA0'
export const MONITOR_INFO_HTTP_APP = 'APPLICATION-00000000000E2EA1'
export const MONITOR_INFO_OTHER = 'ENVIRONMENT-00000000000E2EA2'
export const MONITOR_INFO_LOCATIONS = [1, 2, 3, 4].map(
  (n) => `SYNTHETIC_LOCATION-00000000000E2EB${n}`
)
export const MONITOR_INFO_STEPS = [1, 2, 3, 4, 5].map(
  (n) => `SYNTHETIC_TEST_STEP-00000000000E2EC${n}`
)
export const MONITOR_INFO_REQUESTS = [1, 2].map((n) => `HTTP_CHECK_STEP-00000000000E2ED${n}`)
export const MONITOR_INFO_FIRST_SEEN = Date.parse('2026-07-01T08:00:00.000Z')
export const MONITOR_INFO_LAST_SEEN = Date.parse('2026-10-03T11:00:00.000Z')
Object.assign(ENTITY_NAMES, {
  [MONITOR_INFO_APP]: 'aplicacion-monitor-e2e',
  [MONITOR_INFO_HTTP_APP]: 'aplicacion-http-e2e',
  ...Object.fromEntries(
    MONITOR_INFO_LOCATIONS.map((id, i) => [id, `localizacion-info-${i + 1}-e2e`])
  ),
  ...Object.fromEntries(MONITOR_INFO_STEPS.map((id, i) => [id, `paso-info-${i + 1}-e2e`])),
  ...Object.fromEntries(MONITOR_INFO_REQUESTS.map((id, i) => [id, `peticion-info-${i + 1}-e2e`]))
})
/** Claves del browser monitor que nunca son fila: solo en «Todas las propiedades». */
export const MONITOR_INFO_HIDDEN = {
  detectedName: 'nombre-detectado-monitor-e2e',
  syntheticScreenshotRegularUri: 'captura-normal-e2e',
  syntheticScreenshotRegularErrorUri: 'captura-error-e2e',
  syntheticScreenshotThumbnailUri: 'captura-mini-e2e',
  syntheticScreenshotThumbnailErrorUri: 'captura-mini-error-e2e'
}
export function monitorInfoBrowserBody(): Record<string, unknown> {
  return {
    entityId: MONITOR_BROWSER_ID,
    displayName: 'browser-monitor-e2e',
    type: 'SYNTHETIC_TEST',
    firstSeenTms: MONITOR_INFO_FIRST_SEEN,
    lastSeenTms: MONITOR_INFO_LAST_SEEN,
    managementZones: [
      { id: '2601', name: 'Zona monitor A' },
      { id: '2602', name: 'Zona monitor B' }
    ],
    tags: [
      { context: 'CONTEXTLESS', key: 'equipo', value: 'web', stringRepresentation: 'equipo:web' },
      { context: 'CONTEXTLESS', key: 'entorno', value: 'pro', stringRepresentation: 'entorno:pro' }
    ],
    properties: {
      ...MONITOR_INFO_HIDDEN,
      steps: MONITOR_INFO_STEPS.map((id, i) => ({ id, name: `paso-info-${i + 1}-e2e` })),
      syntheticMonitorFrequency: 15,
      createdBy: 'autor-e2e',
      assignedLocations: MONITOR_INFO_LOCATIONS.slice(0, 3),
      isEnabled: true,
      browserMonitorSubtype: 'CLICKPATH',
      customizedName: 'nombre-propio-monitor-e2e',
      deviceProfile: 'Desktop',
      lastExecutionTimestamp: MONITOR_INFO_LAST_SEEN,
      lastModificationSource: 'UI',
      lastModifiedBy: 'autor-e2e',
      manuallyAssignedApplications: [MONITOR_INFO_APP],
      modificationTimestamp: MONITOR_INFO_FIRST_SEEN,
      url: 'https://monitor-e2e.invalid/'
    },
    fromRelationships: {
      runsOn: MONITOR_INFO_LOCATIONS.slice(0, 3).map((id) => ({ id, type: 'SYNTHETIC_LOCATION' })),
      monitors: [{ id: MONITOR_INFO_APP, type: 'APPLICATION' }]
    },
    toRelationships: {
      isStepOf: MONITOR_INFO_STEPS.map((id) => ({ id, type: 'SYNTHETIC_TEST_STEP' }))
    }
  }
}
/**
 * Número de propiedades del browser monitor (todas salen en «Todas las propiedades»). Función y no
 * constante: MONITOR_BROWSER_ID se declara más abajo.
 */
export const monitorInfoBrowserPropertyCount = (): number =>
  Object.keys((monitorInfoBrowserBody()['properties'] ?? {}) as Record<string, unknown>).length
export function monitorInfoHttpBody(): Record<string, unknown> {
  return {
    entityId: MONITOR_HTTP_ID,
    displayName: 'http-monitor-e2e',
    type: 'HTTP_CHECK',
    firstSeenTms: MONITOR_INFO_FIRST_SEEN,
    lastSeenTms: MONITOR_INFO_LAST_SEEN,
    managementZones: [{ id: '2603', name: 'Zona monitor H' }],
    tags: [],
    properties: {
      detectedName: 'nombre-detectado-http-e2e',
      isEnabled: false,
      httpMonitorSubtype: 'MULTI_REQUEST',
      syntheticMonitorFrequency: 5,
      assignedLocations: MONITOR_INFO_LOCATIONS,
      steps: MONITOR_INFO_REQUESTS.map((id, i) => ({ id, name: `peticion-info-${i + 1}-e2e` })),
      createdBy: 'autor-e2e',
      lastExecutionTimestamp: MONITOR_INFO_LAST_SEEN,
      lastModificationSource: 'API',
      lastModifiedBy: 'autor-e2e',
      manuallyAssignedApplications: [],
      modificationTimestamp: MONITOR_INFO_FIRST_SEEN
    },
    fromRelationships: {
      calls: [{ id: INFO_FEW_ID, type: 'SERVICE' }],
      belongsTo: [{ id: MONITOR_INFO_OTHER, type: 'ENVIRONMENT' }],
      runsOn: MONITOR_INFO_LOCATIONS.map((id) => ({ id, type: 'SYNTHETIC_LOCATION' }))
    },
    toRelationships: {
      isStepOf: MONITOR_INFO_REQUESTS.map((id) => ({ id, type: 'HTTP_CHECK_STEP' })),
      isApplicationOfSyntheticTest: [{ id: MONITOR_INFO_HTTP_APP, type: 'APPLICATION' }]
    }
  }
}

/**
 * Ficha 0029: el proceso inventado de la 0027 (PROCESS_METRICS_ID) en /entities/{id}, para la
 * tarjeta «Información». Claves y relaciones, las que la 0027 vio en vivo (en sus mismas
 * direcciones) y «Servicios» con `runsOnProcessGroupInstance` de toRelationships (la contraria
 * de la del servicio en la 0015); valores e ids inventados y solo tipos estándar.
 *
 * - `metadata` como lista de `{ key, value }` con `COMMAND_LINE_ARGS` (la línea de comandos, con
 *   una contraseña y un token inventados) y `EXE_PATH` (la ruta completa, con un nombre de
 *   usuario inventado): ninguno de los dos se enseña en ningún sitio (main los filtra). `EXE_NAME`
 *   da la fila «Ejecutable».
 * - Relaciones: el host (isProcessOf de from), el process group (isInstanceOf de from), dos
 *   servicios (runsOnProcessGroupInstance de to: INFO_FEW_ID, para abrir su página, y otro) y
 *   una más (isPgiOfCgi) para «Otras relaciones».
 */
export const PROCESS_INFO_HOST = 'HOST-00000000000E2E90'
export const PROCESS_INFO_PG = 'PROCESS_GROUP-00000000000E2E91'
export const PROCESS_INFO_SERVICE_2 = 'SERVICE-00000000000E2E92'
export const PROCESS_INFO_CGI = 'CONTAINER_GROUP_INSTANCE-00000000000E2E93'
export const PROCESS_INFO_FIRST_SEEN = Date.parse('2026-08-10T06:00:00.000Z')
export const PROCESS_INFO_LAST_SEEN = Date.parse('2026-10-03T11:30:00.000Z')
/** Valores que no pueden salir en ningún sitio de la página. */
export const PROCESS_INFO_SECRETS = {
  commandLineArgs: '-Dclave.bd=CLAVE-LINEA-E2E --token TOKEN-LINEA-E2E -Xmx768m',
  exePath: '/home/usuario-e2e-0029/apps/bin/pagos-worker-e2e'
}
export const PROCESS_INFO_SECRET_PARTS = [
  PROCESS_INFO_SECRETS.commandLineArgs,
  PROCESS_INFO_SECRETS.exePath,
  'CLAVE-LINEA-E2E',
  'TOKEN-LINEA-E2E',
  '-Xmx768m',
  'usuario-e2e-0029',
  '/apps/bin/'
]
Object.assign(ENTITY_NAMES, {
  [PROCESS_INFO_HOST]: 'host-proceso-e2e',
  [PROCESS_INFO_PG]: 'grupo-proceso-e2e',
  [PROCESS_INFO_SERVICE_2]: 'servicio-proceso-e2e'
})
export function processInfoBody(): Record<string, unknown> {
  return {
    entityId: PROCESS_METRICS_ID,
    displayName: 'proceso-metricas-e2e',
    type: 'PROCESS_GROUP_INSTANCE',
    firstSeenTms: PROCESS_INFO_FIRST_SEEN,
    lastSeenTms: PROCESS_INFO_LAST_SEEN,
    managementZones: [{ id: '2901', name: 'Zona proceso A' }],
    tags: [
      {
        context: 'CONTEXTLESS',
        key: 'equipo',
        value: 'proceso',
        stringRepresentation: 'equipo:proceso'
      }
    ],
    properties: {
      awsNameTag: '',
      detectedName: 'pagos-worker-detectado-e2e',
      hasPublicTraffic: false,
      bitness: '64',
      processType: 'JAVA',
      listenPorts: [8080, 8443],
      softwareTechnologies: [
        { type: 'JAVA', edition: 'OpenJDK', version: '17.0.2' },
        { type: 'APACHE_TOMCAT', version: '10.1' }
      ],
      metadata: [
        { key: 'COMMAND_LINE_ARGS', value: PROCESS_INFO_SECRETS.commandLineArgs },
        { key: 'EXE_NAME', value: 'pagos-worker-e2e' },
        { key: 'EXE_PATH', value: PROCESS_INFO_SECRETS.exePath },
        { key: 'OSAGENT_GROUPID_NAME', value: 'grupo-agente-e2e' }
      ]
    },
    fromRelationships: {
      isProcessOf: [{ id: PROCESS_INFO_HOST, type: 'HOST' }],
      isInstanceOf: [{ id: PROCESS_INFO_PG, type: 'PROCESS_GROUP' }],
      isPgiOfCgi: [{ id: PROCESS_INFO_CGI, type: 'CONTAINER_GROUP_INSTANCE' }]
    },
    toRelationships: {
      runsOnProcessGroupInstance: [
        { id: INFO_FEW_ID, type: 'SERVICE' },
        { id: PROCESS_INFO_SERVICE_2, type: 'SERVICE' }
      ]
    }
  }
}

/**
 * Ficha 0037: servicios inventados para las píldoras de etiquetas (solo tipos estándar e ids
 * inventados; cada etiqueta, con la forma de `EnrichedTagDto` de la OpenAPI v2).
 *
 * - TAGS_ID: cinco etiquetas desordenadas: dos sin contexto (CONTEXTLESS), una de ellas de solo
 *   clave (sin `value`), y tres con contexto (AWS, KUBERNETES y ENVIRONMENT). Por clave, en
 *   orden alfabético: app, critico, equipo, nombre y zona.
 * - TAGS_MANY_ID: 40 etiquetas largas, al revés del orden alfabético: no caben en dos líneas.
 */
export const TAGS_ID = 'SERVICE-00000000000E2F37'
export const TAGS_MANY_ID = 'SERVICE-00000000000E2F38'
/**
 * Ficha 0049: servicio inventado para la cápsula de etiquetas: dos etiquetas con la misma clave
 * (`equipo`), una con otra clave y valor (`zona`) y una de solo clave (`critico`).
 */
export const TAGS_CAPSULE_ID = 'SERVICE-00000000000E2F49'
export const TAGS_SORTED_KEYS = ['app', 'critico', 'equipo', 'nombre', 'zona']
export const TAGS_MANY_KEYS = Array.from(
  { length: 40 },
  (_, i) => `etiqueta-larga-${String(i + 1).padStart(2, '0')}`
)
export function tagsBody(
  entityId: string,
  tags: Record<string, unknown>[]
): Record<string, unknown> {
  return { ...infoFewBody(entityId), displayName: 'etiquetas-e2e', tags }
}
export function tagsMixedBody(): Record<string, unknown> {
  return tagsBody(TAGS_ID, [
    { context: 'CONTEXTLESS', key: 'zona', value: 'norte', stringRepresentation: 'zona:norte' },
    {
      context: 'AWS',
      key: 'nombre',
      value: 'pagos-aws-e2e',
      stringRepresentation: '[AWS]nombre:pagos-aws-e2e'
    },
    { context: 'CONTEXTLESS', key: 'critico', stringRepresentation: 'critico' },
    {
      context: 'KUBERNETES',
      key: 'app',
      value: 'pagos-k8s-e2e',
      stringRepresentation: '[Kubernetes]app:pagos-k8s-e2e'
    },
    {
      context: 'ENVIRONMENT',
      key: 'equipo',
      value: 'pagos-entorno-e2e',
      stringRepresentation: '[Environment]equipo:pagos-entorno-e2e'
    }
  ])
}
export function tagsCapsuleBody(): Record<string, unknown> {
  return tagsBody(TAGS_CAPSULE_ID, [
    { context: 'CONTEXTLESS', key: 'equipo', value: 'pagos', stringRepresentation: 'equipo:pagos' },
    { context: 'CONTEXTLESS', key: 'zona', value: 'norte', stringRepresentation: 'zona:norte' },
    { context: 'CONTEXTLESS', key: 'critico', stringRepresentation: 'critico' },
    { context: 'CONTEXTLESS', key: 'equipo', value: 'web', stringRepresentation: 'equipo:web' }
  ])
}
export function tagsManyBody(): Record<string, unknown> {
  return tagsBody(
    TAGS_MANY_ID,
    [...TAGS_MANY_KEYS].reverse().map((key) => ({
      context: 'CONTEXTLESS',
      key,
      value: `valor-bastante-largo-de-${key}`,
      stringRepresentation: `${key}:valor-bastante-largo-de-${key}`
    }))
  )
}

/**
 * Ficha 0040: la entidad DISK de /datos, con las claves vistas en vivo (paso 0): `properties`
 * con `detectedName` y `filesystemType`, y la relación `fromRelationships.isDiskOf` con su
 * host (HOST_METRICS_ID, el de la página del host).
 */
export function diskInfoBody(): Record<string, unknown> {
  return {
    entityId: DISK_PAGE_ID,
    displayName: DISK_PAGE_NAME,
    type: 'DISK',
    firstSeenTms: PROCESS_INFO_FIRST_SEEN,
    lastSeenTms: HOST_INFO_LAST_SEEN,
    managementZones: [],
    tags: [],
    properties: { detectedName: DISK_PAGE_NAME, filesystemType: DISK_PAGE_FILESYSTEM },
    fromRelationships: { isDiskOf: [{ id: HOST_METRICS_ID, type: 'HOST' }] },
    toRelationships: {}
  }
}

/** Ficha 0015: lo que devuelve el simulador en /entities/{id}, por id (el resto, 404). */
export function entityBodies(): Record<string, Record<string, unknown>> {
  return {
    [ENTITY_INFO_ID]: entityInfoBody(),
    [INFO_FULL_ID]: infoFullBody(),
    [INFO_FEW_ID]: infoFewBody(INFO_FEW_ID),
    [SVC_ID]: infoFewBody(SVC_ID),
    // Ficha 0020.
    [HOST_INFO_FULL_ID]: hostInfoFullBody(),
    [HOST_METRICS_ID]: hostInfoFewBody(HOST_METRICS_ID),
    // Ficha 0026.
    [MONITOR_BROWSER_ID]: monitorInfoBrowserBody(),
    [MONITOR_HTTP_ID]: monitorInfoHttpBody(),
    // Ficha 0029.
    [PROCESS_METRICS_ID]: processInfoBody(),
    // Ficha 0032.
    [PROCESS_GROUP_PAGE_ID]: processGroupInfoBody(),
    // Ficha 0034.
    [APPLICATION_METRICS_ID]: applicationInfoBody(),
    // Ficha 0037.
    [TAGS_ID]: tagsMixedBody(),
    [TAGS_MANY_ID]: tagsManyBody(),
    // Ficha 0049.
    [TAGS_CAPSULE_ID]: tagsCapsuleBody(),
    // Ficha 0040.
    [DISK_PAGE_ID]: diskInfoBody(),
    // Ficha 0041.
    [HOST_LOGS_PAGE.id]: hostLogsProcessBody()
  }
}

/**
 * Ficha 0008: más servicios inventados para los marcadores. Uno con muchas peticiones, ningún
 * error y tiempos de más de un segundo (separador de miles y «s»), y otro sin datos (no está en
 * esta tabla: el simulador le da `data: []`). SVC_ID es el de la 0006 (con errores).
 */
export const SVC_BIG_ID = 'SERVICE-00000000000E2E02'
export const SVC_EMPTY_ID = 'SERVICE-00000000000E2E03'
/**
 * Ficha 0010: servicios inventados para la franja de problemas del gráfico «Tasa de error»,
 * con las mismas métricas que SVC_ID. SVC_BAND_ID tiene un problema abierto y uno cerrado en el
 * rango de 2 h (bandProblems); SVC_QUIET_ID no tiene ninguno.
 */
export const SVC_BAND_ID = 'SERVICE-00000000000E2E04'
export const SVC_QUIET_ID = 'SERVICE-00000000000E2E05'
/**
 * Ficha 0013: servicio con dos problemas cerrados de pocos minutos (shortProblems): en un rango
 * de 7 días, sus tramos son muy estrechos; uno de ellos, pegado al final del rango.
 */
export const SVC_SHORT_ID = 'SERVICE-00000000000E2E06'
/**
 * Ficha 0013: servicio con un problema cerrado con un id del largo real (P- y 8 cifras), de
 * `sim.bandLongMinutes` minutos (longIdProblems): el test elige la duración para que su tramo
 * mida 5rem o más sin sitio para el id.
 */
export const SVC_LONG_ID = 'SERVICE-00000000000E2E09'
/**
 * Ficha 0012: servicio cuyas peticiones KO suman 9907 (5000 + 4000 + 907): el marcador lleva el
 * separador de miles aunque el número tenga solo 4 cifras.
 */
export const SVC_KO_THOUSANDS_ID = 'SERVICE-0000000000E2E012'
/**
 * Ficha 0048: servicio con una caída de la disponibilidad por debajo del 90 %: por punto, 96 %,
 * 100 %, hueco y 66,7 %; en el rango, 128 de 150 peticiones sin error (85,3 %).
 */
export const SVC_SLO_ID = 'SERVICE-0000000000E2E048'
export const SVC_DATA: Record<
  string,
  { series: Record<SvcKind, (number | null)[]>; markers: Record<SvcKind, number> }
> = {
  [SVC_ID]: { series: SVC_SERIES, markers: SVC_MARKERS },
  [SVC_BAND_ID]: { series: SVC_SERIES, markers: SVC_MARKERS },
  [SVC_QUIET_ID]: { series: SVC_SERIES, markers: SVC_MARKERS },
  [SVC_SHORT_ID]: { series: SVC_SERIES, markers: SVC_MARKERS },
  [SVC_LONG_ID]: { series: SVC_SERIES, markers: SVC_MARKERS },
  [SVC_KO_THOUSANDS_ID]: {
    series: {
      ...SVC_SERIES,
      requests: [20_000, 15_000, null, 10_000],
      errors: [5000, 4000, null, 907]
    },
    markers: { ...SVC_MARKERS, requests: 45_000, errors: 9907 }
  },
  [SVC_SLO_ID]: {
    series: { ...SVC_SERIES, errors: [2, 0, null, 20], rate: [4, 0, null, 33.3] },
    markers: { ...SVC_MARKERS, errors: 22, rate: 14.7 }
  },
  [SVC_BIG_ID]: {
    series: {
      median: [800_000, 900_000, null, 850_000],
      p90: [1_100_000, 1_300_000, null, 1_200_000],
      p99: [2_400_000, 2_600_000, null, 2_500_000],
      requests: [20_000, 15_000, null, 10_000],
      errors: [0, 0, null, 0],
      rate: [0, 0, null, 0]
    },
    markers: {
      median: 850_000,
      p90: 1_200_000,
      p99: 2_500_000,
      requests: 45_000,
      errors: 0,
      rate: 0
    }
  }
}

/**
 * Ficha 0046: un servicio inventado de cada conjunto de métricas. Cada uno solo tiene datos en
 * las métricas de su conjunto (las demás, `data: []`, como en vivo). Tiempos de Servidor y
 * Cliente en µs; los de las unificadas, en ms. Solo actividad: el recuento de
 * `response.server:count`, sin tiempos ni errores.
 */
export const SVC_UNIFIED_KEYS = {
  time: 'builtin:service.request.response_time_service_aggregation',
  errors: 'builtin:service.request.failure_count_service_aggregation',
  requests: 'builtin:service.request.count_service_aggregation'
}
export type SvcSet = 'server' | 'client' | 'unified' | 'activity'
export const SVC_SET_IDS: Record<SvcSet, string> = {
  server: 'SERVICE-00000000000E2E46',
  client: 'SERVICE-00000000000E2E47',
  unified: 'SERVICE-00000000000E2E48',
  activity: 'SERVICE-00000000000E2E49'
}
/** serviceType y propiedades de cada uno (solo tipos estándar; valores inventados). */
export const SVC_SET_ENTITY: Record<
  SvcSet,
  { serviceType: string; properties: Record<string, string> }
> = {
  server: { serviceType: 'WEB_REQUEST_SERVICE', properties: { webServerName: 'web-e2e' } },
  client: { serviceType: 'RPC_SERVICE', properties: { remoteServiceName: 'remoto-e2e' } },
  unified: { serviceType: 'UNIFIED', properties: {} },
  activity: { serviceType: 'QUEUE_LISTENER_SERVICE', properties: {} }
}
/**
 * Ficha 0047: un DATABASE_SERVICE (Cliente) para la página, con los datos del de Cliente. Va
 * aparte de `SVC_SET_IDS` para no cambiar el recorrido de los cuatro conjuntos de la 0046.
 */
export const SVC_DB_ID = 'SERVICE-00000000000E2E4A'
export type SvcSetKind = SvcKind | 'count'
export const SVC_SET_DATA: Record<
  string,
  {
    family: 'server' | 'client' | 'unified'
    series: Partial<Record<SvcSetKind, (number | null)[]>>
    markers: Partial<Record<SvcSetKind, number | null>>
  }
> = {
  [SVC_SET_IDS.server]: { family: 'server', series: SVC_SERIES, markers: SVC_MARKERS },
  [SVC_SET_IDS.client]: {
    family: 'client',
    series: {
      median: [200_000, 210_000, null, 220_000],
      p90: [400_000, 410_000, null, 420_000],
      p99: [700_000, 710_000, null, 720_000],
      requests: [30, 20, null, 10],
      errors: [3, 0, null, 1],
      rate: [10, 0, null, 10]
    },
    markers: { median: 210_000, p90: 410_000, p99: 710_000, requests: 60, errors: 4, rate: 6.7 }
  },
  [SVC_SET_IDS.unified]: {
    family: 'unified',
    series: {
      median: [150, 160, null, 170],
      p90: [250, 260, null, 270],
      p99: [450, 460, null, 470],
      requests: [40, 10, null, 50],
      errors: [4, 0, null, 5]
    },
    markers: { median: 160, p90: 260, p99: 460, requests: 100, errors: 9 }
  },
  // Solo actividad: requestCount.server, errores y tiempos no tienen datos.
  [SVC_SET_IDS.activity]: {
    family: 'server',
    series: { count: [7, 0, null, 3] },
    markers: { count: 10 }
  }
}
// Ficha 0047: el DATABASE_SERVICE, con los mismos datos que el de Cliente.
SVC_SET_DATA[SVC_DB_ID] = SVC_SET_DATA[SVC_SET_IDS.client] as (typeof SVC_SET_DATA)[string]

/**
 * Ficha 0046: lo que devuelve /entities/{id} a entities:serviceMetrics (con
 * `+properties.serviceType`). Los servicios de las fichas anteriores son WEB_SERVICE (Servidor,
 * las métricas de siempre), aunque su tarjeta de entities:get diga otro tipo; el resto, 404.
 */
export function serviceTypeBodies(): Record<string, Record<string, unknown>> {
  const body = (
    id: string,
    serviceType: string,
    properties: Record<string, string> = {}
  ): Record<string, unknown> => ({
    entityId: id,
    displayName: 'servicio-e2e',
    type: 'SERVICE',
    properties: { serviceType, ...properties }
  })
  return {
    ...Object.fromEntries(
      [...Object.keys(SVC_DATA), SVC_EMPTY_ID].map((id) => [id, body(id, 'WEB_SERVICE')])
    ),
    ...Object.fromEntries(
      (Object.keys(SVC_SET_IDS) as SvcSet[]).map((set) => [
        SVC_SET_IDS[set],
        body(SVC_SET_IDS[set], SVC_SET_ENTITY[set].serviceType, SVC_SET_ENTITY[set].properties)
      ])
    ),
    // Ficha 0047.
    [SVC_DB_ID]: body(SVC_DB_ID, 'DATABASE_SERVICE')
  }
}

export const BAND_OPEN = {
  problemId: 'pd-band-open',
  displayId: 'P-E2E41',
  title: 'Caída de pagos en la franja'
}
export const BAND_CLOSED = {
  problemId: 'pd-band-closed',
  displayId: 'P-E2E42',
  title: 'Lentitud resuelta en la franja'
}
/** Inicio y fin de los dos problemas de la franja, contados desde `sim.bandNow` (por test). */
export function bandTimes(): { open: [number, number]; closed: [number, number] } {
  const now = sim.bandNow
  return {
    open: [now - 30 * 60_000, -1],
    closed: [now - 100 * 60_000, now - 70 * 60_000]
  }
}

/**
 * Ficha 0010: los dos problemas de SVC_BAND_ID (uno abierto y uno cerrado, sin solaparse y
 * dentro de las últimas 2 h). Salen en las consultas con affectedEntities y en el detalle.
 */
export function bandProblems(): FakeProblem[] {
  const times = bandTimes()
  return (
    [
      [BAND_OPEN, 'OPEN', times.open],
      [BAND_CLOSED, 'CLOSED', times.closed]
    ] as const
  ).map(([ids, status, [startTime, endTime]]) => ({
    ...ids,
    status,
    severityLevel: 'ERROR',
    impactLevel: 'SERVICES',
    startTime,
    endTime,
    affectedEntities: [{ entityId: { id: SVC_BAND_ID, type: 'SERVICE' }, name: 'servicio-franja' }],
    impactedEntities: [],
    managementZones: [],
    problemFilters: [],
    evidenceDetails: { totalCount: 0, details: [] }
  }))
}

export const HOST_BAND_OPEN = {
  problemId: 'pd-host-band-open',
  displayId: 'P-E2E51',
  title: 'CPU saturada en el host'
}
export const HOST_BAND_CLOSED = {
  problemId: 'pd-host-band-closed',
  displayId: 'P-E2E52',
  title: 'Memoria agotada en el host'
}
export const HOST_BAND_CLOSED_2 = {
  problemId: 'pd-host-band-closed-2',
  displayId: 'P-E2E53',
  title: 'Disco lleno en el host'
}

/**
 * Ficha 0018: los problemas de HOST_METRICS_ID (uno abierto y dos cerrados, sin solaparse y
 * dentro de las últimas 2 h). Salen en las consultas con affectedEntities (recuentos y franja) y
 * en el detalle.
 */
export function hostBandProblems(): FakeProblem[] {
  const now = sim.bandNow
  return (
    [
      [HOST_BAND_OPEN, 'OPEN', now - 30 * 60_000, -1],
      [HOST_BAND_CLOSED, 'CLOSED', now - 100 * 60_000, now - 70 * 60_000],
      [HOST_BAND_CLOSED_2, 'CLOSED', now - 60 * 60_000, now - 45 * 60_000]
    ] as const
  ).map(([ids, status, startTime, endTime]) => ({
    ...ids,
    status,
    severityLevel: 'RESOURCE_CONTENTION',
    impactLevel: 'INFRASTRUCTURE',
    startTime,
    endTime,
    affectedEntities: [{ entityId: { id: HOST_METRICS_ID, type: 'HOST' }, name: 'host-metricas' }],
    impactedEntities: [],
    managementZones: [],
    problemFilters: [],
    evidenceDetails: { totalCount: 0, details: [] }
  }))
}

export const PROCESS_BAND_OPEN = {
  problemId: 'pd-process-band-open',
  displayId: 'P-E2E81',
  title: 'Proceso con CPU saturada'
}
export const PROCESS_BAND_CLOSED = {
  problemId: 'pd-process-band-closed',
  displayId: 'P-E2E82',
  title: 'Proceso caído'
}

/**
 * Ficha 0028: los problemas del proceso inventado de la 0027 (PROCESS_METRICS_ID), uno abierto y
 * uno cerrado, dentro de las últimas 2 h y sin solaparse. Salen en las consultas con
 * affectedEntities (recuentos y franja) y en el detalle. Los procesos de la tabla del host, sin
 * problemas.
 */
export function processBandProblems(): FakeProblem[] {
  const now = sim.bandNow
  return (
    [
      [PROCESS_BAND_OPEN, 'OPEN', now - 40 * 60_000, -1],
      [PROCESS_BAND_CLOSED, 'CLOSED', now - 110 * 60_000, now - 80 * 60_000]
    ] as const
  ).map(([ids, status, startTime, endTime]) => ({
    ...ids,
    status,
    severityLevel: 'AVAILABILITY',
    impactLevel: 'INFRASTRUCTURE',
    startTime,
    endTime,
    affectedEntities: [
      {
        entityId: { id: PROCESS_METRICS_ID, type: 'PROCESS_GROUP_INSTANCE' },
        name: 'proceso-metricas'
      }
    ],
    impactedEntities: [],
    managementZones: [],
    problemFilters: [],
    evidenceDetails: { totalCount: 0, details: [] }
  }))
}

export const MONITOR_BAND_OPEN = {
  problemId: 'pd-monitor-band-open',
  displayId: 'P-E2E71',
  title: 'Browser monitor sin disponibilidad'
}
export const MONITOR_BAND_CLOSED = {
  problemId: 'pd-monitor-band-closed',
  displayId: 'P-E2E72',
  title: 'Browser monitor lento'
}
export const MONITOR_HTTP_BAND_CLOSED = {
  problemId: 'pd-monitor-http-band-closed',
  displayId: 'P-E2E73',
  title: 'HTTP monitor con fallos'
}

/**
 * Ficha 0024: los problemas de los monitores de las páginas, dentro de las últimas 2 h y sin
 * solaparse: MONITOR_BROWSER_ID con uno abierto y uno cerrado; MONITOR_HTTP_ID con uno cerrado.
 * Salen en las consultas con affectedEntities (recuentos y franja) y en el detalle.
 */
export function monitorBandProblems(): FakeProblem[] {
  const now = sim.bandNow
  return (
    [
      [MONITOR_BAND_OPEN, 'OPEN', now - 30 * 60_000, -1, MONITOR_BROWSER_ID, 'SYNTHETIC_TEST'],
      [
        MONITOR_BAND_CLOSED,
        'CLOSED',
        now - 100 * 60_000,
        now - 70 * 60_000,
        MONITOR_BROWSER_ID,
        'SYNTHETIC_TEST'
      ],
      [
        MONITOR_HTTP_BAND_CLOSED,
        'CLOSED',
        now - 90 * 60_000,
        now - 60 * 60_000,
        MONITOR_HTTP_ID,
        'HTTP_CHECK'
      ]
    ] as const
  ).map(([ids, status, startTime, endTime, entityId, type]) => ({
    ...ids,
    status,
    severityLevel: 'AVAILABILITY',
    impactLevel: 'APPLICATION',
    startTime,
    endTime,
    affectedEntities: [{ entityId: { id: entityId, type }, name: 'monitor-franja' }],
    impactedEntities: [],
    managementZones: [],
    problemFilters: [],
    evidenceDetails: { totalCount: 0, details: [] }
  }))
}

export const BAND_SHORT = {
  problemId: 'pd-band-short',
  displayId: 'P-E2E43',
  title: 'Corte breve en la franja'
}
export const BAND_SHORT_END = {
  problemId: 'pd-band-short-end',
  displayId: 'P-E2E44',
  title: 'Corte breve al final de la franja'
}

/**
 * Ficha 0013: los dos problemas de SVC_SHORT_ID, cerrados y de 4 minutos: uno de hace 3 días y
 * otro que acabó hace 2 minutos (pegado al final del rango).
 */
export function shortProblems(): FakeProblem[] {
  const now = sim.bandNow
  return (
    [
      [BAND_SHORT, now - 3 * 24 * 60 * 60_000, now - 3 * 24 * 60 * 60_000 + 4 * 60_000],
      [BAND_SHORT_END, now - 6 * 60_000, now - 2 * 60_000]
    ] as const
  ).map(([ids, startTime, endTime]) => ({
    ...ids,
    status: 'CLOSED',
    severityLevel: 'ERROR',
    impactLevel: 'SERVICES',
    startTime,
    endTime,
    affectedEntities: [{ entityId: { id: SVC_SHORT_ID, type: 'SERVICE' }, name: 'servicio-corto' }],
    impactedEntities: [],
    managementZones: [],
    problemFilters: [],
    evidenceDetails: { totalCount: 0, details: [] }
  }))
}

export const BAND_LONG = {
  problemId: 'pd-band-long',
  displayId: 'P-24109876',
  title: 'Problema con id largo en la franja'
}

/** Ficha 0013: el problema de SVC_LONG_ID, cerrado, desde hace 100 minutos y de `bandLongMinutes`. */
export function longIdProblems(): FakeProblem[] {
  const start = sim.bandNow - 100 * 60_000
  return [
    {
      ...BAND_LONG,
      status: 'CLOSED',
      severityLevel: 'ERROR',
      impactLevel: 'SERVICES',
      startTime: start,
      endTime: Math.round(start + sim.bandLongMinutes * 60_000),
      affectedEntities: [
        { entityId: { id: SVC_LONG_ID, type: 'SERVICE' }, name: 'servicio-id-largo' }
      ],
      impactedEntities: [],
      managementZones: [],
      problemFilters: [],
      evidenceDetails: { totalCount: 0, details: [] }
    }
  ]
}

/** Separa un metricSelector por las comas de primer nivel (no las de dentro de paréntesis). */
export function splitSelector(selector: string): string[] {
  const parts: string[] = []
  let depth = 0
  let quoted = false
  let current = ''
  for (const char of selector) {
    if (char === '"') quoted = !quoted
    if (!quoted && char === '(') depth += 1
    if (!quoted && char === ')') depth -= 1
    if (!quoted && depth === 0 && char === ',') {
      parts.push(current)
      current = ''
      continue
    }
    current += char
  }
  if (current !== '') parts.push(current)
  return parts
}

/** Ficha 0046: clave de métrica de una expresión (antes del primer «:» tras «builtin:»). */
export function serviceMetricKey(expression: string): string {
  return `builtin:${expression.replace(/^builtin:/, '').split(':')[0] ?? ''}`
}

/**
 * Ficha 0046: conjunto y papel de una expresión de métricas de servicio. `count` es el
 * recuento de `response.server` (Solo actividad). Null si no es de ningún conjunto.
 */
export function serviceFamilyKind(
  expression: string
): { family: 'server' | 'client' | 'unified'; kind: SvcKind | 'count' } | null {
  const key = serviceMetricKey(expression)
  const time = (): SvcKind | 'count' | null =>
    /:median\b/.test(expression)
      ? 'median'
      : /:percentile\(90(\.0+)?\)/.test(expression)
        ? 'p90'
        : /:percentile\(99(\.0+)?\)/.test(expression)
          ? 'p99'
          : /:count\b/.test(expression)
            ? 'count'
            : null
  for (const family of ['server', 'client'] as const) {
    if (key === `builtin:service.requestCount.${family}`) return { family, kind: 'requests' }
    if (key === `builtin:service.errors.${family}.count`) return { family, kind: 'errors' }
    if (key === `builtin:service.errors.${family}.rate`) return { family, kind: 'rate' }
    if (key === `builtin:service.response.${family}`) {
      const kind = time()
      return kind === null ? null : { family, kind }
    }
  }
  if (key === SVC_UNIFIED_KEYS.requests) return { family: 'unified', kind: 'requests' }
  if (key === SVC_UNIFIED_KEYS.errors) return { family: 'unified', kind: 'errors' }
  if (key === SVC_UNIFIED_KEYS.time) {
    const kind = time()
    return kind === null || kind === 'count' ? null : { family: 'unified', kind }
  }
  return null
}

export function serviceKind(expression: string): SvcKind | null {
  const found = serviceFamilyKind(expression)
  return found === null || found.family !== 'server' || found.kind === 'count' ? null : found.kind
}

/** ¿Es una consulta de métricas de servicio (la de series o la de marcadores)? */
export function isServiceSelector(selector: string): boolean {
  return selector.startsWith('builtin:service.')
}

/** Respuesta del simulador a una consulta de métricas del servicio inventado. */
export function serviceMetricResponse(query: URLSearchParams): [number, unknown] {
  const selector = query.get('metricSelector') ?? ''
  const inf = query.get('resolution') === 'Inf'
  if (inf && selector.includes(':fold(')) {
    return [400, { error: { code: 400, message: 'fold no admite resolution Inf (simulado)' } }]
  }
  const marker = inf || selector.includes(':fold(')
  if (sim.serviceMetricsFail) {
    return [
      400,
      { error: { code: 400, message: 'Métricas del servicio no disponibles (simulado)' } }
    ]
  }
  const entitySelector = query.get('entitySelector') ?? ''
  const expressions = splitSelector(selector)
  const serviceOf = (expression: string): string | undefined =>
    [...Object.keys(SVC_DATA), ...Object.keys(SVC_SET_DATA)].find(
      (id) => entitySelector.includes(`entityId("${id}")`) || expression.includes(id)
    )
  /** Ficha 0046: datos de la expresión, solo si es del conjunto del servicio (como en vivo). */
  const dataOf = (expression: string, id: string): (number | null)[] | undefined => {
    const legacy = SVC_DATA[id]
    if (legacy !== undefined) {
      const kind = serviceKind(expression)
      if (kind === null) return undefined
      return marker ? [legacy.markers[kind]] : legacy.series[kind]
    }
    const known = SVC_SET_DATA[id]
    const found = serviceFamilyKind(expression)
    if (known === undefined || found === null || found.family !== known.family) return undefined
    const values = marker ? known.markers[found.kind] : known.series[found.kind]
    if (values === undefined) return undefined
    return marker ? [values as number | null] : (values as (number | null)[])
  }
  return [
    200,
    {
      totalCount: expressions.length,
      nextPageKey: null,
      resolution: marker ? (inf ? 'Inf' : '1m') : '1m',
      result: expressions.map((expression) => {
        const id = serviceOf(expression)
        const values = id === undefined ? undefined : dataOf(expression, id)
        return {
          metricId: id === undefined ? expression : expression.split(`"${id}"`).join(id),
          data:
            values !== undefined && id !== undefined
              ? [
                  {
                    dimensionMap: { 'dt.entity.service': id },
                    dimensions: [id],
                    timestamps: marker ? [SVC_T0 + 240_000] : SVC_TIMESTAMPS,
                    values
                  }
                ]
              : []
        }
      })
    }
  ]
}

/**
 * Ficha 0016: métricas de una entidad HOST (canal entities:hostMetrics), con un id inventado.
 * Imita lo observado en vivo (paso 0): un resultado por expresión, en el orden pedido y con el
 * metricId igual a la expresión; % en 0–100, bytes y bits/s; red y disco con una serie por
 * interfaz o disco salvo con splitBy() (suma o máximo por punto); fold con resolution=Inf da 400.
 */
export const HOST_METRICS_ID = 'HOST-00000000000E2E30'
export const HOST_T0 = Date.parse('2026-10-03T08:00:00.000Z')
export const HOST_TIMESTAMPS = [0, 1, 2].map((i) => HOST_T0 + i * 60_000)
export type HostSeriesKind =
  | 'cpu'
  | 'user'
  | 'system'
  | 'iowait'
  | 'memory'
  | 'memUsed'
  | 'memTotal'
  | 'memRecl'
  | 'netIn'
  | 'netOut'
  | 'disk'
export type HostMarkerKind =
  'cpuAvg' | 'cpuMax' | 'memoryAvg' | 'netIn' | 'netOut' | 'diskMax' | 'load'
/** Series ya juntas (lo que da splitBy():sum en la red y splitBy():max en el disco). */
export const HOST_SERIES: Record<HostSeriesKind, (number | null)[]> = {
  cpu: [12, null, 48],
  user: [8, null, 30],
  system: [3, null, 15],
  iowait: [1, null, 3],
  memory: [50, null, 62.5],
  memUsed: [8_000_000_000, null, 10_000_000_000],
  memTotal: [16_000_000_000, null, 16_000_000_000],
  // Ficha 0039: recuperable en bytes (en vivo, usada + recuperable < total); último dato 2,5 GB.
  memRecl: [3_000_000_000, null, 2_500_000_000],
  netIn: [2000, null, 5000],
  netOut: [400, null, 900],
  disk: [81, null, 91]
}
/** Una serie por interfaz o por disco, si no se juntan con splitBy(). */
export const HOST_PER_ITEM: Record<'netIn' | 'netOut' | 'disk', (number | null)[][]> = {
  netIn: [
    [1500, null, 4000],
    [500, null, 1000]
  ],
  netOut: [
    [300, null, 600],
    [100, null, 300]
  ],
  disk: [
    [81, null, 40],
    [20, null, 91]
  ]
}
export const HOST_MARKERS: Record<HostMarkerKind, number> = {
  cpuAvg: 33.5,
  cpuMax: 95,
  memoryAvg: 57,
  netIn: 3600,
  netOut: 650,
  diskMax: 92,
  load: 2.25
}

/** Clave de la métrica (lo que va antes de la primera transformación). */
export const hostMetricKey = (expression: string): string =>
  /^builtin:[A-Za-z.]+/.exec(expression)?.[0].replace(/\.$/, '') ?? ''
export const hostMerged = (expression: string): boolean =>
  /:splitBy\((\s*|"dt\.entity\.host")\)/.test(expression)
export const hostAgg = (expression: string, aggregation: string): boolean =>
  new RegExp(`:${aggregation}\\b`).test(expression)

export function hostSeriesKind(expression: string): HostSeriesKind | null {
  const kinds: Record<string, HostSeriesKind> = {
    'builtin:host.cpu.usage': 'cpu',
    'builtin:host.cpu.user': 'user',
    'builtin:host.cpu.system': 'system',
    'builtin:host.cpu.iowait': 'iowait',
    'builtin:host.mem.usage': 'memory',
    'builtin:host.mem.used': 'memUsed',
    'builtin:host.mem.total': 'memTotal',
    'builtin:host.mem.recl': 'memRecl'
  }
  const key = hostMetricKey(expression)
  const plain = kinds[key]
  if (plain !== undefined) return hostAgg(expression, 'max') ? null : plain
  if (!hostMerged(expression)) return null
  if (key === 'builtin:host.net.nic.trafficIn' && hostAgg(expression, 'sum')) return 'netIn'
  if (key === 'builtin:host.net.nic.trafficOut' && hostAgg(expression, 'sum')) return 'netOut'
  if (key === 'builtin:host.disk.usedPct' && hostAgg(expression, 'max')) return 'disk'
  return null
}

export function hostMarkerKind(expression: string): HostMarkerKind | null {
  const key = hostMetricKey(expression)
  if (key === 'builtin:host.cpu.usage') return hostAgg(expression, 'max') ? 'cpuMax' : 'cpuAvg'
  if (key === 'builtin:host.mem.usage') return 'memoryAvg'
  if (key === 'builtin:host.cpu.load') return 'load'
  if (!hostMerged(expression)) return null
  if (key === 'builtin:host.net.nic.trafficIn' && hostAgg(expression, 'sum')) return 'netIn'
  if (key === 'builtin:host.net.nic.trafficOut' && hostAgg(expression, 'sum')) return 'netOut'
  if (key === 'builtin:host.disk.usedPct' && hostAgg(expression, 'max')) return 'diskMax'
  return null
}

/** Límite de la OpenAPI: «You can select up to 10 metrics for one query» (ficha 0039). */
export const HOST_MAX_EXPRESSIONS = 10

/**
 * Ficha 0039: cuántas llamadas al canal entities:hostMetrics ha recibido el simulador. Las series
 * pueden ir en varias consultas (más de 10 expresiones), pero cada llamada hace una sola consulta
 * de marcadores (resolution=Inf).
 */
export const hostMetricCalls = (): number =>
  sim.hostMetricQueries.filter((query) => query.get('resolution') === 'Inf').length

/** Ficha 0039: ninguna consulta de métricas del host lleva más de 10 expresiones. */
export function expectHostQueriesWithinLimit(): void {
  for (const query of sim.hostMetricQueries) {
    expect(
      splitSelector(query.get('metricSelector') ?? '').length,
      'expresiones en una consulta'
    ).toBeLessThanOrEqual(HOST_MAX_EXPRESSIONS)
  }
}

/** ¿Es una consulta de métricas del host inventado (series o marcadores)? */
export function isHostMetricsQuery(query: URLSearchParams): boolean {
  const selector = query.get('metricSelector') ?? ''
  return (
    selector.startsWith('builtin:host.') &&
    ((query.get('entitySelector') ?? '').includes(`entityId("${HOST_METRICS_ID}")`) ||
      selector.includes(HOST_METRICS_ID))
  )
}

/** Respuesta del simulador a una consulta de métricas del host inventado. */
export function hostMetricResponse(query: URLSearchParams): [number, unknown] {
  const selector = query.get('metricSelector') ?? ''
  const inf = query.get('resolution') === 'Inf'
  if (inf && selector.includes(':fold(')) {
    return [400, { error: { code: 400, message: 'fold no admite resolution Inf (simulado)' } }]
  }
  const marker = inf || selector.includes(':fold(')
  // Ficha 0039 (decisión del Orquestador): la OpenAPI admite hasta 10 métricas por consulta; en
  // vivo hoy pasan 11, pero el simulador se ciñe a lo documentado.
  if (splitSelector(selector).length > HOST_MAX_EXPRESSIONS) {
    return [400, { error: { code: 400, message: 'Más de 10 métricas en la consulta (simulado)' } }]
  }
  if (sim.hostMetricsFail) {
    return [400, { error: { code: 400, message: 'Métricas del host no disponibles (simulado)' } }]
  }
  const expressions = splitSelector(selector)
  const dataOf = (expression: string): (number | null)[][] => {
    if (marker) {
      const kind = hostMarkerKind(expression)
      return kind === null ? [] : [[HOST_MARKERS[kind]]]
    }
    const kind = hostSeriesKind(expression)
    if (kind !== null) return [HOST_SERIES[kind]]
    const key = hostMetricKey(expression)
    if (key === 'builtin:host.net.nic.trafficIn') return HOST_PER_ITEM.netIn
    if (key === 'builtin:host.net.nic.trafficOut') return HOST_PER_ITEM.netOut
    if (key === 'builtin:host.disk.usedPct') return HOST_PER_ITEM.disk
    return []
  }
  return [
    200,
    {
      totalCount: expressions.length,
      nextPageKey: null,
      resolution: inf ? 'Inf' : '1m',
      result: expressions.map((expression) => ({
        metricId: expression.split(`"${HOST_METRICS_ID}"`).join(HOST_METRICS_ID),
        data: dataOf(expression).map((values, i) => ({
          dimensionMap: { 'dt.entity.host': HOST_METRICS_ID, item: `ITEM-${i}` },
          dimensions: [HOST_METRICS_ID, `ITEM-${i}`],
          timestamps: marker ? [HOST_T0 + 180_000] : HOST_TIMESTAMPS,
          values
        }))
      }))
    }
  ]
}

/**
 * Ficha 0022: métricas de un browser monitor y de un HTTP monitor (canal
 * entities:monitorMetrics), con ids inventados. Imita lo observado en vivo (paso 0): un resultado
 * por expresión, en el orden pedido y con el metricId igual a la expresión; disponibilidad en %
 * (0–100) y tiempos en ms; las métricas por localización traen una serie por localización salvo
 * con splitBy(); http.resultStatus, una por «Result status» salvo con filter(eq(...)); y
 * http.duration.geo:median devuelve lo mismo que :avg (no hay mediana en HTTP). fold con
 * resolution=Inf da 400.
 */
export const MONITOR_BROWSER_ID = 'SYNTHETIC_TEST-00000000000E2E40'
export const MONITOR_HTTP_ID = 'HTTP_CHECK-00000000000E2E41'
export const MONITOR_T0 = Date.parse('2026-10-03T08:00:00.000Z')
export const MONITOR_TIMESTAMPS = [0, 1, 2].map((i) => MONITOR_T0 + i * 600_000)
/** Series del monitor, por clave de métrica (ya juntas las localizaciones). */
export const MONITOR_SERIES: Record<string, (number | null)[]> = {
  'builtin:synthetic.browser.availability.location.total': [100, null, 50],
  'builtin:synthetic.browser.totalDuration': [4200, null, 4800],
  'builtin:synthetic.browser.success': [3, null, 1],
  'builtin:synthetic.browser.failure': [0, null, 1],
  'builtin:synthetic.browser.largestContentfulPaint.load': [1900, null, 2300],
  'builtin:synthetic.browser.visuallyComplete.load': [2500, null, 2900],
  'builtin:synthetic.browser.cumulativeLayoutShift.load': [0.05, null, 0.2],
  'builtin:synthetic.browser.speedIndex.load': [1600, null, 1800],
  'builtin:synthetic.http.availability.location.total': [100, null, 75],
  'builtin:synthetic.http.duration.geo': [280, null, 350],
  'resultStatus:SUCCESS': [6, null, 4],
  'resultStatus:FAILURE': [0, null, 2],
  'builtin:synthetic.http.dns.geo': [3, null, 5],
  'builtin:synthetic.http.tcpConnectTime.geo': [10, null, 12],
  'builtin:synthetic.http.tlsHandshakeTime.geo': [20, null, 25],
  'builtin:synthetic.http.timeToFirstByte.geo': [120, null, 160]
}
/** Valor del rango (resolution=Inf), por clave de métrica (y «:median» en la del browser). */
export const MONITOR_MARKERS: Record<string, number> = {
  'builtin:synthetic.browser.availability.location.total': 87.5,
  'builtin:synthetic.browser.totalDuration': 4550,
  'builtin:synthetic.browser.totalDuration:median': 4400,
  'builtin:synthetic.browser.success': 4,
  'builtin:synthetic.browser.failure': 1,
  'builtin:synthetic.http.availability.location.total': 92.5,
  'builtin:synthetic.http.duration.geo': 310,
  'resultStatus:SUCCESS': 10,
  'resultStatus:FAILURE': 2
}

export const monitorKey = (expression: string): string =>
  /^builtin:[A-Za-z.]+/.exec(expression)?.[0].replace(/\.$/, '') ?? ''

/** Clave de las tablas de arriba: la métrica, o «resultStatus:<valor>» si filtra el estado. */
export function monitorEntry(expression: string, marker: boolean): string {
  const key = monitorKey(expression)
  if (key === 'builtin:synthetic.http.resultStatus') {
    const status = /eq\(\s*"Result status"\s*,\s*"(SUCCESS|FAILURE)"\s*\)/.exec(expression)?.[1]
    return status === undefined ? key : `resultStatus:${status}`
  }
  // Observado en vivo: en HTTP, :median da lo mismo que :avg.
  if (marker && /:median\b/.test(expression) && key.startsWith('builtin:synthetic.browser.'))
    return `${key}:median`
  return key
}

/** ¿Es una consulta de métricas de los monitores inventados? */
export function isMonitorMetricsQuery(query: URLSearchParams): boolean {
  const selector = query.get('metricSelector') ?? ''
  const scope = `${selector} ${query.get('entitySelector') ?? ''}`
  return (
    selector.startsWith('builtin:synthetic.') &&
    (scope.includes(MONITOR_BROWSER_ID) || scope.includes(MONITOR_HTTP_ID))
  )
}

/** Respuesta del simulador a una consulta de métricas de los monitores inventados. */
export function monitorMetricResponse(query: URLSearchParams): [number, unknown] {
  const selector = query.get('metricSelector') ?? ''
  const inf = query.get('resolution') === 'Inf'
  if (inf && selector.includes(':fold(')) {
    return [400, { error: { code: 400, message: 'fold no admite resolution Inf (simulado)' } }]
  }
  const marker = inf || selector.includes(':fold(')
  // Ficha 0024: el canal de métricas del monitor falla (errores por panel).
  if (sim.monitorMetricsFail) {
    return [
      400,
      { error: { code: 400, message: 'Métricas del monitor no disponibles (simulado)' } }
    ]
  }
  const scope = `${selector} ${query.get('entitySelector') ?? ''}`
  const id = scope.includes(MONITOR_BROWSER_ID) ? MONITOR_BROWSER_ID : MONITOR_HTTP_ID
  const expressions = splitSelector(selector)
  const dataOf = (expression: string): (number | null)[][] => {
    const entry = monitorEntry(expression, marker)
    // Ficha 0024: un browser monitor sin ninguna métrica de rendimiento (sin series).
    if (sim.monitorPerformanceEmpty && entry.endsWith('.load')) return []
    const one = marker
      ? MONITOR_MARKERS[entry] === undefined
        ? undefined
        : [MONITOR_MARKERS[entry]]
      : MONITOR_SERIES[entry]
    if (one === undefined) return []
    // Por localización o por estado: una serie por cada uno si no se juntan.
    const perLocation =
      entry.endsWith('.geo') ||
      entry.endsWith('availability.location.total') ||
      entry === 'builtin:synthetic.http.resultStatus'
    return perLocation && !/:splitBy\(/.test(expression) ? [one, one] : [one]
  }
  return [
    200,
    {
      totalCount: expressions.length,
      nextPageKey: null,
      resolution: inf ? 'Inf' : '10m',
      result: expressions.map((expression) => ({
        metricId: expression.split(`"${id}"`).join(id),
        data: dataOf(expression).map((values, i) => ({
          dimensionMap: {
            'dt.entity.synthetic_location': `SYNTHETIC_LOCATION-000000000000000${i}`
          },
          dimensions: [`SYNTHETIC_LOCATION-000000000000000${i}`],
          timestamps: marker ? [MONITOR_T0 + 1_800_000] : MONITOR_TIMESTAMPS,
          values
        }))
      }))
    }
  ]
}

/**
 * Ficha 0027: métricas de un proceso (canal entities:processMetrics), con un id inventado. Imita
 * lo observado en vivo (paso 0): con entitySelector=entityId(...), un resultado por expresión, en
 * el orden pedido, con el metricId igual a la expresión y una sola serie; CPU y disponibilidad en
 * % (0–100), memoria en bytes, descriptores de fichero en %, red (bytesRx/bytesTx) en bytes por
 * segundo y salud de red (packets.retransmission) en %, esta solo en series (decisión del
 * Orquestador de 2026-10-08, en la ficha). fold con resolution=Inf da 400.
 */
export const PROCESS_METRICS_ID = 'PROCESS_GROUP_INSTANCE-00000000000E2E50'
export const PROCESS_T0 = Date.parse('2026-10-03T08:00:00.000Z')
export const PROCESS_TIMESTAMPS = [0, 1, 2].map((i) => PROCESS_T0 + i * 600_000)
/** Series del proceso, por expresión (las exactas del paso 0). */
export const PROCESS_SERIES: Record<string, (number | null)[]> = {
  'builtin:tech.generic.cpu.usage': [8, null, 22.5],
  'builtin:tech.generic.mem.workingSetSize': [300_000_000, null, 320_000_000],
  'builtin:tech.generic.network.bytesRx': [4_096, null, 1_024.5],
  'builtin:tech.generic.network.bytesTx': [512, 256, null],
  'builtin:tech.generic.network.packets.retransmission': [0.5, null, 2],
  'builtin:pgi.availability': [100, null, 50],
  'builtin:tech.generic.handles.fileDescriptorsPercentUsed': [0.5, null, 0.8]
}
/** Valor del rango (resolution=Inf), por expresión. */
export const PROCESS_MARKERS: Record<string, number> = {
  'builtin:tech.generic.cpu.usage:avg': 15.25,
  'builtin:tech.generic.cpu.usage:max': 91,
  'builtin:tech.generic.mem.workingSetSize:avg': 310_000_000,
  'builtin:tech.generic.mem.workingSetSize:max': 330_000_000,
  'builtin:tech.generic.network.bytesRx:avg': 2_560,
  'builtin:tech.generic.network.bytesTx:avg': 384,
  'builtin:pgi.availability:avg': 83.5,
  'builtin:tech.generic.handles.fileDescriptorsPercentUsed:max': 0.9
}

/**
 * Ficha 0028: ids de proceso a los que responde el simulador con las métricas de arriba: el
 * inventado de la 0027 y los de la tabla de procesos del host (HOST_PAGE_PROCESSES, 0019), para
 * abrir la página de un proceso desde esa tabla. Los del host se añaden tras definirlos.
 */
export const PROCESS_METRICS_IDS = new Set<string>([PROCESS_METRICS_ID])

/** Id del proceso de la consulta (entityId("…") del entitySelector), o null si no es de uno. */
export function processMetricsEntity(query: URLSearchParams): string | null {
  const match = /^entityId\("(PROCESS_GROUP_INSTANCE-[0-9A-F]{16})"\)$/.exec(
    (query.get('entitySelector') ?? '').trim()
  )
  const id = match?.[1] ?? null
  return id !== null && PROCESS_METRICS_IDS.has(id) ? id : null
}

/** ¿Es una consulta de métricas de uno de los procesos inventados? */
export function isProcessMetricsQuery(query: URLSearchParams): boolean {
  return processMetricsEntity(query) !== null
}

/**
 * Ficha 0028: ¿llega sin datos esta expresión? Con `sim.processEmpty` (claves de métrica, sin
 * agregación), la métrica no trae series ni en la consulta de series ni en la de marcadores, como
 * un proceso real sin esos datos (paso 0 de la 0027: `data` vacío).
 */
export function processExpressionEmpty(expression: string): boolean {
  return sim.processEmpty.some((key) => expression === key || expression.startsWith(`${key}:`))
}

/** Respuesta del simulador a una consulta de métricas de un proceso inventado. */
export function processMetricResponse(query: URLSearchParams): [number, unknown] {
  const selector = query.get('metricSelector') ?? ''
  const inf = query.get('resolution') === 'Inf'
  // Ficha 0028: el canal falla (errores por panel).
  if (sim.processMetricsFail) {
    return [
      400,
      { error: { code: 400, message: 'Métricas del proceso no disponibles (simulado)' } }
    ]
  }
  if (inf && selector.includes(':fold(')) {
    return [400, { error: { code: 400, message: 'fold no admite resolution Inf (simulado)' } }]
  }
  const entityId = processMetricsEntity(query) ?? PROCESS_METRICS_ID
  const expressions = splitSelector(selector)
  return [
    200,
    {
      totalCount: expressions.length,
      nextPageKey: null,
      resolution: inf ? 'Inf' : '10m',
      result: expressions.map((expression) => {
        const one = processExpressionEmpty(expression)
          ? undefined
          : inf
            ? PROCESS_MARKERS[expression] === undefined
              ? undefined
              : [PROCESS_MARKERS[expression]]
            : PROCESS_SERIES[expression]
        return {
          metricId: expression,
          dataPointCountRatio: 0.005,
          dimensionCountRatio: 0.005,
          data:
            one === undefined
              ? []
              : [
                  {
                    dimensionMap: { 'dt.entity.process_group_instance': entityId },
                    dimensions: [entityId],
                    timestamps: inf ? [PROCESS_T0 + 1_800_000] : PROCESS_TIMESTAMPS,
                    values: one
                  }
                ]
        }
      })
    }
  ]
}

/**
 * Ficha 0031: métricas de un process group (canal entities:processGroupMetrics), con ids
 * inventados. Imita lo observado en vivo (paso 0): las instancias del grupo se eligen con
 * `type("PROCESS_GROUP_INSTANCE"),fromRelationships.isInstanceOf(entityId("<grupo>"))`; el total
 * del grupo es `:splitBy():sum` (una serie, sin dimensiones) y, por instancia,
 * `:parents:splitBy("dt.entity.process_group_instance","dt.entity.host"):avg:names` con
 * resolution=Inf trae en dimensionMap la instancia, su host y sus nombres. Responde SOLO a esas
 * expresiones (las demás, sin series); un resultado por expresión, en el orden pedido y con el
 * metricId igual a la expresión. fold con resolution=Inf da 400.
 */
export const PROCESS_GROUP_ID = 'PROCESS_GROUP-00000000000E2E60'
export const PROCESS_GROUP_SELECTOR = `type("PROCESS_GROUP_INSTANCE"),fromRelationships.isInstanceOf(entityId("${PROCESS_GROUP_ID}"))`
export const PROCESS_GROUP_BY_INSTANCE =
  ':parents:splitBy("dt.entity.process_group_instance","dt.entity.host"):avg:names'
/** Instancias inventadas del grupo, con su host. */
export const PROCESS_GROUP_INSTANCES = [
  {
    id: 'PROCESS_GROUP_INSTANCE-00000000000E2E61',
    name: 'Instancia uno',
    hostId: 'HOST-00000000000E2E61',
    hostName: 'Host uno'
  },
  {
    id: 'PROCESS_GROUP_INSTANCE-00000000000E2E62',
    name: 'Instancia dos',
    hostId: 'HOST-00000000000E2E62',
    hostName: 'Host dos'
  }
]
/** Total del grupo por expresión (las exactas del paso 0), sin resolution. */
export const PROCESS_GROUP_SERIES: Record<string, (number | null)[]> = {
  'builtin:tech.generic.cpu.usage:splitBy():sum': [18, null, 112.5],
  'builtin:tech.generic.mem.workingSetSize:splitBy():sum': [900_000_000, null, 950_000_000],
  'builtin:tech.generic.network.bytesRx:splitBy():sum': [8_192, null, 2_048.5],
  'builtin:tech.generic.network.bytesTx:splitBy():sum': [1_024, 512, null]
}
/** Media del total en el rango (resolution=Inf), por expresión. */
export const PROCESS_GROUP_MARKERS: Record<string, number> = {
  'builtin:tech.generic.cpu.usage:splitBy():sum': 64.5,
  'builtin:tech.generic.mem.workingSetSize:splitBy():sum': 925_000_000,
  'builtin:tech.generic.network.bytesRx:splitBy():sum': 5_120,
  'builtin:tech.generic.network.bytesTx:splitBy():sum': 768
}
/** Media por instancia (resolution=Inf), en el orden de PROCESS_GROUP_INSTANCES. */
export const PROCESS_GROUP_INSTANCE_VALUES: Record<string, number[]> = {
  [`builtin:tech.generic.cpu.usage${PROCESS_GROUP_BY_INSTANCE}`]: [20.5, 44],
  [`builtin:tech.generic.mem.workingSetSize${PROCESS_GROUP_BY_INSTANCE}`]: [
    400_000_000, 525_000_000
  ]
}

/**
 * Ficha 0032: el process group de la página (PROCESS_GROUP_PAGE_ID), con siete instancias en tres
 * hosts (ids inventados, solo tipos estándar), para la tabla «Instancias» y el gráfico «CPU por
 * instancia» (como mucho 5, las de más CPU). Mismos totales que el de la 0031; sus medias por
 * instancia, las de aquí. En el orden en que llegan (no el de CPU).
 */
export const PROCESS_GROUP_PAGE_ID = 'PROCESS_GROUP-0000000000E2EC00'
export const PROCESS_GROUP_PAGE_SELECTOR = `type("PROCESS_GROUP_INSTANCE"),fromRelationships.isInstanceOf(entityId("${PROCESS_GROUP_PAGE_ID}"))`
export const pgPageHost = (n: number): { hostId: string; hostName: string } => ({
  hostId: `HOST-0000000000E2EA0${n}`,
  hostName: `host-grupo-${n}`
})
export interface ProcessGroupInstanceFake {
  id: string
  name: string
  hostId: string
  hostName: string
  cpu: number
  memory: number
}
export const PROCESS_GROUP_PAGE_INSTANCES: ProcessGroupInstanceFake[] = [
  [3, 200_000_000, 1],
  [41.5, 700_000_000, 2],
  [12, 300_000_000, 3],
  [0.5, 100_000_000, 1],
  [27, 600_000_000, 2],
  [8, 250_000_000, 3],
  [19, 450_000_000, 1]
].map(([cpu, memory, host], i) => ({
  id: `PROCESS_GROUP_INSTANCE-0000000000E2EB0${i + 1}`,
  name: `instancia-grupo-${i + 1}`,
  ...pgPageHost(host ?? 1),
  cpu: cpu ?? 0,
  memory: memory ?? 0
}))
/** Las instancias de la página, de más a menos CPU media. */
export const PROCESS_GROUP_PAGE_BY_CPU = PROCESS_GROUP_PAGE_INSTANCES.slice().sort(
  (a, b) => b.cpu - a.cpu
)
/** Los tres hosts de sus instancias. */
export const PROCESS_GROUP_PAGE_HOSTS = [1, 2, 3].map(pgPageHost)
Object.assign(
  ENTITY_NAMES,
  Object.fromEntries([
    [PROCESS_GROUP_PAGE_ID, 'grupo-pagos-e2e'],
    ...PROCESS_GROUP_PAGE_INSTANCES.map((instance) => [instance.id, instance.name]),
    ...PROCESS_GROUP_PAGE_HOSTS.map((host) => [host.hostId, host.hostName])
  ])
)

/**
 * Ficha 0050: dos process groups más (ids inventados), para las 20 de más CPU y la lista
 * completa: uno de 30 instancias (CPU distintas, en un orden que no es el de CPU) y otro
 * recortado (la API devuelve 25 instancias con dimensionCountRatio > 1, y /entities cuenta 600).
 */
export const PROCESS_GROUP_MANY_ID = 'PROCESS_GROUP-00000000000E2E70'
export const PROCESS_GROUP_CUT_ID = 'PROCESS_GROUP-00000000000E2E80'
/** Instancias que cuenta /entities en el grupo recortado (más que las que llegan). */
export const PROCESS_GROUP_CUT_TOTAL = 600
/** Selector de las instancias de un grupo, el confirmado en vivo (0031). */
export const processGroupSelector = (groupId: string): string =>
  `type("PROCESS_GROUP_INSTANCE"),fromRelationships.isInstanceOf(entityId("${groupId}"))`
/** `n` instancias inventadas; CPU `(i·7) mod n` + 0,5 (una permutación: n no es múltiplo de 7). */
export function pgManyInstances(prefix: string, n: number): ProcessGroupInstanceFake[] {
  return Array.from({ length: n }, (_, i) => {
    const hex = (i + 1).toString(16).toUpperCase().padStart(2, '0')
    return {
      id: `PROCESS_GROUP_INSTANCE-0000000000${prefix}${hex}`,
      name: `instancia-${prefix.toLowerCase()}-${i + 1}`,
      hostId: `HOST-0000000000${prefix}${hex}`,
      hostName: `host-${prefix.toLowerCase()}-${i + 1}`,
      cpu: ((i * 7) % n) + 0.5,
      memory: 1_000_000 * (i + 1)
    }
  })
}
export const PROCESS_GROUP_MANY_INSTANCES = pgManyInstances('E2E7', 30)
export const PROCESS_GROUP_CUT_INSTANCES = pgManyInstances('E2E8', 25)
/** Ficha 0051: un grupo de 12 instancias (menos de 20: ni aviso ni «Ver todas»). */
export const PROCESS_GROUP_FEW_ID = 'PROCESS_GROUP-00000000000E2E90'
export const PROCESS_GROUP_FEW_INSTANCES = pgManyInstances('E2E9', 12)
/** De más a menos CPU media. */
export const byCpu = (list: ProcessGroupInstanceFake[]): ProcessGroupInstanceFake[] =>
  list.slice().sort((a, b) => b.cpu - a.cpu)
/** Como las da el canal (id, nombre, host, CPU y memoria). */
export const pgItem = (instance: ProcessGroupInstanceFake): Record<string, unknown> => ({
  id: instance.id,
  name: instance.name,
  hostId: instance.hostId,
  hostName: instance.hostName,
  cpu: instance.cpu,
  memory: instance.memory
})

/** Las instancias inventadas de cada process group, con su CPU y su memoria medias. */
export function processGroupInstances(groupId: string): ProcessGroupInstanceFake[] {
  if (groupId === PROCESS_GROUP_PAGE_ID) return PROCESS_GROUP_PAGE_INSTANCES
  if (groupId === PROCESS_GROUP_MANY_ID) return PROCESS_GROUP_MANY_INSTANCES
  if (groupId === PROCESS_GROUP_CUT_ID) return PROCESS_GROUP_CUT_INSTANCES
  if (groupId === PROCESS_GROUP_FEW_ID) return PROCESS_GROUP_FEW_INSTANCES
  return PROCESS_GROUP_INSTANCES.map((instance, i) => ({
    ...instance,
    cpu: PROCESS_GROUP_INSTANCE_VALUES[
      `builtin:tech.generic.cpu.usage${PROCESS_GROUP_BY_INSTANCE}`
    ]?.[i] as number,
    memory: PROCESS_GROUP_INSTANCE_VALUES[
      `builtin:tech.generic.mem.workingSetSize${PROCESS_GROUP_BY_INSTANCE}`
    ]?.[i] as number
  }))
}

/** El process group inventado de la consulta (el de la 0031 o el de la página), o null. */
export function processGroupOf(query: URLSearchParams): string | null {
  const scope = query.get('entitySelector') ?? ''
  if (scope.includes(PROCESS_GROUP_PAGE_ID)) return PROCESS_GROUP_PAGE_ID
  if (scope.includes(PROCESS_GROUP_ID)) return PROCESS_GROUP_ID
  if (scope.includes(PROCESS_GROUP_MANY_ID)) return PROCESS_GROUP_MANY_ID
  if (scope.includes(PROCESS_GROUP_CUT_ID)) return PROCESS_GROUP_CUT_ID
  if (scope.includes(PROCESS_GROUP_FEW_ID)) return PROCESS_GROUP_FEW_ID
  return null
}

/** ¿Es una consulta de métricas de un process group inventado? */
export function isProcessGroupMetricsQuery(query: URLSearchParams): boolean {
  return processGroupOf(query) !== null
}

/**
 * Respuesta del simulador a una consulta de métricas de un process group inventado.
 *
 * Ficha 0032: además de lo de la 0031,
 * - `sim.processGroupMetricsFail`: 400 (errores por panel);
 * - `sim.processGroupTruncated`: las expresiones por instancia llegan recortadas
 *   (dimensionCountRatio > 1), como un grupo de más de unas 498 instancias (el canal lo avisa en
 *   `partial`);
 * - series por instancia (sin resolution=Inf) de la CPU, para el gráfico «CPU por instancia»: una
 *   expresión de `builtin:tech.generic.cpu.usage` partida por
 *   `dt.entity.process_group_instance` da una serie por instancia, de más a menos CPU, con su
 *   nombre en dimensionMap (con `:names`) y, si lleva `:limit(N)`, solo las N primeras. Con
 *   resolution=Inf, como en la 0031, la media de cada instancia.
 */
export function processGroupMetricResponse(query: URLSearchParams): [number, unknown] {
  const selector = query.get('metricSelector') ?? ''
  const inf = query.get('resolution') === 'Inf'
  if (sim.processGroupMetricsFail) {
    return [
      400,
      { error: { code: 400, message: 'Métricas del process group no disponibles (simulado)' } }
    ]
  }
  // Ficha 0051: solo la consulta de la lista completa (CPU con :sort y sin :limit) falla.
  if (
    sim.processGroupInstancesFail &&
    inf &&
    selector.includes(':sort(value(avg,descending))') &&
    !selector.includes(':limit(')
  ) {
    return [400, { error: { code: 400, message: 'Lista de instancias no disponible (simulado)' } }]
  }
  if (inf && selector.includes(':fold(')) {
    return [400, { error: { code: 400, message: 'fold no admite resolution Inf (simulado)' } }]
  }
  const groupId = processGroupOf(query) ?? PROCESS_GROUP_ID
  const instances = processGroupInstances(groupId)
  // Como en vivo: con entityId("<grupo>") estas métricas no traen nada.
  const scoped = query.get('entitySelector') === processGroupSelector(groupId)
  const expressions = splitSelector(selector)
  const at = PROCESS_T0 + 1_800_000
  const byInstance = (expression: string): boolean =>
    expression.includes('splitBy("dt.entity.process_group_instance"')
  const instanceValue = (expression: string, instance: ProcessGroupInstanceFake): number | null =>
    expression.startsWith('builtin:tech.generic.cpu.usage')
      ? instance.cpu
      : expression.startsWith('builtin:tech.generic.mem.workingSetSize')
        ? instance.memory
        : null
  const dimensionMapOf = (
    expression: string,
    instance: ProcessGroupInstanceFake
  ): Record<string, string> => ({
    'dt.entity.process_group_instance': instance.id,
    ...(expression.includes(':names')
      ? { 'dt.entity.process_group_instance.name': instance.name }
      : {}),
    ...(expression.includes('"dt.entity.host"')
      ? {
          'dt.entity.host': instance.hostId,
          ...(expression.includes(':names') ? { 'dt.entity.host.name': instance.hostName } : {})
        }
      : {})
  })
  const perInstanceData = (expression: string): unknown[] => {
    if (inf) {
      // Con Inf, solo la expresión exacta de la 0031 y, desde la 0050, la misma seguida de
      // `:sort(value(avg,descending))` (de más a menos) y, si acaso, `:limit(N)` (las N primeras),
      // las probadas en vivo.
      const sortLimit = /:sort\(value\(avg,descending\)\)(?::limit\((\d+)\))?$/.exec(expression)
      const head = sortLimit === null ? expression : expression.slice(0, sortLimit.index)
      if (!head.endsWith(PROCESS_GROUP_BY_INSTANCE)) return []
      if (instanceValue(head, instances[0]!) === null) return []
      let list = instances
      if (sortLimit !== null) {
        list = list
          .slice()
          .sort((a, b) => (instanceValue(head, b) ?? 0) - (instanceValue(head, a) ?? 0))
        if (sortLimit[1] !== undefined) list = list.slice(0, Number(sortLimit[1]))
      }
      return list.map((instance) => ({
        dimensionMap: dimensionMapOf(expression, instance),
        dimensions: [instance.id, instance.hostId],
        timestamps: [at],
        values: [instanceValue(expression, instance)]
      }))
    }
    // Series por instancia: solo de la CPU, de más a menos y con el límite que se pida.
    if (!expression.startsWith('builtin:tech.generic.cpu.usage')) return []
    const limit = /:limit\((\d+)\)/.exec(expression)
    const sorted = instances.slice().sort((a, b) => b.cpu - a.cpu)
    return (limit === null ? sorted : sorted.slice(0, Number(limit[1]))).map((instance) => ({
      dimensionMap: dimensionMapOf(expression, instance),
      dimensions: [instance.id],
      timestamps: PROCESS_TIMESTAMPS,
      values: [instance.cpu, null, instance.cpu + 1]
    }))
  }
  return [
    200,
    {
      totalCount: expressions.length,
      nextPageKey: null,
      resolution: inf ? 'Inf' : '10m',
      result: expressions.map((expression) => {
        const total = inf
          ? PROCESS_GROUP_MARKERS[expression] === undefined
            ? undefined
            : [PROCESS_GROUP_MARKERS[expression]]
          : PROCESS_GROUP_SERIES[expression]
        const perInstance = byInstance(expression)
        const data = !scoped
          ? []
          : perInstance
            ? perInstanceData(expression)
            : total === undefined
              ? []
              : [
                  {
                    dimensionMap: {},
                    dimensions: [],
                    timestamps: inf ? [at] : PROCESS_TIMESTAMPS,
                    values: total
                  }
                ]
        // 0050: el grupo recortado siempre llega recortado en las expresiones por instancia.
        const truncated =
          perInstance && (sim.processGroupTruncated || groupId === PROCESS_GROUP_CUT_ID)
        return {
          metricId: expression,
          dataPointCountRatio: 0.005,
          dimensionCountRatio: truncated ? 1.5 : 0.005,
          data
        }
      })
    }
  ]
}

export const PROCESS_GROUP_BAND_OPEN = {
  problemId: 'pd-process-group-band-open',
  displayId: 'P-E2E83',
  title: 'Process group con CPU saturada'
}
export const PROCESS_GROUP_BAND_CLOSED = {
  problemId: 'pd-process-group-band-closed',
  displayId: 'P-E2E84',
  title: 'Process group sin instancias'
}

/**
 * Ficha 0032: los problemas del process group de la página (PROCESS_GROUP_PAGE_ID), uno abierto y
 * uno cerrado, dentro de las últimas 2 h y sin solaparse. Salen en las consultas con
 * affectedEntities (recuentos y franja) y en el detalle.
 */
export function processGroupBandProblems(): FakeProblem[] {
  const now = sim.bandNow
  return (
    [
      [PROCESS_GROUP_BAND_OPEN, 'OPEN', now - 35 * 60_000, -1],
      [PROCESS_GROUP_BAND_CLOSED, 'CLOSED', now - 100 * 60_000, now - 70 * 60_000]
    ] as const
  ).map(([ids, status, startTime, endTime]) => ({
    ...ids,
    status,
    severityLevel: 'PERFORMANCE',
    impactLevel: 'INFRASTRUCTURE',
    startTime,
    endTime,
    affectedEntities: [
      {
        entityId: { id: PROCESS_GROUP_PAGE_ID, type: 'PROCESS_GROUP' },
        name: 'grupo-pagos-e2e'
      }
    ],
    impactedEntities: [],
    managementZones: [],
    problemFilters: [],
    evidenceDetails: { totalCount: 0, details: [] }
  }))
}

/**
 * Ficha 0032: el process group de la página en /entities/{id}, para la tarjeta «Información».
 * Claves de `properties`, las vistas en vivo en PROCESS_GROUP (docs/notas-api-v2.md, b):
 * `detectedName`, `listenPorts`, `softwareTechnologies` y `metadata`; relaciones con los nombres
 * vistos en vivo (live-reports de entities-explore): from `runsOn` (los hosts) e
 * `isNetworkClientOfProcessGroup`; to `isInstanceOf` (las instancias) y `runsOn` (los servicios).
 * Valores e ids inventados.
 *
 * - `metadata`, como en el proceso (0029), con `COMMAND_LINE_ARGS` (con una contraseña y un token
 *   inventados) y `EXE_PATH` (con un usuario inventado): no pueden salir en ningún sitio.
 * - «Servicios»: INFO_FEW_ID (para abrir su página) y PROCESS_INFO_SERVICE_2; «Otras»: un process
 *   group del que es cliente de red (PROCESS_INFO_PG).
 */
export const PROCESS_GROUP_INFO_SECRETS = {
  commandLineArgs: '-Dclave.bd=CLAVE-GRUPO-E2E --token TOKEN-GRUPO-E2E -Xmx640m',
  exePath: '/home/usuario-e2e-0032/opt/grupo/bin/pagos-grupo-e2e'
}
export const PROCESS_GROUP_INFO_SECRET_PARTS = [
  PROCESS_GROUP_INFO_SECRETS.commandLineArgs,
  PROCESS_GROUP_INFO_SECRETS.exePath,
  'CLAVE-GRUPO-E2E',
  'TOKEN-GRUPO-E2E',
  '-Xmx640m',
  'usuario-e2e-0032',
  '/opt/grupo/bin/'
]
export function processGroupInfoBody(): Record<string, unknown> {
  return {
    entityId: PROCESS_GROUP_PAGE_ID,
    displayName: 'grupo-pagos-e2e',
    type: 'PROCESS_GROUP',
    firstSeenTms: PROCESS_INFO_FIRST_SEEN,
    lastSeenTms: PROCESS_INFO_LAST_SEEN,
    managementZones: [{ id: '3201', name: 'Zona grupo A' }],
    tags: [],
    properties: {
      detectedName: 'pagos-grupo-detectado-e2e',
      listenPorts: [9090, 9443],
      softwareTechnologies: [
        { type: 'JAVA', edition: 'OpenJDK', version: '21.0.1' },
        { type: 'APACHE_TOMCAT', version: '10.1' }
      ],
      metadata: [
        { key: 'COMMAND_LINE_ARGS', value: PROCESS_GROUP_INFO_SECRETS.commandLineArgs },
        { key: 'EXE_NAME', value: 'pagos-grupo-e2e' },
        { key: 'EXE_PATH', value: PROCESS_GROUP_INFO_SECRETS.exePath }
      ]
    },
    fromRelationships: {
      runsOn: PROCESS_GROUP_PAGE_HOSTS.map((host) => ({ id: host.hostId, type: 'HOST' })),
      isNetworkClientOfProcessGroup: [{ id: PROCESS_INFO_PG, type: 'PROCESS_GROUP' }]
    },
    toRelationships: {
      isInstanceOf: PROCESS_GROUP_PAGE_INSTANCES.map((instance) => ({
        id: instance.id,
        type: 'PROCESS_GROUP_INSTANCE'
      })),
      runsOn: [
        { id: INFO_FEW_ID, type: 'SERVICE' },
        { id: PROCESS_INFO_SERVICE_2, type: 'SERVICE' }
      ]
    }
  }
}

/**
 * Ficha 0033: métricas de una aplicación web (canal entities:applicationMetrics), con ids
 * inventados. Imita lo observado en vivo (paso 0): las de la aplicación se acotan con
 * `entityId("<aplicación>")` y, con `:splitBy()`, traen una serie sin dimensiones (con
 * resolution=Inf, el total del rango); las de acción (`builtin:apps.web.action.*`) solo con
 * `type("APPLICATION_METHOD"),fromRelationships.isApplicationMethodOf(entityId("<aplicación>"))`
 * y traen en dimensionMap el id y el nombre de la acción. Responde SOLO a esas expresiones (las
 * demás, sin series); un resultado por expresión, en el orden pedido y con el metricId igual a
 * la expresión. fold con resolution=Inf da 400.
 */
export const APPLICATION_METRICS_ID = 'APPLICATION-00000000000E2E33'
export const APPLICATION_SELECTOR = `entityId("${APPLICATION_METRICS_ID}")`
export const APPLICATION_METHODS_SELECTOR = `type("APPLICATION_METHOD"),fromRelationships.isApplicationMethodOf(entityId("${APPLICATION_METRICS_ID}"))`
export const APPLICATION_TOP =
  ':splitBy("dt.entity.application_method"):sort(value(count,descending)):limit(10)'
/** Serie de la aplicación por expresión (las exactas del paso 0), sin resolution. */
export const APPLICATION_SERIES: Record<string, (number | null)[]> = {
  'builtin:apps.web.apdex.userType:splitBy():avg': [0.95, null, 0.81],
  'builtin:apps.web.actionCount.summary:splitBy():sum': [60, 75, null],
  'builtin:apps.web.visuallyComplete.load.browser:splitBy():avg': [1_200, null, 1_640.5],
  'builtin:apps.web.countOfErrors:splitBy():sum': [2, null, 5],
  'builtin:apps.web.startedSessions:splitBy():sum': [8, 11, null]
}
/** Total del rango (resolution=Inf), por expresión. */
export const APPLICATION_TOTALS: Record<string, number> = {
  'builtin:apps.web.apdex.userType:splitBy():avg': 0.88,
  'builtin:apps.web.actionCount.summary:splitBy():sum': 135,
  'builtin:apps.web.visuallyComplete.load.browser:splitBy():avg': 1_420.75,
  'builtin:apps.web.countOfErrors:splitBy():sum': 7,
  'builtin:apps.web.startedSessions:splitBy():sum': 19
}
/** Acciones inventadas por tipo, con su recuento y su duración media (ya de más a menos). */
export const APPLICATION_ACTIONS: Record<
  string,
  { id: string; name: string; count: number; avg: number }[]
> = {
  load: [
    {
      id: 'APPLICATION_METHOD-00000000000E2E34',
      name: 'Carga de portada',
      count: 90,
      avg: 1_510
    }
  ],
  xhr: [
    {
      id: 'APPLICATION_METHOD-00000000000E2E35',
      name: 'Petición de catálogo',
      count: 140,
      avg: 320.5
    },
    { id: 'APPLICATION_METHOD-00000000000E2E36', name: 'Petición de carrito', count: 25, avg: 410 }
  ]
}

/**
 * Ficha 0052: datos de RUM de la aplicación inventada (canal entities:applicationRum). Solo API
 * clásica (`builtin:apps.web.*`). Las expresiones exactas del paso 0, con `entityId(...)`; las de
 * custom y rageClick llegan sin series (como en vivo). `countOfErrors` por «Error type»: una
 * serie por tipo (`JavaScript` y `Request`, los vistos en vivo), que suman el total.
 */
export const RUM_W = 'builtin:apps.web.'
export const RUM_ERRORS = `${RUM_W}countOfErrors:splitBy("Error type"):sum`
/** Serie (sin resolution) y total (Inf) de cada expresión de RUM sin tipo de error. */
export const APPLICATION_RUM: Record<string, { series: (number | null)[]; total: number }> = {
  [`${RUM_W}actionCount.load.browser:splitBy():sum`]: {
    series: [4_000, 5_500, null],
    total: 9_640
  },
  [`${RUM_W}actionCount.xhr.browser:splitBy():sum`]: {
    series: [12_000, null, 9_000],
    total: 21_400
  },
  [`${RUM_W}actionDuration.load.browser:splitBy():avg`]: {
    series: [1_850, null, 2_010.5],
    total: 1_930.25
  },
  [`${RUM_W}actionDuration.xhr.browser:splitBy():avg`]: { series: [310, 295.5, null], total: 302 },
  [`${RUM_W}percentageOfUserActionsAffectedByErrors:splitBy()`]: {
    series: [4.5, null, 6],
    total: 5.2
  },
  [`${RUM_W}activeUsersEst:splitBy()`]: { series: [180, 220, null], total: 1_234 },
  [`${RUM_W}startedSessions:splitBy():sum`]: { series: [8, 11, null], total: 19 },
  [`${RUM_W}endedSessions:splitBy():sum`]: { series: [6, null, 9], total: 16 },
  [`${RUM_W}sessionDuration:splitBy():avg`]: {
    series: [150_000_000, null, 192_000_000],
    total: 45_600_000
  },
  [`${RUM_W}actionsPerSession:splitBy():avg`]: { series: [5.5, null, 6.25], total: 5.9 },
  [`${RUM_W}bouncedSessionRatio:splitBy()`]: { series: [25, null, 33.5], total: 28.4 },
  // Ficha 0054: los totales de los Core Web Vitals caen en las tres calificaciones (LCP 2,3 s
  // bueno, CLS 0,18 mejorable e INP 640 ms pobre).
  [`${RUM_W}largestContentfulPaint.load.browser:splitBy():percentile(75)`]: {
    series: [2_200, null, 2_640],
    total: 2_310
  },
  [`${RUM_W}cumulativeLayoutShift.load.browser:splitBy():percentile(75)`]: {
    series: [0.04, null, 0.21],
    total: 0.18
  },
  [`${RUM_W}interactionToNextPaint:splitBy():percentile(75)`]: {
    series: [160, 720, null],
    total: 640
  }
}
/**
 * Ficha 0054: rage clicks, con datos solo con `sim.applicationRumRageClicks` (en vivo llegan sin
 * series; así se prueba el «si hay datos»).
 */
export const APPLICATION_RUM_RAGE: Record<string, { series: (number | null)[]; total: number }> = {
  [`${RUM_W}event.count.rageClick:splitBy():sum`]: { series: [12, null, 25], total: 37 }
}
/** Errores por «Error type»: serie y total de cada tipo. */
export const APPLICATION_RUM_ERRORS: Record<string, { series: (number | null)[]; total: number }> =
  {
    JavaScript: { series: [1, null, 4], total: 5 },
    Request: { series: [6, 3, null], total: 9 }
  }
/**
 * Ficha 0053: las de custom, con datos solo con `sim.applicationRumCustom` (en vivo llegan sin
 * series; así se prueba el «custom si hay»).
 */
export const APPLICATION_RUM_CUSTOM: Record<string, { series: (number | null)[]; total: number }> =
  {
    [`${RUM_W}actionCount.custom.browser:splitBy():sum`]: {
      series: [500, null, 750],
      total: 1_250
    },
    [`${RUM_W}actionDuration.custom.browser:splitBy():avg`]: {
      series: [620, 655, null],
      total: 640
    }
  }
/**
 * Ficha 0053: con `sim.applicationRumErrorsUntyped`, los errores llegan en una sola serie sin
 * «Error type» (no se pueden separar): el canal deja `javascript` y `http` sin datos y los
 * pone en `other`.
 */
export const APPLICATION_RUM_UNTYPED_ERRORS = { series: [7, 3, 4] as (number | null)[], total: 14 }
/**
 * Ficha 0053: expresiones que solo pide el canal entities:applicationRum (startedSessions la
 * piden los dos canales). Toda consulta de RUM lleva alguna.
 */
export const RUM_ONLY_EXPRESSIONS = new Set(
  [
    ...Object.keys(APPLICATION_RUM),
    ...Object.keys(APPLICATION_RUM_CUSTOM),
    RUM_ERRORS,
    `${RUM_W}event.count.rageClick:splitBy():sum`
  ].filter((expression) => !(expression in APPLICATION_TOTALS))
)
/** Ficha 0053: ¿es una consulta del canal entities:applicationRum? */
export function isRumQuery(query: URLSearchParams): boolean {
  return splitSelector(query.get('metricSelector') ?? '').some((expression) =>
    RUM_ONLY_EXPRESSIONS.has(expression)
  )
}
/** La API admite como mucho 10 expresiones por consulta (OpenAPI v2, `metricSelector`). */
export const METRIC_SELECTOR_MAX = 10

/** ¿Es una consulta de métricas de la aplicación inventada? */
export function isApplicationMetricsQuery(query: URLSearchParams): boolean {
  return (query.get('entitySelector') ?? '').includes(APPLICATION_METRICS_ID)
}

/**
 * Ficha 0034: prefijo de la métrica de cada papel de la aplicación (para `sim.applicationEmpty`).
 */
export const APPLICATION_ROLE_PREFIX: Record<string, string> = {
  apdex: 'builtin:apps.web.apdex.',
  actions: 'builtin:apps.web.actionCount.',
  duration: 'builtin:apps.web.visuallyComplete.',
  errors: 'builtin:apps.web.countOfErrors',
  sessions: 'builtin:apps.web.startedSessions'
}

/**
 * Respuesta del simulador a una consulta de métricas de la aplicación inventada.
 *
 * Ficha 0034: `sim.applicationMetricsFail` da 400 (errores por panel); los papeles de
 * `sim.applicationEmpty` llegan sin series, y con `sim.applicationActionsEmpty` las de acción
 * tampoco traen nada (como en vivo, donde la lista de acciones clave suele venir vacía).
 */
export function applicationMetricResponse(query: URLSearchParams): [number, unknown] {
  const selector = query.get('metricSelector') ?? ''
  const inf = query.get('resolution') === 'Inf'
  if (sim.applicationMetricsFail) {
    return [
      400,
      { error: { code: 400, message: 'Métricas de la aplicación no disponibles (simulado)' } }
    ]
  }
  if (sim.applicationRumFail && isRumQuery(query)) {
    // Ficha 0053: solo falla el canal de RUM (errores por panel); el de la 0033 responde.
    return [400, { error: { code: 400, message: 'Métricas de RUM no disponibles (simulado)' } }]
  }
  if (inf && selector.includes(':fold(')) {
    return [400, { error: { code: 400, message: 'fold no admite resolution Inf (simulado)' } }]
  }
  const entitySelector = query.get('entitySelector')
  const expressions = splitSelector(selector)
  // Ficha 0052: como la API, más de 10 expresiones en una consulta dan 400.
  if (expressions.length > METRIC_SELECTOR_MAX) {
    return [400, { error: { code: 400, message: 'Más de 10 métricas por consulta (simulado)' } }]
  }
  const at = PROCESS_T0 + 1_800_000
  return [
    200,
    {
      totalCount: expressions.length,
      nextPageKey: null,
      resolution: inf ? 'Inf' : '10m',
      result: expressions.map((expression) => {
        const action = /^builtin:apps\.web\.action\.duration\.(load|xhr|custom)\.browser(.*)$/.exec(
          expression
        )
        let data: unknown[] = []
        if (action !== null) {
          // Las de acción: solo con el selector de las acciones y con Inf.
          const [, type, rest] = action
          const aggregation =
            rest === `${APPLICATION_TOP}:count:names`
              ? 'count'
              : rest === `${APPLICATION_TOP}:avg:names`
                ? 'avg'
                : null
          if (
            entitySelector === APPLICATION_METHODS_SELECTOR &&
            inf &&
            aggregation !== null &&
            !sim.applicationActionsEmpty
          ) {
            data = (APPLICATION_ACTIONS[type!] ?? []).map((item) => ({
              dimensionMap: {
                'dt.entity.application_method': item.id,
                'dt.entity.application_method.name': item.name
              },
              dimensions: [item.id],
              timestamps: [at],
              values: [aggregation === 'count' ? item.count : item.avg]
            }))
          }
        } else if (
          entitySelector === APPLICATION_SELECTOR &&
          !sim.applicationEmpty.some((role) =>
            expression.startsWith(APPLICATION_ROLE_PREFIX[role] ?? role)
          )
        ) {
          const rum =
            APPLICATION_RUM[expression] ??
            (sim.applicationRumCustom ? APPLICATION_RUM_CUSTOM[expression] : undefined) ??
            (sim.applicationRumRageClicks ? APPLICATION_RUM_RAGE[expression] : undefined)
          const values = inf
            ? APPLICATION_TOTALS[expression] === undefined
              ? rum === undefined
                ? undefined
                : [rum.total]
              : [APPLICATION_TOTALS[expression]]
            : (APPLICATION_SERIES[expression] ?? rum?.series)
          if (expression === RUM_ERRORS && sim.applicationRumErrorsUntyped) {
            // Ficha 0053: una sola serie, sin «Error type».
            data = [
              {
                dimensionMap: {},
                dimensions: [],
                timestamps: inf ? [at] : PROCESS_TIMESTAMPS,
                values: inf
                  ? [APPLICATION_RUM_UNTYPED_ERRORS.total]
                  : APPLICATION_RUM_UNTYPED_ERRORS.series
              }
            ]
          } else if (expression === RUM_ERRORS) {
            // Ficha 0052: una serie por tipo de error, con su dimensión.
            data = Object.entries(APPLICATION_RUM_ERRORS).map(([type, item]) => ({
              dimensionMap: { 'Error type': type },
              dimensions: [type],
              timestamps: inf ? [at] : PROCESS_TIMESTAMPS,
              values: inf ? [item.total] : item.series
            }))
          } else if (values !== undefined) {
            data = [
              {
                dimensionMap: {},
                dimensions: [],
                timestamps: inf ? [at] : PROCESS_TIMESTAMPS,
                values
              }
            ]
          }
        }
        return {
          metricId: expression,
          dataPointCountRatio: 0.005,
          dimensionCountRatio: 0.005,
          data
        }
      })
    }
  ]
}

export const APPLICATION_BAND_OPEN = {
  problemId: 'pd-application-band-open',
  displayId: 'P-E2E85',
  title: 'Aplicación con Apdex bajo'
}
export const APPLICATION_BAND_CLOSED = {
  problemId: 'pd-application-band-closed',
  displayId: 'P-E2E86',
  title: 'Aplicación con errores de JavaScript'
}

/**
 * Ficha 0034: los problemas de la aplicación de la página (APPLICATION_METRICS_ID), uno abierto
 * y uno cerrado, dentro de las últimas 2 h y sin solaparse. Salen en las consultas con
 * affectedEntities (recuentos y franja) y en el detalle.
 */
export function applicationBandProblems(): FakeProblem[] {
  const now = sim.bandNow
  return (
    [
      [APPLICATION_BAND_OPEN, 'OPEN', now - 40 * 60_000, -1],
      [APPLICATION_BAND_CLOSED, 'CLOSED', now - 105 * 60_000, now - 75 * 60_000]
    ] as const
  ).map(([ids, status, startTime, endTime]) => ({
    ...ids,
    status,
    severityLevel: 'PERFORMANCE',
    impactLevel: 'APPLICATION',
    startTime,
    endTime,
    affectedEntities: [
      { entityId: { id: APPLICATION_METRICS_ID, type: 'APPLICATION' }, name: 'tienda-web-e2e' }
    ],
    impactedEntities: [],
    managementZones: [],
    problemFilters: [],
    evidenceDetails: { totalCount: 0, details: [] }
  }))
}

/**
 * Ficha 0034: la aplicación de la página en /entities/{id}, para la tarjeta «Información».
 * Claves de `properties`, las vistas en vivo en APPLICATION (ficha 0033):
 * `applicationInjectionType`, `applicationLikeDeleted`, `applicationType`, `customizedName` y
 * `detectedName`; relaciones con los nombres vistos en vivo: from `calls` (SERVICE) e
 * `isApplicationOfSyntheticTest` (HTTP_CHECK); to `isApplicationMethodOf` (APPLICATION_METHOD),
 * `isGroupOf` (APPLICATION_METHOD_GROUP) y `monitors` (SYNTHETIC_TEST y HTTP_CHECK). Valores e
 * ids inventados; los valores de tipo, de las enumeraciones de la Configuration API.
 *
 * - «Llama a»: INFO_FEW_ID (para abrir su página) y PROCESS_INFO_SERVICE_2.
 * - «Monitores sintéticos»: los de `monitors` (MONITOR_BROWSER_ID y MONITOR_HTTP_ID) y el de
 *   `isApplicationOfSyntheticTest` (APPLICATION_INFO_HTTP).
 * - «Otras»: las tres acciones (`isApplicationMethodOf`) y el grupo de acciones (`isGroupOf`).
 */
export const APPLICATION_INFO_HTTP = 'HTTP_CHECK-00000000000E2E37'
export const APPLICATION_INFO_METHOD_GROUP = 'APPLICATION_METHOD_GROUP-00000000000E2E38'
Object.assign(ENTITY_NAMES, {
  [APPLICATION_METRICS_ID]: 'tienda-web-e2e',
  [APPLICATION_INFO_HTTP]: 'comprobacion-tienda-e2e'
})
export function applicationInfoBody(): Record<string, unknown> {
  return {
    entityId: APPLICATION_METRICS_ID,
    displayName: 'tienda-web-e2e',
    type: 'APPLICATION',
    firstSeenTms: PROCESS_INFO_FIRST_SEEN,
    lastSeenTms: PROCESS_INFO_LAST_SEEN,
    managementZones: [{ id: '3401', name: 'Zona aplicación A' }],
    tags: [],
    properties: {
      applicationType: 'MANUALLY_INJECTED',
      applicationInjectionType: 'AUTO_INJECTED',
      applicationLikeDeleted: false,
      customizedName: 'tienda-personalizada-e2e',
      detectedName: 'tienda-detectada-e2e'
    },
    fromRelationships: {
      calls: [
        { id: INFO_FEW_ID, type: 'SERVICE' },
        { id: PROCESS_INFO_SERVICE_2, type: 'SERVICE' }
      ],
      isApplicationOfSyntheticTest: [{ id: APPLICATION_INFO_HTTP, type: 'HTTP_CHECK' }]
    },
    toRelationships: {
      isApplicationMethodOf: Object.values(APPLICATION_ACTIONS)
        .flat()
        .map((action) => ({ id: action.id, type: 'APPLICATION_METHOD' })),
      isGroupOf: [{ id: APPLICATION_INFO_METHOD_GROUP, type: 'APPLICATION_METHOD_GROUP' }],
      monitors: [
        { id: MONITOR_BROWSER_ID, type: 'SYNTHETIC_TEST' },
        { id: MONITOR_HTTP_ID, type: 'HTTP_CHECK' }
      ]
    }
  }
}

/**
 * Ficha 0023: desglose de un browser monitor y de un HTTP monitor por localización y por paso o
 * petición (canal entities:monitorBreakdown), con ids inventados. Responde SOLO a las expresiones
 * confirmadas en vivo (paso 0 de la ficha) y con el ámbito con que se probaron; a cualquier otra,
 * como la API: 200 con series también de otro monitor. Un resultado por expresión, en el orden
 * pedido; el metricId sin las comillas de los valores de filter(eq(...)); el nombre en
 * dimensionMap («<dimensión>.name») por llevar :names; las series de cada métrica, en otro orden
 * de localizaciones; sin fallos en una localización, su serie de FAILURE no llega.
 */
export const BREAKDOWN_BROWSER_ID = 'SYNTHETIC_TEST-00000000000E2E42'
export const BREAKDOWN_HTTP_ID = 'HTTP_CHECK-00000000000E2E43'
export const MONITOR_BREAKDOWN_T0 = Date.parse('2026-10-03T08:00:00.000Z')
export const breakdownLocation = (n: number): string => `SYNTHETIC_LOCATION-00000000000E2E5${n}`
export const breakdownStep = (type: string, n: number): string => `${type}-00000000000E2E6${n}`
export type BreakdownItem = { id: string; name?: string; value: number | null }
export type BreakdownRole = 'availability' | 'duration' | 'failed' | 'steps'
/** Expresión confirmada → papel y ámbitos probados (`monitor`, `steps` o sin entitySelector). */
export function breakdownExpressions(
  id: string
): Record<string, { role: BreakdownRole; scopes: ('monitor' | 'steps' | 'none')[] }> {
  const location = ':splitBy("dt.entity.synthetic_location")'
  if (id.startsWith('SYNTHETIC_TEST-')) {
    const own = `:filter(eq("dt.entity.synthetic_test","${id}"))`
    return {
      [`builtin:synthetic.browser.availability${location}:avg:names`]: {
        role: 'availability',
        scopes: ['monitor']
      },
      [`builtin:synthetic.browser.duration${own}${location}:avg:names`]: {
        role: 'duration',
        scopes: ['monitor', 'none']
      },
      [`builtin:synthetic.browser.step.duration${own}:splitBy("dt.entity.synthetic_test_step"):avg:names`]:
        { role: 'steps', scopes: ['monitor', 'none'] }
    }
  }
  return {
    [`builtin:synthetic.http.availability${location}:avg:names`]: {
      role: 'availability',
      scopes: ['monitor']
    },
    [`builtin:synthetic.http.duration.geo${location}:avg:names`]: {
      role: 'duration',
      scopes: ['monitor']
    },
    [`builtin:synthetic.http.resultStatus:filter(eq("Result status","FAILURE"))${location}:sum:names`]:
      { role: 'failed', scopes: ['monitor'] },
    ['builtin:synthetic.http.request.duration.geo:splitBy("dt.entity.http_check_step"):avg:names']:
      { role: 'steps', scopes: ['steps'] }
  }
}
/** Datos de cada monitor, en el orden en que llegan (no el esperado). */
export const BREAKDOWN_DATA: Record<string, Partial<Record<BreakdownRole, BreakdownItem[]>>> = {
  [BREAKDOWN_BROWSER_ID]: {
    availability: [
      { id: breakdownLocation(1), name: 'Localización uno', value: 100 },
      { id: breakdownLocation(2), name: 'Localización dos', value: 80 },
      // Sin nombre: llega el id.
      { id: breakdownLocation(3), value: 97.5 }
    ],
    duration: [
      { id: breakdownLocation(3), value: 5200 },
      { id: breakdownLocation(1), name: 'Localización uno', value: 4100 },
      { id: breakdownLocation(2), name: 'Localización dos', value: 6300 }
    ],
    // Total 4000 ms: pesos 25, 62.5 y 12.5 %.
    steps: [
      { id: breakdownStep('SYNTHETIC_TEST_STEP', 1), name: 'Paso uno', value: 1000 },
      { id: breakdownStep('SYNTHETIC_TEST_STEP', 2), name: 'Paso dos', value: 2500 },
      { id: breakdownStep('SYNTHETIC_TEST_STEP', 3), name: 'Paso tres', value: 500 }
    ]
  },
  [BREAKDOWN_HTTP_ID]: {
    availability: [
      { id: breakdownLocation(1), name: 'Localización uno', value: 99 },
      { id: breakdownLocation(2), name: 'Localización dos', value: 100 },
      { id: breakdownLocation(3), name: 'Localización tres', value: 90 }
    ],
    duration: [
      { id: breakdownLocation(2), name: 'Localización dos', value: 250 },
      { id: breakdownLocation(3), name: 'Localización tres', value: 420 },
      { id: breakdownLocation(1), name: 'Localización uno', value: 310 }
    ],
    // La localización dos, sin fallos: su serie no llega.
    failed: [
      { id: breakdownLocation(3), name: 'Localización tres', value: 4 },
      { id: breakdownLocation(1), name: 'Localización uno', value: 1 }
    ],
    // Total 400 ms: pesos 20, 30 y 50 %.
    steps: [
      { id: breakdownStep('HTTP_CHECK_STEP', 1), name: 'Petición uno', value: 80 },
      { id: breakdownStep('HTTP_CHECK_STEP', 2), name: 'Petición dos', value: 120 },
      { id: breakdownStep('HTTP_CHECK_STEP', 3), name: 'Petición tres', value: 200 }
    ]
  }
}

/**
 * Ficha 0024: las páginas de MONITOR_BROWSER_ID y MONITOR_HTTP_ID también piden el desglose (el
 * marcador «Localizaciones»). El browser monitor, con las localizaciones de BREAKDOWN_BROWSER_ID
 * (3, dos por debajo del 100 %); el HTTP monitor, con 4 localizaciones y una por debajo del 100 %.
 */
BREAKDOWN_DATA[MONITOR_BROWSER_ID] = BREAKDOWN_DATA[BREAKDOWN_BROWSER_ID] ?? {}
BREAKDOWN_DATA[MONITOR_HTTP_ID] = {
  availability: [
    { id: breakdownLocation(1), name: 'Localización uno', value: 100 },
    { id: breakdownLocation(2), name: 'Localización dos', value: 100 },
    { id: breakdownLocation(3), name: 'Localización tres', value: 70 },
    { id: breakdownLocation(4), name: 'Localización cuatro', value: 100 }
  ],
  duration: [1, 2, 3, 4].map((n) => ({ id: breakdownLocation(n), value: 300 + n * 10 })),
  failed: [{ id: breakdownLocation(3), name: 'Localización tres', value: 2 }],
  steps: [{ id: breakdownStep('HTTP_CHECK_STEP', 1), name: 'Petición uno', value: 310 }]
}

/**
 * Ficha 0025: desglose de las páginas de los monitores para las tablas (con sim.monitorTables).
 * HTTP: 4 localizaciones con disponibilidades distintas (90, 97,5, 99,5 y 100 %: error, aviso y
 * normal), en otro orden en cada métrica; la uno sin serie de FAILURE (0 fallidas). Browser: las
 * 3 localizaciones de la 0023 y 5 pasos (total 5000 ms: pesos 24, 6, 50, 16 y 4 %), que llegan en
 * otro orden que el de su duración.
 */
export const MONITOR_TABLE_DATA: Record<string, Partial<Record<BreakdownRole, BreakdownItem[]>>> = {
  [MONITOR_BROWSER_ID]: {
    availability: BREAKDOWN_DATA[BREAKDOWN_BROWSER_ID]?.availability ?? [],
    duration: BREAKDOWN_DATA[BREAKDOWN_BROWSER_ID]?.duration ?? [],
    steps: [
      { id: breakdownStep('SYNTHETIC_TEST_STEP', 1), name: 'Paso uno', value: 1200 },
      { id: breakdownStep('SYNTHETIC_TEST_STEP', 2), name: 'Paso dos', value: 300 },
      { id: breakdownStep('SYNTHETIC_TEST_STEP', 3), name: 'Paso tres', value: 2500 },
      { id: breakdownStep('SYNTHETIC_TEST_STEP', 4), name: 'Paso cuatro', value: 800 },
      { id: breakdownStep('SYNTHETIC_TEST_STEP', 5), name: 'Paso cinco', value: 200 }
    ]
  },
  [MONITOR_HTTP_ID]: {
    availability: [
      { id: breakdownLocation(1), name: 'Localización uno', value: 100 },
      { id: breakdownLocation(4), name: 'Localización cuatro', value: 99.5 },
      { id: breakdownLocation(2), name: 'Localización dos', value: 97.5 },
      { id: breakdownLocation(3), name: 'Localización tres', value: 90 }
    ],
    duration: [
      { id: breakdownLocation(3), name: 'Localización tres', value: 1500 },
      { id: breakdownLocation(2), name: 'Localización dos', value: 310 },
      { id: breakdownLocation(1), name: 'Localización uno', value: 250 },
      { id: breakdownLocation(4), name: 'Localización cuatro', value: 420 }
    ],
    failed: [
      { id: breakdownLocation(2), name: 'Localización dos', value: 1 },
      { id: breakdownLocation(4), name: 'Localización cuatro', value: 2 },
      { id: breakdownLocation(3), name: 'Localización tres', value: 6 }
    ],
    // Total 400 ms: pesos 25 y 75 %.
    steps: [
      { id: breakdownStep('HTTP_CHECK_STEP', 1), name: 'Petición uno', value: 100 },
      { id: breakdownStep('HTTP_CHECK_STEP', 2), name: 'Petición dos', value: 300 }
    ]
  }
}

/** Id de monitor (de la 0023 o de las páginas de la 0024) que lleva la consulta, o null. */
export function breakdownMonitorId(query: URLSearchParams): string | null {
  const scope = `${query.get('metricSelector') ?? ''} ${query.get('entitySelector') ?? ''}`
  return (
    [BREAKDOWN_BROWSER_ID, BREAKDOWN_HTTP_ID, MONITOR_BROWSER_ID, MONITOR_HTTP_ID].find((id) =>
      scope.includes(id)
    ) ?? null
  )
}

/**
 * ¿Es una consulta del desglose de los monitores inventados? Con los ids de la 0023, cualquiera;
 * con los de las páginas de la 0024 (que también piden sus métricas), solo si todas sus
 * expresiones son las confirmadas del desglose.
 */
export function isMonitorBreakdownQuery(query: URLSearchParams): boolean {
  const selector = query.get('metricSelector') ?? ''
  const id = breakdownMonitorId(query)
  if (!selector.startsWith('builtin:synthetic.') || id === null) return false
  if (id === BREAKDOWN_BROWSER_ID || id === BREAKDOWN_HTTP_ID) return true
  const known = breakdownExpressions(id)
  return splitSelector(selector).every((expression) => known[expression] !== undefined)
}

/** Respuesta del simulador a una consulta del desglose de los monitores inventados. */
export function monitorBreakdownResponse(query: URLSearchParams): [number, unknown] {
  const selector = query.get('metricSelector') ?? ''
  const inf = query.get('resolution') === 'Inf'
  if (inf && selector.includes(':fold(')) {
    return [400, { error: { code: 400, message: 'fold no admite resolution Inf (simulado)' } }]
  }
  // Ficha 0024: el canal del desglose falla (el marcador «Localizaciones», con su aviso).
  if (sim.monitorBreakdownFail) {
    return [400, { error: { code: 400, message: 'Desglose del monitor no disponible (simulado)' } }]
  }
  const id = breakdownMonitorId(query) ?? BREAKDOWN_HTTP_ID
  const browser = id.startsWith('SYNTHETIC_TEST-')
  const stepType = browser ? 'SYNTHETIC_TEST_STEP' : 'HTTP_CHECK_STEP'
  const entitySelector = query.get('entitySelector')
  const scope =
    entitySelector === null
      ? 'none'
      : entitySelector === `entityId("${id}")`
        ? 'monitor'
        : entitySelector === `type("${stepType}"),fromRelationships.isStepOf(entityId("${id}"))`
          ? 'steps'
          : 'other'
  const known = breakdownExpressions(id)
  const expressions = splitSelector(selector)
  return [
    200,
    {
      totalCount: expressions.length,
      nextPageKey: null,
      resolution: inf ? 'Inf' : '10m',
      result: expressions.map((expression) => {
        const entry = known[expression]
        const valid = entry !== undefined && (entry.scopes as string[]).includes(scope)
        const isStep = expression.includes('step.') || expression.includes('request.')
        const dimension = isStep
          ? browser
            ? 'dt.entity.synthetic_test_step'
            : 'dt.entity.http_check_step'
          : 'dt.entity.synthetic_location'
        // No confirmada o con otro ámbito: como la API, también series de otro monitor.
        const items: BreakdownItem[] = valid
          ? sim.monitorStepsEmpty && entry.role === 'steps'
            ? []
            : (((sim.monitorTables ? MONITOR_TABLE_DATA[id] : undefined) ?? BREAKDOWN_DATA[id])?.[
                entry.role
              ] ?? [])
          : [
              {
                id: isStep ? breakdownStep(stepType, 9) : breakdownLocation(9),
                name: 'De otro monitor',
                value: 1
              }
            ]
        return {
          metricId: expression.split(`"${id}"`).join(id).split('"FAILURE"').join('FAILURE'),
          dataPointCountRatio: 0.001,
          dimensionCountRatio: 0.001,
          data: items.map((item) => ({
            dimensionMap: {
              [dimension]: item.id,
              ...(item.name === undefined ? {} : { [`${dimension}.name`]: item.name })
            },
            dimensions: [item.id],
            timestamps: inf ? [MONITOR_BREAKDOWN_T0 + 1_800_000] : [MONITOR_BREAKDOWN_T0],
            values: [item.value]
          }))
        }
      })
    }
  ]
}
/**
 * Ficha 0017: discos y procesos de una entidad HOST (canal entities:hostBreakdown), con un id
 * inventado. Imita lo observado en vivo (paso 0): una serie por disco con entityId("<host>") en
 * entitySelector; los procesos del host solo con la relación isProcessOf (en entitySelector o en
 * un filter(in(..., entitySelector(...)))); el nombre en dimensionMap («<dimensión>.name») solo
 * con :names; :last o fold con resolution=Inf dan 400; el último punto de la serie, null.
 */
export const BREAKDOWN_HOST_ID = 'HOST-00000000000E2E31'
export const BREAKDOWN_T0 = Date.parse('2026-10-03T08:00:00.000Z')
/** Último dato, media y máximo; la serie es [máximo, x, último, null] con esa media. */
export type BreakdownStats = { last: number; avg: number; max: number }
export const BREAKDOWN_DISKS: {
  id: string
  name: string
  metrics: Record<string, BreakdownStats>
}[] = [
  {
    id: 'DISK-00000000000E2E01',
    name: '/',
    metrics: {
      'builtin:host.disk.usedPct': { last: 40, avg: 40, max: 44 },
      'builtin:host.disk.used': { last: 40_000_000_000, avg: 40_000_000_000, max: 41_000_000_000 },
      'builtin:host.disk.avail': { last: 60_000_000_000, avg: 60_000_000_000, max: 61_000_000_000 },
      'builtin:host.disk.bytesRead': { last: 100, avg: 300, max: 500 },
      'builtin:host.disk.bytesWritten': { last: 200, avg: 400, max: 600 }
    }
  },
  {
    id: 'DISK-00000000000E2E02',
    name: '/datos',
    metrics: {
      'builtin:host.disk.usedPct': { last: 88, avg: 85, max: 90 },
      'builtin:host.disk.used': {
        last: 880_000_000_000,
        avg: 850_000_000_000,
        max: 900_000_000_000
      },
      'builtin:host.disk.avail': {
        last: 120_000_000_000,
        avg: 150_000_000_000,
        max: 160_000_000_000
      },
      'builtin:host.disk.bytesRead': { last: 7000, avg: 8000, max: 9000 },
      'builtin:host.disk.bytesWritten': { last: 1000, avg: 2000, max: 3000 }
    }
  }
]
/** 12 procesos: CPU media y máxima (%) y memoria media (bytes). El 5 llega sin nombre. */
export const BREAKDOWN_CPU = [4, 30, 2, 55, 18, 1, 9, 26, 3, 14, 7, 11]
export const BREAKDOWN_PROCESSES = BREAKDOWN_CPU.map((avg, i) => ({
  id: `PROCESS_GROUP_INSTANCE-00000000000E2E${String(i + 1).padStart(2, '0')}`,
  name: i === 4 ? null : `proceso-e2e-${i + 1}`,
  cpu: { last: avg, avg, max: avg + 1 },
  memory: { last: (i + 1) * 50_000_000, avg: (i + 1) * 50_000_000, max: (i + 1) * 50_000_000 }
}))

/**
 * Ficha 0019: los discos y procesos de la página del host (HOST_METRICS_ID, el de la 0018).
 * Tres discos, que el simulador da en otro orden que el del más lleno (/datos 91 %, /var 85 % y
 * / 40 %, último dato), todos de 1 a 999 GB para que «GB» no dependa de la escala elegida; lectura
 * y escritura de B/s a MB/s. Quince procesos con CPU media distinta y memoria en otro orden.
 */
export const GB = 1_000_000_000
export const HOST_PAGE_DISKS: typeof BREAKDOWN_DISKS = [
  {
    id: 'DISK-00000000000E2E11',
    name: '/',
    metrics: {
      'builtin:host.disk.usedPct': { last: 40, avg: 41, max: 44 },
      'builtin:host.disk.used': { last: 40 * GB, avg: 41 * GB, max: 44 * GB },
      'builtin:host.disk.avail': { last: 60 * GB, avg: 59 * GB, max: 60 * GB },
      'builtin:host.disk.bytesRead': { last: 200, avg: 300, max: 500 },
      'builtin:host.disk.bytesWritten': { last: 1000, avg: 1500, max: 2500 }
    }
  },
  {
    id: 'DISK-00000000000E2E12',
    name: '/datos',
    metrics: {
      'builtin:host.disk.usedPct': { last: 91, avg: 90, max: 92 },
      'builtin:host.disk.used': { last: 455 * GB, avg: 450 * GB, max: 460 * GB },
      'builtin:host.disk.avail': { last: 45 * GB, avg: 50 * GB, max: 55 * GB },
      'builtin:host.disk.bytesRead': { last: 2_000_000, avg: 2_500_000, max: 3_500_000 },
      'builtin:host.disk.bytesWritten': { last: 10_000, avg: 12_000, max: 16_000 }
    }
  },
  {
    id: 'DISK-00000000000E2E13',
    name: '/var',
    metrics: {
      'builtin:host.disk.usedPct': { last: 85, avg: 84, max: 86 },
      'builtin:host.disk.used': { last: 170 * GB, avg: 168 * GB, max: 172 * GB },
      'builtin:host.disk.avail': { last: 30 * GB, avg: 32 * GB, max: 33 * GB },
      'builtin:host.disk.bytesRead': { last: 0, avg: 0, max: 0 },
      'builtin:host.disk.bytesWritten': { last: 700, avg: 800, max: 900 }
    }
  }
]
/** 15 procesos: CPU media (%), máxima = media + 5 y memoria media en múltiplos de 50 MB. */
export const HOST_PAGE_CPU = [12, 47, 3, 28, 61, 7, 19, 2, 35, 9, 1, 24, 15, 5, 40]
export const HOST_PAGE_PROCESSES = HOST_PAGE_CPU.map((avg, i) => {
  const memory = (((i + 1) * 7) % 15) * 50_000_000 + 50_000_000
  return {
    id: `PROCESS_GROUP_INSTANCE-00000000000E2E${(i + 41).toString(16).toUpperCase()}`,
    name: `proceso-host-${i + 1}`,
    cpu: { last: avg, avg, max: avg + 5 },
    memory: { last: memory, avg: memory, max: memory }
  }
})

// Ficha 0028: los procesos de la tabla del host también responden a las métricas del proceso.
for (const process of HOST_PAGE_PROCESSES) PROCESS_METRICS_IDS.add(process.id)
// Ficha 0032: las instancias del process group de la página, también (abrir su página de proceso
// y, si la página del grupo los pide por instancia, sus series).
for (const instance of PROCESS_GROUP_PAGE_INSTANCES) PROCESS_METRICS_IDS.add(instance.id)

/**
 * Ficha 0041: logs detectados en los procesos de la página del host (HOST_METRICS_ID), canal
 * entities:hostLogs. Como en vivo (paso 0 de la ficha): `GET /entities` con
 * `type("PROCESS_GROUP_INSTANCE"),fromRelationships.isProcessOf(entityId("<host>"))` y
 * `fields=+properties.logFileStatus,+properties.logPathLastUpdate,+properties.logSourceState`; las
 * tres propiedades llegan como listas de `{ key, value }` cuya `key` es la ruta del fichero (o el
 * nombre de la fuente), `logPathLastUpdate` en segundos y `logSourceState` como
 * `{ storageStatus }`. De los 15 procesos de HOST_PAGE_PROCESSES, tienen logs tres que no salen en
 * la tabla de procesos (no están entre los 10 con más CPU): proceso-host-3 (OK, con fuente),
 * proceso-host-6 (el fichero no existe; ruta de Windows) y proceso-host-11 (solo última
 * actualización, de una fuente sin ruta). Ninguna de estas rutas puede verse en la app.
 */
export const HOST_LOGS_USER = 'usuario-logs-e2e-0041'
export const HOST_LOGS_PATHS = {
  unix: `/home/${HOST_LOGS_USER}/pagos/logs/app-e2e.log`,
  windows: `C:\\Users\\${HOST_LOGS_USER}\\informes\\salida-e2e.log`,
  source: 'Fuente generica de logs e2e'
}
/** Trozos de las rutas que tampoco pueden verse sueltos. */
export const HOST_LOGS_FRAGMENTS = [
  ...Object.values(HOST_LOGS_PATHS),
  HOST_LOGS_USER,
  '/home/',
  'C:\\Users',
  'app-e2e.log',
  'salida-e2e.log',
  'generica de logs'
]
export const HOST_LOGS_S = Date.parse('2026-10-03T07:30:00.000Z') / 1000
export const HOST_LOGS_ENTRIES: Record<string, Record<string, unknown>> = {
  [HOST_PAGE_PROCESSES[2]?.id ?? '']: {
    logFileStatus: [{ key: HOST_LOGS_PATHS.unix, value: 'FILE_STATUS_OK' }],
    logPathLastUpdate: [{ key: HOST_LOGS_PATHS.unix, value: HOST_LOGS_S }],
    logSourceState: [
      {
        key: HOST_LOGS_PATHS.unix,
        value: { storageStatus: 'LOG_STORAGE_CONFIGURATION_STATUS_SEND_TO_STORAGE' }
      }
    ]
  },
  [HOST_PAGE_PROCESSES[5]?.id ?? '']: {
    logFileStatus: [{ key: HOST_LOGS_PATHS.windows, value: 'FILE_STATUS_NOT_EXIST' }],
    logPathLastUpdate: [{ key: HOST_LOGS_PATHS.windows, value: HOST_LOGS_S - 3600 }]
  },
  [HOST_PAGE_PROCESSES[10]?.id ?? '']: {
    logPathLastUpdate: [{ key: HOST_LOGS_PATHS.source, value: HOST_LOGS_S - 7200 }]
  }
}
export const HOST_LOGS_IDS = Object.keys(HOST_LOGS_ENTRIES)
/** El proceso con logs cuya página tiene `entities:get` (con las mismas rutas en properties). */
export const HOST_LOGS_PAGE = HOST_PAGE_PROCESSES[5]!
export function hostLogsProcessBody(): Record<string, unknown> {
  return {
    entityId: HOST_LOGS_PAGE.id,
    displayName: HOST_LOGS_PAGE.name,
    type: 'PROCESS_GROUP_INSTANCE',
    firstSeenTms: PROCESS_INFO_FIRST_SEEN,
    lastSeenTms: PROCESS_INFO_LAST_SEEN,
    properties: {
      detectedName: 'proceso-logs-detectado-e2e',
      processType: 'JAVA',
      ...HOST_LOGS_ENTRIES[HOST_LOGS_PAGE.id]
    },
    fromRelationships: { isProcessOf: [{ id: HOST_METRICS_ID, type: 'HOST' }] }
  }
}
export const HOST_LOGS_SELECTOR = (hostId: string): string =>
  `type("PROCESS_GROUP_INSTANCE"),fromRelationships.isProcessOf(entityId("${hostId}"))`

/** Respuesta del simulador a la consulta de logs de un host (null si no es esa consulta). */
export function hostLogsResponse(query: URLSearchParams): { status: number; body: unknown } | null {
  const selector = query.get('entitySelector') ?? ''
  const hostId = /isProcessOf\(entityId\("([^"]+)"\)\)/.exec(selector)?.[1]
  if (hostId === undefined || !selector.startsWith('type("PROCESS_GROUP_INSTANCE")')) return null
  sim.hostLogsQueries.push(query)
  if (sim.hostLogsFail) {
    return { status: 400, body: { error: { code: 400, message: 'Consulta de logs rechazada' } } }
  }
  // Solo la forma documentada (OpenAPI): `fromRelationships`, en plural.
  if (selector !== HOST_LOGS_SELECTOR(hostId)) {
    return { status: 400, body: { error: { code: 400, message: 'entitySelector no válido' } } }
  }
  const fields = (query.get('fields') ?? '').split(',')
  const asked = (key: string): boolean => fields.includes(`+properties.${key}`)
  const list = hostId === HOST_METRICS_ID ? HOST_PAGE_PROCESSES : []
  const entities = list.map((process) => {
    const entries = sim.hostLogsEmpty ? {} : (HOST_LOGS_ENTRIES[process.id] ?? {})
    return {
      entityId: process.id,
      displayName: process.name,
      type: 'PROCESS_GROUP_INSTANCE',
      properties: Object.fromEntries(Object.entries(entries).filter(([key]) => asked(key)))
    }
  })
  return {
    status: 200,
    body: { totalCount: entities.length, pageSize: 500, nextPageKey: null, entities }
  }
}

/**
 * Ficha 0042: eventos de la página del host HOST_INFO_FULL_ID (la de la 0020, con relaciones),
 * canal entities:hostEvents. Como en vivo (paso 0 de la ficha): main lee las relaciones del host
 * (GET /entities/{id}) y pide `GET /events` con `eventSelector=entityId("<host>","<id-2>",…)`:
 * el host, sus procesos (isProcessOf), su disco (isDiskOf) y la instancia EC2 en la que corre
 * (runsOn de from). Sus servicios (runsOnHost), el process group (runsOn de to), el grupo de
 * hosts y el host vecino no entran. Cada evento, con la forma vista en vivo (`endTime` -1 en los
 * activos y `entityId: { entityId: { id, type }, name }`). 22 eventos de lo que entra (en la
 * tarjeta, «20 de 22») y uno, el más reciente, de un servicio (que no se pide ni se ve). El 2
 * lleva HTML en el título: es texto del tenant y se ve como texto.
 */
export const HOST_EVENTS_HOST = HOST_INFO_FULL_ID
export const HOST_EVENTS_DISK_NAME = 'disco-e2e-0042'
export const HOST_EVENTS_IDS = [HOST_INFO_FULL_ID, ...HOST_INFO_PGIS, HOST_INFO_DISK, HOST_INFO_EC2]
export const HOST_EVENTS_EXCLUDED = [
  INFO_FEW_ID,
  HOST_INFO_SERVICE_2,
  HOST_INFO_PG,
  HOST_INFO_GROUP,
  HOST_INFO_PEER
]
export const HOST_EVENTS_HTML_TITLE = '<b>Disco</b> casi lleno <img src="x">'
export const HOST_EVENTS_T0 = Date.parse('2026-10-03T10:00:00.000Z')
export const hostEventTitle = (n: number): string =>
  n === 2 ? HOST_EVENTS_HTML_TITLE : `Evento e2e ${n}`
export const hostEventEntityType = (id: string): string => id.slice(0, id.lastIndexOf('-'))
export function hostEvent(n: number, entityId: string): Record<string, unknown> {
  const open = n % 5 === 0
  const start = HOST_EVENTS_T0 - n * 15 * 60_000
  return {
    eventId: `${4200 + n}_${start}`,
    eventType: ['HIGH_CPU', 'PROCESS_RESTART', 'LOW_DISK_SPACE'][n % 3],
    title: hostEventTitle(n),
    status: open ? 'OPEN' : 'CLOSED',
    startTime: start,
    endTime: open ? -1 : start + 5 * 60_000,
    entityId: {
      entityId: { id: entityId, type: hostEventEntityType(entityId) },
      name:
        entityId === HOST_INFO_DISK ? HOST_EVENTS_DISK_NAME : (ENTITY_NAMES[entityId] ?? entityId)
    },
    entityTags: [],
    managementZones: [],
    properties: [],
    correlationId: `e2e-${n}`,
    frequentEvent: false,
    suppressAlert: false,
    suppressProblem: false,
    underMaintenance: false
  }
}
/** Dueño del evento n (1 a 22): host, proceso 1, proceso 2, disco y EC2, por turnos. */
export const hostEventOwner = (n: number): string =>
  HOST_EVENTS_IDS[(n - 1) % HOST_EVENTS_IDS.length]!
export const HOST_EVENTS: Record<string, unknown>[] = [
  hostEvent(0, HOST_INFO_SERVICE_2),
  ...Array.from({ length: 22 }, (_, i) => hostEvent(i + 1, hostEventOwner(i + 1)))
]

/** Ids de un `eventSelector=entityId("a","b")` (vacío si tiene otra forma). */
export function hostEventsSelectorIds(query: URLSearchParams): string[] | null {
  const inner = /^entityId\((.*)\)$/.exec(query.get('eventSelector') ?? '')?.[1]
  if (inner === undefined) return null
  return inner.split(',').map((part) => part.trim().replace(/^"|"$/g, ''))
}

/** Respuesta del simulador a GET /events: los eventos de los ids del eventSelector. */
export function hostEventsResponse(query: URLSearchParams): { status: number; body: unknown } {
  sim.hostEventsQueries.push(query)
  if (sim.hostEventsFail) {
    return { status: 400, body: { error: { code: 400, message: 'Consulta de eventos rechazada' } } }
  }
  const ids = hostEventsSelectorIds(query)
  if (ids === null) {
    return { status: 400, body: { error: { code: 400, message: 'eventSelector no válido' } } }
  }
  const wanted = new Set(ids)
  const matched = HOST_EVENTS.filter((event) => {
    const stub = event['entityId'] as { entityId: { id: string } }
    return wanted.has(stub.entityId.id)
  }).sort((a, b) => Number(b['startTime']) - Number(a['startTime']))
  const pageSize = Number(query.get('pageSize') ?? '100')
  return {
    status: 200,
    body: {
      totalCount: matched.length,
      pageSize,
      nextPageKey: matched.length > pageSize ? 'PAGINA-E2E' : null,
      warnings: [],
      events: matched.slice(0, pageSize)
    }
  }
}

export const breakdownCompact = (text: string): string => text.replace(/["\s]/g, '')
export const breakdownRelation = (hostId: string): string =>
  `fromRelationships.isProcessOf(entityId(${hostId}))`

/** ¿De qué host inventado es la consulta de discos o procesos (null si no es de ninguno)? */
export function hostBreakdownHost(query: URLSearchParams): string | null {
  const selector = query.get('metricSelector') ?? ''
  const scope = breakdownCompact(query.get('entitySelector') ?? '')
  for (const hostId of [BREAKDOWN_HOST_ID, HOST_METRICS_ID]) {
    // Ficha 0019: en HOST_METRICS_ID también llegan las de entities:hostMetrics (0016), que
    // juntan los discos con splitBy() o mezclan otras métricas; las de discos, por disco, no.
    const perDisk =
      hostId === BREAKDOWN_HOST_ID ||
      (!selector.includes(':splitBy(') &&
        splitSelector(selector).every((e) => e.startsWith('builtin:host.disk.')))
    const disks =
      selector.startsWith('builtin:host.disk.') &&
      perDisk &&
      (scope === `entityId(${hostId})` || selector.includes(hostId))
    const processes =
      selector.startsWith('builtin:tech.generic.') &&
      breakdownCompact(`${scope} ${selector}`).includes(breakdownRelation(hostId))
    if (disks || processes) return hostId
  }
  return null
}

/** ¿Es una consulta de discos o procesos de un host inventado? */
export function isHostBreakdownQuery(query: URLSearchParams): boolean {
  return hostBreakdownHost(query) !== null
}

/**
 * Ficha 0040: métricas de un disco (canal entities:diskMetrics). Como en vivo (paso 0 de la
 * ficha): las de `builtin:host.disk.*` tienen el HOST como entidad, así que con
 * `entitySelector=entityId("<disco>")` no llega ninguna serie; el disco se acota con
 * `:filter(eq("dt.entity.disk","<disco>"))`, y el `metricId` de la respuesta llega sin las
 * comillas del valor. Como mucho 10 expresiones por consulta (OpenAPI, ficha 0039); `:last` y
 * `:fold` con `Inf` dan 400. Solo /datos (DISK_PAGE_ID) tiene datos; los otros dos discos
 * del host responden sin series.
 */
export const DISK_PAGE_ID = 'DISK-00000000000E2E12'
export const DISK_PAGE_NAME = '/datos'
export const DISK_PAGE_FILESYSTEM = 'ext4'
export const DISK_PAGE_IDS = HOST_PAGE_DISKS.map((disk) => disk.id)
export const DISK_T0 = Date.parse('2026-10-03T08:00:00.000Z')
/** Series de /datos (último punto a null, como en vivo). */
export const DISK_PAGE_SERIES: Record<string, (number | null)[]> = {
  'builtin:host.disk.usedPct': [90, 91, 92, null],
  'builtin:host.disk.used': [450 * GB, 454 * GB, 455 * GB, null],
  'builtin:host.disk.avail': [50 * GB, 46 * GB, 45 * GB, null],
  'builtin:host.disk.bytesRead': [2_000_000, 3_000_000, 2_500_000, null],
  'builtin:host.disk.bytesWritten': [10_000, 14_000, 12_000, null],
  'builtin:host.disk.readTime': [10, 14, 12, null],
  'builtin:host.disk.writeTime': [16, 20, 18, null],
  'builtin:host.disk.queueLength': [0.5, 1, 0.75, null],
  'builtin:host.disk.inodesAvail': [97, 97, 96.5, null]
}
/** Valor del rango (resolution=Inf) de /datos por métrica y agregación. */
export const DISK_PAGE_MARKERS: Record<string, number> = {
  'builtin:host.disk.usedPct:max': 92.5,
  'builtin:host.disk.bytesRead:avg': 2_500_000,
  'builtin:host.disk.bytesWritten:avg': 12_000,
  'builtin:host.disk.readTime:avg': 12,
  'builtin:host.disk.writeTime:avg': 18,
  'builtin:host.disk.queueLength:avg': 0.75
}

/** Disco inventado al que va el filtro de la expresión (null si no lleva el de ninguno). */
export function diskOfExpression(expression: string): string | null {
  const id = /:filter\(eq\("dt\.entity\.disk","(DISK-[0-9A-F]{16})"\)\)/.exec(expression)?.[1]
  return id !== undefined && DISK_PAGE_IDS.includes(id) ? id : null
}

/** ¿Es una consulta de entities:diskMetrics (expresiones filtradas por un disco inventado)? */
export function isDiskMetricsQuery(query: URLSearchParams): boolean {
  const expressions = splitSelector(query.get('metricSelector') ?? '')
  return (
    expressions.length > 0 &&
    expressions.every((e) => e.startsWith('builtin:host.disk.')) &&
    expressions.some((e) => diskOfExpression(e) !== null)
  )
}

/** Respuesta del simulador a una consulta de métricas de un disco inventado. */
export function diskMetricResponse(query: URLSearchParams): [number, unknown] {
  const selector = query.get('metricSelector') ?? ''
  const expressions = splitSelector(selector)
  const inf = query.get('resolution') === 'Inf'
  if (expressions.length > HOST_MAX_EXPRESSIONS) {
    return [400, { error: { code: 400, message: 'Más de 10 métricas en la consulta (simulado)' } }]
  }
  if (inf && (selector.includes(':fold(') || /:last\b/.test(selector))) {
    return [400, { error: { code: 400, message: 'Transformación no admitida con Inf (simulado)' } }]
  }
  // Como en vivo: acotar con entityId del disco no devuelve nada (su entidad es el host).
  const byDiskEntity = DISK_PAGE_IDS.some((id) => (query.get('entitySelector') ?? '').includes(id))
  return [
    200,
    {
      totalCount: expressions.length,
      nextPageKey: null,
      resolution: inf ? 'Inf' : '1m',
      result: expressions.map((expression) => {
        const disk = diskOfExpression(expression)
        const [metric = '', rest = ''] = expression.split(
          /:filter\(eq\("dt\.entity\.disk","DISK-[0-9A-F]{16}"\)\)/
        )
        const empty = disk !== DISK_PAGE_ID || byDiskEntity || sim.diskEmpty.includes(metric)
        const values = inf
          ? [DISK_PAGE_MARKERS[`${metric}${rest}`] ?? null]
          : (DISK_PAGE_SERIES[metric] ?? null)
        return {
          metricId: disk === null ? expression : expression.replace(`"${disk}"`, disk),
          dataPointCountRatio: 0.004,
          dimensionCountRatio: 0.004,
          data:
            empty || values === null
              ? []
              : [
                  {
                    dimensionMap: { 'dt.entity.host': HOST_METRICS_ID, 'dt.entity.disk': disk },
                    dimensions: [HOST_METRICS_ID, disk],
                    timestamps: inf
                      ? [DISK_T0 + 180_000]
                      : [0, 1, 2, 3].map((i) => DISK_T0 + i * 60_000),
                    values
                  }
                ]
        }
      })
    }
  ]
}

/** Respuesta del simulador a una consulta de discos o procesos del host inventado. */
export function hostBreakdownResponse(query: URLSearchParams): [number, unknown] {
  const selector = query.get('metricSelector') ?? ''
  const inf = query.get('resolution') === 'Inf'
  if (inf && (selector.includes(':fold(') || /:last\b/.test(selector))) {
    return [400, { error: { code: 400, message: 'Transformación no admitida con Inf (simulado)' } }]
  }
  // Ficha 0019: fallo del canal (un 400 en todas sus consultas).
  if (sim.hostBreakdownFail) {
    return [400, { error: { code: 400, message: 'Discos y procesos no disponibles (simulado)' } }]
  }
  const pageHost = hostBreakdownHost(query) === HOST_METRICS_ID
  const disksData = sim.hostBreakdownEmpty ? [] : pageHost ? HOST_PAGE_DISKS : BREAKDOWN_DISKS
  const processesData = sim.hostBreakdownEmpty
    ? []
    : pageHost
      ? HOST_PAGE_PROCESSES
      : BREAKDOWN_PROCESSES
  const single = inf || selector.includes(':fold(')
  const valueOf = (expression: string, stats: BreakdownStats): number => {
    const fold = /:fold\((\w*)\)/.exec(expression)?.[1]
    if (fold === 'max' || (fold === undefined && hostAgg(expression, 'max'))) return stats.max
    if (fold === 'last' || fold === 'value') return stats.last
    return stats.avg
  }
  const expressions = splitSelector(selector)
  return [
    200,
    {
      totalCount: expressions.length,
      nextPageKey: null,
      resolution: inf ? 'Inf' : '1m',
      result: expressions.map((expression) => {
        const key = hostMetricKey(expression)
        const disk = key.startsWith('builtin:host.disk.')
        const dimension = disk ? 'dt.entity.disk' : 'dt.entity.process_group_instance'
        let items = disk
          ? disksData.flatMap((d) => {
              const stats = d.metrics[key]
              return stats === undefined ? [] : [{ id: d.id, name: d.name, stats }]
            })
          : processesData.map((p) => ({
              id: p.id,
              name: p.name,
              stats: key === 'builtin:tech.generic.cpu.usage' ? p.cpu : p.memory
            }))
        if (/:sort\(value\(\w+,descending\)\)/.test(expression)) {
          items = [...items].sort(
            (a, b) => valueOf(expression, b.stats) - valueOf(expression, a.stats)
          )
        }
        const limit = /:limit\((\d+)\)/.exec(expression)?.[1]
        if (limit !== undefined) items = items.slice(0, Number(limit))
        const names = hostAgg(expression, 'names')
        // Ficha 0019: recorte simulado (ratio > 1) en las métricas de procesos o de discos.
        const truncated = sim.hostBreakdownTruncated === (disk ? 'disks' : 'processes')
        return {
          metricId: expression,
          dataPointCountRatio: 0.005,
          dimensionCountRatio: truncated ? 1.5 : 0.005,
          data: items.map((item) => {
            const dimensionMap: Record<string, string> = { [dimension]: item.id }
            if (disk) dimensionMap['dt.entity.host'] = BREAKDOWN_HOST_ID
            if (names && item.name !== null) dimensionMap[`${dimension}.name`] = item.name
            const { last, avg, max } = item.stats
            return {
              dimensionMap,
              dimensions: Object.values(dimensionMap),
              timestamps: single
                ? [BREAKDOWN_T0 + 180_000]
                : [0, 1, 2, 3].map((i) => BREAKDOWN_T0 + i * 60_000),
              values: single
                ? [valueOf(expression, item.stats)]
                : [max, 3 * avg - max - last, last, null]
            }
          })
        }
      })
    }
  ]
}

/** Ficha 0008: los problemas de los marcadores del servicio (recuentos por affectedEntities). */
export function markerProblems(): FakeProblem[] {
  return (
    [
      ['OPEN', SVC_ID],
      ['CLOSED', SVC_ID],
      ['CLOSED', SVC_ID],
      ['CLOSED', SVC_BIG_ID],
      ['CLOSED', SVC_BIG_ID],
      ['CLOSED', SVC_BIG_ID]
    ] as const
  ).map(([status, entityId], i) => ({
    problemId: `pm-${i + 1}`,
    displayId: `P-M${i + 1}`,
    title: `Problema de marcadores ${i + 1}`,
    status,
    severityLevel: 'ERROR',
    impactLevel: 'SERVICES',
    startTime: NOW - (i + 2) * HOUR,
    endTime: status === 'OPEN' ? -1 : NOW - (i + 1) * HOUR,
    affectedEntities: [{ entityId: { id: entityId, type: 'SERVICE' }, name: `marcadores-${i}` }],
    impactedEntities: [],
    managementZones: [],
    problemFilters: []
  }))
}
