import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, it } from 'vitest'
import { z } from 'zod'
import { createLiveClient } from '../../test/live-client'
import { loadLiveEnv } from '../../test/live-env'
import { DtError } from '../dynatrace/errors'

/**
 * EXPLORACIÓN EN VIVO para la 0.9.2 (mini gráfico de los eventos con
 * dt.event.metric_selector), SOLO LECTURA y con pocas peticiones.
 *
 * El informe (live-reports/problems-event-metric.json, ignorado) guarda SOLO
 * comportamientos: si la clave está y dónde, los NOMBRES de las claves
 * estándar dt.event.* que la acompañan (las demás se cuentan, sin nombre),
 * tramos y proporciones, y los códigos de /metrics/query. Nunca un selector,
 * un nombre de métrica, un valor ni un id.
 */

const env = loadLiveEnv()
const live = env === null ? null : createLiveClient(env)
const report: Record<string, unknown> = {}
const timings: number[] = []
const SELECTOR_KEY = 'dt.event.metric_selector'
/** Detalles que se piden como mucho buscando eventos de métrica. */
const MAX_DETAILS = 10
/** Selectores que se prueban en /metrics/query como mucho. */
const MAX_QUERIES = 4

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

/** Código del error, sin su mensaje (puede llevar el selector o el host). */
async function codeOf(promise: Promise<unknown>): Promise<{ code: string; body: unknown }> {
  try {
    return { code: 'ok', body: await promise }
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
  count === 0 ? '0' : count < 10 ? '1-9' : count <= 50 ? '10-50' : 'más de 50'

const lengthBucket = (text: string): string =>
  text.length <= 100
    ? '≤ 100'
    : text.length <= 500
      ? '101-500'
      : text.length <= 2000
        ? '501-2000'
        : '> 2000'

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
    join('live-reports', 'problems-event-metric.json'),
    `${JSON.stringify(report, null, 2)}\n`
  )
})

describe.skipIf(live === null)('0.9.2: eventos con dt.event.metric_selector', () => {
  it('dónde viene, qué claves la acompañan y si /metrics/query acepta el selector', async () => {
    const list = (await get('/problems', {
      from: 'now-7d',
      pageSize: 100,
      sort: '-startTime'
    })) as Raw
    const problems = ((list['problems'] as Raw[] | undefined) ?? []).slice(0, MAX_DETAILS)

    let events = 0
    let withSelectorInProperties = 0
    let withSelectorElsewhere = 0
    let valueIsString = 0
    const companionKeys = new Set<string>()
    let otherKeys = 0
    const lengths = new Set<string>()
    let looksBuiltin = 0
    let looksDql = 0
    const queries: { selector: string; from: number; to: number }[] = []

    for (const problem of problems) {
      const id = String(problem['problemId'])
      const detail = (await get(`/problems/${encodeURIComponent(id)}`, {
        fields: 'evidenceDetails'
      })) as Raw
      const details =
        ((detail['evidenceDetails'] as Raw | undefined)?.['details'] as Raw[] | undefined) ?? []
      for (const evidence of details) {
        if (evidence['evidenceType'] !== 'EVENT') continue
        events += 1
        const data = (evidence['data'] as Raw | undefined) ?? {}
        const properties = (data['properties'] as { key?: unknown; value?: unknown }[]) ?? []
        const found = properties.find((property) => property.key === SELECTOR_KEY)
        if (found === undefined) {
          // ¿Viene en otro sitio de data? Solo se mira si existe la clave.
          if (JSON.stringify(data).includes(SELECTOR_KEY)) withSelectorElsewhere += 1
          continue
        }
        withSelectorInProperties += 1
        if (typeof found.value === 'string') valueIsString += 1
        const selector = String(found.value)
        lengths.add(lengthBucket(selector))
        if (selector.startsWith('builtin:')) looksBuiltin += 1
        if (/^\s*(fetch|timeseries)\b/i.test(selector)) looksDql += 1
        for (const property of properties) {
          const key = String(property.key)
          if (key === SELECTOR_KEY) continue
          if (key.startsWith('dt.event.')) companionKeys.add(key)
          else otherKeys += 1
        }
        if (queries.length < MAX_QUERIES) {
          const start = Number(evidence['startTime'] ?? problem['startTime'])
          const end = Number(evidence['endTime'] ?? -1)
          queries.push({
            selector,
            from: start - 3_600_000,
            to: end > 0 ? end + 15 * 60_000 : Date.now()
          })
        }
      }
    }

    report['detalles mirados'] = problems.length
    report['evidencias EVENT'] = bucket(events)
    report[`EVENT con ${SELECTOR_KEY} en data.properties`] = share(withSelectorInProperties, events)
    report[`EVENT con ${SELECTOR_KEY} en otro sitio de data`] = share(withSelectorElsewhere, events)
    report['el value del selector es string'] = share(valueIsString, withSelectorInProperties)
    report['longitud del selector'] = [...lengths].sort()
    report['selector que empieza por builtin:'] = share(looksBuiltin, withSelectorInProperties)
    report['selector con forma de DQL'] = share(looksDql, withSelectorInProperties)
    report['claves dt.event.* que acompañan al selector'] = [...companionKeys].sort()
    report['otras claves (no dt.event.*), cuántas en total'] = bucket(otherKeys)

    const results: { codigo: string; series: string; warnings: boolean }[] = []
    for (const query of queries) {
      const result = await codeOf(
        get('/metrics/query', {
          metricSelector: query.selector,
          from: new Date(query.from).toISOString(),
          to: new Date(query.to).toISOString(),
          resolution: '5m'
        })
      )
      const body = result.body as Raw | null
      const series = ((body?.['result'] as Raw[] | undefined) ?? []).flatMap(
        (item) => (item['data'] as unknown[] | undefined) ?? []
      ).length
      results.push({
        codigo: result.code,
        series: bucket(series),
        warnings: Array.isArray(body?.['warnings']) && (body?.['warnings'] as unknown[]).length > 0
      })
    }
    report['/metrics/query con el selector tal cual'] = results
    // El log del cliente: ¿algún selector se ha copiado en una línea de log?
    report['algún selector en el log del cliente'] = queries.some((query) =>
      live?.logged.some((line) => line.includes(query.selector))
    )
  })
})
