import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { createServer, type Server } from 'node:https'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Locator,
  type Page
} from '@playwright/test'
import { removeDir } from './cleanup'
import { captureOnFailure } from './failure-capture'
import { hoverFresh, moveToNeutral } from './hover'
import { wallTimeToEpoch } from './local-time'
import {
  FIXED_WINDOW,
  SMALL_WINDOW,
  fitsContentSize,
  useCiWindow,
  viewportSize as pageViewportSize,
  type WindowSize
} from './window-size'
import ExcelJS from 'exceljs'
import { generate } from 'selfsigned'
import en from '../src/renderer/src/locales/en/common.json'
import es from '../src/renderer/src/locales/es/common.json'

/**
 * Fase 6, primeras vistas core sobre la app compilada (`out/`): Problemas,
 * Métricas e Inicio contra un Dynatrace simulado (HTTPS en 127.0.0.1), con
 * exportación CSV/XLSX/TXT, capturas, consultas guardadas, rango personalizado,
 * módulos no disponibles y sin auto-refresco.
 *
 * Los entornos usan el nivel 'ignore' para no tener que fijar huellas (eso ya
 * lo prueba tls.spec). Las exportaciones van a una carpeta temporal
 * (VIGIA_EXPORT_DIR). El portapapeles del sistema se guarda y se restaura.
 *
 * Cada test es independiente: `beforeEach` (resetState) deja el simulador, los
 * ajustes de exportación y las consultas guardadas como al principio, activa
 * Producción, pone la interfaz en español y la recarga en Inicio (sin caché ni
 * filtros en memoria). Así se pueden ejecutar en cualquier orden o sueltos con
 * --grep. La app se lanza una sola vez por worker (beforeAll): relanzarla por
 * test sería mucho más lento.
 *
 * Sin modo serie: el único recurso compartido es el portapapeles del sistema, y
 * los tests de un mismo fichero ya corren de uno en uno en su worker (sin
 * fullyParallel); ningún otro spec lo usa (ver CLAUDE.md).
 */

const tok = (name: string): string => `dt0c01.PUBLICAPRUEBA0000000000A.${name.padEnd(64, 'X')}`
const TOKEN_A = tok('SECRETOVISTASA')
const TOKEN_B = tok('SECRETOVISTASB')
const TOKEN_NO_METRICS = tok('SECRETOVISTASNOMETRICS')
const TOKEN_FORBIDDEN = tok('SECRETOVISTASFORBIDDEN')
const SECRET_MARKS = ['SECRETOVISTAS']

const HOUR = 3600_000
const NOW = Date.now()

type FakeProblem = Record<string, unknown> & { displayId: string; title: string; status: string }

const problemsA: FakeProblem[] = [
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

const problemsB: FakeProblem[] = [
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
const ODD_ID = '-1234567890123456789_1700000000000V2'
const detailOnly: FakeProblem[] = [
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
const COUNT_ENTITY_ID = 'SERVICE-00000000000E2E07'
/** Otra entidad inventada, sin problemas. */
const COUNT_EMPTY_ID = 'HOST-00000000000E2E70'
const entityCountProblems: FakeProblem[] = (
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
const HOSTILE_COMMENT =
  '<script>window.__xss = "script"</script><img src="x" onerror="window.__xss = \'img\'; alert(1)"> fin'

/**
 * v0.9.0: problema grande, solo del detalle: 300 evidencias (más una ilegible),
 * un comentario con HTML, un impacto con usuarios estimados, y clúster y namespace.
 */
const BIG_ID = 'pd-big'
/** v0.10.0: la evidencia de causa raíz de P-778 (cerrada). */
const BIG_ROOT = 250
/** v0.10.0: selector del gráfico de la evidencia 299 de P-778 (cuenta como de mini gráfico). */
const SEL_BIG = 'builtin:host.cpu.usage:avg:e2elazy299'
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
const EV_ID = 'pd-evid'
const EV_START = NOW - 3 * HOUR
const MIN = 60_000
const EV_METRIC = 'builtin:service.response.time'
const EV_PROPERTY = '<b>reinicio</b> manual'
const evEntity = (id: string, type: string, name: string): Record<string, unknown> => ({
  entityId: { id, type },
  name
})
const EV_SERVICE = evEntity('SERVICE-EV1', 'SERVICE', 'pagos-ev')
const EV_HOST = evEntity('HOST-EV1', 'HOST', 'host-ev')
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
const SEL_OK = 'builtin:service.response.time:splitBy("dt.entity.service"):avg'
const SEL_BAD = 'builtin:service.errors.total.count:splitBy():sum:e2e400'
const SEL_FORBIDDEN = 'builtin:host.disk.usedPct:avg:e2e403'
const SEL_EMPTY = 'builtin:host.mem.usage:avg:e2evacio'
const SEL_MANY = 'builtin:service.requestCount.total:splitBy("dt.entity.service"):sum:e2e25'
const SEL_LAZY = (i: number): string => `builtin:host.cpu.usage:avg:e2elazy${i}`
const CHART_ENTITY = 'SERVICE-MC1'

/** v0.10.0: eventId de un evento con gráfico, sacado de su nombre ("Gráfico 1" → mc-gráfico-1). */
function chartEventId(name: string): string {
  return `mc-${name.toLowerCase().replace(/\s+/g, '-')}`
}

/** Un EVENT con el selector (y el umbral) en data.properties, como llega de la API. */
function metricEvent(
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

const CHART_ID = 'pd-chart'
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
const LAZY_ID = 'pd-lazy'
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
const SEL_DONE = 'builtin:service.response.time:avg:e2eterminada'
const SEL_ACTIVE = 'builtin:service.response.time:avg:e2eactiva'
const MIXED_ID = 'pd-mixed'
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
const SEL_LONG = 'builtin:service.response.time:avg:e2elargo'
const LONG_ID = 'pd-long'
const LONG_DAYS = 45
const DAY_MS = 24 * HOUR
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
function isEventSelector(selector: string): boolean {
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
function spreadSeries(query: URLSearchParams): { resolution: string; timestamps: number[] } {
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
function eventMetricResponse(query: URLSearchParams): [number, unknown] {
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
const TABLE_ID = 'pd-table'
const TABLE_HTML = '<b>negrita</b><img src=x onerror="window.__xss=1">'
const tableEntity = (id: string, type: string, name: string): Record<string, unknown> => ({
  entityId: { id, type },
  name
})
const T_HOST = tableEntity('HOST-T1', 'HOST', 'host-tabla')
const T_SERVICE = tableEntity('SERVICE-T1', 'SERVICE', 'servicio-tabla')
const tableEvent = (
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
const noFlags = {
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
const DESC_ID = 'pd-desc'
const DESC_MD = [
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
const DESC_SHORT_MD = '## Segundo evento\n\n- **uno**\n- dos'
const DESC_LONG = `# Descripción larga\n\n${'palabra '.repeat(3200)}`
const DESC_HTML = [
  '# Aviso',
  '',
  '<img src=x onerror="window.__xssDesc=1">',
  '',
  'Texto <script>window.__xssDesc=2</script> fin'
].join('\n')
const SEL_DESC = 'builtin:host.cpu.usage:avg:e2edescripcion'
const DESC_SERVICE = { entityId: { id: 'SERVICE-DS1', type: 'SERVICE' }, name: 'svc-descripcion' }
const descEvent = (
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
const DESC_OTHERS = Array.from({ length: 9 }, (_, i) => ({ key: `paso.${i}`, value: `valor-${i}` }))
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
const EV_ALL_COMMENTS = [
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

const manyProblems: FakeProblem[] = Array.from({ length: 300 }, (_, i) => ({
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
const detailExtras = {
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
const SVC_ID = 'SERVICE-00000000000E2E01'
const SVC_T0 = Date.parse('2026-10-03T08:00:00.000Z')
const SVC_TIMESTAMPS = [0, 1, 2, 3].map((i) => SVC_T0 + i * 60_000)
type SvcKind = 'median' | 'p90' | 'p99' | 'requests' | 'errors' | 'rate'
const SVC_SERIES: Record<SvcKind, (number | null)[]> = {
  median: [100_000, 120_000, null, 110_000],
  p90: [300_000, 320_000, null, 310_000],
  p99: [800_000, 900_000, null, 850_000],
  requests: [50, 40, null, 60],
  errors: [5, 0, null, 10],
  rate: [10, 0, null, 16.7]
}
const SVC_MARKERS: Record<SvcKind, number> = {
  median: 105_000,
  p90: 305_000,
  p99: 820_000,
  requests: 1000,
  errors: 50,
  rate: 5
}

/**
 * Ficha 0008: más servicios inventados para los marcadores. Uno con muchas peticiones, ningún
 * error y tiempos de más de un segundo (separador de miles y «s»), y otro sin datos (no está en
 * esta tabla: el simulador le da `data: []`). SVC_ID es el de la 0006 (con errores).
 */
const SVC_BIG_ID = 'SERVICE-00000000000E2E02'
const SVC_EMPTY_ID = 'SERVICE-00000000000E2E03'
/**
 * Ficha 0010: servicios inventados para la franja de problemas del gráfico «Tasa de error»,
 * con las mismas métricas que SVC_ID. SVC_BAND_ID tiene un problema abierto y uno cerrado en el
 * rango de 2 h (bandProblems); SVC_QUIET_ID no tiene ninguno.
 */
const SVC_BAND_ID = 'SERVICE-00000000000E2E04'
const SVC_QUIET_ID = 'SERVICE-00000000000E2E05'
/**
 * Ficha 0013: servicio con dos problemas cerrados de pocos minutos (shortProblems): en un rango
 * de 7 días, sus tramos son muy estrechos; uno de ellos, pegado al final del rango.
 */
const SVC_SHORT_ID = 'SERVICE-00000000000E2E06'
/**
 * Ficha 0013: servicio con un problema cerrado con un id del largo real (P- y 8 cifras), de
 * `sim.bandLongMinutes` minutos (longIdProblems): el test elige la duración para que su tramo
 * mida 5rem o más sin sitio para el id.
 */
const SVC_LONG_ID = 'SERVICE-00000000000E2E09'
/**
 * Ficha 0012: servicio cuyas peticiones KO suman 9907 (5000 + 4000 + 907): el marcador lleva el
 * separador de miles aunque el número tenga solo 4 cifras.
 */
const SVC_KO_THOUSANDS_ID = 'SERVICE-0000000000E2E012'
const SVC_DATA: Record<
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

const BAND_OPEN = {
  problemId: 'pd-band-open',
  displayId: 'P-E2E41',
  title: 'Caída de pagos en la franja'
}
const BAND_CLOSED = {
  problemId: 'pd-band-closed',
  displayId: 'P-E2E42',
  title: 'Lentitud resuelta en la franja'
}
/** Inicio y fin de los dos problemas de la franja, contados desde `sim.bandNow` (por test). */
function bandTimes(): { open: [number, number]; closed: [number, number] } {
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
function bandProblems(): FakeProblem[] {
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

const BAND_SHORT = {
  problemId: 'pd-band-short',
  displayId: 'P-E2E43',
  title: 'Corte breve en la franja'
}
const BAND_SHORT_END = {
  problemId: 'pd-band-short-end',
  displayId: 'P-E2E44',
  title: 'Corte breve al final de la franja'
}

/**
 * Ficha 0013: los dos problemas de SVC_SHORT_ID, cerrados y de 4 minutos: uno de hace 3 días y
 * otro que acabó hace 2 minutos (pegado al final del rango).
 */
function shortProblems(): FakeProblem[] {
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

const BAND_LONG = {
  problemId: 'pd-band-long',
  displayId: 'P-24109876',
  title: 'Problema con id largo en la franja'
}

/** Ficha 0013: el problema de SVC_LONG_ID, cerrado, desde hace 100 minutos y de `bandLongMinutes`. */
function longIdProblems(): FakeProblem[] {
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
function splitSelector(selector: string): string[] {
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

function serviceKind(expression: string): SvcKind | null {
  if (expression.startsWith('builtin:service.requestCount.server')) return 'requests'
  if (expression.startsWith('builtin:service.errors.server.count')) return 'errors'
  if (expression.startsWith('builtin:service.errors.server.rate')) return 'rate'
  if (!expression.startsWith('builtin:service.response.server')) return null
  if (/:median\b/.test(expression)) return 'median'
  if (/:percentile\(90(\.0+)?\)/.test(expression)) return 'p90'
  if (/:percentile\(99(\.0+)?\)/.test(expression)) return 'p99'
  return null
}

/** ¿Es una consulta de métricas de servicio (la de series o la de marcadores)? */
function isServiceSelector(selector: string): boolean {
  return selector.startsWith('builtin:service.')
}

/** Respuesta del simulador a una consulta de métricas del servicio inventado. */
function serviceMetricResponse(query: URLSearchParams): [number, unknown] {
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
    Object.keys(SVC_DATA).find(
      (id) => entitySelector.includes(`entityId("${id}")`) || expression.includes(id)
    )
  return [
    200,
    {
      totalCount: expressions.length,
      nextPageKey: null,
      resolution: marker ? (inf ? 'Inf' : '1m') : '1m',
      result: expressions.map((expression) => {
        const kind = serviceKind(expression)
        const id = serviceOf(expression)
        const known = kind !== null && id !== undefined ? SVC_DATA[id] : undefined
        return {
          metricId: id === undefined ? expression : expression.split(`"${id}"`).join(id),
          data:
            known !== undefined && kind !== null && id !== undefined
              ? [
                  {
                    dimensionMap: { 'dt.entity.service': id },
                    dimensions: [id],
                    timestamps: marker ? [SVC_T0 + 240_000] : SVC_TIMESTAMPS,
                    values: marker ? [known.markers[kind]] : known.series[kind]
                  }
                ]
              : []
        }
      })
    }
  ]
}

/**
 * Estado y registro del Dynatrace simulado. Cada test parte de estos valores
 * (`resetState` los restaura); los contadores solo se comparan con un «antes»
 * tomado dentro del propio test.
 */
// El tipo del simulador es el de este objeto: escribirlo aparte solo lo duplicaría.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const defaultSim = () => ({
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
  bandLongMinutes: 30
})
const sim = defaultSim()

let server: Server
let port = 0
let app: ElectronApplication
let page: Page
let userDataDir: string
captureOnFailure(() => ({ page, userDataDir }))
let exportDir: string
const env: Record<string, string> = {}
const consoleErrors: string[] = []
const rendererRemote: string[] = []
const ipcOutputs: string[] = []

/**
 * Portapapeles de Electron 44 (al estilo W3C y asíncrono). El de Dani se guarda en
 * main (globalThis) al empezar y se restaura al terminar.
 */
type ClipboardItemLike = { types: readonly string[]; getType(type: string): Promise<Blob> }
type ElectronClipboard = {
  clear(): void
  has(mimetype: string): Promise<boolean>
  read(): Promise<ClipboardItemLike[]>
  write(items: unknown[]): Promise<void>
}
const SAVED_CLIPBOARD = '__vigiaE2eSavedClipboard'

function problemsFor(token: string): FakeProblem[] {
  return token === TOKEN_B ? problemsB : problemsA
}

/** Valores de un criterio con lista, p. ej. severityLevel("A","B") → ['A', 'B']. */
function selectorList(selector: string, name: string): string[] | undefined {
  const inner = new RegExp(`${name}\\(([^)]*)\\)`).exec(selector)?.[1]
  return inner === undefined ? undefined : [...inner.matchAll(/"([^"]*)"/g)].map((m) => m[1] ?? '')
}

/** Aplica de forma aproximada status, text, severityLevel e impactLevel del problemSelector. */
function applySelector(problems: FakeProblem[], selector: string | null): FakeProblem[] {
  if (selector === null) return problems
  const status = /status\("(open|closed)"\)/.exec(selector)?.[1]
  const text = /text\("((?:[^"~]|~.)*)"\)/.exec(selector)?.[1]?.replace(/~(.)/g, '$1')
  const severities = selectorList(selector, 'severityLevel')
  const impacts = selectorList(selector, 'impactLevel')
  const affected = selectorList(selector, 'affectedEntities')
  const affects = (p: FakeProblem, ids: string[]): boolean =>
    ((p['affectedEntities'] as { entityId: { id: string } }[] | undefined) ?? []).some((e) =>
      ids.includes(e.entityId.id)
    )
  return problems.filter(
    (p) =>
      (affected === undefined || affects(p, affected)) &&
      (status === undefined || p.status.toLowerCase() === status) &&
      (text === undefined || p.title.toLowerCase().includes(text.toLowerCase())) &&
      (severities === undefined || severities.includes(String(p['severityLevel']))) &&
      (impacts === undefined || impacts.includes(String(p['impactLevel'])))
  )
}

async function startServer(): Promise<void> {
  const pems = await generate([{ name: 'commonName', value: '127.0.0.1' }], {
    keySize: 2048,
    algorithm: 'sha256',
    extensions: [{ name: 'subjectAltName', altNames: [{ type: 7, ip: '127.0.0.1' }] }]
  })
  server = createServer({ key: pems.private, cert: pems.cert }, (req, res) => {
    const url = new URL(req.url ?? '/', 'https://127.0.0.1')
    const token = (req.headers.authorization ?? '').replace(/^Api-Token /, '')
    const send = (status: number, body: unknown): void => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    req.resume()
    req.on('end', () => {
      sim.requests.push(`${req.method ?? ''} ${url.pathname}`)
      if (![TOKEN_A, TOKEN_B, TOKEN_NO_METRICS, TOKEN_FORBIDDEN].includes(token)) {
        return send(401, { error: { code: 401, message: 'Missing or invalid token' } })
      }
      if (req.method === 'POST' && url.pathname === '/api/v2/apiTokens/lookup') {
        return send(200, {
          id: 'dt0c01.PUBLICAPRUEBA0000000000A',
          name: 'e2e',
          enabled: true,
          scopes:
            token === TOKEN_NO_METRICS
              ? ['problems.read', 'slo.read']
              : ['problems.read', 'metrics.read', 'slo.read']
        })
      }
      if (req.method === 'GET' && url.pathname === '/api/v2/problems') {
        sim.problemsRequests += 1
        sim.lastProblemsQuery = url.searchParams
        if (sim.problemsGate !== null) {
          void sim.problemsGate.then(() => respondProblems())
          return
        }
        return respondProblems()
      }
      function respondProblems(): void {
        if (token === TOKEN_FORBIDDEN) {
          return send(403, {
            error: {
              code: 403,
              message: 'Token is missing required scope',
              details: { missingScopes: ['problems.read'] }
            }
          })
        }
        if (sim.badRequest) {
          return send(400, { error: { code: 400, message: 'Selector mal formado en la prueba' } })
        }
        const selector = url.searchParams.get('problemSelector')
        // Ficha 0007: con affectedEntities, como la API: pageSize recorta la lista y
        // totalCount sigue siendo el total.
        if (selector !== null && selector.includes('affectedEntities(')) {
          // Ficha 0010: sin status es la lista de la franja (aparte de los recuentos).
          const list = !selector.includes('status(')
          if (list) sim.entityProblemListQueries.push(url.searchParams)
          else sim.entityProblemQueries.push(url.searchParams)
          if (list && sim.entityProblemListFail) {
            return send(400, {
              error: { code: 400, message: 'Lista de problemas no disponible (simulado)' }
            })
          }
          if (!list && sim.entityProblemsFail) {
            return send(400, {
              error: { code: 400, message: 'Recuento de problemas no disponible (simulado)' }
            })
          }
          const matching = applySelector(
            [
              ...problemsFor(token),
              ...entityCountProblems,
              ...markerProblems(),
              ...bandProblems(),
              ...shortProblems(),
              ...longIdProblems()
            ],
            selector
          )
          const pageSize = Number(url.searchParams.get('pageSize') ?? '50')
          return send(200, {
            totalCount: matching.length,
            pageSize,
            problems: matching.slice(0, pageSize),
            nextPageKey: matching.length > pageSize ? 'pagina-recuento' : null
          })
        }
        const source = sim.many && token === TOKEN_A ? manyProblems : problemsFor(token)
        const selected = applySelector(source, selector)
        const problems = sim.invalidOne
          ? [...selected, { displayId: 'P-ROTO', title: 'Sin problemId', status: 'OPEN' }]
          : selected
        return send(200, {
          ...(sim.warnings.length > 0 ? { warnings: sim.warnings } : {}),
          // Al truncar, el total de la API es mayor que lo que llega (AUD-07).
          totalCount: sim.truncate ? 999 : problems.length,
          problems,
          nextPageKey: sim.truncate ? `pagina-${sim.problemsRequests}` : null
        })
      }
      const single = /^\/api\/v2\/problems\/([^/]+)$/.exec(url.pathname)
      if (req.method === 'GET' && single !== null) {
        sim.lastDetailQuery = url.searchParams
        const respondDetail = (): void => {
          // 400 y no 404 (un 404 es «no existe») ni 5xx (el cliente los reintenta).
          if (sim.detailFails) {
            return send(400, {
              error: { code: 400, message: 'Detalle no disponible en la prueba' }
            })
          }
          // Los de la lista (también los 300 masivos) y uno que solo existe en el detalle.
          const found = [
            ...problemsFor(token),
            ...manyProblems,
            ...detailOnly,
            ...bandProblems()
          ].find((p) => p['problemId'] === decodeURIComponent(single[1] ?? ''))
          return found
            ? send(200, { ...found, ...(found['problemId'] === 'pa-1' ? detailExtras : {}) })
            : send(404, { error: { code: 404, message: 'No existe' } })
        }
        if (sim.detailGate !== null) {
          void sim.detailGate.then(respondDetail)
          return
        }
        return respondDetail()
      }
      const comments = /^\/api\/v2\/problems\/([^/]+)\/comments$/.exec(url.pathname)
      if (req.method === 'GET' && comments !== null) {
        sim.commentsRequests += 1
        sim.lastCommentsQuery = url.searchParams
        return decodeURIComponent(comments[1] ?? '') === EV_ID
          ? send(200, {
              totalCount: EV_ALL_COMMENTS.length,
              pageSize: 500,
              comments: EV_ALL_COMMENTS
            })
          : send(404, { error: { code: 404, message: 'No existe' } })
      }
      if (req.method === 'GET' && url.pathname === '/api/v2/metrics') {
        // Filtra por text (AUD-13: «Sin resultados» con un texto que no casa).
        const text = (url.searchParams.get('text') ?? '').toLowerCase()
        const metrics = [
          { metricId: 'builtin:host.cpu.usage', displayName: 'CPU usage %', unit: 'Percent' },
          { metricId: 'builtin:host.cpu.idle', displayName: 'CPU idle', unit: 'Percent' }
        ].filter((m) => `${m.metricId} ${m.displayName}`.toLowerCase().includes(text))
        return send(200, { totalCount: metrics.length, nextPageKey: null, metrics })
      }
      if (req.method === 'GET' && url.pathname === '/api/v2/metrics/query') {
        sim.metricsQueries += 1
        sim.lastMetricsQuery = url.searchParams
        // v0.9.2: las de los mini gráficos de las evidencias, aparte (con su retardo y su
        // cuenta de peticiones en vuelo).
        const eventSelector = url.searchParams.get('metricSelector') ?? ''
        if (isEventSelector(eventSelector)) {
          sim.eventMetricQueries.push(url.searchParams)
          sim.eventMetricInFlight += 1
          sim.eventMetricMaxInFlight = Math.max(sim.eventMetricMaxInFlight, sim.eventMetricInFlight)
          setTimeout(() => {
            sim.eventMetricInFlight -= 1
            const [status, body] = eventMetricResponse(url.searchParams)
            send(status, body)
          }, sim.eventMetricDelayMs)
          return
        }
        // Ficha 0006: las del canal entities:serviceMetrics, aparte.
        if (isServiceSelector(eventSelector)) {
          sim.serviceMetricQueries.push(url.searchParams)
          const [status, body] = serviceMetricResponse(url.searchParams)
          return send(status, body)
        }
        // v0.10.2: con metricsSpread, puntos por todo el rango (now-7d o ISO), para el eje de días.
        const relative = /^now-(\d+)([mhd])$/.exec(url.searchParams.get('from') ?? '')
        const spreadQuery = new URLSearchParams(url.searchParams)
        if (relative !== null) {
          const unit = { m: 60_000, h: HOUR, d: DAY_MS }[relative[2] as 'm' | 'h' | 'd']
          spreadQuery.set('from', new Date(Date.now() - Number(relative[1]) * unit).toISOString())
          spreadQuery.set('to', new Date().toISOString())
        }
        const spread = sim.metricsSpread ? spreadSeries(spreadQuery) : null
        const timestamps = spread?.timestamps ?? [0, 1, 2, 3, 4].map((i) => NOW - (4 - i) * 60_000)
        // Varias métricas separadas por comas: un resultado por métrica.
        const selectors = (url.searchParams.get('metricSelector') ?? 'x').split(',')
        return send(200, {
          resolution: spread?.resolution ?? url.searchParams.get('resolution') ?? '1m',
          totalCount: selectors.length,
          ...(sim.metricWarnings.length > 0 ? { warnings: sim.metricWarnings } : {}),
          result: selectors.map((metricId) => ({
            metricId,
            ...sim.metricRatios,
            data: [
              {
                dimensionMap: { 'dt.entity.host': 'HOST-AAA1' },
                timestamps,
                values:
                  spread === null
                    ? [10, 20, null, 15, 30]
                    : timestamps.map((_, i) => 10 + (i % 5) * 4)
              }
            ]
          }))
        })
      }
      if (req.method === 'GET' && url.pathname === '/api/v2/slo') {
        return send(200, {
          totalCount: 4,
          nextPageKey: null,
          slo: [
            {
              id: 'slo-1',
              name: 'Disponibilidad pagos',
              enabled: true,
              status: 'SUCCESS',
              target: 99.5,
              warning: 99.8,
              evaluatedPercentage: 99.9,
              errorBudget: 80,
              error: 'NONE',
              relatedOpenProblems: 0
            },
            {
              id: 'slo-2',
              name: 'Latencia carrito',
              enabled: true,
              status: 'FAILURE',
              target: 95,
              warning: 97,
              evaluatedPercentage: 90.1,
              errorBudget: -20,
              error: 'NONE',
              relatedOpenProblems: 2
            },
            {
              // Entre target y warning: la API dice WARNING.
              id: 'slo-3',
              name: 'Errores de login',
              enabled: true,
              status: 'WARNING',
              target: 99,
              warning: 99.5,
              evaluatedPercentage: 99.2,
              errorBudget: 20,
              error: 'NONE',
              // -1: Dynatrace no pudo calcularlo (OpenAPI). Con sim.sloRelatedFailed a false, 0.
              relatedOpenProblems: sim.sloRelatedFailed ? -1 : 0
            },
            {
              // Sin evaluar: la API da -1 y SUCCESS; la tarjeta no puede decir «Correcto».
              id: 'slo-4',
              name: 'Búsqueda sin datos',
              enabled: true,
              status: 'SUCCESS',
              target: 98,
              warning: 99,
              evaluatedPercentage: -1,
              errorBudget: -1,
              error: 'NONE'
            }
          ]
        })
      }
      send(404, { error: { code: 404, message: 'No existe' } })
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  port = (server.address() as AddressInfo).port
}

/** Llama a un canal IPC desde la interfaz y guarda la respuesta para buscar secretos. */
async function invoke<T = unknown>(channel: string, input?: unknown): Promise<T> {
  const result = await page.evaluate(
    ([name, payload]) => {
      const api = (
        window as unknown as { vigia: { invoke: (...args: unknown[]) => Promise<unknown> } }
      ).vigia
      return payload === undefined ? api.invoke(name) : api.invoke(name, payload)
    },
    [channel, input] as const
  )
  ipcOutputs.push(`${channel}: ${JSON.stringify(result)}`)
  const envelope = result as { ok: boolean; data?: unknown; error?: unknown }
  if (!envelope.ok) throw new Error(`${channel} falló: ${JSON.stringify(envelope.error)}`)
  return envelope.data as T
}

async function reloadUi(): Promise<void> {
  await page.reload()
  await page.waitForLoadState('domcontentloaded')
}

async function createEnvironment(
  clientId: string,
  name: string,
  type: string,
  token: string | null
): Promise<string> {
  const created = await invoke<{ id: string }>('environments:create', {
    clientId,
    name,
    type,
    deployment: 'saas',
    classicApiUrl: `https://127.0.0.1:${port}`,
    platformUrl: null,
    ssoUrl: null,
    oauthClientId: null,
    oauthScopes: [],
    accountUuid: null,
    certificateLevel: 'ignore',
    captureUrlPatterns: [],
    tags: [],
    readOnly: false
  })
  if (token !== null)
    await invoke('secrets:set', { environmentId: created.id, kind: 'classicToken', value: token })
  return created.id
}

async function activate(name: string): Promise<void> {
  await invoke('environments:setActive', { environmentId: env[name] })
  await reloadUi()
}

async function goTo(id: string): Promise<void> {
  await page.getByTestId(`nav-${id}`).click()
}

/**
 * Estado de partida de cada test (ver la cabecera). Restaura el simulador, los
 * ajustes de exportación y las consultas guardadas, activa el entorno pedido,
 * pone las preferencias por defecto (español) y recarga la interfaz en Inicio:
 * la caché de datos, los filtros y el rango de tiempo viven en memoria del
 * renderer y se pierden con la recarga.
 */
async function resetState(active: string | null = 'Producción'): Promise<void> {
  Object.assign(sim, defaultSim())
  await invoke('export:setSettings', { csvSeparator: ';', captureFooter: true })
  for (const environmentId of Object.values(env)) {
    const saved = await invoke<{ id: string }[]>('savedQueries:list', { environmentId })
    for (const query of saved) await invoke('savedQueries:delete', { id: query.id })
  }
  await invoke('environments:setActive', {
    environmentId: active === null ? null : env[active]
  })
  await page.evaluate(() => {
    localStorage.setItem(
      'vigia.preferences',
      JSON.stringify({
        state: { theme: 'system', language: 'es', sidebarCollapsed: false },
        version: 1
      })
    )
    window.location.hash = '#/'
  })
  await reloadUi()
  await expect(page.locator('html')).toHaveAttribute('lang', 'es')
  await expect(page.getByTestId('nav-home')).toBeVisible()
}

/** Va a Problemas y espera a que lleguen los 3 problemas de Producción. */
async function openProblems(): Promise<void> {
  await goTo('problems')
  await expect(page.getByTestId('problem-row')).toHaveCount(3)
}

/** La ruta actual (el hash, sin '#'). */
async function currentRoute(): Promise<string> {
  return page.evaluate(() => window.location.hash.replace(/^#/, ''))
}

/** Entra por URL, como un enlace guardado (sin pasar por la lista). */
async function goToRoute(route: string): Promise<void> {
  await page.evaluate((hash) => {
    window.location.hash = hash
  }, route)
}

/** Abre un problema desde la lista con un clic en su fila (en el título) y espera su página. */
async function openProblem(displayId: string): Promise<Locator> {
  await page
    .getByTestId('problem-row')
    .filter({ hasText: displayId })
    .getByRole('gridcell')
    .nth(1)
    .click()
  const problemPage = page.getByTestId('problem-page')
  await expect(problemPage).toBeVisible()
  await expect(page.getByTestId('problem-page-title')).toContainText(displayId)
  return problemPage
}

/**
 * data-index de la primera fila visible bajo la cabecera fija del grid (la primera
 * cuyo borde inferior queda por debajo de la cabecera), como la guarda la lista.
 */
async function firstVisibleIndex(): Promise<number> {
  return page.getByTestId('problems-scroll').evaluate((scroller) => {
    const header = scroller.querySelector('[data-grid-header]')
    const top = header?.getBoundingClientRect().bottom ?? scroller.getBoundingClientRect().top
    const rows = [...scroller.querySelectorAll<HTMLElement>('[data-testid="problem-row"]')]
      .filter((row) => row.getBoundingClientRect().bottom > top + 1)
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)
    return Number(rows[0]?.dataset['index'] ?? -1)
  })
}

/** Tamaño del contenido de la ventana tal y como lo ve la página. */
async function viewportSize(): Promise<WindowSize> {
  return pageViewportSize(page)
}

/**
 * Ejecuta `body` con el contenido de la ventana a `size` (desde main, con setContentSize; la
 * app no cambia) y al acabar la deja en FIXED_WINDOW (ficha 0021), aunque el test falle. Con el
 * escritorio escalado,
 * Windows redondea y el contenido puede quedar hasta 2 px más grande o más pequeño
 * (`fitsContentSize`, ficha 0011): `body` recibe el tamaño real.
 */
async function withContentSize(
  size: WindowSize,
  body: (actual: WindowSize) => Promise<void>
): Promise<void> {
  await app.evaluate(({ BrowserWindow }, wanted) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win === undefined) throw new Error('withContentSize: no hay ventana')
    win.setContentSize(wanted.width, wanted.height)
  }, size)
  try {
    await expect.poll(async () => fitsContentSize(await viewportSize(), size)).toBe(true)
    await body(await viewportSize())
  } finally {
    await app.evaluate(({ BrowserWindow }, back) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(back.width, back.height)
    }, FIXED_WINDOW)
    await expect.poll(async () => fitsContentSize(await viewportSize(), FIXED_WINDOW)).toBe(true)
  }
}

/** Espera dos frames del renderer (lo que la lista hace con requestAnimationFrame ya ha corrido). */
async function nextFrames(): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      })
  )
}

/**
 * data-index de las filas de Problemas enteras a la vista: bajo la cabecera fija del grid, dentro
 * de la zona de scroll y dentro de la ventana.
 */
async function fullyVisibleRows(): Promise<number[]> {
  return page.getByTestId('problems-scroll').evaluate((scroller) => {
    const box = scroller.getBoundingClientRect()
    const top =
      scroller.querySelector('[data-grid-header]')?.getBoundingClientRect().bottom ?? box.top
    const bottom = Math.min(box.bottom, window.innerHeight)
    return [...scroller.querySelectorAll<HTMLElement>('[data-testid="problem-row"]')]
      .filter((row) => {
        const rect = row.getBoundingClientRect()
        return rect.top >= top && rect.bottom <= bottom
      })
      .map((row) => Number(row.dataset['index']))
      .sort((a, b) => a - b)
  })
}

/**
 * Si un clic normal en el centro del elemento le llega a él: el elemento que hay en ese punto
 * es él o algo de dentro. Es la misma comprobación que hace Playwright antes de hacer clic, pero
 * sin esperar los 60 s del test.
 */
async function receivesClick(target: Locator): Promise<boolean> {
  return target.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return false
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    return hit !== null && element.contains(hit)
  })
}

/**
 * Caja del elemento cuando ya no se mueve: la misma en dos lecturas seguidas, separadas por dos
 * frames. Al volver a la lista, la página aún se recoloca un momento (por ejemplo, aparece la
 * barra de scroll de `main`).
 */
async function settledBox(
  target: Locator
): Promise<{ x: number; y: number; width: number; height: number }> {
  let last = ''
  let box: { x: number; y: number; width: number; height: number } | null = null
  await expect
    .poll(async () => {
      await nextFrames()
      box = await target.boundingBox()
      const now = JSON.stringify(box)
      const same = box !== null && now === last
      last = now
      return same
    }, 'el elemento deja de moverse')
    .toBe(true)
  if (box === null) throw new Error('settledBox: el elemento no tiene caja')
  return box
}

/**
 * Clic con el ratón en el centro del elemento, donde está, cuando ya no se mueve y nada lo tapa.
 * Locator.click, si el primer intento no acierta (la página aún se recoloca), reintenta haciendo
 * scroll para alinear el elemento abajo, y ese scroll cambia lo que se está probando.
 *
 * Con `scroll` (ficha 0013), antes desplaza sus contenedores para traerlo al centro de la vista,
 * como haría el usuario: con una ventana pequeña (la del CI) el elemento puede empezar fuera.
 * Sin él, un elemento fuera de la vista hace fallar el test: es lo que se quiere en las listas.
 */
async function clickInPlace(target: Locator, options: { scroll?: boolean } = {}): Promise<void> {
  if (options.scroll === true) {
    await target.evaluate((element) =>
      element.scrollIntoView({ block: 'center', inline: 'nearest' })
    )
  }
  const box = await settledBox(target)
  expect(await receivesClick(target), 'el elemento recibe el clic donde está').toBe(true)
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
}

/** Va a Métricas, pone el selector y la resolución, consulta y espera el gráfico. */
async function runMetric(selector = 'builtin:host.cpu.usage', resolution = '5m'): Promise<void> {
  await goTo('metrics')
  await page.getByTestId('metric-selector').fill(selector)
  await page.getByTestId('metric-resolution').selectOption(resolution)
  await page.getByTestId('metric-run').click()
  await expect(page.getByTestId('metric-chart').locator('canvas').first()).toBeVisible()
}

function exportMenu(target: string): Locator {
  return page.locator(`[data-testid="export-menu"][data-export-target="${target}"]`)
}

/** Lanza una opción del menú de exportación y devuelve el fichero nuevo de la carpeta de exportación. */
async function exportTo(target: string, option: string): Promise<string> {
  const before = new Set(readdirSync(exportDir))
  await exportMenu(target).click()
  await page.getByTestId(option).click()
  let created = ''
  await expect
    .poll(() => {
      created = readdirSync(exportDir).find((name) => !before.has(name)) ?? ''
      return created
    })
    .not.toBe('')
  return join(exportDir, created)
}

/** Aviso de la exportación junto al menú de `target` («Guardado: <fichero>»). */
function exportNotice(target: string): Locator {
  return exportMenu(target).locator('xpath=..').getByRole('status')
}

/**
 * Ficha 0005: como exportTo, pero devuelve el fichero cuando ya está escrito. El nombre aparece en
 * la carpeta en cuanto main empieza a escribirlo (writeFile directo); el aviso «Guardado: …» sale
 * cuando writeFile ha terminado. Y además, con contenido.
 */
async function exportSaved(target: string, option: string): Promise<string> {
  const file = await exportTo(target, option)
  await expect(exportNotice(target)).toHaveText(es.export.saved.replace('{{file}}', basename(file)))
  expect(statSync(file).size, `${basename(file)} vacío`).toBeGreaterThan(0)
  return file
}

/** Tamaño CSS del canvas de un gráfico. */
async function canvasSize(testId: string): Promise<{ width: number; height: number }> {
  return page
    .getByTestId(testId)
    .locator('canvas')
    .first()
    .evaluate((canvas) => ({
      width: (canvas as HTMLCanvasElement).clientWidth,
      height: (canvas as HTMLCanvasElement).clientHeight
    }))
}

/** Tamaño y alpha de la esquina superior izquierda de un PNG, leído con nativeImage en main. */
async function pngInfo(
  path: string
): Promise<{ width: number; height: number; cornerAlpha: number }> {
  return app.evaluate(({ nativeImage }, file) => {
    const image = nativeImage.createFromPath(file)
    const { width, height } = image.getSize()
    // toBitmap: BGRA, 4 bytes por píxel.
    return { width, height, cornerAlpha: image.toBitmap()[3] ?? 0 }
  }, path)
}

test.beforeAll(async () => {
  test.setTimeout(120_000)
  await startServer()
  userDataDir = mkdtempSync(join(tmpdir(), 'vigia-e2e-views-'))
  exportDir = mkdtempSync(join(tmpdir(), 'vigia-e2e-export-'))
  app = await electron.launch({
    // VIGIA_E2E_NO_SANDBOX solo hace falta en contenedores Linux que ejecutan como root.
    args: ['.', ...(process.env['VIGIA_E2E_NO_SANDBOX'] ? ['--no-sandbox'] : [])],
    env: {
      ...process.env,
      VIGIA_USER_DATA_DIR: userDataDir,
      VIGIA_EXPORT_DIR: exportDir,
      VIGIA_E2E: '1'
    }
  })
  await useCiWindow(app)
  page = await app.firstWindow()
  // Nunca la carpeta real de datos: la temporal de esta prueba.
  expect(await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'))).toBe(
    userDataDir
  )
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(error.message))
  page.on('request', (request) => {
    if (/^(https?|wss?):/i.test(request.url())) rendererRemote.push(request.url())
  })
  await page.waitForLoadState('domcontentloaded')

  // El portapapeles es el del sistema: se guarda para restaurarlo al final.
  await app.evaluate(async ({ clipboard }, key) => {
    const items = await (clipboard as unknown as ElectronClipboard).read()
    ;(globalThis as Record<string, unknown>)[key] = items
  }, SAVED_CLIPBOARD)

  const client = await invoke<{ id: string }>('clients:create', {
    name: 'Cliente A',
    color: '#336699'
  })
  env['Producción'] = await createEnvironment(client.id, 'Producción', 'production', TOKEN_A)
  env['Desarrollo'] = await createEnvironment(client.id, 'Desarrollo', 'development', TOKEN_B)
  env['Sin métricas'] = await createEnvironment(
    client.id,
    'Sin métricas',
    'integration',
    TOKEN_NO_METRICS
  )
  env['Sin token'] = await createEnvironment(client.id, 'Sin token', 'other', null)
  env['Prohibido'] = await createEnvironment(client.id, 'Prohibido', 'other', TOKEN_FORBIDDEN)
  await reloadUi()
})

test.beforeEach(async () => {
  await resetState()
})

/**
 * Comprobaciones de seguridad después de CADA test (antes era un test final que
 * dependía de ir el último): sin secretos en las respuestas IPC ni en la página,
 * sin errores de consola y sin peticiones remotas del renderer.
 */
test.afterEach(async () => {
  const outputs = ipcOutputs.splice(0)
  const errors = consoleErrors.splice(0)
  const remote = rendererRemote.splice(0)
  for (const output of outputs) {
    for (const mark of SECRET_MARKS) expect(output, 'respuesta IPC').not.toContain(mark)
  }
  if (!page.isClosed()) {
    const html = await page.content()
    for (const mark of SECRET_MARKS) expect(html, 'HTML de la página').not.toContain(mark)
  }
  expect(errors, 'errores de consola').toEqual([])
  expect(remote, 'peticiones remotas del renderer').toEqual([])
})

test.afterAll(async () => {
  try {
    await restoreClipboardAndClose()
  } finally {
    // Aunque falle el cierre, las carpetas temporales no se quedan en disco.
    removeDir(userDataDir)
    removeDir(exportDir)
  }
})

async function restoreClipboardAndClose(): Promise<void> {
  await app
    ?.evaluate(async ({ clipboard, ClipboardItem }, key) => {
      const cb = clipboard as unknown as ElectronClipboard
      const saved = (globalThis as Record<string, unknown>)[key] as ClipboardItemLike[] | undefined
      if (saved === undefined) return
      cb.clear()
      if (saved.length === 0) return
      try {
        await cb.write(saved)
      } catch {
        // Si no se pueden reescribir tal cual, se reconstruyen tipo a tipo.
        const rebuilt = await Promise.all(
          saved.map(async (item) => {
            const parts: Record<string, Blob> = {}
            for (const type of item.types) parts[type] = await item.getType(type)
            return new (ClipboardItem as unknown as new (parts: Record<string, Blob>) => unknown)(
              parts
            )
          })
        )
        await cb.write(rebuilt)
      }
    }, SAVED_CLIPBOARD)
    .catch(() => undefined)
  try {
    await app?.close()
  } finally {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()))
  }
}

/** Ficha 0021: todos los e2e corren con el contenido de la ventana del CI (useCiWindow). */
test('CA2 (0021): al empezar, el contenido de la ventana mide 1024×720 (con el margen de 2 px)', async () => {
  const size = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))
  expect(fitsContentSize(size, FIXED_WINDOW), `contenido de ${size.width}×${size.height}`).toBe(
    true
  )
})

/**
 * Ficha 0021: withContentSize deja la ventana en FIXED_WINDOW al acabar, no en el tamaño que
 * tuviera antes. Se parte de otro tamaño (dentro de los mínimos de la app) para distinguirlo.
 */
test('CA3 (0021): tras un withContentSize(SMALL_WINDOW), el contenido vuelve a 1024×720', async () => {
  const other = { width: 1000, height: 650 }
  await app.evaluate(({ BrowserWindow }, size) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(size.width, size.height)
  }, other)
  await expect.poll(async () => fitsContentSize(await viewportSize(), other)).toBe(true)
  await withContentSize(SMALL_WINDOW, async (actual) => {
    expect(fitsContentSize(actual, SMALL_WINDOW)).toBe(true)
  })
  const after = await viewportSize()
  expect(fitsContentSize(after, FIXED_WINDOW), `contenido de ${after.width}×${after.height}`).toBe(
    true
  )
})

// Va justo detrás del anterior (views corre en un solo worker, en orden): empieza donde él acabó.
test('CA3 (0021): el test siguiente a un withContentSize(SMALL_WINDOW) empieza con 1024×720', async () => {
  const size = await viewportSize()
  expect(fitsContentSize(size, FIXED_WINDOW), `contenido de ${size.width}×${size.height}`).toBe(
    true
  )
})

test('sin entorno activo, las tres vistas dicen que no hay entorno', async () => {
  await resetState(null)
  const before = sim.problemsRequests
  for (const id of ['home', 'problems', 'metrics']) {
    await goTo(id)
    await expect(page.getByTestId('module-unavailable'), id).toContainText('Sin entorno')
  }
  expect(sim.problemsRequests).toBe(before)
})

test('CA2 (0005): Problemas: tabla, línea de tiempo y página de detalle con las entidades afectadas; se vuelve con «Volver a Problemas» y con la ruta de la barra superior', async () => {
  await withContentSize(FIXED_WINDOW, async () => {
    await openProblems()
    const rows = page.getByTestId('problem-row')
    for (const p of problemsA) {
      await expect(page.getByTestId('problems-grid')).toContainText(p.displayId)
    }
    await expect(page.getByTestId('problems-grid')).toContainText('Respuesta lenta en pagos')
    await expect(page.getByTestId('problems-timeline').locator('canvas').first()).toBeVisible()

    // Sin rango personalizado, la petición va con el rango global (2 h por defecto).
    expect(sim.lastProblemsQuery.get('from')).toBe('now-2h')

    // v0.9.0: el detalle es una página propia, /problems/<problemId>.
    const detail = await openProblem('P-101')
    expect(await currentRoute()).toBe('/problems/pa-1')
    // Al entrar, el foco va al título (los lectores de pantalla anuncian la página).
    await expect(page.getByTestId('problem-page-title')).toBeFocused()
    await expect(page.getByTestId('problem-page-title')).toContainText('Respuesta lenta en pagos')
    // Barra superior: … › Problemas (enlace) › P-101 (página actual).
    const crumbSection = page.getByTestId('breadcrumb-section')
    await expect(crumbSection).toHaveText('Problemas')
    await expect(page.getByTestId('breadcrumb-detail')).toHaveText('P-101')
    await expect(page.getByTestId('breadcrumb-detail')).toHaveAttribute('aria-current', 'page')
    // Resumen con lo de la fila: estado, severidad, impacto e inicio.
    await expect(detail.getByTestId('detail-summary')).toContainText('Rendimiento')
    await expect(detail.getByTestId('detail-root-cause')).toContainText('pagos')
    // Todas las entidades afectadas, con nombre, tipo e id.
    const entities = detail.getByTestId('problem-entity')
    await expect(entities).toHaveCount(2)
    // Cada entidad se identifica por su id (los nombres pueden contenerse unos a otros).
    const byId = (id: string): Locator =>
      entities.filter({ has: page.getByTestId('entity-id').filter({ hasText: id }) })
    await expect(byId('SERVICE-AAA1')).toContainText('pagos')
    await expect(byId('SERVICE-AAA1').getByTestId('entity-type')).toHaveText(/SERVICE/)
    await expect(byId('HOST-AAA1')).toContainText('host-pagos-01')
    await expect(byId('HOST-AAA1').getByTestId('entity-type')).toHaveText(/HOST/)

    // El detalle se pide con fields y muestra cada parte que llega.
    // v0.9.1: sin impactAnalysis.
    await expect
      .poll(() => sim.lastDetailQuery.get('fields'))
      .toBe('evidenceDetails,recentComments')
    await expect(detail.getByTestId('detail-evidence')).toContainText(
      'Tiempo de respuesta degradado'
    )
    await expect(detail.getByTestId('detail-impacts')).toHaveCount(0)
    await expect(detail.getByTestId('detail-comments')).toContainText(
      'Revisando el pool de conexiones'
    )
    await expect(detail.getByTestId('detail-zones')).toContainText('Producción')
    await expect(detail.getByTestId('detail-impacted')).toContainText('web')
    await expect(detail.getByTestId('detail-tags')).toContainText('equipo:pagos')
    await expect(detail.getByTestId('detail-linked')).toContainText('P-099')
    await expect(
      page.locator('[data-testid="export-menu"][data-export-target="problem-page"]')
    ).toBeVisible()
    // Ya no hay panel lateral.
    await expect(page.getByTestId('problem-detail')).toHaveCount(0)

    // «Volver a Problemas» vuelve a la lista; la fila abierta queda marcada (data-selected,
    // sin aria-selected).
    await detail.getByTestId('problem-back').click()
    await expect(rows).toHaveCount(3)
    expect(await currentRoute()).toBe('/problems')
    await expect(page.getByTestId('breadcrumb-detail')).toHaveCount(0)
    const p101 = rows.filter({ hasText: 'P-101' })
    await expect(p101).toHaveAttribute('data-selected', 'true')
    await expect(p101).not.toHaveAttribute('aria-selected', /.*/)

    // El enlace «Problemas» de la barra superior también lleva a la lista, con un clic normal
    // (sin force ni dispatchEvent): nada lo tapa ni lo recorta.
    await openProblem('P-102')
    await expect(crumbSection).toBeVisible()
    await expect.poll(() => receivesClick(crumbSection), 'el enlace recibe el clic').toBe(true)
    await crumbSection.click()
    await expect(rows).toHaveCount(3)
    expect(await currentRoute()).toBe('/problems')
  })
})

test('CA2 (0005): con la ventana más pequeña que permite la app, el enlace «Problemas» de la barra superior se ve y recibe un clic normal', async () => {
  await withContentSize(SMALL_WINDOW, async () => {
    await openProblems()
    await openProblem('P-102')
    const crumbSection = page.getByTestId('breadcrumb-section')
    await expect(crumbSection).toHaveText('Problemas')
    await expect(crumbSection).toBeVisible()
    await expect.poll(() => receivesClick(crumbSection), 'el enlace recibe el clic').toBe(true)
    await crumbSection.click()
    await expect(page.getByTestId('problem-row')).toHaveCount(3)
    expect(await currentRoute()).toBe('/problems')
  })
})

test('AUD-12: mientras el detalle carga, la página ya muestra los datos de la fila', async () => {
  await openProblems()
  let release = (): void => undefined
  sim.detailGate = new Promise<void>((resolve) => {
    release = resolve
  })
  try {
    const detail = await openProblem('P-103')
    // Lo de la fila, al instante: título, entidad afectada y severidad.
    await expect(detail).toContainText('errores')
    await expect(detail).toContainText('carrito')
    await expect(detail.getByTestId('detail-summary')).toContainText('NUEVA_SEVERIDAD')
    // Lo que solo trae el detalle, cargando.
    await expect(detail.getByTestId('detail-loading').first()).toBeVisible()
  } finally {
    release()
    sim.detailGate = null
  }
  const detail = page.getByTestId('problem-page')
  await expect(detail.getByTestId('detail-loading')).toHaveCount(0)
  await expect(detail).toContainText('carrito')
})

test('AUD-12: si el detalle falla, el error va dentro de la página y los datos de la fila se quedan', async () => {
  await openProblems()
  sim.detailFails = true
  const detail = await openProblem('P-102')
  await expect(detail.getByRole('alert').first()).toBeVisible()
  await expect(detail).toContainText('Detalle no disponible en la prueba')
  await expect(detail).toContainText('Disco lleno')
  await expect(detail).toContainText('host-bd-01')
  // Con error, las secciones del detalle no se quedan en «Cargando…»: dicen que no están.
  await expect(detail.getByTestId('detail-loading')).toHaveCount(0)
  await expect(detail.getByText(es.problems.detailUnavailable).first()).toBeVisible()
  // No es un 404: no sale «no existe».
  await expect(page.getByTestId('problem-not-found')).toHaveCount(0)
})

test('AUD-12: el detalle se abre con el teclado y, al volver, el foco vuelve a la fila', async () => {
  const detail = page.getByTestId('problem-page')
  await openProblems()

  // Ya no hay botón problem-open: se navega por las filas del grid.
  await expect(page.getByTestId('problem-open')).toHaveCount(0)
  // Roving tabindex: una sola fila con tabIndex 0 (la activa, la 0 al empezar).
  await expect(page.locator('[data-testid="problem-row"][tabindex="0"]')).toHaveCount(1)
  await expect(page.locator('[data-testid="problem-row"][tabindex="0"]')).toHaveAttribute(
    'data-index',
    '0'
  )

  // Tab desde el filtro de texto llega a la fila activa.
  await page.getByTestId('problems-filter-text').focus()
  let reached = false
  for (let i = 0; i < 40 && !reached; i++) {
    await page.keyboard.press('Tab')
    reached = await page.evaluate(
      () => document.activeElement?.getAttribute('data-testid') === 'problem-row'
    )
  }
  expect(reached, 'Tab llega a una fila del grid').toBe(true)
  const activeIndex = (): Promise<number> =>
    page.evaluate(() => Number((document.activeElement as HTMLElement | null)?.dataset['index']))
  expect(await activeIndex()).toBe(0)

  // Flechas, Inicio/Fin y RePág/AvPág mueven el foco (3 filas: de 0 a 2, sin salirse).
  const steps: [string, number][] = [
    ['ArrowDown', 1],
    ['ArrowDown', 2],
    ['ArrowDown', 2],
    ['ArrowUp', 1],
    ['Home', 0],
    ['ArrowUp', 0],
    ['End', 2],
    ['PageUp', 0],
    ['PageDown', 2],
    ['ArrowUp', 1]
  ]
  for (const [key, index] of steps) {
    await page.keyboard.press(key)
    expect(await activeIndex(), key).toBe(index)
  }
  // Al moverse, la activa pasa a ser la única con tabIndex 0.
  await expect(page.locator('[data-testid="problem-row"][tabindex="0"]')).toHaveAttribute(
    'data-index',
    '1'
  )

  // Enter abre la fila activa (la 1: por defecto, Inicio desc → P-103, P-101, P-102).
  const opener = page.locator('[data-testid="problem-row"][data-index="1"]')
  const openedId = await opener.getAttribute('data-problem-id')
  const opened = problemsA.find((p) => p['problemId'] === openedId)?.displayId ?? '?'
  expect(opened).toBe('P-101')
  await page.keyboard.press('Enter')
  await expect(detail).toBeVisible()
  await expect(page.getByTestId('problem-page-title')).toContainText(opened)
  await expect(page.getByTestId('problem-page-title')).toBeFocused()

  // «Volver» (con el teclado) vuelve a la lista con el foco en esa misma fila.
  await page.getByTestId('problem-back').focus()
  await page.keyboard.press('Enter')
  await expect(detail).toHaveCount(0)
  await expect(
    page.locator(`[data-testid="problem-row"][data-problem-id="${openedId}"]`)
  ).toBeFocused()

  // Escape ya no hace nada en la lista (no hay panel que cerrar).
  await page.keyboard.press('Escape')
  expect(await currentRoute()).toBe('/problems')

  // Un clic en cualquier parte de la fila sigue abriendo.
  await page
    .getByTestId('problem-row')
    .filter({ hasText: 'P-102' })
    .getByText('Disco lleno')
    .click()
  await expect(detail).toBeVisible()
  await expect(page.getByTestId('problem-page-title')).toContainText('P-102')
})

for (const size of [FIXED_WINDOW, SMALL_WINDOW]) {
  test(`CA1 (0005): con 300 filas virtualizadas, volver del detalle (botón e historial) conserva el filtro, la primera fila visible y la abierta marcada y a la vista (${size.width}×${size.height})`, async () => {
    await withContentSize(size, async () => {
      sim.many = true
      await goTo('problems')
      const rows = page.getByTestId('problem-row')
      await expect(rows.first()).toContainText('P-M')
      const row = (index: number): Locator =>
        page.locator(`[data-testid="problem-row"][data-index="${index}"]`)

      // Un filtro (lo aplica Dynatrace: todos los masivos lo cumplen).
      await page.getByTestId('problems-filter-text').fill('masivo')
      await expect
        .poll(() => sim.lastProblemsQuery.get('problemSelector') ?? '')
        .toContain('masivo')
      // La lista entera a la vista (en una ventana pequeña queda por debajo) y scroll a mitad:
      // al final, el scroll se recorta y no hay «primera fila» exacta.
      const scroller = page.getByTestId('problems-scroll')
      await scroller.evaluate((el) => el.scrollIntoView({ block: 'end' }))
      await scroller.evaluate((el) => {
        el.scrollTop = el.scrollHeight / 2
      })
      await expect.poll(firstVisibleIndex).toBeGreaterThan(100)
      // La lista guarda el índice en un requestAnimationFrame tras el scroll.
      await nextFrames()
      const before = await firstVisibleIndex()

      /**
       * Abre una fila del centro de las que se ven enteras (no la del borde de la cabecera) con
       * un clic donde está, sin que el clic mueva la lista, y devuelve su id.
       */
      const openMiddleRow = async (): Promise<string> => {
        await settledBox(scroller)
        const visible = await fullyVisibleRows()
        expect(visible.length, 'filas enteras a la vista').toBeGreaterThan(2)
        const index = visible[Math.floor(visible.length / 2)] ?? -1
        const id = (await row(index).getAttribute('data-problem-id')) ?? ''
        expect(id).toMatch(/^pm-\d+$/)
        await clickInPlace(row(index))
        await expect(page.getByTestId('problem-page')).toBeVisible()
        await expect(page.getByTestId('problem-page-title')).toContainText(
          `P-M${id.slice('pm-'.length)}`
        )
        return id
      }

      /** Lo que se conserva al volver: filtro, primera fila (por índice) y la abierta. */
      const expectRestored = async (openedId: string): Promise<void> => {
        await expect(page.getByTestId('problem-page')).toHaveCount(0)
        await expect(page.getByTestId('problems-filter-text')).toHaveValue('masivo')
        await expect.poll(firstVisibleIndex).toBe(before)
        const opened = page.locator(`[data-testid="problem-row"][data-problem-id="${openedId}"]`)
        await expect(opened).toHaveAttribute('data-selected', 'true')
        const openedIndex = Number(await opened.getAttribute('data-index'))
        expect(await fullyVisibleRows(), 'la fila abierta, a la vista').toContain(openedIndex)
      }

      // Se vuelve con el botón.
      const first = await openMiddleRow()
      await page.getByTestId('problem-back').click()
      await expectRestored(first)

      // Lo mismo con la flecha atrás del historial (history.back).
      const second = await openMiddleRow()
      await page.goBack()
      await expectRestored(second)
    })
  })
}

test('v0.9.0: entrar por URL a un problema con un id raro (- y _) y volver a la lista', async () => {
  // Desde Inicio, sin la lista en caché: la ruta lleva el problemId codificado.
  await goToRoute(`/problems/${encodeURIComponent(ODD_ID)}`)
  const detail = page.getByTestId('problem-page')
  await expect(detail).toBeVisible()
  await expect(page.getByTestId('problem-page-title')).toContainText('P-777')
  await expect(page.getByTestId('problem-page-title')).toContainText('Problema solo del detalle')
  await expect(page.getByTestId('breadcrumb-detail')).toHaveText('P-777')
  await expect(detail.getByTestId('detail-affected')).toContainText('raro')

  // Sin venir de la lista, «Volver» va a la lista (reemplazando la entrada).
  await page.getByTestId('problem-back').click()
  await expect(page.getByTestId('problem-row')).toHaveCount(3)
  expect(await currentRoute()).toBe('/problems')
})

test('v0.9.0: un problema que no existe da un 404 con enlace a la lista', async () => {
  await goToRoute(`/problems/${encodeURIComponent('no-existe-en-este-entorno')}`)
  const notFound = page.getByTestId('problem-not-found')
  await expect(notFound).toBeVisible()
  await expect(notFound).toContainText('No existe un problema con ese ID en este entorno.')
  await expect(page.getByTestId('problem-page')).toHaveCount(0)

  await page.getByTestId('problem-not-found-back').click()
  await expect(page.getByTestId('problem-row')).toHaveCount(3)
  expect(await currentRoute()).toBe('/problems')
})

test('v0.9.0: detalle: clúster y namespace, y las secciones sin datos no se pintan', async () => {
  await openProblems()

  // P-101: un clúster y ningún namespace → solo la fila «Clúster».
  let detail = await openProblem('P-101')
  const cluster = detail.getByTestId('detail-cluster')
  await expect(cluster).toContainText('Clúster y namespace')
  await expect(cluster).toContainText('cluster-norte')
  await expect(cluster.locator('dt')).toHaveText(['Clúster'])
  await page.getByTestId('problem-back').click()

  // P-103: dos clústeres (unidos con «, ») y dos namespaces.
  detail = await openProblem('P-103')
  await expect(detail.getByTestId('detail-cluster')).toContainText('cluster-sur, cluster-norte')
  await expect(detail.getByTestId('detail-cluster')).toContainText('carrito-ns, comun-ns')
  await expect(detail.getByTestId('detail-cluster').locator('dt')).toHaveText([
    'Clúster',
    'Namespace'
  ])
  await page.getByTestId('problem-back').click()

  // P-102: sin clúster, sin impactadas, sin zonas y, cargado el detalle, sin evidencias,
  // impactos, comentarios, etiquetas ni vinculado → ninguna de esas secciones (ni «Ninguno»).
  detail = await openProblem('P-102')
  await expect(detail.getByTestId('detail-affected')).toContainText('host-bd-01')
  await expect(detail.getByTestId('detail-loading')).toHaveCount(0)
  for (const id of [
    'detail-cluster',
    'detail-impacted',
    'detail-zones',
    'detail-evidence',
    'detail-impacts',
    'detail-comments',
    'detail-tags',
    'detail-linked'
  ]) {
    await expect(detail.getByTestId(id), id).toHaveCount(0)
  }
  await expect(detail).not.toContainText('Ninguno')
})

/** v0.10.0: filas principales de la tabla de evidencias (sin las de detalle). */
const evidenceRows = (): Locator => page.getByTestId('evidence-row')

/** v0.10.0: la fila de la evidencia con ese título. */
function evidenceRow(title: string): Locator {
  return evidenceRows().filter({ has: page.getByRole('gridcell', { name: title, exact: true }) })
}

/** v0.10.0: el detalle de una fila (por su aria-controls). */
async function detailOf(row: Locator): Promise<Locator> {
  const id = (await row.getAttribute('aria-controls')) ?? ''
  expect(id).toMatch(/^evidence-detail-/)
  return page.locator(`[id="${id}"]`)
}

/** v0.10.0: despliega la fila (si no lo está) y devuelve su detalle. */
async function expandRow(title: string): Promise<Locator> {
  const row = evidenceRow(title)
  await row.scrollIntoViewIfNeeded()
  if ((await row.getAttribute('aria-expanded')) !== 'true') await row.click()
  await expect(row).toHaveAttribute('aria-expanded', 'true')
  const detail = await detailOf(row)
  await expect(detail).toBeVisible()
  return detail
}

test('v0.10.0: 300 evidencias en la tabla virtualizada; la vista responde', async () => {
  await goToRoute(`/problems/${BIG_ID}`)
  const detail = page.getByTestId('problem-page')
  await expect(page.getByTestId('problem-page-title')).toContainText('P-778')
  await expect(evidenceRows().first()).toBeVisible()
  // Virtualizada: no se pintan las 300 filas.
  expect(await evidenceRows().count()).toBeLessThan(300)
  // La evidencia ilegible no sale y se avisa; la API mandó las 301 (no es un recorte).
  await expect(detail.getByTestId('api-warnings')).toContainText('1 elemento')
  await expect(detail.getByTestId('evidence-api-truncated')).toHaveCount(0)
  // Contadores: 150 abiertas y 150 cerradas.
  await expect(page.getByTestId('evidence-status-ALL')).toHaveAttribute('data-count', '300')
  await expect(page.getByTestId('evidence-status-OPEN')).toHaveAttribute('data-count', '150')
  await expect(page.getByTestId('evidence-status-CLOSED')).toHaveAttribute('data-count', '150')
  // Orden por defecto: abiertas primero y la más reciente arriba (la 299).
  await expect(evidenceRows().first()).toHaveAttribute('data-event-id', 'big-299')

  // La vista responde: ir al final del grid y volver.
  const started = Date.now()
  await evidenceRows().first().focus()
  await page.keyboard.press('End')
  const last = page.locator('[data-testid="evidence-row"][data-event-id="big-2"]')
  await expect(last).toBeInViewport()
  await expect(last).toBeFocused()
  await page.keyboard.press('Home')
  await expect(evidenceRows().first()).toBeFocused()
  expect(Date.now() - started, 'recorrer 300 evidencias').toBeLessThan(5000)
  await page.getByTestId('problem-back').click()
  await expect(page.getByTestId('problem-page')).toHaveCount(0)
})

test('v0.10.0: tabla virtualizada: desplegar una fila con gráfico recalcula la altura (la siguiente no se solapa)', async () => {
  sim.eventMetricDelayMs = 600
  await goToRoute(`/problems/${BIG_ID}`)
  const first = page.locator('[data-testid="evidence-row"][data-event-id="big-299"]')
  const next = page.locator('[data-testid="evidence-row"][data-event-id="big-297"]')
  await expect(first).toBeVisible()
  const bottomOf = async (locator: Locator): Promise<number> => {
    const box = await locator.boundingBox()
    return (box?.y ?? 0) + (box?.height ?? 0)
  }
  const topOf = async (locator: Locator): Promise<number> => (await locator.boundingBox())?.y ?? 0

  await first.click()
  const detail = await detailOf(first)
  // Mientras carga: la siguiente fila va debajo del detalle.
  await expect(detail.getByTestId('evidence-metric-loading')).toBeVisible()
  expect(await topOf(next)).toBeGreaterThanOrEqual((await bottomOf(detail)) - 1)
  const loadingBottom = await bottomOf(detail)
  // Con el gráfico pintado (más alto): se vuelve a medir y la siguiente baja con él.
  await expect(detail.getByTestId('evidence-metric')).toBeVisible()
  await expect
    .poll(async () => (await topOf(next)) - (await bottomOf(detail)))
    .toBeGreaterThanOrEqual(-1)
  expect(await bottomOf(detail)).toBeGreaterThan(loadingBottom)
  expect(eventQueries(SEL_BIG)).toHaveLength(1)
  // Plegar: la siguiente vuelve justo debajo de la fila.
  await first.click()
  await expect(page.getByTestId('evidence-detail')).toHaveCount(0)
  await expect
    .poll(async () => Math.abs((await topOf(next)) - (await bottomOf(first))))
    .toBeLessThan(2)
})

test('v0.10.0: el resumen de causa raíz salta a su fila aunque un filtro la oculte: quita el filtro, scroll, la despliega y le da el foco', async () => {
  await goToRoute(`/problems/${BIG_ID}`)
  await expect(evidenceRows().first()).toBeVisible()
  // La causa raíz (cerrada) queda oculta: filtro de abiertas y un texto que no casa.
  await page.getByTestId('evidence-status-OPEN').click()
  await page.getByTestId('evidence-search').fill('Evidencia 1')
  const target = page.locator(`[data-testid="evidence-row"][data-event-id="big-${BIG_ROOT}"]`)
  await expect(target).toHaveCount(0)

  const link = page.getByTestId('root-cause-summary').getByTestId('root-cause-link')
  await expect(link).toHaveCount(1)
  await expect(link).toHaveAttribute('data-id', `big-${BIG_ROOT}`)
  await link.click()

  // Los filtros que la ocultaban se han quitado.
  await expect(page.getByTestId('evidence-status-ALL')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('evidence-search')).toHaveValue('')
  // Su fila, en pantalla, desplegada y con el foco.
  await expect(target).toBeInViewport()
  await expect(target).toHaveAttribute('aria-expanded', 'true')
  await expect(target).toBeFocused()
  await expect(await detailOf(target)).toBeVisible()
})

test('v0.9.0: seguridad: un comentario con <script> e <img onerror> se ve literal y no ejecuta nada', async () => {
  const dialogs: string[] = []
  const onDialog = (dialog: { message: () => string; dismiss: () => Promise<void> }): void => {
    dialogs.push(dialog.message())
    void dialog.dismiss()
  }
  page.on('dialog', onDialog)
  try {
    await goToRoute(`/problems/${BIG_ID}`)
    const comments = page.getByTestId('detail-comments')
    // El texto, tal cual, con sus etiquetas.
    await expect(comments).toContainText('<script>window.__xss = "script"</script>')
    await expect(comments).toContainText('<img src="x" onerror=')
    await expect(comments).toContainText('fin')
    // Nada de eso se ha convertido en elementos ni se ha ejecutado.
    const page_ = page.getByTestId('problem-page')
    await expect(page_.locator('script')).toHaveCount(0)
    await expect(page_.locator('img')).toHaveCount(0)
    // Un margen para que un onerror o un script, si los hubiera, se ejecutaran.
    await page.waitForTimeout(300)
    expect(await page.evaluate(() => (window as { __xss?: unknown }).__xss ?? null)).toBeNull()
    expect(dialogs).toEqual([])
  } finally {
    page.off('dialog', onDialog)
  }
  // Los errores de consola (una imagen rota daría uno) los comprueba el afterEach.
})

test('v0.9.0: exportación del detalle: XLSX con sus hojas e Info, en es y en; CSV solo con las principales', async () => {
  await goToRoute(`/problems/${BIG_ID}`)
  await expect(page.getByTestId('problem-page').getByTestId('detail-evidence')).toBeVisible()

  const workbook = async (): Promise<ExcelJS.Workbook> => {
    const book = new ExcelJS.Workbook()
    await book.xlsx.load(
      readFileSync(await exportTo('problem-page', 'export-xlsx')) as unknown as ArrayBuffer
    )
    return book
  }
  const header = (sheet: ExcelJS.Worksheet | undefined): string[] =>
    ((sheet?.getRow(1).values as unknown[] | undefined) ?? []).slice(1).map(String)

  const es1 = await workbook()
  // v0.9.1: sin hoja Impacto.
  expect(es1.worksheets.map((s) => s.name)).toEqual([
    'Resumen',
    'Entidades',
    'Evidencias',
    'Comentarios',
    'Info'
  ])
  expect(es1.getWorksheet('Resumen')?.actualRowCount).toBe(2)
  expect(header(es1.getWorksheet('Resumen'))).toHaveLength(17)
  // Entidades: la afectada y la impactada, con su rol.
  const entityRows: string[] = []
  es1.getWorksheet('Entidades')?.eachRow((row, n) => {
    if (n > 1) entityRows.push(`${String(row.getCell(1).value)}|${String(row.getCell(4).value)}`)
  })
  expect(entityRows).toEqual(['Afectada|SERVICE-BIG1', 'Impactada|APPLICATION-BIG1'])
  // v0.10.0: TODAS las evidencias (sin filtro), en el orden de la tabla y con las columnas nuevas.
  const evidence = es1.getWorksheet('Evidencias')
  expect(evidence?.actualRowCount).toBe(301)
  const evidenceHeader = header(evidence)
  expect(evidenceHeader).toEqual([
    'Estado',
    'Evento',
    'Tipo',
    'Entidad',
    'Tipo de entidad',
    'Inicio',
    'Fin',
    'Duración (min)',
    'Etiquetas',
    'Causa raíz',
    'En mantenimiento',
    'Frecuente',
    'ID del evento',
    'Antes',
    'Después',
    'Unidad',
    'Métrica'
  ])
  const col = (name: string): number => evidenceHeader.indexOf(name) + 1
  // La primera fila es la de la tabla: big-299 (abierta y la más reciente).
  const firstRow = evidence?.getRow(2)
  expect(firstRow?.getCell(col('ID del evento')).value).toBe('big-299')
  expect(firstRow?.getCell(col('Estado')).value).toBe('Abierto')
  expect(firstRow?.getCell(col('Inicio')).value).toBeInstanceOf(Date)
  // Activa: "Activo" (texto en una columna de fecha) y la duración como número.
  expect(firstRow?.getCell(col('Fin')).value).toBe('Activo')
  expect(typeof firstRow?.getCell(col('Duración (min)')).value).toBe('number')
  // Info: van todas.
  const evidenceNote = (book: ExcelJS.Workbook): string => {
    const lines: string[] = []
    book.getWorksheet('Info')?.eachRow((row) => {
      lines.push(((row.values as unknown[] | undefined) ?? []).map(String).join('|'))
    })
    return lines.find((line) => line.includes('Evidencias:')) ?? ''
  }
  expect(evidenceNote(es1)).toContain('Evidencias: todas (300), en el orden de la tabla.')
  // Comentario como texto (ni fórmula ni HTML interpretado); columnas Autor, Fecha, Contexto, Comentario.
  const commentSheet = es1.getWorksheet('Comentarios')
  expect(header(commentSheet)).toEqual(['Autor', 'Fecha', 'Contexto', 'Comentario'])
  expect(String(commentSheet?.getRow(2).getCell(4).value)).toBe(HOSTILE_COMMENT)
  // Info con el contexto y la nota de siempre.
  const info: Record<string, unknown> = {}
  es1.getWorksheet('Info')?.eachRow((row) => {
    info[String(row.getCell(1).value)] = row.getCell(2).value
  })
  expect(info).toMatchObject({ Cliente: 'Cliente A', Entorno: 'Producción' })
  expect(String(info['Nota'])).toContain('Problemas abiertos: sin fin')

  // v0.10.0: con un filtro en la tabla, la hoja Evidencias trae solo lo filtrado y la Info lo dice.
  await page.getByTestId('evidence-status-CLOSED').click()
  await page.getByTestId('evidence-search').fill('Evidencia 25')
  // Cerradas (las pares) cuyo título contiene «Evidencia 25»: 250, 252, 254, 256 y 258 → 5
  // (la 25 es impar: abierta).
  await expect(page.getByTestId('evidence-row')).toHaveCount(5)
  const filtered = await workbook()
  const filteredSheet = filtered.getWorksheet('Evidencias')
  expect(filteredSheet?.actualRowCount).toBe(6)
  const ids: string[] = []
  filteredSheet?.eachRow((row, n) => {
    if (n > 1) ids.push(String(row.getCell(col('ID del evento')).value))
  })
  // En el orden de la tabla (cerradas, startTime desc).
  expect(ids).toEqual(['big-258', 'big-256', 'big-254', 'big-252', 'big-250'])
  const note = evidenceNote(filtered)
  expect(note).toContain('Evidencias: las 5 de 300 que deja el filtro de la tabla')
  expect(note).toContain('Cerrados')
  expect(note).toContain('Evidencia 25')

  // CSV: ahora también Evidencias (es principal), con lo filtrado; sin Comentarios.
  const csv = readFileSync(await exportTo('problem-page', 'export-csv'))
  expect([...csv.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
  const text = csv.subarray(3).toString('utf8')
  expect(text).toContain('Resumen')
  expect(text).toContain('Entidades')
  expect(text).toContain('Evidencias')
  expect(text.indexOf('Resumen')).toBeLessThan(text.indexOf('Entidades'))
  expect(text.indexOf('Entidades')).toBeLessThan(text.indexOf('Evidencias'))
  expect(text).toContain('big-250')
  expect(text).not.toContain('big-299')
  expect(text).not.toContain('Comentarios')
  await page.getByTestId('evidence-status-ALL').click()
  await page.getByTestId('evidence-search').fill('')

  // En inglés, las hojas en inglés.
  await page.getByRole('button', { name: es.topbar.language }).click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  const en1 = await workbook()
  expect(en1.worksheets.map((s) => s.name)).toEqual([
    'Summary',
    'Entities',
    'Evidence',
    'Comments',
    'Info'
  ])
  expect(en1.getWorksheet('Evidence')?.getRow(2).getCell(col('Fin')).value).toBe('Active')
})

/** v0.9.1: abre P-779 (evidencias variadas) por URL y espera a que se pinten. */
async function openEvidenceProblem(): Promise<Locator> {
  await goToRoute(`/problems/${EV_ID}`)
  const detail = page.getByTestId('problem-page')
  await expect(page.getByTestId('problem-page-title')).toContainText('P-779')
  await expect(detail.getByTestId('evidence-row').first()).toBeVisible()
  return detail
}

/** v0.10.0: abre P-783 (tabla: problema cerrado con eventos abiertos y cerrados). */
async function openTableProblem(): Promise<Locator> {
  await goToRoute(`/problems/${TABLE_ID}`)
  const detail = page.getByTestId('problem-page')
  await expect(page.getByTestId('problem-page-title')).toContainText('P-783')
  await expect(evidenceRows()).toHaveCount(6)
  return detail
}

const rowTitles = async (): Promise<string[]> =>
  evidenceRows().evaluateAll((rows) =>
    rows.map((row) => row.querySelectorAll('[role="gridcell"]')[1]?.textContent?.trim() ?? '')
  )

test('v0.10.0: tabla de evidencias: estado propio por evento en un problema cerrado, columnas y celdas', async () => {
  await openTableProblem()
  const grid = page.getByTestId('evidence-grid')
  await expect(grid).toHaveAttribute('role', 'grid')
  await expect(page.getByTestId('evidence-scroll').getByTestId('evidence-grid')).toHaveCount(1)
  // El problema está cerrado, pero cada fila tiene su estado.
  await expect(page.getByTestId('detail-summary')).toContainText('Cerrado')
  // Columnas en orden; tags y flags sin orden.
  const columns = [
    'status',
    'title',
    'type',
    'entity',
    'start',
    'end',
    'duration',
    'tags',
    'rootCause',
    'flags'
  ]
  expect(
    await grid
      .locator('[data-testid^="col-"]')
      .evaluateAll((cols) => cols.map((col) => col.getAttribute('data-testid')))
  ).toEqual(columns.map((c) => `col-${c}`))
  for (const c of ['tags', 'flags']) await expect(grid.getByTestId(`sort-${c}`)).toHaveCount(0)
  for (const c of columns.filter((c) => c !== 'tags' && c !== 'flags')) {
    await expect(grid.getByTestId(`sort-${c}`), c).toHaveCount(1)
  }

  // Orden por defecto: abiertos primero, startTime desc.
  expect(await rowTitles()).toEqual([
    'Errores 5xx',
    'CPU saturada',
    'Tiempo de respuesta tabla',
    'Respuesta lenta',
    'Sin datos de evento',
    'Estado manda'
  ])
  const expected: [string, 'OPEN' | 'CLOSED'][] = [
    ['Errores 5xx', 'OPEN'], // sin status: data.endTime -1
    ['CPU saturada', 'OPEN'],
    ['Tiempo de respuesta tabla', 'OPEN'], // METRIC sin data: endTime -1
    ['Respuesta lenta', 'CLOSED'],
    ['Sin datos de evento', 'CLOSED'], // sin data: endTime numérico
    ['Estado manda', 'CLOSED'] // status CLOSED aunque endTime sea -1
  ]
  for (const [title, status] of expected) {
    const row = evidenceRow(title)
    await expect(row, title).toHaveAttribute('data-status', status)
    await expect(row.getByTestId('status-bar'), title).toHaveAttribute('data-status', status)
    const cell = row.getByTestId('evidence-status')
    await expect(cell, title).toHaveAttribute('data-status', status)
    await expect(cell, title).toHaveText(status === 'OPEN' ? 'Abierto' : 'Cerrado')
    await expect(row, title).toHaveAttribute('aria-expanded', 'false')
  }
  await expect(evidenceRow('CPU saturada')).toHaveAttribute('data-event-id', 'tbl-1')
  // Sin eventId: sin data-event-id.
  await expect(evidenceRow('Sin datos de evento')).not.toHaveAttribute('data-event-id', /.*/)

  // Fin y duración de una activa; una cerrada con su duración.
  await expect(evidenceRow('Errores 5xx').getByTestId('evidence-end')).toHaveText('Activo')
  await expect(evidenceRow('Errores 5xx').getByTestId('evidence-duration')).toHaveText('en curso')
  await expect(evidenceRow('Respuesta lenta').getByTestId('evidence-duration')).toHaveText('20 min')
  // Tipo traducido si existe; si no, el código.
  await expect(evidenceRow('Tiempo de respuesta tabla')).toContainText('Métrica')
  await expect(evidenceRow('Sin datos de evento')).toContainText('CUSTOM_INFO')
  // Causa raíz y flags (solo los true).
  await expect(evidenceRow('CPU saturada').getByTestId('evidence-root')).toHaveText('Sí')
  await expect(evidenceRow('Respuesta lenta').getByTestId('evidence-root')).toHaveText('')
  const flags = evidenceRow('CPU saturada').getByTestId('evidence-flags')
  await expect(flags.getByTestId('flag-maintenance')).toHaveCount(1)
  await expect(flags.getByTestId('flag-frequent')).toHaveCount(0)
  await expect(flags.getByTestId('flag-suppressed')).toHaveCount(0)
  await expect(evidenceRow('Estado manda').getByTestId('flag-frequent')).toHaveCount(1)

  // Tags: 2 visibles y «+2» con un tooltip con todos (sin stringRepresentation → key:value o key).
  const tags = evidenceRow('CPU saturada').getByTestId('evidence-tags')
  await expect(tags).toContainText('equipo:pagos')
  await expect(tags).toContainText('zona:eu')
  const more = tags.getByTestId('evidence-tags-more')
  await expect(more).toHaveText('+2')
  await hoverFresh(page, more)
  const tooltip = page.getByTestId('evidence-tags-tooltip')
  await expect(tooltip).toBeVisible()
  for (const tag of ['equipo:pagos', 'zona:eu', 'critico', 'capa:infra']) {
    await expect(tooltip).toContainText(tag)
  }
  await moveToNeutral(page)
  await page.keyboard.press('Escape')
  await expect(tooltip).toHaveCount(0)
  // Tooltip de la entidad, con su tipo.
  await hoverFresh(page, evidenceRow('CPU saturada').getByRole('gridcell', { name: /host-tabla/ }))
  await expect(page.getByTestId('evidence-entity-tooltip')).toContainText('HOST')
  await moveToNeutral(page)
  await page.keyboard.press('Escape')

  // Orden por título (clic en la cabecera) y vuelta al de estado.
  await grid.getByTestId('sort-title').click()
  expect((await rowTitles())[0]).toBe('CPU saturada')
  await grid.getByTestId('sort-status').click()
  await grid.getByTestId('sort-status').click()
})

test('v0.10.0: contadores Abiertos/Cerrados/Todos filtran y se combinan con el resto de filtros', async () => {
  await openTableProblem()
  const button = (s: 'ALL' | 'OPEN' | 'CLOSED'): Locator => page.getByTestId(`evidence-status-${s}`)
  await expect(button('ALL')).toHaveAttribute('data-count', '6')
  await expect(button('OPEN')).toHaveAttribute('data-count', '3')
  await expect(button('CLOSED')).toHaveAttribute('data-count', '3')
  await expect(button('ALL')).toHaveAttribute('aria-pressed', 'true')

  await button('OPEN').click()
  await expect(button('OPEN')).toHaveAttribute('aria-pressed', 'true')
  await expect(button('ALL')).toHaveAttribute('aria-pressed', 'false')
  await expect(evidenceRows()).toHaveCount(3)
  for (const row of await evidenceRows().all())
    await expect(row).toHaveAttribute('data-status', 'OPEN')
  // Los contadores no dependen del filtro de estado.
  await expect(button('CLOSED')).toHaveAttribute('data-count', '3')

  await button('CLOSED').click()
  await expect(evidenceRows()).toHaveCount(3)
  for (const row of await evidenceRows().all()) {
    await expect(row).toHaveAttribute('data-status', 'CLOSED')
  }

  // Combinados: el texto cambia los contadores (todos los filtros menos el de estado).
  await button('ALL').click()
  await page.getByTestId('evidence-search').fill('servicio-tabla')
  await expect(button('ALL')).toHaveAttribute('data-count', '5')
  await expect(button('OPEN')).toHaveAttribute('data-count', '2')
  await expect(button('CLOSED')).toHaveAttribute('data-count', '3')
  await button('OPEN').click()
  await expect(evidenceRows()).toHaveCount(2)
  expect(await rowTitles()).toEqual(['Errores 5xx', 'Tiempo de respuesta tabla'])
})

test('v0.10.0: filtros de texto, tipo, entidad, tag y «solo causa raíz»; sin resultados y limpiar', async () => {
  await openTableProblem()
  // Texto: sin tildes ni mayúsculas.
  await page.getByTestId('evidence-search').fill('ESTADO')
  expect(await rowTitles()).toEqual(['Estado manda'])
  await page.getByTestId('evidence-search').fill('')
  await expect(evidenceRows()).toHaveCount(6)

  // Tipos: popover con opciones (menuitemcheckbox) y su cuenta.
  const types = page.getByTestId('evidence-types')
  await expect(types).toHaveAttribute('aria-haspopup', /.+/)
  await types.click()
  const option = (type: string): Locator =>
    page.locator(`[data-testid="evidence-type-option"][data-type="${type}"]`)
  await expect(option('CUSTOM_ALERT')).toHaveAttribute('role', 'menuitemcheckbox')
  await expect(option('CUSTOM_ALERT')).toContainText('3')
  await expect(option('CPU_SATURATED')).toContainText('1')
  await expect(option('METRIC')).toContainText('1')
  await option('METRIC').click()
  await expect(option('METRIC')).toHaveAttribute('aria-checked', 'true')
  await page.keyboard.press('Escape')
  expect(await rowTitles()).toEqual(['Tiempo de respuesta tabla'])
  await types.click()
  await option('CUSTOM_INFO').click()
  await page.keyboard.press('Escape')
  expect(await rowTitles()).toEqual(['Tiempo de respuesta tabla', 'Sin datos de evento'])
  await types.click()
  await option('METRIC').click()
  await option('CUSTOM_INFO').click()
  await page.keyboard.press('Escape')
  await expect(evidenceRows()).toHaveCount(6)

  // Entidad (select nativo; '' = todas).
  await page.getByTestId('evidence-entity').selectOption('HOST-T1')
  expect(await rowTitles()).toEqual(['CPU saturada'])
  await page.getByTestId('evidence-entity').selectOption('')
  await expect(evidenceRows()).toHaveCount(6)

  // Tag exacto.
  await page.getByTestId('evidence-tag').selectOption('equipo:pagos')
  expect(await rowTitles()).toEqual(['CPU saturada', 'Respuesta lenta'])
  await page.getByTestId('evidence-tag').selectOption('')

  // Solo causa raíz.
  await page.getByTestId('evidence-root-only').check()
  expect(await rowTitles()).toEqual(['CPU saturada'])
  await page.getByTestId('evidence-root-only').uncheck()
  await expect(evidenceRows()).toHaveCount(6)

  // Sin resultados: el aviso y "limpiar filtros" lo deja todo como al principio.
  await page.getByTestId('evidence-search').fill('no existe nada así')
  await page.getByTestId('evidence-entity').selectOption('HOST-T1')
  await expect(evidenceRows()).toHaveCount(0)
  await expect(page.getByTestId('evidence-empty')).toBeVisible()
  await page.getByTestId('evidence-clear-filters').click()
  await expect(evidenceRows()).toHaveCount(6)
  await expect(page.getByTestId('evidence-search')).toHaveValue('')
  await expect(page.getByTestId('evidence-entity')).toHaveValue('')
})

test('v0.10.0: desplegar con clic y con Enter, aria-expanded y aria-controls, Tab dentro y Escape pliega y devuelve el foco', async () => {
  await openTableProblem()
  const row = evidenceRow('CPU saturada')
  // Clic: despliega; el detalle es la fila siguiente, con su id en aria-controls.
  await row.click()
  await expect(row).toHaveAttribute('aria-expanded', 'true')
  const detail = await detailOf(row)
  await expect(detail).toHaveAttribute('data-testid', 'evidence-detail')
  await expect(detail).toHaveAttribute('role', 'row')
  // Propiedades siempre visibles, como texto (el HTML no se interpreta ni se ejecuta).
  const properties = detail.getByTestId('evidence-properties')
  await expect(properties).toBeVisible()
  await expect(properties).toContainText('97')
  // Ficha 0001: dt.event.description va en su sección (el HTML, como texto) y no en propiedades.
  await expect(properties).not.toContainText(TABLE_HTML)
  const description = detail.getByTestId('evidence-description')
  await expect(description).toContainText(TABLE_HTML)
  await expect(detail.locator('b, img')).toHaveCount(0)
  expect(await page.evaluate(() => (window as { __xss?: unknown }).__xss ?? null)).toBeNull()
  await expect(detail.getByTestId('evidence-zones')).toContainText('Producción')
  for (const tag of ['equipo:pagos', 'zona:eu', 'critico', 'capa:infra']) {
    await expect(detail.getByTestId('evidence-all-tags')).toContainText(tag)
  }
  await expect(detail.getByTestId('evidence-more')).toHaveCount(0)
  // Clic otra vez: pliega.
  await row.click()
  await expect(row).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByTestId('evidence-detail')).toHaveCount(0)

  // Enter con el foco en la fila: despliega.
  await row.focus()
  await page.keyboard.press('Enter')
  await expect(row).toHaveAttribute('aria-expanded', 'true')
  // Tab entra en el contenido del detalle.
  await page.keyboard.press('Tab')
  const focusedInDetail = await page.evaluate(
    () => document.activeElement?.closest('[data-testid="evidence-detail"]') !== null
  )
  expect(focusedInDetail).toBe(true)
  // Escape dentro: pliega y devuelve el foco a la fila.
  await page.keyboard.press('Escape')
  await expect(row).toHaveAttribute('aria-expanded', 'false')
  await expect(row).toBeFocused()
  // Escape en la fila desplegada también pliega.
  await page.keyboard.press('Enter')
  await expect(row).toHaveAttribute('aria-expanded', 'true')
  await page.keyboard.press('Escape')
  await expect(row).toHaveAttribute('aria-expanded', 'false')
  await expect(row).toBeFocused()

  // METRIC: el detalle es la tarjeta antes → después.
  const metric = await expandRow('Tiempo de respuesta tabla')
  await expect(metric.getByTestId('evidence-change')).toContainText('100 ms → 300 ms')
  await expect(metric.getByTestId('evidence-variation')).toContainText('+200 %')
})

test('v0.10.0: volver al problema deja la tabla como estaba (filtros, orden y desplegadas); otro problema empieza limpio', async () => {
  await openTableProblem()
  await page.getByTestId('evidence-status-CLOSED').click()
  await expandRow('Respuesta lenta')
  await page.getByTestId('problem-back').click()
  await expect(page.getByTestId('problem-page')).toHaveCount(0)
  // Otro problema: sin filtros ni desplegadas.
  await goToRoute(`/problems/${BIG_ID}`)
  await expect(page.getByTestId('evidence-status-ALL')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('[data-testid="evidence-row"][aria-expanded="true"]')).toHaveCount(0)
  // De vuelta: como se dejó.
  await goToRoute(`/problems/${TABLE_ID}`)
  await expect(page.getByTestId('evidence-status-CLOSED')).toHaveAttribute('aria-pressed', 'true')
  await expect(evidenceRows()).toHaveCount(3)
  await expect(evidenceRow('Respuesta lenta')).toHaveAttribute('aria-expanded', 'true')
})

test('v0.9.1: evidencias: aviso de la API (retirado: chips y grupos se van en la 0.10.0)', async () => {
  const detail = await openEvidenceProblem()
  const section = detail.getByTestId('detail-evidence')
  // La API mandó 8 de 12: se dice.
  await expect(section.getByTestId('evidence-api-truncated')).toHaveText(
    'La API ha devuelto 8 de 12 evidencias.'
  )
  await expect(section.getByTestId('evidence-api-truncated')).toHaveAttribute('role', 'status')
  await expect(evidenceRows()).toHaveCount(8)
  // Ya no existen los grupos, los chips ni el bloque de causa raíz.
  for (const id of ['evidence-group', 'evidence-filter', 'evidence-root-cause', 'evidence-item']) {
    await expect(section.getByTestId(id), id).toHaveCount(0)
  }
  // El resumen de causa raíz enlaza las dos rootCauseRelevant.
  await expect(page.getByTestId('root-cause-link')).toHaveCount(2)
})

test('v0.9.1: tarjetas de cambio (METRIC y TRANSACTIONAL), N/A y propiedades de un EVENT, en la fila desplegada', async () => {
  await openEvidenceProblem()
  // v0.10.0: la tarjeta y las propiedades van en el detalle de la fila desplegada.
  const item = expandRow

  // METRIC: antes → después con la unidad formateada (µs → ms y s), flecha y variación.
  const metric = await item('Tiempo de respuesta')
  const change = metric.getByTestId('evidence-change')
  await expect(change).toContainText('Tiempo de respuesta en pagos-ev:')
  await expect(change).toContainText('200 ms → 1,5 s')
  const variation = change.getByTestId('evidence-variation')
  // 200 ms → 1500 ms: ×7,5 → +650 %; la flecha es un svg y la dirección va en sr-only.
  await expect(variation).toContainText('+650 %')
  await expect(variation.locator('.sr-only')).toHaveText('sube')
  await expect(variation.locator('svg')).toHaveCount(1)
  await expect(variation).toHaveClass(/text-danger/)
  await expect(change.getByTestId('evidence-metric-id')).toHaveText(EV_METRIC)
  await expect(change.getByTestId('evidence-open-metrics')).toHaveText('Abrir en Métricas')
  // Sin fin: "Activo" en la fila.
  await expect(evidenceRow('Tiempo de respuesta').getByTestId('evidence-end')).toHaveText('Activo')

  // TRANSACTIONAL: antes 0 → sin cociente, con la diferencia y su unidad; sin métrica.
  const transactional = await item('Tasa de fallos')
  await expect(transactional.getByTestId('evidence-change')).toContainText('0 % → 12,5 %')
  await expect(transactional.getByTestId('evidence-variation')).toContainText('+12,5 %')
  await expect(transactional.getByTestId('evidence-variation').locator('.sr-only')).toHaveText(
    'sube'
  )
  await expect(transactional.getByTestId('evidence-metric-id')).toHaveCount(0)
  await expect(transactional.getByTestId('evidence-open-metrics')).toHaveCount(0)

  // METRIC sin valores: N/A (antes, después y variación), sin romper la tarjeta.
  const empty = await item('Uso de CPU')
  await expect(empty.getByTestId('evidence-change')).toContainText('N/A → N/A')
  await expect(empty.getByTestId('evidence-variation')).toHaveText('N/A')
  // Sin datos no hay dirección: ni flecha ni «sin cambio» para el lector de pantalla.
  await expect(empty.getByTestId('evidence-variation').locator('svg')).toHaveCount(0)
  await expect(empty.getByTestId('evidence-variation').locator('.sr-only')).toHaveCount(0)
  await expect(empty.getByTestId('evidence-metric-id')).toHaveText('builtin:host.cpu.usage')

  // EVENT con propiedades: siempre visibles en el detalle, como texto (el <b> no es HTML).
  await expect(evidenceRow('Reinicio del proceso')).toContainText('PROCESS_RESTART')
  const event = await item('Reinicio del proceso')
  await expect(event.getByTestId('evidence-more')).toHaveCount(0)
  const properties = event.getByTestId('evidence-properties')
  // Ficha 0001: dt.event.description sale en su sección, no en las propiedades.
  await expect(properties.locator('dt')).toHaveText(['exit.code'])
  await expect(properties.locator('dd')).toHaveText(['137'])
  await expect(event.getByTestId('evidence-description')).toContainText(EV_PROPERTY)
  await expect(event.locator('b')).toHaveCount(0)
  // EVENT sin propiedades: sin bloque de propiedades.
  await expect(evidenceRow('Despliegue')).toContainText('CUSTOM_DEPLOYMENT')
  await expect((await item('Despliegue')).getByTestId('evidence-properties')).toHaveCount(0)
})

test('v0.9.1: «Abrir en Métricas» lleva a Métricas con la métrica, el rango del problema y la consulta hecha', async () => {
  await openEvidenceProblem()
  const metric = await expandRow('Tiempo de respuesta')
  const before = sim.metricsQueries
  const clickedAt = Date.now()
  await metric.getByTestId('evidence-open-metrics').click()

  // Consulta hecha, con la métrica y el rango personalizado: inicio − 30 min hasta ahora
  // (el problema sigue abierto). Sin filtro por entidad.
  await expect.poll(() => sim.metricsQueries).toBe(before + 1)
  expect(sim.lastMetricsQuery.get('metricSelector')).toBe(EV_METRIC)
  expect(sim.lastMetricsQuery.get('from')).toBe(new Date(EV_START - 30 * MIN).toISOString())
  const to = Date.parse(sim.lastMetricsQuery.get('to') ?? '')
  expect(to).toBeGreaterThanOrEqual(clickedAt - 1000)
  expect(to).toBeLessThanOrEqual(Date.now())
  // En la página: el selector en el formulario y la URL limpia (sin ?selector=).
  await expect(page.getByTestId('metric-selector')).toHaveValue(EV_METRIC)
  await expect.poll(currentRoute).toBe('/metrics')
  // Volver no repite la consulta (la URL ya no la lleva).
  await page.getByTestId('module-refresh').waitFor()
  expect(sim.metricsQueries).toBe(before + 1)
})

test('v0.9.1: Métricas por URL: con basura no hace nada', async () => {
  const before = sim.metricsQueries
  await goToRoute('/metrics?selector=&from=ayer&to=2026-10-04T10:00:00.000Z')
  await expect(page.getByTestId('metric-selector')).toBeVisible()
  await expect(page.getByTestId('metric-selector')).toHaveValue('')
  // Aserción negativa: un margen para que una consulta, si la hubiera, saliera.
  await page.waitForTimeout(500)
  expect(sim.metricsQueries).toBe(before)
})

test('v0.9.1: comentarios: aviso de recientes, «Ver todos (7)», contexto y HTML literal', async () => {
  const dialogs: string[] = []
  const onDialog = (dialog: { message: () => string; dismiss: () => Promise<void> }): void => {
    dialogs.push(dialog.message())
    void dialog.dismiss()
  }
  page.on('dialog', onDialog)
  try {
    const detail = await openEvidenceProblem()
    const section = detail.getByTestId('detail-comments')
    const comments = section.getByTestId('problem-comment')
    await expect(comments).toHaveCount(2)
    await expect(section.getByTestId('comments-api-truncated')).toHaveText(
      'Se ven los 2 más recientes de 7 comentarios.'
    )
    const showAll = section.getByTestId('comments-show-all')
    await expect(showAll).toHaveText('Ver todos (7)')
    // No se piden hasta pulsar.
    expect(sim.commentsRequests).toBe(0)
    // El contexto, como etiqueta; sin autor → N/A.
    await expect(comments.nth(0).getByTestId('comment-context')).toHaveText('dynatrace-problem-ui')
    await expect(comments.nth(1).getByTestId('comment-context')).toHaveCount(0)
    await expect(comments.nth(1)).toContainText('N/A')

    await showAll.click()
    await expect(comments).toHaveCount(7)
    expect(sim.commentsRequests).toBe(1)
    expect(Object.fromEntries(sim.lastCommentsQuery)).toEqual({ pageSize: '500' })
    await expect(section.getByTestId('comments-api-truncated')).toHaveCount(0)
    await expect(showAll).toHaveCount(0)
    await expect(section.getByTestId('comments-all-truncated')).toHaveCount(0)
    await expect(section.getByTestId('comment-context')).toHaveText(['dynatrace-problem-ui', 'api'])
    await expect(section).toContainText('Primer comentario')
    // El que viene sin contenido no rompe nada.
    await expect(comments.nth(3)).toContainText('luis')

    // HTML literal: el texto tal cual, sin elementos ni ejecución.
    await expect(section).toContainText('<script>window.__xss = "script"</script>')
    await expect(section.locator('script, img')).toHaveCount(0)
    await page.waitForTimeout(300)
    expect(await page.evaluate(() => (window as { __xss?: unknown }).__xss ?? null)).toBeNull()
    expect(dialogs).toEqual([])
  } finally {
    page.off('dialog', onDialog)
  }
})

test('v0.9.1: XLSX de evidencias variadas: números, "Activa", causa raíz y avisos de la API en Info', async () => {
  await openEvidenceProblem()
  const book = new ExcelJS.Workbook()
  await book.xlsx.load(
    readFileSync(await exportTo('problem-page', 'export-xlsx')) as unknown as ArrayBuffer
  )
  expect(book.worksheets.map((s) => s.name)).toEqual([
    'Resumen',
    'Entidades',
    'Evidencias',
    'Comentarios',
    'Info'
  ])
  const evidence = book.getWorksheet('Evidencias')
  // v0.10.0: las columnas se buscan por su cabecera.
  const headers = ((evidence?.getRow(1).values as unknown[] | undefined) ?? []).map(String)
  const col = (name: string): number => headers.indexOf(name)
  const rows = new Map<string, ExcelJS.Row>()
  evidence?.eachRow((row, n) => {
    if (n > 1) rows.set(String(row.getCell(col('Evento')).value), row)
  })
  expect(rows.size).toBe(8)
  const metric = rows.get('Tiempo de respuesta')
  // Antes y después como números, sin formatear ni escalar; la unidad aparte.
  expect(metric?.getCell(col('Antes')).value).toBe(200_000)
  expect(metric?.getCell(col('Después')).value).toBe(1_500_000)
  expect(metric?.getCell(col('Unidad')).value).toBe('MicroSecond')
  expect(metric?.getCell(col('Métrica')).value).toBe(EV_METRIC)
  expect(metric?.getCell(col('Fin')).value).toBe('Activo')
  expect(metric?.getCell(col('Causa raíz')).value).toBe('No')
  const root = rows.get('Reinicio del proceso')
  expect(root?.getCell(col('Causa raíz')).value).toBe('Sí')
  expect(root?.getCell(col('Inicio')).value).toBeInstanceOf(Date)
  expect(root?.getCell(col('Fin')).value).toBeInstanceOf(Date)
  expect(root?.getCell(col('Duración (min)')).value).toBe(60)
  expect(root?.getCell(col('Tipo')).value).toBe('PROCESS_RESTART')
  // Sin entidad: celda vacía. Tipo desconocido, tal cual.
  expect(rows.get('Ventana de mantenimiento')?.getCell(col('Entidad')).value ?? null).toBeNull()
  expect(rows.get('Algo nuevo')?.getCell(col('Tipo')).value).toBe('TIPO_NUEVO_E2E')
  // Comentarios: los 2 recientes del detalle.
  expect(book.getWorksheet('Comentarios')?.actualRowCount).toBe(3)
  // Info: los dos recortes de la API.
  const info: string[] = []
  book.getWorksheet('Info')?.eachRow((row) => {
    info.push(row.values ? (row.values as unknown[]).map(String).join('|') : '')
  })
  expect(info.join('\n')).toContain('La API ha devuelto 8 de 12 evidencias.')
  expect(info.join('\n')).toContain('La API ha devuelto 2 de 7 comentarios.')
})

/** v0.9.2: consultas de un mini gráfico al simulador, por selector. */
const eventQueries = (selector: string): URLSearchParams[] =>
  sim.eventMetricQueries.filter((query) => query.get('metricSelector') === selector)

/**
 * v0.9.2: el mini gráfico de la evidencia con ese nombre. Desde la 0.10.0 vive en el
 * detalle de su fila: hay que desplegarla antes (openChart).
 */
function metricChart(name: string): Locator {
  return page
    .locator(`[data-testid="evidence-detail"][data-id="${chartEventId(name)}"]`)
    .getByTestId('evidence-metric-chart')
}

/** v0.10.0: despliega la fila de ese evento y devuelve su mini gráfico. */
async function openChart(name: string): Promise<Locator> {
  await expandRow(name)
  return metricChart(name)
}

test('v0.9.2: mini gráfico de un EVENT con selector: una consulta, rango y resolución; la serie de la entidad primero', async () => {
  const mountedAt = Date.now()
  await goToRoute(`/problems/${CHART_ID}`)
  await expect(page.getByTestId('problem-page-title')).toContainText('P-780')
  // Plegada, la fila no pide nada.
  await expect(evidenceRows().first()).toBeVisible()
  await page.waitForTimeout(300)
  expect(eventQueries(SEL_OK)).toHaveLength(0)
  const chart = await openChart('Respuesta lenta')
  await chart.scrollIntoViewIfNeeded()
  const drawn = chart.getByTestId('evidence-metric')
  await expect(drawn).toBeVisible()
  await expect(drawn.locator('canvas').first()).toBeVisible()
  // Dos series; la de la entidad de la evidencia (SERVICE-MC1) va la primera.
  const series = JSON.parse((await drawn.getAttribute('data-series')) ?? '[]') as string[]
  expect(series).toHaveLength(2)
  expect(series[0]).toContain(CHART_ENTITY)
  expect(series[1]).toContain('SERVICE-OTRO')
  await expect(chart.getByTestId('evidence-metric-truncated')).toHaveCount(0)

  // Una sola consulta, con el selector tal cual, el rango personalizado y la resolución.
  const queries = eventQueries(SEL_OK)
  expect(queries).toHaveLength(1)
  const query = queries[0] as URLSearchParams
  const from = Date.parse(query.get('from') ?? '')
  const to = Date.parse(query.get('to') ?? '')
  const start = NOW - 90 * 60_000
  // Activa: hasta "ahora" (el del montaje) y antes del inicio tanto como lleva (~90 min).
  expect(to).toBeGreaterThanOrEqual(mountedAt - 1000)
  expect(to).toBeLessThanOrEqual(Date.now())
  expect(start - from).toBe(to - start)
  // ~3 h → 1m (unos 180 puntos).
  expect(query.get('resolution')).toBe('1m')
  // Sin entitySelector ni nada que no sea la consulta.
  expect([...query.keys()].sort()).toEqual(['from', 'metricSelector', 'resolution', 'to'])
})

test('v0.9.2: estados del mini gráfico: 400, 403, sin datos, 25 series y selector demasiado largo; la página sigue', async () => {
  await goToRoute(`/problems/${CHART_ID}`)
  await expect(page.getByTestId('problem-page-title')).toContainText('P-780')
  const state = (name: string): Locator => metricChart(name).getByTestId('evidence-metric-state')

  for (const [name, expected, text] of [
    ['Selector no compatible', 'incompatible', es.problems.metricState.incompatible],
    ['Sin permiso', 'forbidden', es.problems.metricState.forbidden],
    ['Sin datos', 'noData', es.problems.metricState.noData]
  ] as const) {
    await openChart(name)
    await metricChart(name).scrollIntoViewIfNeeded()
    await expect(state(name), name).toHaveAttribute('data-state', expected)
    await expect(state(name), name).toHaveText(text)
    // Ni gráfico ni exportación, pero sí "Abrir en Métricas".
    await expect(metricChart(name).getByTestId('evidence-metric')).toHaveCount(0)
    await expect(metricChart(name).getByTestId('export-menu')).toHaveCount(0)
    await expect(metricChart(name).getByTestId('evidence-metric-open')).toBeVisible()
  }
  expect(es.problems.metricState.noData).toBe('Sin datos en el periodo.')

  // 25 series: se dibujan 10, la de la entidad (SERVICE-MC20) la primera, y se avisa.
  const many = await openChart('Muchas series')
  await many.scrollIntoViewIfNeeded()
  await expect(many.getByTestId('evidence-metric-truncated')).toHaveText(
    'Mostrando 10 de 25 series.'
  )
  const series = JSON.parse(
    (await many.getByTestId('evidence-metric').getAttribute('data-series')) ?? '[]'
  ) as string[]
  expect(series).toHaveLength(10)
  expect(series[0]).toContain('SERVICE-MC20')

  // Selector de más de 2000: el texto, sin gráfico ni consulta.
  const long = await expandRow('Selector largo')
  await expect(long.getByTestId('evidence-metric-too-long')).toHaveText(
    'Selector demasiado largo para mostrarlo.'
  )
  await expect(long.getByTestId('evidence-metric-chart')).toHaveCount(0)
  expect(sim.eventMetricQueries.some((q) => (q.get('metricSelector') ?? '').includes('xxxx'))).toBe(
    false
  )
  // Un EVENT sin selector: ni gráfico ni aviso.
  const none = await expandRow('Sin selector')
  await expect(none.getByTestId('evidence-metric-chart')).toHaveCount(0)
  await expect(none.getByTestId('evidence-metric-too-long')).toHaveCount(0)

  // La página sigue: título, el resto de las evidencias y volver.
  await expect(page.getByTestId('problem-page-title')).toContainText('P-780')
  await expect(evidenceRows()).toHaveCount(7)
  await page.getByTestId('problem-back').click()
  await expect(page.getByTestId('problem-page')).toHaveCount(0)
})

test('v0.9.2: carga diferida y cola: una fila plegada no pide; al desplegar 20 deprisa, nunca más de 3 consultas a la vez', async () => {
  sim.eventMetricDelayMs = 400
  await goToRoute(`/problems/${LAZY_ID}`)
  await expect(page.getByTestId('problem-page-title')).toContainText('P-781')
  // v0.10.0: plegadas por defecto, ningún gráfico ni consulta.
  await expect(evidenceRows()).toHaveCount(20)
  const charts = page.getByTestId('evidence-metric-chart')
  await expect(charts).toHaveCount(0)
  await page.waitForTimeout(600)
  expect(sim.eventMetricQueries).toHaveLength(0)

  // Se despliegan las 20 seguidas: cada una se pide al verse, y la cola nunca deja más de 3.
  for (const row of await evidenceRows().all()) {
    await row.scrollIntoViewIfNeeded()
    await row.click()
  }
  await expect(charts).toHaveCount(20)
  for (const chart of await charts.all()) await chart.scrollIntoViewIfNeeded()
  await expect.poll(() => sim.eventMetricQueries.length, { timeout: 15_000 }).toBe(20)
  expect(eventQueries(SEL_LAZY(20))).toHaveLength(1)
  expect(sim.eventMetricMaxInFlight).toBeLessThanOrEqual(3)
  // Y la cola sí se usa en paralelo (no de uno en uno).
  expect(sim.eventMetricMaxInFlight).toBe(3)
  await expect(page.getByTestId('evidence-metric')).toHaveCount(20, { timeout: 15_000 })
})

test('v0.9.2: «Actualizar» vuelve a pedir los gráficos de un problema abierto, y no los de uno cerrado', async () => {
  await goToRoute(`/problems/${CHART_ID}`)
  const chart = await openChart('Respuesta lenta')
  await expect(chart.getByTestId('evidence-metric')).toBeVisible()
  expect(eventQueries(SEL_OK)).toHaveLength(1)
  await page.getByTestId('module-refresh').click()
  await expect.poll(() => eventQueries(SEL_OK).length).toBe(2)
  await expect(chart.getByTestId('evidence-metric')).toBeVisible()

  // Cerrado: Actualizar repite el detalle, pero no los gráficos.
  await goToRoute(`/problems/${LAZY_ID}`)
  await expect(page.getByTestId('problem-page-title')).toContainText('P-781')
  await expect((await openChart('Gráfico 1')).getByTestId('evidence-metric')).toBeVisible()
  const before = sim.eventMetricQueries.length
  const detailBefore = sim.lastDetailQuery
  await page.getByTestId('module-refresh').click()
  // El detalle sí se ha vuelto a pedir.
  await expect.poll(() => sim.lastDetailQuery !== detailBefore).toBe(true)
  // Aserción negativa: un margen para que una consulta, si la hubiera, saliera.
  await page.waitForTimeout(800)
  expect(sim.eventMetricQueries.length).toBe(before)
})

test('v0.9.2: volver a un problema cerrado no repite las consultas de sus gráficos', async () => {
  await goToRoute(`/problems/${LAZY_ID}`)
  await expect((await openChart('Gráfico 1')).getByTestId('evidence-metric')).toBeVisible()
  const first = eventQueries(SEL_LAZY(1)).length
  expect(first).toBe(1)
  await page.getByTestId('problem-back').click()
  await expect(page.getByTestId('problem-page')).toHaveCount(0)
  await goToRoute(`/problems/${LAZY_ID}`)
  // v0.10.0: la fila sigue desplegada (el estado de la tabla se conserva).
  await expect(evidenceRow('Gráfico 1')).toHaveAttribute('aria-expanded', 'true')
  await expect(metricChart('Gráfico 1').getByTestId('evidence-metric')).toBeVisible()
  await page.waitForTimeout(500)
  expect(eventQueries(SEL_LAZY(1))).toHaveLength(1)
})

test('v0.9.2: volver a un problema ABIERTO (lista y vuelta) no pide ningún gráfico; Actualizar pide solo la evidencia activa', async () => {
  await goToRoute(`/problems/${MIXED_ID}`)
  await expect(page.getByTestId('problem-page-title')).toContainText('P-782')
  const done = await openChart('Evidencia terminada')
  const active = await openChart('Evidencia activa')
  await expect(done.getByTestId('evidence-metric')).toBeVisible()
  await expect(active.getByTestId('evidence-metric')).toBeVisible()
  expect(eventQueries(SEL_DONE)).toHaveLength(1)
  expect(eventQueries(SEL_ACTIVE)).toHaveLength(1)
  const activeFirst = eventQueries(SEL_ACTIVE)[0] as URLSearchParams
  const doneFirst = eventQueries(SEL_DONE)[0] as URLSearchParams

  // A la lista y de vuelta, pasado un rato: el «ahora» del problema se conserva → caché.
  await page.getByTestId('problem-back').click()
  await expect(page.getByTestId('problem-page')).toHaveCount(0)
  expect(await currentRoute()).toBe('/problems')
  await page.waitForTimeout(1100)
  await goToRoute(`/problems/${MIXED_ID}`)
  await expect(done.getByTestId('evidence-metric')).toBeVisible()
  await expect(active.getByTestId('evidence-metric')).toBeVisible()
  // Aserción negativa: un margen para que una consulta, si la hubiera, saliera.
  await page.waitForTimeout(800)
  expect(eventQueries(SEL_DONE)).toHaveLength(1)
  expect(eventQueries(SEL_ACTIVE)).toHaveLength(1)

  // Actualizar: el problema está abierto → solo la activa (su «to» es ahora) se pide otra vez.
  await page.getByTestId('module-refresh').click()
  await expect.poll(() => eventQueries(SEL_ACTIVE).length).toBe(2)
  await page.waitForTimeout(800)
  expect(eventQueries(SEL_DONE)).toHaveLength(1)
  const activeSecond = eventQueries(SEL_ACTIVE)[1] as URLSearchParams
  // El rango de la activa avanza (el nuevo «ahora»); el de la terminada no ha cambiado.
  expect(Date.parse(activeSecond.get('to') ?? '')).toBeGreaterThan(
    Date.parse(activeFirst.get('to') ?? '')
  )
  expect(doneFirst.get('to')).toBe(new Date(NOW - 2 * HOUR + 15 * 60_000).toISOString())
  await expect(active.getByTestId('evidence-metric')).toBeVisible()
  await expect(done.getByTestId('evidence-metric')).toBeVisible()

  // Y volver otra vez tras Actualizar tampoco pide nada (el reloj nuevo se guarda).
  await page.getByTestId('problem-back').click()
  await goToRoute(`/problems/${MIXED_ID}`)
  await expect(active.getByTestId('evidence-metric')).toBeVisible()
  await page.waitForTimeout(800)
  expect(eventQueries(SEL_ACTIVE)).toHaveLength(2)
  expect(eventQueries(SEL_DONE)).toHaveLength(1)
})

test('v0.9.2: «Abrir en Métricas» del gráfico abre Métricas con ese selector y el rango del gráfico', async () => {
  await goToRoute(`/problems/${CHART_ID}`)
  const chart = await openChart('Respuesta lenta')
  await expect(chart.getByTestId('evidence-metric')).toBeVisible()
  const chartQuery = eventQueries(SEL_OK)[0] as URLSearchParams
  const before = sim.metricsQueries
  await chart.getByTestId('evidence-metric-open').click()

  await expect.poll(() => sim.metricsQueries).toBeGreaterThan(before)
  await expect.poll(currentRoute).toBe('/metrics')
  await expect(page.getByTestId('metric-selector')).toHaveValue(SEL_OK)
  // El mismo rango que el gráfico (la vista Métricas la pide como cualquier consulta).
  const metricsQuery = sim.eventMetricQueries.at(-1) as URLSearchParams
  expect(metricsQuery.get('metricSelector')).toBe(SEL_OK)
  expect(Date.parse(metricsQuery.get('from') ?? '')).toBe(Date.parse(chartQuery.get('from') ?? ''))
  expect(Date.parse(metricsQuery.get('to') ?? '')).toBe(Date.parse(chartQuery.get('to') ?? ''))
})

test('v0.9.2: exportar las series del mini gráfico (CSV con hora, serie y valor) y capturarlo', async () => {
  await goToRoute(`/problems/${CHART_ID}`)
  const chart = await openChart('Respuesta lenta')
  await expect(chart.getByTestId('evidence-metric')).toBeVisible()
  const menu = chart.locator('[data-testid="export-menu"][data-export-target="evidence-metric"]')
  await expect(menu).toBeVisible()

  const save = async (option: string): Promise<string> => {
    const before = new Set(readdirSync(exportDir))
    await menu.click()
    await page.getByTestId(option).click()
    let created = ''
    await expect
      .poll(() => {
        created = readdirSync(exportDir).find((name) => !before.has(name)) ?? ''
        return created
      })
      .not.toBe('')
    return join(exportDir, created)
  }

  const csv = readFileSync(await save('export-csv'))
    .subarray(3)
    .toString('utf8')
  const lines = csv.split(/\r?\n/).filter((line) => line.trim() !== '')
  const headerIndex = lines.findIndex((line) => line.includes('Serie'))
  expect(headerIndex).toBeGreaterThanOrEqual(0)
  const header = (lines[headerIndex] ?? '').split(';')
  expect(header).toHaveLength(3)
  expect(header[1]).toBe('Serie')
  // 2 series × 5 puntos; la de la entidad primero.
  const rows = lines.slice(headerIndex + 1).filter((line) => line.split(';').length === 3)
  expect(rows).toHaveLength(10)
  expect(rows[0]).toContain(CHART_ENTITY)
  expect(rows[0]).toMatch(/;400$/)
  expect(rows.at(-1)).toContain('SERVICE-OTRO')

  // XLSX: Info lleva la consulta (el selector) como contexto, y los valores son números.
  const book = new ExcelJS.Workbook()
  await book.xlsx.load(readFileSync(await save('export-xlsx')) as unknown as ArrayBuffer)
  const info: string[] = []
  book.getWorksheet('Info')?.eachRow((row) => {
    info.push(((row.values as unknown[] | undefined) ?? []).map(String).join('|'))
  })
  expect(info.join('\n')).toContain(SEL_OK)
  const data = book.worksheets[0]
  expect(data?.getRow(2).getCell(1).value).toBeInstanceOf(Date)
  expect(data?.getRow(2).getCell(3).value).toBe(400)

  const png = await pngInfo(await save('capture-save'))
  expect(png.width).toBeGreaterThan(0)
  expect(png.cornerAlpha).toBe(255)
})

/** v0.10.2: lo que el gráfico expone tras pintarse (etiquetas del eje, rango y markLines). */
async function axisOf(chart: Locator): Promise<{
  labels: string[]
  from: number
  to: number
  markLines: number
}> {
  await expect(chart).toHaveAttribute('data-x-labels', /\[.+\]/)
  return {
    labels: JSON.parse((await chart.getAttribute('data-x-labels')) ?? '[]') as string[],
    from: Number(await chart.getAttribute('data-range-from')),
    to: Number(await chart.getAttribute('data-range-to')),
    markLines: Number(await chart.getAttribute('data-mark-lines'))
  }
}

/** Fecha corta del eje en español (dd/MM). */
const ES_DAY = /^\d\d\/\d\d$/

test('v0.10.2: evidencia de 45 días: últimos 7 por defecto, etiquetas de fecha variadas (no «00:00»), nota y sin línea de inicio', async () => {
  await goToRoute(`/problems/${LONG_ID}`)
  await expect(page.getByTestId('problem-page-title')).toContainText('P-784')
  const container = await openChart('Evento largo')
  const drawn = container.getByTestId('evidence-metric')
  await expect(drawn.locator('canvas').first()).toBeVisible()

  // Ventana de 7 días por defecto, con su selector y la nota de recorte.
  const window7 = container.getByTestId('evidence-metric-window-7d')
  await expect(container.getByTestId('evidence-metric-window')).toHaveAttribute('role', 'group')
  await expect(window7).toHaveAttribute('aria-pressed', 'true')
  await expect(container.getByTestId('evidence-metric-window-all')).toHaveAttribute(
    'aria-pressed',
    'false'
  )
  const note = container.getByTestId('evidence-metric-window-note')
  await expect(note).toContainText('7 días')
  await expect(note).toContainText(String(LONG_DAYS))

  // La consulta: 7 días hasta ahora.
  const first = eventQueries(SEL_LONG).at(-1) as URLSearchParams
  const span = Date.parse(first.get('to') ?? '') - Date.parse(first.get('from') ?? '')
  expect(span).toBe(7 * DAY_MS)

  // El eje: varias etiquetas, distintas, alguna con la fecha del idioma, y nunca todas «00:00».
  const axis = await axisOf(drawn)
  expect(axis.to - axis.from).toBe(7 * DAY_MS)
  expect(axis.labels.length).toBeGreaterThan(2)
  expect(new Set(axis.labels).size).toBeGreaterThan(1)
  expect(axis.labels.every((label) => label === '00:00')).toBe(false)
  // Regresión: sin el arreglo salían 17 «00:00» (y solo los extremos con otra hora), así que
  // «no todas iguales» no basta: ninguna «00:00» y alguna fecha.
  expect(axis.labels.filter((label) => label === '00:00')).toHaveLength(0)
  expect(axis.labels.some((label) => ES_DAY.test(label))).toBe(true)
  // El inicio del problema (hace 45 días) queda fuera: sin línea vertical de inicio.
  expect(axis.markLines).toBe(0)

  // Tooltip con fecha y hora completas.
  const box = await drawn.locator('canvas').first().boundingBox()
  await page.mouse.move(
    (box?.x ?? 0) + (box?.width ?? 0) * 0.6,
    (box?.y ?? 0) + (box?.height ?? 0) / 2,
    {
      steps: 10
    }
  )
  const tooltip = page.locator('.vigia-chart-tooltip').filter({ visible: true }).first()
  await expect(tooltip).toContainText(/\d\d\/\d\d\/\d{4} \d\d:\d\d/)
  await moveToNeutral(page)

  // «Todo»: otra consulta con el rango completo (más de 45 días), sin nota y con la línea.
  const before = eventQueries(SEL_LONG).length
  await container.getByTestId('evidence-metric-window-all').click()
  await expect.poll(() => eventQueries(SEL_LONG).length).toBe(before + 1)
  const all = eventQueries(SEL_LONG).at(-1) as URLSearchParams
  expect(Date.parse(all.get('to') ?? '') - Date.parse(all.get('from') ?? '')).toBeGreaterThan(
    LONG_DAYS * DAY_MS
  )
  await expect(container.getByTestId('evidence-metric-window-note')).toHaveCount(0)
  // El gráfico se repinta con el rango nuevo.
  await expect(drawn).toHaveAttribute('data-range-from', String(Date.parse(all.get('from') ?? '')))
  const wide = await axisOf(drawn)
  expect(wide.to - wide.from).toBeGreaterThan(LONG_DAYS * DAY_MS)
  // Con resolución diaria (la devuelta), solo fechas: ninguna hora.
  expect(wide.labels.every((label) => ES_DAY.test(label) || /^\d{4}$/.test(label))).toBe(true)
  expect(new Set(wide.labels).size).toBeGreaterThan(1)
  expect(wide.markLines).toBe(1)

  // 30 días: el rango cambia y vuelve la nota.
  await container.getByTestId('evidence-metric-window-30d').click()
  await expect(container.getByTestId('evidence-metric-window-note')).toContainText('30 días')
  await expect
    .poll(async () => {
      const current = await axisOf(drawn)
      return current.to - current.from
    })
    .toBe(30 * DAY_MS)
  // El inicio (hace 45 días) vuelve a quedar fuera: sin línea de inicio.
  expect((await axisOf(drawn)).markLines).toBe(0)
})

test('v0.10.2: «Abrir en Métricas» y la exportación del mini gráfico usan el rango visible (7 días)', async () => {
  await goToRoute(`/problems/${LONG_ID}`)
  const container = await openChart('Evento largo')
  const drawn = container.getByTestId('evidence-metric')
  const axis = await axisOf(drawn)
  expect(axis.to - axis.from).toBe(7 * DAY_MS)

  // Exportación: Info dice el rango visible y la duración de la evidencia.
  const menu = container.locator(
    '[data-testid="export-menu"][data-export-target="evidence-metric"]'
  )
  const before = new Set(readdirSync(exportDir))
  await menu.click()
  await page.getByTestId('export-xlsx').click()
  let created = ''
  await expect
    .poll(() => {
      created = readdirSync(exportDir).find((name) => !before.has(name)) ?? ''
      return created
    })
    .not.toBe('')
  const book = new ExcelJS.Workbook()
  await book.xlsx.load(readFileSync(join(exportDir, created)) as unknown as ArrayBuffer)
  const info: string[] = []
  book.getWorksheet('Info')?.eachRow((row) => {
    info.push(((row.values as unknown[] | undefined) ?? []).map(String).join('|'))
  })
  const infoText = info.join('\n')
  expect(infoText).toContain('Rango visible')
  expect(infoText).toContain(`${LONG_DAYS} días`)
  // Los puntos exportados, dentro del rango visible.
  const data = book.worksheets[0]
  const times: number[] = []
  data?.eachRow((row, n) => {
    const value = row.getCell(1).value
    if (n > 1 && value instanceof Date) times.push(value.getTime())
  })
  expect(times.length).toBeGreaterThan(0)
  expect(Math.min(...times)).toBeGreaterThanOrEqual(axis.from - 60_000)
  expect(Math.max(...times)).toBeLessThanOrEqual(axis.to + 60_000)

  // Abrir en Métricas: el mismo rango visible.
  await container.getByTestId('evidence-metric-open').click()
  await expect.poll(currentRoute).toBe('/metrics')
  await expect(page.getByTestId('metric-selector')).toHaveValue(SEL_LONG)
  const metricsQuery = sim.eventMetricQueries.at(-1) as URLSearchParams
  expect(Date.parse(metricsQuery.get('from') ?? '')).toBe(axis.from)
  expect(Date.parse(metricsQuery.get('to') ?? '')).toBe(axis.to)
})

test('v0.10.2: Métricas con 7 días: etiquetas del eje variadas con fechas (no todas iguales) y tooltip con fecha y hora', async () => {
  sim.metricsSpread = true
  await goTo('metrics')
  await page.getByTestId('time-range-7d').click()
  await runMetric('builtin:host.cpu.usage', '1h')
  const chart = page.getByTestId('metric-chart')
  const axis = await axisOf(chart)
  expect(axis.labels.length).toBeGreaterThan(2)
  expect(new Set(axis.labels).size).toBeGreaterThan(1)
  expect(axis.labels.some((label) => ES_DAY.test(label))).toBe(true)
  const box = await chart.locator('canvas').first().boundingBox()
  await page.mouse.move(
    (box?.x ?? 0) + (box?.width ?? 0) * 0.5,
    (box?.y ?? 0) + (box?.height ?? 0) / 2,
    {
      steps: 10
    }
  )
  await expect(
    page.locator('.vigia-chart-tooltip').filter({ visible: true }).first()
  ).toContainText(/\d\d\/\d\d\/\d{4} \d\d:\d\d/)
  await moveToNeutral(page)
  await page.getByTestId('time-range-2h').click()
})

test('v0.10.1: «Copiar detalles» de la pantalla de error: el portapapeles lleva los detalles enmascarados (sin rutas de usuario)', async () => {
  // Va en views porque es el spec que guarda y restaura el portapapeles de quien usa el PC.
  await goToRoute('/__errors/unexpected')
  const screen = page.getByTestId('error-screen')
  await expect(screen).toBeVisible()
  await page.getByTestId('error-details').locator('summary').click()
  const shown = (await page.getByTestId('error-details-text').innerText()).trim()
  expect(shown).toContain('/__errors/unexpected')
  await app.evaluate(({ clipboard }) => (clipboard as unknown as ElectronClipboard).clear())
  await page.getByTestId('error-copy').click()
  await expect(page.getByTestId('error-copy-status')).toHaveText(es.errorScreen.copied)
  const copied = await app.evaluate(({ clipboard }) =>
    (clipboard as unknown as { readText: () => Promise<string> | string }).readText()
  )
  // Lo mismo que se ve, ya enmascarado: el usuario de las rutas, nunca.
  expect(copied.trim()).toBe(shown)
  expect(copied).toContain('/__errors/unexpected')
  expect(copied).not.toMatch(/[A-Za-z]:[\\/]Users[\\/](?!<usuario>)/i)
  expect(copied).not.toMatch(/\/home\/(?!<usuario>)/)
  // El disparador mete una ruta de usuario inventada en el mensaje: sale tapada.
  expect(copied).not.toContain('persona-prueba')
  expect(copied).toContain('<usuario>')
  // El error provocado lo escriben en consola React y React Router: es el
  // esperado y se quita; cualquier otro sigue haciendo fallar el afterEach.
  const others = consoleErrors.filter((line) => !line.includes('Error de prueba del disparador'))
  consoleErrors.splice(0, consoleErrors.length, ...others)
})

test('v0.9.0: cambiar de entorno estando en el detalle lleva a la lista del entorno nuevo', async () => {
  await openProblems()
  await openProblem('P-101')
  await page.getByTestId('env-selector').click()
  await page.getByRole('option', { name: 'Cliente A › Desarrollo' }).click()

  await expect(page.getByTestId('problem-page')).toHaveCount(0)
  const table = page.getByTestId('problems-grid')
  await expect(table).toContainText('P-900')
  await expect(table).not.toContainText('P-101')
  expect(await currentRoute()).toBe('/problems')
  await expect(page.getByTestId('breadcrumb-detail')).toHaveCount(0)
})

test('AUD-12: filtros de severidad e impacto, en el servidor', async () => {
  const rows = page.getByTestId('problem-row')
  const selectorParam = (): string => sim.lastProblemsQuery.get('problemSelector') ?? ''
  const pick = async (filter: string, option: string, value: string): Promise<void> => {
    await page.getByTestId(filter).click()
    await page.locator(`[data-testid="${option}"][value="${value}"]`).click()
    await page.keyboard.press('Escape')
  }
  await openProblems()

  // Opciones con los valores de la API.
  await page.getByTestId('problems-filter-severity').click()
  const severityValues = await page
    .getByTestId('severity-option')
    .evaluateAll((els) => els.map((el) => el.getAttribute('value')))
  expect(severityValues).toEqual(
    expect.arrayContaining(['AVAILABILITY', 'ERROR', 'PERFORMANCE', 'RESOURCE_CONTENTION'])
  )
  await page.keyboard.press('Escape')

  const severityTrigger = page.getByTestId('problems-filter-severity')
  // Sin nada marcado, «Todos».
  await expect(severityTrigger).toContainText('Todos')

  await pick('problems-filter-severity', 'severity-option', 'PERFORMANCE')
  await expect.poll(selectorParam).toMatch(/severityLevel\([^)]*"PERFORMANCE"[^)]*\)/)
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('P-101')
  // Con uno marcado, el nombre de esa opción (no un recuento).
  await expect(severityTrigger).toContainText('Rendimiento')
  await expect(severityTrigger).not.toContainText('seleccionado')

  // Dos severidades: las dos en el mismo criterio (OR).
  await pick('problems-filter-severity', 'severity-option', 'RESOURCE_CONTENTION')
  await expect.poll(selectorParam).toMatch(/severityLevel\([^)]*"RESOURCE_CONTENTION"[^)]*\)/)
  expect(selectorParam()).toMatch(/severityLevel\([^)]*"PERFORMANCE"[^)]*\)/)
  await expect(rows).toHaveCount(2)
  // i18n: plural con dos.
  await expect(severityTrigger).toContainText('2 seleccionados')

  // AVAILABILITY va como valor de la API.
  await pick('problems-filter-severity', 'severity-option', 'AVAILABILITY')
  await expect.poll(selectorParam).toMatch(/severityLevel\([^)]*"AVAILABILITY"[^)]*\)/)

  // Se quitan las tres: vuelve la consulta sin severidad (ya en caché, sin petición nueva).
  for (const value of ['PERFORMANCE', 'RESOURCE_CONTENTION', 'AVAILABILITY']) {
    await pick('problems-filter-severity', 'severity-option', value)
  }
  await expect(rows).toHaveCount(3)

  // Impacto.
  await pick('problems-filter-impact', 'impact-option', 'INFRASTRUCTURE')
  await expect.poll(selectorParam).toMatch(/impactLevel\([^)]*"INFRASTRUCTURE"[^)]*\)/)
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('P-102')

  // Van por entorno, como los demás filtros: Desarrollo empieza sin ellos (con
  // INFRASTRUCTURE, P-900, de impacto APPLICATION, no saldría).
  await page.getByTestId('env-selector').click()
  await page.getByRole('option', { name: 'Cliente A › Desarrollo' }).click()
  await expect(page.getByTestId('problems-grid')).toContainText('P-900')
  await page.getByTestId('env-selector').click()
  await page.getByRole('option', { name: 'Cliente A › Producción' }).click()
  await expect(rows).toHaveCount(1)

  await pick('problems-filter-impact', 'impact-option', 'INFRASTRUCTURE')
  await expect(rows).toHaveCount(3)
})

test('grid de Problemas: ARIA, orden por columna, barra de estado y afectados', async () => {
  await openProblems()
  const grid = page.getByTestId('problems-grid')
  const row = (id: string): Locator => page.getByTestId('problem-row').filter({ hasText: id })
  /** IDs de las filas en el orden en que se ven. */
  const order = (): Promise<string[]> =>
    page
      .getByTestId('problem-row')
      .evaluateAll((els) =>
        els
          .sort(
            (a, b) => Number(a.getAttribute('data-index')) - Number(b.getAttribute('data-index'))
          )
          .map((el) => el.getAttribute('data-problem-id') ?? '')
      )

  // La lista se pide ya ordenada por inicio descendente.
  expect(sim.lastProblemsQuery.get('sort')).toBe('-startTime')

  // ARIA: grid con nombre y recuento (3 filas + la cabecera); la cabecera es la fila 1.
  await expect(grid).toHaveAttribute('role', 'grid')
  await expect(grid).toHaveAttribute('aria-label', 'Problemas')
  await expect(grid).toHaveAttribute('aria-rowcount', '4')
  await expect(grid.locator('[data-grid-header] [role="row"]')).toHaveAttribute(
    'aria-rowindex',
    '1'
  )
  const rowIndexes = await page
    .getByTestId('problem-row')
    .evaluateAll((els) => els.map((el) => el.getAttribute('aria-rowindex')).sort())
  expect(rowIndexes).toEqual(['2', '3', '4'])
  for (const r of await page.getByTestId('problem-row').all()) {
    await expect(r).toHaveAttribute('role', 'row')
    await expect(r.getByRole('gridcell')).toHaveCount(4)
  }

  // Cuatro columnas, y por defecto Inicio descendente.
  const headers = await grid
    .locator('[role="columnheader"]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')))
  expect(headers).toEqual(['col-displayId', 'col-title', 'col-affected', 'col-start'])
  await expect(page.getByTestId('col-start')).toHaveAttribute('aria-sort', 'descending')
  for (const key of ['displayId', 'title', 'affected']) {
    await expect(page.getByTestId(`col-${key}`)).toHaveAttribute('aria-sort', 'none')
  }
  await expect(page.getByTestId('col-affected')).toContainText('Afectados')
  expect(await order()).toEqual(['pa-3', 'pa-1', 'pa-2'])

  // Ordenar por ID: una columna nueva de texto empieza ascendente; la misma, invierte.
  await page.getByTestId('sort-displayId').click()
  await expect(page.getByTestId('col-displayId')).toHaveAttribute('aria-sort', 'ascending')
  await expect(page.getByTestId('col-start')).toHaveAttribute('aria-sort', 'none')
  expect(await order()).toEqual(['pa-1', 'pa-2', 'pa-3'])
  await page.getByTestId('sort-displayId').click()
  await expect(page.getByTestId('col-displayId')).toHaveAttribute('aria-sort', 'descending')
  expect(await order()).toEqual(['pa-3', 'pa-2', 'pa-1'])

  // Afectados empieza descendente; empate (P-102 y P-103, 1 cada uno) → inicio desc.
  await page.getByTestId('sort-affected').focus()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('col-affected')).toHaveAttribute('aria-sort', 'descending')
  expect(await order()).toEqual(['pa-1', 'pa-3', 'pa-2'])

  // Con Espacio también; Título empieza ascendente.
  await page.getByTestId('sort-title').focus()
  await page.keyboard.press('Space')
  await expect(page.getByTestId('col-title')).toHaveAttribute('aria-sort', 'ascending')

  // El orden se conserva al ir al detalle y volver.
  await page.getByTestId('sort-displayId').click()
  await expect(page.getByTestId('col-displayId')).toHaveAttribute('aria-sort', 'ascending')
  await openProblem('P-102')
  await page.getByTestId('problem-back').click()
  await expect(page.getByTestId('col-displayId')).toHaveAttribute('aria-sort', 'ascending')
  expect(await order()).toEqual(['pa-1', 'pa-2', 'pa-3'])

  // La exportación sale en el mismo orden que el grid.
  const csv = readFileSync(await exportTo('problems-table', 'export-csv'))
    .subarray(3)
    .toString('utf8')
    .split('\r\n')
    .filter((line) => line !== '')
  expect(csv.slice(1).map((line) => /P-\d+/.exec(line)?.[0])).toEqual(['P-101', 'P-102', 'P-103'])

  // La 1.ª celda dice el estado en texto (para lectores de pantalla) y el ID.
  await expect(row('P-101').getByRole('gridcell').first()).toHaveText('Abierto: P-101')
  await expect(row('P-102').getByRole('gridcell').first()).toHaveText('Cerrado: P-102')

  // Barra de estado: abierto y cerrado, cerrado más fina.
  const bar = (id: string): Locator => row(id).getByTestId('status-bar')
  await expect(bar('P-101')).toHaveAttribute('data-status', 'OPEN')
  await expect(bar('P-102')).toHaveAttribute('data-status', 'CLOSED')
  const width = (id: string): Promise<number> =>
    bar(id).evaluate((el) => el.getBoundingClientRect().width)
  expect(await width('P-102')).toBeLessThan(await width('P-101'))
  // Contraste de la barra (elemento gráfico, WCAG 1.4.11) calculado sobre lo pintado.
  const barContrast = (id: string): Promise<number> =>
    bar(id).evaluate((el) => {
      const rgb = (value: string): number[] =>
        (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number)
      const luminance = ([r = 0, g = 0, b = 0]: number[]): number => {
        const [R, G, B] = [r, g, b].map((c) => {
          const s = c / 255
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
        }) as [number, number, number]
        return 0.2126 * R + 0.7152 * G + 0.0722 * B
      }
      // La barra: su color pintado. El fondo: el token --background (#rrggbb).
      const fg = luminance(rgb(getComputedStyle(el).backgroundColor))
      const background = getComputedStyle(document.documentElement)
        .getPropertyValue('--background')
        .trim()
      const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(background) ?? []
      const bg = luminance(hex.slice(1, 4).map((part) => parseInt(part, 16)))
      const [hi, lo] = [fg, bg].sort((a, b) => b - a) as [number, number]
      return (hi + 0.05) / (lo + 0.05)
    })
  expect(await barContrast('P-101')).toBeGreaterThanOrEqual(3)
  expect(await barContrast('P-102')).toBeGreaterThanOrEqual(3)
  // Tooltip de la barra con el estado. El ratón se quita llevándolo, en pasos, a un punto
  // neutro del contenido: la esquina (0, 0) es la barra de título arrastrable.
  const away = (): Promise<void> => moveToNeutral(page)
  await hoverFresh(page, bar('P-102'))
  await expect(page.getByRole('tooltip')).toContainText('Cerrado')
  await away()
  await expect(page.getByRole('tooltip')).toHaveCount(0)

  // Afectados: el número de únicos y un tooltip con sus nombres.
  await expect(row('P-101').getByTestId('affected-count')).toHaveText('2')
  await expect(row('P-102').getByTestId('affected-count')).toHaveText('1')
  await hoverFresh(page, row('P-101').getByTestId('affected-count'))
  const tooltip = page.getByTestId('affected-tooltip')
  await expect(tooltip).toContainText('pagos')
  await expect(tooltip).toContainText('host-pagos-01')
  await away()

  // Fuera del grid: severidad, clúster, namespace, duración y los ids de las entidades.
  await expect(grid).not.toContainText('NUEVA_SEVERIDAD')
  await expect(grid).not.toContainText('cluster-norte')
  await expect(grid).not.toContainText('carrito-ns')
  await expect(grid).not.toContainText('(en curso)')
  await expect(grid).not.toContainText('SERVICE-AAA1')
})

test('grid con 300 filas: Fin, RePág e Inicio mueven el foco y hacen scroll hasta la fila', async () => {
  sim.many = true
  await goTo('problems')
  const rows = page.getByTestId('problem-row')
  await expect(rows.first()).toContainText('P-M')
  await expect(page.getByTestId('problems-grid')).toHaveAttribute('aria-rowcount', '301')

  await page.locator('[data-testid="problem-row"][data-index="0"]').focus()
  const active = (): Promise<{ index: number; rowindex: string | null }> =>
    page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null
      return {
        index: Number(el?.dataset['index']),
        rowindex: el?.getAttribute('aria-rowindex') ?? null
      }
    })

  // El foco se mueve después del scroll de la virtualización: se espera, no se lee al instante.
  await page.keyboard.press('End')
  await expect.poll(active).toEqual({ index: 299, rowindex: '301' })
  await expect(page.locator('[data-testid="problem-row"][data-index="299"]')).toBeInViewport()
  await page.keyboard.press('PageUp')
  await expect.poll(async () => (await active()).index).toBe(289)
  await page.keyboard.press('PageDown')
  await expect.poll(async () => (await active()).index).toBe(299)
  await page.keyboard.press('Home')
  await expect.poll(active).toEqual({ index: 0, rowindex: '2' })
  await expect(page.locator('[data-testid="problem-row"][data-index="0"]')).toBeInViewport()
  await page.keyboard.press('PageDown')
  await expect.poll(async () => (await active()).index).toBe(10)
  // Virtualizada: no están las 300 en el DOM.
  expect(await rows.count()).toBeLessThan(300)
})

test('clúster: filtro local, aviso y exportación filtrada (la columna ya no está en el grid)', async () => {
  const rows = page.getByTestId('problem-row')
  const row = (id: string): Locator => rows.filter({ hasText: id })
  await openProblems()

  // Filtro: una casilla por clúster de los datos cargados, ordenadas.
  await page.getByTestId('problems-filter-cluster').click()
  const options = page.getByTestId('cluster-option')
  await expect(options).toHaveCount(2)
  expect(await options.evaluateAll((els) => els.map((el) => el.getAttribute('value')))).toEqual([
    'cluster-norte',
    'cluster-sur'
  ])

  // Solo cluster-sur → P-103; el aviso dice que hay filtro y cuántos se cargaron.
  await page.locator('[data-testid="cluster-option"][value="cluster-sur"]').click()
  await page.keyboard.press('Escape')
  await expect(rows).toHaveCount(1)
  await expect(row('P-103')).toHaveCount(1)
  const notice = page.getByTestId('list-truncated')
  await expect(notice).toContainText('filtro de clúster')
  await expect(notice).toContainText('de 3')

  // La exportación sale filtrada.
  const lines = readFileSync(await exportTo('problems-table', 'export-csv'))
    .subarray(3)
    .toString('utf8')
    .split('\r\n')
    .filter((line) => line !== '')
  expect(lines).toHaveLength(2)
  expect(lines[1]).toContain('P-103')

  // El XLSX filtrado lo dice en Info, con su fila propia.
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(
    readFileSync(await exportTo('problems-table', 'export-xlsx')) as unknown as ArrayBuffer
  )
  const info: [string, unknown][] = []
  workbook.getWorksheet('Info')?.eachRow((r) => {
    info.push([String(r.getCell(1).value), r.getCell(2).value])
  })
  expect(info.filter(([label]) => label === 'Filtro de clúster')).toEqual([
    ['Filtro de clúster', 'cluster-sur']
  ])
  expect(workbook.getWorksheet('Datos')?.actualRowCount).toBe(2)

  // Con las dos marcadas (OR) salen P-101 y P-103; P-102 no tiene clúster.
  await page.getByTestId('problems-filter-cluster').click()
  await page.locator('[data-testid="cluster-option"][value="cluster-norte"]').click()
  await page.keyboard.press('Escape')
  await expect(rows).toHaveCount(2)
  await expect(row('P-102')).toHaveCount(0)

  // Sin filtro: vuelven las 3 y el aviso desaparece.
  await page.getByTestId('problems-filter-cluster').click()
  for (const name of ['cluster-norte', 'cluster-sur']) {
    await page.locator(`[data-testid="cluster-option"][value="${name}"]`).click()
  }
  await page.keyboard.press('Escape')
  await expect(rows).toHaveCount(3)
  await expect(notice).toHaveCount(0)
})

test('tabla de Problemas virtualizada con 300 problemas', async () => {
  sim.many = true
  await goTo('problems')
  const rows = page.getByTestId('problem-row')
  await expect(rows.first()).toContainText('P-M')

  const visible = async (): Promise<string[]> =>
    rows.evaluateAll((els) => els.map((el) => /P-M\d+/.exec(el.textContent ?? '')?.[0] ?? ''))
  const before = await visible()
  expect(before.length, 'filas en el DOM').toBeGreaterThan(0)
  expect(before.length, 'menos filas en el DOM que problemas').toBeLessThan(300)

  await page.getByTestId('problems-scroll').evaluate((el) => {
    el.scrollTop = el.scrollHeight
  })
  await expect.poll(async () => (await visible()).some((id) => !before.includes(id))).toBe(true)
  expect((await visible()).length).toBeLessThan(300)

  sim.many = false
  await page.getByTestId('module-refresh').click()
  await expect(rows).toHaveCount(3)
})

test('Problemas: filtros de estado y de texto', async () => {
  await openProblems()
  const rows = page.getByTestId('problem-row')
  await page.getByTestId('problems-filter-status').selectOption('open')
  await expect(rows).toHaveCount(2)
  await expect(page.getByTestId('problems-grid')).not.toContainText('P-102')

  await page.getByTestId('problems-filter-text').fill('pagos')
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('P-101')

  await page.getByTestId('problems-filter-text').fill('')
  await page.getByTestId('problems-filter-status').selectOption('all')
  await expect(rows).toHaveCount(3)
})

test('AUD-21: los filtros de Problemas se conservan al cambiar de sección', async () => {
  await openProblems()
  const rows = page.getByTestId('problem-row')
  await page.getByTestId('problems-filter-status').selectOption('open')
  await page.getByTestId('problems-filter-text').fill('pagos')
  await expect(rows).toHaveCount(1)

  await goTo('metrics')
  await expect(page).toHaveURL(/#\/metrics/)
  await goTo('problems')
  await expect(page.getByTestId('problems-filter-status')).toHaveValue('open')
  await expect(page.getByTestId('problems-filter-text')).toHaveValue('pagos')
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('P-101')

  await page.getByTestId('problems-filter-text').fill('')
  await page.getByTestId('problems-filter-status').selectOption('all')
  await expect(rows).toHaveCount(3)
})

test('AUD-21: los filtros de Problemas van por entorno', async () => {
  await openProblems()
  const status = page.getByTestId('problems-filter-status')
  const table = page.getByTestId('problems-grid')
  const switchTo = async (name: string): Promise<void> => {
    await page.getByTestId('env-selector').click()
    await page.getByRole('option', { name: `Cliente A › ${name}` }).click()
  }

  await status.selectOption('open')
  await expect(page.getByTestId('problem-row')).toHaveCount(2)

  // Desarrollo no hereda el «open» de Producción.
  await switchTo('Desarrollo')
  await expect(table).toContainText('P-900')
  await expect(status).toHaveValue('all')
  await expect(page.getByTestId('problems-filter-text')).toHaveValue('')

  // Al volver, Producción recupera el suyo.
  await switchTo('Producción')
  await expect(status).toHaveValue('open')
  await expect(page.getByTestId('problem-row')).toHaveCount(2)
  await expect(table).not.toContainText('P-900')

  await status.selectOption('all')
  await expect(page.getByTestId('problem-row')).toHaveCount(3)
})

test('AUD-10: guardar un secreto del entorno descarta sus datos y Problemas los vuelve a pedir', async () => {
  const rows = page.getByTestId('problem-row')
  await openProblems()
  const before = sim.problemsRequests

  // secrets:set desde Ajustes (la mutación del renderer, no IPC directo).
  await goTo('settings')
  await page
    .getByTestId('environment-row')
    .filter({ hasText: 'Producción' })
    .getByTestId('environment-edit')
    .click()
  const form = page.getByTestId('environment-form')
  await form.getByTestId('secret-input-classicToken').fill(TOKEN_A)
  await form.getByTestId('secret-save-classicToken').click()
  await expect(form.getByTestId('secret-status-classicToken')).toHaveText('Configurado')
  await form.getByTestId('form-cancel').click()
  await expect(form).toBeHidden()

  // Se retiene la respuesta: mientras llega, no se ven los problemas de antes.
  let release = (): void => undefined
  sim.problemsGate = new Promise<void>((resolve) => {
    release = resolve
  })
  try {
    await goTo('problems')
    await expect.poll(() => sim.problemsRequests).toBeGreaterThan(before)
    await expect(rows).toHaveCount(0)
    await expect(page.getByTestId('problems-grid')).not.toContainText('P-101')
  } finally {
    release()
    sim.problemsGate = null
  }
  await expect(rows).toHaveCount(3)
})

test('sin auto-refresco: ni volver a la vista, ni el foco, ni la reconexión piden datos; module-refresh sí', async () => {
  await openProblems()
  const before = sim.problemsRequests
  await goTo('metrics')
  await goTo('problems')
  await expect(page.getByTestId('problem-row')).toHaveCount(3)

  // Lo que dispararía un refresco automático (refetchOnWindowFocus, refetchOnReconnect).
  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'))
    window.dispatchEvent(new Event('visibilitychange'))
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('online'))
  })
  await page.evaluate(() => window.blur())
  // Sin page.bringToFront(): activaría la ventana y le quitaría el foco a quien usa el PC
  // (VIGIA_E2E). Los eventos de foco ya se simulan arriba.
  expect(
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isFocused())
  ).toBe(false)
  // Aserción negativa: no hay ninguna condición que esperar, solo un margen de tiempo.
  await page.waitForTimeout(1500)
  expect(sim.problemsRequests).toBe(before)

  await page.getByTestId('module-refresh').click()
  await expect.poll(() => sim.problemsRequests).toBeGreaterThan(before)
})

test('una lista truncada lo indica, con el total real de la API', async () => {
  await openProblems()
  await expect(page.getByTestId('list-truncated')).toHaveCount(0)
  sim.truncate = true
  await page.getByTestId('module-refresh').click()
  const notice = page.getByTestId('list-truncated')
  await expect(notice).toBeVisible()
  await expect(notice).toContainText('de 999')

  // Inicio: el KPI de problemas abiertos muestra el total de la API, no los que han llegado.
  await goTo('home')
  await page.getByTestId('module-refresh').click()
  await expect(page.getByTestId('kpi-open-problems')).toContainText('999')
  await goTo('problems')

  // Sin truncar, el aviso desaparece al refrescar.
  sim.truncate = false
  await page.getByTestId('module-refresh').click()
  await expect(page.getByTestId('list-truncated')).toHaveCount(0)
})

test('exporta problemas a CSV: BOM, ";", una fila por problema y fórmulas neutralizadas', async () => {
  await openProblems()
  const file = await exportTo('problems-table', 'export-csv')
  // Si en el mismo minuto ya se exportó otro (por ejemplo, el CSV filtrado del test del clúster), lleva -N.
  expect(file).toMatch(/Cliente_A_Producción_problems_\d{8}-\d{4}(-\d+)?\.csv$/)

  const buffer = readFileSync(file)
  expect([...buffer.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
  const lines = buffer
    .subarray(3)
    .toString('utf8')
    .split('\r\n')
    .filter((line) => line !== '')
  expect(lines).toHaveLength(1 + problemsA.length)
  expect(lines[0]).toContain(';')
  for (const p of problemsA) expect(buffer.toString('utf8')).toContain(p.displayId)
  expect(buffer.toString('utf8')).toContain(`'=HYPERLINK`)
  expect(buffer.toString('utf8')).not.toMatch(/(^|;|")=HYPERLINK/m)
})

test('CA5 (0005): exporta problemas a XLSX con sus hojas Datos e Info, a TXT alineado y a TXT con tabuladores, cada fichero leído ya escrito', async () => {
  await openProblems()
  const xlsx = await exportSaved('problems-table', 'export-xlsx')
  expect(xlsx).toMatch(/\.xlsx$/)
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(readFileSync(xlsx) as unknown as ArrayBuffer)
  const data = workbook.getWorksheet('Datos')
  const info = workbook.getWorksheet('Info')
  expect(data?.actualRowCount).toBe(1 + problemsA.length)
  const infoText: Record<string, unknown> = {}
  info?.eachRow((row) => {
    infoText[String(row.getCell(1).value)] = row.getCell(2).value
  })
  expect(infoText['Cliente']).toBe('Cliente A')
  expect(infoText['Entorno']).toBe('Producción')
  expect(infoText['Rango']).toBe('now-2h')
  expect(infoText['Desde']).toBeInstanceOf(Date)
  expect(infoText['Hasta']).toBeInstanceOf(Date)
  expect(String(infoText['Nota'])).toContain('Problemas abiertos: sin fin')
  const header = (data?.getRow(1).values as unknown[]).slice(1).map(String)
  expect(header).toHaveLength(17)
  // La fila de un problema abierto: fin vacío y duración en número.
  let openRow: unknown[] = []
  data?.eachRow((r, n) => {
    if (n > 1 && String(r.getCell(1).value) === 'P-101') openRow = (r.values as unknown[]).slice(1)
  })
  expect(String(openRow[11]), 'clusters antes de namespaces').toBe('cluster-norte')
  expect(openRow[14] ?? null, 'endTime vacío si está abierto').toBeNull()
  expect(typeof openRow[15], 'durationMinutes es número').toBe('number')
  expect(String(openRow[5]), 'afectadas unidas con " | "').toBe('pagos | host-pagos-01')
  expect(String(openRow[7])).toBe('SERVICE-AAA1 | HOST-AAA1')

  const txtFile = await exportSaved('problems-table', 'export-txt')
  expect(txtFile).toMatch(/\.txt$/)
  const txt = readFileSync(txtFile, 'utf8')
  expect(txt).toContain('P-101')
  expect(txt).not.toContain('\t')
  const tabsFile = await exportSaved('problems-table', 'export-txt-tabs')
  expect(tabsFile).toMatch(/\.txt$/)
  const tabs = readFileSync(tabsFile, 'utf8')
  expect(tabs.split(/\r?\n/)[0]).toContain('\t')
})

test('con la interfaz en inglés, el XLSX lleva las hojas y la Info en inglés', async () => {
  await goTo('settings')
  await page.getByTestId('language-en').click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await openProblems()

  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(
    readFileSync(await exportTo('problems-table', 'export-xlsx')) as unknown as ArrayBuffer
  )
  expect(workbook.worksheets.map((sheet) => sheet.name).sort()).toEqual(['Data', 'Info'])
  const info: Record<string, unknown> = {}
  workbook.getWorksheet('Info')?.eachRow((row) => {
    info[String(row.getCell(1).value)] = row.getCell(2).value
  })
  expect(info['Client']).toBe('Cliente A')
  expect(info['Environment']).toBe('Producción')
  expect(info['Cliente']).toBeUndefined()

  await goTo('settings')
  await page.getByTestId('language-es').click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'es')
})

test('con el separador "," en Ajustes, el CSV usa coma', async () => {
  await goTo('settings')
  await page.getByTestId('csv-separator-comma').click()
  await expect(page.getByTestId('csv-separator-comma')).toBeChecked()
  expect(await invoke('export:getSettings')).toMatchObject({ csvSeparator: ',' })

  await openProblems()
  const lines = readFileSync(await exportTo('problems-table', 'export-csv'))
    .subarray(3)
    .toString('utf8')
    .split('\r\n')
  expect(lines[0]).toContain(',')
  expect(lines[0]).not.toContain(';')

  await goTo('settings')
  await page.getByTestId('csv-separator-semicolon').click()
  expect(await invoke('export:getSettings')).toMatchObject({ csvSeparator: ';' })
})

test('AUD-08: elementos ilegibles y avisos de la API se ven en Problemas y en Inicio', async () => {
  await openProblems()
  await expect(page.getByTestId('api-warnings')).toHaveCount(0)

  sim.invalidOne = true
  sim.warnings = ['Aviso de prueba de la API']
  await page.getByTestId('module-refresh').click()
  const warnings = page.getByTestId('api-warnings')
  await expect(warnings).toBeVisible()
  await expect(warnings).toContainText('1 elemento')
  await expect(warnings).toContainText('Aviso de prueba de la API')
  // El problema ilegible no sale en la tabla; los demás sí.
  await expect(page.getByTestId('problem-row')).toHaveCount(3)
  await expect(page.getByTestId('problems-grid')).not.toContainText('P-ROTO')

  await goTo('home')
  await page.getByTestId('module-refresh').click()
  await expect(page.getByTestId('api-warnings').first()).toContainText('1 elemento')

  // El XLSX de Problemas lleva la fila «Elementos descartados» con 1, aparte de los avisos.
  await goTo('problems')
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(
    readFileSync(await exportTo('problems-table', 'export-xlsx')) as unknown as ArrayBuffer
  )
  const info: [string, unknown][] = []
  workbook.getWorksheet('Info')?.eachRow((r) => {
    info.push([String(r.getCell(1).value), r.getCell(2).value])
  })
  expect(info.filter(([label]) => label === 'Elementos descartados')).toEqual([
    ['Elementos descartados', 1]
  ])
  expect(info.filter(([label]) => label === 'Aviso').map(([, value]) => value)).toEqual([
    'Aviso de prueba de la API'
  ])

  // Sin elementos ilegibles ni avisos, al refrescar el aviso desaparece.
  sim.invalidOne = false
  sim.warnings = []
  await page.getByTestId('module-refresh').click()
  await expect(page.getByTestId('api-warnings')).toHaveCount(0)
})

test('BAD_REQUEST: un 400 se muestra como «La consulta no es válida» con el mensaje de la API', async () => {
  await openProblems()
  sim.badRequest = true
  await page.getByTestId('module-refresh').click()
  await expect(page.getByText('La consulta no es válida').first()).toBeVisible()
  await expect(page.getByText(/Selector mal formado en la prueba/).first()).toBeVisible()
  sim.badRequest = false
  await page.getByTestId('module-refresh').click()
  await expect(page.getByTestId('problem-row')).toHaveCount(3)
})

test('captura del gráfico al portapapeles', async () => {
  await openProblems()
  await expect(page.getByTestId('problems-timeline').locator('canvas').first()).toBeVisible()
  await app.evaluate(({ clipboard }) => (clipboard as unknown as ElectronClipboard).clear())
  expect(
    await app.evaluate(({ clipboard }) =>
      (clipboard as unknown as ElectronClipboard).has('image/png')
    )
  ).toBe(false)
  await exportMenu('problems-timeline').click()
  await page.getByTestId('capture-copy').click()
  await expect
    .poll(() =>
      app.evaluate(async ({ clipboard }) =>
        (await (clipboard as unknown as ElectronClipboard).read()).some((item) =>
          item.types.includes('image/png')
        )
      )
    )
    .toBe(true)
})

test('captura del gráfico a PNG: x2, fondo sólido y pie según Ajustes', async () => {
  await openProblems()
  await expect(page.getByTestId('problems-timeline').locator('canvas').first()).toBeVisible()
  const size = await canvasSize('problems-timeline')

  const withFooter = await pngInfo(await exportTo('problems-timeline', 'capture-save'))
  expect(withFooter.width).toBeGreaterThanOrEqual(2 * size.width)
  expect(withFooter.height).toBeGreaterThan(2 * size.height)
  expect(withFooter.cornerAlpha).toBe(255)

  await goTo('settings')
  await expect(page.getByTestId('capture-footer-on')).toBeChecked()
  await page.getByTestId('capture-footer-off').click()
  await goTo('problems')

  const file = await exportTo('problems-timeline', 'capture-save')
  expect(file).toMatch(/Cliente_A_Producción_problems_\d{8}-\d{4}.*\.png$/)
  // AUD-14: el aviso dice el nombre del fichero escrito (con su -N si lo hay), no «Guardado:» vacío.
  await expect(exportMenu('problems-timeline').locator('xpath=..').getByRole('status')).toHaveText(
    `Guardado: ${basename(file)}`
  )
  const withoutFooter = await pngInfo(file)
  expect(Math.abs(withoutFooter.height - 2 * size.height)).toBeLessThanOrEqual(1)
  expect(withoutFooter.cornerAlpha).toBe(255)

  await goTo('settings')
  await page.getByTestId('capture-footer-on').click()
})

test('capture:region rechaza un rectángulo que no cabe en la ventana', async () => {
  const result = await page.evaluate(() =>
    (
      window as unknown as { vigia: { invoke: (...args: unknown[]) => Promise<unknown> } }
    ).vigia.invoke('capture:region', {
      module: 'problems',
      rect: { x: 0, y: 0, width: 100_000, height: 100_000 },
      action: 'save'
    })
  )
  expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
})

test('Métricas: búsqueda, consulta con resolución y gráfico', async () => {
  await goTo('metrics')
  await page.getByTestId('metric-search').fill('cpu')
  const options = page.getByTestId('metric-search-results').getByRole('option')
  await expect(options).toHaveCount(2)
  await options.filter({ hasText: 'CPU usage' }).click()
  await expect(page.getByTestId('metric-selector')).toHaveValue('builtin:host.cpu.usage')

  await page.getByTestId('metric-resolution').selectOption('5m')
  await page.getByTestId('metric-run').click()
  await expect(page.getByTestId('metric-chart').locator('canvas').first()).toBeVisible()
  expect(sim.lastMetricsQuery.get('metricSelector')).toBe('builtin:host.cpu.usage')
  expect(sim.lastMetricsQuery.get('resolution')).toBe('5m')
})

test('AUD-13: resolución aplicada bajo el gráfico', async () => {
  await runMetric('builtin:host.cpu.usage', '5m')
  await expect(page.getByTestId('metric-resolution-applied')).toHaveText(/Resolución aplicada: 5m/)

  // Sin resolución, la que diga la API (el simulador responde 1m).
  await page.getByTestId('metric-resolution').selectOption('')
  await page.getByTestId('metric-run').click()
  await expect.poll(() => sim.lastMetricsQuery.has('resolution')).toBe(false)
  await expect(page.getByTestId('metric-resolution-applied')).toHaveText(/Resolución aplicada: 1m/)
})

test('AUD-13: aviso de puntos antes de consultar y resolución sugerida', async () => {
  await goTo('metrics')
  await page.getByTestId('metric-selector').fill('builtin:host.cpu.usage')
  const estimate = page.getByTestId('points-estimate')
  const resolution = page.getByTestId('metric-resolution')
  await page.getByTestId('time-range-7d').click()

  // Sin resolución (120 puntos) o Inf (1): sin aviso.
  for (const value of ['', 'Inf', '1h']) {
    await resolution.selectOption(value)
    await expect(estimate).toHaveCount(0)
  }

  // 1m en 7 días son 10 081 puntos por serie.
  await resolution.selectOption('1m')
  await expect(estimate).toBeVisible()
  await expect(estimate).toContainText(/10\D?081/)
  const use = page.getByTestId('use-resolution')
  await expect(use).toHaveText(/Usar 10m/)

  // No bloquea: con el aviso, la consulta sale igual con 1m.
  const before = sim.metricsQueries
  await page.getByTestId('metric-run').click()
  await expect.poll(() => sim.metricsQueries).toBeGreaterThan(before)
  expect(sim.lastMetricsQuery.get('resolution')).toBe('1m')
  expect(sim.lastMetricsQuery.get('from')).toBe('now-7d')

  // «Usar 10m» cambia la resolución y el aviso desaparece.
  await use.click()
  await expect(resolution).toHaveValue('10m')
  await expect(estimate).toHaveCount(0)

  // En 2 h, 1m son 121 puntos: sin aviso.
  await page.getByTestId('time-range-2h').click()
  await resolution.selectOption('1m')
  await expect(estimate).toHaveCount(0)
})

test('AUD-13 y CA8 (0006): recortes (ratio > 1) y warnings de la API bajo el gráfico; con ratios ≤ 1, ninguno', async () => {
  await goTo('metrics')
  await page.getByTestId('metric-selector').fill('builtin:host.cpu.usage')
  const warnings = page.getByTestId('api-warnings')
  // CA8 (0006): recortado es un ratio > 1 (pedido / máximo permitido).
  sim.metricRatios = { dataPointCountRatio: 1.5 }
  sim.metricWarnings = ['Aviso de métricas de la prueba']
  // Cada paso con una resolución nueva: una clave ya consultada sale de la caché sin petición.
  const resolution = page.getByTestId('metric-resolution')
  try {
    await resolution.selectOption('10m')
    await page.getByTestId('metric-run').click()
    await expect(warnings).toContainText(
      'builtin:host.cpu.usage: la API ha devuelto solo parte de los puntos'
    )
    await expect(warnings).toContainText('Aviso de métricas de la prueba')
    await expect(warnings).not.toContainText('dimensiones')

    sim.metricRatios = { dimensionCountRatio: 4 }
    sim.metricWarnings = []
    await resolution.selectOption('1h')
    await page.getByTestId('metric-run').click()
    await expect(warnings).toContainText('parte de las dimensiones')
    await expect(warnings).not.toContainText('parte de los puntos')

    // El XLSX lleva la resolución y los recortes como Aviso.
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(
      readFileSync(await exportTo('metric-chart', 'export-xlsx')) as unknown as ArrayBuffer
    )
    const info: [string, unknown][] = []
    workbook.getWorksheet('Info')?.eachRow((r) => {
      info.push([String(r.getCell(1).value), r.getCell(2).value])
    })
    expect(info.filter(([label]) => label === 'Resolución')).toEqual([['Resolución', '1h']])
    expect(
      info.filter(([label, value]) => label === 'Aviso' && String(value).includes('dimensiones'))
    ).toHaveLength(1)
  } finally {
    sim.metricRatios = {}
    sim.metricWarnings = []
  }
  // Una consulta sin recortes (ratios como los de vivo, muy por debajo de 1): solo queda la
  // resolución aplicada.
  sim.metricRatios = { dataPointCountRatio: 0.005, dimensionCountRatio: 0.005 }
  await resolution.selectOption('5m')
  await page.getByTestId('metric-run').click()
  await expect(page.getByText(/la API ha devuelto solo parte/)).toHaveCount(0)
  await expect(page.getByTestId('metric-resolution-applied')).toBeVisible()
})

test('AUD-13: el buscador elige con Enter sin lanzar la consulta, y dice «Sin resultados»', async () => {
  await goTo('metrics')
  const search = page.getByTestId('metric-search')
  const selector = page.getByTestId('metric-selector')
  await expect(search).toHaveAttribute('maxlength', '100')
  await selector.fill('otra.metrica')

  const before = sim.metricsQueries
  await search.fill('idle')
  const results = page.getByTestId('metric-search-result')
  await expect(results).toHaveCount(1)
  await search.press('Enter')
  await expect(selector).toHaveValue('builtin:host.cpu.idle')
  await expect(search).toHaveValue('')
  // Aserción negativa: un margen para que una consulta indebida llegara.
  await page.waitForTimeout(500)
  expect(sim.metricsQueries).toBe(before)

  // Un click en un resultado hace lo mismo.
  await search.fill('cpu')
  await expect(results).toHaveCount(2)
  await results.filter({ hasText: 'CPU usage' }).click()
  await expect(selector).toHaveValue('builtin:host.cpu.usage')
  await expect(search).toHaveValue('')
  expect(sim.metricsQueries).toBe(before)

  await search.fill('nada-que-casar')
  await expect(page.getByTestId('metric-search-empty')).toBeVisible()
  await expect(results).toHaveCount(0)
  await search.fill('')
})

test('AUD-13: con varias métricas, la leyenda lleva el metricId delante', async () => {
  await goTo('metrics')
  const chart = page.getByTestId('metric-chart')
  await page.getByTestId('metric-selector').fill('builtin:host.cpu.usage,builtin:host.cpu.idle')
  await page.getByTestId('metric-run').click()
  await expect
    .poll(async () => JSON.parse((await chart.getAttribute('data-series')) ?? '[]') as string[])
    .toEqual(['builtin:host.cpu.usage · HOST-AAA1', 'builtin:host.cpu.idle · HOST-AAA1'])

  // Con una sola, solo las dimensiones.
  await page.getByTestId('metric-selector').fill('builtin:host.cpu.usage')
  await page.getByTestId('metric-run').click()
  await expect
    .poll(async () => JSON.parse((await chart.getAttribute('data-series')) ?? '[]') as string[])
    .toEqual(['HOST-AAA1'])
})

test('CA3 (0005): i18n: cambiar de idioma con el gráfico de Métricas abierto lo rehace con el locale nuevo y la misma serie', async () => {
  await runMetric('builtin:host.cpu.usage', '5m')
  const chart = page.getByTestId('metric-chart')
  // El canvas sale al montar el gráfico, antes de que llegue la consulta: la serie se lee con
  // espera (toHaveAttribute reintenta), nunca con una lectura suelta tras runMetric.
  const SERIES = JSON.stringify(['HOST-AAA1'])
  await expect(chart).toHaveAttribute('data-series', SERIES)
  await expect(chart).toHaveAttribute('data-locale', 'ES')

  // Botón de idioma de la barra superior: la página no se desmonta.
  await page.getByRole('button', { name: es.topbar.language }).click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(chart).toHaveAttribute('data-locale', 'EN')
  await expect(chart.locator('canvas').first()).toBeVisible()
  await expect(chart).toHaveAttribute('data-series', SERIES)

  // Y de vuelta.
  await page.getByRole('button', { name: en.topbar.language }).click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'es')
  await expect(chart).toHaveAttribute('data-locale', 'ES')
  await expect(chart.locator('canvas').first()).toBeVisible()
  await expect(chart).toHaveAttribute('data-series', SERIES)
  // Los errores de consola los comprueba el afterEach.
})

test('AUD-13: guardar con un nombre repetido dice que ya existe; cancelar limpia', async () => {
  await goTo('metrics')
  await page.getByTestId('metric-selector').fill('builtin:host.cpu.usage')
  const dialogName = page.getByTestId('saved-query-name')
  await page.getByTestId('saved-query-save').click()
  await dialogName.fill('Consulta repetida')
  await page.getByTestId('form-save').click()
  const saved = page.getByTestId('saved-query').filter({ hasText: 'Consulta repetida' })
  await expect(saved).toHaveCount(1)

  await page.getByTestId('saved-query-save').click()
  await dialogName.fill('Consulta repetida')
  await page.getByTestId('form-save').click()
  await expect(page.getByText(es.errors.nameTaken)).toBeVisible()
  await expect(saved).toHaveCount(1)

  // Cancelar limpia el nombre y el error.
  await page.getByTestId('form-cancel').click()
  await expect(dialogName).toHaveCount(0)
  await page.getByTestId('saved-query-save').click()
  await expect(dialogName).toHaveValue('')
  await expect(page.getByText(es.errors.nameTaken)).toHaveCount(0)
  await page.getByTestId('form-cancel').click()

  await saved.getByTestId('saved-query-delete').click()
  const confirm = page.getByTestId('confirm-dialog')
  // Siempre pide confirmación (AUD-15: aserción fija, no condicional).
  await expect(confirm).toBeVisible()
  await expect(confirm).toHaveAttribute('role', 'alertdialog')
  await confirm.getByTestId('confirm-accept').click()
  await expect(confirm).toBeHidden()
  await expect(saved).toHaveCount(0)
})

test('Métricas: guardar, cargar desde la lista y desde Ctrl+K, y borrar una consulta', async () => {
  await goTo('metrics')
  await page.getByTestId('metric-selector').fill('builtin:host.cpu.usage')
  await page.getByTestId('saved-query-save').click()
  await page.getByTestId('saved-query-name').fill('CPU producción')
  await page.getByTestId('form-save').click()
  const saved = page.getByTestId('saved-query').filter({ hasText: 'CPU producción' })
  await expect(saved).toHaveCount(1)

  await page.getByTestId('metric-selector').fill('builtin:host.mem.usage')
  await saved.click()
  await expect(page.getByTestId('metric-selector')).toHaveValue('builtin:host.cpu.usage')

  await goTo('home')
  await page.keyboard.press('Control+K')
  const palette = page.getByTestId('command-palette')
  await expect(palette.getByRole('option', { name: /CPU producción/ })).toHaveCount(1)
  await page.keyboard.type('CPU producción')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/#\/metrics/)
  await expect(page.getByTestId('metric-selector')).toHaveValue('builtin:host.cpu.usage')

  await saved.getByTestId('saved-query-delete').click()
  const confirm = page.getByTestId('confirm-dialog')
  // Siempre pide confirmación (AUD-15: aserción fija, no condicional).
  await expect(confirm).toBeVisible()
  await expect(confirm).toHaveAttribute('role', 'alertdialog')
  await confirm.getByTestId('confirm-accept').click()
  await expect(confirm).toBeHidden()
  await expect(page.getByTestId('saved-query').filter({ hasText: 'CPU producción' })).toHaveCount(0)
})

test('Inicio: problemas abiertos, SLOs y salud de servicios', async () => {
  await goTo('home')
  await expect(page.getByTestId('kpi-open-problems')).toContainText('2')
  const slos = page.getByTestId('kpi-slos')
  await expect(slos).toContainText('Disponibilidad pagos')
  await expect(slos).toContainText('Latencia carrito')
  await expect(slos).toContainText(/99[.,]5/)
  const health = page.getByTestId('service-health')
  await expect(health).toContainText('pagos')
  await expect(health).toContainText('carrito')
  // Los servicios de problemas cerrados y las entidades que no son servicios no salen.
  await expect(health).not.toContainText('host-pagos-01')
})

test('CA4 (0005): Inicio: estado de cada SLO (con texto y color), sin evaluar, problemas relacionados con su plural y tooltip con el ratón y con el foco', async () => {
  await withContentSize(FIXED_WINDOW, async () => {
    await goTo('home')
    const card = page.getByTestId('kpi-slos')
    const item = (name: string): Locator => card.locator('li').filter({ hasText: name })
    const status = (name: string): Locator => item(name).getByTestId('slo-status')

    const expected = [
      ['Disponibilidad pagos', 'SUCCESS', 'text-muted-foreground'],
      ['Latencia carrito', 'FAILURE', 'text-danger'],
      ['Errores de login', 'WARNING', 'text-status-warning'],
      ['Búsqueda sin datos', 'UNEVALUATED', 'text-muted-foreground']
    ] as const
    for (const [name, value, cls] of expected) {
      await expect(status(name), name).toHaveAttribute('data-status', value)
      await expect(status(name), name).toHaveClass(new RegExp(`\\b${cls}\\b`))
      // El color nunca es la única señal: siempre hay texto.
      await expect(status(name), name).toHaveText(/\S/)
    }
    // WARNING no se pinta como FAILURE, ni con su color.
    await expect(status('Errores de login')).not.toHaveClass(/\btext-danger\b/)

    // Sin evaluar: «Sin evaluar», nunca «Correcto», y los valores con «—».
    await expect(status('Búsqueda sin datos')).toHaveText('Sin evaluar')
    await expect(item('Búsqueda sin datos')).not.toContainText('Correcto')
    await expect(item('Búsqueda sin datos')).toContainText('—')

    // Problemas abiertos relacionados: solo donde hay más de 0, con plural. Con -1 (Dynatrace
    // no pudo calcularlo, «Errores de login») o 0, nada.
    await expect(card.getByTestId('slo-related-problems')).toHaveCount(1)
    await expect(item('Errores de login').getByTestId('slo-related-problems')).toHaveCount(0)
    await expect(item('Errores de login')).not.toContainText('-1')
    const related = item('Latencia carrito').getByTestId('slo-related-problems')
    await expect(related).toHaveText('2 problemas abiertos')

    // Explica de dónde sale el número: tooltip con el ratón y con el foco.
    const hint = page.getByTestId('slo-related-problems-tooltip')
    const HINT = 'Lo calcula Dynatrace con el filtro de problemas del SLO'
    await expect(hint).toHaveCount(0)
    await hoverFresh(page, related)
    await expect(hint).toBeVisible()
    await expect(hint).toContainText(HINT)
    await moveToNeutral(page)
    await page.keyboard.press('Escape')
    await expect(hint).toHaveCount(0)
    await expect(related).toHaveAttribute('tabindex', '0')
    await related.focus()
    await expect(hint).toBeVisible()
    await expect(hint).toContainText(HINT)
    await page.keyboard.press('Escape')
    await expect(hint).toHaveCount(0)

    // La exportación lleva la columna numérica: vacía sin dato y también con -1 (no calculado),
    // y en ese caso una nota en Info que lo explica. Cada XLSX se lee ya escrito.
    const NOTE = 'Celdas vacías en «Problemas abiertos relacionados»: Dynatrace no pudo calcularlo'
    const exported = async (): Promise<{ values: Map<string, unknown>; info: string[] }> => {
      const workbook = new ExcelJS.Workbook()
      await workbook.xlsx.load(
        readFileSync(await exportSaved('kpi-slos', 'export-xlsx')) as unknown as ArrayBuffer
      )
      const sheet = workbook.getWorksheet('Datos')
      const header = (sheet?.getRow(1).values as unknown[]).slice(1).map(String)
      const column = header.indexOf('Problemas abiertos relacionados') + 1
      expect(column, `cabeceras: ${header.join(' | ')}`).toBeGreaterThan(0)
      const values = new Map<string, unknown>()
      sheet?.eachRow((row, n) => {
        if (n > 1) values.set(String(row.getCell(1).value), row.getCell(column).value)
      })
      const info: string[] = []
      workbook.getWorksheet('Info')?.eachRow((row) => {
        info.push(String(row.getCell(2).value ?? ''))
      })
      return { values, info }
    }

    const withFailed = await exported()
    expect(withFailed.values.get('Latencia carrito')).toBe(2)
    expect(withFailed.values.get('Disponibilidad pagos')).toBe(0)
    expect(withFailed.values.get('Errores de login') ?? null).toBeNull()
    expect(withFailed.values.get('Búsqueda sin datos') ?? null).toBeNull()
    expect(withFailed.info).toContain(NOTE)

    // Sin ningún -1, sin la nota.
    sim.sloRelatedFailed = false
    try {
      await page.getByTestId('module-refresh').click()
      await expect(card).toContainText('Errores de login')
      await expect.poll(async () => (await exported()).values.get('Errores de login')).toBe(0)
      expect((await exported()).info).not.toContain(NOTE)
    } finally {
      sim.sloRelatedFailed = true
    }
    await page.getByTestId('module-refresh').click()
  })
})

test('CA4 (0005): con la ventana más pequeña que permite la app, tras exportar los SLOs el aviso no tapa el menú y se puede volver a exportar', async () => {
  await withContentSize(SMALL_WINDOW, async () => {
    await goTo('home')
    await expect(page.getByTestId('kpi-slos')).toContainText('Errores de login')
    const first = await exportSaved('kpi-slos', 'export-xlsx')
    // El aviso «Guardado: …» ocupa sitio en la cabecera de la tarjeta: el menú sigue a la vista
    // y nada (la tarjeta de al lado) lo tapa.
    await expect(exportMenu('kpi-slos')).toBeVisible()
    await expect
      .poll(() => receivesClick(exportMenu('kpi-slos')), 'el menú recibe el clic')
      .toBe(true)
    const second = await exportSaved('kpi-slos', 'export-xlsx')
    expect(second).not.toBe(first)
  })
})

test('rango personalizado: valida las fechas y se usa en las peticiones', async () => {
  await openProblems()
  await page.getByTestId('time-range-custom').click()
  const popover = page.getByTestId('custom-range')
  await expect(popover).toBeVisible()

  // Desde posterior a hasta: no vale.
  await popover.getByTestId('custom-range-from').fill('2026-10-02T12:00')
  await popover.getByTestId('custom-range-to').fill('2026-10-02T10:00')
  await popover.getByTestId('form-save').click()
  await expect(popover).toBeVisible()
  await expect(popover.getByRole('alert')).toBeVisible()
  await expect(
    popover.locator('[data-testid^="custom-range-"][aria-invalid="true"]').first()
  ).toBeVisible()

  await popover.getByTestId('custom-range-to').fill('2026-10-02T14:00')
  await popover.getByTestId('form-save').click()
  await expect(popover).toBeHidden()
  await page.getByTestId('module-refresh').click()

  await expect.poll(() => sim.lastProblemsQuery.get('to')).not.toBeNull()
  const from = new Date(sim.lastProblemsQuery.get('from') ?? '').getTime()
  const to = new Date(sim.lastProblemsQuery.get('to') ?? '').getTime()
  expect(to - from).toBe(2 * HOUR)

  await page.getByTestId('time-range-2h').click()
  await page.getByTestId('module-refresh').click()
  await expect.poll(() => sim.lastProblemsQuery.get('from')).toBe('now-2h')
})

test('cambiar de entorno no mezcla datos', async () => {
  await openProblems()
  await page.getByTestId('env-selector').click()
  await page.getByRole('option', { name: 'Cliente A › Desarrollo' }).click()
  const table = page.getByTestId('problems-grid')
  await expect(table).toContainText('P-900')
  await expect(table).not.toContainText('P-101')

  await page.getByTestId('env-selector').click()
  await page.getByRole('option', { name: 'Cliente A › Producción' }).click()
  await expect(table).toContainText('P-101')
  await expect(table).not.toContainText('P-900')
})

test('un error de Dynatrace se muestra con el texto traducido del código', async () => {
  await activate('Prohibido')
  await goTo('problems')
  await expect(page.getByText(es.dtErrors.FORBIDDEN).first()).toBeVisible()
})

test('Métricas no disponible: sin metrics.read tras probar la conexión, o sin token clásico', async () => {
  await invoke('connection:test', { environmentId: env['Sin métricas'] })
  await activate('Sin métricas')
  await goTo('metrics')
  await expect(page.getByTestId('module-unavailable')).toContainText('metrics.read')
  await goTo('problems')
  await expect(page.getByTestId('module-unavailable')).toHaveCount(0)
  await expect(page.getByTestId('problem-row')).toHaveCount(3)

  await activate('Sin token')
  await goTo('metrics')
  await expect(page.getByTestId('module-unavailable')).toContainText(
    'Este módulo usa el token clásico'
  )
})

/** Ficha 0001: abre P-785 (descripciones en Markdown) por URL y espera sus 5 evidencias. */
async function openDescriptionProblem(): Promise<void> {
  await goToRoute(`/problems/${DESC_ID}`)
  await expect(page.getByTestId('problem-page-title')).toContainText('P-785')
  await expect(evidenceRows()).toHaveCount(5)
}

/** Fichas 0001 y 0002: las partes de la sección «Descripción» de un detalle desplegado. */
function descriptionParts(detail: Locator): {
  section: Locator
  copy: Locator
  status: Locator
  truncated: Locator
} {
  const section = detail.getByTestId('evidence-description')
  return {
    section,
    copy: section.getByTestId('evidence-description-copy'),
    status: section.getByTestId('evidence-description-copy-status'),
    truncated: detail.getByTestId('evidence-description-truncated')
  }
}

/** Ficha 0002: textos del conmutador que ya no existe (es y en), para comprobar que no está. */
const MODE_LABELS = [
  'Con formato',
  'Texto original',
  'Cómo se ve la descripción',
  'Formatted',
  'Original text',
  'How the description is shown'
]

/** Lee el portapapeles del sistema (desde main), con los saltos de línea normalizados. */
async function clipboardText(): Promise<string> {
  const text = await app.evaluate(({ clipboard }) =>
    (clipboard as unknown as { readText: () => Promise<string> | string }).readText()
  )
  // Windows puede devolver \r\n: el texto es el mismo.
  return text.replace(/\r\n/g, '\n')
}

async function clearClipboard(): Promise<void> {
  await app.evaluate(({ clipboard }) => (clipboard as unknown as ElectronClipboard).clear())
}

/** data-testid del elemento con el foco. */
const focusedTestId = (): Promise<string | null> =>
  page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? null)

test('CA6 (0001): al desplegar un evento con descripción, «Descripción» sale la primera y renderizada', async () => {
  await openDescriptionProblem()
  const detail = await expandRow('Descripción con formato')
  const { section } = descriptionParts(detail)
  await expect(section).toBeVisible()
  await expect(section).toContainText('Descripción')

  // La primera sección del detalle del evento.
  const order = await detail.evaluate((root) =>
    [...root.querySelectorAll('[data-testid]')]
      .map((element) => element.getAttribute('data-testid') ?? '')
      .filter((id) =>
        [
          'evidence-description',
          'evidence-properties',
          'evidence-zones',
          'evidence-all-tags',
          'evidence-metric-chart',
          'evidence-metric-too-long',
          'evidence-change'
        ].includes(id)
      )
  )
  expect(order[0]).toBe('evidence-description')
  expect(order).toContain('evidence-properties')

  // Los elementos renderizados, no los símbolos.
  await expect(section.locator('h1, h2, h3, h4, h5, h6')).toHaveText(['Uso de CPU alto'])
  await expect(section.locator('li')).toHaveText(['primer paso', 'segundo paso'])
  await expect(section.locator('strong')).toHaveText(['negrita'])
  await expect(section.locator('code')).toHaveText(['código'])
  await expect(section.locator('table')).toHaveCount(2)
  await expect(section.locator('table').nth(0).locator('th')).toHaveText(['Métrica', 'Valor'])
  await expect(section.locator('table').nth(0).locator('td')).toHaveText(['CPU', '97 %'])
  // Tabla compacta con alineación, y escapes que se ven sin la barra invertida.
  const compact = section.locator('table').nth(1)
  await expect(compact.locator('th')).toHaveText(['Host', 'Valor', 'Estado'])
  await expect(compact.locator('td')).toHaveText(['web', '9', 'alto (9)'])
  await expect(section).toContainText('Umbral superado en 9.5 puntos')
  const text = await section.innerText()
  expect(text).not.toContain('\\')
  expect(text).not.toContain('|:--|')
  expect(text).not.toContain('**')
  expect(text).not.toContain('`')
  expect(text).not.toMatch(/^\s*#/m)
  expect(text).not.toMatch(/^\s*- /m)
  expect(text).not.toContain('| --- |')

  // CA2 visto en la interfaz: la descripción iba después de la octava propiedad y ya no se
  // repite en la lista de propiedades.
  const keys = await detail.getByTestId('evidence-properties').locator('dt').allInnerTexts()
  expect(keys).not.toContain('dt.event.description')
  expect(keys).toContain('paso.0')
})

test('CA8 (0001) y CA2 (0002): «Copiar» copia el texto original exacto y avisa de que se ha copiado', async () => {
  // Va en views porque es el spec que guarda y restaura el portapapeles de quien usa el PC.
  // El renderer no tiene permiso de portapapeles: lo que llega al del sistema solo puede venir
  // de app:copyText.
  await openDescriptionProblem()
  const parts = descriptionParts(await expandRow('Descripción con formato'))
  await expect(parts.copy).toHaveText('Copiar')
  await expect(parts.status).toHaveCount(0)
  // Se ve con formato (ficha 0002: siempre) y se copia el Markdown, no lo que se ve.
  await expect(parts.section.locator('strong')).toHaveText(['negrita'])
  await clearClipboard()
  await parts.copy.click()
  await expect(parts.status).toHaveText(es.errorScreen.copied)
  expect(await clipboardText()).toBe(DESC_MD)

  // Otro evento copia el suyo.
  const other = descriptionParts(await expandRow('Otra con descripción'))
  await clearClipboard()
  await other.copy.click()
  await expect(other.status).toHaveText(es.errorScreen.copied)
  expect(await clipboardText()).toBe(DESC_SHORT_MD)
})

test('CA9 (0001) y CA3 (0002): con el teclado, Tab llega a «Copiar», Enter lo activa y Escape pliega', async () => {
  await openDescriptionProblem()
  const row = evidenceRow('Descripción con formato')
  await row.scrollIntoViewIfNeeded()
  await row.focus()
  await page.keyboard.press('Enter')
  await expect(row).toHaveAttribute('aria-expanded', 'true')
  const parts = descriptionParts(await detailOf(row))
  await expect(parts.copy).toBeVisible()

  // Tab desde la fila hasta «Copiar», sin pasar por ningún control de modo.
  const visited: (string | null)[] = []
  for (let i = 0; i < 25; i += 1) {
    const current = await focusedTestId()
    visited.push(current)
    if (current === 'evidence-description-copy') break
    await page.keyboard.press('Tab')
  }
  expect(await focusedTestId(), 'Tab hasta evidence-description-copy').toBe(
    'evidence-description-copy'
  )
  expect(visited.filter((id) => id?.startsWith('evidence-description-mode'))).toEqual([])

  // Enter copia sin plegar la fila.
  await clearClipboard()
  await page.keyboard.press('Enter')
  await expect(parts.status).toHaveText(es.errorScreen.copied)
  expect(await clipboardText()).toBe(DESC_MD)
  await expect(row).toHaveAttribute('aria-expanded', 'true')
  await expect(parts.section.locator('strong')).toHaveText(['negrita'])

  // Escape desde dentro del detalle: pliega y devuelve el foco a la fila.
  await page.keyboard.press('Escape')
  await expect(row).toHaveAttribute('aria-expanded', 'false')
  await expect(row).toBeFocused()
})

test('CA10 (0001): el HTML en crudo de la descripción se ve como texto y no crea img ni script', async () => {
  await openDescriptionProblem()
  const detail = await expandRow('Descripción con HTML')
  const { section } = descriptionParts(detail)
  await expect(section).toContainText('<img src=x onerror="window.__xssDesc=1">')
  await expect(section).toContainText('<script>window.__xssDesc=2</script>')
  await expect(section.locator('h1, h2, h3, h4, h5, h6')).toHaveText(['Aviso'])
  await expect(detail.locator('img, script, iframe')).toHaveCount(0)
  expect(
    await page.evaluate(() => (window as { __xssDesc?: unknown }).__xssDesc ?? null)
  ).toBeNull()
})

test('CA13 (0001): una descripción recortada lleva la nota de recorte; una entera, no', async () => {
  await openDescriptionProblem()
  const long = descriptionParts(await expandRow('Descripción recortada'))
  await expect(long.section).toContainText('Descripción larga')
  await expect(long.truncated).toBeVisible()
  await expect(long.truncated).not.toHaveText('')

  const whole = descriptionParts(await expandRow('Descripción con formato'))
  await expect(whole.section).toBeVisible()
  await expect(whole.truncated).toHaveCount(0)
})

test('CA14 (0001): un evento sin descripción no tiene la sección y el resto del detalle sigue igual', async () => {
  await openDescriptionProblem()
  const detail = await expandRow('Sin descripción')
  await expect(detail.getByTestId('evidence-description')).toHaveCount(0)
  await expect(detail.getByTestId('evidence-description-truncated')).toHaveCount(0)
  const properties = detail.getByTestId('evidence-properties')
  await expect(properties).toContainText('exit.code')
  await expect(properties).toContainText('137')
  await expect(detail.getByTestId('evidence-zones')).toContainText('Zona descripción')
  await expect(detail.getByTestId('evidence-all-tags')).toContainText('equipo:pagos')
  // El mini gráfico de su selector se pide y se pinta.
  await expect(detail.getByTestId('evidence-metric-chart')).toBeVisible()
  await expect(detail.getByTestId('evidence-metric').locator('canvas').first()).toBeVisible()
  await expect
    .poll(() => sim.eventMetricQueries.some((q) => q.get('metricSelector') === SEL_DESC))
    .toBe(true)
})

test('CA15 (0001): los textos nuevos de la sección también están en inglés', async () => {
  await page.getByRole('button', { name: es.topbar.language }).click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await openDescriptionProblem()
  const parts = descriptionParts(await expandRow('Descripción con formato'))
  await expect(parts.section).toBeVisible()
  const spanish: Record<string, string> = { copy: 'Copiar' }
  for (const [name, locator] of [['copy', parts.copy]] as const) {
    const label = (await locator.innerText()).trim()
    expect(label, name).not.toBe('')
    expect(label, name).not.toBe(spanish[name])
    // Ni una clave sin traducir (problems.algo.otra).
    expect(label, name).not.toMatch(/^[\w-]+(\.[\w-]+)+$/)
  }
  await parts.copy.click()
  await expect(parts.status).toHaveText(en.errorScreen.copied)
})

test('CA1 (0002): sin conmutador de modo; la descripción sale siempre renderizada', async () => {
  await openDescriptionProblem()
  for (const name of ['Descripción con formato', 'Otra con descripción']) {
    const detail = await expandRow(name)
    const { section } = descriptionParts(detail)
    await expect(section).toBeVisible()
    // Ningún control de modo: ni sus data-testid, ni un grupo o botón con sus textos.
    await expect(detail.locator('[data-testid^="evidence-description-mode"]')).toHaveCount(0)
    await expect(section.locator('[aria-pressed]')).toHaveCount(0)
    for (const label of MODE_LABELS) {
      await expect(section.getByRole('group', { name: label })).toHaveCount(0)
      await expect(section.getByRole('radiogroup', { name: label })).toHaveCount(0)
      await expect(section.getByRole('button', { name: label })).toHaveCount(0)
      await expect(section.getByRole('radio', { name: label })).toHaveCount(0)
      await expect(section.getByRole('tab', { name: label })).toHaveCount(0)
      await expect(section).not.toContainText(label)
    }
    // Solo queda «Copiar» como control de la sección.
    await expect(section.getByRole('button')).toHaveCount(1)
    await expect(section.getByRole('button')).toHaveText('Copiar')
  }

  // Renderizada: los elementos, no los símbolos de Markdown.
  const { section } = descriptionParts(await expandRow('Descripción con formato'))
  await expect(section.locator('h1, h2, h3, h4, h5, h6')).toHaveText(['Uso de CPU alto'])
  await expect(section.locator('li')).toHaveText(['primer paso', 'segundo paso'])
  await expect(section.locator('strong')).toHaveText(['negrita'])
  await expect(section.locator('code')).toHaveText(['código'])
  await expect(section.locator('table')).toHaveCount(2)
  const text = await section.innerText()
  expect(text).not.toContain('**')
  expect(text).not.toContain('`')
  expect(text).not.toMatch(/^\s*#/m)
  expect(text).not.toMatch(/^\s*- /m)
  expect(text).not.toContain('| --- |')
})

/**
 * Ficha 0003: página de análisis de la entidad. Problema ABIERTO (P-786) con cuatro evidencias:
 * un EVENT sobre un HOST (sin selector de métrica: desplegarlo no pide nada), un METRIC sobre un
 * SERVICE, un EVENT sin entidad y uno con entidad sin tipo. Solo tipos estándar.
 */
const ENT_ID = 'pd-entity'
const ENT_HOST_ID = 'HOST-AN1'
const ENT_HOST_NAME = 'host-analisis'
const ENT_HOST = { entityId: { id: ENT_HOST_ID, type: 'HOST' }, name: ENT_HOST_NAME }
const ENT_SERVICE = { entityId: { id: 'SERVICE-AN1', type: 'SERVICE' }, name: 'servicio-analisis' }
const ENT_EV_HOST = 'Evento en el host'
const ENT_EV_METRIC = 'Métrica del servicio'
const ENT_EV_NONE = 'Evento sin entidad'
const ENT_EV_NOTYPE = 'Entidad sin tipo'
const entityEvent = (
  name: string,
  index: number,
  entity: Record<string, unknown> | null
): Record<string, unknown> => ({
  evidenceType: 'EVENT',
  displayName: name,
  eventType: 'CUSTOM_ALERT',
  ...(entity === null ? {} : { entity }),
  startTime: NOW - (60 + index) * 60_000,
  endTime: -1,
  data: {
    eventId: `ent-${index}`,
    status: 'OPEN',
    endTime: -1,
    title: name,
    ...noFlags,
    properties: [{ key: 'paso', value: `valor-${index}` }]
  }
})
detailOnly.push({
  problemId: ENT_ID,
  displayId: 'P-786',
  title: 'Problema para analizar entidades',
  status: 'OPEN',
  severityLevel: 'AVAILABILITY',
  impactLevel: 'INFRASTRUCTURE',
  startTime: NOW - 2 * HOUR,
  endTime: -1,
  affectedEntities: [ENT_HOST],
  impactedEntities: [],
  managementZones: [],
  problemFilters: [],
  evidenceDetails: {
    totalCount: 4,
    details: [
      entityEvent(ENT_EV_HOST, 1, ENT_HOST),
      {
        evidenceType: 'METRIC',
        displayName: ENT_EV_METRIC,
        entity: ENT_SERVICE,
        startTime: NOW - 70 * 60_000,
        endTime: -1,
        metricId: 'builtin:service.response.time',
        unit: 'MicroSecond',
        valueBeforeChangePoint: 100_000,
        valueAfterChangePoint: 300_000
      },
      entityEvent(ENT_EV_NONE, 3, null),
      entityEvent(ENT_EV_NOTYPE, 4, { entityId: { id: 'HOST-AN2' }, name: 'sin-tipo' })
    ]
  }
})

/** Ficha 0003: abre P-786 por URL y espera sus 4 evidencias. */
async function openEntityProblem(): Promise<void> {
  await goToRoute(`/problems/${ENT_ID}`)
  await expect(page.getByTestId('problem-page-title')).toContainText('P-786')
  await expect(evidenceRows()).toHaveCount(4)
}

/** Ficha 0003: el botón «Analizar entidad» dentro del detalle desplegado de una evidencia. */
const analyzeButton = (detail: Locator): Locator => detail.getByTestId('evidence-analyze-entity')

/** Ficha 0003: peticiones al detalle (GET /problems/{id}) que ha recibido el simulador. */
const detailRequests = (): number =>
  sim.requests.filter((request) => /^GET \/api\/v2\/problems\/[^/]+$/.test(request)).length

/** Ficha 0003: espera a que el simulador deje de recibir peticiones y devuelve cuántas lleva. */
async function settledRequests(): Promise<number> {
  let last = -1
  await expect
    .poll(
      () => {
        const now = sim.requests.length
        const stable = now === last
        last = now
        return stable
      },
      { intervals: [400] }
    )
    .toBe(true)
  return sim.requests.length
}

test('CA1 (0003): «Analizar entidad» sale en las evidencias con entidad (EVENT y METRIC) y no en las que no tienen entidad o tipo', async () => {
  await openEntityProblem()
  for (const title of [ENT_EV_HOST, ENT_EV_METRIC]) {
    const button = analyzeButton(await expandRow(title))
    await expect(button, title).toBeVisible()
    await expect(button, title).toHaveText('Analizar entidad')
    await expect(button, title).toHaveRole('button')
  }
  for (const title of [ENT_EV_NONE, ENT_EV_NOTYPE]) {
    const detail = await expandRow(title)
    // El detalle sí se pinta (sus propiedades), pero sin el botón.
    await expect(detail.getByTestId('evidence-properties'), title).toBeVisible()
    await expect(analyzeButton(detail), title).toHaveCount(0)
    await expect(detail.getByText('Analizar entidad'), title).toHaveCount(0)
  }
})

test('CA2 (0003): «Analizar entidad» en una evidencia HOST lleva a #/entities/HOST/<id> con su página en construcción', async () => {
  await openEntityProblem()
  await analyzeButton(await expandRow(ENT_EV_HOST)).click()
  const hostPage = page.getByTestId('entity-page-host')
  await expect(hostPage).toBeVisible()
  expect(await currentRoute()).toBe(`/entities/HOST/${ENT_HOST_ID}`)
  await expect(page.getByTestId('problem-page')).toHaveCount(0)
  await expect(page.getByTestId('entity-page-generic')).toHaveCount(0)
  // Cabecera: el nombre como título y, debajo, el tipo y el id.
  await expect(hostPage.getByRole('heading', { level: 1 })).toHaveText(ENT_HOST_NAME)
  await expect(hostPage.getByTestId('entity-page-type')).toHaveText('Host')
  await expect(hostPage.getByTestId('entity-page-id')).toHaveText(ENT_HOST_ID)
  // Bloque «Página en construcción» con el faro.
  const construction = hostPage.getByTestId('entity-under-construction')
  await expect(construction).toBeVisible()
  await expect(construction).toContainText('Página en construcción')
  await expect(construction.getByTestId('lighthouse')).toBeVisible()
})

test('CA4 (0003): un tipo que no está en el registro (inventado o personalizado) va a la página genérica, nunca al 404', async () => {
  for (const type of ['TIPO_ESTANDAR_INVENTADO', 'algo:otro']) {
    const id = `ID-${type.length}`
    await goToRoute(`/entities/${encodeURIComponent(type)}/${encodeURIComponent(id)}`)
    const generic = page.getByTestId('entity-page-generic')
    await expect(generic, type).toBeVisible()
    await expect(generic.getByTestId('entity-page-type'), type).toHaveText(type)
    await expect(generic.getByTestId('entity-page-id'), type).toHaveText(id)
    await expect(generic.getByTestId('entity-under-construction'), type).toBeVisible()
    await expect(page.getByTestId('error-screen'), type).toHaveCount(0)
    // Ninguna página por tipo a la vez que la genérica.
    await expect(page.getByTestId('entity-page-host'), type).toHaveCount(0)
  }
})

test('CA6 (0003): «Volver» regresa al detalle del problema con la fila desplegada y sin volver a pedir el detalle', async () => {
  await openEntityProblem()
  await expandRow(ENT_EV_HOST)
  await settledRequests()
  const detailsBefore = detailRequests()
  await analyzeButton(await detailOf(evidenceRow(ENT_EV_HOST))).click()
  const hostPage = page.getByTestId('entity-page-host')
  await expect(hostPage).toBeVisible()

  await hostPage.getByTestId('entity-back').click()
  await expect(page.getByTestId('problem-page')).toBeVisible()
  expect(await currentRoute()).toBe(`/problems/${ENT_ID}`)
  await expect(evidenceRow(ENT_EV_HOST)).toHaveAttribute('aria-expanded', 'true')
  await expect(analyzeButton(await detailOf(evidenceRow(ENT_EV_HOST)))).toBeVisible()
  await settledRequests()
  expect(detailRequests(), 'peticiones nuevas del detalle').toBe(detailsBefore)
})

test('CA7 (0003): con la ruta abierta directamente, el título es el id y «Volver» lleva a Problemas', async () => {
  // Desde Inicio (resetState), sin pasar por el problema: sin estado de navegación.
  await goToRoute(`/entities/HOST/${ENT_HOST_ID}`)
  const hostPage = page.getByTestId('entity-page-host')
  await expect(hostPage).toBeVisible()
  await expect(hostPage.getByRole('heading', { level: 1 })).toHaveText(ENT_HOST_ID)
  await expect(hostPage.getByTestId('entity-page-type')).toHaveText('Host')
  await expect(hostPage.getByTestId('entity-page-id')).toHaveText(ENT_HOST_ID)

  // Volver atrás en el historial llevaría a Inicio: tiene que ir a Problemas.
  await hostPage.getByTestId('entity-back').click()
  await expect(page.getByTestId('problem-row')).toHaveCount(3)
  expect(await currentRoute()).toBe('/problems')
})

test('CA8 (0003): mientras está en la página de entidad, el simulador no recibe ninguna petición', async () => {
  await openEntityProblem()
  await expandRow(ENT_EV_HOST)
  const before = await settledRequests()
  await analyzeButton(await detailOf(evidenceRow(ENT_EV_HOST))).click()
  await expect(page.getByTestId('entity-page-host')).toBeVisible()
  // Un rato en la página (y lo que tarde en pintarse): nada sale hacia Dynatrace.
  await page.waitForTimeout(1500)
  expect(sim.requests.slice(before), 'peticiones en la página de entidad').toEqual([])

  // Y por URL, sin venir del problema (genérica y por tipo): tampoco.
  const direct = await settledRequests()
  await goToRoute(`/entities/${encodeURIComponent('algo:otro')}/ID-1`)
  await expect(page.getByTestId('entity-page-generic')).toBeVisible()
  await goToRoute('/entities/SERVICE/SERVICE-AN1')
  await expect(page.getByTestId('entity-page-service')).toBeVisible()
  await page.waitForTimeout(1500)
  expect(sim.requests.slice(direct), 'peticiones en la página por URL').toEqual([])
})

test('CA9 (0003): «Analizar entidad» y «Volver» se alcanzan con Tab y se activan con Enter; Escape sigue plegando la fila', async () => {
  await openEntityProblem()
  const row = evidenceRow(ENT_EV_HOST)
  await row.scrollIntoViewIfNeeded()
  await row.focus()
  await page.keyboard.press('Enter')
  await expect(row).toHaveAttribute('aria-expanded', 'true')

  /** Tab hasta el elemento con ese data-testid (como mucho 40 pasos). */
  async function tabTo(testId: string): Promise<void> {
    for (let i = 0; i < 40 && (await focusedTestId()) !== testId; i += 1) {
      await page.keyboard.press('Tab')
    }
    expect(await focusedTestId(), `Tab hasta ${testId}`).toBe(testId)
  }

  // Con el foco en el botón, Escape pliega la fila y devuelve el foco a la fila.
  await tabTo('evidence-analyze-entity')
  await page.keyboard.press('Escape')
  await expect(row).toHaveAttribute('aria-expanded', 'false')
  await expect(row).toBeFocused()

  // Enter despliega otra vez; Tab hasta el botón y Enter lo activa.
  await page.keyboard.press('Enter')
  await expect(row).toHaveAttribute('aria-expanded', 'true')
  await tabTo('evidence-analyze-entity')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('entity-page-host')).toBeVisible()

  // En la página de entidad: Tab hasta «Volver» y Enter vuelve al problema.
  await tabTo('entity-back')
  await expect(page.getByTestId('entity-back')).toContainText('Volver')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('problem-page')).toBeVisible()
  expect(await currentRoute()).toBe(`/problems/${ENT_ID}`)
  await expect(row).toHaveAttribute('aria-expanded', 'true')
})

test('CA6 (0007): entities:problemCounts por IPC con un id inventado: dos consultas con pageSize=1 y los recuentos del simulador', async () => {
  const counts = await invoke<{ open: number | null; closed: number | null }>(
    'entities:problemCounts',
    { environmentId: env['Producción'], entityId: COUNT_ENTITY_ID, timeRange: '2h' }
  )
  expect(counts).toEqual({ open: 2, closed: 3 })

  // Dos consultas, las dos con pageSize=1, el rango global y la entidad pedida.
  expect(sim.entityProblemQueries).toHaveLength(2)
  for (const query of sim.entityProblemQueries) {
    expect(query.get('pageSize')).toBe('1')
    expect(query.get('from')).toBe('now-2h')
    expect(query.get('problemSelector')).toContain(`affectedEntities("${COUNT_ENTITY_ID}")`)
  }
  expect(
    sim.entityProblemQueries
      .map((q) => /status\("(\w+)"\)/.exec(q.get('problemSelector') ?? '')?.[1])
      .sort()
  ).toEqual(['closed', 'open'])

  // Una entidad sin problemas da 0 y 0 (no null), también con rango absoluto.
  const empty = await invoke<{ open: number | null; closed: number | null }>(
    'entities:problemCounts',
    {
      environmentId: env['Producción'],
      entityId: COUNT_EMPTY_ID,
      timeRange: { from: new Date(NOW - 3 * HOUR).toISOString(), to: new Date(NOW).toISOString() }
    }
  )
  expect(empty).toEqual({ open: 0, closed: 0 })
  expect(sim.entityProblemQueries).toHaveLength(4)
  for (const query of sim.entityProblemQueries.slice(2)) {
    expect(query.get('from')).toBe(new Date(NOW - 3 * HOUR).toISOString())
    expect(query.get('to')).toBe(new Date(NOW).toISOString())
  }
})

test('CA7 (0006): entities:serviceMetrics por IPC con un id inventado: dos consultas, series en ms y totales', async () => {
  const data = await invoke<Record<string, unknown>>('entities:serviceMetrics', {
    environmentId: env['Producción'],
    entityId: SVC_ID,
    timeRange: '2h'
  })
  // Dos consultas al simulador, las dos con el rango global.
  expect(sim.serviceMetricQueries).toHaveLength(2)
  for (const query of sim.serviceMetricQueries) expect(query.get('from')).toBe('now-2h')

  const series = (values: (number | null)[]): { timestamps: number[]; values: unknown[] } => ({
    timestamps: SVC_TIMESTAMPS,
    values
  })
  expect(data).toMatchObject({
    resolution: '1m',
    series: {
      responseTime: {
        median: series([100, 120, null, 110]),
        p90: series([300, 320, null, 310]),
        p99: series([800, 900, null, 850])
      },
      requests: series([50, 40, null, 60]),
      errors: series([5, 0, null, 10]),
      ok: series([45, 40, null, 50]),
      errorRate: series([10, 0, null, 16.7])
    },
    // Recuentos: suma de la serie (no los marcadores del simulador); tasa = 15 / 150.
    totals: {
      requests: 150,
      errors: 15,
      ok: 135,
      errorRate: 10,
      responseTime: { median: 105, p90: 305, p99: 820 }
    },
    warnings: [],
    partial: []
  })
})

/**
 * Ficha 0008: marcadores de la página de un SERVICE. Tres servicios inventados (SVC_ID con
 * errores, SVC_BIG_ID sin errores y con miles de peticiones, SVC_EMPTY_ID sin datos) y sus
 * problemas para los recuentos (affectedEntities). Se llega a sus páginas desde «Analizar
 * entidad» de un problema solo del detalle (P-791) o por URL.
 *
 * Nombres que fijan estos tests: la fila `service-markers`; cada marcador `service-marker-<id>`
 * (ok, ko, error-rate, response-time, problems); dentro, el valor en `service-marker-value`
 * (ok, ko y tasa), `service-marker-median`, `-p90` y `-p99` (tiempos) y `service-marker-open` y
 * `-closed` (problemas). El color de error es la clase `text-danger`.
 */
function markerProblems(): FakeProblem[] {
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

const MK_PROBLEM_ID = 'pd-markers'
const MK_EV_ERRORS = 'Errores en el servicio'
const MK_EV_BIG = 'Servicio con mucho tráfico'
const MK_EV_EMPTY = 'Servicio sin datos'
const MK_EV_HOST = 'Evento en otro host'
detailOnly.push({
  problemId: MK_PROBLEM_ID,
  displayId: 'P-791',
  title: 'Problema para los marcadores de servicio',
  status: 'OPEN',
  severityLevel: 'ERROR',
  impactLevel: 'SERVICES',
  startTime: NOW - 2 * HOUR,
  endTime: -1,
  affectedEntities: [],
  impactedEntities: [],
  managementZones: [],
  problemFilters: [],
  evidenceDetails: {
    totalCount: 4,
    details: [
      entityEvent(MK_EV_ERRORS, 11, {
        entityId: { id: SVC_ID, type: 'SERVICE' },
        name: 'servicio-errores'
      }),
      entityEvent(MK_EV_BIG, 12, {
        entityId: { id: SVC_BIG_ID, type: 'SERVICE' },
        name: 'servicio-grande'
      }),
      entityEvent(MK_EV_EMPTY, 13, {
        entityId: { id: SVC_EMPTY_ID, type: 'SERVICE' },
        name: 'servicio-vacio'
      }),
      entityEvent(MK_EV_HOST, 14, {
        entityId: { id: 'HOST-00000000000E2E81', type: 'HOST' },
        name: 'host-marcadores'
      })
    ]
  }
})

const serviceMarker = (id: string): Locator => page.getByTestId(`service-marker-${id}`)
const METRIC_MARKERS = ['ok', 'ko', 'error-rate', 'response-time'] as const

/** Ficha 0008: el número suelto dentro del texto (no parte de otro número). */
const loneNumber = (value: string): RegExp =>
  new RegExp(`(^|[^\\d.,])${value.replace(/\./g, '\\.')}([^\\d.,]|$)`)

/** Ficha 0008: abre P-791 y «Analizar entidad» de la evidencia; espera la página del servicio. */
async function analyzeMarkersEvidence(title: string): Promise<Locator> {
  await goToRoute(`/problems/${MK_PROBLEM_ID}`)
  await expect(page.getByTestId('problem-page-title')).toContainText('P-791')
  await expect(evidenceRows()).toHaveCount(4)
  await analyzeButton(await expandRow(title)).click()
  const servicePage = page.getByTestId('entity-page-service')
  await expect(servicePage).toBeVisible()
  return servicePage
}

/** Ficha 0008: espera los valores de los marcadores de SVC_ID (con errores y 1 abierto). */
async function expectErrorServiceValues(): Promise<void> {
  await expect(serviceMarker('ok').getByTestId('service-marker-value')).toHaveText(/^135$/)
  await expect(serviceMarker('ko').getByTestId('service-marker-value')).toHaveText(/^15$/)
  await expect(serviceMarker('error-rate').getByTestId('service-marker-value')).toHaveText(
    /^10,0\s?%$/
  )
  const times = serviceMarker('response-time')
  await expect(times.getByTestId('service-marker-median')).toContainText(/105\sms/)
  await expect(times.getByTestId('service-marker-p90')).toContainText(/305\sms/)
  await expect(times.getByTestId('service-marker-p99')).toContainText(/820\sms/)
  const problems = serviceMarker('problems')
  await expect(problems.getByTestId('service-marker-open')).toHaveText(loneNumber('1'))
  await expect(problems.getByTestId('service-marker-closed')).toHaveText(loneNumber('2'))
}

test('CA1 (0008): desde «Analizar entidad», la página del SERVICE enseña los cinco marcadores con los valores del simulador ya formateados, sin «Página en construcción»', async () => {
  const servicePage = await analyzeMarkersEvidence(MK_EV_BIG)
  expect(await currentRoute()).toBe(`/entities/SERVICE/${SVC_BIG_ID}`)
  const row = servicePage.getByTestId('service-markers')
  await expect(row).toBeVisible()

  // Los cinco, con su nombre.
  const labels = [
    ['ok', 'Peticiones OK'],
    ['ko', 'Peticiones KO'],
    ['error-rate', 'Tasa de error'],
    ['response-time', 'Tiempo de respuesta'],
    ['problems', 'Problemas']
  ] as const
  for (const [id, label] of labels) {
    await expect(row.getByTestId(`service-marker-${id}`), id).toBeVisible()
    await expect(row.getByTestId(`service-marker-${id}`), id).toContainText(label)
  }

  // Valores: suma de la serie (45 000 peticiones, 0 errores), tasa con un decimal, tiempos en
  // ms o en s según el valor y los recuentos de problemas (0 abiertos, 3 cerrados).
  await expect(serviceMarker('ok').getByTestId('service-marker-value')).toHaveText(/^45\.000$/)
  await expect(serviceMarker('ko').getByTestId('service-marker-value')).toHaveText(/^0$/)
  await expect(serviceMarker('error-rate').getByTestId('service-marker-value')).toHaveText(
    /^0,0\s?%$/
  )
  const times = serviceMarker('response-time')
  await expect(times.getByTestId('service-marker-median')).toContainText(/850\sms/)
  await expect(times.getByTestId('service-marker-p90')).toContainText(/1,2\ss/)
  await expect(times.getByTestId('service-marker-p99')).toContainText(/2,5\ss/)
  const problems = serviceMarker('problems')
  await expect(problems.getByTestId('service-marker-open')).toHaveText(loneNumber('0'))
  await expect(problems.getByTestId('service-marker-closed')).toHaveText(loneNumber('3'))

  // Ni el bloque ni el texto de «Página en construcción».
  await expect(servicePage.getByTestId('entity-under-construction')).toHaveCount(0)
  await expect(servicePage).not.toContainText('Página en construcción')
})

test('CA3 (0008): con KO > 0 y problemas abiertos > 0 esos marcadores llevan la clase de error y texto; con 0, no', async () => {
  // SVC_ID: 15 KO y 1 problema abierto.
  await analyzeMarkersEvidence(MK_EV_ERRORS)
  await expectErrorServiceValues()
  for (const id of ['ko', 'problems']) {
    const danger = serviceMarker(id).locator('.text-danger')
    await expect(danger.first(), id).toBeVisible()
    // El color nunca es la única señal: lo que va en rojo lleva texto.
    await expect(danger.first(), id).toHaveText(/\S/)
  }
  await expect(serviceMarker('ko').getByTestId('service-marker-value')).toHaveClass(
    /\btext-danger\b/
  )
  await expect(serviceMarker('problems').getByTestId('service-marker-open')).toHaveClass(
    /\btext-danger\b/
  )
  // Los cerrados no van en rojo.
  await expect(serviceMarker('problems').getByTestId('service-marker-closed')).not.toHaveClass(
    /\btext-danger\b/
  )

  // SVC_BIG_ID: 0 KO y 0 abiertos (3 cerrados): ninguno de los dos lleva la clase.
  await page.getByTestId('entity-back').click()
  await expect(page.getByTestId('problem-page')).toBeVisible()
  await analyzeButton(await expandRow(MK_EV_BIG)).click()
  await expect(page.getByTestId('entity-page-service')).toBeVisible()
  await expect(serviceMarker('ko').getByTestId('service-marker-value')).toHaveText(/^0$/)
  await expect(serviceMarker('problems').getByTestId('service-marker-open')).toHaveText(
    loneNumber('0')
  )
  for (const id of ['ko', 'problems']) {
    await expect(serviceMarker(id).locator('.text-danger'), id).toHaveCount(0)
  }
})

test('CA4 (0008): cambiar el rango global vuelve a pedir los dos canales con el rango nuevo; volver a la página sin cambiar nada no pide; «Actualizar» sí', async () => {
  await goToRoute(`/entities/SERVICE/${SVC_ID}`)
  await expect(page.getByTestId('entity-page-service')).toBeVisible()
  await expectErrorServiceValues()
  await settledRequests()
  // Al entrar: una vez cada canal (2 consultas de métricas y 2 de problemas), con el rango global.
  expect(sim.serviceMetricQueries).toHaveLength(2)
  expect(sim.entityProblemQueries).toHaveLength(2)
  for (const query of [...sim.serviceMetricQueries, ...sim.entityProblemQueries]) {
    expect(query.get('from')).toBe('now-2h')
  }

  // Rango nuevo: los dos canales otra vez, con now-24h.
  await page.getByTestId('time-range-24h').click()
  await expect.poll(() => sim.serviceMetricQueries.length).toBe(4)
  await expect.poll(() => sim.entityProblemQueries.length).toBe(4)
  const afterRange = [...sim.serviceMetricQueries.slice(2), ...sim.entityProblemQueries.slice(2)]
  for (const query of afterRange) expect(query.get('from')).toBe('now-24h')
  await expectErrorServiceValues()
  await settledRequests()
  expect(sim.serviceMetricQueries).toHaveLength(4)
  expect(sim.entityProblemQueries).toHaveLength(4)

  // Fuera y vuelta, sin cambiar nada: ninguna petición nueva.
  await goTo('metrics')
  await expect(page.getByTestId('entity-page-service')).toHaveCount(0)
  const before = await settledRequests()
  await goToRoute(`/entities/SERVICE/${SVC_ID}`)
  await expect(page.getByTestId('entity-page-service')).toBeVisible()
  await expectErrorServiceValues()
  await page.waitForTimeout(1500)
  expect(sim.requests.slice(before), 'peticiones al volver a la página').toEqual([])
  expect(sim.serviceMetricQueries).toHaveLength(4)
  expect(sim.entityProblemQueries).toHaveLength(4)

  // «Actualizar», en la cabecera de la página: los dos canales, con el rango actual.
  await page.getByTestId('entity-page-service').getByTestId('module-refresh').click()
  await expect.poll(() => sim.serviceMetricQueries.length).toBe(6)
  await expect.poll(() => sim.entityProblemQueries.length).toBe(6)
  const afterRefresh = [...sim.serviceMetricQueries.slice(4), ...sim.entityProblemQueries.slice(4)]
  for (const query of afterRefresh) expect(query.get('from')).toBe('now-24h')
  await expectErrorServiceValues()
})

test('CA5 (0008): si falla el canal de métricas, sus marcadores enseñan el aviso con Reintentar y el de problemas sigue con su dato', async () => {
  sim.serviceMetricsFail = true
  await goToRoute(`/entities/SERVICE/${SVC_ID}`)
  await expect(page.getByTestId('entity-page-service')).toBeVisible()

  // El de problemas, con sus recuentos y sin aviso.
  const problems = serviceMarker('problems')
  await expect(problems.getByTestId('service-marker-open')).toHaveText(loneNumber('1'))
  await expect(problems.getByTestId('service-marker-closed')).toHaveText(loneNumber('2'))
  await expect(problems.getByRole('button', { name: 'Reintentar' })).toHaveCount(0)

  // Cada marcador de métricas, en su sitio, con el aviso y Reintentar y sin valor.
  for (const id of METRIC_MARKERS) {
    const marker = serviceMarker(id)
    await expect(marker, id).toBeVisible()
    await expect(marker.getByRole('button', { name: 'Reintentar' }), id).toBeVisible()
    await expect(marker.getByTestId('service-marker-value'), id).toHaveCount(0)
    await expect(marker.getByTestId('service-marker-median'), id).toHaveCount(0)
  }

  // Reintentar, con el canal ya bien: llegan los valores.
  sim.serviceMetricsFail = false
  await serviceMarker('ok').getByRole('button', { name: 'Reintentar' }).click()
  await expectErrorServiceValues()
  for (const id of METRIC_MARKERS) {
    await expect(serviceMarker(id).getByRole('button', { name: 'Reintentar' }), id).toHaveCount(0)
  }
})

test('CA5 (0008): si falla el canal de problemas, su marcador enseña el aviso con Reintentar y los de métricas siguen con su dato', async () => {
  sim.entityProblemsFail = true
  await goToRoute(`/entities/SERVICE/${SVC_ID}`)
  await expect(page.getByTestId('entity-page-service')).toBeVisible()

  // Los de métricas, con sus valores y sin aviso.
  await expect(serviceMarker('ok').getByTestId('service-marker-value')).toHaveText(/^135$/)
  await expect(serviceMarker('ko').getByTestId('service-marker-value')).toHaveText(/^15$/)
  await expect(serviceMarker('error-rate').getByTestId('service-marker-value')).toHaveText(
    /^10,0\s?%$/
  )
  await expect(serviceMarker('response-time').getByTestId('service-marker-median')).toContainText(
    /105\sms/
  )
  for (const id of METRIC_MARKERS) {
    await expect(serviceMarker(id).getByRole('button', { name: 'Reintentar' }), id).toHaveCount(0)
  }

  // El de problemas, en su sitio, con el aviso y Reintentar y sin recuentos.
  const problems = serviceMarker('problems')
  await expect(problems).toBeVisible()
  await expect(problems.getByRole('button', { name: 'Reintentar' })).toBeVisible()
  await expect(problems.getByTestId('service-marker-open')).toHaveCount(0)
  await expect(problems.getByTestId('service-marker-closed')).toHaveCount(0)

  sim.entityProblemsFail = false
  await problems.getByRole('button', { name: 'Reintentar' }).click()
  await expectErrorServiceValues()
  await expect(problems.getByRole('button', { name: 'Reintentar' })).toHaveCount(0)
})

test('CA6 (0008): un servicio sin datos enseña «—» en los marcadores de métricas, no 0', async () => {
  await analyzeMarkersEvidence(MK_EV_EMPTY)
  // Las consultas se han hecho y han vuelto (vacías).
  await expect.poll(() => sim.serviceMetricQueries.length).toBe(2)
  await expect.poll(() => sim.entityProblemQueries.length).toBe(2)

  for (const id of ['ok', 'ko', 'error-rate'] as const) {
    await expect(serviceMarker(id).getByTestId('service-marker-value'), id).toHaveText('—')
  }
  const times = serviceMarker('response-time')
  for (const id of ['median', 'p90', 'p99'] as const) {
    await expect(times.getByTestId(`service-marker-${id}`), id).toContainText('—')
  }
  for (const id of METRIC_MARKERS) {
    const marker = serviceMarker(id)
    await expect(marker, id).not.toContainText(/(^|[^\d.,])0([^\d.,]|$)/)
    await expect(marker.getByRole('button', { name: 'Reintentar' }), id).toHaveCount(0)
  }
  // Problemas: Dynatrace sí dice 0 y 0, y eso se enseña.
  const problems = serviceMarker('problems')
  await expect(problems.getByTestId('service-marker-open')).toHaveText(loneNumber('0'))
  await expect(problems.getByTestId('service-marker-closed')).toHaveText(loneNumber('0'))
})

test('CA7 (0008): las páginas de los otros tipos de entidad siguen en construcción, sin marcadores ni peticiones', async () => {
  // Desde «Analizar entidad» de una evidencia HOST del mismo problema.
  await goToRoute(`/problems/${MK_PROBLEM_ID}`)
  await expect(evidenceRows()).toHaveCount(4)
  await expandRow(MK_EV_HOST)
  const fromProblem = await settledRequests()
  await analyzeButton(await detailOf(evidenceRow(MK_EV_HOST))).click()
  const hostPage = page.getByTestId('entity-page-host')
  await expect(hostPage).toBeVisible()
  await expect(hostPage.getByTestId('entity-under-construction')).toContainText(
    'Página en construcción'
  )
  await expect(page.getByTestId('service-markers')).toHaveCount(0)
  await page.waitForTimeout(1000)
  expect(sim.requests.slice(fromProblem), 'peticiones en la página del host').toEqual([])

  // Por URL, el resto de tipos del registro y uno que no está (genérica).
  const others = [
    ['HOST', 'host'],
    ['PROCESS_GROUP_INSTANCE', 'process_group_instance'],
    ['PROCESS_GROUP', 'process_group'],
    ['SYNTHETIC_TEST', 'synthetic_test'],
    ['HTTP_CHECK', 'http_check'],
    ['APPLICATION', 'application'],
    ['CLOUD_APPLICATION', 'cloud_application'],
    ['ENVIRONMENT', 'environment'],
    ['TIPO_ESTANDAR_INVENTADO', 'generic']
  ] as const
  const before = await settledRequests()
  for (const [type, suffix] of others) {
    await goToRoute(`/entities/${type}/${type}-00000000000E2E82`)
    const entityPage = page.getByTestId(`entity-page-${suffix}`)
    await expect(entityPage, type).toBeVisible()
    await expect(entityPage.getByTestId('entity-under-construction'), type).toContainText(
      'Página en construcción'
    )
    await expect(page.getByTestId('service-markers'), type).toHaveCount(0)
    await expect(page.locator('[data-testid^="service-marker-"]'), type).toHaveCount(0)
  }
  await page.waitForTimeout(1000)
  expect(sim.requests.slice(before), 'peticiones en las otras páginas').toEqual([])
})

/**
 * Ficha 0009: los cuatro gráficos de la página de un SERVICE, bajo los marcadores, con los datos
 * de SVC_ID (resolución 1m; tiempos de 100 a 900 ms, peticiones, errores y tasa con un hueco en
 * el tercer punto).
 *
 * Nombres que fijan estos tests: la sección `service-charts`; cada gráfico en un
 * `service-chart-panel` con `data-kind` (response-time, activity, error-rate y errors, en ese
 * orden), con su título en un encabezado; dentro, el `Chart` con testid `service-chart-<kind>`
 * (con `data-series` y su `canvas`), que es también el `target` de su `ExportMenu`, y el botón
 * `service-chart-open` («Abrir en Métricas»).
 */
const CHART_KINDS = ['response-time', 'activity', 'error-rate', 'errors'] as const
type ChartKind = (typeof CHART_KINDS)[number]
const CHART_TITLES: Record<ChartKind, string> = {
  'response-time': 'Tiempo de respuesta',
  activity: 'Actividad',
  'error-rate': 'Tasa de error',
  errors: 'Errores'
}
/** Las series de cada gráfico, en su orden: [mediana, p90, p99], [OK, KO], [tasa] y [KO]. */
const CHART_SERIES: Record<ChartKind, RegExp[]> = {
  'response-time': [/mediana/i, /p90/i, /p99/i],
  activity: [/\bOK\b/, /\bKO\b/],
  'error-rate': [/tasa/i],
  errors: [/\bKO\b/]
}

const chartPanel = (kind: ChartKind): Locator =>
  page.locator(`[data-testid="service-chart-panel"][data-kind="${kind}"]`)
const chartPlot = (kind: ChartKind): Locator =>
  chartPanel(kind).getByTestId(`service-chart-${kind}`)

/** Ficha 0009: abre la página de SVC_ID por URL y espera la sección de gráficos. */
async function openServiceCharts(): Promise<Locator> {
  await goToRoute(`/entities/SERVICE/${SVC_ID}`)
  await expect(page.getByTestId('entity-page-service')).toBeVisible()
  const section = page.getByTestId('service-charts')
  await expect(section).toBeVisible()
  return section
}

/** Ficha 0009: espera a que el gráfico tenga sus series (se monta vacío mientras carga). */
async function chartSeries(kind: ChartKind): Promise<string[]> {
  const plot = chartPlot(kind)
  await expect(plot.locator('canvas').first()).toBeVisible()
  await expect(plot).toHaveAttribute('data-series', /\[.+\]/)
  return JSON.parse((await plot.getAttribute('data-series')) ?? '[]') as string[]
}

test('CA1 (0009): en la página de un SERVICE salen los cuatro gráficos en su orden, con su título, su canvas y sus series', async () => {
  const section = await openServiceCharts()
  await expect(section).toContainText('Métricas de peticiones')

  const panels = section.getByTestId('service-chart-panel')
  await expect(panels).toHaveCount(4)
  for (const [index, kind] of CHART_KINDS.entries()) {
    const panel = panels.nth(index)
    await expect(panel, `posición ${index + 1}`).toHaveAttribute('data-kind', kind)
    await expect(panel.getByRole('heading').first(), kind).toContainText(CHART_TITLES[kind])
    const series = await chartSeries(kind)
    expect(series, kind).toHaveLength(CHART_SERIES[kind].length)
    for (const [i, pattern] of CHART_SERIES[kind].entries()) {
      expect(series[i], `${kind}[${i}]`).toMatch(pattern)
    }
  }

  // Los cuatro gráficos y los marcadores comparten una sola llamada al canal (sus dos consultas).
  await settledRequests()
  expect(sim.serviceMetricQueries).toHaveLength(2)
})

test('CA5 (0009): «Abrir en Métricas» de cada gráfico abre Métricas con la consulta de ese gráfico y el rango que se ve', async () => {
  // Con el rango relativo (2 h): el que se ve, en fechas, hasta ahora.
  const openedAt = Date.now()
  await openServiceCharts()
  await chartSeries('response-time')
  let before = sim.metricsQueries
  await expect(chartPanel('response-time').getByTestId('service-chart-open')).toHaveText(
    'Abrir en Métricas'
  )
  await chartPanel('response-time').getByTestId('service-chart-open').click()
  await expect.poll(currentRoute).toBe('/metrics')
  await expect.poll(() => sim.metricsQueries).toBeGreaterThan(before)
  const relFrom = Date.parse(sim.lastMetricsQuery.get('from') ?? '')
  const relTo = Date.parse(sim.lastMetricsQuery.get('to') ?? '')
  expect(relTo).toBeGreaterThanOrEqual(openedAt - 1000)
  expect(relTo).toBeLessThanOrEqual(Date.now())
  expect(relTo - relFrom).toBe(2 * HOUR)

  // Con un rango personalizado: exactamente el del canal, para cada gráfico.
  await openServiceCharts()
  const queriesBefore = sim.serviceMetricQueries.length
  await page.getByTestId('time-range-custom').click()
  const popover = page.getByTestId('custom-range')
  await popover.getByTestId('custom-range-from').fill('2026-10-03T09:00')
  await popover.getByTestId('custom-range-to').fill('2026-10-03T13:00')
  await popover.getByTestId('form-save').click()
  await expect(popover).toBeHidden()
  await expect.poll(() => sim.serviceMetricQueries.length).toBeGreaterThan(queriesBefore)
  const channelQuery = sim.serviceMetricQueries.at(-1) as URLSearchParams
  const from = Date.parse(channelQuery.get('from') ?? '')
  const to = Date.parse(channelQuery.get('to') ?? '')
  // 09:00 y 13:00 en la zona del renderer, que es en la que la app lee lo escrito (ficha 0011:
  // el CI va en UTC y la VPS en Europe/Madrid).
  const zone = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)
  expect(from).toBe(wallTimeToEpoch('2026-10-03T09:00', zone))
  expect(to).toBe(wallTimeToEpoch('2026-10-03T13:00', zone))

  const expected: Record<ChartKind, { has: string[]; not: string[] }> = {
    'response-time': {
      has: ['builtin:service.response.server', ':median', ':percentile(90', ':percentile(99'],
      not: ['requestCount', 'errors.server']
    },
    activity: {
      has: ['builtin:service.requestCount.server', 'builtin:service.errors.server.count'],
      not: ['response.server', 'errors.server.rate']
    },
    'error-rate': {
      has: ['builtin:service.errors.server.rate'],
      not: ['requestCount', 'response.server', 'errors.server.count']
    },
    errors: {
      has: ['builtin:service.errors.server.count'],
      not: ['requestCount', 'response.server', 'errors.server.rate']
    }
  }
  for (const kind of CHART_KINDS) {
    await openServiceCharts()
    await chartSeries(kind)
    before = sim.metricsQueries
    await chartPanel(kind).getByTestId('service-chart-open').click()
    await expect.poll(currentRoute, kind).toBe('/metrics')
    await expect.poll(() => sim.metricsQueries, kind).toBeGreaterThan(before)
    // El rango que se ve.
    expect(Date.parse(sim.lastMetricsQuery.get('from') ?? ''), kind).toBe(from)
    expect(Date.parse(sim.lastMetricsQuery.get('to') ?? ''), kind).toBe(to)
    // La consulta de ese gráfico, con el id del servicio, en el formulario y en la petición.
    const selector = sim.lastMetricsQuery.get('metricSelector') ?? ''
    await expect(page.getByTestId('metric-selector'), kind).toHaveValue(selector)
    expect(selector, kind).toContain(SVC_ID)
    for (const part of expected[kind].has) expect(selector, `${kind}: ${part}`).toContain(part)
    for (const part of expected[kind].not) expect(selector, `${kind}: ${part}`).not.toContain(part)
  }
})

/**
 * Ficha 0009: ancho del contenido de la ventana fijado desde main (setContentSize), con el alto
 * de FIXED_WINDOW, y de vuelta a FIXED_WINDOW al final aunque el test falle (ficha 0021). Solo se espera al ancho: es lo
 * único de lo que dependen las columnas (withContentSize espera además al alto, con el margen
 * del redondeo de Windows al escalar).
 */
async function withContentWidth(width: number, body: () => Promise<void>): Promise<void> {
  await app.evaluate(
    ({ BrowserWindow }, wanted) => {
      const win = BrowserWindow.getAllWindows()[0]
      if (win === undefined) throw new Error('withContentWidth: no hay ventana')
      win.setContentSize(wanted.width, wanted.height)
    },
    { width, height: FIXED_WINDOW.height }
  )
  try {
    await expect.poll(async () => (await viewportSize()).width).toBe(width)
    await body()
  } finally {
    await app.evaluate(({ BrowserWindow }, back) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(back.width, back.height)
    }, FIXED_WINDOW)
    await expect.poll(async () => fitsContentSize(await viewportSize(), FIXED_WINDOW)).toBe(true)
  }
}

/** Ficha 0009: posición (redondeada) de cada gráfico, en su orden, cuando ya no se mueven. */
async function chartBoxes(): Promise<{ x: number; y: number }[]> {
  const boxes: { x: number; y: number }[] = []
  for (const kind of CHART_KINDS) {
    const box = await settledBox(chartPanel(kind))
    boxes.push({ x: Math.round(box.x), y: Math.round(box.y) })
  }
  return boxes
}

test('CA6 (0009): con la ventana estrecha (la mínima de la app, 960 de ancho), una columna; con la normal (1024), dos', async () => {
  await openServiceCharts()
  for (const kind of CHART_KINDS) await chartSeries(kind)

  await withContentWidth(SMALL_WINDOW.width, async () => {
    const [a, b, c, d] = await chartBoxes()
    // Una columna: todos a la misma x, uno debajo de otro.
    expect(b?.x, 'actividad bajo tiempos').toBe(a?.x)
    expect(c?.x).toBe(a?.x)
    expect(d?.x).toBe(a?.x)
    expect(b?.y ?? 0).toBeGreaterThan(a?.y ?? 0)
    expect(c?.y ?? 0).toBeGreaterThan(b?.y ?? 0)
    expect(d?.y ?? 0).toBeGreaterThan(c?.y ?? 0)
  })

  await withContentWidth(FIXED_WINDOW.width, async () => {
    const [a, b, c, d] = await chartBoxes()
    // Dos columnas: 1 y 2 en la primera fila, 3 y 4 en la segunda.
    expect(b?.y, 'actividad junto a tiempos').toBe(a?.y)
    expect(b?.x ?? 0).toBeGreaterThan(a?.x ?? 0)
    expect(c?.x).toBe(a?.x)
    expect(c?.y ?? 0).toBeGreaterThan(a?.y ?? 0)
    expect(d?.y).toBe(c?.y)
    expect(d?.x).toBe(b?.x)
  })
})

test('CA7 (0009): si el canal falla, los cuatro gráficos enseñan el aviso con Reintentar y los problemas de los marcadores siguen', async () => {
  sim.serviceMetricsFail = true
  await openServiceCharts()

  // El marcador de problemas, con sus recuentos y sin aviso.
  const problems = serviceMarker('problems')
  await expect(problems.getByTestId('service-marker-open')).toHaveText(loneNumber('1'))
  await expect(problems.getByTestId('service-marker-closed')).toHaveText(loneNumber('2'))
  await expect(problems.getByRole('button', { name: 'Reintentar' })).toHaveCount(0)

  // Cada gráfico, en su sitio, con su aviso (role=alert) y Reintentar, sin gráfico.
  for (const kind of CHART_KINDS) {
    const panel = chartPanel(kind)
    await expect(panel, kind).toBeVisible()
    await expect(panel.getByRole('alert').first(), kind).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Reintentar' }), kind).toBeVisible()
    await expect(panel.getByTestId(`service-chart-${kind}`), kind).toHaveCount(0)
  }

  // Reintentar, con el canal ya bien: llega el gráfico.
  sim.serviceMetricsFail = false
  await chartPanel('errors').getByRole('button', { name: 'Reintentar' }).click()
  expect(await chartSeries('errors')).toHaveLength(1)
  await expect(chartPanel('errors').getByRole('button', { name: 'Reintentar' })).toHaveCount(0)
})

test('CA8 (0009): la exportación XLSX de un gráfico trae sus series y la hoja Info con el rango', async () => {
  await openServiceCharts()
  await chartSeries('response-time')
  const file = await exportSaved('service-chart-response-time', 'export-xlsx')
  const book = new ExcelJS.Workbook()
  await book.xlsx.load(readFileSync(file) as unknown as ArrayBuffer)

  // Datos: los valores de mediana, p90 y p99 (en ms) y sus nombres; nada de las otras series.
  const data = book.getWorksheet('Datos')
  expect(data, 'hoja Datos').toBeDefined()
  const numbers: number[] = []
  const texts: string[] = []
  data?.eachRow((row) => {
    row.eachCell((cell) => {
      if (typeof cell.value === 'number') numbers.push(cell.value)
      else if (typeof cell.value === 'string') texts.push(cell.value)
    })
  })
  for (const value of [100, 120, 110, 300, 320, 310, 800, 900, 850]) {
    expect(numbers, `valor ${value}`).toContain(value)
  }
  for (const value of [45, 50, 60]) {
    expect(numbers, `no es de tiempos: ${value}`).not.toContain(value)
  }
  const allText = texts.join('\n')
  expect(allText).toMatch(/mediana/i)
  expect(allText).toMatch(/p90/i)
  expect(allText).toMatch(/p99/i)

  // Info: el rango global y sus fechas.
  const info: Record<string, unknown> = {}
  book.getWorksheet('Info')?.eachRow((row) => {
    info[String(row.getCell(1).value)] = row.getCell(2).value
  })
  expect(info['Rango']).toBe('now-2h')
  expect(info['Desde']).toBeInstanceOf(Date)
  expect(info['Hasta']).toBeInstanceOf(Date)
  const span = (info['Hasta'] as Date).getTime() - (info['Desde'] as Date).getTime()
  expect(span).toBe(2 * HOUR)
})

/**
 * Ficha 0010: franja de los problemas de la entidad sobre el gráfico «Tasa de error» (canal
 * entities:problems). SVC_BAND_ID tiene un problema abierto (P-E2E41, desde hace 30 min) y uno
 * cerrado (P-E2E42, de hace 100 a hace 70 min); SVC_QUIET_ID, ninguno.
 *
 * Nombres que fijan estos tests: la franja `service-problem-band`, dentro del panel de la tasa
 * de error; cada tramo `service-problem-segment`, con `data-problem-id` (el problemId) y
 * `data-status` (`open` o `closed`), enfocable y con su estado en el nombre accesible
 * («Abierto» o «Cerrado»); el tooltip de un tramo, `service-problem-tooltip`, con el id visible,
 * el título, el estado, la hora de inicio y la de fin (HH:MM) o «Activo». Con el canal caído, la
 * franja sigue, con su aviso (`role="alert"`) y «Reintentar».
 */
const problemBand = (): Locator => chartPanel('error-rate').getByTestId('service-problem-band')
const bandSegments = (): Locator => page.getByTestId('service-problem-segment')
const bandSegment = (problemId: string): Locator =>
  problemBand().locator(`[data-testid="service-problem-segment"][data-problem-id="${problemId}"]`)
const bandTooltip = (): Locator => page.getByTestId('service-problem-tooltip')

/** Ficha 0010: abre la página de un servicio por URL y espera el gráfico de la tasa de error. */
async function openBandService(id: string): Promise<void> {
  await goToRoute(`/entities/SERVICE/${id}`)
  await expect(page.getByTestId('entity-page-service')).toBeVisible()
  await chartSeries('error-rate')
}

/** Ficha 0010: hora y minutos (HH:MM) de un instante, en la zona del renderer. */
async function clockOf(time: number): Promise<string> {
  return page.evaluate(
    (t) => new Date(t).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }),
    time
  )
}

/** Ficha 0010: consultas hechas por los tres canales de la página del servicio. */
const serviceQueries = (): number[] => [
  sim.serviceMetricQueries.length,
  sim.entityProblemQueries.length,
  sim.entityProblemListQueries.length
]

test('CA4 (0010): en la página de un SERVICE con un problema abierto y uno cerrado salen dos tramos con su estado (atributo y texto) y el tooltip enseña id, título, estado, inicio y fin', async () => {
  await openBandService(SVC_BAND_ID)
  const band = problemBand()
  await expect(band).toBeVisible()
  await expect(bandSegments()).toHaveCount(2)

  // Una sola consulta de la lista, con la entidad, el rango, pageSize=100 y sort=-startTime.
  await settledRequests()
  expect(sim.entityProblemListQueries).toHaveLength(1)
  const query = sim.entityProblemListQueries[0] as URLSearchParams
  expect(query.get('problemSelector')).toBe(`affectedEntities("${SVC_BAND_ID}")`)
  expect(query.get('from')).toBe('now-2h')
  expect(query.get('pageSize')).toBe('100')
  expect(query.get('sort')).toBe('-startTime')

  // Estado en un atributo y en el texto (no solo el color).
  const open = bandSegment(BAND_OPEN.problemId)
  const closed = bandSegment(BAND_CLOSED.problemId)
  await expect(open).toHaveAttribute('data-status', 'open')
  await expect(closed).toHaveAttribute('data-status', 'closed')
  await expect(open).toHaveAccessibleName(/Abierto/)
  await expect(open).not.toHaveAccessibleName(/Cerrado/)
  await expect(closed).toHaveAccessibleName(/Cerrado/)
  await expect(closed).not.toHaveAccessibleName(/Abierto/)

  // Los dos dentro de la franja; el cerrado (más antiguo) a la izquierda del abierto.
  const bandBox = await settledBox(band)
  const openBox = await settledBox(open)
  const closedBox = await settledBox(closed)
  for (const [name, box] of [
    ['abierto', openBox],
    ['cerrado', closedBox]
  ] as const) {
    expect(box.x, name).toBeGreaterThanOrEqual(bandBox.x - 1)
    expect(box.x + box.width, name).toBeLessThanOrEqual(bandBox.x + bandBox.width + 1)
    expect(box.width, name).toBeGreaterThan(0)
  }
  expect(closedBox.x + closedBox.width).toBeLessThanOrEqual(openBox.x + 1)

  const times = bandTimes()
  // Tooltip con el ratón: el cerrado, con su inicio y su fin.
  await hoverFresh(page, closed)
  const tooltip = bandTooltip()
  await expect(tooltip).toBeVisible()
  for (const text of [
    BAND_CLOSED.displayId,
    BAND_CLOSED.title,
    'Cerrado',
    await clockOf(times.closed[0]),
    await clockOf(times.closed[1])
  ]) {
    await expect(tooltip, text).toContainText(text)
  }
  await expect(tooltip).not.toContainText('Activo')
  await expect(tooltip).not.toContainText(BAND_OPEN.displayId)
  await moveToNeutral(page)
  await expect(tooltip).toHaveCount(0)

  // Tooltip con el foco: el abierto, con su inicio y «Activo» como fin.
  await open.focus()
  await expect(tooltip).toBeVisible()
  for (const text of [
    BAND_OPEN.displayId,
    BAND_OPEN.title,
    'Abierto',
    await clockOf(times.open[0]),
    'Activo'
  ]) {
    await expect(tooltip, text).toContainText(text)
  }
  await expect(tooltip).not.toContainText(BAND_CLOSED.displayId)
  await open.blur()
  await expect(tooltip).toHaveCount(0)
})

test('CA5 (0010): pulsar un tramo (y Enter con el foco) abre el detalle de ese problema; «Volver» vuelve a la página del servicio sin pedir otra vez sus datos', async () => {
  await openBandService(SVC_BAND_ID)
  await expect(bandSegments()).toHaveCount(2)
  await settledRequests()
  const before = serviceQueries()
  // Al entrar: las dos consultas de métricas, las dos de recuentos y la de la lista.
  expect(before).toEqual([2, 2, 1])

  // Clic en el cerrado.
  await clickInPlace(bandSegment(BAND_CLOSED.problemId), { scroll: true })
  await expect(page.getByTestId('problem-page')).toBeVisible()
  await expect(page.getByTestId('problem-page-title')).toContainText(BAND_CLOSED.displayId)
  expect(await currentRoute()).toBe(`/problems/${BAND_CLOSED.problemId}`)

  await page.getByTestId('problem-back').click()
  await expect(page.getByTestId('entity-page-service')).toBeVisible()
  expect(await currentRoute()).toBe(`/entities/SERVICE/${SVC_BAND_ID}`)
  await expect(bandSegments()).toHaveCount(2)
  await settledRequests()
  expect(serviceQueries(), 'consultas del servicio tras volver (clic)').toEqual(before)

  // Enter con el foco en el abierto.
  await bandSegment(BAND_OPEN.problemId).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('problem-page')).toBeVisible()
  await expect(page.getByTestId('problem-page-title')).toContainText(BAND_OPEN.displayId)
  expect(await currentRoute()).toBe(`/problems/${BAND_OPEN.problemId}`)

  await page.getByTestId('problem-back').click()
  await expect(page.getByTestId('entity-page-service')).toBeVisible()
  expect(await currentRoute()).toBe(`/entities/SERVICE/${SVC_BAND_ID}`)
  await expect(bandSegments()).toHaveCount(2)
  await settledRequests()
  expect(serviceQueries(), 'consultas del servicio tras volver (Enter)').toEqual(before)
})

test('CA6 (0010): sin problemas en el rango no hay franja ni hueco sobre la tasa de error', async () => {
  await openBandService(SVC_QUIET_ID)
  await chartSeries('errors')
  // La lista se ha pedido y ha vuelto vacía.
  await expect.poll(() => sim.entityProblemListQueries.length).toBe(1)
  await settledRequests()
  await expect(page.getByTestId('service-problem-band')).toHaveCount(0)
  await expect(bandSegments()).toHaveCount(0)

  // Ni hueco: el gráfico de la tasa de error empieza a la misma altura dentro de su panel que
  // el de Errores (el de al lado, sin franja) y mide lo mismo.
  const placement = async (kind: ChartKind): Promise<{ top: number; height: number }> => {
    const panel = await settledBox(chartPanel(kind))
    const plot = await settledBox(chartPlot(kind))
    return { top: Math.round(plot.y - panel.y), height: Math.round(plot.height) }
  }
  expect(await placement('error-rate')).toEqual(await placement('errors'))
})

test('CA6 (0010): si el canal de la lista falla, la franja enseña el aviso con Reintentar y el gráfico de tasa de error sigue', async () => {
  sim.entityProblemListFail = true
  await openBandService(SVC_BAND_ID)

  // Aviso en la franja, con Reintentar, y ningún tramo.
  const band = problemBand()
  await expect(band).toBeVisible()
  await expect(band.getByRole('alert').first()).toBeVisible()
  await expect(band.getByRole('button', { name: 'Reintentar' })).toBeVisible()
  await expect(bandSegments()).toHaveCount(0)

  // El gráfico sigue, con su serie y sin aviso propio; los marcadores de problemas, también.
  expect(await chartSeries('error-rate')).toHaveLength(1)
  await expect(chartPanel('error-rate').getByRole('button', { name: 'Reintentar' })).toHaveCount(1)
  const problems = serviceMarker('problems')
  await expect(problems.getByTestId('service-marker-open')).toHaveText(loneNumber('1'))
  await expect(problems.getByTestId('service-marker-closed')).toHaveText(loneNumber('1'))

  // Reintentar, con el canal ya bien: llegan los dos tramos.
  sim.entityProblemListFail = false
  await band.getByRole('button', { name: 'Reintentar' }).click()
  await expect(bandSegments()).toHaveCount(2)
  await expect(problemBand().getByRole('button', { name: 'Reintentar' })).toHaveCount(0)
  await expect(problemBand().getByRole('alert')).toHaveCount(0)
  expect(sim.entityProblemListQueries).toHaveLength(2)
})

/**
 * Ficha 0013: la franja de problemas se ve entera. Lo que se mide de cada tramo: su caja, la del
 * icono (el `svg`) y la del texto que se ve (sus nodos de texto, con un Range). Un texto cuenta
 * como visible si su caja toca la del tramo; si la toca, tiene que caber entera en ella (un texto
 * cortado por el tramo es un recorte). Con zoom 1,5 (`setZoomFactor`, como el escalado al 150 %
 * de la VPS) y con la ventana del CI (pantalla de 1024×768: contenido de unos 1008×705).
 */
const CI_WINDOW = { width: 1008, height: 705 }

interface Rect {
  left: number
  top: number
  right: number
  bottom: number
}

interface SegmentFit {
  problemId: string
  segment: Rect
  icon: Rect | null
  /** Caja del texto que toca el tramo; null si no se ve ningún texto. */
  text: Rect | null
  band: Rect
  /** Ancho natural del id (todo su texto, se vea o no). */
  idWidth: number
  /** Sitio dentro del tramo: su ancho interior, sin borde ni relleno. */
  room: number
  /** Ancho que piden el icono y el id en una línea: relleno de la línea, icono, hueco e id. */
  needed: number
}

/** Ficha 0013: cajas de cada tramo de la franja, de su icono y de su texto visible. */
async function segmentFits(): Promise<SegmentFit[]> {
  return problemBand().evaluate((band) => {
    const rect = (r: DOMRect): Rect => ({
      left: r.left,
      top: r.top,
      right: r.right,
      bottom: r.bottom
    })
    const touches = (a: Rect, b: Rect): boolean =>
      a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
    return [...band.querySelectorAll<HTMLElement>('[data-testid="service-problem-segment"]')].map(
      (segment) => {
        const box = rect(segment.getBoundingClientRect())
        const svg = segment.querySelector('svg')
        const walker = document.createTreeWalker(segment, NodeFilter.SHOW_TEXT)
        let text: Rect | null = null
        let idWidth = 0
        for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
          if ((node.textContent ?? '').trim() === '') continue
          const range = document.createRange()
          range.selectNodeContents(node)
          const r = rect(range.getBoundingClientRect())
          idWidth += r.right - r.left
          if (node.parentElement?.checkVisibility({ visibilityProperty: true }) !== true) continue
          if (r.right - r.left === 0 || !touches(r, box)) continue
          text =
            text === null
              ? r
              : {
                  left: Math.min(text.left, r.left),
                  top: Math.min(text.top, r.top),
                  right: Math.max(text.right, r.right),
                  bottom: Math.max(text.bottom, r.bottom)
                }
        }
        const px = (value: string): number => Number.parseFloat(value) || 0
        const own = getComputedStyle(segment)
        const room = segment.clientWidth - px(own.paddingLeft) - px(own.paddingRight)
        const line = svg?.parentElement
        const lineStyle = line === null || line === undefined ? null : getComputedStyle(line)
        const needed =
          (svg === null ? 0 : svg.getBoundingClientRect().width) +
          idWidth +
          (lineStyle === null
            ? 0
            : px(lineStyle.paddingLeft) + px(lineStyle.paddingRight) + px(lineStyle.columnGap))
        return {
          problemId: segment.dataset['problemId'] ?? '',
          segment: box,
          icon: svg === null ? null : rect(svg.getBoundingClientRect()),
          text,
          band: rect(band.getBoundingClientRect()),
          idWidth,
          room,
          needed
        }
      }
    )
  })
}

/** Ficha 0013: `inner` dentro de `outer`, con medio px de margen por el redondeo. */
function expectInside(inner: Rect, outer: Rect, what: string): void {
  expect(inner.left, `${what} (izquierda)`).toBeGreaterThanOrEqual(outer.left - 0.5)
  expect(inner.right, `${what} (derecha)`).toBeLessThanOrEqual(outer.right + 0.5)
  expect(inner.top, `${what} (arriba)`).toBeGreaterThanOrEqual(outer.top - 0.5)
  expect(inner.bottom, `${what} (abajo)`).toBeLessThanOrEqual(outer.bottom + 0.5)
}

/** Ficha 0013: ejecuta `body` con el zoom de la página a `factor` y lo deja en 1 aunque falle. */
async function withZoom(factor: number, body: () => Promise<void>): Promise<void> {
  const dpr = (): Promise<number> => page.evaluate(() => window.devicePixelRatio)
  const base = await dpr()
  const setZoom = (value: number): Promise<void> =>
    app.evaluate(({ BrowserWindow }, z) => {
      BrowserWindow.getAllWindows()[0]?.webContents.setZoomFactor(z)
    }, value)
  await setZoom(factor)
  try {
    if (factor !== 1) await expect.poll(dpr).not.toBe(base)
    await nextFrames()
    await body()
  } finally {
    await setZoom(1)
    await nextFrames()
  }
}

/** Ficha 0013: cambia el rango de tiempo global y espera los tramos de la franja. */
async function bandRange(range: '2h' | '7d', segments: number): Promise<void> {
  await page.getByTestId(`time-range-${range}`).click()
  await expect(bandSegments()).toHaveCount(segments)
  await settledBox(problemBand())
}

/** Ficha 0013: comprueba que cada tramo, su icono y su texto visible se ven enteros. */
async function expectSegmentsWhole(label: string): Promise<SegmentFit[]> {
  await settledBox(problemBand())
  const fits = await segmentFits()
  expect(fits.length, label).toBeGreaterThan(0)
  for (const fit of fits) {
    const name = `${label} · ${fit.problemId}`
    expect(fit.icon, `${name}: icono`).not.toBeNull()
    expectInside(fit.icon as Rect, fit.segment, `${name}: icono dentro del tramo`)
    if (fit.text !== null) expectInside(fit.text, fit.segment, `${name}: texto dentro del tramo`)
    expectInside(fit.segment, fit.band, `${name}: tramo dentro de la franja`)
  }
  return fits
}

/**
 * Ficha 0013: la regla del id con el ancho real del tramo. Si caben el icono y el id en una
 * línea, se ven los dos y el id entero; si no, solo el icono, entero y centrado. Con menos de 1 px
 * de diferencia entre el sitio y lo que piden (redondeo), vale cualquiera de las dos, pero entera.
 * Devuelve lo que ha visto ('id' o 'icon'), o null si estaba en ese margen.
 */
function expectIdRule(fit: SegmentFit, label: string): 'id' | 'icon' | null {
  const name = `${label} · ${fit.problemId} (sitio ${fit.room.toFixed(1)} px, pide ${fit.needed.toFixed(1)} px)`
  expect(fit.idWidth, `${name}: el id tiene ancho`).toBeGreaterThan(0)
  const fits = fit.room >= fit.needed + 1
  const tight = fit.room <= fit.needed - 1
  if (fits) expect(fit.text, `${name}: cabe, así que enseña su id`).not.toBeNull()
  if (tight) expect(fit.text, `${name}: no cabe, así que no enseña texto`).toBeNull()
  if (fit.text !== null) {
    // El id entero, no un trozo (que esté dentro del tramo ya lo comprueba expectSegmentsWhole).
    expect(fit.text.right - fit.text.left, `${name}: el id se ve entero`).toBeGreaterThanOrEqual(
      fit.idWidth - 0.5
    )
  } else {
    const icon = fit.icon as Rect
    const centre = (a: number, b: number): number => (a + b) / 2
    expect(
      Math.abs(centre(icon.left, icon.right) - centre(fit.segment.left, fit.segment.right)),
      `${name}: icono centrado en horizontal`
    ).toBeLessThanOrEqual(1)
    expect(
      Math.abs(centre(icon.top, icon.bottom) - centre(fit.segment.top, fit.segment.bottom)),
      `${name}: icono centrado en vertical`
    ).toBeLessThanOrEqual(1)
  }
  if (!fits && !tight) return null
  return fit.text === null ? 'icon' : 'id'
}

/**
 * Ficha 0013: un id del largo real (P- y 8 cifras) en un tramo casi tan ancho como lo que pide
 * el id, pero sin sitio para él: solo el icono, centrado. La duración del problema se calcula con
 * lo medido (px por minuto y lo que pide el id, que depende de la fuente del equipo) para que el
 * sitio quede 3 px por debajo de lo que pide, con cualquier ventana y cualquier fuente. Que nunca
 * se vea medio id lo garantiza expectSegmentsWhole (el texto que se ve, entero dentro del tramo).
 */
async function expectLongIdCentred(): Promise<void> {
  await openBandService(SVC_LONG_ID)
  await bandRange('2h', 1)
  const [wide] = await expectSegmentsWhole(`id largo, ${sim.bandLongMinutes} min`)
  expect(wide, 'tramo del id largo').toBeDefined()
  const { segment, room, needed } = wide as SegmentFit
  const outer = segment.right - segment.left
  // El sitio buscado: 3 px menos de lo que pide el id (2 px por debajo del margen de redondeo de
  // expectIdRule); el borde se suma aparte.
  const target = needed - 3 + (outer - room)
  sim.bandLongMinutes = (target / outer) * sim.bandLongMinutes
  await reloadUi()
  await openBandService(SVC_LONG_ID)
  await expect(bandSegments()).toHaveCount(1)
  const label = `id largo, ${sim.bandLongMinutes.toFixed(1)} min`
  const [fit] = await expectSegmentsWhole(label)
  const narrow = fit as SegmentFit
  const where = `${label} (sitio ${narrow.room.toFixed(1)} px, pide ${narrow.needed.toFixed(1)} px)`
  expect(narrow.room, `${where}: el id no cabe`).toBeLessThanOrEqual(narrow.needed - 1)
  expect(expectIdRule(narrow, label)).toBe('icon')
}

test('CA1 (0013): con zoom 1 y 1,5, con la ventana que haya y con la del CI, el icono y el texto de cada tramo quedan dentro de su tramo, cada tramo dentro de la franja, y el id se ve entero si cabe o solo el icono centrado si no, también con un id del largo real', async () => {
  // Lo visto en los tramos de 2 h: con la ventana del CI salen los dos casos (zoom 1, una
  // columna y tramos anchos; zoom 1,5, tramos estrechos), así que el test prueba los dos.
  const seen = new Set<string>()
  const run = async (window: string): Promise<void> => {
    for (const zoom of [1, 1.5]) {
      await withZoom(zoom, async () => {
        // Rango de 2 h: anchos o estrechos según la ventana y el zoom; la regla, con su ancho.
        await openBandService(SVC_BAND_ID)
        await bandRange('2h', 2)
        const label = `${window}, zoom ${zoom}, 2 h`
        for (const fit of await expectSegmentsWhole(label)) {
          const shown = expectIdRule(fit, label)
          if (shown !== null) seen.add(shown)
        }
        // Tramos estrechos (7 días), también el pegado al final del rango.
        await openBandService(SVC_SHORT_ID)
        await bandRange('7d', 2)
        const short = `${window}, zoom ${zoom}, 7 días`
        for (const fit of await expectSegmentsWhole(short)) expectIdRule(fit, short)
        await bandRange('2h', 1)
      })
    }
  }
  try {
    await run('ventana actual')
    await withContentSize(CI_WINDOW, async () => {
      await run('ventana del CI')
      await expectLongIdCentred()
    })
  } finally {
    await page.getByTestId('time-range-2h').click()
  }
  expect([...seen].sort(), 'tramos de 2 h con id y tramos con solo el icono').toEqual([
    'icon',
    'id'
  ])
})

test('CA2 (0013): con zoom 1 y 1,5, la franja no se solapa con el canvas del gráfico de tasa de error', async () => {
  await openBandService(SVC_BAND_ID)
  for (const zoom of [1, 1.5]) {
    await withZoom(zoom, async () => {
      await expect(bandSegments()).toHaveCount(2)
      const band = await settledBox(problemBand())
      const canvas = await settledBox(chartPlot('error-rate').locator('canvas').first())
      const label = `zoom ${zoom}`
      // La franja acaba antes de que empiece el gráfico: no se mete en él.
      expect(
        band.y + band.height,
        `${label}: la franja acaba antes del canvas`
      ).toBeLessThanOrEqual(canvas.y + 0.5)
      // Y el gráfico no la tapa: en el centro de cada tramo está el propio tramo.
      for (const id of [BAND_OPEN.problemId, BAND_CLOSED.problemId]) {
        const segment = bandSegment(id)
        await segment.evaluate((element) => element.scrollIntoView({ block: 'center' }))
        await settledBox(segment)
        expect(await receivesClick(segment), `${label}: ${id} no está tapado`).toBe(true)
      }
    })
  }
})

test('CA3 (0013): un problema de pocos minutos en un rango de 7 días enseña su icono entero y centrado, sin texto, y su nombre accesible lleva el id', async () => {
  try {
    await openBandService(SVC_SHORT_ID)
    await bandRange('7d', 2)
    const fits = await expectSegmentsWhole('7 días')
    for (const ids of [BAND_SHORT, BAND_SHORT_END]) {
      const fit = fits.find((item) => item.problemId === ids.problemId)
      expect(fit, ids.problemId).toBeDefined()
      const { segment, icon, text } = fit as SegmentFit
      const name = ids.displayId
      // Sin texto visible en el tramo; el icono, entero y centrado.
      expect(text, `${name}: sin texto`).toBeNull()
      const iconRect = icon as Rect
      expect(iconRect.right - iconRect.left, `${name}: icono con ancho`).toBeGreaterThan(0)
      const centre = (a: number, b: number): number => (a + b) / 2
      expect(
        Math.abs(centre(iconRect.left, iconRect.right) - centre(segment.left, segment.right)),
        `${name}: icono centrado en horizontal`
      ).toBeLessThanOrEqual(1)
      expect(
        Math.abs(centre(iconRect.top, iconRect.bottom) - centre(segment.top, segment.bottom)),
        `${name}: icono centrado en vertical`
      ).toBeLessThanOrEqual(1)
      // El id sigue en el nombre accesible.
      await expect(bandSegment(ids.problemId), name).toHaveAccessibleName(new RegExp(name))
    }
  } finally {
    await page.getByTestId('time-range-2h').click()
  }
})

test('CA4 (0013): con la ventana del CI, donde la franja empieza fuera de la vista, los tramos de la 0010 siguen en su sitio, con tooltip, y el clic (trayéndolos a la vista) abre el problema', async () => {
  await withContentSize(CI_WINDOW, async (actual) => {
    await openBandService(SVC_BAND_ID)
    await expect(bandSegments()).toHaveCount(2)
    const closed = bandSegment(BAND_CLOSED.problemId)
    const open = bandSegment(BAND_OPEN.problemId)
    // Es la situación del CI: al abrir la página, el tramo está por debajo del borde visible.
    const start = await settledBox(closed)
    expect(start.y, 'el tramo empieza fuera de la vista').toBeGreaterThan(actual.height)

    // Estado y posición, como en la 0010: el cerrado (más antiguo) a la izquierda del abierto.
    await expect(closed).toHaveAttribute('data-status', 'closed')
    await expect(open).toHaveAttribute('data-status', 'open')
    const openBox = await settledBox(open)
    expect(start.x + start.width).toBeLessThanOrEqual(openBox.x + 1)

    // Tooltip con el foco, ya a la vista (Radix cierra el tooltip si su contenedor se desplaza, y
    // el foco desplaza para enseñar el tramo).
    await closed.evaluate((element) => element.scrollIntoView({ block: 'center' }))
    await settledBox(closed)
    await closed.focus()
    await expect(bandTooltip()).toContainText(BAND_CLOSED.displayId)
    await closed.blur()
    await expect(bandTooltip()).toHaveCount(0)

    // Clic donde está, tras traerlo a la vista: abre su detalle.
    await clickInPlace(closed, { scroll: true })
    await expect(page.getByTestId('problem-page')).toBeVisible()
    await expect(page.getByTestId('problem-page-title')).toContainText(BAND_CLOSED.displayId)
    expect(await currentRoute()).toBe(`/problems/${BAND_CLOSED.problemId}`)
    await page.getByTestId('problem-back').click()
    await expect(page.getByTestId('entity-page-service')).toBeVisible()
  })
})

/**
 * Ficha 0012: marcadores del servicio centrados. Se mide el contenido de verdad (un Range sobre
 * lo que hay dentro), no la caja del elemento: un título o un valor de bloque ocupan todo el ancho
 * de la tarjeta aunque su texto vaya a la izquierda.
 */
const CENTER_TOLERANCE_PX = 4

/** Centro horizontal (px) de lo que hay dentro de `inner` (un Range sobre su contenido). */
async function contentCenter(inner: Locator): Promise<number> {
  await expect(inner).toBeVisible()
  const content = await inner.evaluate((element) => {
    const range = document.createRange()
    range.selectNodeContents(element)
    const rect = range.getBoundingClientRect()
    return { left: rect.left, width: rect.width }
  })
  expect(content.width, 'el contenido tiene ancho').toBeGreaterThan(0)
  return content.left + content.width / 2
}

/** Distancia (px) entre el centro horizontal del contenido de `inner` y el de la tarjeta `card`. */
async function centerOffset(card: Locator, inner: Locator): Promise<number> {
  const cardBox = await card.boundingBox()
  if (cardBox === null) throw new Error('centerOffset: la tarjeta no tiene caja')
  return Math.abs((await contentCenter(inner)) - (cardBox.x + cardBox.width / 2))
}

/** Ficha 0012: el valor principal de cada marcador. */
function mainValue(id: string): Locator {
  const card = serviceMarker(id)
  if (id === 'response-time') return card.getByTestId('service-marker-median')
  // Problemas: el grupo de los dos recuentos.
  if (id === 'problems') return card.getByTestId('service-marker-open').locator('xpath=..')
  return card.getByTestId('service-marker-value')
}

const ALL_MARKERS = ['ok', 'ko', 'error-rate', 'response-time', 'problems'] as const

for (const size of [FIXED_WINDOW, SMALL_WINDOW]) {
  test(`CA2 (0012): en las cinco tarjetas, el título y el valor principal están centrados (${size.width}×${size.height})`, async () => {
    await withContentSize(size, async () => {
      await goToRoute(`/entities/SERVICE/${SVC_ID}`)
      await expect(page.getByTestId('entity-page-service')).toBeVisible()
      await expectErrorServiceValues()
      for (const id of ALL_MARKERS) {
        const card = serviceMarker(id)
        await card.scrollIntoViewIfNeeded()
        const title = card.getByRole('heading')
        expect(await centerOffset(card, title), `título de ${id}`).toBeLessThanOrEqual(
          CENTER_TOLERANCE_PX
        )
        expect(await centerOffset(card, mainValue(id)), `valor de ${id}`).toBeLessThanOrEqual(
          CENTER_TOLERANCE_PX
        )
      }
    })
  })

  test(`CA3 (0012): las filas secundarias (p90/p99 y abiertos/cerrados) también están centradas (${size.width}×${size.height})`, async () => {
    await withContentSize(size, async () => {
      await goToRoute(`/entities/SERVICE/${SVC_ID}`)
      await expect(page.getByTestId('entity-page-service')).toBeVisible()
      await expectErrorServiceValues()
      const times = serviceMarker('response-time')
      await times.scrollIntoViewIfNeeded()
      const percentiles = times.getByTestId('service-marker-p90').locator('xpath=..')
      expect(await centerOffset(times, percentiles), 'p90/p99').toBeLessThanOrEqual(
        CENTER_TOLERANCE_PX
      )
      const problems = serviceMarker('problems')
      await problems.scrollIntoViewIfNeeded()
      for (const id of ['service-marker-open', 'service-marker-closed']) {
        // Cada recuento, centrado en su columna: su número y su nombre, uno encima del otro.
        const count = problems.getByTestId(id)
        const number = await contentCenter(count.locator('span').nth(0))
        const label = await contentCenter(count.locator('span').nth(1))
        expect(Math.abs(number - label), id).toBeLessThanOrEqual(CENTER_TOLERANCE_PX)
      }
      const counts = problems.getByTestId('service-marker-open').locator('xpath=..')
      expect(await centerOffset(problems, counts), 'abiertos/cerrados').toBeLessThanOrEqual(
        CENTER_TOLERANCE_PX
      )
    })
  })
}

test('CA6 (0012): el marcador «Peticiones KO» con 9907 enseña «9.907»', async () => {
  await goToRoute(`/entities/SERVICE/${SVC_KO_THOUSANDS_ID}`)
  await expect(page.getByTestId('entity-page-service')).toBeVisible()
  await expect(serviceMarker('ko').getByTestId('service-marker-value')).toHaveText(/^9\.907$/)
  // El de OK, con 5 cifras, ya llevaba separador: 45.000 − 9.907 = 35.093.
  await expect(serviceMarker('ok').getByTestId('service-marker-value')).toHaveText(/^35\.093$/)
})
