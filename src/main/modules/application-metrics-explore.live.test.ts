import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createLiveClient } from '../../test/live-client'
import { loadLiveEnv } from '../../test/live-env'
import { DtError } from '../dynatrace/errors'

/**
 * Ficha 0033, paso 0: EXPLORACIÓN EN VIVO de las métricas de una aplicación web
 * (APPLICATION, RUM). SOLO LECTURA, una petición detrás de otra.
 *
 * 1. Catálogo: `GET /metrics?metricSelector=builtin:apps.web.*` (comodín final, OpenAPI v2)
 *    con unidad, agregaciones y dimensiones.
 * 2. Como mucho 3 aplicaciones de los problemas de los últimos 7 días o, si no hay,
 *    de `type("APPLICATION")` con `pageSize` 3.
 * 3. Qué métricas del catálogo tienen datos en `now-24h` para esas aplicaciones, con qué
 *    dimensiones y si llegan series de otras aplicaciones.
 * 4. Elección por papel con la regla de la 0022 (la primera candidata, en orden de
 *    preferencia, con datos).
 * 5. Por acción de usuario (`dt.entity.application_method`): selector, nombres y orden.
 * 6. Consultas exactas del canal.
 * 7. Entidad: claves de `properties` y nombres de relaciones de `GET /entities/{entityId}`.
 *
 * El informe (live-reports/application-metrics-explore.json, ignorado) guarda SOLO
 * comportamientos y claves de la API (métricas integradas, dimensiones, propiedades y
 * relaciones). Nunca un id, un nombre ni un valor. CA1 (0033) comprueba que no se cuela
 * ningún id ni nombre observado.
 */

const env = loadLiveEnv()
const live = env === null ? null : createLiveClient(env)
const report: Record<string, unknown> = {}
const timings: number[] = []
/** Ids y nombres observados: el informe no puede contener ninguno (CA1). */
const observed = new Set<string>()
/** De dónde sale un valor observado de las propiedades (para el mensaje de CA1, sin el valor). */
const sources = new Map<string, string>()
/** Anota un valor observado y de dónde sale. */
const note = (value: string, source: string): void => {
  if (isEnum(value)) return
  observed.add(value)
  if (!sources.has(value)) sources.set(value, source)
}
const MAX_APPS = 3
/** La API admite como mucho 10 expresiones por consulta de /metrics/query. */
const BATCH = 10
const FROM = 'now-24h'
const CATALOG_FIELDS =
  '+unit,+aggregationTypes,+defaultAggregation,+dimensionDefinitions,+entityType,+resolutionInfSupported,+transformations'
const ENTITY_FIELDS = '+properties,+fromRelationships,+toRelationships,+firstSeenTms,+lastSeenTms'
const PREFIX = 'builtin:apps.web.'
const APP_PATTERN = /^APPLICATION-[0-9A-F]{16}$/
const METHOD_PATTERN = /^APPLICATION_METHOD-[0-9A-F]{16}$/
const APP_DIM = 'dt.entity.application'
const METHOD_DIM = 'dt.entity.application_method'

type Raw = Record<string, unknown>
type Values = (number | null)[]

const isEnum = (value: string): boolean =>
  /^[A-Z][A-Z0-9_]*$/.test(value) || /^(true|false|null)$/.test(value)
const observe = (value: unknown): void => {
  if (typeof value === 'string' && !isEnum(value)) observed.add(value)
  if (typeof value === 'number' || value === null || value === undefined) return
  if (Array.isArray(value)) for (const item of value) observe(item)
  else if (typeof value === 'object') for (const item of Object.values(value as Raw)) observe(item)
}

interface CatalogEntry {
  metricId: string
  unit: unknown
  defaultAggregation: unknown
  aggregationTypes: unknown
  resolutionInfSupported: unknown
  transformations: unknown
  entityType: unknown
  dimensions: string[]
}

async function get(path: string, query: Record<string, string | number>): Promise<unknown> {
  if (live === null) throw new Error('sin .env.live.local')
  const started = Date.now()
  try {
    return await live.client.dtRequest({
      envId: 'live',
      api: 'classic',
      path,
      query,
      schema: z.unknown()
    })
  } finally {
    timings.push(Date.now() - started)
  }
}

/** Código del error, sin su mensaje (puede llevar el selector, con el id). */
async function codeOf(promise: Promise<unknown>): Promise<{ code: string; body: Raw | null }> {
  try {
    return { code: 'ok', body: (await promise) as Raw }
  } catch (error) {
    return {
      code:
        error instanceof DtError
          ? `${error.code}${error.status === undefined ? '' : ` ${error.status}`}`
          : 'NO_DT_ERROR',
      body: null
    }
  }
}

const bucket = (count: number): string =>
  count === 0
    ? '0'
    : count === 1
      ? '1'
      : count < 10
        ? '2-9'
        : count <= 10
          ? '10'
          : count <= 150
            ? '11-150'
            : count <= 1000
              ? '151-1000'
              : 'más de 1000'

/** Tramo de un valor (para unidades), nunca el valor. */
function range(value: number | null): string {
  if (value === null) return 'null'
  if (value < 0) return '< 0'
  if (value <= 1) return '[0, 1]'
  if (value <= 100) return '(1, 100]'
  if (value <= 1e6) return '(100, 1e6]'
  return '> 1e6'
}

function kindOf(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return `lista (${bucket(value.length)})`
  return typeof value === 'object' ? 'objeto' : typeof value
}

const typeOfId = (id: unknown): string =>
  typeof id === 'string' && /^[A-Z_]+-[0-9A-F]{16}$/.test(id) ? id.split('-')[0]! : 'otro'

const apiKey = (key: string): string => (/^[A-Za-z][A-Za-z0-9_.:-]*$/.test(key) ? key : 'otra')

const dimKey = (key: string): string =>
  /^[A-Za-z][A-Za-z0-9_.: ()-]{0,40}$/.test(key) ? key : 'otra'

/**
 * Dimensiones de texto de RUM cuyos valores fija Dynatrace («Real users», «JavaScript error»…):
 * de estas se guardan las palabras cortas; de las demás, solo los valores de enumeración.
 */
const STANDARD_DIMENSIONS = new Set([
  'User type',
  'Users',
  'Error type',
  'Error origin',
  'Error context',
  'Action type',
  'Apdex category'
])

/**
 * Valor de una dimensión de texto, solo si es de enumeración (mayúsculas), un código numérico o,
 * en las dimensiones estándar de RUM, unas pocas palabras; si no, `otro`.
 */
const enumValue = (value: unknown, dimension = ''): string =>
  typeof value === 'string' &&
  (isEnum(value) ||
    /^\d{1,4}$/.test(value) ||
    (STANDARD_DIMENSIONS.has(dimension.replace(/\.name$/, '')) &&
      /^[A-Za-z][A-Za-z]{0,15}( [A-Za-z]{1,15}){0,2}$/.test(value)))
    ? value
    : 'otro'

function compare(a: number | null, b: number | null): string {
  if (a === null || b === null) return a === b ? 'los dos null' : 'uno null'
  if (a === b) return 'iguales'
  const scale = Math.max(Math.abs(a), Math.abs(b))
  const diff = Math.abs(a - b) / scale
  return diff < 1e-6 ? 'iguales (redondeo)' : diff < 0.01 ? 'casi (< 1 %)' : 'distintos (≥ 1 %)'
}

const ratioBucket = (value: unknown): string =>
  typeof value !== 'number'
    ? 'sin campo'
    : value < 0.01
      ? '< 0.01'
      : value < 1
        ? '[0.01, 1)'
        : value === 1
          ? '1'
          : '> 1'

const present = (values: Values): number[] => values.filter((v): v is number => v !== null)
const mean = (values: Values): number | null => {
  const p = present(values)
  return p.length === 0 ? null : p.reduce((a, b) => a + b, 0) / p.length
}
const sumOf = (values: Values): number | null => {
  const p = present(values)
  return p.length === 0 ? null : p.reduce((a, b) => a + b, 0)
}

/**
 * Papeles de la ficha y sus candidatas, en orden de preferencia. Se toman solo las que estén
 * en el catálogo; si ninguna está, las del catálogo cuyo id case con el patrón del papel.
 */
const W = PREFIX
const ROLES: Record<string, { candidates: string[]; pattern: RegExp }> = {
  apdex: {
    candidates: [`${W}apdex.userType`, `${W}apdex.userType.geo`, `${W}apdex.osAndVersion`],
    pattern: /apdex/i
  },
  acciones: {
    candidates: [
      `${W}actionCount.summary`,
      `${W}actionCount.category`,
      `${W}actionCount.load.browser`
    ],
    pattern: /actionCount|action\.count/i
  },
  duracion: {
    candidates: [
      `${W}visuallyComplete.load.browser`,
      `${W}actionDuration.load.browser`,
      `${W}actionDuration.xhr.browser`,
      `${W}actionDuration.custom.browser`
    ],
    pattern: /visuallyComplete|actionDuration|action\.duration/i
  },
  // Errores de JavaScript y de peticiones: countOfErrors los trae todos, con «Error type».
  errores: {
    candidates: [
      `${W}countOfErrors`,
      `${W}jsErrorsDuringUa`,
      `${W}jsErrorsWithoutUa`,
      `${W}countOfErrorsDuringUserActions`
    ],
    pattern: /error/i
  },
  // Sesiones empezadas: su suma en el rango es el número de sesiones (las activas no se suman).
  sesionesOUsuarios: {
    candidates: [`${W}startedSessions`, `${W}activeSessions`, `${W}activeUsersEst`],
    pattern: /session|users/i
  },
  duracionPorAccion: {
    candidates: [
      `${W}action.duration.load.browser`,
      `${W}action.visuallyComplete.load.browser`,
      `${W}action.duration.xhr.browser`,
      `${W}action.duration.custom.browser`
    ],
    pattern: /^builtin:apps\.web\.action\.(duration|visuallyComplete)/i
  },
  recuentoPorAccion: {
    candidates: [
      `${W}action.count.load.browser`,
      `${W}action.count.xhr.browser`,
      `${W}action.count.custom.browser`,
      `${W}action.count.summary`
    ],
    pattern: /^builtin:apps\.web\.action\.count/i
  }
}

const catalog: CatalogEntry[] = []
const apps: string[] = []
/** Métrica → por aplicación: ¿tiene datos? */
const withData = new Map<string, { data: boolean; detail: Raw }[]>()
/** Lo mismo para las métricas por acción (sobre las acciones de la aplicación). */
const actionData = new Map<string, boolean[]>()
const hasData = (key: string): boolean =>
  (withData.get(key) ?? []).some((row) => row.data) || (actionData.get(key) ?? []).some(Boolean)

/** Acciones de usuario de una aplicación (la relación `isApplicationMethodOf` de la entidad). */
const methodsOf = (id: string): string =>
  `type("APPLICATION_METHOD"),fromRelationships.isApplicationMethodOf(entityId("${id}"))`
const BY_METHOD = 'splitBy("dt.entity.application_method")'
const ACTION_TYPES = ['load', 'xhr', 'custom'] as const
/** Las 10 acciones con más volumen de cada tipo (el orden, por recuento, antes de la agregación). */
const TOP = 'sort(value(count,descending)):limit(10)'

/**
 * Consultas que usará el canal, elegidas con lo de abajo. Series de la aplicación (sin
 * `resolution`) y sus totales (las mismas con `resolution=Inf`: la media ponderada en Apdex y
 * duración; en los recuentos, a menos del 1 % de la suma de la serie), con `entityId(...)`.
 */
const CHANNEL_SERIES = [
  `${W}apdex.userType:splitBy():avg`,
  `${W}actionCount.summary:splitBy():sum`,
  `${W}visuallyComplete.load.browser:splitBy():avg`,
  `${W}countOfErrors:splitBy():sum`,
  `${W}startedSessions:splitBy():sum`
]
/**
 * Las 10 acciones de más volumen de cada tipo, con su recuento (`:count` de la duración, igual al
 * de `action.count.*`) y su duración media, con `resolution=Inf` y el selector de las acciones.
 */
const CHANNEL_ACTIONS = ACTION_TYPES.flatMap((type) => [
  `${W}action.duration.${type}.browser:${BY_METHOD}:${TOP}:count:names`,
  `${W}action.duration.${type}.browser:${BY_METHOD}:${TOP}:avg:names`
])

/**
 * Expresiones candidatas de la aplicación, por papel (con `entitySelector=entityId(...)`): se
 * comparan las series (resolución de la API) con `resolution=Inf`.
 */
const APP_FORMS: Record<string, string[]> = {
  apdex: [
    `${W}apdex.userType:splitBy()`,
    `${W}apdex.userType:splitBy():avg`,
    `${W}apdex.userType:filter(eq("User type","Real users")):splitBy():avg`
  ],
  acciones: [
    `${W}actionCount.summary:splitBy()`,
    `${W}actionCount.summary:splitBy():sum`,
    `${W}actionCount.summary:splitBy():value`,
    `${W}actionCount.category:splitBy()`
  ],
  duracion: [
    `${W}visuallyComplete.load.browser:splitBy():avg`,
    `${W}visuallyComplete.load.browser:splitBy():median`,
    `${W}actionDuration.load.browser:splitBy():avg`,
    `${W}actionDuration.xhr.browser:splitBy():avg`
  ],
  errores: [
    `${W}countOfErrors:splitBy()`,
    `${W}countOfErrors:splitBy():sum`,
    `${W}countOfErrors:splitBy():value`,
    `${W}countOfErrors:splitBy("Error type")`
  ],
  sesiones: [
    `${W}startedSessions:splitBy()`,
    `${W}startedSessions:splitBy():sum`,
    `${W}startedSessions:splitBy():value`,
    `${W}activeSessions:splitBy()`
  ]
}

afterAll(() => {
  if (live === null || env === null) return
  const sorted = [...timings].sort((a, b) => a - b)
  report['tiempos'] = {
    peticiones: sorted.length,
    medianaMs: sorted[Math.floor(sorted.length / 2)] ?? null,
    maxMs: sorted.at(-1) ?? null
  }
  report['tokenEnLog'] = live.logged.some((line) => line.includes(env.token))
  mkdirSync('live-reports', { recursive: true })
  writeFileSync(
    join('live-reports', 'application-metrics-explore.json'),
    `${JSON.stringify(report, null, 2)}\n`
  )
})

interface SeriesItem {
  dimensionMap: Record<string, unknown>
  timestamps: number[]
  values: Values
}

/** Una consulta de /metrics/query: código, resolución, ratios y series por expresión. */
async function query(
  metricSelector: string,
  extra: Record<string, string>
): Promise<{
  code: string
  resolution: unknown
  results: { metricId: unknown; ratios: string[]; data: SeriesItem[] }[]
}> {
  const { code, body } = await codeOf(
    get('/metrics/query', { metricSelector, from: FROM, ...extra })
  )
  const results = ((body?.['result'] as Raw[] | undefined) ?? []).map((r) => {
    const data = ((r['data'] as Raw[] | undefined) ?? []).map((d) => ({
      dimensionMap: (d['dimensionMap'] as Record<string, unknown> | undefined) ?? {},
      timestamps: (d['timestamps'] as number[] | undefined) ?? [],
      values: (d['values'] as Values | undefined) ?? []
    }))
    // Ids y nombres de entidades (`dt.entity.*`). Las demás de texto, y su `.name`
    // («Synthetic» de User type, navegadores…) son valores de Dynatrace, no del tenant, y el
    // informe solo guarda los de enumeración (`enumValue`).
    for (const item of data) {
      for (const [key, value] of Object.entries(item.dimensionMap)) {
        // Los nombres de navegadores y de geolocalizaciones son del catálogo de Dynatrace
        // («Synthetic monitor» coincide con un User type): de esas, solo el id.
        if (/^dt\.entity\.(browser|geolocation)\.name$/.test(key)) continue
        if (key.startsWith('dt.entity.') && typeof value === 'string')
          note(value, `dimension ${dimKey(key)}`)
      }
    }
    return {
      metricId: r['metricId'],
      ratios: [ratioBucket(r['dataPointCountRatio']), ratioBucket(r['dimensionCountRatio'])],
      data
    }
  })
  return { code, resolution: body?.['resolution'] ?? null, results }
}

const keysOf = (data: SeriesItem[]): string[] =>
  [...new Set(data.flatMap((d) => Object.keys(d.dimensionMap).map(dimKey)))].sort()

/** ¿Alguna serie es de otra aplicación (dimensión de aplicación distinta de la pedida)? */
const otherApps = (data: SeriesItem[], id: string): number =>
  data.filter((d) => d.dimensionMap[APP_DIM] !== undefined && d.dimensionMap[APP_DIM] !== id).length

/** Rutas del informe cuyo texto contiene un valor (para el mensaje de CA1, sin el valor). */
function pathsOf(value: unknown, needle: string, path = ''): string[] {
  if (typeof value === 'string') return value.includes(needle) ? [path] : []
  if (Array.isArray(value))
    return value.flatMap((item, i) => pathsOf(item, needle, `${path}[${i}]`))
  if (value !== null && typeof value === 'object')
    return Object.entries(value as Raw).flatMap(([key, item]) => [
      ...(key.includes(needle) ? [`${path}.<clave ${apiKey(key)}>`] : []),
      ...pathsOf(item, needle, `${path}.${key}`)
    ])
  return []
}

describe.skipIf(live === null)('Ficha 0033: métricas de una aplicación web (paso 0)', () => {
  it('catálogo de builtin:apps.web.*', async () => {
    const { code, body } = await codeOf(
      get('/metrics', { metricSelector: `${PREFIX}*`, fields: CATALOG_FIELDS, pageSize: 500 })
    )
    const metrics = ((body?.['metrics'] as Raw[] | undefined) ?? []).filter((m) =>
      String(m['metricId']).startsWith(PREFIX)
    )
    for (const m of metrics) {
      catalog.push({
        metricId: String(m['metricId']),
        unit: m['unit'] ?? null,
        defaultAggregation: (m['defaultAggregation'] as Raw | null)?.['type'] ?? null,
        aggregationTypes: m['aggregationTypes'] ?? null,
        resolutionInfSupported: m['resolutionInfSupported'] ?? null,
        transformations: m['transformations'] ?? null,
        entityType: m['entityType'] ?? null,
        dimensions: ((m['dimensionDefinitions'] as Raw[] | undefined) ?? []).map(
          (d) => `${dimKey(String(d['key']))} (${String(d['type'])})`
        )
      })
    }
    report['catalogo'] = {
      codigo: code,
      totalCount: body?.['totalCount'] ?? null,
      masPaginas: body?.['nextPageKey'] !== null && body?.['nextPageKey'] !== undefined,
      metricas: catalog
    }
    expect(catalog.length).toBeGreaterThan(0)
  })

  it('elige como mucho 3 aplicaciones', async () => {
    const list = (await get('/problems', { from: 'now-7d', pageSize: 100 })) as Raw
    for (const problem of (list['problems'] as Raw[] | undefined) ?? []) {
      observed.add(String(problem['problemId']))
      observed.add(String(problem['displayId']))
      if (typeof problem['title'] === 'string') note(problem['title'], 'problems.title')
      const entities = [
        ...((problem['affectedEntities'] as Raw[] | undefined) ?? []),
        ...((problem['impactedEntities'] as Raw[] | undefined) ?? [])
      ]
      for (const entity of entities) {
        const id = (entity['entityId'] as Raw | undefined)?.['id']
        if (typeof entity['name'] === 'string') note(entity['name'], 'problems.entidad.name')
        if (typeof id !== 'string') continue
        observed.add(id)
        if (APP_PATTERN.test(id) && !apps.includes(id)) apps.push(id)
      }
    }
    const fromProblems = Math.min(apps.length, MAX_APPS)
    if (apps.length < MAX_APPS) {
      const page = (await get('/entities', {
        entitySelector: 'type("APPLICATION")',
        from: 'now-7d',
        pageSize: MAX_APPS
      })) as Raw
      for (const entity of (page['entities'] as Raw[] | undefined) ?? []) {
        const id = String(entity['entityId'])
        observed.add(id)
        if (typeof entity['displayName'] === 'string')
          note(entity['displayName'], 'entities.displayName')
        if (!apps.includes(id)) apps.push(id)
      }
    }
    apps.splice(MAX_APPS)
    report['aplicaciones'] = {
      deProblemas: fromProblems,
      deEntities: apps.length - fromProblems,
      formatoDelId: apps.every((id) => APP_PATTERN.test(id))
    }
    expect(apps.length).toBeGreaterThan(0)
  })

  it('qué métricas del catálogo tienen datos en now-24h y con qué dimensiones', async () => {
    const keys = catalog.map((m) => m.metricId)
    for (const [index, id] of apps.entries()) {
      for (let start = 0; start < keys.length; start += BATCH) {
        const chunk = keys.slice(start, start + BATCH)
        const scope = { entitySelector: `entityId("${id}")`, resolution: 'Inf' }
        const batch = await query(chunk.map((key) => `${key}:names`).join(','), scope)
        const rows: { key: string; code: string; data: SeriesItem[] }[] = []
        if (batch.code === 'ok') {
          chunk.forEach((key, i) =>
            rows.push({ key, code: 'ok', data: batch.results[i]?.data ?? [] })
          )
        } else {
          for (const key of chunk) {
            const one = await query(`${key}:names`, { entitySelector: `entityId("${id}")` })
            rows.push({
              key,
              code: `tanda ${batch.code}; sola ${one.code}`,
              data: one.results[0]?.data ?? []
            })
          }
        }
        for (const { key, code, data } of rows) {
          const values = data.flatMap((d) => present(d.values))
          const strings: Record<string, string[]> = {}
          for (const item of data) {
            for (const [dimension, value] of Object.entries(item.dimensionMap)) {
              if (dimension.startsWith('dt.entity.')) continue
              const set = new Set(strings[dimKey(dimension)] ?? [])
              set.add(enumValue(value, dimension))
              strings[dimKey(dimension)] = [...set].sort()
            }
          }
          const list = withData.get(key) ?? []
          list.push({
            data: values.length > 0,
            detail: {
              aplicacion: `#${index + 1}`,
              codigo: code,
              series: bucket(data.length),
              seriesDeOtrasAplicaciones: bucket(otherApps(data, id)),
              clavesDeDimensionMap: keysOf(data),
              valoresDeTexto: strings,
              tramoMaximo: range(values.length === 0 ? null : Math.max(...values)),
              tramoMinimo: range(values.length === 0 ? null : Math.min(...values))
            }
          })
          withData.set(key, list)
        }
      }
    }
    report['datos'] = Object.fromEntries(
      [...withData.entries()].map(([key, list]) => [
        key,
        {
          conDatosEn: `${list.filter((r) => r.data).length} de ${list.length}`,
          porAplicacion: list.map((r) => r.detail)
        }
      ])
    )
  })

  it('formas candidatas de la aplicación: series frente a resolution=Inf', async () => {
    const out: Record<string, unknown[]> = {}
    for (const [index, id] of apps.entries()) {
      for (const [role, expressions] of Object.entries(APP_FORMS)) {
        const scope = { entitySelector: `entityId("${id}")` }
        const series = await query(expressions.join(','), scope)
        const inf = await query(expressions.join(','), { ...scope, resolution: 'Inf' })
        const rows = out[role] ?? []
        rows.push({
          aplicacion: `#${index + 1}`,
          codigoSeries: series.code,
          codigoInf: inf.code,
          resolution: series.resolution,
          porExpresion: expressions.map((expression, i) => {
            const s = series.results[i]
            const f = inf.results[i]
            const values = s?.data[0]?.values ?? []
            const infValue = f?.data[0]?.values[0] ?? null
            return {
              expresion: expression,
              metricIdIgualAlPedido: s?.metricId === expression,
              seriesEnSeries: bucket(s?.data.length ?? 0),
              seriesEnInf: bucket(f?.data.length ?? 0),
              clavesDeDimensionMap: keysOf(s?.data ?? []),
              valoresDeTexto: [
                ...new Set(
                  (s?.data ?? []).flatMap((d) =>
                    Object.entries(d.dimensionMap)
                      .filter(([key]) => !key.startsWith('dt.entity.'))
                      .map(([key, value]) => `${dimKey(key)}=${enumValue(value, key)}`)
                  )
                )
              ].sort(),
              puntos: bucket(values.length),
              nulos: `${values.length - present(values).length} de ${values.length}`,
              ultimoNull: (values.at(-1) ?? null) === null,
              tramo: range(present(values).length === 0 ? null : Math.max(...present(values))),
              infFrenteASuma: compare(infValue, sumOf(values)),
              infFrenteAMedia: compare(infValue, mean(values)),
              infFrenteAlInfDeLaPrimera: compare(
                infValue,
                inf.results[0]?.data[0]?.values[0] ?? null
              ),
              ratios: s?.ratios ?? []
            }
          })
        })
        out[role] = rows
      }
    }
    report['formasDeLaAplicacion'] = out
  })

  it('por acción: selector de las acciones, recuento, duración, nombres y las 10 de más volumen', async () => {
    const rows: unknown[] = []
    for (const [index, id] of apps.entries()) {
      const selector = methodsOf(id)
      const entities = await codeOf(
        get('/entities', { entitySelector: selector, from: FROM, pageSize: 1 })
      )
      const total = entities.body?.['totalCount']
      const out: Record<string, unknown> = {
        aplicacion: `#${index + 1}`,
        codigoEntities: entities.code,
        acciones: bucket(typeof total === 'number' ? total : 0)
      }
      for (const type of ACTION_TYPES) {
        const count = `${W}action.count.${type}.browser`
        const duration = `${W}action.duration.${type}.browser`
        const forms: Record<string, string> = {
          recuento: `${count}:${BY_METHOD}:names`,
          duracionMedia: `${duration}:${BY_METHOD}:avg:names`,
          duracionCount: `${duration}:${BY_METHOD}:count:names`,
          topRecuento: `${count}:${BY_METHOD}:sort(value(auto,descending)):limit(10):names`,
          topDuracionCount: `${duration}:${BY_METHOD}:${TOP}:count:names`,
          topDuracionMedia: `${duration}:${BY_METHOD}:${TOP}:avg:names`
        }
        const result = await query(Object.values(forms).join(','), {
          entitySelector: selector,
          resolution: 'Inf'
        })
        const byLabel = Object.fromEntries(
          Object.keys(forms).map((label, i) => [label, result.results[i]?.data ?? []])
        )
        const mapOf = (data: SeriesItem[]): Map<string, number | null> =>
          new Map(data.map((d) => [String(d.dimensionMap[METHOD_DIM]), d.values[0] ?? null]))
        const counts = mapOf(byLabel['recuento'] ?? [])
        const durationCounts = mapOf(byLabel['duracionCount'] ?? [])
        const topCount = byLabel['topDuracionCount'] ?? []
        const topMean = byLabel['topDuracionMedia'] ?? []
        const sortedCounts = [...counts.values()]
          .filter((v): v is number => v !== null)
          .sort((a, b) => b - a)
        for (const key of [count, duration]) {
          const flags = actionData.get(key) ?? []
          flags.push(
            (key === count ? byLabel['recuento'] : byLabel['duracionMedia'])?.some(
              (d) => d.values[0] !== null && d.values[0] !== undefined
            ) ?? false
          )
          actionData.set(key, flags)
        }
        out[type] = {
          codigo: result.code,
          porForma: Object.fromEntries(
            Object.entries(forms).map(([label, expression], i) => [
              label,
              {
                metricIdIgualAlPedido: result.results[i]?.metricId === expression,
                series: bucket(result.results[i]?.data.length ?? 0),
                clavesDeDimensionMap: keysOf(result.results[i]?.data ?? []),
                todasConIdDeAccion: (result.results[i]?.data ?? []).every((d) =>
                  METHOD_PATTERN.test(String(d.dimensionMap[METHOD_DIM]))
                ),
                todasConNombre: (result.results[i]?.data ?? []).every(
                  (d) => typeof d.dimensionMap[`${METHOD_DIM}.name`] === 'string'
                ),
                ratios: result.results[i]?.ratios ?? []
              }
            ])
          ),
          countDeLaDuracionFrenteAlRecuento: [
            ...new Set(
              [...counts.entries()].map(([method, value]) =>
                compare(value, durationCounts.get(method) ?? null)
              )
            )
          ].sort(),
          mismasAccionesEnRecuentoYDuracion:
            counts.size === durationCounts.size &&
            [...counts.keys()].every((method) => durationCounts.has(method)),
          topMismasAccionesEnCountYMedia:
            topCount.length === topMean.length &&
            topCount.every(
              (d, i) => d.dimensionMap[METHOD_DIM] === topMean[i]?.dimensionMap[METHOD_DIM]
            ),
          topOrdenadoDeMasAMenos: topCount.every(
            (d, i) => i === 0 || (d.values[0] ?? -1) <= (topCount[i - 1]?.values[0] ?? Infinity)
          ),
          topSonLasDeMasRecuento:
            topCount.length === Math.min(10, sortedCounts.length) &&
            topCount.every((d) => sortedCounts.slice(0, 10).includes(d.values[0] ?? -1)),
          topCountFrenteASuRecuento: [
            ...new Set(
              topCount.map((d) =>
                compare(d.values[0] ?? null, counts.get(String(d.dimensionMap[METHOD_DIM])) ?? null)
              )
            )
          ].sort()
        }
      }
      rows.push(out)
    }
    report['porAccion'] = rows
  })

  it('consultas exactas del canal (series, totales y las 10 acciones)', async () => {
    const rows: unknown[] = []
    for (const [index, id] of apps.entries()) {
      const scope = { entitySelector: `entityId("${id}")` }
      const series = await query(CHANNEL_SERIES.join(','), scope)
      const totals = await query(CHANNEL_SERIES.join(','), { ...scope, resolution: 'Inf' })
      const actions = await query(CHANNEL_ACTIONS.join(','), {
        entitySelector: methodsOf(id),
        resolution: 'Inf'
      })
      // Con 7 días: ¿aparecen más acciones? (las métricas por acción solo traen algunas).
      const week = await query(CHANNEL_ACTIONS.join(','), {
        entitySelector: methodsOf(id),
        resolution: 'Inf',
        from: 'now-7d'
      })
      const methods = await codeOf(
        get('/entities', { entitySelector: methodsOf(id), from: FROM, pageSize: 1 })
      )
      const countIn = (result: typeof actions): number =>
        ACTION_TYPES.reduce((n, _type, t) => n + (result.results[2 * t]?.data.length ?? 0), 0)
      rows.push({
        aplicacion: `#${index + 1}`,
        accionesConDatos: {
          entidadesDeAccion: bucket(Number(methods.body?.['totalCount'] ?? 0)),
          en24h: bucket(countIn(actions)),
          en7d: bucket(countIn(week))
        },
        series: {
          codigo: series.code,
          resolution: series.resolution,
          porExpresion: CHANNEL_SERIES.map((expression, i) => ({
            expresion: expression,
            metricIdIgualAlPedido: series.results[i]?.metricId === expression,
            series: bucket(series.results[i]?.data.length ?? 0),
            clavesDeDimensionMap: keysOf(series.results[i]?.data ?? [])
          }))
        },
        totales: {
          codigo: totals.code,
          porExpresion: CHANNEL_SERIES.map((expression, i) => {
            const values = series.results[i]?.data[0]?.values ?? []
            const value = totals.results[i]?.data[0]?.values[0] ?? null
            return {
              expresion: expression,
              metricIdIgualAlPedido: totals.results[i]?.metricId === expression,
              series: bucket(totals.results[i]?.data.length ?? 0),
              frenteALaSumaDeLaSerie: compare(value, sumOf(values)),
              frenteALaMediaDeLaSerie: compare(value, mean(values))
            }
          })
        },
        acciones: {
          codigo: actions.code,
          porExpresion: CHANNEL_ACTIONS.map((expression, i) => ({
            expresion: expression,
            metricIdIgualAlPedido: actions.results[i]?.metricId === expression,
            series: bucket(actions.results[i]?.data.length ?? 0),
            puntos: [...new Set((actions.results[i]?.data ?? []).map((d) => d.values.length))],
            todasConNombre: (actions.results[i]?.data ?? []).every(
              (d) => typeof d.dimensionMap[`${METHOD_DIM}.name`] === 'string'
            )
          })),
          // Cada pareja (recuento y media del mismo tipo) trae las mismas acciones, en el mismo orden.
          parejasAlineadas: ACTION_TYPES.map((_type, t) => {
            const count = actions.results[2 * t]?.data ?? []
            const avg = actions.results[2 * t + 1]?.data ?? []
            return (
              count.length === avg.length &&
              count.every((d, i) => d.dimensionMap[METHOD_DIM] === avg[i]?.dimensionMap[METHOD_DIM])
            )
          }),
          // ¿Una acción sale en más de un tipo?
          accionesEnVariosTipos: (() => {
            const seen = new Map<string, number>()
            for (const t of ACTION_TYPES.keys()) {
              for (const d of actions.results[2 * t]?.data ?? []) {
                const method = String(d.dimensionMap[METHOD_DIM])
                seen.set(method, (seen.get(method) ?? 0) + 1)
              }
            }
            return [...seen.values()].filter((n) => n > 1).length
          })()
        }
      })
    }
    report['canal'] = { series: CHANNEL_SERIES, acciones: CHANNEL_ACTIONS, porAplicacion: rows }
  })

  it('elección por papel: la primera candidata, en orden de preferencia, con datos', () => {
    const table: Record<string, unknown> = {}
    const known = new Set(catalog.map((m) => m.metricId))
    for (const [role, { candidates, pattern }] of Object.entries(ROLES)) {
      const listed = candidates.filter((key) => known.has(key))
      const fallback = catalog.map((m) => m.metricId).filter((key) => pattern.test(key))
      const ordered = [...listed, ...fallback.filter((key) => !listed.includes(key))]
      const chosen = ordered.find(hasData)
      const entry = catalog.find((m) => m.metricId === chosen)
      table[role] =
        chosen === undefined || entry === undefined
          ? { metrica: null, candidatasEnCatalogo: ordered }
          : {
              metrica: chosen,
              unidad: entry.unit,
              agregacionPorDefecto: entry.defaultAggregation,
              agregaciones: entry.aggregationTypes,
              dimensiones: entry.dimensions,
              deLaListaDePreferencia: listed.includes(chosen),
              otrasConDatos: ordered.filter((key) => key !== chosen && hasData(key))
            }
    }
    report['eleccion'] = table
  })

  it('entidad: claves de properties y relaciones de GET /entities/{entityId}', async () => {
    const rows: unknown[] = []
    for (const [index, id] of apps.entries()) {
      const { code, body } = await codeOf(get(`/entities/${id}`, { fields: ENTITY_FIELDS }))
      if (body === null) {
        rows.push({ aplicacion: `#${index + 1}`, codigo: code })
        continue
      }
      if (typeof body['displayName'] === 'string') note(body['displayName'], 'entidad.displayName')
      const properties = (body['properties'] as Raw | undefined) ?? {}
      for (const [key, value] of Object.entries(properties)) {
        const before = new Set(observed)
        observe(value)
        for (const added of observed)
          if (!before.has(added)) sources.set(added, `properties.${apiKey(key)}`)
      }
      const relations: Record<string, unknown> = {}
      for (const direction of ['fromRelationships', 'toRelationships'] as const) {
        const map = (body[direction] as Raw | undefined) ?? {}
        for (const [name, targets] of Object.entries(map)) {
          const list = Array.isArray(targets) ? (targets as Raw[]) : []
          for (const target of list) observed.add(String(target['id']))
          relations[`${direction === 'fromRelationships' ? 'from' : 'to'}.${apiKey(name)}`] = {
            destinos: bucket(list.length),
            tipos: [...new Set(list.map((target) => typeOfId(target['id'])))].sort()
          }
        }
      }
      rows.push({
        aplicacion: `#${index + 1}`,
        codigo: code,
        type: body['type'] ?? null,
        firstSeenTms: kindOf(body['firstSeenTms']),
        lastSeenTms: kindOf(body['lastSeenTms']),
        properties: Object.fromEntries(
          Object.keys(properties)
            .sort()
            .map((key) => [apiKey(key), kindOf(properties[key])])
        ),
        relaciones: relations
      })
    }
    report['entidad'] = rows
  })

  it('CA1 (0033): el informe no contiene ningún id ni nombre observado', () => {
    const text = JSON.stringify(report)
    for (const value of observed) {
      if (value.length < 4) continue
      // El mensaje dice dónde está, nunca el valor.
      expect(
        text.includes(value),
        `el informe contiene un id o un nombre observado (${sources.get(value) ?? 'otro'}) en ${pathsOf(report, value).join(', ')}`
      ).toBe(false)
    }
    expect(observed.size).toBeGreaterThan(0)
    expect(Object.keys(report)).toEqual(
      expect.arrayContaining([
        'catalogo',
        'aplicaciones',
        'datos',
        'formasDeLaAplicacion',
        'porAccion',
        'canal',
        'eleccion',
        'entidad'
      ])
    )
  })
})

// Se usan en la exploración por acción y del canal (siguiente paso).
