import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createLiveClient } from '../../test/live-client'
import { loadLiveEnv } from '../../test/live-env'
import { DtError } from '../dynatrace/errors'

/**
 * Ficha 0017, paso 0: EXPLORACIÓN EN VIVO del detalle por disco y de los procesos
 * de un host, SOLO LECTURA, una petición detrás de otra y unas 60 como mucho.
 *
 * Los mismos 3 hosts que la 0016 (los de los problemas de los últimos 7 días o,
 * si no hay, los primeros de type("HOST")). Se prueban las formas de limitar los
 * procesos al host: por relación en entitySelector, por la dimensión del host en
 * la expresión, con un filtro `in(..., entitySelector(...))` y con
 * `entityId("<host>")` a secas.
 *
 * El informe (live-reports/host-breakdown-explore.json, ignorado) guarda SOLO
 * comportamientos: códigos, unidades, agregaciones, claves de dimensiones,
 * órdenes y tramos. Nunca un id, un nombre ni un valor. CA1 (0017) comprueba que
 * no se cuela ningún id ni nombre observado.
 */

const env = loadLiveEnv()
const live = env === null ? null : createLiveClient(env)
const report: Record<string, unknown> = {}
const timings: number[] = []
/** Ids y nombres observados: el informe no puede contener ninguno (CA1). */
const observed = new Set<string>()
const MAX_HOSTS = 3

/** Candidatas de la ficha. */
const DISK_PCT = 'builtin:host.disk.usedPct'
const DISK_AVAIL = 'builtin:host.disk.avail'
const DISK_USED = 'builtin:host.disk.used'
const DISK_READ = 'builtin:host.disk.bytesRead'
const DISK_WRITE = 'builtin:host.disk.bytesWritten'
const PROC_CPU = 'builtin:tech.generic.cpu.usage'
const PROC_MEM = 'builtin:tech.generic.mem.workingSetSize'
const CANDIDATES = [
  DISK_PCT,
  DISK_AVAIL,
  DISK_USED,
  DISK_READ,
  DISK_WRITE,
  PROC_CPU,
  PROC_MEM
] as const

type Raw = Record<string, unknown>
interface Series {
  dimensionMap: Record<string, string>
  timestamps: number[]
  values: (number | null)[]
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
        : count <= 15
          ? '10-15'
          : count <= 50
            ? '16-50'
            : count <= 150
              ? '51-150'
              : count <= 1000
                ? '151-1000'
                : 'más de 1000'

const share = (part: number, whole: number): string =>
  whole === 0 ? 'sin datos' : `${Math.round((part / whole) * 20) * 5} %`

/** ¿Coinciden dos números? Solo el tramo de la diferencia, nunca los valores. */
function compare(a: number | null, b: number | null): string {
  if (a === null || b === null) return a === b ? 'los dos null' : 'uno null'
  if (a === b) return 'iguales'
  const scale = Math.max(Math.abs(a), Math.abs(b))
  const diff = Math.abs(a - b) / scale
  return diff < 1e-6 ? 'iguales (redondeo)' : diff < 0.01 ? 'casi (< 1 %)' : 'distintos (≥ 1 %)'
}

/** Tramo de un valor (para unidades), nunca el valor. */
function range(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'null'
  if (value < 0) return '< 0'
  if (value <= 1) return '[0, 1]'
  if (value <= 100) return '(1, 100]'
  if (value <= 1e6) return '(100, 1e6]'
  if (value <= 1e9) return '(1e6, 1e9]'
  return '> 1e9'
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

/** Cada resultado de /metrics/query con todas sus series; anota ids y nombres como observados. */
function resultsOf(body: Raw | null): { metricId: string; series: Series[]; ratios: unknown[] }[] {
  const results = (Array.isArray(body?.['result']) ? body['result'] : []) as Raw[]
  return results.map((result) => {
    const data = (Array.isArray(result['data']) ? result['data'] : []) as Raw[]
    return {
      metricId: String(result['metricId']),
      ratios: [result['dataPointCountRatio'], result['dimensionCountRatio']],
      series: data.map((item) => {
        const dimensionMap = (item['dimensionMap'] as Record<string, string> | undefined) ?? {}
        for (const value of Object.values(dimensionMap)) observed.add(String(value))
        return {
          dimensionMap,
          timestamps: (item['timestamps'] as number[] | undefined) ?? [],
          values: (item['values'] as (number | null)[] | undefined) ?? []
        }
      })
    }
  })
}

const lastOf = (values: (number | null)[]): number | null =>
  [...values].reverse().find((v) => v !== null) ?? null
const maxOf = (values: (number | null)[]): number | null => {
  const present = values.filter((v): v is number => v !== null)
  return present.length === 0 ? null : Math.max(...present)
}

/** Claves de dimensionMap de un resultado (sin valores). */
const dimensionKeys = (series: Series[]): string[] =>
  [...new Set(series.flatMap((s) => Object.keys(s.dimensionMap)))].sort()

/** ¿Todas las series traen un nombre no vacío en `<clave>.name`? */
function namesIn(series: Series[], key: string): string {
  if (series.length === 0) return 'sin series'
  const named = series.filter((s) => (s.dimensionMap[`${key}.name`] ?? '') !== '').length
  return share(named, series.length)
}

/** Ids (valor de la dimensión `key`) de las series. */
const idsOf = (series: Series[], key: string): string[] =>
  series.map((s) => s.dimensionMap[key] ?? '').filter((id) => id !== '')

/** Compara dos conjuntos de ids sin decir cuáles: solo si son iguales o cuánto se solapan. */
function sameSet(a: string[], b: string[]): string {
  const left = new Set(a)
  const right = new Set(b)
  if (left.size === 0 && right.size === 0) return 'los dos vacíos'
  const common = [...left].filter((id) => right.has(id)).length
  if (common === left.size && common === right.size) return 'iguales'
  if (common === right.size) return 'el primero tiene más (contiene al segundo)'
  if (common === left.size) return 'el segundo tiene más (contiene al primero)'
  return `distintos (comunes ${share(common, Math.max(left.size, right.size))})`
}

/** Selector de los procesos del host por relación (forma A de la ficha). */
const byRelation = (host: string): string =>
  `type("PROCESS_GROUP_INSTANCE"),fromRelationships.isProcessOf(entityId("${host}"))`

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
    join('live-reports', 'host-breakdown-explore.json'),
    `${JSON.stringify(report, null, 2)}\n`
  )
})

describe.skipIf(live === null)('Ficha 0017: discos y procesos de un host (paso 0)', () => {
  const hosts: string[] = []
  /** Dimensiones de cada candidata (del descriptor), para la forma por dimensión del host. */
  const dimensionsOf = new Map<string, string[]>()

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
    expect(hosts.length).toBeGreaterThan(0)
  })

  it('descriptor de cada candidata y, si no existe, la integrada equivalente', async () => {
    const descriptors: Record<string, unknown> = {}
    for (const metric of CANDIDATES) {
      const { code, body } = await codeOf(get(`/metrics/${encodeURIComponent(metric)}`, {}))
      if (body === null) {
        const text = metric.split('.').slice(-1)[0] ?? metric
        const search = await codeOf(get('/metrics', { text, pageSize: 50 }))
        const prefix = metric.startsWith('builtin:host.') ? 'builtin:host.' : 'builtin:tech.'
        const found = ((search.body?.['metrics'] as Raw[] | undefined) ?? [])
          .map((m) => String(m['metricId']))
          .filter((id) => id.startsWith(prefix))
        descriptors[metric] = { codigo: code, busqueda: search.code, integradas: found }
        continue
      }
      const definitions = (body['dimensionDefinitions'] as Raw[] | undefined) ?? []
      dimensionsOf.set(
        metric,
        definitions.map((d) => String(d['key']))
      )
      const transformations = Array.isArray(body['transformations'])
        ? (body['transformations'] as unknown[])
        : []
      descriptors[metric] = {
        codigo: code,
        unit: body['unit'] ?? null,
        defaultAggregation: body['defaultAggregation'] ?? null,
        aggregationTypes: body['aggregationTypes'] ?? null,
        resolutionInfSupported: body['resolutionInfSupported'] ?? null,
        entityType: body['entityType'] ?? null,
        dimensiones: definitions.map((d) => `${String(d['key'])} (${String(d['type'])})`),
        transformaciones: ['fold', 'last', 'limit', 'sort', 'filter', 'splitBy'].filter((t) =>
          transformations.includes(t)
        )
      }
    }
    report['descriptores'] = descriptors
  })

  it('discos: series por disco, último dato, máximo y lectura y escritura', async () => {
    const rows: unknown[] = []
    for (const [index, id] of hosts.entries()) {
      const row: Record<string, unknown> = { host: `#${index + 1}` }
      const scope = { entitySelector: `entityId("${id}")`, from: 'now-2h' }

      // 1. Serie de las 5 métricas de disco (resolución de la API).
      const series = await codeOf(
        get('/metrics/query', {
          metricSelector: [DISK_PCT, DISK_USED, DISK_AVAIL, DISK_READ, DISK_WRITE].join(','),
          ...scope
        })
      )
      const results = resultsOf(series.body)
      const perDisk = results.map((r) => r.series)
      row['series'] = {
        codigo: series.code,
        resolution: series.body?.['resolution'] ?? null,
        resultados: results.length,
        ordenIgualAlPedido:
          results.map((r) => r.metricId).join(',') ===
          [DISK_PCT, DISK_USED, DISK_AVAIL, DISK_READ, DISK_WRITE].join(','),
        discosPorResultado: perDisk.map((s) => bucket(s.length)),
        mismoNumeroDeDiscosEnTodas: new Set(perDisk.map((s) => s.length)).size <= 1,
        discosFrenteALosDeUsedPct: perDisk.map((s) =>
          sameSet(idsOf(s, 'dt.entity.disk'), idsOf(perDisk[0] ?? [], 'dt.entity.disk'))
        ),
        clavesDeDimensionMap: dimensionKeys(perDisk[0] ?? []),
        nombreDeDiscoEnDimensionMap: namesIn(perDisk[0] ?? [], 'dt.entity.disk'),
        tramoDeValores: results.map((r) => range(maxOf(r.series.flatMap((s) => s.values)))),
        ultimoPuntoNull: results.map((r) =>
          share(r.series.filter((s) => (s.values.at(-1) ?? null) === null).length, r.series.length)
        ),
        // ¿used / (used + avail) × 100 ≈ usedPct, en el último punto con dato de cada disco?
        usedEntreUsedMasAvailFrenteAUsedPct: (() => {
          const pct = perDisk[0] ?? []
          return pct.map((disk) => {
            const key = disk.dimensionMap['dt.entity.disk']
            const used = (perDisk[1] ?? []).find((s) => s.dimensionMap['dt.entity.disk'] === key)
            const avail = (perDisk[2] ?? []).find((s) => s.dimensionMap['dt.entity.disk'] === key)
            const u = lastOf(used?.values ?? [])
            const a = lastOf(avail?.values ?? [])
            return u === null || a === null || u + a === 0
              ? 'sin datos'
              : compare((u * 100) / (u + a), lastOf(disk.values))
          })
        })(),
        tramosDeRatios: [...new Set(results.flatMap((r) => r.ratios.map(ratioBucket)))]
      }

      // 2. Marcadores con resolution=Inf: máximo y media del uso, y lectura y escritura medias.
      const inf = await codeOf(
        get('/metrics/query', {
          metricSelector: [
            `${DISK_PCT}:max`,
            `${DISK_PCT}:avg`,
            DISK_READ,
            DISK_WRITE,
            DISK_USED,
            DISK_AVAIL
          ].join(','),
          resolution: 'Inf',
          ...scope
        })
      )
      const infResults = resultsOf(inf.body)
      row['inf'] = {
        codigo: inf.code,
        discosPorResultado: infResults.map((r) => bucket(r.series.length)),
        puntosPorSerie: [
          ...new Set(infResults.flatMap((r) => r.series.map((s) => s.values.length)))
        ],
        clavesDeDimensionMap: dimensionKeys(infResults[0]?.series ?? []),
        nombreDeDiscoEnDimensionMap: namesIn(infResults[0]?.series ?? [], 'dt.entity.disk'),
        // ¿El máximo con Inf es el máximo de la serie de medias del mismo disco?
        maxInfFrenteAMaxDeLaSerie: (infResults[0]?.series ?? []).map((disk) => {
          const key = disk.dimensionMap['dt.entity.disk']
          const fromSeries = (perDisk[0] ?? []).find(
            (s) => s.dimensionMap['dt.entity.disk'] === key
          )
          return compare(disk.values[0] ?? null, maxOf(fromSeries?.values ?? []))
        }),
        tramoDeValores: infResults.map((r) =>
          range(maxOf(r.series.map((s) => s.values[0] ?? null)))
        )
      }

      // 3. ¿`:last` da el último dato con Inf? (si no, sale de la serie)
      const last = await codeOf(
        get('/metrics/query', {
          metricSelector: [`${DISK_PCT}:last`, `${DISK_USED}:last`, `${DISK_AVAIL}:last`].join(','),
          resolution: 'Inf',
          ...scope
        })
      )
      const lastResults = resultsOf(last.body)
      row[':last con Inf'] = {
        codigo: last.code,
        frenteAlUltimoConDatoDeLaSerie: lastResults.map((r, i) =>
          r.series.map((disk) => {
            const key = disk.dimensionMap['dt.entity.disk']
            const fromSeries = (perDisk[i] ?? []).find(
              (s) => s.dimensionMap['dt.entity.disk'] === key
            )
            return compare(disk.values[0] ?? null, lastOf(fromSeries?.values ?? []))
          })
        )
      }

      // 4. now-7d: la consulta de marcadores sigue cabiendo.
      const week = await codeOf(
        get('/metrics/query', {
          metricSelector: [`${DISK_PCT}:max`, DISK_READ, DISK_WRITE].join(','),
          resolution: 'Inf',
          entitySelector: `entityId("${id}")`,
          from: 'now-7d'
        })
      )
      row['inf now-7d'] = {
        codigo: week.code,
        discosPorResultado: resultsOf(week.body).map((r) => bucket(r.series.length))
      }

      // 5. ¿`:names` añade el nombre del disco a dimensionMap (series e Inf)?
      const named = await codeOf(
        get('/metrics/query', {
          metricSelector: [`${DISK_PCT}:names`, `${DISK_READ}:names`].join(','),
          ...scope
        })
      )
      const namedInf = await codeOf(
        get('/metrics/query', {
          metricSelector: `${DISK_PCT}:max:names`,
          resolution: 'Inf',
          ...scope
        })
      )
      const namedResults = resultsOf(named.body)
      const namedInfResults = resultsOf(namedInf.body)
      row[':names'] = {
        codigo: named.code,
        codigoInf: namedInf.code,
        metricIdIgualAlPedido: namedResults[0]?.metricId === `${DISK_PCT}:names`,
        clavesDeDimensionMap: dimensionKeys(namedResults[0]?.series ?? []),
        nombreDeDiscoEnSeries: namedResults.map((r) => namesIn(r.series, 'dt.entity.disk')),
        nombreDeDiscoConInf: namesIn(namedInfResults[0]?.series ?? [], 'dt.entity.disk'),
        mismosDiscosQueSinNames: sameSet(
          idsOf(namedResults[0]?.series ?? [], 'dt.entity.disk'),
          idsOf(perDisk[0] ?? [], 'dt.entity.disk')
        )
      }
      rows.push(row)
    }
    report['discos'] = rows
  })

  it('procesos: formas de limitarlos al host, nombres y número', async () => {
    const rows: unknown[] = []
    const hostDimension = (dimensionsOf.get(PROC_CPU) ?? []).includes('dt.entity.host')
    report['la métrica de CPU por proceso trae la dimensión dt.entity.host'] = hostDimension
    const PGI = 'dt.entity.process_group_instance'
    const expressions = [`${PROC_CPU}:avg`, `${PROC_CPU}:max`, `${PROC_MEM}:avg`]

    for (const [index, id] of hosts.entries()) {
      const row: Record<string, unknown> = { host: `#${index + 1}` }

      // Referencia: los procesos del host según /entities con la misma relación.
      const entities = await codeOf(
        get('/entities', { entitySelector: byRelation(id), from: 'now-2h', pageSize: 500 })
      )
      const entityIds = ((entities.body?.['entities'] as Raw[] | undefined) ?? []).map((e) => {
        const entityId = String(e['entityId'])
        observed.add(entityId)
        if (typeof e['displayName'] === 'string') observed.add(e['displayName'])
        return entityId
      })
      row['/entities por relación'] = {
        codigo: entities.code,
        procesos: bucket(entityIds.length),
        totalCount: bucket(Number(entities.body?.['totalCount'] ?? 0))
      }

      // A. Por relación en entitySelector.
      const a = await codeOf(
        get('/metrics/query', {
          metricSelector: expressions.join(','),
          resolution: 'Inf',
          entitySelector: byRelation(id),
          from: 'now-2h'
        })
      )
      const aResults = resultsOf(a.body)
      const aIds = idsOf(aResults[0]?.series ?? [], PGI)
      row['A: entitySelector por relación'] = {
        codigo: a.code,
        resultados: aResults.length,
        procesosPorResultado: aResults.map((r) => bucket(r.series.length)),
        frenteAEntities: sameSet(aIds, entityIds),
        mismosProcesosEnCpuYMemoria: sameSet(aIds, idsOf(aResults[2]?.series ?? [], PGI)),
        clavesDeDimensionMap: dimensionKeys(aResults[0]?.series ?? []),
        nombreDeProcesoEnDimensionMap: namesIn(aResults[0]?.series ?? [], PGI),
        puntosPorSerie: [...new Set(aResults.flatMap((r) => r.series.map((s) => s.values.length)))],
        tramoDeValores: aResults.map((r) => range(maxOf(r.series.map((s) => s.values[0] ?? null)))),
        procesosSinCpu: share(
          (aResults[0]?.series ?? []).filter((s) => (s.values[0] ?? null) === null).length,
          aResults[0]?.series.length ?? 0
        ),
        tramosDeRatios: [...new Set(aResults.flatMap((r) => r.ratios.map(ratioBucket)))]
      }

      // B. Por la dimensión del host en la expresión (si la métrica la tiene; se prueba igual).
      const b = await codeOf(
        get('/metrics/query', {
          metricSelector: `${PROC_CPU}:filter(eq("dt.entity.host","${id}")):avg`,
          resolution: 'Inf',
          from: 'now-2h'
        })
      )
      const bResults = resultsOf(b.body)
      row['B: filtro por la dimensión dt.entity.host'] = {
        codigo: b.code,
        procesos: bucket(bResults[0]?.series.length ?? 0),
        frenteAEntities: sameSet(idsOf(bResults[0]?.series ?? [], PGI), entityIds)
      }

      // C. Filtro in(...) con un entitySelector dentro de la expresión.
      const c = await codeOf(
        get('/metrics/query', {
          metricSelector: `${PROC_CPU}:filter(in("${PGI}",entitySelector("type(PROCESS_GROUP_INSTANCE),fromRelationships.isProcessOf(entityId(${id}))"))):avg`,
          resolution: 'Inf',
          from: 'now-2h'
        })
      )
      const cResults = resultsOf(c.body)
      row['C: filtro in(entitySelector(...)) en la expresión'] = {
        codigo: c.code,
        procesos: bucket(cResults[0]?.series.length ?? 0),
        frenteAEntities: sameSet(idsOf(cResults[0]?.series ?? [], PGI), entityIds),
        frenteAA: sameSet(idsOf(cResults[0]?.series ?? [], PGI), aIds)
      }

      // D. entitySelector=entityId("<host>") a secas (el host no es la entidad de la métrica).
      const d = await codeOf(
        get('/metrics/query', {
          metricSelector: `${PROC_CPU}:avg`,
          resolution: 'Inf',
          entitySelector: `entityId("${id}")`,
          from: 'now-2h'
        })
      )
      row['D: entitySelector entityId(host)'] = {
        codigo: d.code,
        procesos: bucket(resultsOf(d.body)[0]?.series.length ?? 0)
      }

      // E. Top 10 en Dynatrace (sort + limit) frente al top 10 calculado de A.
      const e = await codeOf(
        get('/metrics/query', {
          metricSelector: `${PROC_CPU}:avg:sort(value(avg,descending)):limit(10)`,
          resolution: 'Inf',
          entitySelector: byRelation(id),
          from: 'now-2h'
        })
      )
      const top = [...(aResults[0]?.series ?? [])]
        .sort((x, y) => (y.values[0] ?? -1) - (x.values[0] ?? -1))
        .slice(0, 10)
      row['E: sort + limit(10)'] = {
        codigo: e.code,
        procesos: bucket(resultsOf(e.body)[0]?.series.length ?? 0),
        frenteATop10DeA: sameSet(idsOf(resultsOf(e.body)[0]?.series ?? [], PGI), idsOf(top, PGI))
      }

      // F. now-7d con la forma A.
      const week = await codeOf(
        get('/metrics/query', {
          metricSelector: expressions.join(','),
          resolution: 'Inf',
          entitySelector: byRelation(id),
          from: 'now-7d'
        })
      )
      const weekResults = resultsOf(week.body)
      row['A now-7d'] = {
        codigo: week.code,
        procesosPorResultado: weekResults.map((r) => bucket(r.series.length)),
        tramosDeRatios: [...new Set(weekResults.flatMap((r) => r.ratios.map(ratioBucket)))]
      }

      // G. ¿`:names` añade el nombre del proceso a dimensionMap (forma A, Inf)?
      const named = await codeOf(
        get('/metrics/query', {
          metricSelector: [`${PROC_CPU}:avg:names`, `${PROC_MEM}:avg:names`].join(','),
          resolution: 'Inf',
          entitySelector: byRelation(id),
          from: 'now-2h'
        })
      )
      const namedResults = resultsOf(named.body)
      row['G: :names'] = {
        codigo: named.code,
        clavesDeDimensionMap: dimensionKeys(namedResults[0]?.series ?? []),
        nombreDeProceso: namedResults.map((r) => namesIn(r.series, PGI)),
        mismosProcesosQueA: sameSet(idsOf(namedResults[0]?.series ?? [], PGI), aIds),
        mismoValorQueA: (namedResults[0]?.series ?? []).every((s) => {
          const plain = (aResults[0]?.series ?? []).find(
            (p) => p.dimensionMap[PGI] === s.dimensionMap[PGI]
          )
          return compare(s.values[0] ?? null, plain?.values[0] ?? null).startsWith('iguales')
        })
      }
      rows.push(row)
    }
    report['procesos'] = rows
  })

  it('CA1 (0017): el informe no contiene ningún id ni nombre observado y dice qué forma limita los procesos al host', () => {
    const text = JSON.stringify(report)
    for (const value of observed) {
      if (value.length < 4) continue
      expect(text.includes(value), 'el informe contiene un id o un nombre observado').toBe(false)
    }
    expect(observed.size).toBeGreaterThan(0)
    // Hay un veredicto por cada forma de limitar los procesos al host.
    const rows = (report['procesos'] as Raw[] | undefined) ?? []
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row).toHaveProperty(['A: entitySelector por relación', 'codigo'])
      expect(row).toHaveProperty(['B: filtro por la dimensión dt.entity.host', 'codigo'])
    }
  })
})
