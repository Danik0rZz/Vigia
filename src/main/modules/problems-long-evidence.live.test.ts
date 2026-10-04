import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, it } from 'vitest'
import { z } from 'zod'
import { eventMetricInfo, evidenceMetricWindow, pickResolution } from '@shared/event-metric'
import { createLiveClient } from '../../test/live-client'
import { loadLiveEnv } from '../../test/live-env'

/**
 * EXPLORACIÓN EN VIVO para la 0.10.2 (eje de tiempo «00:00»), SOLO LECTURA y
 * con pocas peticiones: evidencias EVENT con selector de métrica y rango
 * largo, y la resolución que DEVUELVE /metrics/query frente a la pedida.
 *
 * El informe (live-reports/problems-long-evidence.json, ignorado) guarda SOLO
 * formas y cuentas: nunca ids, títulos, selectores ni valores.
 */

const env = loadLiveEnv()
const live = env === null ? null : createLiveClient(env)
const report: Record<string, unknown> = {}
const timings: number[] = []
const DAY = 86_400_000
/** Detalles de problema que se piden como mucho. */
const MAX_DETAILS = 8
/** Consultas de métrica como mucho (dos ventanas por evidencia). */
const MAX_QUERIES = 6

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

const bucket = (count: number): string =>
  count === 0 ? '0' : count < 10 ? '1-9' : count <= 50 ? '10-50' : 'más de 50'

/** Si todas las marcas caen a la misma hora local (el síntoma del «00:00»). */
function sameLocalTime(timestamps: number[]): boolean {
  const times = new Set(
    timestamps.map((time) => {
      const date = new Date(time)
      return `${date.getHours()}:${date.getMinutes()}`
    })
  )
  return timestamps.length > 1 && times.size === 1
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
    join('live-reports', 'problems-long-evidence.json'),
    `${JSON.stringify(report, null, 2)}\n`
  )
})

describe.skipIf(live === null)('0.10.2: evidencias largas con métrica', () => {
  it('resolución pedida frente a devuelta, y marcas a la misma hora', async () => {
    const now = Date.now()
    const list = (await get('/problems', {
      from: 'now-90d',
      pageSize: 100,
      sort: '-startTime'
    })) as Raw
    // Los abiertos aparte: uno abierto hace un mes queda por debajo de los 100 más recientes.
    const open = (await get('/problems', {
      from: 'now-90d',
      pageSize: 100,
      problemSelector: 'status("open")'
    })) as Raw
    const byId = new Map<string, Raw>()
    for (const problem of [
      ...((list['problems'] as Raw[] | undefined) ?? []),
      ...((open['problems'] as Raw[] | undefined) ?? [])
    ]) {
      byId.set(String(problem['problemId']), problem)
    }
    const all = [...byId.values()]
    // Largos: abiertos desde hace más de 7 días, o cerrados que duraron más de 7.
    const long = all.filter((problem) => {
      const start = Number(problem['startTime'])
      const end = Number(problem['endTime'])
      return Number.isFinite(start) && (end === -1 ? now : end) - start > 7 * DAY
    })
    report['problemas de 90 d'] = bucket(all.length)
    report['problemas de más de 7 d'] = bucket(long.length)

    const cases: Record<string, unknown>[] = []
    let withSelector = 0
    let queries = 0
    for (const problem of long.slice(0, MAX_DETAILS)) {
      if (queries >= MAX_QUERIES) break
      const detail = (await get(`/problems/${encodeURIComponent(String(problem['problemId']))}`, {
        fields: 'evidenceDetails'
      })) as Raw
      const details =
        ((detail['evidenceDetails'] as Raw | undefined)?.['details'] as Raw[] | undefined) ?? []
      for (const evidence of details) {
        if (evidence['evidenceType'] !== 'EVENT' || queries >= MAX_QUERIES) continue
        const data = evidence['data'] as Raw | undefined
        const metric = eventMetricInfo((data?.['properties'] as Raw[] | undefined) ?? [])
        if (metric?.status !== 'ok') continue
        withSelector += 1
        const start = typeof evidence['startTime'] === 'number' ? evidence['startTime'] : null
        const endRaw = evidence['endTime']
        const end = endRaw === -1 || typeof endRaw !== 'number' ? ('ACTIVE' as const) : endRaw
        const problemTimes = {
          startTime: Number(problem['startTime']),
          endTime: Number(problem['endTime']) === -1 ? null : Number(problem['endTime'])
        }
        for (const choice of ['all', '7d'] as const) {
          const window = evidenceMetricWindow({ start, end }, problemTimes, now, choice)
          const requested = pickResolution(window.from, window.to)
          const result = (await get('/metrics/query', {
            metricSelector: metric.selector,
            from: window.from,
            to: window.to,
            resolution: requested
          })) as Raw
          queries += 1
          const series =
            ((result['result'] as Raw[] | undefined)?.[0]?.['data'] as Raw[] | undefined) ?? []
          const timestamps = (series[0]?.['timestamps'] as number[] | undefined) ?? []
          cases.push({
            ventana: choice,
            'días del rango': Math.round((window.to - window.from) / DAY),
            'evidencia larga': window.long,
            'resolución pedida': requested,
            'resolución devuelta': result['resolution'] ?? null,
            puntos: bucket(timestamps.length),
            'todas las marcas a la misma hora local': sameLocalTime(timestamps)
          })
        }
      }
    }
    report['EVENT con selector en problemas largos'] = bucket(withSelector)
    report['casos'] = cases
  })
})
