import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createLiveClient } from '../../test/live-client'
import { loadLiveEnv } from '../../test/live-env'
import { DtError } from '../dynatrace/errors'

/**
 * Ficha 0006, paso 0: EXPLORACIÓN EN VIVO de las métricas de un servicio, SOLO
 * LECTURA, una petición detrás de otra y unas 30 como mucho.
 *
 * Como mucho 3 servicios (los afectados por problemas de los últimos 7 días o,
 * si no hay, los primeros de type("SERVICE")), con now-2h y now-7d.
 *
 * El informe (live-reports/service-metrics-explore.json, ignorado) guarda SOLO
 * comportamientos: unidades, códigos, si coinciden, órdenes y tramos. Nunca un
 * id, un nombre ni un valor. CA1 (0006) comprueba que no se cuela ningún id ni
 * nombre observado.
 */

const env = loadLiveEnv()
const live = env === null ? null : createLiveClient(env)
const report: Record<string, unknown> = {}
const timings: number[] = []
/** Ids y nombres observados: el informe no puede contener ninguno (CA1). */
const observed = new Set<string>()
const MAX_SERVICES = 3
const RANGES = ['now-2h', 'now-7d'] as const

const RESPONSE = 'builtin:service.response.server'
const REQUESTS = 'builtin:service.requestCount.server'
const ERRORS = 'builtin:service.errors.server.count'
const RATE = 'builtin:service.errors.server.rate'
const METRICS = [RESPONSE, REQUESTS, ERRORS, RATE] as const

type Raw = Record<string, unknown>
type Series = { timestamps: number[]; values: (number | null)[] }

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

const share = (part: number, whole: number): string =>
  whole === 0 ? 'sin datos' : `${Math.round((part / whole) * 20) * 5} %`

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

/** ¿Coinciden dos números? Solo el tramo de la diferencia, nunca los valores. */
function compare(a: number | null, b: number | null): string {
  if (a === null || b === null) return a === b ? 'los dos null' : 'uno null'
  if (a === b) return 'iguales'
  const scale = Math.max(Math.abs(a), Math.abs(b))
  const diff = Math.abs(a - b) / scale
  return diff < 1e-6 ? 'iguales (redondeo)' : diff < 0.01 ? 'casi (< 1 %)' : 'distintos (≥ 1 %)'
}

/** Resultados de /metrics/query como lista de series (una por resultado; la primera serie). */
function seriesOf(body: Raw | null): { metricId: string; series: Series | null; count: number }[] {
  const results = (Array.isArray(body?.['result']) ? body['result'] : []) as Raw[]
  return results.map((result) => {
    const data = (Array.isArray(result['data']) ? result['data'] : []) as Raw[]
    const first = data[0]
    return {
      metricId: String(result['metricId']),
      count: data.length,
      series:
        first === undefined
          ? null
          : {
              timestamps: (first['timestamps'] as number[] | undefined) ?? [],
              values: (first['values'] as (number | null)[] | undefined) ?? []
            }
    }
  })
}

const sum = (values: (number | null)[]): number | null =>
  values.every((v) => v === null) ? null : values.reduce<number>((acc, v) => acc + (v ?? 0), 0)

/** Único valor de una serie de un punto (fold o Inf). */
const single = (series: Series | null): number | null =>
  series === null || series.values.length === 0 ? null : (series.values[0] ?? null)

const byService = (id: string): string => `filter(eq("dt.entity.service","${id}"))`
const SPLIT = 'splitBy("dt.entity.service")'

/** Las 6 expresiones de las series, con el filtro de la petición original o sin él. */
function seriesExpressions(id: string | null): string[] {
  const scope = id === null ? `:${SPLIT}` : `:${byService(id)}:${SPLIT}`
  return [
    `${RESPONSE}${scope}:median`,
    `${RESPONSE}${scope}:percentile(90.0)`,
    `${RESPONSE}${scope}:percentile(99.0)`,
    `${REQUESTS}${scope}`,
    `${ERRORS}${scope}`,
    `${RATE}${scope}`
  ]
}

const SERIES_NAMES = ['mediana', 'p90', 'p99', 'peticiones', 'errores', 'tasa'] as const

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
    join('live-reports', 'service-metrics-explore.json'),
    `${JSON.stringify(report, null, 2)}\n`
  )
})

describe.skipIf(live === null)('Ficha 0006: métricas de un servicio (paso 0)', () => {
  const services: string[] = []

  it('elige como mucho 3 servicios', async () => {
    const list = (await get('/problems', { from: 'now-7d', pageSize: 50 })) as Raw
    for (const problem of (list['problems'] as Raw[] | undefined) ?? []) {
      observed.add(String(problem['problemId']))
      observed.add(String(problem['displayId']))
      for (const entity of (problem['affectedEntities'] as Raw[] | undefined) ?? []) {
        const id = (entity['entityId'] as Raw | undefined)?.['id']
        if (typeof entity['name'] === 'string') observed.add(entity['name'])
        if (typeof id !== 'string') continue
        observed.add(id)
        if (/^SERVICE-[0-9A-F]{16}$/.test(id) && !services.includes(id)) services.push(id)
      }
    }
    report['servicios sacados de problemas'] = Math.min(services.length, MAX_SERVICES)
    if (services.length === 0) {
      const page = (await get('/entities', {
        entitySelector: 'type("SERVICE")',
        from: 'now-2h',
        pageSize: MAX_SERVICES
      })) as Raw
      for (const entity of (page['entities'] as Raw[] | undefined) ?? []) {
        const id = String(entity['entityId'])
        observed.add(id)
        if (typeof entity['displayName'] === 'string') observed.add(entity['displayName'])
        services.push(id)
      }
      report['servicios sacados de /entities'] = services.length
    }
    services.splice(MAX_SERVICES)
    report['todos los ids con el formato SERVICE-<16 hex mayúsculas>'] = services.every((id) =>
      /^SERVICE-[0-9A-F]{16}$/.test(id)
    )
  })

  it('unidad, agregación por defecto y resolution=Inf de las cuatro métricas', async () => {
    const descriptors: Record<string, unknown> = {}
    for (const metric of METRICS) {
      const { code, body } = await codeOf(get(`/metrics/${encodeURIComponent(metric)}`, {}))
      descriptors[metric] =
        body === null
          ? { codigo: code }
          : {
              codigo: code,
              unit: body['unit'] ?? null,
              resolutionInfSupported: body['resolutionInfSupported'] ?? null,
              defaultAggregation: body['defaultAggregation'] ?? null,
              aggregationTypes: body['aggregationTypes'] ?? null,
              transformations: Array.isArray(body['transformations'])
                ? (body['transformations'] as unknown[]).includes('fold')
                  ? 'incluye fold'
                  : 'sin fold'
                : null
            }
    }
    report['descriptores'] = descriptors
  })

  it('series, selectores equivalentes, marcadores y OK/KO por servicio y rango', async () => {
    const perRange: Record<string, unknown[]> = {}
    for (const range of RANGES) {
      const rows: unknown[] = []
      for (const [index, id] of services.entries()) {
        const row: Record<string, unknown> = { servicio: `#${index + 1}` }

        // 1. Las 6 expresiones de series en una consulta, con el filtro de la petición.
        const sent = seriesExpressions(id)
        const filtered = await codeOf(
          get('/metrics/query', { metricSelector: sent.join(','), from: range })
        )
        const results = seriesOf(filtered.body)
        row['series (filtro dt.entity.service)'] = {
          codigo: filtered.code,
          resolution: filtered.body?.['resolution'] ?? null,
          warnings: Array.isArray(filtered.body?.['warnings'])
            ? (filtered.body['warnings'] as unknown[]).length
            : 'sin campo',
          resultados: results.length,
          // ¿Vuelven en el orden pedido y con metricId igual a la expresión enviada?
          metricIdIgualALaExpresion: results.every((r, i) => r.metricId === sent[i]),
          // El metricId devuelto quita las comillas del valor del filtro.
          ordenIgualAlPedidoSinComillasDelId: results.every(
            (r, i) => r.metricId === sent[i]?.replace(`"${id}"`, id)
          ),
          seriesPorResultado: [...new Set(results.map((r) => bucket(r.count)))],
          // Tramo de los ratios (la OpenAPI: puntos pedidos / máximo permitido por consulta).
          tramosDeRatios: [
            ...new Set(
              ((filtered.body?.['result'] as Raw[] | undefined) ?? []).flatMap((r) =>
                [r['dataPointCountRatio'], r['dimensionCountRatio']].map((value) =>
                  typeof value !== 'number'
                    ? 'sin campo'
                    : value === 0
                      ? '0'
                      : value < 0.01
                        ? '(0, 0.01)'
                        : value < 1
                          ? '[0.01, 1)'
                          : value === 1
                            ? '1'
                            : '> 1'
                )
              )
            )
          ],
          puntos: Object.fromEntries(
            results.map((r, i) => [SERIES_NAMES[i], bucket(r.series?.timestamps.length ?? 0)])
          ),
          nulos: Object.fromEntries(
            results.map((r, i) => [
              SERIES_NAMES[i],
              share(
                r.series?.values.filter((v) => v === null).length ?? 0,
                r.series?.values.length ?? 0
              )
            ])
          ),
          mismosTimestampsEnTodas: results.every(
            (r) =>
              JSON.stringify(r.series?.timestamps ?? []) ===
              JSON.stringify(results[0]?.series?.timestamps ?? [])
          )
        }

        // 2. Lo mismo con entitySelector=entityId(...) y sin filtro: ¿devuelve lo mismo?
        const scoped = await codeOf(
          get('/metrics/query', {
            metricSelector: seriesExpressions(null).join(','),
            entitySelector: `entityId("${id}")`,
            from: range
          })
        )
        const scopedResults = seriesOf(scoped.body)
        row['series (entitySelector)'] = {
          codigo: scoped.code,
          resolutionIgual: scoped.body?.['resolution'] === filtered.body?.['resolution'],
          mismosValores: Object.fromEntries(
            results.map((r, i) => [
              SERIES_NAMES[i],
              JSON.stringify(r.series) === JSON.stringify(scopedResults[i]?.series ?? null)
            ])
          )
        }

        // 3. Marcadores: fold frente a resolution=Inf.
        const scope = `:${byService(id)}:${SPLIT}`
        const foldExpr = [
          `${REQUESTS}${scope}:fold(sum)`,
          `${ERRORS}${scope}:fold(sum)`,
          `${RESPONSE}${scope}:median:fold(avg)`,
          `${RESPONSE}${scope}:percentile(90.0):fold(avg)`,
          `${RESPONSE}${scope}:percentile(99.0):fold(avg)`,
          `${RATE}${scope}:fold(avg)`
        ]
        const folded = await codeOf(
          get('/metrics/query', { metricSelector: foldExpr.join(','), from: range })
        )
        const infExpr = [
          `${REQUESTS}${scope}`,
          `${ERRORS}${scope}`,
          `${RESPONSE}${scope}:median`,
          `${RESPONSE}${scope}:percentile(90.0)`,
          `${RESPONSE}${scope}:percentile(99.0)`,
          `${RATE}${scope}`
        ]
        const inf = await codeOf(
          get('/metrics/query', {
            metricSelector: infExpr.join(','),
            from: range,
            resolution: 'Inf'
          })
        )
        const foldValues = seriesOf(folded.body).map((r) => single(r.series))
        const infValues = seriesOf(inf.body).map((r) => single(r.series))
        const infSeries = seriesOf(inf.body)
        const seriesSum = (i: number): number | null => sum(results[i]?.series?.values ?? [null])
        const names = ['peticiones', 'errores', 'mediana', 'p90', 'p99', 'tasa']
        row['marcadores'] = {
          codigoFold: folded.code,
          codigoInf: inf.code,
          resolutionFold: folded.body?.['resolution'] ?? null,
          resolutionInf: inf.body?.['resolution'] ?? null,
          puntosFold: [...new Set(seriesOf(folded.body).map((r) => r.series?.values.length ?? 0))],
          puntosInf: [...new Set(infSeries.map((r) => r.series?.values.length ?? 0))],
          foldFrenteAInf: Object.fromEntries(
            names.map((name, i) => [name, compare(foldValues[i] ?? null, infValues[i] ?? null)])
          ),
          // fold(sum) frente a la suma de los puntos de la serie (sin resolution).
          foldSumFrenteASumaDeLaSerie: {
            peticiones: compare(foldValues[0] ?? null, seriesSum(3)),
            errores: compare(foldValues[1] ?? null, seriesSum(4))
          }
        }

        // 4. ¿requestCount incluye las fallidas? errores ≤ peticiones y tasa ≈ errores/peticiones.
        const requests = infValues[0] ?? null
        const errors = infValues[1] ?? null
        const rate = infValues[5] ?? null
        const reqSeries = results[3]?.series?.values ?? []
        const errSeries = results[4]?.series?.values ?? []
        row['peticiones y errores'] = {
          erroresMenorOIgualQuePeticionesEnTotal:
            requests === null || errors === null ? 'sin datos' : errors <= requests,
          puntosConErroresMayorQuePeticiones: errSeries.filter(
            (e, i) => e !== null && (reqSeries[i] ?? 0) < e
          ).length,
          puntosConErroresNullYPeticiones: share(
            errSeries.filter((e, i) => e === null && (reqSeries[i] ?? null) !== null).length,
            reqSeries.length
          ),
          tasaInfFrenteA100PorErroresEntrePeticiones:
            requests === null || errors === null || requests === 0
              ? 'sin datos'
              : compare(rate, (errors / requests) * 100),
          tasaInfFrenteAErroresEntrePeticiones:
            requests === null || errors === null || requests === 0
              ? 'sin datos'
              : compare(rate, errors / requests),
          tasaEnRango0a100: rate === null ? 'sin datos' : rate >= 0 && rate <= 100 ? 'sí' : 'no',
          tasaMenorOIgualQue1: rate === null ? 'sin datos' : rate <= 1
        }
        rows.push(row)
      }
      perRange[range] = rows
    }
    report['por rango'] = perRange
  })

  it('forma del metricId devuelto y fold(sum) con resolution=Inf (solo el servicio #1)', async () => {
    const id = services[0]
    if (id === undefined) return
    /** La expresión con el id cambiado por <id>: es la forma, no el dato. */
    const shape = (text: string): string => text.split(id).join('<id>')
    const detail: Record<string, unknown> = {}
    for (const range of RANGES) {
      const sent = seriesExpressions(id)
      const body = (await get('/metrics/query', {
        metricSelector: sent.join(','),
        from: range
      })) as Raw
      const results = seriesOf(body)
      const mixScope = `:${byService(id)}:${SPLIT}`
      const mixed = await codeOf(
        get('/metrics/query', {
          metricSelector: [
            `${REQUESTS}${mixScope}:fold(sum)`,
            `${ERRORS}${mixScope}:fold(sum)`,
            `${REQUESTS}${mixScope}`,
            `${ERRORS}${mixScope}`
          ].join(','),
          from: range,
          resolution: 'Inf'
        })
      )
      const mixedValues = seriesOf(mixed.body).map((r) => single(r.series))
      detail[range] = {
        enviadas: sent.map(shape),
        devueltas: results.map((r) => shape(r.metricId)),
        ordenIgualAlPedidoSinComillasDelId: results.every(
          (r, i) => r.metricId === sent[i]?.replace(`"${id}"`, id)
        ),
        foldSumConResolutionInf: {
          codigo: mixed.code,
          resolution: mixed.body?.['resolution'] ?? null,
          peticionesFoldFrenteAInf: compare(mixedValues[0] ?? null, mixedValues[2] ?? null),
          erroresFoldFrenteAInf: compare(mixedValues[1] ?? null, mixedValues[3] ?? null),
          peticionesFoldFrenteASumaDeLaSerie: compare(
            mixedValues[0] ?? null,
            sum(results[3]?.series?.values ?? [null])
          ),
          erroresFoldFrenteASumaDeLaSerie: compare(
            mixedValues[1] ?? null,
            sum(results[4]?.series?.values ?? [null])
          )
        },
        primerTimestampFrenteAlInicioDelRango:
          results[0]?.series?.timestamps[0] === undefined
            ? 'sin datos'
            : `${Math.round(
                (results[0].series.timestamps[0] -
                  (Date.now() - (range === 'now-2h' ? 2 : 168) * 3_600_000)) /
                  60_000
              )} min`
      }
    }
    report['detalle del servicio #1'] = detail
  })

  it('CA1 (0006): el informe no contiene ningún id ni nombre observado', () => {
    const text = JSON.stringify(report)
    for (const value of observed) {
      if (value.length < 4) continue
      expect(text.includes(value), 'el informe contiene un id o un nombre observado').toBe(false)
    }
    expect(observed.size).toBeGreaterThan(0)
  })
})
