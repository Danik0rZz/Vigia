import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createLiveClient } from '../../test/live-client'
import { loadLiveEnv } from '../../test/live-env'
import { DtError } from '../dynatrace/errors'

/**
 * Ficha 0016, paso 0: EXPLORACIÓN EN VIVO de las métricas de un host, SOLO
 * LECTURA, una petición detrás de otra y unas 60 como mucho.
 *
 * Como mucho 3 hosts (los de los problemas de los últimos 7 días o, si no hay,
 * los primeros de type("HOST")), con now-2h y now-7d.
 *
 * El informe (live-reports/host-metrics-explore.json, ignorado) guarda SOLO
 * comportamientos: códigos, unidades, agregaciones, dimensiones, órdenes y
 * tramos. Nunca un id, un nombre ni un valor. CA1 (0016) comprueba que no se
 * cuela ningún id ni nombre observado.
 */

const env = loadLiveEnv()
const live = env === null ? null : createLiveClient(env)
const report: Record<string, unknown> = {}
const timings: number[] = []
/** Ids y nombres observados: el informe no puede contener ninguno (CA1). */
const observed = new Set<string>()
const MAX_HOSTS = 3
const RANGES = ['now-2h', 'now-7d'] as const

/** Candidatas de la ficha, por este orden. */
const CPU = 'builtin:host.cpu.usage'
const CPU_USER = 'builtin:host.cpu.user'
const CPU_SYSTEM = 'builtin:host.cpu.system'
const CPU_IOWAIT = 'builtin:host.cpu.iowait'
const LOAD = 'builtin:host.cpu.load'
const MEM = 'builtin:host.mem.usage'
const MEM_USED = 'builtin:host.mem.used'
const MEM_TOTAL = 'builtin:host.mem.total'
const NET_IN = 'builtin:host.net.nic.trafficIn'
const NET_OUT = 'builtin:host.net.nic.trafficOut'
const DISK = 'builtin:host.disk.usedPct'
const CANDIDATES = [
  CPU,
  CPU_USER,
  CPU_SYSTEM,
  CPU_IOWAIT,
  LOAD,
  MEM,
  MEM_USED,
  MEM_TOTAL,
  NET_IN,
  NET_OUT,
  DISK
] as const

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

/** Tramo de un valor (para unidades: ¿0–1, 0–100 o más?), nunca el valor. */
function range(value: number | null): string {
  if (value === null) return 'null'
  if (value < 0) return '< 0'
  if (value <= 1) return '[0, 1]'
  if (value <= 100) return '(1, 100]'
  if (value <= 1e6) return '(100, 1e6]'
  if (value <= 1e9) return '(1e6, 1e9]'
  return '> 1e9'
}

/** Cada resultado de /metrics/query con todas sus series. */
function resultsOf(body: Raw | null): { metricId: string; series: Series[]; ratios: unknown[] }[] {
  const results = (Array.isArray(body?.['result']) ? body['result'] : []) as Raw[]
  return results.map((result) => {
    const data = (Array.isArray(result['data']) ? result['data'] : []) as Raw[]
    return {
      metricId: String(result['metricId']),
      ratios: [result['dataPointCountRatio'], result['dimensionCountRatio']],
      series: data.map((item) => ({
        timestamps: (item['timestamps'] as number[] | undefined) ?? [],
        values: (item['values'] as (number | null)[] | undefined) ?? []
      }))
    }
  })
}

const ratioBucket = (value: unknown): string =>
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

const nonNull = (values: (number | null)[]): number[] =>
  values.filter((v): v is number => v !== null)
const mean = (values: (number | null)[]): number | null => {
  const present = nonNull(values)
  return present.length === 0 ? null : present.reduce((a, b) => a + b, 0) / present.length
}
const maxOf = (values: (number | null)[]): number | null => {
  const present = nonNull(values)
  return present.length === 0 ? null : Math.max(...present)
}
const lastOf = (values: (number | null)[]): number | null =>
  [...values].reverse().find((v) => v !== null) ?? null

/** Único valor de la primera serie (fold o Inf). */
const single = (series: Series[] | undefined): number | null => series?.[0]?.values[0] ?? null

/** Por timestamp, la suma (o el máximo) de varias series: lo que daría splitBy() a mano. */
function combine(series: Series[], how: 'sum' | 'max'): Map<number, number | null> {
  const out = new Map<number, number | null>()
  for (const item of series) {
    item.timestamps.forEach((t, i) => {
      const value = item.values[i] ?? null
      const current = out.get(t) ?? null
      if (value === null) {
        if (!out.has(t)) out.set(t, null)
        return
      }
      out.set(
        t,
        current === null ? value : how === 'sum' ? current + value : Math.max(current, value)
      )
    })
  }
  return out
}

/** ¿La serie combinada por Dynatrace coincide, punto a punto, con la combinada a mano? */
function sameAsManual(merged: Series | undefined, manual: Map<number, number | null>): string {
  if (merged === undefined) return 'sin serie'
  const tally = new Map<string, number>()
  merged.timestamps.forEach((t, i) => {
    const verdict = compare(merged.values[i] ?? null, manual.get(t) ?? null)
    tally.set(verdict, (tally.get(verdict) ?? 0) + 1)
  })
  return [...tally.entries()]
    .map(([verdict, count]) => `${verdict}: ${share(count, merged.timestamps.length)}`)
    .join('; ')
}

/** Series: las 10 expresiones, sin filtro (lo acota entitySelector). */
const SERIES_EXPRESSIONS = [
  CPU,
  CPU_USER,
  CPU_SYSTEM,
  CPU_IOWAIT,
  MEM,
  MEM_USED,
  MEM_TOTAL,
  `${NET_IN}:splitBy():sum`,
  `${NET_OUT}:splitBy():sum`,
  `${DISK}:splitBy():max`
]
const SERIES_NAMES = [
  'cpu',
  'cpu.user',
  'cpu.system',
  'cpu.iowait',
  'mem.usage',
  'mem.used',
  'mem.total',
  'red entrada (splitBy():sum)',
  'red salida (splitBy():sum)',
  'disco (splitBy():max)'
]

/** Marcadores con resolution=Inf (sin fold: juntos dan 400, ficha 0006). */
const INF_EXPRESSIONS = [
  `${CPU}:avg`,
  `${CPU}:max`,
  `${MEM}:avg`,
  `${NET_IN}:splitBy():sum`,
  `${NET_OUT}:splitBy():sum`,
  `${DISK}:splitBy():max`,
  `${LOAD}:avg`,
  // Por interfaz, para sumar a mano y comparar con splitBy():sum.
  `${NET_IN}:avg`,
  `${NET_OUT}:avg`,
  `${DISK}:max`
]
/** Los mismos marcadores con fold y la resolución de la API. */
const FOLD_EXPRESSIONS = [
  `${CPU}:avg:fold(avg)`,
  `${CPU}:max:fold(max)`,
  `${MEM}:avg:fold(avg)`,
  `${NET_IN}:splitBy():sum:fold(avg)`,
  `${NET_OUT}:splitBy():sum:fold(avg)`,
  `${DISK}:splitBy():max:fold(max)`,
  `${LOAD}:avg:fold(avg)`
]
const MARKER_NAMES = [
  'cpu media',
  'cpu máxima',
  'memoria media',
  'red entrada media',
  'red salida media',
  'disco más lleno',
  'carga media'
]

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
    join('live-reports', 'host-metrics-explore.json'),
    `${JSON.stringify(report, null, 2)}\n`
  )
})

describe.skipIf(live === null)('Ficha 0016: métricas de un host (paso 0)', () => {
  const hosts: string[] = []

  it('elige como mucho 3 hosts', async () => {
    const list = (await get('/problems', { from: 'now-7d', pageSize: 50 })) as Raw
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
        if (/^HOST-[0-9A-F]{16}$/.test(id) && !hosts.includes(id)) hosts.push(id)
      }
    }
    report['hosts sacados de problemas'] = Math.min(hosts.length, MAX_HOSTS)
    // Si los problemas no dan 3, se completa con los primeros de type("HOST").
    if (hosts.length < MAX_HOSTS) {
      const before = hosts.length
      const page = (await get('/entities', {
        entitySelector: 'type("HOST")',
        from: 'now-2h',
        pageSize: 2 * MAX_HOSTS
      })) as Raw
      for (const entity of (page['entities'] as Raw[] | undefined) ?? []) {
        const id = String(entity['entityId'])
        observed.add(id)
        if (typeof entity['displayName'] === 'string') observed.add(entity['displayName'])
        if (!hosts.includes(id)) hosts.push(id)
      }
      report['hosts sacados de /entities'] = Math.min(hosts.length, MAX_HOSTS) - before
    }
    hosts.splice(MAX_HOSTS)
    report['todos los ids con el formato HOST-<16 hex mayúsculas>'] = hosts.every((id) =>
      /^HOST-[0-9A-F]{16}$/.test(id)
    )
    expect(hosts.length).toBeGreaterThan(0)
  })

  it('descriptor de cada candidata y, si no existe, la integrada equivalente', async () => {
    const descriptors: Record<string, unknown> = {}
    for (const metric of CANDIDATES) {
      const { code, body } = await codeOf(get(`/metrics/${encodeURIComponent(metric)}`, {}))
      if (body === null) {
        // No existe (o no se puede leer): se busca la integrada equivalente por texto.
        const text = metric.split('.').slice(-1)[0] ?? metric
        const search = await codeOf(get('/metrics', { text, pageSize: 50 }))
        const found = ((search.body?.['metrics'] as Raw[] | undefined) ?? [])
          .map((m) => String(m['metricId']))
          // Solo las integradas del host: las propias del tenant no se anotan.
          .filter((id) => id.startsWith('builtin:host.'))
        descriptors[metric] = { codigo: code, busqueda: search.code, integradasDelHost: found }
        continue
      }
      const dimensions = ((body['dimensionDefinitions'] as Raw[] | undefined) ?? []).map(
        (d) => `${String(d['key'])} (${String(d['type'])})`
      )
      descriptors[metric] = {
        codigo: code,
        unit: body['unit'] ?? null,
        defaultAggregation: body['defaultAggregation'] ?? null,
        aggregationTypes: body['aggregationTypes'] ?? null,
        resolutionInfSupported: body['resolutionInfSupported'] ?? null,
        entityType: body['entityType'] ?? null,
        dimensiones: dimensions,
        fold: Array.isArray(body['transformations'])
          ? (body['transformations'] as unknown[]).includes('fold')
          : null,
        splitBy: Array.isArray(body['transformations'])
          ? (body['transformations'] as unknown[]).includes('splitBy')
          : null
      }
    }
    report['descriptores'] = descriptors
  })

  it('series, red y disco por interfaz y disco, y marcadores (Inf frente a fold)', async () => {
    const perRange: Record<string, unknown[]> = {}
    for (const span of RANGES) {
      const rows: unknown[] = []
      for (const [index, id] of hosts.entries()) {
        const row: Record<string, unknown> = { host: `#${index + 1}` }
        const scope = { entitySelector: `entityId("${id}")`, from: span }

        // 1. Las 10 expresiones de series en una consulta, con entitySelector.
        const series = await codeOf(
          get('/metrics/query', { metricSelector: SERIES_EXPRESSIONS.join(','), ...scope })
        )
        const results = resultsOf(series.body)
        const first = results.map((r) => r.series[0])
        row['series'] = {
          codigo: series.code,
          resolution: series.body?.['resolution'] ?? null,
          warnings: Array.isArray(series.body?.['warnings'])
            ? (series.body['warnings'] as unknown[]).length
            : 'sin campo',
          resultados: results.length,
          // Sin id en las expresiones: el metricId se puede comparar tal cual.
          ordenYMetricIdIgualAlPedido: results.every(
            (r, i) => r.metricId === SERIES_EXPRESSIONS[i]
          ),
          seriesPorResultado: Object.fromEntries(
            results.map((r, i) => [SERIES_NAMES[i], bucket(r.series.length)])
          ),
          tramosDeRatios: [...new Set(results.flatMap((r) => r.ratios.map(ratioBucket)))],
          puntos: Object.fromEntries(
            first.map((s, i) => [SERIES_NAMES[i], bucket(s?.timestamps.length ?? 0)])
          ),
          nulos: Object.fromEntries(
            first.map((s, i) => [
              SERIES_NAMES[i],
              share(s?.values.filter((v) => v === null).length ?? 0, s?.values.length ?? 0)
            ])
          ),
          tramoDeValores: Object.fromEntries(
            first.map((s, i) => [SERIES_NAMES[i], range(maxOf(s?.values ?? []))])
          ),
          ultimoPuntoNull: Object.fromEntries(
            first.map((s, i) => [SERIES_NAMES[i], (s?.values.at(-1) ?? null) === null])
          ),
          mismosTimestampsEnTodas: first.every(
            (s) =>
              JSON.stringify(s?.timestamps ?? []) === JSON.stringify(first[0]?.timestamps ?? [])
          ),
          // ¿user + system + iowait ≈ total? (si no, el desglose no suma el total)
          desgloseFrenteATotal: (() => {
            const total = first[0]
            if (total === undefined) return 'sin serie'
            const parts = [first[1], first[2], first[3]]
            const manual = new Map<number, number | null>()
            total.timestamps.forEach((t, i) => {
              const values = parts.map((p) => p?.values[p.timestamps.indexOf(t)] ?? null)
              manual.set(
                t,
                values.every((v) => v === null)
                  ? null
                  : values.reduce<number>((a, v) => a + (v ?? 0), 0)
              )
              void i
            })
            return sameAsManual(total, manual)
          })(),
          // ¿mem.used / mem.total × 100 ≈ mem.usage, en el último punto con dato?
          memoriaUsadaEntreTotalFrenteAUsage: (() => {
            const used = lastOf(first[5]?.values ?? [])
            const total = lastOf(first[6]?.values ?? [])
            const usage = lastOf(first[4]?.values ?? [])
            return used === null || total === null || total === 0
              ? 'sin datos'
              : compare((used * 100) / total, usage)
          })()
        }

        // 2. Red y disco sin juntar: una serie por interfaz o por disco.
        const split = await codeOf(
          get('/metrics/query', {
            metricSelector: [NET_IN, NET_OUT, DISK].join(','),
            ...scope
          })
        )
        const splitResults = resultsOf(split.body)
        row['red y disco sin juntar'] = {
          codigo: split.code,
          resolutionIgualALaDeSeries: split.body?.['resolution'] === series.body?.['resolution'],
          seriesPorResultado: {
            entrada: bucket(splitResults[0]?.series.length ?? 0),
            salida: bucket(splitResults[1]?.series.length ?? 0),
            disco: bucket(splitResults[2]?.series.length ?? 0)
          },
          splitBySumFrenteASumaAMano: {
            entrada: sameAsManual(first[7], combine(splitResults[0]?.series ?? [], 'sum')),
            salida: sameAsManual(first[8], combine(splitResults[1]?.series ?? [], 'sum'))
          },
          splitByMaxFrenteAMaxAMano: sameAsManual(
            first[9],
            combine(splitResults[2]?.series ?? [], 'max')
          )
        }

        // 3. Marcadores: resolution=Inf frente a fold.
        const inf = await codeOf(
          get('/metrics/query', {
            metricSelector: INF_EXPRESSIONS.join(','),
            resolution: 'Inf',
            ...scope
          })
        )
        const fold = await codeOf(
          get('/metrics/query', { metricSelector: FOLD_EXPRESSIONS.join(','), ...scope })
        )
        const infResults = resultsOf(inf.body)
        const foldResults = resultsOf(fold.body)
        const infValues = infResults.map((r) => single(r.series))
        const foldValues = foldResults.map((r) => single(r.series))
        const fromSeries = [
          mean(first[0]?.values ?? []),
          maxOf(first[0]?.values ?? []),
          mean(first[4]?.values ?? []),
          mean(first[7]?.values ?? []),
          mean(first[8]?.values ?? []),
          maxOf(first[9]?.values ?? []),
          null
        ]
        const sumOfSingles = (series: Series[] | undefined): number | null => {
          const values = (series ?? []).map((s) => s.values[0] ?? null)
          return values.every((v) => v === null)
            ? null
            : values.reduce<number>((a, v) => a + (v ?? 0), 0)
        }
        const maxOfSingles = (series: Series[] | undefined): number | null =>
          maxOf((series ?? []).map((s) => s.values[0] ?? null))
        row['marcadores'] = {
          codigoInf: inf.code,
          codigoFold: fold.code,
          resolutionInf: inf.body?.['resolution'] ?? null,
          resolutionFold: fold.body?.['resolution'] ?? null,
          puntosInf: [...new Set(infResults.map((r) => r.series[0]?.values.length ?? 0))],
          puntosFold: [...new Set(foldResults.map((r) => r.series[0]?.values.length ?? 0))],
          seriesPorResultadoInf: [...new Set(infResults.map((r) => bucket(r.series.length)))],
          tramosDeRatiosInf: [...new Set(infResults.flatMap((r) => r.ratios.map(ratioBucket)))],
          infFrenteAFold: Object.fromEntries(
            MARKER_NAMES.map((name, i) => [
              name,
              compare(infValues[i] ?? null, foldValues[i] ?? null)
            ])
          ),
          infFrenteALaSerie: Object.fromEntries(
            MARKER_NAMES.slice(0, 6).map((name, i) => [
              name,
              compare(infValues[i] ?? null, fromSeries[i] ?? null)
            ])
          ),
          foldFrenteALaSerie: Object.fromEntries(
            MARKER_NAMES.slice(0, 6).map((name, i) => [
              name,
              compare(foldValues[i] ?? null, fromSeries[i] ?? null)
            ])
          ),
          // splitBy():sum con Inf frente a la suma de las medias por interfaz (también con Inf).
          redInfSplitBySumFrenteASumaDeMediasPorInterfaz: {
            entrada: compare(infValues[3] ?? null, sumOfSingles(infResults[7]?.series)),
            salida: compare(infValues[4] ?? null, sumOfSingles(infResults[8]?.series))
          },
          discoInfSplitByMaxFrenteAMaxPorDisco: compare(
            infValues[5] ?? null,
            maxOfSingles(infResults[9]?.series)
          ),
          tramoDeValoresInf: Object.fromEntries(
            MARKER_NAMES.map((name, i) => [name, range(infValues[i] ?? null)])
          ),
          cargaConDato: infValues[6] !== null && infValues[6] !== undefined
        }
        rows.push(row)
      }
      perRange[span] = rows
    }
    report['por rango'] = perRange
  })

  it('CA1 (0016): el informe no contiene ningún id ni nombre observado', () => {
    const text = JSON.stringify(report)
    for (const value of observed) {
      if (value.length < 4) continue
      expect(text.includes(value), 'el informe contiene un id o un nombre observado').toBe(false)
    }
    expect(observed.size).toBeGreaterThan(0)
  })
})
