import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createLiveClient } from '../../test/live-client'
import { loadLiveEnv } from '../../test/live-env'
import { DtError } from '../dynatrace/errors'

/**
 * Ficha 0022, paso 0: EXPLORACIÓN EN VIVO de las métricas de los monitores
 * sintéticos (browser, SYNTHETIC_TEST, y HTTP, HTTP_CHECK). SOLO LECTURA, una
 * petición detrás de otra y unas 80 como mucho.
 *
 * 1. Catálogo: `GET /metrics?metricSelector=builtin:synthetic.browser.*` y
 *    `…http.*` (comodín final, OpenAPI v2) con unidad, agregaciones y dimensiones.
 * 2. Con datos: como mucho 3 monitores de cada tipo (de los problemas de los
 *    últimos 7 días o, si no hay, de `type(...)`), qué métricas del catálogo
 *    tienen datos en `now-24h`, con qué dimensiones y si `:names` trae nombres.
 * 3. Elección por papel con la regla de la ficha (la primera candidata del
 *    catálogo, en orden de preferencia, que tenga datos).
 * 4. Entidad: claves de `properties` y nombres de relaciones de
 *    `GET /entities/{entityId}`.
 *
 * El informe (live-reports/monitor-metrics-explore.json, ignorado) guarda SOLO
 * comportamientos y claves de la API (métricas integradas, dimensiones,
 * propiedades y relaciones). Nunca un id, un nombre ni un valor. CA1 (0022)
 * comprueba que no se cuela ningún id ni nombre observado.
 */

const env = loadLiveEnv()
const live = env === null ? null : createLiveClient(env)
const report: Record<string, unknown> = {}
const timings: number[] = []
/** Ids y nombres observados: el informe no puede contener ninguno (CA1). */
const observed = new Set<string>()
const MAX_MONITORS = 3
/** La API admite como mucho 10 expresiones por consulta de /metrics/query. */
const BATCH = 10
const FROM = 'now-24h'
const CATALOG_FIELDS =
  '+unit,+aggregationTypes,+defaultAggregation,+dimensionDefinitions,+entityType,+resolutionInfSupported,+transformations'
const ENTITY_FIELDS = '+properties,+fromRelationships,+toRelationships,+firstSeenTms,+lastSeenTms'

type Kind = 'browser' | 'httpCheck'
const TYPES: Record<Kind, { entityType: string; prefix: string; entityDimension: string }> = {
  browser: {
    entityType: 'SYNTHETIC_TEST',
    prefix: 'builtin:synthetic.browser.',
    entityDimension: 'dt.entity.synthetic_test'
  },
  httpCheck: {
    entityType: 'HTTP_CHECK',
    prefix: 'builtin:synthetic.http.',
    entityDimension: 'dt.entity.http_check'
  }
}
const ID_PATTERN = /^(SYNTHETIC_TEST|HTTP_CHECK)-[0-9A-F]{16}$/

type Raw = Record<string, unknown>

/**
 * Valores de enumeración de la API (`BROWSER`, `ENABLED`…) y booleanos en texto: no son datos
 * del tenant y chocarían con las claves y los literales del informe.
 */
const isEnum = (value: string): boolean =>
  /^[A-Z][A-Z0-9_]*$/.test(value) || /^(true|false|null)$/.test(value)
/** Anota un valor observado, salvo los de enumeración. */
const observe = (value: string): void => {
  if (!isEnum(value)) observed.add(value)
}

interface CatalogEntry {
  metricId: string
  unit: unknown
  defaultAggregation: unknown
  aggregationTypes: unknown
  resolutionInfSupported: unknown
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
        : count <= 150
          ? '10-150'
          : count <= 1000
            ? '151-1000'
            : 'más de 1000'

/** Tramo de un valor (para unidades: ¿0–1, 0–100 o más?), nunca el valor. */
function range(value: number | null): string {
  if (value === null) return 'null'
  if (value < 0) return '< 0'
  if (value <= 1) return '[0, 1]'
  if (value <= 100) return '(1, 100]'
  if (value <= 1e6) return '(100, 1e6]'
  return '> 1e6'
}

/** Tipo de un valor de la API (nunca el valor). */
function kindOf(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return `lista (${bucket(value.length)})`
  return typeof value === 'object' ? 'objeto' : typeof value
}

/** Tipo de entidad de un id (`SYNTHETIC_LOCATION-…` → `SYNTHETIC_LOCATION`), o `otro`. */
const typeOfId = (id: unknown): string =>
  typeof id === 'string' && /^[A-Z_]+-[0-9A-F]{16}$/.test(id) ? id.split('-')[0]! : 'otro'

/** Nombre de clave de la API: solo letras, puntos y guiones bajos (no se cuela un valor). */
const apiKey = (key: string): string => (/^[A-Za-z][A-Za-z0-9_.:-]*$/.test(key) ? key : 'otra')

/** Clave de una dimensión de una métrica integrada (las define Dynatrace; pueden llevar espacios). */
const dimKey = (key: string): string =>
  /^[A-Za-z][A-Za-z0-9_.: ()-]{0,40}$/.test(key) ? key : 'otra'

/**
 * Valor de una dimensión de texto de estado o código: solo si parece de enumeración (mayúsculas,
 * un código numérico o una palabra corta); si no, `otro`. Nunca un nombre del tenant.
 */
const enumValue = (value: unknown): string =>
  typeof value === 'string' &&
  /^([A-Z][A-Z0-9_]*|\d{1,4}|[A-Za-z][a-z]{0,15}( [a-z]{1,15})?)$/.test(value)
    ? value
    : 'otro'

/** ¿Coinciden dos números? Solo el tramo de la diferencia, nunca los valores. */
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

const B = 'builtin:synthetic.browser.'
const H = 'builtin:synthetic.http.'
const BY_TEST = ':splitBy("dt.entity.synthetic_test")'
const BY_CHECK = ':splitBy("dt.entity.http_check")'
/** Expresiones candidatas del canal, por papel (se prueban con entitySelector=entityId(...)). */
const CANDIDATE_EXPRESSIONS: Record<Kind, Record<string, string[]>> = {
  browser: {
    availability: [
      `${B}availability.location.total${BY_TEST}:avg`,
      `${B}availability.location.totalWoMaintenanceWindow${BY_TEST}:avg`,
      `${B}availability${BY_TEST}:avg`
    ],
    duration: [`${B}totalDuration:avg`, `${B}totalDuration:median`, `${B}duration${BY_TEST}:avg`],
    executions: [`${B}success`, `${B}failure`, `${B}total`],
    performance: [
      `${B}largestContentfulPaint.load:avg`,
      `${B}visuallyComplete.load:avg`,
      `${B}cumulativeLayoutShift.load:avg`,
      `${B}speedIndex.load:avg`
    ]
  },
  httpCheck: {
    availability: [
      `${H}availability.location.total${BY_CHECK}:avg`,
      `${H}availability.location.totalWoMaintenanceWindow${BY_CHECK}:avg`,
      `${H}availability${BY_CHECK}:avg`
    ],
    duration: [`${H}duration.geo${BY_CHECK}:avg`],
    durationMedian: [`${H}duration.geo${BY_CHECK}:avg`, `${H}duration.geo${BY_CHECK}:median`],
    executions: [
      `${H}resultStatus:filter(eq("Result status","SUCCESS"))${BY_CHECK}:sum`,
      `${H}resultStatus:filter(eq("Result status","FAILURE"))${BY_CHECK}:sum`,
      `${H}execution.status:filter(eq("execution_state","SUCCESS"))${BY_CHECK}`,
      `${H}execution.status:filter(eq("execution_state","FAIL"))${BY_CHECK}`,
      `${H}execution.status${BY_CHECK}`
    ],
    httpTimings: [
      `${H}dns.geo${BY_CHECK}:avg`,
      `${H}tcpConnectTime.geo${BY_CHECK}:avg`,
      `${H}tlsHandshakeTime.geo${BY_CHECK}:avg`,
      `${H}timeToFirstByte.geo${BY_CHECK}:avg`
    ]
  }
}

/**
 * Papeles de la ficha y sus candidatas, en orden de preferencia (claves del catálogo). Las
 * métricas por paso o petición se miden aparte, sobre los pasos del monitor.
 */
const ROLES: Record<Kind, Record<string, string[]>> = {
  browser: {
    disponibilidad: [`${B}availability.location.total`, `${B}availability`],
    disponibilidadSinMantenimiento: [`${B}availability.location.totalWoMaintenanceWindow`],
    duracion: [`${B}totalDuration`, `${B}duration`],
    ejecucionesCorrectas: [`${B}success`],
    ejecucionesFallidas: [`${B}failure`],
    disponibilidadPorLocalizacion: [`${B}availability`, `${B}availability.location.total`],
    duracionPorLocalizacion: [`${B}duration`, `${B}totalDuration.geo`],
    duracionPorPaso: [`${B}step.duration`, `${B}event.totalDuration`],
    lcp: [`${B}largestContentfulPaint.load`],
    visuallyComplete: [`${B}visuallyComplete.load`],
    cls: [`${B}cumulativeLayoutShift.load`],
    speedIndex: [`${B}speedIndex.load`]
  },
  httpCheck: {
    disponibilidad: [`${H}availability.location.total`, `${H}availability`],
    disponibilidadSinMantenimiento: [`${H}availability.location.totalWoMaintenanceWindow`],
    duracion: [`${H}duration.geo`],
    ejecucionesCorrectasYFallidas: [`${H}resultStatus`, `${H}execution.status`],
    disponibilidadPorLocalizacion: [`${H}availability`, `${H}availability.location.total`],
    duracionPorLocalizacion: [`${H}duration.geo`],
    duracionPorPeticion: [`${H}request.duration.geo`],
    dns: [`${H}dns.geo`],
    tcp: [`${H}tcpConnectTime.geo`],
    tls: [`${H}tlsHandshakeTime.geo`],
    primerByte: [`${H}timeToFirstByte.geo`],
    codigoDeEstado: [`${H}statusCode`]
  }
}

/** Comillas para el selector (la clave de una métrica integrada no lleva caracteres raros). */
const scoped = (metricId: string, kind: Kind, id: string): string =>
  `${metricId}:filter(eq("${TYPES[kind].entityDimension}","${id}")):names`

const catalogs: Record<Kind, CatalogEntry[]> = { browser: [], httpCheck: [] }
const monitors: Record<Kind, string[]> = { browser: [], httpCheck: [] }
/** Métrica → por monitor: ¿tiene datos?, series, claves de dimensionMap y tramo de valores. */
/** Lo mismo para las métricas por paso o petición (sobre los pasos del monitor). */
const stepData: Record<Kind, Map<string, { data: boolean }[]>> = {
  browser: new Map(),
  httpCheck: new Map()
}
const withData: Record<Kind, Map<string, { data: boolean; detail: Raw }[]>> = {
  browser: new Map(),
  httpCheck: new Map()
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
    join('live-reports', 'monitor-metrics-explore.json'),
    `${JSON.stringify(report, null, 2)}\n`
  )
})

describe.skipIf(live === null)('Ficha 0022: métricas de los monitores sintéticos (paso 0)', () => {
  it('catálogo de builtin:synthetic.browser.* y builtin:synthetic.http.*', async () => {
    const out: Record<string, unknown> = {}
    for (const kind of ['browser', 'httpCheck'] as const) {
      const { code, body } = await codeOf(
        get('/metrics', {
          metricSelector: `${TYPES[kind].prefix}*`,
          fields: CATALOG_FIELDS,
          pageSize: 500
        })
      )
      const metrics = ((body?.['metrics'] as Raw[] | undefined) ?? []).filter((m) =>
        String(m['metricId']).startsWith(TYPES[kind].prefix)
      )
      catalogs[kind] = metrics.map((m) => ({
        metricId: String(m['metricId']),
        unit: m['unit'] ?? null,
        defaultAggregation: m['defaultAggregation'] ?? null,
        aggregationTypes: m['aggregationTypes'] ?? null,
        resolutionInfSupported: m['resolutionInfSupported'] ?? null,
        entityType: m['entityType'] ?? null,
        dimensions: ((m['dimensionDefinitions'] as Raw[] | undefined) ?? []).map(
          (d) => `${dimKey(String(d['key']))} (${String(d['type'])})`
        )
      }))
      out[kind] = {
        codigo: code,
        totalCount: body?.['totalCount'] ?? null,
        // Una sola página: si hubiera más, se anota (nextPageKey exige omitir los demás).
        masPaginas: body?.['nextPageKey'] !== null && body?.['nextPageKey'] !== undefined,
        metricas: catalogs[kind]
      }
    }
    report['catalogo'] = out
    expect(catalogs.browser.length + catalogs.httpCheck.length).toBeGreaterThan(0)
  })

  it('elige como mucho 3 monitores de cada tipo', async () => {
    const list = (await get('/problems', { from: 'now-7d', pageSize: 100 })) as Raw
    for (const problem of (list['problems'] as Raw[] | undefined) ?? []) {
      observed.add(String(problem['problemId']))
      observed.add(String(problem['displayId']))
      if (typeof problem['title'] === 'string') observed.add(problem['title'])
      const entities = [
        ...((problem['affectedEntities'] as Raw[] | undefined) ?? []),
        ...((problem['impactedEntities'] as Raw[] | undefined) ?? [])
      ]
      for (const entity of entities) {
        const id = (entity['entityId'] as Raw | undefined)?.['id']
        if (typeof entity['name'] === 'string') observed.add(entity['name'])
        if (typeof id !== 'string') continue
        observed.add(id)
        if (!ID_PATTERN.test(id)) continue
        const kind: Kind = id.startsWith('HTTP_CHECK-') ? 'httpCheck' : 'browser'
        if (!monitors[kind].includes(id)) monitors[kind].push(id)
      }
    }
    const origin: Record<string, unknown> = {}
    for (const kind of ['browser', 'httpCheck'] as const) {
      const fromProblems = Math.min(monitors[kind].length, MAX_MONITORS)
      if (monitors[kind].length < MAX_MONITORS) {
        const page = (await get('/entities', {
          entitySelector: `type("${TYPES[kind].entityType}")`,
          from: 'now-7d',
          pageSize: 2 * MAX_MONITORS
        })) as Raw
        for (const entity of (page['entities'] as Raw[] | undefined) ?? []) {
          const id = String(entity['entityId'])
          observed.add(id)
          if (typeof entity['displayName'] === 'string') observed.add(entity['displayName'])
          if (!monitors[kind].includes(id)) monitors[kind].push(id)
        }
      }
      monitors[kind].splice(MAX_MONITORS)
      origin[kind] = {
        deProblemas: fromProblems,
        deEntities: monitors[kind].length - fromProblems,
        formatoDelId: monitors[kind].every((id) => ID_PATTERN.test(id))
      }
    }
    report['monitores'] = origin
    expect(monitors.browser.length + monitors.httpCheck.length).toBeGreaterThan(0)
  })

  it('qué métricas del catálogo tienen datos en now-24h y con qué dimensiones', async () => {
    const out: Record<string, unknown> = {}
    for (const kind of ['browser', 'httpCheck'] as const) {
      const keys = catalogs[kind].map((m) => m.metricId)
      for (const [index, id] of monitors[kind].entries()) {
        for (let start = 0; start < keys.length; start += BATCH) {
          const chunk = keys.slice(start, start + BATCH)
          const batch = await codeOf(
            get('/metrics/query', {
              metricSelector: chunk.map((key) => scoped(key, kind, id)).join(','),
              from: FROM,
              resolution: 'Inf'
            })
          )
          // Si la tanda falla (una métrica sin Inf, por ejemplo), una a una y sin Inf.
          const bodies: { key: string; code: string; result: Raw | undefined }[] = []
          if (batch.body !== null) {
            const results = (batch.body['result'] as Raw[] | undefined) ?? []
            chunk.forEach((key, i) => bodies.push({ key, code: 'ok', result: results[i] }))
          } else {
            for (const key of chunk) {
              const one = await codeOf(
                get('/metrics/query', { metricSelector: scoped(key, kind, id), from: FROM })
              )
              bodies.push({
                key,
                code: `tanda ${batch.code}; sola ${one.code}`,
                result: ((one.body?.['result'] as Raw[] | undefined) ?? [])[0]
              })
            }
          }
          for (const { key, code, result } of bodies) {
            const data = (result?.['data'] as Raw[] | undefined) ?? []
            const values = data.flatMap((d) => (d['values'] as (number | null)[] | undefined) ?? [])
            const present = values.filter((v): v is number => v !== null)
            const dimensionKeys = new Set<string>()
            for (const item of data) {
              const map = (item['dimensionMap'] as Record<string, unknown> | undefined) ?? {}
              for (const [dimension, value] of Object.entries(map)) {
                dimensionKeys.add(dimKey(dimension))
                if (typeof value === 'string') observe(value)
              }
            }
            const rows = withData[kind].get(key) ?? []
            rows.push({
              data: present.length > 0,
              detail: {
                monitor: `#${index + 1}`,
                codigo: code,
                series: bucket(data.length),
                clavesDeDimensionMap: [...dimensionKeys].sort(),
                tramoMaximo: range(present.length === 0 ? null : Math.max(...present)),
                tramoMinimo: range(present.length === 0 ? null : Math.min(...present))
              }
            })
            withData[kind].set(key, rows)
          }
        }
      }
      out[kind] = Object.fromEntries(
        [...withData[kind].entries()].map(([key, rows]) => [
          key,
          {
            conDatosEn: `${rows.filter((r) => r.data).length} de ${rows.length}`,
            porMonitor: rows.map((r) => r.detail)
          }
        ])
      )
    }
    report['datos'] = out
  })

  it('por paso o petición, dimensiones de texto y expresiones candidatas del canal', async () => {
    const out: Record<string, unknown> = {}
    for (const kind of ['browser', 'httpCheck'] as const) {
      const section: Record<string, unknown> = {}
      const stepType = kind === 'browser' ? 'SYNTHETIC_TEST_STEP' : 'HTTP_CHECK_STEP'
      const stepMetrics = catalogs[kind]
        .map((m) => m.metricId)
        .filter((key) =>
          key.startsWith(`${TYPES[kind].prefix}${kind === 'browser' ? 'event.' : 'request.'}`)
        )
        .filter((key) => !key.endsWith('.geo') || kind === 'httpCheck')
      const steps: Record<string, unknown[]> = {}
      const strings: Record<string, Record<string, string[]>> = {}
      const candidates: Record<string, unknown[]> = {}
      for (const [index, id] of monitors[kind].entries()) {
        // 1. Métricas por paso o petición: acotadas con entitySelector sobre los pasos del monitor.
        const stepScope = `type("${stepType}"),fromRelationships.isStepOf(entityId("${id}"))`
        for (let start = 0; start < stepMetrics.length; start += BATCH) {
          const chunk = stepMetrics.slice(start, start + BATCH)
          const { code, body } = await codeOf(
            get('/metrics/query', {
              metricSelector: chunk.map((key) => `${key}:names`).join(','),
              entitySelector: stepScope,
              from: FROM,
              resolution: 'Inf'
            })
          )
          const results = (body?.['result'] as Raw[] | undefined) ?? []
          chunk.forEach((key, i) => {
            const data = (results[i]?.['data'] as Raw[] | undefined) ?? []
            const values = data.flatMap((d) => (d['values'] as (number | null)[] | undefined) ?? [])
            const keys = new Set<string>()
            for (const item of data) {
              for (const [dimension, value] of Object.entries(
                (item['dimensionMap'] as Record<string, unknown> | undefined) ?? {}
              )) {
                keys.add(dimKey(dimension))
                if (typeof value === 'string') observe(value)
              }
            }
            const row = steps[key] ?? []
            row.push({
              monitor: `#${index + 1}`,
              codigo: code,
              conDatos: values.some((v) => v !== null),
              series: bucket(data.length),
              clavesDeDimensionMap: [...keys].sort()
            })
            steps[key] = row
            const flags = stepData[kind].get(key) ?? []
            flags.push({ data: values.some((v) => v !== null) })
            stepData[kind].set(key, flags)
          })
        }

        // 2. Dimensiones de texto (no entidades) de estado y códigos: claves y valores de enumeración.
        const stringMetrics = catalogs[kind]
          .filter((m) =>
            m.dimensions.some((d) => d.endsWith('(STRING)') && !d.startsWith('interpolated'))
          )
          .map((m) => m.metricId)
          .filter(
            (key) => !key.includes('.event.') && !key.includes('.request.') && !key.endsWith('.geo')
          )
        const { body } = await codeOf(
          get('/metrics/query', {
            metricSelector: stringMetrics.map((key) => scoped(key, kind, id)).join(','),
            from: FROM,
            resolution: 'Inf'
          })
        )
        const results = (body?.['result'] as Raw[] | undefined) ?? []
        stringMetrics.forEach((key, i) => {
          const entry = strings[key] ?? {}
          for (const item of (results[i]?.['data'] as Raw[] | undefined) ?? []) {
            for (const [dimension, value] of Object.entries(
              (item['dimensionMap'] as Record<string, unknown> | undefined) ?? {}
            )) {
              if (dimension.startsWith('dt.entity.')) continue
              const values = new Set(entry[dimKey(dimension)] ?? [])
              values.add(enumValue(value))
              entry[dimKey(dimension)] = [...values].sort()
            }
          }
          strings[key] = entry
        })

        // 3. Expresiones candidatas del canal: series (resolución de la API) y marcadores (Inf).
        for (const [role, expressions] of Object.entries(CANDIDATE_EXPRESSIONS[kind])) {
          const scope = { entitySelector: `entityId("${id}")`, from: FROM }
          const series = await codeOf(
            get('/metrics/query', { metricSelector: expressions.join(','), ...scope })
          )
          const inf = await codeOf(
            get('/metrics/query', {
              metricSelector: expressions.join(','),
              ...scope,
              resolution: 'Inf'
            })
          )
          const seriesResults = (series.body?.['result'] as Raw[] | undefined) ?? []
          const infResults = (inf.body?.['result'] as Raw[] | undefined) ?? []
          const rows = candidates[role] ?? []
          rows.push({
            monitor: `#${index + 1}`,
            codigoSeries: series.code,
            codigoInf: inf.code,
            resolution: series.body?.['resolution'] ?? null,
            porExpresion: expressions.map((expression, i) => {
              const s = (seriesResults[i]?.['data'] as Raw[] | undefined) ?? []
              const f = (infResults[i]?.['data'] as Raw[] | undefined) ?? []
              const values = (s[0]?.['values'] as (number | null)[] | undefined) ?? []
              const present = values.filter((v): v is number => v !== null)
              const infValue =
                ((f[0]?.['values'] as (number | null)[] | undefined) ?? [])[0] ?? null
              const sum = present.reduce((a, b) => a + b, 0)
              const mean = present.length === 0 ? null : sum / present.length
              return {
                expresion: expression,
                metricIdIgualAlPedido: seriesResults[i]?.['metricId'] === expression,
                seriesEnSeries: bucket(s.length),
                seriesEnInf: bucket(f.length),
                puntos: bucket(values.length),
                nulos: `${values.length - present.length} de ${values.length}`,
                ultimoNull: (values.at(-1) ?? null) === null,
                tramo: range(present.length === 0 ? null : Math.max(...present)),
                infFrenteASuma: compare(infValue, present.length === 0 ? null : sum),
                infFrenteAMedia: compare(infValue, mean),
                infFrenteAlInfDeLaPrimera: compare(
                  infValue,
                  ((((infResults[0]?.['data'] as Raw[] | undefined) ?? [])[0]?.['values'] as
                    (number | null)[] | undefined) ?? [])[0] ?? null
                ),
                ratios: [
                  ratioBucket(seriesResults[i]?.['dataPointCountRatio']),
                  ratioBucket(seriesResults[i]?.['dimensionCountRatio'])
                ]
              }
            })
          })
          candidates[role] = rows
        }
      }
      section['porPasoOPeticion'] = Object.fromEntries(
        Object.entries(steps).map(([key, rows]) => [key, rows])
      )
      section['dimensionesDeTexto'] = strings
      section['candidatas'] = candidates
      out[kind] = section
    }
    report['exploracion'] = out
  })

  it('elección por papel: la primera candidata del catálogo, en orden de preferencia, con datos', () => {
    const out: Record<string, unknown> = {}
    for (const kind of ['browser', 'httpCheck'] as const) {
      const table: Record<string, unknown> = {}
      for (const [role, keys] of Object.entries(ROLES[kind])) {
        const chosen = keys.find((key) => {
          // Con el filtro del monitor o, si es por paso o petición, sobre sus pasos.
          const rows = [...(withData[kind].get(key) ?? []), ...(stepData[kind].get(key) ?? [])]
          return rows.some((row) => row.data)
        })
        const entry = catalogs[kind].find((m) => m.metricId === chosen)
        table[role] =
          chosen === undefined || entry === undefined
            ? { metrica: null, candidatas: keys.length }
            : {
                metrica: chosen,
                unidad: entry.unit,
                agregacionPorDefecto:
                  (entry.defaultAggregation as Raw | null)?.['type'] ?? entry.defaultAggregation,
                agregaciones: entry.aggregationTypes,
                dimensiones: entry.dimensions,
                posicionEnLaPreferencia: keys.indexOf(chosen) + 1
              }
      }
      out[kind] = table
    }
    report['eleccion'] = out
  })

  it('entidad: claves de properties y relaciones de GET /entities/{entityId}', async () => {
    const out: Record<string, unknown> = {}
    for (const kind of ['browser', 'httpCheck'] as const) {
      const rows: unknown[] = []
      for (const [index, id] of monitors[kind].entries()) {
        const { code, body } = await codeOf(get(`/entities/${id}`, { fields: ENTITY_FIELDS }))
        if (body === null) {
          rows.push({ monitor: `#${index + 1}`, codigo: code })
          continue
        }
        if (typeof body['displayName'] === 'string') observed.add(body['displayName'])
        const properties = (body['properties'] as Raw | undefined) ?? {}
        for (const value of Object.values(properties)) {
          if (typeof value === 'string') observe(value)
          if (Array.isArray(value)) {
            for (const item of value) if (typeof item === 'string') observe(item)
          }
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
          monitor: `#${index + 1}`,
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
      out[kind] = rows
    }
    report['entidad'] = out
  })

  it('CA1 (0022): el informe no contiene ningún id ni nombre observado', () => {
    const text = JSON.stringify(report)
    for (const value of observed) {
      if (value.length < 4) continue
      expect(text.includes(value), 'el informe contiene un id o un nombre observado').toBe(false)
    }
    expect(observed.size).toBeGreaterThan(0)
    // Trae lo que pide la ficha: catálogo, datos y claves de la entidad.
    expect(Object.keys(report)).toEqual(
      expect.arrayContaining([
        'catalogo',
        'monitores',
        'datos',
        'exploracion',
        'eleccion',
        'entidad'
      ])
    )
  })
})
