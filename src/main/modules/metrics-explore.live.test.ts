import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, it } from 'vitest'
import { z } from 'zod'
import { DT_ENDPOINTS } from '@shared/dt-endpoints'
import { createLiveClient } from '../../test/live-client'
import { loadLiveEnv } from '../../test/live-env'
import { DtError } from '../dynatrace/errors'

/**
 * EXPLORACIÓN EN VIVO del bloque c (Metrics), SOLO LECTURA y con unas 15
 * peticiones como mucho.
 *
 * El informe (live-reports/metrics-explore.json, ignorado) guarda solo
 * comportamientos. Las métricas personalizadas (lo que no es builtin:) solo se
 * cuentan en proporción; nunca su nombre. Los `warnings` de la API pueden
 * llevar nombres de métricas o IDs: solo se cuentan. Las consultas usan una
 * métrica estándar (builtin:host.cpu.usage).
 */

const env = loadLiveEnv()
const live = env === null ? null : createLiveClient(env)
const report: Record<string, unknown> = {}
const timings: number[] = []
const METRIC = 'builtin:host.cpu.usage'

type Raw = Record<string, unknown>

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

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
    return 'ok'
  } catch (error) {
    return error instanceof DtError
      ? `${error.code}${error.status === undefined ? '' : ` ${error.status}`}`
      : 'NO_DT_ERROR'
  }
}

const share = (part: number, whole: number): string =>
  whole === 0 ? 'sin datos' : `${Math.round((part / whole) * 20) * 5} %`

/** Resumen de una respuesta de /metrics/query sin valores ni dimensiones. */
function querySummary(body: Raw): Record<string, unknown> {
  const results = (Array.isArray(body['result']) ? body['result'] : []) as Raw[]
  const series = results.flatMap((r) => (Array.isArray(r['data']) ? (r['data'] as Raw[]) : []))
  const points = series.map((s) => (Array.isArray(s['timestamps']) ? s['timestamps'].length : 0))
  const values = series.flatMap((s) =>
    Array.isArray(s['values']) ? (s['values'] as unknown[]) : []
  )
  return {
    claves: Object.keys(body).sort(),
    resolution: body['resolution'] ?? null,
    hayNextPageKey: typeof body['nextPageKey'] === 'string',
    warnings: Array.isArray(body['warnings']) ? body['warnings'].length : 'sin campo',
    clavesDeUnResultado: [...new Set(results.flatMap((r) => Object.keys(r)))].sort(),
    clavesDeUnaSerie: [...new Set(series.flatMap((s) => Object.keys(s)))].sort(),
    puntosPorSerieMax: points.length === 0 ? 0 : Math.max(...points),
    valoresNulos: share(values.filter((v) => v === null).length, values.length)
  }
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
    join('live-reports', 'metrics-explore.json'),
    `${JSON.stringify(report, null, 2)}\n`
  )
})

describe.skipIf(live === null)('exploración: Metrics (bloque c)', () => {
  it('/metrics: forma, personalizadas (solo proporción) y paginación', async () => {
    const first = (await get(DT_ENDPOINTS.metrics.path, { pageSize: 100 })) as Raw
    const metrics = (Array.isArray(first['metrics']) ? first['metrics'] : []) as Raw[]
    report['/metrics: claves de la respuesta'] = Object.keys(first).sort()
    report['/metrics: claves de una métrica'] = [
      ...new Set(metrics.flatMap((m) => Object.keys(m)))
    ].sort()
    report['/metrics: no builtin (proporción de la 1.ª página)'] = share(
      metrics.filter((m) => !String(m['metricId']).startsWith('builtin:')).length,
      metrics.length
    )
    const key = first['nextPageKey']
    if (typeof key === 'string') {
      report['/metrics: página 2 solo con nextPageKey'] = await codeOf(
        get(DT_ENDPOINTS.metrics.path, { nextPageKey: key })
      )
      report['/metrics: página 2 con nextPageKey y pageSize'] = await codeOf(
        get(DT_ENDPOINTS.metrics.path, { nextPageKey: key, pageSize: 100 })
      )
    }
    report['/metrics?text=cpu: estado'] = await codeOf(
      get(DT_ENDPOINTS.metrics.path, { text: 'cpu', pageSize: 50 })
    )
    const descriptor = (await get(`/metrics/${encodeURIComponent(METRIC)}`, {})) as Raw
    report['/metrics/{id}: claves'] = Object.keys(descriptor).sort()
  })

  it('/metrics/query: resolución por defecto, explícita, Inf y límites', async () => {
    const cases: Record<string, Record<string, string>> = {
      '2h sin resolution': { from: 'now-2h' },
      '7d con 1m': { from: 'now-7d', resolution: '1m' },
      '7d con 1h': { from: 'now-7d', resolution: '1h' },
      '30d con Inf': { from: 'now-30d', resolution: 'Inf' }
    }
    for (const [name, query] of Object.entries(cases)) {
      try {
        const body = (await get('/metrics/query', { metricSelector: METRIC, ...query })) as Raw
        report[`query ${name}`] = querySummary(body)
      } catch (error) {
        report[`query ${name}`] = error instanceof DtError ? error.code : 'NO_DT_ERROR'
      }
    }
    report['query: resolution no válida'] = await codeOf(
      get('/metrics/query', { metricSelector: METRIC, from: 'now-2h', resolution: 'xyz' })
    )
    report['query: metricSelector mal formado'] = await codeOf(
      get('/metrics/query', { metricSelector: `${METRIC}:splitBy(`, from: 'now-2h' })
    )
    report['query: métrica inexistente'] = await codeOf(
      get('/metrics/query', { metricSelector: 'builtin:no.existe.falsa', from: 'now-2h' })
    )
  })
})
