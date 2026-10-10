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
import { MAX_DESCRIPTION_LENGTH } from '../src/shared/problem-evidence'

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
/** Ficha 0015: token con los scopes de siempre menos entities.read. */
const TOKEN_NO_ENTITIES = tok('SECRETOVISTASNOENTITIES')
/** Ficha 0042: token con los scopes de siempre menos events.read. */
const TOKEN_NO_EVENTS = tok('SECRETOVISTASNOEVENTS')
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
 * Ficha 0014: datos de una entidad (canal entities:get, GET /api/v2/entities/{id}) y nombres
 * de sus relaciones (canal entities:names, GET /api/v2/entities con entityId(...)). Datos
 * inventados con la forma de `Entity` y `EntitiesList` de la OpenAPI v2; solo tipos estándar.
 * Un id que no es ENTITY_INFO_ID da 404; en /entities solo vuelven los de ENTITY_NAMES.
 */
const ENTITY_INFO_ID = 'SERVICE-00000000000E2E14'
const ENTITY_INFO_FIRST_SEEN = Date.parse('2026-09-01T08:00:00.000Z')
const ENTITY_INFO_LAST_SEEN = Date.parse('2026-10-03T09:30:00.000Z')
const ENTITY_INFO_HOST = 'HOST-00000000000E2E15'
/** 55 servicios llamados: más de los 50 que se devuelven por relación. */
const ENTITY_INFO_CALLS = Array.from({ length: 55 }, (_, i) => ({
  id: `SERVICE-${(0xe2e100 + i).toString(16).toUpperCase().padStart(16, '0')}`,
  type: 'SERVICE'
}))
const ENTITY_NAMES: Record<string, string> = {
  [ENTITY_INFO_HOST]: 'servidor-e2e',
  'HOST-00000000000E2E16': 'servidor-e2e-2'
}
function entityInfoBody(): Record<string, unknown> {
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
const INFO_FULL_ID = 'SERVICE-00000000000E2E20'
const INFO_FEW_ID = 'SERVICE-00000000000E2E21'
const INFO_HOSTS = ['HOST-00000000000E2E22', 'HOST-00000000000E2E23']
const INFO_PGI = 'PROCESS_GROUP_INSTANCE-00000000000E2E24'
const INFO_PG = 'PROCESS_GROUP-00000000000E2E25'
const INFO_CALLER_NAMED = 'SERVICE-00000000000E2E26'
const INFO_CALLER_UNNAMED = 'SERVICE-00000000000E2E27'
const INFO_CALLER_APP = 'APPLICATION-00000000000E2E28'
const INFO_METHOD = 'SERVICE_METHOD-00000000000E2E29'
const INFO_CALLS = Array.from({ length: 55 }, (_, i) => ({
  id: `SERVICE-${(0xe2e200 + i).toString(16).toUpperCase().padStart(16, '0')}`,
  type: 'SERVICE'
}))
const INFO_FIRST_SEEN = Date.parse('2026-09-01T10:00:00.000Z')
const INFO_LAST_SEEN = Date.parse('2026-10-03T10:00:00.000Z')
const INFO_TAGS = Array.from({ length: 8 }, (_, i) => `etiqueta${i + 1}:valor${i + 1}`)
Object.assign(ENTITY_NAMES, {
  [INFO_HOSTS[0] ?? '']: 'host-info-1',
  [INFO_HOSTS[1] ?? '']: 'host-info-2',
  [INFO_PGI]: 'proceso-info',
  [INFO_PG]: 'grupo-info',
  [INFO_CALLER_NAMED]: 'llamante-info',
  [INFO_CALLER_APP]: 'web-info'
})
/** Propiedades internas de INFO_FULL_ID: solo en «Todas las propiedades». */
const INFO_INTERNAL = {
  agentTechnologyType: 'JAVA',
  'dt.security_context': 'contexto-interno-e2e',
  detectedName: 'nombre-detectado-e2e',
  matchedServiceDetectionV2Rules: ['regla-interna-e2e']
}
function infoFullBody(): Record<string, unknown> {
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
const INFO_FULL_PROPERTY_COUNT = Object.keys(
  (infoFullBody()['properties'] ?? {}) as Record<string, unknown>
).length
function infoFewBody(entityId: string): Record<string, unknown> {
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
const HOST_INFO_FULL_ID = 'HOST-00000000000E2E60'
const HOST_INFO_PGIS = [
  'PROCESS_GROUP_INSTANCE-00000000000E2E61',
  'PROCESS_GROUP_INSTANCE-00000000000E2E62'
]
const HOST_INFO_SERVICE_2 = 'SERVICE-00000000000E2E63'
const HOST_INFO_EC2 = 'EC2_INSTANCE-00000000000E2E64'
const HOST_INFO_GROUP = 'HOST_GROUP-00000000000E2E65'
const HOST_INFO_PG = 'PROCESS_GROUP-00000000000E2E66'
const HOST_INFO_DISK = 'DISK-00000000000E2E67'
const HOST_INFO_PEER = 'HOST-00000000000E2E68'
const HOST_INFO_FIRST_SEEN = Date.parse('2026-08-20T07:15:00.000Z')
const HOST_INFO_LAST_SEEN = Date.parse('2026-10-03T11:00:00.000Z')
const HOST_INFO_IPS = ['192.0.2.10', '192.0.2.11', '198.51.100.7', '2001:db8::10']
Object.assign(ENTITY_NAMES, {
  [HOST_INFO_PGIS[0] ?? '']: 'proceso-host-1',
  [HOST_INFO_PGIS[1] ?? '']: 'proceso-host-2',
  [INFO_FEW_ID]: 'info-pocas-e2e',
  [HOST_INFO_SERVICE_2]: 'servicio-host-e2e',
  [HOST_INFO_EC2]: 'instancia-e2e',
  [HOST_INFO_GROUP]: 'grupo-hosts-e2e'
})
/** Claves de HOST_INFO_FULL_ID que la ficha no nombra: solo en «Todas las propiedades». */
const HOST_INFO_OTHER = {
  detectedName: 'nombre-detectado-host-e2e',
  macAddresses: ['00-00-5E-00-53-01'],
  standalone: false,
  oneAgentCustomHostName: 'nombre-propio-host-e2e'
}
function hostInfoFullBody(): Record<string, unknown> {
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
const HOST_INFO_FULL_PROPERTY_COUNT = Object.keys(
  (hostInfoFullBody()['properties'] ?? {}) as Record<string, unknown>
).length
function hostInfoFewBody(entityId: string): Record<string, unknown> {
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
const MONITOR_INFO_APP = 'APPLICATION-00000000000E2EA0'
const MONITOR_INFO_HTTP_APP = 'APPLICATION-00000000000E2EA1'
const MONITOR_INFO_OTHER = 'ENVIRONMENT-00000000000E2EA2'
const MONITOR_INFO_LOCATIONS = [1, 2, 3, 4].map((n) => `SYNTHETIC_LOCATION-00000000000E2EB${n}`)
const MONITOR_INFO_STEPS = [1, 2, 3, 4, 5].map((n) => `SYNTHETIC_TEST_STEP-00000000000E2EC${n}`)
const MONITOR_INFO_REQUESTS = [1, 2].map((n) => `HTTP_CHECK_STEP-00000000000E2ED${n}`)
const MONITOR_INFO_FIRST_SEEN = Date.parse('2026-07-01T08:00:00.000Z')
const MONITOR_INFO_LAST_SEEN = Date.parse('2026-10-03T11:00:00.000Z')
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
const MONITOR_INFO_HIDDEN = {
  detectedName: 'nombre-detectado-monitor-e2e',
  syntheticScreenshotRegularUri: 'captura-normal-e2e',
  syntheticScreenshotRegularErrorUri: 'captura-error-e2e',
  syntheticScreenshotThumbnailUri: 'captura-mini-e2e',
  syntheticScreenshotThumbnailErrorUri: 'captura-mini-error-e2e'
}
function monitorInfoBrowserBody(): Record<string, unknown> {
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
const monitorInfoBrowserPropertyCount = (): number =>
  Object.keys((monitorInfoBrowserBody()['properties'] ?? {}) as Record<string, unknown>).length
function monitorInfoHttpBody(): Record<string, unknown> {
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
const PROCESS_INFO_HOST = 'HOST-00000000000E2E90'
const PROCESS_INFO_PG = 'PROCESS_GROUP-00000000000E2E91'
const PROCESS_INFO_SERVICE_2 = 'SERVICE-00000000000E2E92'
const PROCESS_INFO_CGI = 'CONTAINER_GROUP_INSTANCE-00000000000E2E93'
const PROCESS_INFO_FIRST_SEEN = Date.parse('2026-08-10T06:00:00.000Z')
const PROCESS_INFO_LAST_SEEN = Date.parse('2026-10-03T11:30:00.000Z')
/** Valores que no pueden salir en ningún sitio de la página. */
const PROCESS_INFO_SECRETS = {
  commandLineArgs: '-Dclave.bd=CLAVE-LINEA-E2E --token TOKEN-LINEA-E2E -Xmx768m',
  exePath: '/home/usuario-e2e-0029/apps/bin/pagos-worker-e2e'
}
const PROCESS_INFO_SECRET_PARTS = [
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
function processInfoBody(): Record<string, unknown> {
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
const TAGS_ID = 'SERVICE-00000000000E2F37'
const TAGS_MANY_ID = 'SERVICE-00000000000E2F38'
/**
 * Ficha 0049: servicio inventado para la cápsula de etiquetas: dos etiquetas con la misma clave
 * (`equipo`), una con otra clave y valor (`zona`) y una de solo clave (`critico`).
 */
const TAGS_CAPSULE_ID = 'SERVICE-00000000000E2F49'
const TAGS_SORTED_KEYS = ['app', 'critico', 'equipo', 'nombre', 'zona']
const TAGS_MANY_KEYS = Array.from(
  { length: 40 },
  (_, i) => `etiqueta-larga-${String(i + 1).padStart(2, '0')}`
)
function tagsBody(entityId: string, tags: Record<string, unknown>[]): Record<string, unknown> {
  return { ...infoFewBody(entityId), displayName: 'etiquetas-e2e', tags }
}
function tagsMixedBody(): Record<string, unknown> {
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
function tagsCapsuleBody(): Record<string, unknown> {
  return tagsBody(TAGS_CAPSULE_ID, [
    { context: 'CONTEXTLESS', key: 'equipo', value: 'pagos', stringRepresentation: 'equipo:pagos' },
    { context: 'CONTEXTLESS', key: 'zona', value: 'norte', stringRepresentation: 'zona:norte' },
    { context: 'CONTEXTLESS', key: 'critico', stringRepresentation: 'critico' },
    { context: 'CONTEXTLESS', key: 'equipo', value: 'web', stringRepresentation: 'equipo:web' }
  ])
}
function tagsManyBody(): Record<string, unknown> {
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
function diskInfoBody(): Record<string, unknown> {
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
function entityBodies(): Record<string, Record<string, unknown>> {
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
/**
 * Ficha 0048: servicio con una caída de la disponibilidad por debajo del 90 %: por punto, 96 %,
 * 100 %, hueco y 66,7 %; en el rango, 128 de 150 peticiones sin error (85,3 %).
 */
const SVC_SLO_ID = 'SERVICE-0000000000E2E048'
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
const SVC_UNIFIED_KEYS = {
  time: 'builtin:service.request.response_time_service_aggregation',
  errors: 'builtin:service.request.failure_count_service_aggregation',
  requests: 'builtin:service.request.count_service_aggregation'
}
type SvcSet = 'server' | 'client' | 'unified' | 'activity'
const SVC_SET_IDS: Record<SvcSet, string> = {
  server: 'SERVICE-00000000000E2E46',
  client: 'SERVICE-00000000000E2E47',
  unified: 'SERVICE-00000000000E2E48',
  activity: 'SERVICE-00000000000E2E49'
}
/** serviceType y propiedades de cada uno (solo tipos estándar; valores inventados). */
const SVC_SET_ENTITY: Record<SvcSet, { serviceType: string; properties: Record<string, string> }> =
  {
    server: { serviceType: 'WEB_REQUEST_SERVICE', properties: { webServerName: 'web-e2e' } },
    client: { serviceType: 'RPC_SERVICE', properties: { remoteServiceName: 'remoto-e2e' } },
    unified: { serviceType: 'UNIFIED', properties: {} },
    activity: { serviceType: 'QUEUE_LISTENER_SERVICE', properties: {} }
  }
/**
 * Ficha 0047: un DATABASE_SERVICE (Cliente) para la página, con los datos del de Cliente. Va
 * aparte de `SVC_SET_IDS` para no cambiar el recorrido de los cuatro conjuntos de la 0046.
 */
const SVC_DB_ID = 'SERVICE-00000000000E2E4A'
type SvcSetKind = SvcKind | 'count'
const SVC_SET_DATA: Record<
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
function serviceTypeBodies(): Record<string, Record<string, unknown>> {
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

const HOST_BAND_OPEN = {
  problemId: 'pd-host-band-open',
  displayId: 'P-E2E51',
  title: 'CPU saturada en el host'
}
const HOST_BAND_CLOSED = {
  problemId: 'pd-host-band-closed',
  displayId: 'P-E2E52',
  title: 'Memoria agotada en el host'
}
const HOST_BAND_CLOSED_2 = {
  problemId: 'pd-host-band-closed-2',
  displayId: 'P-E2E53',
  title: 'Disco lleno en el host'
}

/**
 * Ficha 0018: los problemas de HOST_METRICS_ID (uno abierto y dos cerrados, sin solaparse y
 * dentro de las últimas 2 h). Salen en las consultas con affectedEntities (recuentos y franja) y
 * en el detalle.
 */
function hostBandProblems(): FakeProblem[] {
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

const PROCESS_BAND_OPEN = {
  problemId: 'pd-process-band-open',
  displayId: 'P-E2E81',
  title: 'Proceso con CPU saturada'
}
const PROCESS_BAND_CLOSED = {
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
function processBandProblems(): FakeProblem[] {
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

const MONITOR_BAND_OPEN = {
  problemId: 'pd-monitor-band-open',
  displayId: 'P-E2E71',
  title: 'Browser monitor sin disponibilidad'
}
const MONITOR_BAND_CLOSED = {
  problemId: 'pd-monitor-band-closed',
  displayId: 'P-E2E72',
  title: 'Browser monitor lento'
}
const MONITOR_HTTP_BAND_CLOSED = {
  problemId: 'pd-monitor-http-band-closed',
  displayId: 'P-E2E73',
  title: 'HTTP monitor con fallos'
}

/**
 * Ficha 0024: los problemas de los monitores de las páginas, dentro de las últimas 2 h y sin
 * solaparse: MONITOR_BROWSER_ID con uno abierto y uno cerrado; MONITOR_HTTP_ID con uno cerrado.
 * Salen en las consultas con affectedEntities (recuentos y franja) y en el detalle.
 */
function monitorBandProblems(): FakeProblem[] {
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

/** Ficha 0046: clave de métrica de una expresión (antes del primer «:» tras «builtin:»). */
function serviceMetricKey(expression: string): string {
  return `builtin:${expression.replace(/^builtin:/, '').split(':')[0] ?? ''}`
}

/**
 * Ficha 0046: conjunto y papel de una expresión de métricas de servicio. `count` es el
 * recuento de `response.server` (Solo actividad). Null si no es de ningún conjunto.
 */
function serviceFamilyKind(
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

function serviceKind(expression: string): SvcKind | null {
  const found = serviceFamilyKind(expression)
  return found === null || found.family !== 'server' || found.kind === 'count' ? null : found.kind
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
const HOST_METRICS_ID = 'HOST-00000000000E2E30'
const HOST_T0 = Date.parse('2026-10-03T08:00:00.000Z')
const HOST_TIMESTAMPS = [0, 1, 2].map((i) => HOST_T0 + i * 60_000)
type HostSeriesKind =
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
type HostMarkerKind = 'cpuAvg' | 'cpuMax' | 'memoryAvg' | 'netIn' | 'netOut' | 'diskMax' | 'load'
/** Series ya juntas (lo que da splitBy():sum en la red y splitBy():max en el disco). */
const HOST_SERIES: Record<HostSeriesKind, (number | null)[]> = {
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
const HOST_PER_ITEM: Record<'netIn' | 'netOut' | 'disk', (number | null)[][]> = {
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
const HOST_MARKERS: Record<HostMarkerKind, number> = {
  cpuAvg: 33.5,
  cpuMax: 95,
  memoryAvg: 57,
  netIn: 3600,
  netOut: 650,
  diskMax: 92,
  load: 2.25
}

/** Clave de la métrica (lo que va antes de la primera transformación). */
const hostMetricKey = (expression: string): string =>
  /^builtin:[A-Za-z.]+/.exec(expression)?.[0].replace(/\.$/, '') ?? ''
const hostMerged = (expression: string): boolean =>
  /:splitBy\((\s*|"dt\.entity\.host")\)/.test(expression)
const hostAgg = (expression: string, aggregation: string): boolean =>
  new RegExp(`:${aggregation}\\b`).test(expression)

function hostSeriesKind(expression: string): HostSeriesKind | null {
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

function hostMarkerKind(expression: string): HostMarkerKind | null {
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
const HOST_MAX_EXPRESSIONS = 10

/**
 * Ficha 0039: cuántas llamadas al canal entities:hostMetrics ha recibido el simulador. Las series
 * pueden ir en varias consultas (más de 10 expresiones), pero cada llamada hace una sola consulta
 * de marcadores (resolution=Inf).
 */
const hostMetricCalls = (): number =>
  sim.hostMetricQueries.filter((query) => query.get('resolution') === 'Inf').length

/** Ficha 0039: ninguna consulta de métricas del host lleva más de 10 expresiones. */
function expectHostQueriesWithinLimit(): void {
  for (const query of sim.hostMetricQueries) {
    expect(
      splitSelector(query.get('metricSelector') ?? '').length,
      'expresiones en una consulta'
    ).toBeLessThanOrEqual(HOST_MAX_EXPRESSIONS)
  }
}

/** ¿Es una consulta de métricas del host inventado (series o marcadores)? */
function isHostMetricsQuery(query: URLSearchParams): boolean {
  const selector = query.get('metricSelector') ?? ''
  return (
    selector.startsWith('builtin:host.') &&
    ((query.get('entitySelector') ?? '').includes(`entityId("${HOST_METRICS_ID}")`) ||
      selector.includes(HOST_METRICS_ID))
  )
}

/** Respuesta del simulador a una consulta de métricas del host inventado. */
function hostMetricResponse(query: URLSearchParams): [number, unknown] {
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
const MONITOR_BROWSER_ID = 'SYNTHETIC_TEST-00000000000E2E40'
const MONITOR_HTTP_ID = 'HTTP_CHECK-00000000000E2E41'
const MONITOR_T0 = Date.parse('2026-10-03T08:00:00.000Z')
const MONITOR_TIMESTAMPS = [0, 1, 2].map((i) => MONITOR_T0 + i * 600_000)
/** Series del monitor, por clave de métrica (ya juntas las localizaciones). */
const MONITOR_SERIES: Record<string, (number | null)[]> = {
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
const MONITOR_MARKERS: Record<string, number> = {
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

const monitorKey = (expression: string): string =>
  /^builtin:[A-Za-z.]+/.exec(expression)?.[0].replace(/\.$/, '') ?? ''

/** Clave de las tablas de arriba: la métrica, o «resultStatus:<valor>» si filtra el estado. */
function monitorEntry(expression: string, marker: boolean): string {
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
function isMonitorMetricsQuery(query: URLSearchParams): boolean {
  const selector = query.get('metricSelector') ?? ''
  const scope = `${selector} ${query.get('entitySelector') ?? ''}`
  return (
    selector.startsWith('builtin:synthetic.') &&
    (scope.includes(MONITOR_BROWSER_ID) || scope.includes(MONITOR_HTTP_ID))
  )
}

/** Respuesta del simulador a una consulta de métricas de los monitores inventados. */
function monitorMetricResponse(query: URLSearchParams): [number, unknown] {
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
const PROCESS_METRICS_ID = 'PROCESS_GROUP_INSTANCE-00000000000E2E50'
const PROCESS_T0 = Date.parse('2026-10-03T08:00:00.000Z')
const PROCESS_TIMESTAMPS = [0, 1, 2].map((i) => PROCESS_T0 + i * 600_000)
/** Series del proceso, por expresión (las exactas del paso 0). */
const PROCESS_SERIES: Record<string, (number | null)[]> = {
  'builtin:tech.generic.cpu.usage': [8, null, 22.5],
  'builtin:tech.generic.mem.workingSetSize': [300_000_000, null, 320_000_000],
  'builtin:tech.generic.network.bytesRx': [4_096, null, 1_024.5],
  'builtin:tech.generic.network.bytesTx': [512, 256, null],
  'builtin:tech.generic.network.packets.retransmission': [0.5, null, 2],
  'builtin:pgi.availability': [100, null, 50],
  'builtin:tech.generic.handles.fileDescriptorsPercentUsed': [0.5, null, 0.8]
}
/** Valor del rango (resolution=Inf), por expresión. */
const PROCESS_MARKERS: Record<string, number> = {
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
const PROCESS_METRICS_IDS = new Set<string>([PROCESS_METRICS_ID])

/** Id del proceso de la consulta (entityId("…") del entitySelector), o null si no es de uno. */
function processMetricsEntity(query: URLSearchParams): string | null {
  const match = /^entityId\("(PROCESS_GROUP_INSTANCE-[0-9A-F]{16})"\)$/.exec(
    (query.get('entitySelector') ?? '').trim()
  )
  const id = match?.[1] ?? null
  return id !== null && PROCESS_METRICS_IDS.has(id) ? id : null
}

/** ¿Es una consulta de métricas de uno de los procesos inventados? */
function isProcessMetricsQuery(query: URLSearchParams): boolean {
  return processMetricsEntity(query) !== null
}

/**
 * Ficha 0028: ¿llega sin datos esta expresión? Con `sim.processEmpty` (claves de métrica, sin
 * agregación), la métrica no trae series ni en la consulta de series ni en la de marcadores, como
 * un proceso real sin esos datos (paso 0 de la 0027: `data` vacío).
 */
function processExpressionEmpty(expression: string): boolean {
  return sim.processEmpty.some((key) => expression === key || expression.startsWith(`${key}:`))
}

/** Respuesta del simulador a una consulta de métricas de un proceso inventado. */
function processMetricResponse(query: URLSearchParams): [number, unknown] {
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
const PROCESS_GROUP_ID = 'PROCESS_GROUP-00000000000E2E60'
const PROCESS_GROUP_SELECTOR = `type("PROCESS_GROUP_INSTANCE"),fromRelationships.isInstanceOf(entityId("${PROCESS_GROUP_ID}"))`
const PROCESS_GROUP_BY_INSTANCE =
  ':parents:splitBy("dt.entity.process_group_instance","dt.entity.host"):avg:names'
/** Instancias inventadas del grupo, con su host. */
const PROCESS_GROUP_INSTANCES = [
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
const PROCESS_GROUP_SERIES: Record<string, (number | null)[]> = {
  'builtin:tech.generic.cpu.usage:splitBy():sum': [18, null, 112.5],
  'builtin:tech.generic.mem.workingSetSize:splitBy():sum': [900_000_000, null, 950_000_000],
  'builtin:tech.generic.network.bytesRx:splitBy():sum': [8_192, null, 2_048.5],
  'builtin:tech.generic.network.bytesTx:splitBy():sum': [1_024, 512, null]
}
/** Media del total en el rango (resolution=Inf), por expresión. */
const PROCESS_GROUP_MARKERS: Record<string, number> = {
  'builtin:tech.generic.cpu.usage:splitBy():sum': 64.5,
  'builtin:tech.generic.mem.workingSetSize:splitBy():sum': 925_000_000,
  'builtin:tech.generic.network.bytesRx:splitBy():sum': 5_120,
  'builtin:tech.generic.network.bytesTx:splitBy():sum': 768
}
/** Media por instancia (resolution=Inf), en el orden de PROCESS_GROUP_INSTANCES. */
const PROCESS_GROUP_INSTANCE_VALUES: Record<string, number[]> = {
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
const PROCESS_GROUP_PAGE_ID = 'PROCESS_GROUP-0000000000E2EC00'
const PROCESS_GROUP_PAGE_SELECTOR = `type("PROCESS_GROUP_INSTANCE"),fromRelationships.isInstanceOf(entityId("${PROCESS_GROUP_PAGE_ID}"))`
const pgPageHost = (n: number): { hostId: string; hostName: string } => ({
  hostId: `HOST-0000000000E2EA0${n}`,
  hostName: `host-grupo-${n}`
})
interface ProcessGroupInstanceFake {
  id: string
  name: string
  hostId: string
  hostName: string
  cpu: number
  memory: number
}
const PROCESS_GROUP_PAGE_INSTANCES: ProcessGroupInstanceFake[] = [
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
const PROCESS_GROUP_PAGE_BY_CPU = PROCESS_GROUP_PAGE_INSTANCES.slice().sort((a, b) => b.cpu - a.cpu)
/** Los tres hosts de sus instancias. */
const PROCESS_GROUP_PAGE_HOSTS = [1, 2, 3].map(pgPageHost)
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
const PROCESS_GROUP_MANY_ID = 'PROCESS_GROUP-00000000000E2E70'
const PROCESS_GROUP_CUT_ID = 'PROCESS_GROUP-00000000000E2E80'
/** Instancias que cuenta /entities en el grupo recortado (más que las que llegan). */
const PROCESS_GROUP_CUT_TOTAL = 600
/** Selector de las instancias de un grupo, el confirmado en vivo (0031). */
const processGroupSelector = (groupId: string): string =>
  `type("PROCESS_GROUP_INSTANCE"),fromRelationships.isInstanceOf(entityId("${groupId}"))`
/** `n` instancias inventadas; CPU `(i·7) mod n` + 0,5 (una permutación: n no es múltiplo de 7). */
function pgManyInstances(prefix: string, n: number): ProcessGroupInstanceFake[] {
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
const PROCESS_GROUP_MANY_INSTANCES = pgManyInstances('E2E7', 30)
const PROCESS_GROUP_CUT_INSTANCES = pgManyInstances('E2E8', 25)
/** Ficha 0051: un grupo de 12 instancias (menos de 20: ni aviso ni «Ver todas»). */
const PROCESS_GROUP_FEW_ID = 'PROCESS_GROUP-00000000000E2E90'
const PROCESS_GROUP_FEW_INSTANCES = pgManyInstances('E2E9', 12)
/** De más a menos CPU media. */
const byCpu = (list: ProcessGroupInstanceFake[]): ProcessGroupInstanceFake[] =>
  list.slice().sort((a, b) => b.cpu - a.cpu)
/** Como las da el canal (id, nombre, host, CPU y memoria). */
const pgItem = (instance: ProcessGroupInstanceFake): Record<string, unknown> => ({
  id: instance.id,
  name: instance.name,
  hostId: instance.hostId,
  hostName: instance.hostName,
  cpu: instance.cpu,
  memory: instance.memory
})

/** Las instancias inventadas de cada process group, con su CPU y su memoria medias. */
function processGroupInstances(groupId: string): ProcessGroupInstanceFake[] {
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
function processGroupOf(query: URLSearchParams): string | null {
  const scope = query.get('entitySelector') ?? ''
  if (scope.includes(PROCESS_GROUP_PAGE_ID)) return PROCESS_GROUP_PAGE_ID
  if (scope.includes(PROCESS_GROUP_ID)) return PROCESS_GROUP_ID
  if (scope.includes(PROCESS_GROUP_MANY_ID)) return PROCESS_GROUP_MANY_ID
  if (scope.includes(PROCESS_GROUP_CUT_ID)) return PROCESS_GROUP_CUT_ID
  if (scope.includes(PROCESS_GROUP_FEW_ID)) return PROCESS_GROUP_FEW_ID
  return null
}

/** ¿Es una consulta de métricas de un process group inventado? */
function isProcessGroupMetricsQuery(query: URLSearchParams): boolean {
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
function processGroupMetricResponse(query: URLSearchParams): [number, unknown] {
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

const PROCESS_GROUP_BAND_OPEN = {
  problemId: 'pd-process-group-band-open',
  displayId: 'P-E2E83',
  title: 'Process group con CPU saturada'
}
const PROCESS_GROUP_BAND_CLOSED = {
  problemId: 'pd-process-group-band-closed',
  displayId: 'P-E2E84',
  title: 'Process group sin instancias'
}

/**
 * Ficha 0032: los problemas del process group de la página (PROCESS_GROUP_PAGE_ID), uno abierto y
 * uno cerrado, dentro de las últimas 2 h y sin solaparse. Salen en las consultas con
 * affectedEntities (recuentos y franja) y en el detalle.
 */
function processGroupBandProblems(): FakeProblem[] {
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
const PROCESS_GROUP_INFO_SECRETS = {
  commandLineArgs: '-Dclave.bd=CLAVE-GRUPO-E2E --token TOKEN-GRUPO-E2E -Xmx640m',
  exePath: '/home/usuario-e2e-0032/opt/grupo/bin/pagos-grupo-e2e'
}
const PROCESS_GROUP_INFO_SECRET_PARTS = [
  PROCESS_GROUP_INFO_SECRETS.commandLineArgs,
  PROCESS_GROUP_INFO_SECRETS.exePath,
  'CLAVE-GRUPO-E2E',
  'TOKEN-GRUPO-E2E',
  '-Xmx640m',
  'usuario-e2e-0032',
  '/opt/grupo/bin/'
]
function processGroupInfoBody(): Record<string, unknown> {
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
const APPLICATION_METRICS_ID = 'APPLICATION-00000000000E2E33'
const APPLICATION_SELECTOR = `entityId("${APPLICATION_METRICS_ID}")`
const APPLICATION_METHODS_SELECTOR = `type("APPLICATION_METHOD"),fromRelationships.isApplicationMethodOf(entityId("${APPLICATION_METRICS_ID}"))`
const APPLICATION_TOP =
  ':splitBy("dt.entity.application_method"):sort(value(count,descending)):limit(10)'
/** Serie de la aplicación por expresión (las exactas del paso 0), sin resolution. */
const APPLICATION_SERIES: Record<string, (number | null)[]> = {
  'builtin:apps.web.apdex.userType:splitBy():avg': [0.95, null, 0.81],
  'builtin:apps.web.actionCount.summary:splitBy():sum': [60, 75, null],
  'builtin:apps.web.visuallyComplete.load.browser:splitBy():avg': [1_200, null, 1_640.5],
  'builtin:apps.web.countOfErrors:splitBy():sum': [2, null, 5],
  'builtin:apps.web.startedSessions:splitBy():sum': [8, 11, null]
}
/** Total del rango (resolution=Inf), por expresión. */
const APPLICATION_TOTALS: Record<string, number> = {
  'builtin:apps.web.apdex.userType:splitBy():avg': 0.88,
  'builtin:apps.web.actionCount.summary:splitBy():sum': 135,
  'builtin:apps.web.visuallyComplete.load.browser:splitBy():avg': 1_420.75,
  'builtin:apps.web.countOfErrors:splitBy():sum': 7,
  'builtin:apps.web.startedSessions:splitBy():sum': 19
}
/** Acciones inventadas por tipo, con su recuento y su duración media (ya de más a menos). */
const APPLICATION_ACTIONS: Record<
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
const RUM_W = 'builtin:apps.web.'
const RUM_ERRORS = `${RUM_W}countOfErrors:splitBy("Error type"):sum`
/** Serie (sin resolution) y total (Inf) de cada expresión de RUM sin tipo de error. */
const APPLICATION_RUM: Record<string, { series: (number | null)[]; total: number }> = {
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
const APPLICATION_RUM_RAGE: Record<string, { series: (number | null)[]; total: number }> = {
  [`${RUM_W}event.count.rageClick:splitBy():sum`]: { series: [12, null, 25], total: 37 }
}
/** Errores por «Error type»: serie y total de cada tipo. */
const APPLICATION_RUM_ERRORS: Record<string, { series: (number | null)[]; total: number }> = {
  JavaScript: { series: [1, null, 4], total: 5 },
  Request: { series: [6, 3, null], total: 9 }
}
/**
 * Ficha 0053: las de custom, con datos solo con `sim.applicationRumCustom` (en vivo llegan sin
 * series; así se prueba el «custom si hay»).
 */
const APPLICATION_RUM_CUSTOM: Record<string, { series: (number | null)[]; total: number }> = {
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
const APPLICATION_RUM_UNTYPED_ERRORS = { series: [7, 3, 4] as (number | null)[], total: 14 }
/**
 * Ficha 0053: expresiones que solo pide el canal entities:applicationRum (startedSessions la
 * piden los dos canales). Toda consulta de RUM lleva alguna.
 */
const RUM_ONLY_EXPRESSIONS = new Set(
  [
    ...Object.keys(APPLICATION_RUM),
    ...Object.keys(APPLICATION_RUM_CUSTOM),
    RUM_ERRORS,
    `${RUM_W}event.count.rageClick:splitBy():sum`
  ].filter((expression) => !(expression in APPLICATION_TOTALS))
)
/** Ficha 0053: ¿es una consulta del canal entities:applicationRum? */
function isRumQuery(query: URLSearchParams): boolean {
  return splitSelector(query.get('metricSelector') ?? '').some((expression) =>
    RUM_ONLY_EXPRESSIONS.has(expression)
  )
}
/** La API admite como mucho 10 expresiones por consulta (OpenAPI v2, `metricSelector`). */
const METRIC_SELECTOR_MAX = 10

/** ¿Es una consulta de métricas de la aplicación inventada? */
function isApplicationMetricsQuery(query: URLSearchParams): boolean {
  return (query.get('entitySelector') ?? '').includes(APPLICATION_METRICS_ID)
}

/**
 * Ficha 0034: prefijo de la métrica de cada papel de la aplicación (para `sim.applicationEmpty`).
 */
const APPLICATION_ROLE_PREFIX: Record<string, string> = {
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
function applicationMetricResponse(query: URLSearchParams): [number, unknown] {
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

const APPLICATION_BAND_OPEN = {
  problemId: 'pd-application-band-open',
  displayId: 'P-E2E85',
  title: 'Aplicación con Apdex bajo'
}
const APPLICATION_BAND_CLOSED = {
  problemId: 'pd-application-band-closed',
  displayId: 'P-E2E86',
  title: 'Aplicación con errores de JavaScript'
}

/**
 * Ficha 0034: los problemas de la aplicación de la página (APPLICATION_METRICS_ID), uno abierto
 * y uno cerrado, dentro de las últimas 2 h y sin solaparse. Salen en las consultas con
 * affectedEntities (recuentos y franja) y en el detalle.
 */
function applicationBandProblems(): FakeProblem[] {
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
const APPLICATION_INFO_HTTP = 'HTTP_CHECK-00000000000E2E37'
const APPLICATION_INFO_METHOD_GROUP = 'APPLICATION_METHOD_GROUP-00000000000E2E38'
Object.assign(ENTITY_NAMES, {
  [APPLICATION_METRICS_ID]: 'tienda-web-e2e',
  [APPLICATION_INFO_HTTP]: 'comprobacion-tienda-e2e'
})
function applicationInfoBody(): Record<string, unknown> {
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
const BREAKDOWN_BROWSER_ID = 'SYNTHETIC_TEST-00000000000E2E42'
const BREAKDOWN_HTTP_ID = 'HTTP_CHECK-00000000000E2E43'
const MONITOR_BREAKDOWN_T0 = Date.parse('2026-10-03T08:00:00.000Z')
const breakdownLocation = (n: number): string => `SYNTHETIC_LOCATION-00000000000E2E5${n}`
const breakdownStep = (type: string, n: number): string => `${type}-00000000000E2E6${n}`
type BreakdownItem = { id: string; name?: string; value: number | null }
type BreakdownRole = 'availability' | 'duration' | 'failed' | 'steps'
/** Expresión confirmada → papel y ámbitos probados (`monitor`, `steps` o sin entitySelector). */
function breakdownExpressions(
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
const BREAKDOWN_DATA: Record<string, Partial<Record<BreakdownRole, BreakdownItem[]>>> = {
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
const MONITOR_TABLE_DATA: Record<string, Partial<Record<BreakdownRole, BreakdownItem[]>>> = {
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
function breakdownMonitorId(query: URLSearchParams): string | null {
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
function isMonitorBreakdownQuery(query: URLSearchParams): boolean {
  const selector = query.get('metricSelector') ?? ''
  const id = breakdownMonitorId(query)
  if (!selector.startsWith('builtin:synthetic.') || id === null) return false
  if (id === BREAKDOWN_BROWSER_ID || id === BREAKDOWN_HTTP_ID) return true
  const known = breakdownExpressions(id)
  return splitSelector(selector).every((expression) => known[expression] !== undefined)
}

/** Respuesta del simulador a una consulta del desglose de los monitores inventados. */
function monitorBreakdownResponse(query: URLSearchParams): [number, unknown] {
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
const BREAKDOWN_HOST_ID = 'HOST-00000000000E2E31'
const BREAKDOWN_T0 = Date.parse('2026-10-03T08:00:00.000Z')
/** Último dato, media y máximo; la serie es [máximo, x, último, null] con esa media. */
type BreakdownStats = { last: number; avg: number; max: number }
const BREAKDOWN_DISKS: { id: string; name: string; metrics: Record<string, BreakdownStats> }[] = [
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
const BREAKDOWN_CPU = [4, 30, 2, 55, 18, 1, 9, 26, 3, 14, 7, 11]
const BREAKDOWN_PROCESSES = BREAKDOWN_CPU.map((avg, i) => ({
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
const GB = 1_000_000_000
const HOST_PAGE_DISKS: typeof BREAKDOWN_DISKS = [
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
const HOST_PAGE_CPU = [12, 47, 3, 28, 61, 7, 19, 2, 35, 9, 1, 24, 15, 5, 40]
const HOST_PAGE_PROCESSES = HOST_PAGE_CPU.map((avg, i) => {
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
const HOST_LOGS_USER = 'usuario-logs-e2e-0041'
const HOST_LOGS_PATHS = {
  unix: `/home/${HOST_LOGS_USER}/pagos/logs/app-e2e.log`,
  windows: `C:\\Users\\${HOST_LOGS_USER}\\informes\\salida-e2e.log`,
  source: 'Fuente generica de logs e2e'
}
/** Trozos de las rutas que tampoco pueden verse sueltos. */
const HOST_LOGS_FRAGMENTS = [
  ...Object.values(HOST_LOGS_PATHS),
  HOST_LOGS_USER,
  '/home/',
  'C:\\Users',
  'app-e2e.log',
  'salida-e2e.log',
  'generica de logs'
]
const HOST_LOGS_S = Date.parse('2026-10-03T07:30:00.000Z') / 1000
const HOST_LOGS_ENTRIES: Record<string, Record<string, unknown>> = {
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
const HOST_LOGS_IDS = Object.keys(HOST_LOGS_ENTRIES)
/** El proceso con logs cuya página tiene `entities:get` (con las mismas rutas en properties). */
const HOST_LOGS_PAGE = HOST_PAGE_PROCESSES[5]!
function hostLogsProcessBody(): Record<string, unknown> {
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
const HOST_LOGS_SELECTOR = (hostId: string): string =>
  `type("PROCESS_GROUP_INSTANCE"),fromRelationships.isProcessOf(entityId("${hostId}"))`

/** Respuesta del simulador a la consulta de logs de un host (null si no es esa consulta). */
function hostLogsResponse(query: URLSearchParams): { status: number; body: unknown } | null {
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
const HOST_EVENTS_HOST = HOST_INFO_FULL_ID
const HOST_EVENTS_DISK_NAME = 'disco-e2e-0042'
const HOST_EVENTS_IDS = [HOST_INFO_FULL_ID, ...HOST_INFO_PGIS, HOST_INFO_DISK, HOST_INFO_EC2]
const HOST_EVENTS_EXCLUDED = [
  INFO_FEW_ID,
  HOST_INFO_SERVICE_2,
  HOST_INFO_PG,
  HOST_INFO_GROUP,
  HOST_INFO_PEER
]
const HOST_EVENTS_HTML_TITLE = '<b>Disco</b> casi lleno <img src="x">'
const HOST_EVENTS_T0 = Date.parse('2026-10-03T10:00:00.000Z')
const hostEventTitle = (n: number): string => (n === 2 ? HOST_EVENTS_HTML_TITLE : `Evento e2e ${n}`)
const hostEventEntityType = (id: string): string => id.slice(0, id.lastIndexOf('-'))
function hostEvent(n: number, entityId: string): Record<string, unknown> {
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
const hostEventOwner = (n: number): string => HOST_EVENTS_IDS[(n - 1) % HOST_EVENTS_IDS.length]!
const HOST_EVENTS: Record<string, unknown>[] = [
  hostEvent(0, HOST_INFO_SERVICE_2),
  ...Array.from({ length: 22 }, (_, i) => hostEvent(i + 1, hostEventOwner(i + 1)))
]

/** Ids de un `eventSelector=entityId("a","b")` (vacío si tiene otra forma). */
function hostEventsSelectorIds(query: URLSearchParams): string[] | null {
  const inner = /^entityId\((.*)\)$/.exec(query.get('eventSelector') ?? '')?.[1]
  if (inner === undefined) return null
  return inner.split(',').map((part) => part.trim().replace(/^"|"$/g, ''))
}

/** Respuesta del simulador a GET /events: los eventos de los ids del eventSelector. */
function hostEventsResponse(query: URLSearchParams): { status: number; body: unknown } {
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

const breakdownCompact = (text: string): string => text.replace(/["\s]/g, '')
const breakdownRelation = (hostId: string): string =>
  `fromRelationships.isProcessOf(entityId(${hostId}))`

/** ¿De qué host inventado es la consulta de discos o procesos (null si no es de ninguno)? */
function hostBreakdownHost(query: URLSearchParams): string | null {
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
function isHostBreakdownQuery(query: URLSearchParams): boolean {
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
const DISK_PAGE_ID = 'DISK-00000000000E2E12'
const DISK_PAGE_NAME = '/datos'
const DISK_PAGE_FILESYSTEM = 'ext4'
const DISK_PAGE_IDS = HOST_PAGE_DISKS.map((disk) => disk.id)
const DISK_T0 = Date.parse('2026-10-03T08:00:00.000Z')
/** Series de /datos (último punto a null, como en vivo). */
const DISK_PAGE_SERIES: Record<string, (number | null)[]> = {
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
const DISK_PAGE_MARKERS: Record<string, number> = {
  'builtin:host.disk.usedPct:max': 92.5,
  'builtin:host.disk.bytesRead:avg': 2_500_000,
  'builtin:host.disk.bytesWritten:avg': 12_000,
  'builtin:host.disk.readTime:avg': 12,
  'builtin:host.disk.writeTime:avg': 18,
  'builtin:host.disk.queueLength:avg': 0.75
}

/** Disco inventado al que va el filtro de la expresión (null si no lleva el de ninguno). */
function diskOfExpression(expression: string): string | null {
  const id = /:filter\(eq\("dt\.entity\.disk","(DISK-[0-9A-F]{16})"\)\)/.exec(expression)?.[1]
  return id !== undefined && DISK_PAGE_IDS.includes(id) ? id : null
}

/** ¿Es una consulta de entities:diskMetrics (expresiones filtradas por un disco inventado)? */
function isDiskMetricsQuery(query: URLSearchParams): boolean {
  const expressions = splitSelector(query.get('metricSelector') ?? '')
  return (
    expressions.length > 0 &&
    expressions.every((e) => e.startsWith('builtin:host.disk.')) &&
    expressions.some((e) => diskOfExpression(e) !== null)
  )
}

/** Respuesta del simulador a una consulta de métricas de un disco inventado. */
function diskMetricResponse(query: URLSearchParams): [number, unknown] {
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
function hostBreakdownResponse(query: URLSearchParams): [number, unknown] {
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
      if (
        ![
          TOKEN_A,
          TOKEN_B,
          TOKEN_NO_METRICS,
          TOKEN_FORBIDDEN,
          TOKEN_NO_ENTITIES,
          TOKEN_NO_EVENTS
        ].includes(token)
      ) {
        return send(401, { error: { code: 401, message: 'Missing or invalid token' } })
      }
      if (req.method === 'POST' && url.pathname === '/api/v2/apiTokens/lookup') {
        return send(200, {
          id: 'dt0c01.PUBLICAPRUEBA0000000000A',
          name: 'e2e',
          enabled: true,
          // Ficha 0042: events.read en todos menos en TOKEN_NO_EVENTS.
          scopes:
            token === TOKEN_NO_METRICS
              ? ['problems.read', 'slo.read', 'entities.read', 'events.read']
              : token === TOKEN_NO_ENTITIES
                ? ['problems.read', 'metrics.read', 'slo.read', 'events.read']
                : token === TOKEN_NO_EVENTS
                  ? ['problems.read', 'metrics.read', 'slo.read', 'entities.read']
                  : ['problems.read', 'metrics.read', 'slo.read', 'entities.read', 'events.read']
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
              ...hostBandProblems(),
              ...monitorBandProblems(),
              ...processBandProblems(),
              ...processGroupBandProblems(),
              ...applicationBandProblems(),
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
            ...bandProblems(),
            ...hostBandProblems(),
            ...monitorBandProblems(),
            ...processBandProblems(),
            ...processGroupBandProblems(),
            ...applicationBandProblems()
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
        // Ficha 0033: las del canal entities:applicationMetrics, aparte.
        if (isApplicationMetricsQuery(url.searchParams)) {
          sim.applicationMetricQueries.push(url.searchParams)
          const [status, body] = applicationMetricResponse(url.searchParams)
          return send(status, body)
        }
        // Ficha 0031: las del canal entities:processGroupMetrics, aparte.
        if (isProcessGroupMetricsQuery(url.searchParams)) {
          sim.processGroupMetricQueries.push(url.searchParams)
          const [status, body] = processGroupMetricResponse(url.searchParams)
          return send(status, body)
        }
        // Ficha 0027: las del canal entities:processMetrics, aparte.
        if (isProcessMetricsQuery(url.searchParams)) {
          sim.processMetricQueries.push(url.searchParams)
          const [status, body] = processMetricResponse(url.searchParams)
          return send(status, body)
        }
        // Ficha 0040: las del canal entities:diskMetrics, aparte.
        if (isDiskMetricsQuery(url.searchParams)) {
          sim.diskMetricQueries.push(url.searchParams)
          const [status, body] = diskMetricResponse(url.searchParams)
          return send(status, body)
        }
        // Ficha 0017: las del canal entities:hostBreakdown, aparte.
        if (isHostBreakdownQuery(url.searchParams)) {
          sim.hostBreakdownQueries.push(url.searchParams)
          const [status, body] = hostBreakdownResponse(url.searchParams)
          return send(status, body)
        }
        // Ficha 0023: las del canal entities:monitorBreakdown, aparte.
        if (isMonitorBreakdownQuery(url.searchParams)) {
          sim.monitorBreakdownQueries.push(url.searchParams)
          const [status, body] = monitorBreakdownResponse(url.searchParams)
          return send(status, body)
        }
        // Ficha 0022: las del canal entities:monitorMetrics, aparte.
        if (isMonitorMetricsQuery(url.searchParams)) {
          sim.monitorMetricQueries.push(url.searchParams)
          const [status, body] = monitorMetricResponse(url.searchParams)
          return send(status, body)
        }
        // Ficha 0016: las del canal entities:hostMetrics, aparte (antes que la vista Métricas).
        if (isHostMetricsQuery(url.searchParams)) {
          sim.hostMetricQueries.push(url.searchParams)
          const [status, body] = hostMetricResponse(url.searchParams)
          return send(status, body)
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
      // Ficha 0042: eventos (entities:hostEvents).
      if (req.method === 'GET' && url.pathname === '/api/v2/events') {
        const events = hostEventsResponse(url.searchParams)
        return send(events.status, events.body)
      }
      // Ficha 0014: una entidad (entities:get) y los nombres de una lista de ids (entities:names).
      const entityPath = /^\/api\/v2\/entities\/([^/]+)$/.exec(url.pathname)
      // Ficha 0046: la entidad que pide entities:serviceMetrics para elegir las métricas.
      if (
        req.method === 'GET' &&
        entityPath !== null &&
        (url.searchParams.get('fields') ?? '').includes('properties.serviceType')
      ) {
        const id = decodeURIComponent(entityPath[1] ?? '')
        sim.serviceEntityQueries.push(`${id} ${url.searchParams.get('fields') ?? ''}`)
        if (token === TOKEN_NO_ENTITIES) {
          return send(403, {
            error: {
              code: 403,
              message: 'Token is missing required scope',
              details: { missingScopes: ['entities.read'] }
            }
          })
        }
        const body = serviceTypeBodies()[id]
        return body !== undefined
          ? send(200, body)
          : send(404, { error: { code: 404, message: 'Entity not found' } })
      }
      if (req.method === 'GET' && entityPath !== null) {
        sim.entityInfoQueries.push(url.searchParams)
        if (sim.entityInfoFail) {
          return send(400, { error: { code: 400, message: 'Consulta de entidad rechazada' } })
        }
        const body = entityBodies()[decodeURIComponent(entityPath[1] ?? '')]
        return body !== undefined
          ? send(200, body)
          : send(404, { error: { code: 404, message: 'Entity not found' } })
      }
      if (req.method === 'GET' && url.pathname === '/api/v2/entities') {
        // Ficha 0050: el total real de instancias de un grupo inventado (totalCount, con la
        // primera página de pageSize), como en vivo con el selector de la 0031.
        const group = processGroupOf(url.searchParams)
        if (
          group !== null &&
          url.searchParams.get('entitySelector') === processGroupSelector(group)
        ) {
          sim.processGroupEntityQueries.push(url.searchParams)
          // Ficha 0051: sin entities.read, el total real no se puede saber.
          if (sim.processGroupEntitiesFail) {
            return send(403, {
              error: { code: 403, message: 'Token sin entities.read (simulado)' }
            })
          }
          const all = processGroupInstances(group)
          const totalCount = group === PROCESS_GROUP_CUT_ID ? PROCESS_GROUP_CUT_TOTAL : all.length
          const pageSize = Number(url.searchParams.get('pageSize') ?? '50')
          const entities = all.slice(0, pageSize).map((instance) => ({
            entityId: instance.id,
            displayName: instance.name,
            type: 'PROCESS_GROUP_INSTANCE'
          }))
          return send(200, {
            totalCount,
            pageSize,
            nextPageKey: totalCount > entities.length ? 'AQAAABQBAAAABQ==' : null,
            entities
          })
        }
        // Ficha 0041: la consulta de logs del host no es de entities:names.
        const logs = hostLogsResponse(url.searchParams)
        if (logs !== null) return send(logs.status, logs.body)
        sim.entityNamesQueries.push(url.searchParams)
        const selector = url.searchParams.get('entitySelector') ?? ''
        const inner = /^entityId\((.*)\)$/.exec(selector)?.[1]
        if (inner === undefined) {
          return send(400, { error: { code: 400, message: 'entitySelector no válido' } })
        }
        const ids = [...inner.matchAll(/"([^"]*)"/g)].map((m) => m[1] ?? '')
        const entities = ids
          .filter((id) => ENTITY_NAMES[id] !== undefined)
          .map((id) => ({ entityId: id, displayName: ENTITY_NAMES[id], type: id.split('-')[0] }))
        return send(200, { totalCount: entities.length, pageSize: 50, entities })
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

/**
 * Menú de exportación de `target`. Ficha 0030: si ya es un locator (un menú dentro de su
 * contenedor, como el del mini gráfico de evidencias), ese.
 */
function exportMenu(target: string | Locator): Locator {
  if (typeof target !== 'string') return target
  return page.locator(`[data-testid="export-menu"][data-export-target="${target}"]`)
}

/**
 * Lanza una opción del menú de exportación y devuelve el fichero nuevo de la carpeta de exportación,
 * quizá aún vacío. Ficha 0030: solo la usa exportSaved; para leer el fichero, exportSaved.
 */
async function exportTo(target: string | Locator, option: string): Promise<string> {
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
function exportNotice(target: string | Locator): Locator {
  return exportMenu(target).locator('xpath=..').getByRole('status')
}

/**
 * Ficha 0005: como exportTo, pero devuelve el fichero cuando ya está escrito. El nombre aparece en
 * la carpeta en cuanto main empieza a escribirlo (writeFile directo); el aviso «Guardado: …» sale
 * cuando writeFile ha terminado. Y además, con contenido. Ficha 0030: el aviso vale en es o en en
 * (hay tests que exportan con la interfaz en inglés).
 */
async function exportSaved(target: string | Locator, option: string): Promise<string> {
  const file = await exportTo(target, option)
  const notices = [es, en].map((locale) => locale.export.saved.replace('{{file}}', basename(file)))
  await expect
    .poll(async () => notices.includes((await exportNotice(target).textContent()) ?? ''), {
      message: `aviso «${notices.join('» o «')}»`
    })
    .toBe(true)
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

/**
 * Ficha 0059: cuántas veces se ha pintado cada fila de un DataGrid. Contrato (decisión del
 * test-writer, refinable): con VIGIA_E2E, cada fila principal (la de `rowTestId`) lleva
 * `data-render-count`, las veces que se ha pintado desde que se montó. Devuelve id → renders
 * (-1 si falta el atributo) de las filas montadas, por el atributo `idAttr` de cada fila.
 */
async function rowRenders(rowTestId: string, idAttr: string): Promise<Record<string, number>> {
  return page.evaluate(
    ({ testId, attr }) => {
      const out: Record<string, number> = {}
      for (const row of document.querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`)) {
        const id = row.getAttribute(attr)
        const count = row.getAttribute('data-render-count')
        if (id !== null) out[id] = count === null || count === '' ? -1 : Number(count)
      }
      return out
    },
    { testId: rowTestId, attr: idAttr }
  )
}

/** Ficha 0059: espera a que los renders de las filas no cambien entre dos frames y los devuelve. */
async function settledRowRenders(
  rowTestId: string,
  idAttr: string
): Promise<Record<string, number>> {
  let last: Record<string, number> = {}
  await expect
    .poll(async () => {
      const before = await rowRenders(rowTestId, idAttr)
      await nextFrames()
      last = await rowRenders(rowTestId, idAttr)
      return JSON.stringify(before) === JSON.stringify(last)
    })
    .toBe(true)
  return last
}

/**
 * Ficha 0059: guarda el elemento de cada fila montada. Si una fila se desmonta y se vuelve a montar,
 * su contador empieza de cero y podría coincidir con el de antes: `sameRows` lo descubre.
 */
async function markRows(rowTestId: string, idAttr: string): Promise<void> {
  await page.evaluate(
    ({ testId, attr }) => {
      const marks = new Map<string, Element>()
      for (const row of document.querySelectorAll(`[data-testid="${testId}"]`)) {
        const id = row.getAttribute(attr)
        if (id !== null) marks.set(id, row)
      }
      ;(window as unknown as { __rows0059?: Map<string, Element> }).__rows0059 = marks
    },
    { testId: rowTestId, attr: idAttr }
  )
}

/** Ficha 0059: ids marcados con `markRows` cuya fila sigue siendo el mismo elemento montado. */
async function sameRows(rowTestId: string, idAttr: string): Promise<string[]> {
  return page.evaluate(
    ({ testId, attr }) => {
      const marks = (window as unknown as { __rows0059?: Map<string, Element> }).__rows0059
      if (marks === undefined) return []
      const now = new Map<string, Element>()
      for (const row of document.querySelectorAll(`[data-testid="${testId}"]`)) {
        const id = row.getAttribute(attr)
        if (id !== null) now.set(id, row)
      }
      return [...marks]
        .filter(([id, row]) => row.isConnected && now.get(id) === row)
        .map(([id]) => id)
    },
    { testId: rowTestId, attr: idAttr }
  )
}

/** Ficha 0059: el subconjunto de `renders` con esos ids. */
function pick(renders: Record<string, number>, ids: readonly string[]): Record<string, number> {
  return Object.fromEntries(ids.map((id) => [id, renders[id] ?? -1]))
}

test('CA1 (0059): en Problemas con 300 filas, hacer scroll de diez filas no vuelve a pintar las que ya estaban montadas y no han cambiado', async () => {
  sim.many = true
  await goTo('problems')
  const rows = page.getByTestId('problem-row')
  await expect(rows.first()).toContainText('P-M')
  const scroller = page.getByTestId('problems-scroll')
  const row = (index: number): Locator =>
    page.locator(`[data-testid="problem-row"][data-index="${index}"]`)
  await expect(row(10)).toHaveCount(1)
  expect(await firstVisibleIndex()).toBe(0)

  // Antes del scroll: cada fila montada lleva su contador.
  const before = await settledRowRenders('problem-row', 'data-problem-id')
  const mounted = Object.keys(before)
  expect(mounted.length, 'filas montadas').toBeGreaterThan(10)
  expect(mounted.length, 'virtualizada: no están las 300').toBeLessThan(300)
  for (const [id, count] of Object.entries(before)) {
    expect(count, `data-render-count de ${id}`).toBeGreaterThanOrEqual(1)
  }
  await markRows('problem-row', 'data-problem-id')

  // Scroll de diez filas exactas (lo que separa la fila 10 de la 0).
  const tops = await Promise.all(
    [0, 10].map((i) => row(i).evaluate((el) => el.getBoundingClientRect().top))
  )
  const delta = (tops[1] ?? 0) - (tops[0] ?? 0)
  expect(delta).toBeGreaterThan(0)
  await scroller.evaluate((el, by) => {
    el.scrollTop += by
  }, delta)
  await expect.poll(firstVisibleIndex).toBe(10)
  const after = await settledRowRenders('problem-row', 'data-problem-id')

  // Las que siguen montadas (el mismo elemento) no se han vuelto a pintar.
  const kept = await sameRows('problem-row', 'data-problem-id')
  expect(kept.length, 'filas que siguen montadas tras el scroll').toBeGreaterThan(5)
  expect(pick(after, kept), 'renders de las filas que no han cambiado').toEqual(pick(before, kept))
  // Las nuevas sí se pintan (el contador está vivo).
  const fresh = Object.keys(after).filter((id) => before[id] === undefined)
  expect(fresh.length, 'filas nuevas tras el scroll').toBeGreaterThan(0)
  for (const id of fresh) expect(after[id], `data-render-count de ${id}`).toBeGreaterThanOrEqual(1)

  // Una fila que sí cambia (pasa a ser la del foco) se vuelve a pintar: el contador sube.
  const target = page.locator(`[data-testid="problem-row"][data-index="12"]`)
  const targetId = (await target.getAttribute('data-problem-id')) ?? ''
  expect(kept).toContain(targetId)
  await target.evaluate((el) => (el as HTMLElement).focus({ preventScroll: true }))
  await expect(target).toHaveAttribute('tabindex', '0')
  await expect
    .poll(async () => (await rowRenders('problem-row', 'data-problem-id'))[targetId] ?? -1)
    .toBeGreaterThan(after[targetId] ?? Number.MAX_SAFE_INTEGER)
})

test('CA2 (0059): escribir en el buscador de evidencias solo vuelve a pintar las filas que cambian', async () => {
  await goToRoute(`/problems/${BIG_ID}`)
  await expect(page.getByTestId('problem-page-title')).toContainText('P-778')
  await expect(evidenceRows().first()).toHaveAttribute('data-event-id', 'big-299')

  const before = await settledRowRenders('evidence-row', 'data-event-id')
  const mounted = Object.keys(before)
  expect(mounted.length, 'evidencias montadas').toBeGreaterThan(5)
  for (const [id, count] of Object.entries(before)) {
    expect(count, `data-render-count de ${id}`).toBeGreaterThanOrEqual(1)
  }
  await markRows('evidence-row', 'data-event-id')

  // Letra a letra, un texto que cumplen las 300: ninguna fila cambia, así que ninguna se repinta.
  const search = page.getByTestId('evidence-search')
  await search.click()
  await search.pressSequentially('Evidencia')
  await expect(search).toHaveValue('Evidencia')
  await expect(evidenceRows().first()).toHaveAttribute('data-event-id', 'big-299')
  const after = await settledRowRenders('evidence-row', 'data-event-id')
  expect(Object.keys(after).sort(), 'las mismas filas montadas').toEqual([...mounted].sort())
  const kept = await sameRows('evidence-row', 'data-event-id')
  expect(kept.sort(), 'ninguna fila se ha vuelto a montar').toEqual([...mounted].sort())
  expect(after, 'renders de las filas que no han cambiado').toEqual(before)

  // Una fila que sí cambia (se despliega) se vuelve a pintar: el contador sube.
  const target = page.locator('[data-testid="evidence-row"][data-event-id="big-297"]')
  await target.click()
  await expect(target).toHaveAttribute('aria-expanded', 'true')
  await expect
    .poll(async () => (await rowRenders('evidence-row', 'data-event-id'))['big-297'] ?? -1)
    .toBeGreaterThan(after['big-297'] ?? Number.MAX_SAFE_INTEGER)
})

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
      readFileSync(await exportSaved('problem-page', 'export-xlsx')) as unknown as ArrayBuffer
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
  const csv = readFileSync(await exportSaved('problem-page', 'export-csv'))
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
  // Ficha 0001: dt.event.description va en su sección y no en propiedades. CA6 (0043): el HTML de
  // formato (b) se interpreta; el peligroso (img con onerror) no se crea ni se ejecuta.
  await expect(properties).not.toContainText(TABLE_HTML)
  await expect(properties).not.toContainText('negrita')
  const description = detail.getByTestId('evidence-description')
  await expect(description).toContainText('negrita')
  await expect(description).not.toContainText('<b>')
  await expect(detail.locator('b')).toHaveText(['negrita'])
  await expect(detail.locator('img, script, iframe')).toHaveCount(0)
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

  // EVENT con propiedades: siempre visibles en el detalle.
  await expect(evidenceRow('Reinicio del proceso')).toContainText('PROCESS_RESTART')
  const event = await item('Reinicio del proceso')
  await expect(event.getByTestId('evidence-more')).toHaveCount(0)
  const properties = event.getByTestId('evidence-properties')
  // Ficha 0001: dt.event.description sale en su sección, no en las propiedades.
  await expect(properties.locator('dt')).toHaveText(['exit.code'])
  await expect(properties.locator('dd')).toHaveText(['137'])
  // CA6 (0043): el <b> de la descripción se interpreta (formato permitido) y no se ve como texto.
  await expect(event.getByTestId('evidence-description')).toContainText('reinicio manual')
  await expect(event.getByTestId('evidence-description')).not.toContainText('<b>')
  await expect(event.locator('b')).toHaveText(['reinicio'])
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
    readFileSync(await exportSaved('problem-page', 'export-xlsx')) as unknown as ArrayBuffer
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

  // Ficha 0030: tras el aviso «Guardado» y con contenido.
  const save = (option: string): Promise<string> => exportSaved(menu, option)

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
  const book = new ExcelJS.Workbook()
  await book.xlsx.load(
    readFileSync(await exportSaved(menu, 'export-xlsx')) as unknown as ArrayBuffer
  )
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
  const csv = readFileSync(await exportSaved('problems-table', 'export-csv'))
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
  const lines = readFileSync(await exportSaved('problems-table', 'export-csv'))
    .subarray(3)
    .toString('utf8')
    .split('\r\n')
    .filter((line) => line !== '')
  expect(lines).toHaveLength(2)
  expect(lines[1]).toContain('P-103')

  // El XLSX filtrado lo dice en Info, con su fila propia.
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(
    readFileSync(await exportSaved('problems-table', 'export-xlsx')) as unknown as ArrayBuffer
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
  const file = await exportSaved('problems-table', 'export-csv')
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
    readFileSync(await exportSaved('problems-table', 'export-xlsx')) as unknown as ArrayBuffer
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
  const lines = readFileSync(await exportSaved('problems-table', 'export-csv'))
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
    readFileSync(await exportSaved('problems-table', 'export-xlsx')) as unknown as ArrayBuffer
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

  const withFooter = await pngInfo(await exportSaved('problems-timeline', 'capture-save'))
  expect(withFooter.width).toBeGreaterThanOrEqual(2 * size.width)
  expect(withFooter.height).toBeGreaterThan(2 * size.height)
  expect(withFooter.cornerAlpha).toBe(255)

  await goTo('settings')
  await expect(page.getByTestId('capture-footer-on')).toBeChecked()
  await page.getByTestId('capture-footer-off').click()
  await goTo('problems')

  const file = await exportSaved('problems-timeline', 'capture-save')
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
      readFileSync(await exportSaved('metric-chart', 'export-xlsx')) as unknown as ArrayBuffer
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

test('CA10 (0001), actualizado por CA6 (0043): el HTML peligroso de la descripción no crea img, script ni iframe ni se ejecuta', async () => {
  await openDescriptionProblem()
  const detail = await expandRow('Descripción con HTML')
  const { section } = descriptionParts(detail)
  // El texto de alrededor se sigue viendo; el HTML peligroso no se crea (ni como elemento ni
  // ejecutándose). Desde la 0043 no se exige verlo como texto.
  await expect(section).toContainText('Texto')
  await expect(section).toContainText('fin')
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
 * Ficha 0035: la descripción (dt.event.description) en todas las evidencias, no solo en EVENT.
 * Problema ABIERTO (P-835) con seis evidencias: un METRIC y un AVAILABILITY_EVIDENCE con
 * descripción en Markdown, un TRANSACTIONAL y un EVENT con una descripción de 12 000 caracteres
 * con un bloque de código YAML, un METRIC sin descripción y un EVENT con solo otra clave con
 * «description» (decisión del Orquestador: claves inventadas, nada del tenant). La OpenAPI solo documenta `data`
 * en EventEvidence; en las demás, la descripción va en el mismo sitio que en vivo
 * (`data.properties[]`), como anota la ficha.
 */
const ALL_ID = 'pd-desc-all'
const ALL_SERVICE = { entityId: { id: 'SERVICE-DA1', type: 'SERVICE' }, name: 'svc-todas' }
const ALL_METRIC_MD = [
  '## Cambio en la métrica',
  '',
  '- **subida** brusca',
  '- revisar `pool`',
  '',
  '> Avisado por el equipo'
].join('\n')
const ALL_AVAILABILITY_MD = '### Host caído\n\n1. reiniciar\n2. comprobar'
/** Fin de la descripción larga: si se ve, ha llegado entera. */
const LONG_END = 'FIN-DE-LA-DESCRIPCION-0035'
const LONG_HEAD = [
  '# Configuración del despliegue',
  '',
  'Antes del bloque.',
  '',
  '```yaml',
  'servicio:',
  '  nombre: pagos',
  '  replicas: 3',
  '```',
  '',
  ''
].join('\n')
const LONG_TAIL = `\n\n${LONG_END}`
/** 12 000 caracteres exactos, con el bloque de código al principio y la marca al final. */
const DESC_12K =
  LONG_HEAD +
  'relleno '.repeat(2000).slice(0, 12_000 - LONG_HEAD.length - LONG_TAIL.length) +
  LONG_TAIL
const ALL_METRIC = 'Métrica con descripción'
const ALL_AVAILABILITY = 'Disponibilidad con descripción'
const ALL_TRANSACTIONAL = 'Transacción con descripción larga'
const ALL_EVENT = 'Evento con descripción larga'
const ALL_PLAIN = 'Métrica sin descripción'
const ALL_OTHER_EVENT = 'Evento con otra descripción'
/** Otras claves con «description» (inventadas) y su Markdown. */
const OTHER_KEY = 'custom.description'
const OTHER_KEY_EVENT = 'Runbook.Description'
const OTHER_MD = '### Pasos\n\n- **reiniciar** el pool\n- avisar al `equipo`'
detailOnly.push({
  problemId: ALL_ID,
  displayId: 'P-835',
  title: 'Problema con descripciones en todas las evidencias',
  status: 'OPEN',
  severityLevel: 'PERFORMANCE',
  impactLevel: 'SERVICES',
  startTime: NOW - 2 * HOUR,
  endTime: -1,
  affectedEntities: [ALL_SERVICE],
  impactedEntities: [],
  managementZones: [],
  problemFilters: [],
  evidenceDetails: {
    totalCount: 6,
    details: [
      {
        evidenceType: 'METRIC',
        displayName: ALL_METRIC,
        entity: ALL_SERVICE,
        rootCauseRelevant: true,
        startTime: NOW - 90 * MIN,
        endTime: -1,
        metricId: 'builtin:service.response.time',
        unit: 'MicroSecond',
        valueBeforeChangePoint: 100_000,
        valueAfterChangePoint: 300_000,
        data: {
          properties: [
            { key: 'paso.0', value: 'valor-0' },
            { key: 'dt.event.description', value: ALL_METRIC_MD },
            { key: OTHER_KEY, value: OTHER_MD },
            { key: 'custom.owner', value: 'equipo-pagos' }
          ]
        }
      },
      {
        evidenceType: 'AVAILABILITY_EVIDENCE',
        displayName: ALL_AVAILABILITY,
        entity: ALL_SERVICE,
        rootCauseRelevant: false,
        startTime: NOW - 85 * MIN,
        endTime: NOW - 80 * MIN,
        data: { properties: [{ key: 'dt.event.description', value: ALL_AVAILABILITY_MD }] }
      },
      {
        evidenceType: 'TRANSACTIONAL',
        displayName: ALL_TRANSACTIONAL,
        entity: ALL_SERVICE,
        rootCauseRelevant: false,
        startTime: NOW - 75 * MIN,
        endTime: NOW - 70 * MIN,
        unit: 'Percent',
        valueBeforeChangePoint: 0,
        valueAfterChangePoint: 12.5,
        data: { properties: [{ key: 'dt.event.description', value: DESC_12K }] }
      },
      descEvent(ALL_EVENT, 35, [{ key: 'dt.event.description', value: DESC_12K }], {
        eventId: 'desc-all-35'
      }),
      {
        evidenceType: 'METRIC',
        displayName: ALL_PLAIN,
        entity: ALL_SERVICE,
        rootCauseRelevant: false,
        startTime: NOW - 65 * MIN,
        endTime: -1,
        metricId: 'builtin:service.errors.total.rate',
        unit: 'Percent',
        valueBeforeChangePoint: 1,
        valueAfterChangePoint: 4
      },
      descEvent(ALL_OTHER_EVENT, 36, [
        { key: OTHER_KEY_EVENT, value: OTHER_MD },
        { key: 'custom.owner', value: 'equipo-pagos' }
      ])
    ]
  }
})

/** Ficha 0035: abre P-835 por URL y espera sus 6 evidencias. */
async function openAllDescriptionsProblem(): Promise<void> {
  await goToRoute(`/problems/${ALL_ID}`)
  await expect(page.getByTestId('problem-page-title')).toContainText('P-835')
  await expect(evidenceRows()).toHaveCount(6)
}

/** Ficha 0035: el texto de la sección no lleva los símbolos de Markdown. */
async function expectRenderedText(section: Locator): Promise<void> {
  const text = await section.innerText()
  expect(text).not.toContain('**')
  expect(text).not.toContain('`')
  expect(text).not.toMatch(/^\s*#/m)
  expect(text).not.toMatch(/^\s*- /m)
}

test('CA4 (0035): una evidencia METRIC con descripción enseña «Descripción» renderizada al desplegarla', async () => {
  await openAllDescriptionsProblem()
  const detail = await expandRow(ALL_METRIC)
  const { section, copy, truncated } = descriptionParts(detail)
  await expect(section).toBeVisible()
  await expect(section).toContainText('Descripción')
  await expect(section.locator('h1, h2, h3, h4, h5, h6')).toHaveText(['Cambio en la métrica'])
  await expect(section.locator('li')).toHaveText(['subida brusca', 'revisar pool'])
  await expect(section.locator('strong')).toHaveText(['subida'])
  await expect(section.locator('code')).toHaveText(['pool'])
  await expect(section.locator('blockquote')).toHaveText('Avisado por el equipo')
  await expectRenderedText(section)
  // Con su «Copiar» y sin nota de recorte (es corta).
  await expect(copy).toBeVisible()
  await expect(truncated).toHaveCount(0)
  // La clave no se repite como propiedad genérica.
  const keys = await detail.locator('[data-testid="evidence-properties"] dt').allInnerTexts()
  expect(keys).not.toContain('dt.event.description')
})

test('CA4 (0035): una evidencia AVAILABILITY_EVIDENCE con descripción también la enseña renderizada', async () => {
  await openAllDescriptionsProblem()
  const { section } = descriptionParts(await expandRow(ALL_AVAILABILITY))
  await expect(section).toBeVisible()
  await expect(section.locator('h1, h2, h3, h4, h5, h6')).toHaveText(['Host caído'])
  await expect(section.locator('ol li')).toHaveText(['reiniciar', 'comprobar'])
  await expectRenderedText(section)
})

test('CA4 (0035): una evidencia que no es EVENT y no trae descripción no tiene la sección', async () => {
  await openAllDescriptionsProblem()
  const detail = await expandRow(ALL_PLAIN)
  await expect(detail.getByTestId('evidence-description')).toHaveCount(0)
  await expect(detail.getByTestId('evidence-description-truncated')).toHaveCount(0)
})

/**
 * Decisión del Orquestador (0035): la sección de otra clave con «description», localizada por su
 * título (la clave) sin atarse a un data-testid: el contenedor más cercano que tiene el título y
 * el Markdown renderizado.
 */
function otherDescription(detail: Locator, key: string): Locator {
  return detail
    .locator('section, div')
    .filter({ has: page.getByText(key, { exact: true }) })
    .filter({ has: page.locator('strong', { hasText: 'reiniciar' }) })
    .last()
}

test('Decisión del Orquestador (0035): otra clave con «description» en un METRIC se pinta como Markdown en su sección, debajo de «Descripción»', async () => {
  await openAllDescriptionsProblem()
  const detail = await expandRow(ALL_METRIC)
  const main = descriptionParts(detail).section
  await expect(main).toBeVisible()

  // Su título es la clave, visible y fuera de la lista de propiedades.
  const title = detail.getByText(OTHER_KEY, { exact: true })
  await expect(title).toBeVisible()
  const section = otherDescription(detail, OTHER_KEY)
  await expect(section).toBeVisible()
  await expect(section.locator('h1, h2, h3, h4, h5, h6')).toHaveText(['Pasos'])
  await expect(section.locator('li')).toHaveText(['reiniciar el pool', 'avisar al equipo'])
  await expect(section.locator('strong')).toHaveText(['reiniciar'])
  await expect(section.locator('code')).toHaveText(['equipo'])
  const text = await section.innerText()
  expect(text).not.toContain('**')
  expect(text).not.toContain('`')
  expect(text).not.toContain('###')
  // Con su «Copiar», como la «Descripción».
  await expect(section.getByRole('button', { name: 'Copiar' })).toHaveCount(1)
  // No está dentro de «Descripción» y va después de ella.
  await expect(main.getByText(OTHER_KEY, { exact: true })).toHaveCount(0)
  await expect(main.locator('strong', { hasText: 'reiniciar' })).toHaveCount(0)
  const after = await main.evaluate(
    (first, second) =>
      second !== null &&
      (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
    await title.elementHandle()
  )
  expect(after).toBe(true)

  // Deja de salir como texto en la lista; la clave sin «description» sigue en ella como texto.
  const properties = detail.getByTestId('evidence-properties')
  const keys = await properties.locator('dt').allInnerTexts()
  expect(keys).not.toContain(OTHER_KEY)
  expect(keys).toContain('custom.owner')
  await expect(properties).toContainText('equipo-pagos')
  await expect(properties).not.toContainText('reiniciar')
})

test('Decisión del Orquestador (0035): en un EVENT sin dt.event.description, otra clave con «Description» (mayúsculas) también se pinta', async () => {
  await openAllDescriptionsProblem()
  const detail = await expandRow(ALL_OTHER_EVENT)
  // Sin dt.event.description no hay «Descripción» principal.
  await expect(detail.getByTestId('evidence-description')).toHaveCount(0)
  await expect(detail.getByText(OTHER_KEY_EVENT, { exact: true })).toBeVisible()
  const section = otherDescription(detail, OTHER_KEY_EVENT)
  await expect(section.locator('h1, h2, h3, h4, h5, h6')).toHaveText(['Pasos'])
  await expect(section.locator('li')).toHaveText(['reiniciar el pool', 'avisar al equipo'])
  expect(await section.innerText()).not.toContain('**')

  const properties = detail.getByTestId('evidence-properties')
  const keys = await properties.locator('dt').allInnerTexts()
  expect(keys).not.toContain(OTHER_KEY_EVENT)
  expect(keys).toContain('custom.owner')
  await expect(properties).toContainText('equipo-pagos')
})

for (const name of [ALL_TRANSACTIONAL, ALL_EVENT]) {
  test(`CA5 (0035): una descripción de 12 000 caracteres con un bloque de código llega y se renderiza (${name})`, async () => {
    expect(DESC_12K).toHaveLength(12_000)
    await openAllDescriptionsProblem()
    const { section, truncated } = descriptionParts(await expandRow(name))
    await expect(section).toBeVisible()
    await expect(section.locator('h1, h2, h3, h4, h5, h6')).toHaveText([
      'Configuración del despliegue'
    ])
    // El bloque de código YAML, como bloque y sin las vallas.
    const block = section.locator('pre')
    await expect(block).toHaveCount(1)
    await expect(block).toContainText('servicio:')
    await expect(block).toContainText('replicas: 3')
    expect(await section.innerText()).not.toContain('```')
    if (MAX_DESCRIPTION_LENGTH >= DESC_12K.length) {
      // El límite lo permite: llega entera, con su final y sin nota de recorte.
      await expect(section).toContainText(LONG_END)
      await expect(truncated).toHaveCount(0)
    } else {
      await expect(section).not.toContainText(LONG_END)
      await expect(truncated).toBeVisible()
    }
  })
}

/**
 * Ficha 0038: «Copiar» de cada bloque de código. Usa el bloque YAML de la descripción larga de
 * P-835 (fixture de la 0035). Contrato elegido al escribir los tests (anotado en la ficha): el
 * bloque es `data-testid="md-code-block"`, su botón `md-code-copy` (texto «Copiar») y
 * el aviso `md-code-copy-status` con `errorScreen.copied`, como el «Copiar» de la descripción.
 */
const YAML_BLOCK_CODE = 'servicio:\n  nombre: pagos\n  replicas: 3'

test('CA2 (0038): «Copiar» de un bloque copia su código exacto, sin los números de línea, y avisa', async () => {
  // Va en views porque es el spec que usa el portapapeles del sistema.
  await openAllDescriptionsProblem()
  const { section } = descriptionParts(await expandRow(ALL_EVENT))
  const block = section.getByTestId('md-code-block')
  await expect(block).toHaveCount(1)
  await block.scrollIntoViewIfNeeded()
  const copy = block.getByTestId('md-code-copy')
  const status = block.getByTestId('md-code-copy-status')
  await expect(copy).toHaveText('Copiar')
  await expect(status).toHaveCount(0)
  // Los números de línea se ven en el bloque (uno por línea)...
  await expect(block.locator('[data-line-number]')).toHaveText(['1', '2', '3'])

  await clearClipboard()
  await copy.click()
  await expect(status).toHaveText(es.errorScreen.copied)
  // ...pero no van al portapapeles: solo el código del bloque, ni la descripción entera.
  expect(await clipboardText()).toBe(YAML_BLOCK_CODE)
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

// Ficha 0018: la página del HOST ya no está en construcción; el bloque «Página en construcción»
// con el faro se sigue comprobando en los tipos que lo conservan (CA7 de la 0008).
test('CA2 (0003): «Analizar entidad» en una evidencia HOST lleva a #/entities/HOST/<id> con su página', async () => {
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

// Ficha 0018: la página del HOST ya pide sus métricas y sus problemas; lo que no puede hacer es
// volver a pedir el detalle del problema del que viene.
test('CA8 (0003): mientras está en la página de entidad, el simulador no recibe más peticiones que las de sus canales (ninguna en construcción)', async () => {
  await openEntityProblem()
  await expandRow(ENT_EV_HOST)
  const before = await settledRequests()
  await analyzeButton(await detailOf(evidenceRow(ENT_EV_HOST))).click()
  await expect(page.getByTestId('entity-page-host')).toBeVisible()
  // Un rato en la página (y lo que tarde en pintarse): solo los canales del host.
  await page.waitForTimeout(1500)
  for (const request of sim.requests.slice(before)) {
    expect(request, 'peticiones en la página del host').toMatch(
      /^GET \/api\/v2\/(metrics\/query|problems)$/
    )
  }

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

test('CA7 (0046): entities:serviceMetrics por IPC con un servicio de cada conjunto: entidad primero y las métricas de su conjunto', async () => {
  const setKeys: Record<SvcSet, string[]> = {
    server: [
      'builtin:service.response.server',
      'builtin:service.errors.server.count',
      'builtin:service.errors.server.rate',
      'builtin:service.requestCount.server'
    ],
    client: [
      'builtin:service.response.client',
      'builtin:service.errors.client.count',
      'builtin:service.errors.client.rate',
      'builtin:service.requestCount.client'
    ],
    unified: [SVC_UNIFIED_KEYS.time, SVC_UNIFIED_KEYS.errors, SVC_UNIFIED_KEYS.requests],
    activity: ['builtin:service.response.server']
  }
  const series = (values: (number | null)[]): { timestamps: number[]; values: unknown[] } => ({
    timestamps: SVC_TIMESTAMPS,
    values
  })
  const expected: Record<SvcSet, Record<string, unknown>> = {
    server: {
      series: { requests: series([50, 40, null, 60]), errors: series([5, 0, null, 10]) },
      totals: { requests: 150, errors: 15, responseTime: { median: 105 } }
    },
    client: {
      series: {
        responseTime: { median: series([200, 210, null, 220]) },
        requests: series([30, 20, null, 10]),
        errorRate: series([10, 0, null, 10])
      },
      totals: { requests: 60, errors: 4, ok: 56, responseTime: { median: 210 } }
    },
    unified: {
      series: {
        // Ya en ms: sin dividir.
        responseTime: { median: series([150, 160, null, 170]) },
        requests: series([40, 10, null, 50]),
        errors: series([4, 0, null, 5]),
        ok: series([36, 10, null, 45]),
        // Calculada en main: fallidas / total × 100.
        errorRate: series([10, 0, null, 10])
      },
      totals: { requests: 100, errors: 9, ok: 91, errorRate: 9, responseTime: { median: 160 } }
    },
    activity: {
      series: {
        responseTime: null,
        requests: series([7, 0, null, 3]),
        errors: null,
        ok: null,
        errorRate: null
      },
      totals: { requests: 10, errors: null, ok: null, errorRate: null, responseTime: null }
    }
  }

  for (const set of Object.keys(SVC_SET_IDS) as SvcSet[]) {
    const id = SVC_SET_IDS[set]
    const entityBefore = sim.serviceEntityQueries.length
    const metricsBefore = sim.serviceMetricQueries.length
    const requestsBefore = sim.requests.length
    const data = await invoke<Record<string, unknown>>('entities:serviceMetrics', {
      environmentId: env['Producción'],
      entityId: id,
      timeRange: '2h'
    })

    // Una petición a la entidad, con los fields de la ficha, antes de las métricas.
    const entityQueries = sim.serviceEntityQueries.slice(entityBefore)
    expect(entityQueries, set).toHaveLength(1)
    const [entityId, fields] = (entityQueries[0] ?? '').split(' ')
    expect(entityId, set).toBe(id)
    for (const field of [
      '+properties.serviceType',
      '+properties.webServerName',
      '+properties.remoteEndpoint',
      '+properties.remoteServiceName'
    ]) {
      expect((fields ?? '').split(','), `${set}: ${field}`).toContain(field)
    }
    const calls = sim.requests.slice(requestsBefore)
    expect(calls[0], `${set}: la primera petición es la entidad`).toBe(`GET /api/v2/entities/${id}`)

    // Las consultas, solo con las métricas del conjunto (todas) y nunca más de 10 expresiones.
    const queries = sim.serviceMetricQueries.slice(metricsBefore)
    expect(queries.length, set).toBeGreaterThan(0)
    const used = new Set<string>()
    for (const query of queries) {
      const expressions = splitSelector(query.get('metricSelector') ?? '')
      expect(expressions.length, set).toBeLessThan(11)
      for (const expression of expressions) used.add(serviceMetricKey(expression))
    }
    expect([...used].sort(), set).toEqual([...setKeys[set]].sort())

    expect(data, set).toMatchObject({
      serviceType: SVC_SET_ENTITY[set].serviceType,
      metricSet: set,
      warnings: [],
      ...expected[set]
    })
  }
})

test('CA7 (0046): entities:serviceMetrics sin entities.read: entidad con 403, conjunto Servidor y aviso', async () => {
  const tenants = await invoke<{ clients: { id: string; name: string }[] }>('tenants:list')
  const clientId = tenants.clients.find((client) => client.name === 'Cliente A')?.id ?? ''
  const noEntities = await createEnvironment(
    clientId,
    'Sin entidades 0046',
    'other',
    TOKEN_NO_ENTITIES
  )
  try {
    await invoke('connection:test', { environmentId: noEntities })
    const data = await invoke<Record<string, unknown>>('entities:serviceMetrics', {
      environmentId: noEntities,
      entityId: SVC_SET_IDS.server,
      timeRange: '2h'
    })
    expect(data).toMatchObject({
      serviceType: null,
      metricSet: 'server',
      series: { requests: { timestamps: SVC_TIMESTAMPS, values: [50, 40, null, 60] } }
    })
    expect((data['warnings'] as string[]).length).toBeGreaterThan(0)
  } finally {
    await invoke('environments:delete', { id: noEntities })
  }
})

test('CA7 (0016): entities:hostMetrics por IPC con un id inventado: consultas, series y totales', async () => {
  const data = await invoke<Record<string, unknown>>('entities:hostMetrics', {
    environmentId: env['Producción'],
    entityId: HOST_METRICS_ID,
    timeRange: '2h'
  })
  // Series (una o más consultas, ficha 0039) y marcadores con Inf (una), todas con el rango
  // global y ninguna con más de 10 expresiones.
  expect(hostMetricCalls()).toBe(1)
  expect(sim.hostMetricQueries.length).toBeGreaterThanOrEqual(2)
  expectHostQueriesWithinLimit()
  for (const query of sim.hostMetricQueries) expect(query.get('from')).toBe('now-2h')
  expect(
    [...new Set(sim.hostMetricQueries.map((q) => q.get('resolution') ?? 'API'))].sort()
  ).toEqual(['API', 'Inf'])

  const series = (values: (number | null)[]): { timestamps: number[]; values: unknown[] } => ({
    timestamps: HOST_TIMESTAMPS,
    values
  })
  expect(data).toMatchObject({
    resolution: '1m',
    series: {
      cpu: series([12, null, 48]),
      cpuBreakdown: {
        user: series([8, null, 30]),
        system: series([3, null, 15]),
        iowait: series([1, null, 3])
      },
      memory: series([50, null, 62.5]),
      // Todas las interfaces sumadas (bits/s) y el disco más lleno en cada punto (%).
      network: { in: series([2000, null, 5000]), out: series([400, null, 900]) },
      disk: series([81, null, 91])
    },
    totals: {
      cpu: { avg: 33.5, max: 95 },
      // Usada y total del último punto con dato, en bytes.
      memory: { avg: 57, used: 10_000_000_000, total: 16_000_000_000 },
      network: { in: 3600, out: 650 },
      disk: { max: 92 },
      load: { avg: 2.25 }
    },
    warnings: [],
    partial: []
  })
})

test('CA6 (0022): entities:monitorMetrics por IPC con ids inventados de browser y HTTP monitor', async () => {
  const series = (values: (number | null)[]): { timestamps: number[]; values: unknown[] } => ({
    timestamps: MONITOR_TIMESTAMPS,
    values
  })

  const browser = await invoke<Record<string, unknown>>('entities:monitorMetrics', {
    environmentId: env['Producción'],
    entityId: MONITOR_BROWSER_ID,
    timeRange: '2h'
  })
  // Dos consultas al simulador (series y marcadores con Inf), las dos con el rango global y
  // solo con el catálogo de su tipo.
  expect(sim.monitorMetricQueries).toHaveLength(2)
  for (const query of sim.monitorMetricQueries) {
    expect(query.get('from')).toBe('now-2h')
    expect(query.get('metricSelector') ?? '').not.toContain('builtin:synthetic.http.')
  }
  expect(sim.monitorMetricQueries.map((q) => q.get('resolution') ?? 'API').sort()).toEqual([
    'API',
    'Inf'
  ])
  expect(browser).toMatchObject({
    kind: 'browser',
    resolution: '10m',
    series: {
      availability: series([100, null, 50]),
      duration: series([4200, null, 4800]),
      executions: { ok: series([3, null, 1]), failed: series([0, null, 1]) },
      performance: {
        largestContentfulPaint: series([1900, null, 2300]),
        visuallyComplete: series([2500, null, 2900]),
        cumulativeLayoutShift: series([0.05, null, 0.2]),
        speedIndex: series([1600, null, 1800])
      },
      httpTimings: null
    },
    totals: {
      availability: 87.5,
      duration: { avg: 4550, median: 4400 },
      executions: { ok: 4, failed: 1 }
    },
    warnings: [],
    partial: []
  })

  const http = await invoke<Record<string, unknown>>('entities:monitorMetrics', {
    environmentId: env['Producción'],
    entityId: MONITOR_HTTP_ID,
    timeRange: '2h'
  })
  expect(sim.monitorMetricQueries).toHaveLength(4)
  for (const query of sim.monitorMetricQueries.slice(2)) {
    expect(query.get('from')).toBe('now-2h')
    expect(query.get('metricSelector') ?? '').not.toContain('builtin:synthetic.browser.')
  }
  expect(http).toMatchObject({
    kind: 'http',
    resolution: '10m',
    series: {
      // Todas las localizaciones juntas.
      availability: series([100, null, 75]),
      duration: series([280, null, 350]),
      executions: { ok: series([6, null, 4]), failed: series([0, null, 2]) },
      httpTimings: {
        dns: series([3, null, 5]),
        tcpConnect: series([10, null, 12]),
        tlsHandshake: series([20, null, 25]),
        timeToFirstByte: series([120, null, 160])
      },
      performance: null
    },
    // Sin mediana en HTTP (paso 0 de la ficha).
    totals: {
      availability: 92.5,
      duration: { avg: 310, median: null },
      executions: { ok: 10, failed: 2 }
    },
    warnings: [],
    partial: []
  })
})

test('CA6 (0027): entities:processMetrics por IPC con un id inventado: dos consultas, series por papel y marcadores', async () => {
  const data = await invoke<Record<string, unknown>>('entities:processMetrics', {
    environmentId: env['Producción'],
    entityId: PROCESS_METRICS_ID,
    timeRange: '2h'
  })
  // Dos consultas al simulador (series y marcadores con Inf), acotadas al proceso y con el rango.
  expect(sim.processMetricQueries).toHaveLength(2)
  for (const query of sim.processMetricQueries) {
    expect(query.get('from')).toBe('now-2h')
    expect(query.get('entitySelector')).toBe(`entityId("${PROCESS_METRICS_ID}")`)
  }
  expect(sim.processMetricQueries.map((q) => q.get('resolution') ?? 'API').sort()).toEqual([
    'API',
    'Inf'
  ])
  // Red en las dos consultas; salud de red, solo en la de series.
  const selectorOf = (resolution: string | null): string =>
    sim.processMetricQueries
      .find((q) => q.get('resolution') === resolution)
      ?.get('metricSelector') ?? ''
  expect(selectorOf(null)).toContain('builtin:tech.generic.network.bytesRx')
  expect(selectorOf(null)).toContain('builtin:tech.generic.network.packets.retransmission')
  expect(selectorOf('Inf')).toContain('builtin:tech.generic.network.bytesTx:avg')
  expect(selectorOf('Inf')).not.toContain('retransmission')

  const series = (values: (number | null)[]): { timestamps: number[]; values: unknown[] } => ({
    timestamps: PROCESS_TIMESTAMPS,
    values
  })
  expect(data).toMatchObject({
    resolution: '10m',
    series: {
      cpu: series([8, null, 22.5]),
      memory: series([300_000_000, null, 320_000_000]),
      availability: series([100, null, 50]),
      resources: series([0.5, null, 0.8]),
      network: { in: series([4_096, null, 1_024.5]), out: series([512, 256, null]) },
      networkHealth: series([0.5, null, 2])
    },
    totals: {
      cpu: { avg: 15.25, max: 91 },
      memory: { avg: 310_000_000, max: 330_000_000 },
      network: { in: 2_560, out: 384 },
      availability: 83.5,
      resources: 0.9
    },
    warnings: [],
    partial: []
  })
})

test('CA6 (0031): entities:processGroupMetrics por IPC con ids inventados: dos consultas, total del grupo e instancias', async () => {
  const data = await invoke<Record<string, unknown>>('entities:processGroupMetrics', {
    environmentId: env['Producción'],
    entityId: PROCESS_GROUP_ID,
    timeRange: '2h'
  })
  // Dos consultas al simulador (series y marcadores con Inf), con el selector de las instancias
  // del grupo y con el rango.
  expect(sim.processGroupMetricQueries).toHaveLength(2)
  for (const query of sim.processGroupMetricQueries) {
    expect(query.get('from')).toBe('now-2h')
    expect(query.get('entitySelector')).toBe(PROCESS_GROUP_SELECTOR)
  }
  expect(sim.processGroupMetricQueries.map((q) => q.get('resolution') ?? 'API').sort()).toEqual([
    'API',
    'Inf'
  ])
  // Las medias por instancia, solo en la de marcadores.
  const selectorOf = (resolution: string | null): string =>
    sim.processGroupMetricQueries
      .find((q) => q.get('resolution') === resolution)
      ?.get('metricSelector') ?? ''
  expect(selectorOf(null)).not.toContain(PROCESS_GROUP_BY_INSTANCE)
  expect(selectorOf('Inf')).toContain(`builtin:tech.generic.cpu.usage${PROCESS_GROUP_BY_INSTANCE}`)

  const series = (values: (number | null)[]): { timestamps: number[]; values: unknown[] } => ({
    timestamps: PROCESS_TIMESTAMPS,
    values
  })
  const [one, two] = PROCESS_GROUP_INSTANCES
  expect(data).toMatchObject({
    resolution: '10m',
    series: {
      cpu: series([18, null, 112.5]),
      memory: series([900_000_000, null, 950_000_000]),
      network: { in: series([8_192, null, 2_048.5]), out: series([1_024, 512, null]) }
    },
    totals: {
      // La máxima, de la serie del total.
      cpu: { avg: 64.5, max: 112.5 },
      memory: { avg: 925_000_000 },
      network: { in: 5_120, out: 768 }
    },
    // Por CPU media, de más a menos.
    instances: {
      items: [
        {
          id: two!.id,
          name: two!.name,
          hostId: two!.hostId,
          hostName: two!.hostName,
          cpu: 44,
          memory: 525_000_000
        },
        {
          id: one!.id,
          name: one!.name,
          hostId: one!.hostId,
          hostName: one!.hostName,
          cpu: 20.5,
          memory: 400_000_000
        }
      ],
      total: 2
    },
    warnings: [],
    partial: []
  })
})

test('CA6 (0050): entities:processGroupMetrics de un grupo de 30 instancias: las 20 de más CPU y el total real', async () => {
  const data = await invoke<{ instances: Record<string, unknown> }>(
    'entities:processGroupMetrics',
    { environmentId: env['Producción'], entityId: PROCESS_GROUP_MANY_ID, timeRange: '2h' }
  )
  // La CPU por instancia, ordenada y limitada a 20 en la consulta de marcadores (Inf).
  const markers =
    sim.processGroupMetricQueries
      .find((q) => q.get('resolution') === 'Inf')
      ?.get('metricSelector') ?? ''
  expect(markers).toContain(
    `builtin:tech.generic.cpu.usage${PROCESS_GROUP_BY_INSTANCE}:sort(value(avg,descending)):limit(20)`
  )
  // El total, de totalCount de /entities con el selector del grupo.
  expect(sim.processGroupEntityQueries).toHaveLength(1)
  expect(sim.processGroupEntityQueries[0]?.get('pageSize')).toBe('1')
  expect(data.instances).toEqual({
    items: byCpu(PROCESS_GROUP_MANY_INSTANCES).slice(0, 20).map(pgItem),
    total: 30,
    totalKnown: true
  })
})

test('CA6 (0050): entities:processGroupMetrics de un grupo recortado: 20 instancias, total real y partial', async () => {
  const data = await invoke<{ instances: Record<string, unknown>; partial: unknown[] }>(
    'entities:processGroupMetrics',
    { environmentId: env['Producción'], entityId: PROCESS_GROUP_CUT_ID, timeRange: '2h' }
  )
  expect(data.instances).toEqual({
    items: byCpu(PROCESS_GROUP_CUT_INSTANCES).slice(0, 20).map(pgItem),
    total: PROCESS_GROUP_CUT_TOTAL,
    totalKnown: true
  })
  expect(data.partial.length).toBeGreaterThan(0)
})

test('CA6 (0050): entities:processGroupInstances del grupo de 30: la lista completa por CPU, sin recorte', async () => {
  const data = await invoke<Record<string, unknown>>('entities:processGroupInstances', {
    environmentId: env['Producción'],
    entityId: PROCESS_GROUP_MANY_ID,
    timeRange: '2h'
  })
  // Una consulta de métricas con Inf, con el selector del grupo y el rango, y una a /entities.
  expect(sim.processGroupMetricQueries).toHaveLength(1)
  const query = sim.processGroupMetricQueries[0]
  expect(query?.get('resolution')).toBe('Inf')
  expect(query?.get('entitySelector')).toBe(processGroupSelector(PROCESS_GROUP_MANY_ID))
  expect(query?.get('from')).toBe('now-2h')
  expect(sim.processGroupEntityQueries).toHaveLength(1)
  expect(data).toMatchObject({
    items: byCpu(PROCESS_GROUP_MANY_INSTANCES).map(pgItem),
    total: 30,
    truncated: false
  })
})

test('CA6 (0050): entities:processGroupInstances de un grupo recortado: truncated y el total real', async () => {
  const data = await invoke<Record<string, unknown>>('entities:processGroupInstances', {
    environmentId: env['Producción'],
    entityId: PROCESS_GROUP_CUT_ID,
    timeRange: '2h'
  })
  expect(data).toMatchObject({
    items: byCpu(PROCESS_GROUP_CUT_INSTANCES).map(pgItem),
    total: PROCESS_GROUP_CUT_TOTAL,
    truncated: true
  })
})

test('CA6 (0033): entities:applicationMetrics por IPC con ids inventados: tres consultas, series, totales y las 10 acciones', async () => {
  const data = await invoke<Record<string, unknown>>('entities:applicationMetrics', {
    environmentId: env['Producción'],
    entityId: APPLICATION_METRICS_ID,
    timeRange: '2h'
  })
  // Tres consultas al simulador, todas con el rango: series y totales (Inf) con entityId de la
  // aplicación, y las acciones (Inf) con el selector de sus acciones.
  expect(sim.applicationMetricQueries).toHaveLength(3)
  for (const query of sim.applicationMetricQueries) expect(query.get('from')).toBe('now-2h')
  const app = sim.applicationMetricQueries.filter(
    (q) => q.get('entitySelector') === APPLICATION_SELECTOR
  )
  expect(app.map((q) => q.get('resolution') ?? 'API').sort()).toEqual(['API', 'Inf'])
  const actions = sim.applicationMetricQueries.filter(
    (q) => q.get('entitySelector') === APPLICATION_METHODS_SELECTOR
  )
  expect(actions).toHaveLength(1)
  expect(actions[0]?.get('resolution')).toBe('Inf')
  expect(actions[0]?.get('metricSelector')).toContain(
    `builtin:apps.web.action.duration.xhr.browser${APPLICATION_TOP}:count:names`
  )

  const series = (values: (number | null)[]): { timestamps: number[]; values: unknown[] } => ({
    timestamps: PROCESS_TIMESTAMPS,
    values
  })
  const [load] = APPLICATION_ACTIONS['load']!
  const [catalog, cart] = APPLICATION_ACTIONS['xhr']!
  expect(data).toMatchObject({
    resolution: '10m',
    series: {
      apdex: series([0.95, null, 0.81]),
      actions: series([60, 75, null]),
      duration: series([1_200, null, 1_640.5]),
      errors: series([2, null, 5]),
      sessions: series([8, 11, null])
    },
    totals: { apdex: 0.88, actions: 135, duration: 1_420.75, errors: 7, sessions: 19 },
    // Las de los tres tipos juntas, de más a menos recuento.
    topActions: [
      { id: catalog!.id, name: catalog!.name, count: 140, duration: 320.5 },
      { id: load!.id, name: load!.name, count: 90, duration: 1_510 },
      { id: cart!.id, name: cart!.name, count: 25, duration: 410 }
    ],
    warnings: [],
    partial: []
  })
})

test('CA5 (0052): entities:applicationRum por IPC con ids inventados: solo métricas clásicas, de 10 en 10, series y totales por papel', async () => {
  const data = await invoke<Record<string, unknown>>('entities:applicationRum', {
    environmentId: env['Producción'],
    entityId: APPLICATION_METRICS_ID,
    timeRange: '2h'
  })
  // Las consultas llegan al simulador (métricas clásicas), con el id, el rango y como mucho 10
  // expresiones; cada expresión, una vez en las series y otra en los totales (Inf).
  const queries = sim.applicationMetricQueries
  expect(queries.length).toBeGreaterThanOrEqual(4)
  const expressions = (inf: boolean): string[] =>
    queries
      .filter((q) => (q.get('resolution') === 'Inf') === inf)
      .flatMap((q) => splitSelector(q.get('metricSelector') ?? ''))
      .sort()
  const expected = [
    ...Object.keys(APPLICATION_RUM),
    RUM_ERRORS,
    `${RUM_W}actionCount.custom.browser:splitBy():sum`,
    `${RUM_W}actionDuration.custom.browser:splitBy():avg`,
    `${RUM_W}event.count.rageClick:splitBy():sum`
  ].sort()
  expect(expressions(false)).toEqual(expected)
  expect(expressions(true)).toEqual(expected)
  for (const query of queries) {
    expect(query.get('entitySelector')).toBe(APPLICATION_SELECTOR)
    expect(query.get('from')).toBe('now-2h')
    expect(splitSelector(query.get('metricSelector') ?? '').length).toBeLessThanOrEqual(
      METRIC_SELECTOR_MAX
    )
  }

  const rum = (expression: string): { timestamps: number[]; values: unknown[] } => ({
    timestamps: PROCESS_TIMESTAMPS,
    values: APPLICATION_RUM[`${RUM_W}${expression}`]!.series
  })
  const total = (expression: string): number => APPLICATION_RUM[`${RUM_W}${expression}`]!.total
  const none = { timestamps: [], values: [] }
  expect(data).toMatchObject({
    resolution: '10m',
    series: {
      actionsByType: {
        load: rum('actionCount.load.browser:splitBy():sum'),
        xhr: rum('actionCount.xhr.browser:splitBy():sum'),
        custom: none
      },
      durationByType: {
        load: rum('actionDuration.load.browser:splitBy():avg'),
        xhr: rum('actionDuration.xhr.browser:splitBy():avg'),
        custom: none
      },
      errorsByType: {
        javascript: { timestamps: PROCESS_TIMESTAMPS, values: [1, null, 4] },
        http: { timestamps: PROCESS_TIMESTAMPS, values: [6, 3, null] },
        other: none
      },
      affectedActionsPct: rum('percentageOfUserActionsAffectedByErrors:splitBy()'),
      activeUsers: rum('activeUsersEst:splitBy()'),
      sessions: {
        started: rum('startedSessions:splitBy():sum'),
        ended: rum('endedSessions:splitBy():sum')
      },
      sessionDuration: rum('sessionDuration:splitBy():avg'),
      actionsPerSession: rum('actionsPerSession:splitBy():avg'),
      bounceRate: rum('bouncedSessionRatio:splitBy()'),
      vitals: {
        lcp: rum('largestContentfulPaint.load.browser:splitBy():percentile(75)'),
        cls: rum('cumulativeLayoutShift.load.browser:splitBy():percentile(75)'),
        inp: rum('interactionToNextPaint:splitBy():percentile(75)')
      },
      rageClicks: none
    },
    totals: {
      actionsByType: {
        load: total('actionCount.load.browser:splitBy():sum'),
        xhr: total('actionCount.xhr.browser:splitBy():sum'),
        custom: null
      },
      durationByType: {
        load: total('actionDuration.load.browser:splitBy():avg'),
        xhr: total('actionDuration.xhr.browser:splitBy():avg'),
        custom: null
      },
      errorsByType: { javascript: 5, http: 9, other: null },
      affectedActionsPct: total('percentageOfUserActionsAffectedByErrors:splitBy()'),
      activeUsers: total('activeUsersEst:splitBy()'),
      sessions: {
        started: total('startedSessions:splitBy():sum'),
        ended: total('endedSessions:splitBy():sum')
      },
      sessionDuration: total('sessionDuration:splitBy():avg'),
      actionsPerSession: total('actionsPerSession:splitBy():avg'),
      bounceRate: total('bouncedSessionRatio:splitBy()'),
      vitals: {
        lcp: total('largestContentfulPaint.load.browser:splitBy():percentile(75)'),
        cls: total('cumulativeLayoutShift.load.browser:splitBy():percentile(75)'),
        inp: total('interactionToNextPaint:splitBy():percentile(75)')
      },
      rageClicks: null
    }
  })
})

test('CA5 (0052): entities:applicationRum con un 400 del simulador acaba en error con reason', async () => {
  sim.applicationMetricsFail = true
  // invoke lanza con el error del sobre: lleva el reason de la 0033.
  await expect(
    invoke('entities:applicationRum', {
      environmentId: env['Producción'],
      entityId: APPLICATION_METRICS_ID,
      timeRange: '2h'
    })
  ).rejects.toThrow(/"key":"applicationMetricsRejected"/)
})

test('CA5 (0023): entities:monitorBreakdown por IPC con ids inventados de browser y HTTP monitor', async () => {
  const browser = await invoke<Record<string, unknown>>('entities:monitorBreakdown', {
    environmentId: env['Producción'],
    entityId: BREAKDOWN_BROWSER_ID,
    timeRange: '2h'
  })
  // Las consultas llegan al simulador, con el rango global y solo con el catálogo de su tipo.
  expect(sim.monitorBreakdownQueries.length).toBeGreaterThan(0)
  const browserQueries = sim.monitorBreakdownQueries.length
  for (const query of sim.monitorBreakdownQueries) {
    expect(query.get('from')).toBe('now-2h')
    expect(query.get('resolution')).toBe('Inf')
    expect(query.get('metricSelector') ?? '').not.toContain('builtin:synthetic.http.')
  }
  expect(browser).toMatchObject({
    // De peor a mejor disponibilidad; el browser monitor no tiene fallidas por localización.
    locations: [
      {
        id: breakdownLocation(2),
        name: 'Localización dos',
        availability: 80,
        duration: 6300,
        failed: null
      },
      {
        id: breakdownLocation(3),
        name: breakdownLocation(3),
        availability: 97.5,
        duration: 5200,
        failed: null
      },
      {
        id: breakdownLocation(1),
        name: 'Localización uno',
        availability: 100,
        duration: 4100,
        failed: null
      }
    ],
    // Por duración (la dimensión no trae número de secuencia), con su peso en el total.
    steps: [
      {
        id: breakdownStep('SYNTHETIC_TEST_STEP', 2),
        name: 'Paso dos',
        duration: 2500,
        share: 62.5
      },
      { id: breakdownStep('SYNTHETIC_TEST_STEP', 1), name: 'Paso uno', duration: 1000, share: 25 },
      { id: breakdownStep('SYNTHETIC_TEST_STEP', 3), name: 'Paso tres', duration: 500, share: 12.5 }
    ]
  })
  expect((browser['locations'] as unknown[]).length).toBe(3)
  expect((browser['steps'] as unknown[]).length).toBe(3)

  const http = await invoke<Record<string, unknown>>('entities:monitorBreakdown', {
    environmentId: env['Producción'],
    entityId: BREAKDOWN_HTTP_ID,
    timeRange: '2h'
  })
  expect(sim.monitorBreakdownQueries.length).toBeGreaterThan(browserQueries)
  for (const query of sim.monitorBreakdownQueries.slice(browserQueries)) {
    expect(query.get('from')).toBe('now-2h')
    expect(query.get('resolution')).toBe('Inf')
    expect(query.get('metricSelector') ?? '').not.toContain('builtin:synthetic.browser.')
  }
  expect(http).toMatchObject({
    locations: [
      {
        id: breakdownLocation(3),
        name: 'Localización tres',
        availability: 90,
        duration: 420,
        failed: 4
      },
      {
        id: breakdownLocation(1),
        name: 'Localización uno',
        availability: 99,
        duration: 310,
        failed: 1
      },
      // Sin serie de FAILURE: 0 fallidas.
      {
        id: breakdownLocation(2),
        name: 'Localización dos',
        availability: 100,
        duration: 250,
        failed: 0
      }
    ],
    steps: [
      { id: breakdownStep('HTTP_CHECK_STEP', 3), name: 'Petición tres', duration: 200, share: 50 },
      { id: breakdownStep('HTTP_CHECK_STEP', 2), name: 'Petición dos', duration: 120, share: 30 },
      { id: breakdownStep('HTTP_CHECK_STEP', 1), name: 'Petición uno', duration: 80, share: 20 }
    ]
  })
  expect((http['locations'] as unknown[]).length).toBe(3)
  expect((http['steps'] as unknown[]).length).toBe(3)
})

test('CA6 (0017): entities:hostBreakdown por IPC con un id inventado: discos por uso y los 10 procesos con más CPU', async () => {
  const data = await invoke<{
    disks: Record<string, unknown>[]
    processes: { items: Record<string, unknown>[]; total: number }
  }>('entities:hostBreakdown', {
    environmentId: env['Producción'],
    entityId: BREAKDOWN_HOST_ID,
    timeRange: '2h'
  })
  // Las consultas llegan al simulador, todas con el rango global.
  expect(sim.hostBreakdownQueries.length).toBeGreaterThan(0)
  for (const query of sim.hostBreakdownQueries) expect(query.get('from')).toBe('now-2h')

  // Discos del más lleno al menos, con su nombre de dimensionMap.
  expect(data.disks).toMatchObject([
    {
      id: 'DISK-00000000000E2E02',
      name: '/datos',
      usedPct: { last: 88, max: 90 },
      used: 880_000_000_000,
      avail: 120_000_000_000,
      read: 8000,
      write: 2000
    },
    {
      id: 'DISK-00000000000E2E01',
      name: '/',
      usedPct: { last: 40, max: 44 },
      used: 40_000_000_000,
      avail: 60_000_000_000,
      read: 300,
      write: 400
    }
  ])

  // Los 10 con más CPU media de los 12, de más a menos; el 5 (sin nombre) con su id.
  const top = BREAKDOWN_PROCESSES.slice()
    .sort((a, b) => b.cpu.avg - a.cpu.avg)
    .slice(0, 10)
  expect(top.map((p) => p.cpu.avg)).toEqual([55, 30, 26, 18, 14, 11, 9, 7, 4, 3])
  expect(data.processes.items).toMatchObject(
    top.map((p) => ({
      id: p.id,
      name: p.name ?? p.id,
      cpu: { avg: p.cpu.avg, max: p.cpu.max },
      memory: p.memory.avg
    }))
  )
  expect(data.processes.total).toBe(12)
})

test('CA8 (0014): entities:get y entities:names por IPC con ids inventados: lo que pide main y lo que llega del simulador', async () => {
  // entities:get: una petición a /entities/{id} con los fields de la ficha.
  const data = await invoke<{
    properties: { key: string; text: string }[]
    relationships: {
      direction: string
      name: string
      entities: { id: string; type: string }[]
      total: number
    }[]
  }>('entities:get', { environmentId: env['Producción'], entityId: ENTITY_INFO_ID })
  expect(sim.entityInfoQueries).toHaveLength(1)
  expect((sim.entityInfoQueries[0]?.get('fields') ?? '').split(',').sort()).toEqual(
    [
      '+properties',
      '+tags',
      '+managementZones',
      '+fromRelationships',
      '+toRelationships',
      '+firstSeenTms',
      '+lastSeenTms',
      '+icon'
    ].sort()
  )
  expect(data).toMatchObject({
    displayName: 'pagos-e2e',
    type: 'SERVICE',
    firstSeen: ENTITY_INFO_FIRST_SEEN,
    lastSeen: ENTITY_INFO_LAST_SEEN,
    iconType: 'java',
    managementZones: ['Zona e2e'],
    // Ficha 0037: las etiquetas llegan separadas en contexto, clave y valor.
    tags: [{ context: 'CONTEXTLESS', key: 'equipo', value: 'pagos' }]
  })
  expect(data.properties.map((p) => p.key)).toEqual(['serviceType', 'port', 'webServiceName'])
  expect(data.properties[0]?.text).toBe('WEB_REQUEST_SERVICE')
  expect(data.properties[1]?.text).toBe('8443')
  expect(data.properties[2]?.text).toHaveLength(300)
  const relation = (direction: string, name: string): unknown =>
    data.relationships.find((r) => r.direction === direction && r.name === name)
  expect(data.relationships).toHaveLength(3)
  expect(relation('from', 'calls')).toEqual({
    direction: 'from',
    name: 'calls',
    entities: ENTITY_INFO_CALLS.slice(0, 50),
    total: 55
  })
  expect(relation('from', 'runsOnHost')).toEqual({
    direction: 'from',
    name: 'runsOnHost',
    entities: [{ id: ENTITY_INFO_HOST, type: 'HOST' }],
    total: 1
  })
  expect(relation('to', 'isServiceMethodOfService')).toEqual({
    direction: 'to',
    name: 'isServiceMethodOfService',
    entities: [{ id: 'SERVICE_METHOD-00000000000E2E17', type: 'SERVICE_METHOD' }],
    total: 1
  })

  // entities:names: una petición a /entities con entityId(...) y pageSize 50; el que no
  // devuelve el simulador va a missing.
  const ids = [ENTITY_INFO_HOST, 'HOST-00000000000E2E16', 'HOST-00000000000E2E18']
  const names = await invoke<{ names: { id: string; name: string }[]; missing: string[] }>(
    'entities:names',
    { environmentId: env['Producción'], entityIds: ids }
  )
  expect(sim.entityNamesQueries).toHaveLength(1)
  expect(sim.entityNamesQueries[0]?.get('entitySelector')).toBe(
    `entityId(${ids.map((id) => `"${id}"`).join(',')})`
  )
  expect(sim.entityNamesQueries[0]?.get('pageSize')).toBe('50')
  expect([...names.names].sort((a, b) => a.id.localeCompare(b.id))).toEqual([
    { id: 'HOST-00000000000E2E15', name: 'servidor-e2e' },
    { id: 'HOST-00000000000E2E16', name: 'servidor-e2e-2' }
  ])
  expect(names.missing).toEqual(['HOST-00000000000E2E18'])

  // Una entidad que no existe: NOT_FOUND con un reason que se traduce.
  const missing = (await page.evaluate(
    (entityId) =>
      (
        window as unknown as { vigia: { invoke: (...args: unknown[]) => Promise<unknown> } }
      ).vigia.invoke('entities:get', { environmentId: entityId.env, entityId: entityId.id }),
    { env: env['Producción'], id: 'HOST-00000000000E2E19' }
  )) as { ok: boolean; error?: { code: string; reason?: { key: string } } }
  expect(missing).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
  const key = missing.error?.reason?.key ?? ''
  expect((es.errorReasons as Record<string, string>)[key] ?? '').toMatch(/entidad/i)
  expect((en.errorReasons as Record<string, string>)[key] ?? '').not.toBe('')
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

// Ficha 0018: el HOST ya tiene su página (sus marcadores, no los del servicio); sale de la lista
// de tipos en construcción. Ficha 0024: también salen SYNTHETIC_TEST y HTTP_CHECK (los prueban
// los e2e de la 0024). Ficha 0028: también sale PROCESS_GROUP_INSTANCE (lo prueban los e2e de
// la 0028). Ficha 0032: también sale PROCESS_GROUP (lo prueban los e2e de la 0032). Ficha 0034:
// también sale APPLICATION (lo prueban los e2e de la 0034).
test('CA7 (0008): las páginas de los otros tipos de entidad siguen en construcción, sin marcadores ni peticiones', async () => {
  // Desde «Analizar entidad» de una evidencia HOST del mismo problema: la del host, sin los
  // marcadores del servicio.
  await goToRoute(`/problems/${MK_PROBLEM_ID}`)
  await expect(evidenceRows()).toHaveCount(4)
  await expandRow(MK_EV_HOST)
  await analyzeButton(await detailOf(evidenceRow(MK_EV_HOST))).click()
  const hostPage = page.getByTestId('entity-page-host')
  await expect(hostPage).toBeVisible()
  await expect(page.getByTestId('service-markers')).toHaveCount(0)

  // Por URL, el resto de tipos del registro y uno que no está (genérica).
  const others = [
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
 * Ficha 0047: la página del servicio según el conjunto de métricas de la 0046 (servicios de
 * `SVC_SET_IDS` y `SVC_DB_ID`). Nombres que fijan estos tests: la nota bajo los marcadores en
 * `service-metric-set-note` (con su tooltip al pasar el ratón), el marcador `service-marker-requests`
 * («Peticiones») de Solo actividad y la cabecera «Servicio · <nombre del tipo>» en
 * `entity-page-type`.
 */
async function openServicePage(id: string): Promise<Locator> {
  await goToRoute(`/entities/SERVICE/${id}`)
  const servicePage = page.getByTestId('entity-page-service')
  await expect(servicePage).toBeVisible()
  await expect(servicePage.getByTestId('service-markers')).toBeVisible()
  return servicePage
}

/** Ficha 0047: los marcadores completos de siempre (los de la 0008). */
const FULL_MARKERS = ['ok', 'ko', 'error-rate', 'response-time', 'problems'] as const

test('CA1 (0047): un QUEUE_LISTENER_SERVICE enseña solo Peticiones y Problemas, el gráfico de actividad sin KO y la nota; no tiempos, errores ni tasa', async () => {
  const servicePage = await openServicePage(SVC_SET_IDS.activity)

  // Marcadores: Peticiones (la suma del recuento, 10) y Problemas; ninguno de tiempos ni errores.
  const requests = serviceMarker('requests')
  await expect(requests).toBeVisible()
  await expect(requests).toContainText('Peticiones')
  await expect(requests.getByTestId('service-marker-value')).toHaveText(/^10$/)
  await expect(serviceMarker('problems')).toBeVisible()
  for (const id of ['ok', 'ko', 'error-rate', 'response-time']) {
    await expect(serviceMarker(id), id).toHaveCount(0)
  }
  const markers = servicePage.getByTestId('service-markers')
  await expect(markers).not.toContainText('Tiempo de respuesta')
  await expect(markers).not.toContainText('Tasa de error')
  await expect(markers).not.toContainText('Peticiones KO')

  // La nota que lo explica.
  const note = servicePage.getByTestId('service-metric-set-note')
  await expect(note).toBeVisible()
  await expect(note).toContainText('Este tipo de servicio solo mide actividad')

  // Gráficos: solo el de actividad, con una serie (sin la parte KO).
  const panels = page.getByTestId('service-chart-panel')
  await expect(panels).toHaveCount(1)
  await expect(panels.first()).toHaveAttribute('data-kind', 'activity')
  const series = await chartSeries('activity')
  expect(series).toHaveLength(1)
  expect(series[0]).not.toMatch(/\bKO\b/)
  for (const kind of ['response-time', 'error-rate', 'errors'] as const) {
    await expect(chartPanel(kind), kind).toHaveCount(0)
  }
})

test('CA2 (0047): un DATABASE_SERVICE enseña los marcadores y gráficos completos, la nota de cliente con su tooltip y «Base de datos» en la cabecera', async () => {
  const servicePage = await openServicePage(SVC_DB_ID)

  // Cabecera: el tipo de entidad y el del servicio.
  await expect(servicePage.getByTestId('entity-page-type')).toHaveText('Servicio · Base de datos')

  // Los cinco marcadores, con los datos de Cliente (60 peticiones, 4 KO, mediana 210 ms).
  for (const id of FULL_MARKERS) await expect(serviceMarker(id), id).toBeVisible()
  await expect(serviceMarker('requests')).toHaveCount(0)
  await expect(serviceMarker('ok').getByTestId('service-marker-value')).toHaveText(/^56$/)
  await expect(serviceMarker('ko').getByTestId('service-marker-value')).toHaveText(/^4$/)
  await expect(serviceMarker('response-time').getByTestId('service-marker-median')).toContainText(
    /210\sms/
  )

  // Los cuatro gráficos.
  await expect(page.getByTestId('service-chart-panel')).toHaveCount(4)
  for (const kind of CHART_KINDS) await expect(chartPanel(kind), kind).toHaveCount(1)

  // La nota de cliente y su tooltip.
  const note = servicePage.getByTestId('service-metric-set-note')
  await expect(note).toBeVisible()
  await expect(note).toContainText('Medido desde los clientes')
  await note.scrollIntoViewIfNeeded()
  await hoverFresh(page, note)
  await expect(page.getByRole('tooltip')).toBeVisible()
  await expect(page.getByRole('tooltip')).toContainText(/cliente/i)
  await moveToNeutral(page)
})

test('CA3 (0047): «Abrir en Métricas» de los tiempos abre Métricas con la métrica de cliente o la unificada, no la de servidor', async () => {
  const cases = [
    {
      id: SVC_DB_ID,
      has: 'builtin:service.response.client',
      not: 'builtin:service.response.server'
    },
    {
      id: SVC_SET_IDS.unified,
      has: SVC_UNIFIED_KEYS.time,
      not: 'builtin:service.response.'
    }
  ]
  for (const { id, has, not } of cases) {
    await openServicePage(id)
    await chartSeries('response-time')
    const before = sim.metricsQueries
    await chartPanel('response-time').getByTestId('service-chart-open').click()
    await expect.poll(currentRoute, id).toBe('/metrics')
    await expect.poll(() => sim.metricsQueries, id).toBeGreaterThan(before)
    const selector = sim.lastMetricsQuery.get('metricSelector') ?? ''
    await expect(page.getByTestId('metric-selector'), id).toHaveValue(selector)
    expect(selector, id).toContain(id)
    expect(selector, id).toContain(has)
    expect(selector, `${id}: ${not}`).not.toContain(not)
    for (const part of [':median', ':percentile(90', ':percentile(99']) {
      expect(selector, `${id}: ${part}`).toContain(part)
    }
  }
})

test('CA4 (0047): un WEB_SERVICE se ve como hoy: marcadores y gráficos completos, sin nota y su tipo en la cabecera', async () => {
  const servicePage = await openServicePage(SVC_ID)
  await expect(servicePage.getByTestId('entity-page-type')).toHaveText('Servicio · Servicio web')
  for (const id of FULL_MARKERS) await expect(serviceMarker(id), id).toBeVisible()
  await expect(serviceMarker('requests')).toHaveCount(0)
  await expect(page.getByTestId('service-chart-panel')).toHaveCount(4)
  expect(await chartSeries('activity')).toHaveLength(2)
  await expect(servicePage.getByTestId('service-metric-set-note')).toHaveCount(0)
})

/**
 * Ficha 0048: disponibilidad (SLO calculado por Vigía) de la página del servicio. Nombres que fijan
 * estos tests: el panel `service-slo-panel` (dentro de `service-charts`, encima de la rejilla de
 * los `service-chart-panel`), con su título en `service-slo-title` (disparador del tooltip, con
 * foco) y el `Chart` `service-slo-chart` con `data-series` y `data-thresholds` (los valores de
 * las líneas horizontales de la opción, en JSON); la línea `service-marker-availability` dentro
 * del marcador «Tasa de error», con `data-critical` («true» por debajo del 90 %).
 */
const sloPanel = (): Locator => page.getByTestId('service-slo-panel')
const sloChart = (): Locator => sloPanel().getByTestId('service-slo-chart')

test('CA3 (0048): con una caída por debajo del 90 %, el gráfico de disponibilidad sale encima de la rejilla con su serie y el umbral, y el marcador en color de error', async () => {
  const servicePage = await openServicePage(SVC_SLO_ID)
  const section = servicePage.getByTestId('service-charts')

  // El panel, dentro de la sección de gráficos y encima del primero de la rejilla.
  const panel = section.getByTestId('service-slo-panel')
  await expect(panel).toBeVisible()
  await expect(panel.getByTestId('service-slo-title')).toHaveText('Disponibilidad (SLO calculado)')
  const firstGrid = section.getByTestId('service-chart-panel').first()
  await expect(firstGrid).toBeVisible()
  const sloBox = await panel.boundingBox()
  const gridBox = await firstGrid.boundingBox()
  expect(sloBox).not.toBeNull()
  expect(gridBox).not.toBeNull()
  expect((sloBox?.y ?? 0) + (sloBox?.height ?? 0)).toBeLessThanOrEqual(gridBox?.y ?? 0)
  // A todo el ancho: tan ancho como la rejilla entera.
  const gridRow = await firstGrid.locator('xpath=..').boundingBox()
  expect(Math.abs((sloBox?.width ?? 0) - (gridRow?.width ?? 0))).toBeLessThanOrEqual(2)
  // La rejilla sigue con sus cuatro gráficos.
  await expect(section.getByTestId('service-chart-panel')).toHaveCount(4)

  // Su serie y la línea del umbral del 90 %.
  const chart = sloChart()
  await expect(chart.locator('canvas').first()).toBeVisible()
  await expect(chart).toHaveAttribute('data-series', /\[.+\]/)
  const series = JSON.parse((await chart.getAttribute('data-series')) ?? '[]') as string[]
  expect(series).toHaveLength(1)
  expect(series[0]).toMatch(/disponibilidad/i)
  await expect(chart).toHaveAttribute('data-thresholds', '[90]')

  // Sin «Abrir en Métricas» (es un cálculo de Vigía), pero se puede exportar.
  await expect(panel.getByTestId('service-chart-open')).toHaveCount(0)
  await expect(
    panel.locator('[data-testid="export-menu"][data-export-target="service-slo-chart"]')
  ).toBeVisible()

  // El marcador «Tasa de error» enseña la disponibilidad del rango, en color de error y con texto.
  const line = serviceMarker('error-rate').getByTestId('service-marker-availability')
  await expect(line).toBeVisible()
  await expect(line).toContainText(/Disponibilidad\s85,3\s?%/)
  await expect(line).toHaveAttribute('data-critical', 'true')
  await expect(line).toHaveClass(/text-danger/)
  await expect(line).toContainText(/por debajo del 90\s?%/)
})

test('CA3 (0048): sin bajar del 90 %, la disponibilidad del marcador no va en color de error', async () => {
  await openServicePage(SVC_BIG_ID)
  const line = serviceMarker('error-rate').getByTestId('service-marker-availability')
  await expect(line).toContainText(/Disponibilidad\s100,0\s?%/)
  await expect(line).toHaveAttribute('data-critical', 'false')
  await expect(line).not.toHaveClass(/text-danger/)
  await expect(sloPanel()).toBeVisible()
})

test('CA4 (0048): en un servicio de solo actividad no salen el gráfico de disponibilidad ni la línea del marcador', async () => {
  const servicePage = await openServicePage(SVC_SET_IDS.activity)
  // Espera a que la página esté pintada con los datos (el gráfico de actividad, con su serie).
  expect(await chartSeries('activity')).toHaveLength(1)
  await expect(servicePage.getByTestId('service-slo-panel')).toHaveCount(0)
  await expect(servicePage.getByTestId('service-slo-chart')).toHaveCount(0)
  await expect(servicePage.getByTestId('service-marker-availability')).toHaveCount(0)
})

test('CA5 (0048): el tooltip del nombre del gráfico explica la fórmula, con ratón y con foco', async () => {
  await openServicePage(SVC_SLO_ID)
  const title = sloPanel().getByTestId('service-slo-title')
  await expect(title).toBeVisible()
  const tooltip = page.getByRole('tooltip')

  // Con el ratón.
  await hoverFresh(page, title)
  await expect(tooltip).toBeVisible()
  await expect(tooltip).toContainText(/peticiones/i)
  await expect(tooltip).toContainText(/errores/i)
  await expect(tooltip).toContainText('Vigía')
  await moveToNeutral(page)
  await page.keyboard.press('Escape')
  await expect(tooltip).toHaveCount(0)

  // Con el foco, ya a la vista (Radix cierra el tooltip si su contenedor se desplaza).
  await title.evaluate((element) => element.scrollIntoView({ block: 'center' }))
  await settledBox(title)
  await title.focus()
  await expect(title).toBeFocused()
  await expect(tooltip).toBeVisible()
  await expect(tooltip).toContainText(/peticiones/i)
  await page.keyboard.press('Escape')
  await expect(tooltip).toHaveCount(0)
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

/**
 * Ficha 0012: un problema solo del detalle con 1234 comentarios en la API (trae uno): los números
 * de los avisos de i18next también llevan el separador de miles.
 */
const THOUSANDS_PROBLEM_ID = 'pd-thousands'
detailOnly.push({
  problemId: THOUSANDS_PROBLEM_ID,
  displayId: 'P-792',
  title: 'Problema con muchos comentarios',
  status: 'OPEN',
  severityLevel: 'ERROR',
  impactLevel: 'SERVICES',
  startTime: NOW - 2 * HOUR,
  endTime: -1,
  affectedEntities: [],
  impactedEntities: [],
  managementZones: [],
  problemFilters: [],
  evidenceDetails: { totalCount: 0, details: [] },
  recentComments: {
    totalCount: 1234,
    comments: [{ authorName: 'operador', content: 'Mirando', createdAtTimestamp: NOW - HOUR }]
  }
})

test('Separador en textos (0012): los números de los avisos (textos de i18next) también llevan separador: 1234 → «1.234»', async () => {
  await goToRoute(`/problems/${THOUSANDS_PROBLEM_ID}`)
  await expect(page.getByTestId('problem-page-title')).toContainText('P-792')
  const section = page.getByTestId('detail-comments')
  await expect(section.getByTestId('comments-api-truncated')).toHaveText(
    'Se ven los 1 más recientes de 1.234 comentarios.'
  )
  await expect(section.getByTestId('comments-show-all')).toHaveText('Ver todos (1.234)')
})

/**
 * Ficha 0015: tarjeta «Información» de la página de un SERVICE (entre la cabecera y los
 * marcadores), con los datos de entities:get y los nombres de entities:names a demanda.
 *
 * Nombres que fijan estos tests: la tarjeta `service-info`; sus columnas `service-info-service`
 * («Servicio») y `service-info-relations` («Relaciones»); cada fila de «Servicio» es un
 * `service-info-row` con `data-key` (serviceType, technologies, webServerName, webService,
 * contextRoot, port, isExternalService, remoteEndpoint, databaseVendor, databaseName,
 * applicationName, applicationEnvironment, applicationReleaseVersion, publicCloudId,
 * publicCloudRegion, firstSeen, lastSeen, managementZones y tags, en ese orden), con su valor en
 * `service-info-value` y los chips en `service-info-chip`; el «+N» de las etiquetas,
 * `service-info-tags-more`. Cada grupo de relaciones es un `service-info-group` con `data-group`
 * (runsOn, calls, calledBy y other), su número en `service-info-group-count`, el botón que lo
 * despliega `service-info-group-toggle` (con `aria-expanded`), el aviso «Mostrando 50 de N»
 * `service-info-group-truncated`, el botón «Ver nombres» `service-info-names` y cada entidad,
 * un enlace `service-info-entity` con `data-entity-id`, con su nombre (si se conoce) en
 * `service-info-entity-name`. «Todas las propiedades»: el botón
 * `service-info-properties-toggle` y cada propiedad, `service-info-property` con `data-key`.
 */
const INFO_ROW_ORDER = [
  'serviceType',
  'technologies',
  'webServerName',
  'webService',
  'contextRoot',
  'port',
  'isExternalService',
  'remoteEndpoint',
  'databaseVendor',
  'databaseName',
  'applicationName',
  'applicationEnvironment',
  'applicationReleaseVersion',
  'publicCloudId',
  'publicCloudRegion',
  'firstSeen',
  'lastSeen',
  // Ficha 0037: las etiquetas ya no son fila de la tarjeta (van en las píldoras de arriba).
  'managementZones'
]
const infoCard = (): Locator => page.getByTestId('service-info')
const infoRow = (key: string): Locator =>
  infoCard().locator(`[data-testid="service-info-row"][data-key="${key}"]`)
const infoGroup = (key: string): Locator =>
  infoCard().locator(`[data-testid="service-info-group"][data-group="${key}"]`)
const infoEntity = (group: string, id: string): Locator =>
  infoGroup(group).locator(`[data-testid="service-info-entity"][data-entity-id="${id}"]`)

/** Ficha 0015: abre la página del servicio por URL y espera la tarjeta con sus filas. */
async function openServiceInfo(id: string): Promise<Locator> {
  await goToRoute(`/entities/SERVICE/${id}`)
  await expect(page.getByTestId('entity-page-service')).toBeVisible()
  const card = infoCard()
  await expect(card).toBeVisible()
  await expect(card.getByTestId('service-info-row').first()).toBeVisible()
  return card
}

/** Ficha 0015: valor de un atributo (data-key por defecto) de cada elemento, en el orden del DOM. */
async function dataKeys(target: Locator, attribute = 'data-key'): Promise<string[]> {
  return target.evaluateAll(
    (elements, name) => elements.map((element) => element.getAttribute(name) ?? ''),
    attribute
  )
}

/** Ficha 0015: despliega un grupo de relaciones (si no lo está), trayéndolo antes a la vista. */
async function expandGroup(key: string): Promise<Locator> {
  const group = infoGroup(key)
  const toggle = group.getByTestId('service-info-group-toggle')
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await clickInPlace(toggle, { scroll: true })
  }
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  return group
}

test('CA1 (0015): con un servicio con todas las propiedades, la columna «Servicio» enseña sus datos en su orden, con tecnologías y zonas como chips, y las claves internas solo en «Todas las propiedades»', async () => {
  const card = await openServiceInfo(INFO_FULL_ID)
  await expect(card).toContainText('Información')
  const column = card.getByTestId('service-info-service')
  await expect(column).toContainText('Servicio')

  // Debajo de los marcadores: desde la ficha 0036, «Información» va al final de la página.
  const cardBox = await settledBox(card)
  const markersBox = await settledBox(page.getByTestId('service-markers'))
  expect(cardBox.y, 'la tarjeta va debajo de los marcadores').toBeGreaterThanOrEqual(
    markersBox.y + markersBox.height - 1
  )

  // Las filas, en el orden de la ficha (no en el de la respuesta).
  await expect(column.getByTestId('service-info-row')).toHaveCount(INFO_ROW_ORDER.length)
  expect(await dataKeys(column.getByTestId('service-info-row'))).toEqual(INFO_ROW_ORDER)

  const value = (key: string): Locator => infoRow(key).getByTestId('service-info-value')
  await expect(value('serviceType')).toContainText('WEB_REQUEST_SERVICE')
  await expect(value('webServerName')).toContainText('servidor-web-e2e')
  await expect(value('webService')).toContainText('ServicioPagosE2e')
  await expect(value('webService')).toContainText('urn:e2e:pagos')
  await expect(value('contextRoot')).toContainText('/pagos-e2e')
  await expect(value('port')).toContainText('443')
  await expect(infoRow('isExternalService')).toContainText('Externo')
  await expect(value('remoteEndpoint')).toContainText('remoto-e2e.invalid')
  await expect(value('databaseVendor')).toContainText('POSTGRESQL')
  await expect(value('databaseName')).toContainText('pagos_e2e')
  await expect(value('applicationName')).toContainText('app-e2e')
  await expect(value('applicationEnvironment')).toContainText('pre-e2e')
  await expect(value('applicationReleaseVersion')).toContainText('1.2.3')
  await expect(value('publicCloudId')).toContainText('nube-e2e')
  await expect(value('publicCloudRegion')).toContainText('region-e2e')
  await expect(value('firstSeen')).toContainText('2026')
  await expect(value('lastSeen')).toContainText('2026')

  // Tecnologías y zonas, como chips.
  const techChips = infoRow('technologies').getByTestId('service-info-chip')
  await expect(techChips.filter({ hasText: /^Java$/ })).toHaveCount(1)
  await expect(techChips.filter({ hasText: /^Apache Tomcat$/ })).toHaveCount(1)
  await expect(techChips.filter({ hasText: /OpenJDK/ })).toHaveCount(1)
  await expect(techChips.filter({ hasText: /APACHE_TOMCAT/ })).toHaveCount(1)
  await expect(infoRow('managementZones').getByTestId('service-info-chip')).toHaveText([
    'Zona info A',
    'Zona info B'
  ])

  // Ficha 0037: las etiquetas ya no salen en la tarjeta (CA4 de la 0037 lo comprueba).
  await expect(infoRow('tags')).toHaveCount(0)

  // Nada interno fuera de «Todas las propiedades», que empieza plegada.
  const internalTexts = [
    ...Object.keys(INFO_INTERNAL),
    'contexto-interno-e2e',
    'nombre-detectado-e2e',
    'regla-interna-e2e'
  ]
  for (const text of internalTexts) {
    await expect(column, text).not.toContainText(text)
    await expect(card.getByTestId('service-info-relations'), text).not.toContainText(text)
  }
  await expect(card.getByTestId('service-info-property')).toHaveCount(0)

  // Desplegada: todas las propiedades, también las internas, como dato y valor.
  const toggle = card.getByTestId('service-info-properties-toggle')
  await expect(toggle).toContainText('Todas las propiedades')
  await clickInPlace(toggle, { scroll: true })
  await expect(card.getByTestId('service-info-property')).toHaveCount(INFO_FULL_PROPERTY_COUNT)
  const property = (key: string): Locator =>
    card.locator(`[data-testid="service-info-property"][data-key="${key}"]`)
  await expect(property('dt.security_context')).toContainText('dt.security_context')
  await expect(property('dt.security_context')).toContainText('contexto-interno-e2e')
  await expect(property('agentTechnologyType')).toContainText('JAVA')
  await expect(property('detectedName')).toContainText('nombre-detectado-e2e')
  await expect(property('matchedServiceDetectionV2Rules')).toContainText('regla-interna-e2e')
  await expect(property('serviceType')).toContainText('WEB_REQUEST_SERVICE')
})

test('CA2 (0015): con un servicio con pocas propiedades solo salen las filas con dato, sin filas vacías ni «undefined»', async () => {
  const card = await openServiceInfo(INFO_FEW_ID)
  const rows = card.getByTestId('service-info-service').getByTestId('service-info-row')
  // serviceType y la última vez visto; webServerName vacío, isExternalService a false, sin
  // primera vez, sin zonas y sin etiquetas: ninguna de esas filas.
  await expect(rows).toHaveCount(2)
  expect(await dataKeys(rows)).toEqual(['serviceType', 'lastSeen'])
  for (const key of ['serviceType', 'lastSeen']) {
    await expect(infoRow(key).getByTestId('service-info-value'), key).toHaveText(/\S/)
  }
  await expect(infoRow('serviceType')).toContainText('DATABASE_SERVICE')
  // Sin relaciones, ningún grupo.
  await expect(card.getByTestId('service-info-group')).toHaveCount(0)
  // Nada de valores sin dato en toda la tarjeta (con «Todas las propiedades» desplegada).
  await clickInPlace(card.getByTestId('service-info-properties-toggle'), { scroll: true })
  await expect(card.getByTestId('service-info-property').first()).toBeVisible()
  for (const text of ['undefined', 'null', 'NaN', '[object Object]']) {
    await expect(card, text).not.toContainText(text)
  }
})

test('CA3 (0015): las relaciones salen en sus grupos y en su orden, con su número; desplegadas, con tipo e id; con más de 50, «Mostrando 50 de N»', async () => {
  const card = await openServiceInfo(INFO_FULL_ID)
  const column = card.getByTestId('service-info-relations')
  await expect(column).toContainText('Relaciones')

  const groups = column.getByTestId('service-info-group')
  await expect(groups).toHaveCount(4)
  expect(await dataKeys(groups, 'data-group')).toEqual(['runsOn', 'calls', 'calledBy', 'other'])
  const expected = [
    ['runsOn', 'Se ejecuta en', '4'],
    ['calls', 'Llama a', '55'],
    ['calledBy', 'Lo llaman', '3'],
    ['other', 'Otras relaciones', '3']
  ] as const
  for (const [key, title, count] of expected) {
    await expect(infoGroup(key), key).toContainText(title)
    await expect(infoGroup(key).getByTestId('service-info-group-count'), key).toHaveText(
      new RegExp(`^\\s*${count}\\s*$`)
    )
  }
  // «Otras relaciones», plegada.
  await expect(infoGroup('other').getByTestId('service-info-group-toggle')).toHaveAttribute(
    'aria-expanded',
    'false'
  )
  await expect(infoGroup('other').getByTestId('service-info-entity')).toHaveCount(0)

  // «Se ejecuta en»: hosts, proceso y process group, con su tipo (nombre de la 0003) y su id.
  const runsOn = await expandGroup('runsOn')
  const runsOnEntities = runsOn.getByTestId('service-info-entity')
  await expect(runsOnEntities).toHaveCount(4)
  expect(await dataKeys(runsOnEntities, 'data-entity-id')).toEqual([
    ...INFO_HOSTS,
    INFO_PGI,
    INFO_PG
  ])
  const types: [string, string][] = [
    [INFO_HOSTS[0] ?? '', es.entities.types.HOST],
    [INFO_HOSTS[1] ?? '', es.entities.types.HOST],
    [INFO_PGI, es.entities.types.PROCESS_GROUP_INSTANCE],
    [INFO_PG, es.entities.types.PROCESS_GROUP]
  ]
  for (const [id, label] of types) {
    await expect(infoEntity('runsOn', id), id).toContainText(label)
    await expect(infoEntity('runsOn', id), id).toContainText(id)
  }
  await expect(runsOn.getByTestId('service-info-group-truncated')).toHaveCount(0)

  // «Llama a»: 50 de 55.
  const calls = await expandGroup('calls')
  await expect(calls.getByTestId('service-info-entity')).toHaveCount(50)
  expect(await dataKeys(calls.getByTestId('service-info-entity'), 'data-entity-id')).toEqual(
    INFO_CALLS.slice(0, 50).map((entity) => entity.id)
  )
  await expect(calls.getByTestId('service-info-group-truncated')).toContainText(
    /Mostrando 50 de 55/
  )

  // «Lo llaman»: tipos mezclados.
  const calledBy = await expandGroup('calledBy')
  await expect(calledBy.getByTestId('service-info-entity')).toHaveCount(3)
  await expect(infoEntity('calledBy', INFO_CALLER_APP)).toContainText(es.entities.types.APPLICATION)
  await expect(infoEntity('calledBy', INFO_CALLER_NAMED)).toContainText(es.entities.types.SERVICE)

  // «Otras relaciones»: con el nombre de la relación tal cual.
  const other = await expandGroup('other')
  await expect(other.getByTestId('service-info-entity')).toHaveCount(3)
  for (const name of ['runsOn', 'isServiceOf', 'isServiceMethodOfService']) {
    await expect(other, name).toContainText(name)
  }
  await expect(infoEntity('other', INFO_METHOD)).toContainText(INFO_METHOD)
})

test('CA4 (0015): al abrir la página no se pide ningún nombre; «Ver nombres» llama a entities:names una vez por tipo del grupo y los no resueltos quedan «sin nombre»', async () => {
  await openServiceInfo(INFO_FULL_ID)
  await settledRequests()
  expect(sim.entityNamesQueries, 'nombres al abrir').toHaveLength(0)

  // Desplegar no pide nada.
  const calledBy = await expandGroup('calledBy')
  await expandGroup('runsOn')
  await settledRequests()
  expect(sim.entityNamesQueries, 'nombres al desplegar').toHaveLength(0)

  // «Lo llaman» tiene dos tipos: dos llamadas, cada una con los ids de un solo tipo.
  const button = calledBy.getByTestId('service-info-names')
  await expect(button).toHaveText('Ver nombres')
  await clickInPlace(button, { scroll: true })
  await expect.poll(() => sim.entityNamesQueries.length).toBe(2)
  const idsOf = (query: URLSearchParams): string[] =>
    [...(query.get('entitySelector') ?? '').matchAll(/"([^"]*)"/g)]
      .map((match) => match[1] ?? '')
      .sort()
  const batches = sim.entityNamesQueries.map(idsOf).sort((a, b) => a.length - b.length)
  expect(batches).toEqual([[INFO_CALLER_APP], [INFO_CALLER_NAMED, INFO_CALLER_UNNAMED].sort()])

  // Los nombres, y el que no se resuelve se queda con su id y «sin nombre».
  await expect(
    infoEntity('calledBy', INFO_CALLER_NAMED).getByTestId('service-info-entity-name')
  ).toHaveText('llamante-info')
  await expect(
    infoEntity('calledBy', INFO_CALLER_APP).getByTestId('service-info-entity-name')
  ).toHaveText('web-info')
  const unnamed = infoEntity('calledBy', INFO_CALLER_UNNAMED)
  await expect(unnamed).toContainText('sin nombre')
  await expect(unnamed).toContainText(INFO_CALLER_UNNAMED)
  await expect(unnamed).not.toContainText('llamante-info')

  // Ni más llamadas ni nombres en otros grupos.
  await settledRequests()
  expect(sim.entityNamesQueries).toHaveLength(2)
  await expect(
    infoEntity('runsOn', INFO_HOSTS[0] ?? '').getByTestId('service-info-entity-name')
  ).toHaveCount(0)
})

test('CA5 (0015): pulsar una entidad relacionada abre su página (la del tipo, con el nombre ya conocido) y «Volver» regresa al servicio sin volver a pedir sus datos', async () => {
  await openServiceInfo(INFO_FULL_ID)
  const runsOn = await expandGroup('runsOn')
  const host = INFO_HOSTS[0] ?? ''
  // Cada entidad es un enlace a #/entities/<tipo>/<id>.
  const link = infoEntity('runsOn', host)
  await expect(link).toHaveRole('link')
  await expect(link).toHaveAttribute('href', new RegExp(`#/entities/HOST/${host}$`))
  await expect(infoEntity('runsOn', INFO_PGI)).toHaveAttribute(
    'href',
    new RegExp(`#/entities/PROCESS_GROUP_INSTANCE/${INFO_PGI}$`)
  )

  await clickInPlace(runsOn.getByTestId('service-info-names'), { scroll: true })
  await expect(link.getByTestId('service-info-entity-name')).toHaveText('host-info-1')
  await settledRequests()
  // Solo las de este servicio: la página del host pide su propia entities:get (ficha 0020).
  const serviceInfoQueries = (): number =>
    sim.requests.filter((request) => request.includes(`/entities/${INFO_FULL_ID}`)).length
  const infoBefore = serviceInfoQueries()
  const namesBefore = sim.entityNamesQueries.length

  await clickInPlace(link, { scroll: true })
  const hostPage = page.getByTestId('entity-page-host')
  await expect(hostPage).toBeVisible()
  expect(await currentRoute()).toBe(`/entities/HOST/${host}`)
  await expect(hostPage.getByRole('heading', { level: 1 })).toHaveText('host-info-1')
  await expect(hostPage.getByTestId('entity-page-id')).toHaveText(host)

  await clickInPlace(hostPage.getByTestId('entity-back'), { scroll: true })
  await expect(page.getByTestId('entity-page-service')).toBeVisible()
  expect(await currentRoute()).toBe(`/entities/SERVICE/${INFO_FULL_ID}`)
  await expect(infoRow('serviceType')).toContainText('WEB_REQUEST_SERVICE')
  await settledRequests()
  expect(serviceInfoQueries(), 'entities:get del servicio al volver').toBe(infoBefore)
  expect(sim.entityNamesQueries, 'entities:names al volver').toHaveLength(namesBefore)
})

test('CA6 (0015): sin entities.read, la tarjeta dice qué scope falta y marcadores y gráficos siguen; con el canal caído, aviso con Reintentar', async () => {
  // Un entorno con un token sin entities.read, solo para este test.
  const tenants = await invoke<{ clients: { id: string; name: string }[] }>('tenants:list')
  const clientId = tenants.clients.find((client) => client.name === 'Cliente A')?.id ?? ''
  const noEntities = await createEnvironment(clientId, 'Sin entidades', 'other', TOKEN_NO_ENTITIES)
  try {
    await invoke('connection:test', { environmentId: noEntities })
    await invoke('environments:setActive', { environmentId: noEntities })
    await reloadUi()
    await goToRoute(`/entities/SERVICE/${SVC_ID}`)
    await expect(page.getByTestId('entity-page-service')).toBeVisible()
    const unavailable = infoCard().getByTestId('module-unavailable')
    await expect(unavailable).toBeVisible()
    await expect(unavailable).toContainText('entities.read')
    await expect(infoCard().getByTestId('service-info-row')).toHaveCount(0)
    // Marcadores y gráficos, con sus datos.
    await expectErrorServiceValues()
    expect(await chartSeries('error-rate')).toHaveLength(1)
    await settledRequests()
    expect(sim.entityInfoQueries, 'entities:get sin el scope').toHaveLength(0)
  } finally {
    await invoke('environments:setActive', { environmentId: env['Producción'] })
    await invoke('environments:delete', { id: noEntities })
    await reloadUi()
  }

  // Canal caído: aviso compacto con Reintentar; marcadores y gráficos siguen.
  sim.entityInfoFail = true
  await goToRoute(`/entities/SERVICE/${SVC_ID}`)
  await expect(page.getByTestId('entity-page-service')).toBeVisible()
  const retry = infoCard().getByRole('button', { name: 'Reintentar' })
  await expect(infoCard().getByRole('alert').first()).toBeVisible()
  await expect(retry).toBeVisible()
  await expectErrorServiceValues()
  expect(await chartSeries('error-rate')).toHaveLength(1)

  sim.entityInfoFail = false
  await clickInPlace(retry, { scroll: true })
  await expect(infoRow('serviceType')).toContainText('DATABASE_SERVICE')
  await expect(infoCard().getByRole('button', { name: 'Reintentar' })).toHaveCount(0)
})

test('CA7 (0015): con la ventana estrecha, «Servicio» y «Relaciones» en una columna; con la normal, en dos', async () => {
  const card = await openServiceInfo(INFO_FULL_ID)
  const service = card.getByTestId('service-info-service')
  const relations = card.getByTestId('service-info-relations')

  await withContentSize(SMALL_WINDOW, async () => {
    const a = await settledBox(service)
    const b = await settledBox(relations)
    expect(Math.abs(b.x - a.x), 'misma x').toBeLessThanOrEqual(1)
    expect(b.y, 'relaciones debajo').toBeGreaterThanOrEqual(a.y + a.height - 1)
  })

  // De vuelta en FIXED_WINDOW (la del CI, 1024×720): dos columnas.
  const a = await settledBox(service)
  const b = await settledBox(relations)
  expect(b.x, 'relaciones a la derecha').toBeGreaterThanOrEqual(a.x + a.width - 1)
  expect(Math.abs(b.y - a.y), 'misma altura de inicio').toBeLessThanOrEqual(1)
})

/**
 * Ficha 0018: marcadores y gráficos de la página de un HOST, con los datos de HOST_METRICS_ID
 * (canal entities:hostMetrics de la 0016) y sus problemas (hostBandProblems: uno abierto y dos
 * cerrados).
 *
 * Nombres que fijan estos tests: la fila `host-markers`; cada marcador `host-marker-<id>` (cpu,
 * memory, network, disk y problems); dentro, el valor principal en `host-marker-value` (con
 * `data-level`: `normal`, `warning` o `error`, umbrales del 80 y el 90 %) y lo de debajo en
 * `host-marker-secondary` (máxima, usada / total y salida); el texto del nivel, cuando no es
 * `normal`, en `host-marker-level`; los recuentos, en `host-marker-open` y `host-marker-closed`.
 * La sección `host-charts`; cada gráfico en un `host-chart-panel` con `data-kind` (cpu, memory,
 * network y disk, en ese orden) y su título en un encabezado; dentro, el `Chart` con testid
 * `host-chart-<kind>` (con `data-series`). La franja, `host-problem-band`, dentro del panel de la
 * CPU; cada tramo, `host-problem-segment` con `data-problem-id`.
 */
const HOST_MARKER_IDS = ['cpu', 'memory', 'network', 'disk'] as const
const HOST_CHART_KINDS = ['cpu', 'memory', 'network', 'disk'] as const
type HostChartKind = (typeof HOST_CHART_KINDS)[number]
const HOST_CHART_TITLES: Record<HostChartKind, string> = {
  cpu: 'CPU',
  memory: 'Memoria',
  network: 'Red',
  disk: 'Disco'
}
/** Las series de cada gráfico, en su orden: CPU con el total y su desglose, y red con las dos. */
const HOST_CHART_SERIES: Record<HostChartKind, RegExp[]> = {
  cpu: [/total/i, /user/i, /system/i, /iowait/i],
  // Ficha 0039: usada y recuperable apiladas, y la total.
  memory: [/usad/i, /recuperable/i, /total/i],
  network: [/entrada/i, /salida/i],
  disk: [/./]
}

const hostMarker = (id: string): Locator => page.getByTestId(`host-marker-${id}`)
const hostChartPanel = (kind: HostChartKind): Locator =>
  page.locator(`[data-testid="host-chart-panel"][data-kind="${kind}"]`)
const hostChartPlot = (kind: HostChartKind): Locator =>
  hostChartPanel(kind).getByTestId(`host-chart-${kind}`)
const hostBand = (): Locator => hostChartPanel('cpu').getByTestId('host-problem-band')
const hostSegment = (problemId: string): Locator =>
  hostBand().locator(`[data-testid="host-problem-segment"][data-problem-id="${problemId}"]`)

/** Ficha 0018: abre la página de HOST_METRICS_ID por URL. */
async function openHostPage(): Promise<Locator> {
  await goToRoute(`/entities/HOST/${HOST_METRICS_ID}`)
  const hostPage = page.getByTestId('entity-page-host')
  await expect(hostPage).toBeVisible()
  return hostPage
}

/** Ficha 0018: espera a que el gráfico tenga sus series (se monta vacío mientras carga). */
async function hostChartSeries(kind: HostChartKind): Promise<string[]> {
  const plot = hostChartPlot(kind)
  await expect(plot.locator('canvas').first()).toBeVisible()
  await expect(plot).toHaveAttribute('data-series', /\[.+\]/)
  return JSON.parse((await plot.getAttribute('data-series')) ?? '[]') as string[]
}

/** Ficha 0018: los valores de los marcadores de HOST_METRICS_ID, ya formateados (es). */
async function expectHostMarkerValues(): Promise<void> {
  // CPU: media 33,5 % y máxima 95 %.
  const cpu = hostMarker('cpu')
  await expect(cpu.getByTestId('host-marker-value')).toHaveText(/^33,5\s?%$/)
  await expect(cpu.getByTestId('host-marker-secondary')).toContainText(/(^|[^\d.,])95(,0)?\s?%/)
  // Memoria: media 57 % y usada / total del último punto (10 y 16 GB).
  const memory = hostMarker('memory')
  await expect(memory.getByTestId('host-marker-value')).toHaveText(/^57(,0)?\s?%$/)
  await expect(memory.getByTestId('host-marker-secondary')).toContainText(/(^|[^\d.,])10,0\sGB/)
  await expect(memory.getByTestId('host-marker-secondary')).toContainText(/(^|[^\d.,])16,0\sGB/)
  // Red: entrada media 3600 bit/s y salida media 650 bit/s, con su unidad adaptada.
  const network = hostMarker('network')
  await expect(network.getByTestId('host-marker-value')).toHaveText(/^3,6\skbit\/s$/)
  await expect(network.getByTestId('host-marker-secondary')).toContainText(/(^|[^\d.,])650\sbit\/s/)
  // Disco: el más lleno, 92 %.
  await expect(hostMarker('disk').getByTestId('host-marker-value')).toHaveText(/^92(,0)?\s?%$/)
  // Problemas: 1 abierto y 2 cerrados.
  const problems = hostMarker('problems')
  await expect(problems.getByTestId('host-marker-open')).toHaveText(loneNumber('1'))
  await expect(problems.getByTestId('host-marker-closed')).toHaveText(loneNumber('2'))
}

test('CA1 (0018): la página de un HOST enseña los cinco marcadores con los valores del simulador formateados, sin «Página en construcción»', async () => {
  const hostPage = await openHostPage()
  const row = hostPage.getByTestId('host-markers')
  await expect(row).toBeVisible()

  // Los cinco, con su nombre.
  const labels = [
    ['cpu', 'CPU'],
    ['memory', 'Memoria'],
    ['network', 'Red'],
    ['disk', 'Disco'],
    ['problems', 'Problemas']
  ] as const
  for (const [id, label] of labels) {
    await expect(row.getByTestId(`host-marker-${id}`), id).toBeVisible()
    await expect(row.getByTestId(`host-marker-${id}`), id).toContainText(label)
  }
  await expectHostMarkerValues()

  // Niveles (CA5): CPU (33,5 %) y memoria (57 %), normales y sin texto de nivel; el disco
  // (92 %), de error y con su texto además del color.
  for (const id of ['cpu', 'memory'] as const) {
    await expect(hostMarker(id).getByTestId('host-marker-value'), id).toHaveAttribute(
      'data-level',
      'normal'
    )
    await expect(hostMarker(id).getByTestId('host-marker-level'), id).toHaveCount(0)
  }
  const disk = hostMarker('disk')
  await expect(disk.getByTestId('host-marker-value')).toHaveAttribute('data-level', 'error')
  await expect(disk.getByTestId('host-marker-level')).toBeVisible()
  await expect(disk.getByTestId('host-marker-level')).toHaveText(/\S/)

  // Ni el bloque ni el texto de «Página en construcción», ni los marcadores del servicio.
  await expect(hostPage.getByTestId('entity-under-construction')).toHaveCount(0)
  await expect(hostPage).not.toContainText('Página en construcción')
  await expect(page.getByTestId('service-markers')).toHaveCount(0)
})

test('CA2 (0018): salen los cuatro gráficos en su orden (CPU, memoria, red y disco), con su título y sus series', async () => {
  const hostPage = await openHostPage()
  const section = hostPage.getByTestId('host-charts')
  await expect(section).toBeVisible()

  const panels = section.getByTestId('host-chart-panel')
  await expect(panels).toHaveCount(4)
  for (const [index, kind] of HOST_CHART_KINDS.entries()) {
    const panel = panels.nth(index)
    await expect(panel, `posición ${index + 1}`).toHaveAttribute('data-kind', kind)
    await expect(panel.getByRole('heading').first(), kind).toContainText(HOST_CHART_TITLES[kind])
    const series = await hostChartSeries(kind)
    expect(series, kind).toHaveLength(HOST_CHART_SERIES[kind].length)
    for (const [i, pattern] of HOST_CHART_SERIES[kind].entries()) {
      expect(series[i], `${kind}[${i}]`).toMatch(pattern)
    }
  }

  // Marcadores y gráficos comparten una sola llamada al canal (una consulta de marcadores).
  await settledRequests()
  expect(hostMetricCalls()).toBe(1)
  expectHostQueriesWithinLimit()
})

test('CA3 (0018): la franja de problemas sale sobre el gráfico de CPU con los problemas del host, y pulsar un tramo abre el problema', async () => {
  await openHostPage()
  await hostChartSeries('cpu')
  const band = hostBand()
  await expect(band).toBeVisible()
  await expect(band.getByTestId('host-problem-segment')).toHaveCount(3)
  for (const { problemId } of [HOST_BAND_OPEN, HOST_BAND_CLOSED, HOST_BAND_CLOSED_2]) {
    await expect(hostSegment(problemId), problemId).toHaveCount(1)
  }
  // Solo en el panel de la CPU.
  await expect(page.getByTestId('host-problem-band')).toHaveCount(1)

  // La lista se pide con el host y el rango global.
  await settledRequests()
  const lists = sim.entityProblemListQueries.filter((query) =>
    (query.get('problemSelector') ?? '').includes(HOST_METRICS_ID)
  )
  expect(lists).toHaveLength(1)
  expect(lists[0]?.get('problemSelector')).toBe(`affectedEntities("${HOST_METRICS_ID}")`)
  expect(lists[0]?.get('from')).toBe('now-2h')

  // Encima del gráfico: la franja acaba antes de que empiece el canvas.
  const bandBox = await settledBox(band)
  const plotBox = await settledBox(hostChartPlot('cpu'))
  expect(bandBox.y + bandBox.height).toBeLessThanOrEqual(plotBox.y + 1)

  // Pulsar un tramo (trayéndolo a la vista) abre ese problema.
  await clickInPlace(hostSegment(HOST_BAND_CLOSED.problemId), { scroll: true })
  await expect(page.getByTestId('problem-page')).toBeVisible()
  await expect(page.getByTestId('problem-page-title')).toContainText(HOST_BAND_CLOSED.displayId)
  expect(await currentRoute()).toBe(`/problems/${HOST_BAND_CLOSED.problemId}`)

  // «Volver» regresa a la página del host.
  await page.getByTestId('problem-back').click()
  await expect(page.getByTestId('entity-page-host')).toBeVisible()
  expect(await currentRoute()).toBe(`/entities/HOST/${HOST_METRICS_ID}`)
})

test('CA6 (0018): cambiar el rango global vuelve a pedir los datos; «Actualizar» también; volver a la página sin cambios, no', async () => {
  await openHostPage()
  await expectHostMarkerValues()
  await settledRequests()
  // Al entrar: una llamada al canal de métricas (sus consultas, que pueden ser más de dos desde
  // la 0039) y las dos de recuentos, con el rango global.
  expect(hostMetricCalls()).toBe(1)
  const perCall = sim.hostMetricQueries.length
  expect(perCall).toBeGreaterThanOrEqual(2)
  expect(sim.entityProblemQueries).toHaveLength(2)
  for (const query of [...sim.hostMetricQueries, ...sim.entityProblemQueries]) {
    expect(query.get('from')).toBe('now-2h')
  }

  // Rango nuevo: otra vez, con now-24h.
  await page.getByTestId('time-range-24h').click()
  await expect.poll(() => sim.hostMetricQueries.length).toBe(2 * perCall)
  await expect.poll(() => sim.entityProblemQueries.length).toBe(4)
  for (const query of [
    ...sim.hostMetricQueries.slice(perCall),
    ...sim.entityProblemQueries.slice(2)
  ]) {
    expect(query.get('from')).toBe('now-24h')
  }
  await expectHostMarkerValues()
  await settledRequests()
  expect(sim.hostMetricQueries).toHaveLength(2 * perCall)

  // Fuera y vuelta, sin cambiar nada: ninguna petición nueva.
  await goTo('metrics')
  await expect(page.getByTestId('entity-page-host')).toHaveCount(0)
  const before = await settledRequests()
  await openHostPage()
  await expectHostMarkerValues()
  await page.waitForTimeout(1500)
  expect(sim.requests.slice(before), 'peticiones al volver a la página').toEqual([])

  // «Actualizar», en la cabecera de la página: otra vez, con el rango actual.
  await page.getByTestId('entity-page-host').getByTestId('module-refresh').click()
  await expect.poll(() => sim.hostMetricQueries.length).toBe(3 * perCall)
  await expect.poll(() => sim.entityProblemQueries.length).toBe(6)
  for (const query of [
    ...sim.hostMetricQueries.slice(2 * perCall),
    ...sim.entityProblemQueries.slice(4)
  ]) {
    expect(query.get('from')).toBe('now-24h')
  }
  await expectHostMarkerValues()
})

test('CA7 (0018): si falla el canal de métricas, marcadores y gráficos enseñan el aviso con Reintentar y el marcador de problemas sigue', async () => {
  sim.hostMetricsFail = true
  await openHostPage()

  // El de problemas, con sus recuentos y sin aviso.
  const problems = hostMarker('problems')
  await expect(problems.getByTestId('host-marker-open')).toHaveText(loneNumber('1'))
  await expect(problems.getByTestId('host-marker-closed')).toHaveText(loneNumber('2'))
  await expect(problems.getByRole('button', { name: 'Reintentar' })).toHaveCount(0)

  // Cada marcador de métricas, en su sitio, con el aviso y Reintentar y sin valor.
  for (const id of HOST_MARKER_IDS) {
    const marker = hostMarker(id)
    await expect(marker, id).toBeVisible()
    await expect(marker.getByRole('button', { name: 'Reintentar' }), id).toBeVisible()
    await expect(marker.getByTestId('host-marker-value'), id).toHaveCount(0)
  }
  // Cada gráfico, en su sitio, con su aviso (role=alert) y Reintentar, sin gráfico.
  for (const kind of HOST_CHART_KINDS) {
    const panel = hostChartPanel(kind)
    await expect(panel, kind).toBeVisible()
    await expect(panel.getByRole('alert').first(), kind).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Reintentar' }), kind).toBeVisible()
    await expect(panel.getByTestId(`host-chart-${kind}`), kind).toHaveCount(0)
  }

  // Reintentar, con el canal ya bien: llegan valores y gráficos.
  sim.hostMetricsFail = false
  await clickInPlace(hostMarker('cpu').getByRole('button', { name: 'Reintentar' }), {
    scroll: true
  })
  await expectHostMarkerValues()
  for (const kind of HOST_CHART_KINDS) {
    expect(await hostChartSeries(kind), kind).toHaveLength(HOST_CHART_SERIES[kind].length)
  }
  for (const id of HOST_MARKER_IDS) {
    await expect(hostMarker(id).getByRole('button', { name: 'Reintentar' }), id).toHaveCount(0)
  }
})

/**
 * Ficha 0039: memoria total y recuperable en el marcador y el gráfico «Memoria» del HOST, con los
 * datos de HOST_METRICS_ID (usada 10 GB, total 16 GB y recuperable 2,5 GB en el último punto).
 *
 * Nombres que fijan estos tests (decisión delegada, refinable): dentro de `host-marker-memory`,
 * la recuperable en `host-marker-reclaimable` (la palabra y su valor) y, junto a la palabra, el
 * icono de ayuda `host-marker-reclaimable-help` (enfocable); su tooltip,
 * `host-marker-reclaimable-tooltip`.
 */
const reclaimableHelp = (): Locator =>
  hostMarker('memory').getByTestId('host-marker-reclaimable-help')
const reclaimableTooltip = (): Locator => page.getByTestId('host-marker-reclaimable-tooltip')

test('CA3 (0039): el marcador de memoria enseña usada / total y recuperable, y el gráfico tiene usada, recuperable y total', async () => {
  await openHostPage()
  const memory = hostMarker('memory')
  // El valor principal sigue siendo el % usado.
  await expect(memory.getByTestId('host-marker-value')).toHaveText(/^57(,0)?\s?%$/)
  // Debajo, usada / total (10 y 16 GB) y la recuperable (2,5 GB, del último punto con dato).
  const secondary = memory.getByTestId('host-marker-secondary')
  await expect(secondary).toContainText(/(^|[^\d.,])10,0\sGB/)
  await expect(secondary).toContainText(/(^|[^\d.,])16,0\sGB/)
  const reclaimable = memory.getByTestId('host-marker-reclaimable')
  await expect(reclaimable).toBeVisible()
  await expect(reclaimable).toContainText(/recuperable/i)
  await expect(reclaimable).toContainText(/(^|[^\d.,])2,5\sGB/)

  // El gráfico: tres series, usada, recuperable y total (cada una, una vez).
  const series = await hostChartSeries('memory')
  expect(series).toHaveLength(3)
  for (const pattern of [/usad/i, /recuperable/i, /total/i]) {
    expect(
      series.filter((name) => pattern.test(name)),
      String(pattern)
    ).toHaveLength(1)
  }

  // La recuperable llega en la misma llamada al canal, sin pasar de 10 expresiones por consulta.
  await settledRequests()
  expect(hostMetricCalls()).toBe(1)
  expectHostQueriesWithinLimit()
  expect(
    sim.hostMetricQueries.some((query) =>
      (query.get('metricSelector') ?? '').includes('builtin:host.mem.recl')
    )
  ).toBe(true)
})

test('CA4 (0039): el tooltip de ayuda de «recuperable» sale con el ratón y con el foco', async () => {
  await openHostPage()
  const help = reclaimableHelp()
  await expect(help).toBeVisible()
  await expect(reclaimableTooltip()).toHaveCount(0)

  // Con el ratón: lo que el sistema puede liberar si hace falta (como cachés).
  await hoverFresh(page, help)
  await expect(reclaimableTooltip()).toBeVisible()
  await expect(reclaimableTooltip()).toContainText(/liberar/i)
  await moveToNeutral(page)
  await page.keyboard.press('Escape')
  await expect(reclaimableTooltip()).toHaveCount(0)

  // Con el foco, ya a la vista (Radix cierra el tooltip si su contenedor se desplaza).
  await help.evaluate((element) => element.scrollIntoView({ block: 'center' }))
  await settledBox(help)
  await help.focus()
  await expect(help).toBeFocused()
  await expect(reclaimableTooltip()).toBeVisible()
  await expect(reclaimableTooltip()).toContainText(/liberar/i)
  await page.keyboard.press('Escape')
  await expect(reclaimableTooltip()).toHaveCount(0)
})

/**
 * Ficha 0019: tablas de discos y de los procesos que más consumen en la página de un HOST, con los
 * datos de HOST_METRICS_ID (HOST_PAGE_DISKS y HOST_PAGE_PROCESSES, canal entities:hostBreakdown).
 *
 * Nombres que fijan estos tests: las tarjetas `host-disks` y `host-processes`, debajo de
 * `host-charts`; dentro, el `DataGrid` con `gridTestId` `host-disks-grid` y `host-processes-grid`
 * y filas `host-disk-row` (con `data-disk-id`) y `host-process-row` (con `data-process-id`).
 * Columnas, en este orden: discos `name`, `usage`, `used` (usado / total), `free`, `read` y
 * `write`; procesos `name`, `cpu` (media, con su barra `host-process-cpu-bar`), `cpuMax` y
 * `memory`. La barra de uso del disco, `host-disk-usage` con `data-level`. El nombre del proceso
 * es un enlace a su página. Debajo de los procesos, `host-processes-count` («10 de N procesos»)
 * y, si la métrica de procesos llega recortada (`partial`), `host-processes-partial`.
 */
const DISK_COLUMNS = ['name', 'usage', 'used', 'free', 'read', 'write'] as const
const PROCESS_COLUMNS = ['name', 'cpu', 'cpuMax', 'memory'] as const
const hostDisks = (): Locator => page.getByTestId('host-disks')
const hostProcesses = (): Locator => page.getByTestId('host-processes')
const diskRow = (id: string): Locator =>
  hostDisks().locator(`[data-testid="host-disk-row"][data-disk-id="${id}"]`)
const processRow = (id: string): Locator =>
  hostProcesses().locator(`[data-testid="host-process-row"][data-process-id="${id}"]`)

/** Ficha 0019: ids de las filas de la tabla, en el orden en que se pintan. */
async function tableOrder(card: Locator, rowTestId: string, attribute: string): Promise<string[]> {
  return card
    .getByTestId(rowTestId)
    .evaluateAll(
      (els, attr) =>
        els
          .sort(
            (a, b) => Number(a.getAttribute('data-index')) - Number(b.getAttribute('data-index'))
          )
          .map((el) => el.getAttribute(attr) ?? ''),
      attribute
    )
}
const diskOrder = (): Promise<string[]> => tableOrder(hostDisks(), 'host-disk-row', 'data-disk-id')
const processOrder = (): Promise<string[]> =>
  tableOrder(hostProcesses(), 'host-process-row', 'data-process-id')

/** Ficha 0019: las columnas del grid (sus testid), en orden. */
async function gridColumns(grid: Locator): Promise<(string | null)[]> {
  return grid
    .locator('[role="columnheader"]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')))
}

/** Los 10 procesos de HOST_PAGE_PROCESSES con más CPU media, de más a menos. */
const HOST_PAGE_TOP = HOST_PAGE_PROCESSES.slice()
  .sort((a, b) => b.cpu.avg - a.cpu.avg)
  .slice(0, 10)

/** Ficha 0019: espera a que las dos tablas tengan sus filas (3 discos y 10 procesos). */
async function expectHostTablesLoaded(): Promise<void> {
  await expect(hostDisks().getByTestId('host-disk-row')).toHaveCount(3)
  await expect(hostProcesses().getByTestId('host-process-row')).toHaveCount(10)
}

test('CA1 (0019): con 3 discos, la tabla los enseña del más lleno al menos, con su %, usado/total, libre, lectura y escritura formateados', async () => {
  await openHostPage()
  const card = hostDisks()
  await expect(card).toBeVisible()
  const grid = card.getByTestId('host-disks-grid')
  await expect(grid).toHaveAttribute('role', 'grid')
  await expect(card.getByTestId('host-disk-row')).toHaveCount(3)
  expect(await gridColumns(grid)).toEqual(DISK_COLUMNS.map((c) => `col-${c}`))
  await expect(grid.getByTestId('col-usage')).toHaveAttribute('aria-sort', 'descending')

  // Del más lleno (último dato) al menos; el simulador los da en otro orden.
  expect(await diskOrder()).toEqual([
    'DISK-00000000000E2E12',
    'DISK-00000000000E2E13',
    'DISK-00000000000E2E11'
  ])

  const levels = es.entities.host.markers.levels
  const expected = [
    {
      id: 'DISK-00000000000E2E12',
      name: '/datos',
      pct: /(^|[^\d,.])91\s?%/,
      level: 'error',
      used: /(^|[^\d,.])455,0\sGB.*(^|[^\d,.])500,0\sGB/,
      free: /^45,0\sGB$/,
      read: /^2,5\sMB\/s$/,
      write: /^12,0\skB\/s$/
    },
    {
      id: 'DISK-00000000000E2E13',
      name: '/var',
      pct: /(^|[^\d,.])85\s?%/,
      level: 'warning',
      used: /(^|[^\d,.])170,0\sGB.*(^|[^\d,.])200,0\sGB/,
      free: /^30,0\sGB$/,
      read: /^0\sB\/s$/,
      write: /^800\sB\/s$/
    },
    {
      id: 'DISK-00000000000E2E11',
      name: '/',
      pct: /(^|[^\d,.])40\s?%/,
      level: 'normal',
      used: /(^|[^\d,.])40,0\sGB.*(^|[^\d,.])100,0\sGB/,
      free: /^60,0\sGB$/,
      read: /^300\sB\/s$/,
      write: /^1,5\skB\/s$/
    }
  ] as const
  for (const disk of expected) {
    const cells = diskRow(disk.id).getByRole('gridcell')
    await expect(cells, disk.name).toHaveCount(DISK_COLUMNS.length)
    await expect(cells.nth(0), disk.name).toHaveText(disk.name)
    // Barra de uso con su % y su nivel (color en data-level y, si no es normal, texto).
    const usage = cells.nth(1)
    await expect(usage, disk.name).toContainText(disk.pct)
    await expect(usage.getByTestId('host-disk-usage'), disk.name).toHaveAttribute(
      'data-level',
      disk.level
    )
    if (disk.level === 'normal') {
      await expect(usage, disk.name).not.toContainText(levels.warning)
      await expect(usage, disk.name).not.toContainText(levels.error)
    } else {
      await expect(usage, disk.name).toContainText(levels[disk.level])
    }
    await expect(cells.nth(2), disk.name).toContainText(disk.used)
    await expect(cells.nth(3), disk.name).toHaveText(disk.free)
    await expect(cells.nth(4), disk.name).toHaveText(disk.read)
    await expect(cells.nth(5), disk.name).toHaveText(disk.write)
  }

  // Debajo de los gráficos.
  const charts = await settledBox(page.getByTestId('host-charts'))
  const disks = await settledBox(card)
  expect(disks.y).toBeGreaterThanOrEqual(charts.y + charts.height - 1)
  // Con el rango global.
  await settledRequests()
  expect(sim.hostBreakdownQueries.length).toBeGreaterThan(0)
  for (const query of sim.hostBreakdownQueries) expect(query.get('from')).toBe('now-2h')
})

test('CA2 (0019): con 15 procesos, la tabla enseña los 10 con más CPU, ordenados, y «10 de 15 procesos»', async () => {
  await openHostPage()
  const card = hostProcesses()
  await expect(card).toBeVisible()
  const grid = card.getByTestId('host-processes-grid')
  await expect(grid).toHaveAttribute('role', 'grid')
  await expect(card.getByTestId('host-process-row')).toHaveCount(10)
  expect(await gridColumns(grid)).toEqual(PROCESS_COLUMNS.map((c) => `col-${c}`))
  await expect(grid.getByTestId('col-cpu')).toHaveAttribute('aria-sort', 'descending')

  // Los 10 con más CPU media, de más a menos (los de 7, 5, 3, 2 y 1 % se quedan fuera).
  expect(HOST_PAGE_TOP.map((p) => p.cpu.avg)).toEqual([61, 47, 40, 35, 28, 24, 19, 15, 12, 9])
  expect(await processOrder()).toEqual(HOST_PAGE_TOP.map((p) => p.id))

  // Cada fila: nombre, CPU media con su barra, máxima y memoria media.
  for (const process of HOST_PAGE_TOP) {
    const cells = processRow(process.id).getByRole('gridcell')
    await expect(cells, process.name).toHaveCount(PROCESS_COLUMNS.length)
    await expect(cells.nth(0), process.name).toHaveText(process.name)
    await expect(cells.nth(1), process.name).toContainText(
      new RegExp(`(^|[^\\d,.])${process.cpu.avg}\\s?%`)
    )
    await expect(cells.nth(1).getByTestId('host-process-cpu-bar'), process.name).toHaveCount(1)
    await expect(cells.nth(2), process.name).toHaveText(new RegExp(`^${process.cpu.max}\\s?%$`))
  }
  // Memoria en su unidad: 300 MB y 750 MB.
  const first = HOST_PAGE_TOP[0]
  const second = HOST_PAGE_TOP[1]
  expect(first?.memory.avg).toBe(300_000_000)
  expect(second?.memory.avg).toBe(750_000_000)
  await expect(
    processRow(first?.id ?? '')
      .getByRole('gridcell')
      .nth(3)
  ).toHaveText(/^300,0\sMB$/)
  await expect(
    processRow(second?.id ?? '')
      .getByRole('gridcell')
      .nth(3)
  ).toHaveText(/^750,0\sMB$/)

  await expect(card.getByTestId('host-processes-count')).toHaveText(/^10 de 15 procesos$/)
  // Sin recorte, sin aviso.
  await expect(card.getByTestId('host-processes-partial')).toHaveCount(0)

  // Debajo de los gráficos, como los discos.
  const charts = await settledBox(page.getByTestId('host-charts'))
  const processes = await settledBox(card)
  expect(processes.y).toBeGreaterThanOrEqual(charts.y + charts.height - 1)
})

test('CA3 (0019): pulsar un proceso abre su página de entidad con su nombre, y «Volver» regresa al host sin volver a pedir sus datos', async () => {
  await openHostPage()
  await expectHostTablesLoaded()
  const target = HOST_PAGE_TOP[4]
  const id = target?.id ?? ''
  const name = target?.name ?? ''
  const link = processRow(id).getByRole('link', { name })
  await expect(link).toHaveAttribute('href', new RegExp(`#/entities/PROCESS_GROUP_INSTANCE/${id}$`))

  await settledRequests()
  const breakdownBefore = sim.hostBreakdownQueries.length
  const metricsBefore = sim.hostMetricQueries.length
  await clickInPlace(link, { scroll: true })
  const processPage = page.getByTestId('entity-page-process_group_instance')
  await expect(processPage).toBeVisible()
  expect(await currentRoute()).toBe(`/entities/PROCESS_GROUP_INSTANCE/${id}`)
  await expect(processPage.getByRole('heading', { level: 1 })).toHaveText(name)
  await expect(processPage.getByTestId('entity-page-id')).toHaveText(id)

  const before = await settledRequests()
  await clickInPlace(processPage.getByTestId('entity-back'), { scroll: true })
  await expect(page.getByTestId('entity-page-host')).toBeVisible()
  expect(await currentRoute()).toBe(`/entities/HOST/${HOST_METRICS_ID}`)
  await expectHostTablesLoaded()
  await expectHostMarkerValues()
  await page.waitForTimeout(1500)
  expect(sim.requests.slice(before), 'peticiones al volver al host').toEqual([])
  expect(sim.hostBreakdownQueries).toHaveLength(breakdownBefore)
  expect(sim.hostMetricQueries).toHaveLength(metricsBefore)
})

test('CA4 (0019): ordenar por otra columna (libre en discos, memoria en procesos) reordena las filas', async () => {
  await openHostPage()
  await expectHostTablesLoaded()

  // Discos por libre: /var 30 GB, /datos 45 GB y / 60 GB.
  const disksGrid = hostDisks().getByTestId('host-disks-grid')
  const byFree = ['DISK-00000000000E2E13', 'DISK-00000000000E2E12', 'DISK-00000000000E2E11']
  await clickInPlace(disksGrid.getByTestId('sort-free'), { scroll: true })
  const freeCol = disksGrid.getByTestId('col-free')
  await expect(freeCol).toHaveAttribute('aria-sort', /^(ascending|descending)$/)
  await expect(disksGrid.getByTestId('col-usage')).toHaveAttribute('aria-sort', 'none')
  const freeAsc = (await freeCol.getAttribute('aria-sort')) === 'ascending'
  expect(await diskOrder()).toEqual(freeAsc ? byFree : byFree.slice().reverse())
  // La misma columna otra vez: al revés.
  await clickInPlace(disksGrid.getByTestId('sort-free'), { scroll: true })
  await expect(freeCol).toHaveAttribute('aria-sort', freeAsc ? 'descending' : 'ascending')
  expect(await diskOrder()).toEqual(freeAsc ? byFree.slice().reverse() : byFree)

  // Procesos por memoria media (los mismos 10, en otro orden que por CPU).
  const processesGrid = hostProcesses().getByTestId('host-processes-grid')
  const byMemory = HOST_PAGE_TOP.slice()
    .sort((a, b) => a.memory.avg - b.memory.avg)
    .map((p) => p.id)
  expect(byMemory).not.toEqual(HOST_PAGE_TOP.map((p) => p.id))
  expect(byMemory.slice().reverse()).not.toEqual(HOST_PAGE_TOP.map((p) => p.id))
  await clickInPlace(processesGrid.getByTestId('sort-memory'), { scroll: true })
  const memoryCol = processesGrid.getByTestId('col-memory')
  await expect(memoryCol).toHaveAttribute('aria-sort', /^(ascending|descending)$/)
  await expect(processesGrid.getByTestId('col-cpu')).toHaveAttribute('aria-sort', 'none')
  const memoryAsc = (await memoryCol.getAttribute('aria-sort')) === 'ascending'
  expect(await processOrder()).toEqual(memoryAsc ? byMemory : byMemory.slice().reverse())
  await clickInPlace(processesGrid.getByTestId('sort-memory'), { scroll: true })
  await expect(memoryCol).toHaveAttribute('aria-sort', memoryAsc ? 'descending' : 'ascending')
  expect(await processOrder()).toEqual(memoryAsc ? byMemory.slice().reverse() : byMemory)
  // Ordenar no cambia qué procesos salen ni el total.
  await expect(hostProcesses().getByTestId('host-process-row')).toHaveCount(10)
  await expect(hostProcesses().getByTestId('host-processes-count')).toHaveText(
    /^10 de 15 procesos$/
  )
})

test('CA6 (0019): si falla el canal, las dos tarjetas enseñan el aviso con Reintentar y los gráficos siguen', async () => {
  sim.hostBreakdownFail = true
  await openHostPage()

  for (const card of [hostDisks(), hostProcesses()]) {
    await expect(card).toBeVisible()
    await expect(card.getByRole('alert').first()).toBeVisible()
    await expect(card.getByRole('button', { name: 'Reintentar' })).toBeVisible()
  }
  await expect(hostDisks().getByTestId('host-disk-row')).toHaveCount(0)
  await expect(hostProcesses().getByTestId('host-process-row')).toHaveCount(0)

  // Marcadores y gráficos, con sus datos y sin aviso.
  await expectHostMarkerValues()
  for (const kind of HOST_CHART_KINDS) {
    expect(await hostChartSeries(kind), kind).toHaveLength(HOST_CHART_SERIES[kind].length)
    await expect(
      hostChartPanel(kind).getByRole('button', { name: 'Reintentar' }),
      kind
    ).toHaveCount(0)
  }

  // Reintentar, con el canal ya bien: llegan las dos tablas (un mismo canal).
  sim.hostBreakdownFail = false
  await clickInPlace(hostDisks().getByRole('button', { name: 'Reintentar' }), { scroll: true })
  await expectHostTablesLoaded()
  for (const card of [hostDisks(), hostProcesses()]) {
    await expect(card.getByRole('button', { name: 'Reintentar' })).toHaveCount(0)
  }
})

test('CA6 (0019): sin datos, «Sin discos» y «Sin procesos»', async () => {
  sim.hostBreakdownEmpty = true
  await openHostPage()
  await expect(hostDisks()).toContainText('Sin discos')
  await expect(hostProcesses()).toContainText('Sin procesos')
  await expect(hostDisks().getByTestId('host-disk-row')).toHaveCount(0)
  await expect(hostProcesses().getByTestId('host-process-row')).toHaveCount(0)
  for (const card of [hostDisks(), hostProcesses()]) {
    await expect(card.getByRole('alert')).toHaveCount(0)
    await expect(card.getByRole('button', { name: 'Reintentar' })).toHaveCount(0)
  }
  // Los gráficos siguen.
  expect(await hostChartSeries('cpu')).toHaveLength(HOST_CHART_SERIES.cpu.length)
})

test('Aviso de recorte de procesos (0019): con la métrica de procesos en partial, la tabla avisa de que la lista y el total pueden estar incompletos', async () => {
  // Recortada solo una de discos: la de procesos no avisa.
  sim.hostBreakdownTruncated = 'disks'
  await openHostPage()
  await expectHostTablesLoaded()
  await settledRequests()
  await expect(hostProcesses().getByTestId('host-processes-partial')).toHaveCount(0)

  // Con la de procesos recortada, tras «Actualizar»: el aviso, sin quitar las filas ni el total.
  sim.hostBreakdownTruncated = 'processes'
  const before = sim.hostBreakdownQueries.length
  await page.getByTestId('entity-page-host').getByTestId('module-refresh').click()
  await expect.poll(() => sim.hostBreakdownQueries.length).toBeGreaterThan(before)
  const notice = hostProcesses().getByTestId('host-processes-partial')
  await expect(notice).toBeVisible()
  await expect(notice).toContainText(/incomplet/i)
  await expect(hostProcesses().getByTestId('host-process-row')).toHaveCount(10)
  await expect(hostProcesses().getByTestId('host-processes-count')).toHaveText(
    /^10 de 15 procesos$/
  )
})

/**
 * Ficha 0020: tarjeta «Información» de la página de un HOST (HOST_INFO_FULL_ID y HOST_METRICS_ID,
 * canal entities:get), con la misma forma que la del servicio (0015) y sus nombres con el prefijo
 * `host-info`.
 *
 * Nombres que fijan estos tests: la tarjeta `host-info`, entre la cabecera y `host-markers`;
 * dentro, cada grupo de filas en un `host-info-section` con `data-section` (system, capacity,
 * network, monitoring, grouping y cloud, en ese orden y solo los que tengan filas) y su nombre
 * en un encabezado; cada fila, `host-info-row` con `data-key` (las claves de `buildHostInfo`) y
 * su valor en `host-info-value`; los chips, `host-info-chip`; las IPs, las 2 primeras y un botón
 * `host-info-more` con «+N» que enseña el resto. Las relaciones, en `host-info-relations`: cada
 * grupo `host-info-group` con `data-group` (processes, services, runsOn, hostGroup y other), con
 * `host-info-group-toggle` (aria-expanded), `host-info-group-count` y, desplegado, sus
 * `host-info-entity` (enlaces, con `data-entity-id`), el botón `host-info-names` («Ver nombres»)
 * y cada nombre en `host-info-entity-name`. «Todas las propiedades», `host-info-properties-toggle`
 * y cada una `host-info-property` con `data-key`. La memoria, en GB (10^9 bytes, como la 0018).
 */
const HOST_INFO_SECTIONS: [string, string, string[]][] = [
  ['system', 'Sistema', ['osType', 'osVersion', 'osArchitecture', 'bitness']],
  ['capacity', 'Capacidad', ['cpuCores', 'logicalCpuCores', 'memory']],
  ['network', 'Red', ['ipAddress', 'networkZone']],
  [
    'monitoring',
    'Monitorización',
    ['monitoringMode', 'state', 'installerVersion', 'firstSeen', 'lastSeen']
  ],
  // Ficha 0037: sin la fila de etiquetas (van en las píldoras de arriba).
  ['grouping', 'Agrupación', ['hostGroupName', 'managementZones']],
  ['cloud', 'Nube o virtualización', ['cloudType', 'hypervisorType']]
]
const hostInfoCard = (): Locator => page.getByTestId('host-info')
const hostInfoSection = (key: string): Locator =>
  hostInfoCard().locator(`[data-testid="host-info-section"][data-section="${key}"]`)
const hostInfoRow = (key: string): Locator =>
  hostInfoCard().locator(`[data-testid="host-info-row"][data-key="${key}"]`)
const hostInfoValue = (key: string): Locator => hostInfoRow(key).getByTestId('host-info-value')
const hostInfoGroup = (key: string): Locator =>
  hostInfoCard().locator(`[data-testid="host-info-group"][data-group="${key}"]`)
const hostInfoEntity = (group: string, id: string): Locator =>
  hostInfoGroup(group).locator(`[data-testid="host-info-entity"][data-entity-id="${id}"]`)

/** Ficha 0020: abre la página de un host por URL y espera la tarjeta con sus filas. */
async function openHostInfo(id: string): Promise<Locator> {
  await goToRoute(`/entities/HOST/${id}`)
  await expect(page.getByTestId('entity-page-host')).toBeVisible()
  const card = hostInfoCard()
  await expect(card).toBeVisible()
  await expect(card.getByTestId('host-info-row').first()).toBeVisible()
  return card
}

/** Ficha 0020: despliega un grupo de relaciones del host (si no lo está), trayéndolo a la vista. */
async function expandHostGroup(key: string): Promise<Locator> {
  const group = hostInfoGroup(key)
  const toggle = group.getByTestId('host-info-group-toggle')
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await clickInPlace(toggle, { scroll: true })
  }
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  return group
}

test('CA2 (0020): la página de un HOST enseña la tarjeta «Información» con sus grupos (Sistema, Capacidad, Red…), memoria en GB, IPs con «+N» y lo demás solo en «Todas las propiedades»', async () => {
  const card = await openHostInfo(HOST_INFO_FULL_ID)
  await expect(card).toContainText('Información')

  // Debajo de los marcadores: desde la ficha 0036, «Información» va al final de la página.
  const cardBox = await settledBox(card)
  const markersBox = await settledBox(page.getByTestId('host-markers'))
  expect(cardBox.y, 'la tarjeta va debajo de los marcadores').toBeGreaterThanOrEqual(
    markersBox.y + markersBox.height - 1
  )

  // Los grupos de filas, en su orden y con su nombre; las filas de cada uno, en el suyo.
  const sections = card.getByTestId('host-info-section')
  await expect(sections).toHaveCount(HOST_INFO_SECTIONS.length)
  expect(await dataKeys(sections, 'data-section')).toEqual(HOST_INFO_SECTIONS.map(([key]) => key))
  for (const [key, title, rows] of HOST_INFO_SECTIONS) {
    await expect(hostInfoSection(key).getByRole('heading').first(), key).toContainText(title)
    expect(await dataKeys(hostInfoSection(key).getByTestId('host-info-row')), key).toEqual(rows)
  }

  // Los valores.
  const texts: [string, string][] = [
    ['osType', 'LINUX'],
    ['osVersion', 'Ubuntu 24.04 e2e'],
    ['osArchitecture', 'X86'],
    ['bitness', '64'],
    ['cpuCores', '4'],
    ['logicalCpuCores', '8'],
    ['networkZone', 'zona-red-e2e'],
    ['monitoringMode', 'FULL_STACK'],
    ['state', 'RUNNING'],
    ['installerVersion', '1.300.12.20260901-e2e'],
    ['hostGroupName', 'grupo-hosts-e2e'],
    ['cloudType', 'EC2'],
    ['hypervisorType', 'KVM'],
    ['firstSeen', '2026'],
    ['lastSeen', '2026']
  ]
  for (const [key, text] of texts) {
    await expect(hostInfoValue(key), key).toContainText(text)
  }
  // Memoria: physicalMemory (16 GB), no memoryTotal (15,5 GB), en GB y sin bytes.
  await expect(hostInfoValue('memory')).toHaveText(/^16,0\sGB$/)

  // IPs: las 2 primeras y «+2», que enseña el resto.
  const ipChips = hostInfoRow('ipAddress').getByTestId('host-info-chip')
  await expect(ipChips).toHaveText(HOST_INFO_IPS.slice(0, 2))
  const more = hostInfoRow('ipAddress').getByTestId('host-info-more')
  await expect(more).toHaveText('+2')
  await clickInPlace(more, { scroll: true })
  await expect(ipChips).toHaveText(HOST_INFO_IPS)

  // Zonas, como chips; las etiquetas ya no salen en la tarjeta (ficha 0037).
  await expect(hostInfoRow('managementZones').getByTestId('host-info-chip')).toHaveText([
    'Zona host A',
    'Zona host B'
  ])
  await expect(hostInfoRow('tags')).toHaveCount(0)

  // Lo que la ficha no nombra, fuera de las filas; «Todas las propiedades» empieza plegada.
  const otherTexts = [
    ...Object.keys(HOST_INFO_OTHER),
    'nombre-detectado-host-e2e',
    'nombre-propio-host-e2e',
    '00-00-5E-00-53-01',
    'memoryTotal',
    'physicalMemory',
    '15,5',
    '16000000000'
  ]
  const allSections = card.locator('[data-testid="host-info-section"]')
  for (const text of otherTexts) {
    for (const [key] of HOST_INFO_SECTIONS) {
      await expect(hostInfoSection(key), `${key}: ${text}`).not.toContainText(text)
    }
  }
  await expect(allSections).toHaveCount(HOST_INFO_SECTIONS.length)
  await expect(card.getByTestId('host-info-property')).toHaveCount(0)
  const toggle = card.getByTestId('host-info-properties-toggle')
  await expect(toggle).toContainText('Todas las propiedades')
  await clickInPlace(toggle, { scroll: true })
  await expect(card.getByTestId('host-info-property')).toHaveCount(HOST_INFO_FULL_PROPERTY_COUNT)
  const property = (key: string): Locator =>
    card.locator(`[data-testid="host-info-property"][data-key="${key}"]`)
  await expect(property('detectedName')).toContainText('nombre-detectado-host-e2e')
  await expect(property('macAddresses')).toContainText('00-00-5E-00-53-01')
  await expect(property('memoryTotal')).toContainText('memoryTotal')

  // Sin la tarjeta del servicio en la página del host.
  await expect(page.getByTestId('service-info')).toHaveCount(0)
})

test('CA2 (0020): con un HOST con pocas claves solo salen los grupos y las filas con dato, sin «undefined»', async () => {
  const card = await openHostInfo(HOST_METRICS_ID)
  // osType, memoryTotal (8 GB) y la última vez visto; osVersion, ipAddress y hostGroupName
  // vacíos, sin primera vez, sin zonas, sin etiquetas y sin nube: ninguna de esas filas.
  await expect(card.getByTestId('host-info-row')).toHaveCount(3)
  expect(await dataKeys(card.getByTestId('host-info-section'), 'data-section')).toEqual([
    'system',
    'capacity',
    'monitoring'
  ])
  expect(await dataKeys(card.getByTestId('host-info-row'))).toEqual([
    'osType',
    'memory',
    'lastSeen'
  ])
  await expect(hostInfoValue('osType')).toContainText('WINDOWS')
  await expect(hostInfoValue('memory')).toHaveText(/^8,0\sGB$/)
  await expect(hostInfoValue('lastSeen')).toHaveText(/\S/)
  // Sin relaciones, ningún grupo.
  await expect(card.getByTestId('host-info-group')).toHaveCount(0)
  await clickInPlace(card.getByTestId('host-info-properties-toggle'), { scroll: true })
  await expect(card.getByTestId('host-info-property').first()).toBeVisible()
  for (const text of ['undefined', 'null', 'NaN', '[object Object]']) {
    await expect(card, text).not.toContainText(text)
  }
  // El resto de la página sigue: marcadores con sus valores.
  await expectHostMarkerValues()
})

test('CA3 (0020): las relaciones salen en su orden con su número; «Ver nombres» los trae a demanda; pulsar un servicio abre su página y «Volver» regresa al host', async () => {
  const card = await openHostInfo(HOST_INFO_FULL_ID)
  const relations = card.getByTestId('host-info-relations')
  await expect(relations).toContainText('Relaciones')

  const groups = relations.getByTestId('host-info-group')
  await expect(groups).toHaveCount(5)
  expect(await dataKeys(groups, 'data-group')).toEqual([
    'processes',
    'services',
    'runsOn',
    'hostGroup',
    'other'
  ])
  const expected = [
    ['processes', 'Procesos', '2'],
    ['services', 'Servicios', '2'],
    ['runsOn', 'Se ejecuta en', '1'],
    ['hostGroup', 'Grupo de hosts', '1'],
    ['other', 'Otras relaciones', '3']
  ] as const
  for (const [key, title, count] of expected) {
    await expect(hostInfoGroup(key), key).toContainText(title)
    await expect(hostInfoGroup(key).getByTestId('host-info-group-count'), key).toHaveText(
      new RegExp(`^\\s*${count}\\s*$`)
    )
  }
  // «Otras relaciones», plegada.
  await expect(hostInfoGroup('other').getByTestId('host-info-group-toggle')).toHaveAttribute(
    'aria-expanded',
    'false'
  )
  await expect(hostInfoGroup('other').getByTestId('host-info-entity')).toHaveCount(0)

  // Desplegados, con sus entidades en el orden de la respuesta; ningún nombre pedido aún.
  const processes = await expandHostGroup('processes')
  expect(await dataKeys(processes.getByTestId('host-info-entity'), 'data-entity-id')).toEqual(
    HOST_INFO_PGIS
  )
  const services = await expandHostGroup('services')
  expect(await dataKeys(services.getByTestId('host-info-entity'), 'data-entity-id')).toEqual([
    INFO_FEW_ID,
    HOST_INFO_SERVICE_2
  ])
  await expandHostGroup('runsOn')
  await expect(hostInfoEntity('runsOn', HOST_INFO_EC2)).toContainText(HOST_INFO_EC2)
  await expandHostGroup('hostGroup')
  await expect(hostInfoEntity('hostGroup', HOST_INFO_GROUP)).toContainText(HOST_INFO_GROUP)
  const other = await expandHostGroup('other')
  for (const name of ['runsOn', 'isDiskOf', 'isNetworkClientOfHost']) {
    await expect(other, name).toContainText(name)
  }
  expect(
    [...(await dataKeys(other.getByTestId('host-info-entity'), 'data-entity-id'))].sort()
  ).toEqual([HOST_INFO_DISK, HOST_INFO_PEER, HOST_INFO_PG].sort())
  await settledRequests()
  expect(sim.entityNamesQueries, 'nombres antes de «Ver nombres»').toHaveLength(0)

  // «Ver nombres» de «Servicios»: una llamada con sus dos ids y los nombres en su sitio.
  const button = services.getByTestId('host-info-names')
  await expect(button).toHaveText('Ver nombres')
  await clickInPlace(button, { scroll: true })
  await expect.poll(() => sim.entityNamesQueries.length).toBe(1)
  const selector = sim.entityNamesQueries[0]?.get('entitySelector') ?? ''
  expect(selector).toContain(INFO_FEW_ID)
  expect(selector).toContain(HOST_INFO_SERVICE_2)
  const service = hostInfoEntity('services', INFO_FEW_ID)
  await expect(service.getByTestId('host-info-entity-name')).toHaveText('info-pocas-e2e')
  await expect(
    hostInfoEntity('services', HOST_INFO_SERVICE_2).getByTestId('host-info-entity-name')
  ).toHaveText('servicio-host-e2e')
  // Los de otros grupos, sin pedir.
  await settledRequests()
  expect(sim.entityNamesQueries).toHaveLength(1)
  await expect(
    hostInfoEntity('processes', HOST_INFO_PGIS[0] ?? '').getByTestId('host-info-entity-name')
  ).toHaveCount(0)

  // Cada entidad es un enlace a su página; pulsar el servicio abre la del servicio.
  await expect(service).toHaveRole('link')
  await expect(service).toHaveAttribute('href', new RegExp(`#/entities/SERVICE/${INFO_FEW_ID}$`))
  await expect(hostInfoEntity('processes', HOST_INFO_PGIS[0] ?? '')).toHaveAttribute(
    'href',
    new RegExp(`#/entities/PROCESS_GROUP_INSTANCE/${HOST_INFO_PGIS[0]}$`)
  )
  const hostQueries = (): number =>
    sim.requests.filter((request) => request.includes(`/entities/${HOST_INFO_FULL_ID}`)).length
  const hostQueriesBefore = hostQueries()
  await clickInPlace(service, { scroll: true })
  const servicePage = page.getByTestId('entity-page-service')
  await expect(servicePage).toBeVisible()
  expect(await currentRoute()).toBe(`/entities/SERVICE/${INFO_FEW_ID}`)
  await expect(servicePage.getByTestId('entity-page-id')).toHaveText(INFO_FEW_ID)
  await expect(page.getByTestId('host-info')).toHaveCount(0)

  // «Volver» regresa al host, sin volver a pedir sus datos.
  await clickInPlace(servicePage.getByTestId('entity-back'), { scroll: true })
  await expect(page.getByTestId('entity-page-host')).toBeVisible()
  expect(await currentRoute()).toBe(`/entities/HOST/${HOST_INFO_FULL_ID}`)
  await expect(hostInfoValue('osType')).toContainText('LINUX')
  await settledRequests()
  expect(hostQueries(), 'entities:get del host al volver').toBe(hostQueriesBefore)
})

test('CA4 (0020): sin entities.read, la tarjeta del host dice qué scope falta y los marcadores y gráficos siguen', async () => {
  const tenants = await invoke<{ clients: { id: string; name: string }[] }>('tenants:list')
  const clientId = tenants.clients.find((client) => client.name === 'Cliente A')?.id ?? ''
  const noEntities = await createEnvironment(
    clientId,
    'Sin entidades host',
    'other',
    TOKEN_NO_ENTITIES
  )
  try {
    await invoke('connection:test', { environmentId: noEntities })
    await invoke('environments:setActive', { environmentId: noEntities })
    await reloadUi()
    await goToRoute(`/entities/HOST/${HOST_METRICS_ID}`)
    await expect(page.getByTestId('entity-page-host')).toBeVisible()
    const unavailable = hostInfoCard().getByTestId('module-unavailable')
    await expect(unavailable).toBeVisible()
    await expect(unavailable).toContainText('entities.read')
    await expect(hostInfoCard().getByTestId('host-info-row')).toHaveCount(0)
    // Marcadores y gráficos, con sus datos.
    await expectHostMarkerValues()
    for (const kind of HOST_CHART_KINDS) {
      expect(await hostChartSeries(kind), kind).toHaveLength(HOST_CHART_SERIES[kind].length)
    }
    await settledRequests()
    expect(sim.entityInfoQueries, 'entities:get sin el scope').toHaveLength(0)
  } finally {
    await invoke('environments:setActive', { environmentId: env['Producción'] })
    await invoke('environments:delete', { id: noEntities })
    await reloadUi()
  }
})

test('CA5 (0020): la tarjeta del servicio sigue igual (sus filas, sus grupos y sin nada del host); los e2e de la 0015 siguen sin tocar, salvo el recuento de CA5 (0015)', async () => {
  const card = await openServiceInfo(INFO_FULL_ID)
  expect(
    await dataKeys(card.getByTestId('service-info-service').getByTestId('service-info-row'))
  ).toEqual(INFO_ROW_ORDER)
  expect(await dataKeys(card.getByTestId('service-info-group'), 'data-group')).toEqual([
    'runsOn',
    'calls',
    'calledBy',
    'other'
  ])
  await expect(card.locator('[data-testid^="host-info"]')).toHaveCount(0)
  await expect(page.getByTestId('host-info')).toHaveCount(0)
  await expect(page.getByTestId('service-markers')).toBeVisible()
})

/**
 * Ficha 0024: marcadores y gráficos de las páginas de un browser monitor (MONITOR_BROWSER_ID) y
 * de un HTTP monitor (MONITOR_HTTP_ID), con sus métricas (canal entities:monitorMetrics de la
 * 0022), su desglose (entities:monitorBreakdown de la 0023, para «Localizaciones») y sus
 * problemas (monitorBandProblems).
 *
 * Nombres que fijan estos tests (las dos páginas comparten componentes y testids): la fila
 * `monitor-markers`; cada marcador `monitor-marker-<id>` (availability, duration, executions,
 * locations y problems); dentro, el valor principal en `monitor-marker-value` (el de la
 * disponibilidad con `data-level`: `normal`, `warning` o `error`, umbrales del 99 y el 95 %) y lo
 * de debajo en `monitor-marker-secondary` (mediana, fallidas con `data-level` `error` si hay
 * alguna y `normal` si no, y localizaciones por debajo del 100 %); el texto del nivel, cuando no es
 * `normal`, en `monitor-marker-level`; los recuentos, en `monitor-marker-open` y
 * `monitor-marker-closed`. La sección `monitor-charts`; cada gráfico en un `monitor-chart-panel`
 * con `data-kind` (availability, duration, executions y performance, en ese orden; el cuarto es
 * el de rendimiento en browser y el de tiempos HTTP en HTTP) y su título en un encabezado;
 * dentro, el `Chart` con testid `monitor-chart-<kind>` (con `data-series`). La franja,
 * `monitor-problem-band`, dentro del panel de la disponibilidad; cada tramo,
 * `monitor-problem-segment` con `data-problem-id`.
 */
type MonitorPageKind = 'browser' | 'http'
const MONITOR_PAGES: Record<MonitorPageKind, { type: string; id: string; testId: string }> = {
  browser: {
    type: 'SYNTHETIC_TEST',
    id: MONITOR_BROWSER_ID,
    testId: 'entity-page-synthetic_test'
  },
  http: { type: 'HTTP_CHECK', id: MONITOR_HTTP_ID, testId: 'entity-page-http_check' }
}
const MONITOR_MARKER_LABELS = [
  ['availability', 'Disponibilidad'],
  ['duration', 'Duración'],
  ['executions', 'Ejecuciones'],
  ['locations', 'Localizaciones'],
  ['problems', 'Problemas']
] as const
const MONITOR_METRIC_MARKERS = ['availability', 'duration', 'executions'] as const
const MONITOR_CHART_KINDS = ['availability', 'duration', 'executions', 'performance'] as const
type MonitorChartKind = (typeof MONITOR_CHART_KINDS)[number]
const MONITOR_CHART_TITLES: Record<MonitorChartKind, string> = {
  availability: 'Disponibilidad',
  duration: 'Duración',
  executions: 'Ejecuciones',
  performance: 'Rendimiento'
}
/**
 * Las series de cada gráfico (`data-series`, en es). Las de rendimiento, por nombre y sin orden:
 * en browser, LCP, visually complete y speed index (el CLS, sin unidad de tiempo, puede ir o no);
 * en HTTP, DNS, TCP y TLS (el primer byte puede ir o no).
 */
const MONITOR_PERFORMANCE_SERIES: Record<MonitorPageKind, RegExp[]> = {
  browser: [/LCP|largest\s*contentful\s*paint/i, /visually\s*complete/i, /speed\s*index/i],
  http: [/DNS/i, /TCP/i, /TLS/i]
}

const monitorPage = (kind: MonitorPageKind): Locator => page.getByTestId(MONITOR_PAGES[kind].testId)
const monitorMarker = (id: string): Locator => page.getByTestId(`monitor-marker-${id}`)
const monitorChartPanel = (kind: MonitorChartKind): Locator =>
  page.locator(`[data-testid="monitor-chart-panel"][data-kind="${kind}"]`)
const monitorChartPlot = (kind: MonitorChartKind): Locator =>
  monitorChartPanel(kind).getByTestId(`monitor-chart-${kind}`)
const monitorBand = (): Locator =>
  monitorChartPanel('availability').getByTestId('monitor-problem-band')
const monitorSegment = (problemId: string): Locator =>
  monitorBand().locator(`[data-testid="monitor-problem-segment"][data-problem-id="${problemId}"]`)

/** Ficha 0024: abre por URL la página del monitor inventado de ese tipo. */
async function openMonitorPage(kind: MonitorPageKind): Promise<Locator> {
  const { type, id } = MONITOR_PAGES[kind]
  await goToRoute(`/entities/${type}/${id}`)
  const entityPage = monitorPage(kind)
  await expect(entityPage).toBeVisible()
  return entityPage
}

/** Ficha 0024: espera a que el gráfico tenga sus series (se monta vacío mientras carga). */
async function monitorChartSeries(kind: MonitorChartKind): Promise<string[]> {
  const plot = monitorChartPlot(kind)
  await expect(plot.locator('canvas').first()).toBeVisible()
  await expect(plot).toHaveAttribute('data-series', /\[.+\]/)
  return JSON.parse((await plot.getAttribute('data-series')) ?? '[]') as string[]
}

/** Ficha 0024: comprueba las series de un gráfico del monitor de ese tipo. */
async function expectMonitorChartSeries(
  pageKind: MonitorPageKind,
  kind: MonitorChartKind
): Promise<void> {
  const series = await monitorChartSeries(kind)
  if (kind === 'availability' || kind === 'duration') {
    expect(series, kind).toHaveLength(1)
    return
  }
  if (kind === 'executions') {
    expect(series, kind).toHaveLength(2)
    expect(series[0], 'correctas').toMatch(/correctas/i)
    expect(series[1], 'fallidas').toMatch(/fallidas/i)
    return
  }
  const expected = MONITOR_PERFORMANCE_SERIES[pageKind]
  expect(series.length, `${pageKind}: series de rendimiento`).toBeGreaterThanOrEqual(3)
  expect(series.length, `${pageKind}: series de rendimiento`).toBeLessThanOrEqual(4)
  for (const pattern of expected) {
    expect(
      series.some((name) => pattern.test(name)),
      `${pageKind}: ${String(pattern)} en ${JSON.stringify(series)}`
    ).toBe(true)
  }
}

/** Ficha 0024: los valores de los marcadores del browser monitor inventado, ya formateados (es). */
async function expectBrowserMonitorMarkers(): Promise<void> {
  // Disponibilidad del rango: 87,5 %, por debajo del 95 % (error, con texto además del color).
  const availability = monitorMarker('availability')
  await expect(availability.getByTestId('monitor-marker-value')).toHaveText(/^87,5\s?%$/)
  await expect(availability.getByTestId('monitor-marker-value')).toHaveAttribute(
    'data-level',
    'error'
  )
  await expect(availability.getByTestId('monitor-marker-level')).toBeVisible()
  await expect(availability.getByTestId('monitor-marker-level')).toHaveText(/\S/)
  // Duración: media 4550 ms (en s, con un decimal) y mediana 4400 ms.
  const duration = monitorMarker('duration')
  await expect(duration.getByTestId('monitor-marker-value')).toHaveText(/^4,[56]\s?s$/)
  await expect(duration.getByTestId('monitor-marker-secondary')).toContainText(/mediana/i)
  await expect(duration.getByTestId('monitor-marker-secondary')).toContainText(/(^|[^\d.,])4,4\s?s/)
  // Ejecuciones: 4 correctas y 1 fallida, en color de error.
  const executions = monitorMarker('executions')
  await expect(executions.getByTestId('monitor-marker-value')).toHaveText(/^4$/)
  await expect(executions.getByTestId('monitor-marker-secondary')).toContainText(loneNumber('1'))
  await expect(executions.getByTestId('monitor-marker-secondary')).toHaveAttribute(
    'data-level',
    'error'
  )
  // Localizaciones (0023): 3, dos por debajo del 100 %.
  const locations = monitorMarker('locations')
  await expect(locations.getByTestId('monitor-marker-value')).toHaveText(/^3$/)
  await expect(locations.getByTestId('monitor-marker-secondary')).toContainText(loneNumber('2'))
  // Problemas: 1 abierto y 1 cerrado.
  const problems = monitorMarker('problems')
  await expect(problems.getByTestId('monitor-marker-open')).toHaveText(loneNumber('1'))
  await expect(problems.getByTestId('monitor-marker-closed')).toHaveText(loneNumber('1'))
}

/** Ficha 0024: los valores de los marcadores del HTTP monitor inventado, ya formateados (es). */
async function expectHttpMonitorMarkers(): Promise<void> {
  // Disponibilidad del rango: 92,5 %, por debajo del 95 % (error, con texto).
  const availability = monitorMarker('availability')
  await expect(availability.getByTestId('monitor-marker-value')).toHaveText(/^92,5\s?%$/)
  await expect(availability.getByTestId('monitor-marker-value')).toHaveAttribute(
    'data-level',
    'error'
  )
  await expect(availability.getByTestId('monitor-marker-level')).toHaveText(/\S/)
  // Duración: media 310 ms; el HTTP monitor no tiene mediana (0022): no se pinta.
  const duration = monitorMarker('duration')
  await expect(duration.getByTestId('monitor-marker-value')).toHaveText(/^310\s?ms$/)
  await expect(duration).not.toContainText(/mediana/i)
  // Ejecuciones: 10 correctas y 2 fallidas, en color de error.
  const executions = monitorMarker('executions')
  await expect(executions.getByTestId('monitor-marker-value')).toHaveText(/^10$/)
  await expect(executions.getByTestId('monitor-marker-secondary')).toContainText(loneNumber('2'))
  await expect(executions.getByTestId('monitor-marker-secondary')).toHaveAttribute(
    'data-level',
    'error'
  )
  // Localizaciones (0023): 4, una por debajo del 100 %.
  const locations = monitorMarker('locations')
  await expect(locations.getByTestId('monitor-marker-value')).toHaveText(/^4$/)
  await expect(locations.getByTestId('monitor-marker-secondary')).toContainText(loneNumber('1'))
  // Problemas: 0 abiertos y 1 cerrado.
  const problems = monitorMarker('problems')
  await expect(problems.getByTestId('monitor-marker-open')).toHaveText(loneNumber('0'))
  await expect(problems.getByTestId('monitor-marker-closed')).toHaveText(loneNumber('1'))
}

/** Ficha 0024: CA1 y CA2, la misma comprobación para cada tipo de monitor. */
async function expectMonitorPage(kind: MonitorPageKind): Promise<void> {
  const entityPage = await openMonitorPage(kind)
  const row = entityPage.getByTestId('monitor-markers')
  await expect(row).toBeVisible()

  // Los cinco marcadores, con su nombre y sus valores.
  for (const [id, label] of MONITOR_MARKER_LABELS) {
    await expect(row.getByTestId(`monitor-marker-${id}`), id).toBeVisible()
    await expect(row.getByTestId(`monitor-marker-${id}`), id).toContainText(label)
  }
  if (kind === 'browser') await expectBrowserMonitorMarkers()
  else await expectHttpMonitorMarkers()

  // Los cuatro gráficos, en su orden, con su título y sus series.
  const section = entityPage.getByTestId('monitor-charts')
  await expect(section).toBeVisible()
  const panels = section.getByTestId('monitor-chart-panel')
  await expect(panels).toHaveCount(4)
  for (const [index, chart] of MONITOR_CHART_KINDS.entries()) {
    const panel = panels.nth(index)
    await expect(panel, `posición ${index + 1}`).toHaveAttribute('data-kind', chart)
    await expect(panel.getByRole('heading').first(), chart).toContainText(
      MONITOR_CHART_TITLES[chart]
    )
    await expectMonitorChartSeries(kind, chart)
  }

  // Ni el bloque ni el texto de «Página en construcción», ni marcadores de otro tipo.
  await expect(entityPage.getByTestId('entity-under-construction')).toHaveCount(0)
  await expect(entityPage).not.toContainText('Página en construcción')
  await expect(page.getByTestId('service-markers')).toHaveCount(0)
  await expect(page.getByTestId('host-markers')).toHaveCount(0)

  // Marcadores y gráficos comparten una sola llamada al canal de métricas (sus dos consultas),
  // con el monitor y el rango global.
  await settledRequests()
  expect(sim.monitorMetricQueries).toHaveLength(2)
  for (const query of sim.monitorMetricQueries) {
    expect(`${query.get('metricSelector')} ${query.get('entitySelector')}`).toContain(
      MONITOR_PAGES[kind].id
    )
    expect(query.get('from')).toBe('now-2h')
  }
}

test('CA1 (0024): la página de un browser monitor enseña los cinco marcadores con sus valores y los cuatro gráficos con sus series, sin «Página en construcción»', async () => {
  await expectMonitorPage('browser')
})

test('CA2 (0024): la página de un HTTP monitor enseña los cinco marcadores con sus valores y los cuatro gráficos, el cuarto con los tiempos HTTP', async () => {
  await expectMonitorPage('http')
})

// Lo que el simulador puede dejar «sin métrica» es el papel entero sin series: main da `null` por
// tipo (rendimiento en HTTP, tiempos en browser), nunca en el gráfico de su propio tipo. Aquí, el
// browser monitor sin ninguna métrica de rendimiento.
test('CA3 (0024): con el rendimiento sin métrica, su gráfico no sale, la rejilla queda en tres y el resto de marcadores y gráficos sí', async () => {
  sim.monitorPerformanceEmpty = true
  const entityPage = await openMonitorPage('browser')

  // Marcadores: los cinco, con sus valores.
  for (const [id] of MONITOR_MARKER_LABELS) {
    await expect(monitorMarker(id), id).toBeVisible()
  }
  await expectBrowserMonitorMarkers()

  // Gráficos: los tres primeros, con sus series; el de rendimiento, ni el panel.
  const panels = entityPage.getByTestId('monitor-charts').getByTestId('monitor-chart-panel')
  for (const kind of ['availability', 'duration', 'executions'] as const) {
    await expectMonitorChartSeries('browser', kind)
  }
  await expect(panels).toHaveCount(3)
  expect(await panels.evaluateAll((els) => els.map((el) => el.getAttribute('data-kind')))).toEqual([
    'availability',
    'duration',
    'executions'
  ])
  await expect(monitorChartPanel('performance')).toHaveCount(0)
  await expect(page.getByTestId('monitor-chart-performance')).toHaveCount(0)
})

test('CA5 (0024): la franja de problemas sale sobre el gráfico de disponibilidad con los problemas del monitor, y pulsar un tramo abre el problema', async () => {
  await openMonitorPage('browser')
  await monitorChartSeries('availability')
  const band = monitorBand()
  await expect(band).toBeVisible()
  await expect(band.getByTestId('monitor-problem-segment')).toHaveCount(2)
  for (const { problemId } of [MONITOR_BAND_OPEN, MONITOR_BAND_CLOSED]) {
    await expect(monitorSegment(problemId), problemId).toHaveCount(1)
  }
  // Solo en el panel de la disponibilidad.
  await expect(page.getByTestId('monitor-problem-band')).toHaveCount(1)

  // La lista se pide con el monitor y el rango global.
  await settledRequests()
  const lists = sim.entityProblemListQueries.filter((query) =>
    (query.get('problemSelector') ?? '').includes(MONITOR_BROWSER_ID)
  )
  expect(lists).toHaveLength(1)
  expect(lists[0]?.get('problemSelector')).toBe(`affectedEntities("${MONITOR_BROWSER_ID}")`)
  expect(lists[0]?.get('from')).toBe('now-2h')

  // Encima del gráfico: la franja acaba antes de que empiece el canvas.
  const bandBox = await settledBox(band)
  const plotBox = await settledBox(monitorChartPlot('availability'))
  expect(bandBox.y + bandBox.height).toBeLessThanOrEqual(plotBox.y + 1)

  // Pulsar un tramo (trayéndolo a la vista) abre ese problema.
  await clickInPlace(monitorSegment(MONITOR_BAND_CLOSED.problemId), { scroll: true })
  await expect(page.getByTestId('problem-page')).toBeVisible()
  await expect(page.getByTestId('problem-page-title')).toContainText(MONITOR_BAND_CLOSED.displayId)
  expect(await currentRoute()).toBe(`/problems/${MONITOR_BAND_CLOSED.problemId}`)

  // «Volver» regresa a la página del monitor.
  await page.getByTestId('problem-back').click()
  await expect(monitorPage('browser')).toBeVisible()
  expect(await currentRoute()).toBe(`/entities/SYNTHETIC_TEST/${MONITOR_BROWSER_ID}`)
})

test('CA6 (0024): cambiar el rango global vuelve a pedir los datos; «Actualizar» también; volver a la página sin cambios, no', async () => {
  await openMonitorPage('browser')
  await expectBrowserMonitorMarkers()
  await settledRequests()
  // Al entrar: las dos consultas de métricas, el desglose y los recuentos, con el rango global.
  expect(sim.monitorMetricQueries).toHaveLength(2)
  expect(sim.entityProblemQueries).toHaveLength(2)
  const breakdown = sim.monitorBreakdownQueries.length
  expect(breakdown, 'consultas del desglose al entrar').toBeGreaterThan(0)
  const all = (): URLSearchParams[] => [
    ...sim.monitorMetricQueries,
    ...sim.monitorBreakdownQueries,
    ...sim.entityProblemQueries
  ]
  for (const query of all()) expect(query.get('from')).toBe('now-2h')

  // Rango nuevo: otra vez, con now-24h.
  await page.getByTestId('time-range-24h').click()
  await expect.poll(() => sim.monitorMetricQueries.length).toBe(4)
  await expect.poll(() => sim.entityProblemQueries.length).toBe(4)
  await expect.poll(() => sim.monitorBreakdownQueries.length).toBe(breakdown * 2)
  for (const query of [
    ...sim.monitorMetricQueries.slice(2),
    ...sim.monitorBreakdownQueries.slice(breakdown),
    ...sim.entityProblemQueries.slice(2)
  ]) {
    expect(query.get('from')).toBe('now-24h')
  }
  await expectBrowserMonitorMarkers()
  await settledRequests()
  expect(sim.monitorMetricQueries).toHaveLength(4)

  // Fuera y vuelta, sin cambiar nada: ninguna petición nueva.
  await goTo('metrics')
  await expect(monitorPage('browser')).toHaveCount(0)
  const before = await settledRequests()
  await openMonitorPage('browser')
  await expectBrowserMonitorMarkers()
  await page.waitForTimeout(1500)
  expect(sim.requests.slice(before), 'peticiones al volver a la página').toEqual([])

  // «Actualizar», en la cabecera de la página: otra vez, con el rango actual.
  await monitorPage('browser').getByTestId('module-refresh').click()
  await expect.poll(() => sim.monitorMetricQueries.length).toBe(6)
  await expect.poll(() => sim.entityProblemQueries.length).toBe(6)
  await expect.poll(() => sim.monitorBreakdownQueries.length).toBe(breakdown * 3)
  for (const query of [
    ...sim.monitorMetricQueries.slice(4),
    ...sim.monitorBreakdownQueries.slice(breakdown * 2),
    ...sim.entityProblemQueries.slice(4)
  ]) {
    expect(query.get('from')).toBe('now-24h')
  }
  await expectBrowserMonitorMarkers()
})

test('CA6 (0024): si falla el canal de métricas, sus marcadores y cada gráfico enseñan el aviso con Reintentar; localizaciones y problemas siguen', async () => {
  sim.monitorMetricsFail = true
  await openMonitorPage('browser')

  // Localizaciones y problemas, con su dato y sin aviso.
  const locations = monitorMarker('locations')
  await expect(locations.getByTestId('monitor-marker-value')).toHaveText(/^3$/)
  await expect(locations.getByRole('button', { name: 'Reintentar' })).toHaveCount(0)
  const problems = monitorMarker('problems')
  await expect(problems.getByTestId('monitor-marker-open')).toHaveText(loneNumber('1'))
  await expect(problems.getByTestId('monitor-marker-closed')).toHaveText(loneNumber('1'))
  await expect(problems.getByRole('button', { name: 'Reintentar' })).toHaveCount(0)

  // Cada marcador de métricas, en su sitio, con el aviso y Reintentar y sin valor.
  for (const id of MONITOR_METRIC_MARKERS) {
    const marker = monitorMarker(id)
    await expect(marker, id).toBeVisible()
    await expect(marker.getByRole('alert').first(), id).toBeVisible()
    await expect(marker.getByRole('button', { name: 'Reintentar' }), id).toBeVisible()
    await expect(marker.getByTestId('monitor-marker-value'), id).toHaveCount(0)
  }
  // Cada gráfico (al menos los tres que tiene todo monitor), con su aviso y Reintentar, sin gráfico.
  const panels = page.getByTestId('monitor-chart-panel')
  for (const kind of ['availability', 'duration', 'executions'] as const) {
    await expect(monitorChartPanel(kind), kind).toBeVisible()
  }
  const shown = await panels.evaluateAll((els) => els.map((el) => el.getAttribute('data-kind')))
  for (const kind of shown as MonitorChartKind[]) {
    const panel = monitorChartPanel(kind)
    await expect(panel.getByRole('alert').first(), kind).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Reintentar' }), kind).toBeVisible()
    await expect(panel.getByTestId(`monitor-chart-${kind}`), kind).toHaveCount(0)
  }

  // Reintentar, con el canal ya bien: llegan valores y los cuatro gráficos.
  sim.monitorMetricsFail = false
  await clickInPlace(monitorMarker('availability').getByRole('button', { name: 'Reintentar' }), {
    scroll: true
  })
  await expectBrowserMonitorMarkers()
  for (const kind of MONITOR_CHART_KINDS) await expectMonitorChartSeries('browser', kind)
  for (const id of MONITOR_METRIC_MARKERS) {
    await expect(monitorMarker(id).getByRole('button', { name: 'Reintentar' }), id).toHaveCount(0)
  }
})

test('CA6 (0024): si falla el desglose, el marcador «Localizaciones» enseña el aviso con Reintentar y el resto sigue', async () => {
  sim.monitorBreakdownFail = true
  await openMonitorPage('http')

  const locations = monitorMarker('locations')
  await expect(locations).toBeVisible()
  await expect(locations.getByRole('alert').first()).toBeVisible()
  await expect(locations.getByRole('button', { name: 'Reintentar' })).toBeVisible()
  await expect(locations.getByTestId('monitor-marker-value')).toHaveCount(0)

  // Los demás marcadores y los gráficos, con sus datos.
  await expect(monitorMarker('availability').getByTestId('monitor-marker-value')).toHaveText(
    /^92,5\s?%$/
  )
  await expect(monitorMarker('problems').getByTestId('monitor-marker-closed')).toHaveText(
    loneNumber('1')
  )
  for (const kind of MONITOR_CHART_KINDS) await expectMonitorChartSeries('http', kind)

  // Reintentar, con el canal ya bien.
  sim.monitorBreakdownFail = false
  await clickInPlace(locations.getByRole('button', { name: 'Reintentar' }), { scroll: true })
  await expectHttpMonitorMarkers()
  await expect(locations.getByRole('button', { name: 'Reintentar' })).toHaveCount(0)
})

/**
 * Ficha 0025: tablas de localizaciones y de pasos (browser) o peticiones (HTTP) debajo de los
 * gráficos de las páginas de monitor, con el desglose de MONITOR_TABLE_DATA (sim.monitorTables,
 * canal entities:monitorBreakdown de la 0023).
 *
 * Nombres que fijan estos tests (las dos páginas comparten componentes y testids, como las tablas
 * del host de la 0019): las tarjetas `monitor-locations` y `monitor-steps`, debajo de
 * `monitor-charts`, con su título en un encabezado («Localizaciones»; «Pasos» en browser y
 * «Peticiones» en HTTP); dentro, el `DataGrid` con `gridTestId` `monitor-locations-grid` y
 * `monitor-steps-grid` y filas `monitor-location-row` (con `data-location-id`) y
 * `monitor-step-row` (con `data-step-id`). Columnas, en este orden: localizaciones `name`,
 * `availability` (barra `monitor-location-availability` con `data-level` y su %; si el nivel no es
 * `normal`, su texto en `monitor-location-level`), `duration` y `failed`; pasos `name`,
 * `duration` y `share` (barra `monitor-step-share` y su %). El paso más lento, con
 * `data-slowest="true"` en su fila y un texto en `monitor-step-slowest` (solo en esa fila). El
 * orden por columna, con `sort-<columna>` y `aria-sort` en `col-<columna>`, como en la 0019.
 */
const LOCATION_COLUMNS = ['name', 'availability', 'duration', 'failed'] as const
const STEP_COLUMNS = ['name', 'duration', 'share'] as const
const monitorLocations = (): Locator => page.getByTestId('monitor-locations')
const monitorSteps = (): Locator => page.getByTestId('monitor-steps')
const locationRow = (id: string): Locator =>
  monitorLocations().locator(`[data-testid="monitor-location-row"][data-location-id="${id}"]`)
const stepRow = (id: string): Locator =>
  monitorSteps().locator(`[data-testid="monitor-step-row"][data-step-id="${id}"]`)
const locationOrder = (): Promise<string[]> =>
  tableOrder(monitorLocations(), 'monitor-location-row', 'data-location-id')
const stepOrder = (): Promise<string[]> =>
  tableOrder(monitorSteps(), 'monitor-step-row', 'data-step-id')
/** Un número suelto con su unidad: «90 %» no casa con «190 %» ni con «90,5 %». */
const withUnit = (value: string, unit: string): RegExp =>
  new RegExp(`(^|[^\\d,.])${value}\\s?${unit}($|[^\\d,.])`)

/** Ficha 0025: abre la página del monitor con el desglose de las tablas. */
async function openMonitorTables(kind: MonitorPageKind): Promise<Locator> {
  sim.monitorTables = true
  return openMonitorPage(kind)
}

/** Ficha 0025: las localizaciones del HTTP monitor, de peor a mejor disponibilidad (es). */
const HTTP_LOCATIONS = [
  {
    id: breakdownLocation(3),
    name: 'Localización tres',
    pct: withUnit('90(,0)?', '%'),
    level: 'error',
    duration: /^1,5\s?s$/,
    failed: /^6$/
  },
  {
    id: breakdownLocation(2),
    name: 'Localización dos',
    pct: withUnit('97,5', '%'),
    level: 'warning',
    duration: /^310\s?ms$/,
    failed: /^1$/
  },
  {
    id: breakdownLocation(4),
    name: 'Localización cuatro',
    pct: withUnit('99,5', '%'),
    level: 'normal',
    duration: /^420\s?ms$/,
    failed: /^2$/
  },
  {
    id: breakdownLocation(1),
    name: 'Localización uno',
    pct: withUnit('100(,0)?', '%'),
    level: 'normal',
    duration: /^250\s?ms$/,
    // Sin serie de FAILURE: 0 fallidas.
    failed: /^0$/
  }
] as const

/** Ficha 0025: los 5 pasos del browser monitor, por duración (el orden que da el canal). */
const BROWSER_STEPS = [
  { n: 3, name: 'Paso tres', duration: /^2,5\s?s$/, share: '50(,0)?' },
  { n: 1, name: 'Paso uno', duration: /^1,2\s?s$/, share: '24(,0)?' },
  { n: 4, name: 'Paso cuatro', duration: /^800\s?ms$/, share: '16(,0)?' },
  { n: 2, name: 'Paso dos', duration: /^300\s?ms$/, share: '6(,0)?' },
  { n: 5, name: 'Paso cinco', duration: /^200\s?ms$/, share: '4(,0)?' }
].map((step) => ({ ...step, id: breakdownStep('SYNTHETIC_TEST_STEP', step.n) }))

/** Ficha 0025: espera a que las dos tablas tengan sus filas. */
async function expectMonitorTablesLoaded(locations: number, steps: number): Promise<void> {
  await expect(monitorLocations().getByTestId('monitor-location-row')).toHaveCount(locations)
  await expect(monitorSteps().getByTestId('monitor-step-row')).toHaveCount(steps)
}

test('CA1 (0025): con 4 localizaciones, la tabla las enseña de peor a mejor disponibilidad, con su %, su nivel, la duración media y las fallidas', async () => {
  await openMonitorTables('http')
  const card = monitorLocations()
  await expect(card).toBeVisible()
  await expect(card.getByRole('heading').first()).toContainText('Localizaciones')
  const grid = card.getByTestId('monitor-locations-grid')
  await expect(grid).toHaveAttribute('role', 'grid')
  await expect(card.getByTestId('monitor-location-row')).toHaveCount(4)
  expect(await gridColumns(grid)).toEqual(LOCATION_COLUMNS.map((c) => `col-${c}`))
  await expect(grid.getByTestId('col-availability')).toHaveAttribute('aria-sort', 'ascending')

  // De peor a mejor: el simulador las da en otro orden en cada métrica.
  expect(await locationOrder()).toEqual(HTTP_LOCATIONS.map((l) => l.id))

  for (const location of HTTP_LOCATIONS) {
    const cells = locationRow(location.id).getByRole('gridcell')
    await expect(cells, location.name).toHaveCount(LOCATION_COLUMNS.length)
    await expect(cells.nth(0), location.name).toHaveText(location.name)
    // Barra con su % y su nivel (color en data-level y, si no es normal, también texto).
    const availability = cells.nth(1)
    await expect(availability, location.name).toContainText(location.pct)
    await expect(
      availability.getByTestId('monitor-location-availability'),
      location.name
    ).toHaveAttribute('data-level', location.level)
    const levelText = availability.getByTestId('monitor-location-level')
    if (location.level === 'normal') await expect(levelText, location.name).toHaveCount(0)
    else await expect(levelText, location.name).toHaveText(/\S/)
    await expect(cells.nth(2), location.name).toHaveText(location.duration)
    await expect(cells.nth(3), location.name).toHaveText(location.failed)
  }
  // El aviso y el error no dicen lo mismo.
  const warningText = await locationRow(breakdownLocation(2))
    .getByTestId('monitor-location-level')
    .textContent()
  const errorText = await locationRow(breakdownLocation(3))
    .getByTestId('monitor-location-level')
    .textContent()
  expect(warningText).not.toBe(errorText)

  // Debajo de los gráficos.
  const charts = await settledBox(page.getByTestId('monitor-charts'))
  const locations = await settledBox(card)
  expect(locations.y).toBeGreaterThanOrEqual(charts.y + charts.height - 1)
})

test('CA2 (0025): con 5 pasos, la tabla del browser monitor los enseña en su orden, con su duración y su peso, y marca el más lento; en un HTTP monitor la tarjeta se llama «Peticiones»', async () => {
  await openMonitorTables('browser')
  const card = monitorSteps()
  await expect(card).toBeVisible()
  await expect(card.getByRole('heading').first()).toHaveText(/^Pasos\b/)
  const grid = card.getByTestId('monitor-steps-grid')
  await expect(grid).toHaveAttribute('role', 'grid')
  await expect(card.getByTestId('monitor-step-row')).toHaveCount(5)
  expect(await gridColumns(grid)).toEqual(STEP_COLUMNS.map((c) => `col-${c}`))

  // En el orden que da el canal (por duración: la dimensión no trae secuencia, 0023), no en el
  // que llegan del simulador.
  expect(await stepOrder()).toEqual(BROWSER_STEPS.map((s) => s.id))

  for (const step of BROWSER_STEPS) {
    const row = stepRow(step.id)
    const cells = row.getByRole('gridcell')
    await expect(cells, step.name).toHaveCount(STEP_COLUMNS.length)
    await expect(cells.nth(0), step.name).toContainText(step.name)
    await expect(cells.nth(1), step.name).toHaveText(step.duration)
    await expect(cells.nth(2), step.name).toContainText(withUnit(step.share, '%'))
    await expect(cells.nth(2).getByTestId('monitor-step-share'), step.name).toHaveCount(1)
  }

  // El más lento (Paso tres), resaltado con atributo y con texto; los demás, no.
  const slowest = stepRow(breakdownStep('SYNTHETIC_TEST_STEP', 3))
  await expect(slowest).toHaveAttribute('data-slowest', 'true')
  await expect(slowest.getByTestId('monitor-step-slowest')).toHaveText(/\S/)
  await expect(card.getByTestId('monitor-step-slowest')).toHaveCount(1)
  for (const step of BROWSER_STEPS.slice(1)) {
    await expect(stepRow(step.id), step.name).not.toHaveAttribute('data-slowest', 'true')
  }

  // Debajo de los gráficos, como las localizaciones.
  const charts = await settledBox(page.getByTestId('monitor-charts'))
  const steps = await settledBox(card)
  expect(steps.y).toBeGreaterThanOrEqual(charts.y + charts.height - 1)

  // En un HTTP monitor, «Peticiones» (y no «Pasos»), con sus peticiones y la más lenta marcada.
  await openMonitorPage('http')
  await expect(monitorSteps()).toBeVisible()
  await expect(monitorSteps().getByRole('heading').first()).toHaveText(/^Peticiones\b/)
  await expect(monitorSteps().getByRole('heading').first()).not.toContainText('Pasos')
  await expect(monitorSteps().getByTestId('monitor-step-row')).toHaveCount(2)
  const requests = [breakdownStep('HTTP_CHECK_STEP', 2), breakdownStep('HTTP_CHECK_STEP', 1)]
  expect(await stepOrder()).toEqual(requests)
  const slowestRequest = stepRow(requests[0] ?? '')
  await expect(slowestRequest.getByRole('gridcell').nth(2)).toContainText(withUnit('75(,0)?', '%'))
  await expect(slowestRequest).toHaveAttribute('data-slowest', 'true')
  await expect(monitorSteps().getByTestId('monitor-step-slowest')).toHaveCount(1)
})

test('CA4 (0025): ordenar por otra columna (nombre en pasos, duración en localizaciones) reordena las filas', async () => {
  await openMonitorTables('browser')
  await expectMonitorTablesLoaded(3, 5)

  // Pasos por nombre: «Paso cinco», «Paso cuatro», «Paso dos», «Paso tres» y «Paso uno».
  const stepsGrid = monitorSteps().getByTestId('monitor-steps-grid')
  const byName = BROWSER_STEPS.slice()
    .sort((a, b) => a.name.localeCompare(b.name, 'es'))
    .map((s) => s.id)
  expect(byName).not.toEqual(BROWSER_STEPS.map((s) => s.id))
  expect(byName.slice().reverse()).not.toEqual(BROWSER_STEPS.map((s) => s.id))
  await clickInPlace(stepsGrid.getByTestId('sort-name'), { scroll: true })
  const nameCol = stepsGrid.getByTestId('col-name')
  await expect(nameCol).toHaveAttribute('aria-sort', /^(ascending|descending)$/)
  const nameAsc = (await nameCol.getAttribute('aria-sort')) === 'ascending'
  expect(await stepOrder()).toEqual(nameAsc ? byName : byName.slice().reverse())
  await clickInPlace(stepsGrid.getByTestId('sort-name'), { scroll: true })
  await expect(nameCol).toHaveAttribute('aria-sort', nameAsc ? 'descending' : 'ascending')
  expect(await stepOrder()).toEqual(nameAsc ? byName.slice().reverse() : byName)
  // Ordenar no quita la marca del más lento.
  await expect(stepRow(breakdownStep('SYNTHETIC_TEST_STEP', 3))).toHaveAttribute(
    'data-slowest',
    'true'
  )

  // Localizaciones del HTTP monitor por duración media: uno 250, dos 310, cuatro 420, tres 1500.
  await openMonitorPage('http')
  await expectMonitorTablesLoaded(4, 2)
  const locationsGrid = monitorLocations().getByTestId('monitor-locations-grid')
  const byDuration = [1, 2, 4, 3].map((n) => breakdownLocation(n))
  await clickInPlace(locationsGrid.getByTestId('sort-duration'), { scroll: true })
  const durationCol = locationsGrid.getByTestId('col-duration')
  await expect(durationCol).toHaveAttribute('aria-sort', /^(ascending|descending)$/)
  await expect(locationsGrid.getByTestId('col-availability')).toHaveAttribute('aria-sort', 'none')
  const durationAsc = (await durationCol.getAttribute('aria-sort')) === 'ascending'
  expect(await locationOrder()).toEqual(durationAsc ? byDuration : byDuration.slice().reverse())
  await clickInPlace(locationsGrid.getByTestId('sort-duration'), { scroll: true })
  await expect(durationCol).toHaveAttribute('aria-sort', durationAsc ? 'descending' : 'ascending')
  expect(await locationOrder()).toEqual(durationAsc ? byDuration.slice().reverse() : byDuration)
})

test('CA4 (0025): si falla el canal, las dos tarjetas enseñan el aviso con Reintentar y los gráficos siguen', async () => {
  sim.monitorBreakdownFail = true
  await openMonitorTables('browser')

  for (const card of [monitorLocations(), monitorSteps()]) {
    await expect(card).toBeVisible()
    await expect(card.getByRole('alert').first()).toBeVisible()
    await expect(card.getByRole('button', { name: 'Reintentar' })).toBeVisible()
  }
  await expect(monitorLocations().getByTestId('monitor-location-row')).toHaveCount(0)
  await expect(monitorSteps().getByTestId('monitor-step-row')).toHaveCount(0)

  // Los gráficos, con sus series y sin aviso.
  for (const kind of MONITOR_CHART_KINDS) {
    await expectMonitorChartSeries('browser', kind)
    await expect(
      monitorChartPanel(kind).getByRole('button', { name: 'Reintentar' }),
      kind
    ).toHaveCount(0)
  }

  // Reintentar, con el canal ya bien: llegan las dos tablas.
  sim.monitorBreakdownFail = false
  await clickInPlace(monitorLocations().getByRole('button', { name: 'Reintentar' }), {
    scroll: true
  })
  await expectMonitorTablesLoaded(3, 5)
  for (const card of [monitorLocations(), monitorSteps()]) {
    await expect(card.getByRole('button', { name: 'Reintentar' })).toHaveCount(0)
  }
})

test('CA3 (0025): sin pasos que enseñar (lista vacía del canal), no sale la tarjeta de pasos y la de localizaciones sí', async () => {
  // Decisión del Orquestador (ficha 0025): el canal siempre da `steps` como lista, así que desde
  // el simulador se prueba con la lista vacía; `steps: null` lo cubre el unitario de
  // monitor-tables.
  sim.monitorStepsEmpty = true
  for (const kind of ['browser', 'http'] as const) {
    await openMonitorTables(kind)
    const rows = kind === 'browser' ? 3 : 4
    await expect(monitorLocations(), kind).toBeVisible()
    await expect(monitorLocations().getByTestId('monitor-location-row'), kind).toHaveCount(rows)
    // Con las localizaciones ya cargadas, el desglose ha respondido: la de pasos no está.
    await expect(monitorSteps(), kind).toHaveCount(0)
    await expect(page.getByTestId('monitor-step-row'), kind).toHaveCount(0)
  }

  // Que con pasos sí sale (no falta siempre) lo prueba CA2 con los mismos testids.
})

/**
 * Ficha 0026: tarjeta «Información» de las páginas de un browser monitor (MONITOR_BROWSER_ID) y
 * de un HTTP monitor (MONITOR_HTTP_ID), canal entities:get, con la forma de la del servicio
 * (0015) y la del host (0020) y sus nombres con el prefijo `monitor-info`.
 *
 * Nombres que fijan estos tests: la tarjeta `monitor-info`, entre la cabecera y
 * `monitor-markers`; cada fila, `monitor-info-row` con `data-key` (las claves de
 * `buildMonitorInfo`) y su valor en `monitor-info-value`; los chips, `monitor-info-chip`. Las
 * relaciones, en `monitor-info-relations`: cada grupo `monitor-info-group` con `data-group`
 * (monitors, locations, steps o requests, y other), con `monitor-info-group-toggle`
 * (aria-expanded), `monitor-info-group-count` y, desplegado, sus `monitor-info-entity` (enlaces,
 * con `data-entity-id`), el botón `monitor-info-names` («Ver nombres») y cada nombre en
 * `monitor-info-entity-name`. «Todas las propiedades», `monitor-info-properties-toggle` y cada
 * una `monitor-info-property` con `data-key`. Las filas obligatorias van en su orden relativo; el
 * developer puede añadir otras entre ellas (la ficha se las deja a él).
 */
const MONITOR_INFO_REQUIRED: Record<MonitorPageKind, string[]> = {
  browser: [
    'monitorType',
    'enabled',
    'frequency',
    'locations',
    'steps',
    'firstSeen',
    'lastSeen',
    // Ficha 0037: sin la fila de etiquetas (van en las píldoras de arriba).
    'managementZones'
  ],
  // Sin etiquetas: no hay fila.
  http: [
    'monitorType',
    'enabled',
    'frequency',
    'locations',
    'requests',
    'firstSeen',
    'lastSeen',
    'managementZones'
  ]
}
const monitorInfoCard = (): Locator => page.getByTestId('monitor-info')
const monitorInfoRow = (key: string): Locator =>
  monitorInfoCard().locator(`[data-testid="monitor-info-row"][data-key="${key}"]`)
const monitorInfoValue = (key: string): Locator =>
  monitorInfoRow(key).getByTestId('monitor-info-value')
const monitorInfoGroup = (key: string): Locator =>
  monitorInfoCard().locator(`[data-testid="monitor-info-group"][data-group="${key}"]`)
const monitorInfoEntity = (group: string, id: string): Locator =>
  monitorInfoGroup(group).locator(`[data-testid="monitor-info-entity"][data-entity-id="${id}"]`)

/** Ficha 0026: ¿están las claves `expected` en `actual`, en ese orden relativo? */
function inRelativeOrder(actual: string[], expected: string[]): boolean {
  let index = 0
  for (const key of actual) if (key === expected[index]) index += 1
  return index === expected.length
}

/** Ficha 0026: abre la página del monitor y espera su tarjeta con filas. */
async function openMonitorInfo(kind: MonitorPageKind): Promise<Locator> {
  await openMonitorPage(kind)
  const card = monitorInfoCard()
  await expect(card).toBeVisible()
  await expect(card.getByTestId('monitor-info-row').first()).toBeVisible()
  return card
}

/** Ficha 0026: despliega un grupo de relaciones del monitor (si no lo está). */
async function expandMonitorGroup(key: string): Promise<Locator> {
  const group = monitorInfoGroup(key)
  const toggle = group.getByTestId('monitor-info-group-toggle')
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await clickInPlace(toggle, { scroll: true })
  }
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  return group
}

/** Ficha 0026: filas obligatorias en su orden, sin repetirse, y sin «undefined» en la tarjeta. */
async function expectMonitorInfoRows(kind: MonitorPageKind): Promise<void> {
  const keys = await dataKeys(monitorInfoCard().getByTestId('monitor-info-row'))
  expect(inRelativeOrder(keys, MONITOR_INFO_REQUIRED[kind]), JSON.stringify(keys)).toBe(true)
  expect(new Set(keys).size, JSON.stringify(keys)).toBe(keys.length)
  for (const text of ['undefined', 'null', 'NaN', '[object Object]']) {
    await expect(monitorInfoCard(), text).not.toContainText(text)
  }
}

/** Ficha 0026: los grupos de relaciones, en su orden, con su nombre y su número. */
async function expectMonitorGroups(expected: [string, string, string][]): Promise<void> {
  const relations = monitorInfoCard().getByTestId('monitor-info-relations')
  await expect(relations).toContainText('Relaciones')
  const groups = relations.getByTestId('monitor-info-group')
  await expect(groups).toHaveCount(expected.length)
  expect(await dataKeys(groups, 'data-group')).toEqual(expected.map(([key]) => key))
  for (const [key, title, count] of expected) {
    await expect(monitorInfoGroup(key), key).toContainText(title)
    await expect(monitorInfoGroup(key).getByTestId('monitor-info-group-count'), key).toHaveText(
      new RegExp(`^\\s*${count}\\s*$`)
    )
  }
}

test('CA2 (0026): la página de un browser monitor enseña la tarjeta «Información» con sus filas (tipo, activo, frecuencia, localizaciones, pasos…), sus relaciones con «Ver nombres» a demanda y enlaces que abren cada entidad', async () => {
  const card = await openMonitorInfo('browser')
  await expect(card).toContainText('Información')

  // Debajo de los marcadores: desde la ficha 0036, «Información» va al final de la página.
  const cardBox = await settledBox(card)
  const markersBox = await settledBox(page.getByTestId('monitor-markers'))
  expect(cardBox.y, 'la tarjeta va debajo de los marcadores').toBeGreaterThanOrEqual(
    markersBox.y + markersBox.height - 1
  )

  // Las filas y sus valores.
  await expectMonitorInfoRows('browser')
  await expect(monitorInfoValue('monitorType')).toContainText('CLICKPATH')
  await expect(monitorInfoValue('enabled')).toHaveText(/\S/)
  await expect(monitorInfoValue('enabled')).not.toContainText(/true|false/)
  await expect(monitorInfoValue('frequency')).toContainText(loneNumber('15'))
  await expect(monitorInfoValue('locations')).toContainText(loneNumber('3'))
  await expect(monitorInfoValue('steps')).toContainText(loneNumber('5'))
  await expect(monitorInfoValue('firstSeen')).toContainText('2026')
  await expect(monitorInfoValue('lastSeen')).toContainText('2026')
  await expect(monitorInfoRow('managementZones').getByTestId('monitor-info-chip')).toHaveText([
    'Zona monitor A',
    'Zona monitor B'
  ])
  // Ficha 0037: las etiquetas ya no salen en la tarjeta.
  await expect(monitorInfoRow('tags')).toHaveCount(0)

  // Capturas y nombre detectado, nunca en una fila; «Todas las propiedades» empieza plegada.
  const rows = card.getByTestId('monitor-info-row')
  for (const [key, value] of Object.entries(MONITOR_INFO_HIDDEN)) {
    await expect(rows.filter({ hasText: value }), key).toHaveCount(0)
    await expect(monitorInfoRow(key), key).toHaveCount(0)
  }
  await expect(card.getByTestId('monitor-info-property')).toHaveCount(0)
  const toggle = card.getByTestId('monitor-info-properties-toggle')
  await expect(toggle).toContainText('Todas las propiedades')
  await clickInPlace(toggle, { scroll: true })
  await expect(card.getByTestId('monitor-info-property')).toHaveCount(
    monitorInfoBrowserPropertyCount()
  )
  await expect(
    card.locator('[data-testid="monitor-info-property"][data-key="detectedName"]')
  ).toContainText(MONITOR_INFO_HIDDEN.detectedName)

  // Sin las tarjetas del servicio ni del host.
  await expect(page.getByTestId('service-info')).toHaveCount(0)
  await expect(page.getByTestId('host-info')).toHaveCount(0)

  // Relaciones: Monitoriza, Localizaciones y Pasos (sin otras), con su número.
  await expectMonitorGroups([
    ['monitors', 'Monitoriza', '1'],
    ['locations', 'Localizaciones', '3'],
    ['steps', 'Pasos', '5']
  ])
  const locations = await expandMonitorGroup('locations')
  expect(await dataKeys(locations.getByTestId('monitor-info-entity'), 'data-entity-id')).toEqual(
    MONITOR_INFO_LOCATIONS.slice(0, 3)
  )
  const steps = await expandMonitorGroup('steps')
  expect(await dataKeys(steps.getByTestId('monitor-info-entity'), 'data-entity-id')).toEqual(
    MONITOR_INFO_STEPS
  )
  await expandMonitorGroup('monitors')
  await settledRequests()
  expect(sim.entityNamesQueries, 'nombres antes de «Ver nombres»').toHaveLength(0)

  // «Ver nombres» de «Localizaciones»: una llamada con sus tres ids y los nombres en su sitio.
  const button = locations.getByTestId('monitor-info-names')
  await expect(button).toHaveText('Ver nombres')
  await clickInPlace(button, { scroll: true })
  await expect.poll(() => sim.entityNamesQueries.length).toBe(1)
  const selector = sim.entityNamesQueries[0]?.get('entitySelector') ?? ''
  for (const id of MONITOR_INFO_LOCATIONS.slice(0, 3)) expect(selector).toContain(id)
  for (const [index, id] of MONITOR_INFO_LOCATIONS.slice(0, 3).entries()) {
    await expect(
      monitorInfoEntity('locations', id).getByTestId('monitor-info-entity-name')
    ).toHaveText(`localizacion-info-${index + 1}-e2e`)
  }
  // Los de otros grupos, sin pedir.
  await settledRequests()
  expect(sim.entityNamesQueries).toHaveLength(1)
  await expect(
    monitorInfoEntity('steps', MONITOR_INFO_STEPS[0] ?? '').getByTestId('monitor-info-entity-name')
  ).toHaveCount(0)

  // Cada entidad es un enlace a su página; pulsar la aplicación abre la suya.
  const app = monitorInfoEntity('monitors', MONITOR_INFO_APP)
  await expect(app).toHaveRole('link')
  await expect(app).toHaveAttribute(
    'href',
    new RegExp(`#/entities/APPLICATION/${MONITOR_INFO_APP}$`)
  )
  await expect(monitorInfoEntity('steps', MONITOR_INFO_STEPS[0] ?? '')).toHaveAttribute(
    'href',
    new RegExp(`#/entities/SYNTHETIC_TEST_STEP/${MONITOR_INFO_STEPS[0]}$`)
  )
  const monitorQueries = (): number =>
    sim.requests.filter((request) => request.includes(`/entities/${MONITOR_BROWSER_ID}`)).length
  const before = monitorQueries()
  await clickInPlace(app, { scroll: true })
  const appPage = page.getByTestId('entity-page-application')
  await expect(appPage).toBeVisible()
  expect(await currentRoute()).toBe(`/entities/APPLICATION/${MONITOR_INFO_APP}`)
  await expect(appPage.getByTestId('entity-page-id')).toHaveText(MONITOR_INFO_APP)
  await expect(page.getByTestId('monitor-info')).toHaveCount(0)

  // «Volver» regresa al monitor, sin volver a pedir sus datos.
  await clickInPlace(appPage.getByTestId('entity-back'), { scroll: true })
  await expect(monitorPage('browser')).toBeVisible()
  expect(await currentRoute()).toBe(`/entities/SYNTHETIC_TEST/${MONITOR_BROWSER_ID}`)
  await expect(monitorInfoValue('monitorType')).toContainText('CLICKPATH')
  await settledRequests()
  expect(monitorQueries(), 'entities:get del monitor al volver').toBe(before)
})

test('CA2 (0026): la página de un HTTP monitor enseña su tarjeta con «Peticiones», «Monitoriza» con el servicio y la aplicación, «Otras relaciones» plegada, y pulsar el servicio abre su página', async () => {
  // El «activo» del browser monitor, para compararlo con el «inactivo» de este.
  await openMonitorInfo('browser')
  const enabledText = (await monitorInfoValue('enabled').textContent())?.trim() ?? ''
  expect(enabledText).not.toBe('')

  const card = await openMonitorInfo('http')
  await expect(card).toContainText('Información')
  await expectMonitorInfoRows('http')
  await expect(monitorInfoRow('steps')).toHaveCount(0)
  await expect(monitorInfoRow('tags')).toHaveCount(0)
  await expect(monitorInfoValue('monitorType')).toContainText('MULTI_REQUEST')
  await expect(monitorInfoValue('enabled')).toHaveText(/\S/)
  await expect(monitorInfoValue('enabled')).not.toContainText(/true|false/)
  await expect(monitorInfoValue('enabled')).not.toHaveText(enabledText)
  await expect(monitorInfoValue('frequency')).toContainText(loneNumber('5'))
  await expect(monitorInfoValue('locations')).toContainText(loneNumber('4'))
  await expect(monitorInfoValue('requests')).toContainText(loneNumber('2'))
  await expect(monitorInfoRow('managementZones').getByTestId('monitor-info-chip')).toHaveText([
    'Zona monitor H'
  ])
  await expect(
    card.getByTestId('monitor-info-row').filter({ hasText: 'nombre-detectado-http-e2e' })
  ).toHaveCount(0)

  await expectMonitorGroups([
    ['monitors', 'Monitoriza', '2'],
    ['locations', 'Localizaciones', '4'],
    ['requests', 'Peticiones', '2'],
    ['other', 'Otras relaciones', '1']
  ])
  // «Otras relaciones», plegada.
  await expect(monitorInfoGroup('other').getByTestId('monitor-info-group-toggle')).toHaveAttribute(
    'aria-expanded',
    'false'
  )
  await expect(monitorInfoGroup('other').getByTestId('monitor-info-entity')).toHaveCount(0)
  const other = await expandMonitorGroup('other')
  await expect(other).toContainText('belongsTo')
  await expect(monitorInfoEntity('other', MONITOR_INFO_OTHER)).toContainText(MONITOR_INFO_OTHER)

  const monitors = await expandMonitorGroup('monitors')
  expect(
    [...(await dataKeys(monitors.getByTestId('monitor-info-entity'), 'data-entity-id'))].sort()
  ).toEqual([INFO_FEW_ID, MONITOR_INFO_HTTP_APP].sort())

  // «Ver nombres» de «Peticiones».
  const requests = await expandMonitorGroup('requests')
  await settledRequests()
  expect(sim.entityNamesQueries, 'nombres antes de «Ver nombres»').toHaveLength(0)
  await clickInPlace(requests.getByTestId('monitor-info-names'), { scroll: true })
  await expect.poll(() => sim.entityNamesQueries.length).toBe(1)
  for (const [index, id] of MONITOR_INFO_REQUESTS.entries()) {
    await expect(
      monitorInfoEntity('requests', id).getByTestId('monitor-info-entity-name')
    ).toHaveText(`peticion-info-${index + 1}-e2e`)
  }

  // Pulsar el servicio abre su página; «Volver» regresa al monitor.
  const service = monitorInfoEntity('monitors', INFO_FEW_ID)
  await expect(service).toHaveRole('link')
  await expect(service).toHaveAttribute('href', new RegExp(`#/entities/SERVICE/${INFO_FEW_ID}$`))
  await clickInPlace(service, { scroll: true })
  const servicePage = page.getByTestId('entity-page-service')
  await expect(servicePage).toBeVisible()
  expect(await currentRoute()).toBe(`/entities/SERVICE/${INFO_FEW_ID}`)
  await expect(page.getByTestId('monitor-info')).toHaveCount(0)
  await clickInPlace(servicePage.getByTestId('entity-back'), { scroll: true })
  await expect(monitorPage('http')).toBeVisible()
  expect(await currentRoute()).toBe(`/entities/HTTP_CHECK/${MONITOR_HTTP_ID}`)
  await expect(monitorInfoValue('monitorType')).toContainText('MULTI_REQUEST')
})

test('CA3 (0026): sin entities.read, la tarjeta del monitor dice qué scope falta y los marcadores y gráficos siguen', async () => {
  const tenants = await invoke<{ clients: { id: string; name: string }[] }>('tenants:list')
  const clientId = tenants.clients.find((client) => client.name === 'Cliente A')?.id ?? ''
  const noEntities = await createEnvironment(
    clientId,
    'Sin entidades monitor',
    'other',
    TOKEN_NO_ENTITIES
  )
  try {
    await invoke('connection:test', { environmentId: noEntities })
    await invoke('environments:setActive', { environmentId: noEntities })
    await reloadUi()
    await openMonitorPage('browser')
    const unavailable = monitorInfoCard().getByTestId('module-unavailable')
    await expect(unavailable).toBeVisible()
    await expect(unavailable).toContainText('entities.read')
    await expect(monitorInfoCard().getByTestId('monitor-info-row')).toHaveCount(0)
    // Marcadores y gráficos, con sus datos.
    await expectBrowserMonitorMarkers()
    for (const kind of MONITOR_CHART_KINDS) await expectMonitorChartSeries('browser', kind)
    await settledRequests()
    expect(sim.entityInfoQueries, 'entities:get sin el scope').toHaveLength(0)
  } finally {
    await invoke('environments:setActive', { environmentId: env['Producción'] })
    await invoke('environments:delete', { id: noEntities })
    await reloadUi()
  }
})

test('CA4 (0026): las tarjetas del servicio y del host siguen igual (sus filas y sus grupos, sin nada del monitor); sus e2e de la 0015 y la 0020 siguen sin tocar', async () => {
  const serviceCard = await openServiceInfo(INFO_FULL_ID)
  expect(
    await dataKeys(serviceCard.getByTestId('service-info-service').getByTestId('service-info-row'))
  ).toEqual(INFO_ROW_ORDER)
  expect(await dataKeys(serviceCard.getByTestId('service-info-group'), 'data-group')).toEqual([
    'runsOn',
    'calls',
    'calledBy',
    'other'
  ])
  await expect(page.locator('[data-testid^="monitor-info"]')).toHaveCount(0)

  const hostCard = await openHostInfo(HOST_INFO_FULL_ID)
  expect(await dataKeys(hostCard.getByTestId('host-info-section'), 'data-section')).toEqual(
    HOST_INFO_SECTIONS.map(([key]) => key)
  )
  expect(await dataKeys(hostCard.getByTestId('host-info-group'), 'data-group')).toEqual([
    'processes',
    'services',
    'runsOn',
    'hostGroup',
    'other'
  ])
  await expect(page.locator('[data-testid^="monitor-info"]')).toHaveCount(0)
  await expect(page.getByTestId('service-info')).toHaveCount(0)
})

/**
 * Ficha 0028: marcadores y gráficos de la página de un proceso (PROCESS_GROUP_INSTANCE), con las
 * métricas del canal entities:processMetrics (0027: PROCESS_SERIES y PROCESS_MARKERS) y sus
 * problemas (processBandProblems: uno abierto y uno cerrado).
 *
 * Con la decisión del Orquestador de la 0027, el canal tiene métrica para los seis papeles: un
 * papel sin datos llega con series vacías y su marcador a null, y eso es lo que el simulador puede
 * dejar «sin métrica» (`sim.processEmpty`). Ese papel no se pinta. «Disponibilidad o Recursos» y
 * «Salud de red o Recursos» son «el que haya»; con los dos, por la decisión del Orquestador en la
 * ficha 0028, el cuarto marcador es Disponibilidad y el cuarto gráfico, Salud de red; sin el
 * primero, sale el segundo.
 *
 * Nombres que fijan estos tests (los del host con el prefijo `process`): la fila
 * `process-markers`; cada marcador `process-marker-<id>` (cpu, memory, network, availability o
 * resources, y problems); dentro, el valor principal en `process-marker-value` (el de la CPU con
 * `data-level`: `normal`, `warning` o `error`, umbrales del 80 y el 90 %) y lo de debajo en
 * `process-marker-secondary` (máxima y salida); el texto del nivel, cuando no es `normal`, en
 * `process-marker-level`; los recuentos, en `process-marker-open` y `process-marker-closed`. La
 * sección `process-charts`; cada gráfico en un `process-chart-panel` con `data-kind` (cpu,
 * memory, network y network-health o resources, en ese orden) y su título en un encabezado;
 * dentro, el `Chart` con testid `process-chart-<kind>` (con `data-series`). La franja,
 * `process-problem-band`, dentro del panel de la CPU; cada tramo, `process-problem-segment` con
 * `data-problem-id`.
 *
 * Formato (decisión del Orquestador, ficha 0028): Recursos, como porcentaje tal cual (0,9 →
 * «0,9 %»); la red, como en el host, en bits por segundo (`formatBitRate`): bytesRx y bytesTx
 * llegan en BytePerSecond (docs/notas-api-v2.md), así que se multiplican por 8.
 */
const PROCESS_PAGE_TEST_ID = 'entity-page-process_group_instance'
const PROCESS_METRIC_MARKERS = ['cpu', 'memory', 'network'] as const
type ProcessFourthMarker = 'availability' | 'resources'
type ProcessChartKind = 'cpu' | 'memory' | 'network' | 'network-health' | 'resources'
const PROCESS_MARKER_LABELS: Record<string, string> = {
  cpu: 'CPU',
  memory: 'Memoria',
  network: 'Red',
  availability: 'Disponibilidad',
  resources: 'Recursos',
  problems: 'Problemas'
}
const PROCESS_CHART_TITLES: Record<ProcessChartKind, string> = {
  cpu: 'CPU',
  memory: 'Memoria',
  network: 'Red',
  'network-health': 'Salud de red',
  resources: 'Recursos'
}
/** Las series de cada gráfico, en su orden: una por papel y la red con entrada y salida. */
const PROCESS_CHART_SERIES: Record<ProcessChartKind, RegExp[]> = {
  cpu: [/./],
  memory: [/./],
  network: [/entrada/i, /salida/i],
  'network-health': [/./],
  resources: [/./]
}
/** Claves de métrica de cada papel (las de PROCESS_SERIES), para dejarlas sin datos. */
const PROCESS_ROLE_METRICS = {
  network: ['builtin:tech.generic.network.bytesRx', 'builtin:tech.generic.network.bytesTx'],
  networkHealth: ['builtin:tech.generic.network.packets.retransmission'],
  availability: ['builtin:pgi.availability'],
  resources: ['builtin:tech.generic.handles.fileDescriptorsPercentUsed']
} as const

const processPage = (): Locator => page.getByTestId(PROCESS_PAGE_TEST_ID)
const processMarker = (id: string): Locator => page.getByTestId(`process-marker-${id}`)
const processChartPanel = (kind: ProcessChartKind): Locator =>
  page.locator(`[data-testid="process-chart-panel"][data-kind="${kind}"]`)
const processChartPlot = (kind: ProcessChartKind): Locator =>
  processChartPanel(kind).getByTestId(`process-chart-${kind}`)
const processBand = (): Locator => processChartPanel('cpu').getByTestId('process-problem-band')
const processSegment = (problemId: string): Locator =>
  processBand().locator(`[data-testid="process-problem-segment"][data-problem-id="${problemId}"]`)

/** Ficha 0028: abre por URL la página del proceso (por defecto, el inventado de la 0027). */
async function openProcessPage(id: string = PROCESS_METRICS_ID): Promise<Locator> {
  await goToRoute(`/entities/PROCESS_GROUP_INSTANCE/${id}`)
  const entityPage = processPage()
  await expect(entityPage).toBeVisible()
  return entityPage
}

/** Ficha 0028: espera a que el gráfico tenga sus series (se monta vacío mientras carga). */
async function processChartSeries(kind: ProcessChartKind): Promise<string[]> {
  const plot = processChartPlot(kind)
  await expect(plot.locator('canvas').first()).toBeVisible()
  await expect(plot).toHaveAttribute('data-series', /\[.+\]/)
  return JSON.parse((await plot.getAttribute('data-series')) ?? '[]') as string[]
}

/** Ficha 0028: comprueba las series de un gráfico del proceso. */
async function expectProcessChartSeries(kind: ProcessChartKind): Promise<void> {
  const series = await processChartSeries(kind)
  expect(series, kind).toHaveLength(PROCESS_CHART_SERIES[kind].length)
  for (const [i, pattern] of PROCESS_CHART_SERIES[kind].entries()) {
    expect(series[i], `${kind}[${i}]`).toMatch(pattern)
  }
}

/** Ficha 0028: los `data-kind` de los paneles de gráficos, en el orden en que se pintan. */
async function processChartKinds(): Promise<string[]> {
  return processPage()
    .getByTestId('process-charts')
    .getByTestId('process-chart-panel')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-kind') ?? ''))
}

/** Ficha 0028: valor del cuarto marcador, según cuál sea (0027: 83,5 % y 0,9). */
async function expectProcessFourthMarker(id: ProcessFourthMarker): Promise<void> {
  const value = processMarker(id).getByTestId('process-marker-value')
  if (id === 'availability') await expect(value).toHaveText(/^83,5\s?%$/)
  else await expect(value).toHaveText(/^0,9\s?%$/)
}

/**
 * Ficha 0028: los marcadores de métricas con los valores del simulador, ya formateados (es). Con
 * `network: false`, el de red no se comprueba (se comprueba aparte que no sale).
 */
async function expectProcessMetricMarkers(options: { network?: boolean } = {}): Promise<void> {
  // CPU: media 15,25 % (un decimal) y máxima 91 %; normal, sin texto de nivel.
  const cpu = processMarker('cpu')
  await expect(cpu.getByTestId('process-marker-value')).toHaveText(/^15,[23]\s?%$/)
  await expect(cpu.getByTestId('process-marker-secondary')).toContainText(/(^|[^\d.,])91(,0)?\s?%/)
  await expect(cpu.getByTestId('process-marker-value')).toHaveAttribute('data-level', 'normal')
  await expect(cpu.getByTestId('process-marker-level')).toHaveCount(0)
  // Memoria (working set): media 310 MB y máxima 330 MB.
  const memory = processMarker('memory')
  await expect(memory.getByTestId('process-marker-value')).toHaveText(/^310(,0)?\sMB$/)
  await expect(memory.getByTestId('process-marker-secondary')).toContainText(
    /(^|[^\d.,])330(,0)?\sMB/
  )
  if (options.network === false) return
  // Red: entrada media 2560 B/s y salida media 384 B/s, en bits por segundo como el host
  // (20 480 y 3072 bit/s).
  const network = processMarker('network')
  await expect(network.getByTestId('process-marker-value')).toHaveText(/^20,5\skbit\/s$/)
  await expect(network.getByTestId('process-marker-secondary')).toContainText(
    /(^|[^\d.,])3,1\skbit\/s/
  )
}

/** Ficha 0028: el marcador de problemas, con sus recuentos. */
async function expectProcessProblems(open: string, closed: string): Promise<void> {
  const problems = processMarker('problems')
  await expect(problems.getByTestId('process-marker-open')).toHaveText(loneNumber(open))
  await expect(problems.getByTestId('process-marker-closed')).toHaveText(loneNumber(closed))
}

/**
 * Ficha 0028: con datos de disponibilidad, el cuarto marcador es el de disponibilidad y el de
 * recursos no sale (decisión del Orquestador).
 */
async function shownFourthMarker(): Promise<ProcessFourthMarker> {
  const row = processPage().getByTestId('process-markers')
  await expect(row.getByTestId('process-marker-availability')).toHaveCount(1)
  await expect(row.getByTestId('process-marker-resources')).toHaveCount(0)
  return 'availability'
}

/** Ficha 0028: todos los marcadores del proceso inventado con todos sus datos. */
async function expectProcessMarkers(): Promise<void> {
  await expectProcessMetricMarkers()
  await expectProcessFourthMarker(await shownFourthMarker())
  await expectProcessProblems('1', '1')
}

test('CA1 (0028): la página de un proceso enseña sus marcadores y sus cuatro gráficos con los valores y las series del simulador, sin «Página en construcción»', async () => {
  const entityPage = await openProcessPage()
  const row = entityPage.getByTestId('process-markers')
  await expect(row).toBeVisible()

  // Cinco marcadores: CPU, memoria, red, disponibilidad (antes que recursos) y problemas.
  const fourth = await shownFourthMarker()
  for (const id of [...PROCESS_METRIC_MARKERS, fourth, 'problems']) {
    await expect(row.getByTestId(`process-marker-${id}`), id).toBeVisible()
    await expect(row.getByTestId(`process-marker-${id}`), id).toContainText(
      PROCESS_MARKER_LABELS[id] ?? id
    )
  }
  await expectProcessMarkers()

  // Cuatro gráficos en su orden: CPU, memoria, red y salud de red (antes que recursos).
  const section = entityPage.getByTestId('process-charts')
  await expect(section).toBeVisible()
  const panels = section.getByTestId('process-chart-panel')
  await expect(panels).toHaveCount(4)
  const kinds = await processChartKinds()
  expect(kinds).toEqual(['cpu', 'memory', 'network', 'network-health'])
  for (const [index, kind] of (kinds as ProcessChartKind[]).entries()) {
    await expect(panels.nth(index).getByRole('heading').first(), kind).toContainText(
      PROCESS_CHART_TITLES[kind]
    )
    await expectProcessChartSeries(kind)
  }

  // Ni el bloque ni el texto de «Página en construcción», ni marcadores de otro tipo.
  await expect(entityPage.getByTestId('entity-under-construction')).toHaveCount(0)
  await expect(entityPage).not.toContainText('Página en construcción')
  for (const other of ['service-markers', 'host-markers', 'monitor-markers']) {
    await expect(page.getByTestId(other), other).toHaveCount(0)
  }

  // Marcadores y gráficos comparten una sola llamada al canal (sus dos consultas), con el proceso
  // y el rango global.
  await settledRequests()
  expect(sim.processMetricQueries).toHaveLength(2)
  for (const query of sim.processMetricQueries) {
    expect(query.get('entitySelector')).toBe(`entityId("${PROCESS_METRICS_ID}")`)
    expect(query.get('from')).toBe('now-2h')
  }
})

test('CA2 (0028): sin datos de red ni de salud de red, el marcador y el gráfico de red no salen, el cuarto gráfico es el de recursos y el resto sigue', async () => {
  sim.processEmpty = [...PROCESS_ROLE_METRICS.network, ...PROCESS_ROLE_METRICS.networkHealth]
  const entityPage = await openProcessPage()

  // Marcadores: CPU, memoria, el cuarto y problemas, con sus valores; el de red, no.
  await expectProcessMetricMarkers({ network: false })
  await expectProcessFourthMarker(await shownFourthMarker())
  await expectProcessProblems('1', '1')
  await expect(processMarker('network')).toHaveCount(0)

  // Gráficos: CPU, memoria y recursos (el que hay de «salud de red o recursos»).
  await expectProcessChartSeries('cpu')
  await expectProcessChartSeries('resources')
  await expect(entityPage.getByTestId('process-chart-panel')).toHaveCount(3)
  expect(await processChartKinds()).toEqual(['cpu', 'memory', 'resources'])
  await expect(processChartPanel('network')).toHaveCount(0)
  await expect(processChartPanel('network-health')).toHaveCount(0)
  await expect(page.getByTestId('process-chart-network')).toHaveCount(0)
})

test('CA2 (0028): sin datos de disponibilidad, el cuarto marcador es el de recursos', async () => {
  sim.processEmpty = [...PROCESS_ROLE_METRICS.availability]
  await openProcessPage()
  await expectProcessMetricMarkers()
  await expectProcessFourthMarker('resources')
  await expectProcessProblems('1', '1')
  await expect(processMarker('availability')).toHaveCount(0)
  // Los gráficos no dependen de la disponibilidad: los cuatro.
  await expectProcessChartSeries('cpu')
  await expect(processPage().getByTestId('process-chart-panel')).toHaveCount(4)
})

test('CA2 (0028): sin datos de recursos, el cuarto marcador es el de disponibilidad y el cuarto gráfico, el de salud de red', async () => {
  sim.processEmpty = [...PROCESS_ROLE_METRICS.resources]
  await openProcessPage()
  await expectProcessMetricMarkers()
  await expectProcessFourthMarker('availability')
  await expectProcessProblems('1', '1')
  await expect(processMarker('resources')).toHaveCount(0)

  await expectProcessChartSeries('network-health')
  expect(await processChartKinds()).toEqual(['cpu', 'memory', 'network', 'network-health'])
  await expect(processChartPanel('resources')).toHaveCount(0)
})

test('CA2 (0028): sin disponibilidad, recursos ni salud de red, ni cuarto marcador ni cuarto gráfico; el resto sí', async () => {
  sim.processEmpty = [
    ...PROCESS_ROLE_METRICS.availability,
    ...PROCESS_ROLE_METRICS.resources,
    ...PROCESS_ROLE_METRICS.networkHealth
  ]
  const entityPage = await openProcessPage()
  await expectProcessMetricMarkers()
  await expectProcessProblems('1', '1')
  await expect(processMarker('availability')).toHaveCount(0)
  await expect(processMarker('resources')).toHaveCount(0)

  for (const kind of ['cpu', 'memory', 'network'] as const) await expectProcessChartSeries(kind)
  await expect(entityPage.getByTestId('process-chart-panel')).toHaveCount(3)
  expect(await processChartKinds()).toEqual(['cpu', 'memory', 'network'])
})

test('CA3 (0028): la franja de problemas sale sobre el gráfico de CPU con los problemas del proceso, y pulsar un tramo abre el problema', async () => {
  await openProcessPage()
  await processChartSeries('cpu')
  const band = processBand()
  await expect(band).toBeVisible()
  await expect(band.getByTestId('process-problem-segment')).toHaveCount(2)
  for (const { problemId } of [PROCESS_BAND_OPEN, PROCESS_BAND_CLOSED]) {
    await expect(processSegment(problemId), problemId).toHaveCount(1)
  }
  // Solo en el panel de la CPU.
  await expect(page.getByTestId('process-problem-band')).toHaveCount(1)

  // La lista se pide con el proceso y el rango global.
  await settledRequests()
  const lists = sim.entityProblemListQueries.filter((query) =>
    (query.get('problemSelector') ?? '').includes(PROCESS_METRICS_ID)
  )
  expect(lists).toHaveLength(1)
  expect(lists[0]?.get('problemSelector')).toBe(`affectedEntities("${PROCESS_METRICS_ID}")`)
  expect(lists[0]?.get('from')).toBe('now-2h')

  // Encima del gráfico: la franja acaba antes de que empiece el canvas.
  const bandBox = await settledBox(band)
  const plotBox = await settledBox(processChartPlot('cpu'))
  expect(bandBox.y + bandBox.height).toBeLessThanOrEqual(plotBox.y + 1)

  // Pulsar un tramo (trayéndolo a la vista) abre ese problema.
  await clickInPlace(processSegment(PROCESS_BAND_CLOSED.problemId), { scroll: true })
  await expect(page.getByTestId('problem-page')).toBeVisible()
  await expect(page.getByTestId('problem-page-title')).toContainText(PROCESS_BAND_CLOSED.displayId)
  expect(await currentRoute()).toBe(`/problems/${PROCESS_BAND_CLOSED.problemId}`)

  // «Volver» regresa a la página del proceso.
  await page.getByTestId('problem-back').click()
  await expect(processPage()).toBeVisible()
  expect(await currentRoute()).toBe(`/entities/PROCESS_GROUP_INSTANCE/${PROCESS_METRICS_ID}`)
})

test('CA4 (0028): cambiar el rango global vuelve a pedir los datos; «Actualizar» también; volver a la página sin cambios, no', async () => {
  await openProcessPage()
  await expectProcessMarkers()
  await settledRequests()
  // Al entrar: las dos consultas de métricas y las dos de recuentos, con el rango global.
  expect(sim.processMetricQueries).toHaveLength(2)
  expect(sim.entityProblemQueries).toHaveLength(2)
  for (const query of [...sim.processMetricQueries, ...sim.entityProblemQueries]) {
    expect(query.get('from')).toBe('now-2h')
  }

  // Rango nuevo: otra vez, con now-24h.
  await page.getByTestId('time-range-24h').click()
  await expect.poll(() => sim.processMetricQueries.length).toBe(4)
  await expect.poll(() => sim.entityProblemQueries.length).toBe(4)
  for (const query of [
    ...sim.processMetricQueries.slice(2),
    ...sim.entityProblemQueries.slice(2)
  ]) {
    expect(query.get('from')).toBe('now-24h')
  }
  await expectProcessMarkers()
  await settledRequests()
  expect(sim.processMetricQueries).toHaveLength(4)

  // Fuera y vuelta, sin cambiar nada: ninguna petición nueva.
  await goTo('metrics')
  await expect(processPage()).toHaveCount(0)
  const before = await settledRequests()
  await openProcessPage()
  await expectProcessMarkers()
  await page.waitForTimeout(1500)
  expect(sim.requests.slice(before), 'peticiones al volver a la página').toEqual([])

  // «Actualizar», en la cabecera de la página: otra vez, con el rango actual.
  await processPage().getByTestId('module-refresh').click()
  await expect.poll(() => sim.processMetricQueries.length).toBe(6)
  await expect.poll(() => sim.entityProblemQueries.length).toBe(6)
  for (const query of [
    ...sim.processMetricQueries.slice(4),
    ...sim.entityProblemQueries.slice(4)
  ]) {
    expect(query.get('from')).toBe('now-24h')
  }
  await expectProcessMarkers()
})

test('CA4 (0028): si falla el canal de métricas, sus marcadores y cada gráfico enseñan el aviso con Reintentar y el marcador de problemas sigue', async () => {
  sim.processMetricsFail = true
  await openProcessPage()

  // El de problemas, con sus recuentos y sin aviso.
  await expectProcessProblems('1', '1')
  await expect(processMarker('problems').getByRole('button', { name: 'Reintentar' })).toHaveCount(0)

  // Cada marcador de métricas, en su sitio, con el aviso y Reintentar y sin valor.
  for (const id of PROCESS_METRIC_MARKERS) {
    const marker = processMarker(id)
    await expect(marker, id).toBeVisible()
    await expect(marker.getByRole('alert').first(), id).toBeVisible()
    await expect(marker.getByRole('button', { name: 'Reintentar' }), id).toBeVisible()
    await expect(marker.getByTestId('process-marker-value'), id).toHaveCount(0)
  }
  // Cada gráfico (al menos CPU, memoria y red), con su aviso y Reintentar, sin gráfico.
  for (const kind of ['cpu', 'memory', 'network'] as const) {
    await expect(processChartPanel(kind), kind).toBeVisible()
  }
  for (const kind of (await processChartKinds()) as ProcessChartKind[]) {
    const panel = processChartPanel(kind)
    await expect(panel.getByRole('alert').first(), kind).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Reintentar' }), kind).toBeVisible()
    await expect(panel.getByTestId(`process-chart-${kind}`), kind).toHaveCount(0)
  }

  // Reintentar, con el canal ya bien: llegan valores y los cuatro gráficos.
  sim.processMetricsFail = false
  await clickInPlace(processMarker('cpu').getByRole('button', { name: 'Reintentar' }), {
    scroll: true
  })
  await expectProcessMarkers()
  await expect(processPage().getByTestId('process-chart-panel')).toHaveCount(4)
  expect(await processChartKinds()).toEqual(['cpu', 'memory', 'network', 'network-health'])
  for (const kind of (await processChartKinds()) as ProcessChartKind[]) {
    await expectProcessChartSeries(kind)
  }
  for (const id of PROCESS_METRIC_MARKERS) {
    await expect(processMarker(id).getByRole('button', { name: 'Reintentar' }), id).toHaveCount(0)
  }
})

test('CA5 (0028): desde la tabla de procesos del host, pulsar un proceso abre su página con sus marcadores y gráficos', async () => {
  await openHostPage()
  await expectHostTablesLoaded()
  const target = HOST_PAGE_TOP[2]
  const id = target?.id ?? ''
  const name = target?.name ?? ''
  await settledRequests()
  const processQueriesBefore = sim.processMetricQueries.length

  await clickInPlace(processRow(id).getByRole('link', { name }), { scroll: true })
  const entityPage = processPage()
  await expect(entityPage).toBeVisible()
  expect(await currentRoute()).toBe(`/entities/PROCESS_GROUP_INSTANCE/${id}`)
  await expect(entityPage.getByRole('heading', { level: 1 })).toHaveText(name)

  // Sus datos: los marcadores del simulador (sin problemas) y los cuatro gráficos.
  await expectProcessMetricMarkers()
  await expectProcessFourthMarker(await shownFourthMarker())
  await expectProcessProblems('0', '0')
  await expect(entityPage.getByTestId('process-chart-panel')).toHaveCount(4)
  expect(await processChartKinds()).toEqual(['cpu', 'memory', 'network', 'network-health'])
  for (const kind of (await processChartKinds()) as ProcessChartKind[]) {
    await expectProcessChartSeries(kind)
  }
  await expect(entityPage.getByTestId('entity-under-construction')).toHaveCount(0)

  // Las consultas, de ese proceso.
  await settledRequests()
  const queries = sim.processMetricQueries.slice(processQueriesBefore)
  expect(queries).toHaveLength(2)
  for (const query of queries) expect(query.get('entitySelector')).toBe(`entityId("${id}")`)
})

/**
 * Ficha 0029: tarjeta «Información» de la página de un proceso (PROCESS_METRICS_ID, con
 * processInfoBody), canal entities:get, con la forma de la del servicio (0015), el host (0020) y
 * el monitor (0026) y sus nombres con el prefijo `process-info`.
 *
 * Nombres que fijan estos tests: la tarjeta `process-info`, entre la cabecera y
 * `process-markers`; cada fila, `process-info-row` con `data-key` (las claves de
 * `buildProcessInfo`: technologies, listenPorts, detectedName, executable, firstSeen, lastSeen,
 * managementZones y tags, en ese orden) y su valor en `process-info-value`; los chips,
 * `process-info-chip`. Las relaciones, en `process-info-relations`: cada grupo
 * `process-info-group` con `data-group` (runsOn, processGroup, services y other), con
 * `process-info-group-toggle` (aria-expanded), `process-info-group-count` y, desplegado, sus
 * `process-info-entity` (enlaces, con `data-entity-id`), el botón `process-info-names` («Ver
 * nombres») y cada nombre en `process-info-entity-name`. «Todas las propiedades»,
 * `process-info-properties-toggle` y cada una `process-info-property` con `data-key`.
 */
const PROCESS_INFO_ROWS = [
  'technologies',
  'listenPorts',
  'detectedName',
  'executable',
  'firstSeen',
  'lastSeen',
  // Ficha 0037: sin la fila de etiquetas (van en las píldoras de arriba).
  'managementZones'
]
const processInfoCard = (): Locator => page.getByTestId('process-info')
const processInfoRow = (key: string): Locator =>
  processInfoCard().locator(`[data-testid="process-info-row"][data-key="${key}"]`)
const processInfoValue = (key: string): Locator =>
  processInfoRow(key).getByTestId('process-info-value')
const processInfoGroup = (key: string): Locator =>
  processInfoCard().locator(`[data-testid="process-info-group"][data-group="${key}"]`)
const processInfoEntity = (group: string, id: string): Locator =>
  processInfoGroup(group).locator(`[data-testid="process-info-entity"][data-entity-id="${id}"]`)
const processInfoProperty = (key: string): Locator =>
  processInfoCard().locator(`[data-testid="process-info-property"][data-key="${key}"]`)

/** Ficha 0029: abre la página del proceso y espera su tarjeta con filas. */
async function openProcessInfo(): Promise<Locator> {
  await openProcessPage()
  const card = processInfoCard()
  await expect(card).toBeVisible()
  await expect(card.getByTestId('process-info-row').first()).toBeVisible()
  return card
}

/** Ficha 0029: despliega un grupo de relaciones del proceso (si no lo está). */
async function expandProcessGroup(key: string): Promise<Locator> {
  const group = processInfoGroup(key)
  const toggle = group.getByTestId('process-info-group-toggle')
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await clickInPlace(toggle, { scroll: true })
  }
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  return group
}

/**
 * Ficha 0029: ni la línea de comandos ni la ruta completa del simulador aparecen en ningún sitio
 * de la página: ni en el texto ni en el HTML (atributos, títulos, tooltips).
 */
async function expectNoProcessSecrets(where: string): Promise<void> {
  const html = await page.content()
  const text = await page.locator('body').innerText()
  for (const part of PROCESS_INFO_SECRET_PARTS) {
    expect(html, `${where}: HTML con «${part}»`).not.toContain(part)
    expect(text, `${where}: texto con «${part}»`).not.toContain(part)
  }
}

test('CA3 (0029): la página de un proceso enseña su tarjeta «Información» (tecnologías, puertos, ejecutable…), sus relaciones con «Ver nombres» y enlaces al host y a los servicios, y nunca la línea de comandos ni la ruta completa', async () => {
  const card = await openProcessInfo()
  await expect(card).toContainText('Información')

  // Debajo de los marcadores: desde la ficha 0036, «Información» va al final de la página.
  const cardBox = await settledBox(card)
  const markersBox = await settledBox(page.getByTestId('process-markers'))
  expect(cardBox.y, 'la tarjeta va debajo de los marcadores').toBeGreaterThanOrEqual(
    markersBox.y + markersBox.height - 1
  )

  // Las filas, en su orden y con sus valores.
  expect(await dataKeys(card.getByTestId('process-info-row'))).toEqual(PROCESS_INFO_ROWS)
  await expect(processInfoRow('technologies').getByTestId('process-info-chip')).toHaveText([
    'JAVA OpenJDK 17.0.2',
    'APACHE_TOMCAT 10.1'
  ])
  await expect(processInfoValue('listenPorts')).toContainText(loneNumber('8080'))
  await expect(processInfoValue('listenPorts')).toContainText(loneNumber('8443'))
  await expect(processInfoValue('detectedName')).toContainText('pagos-worker-detectado-e2e')
  // Solo el nombre del fichero.
  await expect(processInfoValue('executable')).toHaveText(/^\s*pagos-worker-e2e\s*$/)
  await expect(processInfoValue('firstSeen')).toContainText('2026')
  await expect(processInfoValue('lastSeen')).toContainText('2026')
  await expect(processInfoRow('managementZones').getByTestId('process-info-chip')).toHaveText([
    'Zona proceso A'
  ])
  // Ficha 0037: las etiquetas ya no salen en la tarjeta.
  await expect(processInfoRow('tags')).toHaveCount(0)
  for (const text of ['undefined', 'null', 'NaN', '[object Object]']) {
    await expect(card, text).not.toContainText(text)
  }
  // Sin las tarjetas de otros tipos.
  for (const other of ['service-info', 'host-info', 'monitor-info']) {
    await expect(page.getByTestId(other), other).toHaveCount(0)
  }

  // Relaciones: Se ejecuta en, Process group, Servicios y Otras relaciones (plegada).
  const relations = card.getByTestId('process-info-relations')
  await expect(relations).toContainText('Relaciones')
  const groups = relations.getByTestId('process-info-group')
  await expect(groups).toHaveCount(4)
  expect(await dataKeys(groups, 'data-group')).toEqual([
    'runsOn',
    'processGroup',
    'services',
    'other'
  ])
  for (const [key, title, count] of [
    ['runsOn', 'Se ejecuta en', '1'],
    ['processGroup', 'Process group', '1'],
    ['services', 'Servicios', '2'],
    ['other', 'Otras relaciones', '1']
  ] as const) {
    await expect(processInfoGroup(key), key).toContainText(title)
    await expect(processInfoGroup(key).getByTestId('process-info-group-count'), key).toHaveText(
      new RegExp(`^\\s*${count}\\s*$`)
    )
  }
  await expect(processInfoGroup('other').getByTestId('process-info-group-toggle')).toHaveAttribute(
    'aria-expanded',
    'false'
  )
  await expect(processInfoGroup('other').getByTestId('process-info-entity')).toHaveCount(0)

  // Desplegados, con sus entidades; ningún nombre pedido aún.
  await expandProcessGroup('runsOn')
  await expandProcessGroup('processGroup')
  const services = await expandProcessGroup('services')
  expect(await dataKeys(services.getByTestId('process-info-entity'), 'data-entity-id')).toEqual([
    INFO_FEW_ID,
    PROCESS_INFO_SERVICE_2
  ])
  const other = await expandProcessGroup('other')
  await expect(other).toContainText('isPgiOfCgi')
  await expect(processInfoEntity('other', PROCESS_INFO_CGI)).toContainText(PROCESS_INFO_CGI)
  await settledRequests()
  expect(sim.entityNamesQueries, 'nombres antes de «Ver nombres»').toHaveLength(0)

  // «Ver nombres» de «Servicios»: una llamada con sus dos ids y los nombres en su sitio.
  const button = services.getByTestId('process-info-names')
  await expect(button).toHaveText('Ver nombres')
  await clickInPlace(button, { scroll: true })
  await expect.poll(() => sim.entityNamesQueries.length).toBe(1)
  const selector = sim.entityNamesQueries[0]?.get('entitySelector') ?? ''
  expect(selector).toContain(INFO_FEW_ID)
  expect(selector).toContain(PROCESS_INFO_SERVICE_2)
  await expect(
    processInfoEntity('services', INFO_FEW_ID).getByTestId('process-info-entity-name')
  ).toHaveText('info-pocas-e2e')
  await expect(
    processInfoEntity('services', PROCESS_INFO_SERVICE_2).getByTestId('process-info-entity-name')
  ).toHaveText('servicio-proceso-e2e')
  // Los de otros grupos, sin pedir; «Ver nombres» del host, aparte.
  await settledRequests()
  expect(sim.entityNamesQueries).toHaveLength(1)
  await expect(
    processInfoEntity('runsOn', PROCESS_INFO_HOST).getByTestId('process-info-entity-name')
  ).toHaveCount(0)
  await clickInPlace(processInfoGroup('runsOn').getByTestId('process-info-names'), {
    scroll: true
  })
  await expect(
    processInfoEntity('runsOn', PROCESS_INFO_HOST).getByTestId('process-info-entity-name')
  ).toHaveText('host-proceso-e2e')

  // «Todas las propiedades», plegada; desplegada, con metadata pero sin la línea de comandos.
  await expect(card.getByTestId('process-info-property')).toHaveCount(0)
  const toggle = card.getByTestId('process-info-properties-toggle')
  await expect(toggle).toContainText('Todas las propiedades')
  await clickInPlace(toggle, { scroll: true })
  await expect(processInfoProperty('detectedName')).toContainText('pagos-worker-detectado-e2e')
  await expect(processInfoProperty('metadata')).toContainText('pagos-worker-e2e')

  // Con todo desplegado: ni la línea de comandos ni la ruta completa en ningún sitio.
  await expectNoProcessSecrets('todo desplegado')

  // Enlaces: el host, el process group y los servicios, a su página.
  const host = processInfoEntity('runsOn', PROCESS_INFO_HOST)
  await expect(host).toHaveRole('link')
  await expect(host).toHaveAttribute('href', new RegExp(`#/entities/HOST/${PROCESS_INFO_HOST}$`))
  await expect(processInfoEntity('processGroup', PROCESS_INFO_PG)).toHaveAttribute(
    'href',
    new RegExp(`#/entities/PROCESS_GROUP/${PROCESS_INFO_PG}$`)
  )
  const service = processInfoEntity('services', INFO_FEW_ID)
  await expect(service).toHaveRole('link')
  await expect(service).toHaveAttribute('href', new RegExp(`#/entities/SERVICE/${INFO_FEW_ID}$`))

  const processQueries = (): number =>
    sim.requests.filter((request) => request.includes(`/entities/${PROCESS_METRICS_ID}`)).length
  const before = processQueries()

  // Pulsar el host abre su página; «Volver» regresa al proceso.
  await clickInPlace(host, { scroll: true })
  const hostPage = page.getByTestId('entity-page-host')
  await expect(hostPage).toBeVisible()
  expect(await currentRoute()).toBe(`/entities/HOST/${PROCESS_INFO_HOST}`)
  await expect(page.getByTestId('process-info')).toHaveCount(0)
  await clickInPlace(hostPage.getByTestId('entity-back'), { scroll: true })
  await expect(processPage()).toBeVisible()
  expect(await currentRoute()).toBe(`/entities/PROCESS_GROUP_INSTANCE/${PROCESS_METRICS_ID}`)
  await expect(processInfoValue('executable')).toContainText('pagos-worker-e2e')

  // Pulsar un servicio abre la suya; «Volver» regresa al proceso sin volver a pedir sus datos.
  await expandProcessGroup('services')
  await clickInPlace(processInfoEntity('services', INFO_FEW_ID), { scroll: true })
  const servicePage = page.getByTestId('entity-page-service')
  await expect(servicePage).toBeVisible()
  expect(await currentRoute()).toBe(`/entities/SERVICE/${INFO_FEW_ID}`)
  await expect(servicePage.getByTestId('entity-page-id')).toHaveText(INFO_FEW_ID)
  await clickInPlace(servicePage.getByTestId('entity-back'), { scroll: true })
  await expect(processPage()).toBeVisible()
  await expect(processInfoValue('executable')).toContainText('pagos-worker-e2e')
  await settledRequests()
  expect(processQueries(), 'entities:get del proceso al volver').toBe(before)

  // Tampoco al volver, con la tarjeta recién pintada.
  await expectNoProcessSecrets('al volver')
})

test('CA4 (0029): sin entities.read, la tarjeta del proceso dice qué scope falta y los marcadores y gráficos siguen', async () => {
  const tenants = await invoke<{ clients: { id: string; name: string }[] }>('tenants:list')
  const clientId = tenants.clients.find((client) => client.name === 'Cliente A')?.id ?? ''
  const noEntities = await createEnvironment(
    clientId,
    'Sin entidades proceso',
    'other',
    TOKEN_NO_ENTITIES
  )
  try {
    await invoke('connection:test', { environmentId: noEntities })
    await invoke('environments:setActive', { environmentId: noEntities })
    await reloadUi()
    await openProcessPage()
    const unavailable = processInfoCard().getByTestId('module-unavailable')
    await expect(unavailable).toBeVisible()
    await expect(unavailable).toContainText('entities.read')
    await expect(processInfoCard().getByTestId('process-info-row')).toHaveCount(0)
    // Marcadores y gráficos, con sus datos.
    await expectProcessMarkers()
    await expect(processPage().getByTestId('process-chart-panel')).toHaveCount(4)
    for (const kind of (await processChartKinds()) as ProcessChartKind[]) {
      await expectProcessChartSeries(kind)
    }
    await settledRequests()
    expect(sim.entityInfoQueries, 'entities:get sin el scope').toHaveLength(0)
  } finally {
    await invoke('environments:setActive', { environmentId: env['Producción'] })
    await invoke('environments:delete', { id: noEntities })
    await reloadUi()
  }
})

// ---------------------------------------------------------------------------
// Ficha 0036: en las páginas de entidad, marcadores primero e «Información» al final.
// ---------------------------------------------------------------------------

interface OrderedEntityPage {
  /** Nombre de la página en los mensajes. */
  name: string
  /** Abre la página y espera la tarjeta «Información» con sus filas. */
  open: () => Promise<Locator>
  pageTestId: string
  markers: string
  info: string
  charts: string
  /** Las demás tarjetas de la página, que van detrás de los gráficos. */
  cards: string[]
}

const ORDERED_ENTITY_PAGES: OrderedEntityPage[] = [
  {
    name: 'servicio',
    open: () => openServiceInfo(INFO_FULL_ID),
    pageTestId: 'entity-page-service',
    markers: 'service-markers',
    info: 'service-info',
    charts: 'service-charts',
    cards: []
  },
  {
    name: 'host',
    open: () => openHostInfo(HOST_INFO_FULL_ID),
    pageTestId: 'entity-page-host',
    markers: 'host-markers',
    info: 'host-info',
    charts: 'host-charts',
    cards: ['host-disks', 'host-processes']
  },
  {
    name: 'browser monitor',
    open: () => openMonitorInfo('browser'),
    pageTestId: MONITOR_PAGES.browser.testId,
    markers: 'monitor-markers',
    info: 'monitor-info',
    charts: 'monitor-charts',
    cards: ['monitor-locations', 'monitor-steps']
  },
  {
    name: 'HTTP monitor',
    open: () => openMonitorInfo('http'),
    pageTestId: MONITOR_PAGES.http.testId,
    markers: 'monitor-markers',
    info: 'monitor-info',
    charts: 'monitor-charts',
    cards: ['monitor-locations', 'monitor-steps']
  },
  {
    name: 'proceso',
    open: () => openProcessInfo(),
    pageTestId: 'entity-page-process_group_instance',
    markers: 'process-markers',
    info: 'process-info',
    charts: 'process-charts',
    cards: []
  }
]

/**
 * Ficha 0036: lo que se ve en la página antes (o después) de `testId`, subiendo desde él hasta la
 * raíz de la página y mirando los hermanos con caja de cada nivel. Cada uno se nombra por su
 * `data-testid`, por el primero que tenga dentro o por su etiqueta (`header` para la cabecera).
 * No depende de cómo se envuelvan las secciones.
 */
async function visibleNeighbours(
  pageTestId: string,
  testId: string,
  side: 'before' | 'after'
): Promise<string[]> {
  return page.getByTestId(pageTestId).evaluate(
    (root, [id, where]) => {
      const target = root.querySelector(`[data-testid="${id}"]`)
      if (target === null) return [`sin ${id}`]
      const describe = (element: Element): string => {
        if (element.tagName === 'HEADER') return 'header'
        const own = element.getAttribute('data-testid')
        if (own !== null) return own
        const inner = element.querySelector('[data-testid]')?.getAttribute('data-testid')
        return inner ?? element.tagName.toLowerCase()
      }
      const found: string[] = []
      for (let node: Element = target; node !== root;) {
        let sibling = where === 'after' ? node.nextElementSibling : node.previousElementSibling
        while (sibling !== null) {
          const rect = sibling.getBoundingClientRect()
          if (rect.width > 0 && rect.height > 0) found.push(describe(sibling))
          sibling = where === 'after' ? sibling.nextElementSibling : sibling.previousElementSibling
        }
        if (node.parentElement === null) break
        node = node.parentElement
      }
      return found
    },
    [testId, side] as const
  )
}

/** Ficha 0036: abre la página y espera sus secciones (marcadores, gráficos y tarjetas). */
async function openOrderedPage(entry: OrderedEntityPage): Promise<void> {
  await entry.open()
  for (const id of [entry.markers, entry.charts, ...entry.cards]) {
    await expect(page.getByTestId(entry.pageTestId).getByTestId(id), id).toBeVisible()
  }
}

test('CA1 (0036): en las páginas de servicio, host, browser monitor, HTTP monitor y proceso, la tarjeta «Información» es la última sección, después de los gráficos y de las demás tarjetas', async () => {
  for (const entry of ORDERED_ENTITY_PAGES) {
    await openOrderedPage(entry)
    // Nada visible detrás de la tarjeta, por mucho que se envuelvan las secciones.
    expect(
      await visibleNeighbours(entry.pageTestId, entry.info, 'after'),
      `${entry.name}: nada después de «Información»`
    ).toEqual([])

    // Y en la pantalla: los gráficos y las demás tarjetas, encima de ella; los gráficos, antes que
    // las tarjetas.
    const infoBox = await settledBox(page.getByTestId(entry.info))
    const chartsBox = await settledBox(page.getByTestId(entry.charts))
    expect(
      chartsBox.y + chartsBox.height,
      `${entry.name}: gráficos encima de «Información»`
    ).toBeLessThanOrEqual(infoBox.y + 1)
    for (const id of entry.cards) {
      const box = await settledBox(page.getByTestId(id))
      expect(
        box.y + box.height,
        `${entry.name}: ${id} encima de «Información»`
      ).toBeLessThanOrEqual(infoBox.y + 1)
      expect(box.y, `${entry.name}: ${id} debajo de los gráficos`).toBeGreaterThanOrEqual(
        chartsBox.y + chartsBox.height - 1
      )
    }
  }
})

test('CA2 (0036): en esas cinco páginas, los marcadores son la primera sección después de la cabecera', async () => {
  for (const entry of ORDERED_ENTITY_PAGES) {
    await openOrderedPage(entry)
    // Antes de los marcadores, solo la cabecera (y, desde la ficha 0037, la fila de etiquetas).
    expect(
      (await visibleNeighbours(entry.pageTestId, entry.markers, 'before')).filter(
        (name) => name !== 'entity-tags'
      ),
      `${entry.name}: solo la cabecera antes de los marcadores`
    ).toEqual(['header'])

    // Y en la pantalla, los marcadores encima de los gráficos, de las tarjetas y de «Información».
    const markersBox = await settledBox(page.getByTestId(entry.markers))
    for (const id of [entry.charts, ...entry.cards, entry.info]) {
      const box = await settledBox(page.getByTestId(id))
      expect(box.y, `${entry.name}: ${id} debajo de los marcadores`).toBeGreaterThanOrEqual(
        markersBox.y + markersBox.height - 1
      )
    }
  }
})

// ---------------------------------------------------------------------------
// Ficha 0037: etiquetas arriba del todo, como píldoras clave:valor.
// ---------------------------------------------------------------------------

/**
 * Nombres que fijan estos tests (la ficha no los daba; decisión del test-writer, delegada por
 * Dani y refinable): la fila de píldoras es `entity-tags`, común a todas las páginas de entidad;
 * cada píldora, `entity-tag`, con su clave en `entity-tag-key`, su valor (si lo hay) en
 * `entity-tag-value` y su contexto (si no es CONTEXTLESS) en `entity-tag-context`; el «+N» que
 * despliega el resto, `entity-tags-more`. La cabecera de la página es su `header`.
 */
const entityTags = (pageTestId: string): Locator =>
  page.getByTestId(pageTestId).getByTestId('entity-tags')

/** Ficha 0037: la clave de un elemento de píldora, sin espacios ni los dos puntos de «clave:». */
const cleanTagKey = (text: string | null): string => (text ?? '').replace(/:\s*$/, '').trim()

/** Ficha 0037: la clave de cada píldora de la fila, en el orden del DOM. */
async function tagKeys(row: Locator): Promise<string[]> {
  return (await row.getByTestId('entity-tag-key').allTextContents()).map(cleanTagKey)
}

/**
 * Ficha 0037: las píldoras que se ven dentro de la fila (caja no vacía, sin `visibility: hidden` y
 * dentro de la caja de la fila: una píldora recortada por la fila no se ve), con su clave y su
 * línea (arriba y alto).
 */
async function shownTags(row: Locator): Promise<{ key: string; top: number; height: number }[]> {
  return row.evaluate((element) => {
    const rowRect = element.getBoundingClientRect()
    return [...element.querySelectorAll('[data-testid="entity-tag"]')].flatMap((pill) => {
      const rect = pill.getBoundingClientRect()
      const inside =
        rect.top >= rowRect.top - 1 &&
        rect.bottom <= rowRect.bottom + 1 &&
        rect.left >= rowRect.left - 1 &&
        rect.right <= rowRect.right + 1
      const hidden = getComputedStyle(pill).visibility === 'hidden'
      if (rect.width === 0 || rect.height === 0 || hidden || !inside) return []
      const key = (pill.querySelector('[data-testid="entity-tag-key"]')?.textContent ?? '')
        .replace(/:\s*$/, '')
        .trim()
      return [{ key, top: rect.top, height: rect.height }]
    })
  })
}

/** Ficha 0037: ¿va `first` antes que `second` en el DOM, dentro de `root`? */
async function comesBefore(root: Locator, first: string, second: string): Promise<boolean> {
  return root.evaluate(
    (element, [a, b]) => {
      const nodeA = element.querySelector(`[data-testid="${a}"]`)
      const nodeB = element.querySelector(`[data-testid="${b}"]`)
      if (nodeA === null || nodeB === null) return false
      return (nodeA.compareDocumentPosition(nodeB) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    },
    [first, second] as const
  )
}

/** Ficha 0037: abre la página del servicio, espera su tarjeta (los datos ya han llegado) y la fila. */
async function openTagsPage(id: string): Promise<Locator> {
  await openServiceInfo(id)
  const row = entityTags('entity-page-service')
  await expect(row).toBeVisible()
  return row
}

test('CA2 (0037): en la página de un servicio, las píldoras salen entre la cabecera y los marcadores, en orden alfabético; la de solo clave enseña solo la clave y las de contexto llevan su prefijo', async () => {
  const row = await openTagsPage(TAGS_ID)
  const pageTestId = 'entity-page-service'
  const root = page.getByTestId(pageTestId)

  // Entre la cabecera y los marcadores: antes de los marcadores, solo la cabecera y la fila (que
  // puede ir dentro de la cabecera, debajo del título); la fila, antes que los marcadores en el
  // DOM y encima de ellos en la pantalla.
  const before = await visibleNeighbours(pageTestId, 'service-markers', 'before')
  expect(before, 'antes de los marcadores, la cabecera').toContain('header')
  expect(
    before.filter((name) => name !== 'entity-tags' && name !== 'header'),
    'nada más antes de los marcadores'
  ).toEqual([])
  expect(await comesBefore(root, 'entity-tags', 'service-markers'), 'orden en el DOM').toBe(true)
  const headerBox = await settledBox(root.locator('header').first())
  const rowBox = await settledBox(row)
  const markersBox = await settledBox(page.getByTestId('service-markers'))
  expect(rowBox.y, 'la fila, por debajo del principio de la cabecera').toBeGreaterThan(headerBox.y)
  expect(rowBox.y + rowBox.height, 'la fila, encima de los marcadores').toBeLessThanOrEqual(
    markersBox.y + 1
  )

  // Cinco píldoras, por clave en orden alfabético (no en el de la respuesta).
  const pills = row.getByTestId('entity-tag')
  await expect(pills).toHaveCount(TAGS_SORTED_KEYS.length)
  expect(await tagKeys(row)).toEqual(TAGS_SORTED_KEYS)
  // Las píldoras ya están en el orden de TAGS_SORTED_KEYS (comprobado justo arriba).
  const pill = (key: string): Locator => pills.nth(TAGS_SORTED_KEYS.indexOf(key))

  // Clave y valor, con el valor aparte y en otro tono que la clave.
  const zona = pill('zona')
  await expect(zona.getByTestId('entity-tag-value')).toHaveText(/^\s*norte\s*$/)
  await expect(zona).toHaveText(/zona\s*:\s*norte/)
  const colors = await zona.evaluate((element) => {
    const color = (id: string): string => {
      const target = element.querySelector(`[data-testid="${id}"]`)
      return target === null ? '' : getComputedStyle(target).color
    }
    return { key: color('entity-tag-key'), value: color('entity-tag-value') }
  })
  expect(colors.key, 'la clave tiene color').not.toBe('')
  expect(colors.value, 'la clave y el valor, en tonos distintos').not.toBe(colors.key)

  // Solo clave: ni valor ni dos puntos.
  const critico = pill('critico')
  await expect(critico.getByTestId('entity-tag-value')).toHaveCount(0)
  await expect(critico).not.toContainText(':')
  await expect(critico).toHaveText(/^\s*critico\s*$/)

  // Sin contexto (CONTEXTLESS), sin prefijo; con contexto, su prefijo antes de la clave.
  for (const key of ['zona', 'critico']) {
    await expect(pill(key).getByTestId('entity-tag-context'), key).toHaveCount(0)
    await expect(pill(key), key).not.toContainText(/contextless/i)
  }
  const withContext: [string, RegExp, string][] = [
    ['app', /kubernetes/i, 'pagos-k8s-e2e'],
    ['equipo', /environment/i, 'pagos-entorno-e2e'],
    ['nombre', /aws/i, 'pagos-aws-e2e']
  ]
  for (const [key, context, value] of withContext) {
    const target = pill(key)
    await expect(target.getByTestId('entity-tag-context'), key).toHaveText(context)
    await expect(target.getByTestId('entity-tag-value'), key).toHaveText(
      new RegExp(`^\\s*${value}\\s*$`)
    )
    expect(
      await comesBefore(target, 'entity-tag-context', 'entity-tag-key'),
      `${key}: el contexto va antes de la clave`
    ).toBe(true)
  }
})

test('CA2 (0037): en las páginas de host, browser monitor y proceso, sus etiquetas también salen como píldoras entre la cabecera y los marcadores, por orden alfabético', async () => {
  const cases: [string, string[]][] = [
    ['host', ['entorno', 'equipo']],
    ['browser monitor', ['entorno', 'equipo']],
    ['proceso', ['equipo']]
  ]
  for (const [name, keys] of cases) {
    const entry = ORDERED_ENTITY_PAGES.find((candidate) => candidate.name === name)
    expect(entry, name).toBeDefined()
    if (entry === undefined) continue
    await entry.open()
    const root = page.getByTestId(entry.pageTestId)
    const row = entityTags(entry.pageTestId)
    await expect(row, name).toBeVisible()
    expect(await tagKeys(row), name).toEqual(keys)
    expect(await comesBefore(root, 'entity-tags', entry.markers), `${name}: orden en el DOM`).toBe(
      true
    )
    const rowBox = await settledBox(row)
    const markersBox = await settledBox(root.getByTestId(entry.markers))
    expect(rowBox.y + rowBox.height, `${name}: encima de los marcadores`).toBeLessThanOrEqual(
      markersBox.y + 1
    )
  }
})

test('CA3 (0037): con muchas etiquetas, se ven las que caben en dos líneas y «+N» despliega el resto, en orden', async () => {
  const row = await openTagsPage(TAGS_MANY_ID)
  await expect(row.getByTestId('entity-tag').first()).toBeVisible()
  const more = row.getByTestId('entity-tags-more')
  await expect(more).toBeVisible()
  await expect(more).toHaveText(/^\s*\+\d+\s*$/)
  const hidden = Number(((await more.textContent()) ?? '').replace(/\D/g, ''))

  // Plegada: las primeras por orden alfabético, en dos líneas como mucho, y «+N» con las demás.
  await settledBox(row)
  const shown = await shownTags(row)
  expect(shown.length, 'alguna se ve').toBeGreaterThan(0)
  expect(hidden, 'N > 0').toBeGreaterThan(0)
  expect(shown.length + hidden, 'las que se ven más N son todas').toBe(TAGS_MANY_KEYS.length)
  expect(shown.map((tag) => tag.key)).toEqual(TAGS_MANY_KEYS.slice(0, shown.length))
  const lines: number[] = []
  for (const tag of shown) {
    if (!lines.some((top) => Math.abs(top - tag.top) < tag.height / 2)) lines.push(tag.top)
  }
  expect(lines.length, 'como mucho dos líneas').toBeLessThanOrEqual(2)

  // Desplegada: todas, en orden.
  await clickInPlace(more, { scroll: true })
  await expect
    .poll(async () => (await shownTags(row)).map((tag) => tag.key))
    .toEqual(TAGS_MANY_KEYS)
})

test('CA4 (0037): la tarjeta «Información» ya no enseña etiquetas en las páginas de servicio, host, browser monitor y proceso; la fila de píldoras sí', async () => {
  const cases: [string, string, string[]][] = [
    ['servicio', 'service-info-row', INFO_TAGS],
    ['host', 'host-info-row', ['equipo:sistemas', 'entorno:pre', 'sistemas']],
    ['browser monitor', 'monitor-info-row', ['equipo:web', 'entorno:pro']],
    ['proceso', 'process-info-row', ['equipo:proceso']]
  ]
  for (const [name, rowTestId, texts] of cases) {
    const entry = ORDERED_ENTITY_PAGES.find((candidate) => candidate.name === name)
    expect(entry, name).toBeDefined()
    if (entry === undefined) continue
    const card = await entry.open()
    await expect(card.getByTestId(rowTestId).first(), name).toBeVisible()
    await expect(card.locator(`[data-testid="${rowTestId}"][data-key="tags"]`), name).toHaveCount(0)
    await expect(card.getByTestId('entity-tags'), name).toHaveCount(0)
    await expect(card.getByTestId('entity-tag'), name).toHaveCount(0)
    for (const text of texts) await expect(card, `${name}: ${text}`).not.toContainText(text)
    // Las etiquetas siguen en la página, en la fila de píldoras.
    await expect(entityTags(entry.pageTestId).getByTestId('entity-tag').first(), name).toBeVisible()
  }
})

test('CA5 (0037): sin etiquetas, o sin el scope entities.read, no hay fila de píldoras y los marcadores siguen justo debajo de la cabecera', async () => {
  // Servicio y HTTP monitor sin etiquetas (con la tarjeta ya cargada: los datos han llegado).
  await openServiceInfo(INFO_FEW_ID)
  await expect(entityTags('entity-page-service')).toHaveCount(0)
  await expect(page.getByTestId('entity-tag')).toHaveCount(0)
  expect(await visibleNeighbours('entity-page-service', 'service-markers', 'before')).toEqual([
    'header'
  ])
  const http = ORDERED_ENTITY_PAGES.find((candidate) => candidate.name === 'HTTP monitor')
  expect(http).toBeDefined()
  if (http !== undefined) {
    await http.open()
    await expect(entityTags(http.pageTestId)).toHaveCount(0)
    await expect(page.getByTestId('entity-tag')).toHaveCount(0)
  }

  // Sin entities.read: la tarjeta dice qué scope falta y no hay fila (aunque la entidad tenga).
  const tenants = await invoke<{ clients: { id: string; name: string }[] }>('tenants:list')
  const clientId = tenants.clients.find((client) => client.name === 'Cliente A')?.id ?? ''
  const noEntities = await createEnvironment(clientId, 'Sin entidades', 'other', TOKEN_NO_ENTITIES)
  try {
    await invoke('connection:test', { environmentId: noEntities })
    await invoke('environments:setActive', { environmentId: noEntities })
    await reloadUi()
    await goToRoute(`/entities/SERVICE/${TAGS_ID}`)
    await expect(page.getByTestId('entity-page-service')).toBeVisible()
    await expect(infoCard().getByTestId('module-unavailable')).toContainText('entities.read')
    await expect(page.getByTestId('service-markers')).toBeVisible()
    await expect(entityTags('entity-page-service')).toHaveCount(0)
    await expect(page.getByTestId('entity-tag')).toHaveCount(0)
  } finally {
    await invoke('environments:setActive', { environmentId: env['Producción'] })
    await invoke('environments:delete', { id: noEntities })
    await reloadUi()
  }
})

// ---------------------------------------------------------------------------
// Ficha 0049: etiquetas como cápsula de dos colores (clave | valor).
// ---------------------------------------------------------------------------

/**
 * Nombres que fija este test (la ficha pide un `data-testid` por mitad sin darlo; decisión del
 * developer, delegada por Dani y refinable): la mitad de la clave es `entity-tag-key-part` (con el
 * contexto y `entity-tag-key` dentro) y la del valor, `entity-tag-value-part` (con
 * `entity-tag-value` dentro). Los de la 0037 siguen igual.
 */
async function capsuleParts(pill: Locator): Promise<{
  pill: { left: number; right: number; top: number }
  key: { left: number; right: number; top: number; background: string } | null
  value: { left: number; right: number; top: number; background: string } | null
}> {
  return pill.evaluate((element) => {
    const part = (
      id: string
    ): { left: number; right: number; top: number; background: string } | null => {
      const target = element.querySelector(`[data-testid="${id}"]`)
      if (target === null) return null
      const rect = target.getBoundingClientRect()
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        background: getComputedStyle(target).backgroundColor
      }
    }
    const rect = element.getBoundingClientRect()
    return {
      pill: { left: rect.left, right: rect.right, top: rect.top },
      key: part('entity-tag-key-part'),
      value: part('entity-tag-value-part')
    }
  })
}

const TRANSPARENT = ['rgba(0, 0, 0, 0)', 'transparent', '']

test('CA3 (0049): una etiqueta clave:valor sale como cápsula de dos mitades y una de solo clave con una sola; la misma clave lleva el mismo color', async () => {
  const row = await openTagsPage(TAGS_CAPSULE_ID)
  const pills = row.getByTestId('entity-tag')
  await expect(pills).toHaveCount(4)
  expect(await tagKeys(row)).toEqual(['critico', 'equipo', 'equipo', 'zona'])
  await settledBox(row)

  // Con valor: dos mitades, la clave a la izquierda y el valor a su derecha, en la misma línea,
  // cada una con su texto y con fondos distintos (ninguno transparente).
  const withValue: [number, string, string][] = [
    [1, 'equipo', 'pagos'],
    [2, 'equipo', 'web'],
    [3, 'zona', 'norte']
  ]
  const keyBackgrounds: Record<number, string> = {}
  for (const [index, key, value] of withValue) {
    const pill = pills.nth(index)
    await expect(pill.getByTestId('entity-tag-key-part'), key).toHaveCount(1)
    await expect(pill.getByTestId('entity-tag-value-part'), key).toHaveCount(1)
    await expect(
      pill.getByTestId('entity-tag-key-part').getByTestId('entity-tag-key'),
      key
    ).toHaveText(new RegExp(`^\\s*${key}\\s*$`))
    await expect(
      pill.getByTestId('entity-tag-value-part').getByTestId('entity-tag-value'),
      key
    ).toHaveText(new RegExp(`^\\s*${value}\\s*$`))
    const parts = await capsuleParts(pill)
    expect(parts.key, `${key}: mitad de la clave`).not.toBeNull()
    expect(parts.value, `${key}: mitad del valor`).not.toBeNull()
    if (parts.key === null || parts.value === null) continue
    expect(parts.key.right, `${key}: la clave, a la izquierda del valor`).toBeLessThanOrEqual(
      parts.value.left + 1.5
    )
    expect(Math.abs(parts.key.top - parts.value.top), `${key}: misma línea`).toBeLessThan(2)
    expect(TRANSPARENT, `${key}: la clave tiene fondo`).not.toContain(parts.key.background)
    expect(TRANSPARENT, `${key}: el valor tiene fondo`).not.toContain(parts.value.background)
    expect(parts.key.background, `${key}: dos colores`).not.toBe(parts.value.background)
    keyBackgrounds[index] = parts.key.background
  }

  // La misma clave (equipo), el mismo color.
  expect(keyBackgrounds[1]).toBe(keyBackgrounds[2])

  // Solo clave: una sola mitad, del color de la clave, que ocupa la cápsula entera.
  const critico = pills.nth(0)
  await expect(critico.getByTestId('entity-tag-key-part')).toHaveCount(1)
  await expect(critico.getByTestId('entity-tag-value-part')).toHaveCount(0)
  const single = await capsuleParts(critico)
  expect(single.key).not.toBeNull()
  if (single.key !== null) {
    expect(TRANSPARENT, 'solo clave: con fondo').not.toContain(single.key.background)
    // Entera: como mucho el borde (1 px por lado) y redondeo.
    expect(single.key.left - single.pill.left).toBeLessThanOrEqual(2)
    expect(single.pill.right - single.key.right).toBeLessThanOrEqual(2)
  }
})

// ---------------------------------------------------------------------------
// Ficha 0032: página de un PROCESS_GROUP (marcadores, gráficos, instancias e «Información»).
// ---------------------------------------------------------------------------

/**
 * Página del process group inventado de la ficha 0032 (PROCESS_GROUP_PAGE_ID, siete instancias en
 * tres hosts), con el canal entities:processGroupMetrics de la 0031 (totales PROCESS_GROUP_SERIES
 * y PROCESS_GROUP_MARKERS), sus problemas (processGroupBandProblems: uno abierto y uno cerrado) y
 * entities:get (processGroupInfoBody).
 *
 * Nombres que fijan estos tests (la ficha no los da; decisión del test-writer, delegada por Dani y
 * refinable), los del proceso (0028 y 0029) con el prefijo `process-group`:
 * - Marcadores: la fila `process-group-markers`; cada marcador `process-group-marker-<id>`
 *   (instances, cpu, memory, network y problems); el valor principal en
 *   `process-group-marker-value` (el de la CPU con `data-level`), lo de debajo en
 *   `process-group-marker-secondary` (máxima y salida) y los recuentos en
 *   `process-group-marker-open` y `process-group-marker-closed`.
 * - Gráficos: la sección `process-group-charts`; cada uno en un `process-group-chart-panel` con
 *   `data-kind` (cpu, memory, network y cpu-instances, en ese orden) y su título en un
 *   encabezado; dentro, el `Chart` con testid `process-group-chart-<kind>` (con `data-series`).
 *   La franja, `process-group-problem-band`, en el panel de la CPU; cada tramo,
 *   `process-group-problem-segment` con `data-problem-id`.
 * - Tabla: la tarjeta `process-group-instances`, con el `DataGrid` `process-group-instances-grid`
 *   (columnas name, host, cpu y memory, en ese orden) y filas `process-group-instance-row` con
 *   `data-instance-id`; la barra de CPU, `process-group-instance-cpu-bar`. El nombre de la
 *   instancia y el de su host son enlaces a su página. Con `partial`, el aviso
 *   `process-group-instances-partial`.
 * - «Información»: `process-group-info`, con `process-group-info-row` (`data-key`: al menos
 *   technologies, listenPorts y detectedName), `process-group-info-value`,
 *   `process-group-info-chip`, `process-group-info-relations`, `process-group-info-group`
 *   (`data-group`: instances, hosts, services y other), `-group-toggle`, `-group-count`,
 *   `-entity` (`data-entity-id`), `-names`, `-entity-name` y `-properties-toggle`.
 *
 * Formato, como el proceso (0028): CPU en % con un decimal; memoria en MB; red en bits por segundo
 * (bytes/s × 8). Los marcadores enseñan los `totals` del canal: la CPU, la media del total del
 * grupo (la suma de sus instancias, 64,5 %) y debajo la máxima (112,5 %).
 *
 * «CPU por instancia»: la ficha no dice de dónde salen las series; el simulador las da de dos
 * formas (decisión del test-writer): en entities:processGroupMetrics, una expresión de
 * `cpu.usage` partida por `dt.entity.process_group_instance` (de más a menos CPU, con
 * `:limit(N)` si se pide), o en entities:processMetrics de cada instancia. Los tests solo miran el
 * gráfico: una serie por instancia, las cinco de más CPU, con su nombre.
 */
const PG_PAGE_TEST_ID = 'entity-page-process_group'
type PgChartKind = 'cpu' | 'memory' | 'network' | 'cpu-instances'
const PG_METRIC_MARKERS = ['instances', 'cpu', 'memory', 'network'] as const
const PG_MARKER_LABELS: Record<string, string> = {
  instances: 'Instancias',
  cpu: 'CPU',
  memory: 'Memoria',
  network: 'Red',
  problems: 'Problemas'
}
const PG_CHART_KINDS: PgChartKind[] = ['cpu', 'memory', 'network', 'cpu-instances']
const PG_CHART_TITLES: Record<PgChartKind, string> = {
  cpu: 'CPU',
  memory: 'Memoria',
  network: 'Red',
  'cpu-instances': 'CPU por instancia'
}
const PG_INSTANCE_COLUMNS = ['name', 'host', 'cpu', 'memory'] as const
/** Las cinco instancias de más CPU, las del gráfico «CPU por instancia». */
const PG_TOP_FIVE = PROCESS_GROUP_PAGE_BY_CPU.slice(0, 5)

const pgPage = (): Locator => page.getByTestId(PG_PAGE_TEST_ID)
const pgMarker = (id: string): Locator => pgPage().getByTestId(`process-group-marker-${id}`)
const pgChartPanel = (kind: PgChartKind): Locator =>
  pgPage().locator(`[data-testid="process-group-chart-panel"][data-kind="${kind}"]`)
const pgChartPlot = (kind: PgChartKind): Locator =>
  pgChartPanel(kind).getByTestId(`process-group-chart-${kind}`)
const pgBand = (): Locator => pgChartPanel('cpu').getByTestId('process-group-problem-band')
const pgSegment = (problemId: string): Locator =>
  pgBand().locator(`[data-testid="process-group-problem-segment"][data-problem-id="${problemId}"]`)
const pgInstances = (): Locator => pgPage().getByTestId('process-group-instances')
const pgInstanceRow = (id: string): Locator =>
  pgInstances().locator(`[data-testid="process-group-instance-row"][data-instance-id="${id}"]`)
const pgInfoCard = (): Locator => pgPage().getByTestId('process-group-info')
const pgInfoRow = (key: string): Locator =>
  pgInfoCard().locator(`[data-testid="process-group-info-row"][data-key="${key}"]`)
const pgInfoValue = (key: string): Locator => pgInfoRow(key).getByTestId('process-group-info-value')
const pgInfoGroup = (key: string): Locator =>
  pgInfoCard().locator(`[data-testid="process-group-info-group"][data-group="${key}"]`)
const pgInfoEntity = (group: string, id: string): Locator =>
  pgInfoGroup(group).locator(`[data-testid="process-group-info-entity"][data-entity-id="${id}"]`)

/** Ficha 0032: abre por URL la página del process group de la ficha. */
async function openProcessGroupPage(): Promise<Locator> {
  await goToRoute(`/entities/PROCESS_GROUP/${PROCESS_GROUP_PAGE_ID}`)
  const entityPage = pgPage()
  await expect(entityPage).toBeVisible()
  return entityPage
}

/** Ficha 0032: espera a que el gráfico tenga sus series y las devuelve. */
async function pgChartSeries(kind: PgChartKind): Promise<string[]> {
  const plot = pgChartPlot(kind)
  await expect(plot.locator('canvas').first()).toBeVisible()
  await expect(plot).toHaveAttribute('data-series', /\[.+\]/)
  return JSON.parse((await plot.getAttribute('data-series')) ?? '[]') as string[]
}

/** Ficha 0032: los `data-kind` de los paneles de gráficos, en el orden en que se pintan. */
async function pgChartKinds(): Promise<string[]> {
  return pgPage()
    .getByTestId('process-group-charts')
    .getByTestId('process-group-chart-panel')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-kind') ?? ''))
}

/** Ficha 0032: las series de los cuatro gráficos, con sus nombres. */
async function expectPgChartSeries(): Promise<void> {
  expect(await pgChartSeries('cpu'), 'cpu').toHaveLength(1)
  expect(await pgChartSeries('memory'), 'memory').toHaveLength(1)
  const network = await pgChartSeries('network')
  expect(network, 'network').toHaveLength(2)
  expect(network[0]).toMatch(/entrada/i)
  expect(network[1]).toMatch(/salida/i)
  // Una línea por instancia: las cinco de más CPU (de siete), con su nombre.
  const instances = await pgChartSeries('cpu-instances')
  expect(instances, 'cpu-instances').toHaveLength(5)
  expect(instances.slice().sort()).toEqual(PG_TOP_FIVE.map((instance) => instance.name).sort())
}

/** Ficha 0032: los marcadores con los valores del simulador, ya formateados (es). */
async function expectPgMarkers(): Promise<void> {
  // Instancias: siete.
  await expect(pgMarker('instances').getByTestId('process-group-marker-value')).toHaveText(
    /^\s*7\s*$/
  )
  // CPU: media del total 64,5 % y, debajo, la máxima de la serie, 112,5 %; normal, sin texto.
  const cpu = pgMarker('cpu')
  await expect(cpu.getByTestId('process-group-marker-value')).toHaveText(/^64,5\s?%$/)
  await expect(cpu.getByTestId('process-group-marker-secondary')).toContainText(
    /(^|[^\d.,])112,5\s?%/
  )
  await expect(cpu.getByTestId('process-group-marker-value')).toHaveAttribute(
    'data-level',
    'normal'
  )
  // Memoria: media del total, 925 MB.
  await expect(pgMarker('memory').getByTestId('process-group-marker-value')).toHaveText(
    /^925(,0)?\sMB$/
  )
  // Red: entrada 5120 B/s y salida 768 B/s, en bits por segundo (40 960 y 6144 bit/s).
  const network = pgMarker('network')
  await expect(network.getByTestId('process-group-marker-value')).toHaveText(/^41(,0)?\skbit\/s$/)
  await expect(network.getByTestId('process-group-marker-secondary')).toContainText(
    /(^|[^\d.,])6,1\skbit\/s/
  )
  // Problemas: uno abierto y uno cerrado.
  await expect(pgMarker('problems').getByTestId('process-group-marker-open')).toHaveText(
    loneNumber('1')
  )
  await expect(pgMarker('problems').getByTestId('process-group-marker-closed')).toHaveText(
    loneNumber('1')
  )
}

/** Ficha 0032: la CPU de una instancia en la tabla (es): 41,5 %; las enteras, con o sin «,0». */
const cpuText = (cpu: number): RegExp =>
  Number.isInteger(cpu)
    ? new RegExp(`(^|[^\\d,.])${cpu}(,0)?\\s?%`)
    : new RegExp(`(^|[^\\d,.])${String(cpu).replace('.', ',')}\\s?%`)

/** Ficha 0032: los ids de las filas de la tabla de instancias, en el orden en que se pintan. */
const pgInstanceOrder = (): Promise<string[]> =>
  tableOrder(pgInstances(), 'process-group-instance-row', 'data-instance-id')

/** Ficha 0032: ni la línea de comandos ni la ruta completa del grupo, en ningún sitio. */
async function expectNoProcessGroupSecrets(where: string): Promise<void> {
  const html = await page.content()
  const text = await page.locator('body').innerText()
  for (const part of PROCESS_GROUP_INFO_SECRET_PARTS) {
    expect(html, `${where}: HTML con «${part}»`).not.toContain(part)
    expect(text, `${where}: texto con «${part}»`).not.toContain(part)
  }
}

/** Ficha 0032: despliega un grupo de relaciones del process group (si no lo está). */
async function expandPgInfoGroup(key: string): Promise<Locator> {
  const group = pgInfoGroup(key)
  const toggle = group.getByTestId('process-group-info-group-toggle')
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await clickInPlace(toggle, { scroll: true })
  }
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  return group
}

test('CA1 (0032): la página de un process group enseña sus marcadores, sus cuatro gráficos y la tabla de instancias con los valores del simulador, sin «Página en construcción»', async () => {
  const entityPage = await openProcessGroupPage()

  // Cinco marcadores: instancias, CPU, memoria, red y problemas, con su nombre y sus valores.
  const row = entityPage.getByTestId('process-group-markers')
  await expect(row).toBeVisible()
  for (const id of [...PG_METRIC_MARKERS, 'problems']) {
    await expect(row.getByTestId(`process-group-marker-${id}`), id).toBeVisible()
    await expect(row.getByTestId(`process-group-marker-${id}`), id).toContainText(
      PG_MARKER_LABELS[id] ?? id
    )
  }
  await expectPgMarkers()

  // Cuatro gráficos en su orden: CPU, memoria, red y CPU por instancia.
  const section = entityPage.getByTestId('process-group-charts')
  await expect(section).toBeVisible()
  const panels = section.getByTestId('process-group-chart-panel')
  await expect(panels).toHaveCount(4)
  expect(await pgChartKinds()).toEqual(PG_CHART_KINDS)
  for (const [index, kind] of PG_CHART_KINDS.entries()) {
    await expect(panels.nth(index).getByRole('heading').first(), kind).toContainText(
      PG_CHART_TITLES[kind]
    )
  }
  await expectPgChartSeries()

  // Tabla «Instancias»: las siete, de más a menos CPU, con nombre, host, CPU (con barra) y memoria.
  const card = pgInstances()
  await expect(card).toBeVisible()
  await expect(card).toContainText('Instancias')
  const grid = card.getByTestId('process-group-instances-grid')
  await expect(grid).toHaveAttribute('role', 'grid')
  expect(await gridColumns(grid)).toEqual(PG_INSTANCE_COLUMNS.map((c) => `col-${c}`))
  await expect(card.getByTestId('process-group-instance-row')).toHaveCount(7)
  expect(await pgInstanceOrder()).toEqual(PROCESS_GROUP_PAGE_BY_CPU.map((i) => i.id))
  for (const instance of PROCESS_GROUP_PAGE_INSTANCES) {
    const cells = pgInstanceRow(instance.id).getByRole('gridcell')
    await expect(cells, instance.name).toHaveCount(PG_INSTANCE_COLUMNS.length)
    await expect(cells.nth(0), instance.name).toHaveText(instance.name)
    await expect(cells.nth(1), instance.name).toHaveText(instance.hostName)
    await expect(cells.nth(2), instance.name).toContainText(cpuText(instance.cpu))
    await expect(
      cells.nth(2).getByTestId('process-group-instance-cpu-bar'),
      instance.name
    ).toHaveCount(1)
    await expect(cells.nth(3), instance.name).toHaveText(
      new RegExp(`^${instance.memory / 1_000_000},0\\sMB$`)
    )
  }
  // Sin recorte, sin aviso.
  await expect(card.getByTestId('process-group-instances-partial')).toHaveCount(0)

  // Ni el bloque ni el texto de «Página en construcción», ni marcadores de otro tipo.
  await expect(entityPage.getByTestId('entity-under-construction')).toHaveCount(0)
  await expect(entityPage).not.toContainText('Página en construcción')
  for (const other of ['service-markers', 'host-markers', 'monitor-markers', 'process-markers']) {
    await expect(page.getByTestId(other), other).toHaveCount(0)
  }

  // Las consultas del canal, con el selector de las instancias del grupo y el rango global.
  await settledRequests()
  expect(sim.processGroupMetricQueries.length).toBeGreaterThanOrEqual(2)
  for (const query of sim.processGroupMetricQueries) {
    expect(query.get('entitySelector')).toBe(PROCESS_GROUP_PAGE_SELECTOR)
    expect(query.get('from')).toBe('now-2h')
  }
})

test('CA1 (0032), nota del Orquestador: con las instancias recortadas (partial), la tabla avisa del recorte y el marcador «Instancias» no presenta el total como real', async () => {
  sim.processGroupTruncated = true
  // Ficha 0051 (nota del revisor de la 0050): con el total real de /entities, el marcador es
  // exacto aunque llegue `partial`; el «como mínimo» solo vale si no se sabe el total.
  sim.processGroupEntitiesFail = true
  await openProcessGroupPage()
  const card = pgInstances()
  await expect(card.getByTestId('process-group-instance-row').first()).toBeVisible()

  // El aviso, como el del desglose del host; las filas siguen.
  const notice = card.getByTestId('process-group-instances-partial')
  await expect(notice).toBeVisible()
  await expect(notice).toContainText(/incomplet|recort/i)
  await expect(card.getByTestId('process-group-instance-row')).toHaveCount(7)

  // «Instancias»: el número que llegó, pero no como total real («7+» o «como mínimo 7»).
  const marker = pgMarker('instances')
  await expect(marker).toContainText(loneNumber('7'))
  await expect(marker.getByTestId('process-group-marker-value')).not.toHaveText(/^\s*7\s*$/)
  await expect(marker).toContainText(/7\s*\+|mínimo|al menos/i)
})

test('CA2 (0032): pulsar una instancia abre su página de proceso y «Volver» regresa al grupo; pulsar su host abre la del host', async () => {
  await openProcessGroupPage()
  const target = PROCESS_GROUP_PAGE_BY_CPU[1]
  const id = target?.id ?? ''
  const name = target?.name ?? ''
  const hostId = target?.hostId ?? ''
  const hostName = target?.hostName ?? ''
  const row = pgInstanceRow(id)
  await expect(row).toBeVisible()

  // La instancia: enlace a su página de proceso.
  const link = row.getByRole('link', { name })
  await expect(link).toHaveAttribute('href', new RegExp(`#/entities/PROCESS_GROUP_INSTANCE/${id}$`))
  await clickInPlace(link, { scroll: true })
  const processEntityPage = page.getByTestId('entity-page-process_group_instance')
  await expect(processEntityPage).toBeVisible()
  expect(await currentRoute()).toBe(`/entities/PROCESS_GROUP_INSTANCE/${id}`)
  await expect(processEntityPage.getByTestId('entity-page-id')).toHaveText(id)

  // «Volver» regresa al grupo, con su tabla.
  await clickInPlace(processEntityPage.getByTestId('entity-back'), { scroll: true })
  await expect(pgPage()).toBeVisible()
  expect(await currentRoute()).toBe(`/entities/PROCESS_GROUP/${PROCESS_GROUP_PAGE_ID}`)
  await expect(pgInstanceRow(id)).toBeVisible()

  // Su host: enlace a la página del host.
  const hostLink = pgInstanceRow(id).getByRole('link', { name: hostName })
  await expect(hostLink).toHaveAttribute('href', new RegExp(`#/entities/HOST/${hostId}$`))
  await clickInPlace(hostLink, { scroll: true })
  const hostEntityPage = page.getByTestId('entity-page-host')
  await expect(hostEntityPage).toBeVisible()
  expect(await currentRoute()).toBe(`/entities/HOST/${hostId}`)
  await expect(hostEntityPage.getByTestId('entity-page-id')).toHaveText(hostId)
})

test('CA3 (0032): la franja de problemas sale sobre el gráfico de CPU con los problemas del grupo, y pulsar un tramo abre el problema', async () => {
  await openProcessGroupPage()
  await pgChartSeries('cpu')
  const band = pgBand()
  await expect(band).toBeVisible()
  await expect(band.getByTestId('process-group-problem-segment')).toHaveCount(2)
  for (const { problemId } of [PROCESS_GROUP_BAND_OPEN, PROCESS_GROUP_BAND_CLOSED]) {
    await expect(pgSegment(problemId), problemId).toHaveCount(1)
  }
  // Solo en el panel de la CPU.
  await expect(page.getByTestId('process-group-problem-band')).toHaveCount(1)

  // La lista se pide con el grupo y el rango global.
  await settledRequests()
  const lists = sim.entityProblemListQueries.filter((query) =>
    (query.get('problemSelector') ?? '').includes(PROCESS_GROUP_PAGE_ID)
  )
  expect(lists).toHaveLength(1)
  expect(lists[0]?.get('problemSelector')).toBe(`affectedEntities("${PROCESS_GROUP_PAGE_ID}")`)
  expect(lists[0]?.get('from')).toBe('now-2h')

  // Encima del gráfico: la franja acaba antes de que empiece el canvas.
  const bandBox = await settledBox(band)
  const plotBox = await settledBox(pgChartPlot('cpu'))
  expect(bandBox.y + bandBox.height).toBeLessThanOrEqual(plotBox.y + 1)

  // Pulsar un tramo abre ese problema; «Volver» regresa al grupo.
  await clickInPlace(pgSegment(PROCESS_GROUP_BAND_CLOSED.problemId), { scroll: true })
  await expect(page.getByTestId('problem-page')).toBeVisible()
  await expect(page.getByTestId('problem-page-title')).toContainText(
    PROCESS_GROUP_BAND_CLOSED.displayId
  )
  expect(await currentRoute()).toBe(`/problems/${PROCESS_GROUP_BAND_CLOSED.problemId}`)
  await page.getByTestId('problem-back').click()
  await expect(pgPage()).toBeVisible()
  expect(await currentRoute()).toBe(`/entities/PROCESS_GROUP/${PROCESS_GROUP_PAGE_ID}`)
})

/**
 * Ficha 0032, CA4 (unitario): en `src/main/ipc/handlers/entity-detail.test.ts`. Este e2e es el
 * CA5: la tarjeta, la última, y nada de la línea de comandos en la página.
 */
test('CA5 (0032): la tarjeta «Información» del process group sale la última, con sus filas y relaciones, y sin la línea de comandos ni la ruta completa en ningún sitio de la página', async () => {
  const entityPage = await openProcessGroupPage()
  const card = pgInfoCard()
  await expect(card).toBeVisible()
  await expect(card).toContainText('Información')
  await expect(card.getByTestId('process-group-info-row').first()).toBeVisible()
  for (const id of ['process-group-markers', 'process-group-charts', 'process-group-instances']) {
    await expect(entityPage.getByTestId(id), id).toBeVisible()
  }

  // La última sección: nada visible detrás; gráficos e instancias, encima.
  expect(await visibleNeighbours(PG_PAGE_TEST_ID, 'process-group-info', 'after')).toEqual([])
  const infoBox = await settledBox(card)
  for (const id of ['process-group-markers', 'process-group-charts', 'process-group-instances']) {
    const box = await settledBox(entityPage.getByTestId(id))
    expect(box.y + box.height, `${id} encima de «Información»`).toBeLessThanOrEqual(infoBox.y + 1)
  }

  // Filas con las claves vistas en vivo: tecnologías, puertos y nombre detectado.
  await expect(pgInfoRow('technologies').getByTestId('process-group-info-chip')).toHaveText([
    'JAVA OpenJDK 21.0.1',
    'APACHE_TOMCAT 10.1'
  ])
  await expect(pgInfoValue('listenPorts')).toContainText(loneNumber('9090'))
  await expect(pgInfoValue('listenPorts')).toContainText(loneNumber('9443'))
  await expect(pgInfoValue('detectedName')).toContainText('pagos-grupo-detectado-e2e')
  for (const text of ['undefined', 'null', 'NaN', '[object Object]']) {
    await expect(card, text).not.toContainText(text)
  }

  // Relaciones: Instancias, Hosts, Servicios y Otras.
  const relations = card.getByTestId('process-group-info-relations')
  const groups = relations.getByTestId('process-group-info-group')
  await expect(groups).toHaveCount(4)
  expect(await dataKeys(groups, 'data-group')).toEqual(['instances', 'hosts', 'services', 'other'])
  for (const [key, title, count] of [
    ['instances', 'Instancias', '7'],
    ['hosts', 'Hosts', '3'],
    ['services', 'Servicios', '2'],
    ['other', 'Otras', '1']
  ] as const) {
    await expect(pgInfoGroup(key), key).toContainText(title)
    await expect(pgInfoGroup(key).getByTestId('process-group-info-group-count'), key).toHaveText(
      new RegExp(`^\\s*${count}\\s*$`)
    )
  }

  // «Ver nombres» de los hosts: una llamada con sus tres ids y los nombres en su sitio.
  const hosts = await expandPgInfoGroup('hosts')
  await settledRequests()
  const namesBefore = sim.entityNamesQueries.length
  await clickInPlace(hosts.getByTestId('process-group-info-names'), { scroll: true })
  await expect.poll(() => sim.entityNamesQueries.length).toBe(namesBefore + 1)
  const selector = sim.entityNamesQueries[namesBefore]?.get('entitySelector') ?? ''
  for (const host of PROCESS_GROUP_PAGE_HOSTS) {
    expect(selector).toContain(host.hostId)
    await expect(
      pgInfoEntity('hosts', host.hostId).getByTestId('process-group-info-entity-name')
    ).toHaveText(host.hostName)
  }

  // Enlaces: una instancia a su página de proceso y un servicio a la suya.
  await expandPgInfoGroup('instances')
  const instance = PROCESS_GROUP_PAGE_INSTANCES[0]?.id ?? ''
  await expect(pgInfoEntity('instances', instance)).toHaveAttribute(
    'href',
    new RegExp(`#/entities/PROCESS_GROUP_INSTANCE/${instance}$`)
  )
  await expandPgInfoGroup('services')
  await expect(pgInfoEntity('services', INFO_FEW_ID)).toHaveAttribute(
    'href',
    new RegExp(`#/entities/SERVICE/${INFO_FEW_ID}$`)
  )
  const other = await expandPgInfoGroup('other')
  await expect(other).toContainText('isNetworkClientOfProcessGroup')

  // «Todas las propiedades», desplegada: metadata sin la línea de comandos ni la ruta.
  await clickInPlace(card.getByTestId('process-group-info-properties-toggle'), { scroll: true })
  await expect(
    card.locator('[data-testid="process-group-info-property"][data-key="metadata"]')
  ).toContainText('pagos-grupo-e2e')

  // Con todo desplegado: ni la línea de comandos ni la ruta completa en ningún sitio.
  await expectNoProcessGroupSecrets('todo desplegado')
})

test('CA6 (0032): cambiar el rango global vuelve a pedir los datos; «Actualizar» también; volver a la página sin cambios, no', async () => {
  await openProcessGroupPage()
  await expectPgMarkers()
  await expectPgChartSeries()
  await settledRequests()
  // Al entrar: las consultas del grupo y los recuentos de problemas, con el rango global.
  const groupQueries = sim.processGroupMetricQueries.length
  const instanceQueries = sim.processMetricQueries.length
  expect(groupQueries).toBeGreaterThanOrEqual(2)
  expect(sim.entityProblemQueries).toHaveLength(2)
  for (const query of [
    ...sim.processGroupMetricQueries,
    ...sim.processMetricQueries,
    ...sim.entityProblemQueries
  ]) {
    expect(query.get('from')).toBe('now-2h')
  }

  // Rango nuevo: otra vez, con now-24h.
  await page.getByTestId('time-range-24h').click()
  await expect.poll(() => sim.processGroupMetricQueries.length).toBe(groupQueries * 2)
  await expect.poll(() => sim.processMetricQueries.length).toBe(instanceQueries * 2)
  await expect.poll(() => sim.entityProblemQueries.length).toBe(4)
  for (const query of [
    ...sim.processGroupMetricQueries.slice(groupQueries),
    ...sim.processMetricQueries.slice(instanceQueries),
    ...sim.entityProblemQueries.slice(2)
  ]) {
    expect(query.get('from')).toBe('now-24h')
  }
  await expectPgMarkers()

  // Fuera y vuelta, sin cambiar nada: ninguna petición nueva.
  await goTo('metrics')
  await expect(pgPage()).toHaveCount(0)
  const before = await settledRequests()
  await openProcessGroupPage()
  await expectPgMarkers()
  await page.waitForTimeout(1500)
  expect(sim.requests.slice(before), 'peticiones al volver a la página').toEqual([])

  // «Actualizar», en la cabecera de la página: otra vez, con el rango actual.
  await pgPage().getByTestId('module-refresh').click()
  await expect.poll(() => sim.processGroupMetricQueries.length).toBe(groupQueries * 3)
  await expect.poll(() => sim.entityProblemQueries.length).toBe(6)
  for (const query of [
    ...sim.processGroupMetricQueries.slice(groupQueries * 2),
    ...sim.entityProblemQueries.slice(4)
  ]) {
    expect(query.get('from')).toBe('now-24h')
  }
  await expectPgMarkers()
})

test('CA6 (0032): si falla el canal de métricas, sus marcadores, cada gráfico y la tabla enseñan el aviso con Reintentar y el marcador de problemas sigue', async () => {
  sim.processGroupMetricsFail = true
  await openProcessGroupPage()

  // El de problemas, con sus recuentos y sin aviso.
  await expect(pgMarker('problems').getByTestId('process-group-marker-open')).toHaveText(
    loneNumber('1')
  )
  await expect(pgMarker('problems').getByRole('button', { name: 'Reintentar' })).toHaveCount(0)

  // Cada marcador de métricas, en su sitio, con el aviso y Reintentar y sin valor.
  for (const id of PG_METRIC_MARKERS) {
    const marker = pgMarker(id)
    await expect(marker, id).toBeVisible()
    await expect(marker.getByRole('alert').first(), id).toBeVisible()
    await expect(marker.getByRole('button', { name: 'Reintentar' }), id).toBeVisible()
    await expect(marker.getByTestId('process-group-marker-value'), id).toHaveCount(0)
  }
  // Cada gráfico, con su aviso y Reintentar, sin gráfico.
  for (const kind of PG_CHART_KINDS) {
    const panel = pgChartPanel(kind)
    await expect(panel, kind).toBeVisible()
    await expect(panel.getByRole('alert').first(), kind).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Reintentar' }), kind).toBeVisible()
    await expect(panel.getByTestId(`process-group-chart-${kind}`), kind).toHaveCount(0)
  }
  // La tabla de instancias, también, sin filas.
  await expect(pgInstances().getByRole('alert').first()).toBeVisible()
  await expect(pgInstances().getByRole('button', { name: 'Reintentar' })).toBeVisible()
  await expect(pgInstances().getByTestId('process-group-instance-row')).toHaveCount(0)

  // Reintentar, con el canal ya bien: llegan valores, los cuatro gráficos y la tabla.
  sim.processGroupMetricsFail = false
  await clickInPlace(pgMarker('cpu').getByRole('button', { name: 'Reintentar' }), {
    scroll: true
  })
  await expectPgMarkers()
  await expect(pgPage().getByTestId('process-group-chart-panel')).toHaveCount(4)
  await expectPgChartSeries()
  await expect(pgInstances().getByTestId('process-group-instance-row')).toHaveCount(7)
  for (const id of PG_METRIC_MARKERS) {
    await expect(pgMarker(id).getByRole('button', { name: 'Reintentar' }), id).toHaveCount(0)
  }
})

// ---------------------------------------------------------------------------
// Ficha 0051: las 20 de más CPU en la tabla «Instancias», el aviso «20 de N» y el modal
// «Ver todas» con la lista completa (canal entities:processGroupInstances, a demanda).
// ---------------------------------------------------------------------------

/**
 * Grupos inventados de la 0050 (PROCESS_GROUP_MANY_ID, 30 instancias; PROCESS_GROUP_CUT_ID, 25
 * que llegan recortadas de 600) y el de 12 de esta ficha (PROCESS_GROUP_FEW_ID).
 *
 * Nombres que fijan estos tests (la ficha no los da; decisión del developer en una ficha ligera,
 * delegada por Dani y refinable):
 * - Debajo de la tabla, el aviso `process-group-instances-more` (role="status") y el botón
 *   `process-group-instances-all` («Ver todas»).
 * - El modal: `process-group-instances-dialog` (el role="dialog" de Radix, con `data-state`),
 *   su fondo `process-group-instances-dialog-overlay`, el buscador
 *   `process-group-instances-dialog-search`, el aviso de recorte
 *   `process-group-instances-dialog-truncated` y la tabla `process-group-instances-dialog-grid`
 *   con las mismas filas (`process-group-instance-row` con `data-instance-id`) y columnas.
 * - La consulta del modal se reconoce en el simulador por la expresión de CPU con
 *   `:sort(value(avg,descending))` y sin `:limit` (la de la 0050).
 */
const pgDialog = (): Locator => page.getByTestId('process-group-instances-dialog')
const pgViewAll = (): Locator => pgInstances().getByTestId('process-group-instances-all')
const pgMore = (): Locator => pgInstances().getByTestId('process-group-instances-more')
const pgDialogRows = (): Locator => pgDialog().getByTestId('process-group-instance-row')
const pgDialogOrder = (): Promise<string[]> =>
  tableOrder(pgDialog(), 'process-group-instance-row', 'data-instance-id')

/** Ficha 0051: las consultas de la lista completa (entities:processGroupInstances). */
const pgFullListQueries = (): URLSearchParams[] =>
  sim.processGroupMetricQueries.filter((query) => {
    const selector = query.get('metricSelector') ?? ''
    return (
      query.get('resolution') === 'Inf' &&
      selector.includes(':sort(value(avg,descending))') &&
      !selector.includes(':limit(')
    )
  })

/** Ficha 0051: abre por URL la página de un process group inventado y espera sus filas. */
async function openPgGroup(groupId: string): Promise<void> {
  await goToRoute(`/entities/PROCESS_GROUP/${groupId}`)
  await expect(pgPage()).toBeVisible()
  await expect(pgInstances().getByTestId('process-group-instance-row').first()).toBeVisible()
}

/** Ficha 0051: pulsa «Ver todas» y espera el modal abierto con sus filas. */
async function openPgDialog(): Promise<Locator> {
  await clickInPlace(pgViewAll(), { scroll: true })
  const dialog = pgDialog()
  await expect(dialog).toBeVisible()
  await expect(dialog).toHaveAttribute('role', 'dialog')
  await expect(dialog).toHaveAttribute('data-state', 'open')
  await expect(pgDialogRows().first()).toBeVisible()
  return dialog
}

/** Ficha 0051: animación de entrada de un elemento (nombre, duración, curva y fotogramas). */
async function entranceMotion(target: Locator): Promise<{
  name: string
  duration: number
  timing: string
  keyframes: string
}> {
  return target.evaluate((el) => {
    const style = getComputedStyle(el)
    const name = style.animationName
    const names = name.split(',').map((n) => n.trim())
    const seconds = (value: string): number =>
      Math.max(
        0,
        ...value.split(',').map((part) => {
          const v = part.trim()
          return v.endsWith('ms') ? parseFloat(v) / 1000 : parseFloat(v)
        })
      )
    const texts: string[] = []
    const visit = (rules: CSSRuleList): void => {
      for (const rule of Array.from(rules)) {
        if (rule instanceof CSSKeyframesRule) {
          if (names.includes(rule.name)) texts.push(rule.cssText)
        } else if ('cssRules' in rule) {
          visit((rule as CSSGroupingRule).cssRules)
        }
      }
    }
    for (const sheet of Array.from(document.styleSheets)) visit(sheet.cssRules)
    return {
      name,
      duration: seconds(style.animationDuration),
      timing: style.animationTimingFunction,
      keyframes: texts.join('\n')
    }
  })
}

test('CA1 (0051): con 30 instancias la tabla enseña las 20 de más CPU y el aviso «20 de 30» con «Ver todas»; con 12, ni aviso ni botón; sin el total real, «puede haber más»', async () => {
  await openPgGroup(PROCESS_GROUP_MANY_ID)
  const card = pgInstances()
  await expect(card.getByTestId('process-group-instance-row')).toHaveCount(20)
  expect(await pgInstanceOrder()).toEqual(
    byCpu(PROCESS_GROUP_MANY_INSTANCES)
      .slice(0, 20)
      .map((instance) => instance.id)
  )
  await expect(pgMore()).toBeVisible()
  await expect(pgMore()).toHaveAttribute('role', 'status')
  await expect(pgMore()).toContainText(/(^|[^\d.,])20 de 30([^\d.,]|$)/)
  await expect(pgMore()).toContainText(/más CPU/)
  await expect(pgViewAll()).toBeVisible()
  await expect(pgViewAll()).toHaveText(/^\s*Ver todas\s*$/)
  // El total real, exacto en el marcador (de /entities), sin «como mínimo».
  await expect(pgMarker('instances').getByTestId('process-group-marker-value')).toHaveText(
    /^\s*30\s*$/
  )

  // Con 12 instancias: las 12, ni aviso ni botón.
  await openPgGroup(PROCESS_GROUP_FEW_ID)
  await expect(pgInstances().getByTestId('process-group-instance-row')).toHaveCount(12)
  await expect(pgMore()).toHaveCount(0)
  await expect(pgViewAll()).toHaveCount(0)

  // Sin el total real (403 en /entities): «20 instancias…; puede haber más» y el botón.
  await resetState()
  sim.processGroupEntitiesFail = true
  await openPgGroup(PROCESS_GROUP_MANY_ID)
  await expect(pgInstances().getByTestId('process-group-instance-row')).toHaveCount(20)
  await expect(pgMore()).toContainText(/(^|[^\d.,])20 instancias/)
  await expect(pgMore()).toContainText(/puede haber más/)
  await expect(pgMore()).not.toContainText(/ de 30/)
  await expect(pgViewAll()).toBeVisible()
})

test('CA2 (0051): «Ver todas» abre el modal con las 30 y pide entities:processGroupInstances una sola vez, no antes de pulsar ni al volver a abrirlo', async () => {
  await openPgGroup(PROCESS_GROUP_MANY_ID)
  await settledRequests()
  // La página no pide la lista completa.
  expect(pgFullListQueries()).toHaveLength(0)

  const dialog = await openPgDialog()
  await expect(dialog.getByRole('heading')).toContainText(`Instancias de ${PROCESS_GROUP_MANY_ID}`)
  await expect(pgDialogRows()).toHaveCount(30)
  expect(await pgDialogOrder()).toEqual(
    byCpu(PROCESS_GROUP_MANY_INSTANCES).map((instance) => instance.id)
  )
  // Mismas columnas que la tabla de la página.
  expect(await gridColumns(dialog.getByTestId('process-group-instances-dialog-grid'))).toEqual(
    PG_INSTANCE_COLUMNS.map((c) => `col-${c}`)
  )
  // Sin recorte, sin aviso.
  await expect(dialog.getByTestId('process-group-instances-dialog-truncated')).toHaveCount(0)
  await settledRequests()
  expect(pgFullListQueries()).toHaveLength(1)
  expect(pgFullListQueries()[0]?.get('entitySelector')).toBe(
    processGroupSelector(PROCESS_GROUP_MANY_ID)
  )
  expect(pgFullListQueries()[0]?.get('from')).toBe('now-2h')

  // Cerrar y volver a abrir: de la caché, sin pedir otra vez.
  await page.keyboard.press('Escape')
  await expect(pgDialog()).toHaveCount(0)
  await openPgDialog()
  await expect(pgDialogRows()).toHaveCount(30)
  await settledRequests()
  expect(pgFullListQueries()).toHaveLength(1)
})

test('CA3 (0051): con un grupo recortado, el modal avisa arriba del recorte con los números (25 de 600) y el marcador da el total real', async () => {
  await openPgGroup(PROCESS_GROUP_CUT_ID)
  // Con el total real de /entities, el marcador es exacto aunque llegue `partial`.
  await expect(pgMarker('instances').getByTestId('process-group-marker-value')).toHaveText(
    /^\s*600\s*$/
  )
  await expect(pgMore()).toContainText(/(^|[^\d.,])20 de 600([^\d.,]|$)/)

  const dialog = await openPgDialog()
  await expect(pgDialogRows()).toHaveCount(25)
  const notice = dialog.getByTestId('process-group-instances-dialog-truncated')
  await expect(notice).toBeVisible()
  await expect(notice).toContainText(/(^|[^\d.,])25 de 600([^\d.,]|$)/)
  await expect(notice).toContainText(loneNumber('498'))
  // Arriba: antes que la tabla.
  const noticeBox = await settledBox(notice)
  const gridBox = await settledBox(dialog.getByTestId('process-group-instances-dialog-grid'))
  expect(noticeBox.y + noticeBox.height).toBeLessThanOrEqual(gridBox.y + 1)
})

test('CA3 (0051), revisión ronda 1: con el grupo recortado y el total real, la tabla avisa de que la lista puede estar incompleta y el marcador da 600 exacto', async () => {
  await openPgGroup(PROCESS_GROUP_CUT_ID)
  // El marcador, exacto: el total sale de /entities aunque llegue `partial`.
  const marker = pgMarker('instances')
  await expect(marker.getByTestId('process-group-marker-value')).toHaveText(/^\s*600\s*$/)
  await expect(marker).not.toContainText(/\+|mínimo|al menos/i)
  // La tabla sí avisa del recorte: la lista puede estar incompleta, el total no.
  const notice = pgInstances().getByTestId('process-group-instances-partial')
  await expect(notice).toBeVisible()
  await expect(notice).toContainText(/recort/i)
  await expect(notice).toContainText(/lista puede estar incompleta/)
  await expect(notice).not.toContainText(/total/i)
})

test('CA2 (0051), revisión ronda 1: con el modal cerrado, ni un rango nuevo ni «Actualizar» piden la lista completa; al volver a abrirlo, sí', async () => {
  await openPgGroup(PROCESS_GROUP_MANY_ID)
  await openPgDialog()
  await settledRequests()
  expect(pgFullListQueries()).toHaveLength(1)
  await page.keyboard.press('Escape')
  await expect(pgDialog()).toHaveCount(0)

  // Rango nuevo con el modal cerrado: la página pide lo suyo, la lista completa no.
  const groupQueries = sim.processGroupMetricQueries.length
  await page.getByTestId('time-range-24h').click()
  await expect.poll(() => sim.processGroupMetricQueries.length).toBeGreaterThan(groupQueries)
  await settledRequests()
  expect(pgFullListQueries()).toHaveLength(1)
  // Al abrir, la del rango nuevo.
  await openPgDialog()
  await settledRequests()
  expect(pgFullListQueries()).toHaveLength(2)
  expect(pgFullListQueries()[1]?.get('from')).toBe('now-24h')
  await page.keyboard.press('Escape')
  await expect(pgDialog()).toHaveCount(0)

  // «Actualizar» con el modal cerrado: no la pide; al abrir, ya no vale la de antes.
  const beforeRefresh = sim.processGroupMetricQueries.length
  await clickInPlace(pgPage().getByTestId('module-refresh'), { scroll: true })
  await expect.poll(() => sim.processGroupMetricQueries.length).toBeGreaterThan(beforeRefresh)
  await settledRequests()
  expect(pgFullListQueries()).toHaveLength(2)
  await openPgDialog()
  await settledRequests()
  expect(pgFullListQueries()).toHaveLength(3)
})

test('Especificación (0051): si falla la lista completa, el modal enseña el aviso con Reintentar, y Reintentar la carga', async () => {
  sim.processGroupInstancesFail = true
  await openPgGroup(PROCESS_GROUP_MANY_ID)
  await clickInPlace(pgViewAll(), { scroll: true })
  const dialog = pgDialog()
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('alert').first()).toBeVisible()
  const retry = dialog.getByRole('button', { name: 'Reintentar' })
  await expect(retry).toBeVisible()
  await expect(pgDialogRows()).toHaveCount(0)
  // La tabla de la página sigue con sus 20.
  await expect(pgInstances().getByTestId('process-group-instance-row')).toHaveCount(20)

  sim.processGroupInstancesFail = false
  await clickInPlace(retry)
  await expect(pgDialogRows()).toHaveCount(30)
  await expect(dialog.getByRole('button', { name: 'Reintentar' })).toHaveCount(0)
})

test('CA4 (0051): en el modal, el buscador filtra por nombre o host, el orden por columna funciona, Escape y clic fuera cierran con el foco en «Ver todas», y pulsar un proceso abre su página', async () => {
  await openPgGroup(PROCESS_GROUP_MANY_ID)
  const dialog = await openPgDialog()
  const search = dialog.getByTestId('process-group-instances-dialog-search')

  // Por nombre.
  await search.fill('instancia-e2e7-25')
  await expect(pgDialogRows()).toHaveCount(1)
  expect(await pgDialogOrder()).toEqual([PROCESS_GROUP_MANY_INSTANCES[24]?.id])
  // Por host, sin distinguir mayúsculas.
  await search.fill('HOST-E2E7-7')
  await expect(pgDialogRows()).toHaveCount(1)
  expect(await pgDialogOrder()).toEqual([PROCESS_GROUP_MANY_INSTANCES[6]?.id])
  // Sin coincidencias, ninguna fila; vacío, las 30.
  await search.fill('no-existe-ninguna')
  await expect(pgDialogRows()).toHaveCount(0)
  await search.fill('')
  await expect(pgDialogRows()).toHaveCount(30)

  // Orden por nombre (ascendente, con los números en su orden) y por memoria.
  await clickInPlace(dialog.getByTestId('sort-name'))
  await expect
    .poll(async () => (await pgDialogOrder()).slice(0, 3))
    .toEqual(PROCESS_GROUP_MANY_INSTANCES.slice(0, 3).map((instance) => instance.id))
  await clickInPlace(dialog.getByTestId('sort-memory'))
  await expect
    .poll(async () => (await pgDialogOrder())[0])
    .toBe(PROCESS_GROUP_MANY_INSTANCES[29]?.id)

  // Escape cierra y el foco vuelve a «Ver todas».
  await page.keyboard.press('Escape')
  await expect(pgDialog()).toHaveCount(0)
  await expect(pgViewAll()).toBeFocused()

  // Clic fuera (en el fondo) también cierra.
  await openPgDialog()
  await expect(page.getByTestId('process-group-instances-dialog-overlay')).toBeVisible()
  const box = await settledBox(pgDialog())
  await page.mouse.click(Math.max(2, box.x / 2), box.y + box.height / 2)
  await expect(pgDialog()).toHaveCount(0)

  // Pulsar un proceso cierra el modal y abre su página; «Volver» regresa al grupo.
  await openPgDialog()
  const target = byCpu(PROCESS_GROUP_MANY_INSTANCES)[25]
  const id = target?.id ?? ''
  const row = pgDialog().locator(
    `[data-testid="process-group-instance-row"][data-instance-id="${id}"]`
  )
  const link = row.getByRole('link', { name: target?.name ?? '' })
  await expect(link).toHaveAttribute('href', new RegExp(`#/entities/PROCESS_GROUP_INSTANCE/${id}$`))
  await clickInPlace(link, { scroll: true })
  const processEntityPage = page.getByTestId('entity-page-process_group_instance')
  await expect(processEntityPage).toBeVisible()
  await expect(pgDialog()).toHaveCount(0)
  expect(await currentRoute()).toBe(`/entities/PROCESS_GROUP_INSTANCE/${id}`)
  await clickInPlace(processEntityPage.getByTestId('entity-back'), { scroll: true })
  await expect(pgPage()).toBeVisible()
  expect(await currentRoute()).toBe(`/entities/PROCESS_GROUP/${PROCESS_GROUP_MANY_ID}`)
  await expect(pgDialog()).toHaveCount(0)

  // El host de una instancia, desde el modal, abre la página del host.
  await openPgDialog()
  const hostLink = pgDialog()
    .locator(`[data-testid="process-group-instance-row"][data-instance-id="${id}"]`)
    .getByRole('link', { name: target?.hostName ?? '' })
  await expect(hostLink).toHaveAttribute(
    'href',
    new RegExp(`#/entities/HOST/${target?.hostId ?? ''}$`)
  )
  await clickInPlace(hostLink, { scroll: true })
  await expect(page.getByTestId('entity-page-host')).toBeVisible()
  await expect(pgDialog()).toHaveCount(0)
  expect(await currentRoute()).toBe(`/entities/HOST/${target?.hostId ?? ''}`)
})

test('CA5 (0051): el panel del modal entra con escala, desplazamiento y opacidad con rebote (unos 300 ms) y el fondo se desenfoca; con movimiento reducido, solo un fundido corto', async () => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  try {
    await openPgGroup(PROCESS_GROUP_MANY_ID)
    await openPgDialog()
    const panel = await entranceMotion(pgDialog())
    expect(panel.name, 'animación de entrada').not.toBe('none')
    expect(panel.duration).toBeGreaterThanOrEqual(0.2)
    expect(panel.duration).toBeLessThanOrEqual(0.5)
    expect(panel.keyframes).toMatch(/scale/)
    expect(panel.keyframes).toMatch(/translate/)
    expect(panel.keyframes).toMatch(/opacity/)
    // Curva con rebote: un cubic-bezier con un punto de control por encima de 1.
    const bezier = /cubic-bezier\(([^)]+)\)/.exec(panel.timing)
    expect(bezier, panel.timing).not.toBeNull()
    const [, y1, , y2] = (bezier?.[1] ?? '').split(',').map((v) => Number(v.trim()))
    expect(Math.max(y1 ?? 0, y2 ?? 0)).toBeGreaterThan(1)
    // El fondo se oscurece con desenfoque.
    const overlay = page.getByTestId('process-group-instances-dialog-overlay')
    expect(await overlay.evaluate((el) => getComputedStyle(el).backdropFilter)).toMatch(/blur/)
    expect((await entranceMotion(overlay)).name).not.toBe('none')
    await page.keyboard.press('Escape')
    await expect(pgDialog()).toHaveCount(0)

    // Con «reducir el movimiento»: solo un fundido corto, sin escala ni desplazamiento.
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await openPgDialog()
    const reduced = await entranceMotion(pgDialog())
    expect(reduced.name, 'fundido').not.toBe('none')
    expect(reduced.keyframes).toMatch(/opacity/)
    expect(reduced.keyframes).not.toMatch(/scale|translate/)
    expect(reduced.duration).toBeGreaterThan(0.01)
    expect(reduced.duration).toBeLessThanOrEqual(0.2)
  } finally {
    await page.emulateMedia({ reducedMotion: null })
  }
})

// ---------------------------------------------------------------------------
// Ficha 0034: página de una APPLICATION (marcadores, gráficos, acciones de usuario e
// «Información»).
// ---------------------------------------------------------------------------

/**
 * Página de la aplicación inventada de la ficha 0033 (APPLICATION_METRICS_ID), con el canal
 * entities:applicationMetrics (series APPLICATION_SERIES, totales APPLICATION_TOTALS y las tres
 * acciones de APPLICATION_ACTIONS), el canal entities:applicationRum de la 0052 (APPLICATION_RUM
 * y APPLICATION_RUM_ERRORS), sus problemas (applicationBandProblems: uno abierto y uno cerrado) y
 * entities:get (applicationInfoBody).
 *
 * Nombres que fijan estos tests (la ficha no los da; decisión del test-writer, delegada por Dani y
 * refinable), los del process group (0032) con el prefijo `application`:
 * - Marcadores (ficha 0053): la fila `application-markers`; cada marcador
 *   `application-marker-<id>` (apdex, users, sessions, actions, errors y problems, en ese orden);
 *   el valor principal en `application-marker-value`, con `data-level` en el Apdex
 *   (`apdexLevel` de `lib/application-format.ts`: success, warning o error) y en los errores
 *   (error si > 0); lo de debajo en `application-marker-secondary`; el texto de la categoría del
 *   Apdex, dentro del marcador; los recuentos de problemas en `application-marker-open` y
 *   `application-marker-closed`.
 * - Secciones (ficha 0053): cada una en un `application-section` con `data-section` (activity,
 *   errors, users, experience, apdex y key-actions, en ese orden, entre los marcadores e
 *   «Información») y su título en el primer encabezado. Ficha 0054: users («Usuarios y
 *   sesiones») y experience («Experiencia») van justo después de errors.
 * - Gráficos: cada uno en un `application-chart-panel` con `data-kind` y su título en un
 *   encabezado; dentro, el `Chart` con testid `application-chart-<kind>` (con `data-series`).
 *   «Actividad»: actionsByType y durationByType; «Errores»: errorsByType y affectedActions;
 *   «Apdex»: apdex. La franja, `application-problem-band`, en los paneles del Apdex y de la
 *   duración por tipo; cada tramo, `application-problem-segment` con `data-problem-id`. La nota
 *   de errores sin separar, `application-errors-note`, en el panel errorsByType.
 * - Tabla: la tarjeta `application-actions` (en la sección key-actions), con el `DataGrid`
 *   `application-actions-grid` (columnas name, count y duration, en ese orden; de más a menos
 *   acciones al entrar; botones `sort-<columna>`) y filas `application-action-row` con
 *   `data-action-id`; la barra de la duración, `application-action-duration-bar`. Sin acciones,
 *   el aviso `application-actions-empty` (en vivo la lista de acciones clave suele venir vacía).
 * - «Información»: `application-info`, con `application-info-row` (`data-key`: al menos
 *   applicationType, applicationInjectionType, customizedName y detectedName),
 *   `application-info-value`, `application-info-relations`, `application-info-group`
 *   (`data-group`: calls, synthetic y other), `-group-toggle`, `-group-count`, `-entity`
 *   (`data-entity-id`), `-names` y `-entity-name`.
 *
 * Formato, como el servicio: Apdex con dos decimales; recuentos con separador de miles;
 * duraciones con `formatDurationMs` (ms o s con un decimal); porcentajes con un decimal.
 *
 * Ficha 0053 (decisiones del test-writer, refinables): los marcadores de usuarios, sesiones,
 * acciones y errores salen del canal de RUM; el total de acciones y el de errores son la suma de
 * sus tipos (así cuadra con lo de debajo). Errores «sin separar»: el canal trae `javascript` y
 * `http` sin datos (total null) y los errores en `other`. Custom y «otros», solo si traen datos.
 */
const APP_PAGE_TEST_ID = 'entity-page-application'
type AppChartKind =
  | 'apdex'
  | 'actionsByType'
  | 'durationByType'
  | 'errorsByType'
  | 'affectedActions'
  | 'activeUsers'
  | 'sessions'
  | 'vitals'
type AppSection = 'activity' | 'errors' | 'users' | 'experience' | 'apdex' | 'key-actions'
const APP_MARKERS = ['apdex', 'users', 'sessions', 'actions', 'errors', 'problems'] as const
const APP_MARKER_LABELS: Record<string, string> = {
  apdex: 'Apdex',
  users: 'Usuarios activos',
  sessions: 'Sesiones',
  actions: 'Acciones',
  errors: 'Errores',
  problems: 'Problemas'
}
const APP_SECTIONS: AppSection[] = [
  'activity',
  'errors',
  'users',
  'experience',
  'apdex',
  'key-actions'
]
const APP_SECTION_TITLES: Record<AppSection, string> = {
  activity: 'Actividad',
  errors: 'Errores',
  users: 'Usuarios y sesiones',
  experience: 'Experiencia',
  apdex: 'Apdex',
  'key-actions': 'Acciones clave'
}
const APP_SECTION_CHARTS: Record<AppSection, AppChartKind[]> = {
  activity: ['actionsByType', 'durationByType'],
  errors: ['errorsByType', 'affectedActions'],
  users: ['activeUsers', 'sessions'],
  experience: ['vitals'],
  apdex: ['apdex'],
  'key-actions': []
}
const APP_CHART_TITLES: Record<AppChartKind, RegExp> = {
  apdex: /Apdex/,
  actionsByType: /Acciones por tipo/,
  durationByType: /Duración por tipo/,
  errorsByType: /Errores por tipo/,
  affectedActions: /Acciones afectadas por errores/,
  activeUsers: /Usuarios activos/,
  sessions: /Sesiones/,
  vitals: /Core Web Vitals|LCP|Experiencia/
}
/** Los nombres de las series por tipo (es): load, XHR, custom, JavaScript, HTTP y otros. */
const APP_SERIES = {
  load: /load|carga/i,
  xhr: /xhr/i,
  custom: /custom|personalizad/i,
  javascript: /javascript/i,
  http: /http/i
}
const APP_ACTION_COLUMNS = ['name', 'count', 'duration'] as const
/** Las acciones del simulador, de más a menos recuento (como las da el canal). */
const APP_ACTIONS_BY_COUNT = Object.values(APPLICATION_ACTIONS)
  .flat()
  .sort((a, b) => b.count - a.count)
/** La duración media de cada acción en la tabla (es). */
const APP_ACTION_DURATION: Record<string, RegExp> = {
  'APPLICATION_METHOD-00000000000E2E35': /(^|[^\d,.])321\sms/,
  'APPLICATION_METHOD-00000000000E2E34': /(^|[^\d,.])1,5\ss/,
  'APPLICATION_METHOD-00000000000E2E36': /(^|[^\d,.])410\sms/
}

const appPage = (): Locator => page.getByTestId(APP_PAGE_TEST_ID)
const appMarker = (id: string): Locator => appPage().getByTestId(`application-marker-${id}`)
const appMarkerValue = (id: string): Locator =>
  appMarker(id).getByTestId('application-marker-value')
const appMarkerSecondary = (id: string): Locator =>
  appMarker(id).getByTestId('application-marker-secondary')
const appSection = (id: AppSection): Locator =>
  appPage().locator(`[data-testid="application-section"][data-section="${id}"]`)
const appChartPanel = (kind: AppChartKind): Locator =>
  appPage().locator(`[data-testid="application-chart-panel"][data-kind="${kind}"]`)
const appChartPlot = (kind: AppChartKind): Locator =>
  appChartPanel(kind).getByTestId(`application-chart-${kind}`)
const appBand = (kind: AppChartKind = 'apdex'): Locator =>
  appChartPanel(kind).getByTestId('application-problem-band')
const appSegment = (problemId: string, kind: AppChartKind = 'apdex'): Locator =>
  appBand(kind).locator(
    `[data-testid="application-problem-segment"][data-problem-id="${problemId}"]`
  )
const appActions = (): Locator => appPage().getByTestId('application-actions')
const appActionRow = (id: string): Locator =>
  appActions().locator(`[data-testid="application-action-row"][data-action-id="${id}"]`)
const appInfoCard = (): Locator => appPage().getByTestId('application-info')
const appInfoRow = (key: string): Locator =>
  appInfoCard().locator(`[data-testid="application-info-row"][data-key="${key}"]`)
const appInfoValue = (key: string): Locator => appInfoRow(key).getByTestId('application-info-value')
const appInfoGroup = (key: string): Locator =>
  appInfoCard().locator(`[data-testid="application-info-group"][data-group="${key}"]`)
const appInfoEntity = (group: string, id: string): Locator =>
  appInfoGroup(group).locator(`[data-testid="application-info-entity"][data-entity-id="${id}"]`)

/** Ficha 0034: abre por URL la página de la aplicación de la ficha. */
async function openApplicationPage(): Promise<Locator> {
  await goToRoute(`/entities/APPLICATION/${APPLICATION_METRICS_ID}`)
  const entityPage = appPage()
  await expect(entityPage).toBeVisible()
  return entityPage
}

/** Ficha 0034: espera a que el gráfico tenga sus series y las devuelve. */
async function appChartSeries(kind: AppChartKind): Promise<string[]> {
  const plot = appChartPlot(kind)
  await expect(plot.locator('canvas').first(), kind).toBeVisible()
  await expect(plot, kind).toHaveAttribute('data-series', /\[.+\]/)
  return JSON.parse((await plot.getAttribute('data-series')) ?? '[]') as string[]
}

/** Ficha 0053: comprueba que el gráfico lleva exactamente esas series, en ese orden. */
async function expectAppChartSeries(kind: AppChartKind, patterns: RegExp[]): Promise<void> {
  const series = await appChartSeries(kind)
  expect(series, kind).toHaveLength(patterns.length)
  for (const [index, pattern] of patterns.entries()) {
    expect(series[index], `${kind}[${index}]`).toMatch(pattern)
  }
}

/** Los `data-kind` de los paneles de gráficos de la página (o de una sección), en su orden. */
async function appChartKinds(section?: AppSection): Promise<string[]> {
  const root = section === undefined ? appPage() : appSection(section)
  return root
    .getByTestId('application-chart-panel')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-kind') ?? ''))
}

/** Ficha 0053: los `data-section` de las secciones, en el orden en que se pintan. */
async function appSectionIds(): Promise<string[]> {
  return appPage()
    .getByTestId('application-section')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-section') ?? ''))
}

/** Ficha 0053: los marcadores de la fila (sus ids), en el orden en que se pintan. */
async function appMarkerIds(): Promise<string[]> {
  const known = APP_MARKERS.map((id) => `application-marker-${id}`)
  return appPage()
    .getByTestId('application-markers')
    .locator('[data-testid^="application-marker-"]')
    .evaluateAll(
      (els, ids) =>
        els
          .map((el) => el.getAttribute('data-testid') ?? '')
          .filter((testId) => ids.includes(testId))
          .map((testId) => testId.replace('application-marker-', '')),
      known
    )
}

/** Ficha 0034: los ids de las filas de la tabla de acciones, en el orden en que se pintan. */
const appActionOrder = (): Promise<string[]> =>
  tableOrder(appActions(), 'application-action-row', 'data-action-id')

/** Ficha 0034: despliega un grupo de relaciones de la aplicación (si no lo está). */
async function expandAppInfoGroup(key: string): Promise<Locator> {
  const group = appInfoGroup(key)
  const toggle = group.getByTestId('application-info-group-toggle')
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await clickInPlace(toggle, { scroll: true })
  }
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  return group
}

/** Ficha 0034: el marcador del Apdex con el valor del simulador (0,88, «Buena»). */
async function expectAppApdexMarker(): Promise<void> {
  // Apdex: 0,88 del rango, categoría «Buena» (≥ 0,85 y < 0,94), con su color.
  await expect(appMarkerValue('apdex')).toHaveText(/^\s*0,88\s*$/)
  await expect(appMarker('apdex')).toContainText('Buena')
  await expect(appMarkerValue('apdex')).toHaveAttribute('data-level', 'success')
}

/** Ficha 0053: usuarios activos, 1234 en el rango, con «estimado» debajo. */
async function expectAppUsersMarker(): Promise<void> {
  await expect(appMarkerValue('users')).toHaveText(loneNumber('1.234'))
  await expect(appMarkerSecondary('users')).toContainText(/estimad/i)
}

/** Ficha 0053: sesiones iniciadas (19); debajo, duración media (45,6 s) y rebote (28,4 %). */
async function expectAppSessionsMarker(): Promise<void> {
  await expect(appMarkerValue('sessions')).toHaveText(loneNumber('19'))
  const secondary = appMarkerSecondary('sessions')
  // 45 600 000 µs de media → 45,6 s.
  await expect(secondary).toContainText(/(^|[^\d,.])45,6\ss/)
  await expect(secondary).toContainText(/(^|[^\d,.])28,4\s?%/)
}

/** Ficha 0053: acciones, 9640 load + 21 400 XHR; sin custom (no trae datos). */
async function expectAppActionsMarker(): Promise<void> {
  await expect(appMarkerValue('actions')).toHaveText(loneNumber('31.040'))
  const secondary = appMarkerSecondary('actions')
  await expect(secondary).toContainText(APP_SERIES.load)
  await expect(secondary).toContainText(loneNumber('9.640'))
  await expect(secondary).toContainText(APP_SERIES.xhr)
  await expect(secondary).toContainText(loneNumber('21.400'))
  await expect(secondary).not.toContainText(APP_SERIES.custom)
}

/** Ficha 0053: errores, 5 de JavaScript + 9 HTTP, con el color de error. */
async function expectAppErrorsMarker(): Promise<void> {
  await expect(appMarkerValue('errors')).toHaveText(loneNumber('14'))
  await expect(appMarkerValue('errors')).toHaveAttribute('data-level', 'error')
  const secondary = appMarkerSecondary('errors')
  await expect(secondary).toContainText('JavaScript')
  await expect(secondary).toContainText(loneNumber('5'))
  await expect(secondary).toContainText('HTTP')
  await expect(secondary).toContainText(loneNumber('9'))
}

/** Ficha 0034: el marcador de problemas, uno abierto y uno cerrado. */
async function expectAppProblemsMarker(): Promise<void> {
  await expect(appMarker('problems').getByTestId('application-marker-open')).toHaveText(
    loneNumber('1')
  )
  await expect(appMarker('problems').getByTestId('application-marker-closed')).toHaveText(
    loneNumber('1')
  )
}

/** Ficha 0053: los seis marcadores con los valores del simulador. */
async function expectAppMarkers(): Promise<void> {
  await expectAppApdexMarker()
  await expectAppUsersMarker()
  await expectAppSessionsMarker()
  await expectAppActionsMarker()
  await expectAppErrorsMarker()
  await expectAppProblemsMarker()
}

/**
 * Ficha 0054: secciones «Usuarios y sesiones» y «Experiencia». Nombres que fijan estos tests (la
 * ficha no los da; decisión del test-writer, delegada por Dani y refinable):
 * - Gráficos, como los de la 0053 (`application-chart-panel` con `data-kind`): activeUsers
 *   (una serie de usuarios, con la nota de estimación `application-users-note` en el panel) y
 *   sessions (series iniciadas, terminadas y duración media, en ese orden); vitals (LCP, CLS e
 *   INP, en ese orden, con `data-thresholds` en los cortes de «bueno»: 2500 ms, 0,1 y 200 ms).
 *   Ninguno lleva la franja de problemas (la ficha no la pide).
 * - Datos pequeños bajo el gráfico de sesiones: `application-session-stat` con `data-stat`
 *   (actionsPerSession, bounceRate y rageClicks, en ese orden), dentro del panel sessions, con
 *   su valor en `application-session-stat-value`.
 * - Tarjetas de Core Web Vitals, en la sección experience y encima del gráfico:
 *   `application-vital` con `data-vital` (lcp, cls e inp, en ese orden), el valor del rango en
 *   `application-vital-value` (LCP e INP con `formatDurationMs`, CLS con dos decimales) y la
 *   calificación en `application-vital-rating`, con `data-rating` (good, needsImprovement o
 *   poor), `data-level` (success, warning o error) y su texto.
 * - Una sección sin nada con datos no sale (como en la 0053).
 */
type AppVital = 'lcp' | 'cls' | 'inp'
const APP_VITALS: AppVital[] = ['lcp', 'cls', 'inp']
/** Totales del simulador: LCP 2310 ms, CLS 0,18 e INP 640 ms. */
const APP_VITAL_EXPECTED: Record<
  AppVital,
  { label: RegExp; value: RegExp; rating: string; level: string; text: string }
> = {
  lcp: {
    label: /LCP/,
    value: /(^|[^\d,.])2,3\ss/,
    rating: 'good',
    level: 'success',
    text: 'Bueno'
  },
  cls: {
    label: /CLS/,
    value: /(^|[^\d,.])0,18([^\d,.]|$)/,
    rating: 'needsImprovement',
    level: 'warning',
    text: 'Mejorable'
  },
  inp: {
    label: /INP/,
    value: /(^|[^\d,.])640\sms/,
    rating: 'poor',
    level: 'error',
    text: 'Pobre'
  }
}
const APP_SESSION_STATS = ['actionsPerSession', 'bounceRate', 'rageClicks'] as const
const appVital = (vital: AppVital): Locator =>
  appPage().locator(`[data-testid="application-vital"][data-vital="${vital}"]`)
const appSessionStat = (stat: string): Locator =>
  appChartPanel('sessions').locator(`[data-testid="application-session-stat"][data-stat="${stat}"]`)
/** Ficha 0054: los `data-stat` de los datos pequeños de sesiones, en su orden. */
async function appSessionStatIds(): Promise<string[]> {
  return appChartPanel('sessions')
    .getByTestId('application-session-stat')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-stat') ?? ''))
}
/** Ficha 0054: los `data-vital` de las tarjetas, en su orden. */
async function appVitalIds(): Promise<string[]> {
  return appPage()
    .getByTestId('application-vital')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-vital') ?? ''))
}

/** Ficha 0053: las consultas del canal de RUM que ha recibido el simulador. */
const appRumQueries = (): URLSearchParams[] => sim.applicationMetricQueries.filter(isRumQuery)

test('CA1 (0034): la página de una aplicación enseña sus marcadores, el gráfico del Apdex y la tabla de acciones de usuario con los valores del simulador, sin «Página en construcción»', async () => {
  const entityPage = await openApplicationPage()

  // Marcadores (ficha 0053: los seis los mira CA1 de la 0053): Apdex y problemas.
  const row = entityPage.getByTestId('application-markers')
  await expect(row).toBeVisible()
  await expectAppApdexMarker()
  await expectAppProblemsMarker()

  // El gráfico del Apdex se queda (ficha 0053), en su sección, con una serie.
  await expect(appSection('apdex')).toBeVisible()
  expect(await appChartKinds('apdex')).toEqual(['apdex'])
  await expect(appChartPanel('apdex').getByRole('heading').first()).toContainText('Apdex')
  expect(await appChartSeries('apdex')).toHaveLength(1)
  // Los gráficos de la 0034 de acciones, duración y errores totales ya no están (ficha 0053).
  for (const old of ['actions', 'duration', 'errors']) {
    await expect(
      entityPage.locator(`[data-testid="application-chart-panel"][data-kind="${old}"]`),
      old
    ).toHaveCount(0)
  }

  // Tabla de acciones (en «Acciones clave», ficha 0053): las tres, de más a menos acciones, con
  // nombre, recuento y duración media (con barra).
  const card = appActions()
  await expect(card).toBeVisible()
  await expect(appSection('key-actions').getByTestId('application-actions')).toHaveCount(1)
  const grid = card.getByTestId('application-actions-grid')
  await expect(grid).toHaveAttribute('role', 'grid')
  expect(await gridColumns(grid)).toEqual(APP_ACTION_COLUMNS.map((c) => `col-${c}`))
  await expect(grid.getByTestId('col-count')).toHaveAttribute('aria-sort', 'descending')
  await expect(card.getByTestId('application-action-row')).toHaveCount(3)
  expect(await appActionOrder()).toEqual(APP_ACTIONS_BY_COUNT.map((a) => a.id))
  for (const action of APP_ACTIONS_BY_COUNT) {
    const cells = appActionRow(action.id).getByRole('gridcell')
    await expect(cells, action.name).toHaveCount(APP_ACTION_COLUMNS.length)
    await expect(cells.nth(0), action.name).toHaveText(action.name)
    await expect(cells.nth(1), action.name).toHaveText(loneNumber(String(action.count)))
    await expect(cells.nth(2), action.name).toContainText(APP_ACTION_DURATION[action.id] ?? /^$/)
    await expect(
      cells.nth(2).getByTestId('application-action-duration-bar'),
      action.name
    ).toHaveCount(1)
  }
  await expect(card.getByTestId('application-actions-empty')).toHaveCount(0)

  // Orden por columna: por duración media, y al revés pulsando otra vez.
  const byDuration = APP_ACTIONS_BY_COUNT.slice()
    .sort((a, b) => a.avg - b.avg)
    .map((a) => a.id)
  expect(byDuration).not.toEqual(APP_ACTIONS_BY_COUNT.map((a) => a.id))
  expect(byDuration.slice().reverse()).not.toEqual(APP_ACTIONS_BY_COUNT.map((a) => a.id))
  await clickInPlace(grid.getByTestId('sort-duration'), { scroll: true })
  const durationCol = grid.getByTestId('col-duration')
  await expect(durationCol).toHaveAttribute('aria-sort', /^(ascending|descending)$/)
  await expect(grid.getByTestId('col-count')).toHaveAttribute('aria-sort', 'none')
  const durationAsc = (await durationCol.getAttribute('aria-sort')) === 'ascending'
  expect(await appActionOrder()).toEqual(durationAsc ? byDuration : byDuration.slice().reverse())
  await clickInPlace(grid.getByTestId('sort-duration'), { scroll: true })
  await expect(durationCol).toHaveAttribute('aria-sort', durationAsc ? 'descending' : 'ascending')
  expect(await appActionOrder()).toEqual(durationAsc ? byDuration.slice().reverse() : byDuration)

  // Ni el bloque ni el texto de «Página en construcción», ni marcadores de otro tipo.
  await expect(entityPage.getByTestId('entity-under-construction')).toHaveCount(0)
  await expect(entityPage).not.toContainText('Página en construcción')
  for (const other of [
    'service-markers',
    'host-markers',
    'monitor-markers',
    'process-markers',
    'process-group-markers'
  ]) {
    await expect(page.getByTestId(other), other).toHaveCount(0)
  }

  // Las consultas del canal, con el rango global.
  await settledRequests()
  expect(sim.applicationMetricQueries.length).toBeGreaterThanOrEqual(2)
  for (const query of sim.applicationMetricQueries) {
    expect(query.get('from')).toBe('now-2h')
  }
})

test('CA1 (0034), nota del Orquestador: sin acciones de usuario en el rango (lo habitual en vivo), la tabla lo dice y el resto de la página sale igual', async () => {
  sim.applicationActionsEmpty = true
  await openApplicationPage()

  const card = appActions()
  await expect(card).toBeVisible()
  const empty = card.getByTestId('application-actions-empty')
  await expect(empty).toBeVisible()
  await expect(empty).not.toHaveText(/^\s*$/)
  await expect(card.getByTestId('application-action-row')).toHaveCount(0)
  // Sin aviso de error ni Reintentar: no es un fallo.
  await expect(card.getByRole('alert')).toHaveCount(0)
  await expect(card.getByRole('button', { name: 'Reintentar' })).toHaveCount(0)
  for (const text of ['undefined', 'null', 'NaN', '[object Object]']) {
    await expect(card, text).not.toContainText(text)
  }

  // Marcadores y gráficos, como siempre (ficha 0053: seis marcadores y cinco gráficos; ficha
  // 0054: tres más, usuarios, sesiones y Core Web Vitals).
  await expectAppMarkers()
  await expect(appPage().getByTestId('application-chart-panel')).toHaveCount(8)
})

test('CA3 (0034): con papeles sin datos (Apdex y errores), sus marcadores y gráficos no salen y el resto sí', async () => {
  // Ficha 0053: 'errors' deja sin series countOfErrors en los dos canales (total y por tipo).
  sim.applicationEmpty = ['apdex', 'errors']
  const entityPage = await openApplicationPage()

  // Los de usuarios, sesiones y acciones, con sus valores; el de problemas, también.
  await expectAppUsersMarker()
  await expectAppSessionsMarker()
  await expectAppActionsMarker()
  await expectAppProblemsMarker()
  expect(await appMarkerIds()).toEqual(['users', 'sessions', 'actions', 'problems'])
  // Gráficos: la actividad entera y las acciones afectadas, con sus series (ficha 0054: y los de
  // usuarios, sesiones y Core Web Vitals).
  expect(await appChartKinds()).toEqual([
    'actionsByType',
    'durationByType',
    'affectedActions',
    'activeUsers',
    'sessions',
    'vitals'
  ])
  for (const kind of ['actionsByType', 'durationByType', 'affectedActions'] as const) {
    expect((await appChartSeries(kind)).length, kind).toBeGreaterThan(0)
  }

  // Los del Apdex y los errores no salen (ni marcador ni gráfico), ni un «—» en su lugar.
  for (const role of ['apdex', 'errors'] as const) {
    await expect(appMarker(role), role).toHaveCount(0)
  }
  for (const kind of ['apdex', 'errorsByType'] as const) {
    await expect(appChartPanel(kind), kind).toHaveCount(0)
    await expect(entityPage.getByTestId(`application-chart-${kind}`), kind).toHaveCount(0)
  }
  // La tabla de acciones sigue.
  await expect(appActions().getByTestId('application-action-row')).toHaveCount(3)
  // Ningún aviso de error en la página: faltar datos no es un fallo.
  await expect(entityPage.getByRole('button', { name: 'Reintentar' })).toHaveCount(0)
})

test('CA4 (0034): la franja de problemas sale sobre el gráfico del Apdex con los problemas de la aplicación, y pulsar un tramo abre el problema', async () => {
  await openApplicationPage()
  await appChartSeries('apdex')
  const band = appBand()
  await expect(band).toBeVisible()
  await expect(band.getByTestId('application-problem-segment')).toHaveCount(2)
  for (const { problemId } of [APPLICATION_BAND_OPEN, APPLICATION_BAND_CLOSED]) {
    await expect(appSegment(problemId), problemId).toHaveCount(1)
  }
  // En el panel del Apdex y (ficha 0053) en el de la duración por tipo; en ningún otro.
  await expect(page.getByTestId('application-problem-band')).toHaveCount(2)
  await expect(appBand('durationByType')).toHaveCount(1)

  // La lista se pide con la aplicación y el rango global.
  await settledRequests()
  const lists = sim.entityProblemListQueries.filter((query) =>
    (query.get('problemSelector') ?? '').includes(APPLICATION_METRICS_ID)
  )
  expect(lists).toHaveLength(1)
  expect(lists[0]?.get('problemSelector')).toBe(`affectedEntities("${APPLICATION_METRICS_ID}")`)
  expect(lists[0]?.get('from')).toBe('now-2h')

  // Encima del gráfico: la franja acaba antes de que empiece el canvas.
  const bandBox = await settledBox(band)
  const plotBox = await settledBox(appChartPlot('apdex'))
  expect(bandBox.y + bandBox.height).toBeLessThanOrEqual(plotBox.y + 1)

  // Pulsar un tramo abre ese problema; «Volver» regresa a la aplicación.
  await clickInPlace(appSegment(APPLICATION_BAND_CLOSED.problemId), { scroll: true })
  await expect(page.getByTestId('problem-page')).toBeVisible()
  await expect(page.getByTestId('problem-page-title')).toContainText(
    APPLICATION_BAND_CLOSED.displayId
  )
  expect(await currentRoute()).toBe(`/problems/${APPLICATION_BAND_CLOSED.problemId}`)
  await page.getByTestId('problem-back').click()
  await expect(appPage()).toBeVisible()
  expect(await currentRoute()).toBe(`/entities/APPLICATION/${APPLICATION_METRICS_ID}`)
})

test('CA5 (0034): la tarjeta «Información» de la aplicación sale la última, con sus filas, sus relaciones («Llama a», «Monitores sintéticos» y «Otras»), «Ver nombres» y enlaces', async () => {
  const entityPage = await openApplicationPage()
  const card = appInfoCard()
  await expect(card).toBeVisible()
  await expect(card).toContainText('Información')
  await expect(card.getByTestId('application-info-row').first()).toBeVisible()
  // Ficha 0053: marcadores y secciones (actividad, errores, Apdex y acciones clave).
  const sections: [string, Locator][] = [
    ['application-markers', entityPage.getByTestId('application-markers')],
    ...APP_SECTIONS.map((id): [string, Locator] => [id, appSection(id)])
  ]
  for (const [id, section] of sections) await expect(section, id).toBeVisible()

  // La última sección: nada visible detrás; marcadores y secciones, encima.
  expect(await visibleNeighbours(APP_PAGE_TEST_ID, 'application-info', 'after')).toEqual([])
  const infoBox = await settledBox(card)
  for (const [id, section] of sections) {
    const box = await settledBox(section)
    expect(box.y + box.height, `${id} encima de «Información»`).toBeLessThanOrEqual(infoBox.y + 1)
  }

  // Filas con las claves vistas en vivo.
  await expect(appInfoValue('applicationType')).toContainText('MANUALLY_INJECTED')
  await expect(appInfoValue('applicationInjectionType')).toContainText('AUTO_INJECTED')
  await expect(appInfoValue('customizedName')).toContainText('tienda-personalizada-e2e')
  await expect(appInfoValue('detectedName')).toContainText('tienda-detectada-e2e')
  for (const text of ['undefined', 'null', 'NaN', '[object Object]']) {
    await expect(card, text).not.toContainText(text)
  }

  // Relaciones: «Llama a» (servicios), «Monitores sintéticos» y «Otras».
  const relations = card.getByTestId('application-info-relations')
  const groups = relations.getByTestId('application-info-group')
  await expect(groups).toHaveCount(3)
  expect(await dataKeys(groups, 'data-group')).toEqual(['calls', 'synthetic', 'other'])
  for (const [key, title, count] of [
    ['calls', 'Llama a', '2'],
    ['synthetic', 'Monitores sintéticos', '3'],
    ['other', 'Otras', '4']
  ] as const) {
    await expect(appInfoGroup(key), key).toContainText(title)
    await expect(appInfoGroup(key).getByTestId('application-info-group-count'), key).toHaveText(
      new RegExp(`^\\s*${count}\\s*$`)
    )
  }

  // «Ver nombres» de los servicios: una llamada con sus dos ids y los nombres en su sitio.
  const calls = await expandAppInfoGroup('calls')
  await settledRequests()
  const namesBefore = sim.entityNamesQueries.length
  await clickInPlace(calls.getByTestId('application-info-names'), { scroll: true })
  await expect.poll(() => sim.entityNamesQueries.length).toBe(namesBefore + 1)
  const selector = sim.entityNamesQueries[namesBefore]?.get('entitySelector') ?? ''
  for (const [id, name] of [
    [INFO_FEW_ID, 'info-pocas-e2e'],
    [PROCESS_INFO_SERVICE_2, 'servicio-proceso-e2e']
  ] as const) {
    expect(selector).toContain(id)
    await expect(appInfoEntity('calls', id).getByTestId('application-info-entity-name')).toHaveText(
      name
    )
  }

  // Enlaces: un servicio a su página y los monitores a la suya (browser y HTTP).
  await expect(appInfoEntity('calls', INFO_FEW_ID)).toHaveAttribute(
    'href',
    new RegExp(`#/entities/SERVICE/${INFO_FEW_ID}$`)
  )
  await expandAppInfoGroup('synthetic')
  for (const [id, type] of [
    [MONITOR_BROWSER_ID, 'SYNTHETIC_TEST'],
    [MONITOR_HTTP_ID, 'HTTP_CHECK'],
    [APPLICATION_INFO_HTTP, 'HTTP_CHECK']
  ] as const) {
    await expect(appInfoEntity('synthetic', id), id).toHaveAttribute(
      'href',
      new RegExp(`#/entities/${type}/${id}$`)
    )
  }
  const other = await expandAppInfoGroup('other')
  await expect(other).toContainText('isApplicationMethodOf')
  await expect(other).toContainText('isGroupOf')

  // Pulsar el servicio abre su página.
  await clickInPlace(appInfoEntity('calls', INFO_FEW_ID), { scroll: true })
  await expect(page.getByTestId('entity-page-service')).toBeVisible()
  expect(await currentRoute()).toBe(`/entities/SERVICE/${INFO_FEW_ID}`)
})

// ---------------------------------------------------------------------------
// Ficha 0053: página de la aplicación con los marcadores nuevos y las secciones «Actividad» y
// «Errores» (canal entities:applicationRum de la 0052). Nombres y decisiones, en el comentario
// de la página de la aplicación (ficha 0034).
// ---------------------------------------------------------------------------

test('CA1 (0053): la página de una aplicación enseña los seis marcadores, en su orden, con sus valores formateados y sus líneas de debajo', async () => {
  const entityPage = await openApplicationPage()
  const row = entityPage.getByTestId('application-markers')
  await expect(row).toBeVisible()
  for (const id of APP_MARKERS) {
    await expect(appMarker(id), id).toBeVisible()
    await expect(appMarker(id), id).toContainText(APP_MARKER_LABELS[id] ?? id)
  }
  expect(await appMarkerIds()).toEqual([...APP_MARKERS])
  // Ni el de duración de la 0034.
  await expect(appMarker('duration')).toHaveCount(0)

  // Valores: Apdex 0,88 «Buena»; usuarios 1.234 «estimado»; sesiones 19 con 45,6 s · 28,4 %;
  // acciones 31.040 con load 9.640 · XHR 21.400; errores 14 con JavaScript 5 · HTTP 9;
  // problemas 1 abierto y 1 cerrado.
  await expectAppMarkers()
  for (const text of ['undefined', 'null', 'NaN', '[object Object]']) {
    await expect(row, text).not.toContainText(text)
  }

  // Las consultas de RUM, con el rango global.
  await settledRequests()
  expect(appRumQueries().length).toBeGreaterThanOrEqual(4)
  for (const query of appRumQueries()) expect(query.get('from')).toBe('now-2h')
})

test('CA1 (0053): con acciones custom, el marcador de acciones las suma y las enseña debajo', async () => {
  sim.applicationRumCustom = true
  await openApplicationPage()
  // 9640 + 21 400 + 1250.
  await expect(appMarkerValue('actions')).toHaveText(loneNumber('32.290'))
  const secondary = appMarkerSecondary('actions')
  await expect(secondary).toContainText(APP_SERIES.load)
  await expect(secondary).toContainText(loneNumber('9.640'))
  await expect(secondary).toContainText(APP_SERIES.xhr)
  await expect(secondary).toContainText(loneNumber('21.400'))
  await expect(secondary).toContainText(APP_SERIES.custom)
  await expect(secondary).toContainText(loneNumber('1.250'))
})

test('CA2 (0053): las secciones «Actividad» y «Errores» enseñan sus dos gráficos con sus series, en su orden, y la franja de problemas sobre la duración por tipo', async () => {
  const entityPage = await openApplicationPage()

  // Secciones con título, en su orden; los marcadores, encima de todas.
  expect(await appSectionIds()).toEqual(APP_SECTIONS)
  const markersBox = await settledBox(entityPage.getByTestId('application-markers'))
  for (const id of APP_SECTIONS) {
    const section = appSection(id)
    await expect(section, id).toBeVisible()
    await expect(section.getByRole('heading').first(), id).toContainText(APP_SECTION_TITLES[id])
    const box = await settledBox(section)
    expect(markersBox.y + markersBox.height, `marcadores encima de ${id}`).toBeLessThanOrEqual(
      box.y + 1
    )
    expect(await appChartKinds(id), id).toEqual(APP_SECTION_CHARTS[id])
  }
  for (const kind of APP_SECTION_CHARTS.activity.concat(APP_SECTION_CHARTS.errors)) {
    await expect(appChartPanel(kind).getByRole('heading').first(), kind).toContainText(
      APP_CHART_TITLES[kind]
    )
  }

  // «Actividad»: load y XHR (custom no trae datos en el simulador, como en vivo).
  await expectAppChartSeries('actionsByType', [APP_SERIES.load, APP_SERIES.xhr])
  await expectAppChartSeries('durationByType', [APP_SERIES.load, APP_SERIES.xhr])
  // «Errores»: JavaScript y HTTP (sin «otros»: no traen datos), y el % de acciones afectadas.
  await expectAppChartSeries('errorsByType', [APP_SERIES.javascript, APP_SERIES.http])
  expect(await appChartSeries('affectedActions')).toHaveLength(1)
  // Separados: sin nota.
  await expect(appChartPanel('errorsByType').getByTestId('application-errors-note')).toHaveCount(0)

  // La franja de problemas, sobre la duración por tipo, con los dos problemas.
  const band = appBand('durationByType')
  await expect(band).toBeVisible()
  await expect(band.getByTestId('application-problem-segment')).toHaveCount(2)
  for (const { problemId } of [APPLICATION_BAND_OPEN, APPLICATION_BAND_CLOSED]) {
    await expect(appSegment(problemId, 'durationByType'), problemId).toHaveCount(1)
  }
  const bandBox = await settledBox(band)
  const plotBox = await settledBox(appChartPlot('durationByType'))
  expect(bandBox.y + bandBox.height).toBeLessThanOrEqual(plotBox.y + 1)
})

test('CA2 (0053): con acciones custom, los dos gráficos de «Actividad» llevan load, XHR y custom', async () => {
  sim.applicationRumCustom = true
  await openApplicationPage()
  const all = [APP_SERIES.load, APP_SERIES.xhr, APP_SERIES.custom]
  await expectAppChartSeries('actionsByType', all)
  await expectAppChartSeries('durationByType', all)
})

test('CA3 (0053): con los errores sin separar por tipo, el gráfico de errores lleva una sola serie y la nota, y el marcador no enseña la línea JavaScript · HTTP', async () => {
  sim.applicationRumErrorsUntyped = true
  await openApplicationPage()

  // El gráfico: una sola serie, con la nota.
  expect(await appChartSeries('errorsByType')).toHaveLength(1)
  const note = appChartPanel('errorsByType').getByTestId('application-errors-note')
  await expect(note).toBeVisible()
  await expect(note).not.toHaveText(/^\s*$/)

  // El marcador: el total (14), sin JavaScript ni HTTP.
  await expect(appMarkerValue('errors')).toHaveText(loneNumber('14'))
  await expect(appMarkerValue('errors')).toHaveAttribute('data-level', 'error')
  await expect(appMarker('errors')).not.toContainText('JavaScript')
  await expect(appMarker('errors')).not.toContainText('HTTP')

  // El resto, como siempre.
  expect(await appChartSeries('affectedActions')).toHaveLength(1)
  await expectAppActionsMarker()
})

test('CA4 (0053): con papeles sin datos (usuarios, acciones por tipo y acciones afectadas), su marcador o gráfico no sale y el resto sí', async () => {
  sim.applicationEmpty = [
    `${RUM_W}activeUsersEst`,
    `${RUM_W}actionCount.load`,
    `${RUM_W}actionCount.xhr`,
    `${RUM_W}percentageOfUserActionsAffectedByErrors`
  ]
  const entityPage = await openApplicationPage()

  // Marcadores: sin usuarios ni acciones; el resto con sus valores.
  expect(await appMarkerIds()).toEqual(['apdex', 'sessions', 'errors', 'problems'])
  await expect(appMarker('users')).toHaveCount(0)
  await expect(appMarker('actions')).toHaveCount(0)
  await expectAppApdexMarker()
  await expectAppSessionsMarker()
  await expectAppErrorsMarker()
  await expectAppProblemsMarker()

  // Gráficos: sin acciones por tipo ni acciones afectadas (ni, ficha 0054, el de usuarios
  // activos); el resto con sus series.
  expect(await appChartKinds()).toEqual([
    'durationByType',
    'errorsByType',
    'sessions',
    'vitals',
    'apdex'
  ])
  for (const kind of ['actionsByType', 'affectedActions'] as const) {
    await expect(appChartPanel(kind), kind).toHaveCount(0)
    await expect(entityPage.getByTestId(`application-chart-${kind}`), kind).toHaveCount(0)
  }
  await expectAppChartSeries('durationByType', [APP_SERIES.load, APP_SERIES.xhr])
  await expectAppChartSeries('errorsByType', [APP_SERIES.javascript, APP_SERIES.http])
  expect(await appChartSeries('apdex')).toHaveLength(1)

  // Faltar datos no es un fallo.
  await expect(entityPage.getByRole('button', { name: 'Reintentar' })).toHaveCount(0)
  await expect(appActions().getByTestId('application-action-row')).toHaveCount(3)
})

test('CA5 (0053): cambiar el rango global vuelve a pedir los datos de RUM; «Actualizar» también; volver a la página sin cambios, no', async () => {
  await openApplicationPage()
  await expectAppMarkers()
  await appChartSeries('actionsByType')
  await settledRequests()
  const rum = appRumQueries().length
  expect(rum).toBeGreaterThanOrEqual(4)
  for (const query of appRumQueries()) expect(query.get('from')).toBe('now-2h')

  // Rango nuevo: otra vez, con now-24h.
  await page.getByTestId('time-range-24h').click()
  await expect.poll(() => appRumQueries().length).toBe(rum * 2)
  for (const query of appRumQueries().slice(rum)) expect(query.get('from')).toBe('now-24h')
  await expectAppMarkers()

  // Fuera y vuelta, sin cambiar nada: ninguna petición nueva.
  await goTo('metrics')
  await expect(appPage()).toHaveCount(0)
  const before = await settledRequests()
  await openApplicationPage()
  await expectAppMarkers()
  await page.waitForTimeout(1500)
  expect(sim.requests.slice(before), 'peticiones al volver a la página').toEqual([])

  // «Actualizar», en la cabecera de la página: otra vez, con el rango actual.
  await appPage().getByTestId('module-refresh').click()
  await expect.poll(() => appRumQueries().length).toBe(rum * 3)
  for (const query of appRumQueries().slice(rum * 2)) expect(query.get('from')).toBe('now-24h')
  await expectAppMarkers()
})

test('CA5 (0053): si falla el canal de RUM, sus marcadores y cada gráfico de «Actividad» y «Errores» enseñan el aviso con Reintentar, y el Apdex, los problemas y la tabla siguen', async () => {
  sim.applicationRumFail = true
  await openApplicationPage()
  const rumMarkers = ['users', 'sessions', 'actions', 'errors'] as const
  const rumCharts = ['actionsByType', 'durationByType', 'errorsByType', 'affectedActions'] as const

  // Lo que no es de RUM, con sus valores y sin aviso.
  await expectAppApdexMarker()
  await expectAppProblemsMarker()
  expect(await appChartSeries('apdex')).toHaveLength(1)
  await expect(appActions().getByTestId('application-action-row')).toHaveCount(3)
  for (const id of ['apdex', 'problems']) {
    await expect(appMarker(id).getByRole('button', { name: 'Reintentar' }), id).toHaveCount(0)
  }
  await expect(appChartPanel('apdex').getByRole('button', { name: 'Reintentar' })).toHaveCount(0)

  // Cada marcador de RUM, en su sitio, con el aviso y Reintentar y sin valor.
  for (const id of rumMarkers) {
    const marker = appMarker(id)
    await expect(marker, id).toBeVisible()
    await expect(marker.getByRole('alert').first(), id).toBeVisible()
    await expect(marker.getByRole('button', { name: 'Reintentar' }), id).toBeVisible()
    await expect(marker.getByTestId('application-marker-value'), id).toHaveCount(0)
  }
  // Cada gráfico de RUM, con su aviso y Reintentar, sin gráfico.
  for (const kind of rumCharts) {
    const panel = appChartPanel(kind)
    await expect(panel, kind).toBeVisible()
    await expect(panel.getByRole('alert').first(), kind).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Reintentar' }), kind).toBeVisible()
    await expect(panel.getByTestId(`application-chart-${kind}`), kind).toHaveCount(0)
  }

  // Reintentar, con el canal ya bien: llegan los valores y los gráficos.
  sim.applicationRumFail = false
  await clickInPlace(appChartPanel('actionsByType').getByRole('button', { name: 'Reintentar' }), {
    scroll: true
  })
  await expectAppMarkers()
  await expectAppChartSeries('actionsByType', [APP_SERIES.load, APP_SERIES.xhr])
  await expectAppChartSeries('errorsByType', [APP_SERIES.javascript, APP_SERIES.http])
  for (const kind of rumCharts) {
    await expect(appChartPanel(kind).getByRole('alert'), kind).toHaveCount(0)
  }
})

// ---------------------------------------------------------------------------
// Ficha 0054: secciones «Usuarios y sesiones» y «Experiencia» (Core Web Vitals) de la página de
// la aplicación, con el canal entities:applicationRum de la 0052 (solo API clásica). Nombres y
// decisiones, en el comentario de APP_VITALS.
// ---------------------------------------------------------------------------

test('CA1 (0054): la página de una aplicación enseña «Usuarios y sesiones» con sus dos gráficos y los tres datos pequeños bajo el de sesiones', async () => {
  sim.applicationRumRageClicks = true
  const entityPage = await openApplicationPage()

  // La sección, con su título, justo después de «Errores».
  const section = appSection('users')
  await expect(section).toBeVisible()
  await expect(section.getByRole('heading').first()).toContainText(APP_SECTION_TITLES.users)
  expect(await appSectionIds()).toEqual(APP_SECTIONS)
  expect(await appChartKinds('users')).toEqual(['activeUsers', 'sessions'])
  for (const kind of ['activeUsers', 'sessions'] as const) {
    await expect(appChartPanel(kind).getByRole('heading').first(), kind).toContainText(
      APP_CHART_TITLES[kind]
    )
  }

  // Usuarios activos: una línea, con la nota de que es una estimación.
  await expectAppChartSeries('activeUsers', [/usuarios/i])
  const note = appChartPanel('activeUsers').getByTestId('application-users-note')
  await expect(note).toBeVisible()
  await expect(note).toContainText(/estimad|aproximaci/i)

  // Sesiones: iniciadas y terminadas, y la duración media (en su eje).
  await expectAppChartSeries('sessions', [/iniciadas/i, /terminadas/i, /duración/i])

  // Debajo, los tres datos del rango: 5,9 acciones por sesión, 28,4 % de rebote y 37 rage clicks.
  expect(await appSessionStatIds()).toEqual([...APP_SESSION_STATS])
  const stats: Record<(typeof APP_SESSION_STATS)[number], [RegExp, RegExp]> = {
    actionsPerSession: [/acciones por sesión/i, /^\s*5,9\s*$/],
    bounceRate: [/rebote/i, /^\s*28,4\s?%\s*$/],
    rageClicks: [/frustración|rage/i, loneNumber('37')]
  }
  for (const [stat, [label, value]] of Object.entries(stats)) {
    await expect(appSessionStat(stat), stat).toBeVisible()
    await expect(appSessionStat(stat), stat).toContainText(label)
    await expect(
      appSessionStat(stat).getByTestId('application-session-stat-value'),
      stat
    ).toHaveText(value)
  }
  // Debajo del gráfico: el primer dato empieza donde acaba el canvas.
  const plotBox = await settledBox(appChartPlot('sessions'))
  const statBox = await settledBox(appSessionStat('actionsPerSession'))
  expect(plotBox.y + plotBox.height).toBeLessThanOrEqual(statBox.y + 1)

  for (const text of ['undefined', 'null', 'NaN', '[object Object]']) {
    await expect(section, text).not.toContainText(text)
  }
  // Nada de aviso: hay datos.
  await expect(section.getByRole('button', { name: 'Reintentar' })).toHaveCount(0)
  await expect(entityPage.getByTestId('entity-under-construction')).toHaveCount(0)
})

test('CA3 (0054): la sección «Experiencia» enseña las tarjetas de LCP, CLS e INP con su calificación y el gráfico con sus tres series y las líneas de umbral', async () => {
  await openApplicationPage()

  // La sección, con su título, después de «Usuarios y sesiones».
  const section = appSection('experience')
  await expect(section).toBeVisible()
  await expect(section.getByRole('heading').first()).toContainText(APP_SECTION_TITLES.experience)
  expect(await appSectionIds()).toEqual(APP_SECTIONS)

  // Tres tarjetas, en su orden, con el valor del rango y su calificación (texto y color): LCP
  // 2,3 s «Bueno», CLS 0,18 «Mejorable» e INP 640 ms «Pobre».
  expect(await appVitalIds()).toEqual(APP_VITALS)
  await expect(section.getByTestId('application-vital')).toHaveCount(3)
  for (const vital of APP_VITALS) {
    const expected = APP_VITAL_EXPECTED[vital]
    const card = appVital(vital)
    await expect(card, vital).toBeVisible()
    await expect(card, vital).toContainText(expected.label)
    await expect(card.getByTestId('application-vital-value'), vital).toContainText(expected.value)
    const rating = card.getByTestId('application-vital-rating')
    await expect(rating, vital).toHaveAttribute('data-rating', expected.rating)
    await expect(rating, vital).toHaveAttribute('data-level', expected.level)
    await expect(rating, vital).toHaveText(new RegExp(`^\\s*${expected.text}\\s*$`))
  }

  // El gráfico: un solo panel, con LCP, CLS e INP y las líneas en los cortes de «bueno».
  expect(await appChartKinds('experience')).toEqual(['vitals'])
  await expect(appChartPanel('vitals').getByRole('heading').first()).toContainText(
    APP_CHART_TITLES.vitals
  )
  await expectAppChartSeries('vitals', [/LCP/, /CLS/, /INP/])
  const plot = appChartPlot('vitals')
  await expect(plot).toHaveAttribute('data-thresholds', /\[.+\]/)
  const thresholds = JSON.parse((await plot.getAttribute('data-thresholds')) ?? '[]') as number[]
  expect(thresholds.slice().sort((a, b) => a - b)).toEqual([0.1, 200, 2_500])

  for (const text of ['undefined', 'null', 'NaN', '[object Object]']) {
    await expect(section, text).not.toContainText(text)
  }
  await expect(section.getByRole('button', { name: 'Reintentar' })).toHaveCount(0)
})

test('CA4 (0054): sin datos de experiencia (LCP, CLS e INP), la sección «Experiencia» no sale y el resto sí', async () => {
  sim.applicationEmpty = [
    `${RUM_W}largestContentfulPaint`,
    `${RUM_W}cumulativeLayoutShift`,
    `${RUM_W}interactionToNextPaint`
  ]
  const entityPage = await openApplicationPage()

  // «Usuarios y sesiones» sale con sus dos gráficos; las demás secciones, en su orden.
  await expect(appSection('users')).toBeVisible()
  await expectAppChartSeries('activeUsers', [/usuarios/i])
  await expectAppChartSeries('sessions', [/iniciadas/i, /terminadas/i, /duración/i])
  expect(await appSectionIds()).toEqual(APP_SECTIONS.filter((id) => id !== 'experience'))

  // Ni la sección, ni las tarjetas, ni el gráfico, ni un «—» en su lugar.
  await expect(appSection('experience')).toHaveCount(0)
  await expect(entityPage.getByTestId('application-vital')).toHaveCount(0)
  await expect(appChartPanel('vitals')).toHaveCount(0)
  await expect(entityPage.getByTestId('application-chart-vitals')).toHaveCount(0)

  // Faltar datos no es un fallo.
  await expect(entityPage.getByRole('button', { name: 'Reintentar' })).toHaveCount(0)
  await expectAppMarkers()
})

test('CA4 (0054): sin rage clicks (lo habitual en vivo), su dato no sale y los otros dos sí', async () => {
  // Por defecto, el simulador no trae rage clicks (como en vivo).
  expect(sim.applicationRumRageClicks).toBe(false)
  await openApplicationPage()
  await expectAppChartSeries('sessions', [/iniciadas/i, /terminadas/i, /duración/i])

  expect(await appSessionStatIds()).toEqual(['actionsPerSession', 'bounceRate'])
  await expect(appSessionStat('rageClicks')).toHaveCount(0)
  await expect(
    appSessionStat('actionsPerSession').getByTestId('application-session-stat-value')
  ).toHaveText(/^\s*5,9\s*$/)
  await expect(
    appSessionStat('bounceRate').getByTestId('application-session-stat-value')
  ).toHaveText(/^\s*28,4\s?%\s*$/)
  const panel = appChartPanel('sessions')
  await expect(panel).not.toContainText(/frustración|rage/i)
  for (const text of ['undefined', 'null', 'NaN']) {
    await expect(panel, text).not.toContainText(text)
  }
})

/**
 * Ficha 0040: página del disco (DISK), a la que se llega desde la tabla de discos del host (0019).
 * Datos del canal entities:diskMetrics del simulador (DISK_PAGE_SERIES y DISK_PAGE_MARKERS, de
 * /datos) y de su entidad (diskInfoBody).
 *
 * Nombres que fijan estos tests (decisión del test-writer, refinable; los del proceso con el
 * prefijo `disk`): la página `entity-page-disk`; la fila `disk-markers`; cada marcador
 * `disk-marker-<id>` (usage, free, read, write, latency o queue, y problems); dentro, el valor
 * principal en `disk-marker-value` (el de uso con `data-level`: `normal`, `warning` o `error`,
 * umbrales del 80 y el 90 %), lo de debajo en `disk-marker-secondary` y el texto del nivel, si no
 * es `normal`, en `disk-marker-level`; los recuentos, en `disk-marker-open` y
 * `disk-marker-closed`. La sección `disk-charts`; cada gráfico en un `disk-chart-panel` con
 * `data-kind` (usage, space, throughput y latency o queue, en ese orden) y su título en un
 * encabezado; dentro, el `Chart` con testid `disk-chart-<kind>` (con `data-series`). La tarjeta
 * `disk-info`, al final.
 *
 * Formato (como la tabla de discos del host, 0019): espacio en GB, lectura y escritura en bytes
 * por segundo (kB/s, MB/s) y latencia en ms. Con latencia y cola, sale Latencia (decisión del
 * test-writer, como Disponibilidad antes que Recursos en la 0028); sin latencia, Cola.
 */
type DiskChartKind = 'usage' | 'space' | 'throughput' | 'latency' | 'queue'
const DISK_PAGE_TEST_ID = 'entity-page-disk'
const DISK_MARKER_LABELS: Record<string, string> = {
  usage: 'Uso',
  free: 'Libre',
  read: 'Lectura',
  write: 'Escritura',
  latency: 'Latencia',
  queue: 'Cola',
  problems: 'Problemas'
}
const DISK_CHART_TITLES: Record<DiskChartKind, RegExp> = {
  usage: /^Uso/,
  space: /^Espacio/,
  throughput: /^Lectura y escritura/,
  latency: /^Latencia/,
  queue: /^Cola/
}
/** Las series de cada gráfico, en su orden. */
const DISK_CHART_SERIES: Record<DiskChartKind, RegExp[]> = {
  usage: [/./],
  space: [/usad/i, /libre/i],
  throughput: [/lectura/i, /escritura/i],
  latency: [/lectura/i, /escritura/i],
  queue: [/./]
}

const diskPage = (): Locator => page.getByTestId(DISK_PAGE_TEST_ID)
const diskMarker = (id: string): Locator => diskPage().getByTestId(`disk-marker-${id}`)
const diskChartPanel = (kind: DiskChartKind): Locator =>
  diskPage().locator(`[data-testid="disk-chart-panel"][data-kind="${kind}"]`)

/** Ficha 0040: abre por URL la página del disco /datos. */
async function openDiskPage(): Promise<Locator> {
  await goToRoute(`/entities/DISK/${DISK_PAGE_ID}`)
  await expect(diskPage()).toBeVisible()
  return diskPage()
}

/** Ficha 0040: comprueba las series de un gráfico del disco (se monta vacío mientras carga). */
async function expectDiskChartSeries(kind: DiskChartKind): Promise<void> {
  const plot = diskChartPanel(kind).getByTestId(`disk-chart-${kind}`)
  await expect(plot.locator('canvas').first(), kind).toBeVisible()
  await expect(plot, kind).toHaveAttribute('data-series', /\[.+\]/)
  const series = JSON.parse((await plot.getAttribute('data-series')) ?? '[]') as string[]
  expect(series, kind).toHaveLength(DISK_CHART_SERIES[kind].length)
  for (const [i, pattern] of DISK_CHART_SERIES[kind].entries()) {
    expect(series[i], `${kind}[${i}]`).toMatch(pattern)
  }
}

/** Ficha 0040: los `data-kind` de los paneles de gráficos, en el orden en que se pintan. */
async function diskChartKinds(): Promise<string[]> {
  return diskPage()
    .getByTestId('disk-charts')
    .getByTestId('disk-chart-panel')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-kind') ?? ''))
}

/** Ficha 0040: los marcadores comunes (uso, libre, lectura, escritura y problemas). */
async function expectDiskCommonMarkers(): Promise<void> {
  const levels = es.entities.host.markers.levels
  // Uso: % máximo del rango (92,5 %), en error (≥ 90 %) y con su texto.
  const usage = diskMarker('usage')
  await expect(usage.getByTestId('disk-marker-value')).toHaveText(/^92,5\s?%$/)
  await expect(usage.getByTestId('disk-marker-value')).toHaveAttribute('data-level', 'error')
  await expect(usage.getByTestId('disk-marker-level')).toContainText(levels.error)
  // Libre: último dato de avail (45 GB; el último punto llega a null).
  await expect(diskMarker('free').getByTestId('disk-marker-value')).toHaveText(/^45,0\sGB$/)
  // Lectura y escritura: medias del rango, en bytes por segundo.
  await expect(diskMarker('read').getByTestId('disk-marker-value')).toHaveText(/^2,5\sMB\/s$/)
  await expect(diskMarker('write').getByTestId('disk-marker-value')).toHaveText(/^12,0\skB\/s$/)
  // Problemas: el disco no tiene ninguno.
  const problems = diskMarker('problems')
  await expect(problems.getByTestId('disk-marker-open')).toHaveText(loneNumber('0'))
  await expect(problems.getByTestId('disk-marker-closed')).toHaveText(loneNumber('0'))
}

test('CA4 (0040): pulsar un disco en la tabla del host abre su página con su nombre, y «Volver» regresa al host sin volver a pedir sus datos', async () => {
  await openHostPage()
  await expectHostTablesLoaded()
  const link = diskRow(DISK_PAGE_ID).getByRole('link', { name: DISK_PAGE_NAME })
  await expect(link).toHaveAttribute('href', new RegExp(`#/entities/DISK/${DISK_PAGE_ID}$`))

  await settledRequests()
  const breakdownBefore = sim.hostBreakdownQueries.length
  const metricsBefore = sim.hostMetricQueries.length
  await clickInPlace(link, { scroll: true })
  await expect(diskPage()).toBeVisible()
  expect(await currentRoute()).toBe(`/entities/DISK/${DISK_PAGE_ID}`)
  await expect(diskPage().getByRole('heading', { level: 1 })).toHaveText(DISK_PAGE_NAME)
  await expect(diskPage().getByTestId('entity-page-id')).toHaveText(DISK_PAGE_ID)
  // Es la página del disco, no la genérica.
  await expect(diskPage().getByTestId('disk-markers')).toBeVisible()

  const before = await settledRequests()
  await clickInPlace(diskPage().getByTestId('entity-back'), { scroll: true })
  await expect(page.getByTestId('entity-page-host')).toBeVisible()
  expect(await currentRoute()).toBe(`/entities/HOST/${HOST_METRICS_ID}`)
  await expectHostTablesLoaded()
  await expectHostMarkerValues()
  await page.waitForTimeout(1500)
  expect(sim.requests.slice(before), 'peticiones al volver al host').toEqual([])
  expect(sim.hostBreakdownQueries).toHaveLength(breakdownBefore)
  expect(sim.hostMetricQueries).toHaveLength(metricsBefore)
})

test('CA5 (0040): la página del disco enseña sus marcadores, sus cuatro gráficos y su «Información» con los valores del simulador', async () => {
  const entityPage = await openDiskPage()
  const row = entityPage.getByTestId('disk-markers')
  await expect(row).toBeVisible()

  // Marcadores: uso, libre, lectura, escritura, latencia (antes que cola) y problemas.
  for (const id of ['usage', 'free', 'read', 'write', 'latency', 'problems']) {
    await expect(row.getByTestId(`disk-marker-${id}`), id).toBeVisible()
    await expect(row.getByTestId(`disk-marker-${id}`), id).toContainText(
      DISK_MARKER_LABELS[id] ?? id
    )
  }
  await expect(row.getByTestId('disk-marker-queue')).toHaveCount(0)
  await expectDiskCommonMarkers()
  // Latencia: media de lectura (12 ms) y, debajo, la de escritura (18 ms).
  const latency = diskMarker('latency')
  await expect(latency.getByTestId('disk-marker-value')).toHaveText(/^12(,0)?\s?ms$/)
  await expect(latency.getByTestId('disk-marker-secondary')).toContainText(
    /(^|[^\d.,])18(,0)?\s?ms/
  )

  // Cuatro gráficos en su orden: uso, espacio, lectura y escritura, y latencia.
  const section = entityPage.getByTestId('disk-charts')
  await expect(section).toBeVisible()
  const panels = section.getByTestId('disk-chart-panel')
  await expect(panels).toHaveCount(4)
  const kinds = await diskChartKinds()
  expect(kinds).toEqual(['usage', 'space', 'throughput', 'latency'])
  for (const [index, kind] of (kinds as DiskChartKind[]).entries()) {
    await expect(panels.nth(index).getByRole('heading').first(), kind).toHaveText(
      DISK_CHART_TITLES[kind]
    )
    await expectDiskChartSeries(kind)
  }

  // «Información», al final: el sistema de ficheros y el host del que es el disco, con enlace.
  const info = entityPage.getByTestId('disk-info')
  await expect(info).toBeVisible()
  await expect(info).toContainText('Información')
  await expect(info).toContainText(DISK_PAGE_FILESYSTEM)
  await expect(info).toContainText('Disco de')
  const host = info.locator(`a[href$="#/entities/HOST/${HOST_METRICS_ID}"]`)
  await expect(host).toHaveCount(1)
  for (const text of ['undefined', 'null', 'NaN', '[object Object]']) {
    await expect(info, text).not.toContainText(text)
  }
  const markersBox = await settledBox(row)
  const chartsBox = await settledBox(section)
  const infoBox = await settledBox(info)
  expect(markersBox.y + markersBox.height, 'marcadores encima de los gráficos').toBeLessThanOrEqual(
    chartsBox.y + 1
  )
  expect(chartsBox.y + chartsBox.height, 'gráficos encima de «Información»').toBeLessThanOrEqual(
    infoBox.y + 1
  )

  // Ni «Página en construcción» ni marcadores de otro tipo.
  await expect(entityPage.getByTestId('entity-under-construction')).toHaveCount(0)
  await expect(entityPage).not.toContainText('Página en construcción')
  for (const other of ['host-markers', 'process-markers', 'service-markers']) {
    await expect(page.getByTestId(other), other).toHaveCount(0)
  }

  // Las consultas del canal: acotadas al disco con el filtro, con el rango global y sin pasar de
  // 10 expresiones.
  await settledRequests()
  expect(sim.diskMetricQueries.length).toBeGreaterThan(0)
  for (const query of sim.diskMetricQueries) {
    const expressions = splitSelector(query.get('metricSelector') ?? '')
    expect(expressions.length).toBeLessThanOrEqual(HOST_MAX_EXPRESSIONS)
    for (const expression of expressions) expect(diskOfExpression(expression)).toBe(DISK_PAGE_ID)
    expect(query.get('entitySelector') ?? '').not.toContain(DISK_PAGE_ID)
    expect(query.get('from')).toBe('now-2h')
  }
})

test('CA5 (0040): sin latencia, el marcador y el gráfico de cola ocupan su sitio y el resto sigue', async () => {
  sim.diskEmpty = ['builtin:host.disk.readTime', 'builtin:host.disk.writeTime']
  const entityPage = await openDiskPage()
  const row = entityPage.getByTestId('disk-markers')
  await expect(row.getByTestId('disk-marker-queue')).toBeVisible()
  await expect(row.getByTestId('disk-marker-queue')).toContainText(
    DISK_MARKER_LABELS['queue'] ?? ''
  )
  await expect(row.getByTestId('disk-marker-latency')).toHaveCount(0)
  await expectDiskCommonMarkers()
  // Cola: longitud media del rango (0,75).
  await expect(diskMarker('queue').getByTestId('disk-marker-value')).toHaveText(/^0,(75|8)$/)

  await expect(entityPage.getByTestId('disk-chart-panel')).toHaveCount(4)
  expect(await diskChartKinds()).toEqual(['usage', 'space', 'throughput', 'queue'])
  await expect(diskChartPanel('queue').getByRole('heading').first()).toHaveText(
    DISK_CHART_TITLES.queue
  )
  await expectDiskChartSeries('queue')
  await expect(entityPage.getByTestId('disk-info')).toBeVisible()
})

/**
 * Ficha 0041: tarjeta «Logs» en la página del host (HOST_METRICS_ID), canal entities:hostLogs,
 * con HOST_LOGS_ENTRIES: 3 de los 15 procesos de HOST_PAGE_PROCESSES tienen logs.
 *
 * Nombres que fijan estos tests (decisión del test-writer, refinable; en la ficha): la tarjeta
 * `host-logs`, antes de «Información» (`host-info`); dentro, el resumen `host-logs-summary` y una
 * fila `host-log-row` (con `data-process-id`) por proceso con logs, con el nombre como enlace a su
 * página, el estado en `host-log-status` (con `data-status`, el enum de Dynatrace, su texto y su
 * color) y la última actualización en `host-log-updated`. Regla de Dani: ninguna ruta de log se ve
 * en la app (ni en la tarjeta ni en «Todas las propiedades» del proceso).
 */
const hostLogsCard = (): Locator => page.getByTestId('host-logs')
const hostLogRow = (id: string): Locator =>
  hostLogsCard().locator(`[data-testid="host-log-row"][data-process-id="${id}"]`)

/** Ficha 0041: ninguna ruta (ni trozo de ella) en el HTML del elemento, atributos incluidos. */
async function expectNoLogPaths(target: Locator, where: string): Promise<void> {
  const html = await target.evaluate((element) => element.outerHTML)
  for (const fragment of HOST_LOGS_FRAGMENTS) {
    expect(html.includes(fragment), `${where}: ${fragment}`).toBe(false)
  }
}

test('CA4 (0041): la tarjeta «Logs» del host enseña el resumen y los procesos con logs, sin rutas; pulsar uno abre su página, y su «Todas las propiedades» tampoco enseña rutas', async () => {
  const hostPage = await openHostPage()
  const card = hostLogsCard()
  await expect(card).toBeVisible()
  await expect(card.getByTestId('host-logs-summary')).toHaveText('3 de 15 procesos con logs')
  await expect(card.getByTestId('host-log-row')).toHaveCount(3)

  // La consulta: el selector con el id del host y pageSize 500.
  expect(sim.hostLogsQueries.length).toBeGreaterThan(0)
  const query = sim.hostLogsQueries[0]!
  expect(query.get('entitySelector')).toBe(HOST_LOGS_SELECTOR(HOST_METRICS_ID))
  expect(query.get('pageSize')).toBe('500')

  // Cada proceso con logs: su nombre, enlace a su página y la última actualización (una fecha).
  for (const id of HOST_LOGS_IDS) {
    const process = HOST_PAGE_PROCESSES.find((p) => p.id === id)!
    const row = hostLogRow(id)
    await expect(row, process.name).toBeVisible()
    await expect(row.getByRole('link', { name: process.name })).toHaveAttribute(
      'href',
      new RegExp(`#/entities/PROCESS_GROUP_INSTANCE/${id}$`)
    )
    await expect(row.getByTestId('host-log-updated'), process.name).toContainText('2026')
  }
  // Los procesos sin logs no salen.
  for (const process of HOST_PAGE_PROCESSES.filter((p) => !HOST_LOGS_IDS.includes(p.id))) {
    await expect(hostLogRow(process.id), process.name).toHaveCount(0)
  }

  // Estado, con texto (no el enum) y color: el fichero que se lee y el que no existe se distinguen.
  const ok = hostLogRow(HOST_PAGE_PROCESSES[2]!.id).getByTestId('host-log-status')
  const missing = hostLogRow(HOST_PAGE_PROCESSES[5]!.id).getByTestId('host-log-status')
  await expect(ok).toHaveAttribute('data-status', 'FILE_STATUS_OK')
  await expect(missing).toHaveAttribute('data-status', 'FILE_STATUS_NOT_EXIST')
  for (const status of [ok, missing]) {
    await expect(status).toHaveText(/\S/)
    await expect(status).not.toHaveText(/FILE_STATUS/)
  }
  expect(await ok.innerText()).not.toBe(await missing.innerText())
  const colorOf = (target: Locator): Promise<string> =>
    target.evaluate((element) => getComputedStyle(element).color)
  expect(await colorOf(ok), 'color de OK frente a NOT_EXIST').not.toBe(await colorOf(missing))

  // Antes de «Información».
  const info = hostInfoCard()
  await expect(info).toBeVisible()
  const logsBox = await settledBox(card)
  const infoBox = await settledBox(info)
  expect(logsBox.y + logsBox.height, '«Logs» encima de «Información»').toBeLessThanOrEqual(
    infoBox.y + 1
  )

  // Ninguna ruta de log en toda la página del host.
  await expectNoLogPaths(hostPage, 'página del host')

  // Pulsar un proceso abre su página.
  const link = hostLogRow(HOST_LOGS_PAGE.id).getByRole('link', { name: HOST_LOGS_PAGE.name })
  await clickInPlace(link, { scroll: true })
  const processPage = page.getByTestId('entity-page-process_group_instance')
  await expect(processPage).toBeVisible()
  expect(await currentRoute()).toBe(`/entities/PROCESS_GROUP_INSTANCE/${HOST_LOGS_PAGE.id}`)
  await expect(processPage.getByRole('heading', { level: 1 })).toHaveText(HOST_LOGS_PAGE.name)
  await expect(processPage.getByTestId('entity-page-id')).toHaveText(HOST_LOGS_PAGE.id)

  // Su «Información», con «Todas las propiedades» desplegada: sin rutas de log (sus properties
  // traen las mismas listas con rutas, como en vivo).
  const processCard = processInfoCard()
  await expect(processCard.getByTestId('process-info-row').first()).toBeVisible()
  const toggle = processCard.getByTestId('process-info-properties-toggle')
  await expect(toggle).toContainText('Todas las propiedades')
  await clickInPlace(toggle, { scroll: true })
  await expect(processInfoProperty('detectedName')).toContainText('proceso-logs-detectado-e2e')
  await expectNoLogPaths(processPage, 'página del proceso')
})

test('CA5 (0041): sin procesos con logs, la tarjeta dice «Sin logs detectados», sin aviso de error', async () => {
  sim.hostLogsEmpty = true
  await openHostPage()
  const card = hostLogsCard()
  await expect(card).toBeVisible()
  await expect(card).toContainText('Sin logs detectados')
  await expect(card.getByTestId('host-log-row')).toHaveCount(0)
  await expect(card.getByRole('alert')).toHaveCount(0)
  await expect(card.getByRole('button', { name: 'Reintentar' })).toHaveCount(0)
})

test('CA5 (0041): con el canal caído, la tarjeta «Logs» enseña el aviso con Reintentar y lo demás sigue; Reintentar la carga', async () => {
  sim.hostLogsFail = true
  await openHostPage()
  const card = hostLogsCard()
  await expect(card).toBeVisible()
  await expect(card.getByRole('alert').first()).toBeVisible()
  await expect(card.getByRole('button', { name: 'Reintentar' })).toBeVisible()
  await expect(card.getByTestId('host-log-row')).toHaveCount(0)
  // Marcadores y gráficos del host, con sus datos.
  await expectHostMarkerValues()
  expect(await hostChartSeries('cpu')).toHaveLength(HOST_CHART_SERIES.cpu.length)

  sim.hostLogsFail = false
  await clickInPlace(card.getByRole('button', { name: 'Reintentar' }), { scroll: true })
  await expect(card.getByTestId('host-log-row')).toHaveCount(3)
  await expect(card.getByTestId('host-logs-summary')).toHaveText('3 de 15 procesos con logs')
  await expect(card.getByRole('button', { name: 'Reintentar' })).toHaveCount(0)
})

test('Aviso del scope (0041): sin entities.read, la tarjeta «Logs» dice qué scope falta y no se pide nada', async () => {
  const tenants = await invoke<{ clients: { id: string; name: string }[] }>('tenants:list')
  const clientId = tenants.clients.find((client) => client.name === 'Cliente A')?.id ?? ''
  const noEntities = await createEnvironment(
    clientId,
    'Sin entidades logs',
    'other',
    TOKEN_NO_ENTITIES
  )
  try {
    await invoke('connection:test', { environmentId: noEntities })
    await invoke('environments:setActive', { environmentId: noEntities })
    await reloadUi()
    await goToRoute(`/entities/HOST/${HOST_METRICS_ID}`)
    await expect(page.getByTestId('entity-page-host')).toBeVisible()
    const unavailable = hostLogsCard().getByTestId('module-unavailable')
    await expect(unavailable).toBeVisible()
    await expect(unavailable).toContainText('entities.read')
    await expect(hostLogsCard().getByTestId('host-log-row')).toHaveCount(0)
    await settledRequests()
    expect(sim.hostLogsQueries, 'entities:hostLogs sin el scope').toHaveLength(0)
  } finally {
    await invoke('environments:setActive', { environmentId: env['Producción'] })
    await invoke('environments:delete', { id: noEntities })
    await reloadUi()
  }
})

/**
 * Ficha 0042: tarjeta «Eventos» en la página del host HOST_INFO_FULL_ID, canal
 * entities:hostEvents, con HOST_EVENTS (22 del host y de lo que corre en él; uno más de un
 * servicio, que no se pide).
 *
 * Nombres que fijan estos tests (decisión del test-writer, refinable; en la ficha): la tarjeta
 * `host-events`, antes de «Información» (`host-info`); dentro, «20 de N» en
 * `host-events-summary` y una fila `host-event-row` por evento (del más reciente al más antiguo)
 * con el tipo en una píldora (`host-event-type`), el título (`host-event-title`), la entidad
 * (`host-event-entity`: enlace a su página si su tipo tiene página, texto si no), el inicio
 * (`host-event-start`), el fin o «Activo» (`host-event-end`) y el estado (`host-event-status`,
 * con `data-status`, el de Dynatrace). Sin el scope, `module-unavailable` dentro de la tarjeta.
 */
const hostEventsCard = (): Locator => page.getByTestId('host-events')
const hostEventRows = (): Locator => hostEventsCard().getByTestId('host-event-row')
const hostEventEntity = (n: number): Locator =>
  hostEventRows()
    .nth(n - 1)
    .getByTestId('host-event-entity')

test('CA5 (0042): la tarjeta «Eventos» del host enseña los 20 más recientes del host y de lo que corre en él, con enlaces; «20 de 22»', async () => {
  await openHostInfo(HOST_EVENTS_HOST)
  const card = hostEventsCard()
  await expect(card).toBeVisible()
  await expect(hostEventRows()).toHaveCount(20)
  await expect(card.getByTestId('host-events-summary')).toContainText('20 de 22')

  // La consulta: eventSelector con el host y sus relacionados, sin los que no entran. Solo las
  // de este host: una recarga del test anterior puede dejar una consulta tardía de otro.
  const queries = sim.hostEventsQueries.filter((query) =>
    (hostEventsSelectorIds(query) ?? []).includes(HOST_EVENTS_HOST)
  )
  expect(queries.length).toBeGreaterThan(0)
  const asked = queries.flatMap((query) => hostEventsSelectorIds(query) ?? [])
  expect([...new Set(asked)].sort()).toEqual([...HOST_EVENTS_IDS].sort())
  for (const id of HOST_EVENTS_EXCLUDED) expect(asked, id).not.toContain(id)
  for (const query of queries) {
    expect(query.has('optionalEntitySelector')).toBe(false)
    expect(query.has('entitySelector')).toBe(false)
    expect(query.get('from')).toBe('now-2h')
  }

  // Del más reciente al más antiguo: los eventos 1 a 20; el del servicio no sale.
  const titles = await hostEventRows().getByTestId('host-event-title').allTextContents()
  expect(titles.map((title) => title.trim())).toEqual(
    Array.from({ length: 20 }, (_, i) => hostEventTitle(i + 1))
  )
  await expect(card).not.toContainText('Evento e2e 0')
  await expect(card).not.toContainText('servicio-host-e2e')

  // El título con HTML se ve como texto: ni negrita ni imagen dentro de la tarjeta.
  await expect(hostEventRows().nth(1).getByTestId('host-event-title')).toHaveText(
    HOST_EVENTS_HTML_TITLE
  )
  await expect(card.locator('b, img')).toHaveCount(0)

  // Cada fila: tipo en su píldora, inicio, fin o «Activo», y estado.
  for (const n of [1, 5]) {
    const row = hostEventRows().nth(n - 1)
    await expect(row.getByTestId('host-event-type'), `tipo del ${n}`).toHaveText(/\S/)
    await expect(row.getByTestId('host-event-start'), `inicio del ${n}`).toHaveText(/\d/)
    await expect(row.getByTestId('host-event-status'), `estado del ${n}`).toHaveAttribute(
      'data-status',
      n === 5 ? 'OPEN' : 'CLOSED'
    )
  }
  await expect(hostEventRows().nth(4).getByTestId('host-event-end')).toHaveText('Activo')
  await expect(hostEventRows().nth(0).getByTestId('host-event-end')).toHaveText(/\d/)
  await expect(hostEventRows().nth(0).getByTestId('host-event-end')).not.toHaveText('Activo')

  // La entidad: enlace a su página si su tipo la tiene (host, proceso, disco); la EC2, texto.
  await expect(hostEventEntity(2).getByRole('link', { name: 'proceso-host-1' })).toHaveAttribute(
    'href',
    new RegExp(`#/entities/PROCESS_GROUP_INSTANCE/${HOST_INFO_PGIS[0]}$`)
  )
  await expect(
    hostEventEntity(4).getByRole('link', { name: HOST_EVENTS_DISK_NAME })
  ).toHaveAttribute('href', new RegExp(`#/entities/DISK/${HOST_INFO_DISK}$`))
  await expect(hostEventEntity(5)).toContainText('instancia-e2e')
  await expect(hostEventEntity(5).getByRole('link')).toHaveCount(0)

  // Antes de «Información».
  const eventsBox = await settledBox(card)
  const infoBox = await settledBox(hostInfoCard())
  expect(eventsBox.y + eventsBox.height, '«Eventos» encima de «Información»').toBeLessThanOrEqual(
    infoBox.y + 1
  )

  // Pulsar la entidad de un evento abre su página.
  await clickInPlace(hostEventEntity(3).getByRole('link', { name: 'proceso-host-2' }), {
    scroll: true
  })
  await expect.poll(currentRoute).toBe(`/entities/PROCESS_GROUP_INSTANCE/${HOST_INFO_PGIS[1]}`)
})

test('CA5 (0042): con el canal caído, la tarjeta «Eventos» enseña el aviso con Reintentar y lo demás sigue; Reintentar la carga', async () => {
  sim.hostEventsFail = true
  await openHostInfo(HOST_EVENTS_HOST)
  const card = hostEventsCard()
  await expect(card).toBeVisible()
  await expect(card.getByRole('alert').first()).toBeVisible()
  await expect(card.getByRole('button', { name: 'Reintentar' })).toBeVisible()
  await expect(hostEventRows()).toHaveCount(0)
  // La «Información» del host sigue con sus datos.
  await expect(hostInfoValue('osType')).toContainText('LINUX')

  sim.hostEventsFail = false
  await clickInPlace(card.getByRole('button', { name: 'Reintentar' }), { scroll: true })
  await expect(hostEventRows()).toHaveCount(20)
  await expect(card.getByTestId('host-events-summary')).toContainText('20 de 22')
  await expect(card.getByRole('button', { name: 'Reintentar' })).toHaveCount(0)
})

test('CA5 (0042): sin events.read, la tarjeta «Eventos» dice qué scope falta y no se pide nada', async () => {
  const tenants = await invoke<{ clients: { id: string; name: string }[] }>('tenants:list')
  const clientId = tenants.clients.find((client) => client.name === 'Cliente A')?.id ?? ''
  const noEvents = await createEnvironment(clientId, 'Sin eventos', 'other', TOKEN_NO_EVENTS)
  try {
    await invoke('connection:test', { environmentId: noEvents })
    await invoke('environments:setActive', { environmentId: noEvents })
    await reloadUi()
    await goToRoute(`/entities/HOST/${HOST_EVENTS_HOST}`)
    await expect(page.getByTestId('entity-page-host')).toBeVisible()
    const unavailable = hostEventsCard().getByTestId('module-unavailable')
    await expect(unavailable).toBeVisible()
    await expect(unavailable).toContainText('events.read')
    await expect(hostEventRows()).toHaveCount(0)
    // La «Información» del host no depende de events.read.
    await expect(hostInfoValue('osType')).toContainText('LINUX')
    await settledRequests()
    expect(sim.hostEventsQueries, 'entities:hostEvents sin el scope').toHaveLength(0)
  } finally {
    await invoke('environments:setActive', { environmentId: env['Producción'] })
    await invoke('environments:delete', { id: noEvents })
    await reloadUi()
  }
})
