import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createLiveClient } from '../../test/live-client'
import { loadLiveEnv } from '../../test/live-env'
import { DtError } from '../dynatrace/errors'

/**
 * Ficha 0031, paso 0: EXPLORACIÓN EN VIVO de las métricas de un process group
 * (PROCESS_GROUP). SOLO LECTURA, una petición detrás de otra.
 *
 * 1. Catálogo de las métricas que ya usa la página del proceso (0027) con sus dimensiones.
 * 2. Como mucho 3 grupos de los procesos de los hosts de los problemas de los últimos 7 días
 *    (y, si ninguno tiene varias instancias, el de más instancias entre los candidatos).
 * 3. Instancias del grupo con `type("PROCESS_GROUP_INSTANCE"),fromRelationships.isInstanceOf(…)`:
 *    cuántas (tramos), si traen nombre y su host (relación `isProcessOf`).
 * 4. Métricas con ese selector: por instancia (`splitBy("dt.entity.process_group_instance")`,
 *    con `:names` y con `:parents`) y del grupo (varias formas de `splitBy()`), comparadas con
 *    la suma y la media de las series por instancia; y los marcadores con `resolution=Inf`.
 *
 * El informe (live-reports/process-group-metrics-explore.json, ignorado) guarda SOLO
 * comportamientos y claves de la API. Nunca un id, un nombre ni un valor. CA1 (0031)
 * comprueba que no se cuela ningún id ni nombre observado.
 */

const env = loadLiveEnv()
const live = env === null ? null : createLiveClient(env)
const report: Record<string, unknown> = {}
const timings: number[] = []
/** Ids, nombres y valores observados: el informe no puede contener ninguno (CA1). */
const observed = new Set<string>()
const MAX_GROUPS = 3
/** Grupos candidatos (de los hosts de los problemas) que se cuentan como mucho. */
const MAX_CANDIDATES = 20
const FROM = 'now-24h'
const PG_PATTERN = /^PROCESS_GROUP-[0-9A-F]{16}$/
const PGI_PATTERN = /^PROCESS_GROUP_INSTANCE-[0-9A-F]{16}$/
const HOST_PATTERN = /^HOST-[0-9A-F]{16}$/

type Raw = Record<string, unknown>
type Values = (number | null)[]

const G = 'builtin:tech.generic.'
/** Las de la página del proceso (0027) que pide la ficha para el grupo. */
const METRICS = {
  cpu: `${G}cpu.usage`,
  memoria: `${G}mem.workingSetSize`,
  redEntrada: `${G}network.bytesRx`,
  redSalida: `${G}network.bytesTx`
} as const
const BY_PGI = 'splitBy("dt.entity.process_group_instance")'
/** Por instancia, con su host (`:parents`) y los nombres de los dos. */
const BY_PGI_AND_HOST = 'parents:splitBy("dt.entity.process_group_instance","dt.entity.host")'

/**
 * Consultas que usará el canal, elegidas con lo de arriba: el total del grupo es
 * `:splitBy():sum` (punto a punto, igual a la suma de las series por instancia; con
 * `resolution=Inf`, a menos del 1 % de la media de esa suma). Las instancias, con
 * `:parents` y `:names`, traen su nombre, su host y el nombre del host.
 */
const CHANNEL_SERIES = [
  `${METRICS.cpu}:splitBy():sum`,
  `${METRICS.memoria}:splitBy():sum`,
  `${METRICS.redEntrada}:splitBy():sum`,
  `${METRICS.redSalida}:splitBy():sum`
]
const CHANNEL_MARKERS = [
  ...CHANNEL_SERIES,
  `${METRICS.cpu}:${BY_PGI_AND_HOST}:avg:names`,
  `${METRICS.memoria}:${BY_PGI_AND_HOST}:avg:names`
]

/** Selector de las instancias de un grupo (el que propone la ficha). */
const groupSelector = (id: string): string =>
  `type("PROCESS_GROUP_INSTANCE"),fromRelationships.isInstanceOf(entityId("${id}"))`

const isEnum = (value: string): boolean =>
  /^[A-Z][A-Z0-9_]*$/.test(value) || /^(true|false|null)$/.test(value)
const observe = (value: unknown): void => {
  if (typeof value === 'string' && !isEnum(value)) observed.add(value)
  if (typeof value === 'number') return
  if (Array.isArray(value)) for (const item of value) observe(item)
  else if (value !== null && typeof value === 'object')
    for (const item of Object.values(value as Raw)) observe(item)
}

/** De una entidad: su id, su nombre y los ids de sus relaciones (no el resto de propiedades). */
function observeEntity(entity: Raw): void {
  observe(entity['entityId'])
  observe(entity['displayName'])
  observe((entity['properties'] as Raw | undefined)?.['detectedName'])
  for (const direction of ['fromRelationships', 'toRelationships']) {
    for (const targets of Object.values((entity[direction] as Raw | undefined) ?? {})) {
      for (const target of Array.isArray(targets) ? (targets as Raw[]) : []) observe(target['id'])
    }
  }
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
      : count < 5
        ? '2-4'
        : count < 10
          ? '5-9'
          : count <= 50
            ? '10-50'
            : count <= 150
              ? '51-150'
              : 'más de 150'

/** Tramo de un valor, nunca el valor. */
function range(value: number | null): string {
  if (value === null) return 'null'
  if (value < 0) return '< 0'
  if (value <= 1) return '[0, 1]'
  if (value <= 100) return '(1, 100]'
  if (value <= 1e6) return '(100, 1e6]'
  if (value <= 1e9) return '(1e6, 1e9]'
  return '> 1e9'
}

/** ¿Coinciden dos números? Solo el tramo de la diferencia, nunca los valores. */
function compare(a: number | null, b: number | null): string {
  if (a === null || b === null) return a === b ? 'los dos null' : 'uno null'
  if (a === b) return 'iguales'
  const scale = Math.max(Math.abs(a), Math.abs(b))
  const diff = Math.abs(a - b) / scale
  return diff < 1e-6 ? 'iguales (redondeo)' : diff < 0.01 ? 'casi (< 1 %)' : 'distintos (≥ 1 %)'
}

/** Peor comparación punto a punto de dos series (mismos timestamps). */
function compareSeries(a: Values, b: Values): string {
  if (a.length !== b.length) return `largos distintos`
  const order = ['iguales', 'iguales (redondeo)', 'los dos null', 'casi (< 1 %)', 'uno null']
  let worst = 'iguales'
  for (const [i, value] of a.entries()) {
    const result = compare(value, b[i] ?? null)
    const rank = (r: string): number => (order.includes(r) ? order.indexOf(r) : order.length)
    if (rank(result) > rank(worst)) worst = result
  }
  return worst
}

const dimKey = (key: string): string =>
  /^[A-Za-z][A-Za-z0-9_.: ()-]{0,60}$/.test(key) ? key : 'otra'

interface SeriesItem {
  dimensionMap: Record<string, unknown>
  timestamps: number[]
  values: Values
}

/** Una consulta de /metrics/query: código, resolución y series por expresión. */
async function query(
  metricSelector: string,
  entitySelector: string,
  extra: Record<string, string> = {}
): Promise<{
  code: string
  resolution: unknown
  results: { metricId: unknown; data: SeriesItem[] }[]
}> {
  const { code, body } = await codeOf(
    get('/metrics/query', { metricSelector, entitySelector, from: FROM, ...extra })
  )
  const results = ((body?.['result'] as Raw[] | undefined) ?? []).map((r) => {
    const data = ((r['data'] as Raw[] | undefined) ?? []).map((d) => ({
      dimensionMap: (d['dimensionMap'] as Record<string, unknown> | undefined) ?? {},
      timestamps: (d['timestamps'] as number[] | undefined) ?? [],
      values: (d['values'] as Values | undefined) ?? []
    }))
    for (const item of data) observe(item.dimensionMap)
    return { metricId: r['metricId'], data }
  })
  return { code, resolution: body?.['resolution'] ?? null, results }
}

/** Suma y media, punto a punto, de varias series con los mismos timestamps (null si todas null). */
function pointwise(series: Values[], how: 'sum' | 'avg'): Values {
  const length = Math.max(0, ...series.map((s) => s.length))
  return Array.from({ length }, (_, i) => {
    const present = series.map((s) => s[i] ?? null).filter((v): v is number => v !== null)
    if (present.length === 0) return null
    const sum = present.reduce((a, b) => a + b, 0)
    return how === 'sum' ? sum : sum / present.length
  })
}

const mean = (values: Values): number | null => {
  const present = values.filter((v): v is number => v !== null)
  return present.length === 0 ? null : present.reduce((a, b) => a + b, 0) / present.length
}
const maxOf = (values: Values): number | null => {
  const present = values.filter((v): v is number => v !== null)
  return present.length === 0 ? null : Math.max(...present)
}

const groups: string[] = []
const instanceCount = new Map<string, number>()

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
    join('live-reports', 'process-group-metrics-explore.json'),
    `${JSON.stringify(report, null, 2)}\n`
  )
})

describe.skipIf(live === null)('Ficha 0031: métricas de un process group (paso 0)', () => {
  it('catálogo: dimensiones de las métricas del proceso (0027)', async () => {
    const out: Record<string, unknown> = {}
    const { code, body } = await codeOf(
      get('/metrics', {
        metricSelector: Object.values(METRICS).join(','),
        fields: '+unit,+defaultAggregation,+aggregationTypes,+dimensionDefinitions,+entityType',
        pageSize: 100
      })
    )
    for (const m of (body?.['metrics'] as Raw[] | undefined) ?? []) {
      out[String(m['metricId'])] = {
        unidad: m['unit'] ?? null,
        agregacionPorDefecto: (m['defaultAggregation'] as Raw | null)?.['type'] ?? null,
        agregaciones: m['aggregationTypes'] ?? null,
        tipoDeEntidad: m['entityType'] ?? null,
        dimensiones: ((m['dimensionDefinitions'] as Raw[] | undefined) ?? []).map((d) =>
          dimKey(String(d['key']))
        )
      }
    }
    report['catalogo'] = { codigo: code, metricas: out }
    expect(Object.keys(out).length).toBeGreaterThan(0)
  })

  it('elige como mucho 3 grupos de los procesos de los hosts de los problemas', async () => {
    const hosts: string[] = []
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
        if (HOST_PATTERN.test(id) && !hosts.includes(id)) hosts.push(id)
      }
    }
    // Grupos de los procesos de esos hosts (por la relación isInstanceOf de cada instancia).
    const candidates: string[] = []
    for (const host of hosts) {
      if (candidates.length >= MAX_CANDIDATES) break
      const page = await codeOf(
        get('/entities', {
          entitySelector: `type("PROCESS_GROUP_INSTANCE"),fromRelationships.isProcessOf(entityId("${host}"))`,
          fields: '+fromRelationships.isInstanceOf',
          from: FROM,
          pageSize: 10
        })
      )
      for (const entity of (page.body?.['entities'] as Raw[] | undefined) ?? []) {
        observed.add(String(entity['entityId']))
        if (typeof entity['displayName'] === 'string') observed.add(entity['displayName'])
        const targets =
          ((entity['fromRelationships'] as Raw | undefined)?.['isInstanceOf'] as
            Raw[] | undefined) ?? []
        for (const target of targets) {
          const id = String(target['id'])
          observed.add(id)
          if (PG_PATTERN.test(id) && !candidates.includes(id) && candidates.length < MAX_CANDIDATES)
            candidates.push(id)
        }
      }
    }
    // Cuántas instancias tiene cada candidato (totalCount con pageSize 1).
    for (const id of candidates) {
      const page = await codeOf(
        get('/entities', { entitySelector: groupSelector(id), from: FROM, pageSize: 1 })
      )
      const total = page.body?.['totalCount']
      instanceCount.set(id, typeof total === 'number' ? total : -1)
    }
    groups.push(...candidates.slice(0, MAX_GROUPS))
    const multi = [...instanceCount.entries()].sort((a, b) => b[1] - a[1])[0]
    if (
      multi !== undefined &&
      multi[1] > 1 &&
      !groups.some((id) => (instanceCount.get(id) ?? 0) > 1)
    ) {
      groups.splice(MAX_GROUPS - 1, 1, multi[0])
    }
    report['grupos'] = {
      hostsDeProblemas: bucket(hosts.length),
      candidatos: candidates.length,
      instanciasPorCandidato: [...instanceCount.values()].map(bucket).sort(),
      elegidos: groups.map((id) => bucket(instanceCount.get(id) ?? 0)),
      formatoDelId: groups.every((id) => PG_PATTERN.test(id))
    }
    expect(groups.length).toBeGreaterThan(0)
  })

  it('instancias del grupo: selector, nombres y host', async () => {
    const rows: unknown[] = []
    for (const [index, id] of groups.entries()) {
      const { code, body } = await codeOf(
        get('/entities', {
          entitySelector: groupSelector(id),
          fields: '+fromRelationships.isProcessOf,+properties.detectedName',
          from: FROM,
          pageSize: 500
        })
      )
      const entities = (body?.['entities'] as Raw[] | undefined) ?? []
      for (const entity of entities) observeEntity(entity)
      const hostsOf = entities.map(
        (e) =>
          ((e['fromRelationships'] as Raw | undefined)?.['isProcessOf'] as Raw[] | undefined) ?? []
      )
      // La otra dirección: la entidad del grupo con toRelationships.isInstanceOf.
      const group = await codeOf(get(`/entities/${id}`, { fields: '+toRelationships' }))
      if (group.body !== null) observeEntity(group.body)
      const toInstances =
        ((group.body?.['toRelationships'] as Raw | undefined)?.['isInstanceOf'] as
          Raw[] | undefined) ?? []
      // Nombres de los hosts de las instancias, con un selector anidado.
      const hostQuery = await codeOf(
        get('/entities', {
          entitySelector: `type("HOST"),toRelationships.isProcessOf(${groupSelector(id)})`,
          from: FROM,
          pageSize: 500
        })
      )
      const hostEntities = (hostQuery.body?.['entities'] as Raw[] | undefined) ?? []
      for (const host of hostEntities) observeEntity(host)
      rows.push({
        grupo: `#${index + 1}`,
        codigo: code,
        instancias: bucket(entities.length),
        totalCountIgualALaLista: body?.['totalCount'] === entities.length,
        todasConDisplayName: entities.every((e) => typeof e['displayName'] === 'string'),
        todasConIdDeInstancia: entities.every((e) => PGI_PATTERN.test(String(e['entityId']))),
        hostsPorInstancia: [...new Set(hostsOf.map((h) => bucket(h.length)))].sort(),
        hostsSonHost: hostsOf.flat().every((h) => HOST_PATTERN.test(String(h['id']))),
        entidadDelGrupo: {
          codigo: group.code,
          toIsInstanceOf: bucket(toInstances.length),
          mismasInstancias:
            toInstances.length === entities.length &&
            toInstances.every((t) => entities.some((e) => e['entityId'] === t['id']))
        },
        hostsAnidados: {
          codigo: hostQuery.code,
          hosts: bucket(hostEntities.length),
          conDisplayName: hostEntities.every((h) => typeof h['displayName'] === 'string'),
          mismosQueLasRelaciones:
            new Set(hostsOf.flat().map((h) => h['id'])).size === hostEntities.length
        }
      })
    }
    report['instancias'] = rows
  })

  it('métricas por instancia: splitBy de la instancia, con :names y con :parents', async () => {
    const rows: unknown[] = []
    for (const [index, id] of groups.entries()) {
      const selector = groupSelector(id)
      const variants: Record<string, string> = {
        porInstancia: `${METRICS.cpu}:${BY_PGI}`,
        porInstanciaConNombres: `${METRICS.cpu}:${BY_PGI}:names`,
        conParents: `${METRICS.cpu}:parents:splitBy("dt.entity.process_group_instance","dt.entity.host"):names`,
        conParentsSinSplit: `${METRICS.cpu}:parents:names`
      }
      const out: Record<string, unknown> = { grupo: `#${index + 1}` }
      for (const [label, expression] of Object.entries(variants)) {
        const result = await query(expression, selector, { resolution: 'Inf' })
        const data = result.results[0]?.data ?? []
        out[label] = {
          codigo: result.code,
          metricIdIgualAlPedido: result.results[0]?.metricId === expression,
          series: bucket(data.length),
          seriesIgualAInstancias: data.length === instanceCount.get(id),
          clavesDeDimensionMap: [
            ...new Set(data.flatMap((d) => Object.keys(d.dimensionMap).map(dimKey)))
          ].sort(),
          hostEsHost: data.every((d) =>
            d.dimensionMap['dt.entity.host'] === undefined
              ? true
              : HOST_PATTERN.test(String(d.dimensionMap['dt.entity.host']))
          )
        }
      }
      // Sin el selector del grupo: entityId del grupo con la métrica de la instancia.
      const direct = await query(METRICS.cpu, `entityId("${id}")`, { resolution: 'Inf' })
      out['entityIdDelGrupo'] = {
        codigo: direct.code,
        series: bucket(direct.results[0]?.data.length ?? 0)
      }
      rows.push(out)
    }
    report['porInstancia'] = rows
  })

  it('métricas del grupo: formas de splitBy() frente a la suma y la media de las instancias', async () => {
    const rows: unknown[] = []
    for (const [index, id] of groups.entries()) {
      const selector = groupSelector(id)
      const out: Record<string, unknown> = { grupo: `#${index + 1}` }
      for (const [role, metric] of Object.entries(METRICS)) {
        const perInstance = await query(`${metric}:${BY_PGI}`, selector)
        const series = (perInstance.results[0]?.data ?? []).map((d) => d.values)
        const sum = pointwise(series, 'sum')
        const avg = pointwise(series, 'avg')
        const forms: Record<string, string> = {
          splitBy: `${metric}:splitBy()`,
          splitBySum: `${metric}:splitBy():sum`,
          splitByAvg: `${metric}:splitBy():avg`,
          avgLuegoSplitBySum: `${metric}:${BY_PGI}:avg:splitBy():sum`,
          avgSplitBySum: `${metric}:avg:splitBy():sum`
        }
        const formsOut: Record<string, unknown> = {}
        for (const [label, expression] of Object.entries(forms)) {
          const group = await query(expression, selector)
          const data = group.results[0]?.data ?? []
          const values = data[0]?.values ?? []
          formsOut[label] = {
            expresion: expression.replace(metric, '<métrica>'),
            codigo: group.code,
            resolution: group.resolution,
            mismaResolucionQuePorInstancia: group.resolution === perInstance.resolution,
            metricIdIgualAlPedido: group.results[0]?.metricId === expression,
            series: bucket(data.length),
            clavesDeDimensionMap: [
              ...new Set(data.flatMap((d) => Object.keys(d.dimensionMap).map(dimKey)))
            ].sort(),
            frenteALaSuma: compareSeries(values, sum),
            frenteALaMedia: compareSeries(values, avg),
            tramoMaximo: range(maxOf(values))
          }
        }
        out[role] = {
          codigoPorInstancia: perInstance.code,
          resolutionPorInstancia: perInstance.resolution,
          seriesPorInstancia: bucket(series.length),
          formas: formsOut
        }
      }
      rows.push(out)
    }
    report['grupo'] = rows
  })

  it('marcadores del grupo y por instancia con resolution=Inf', async () => {
    const rows: unknown[] = []
    for (const [index, id] of groups.entries()) {
      const selector = groupSelector(id)
      const out: Record<string, unknown> = { grupo: `#${index + 1}` }
      for (const [role, metric] of Object.entries(METRICS)) {
        // La serie del grupo como suma de las instancias, punto a punto (lo de referencia).
        const perInstance = await query(`${metric}:${BY_PGI}`, selector)
        const sum = pointwise(
          (perInstance.results[0]?.data ?? []).map((d) => d.values),
          'sum'
        )
        const expressions: Record<string, string> = {
          avg: `${metric}:splitBy():avg`,
          max: `${metric}:splitBy():max`,
          sum: `${metric}:splitBy():sum`,
          avgLuegoSuma: `${metric}:${BY_PGI}:avg:splitBy():sum`,
          maxLuegoSuma: `${metric}:${BY_PGI}:max:splitBy():sum`,
          porInstanciaAvg: `${metric}:${BY_PGI}:avg:names`
        }
        const inf = await query(Object.values(expressions).join(','), selector, {
          resolution: 'Inf'
        })
        const formsOut: Record<string, unknown> = {}
        for (const [i, [label, expression]] of Object.entries(expressions).entries()) {
          const data = inf.results[i]?.data ?? []
          const value = data[0]?.values[0] ?? null
          formsOut[label] = {
            metricIdIgualAlPedido: inf.results[i]?.metricId === expression,
            series: bucket(data.length),
            tramo: range(value),
            frenteALaMediaDeLaSuma: compare(value, mean(sum)),
            frenteAlMaximoDeLaSuma: compare(value, maxOf(sum)),
            clavesDeDimensionMap: [
              ...new Set(data.flatMap((d) => Object.keys(d.dimensionMap).map(dimKey)))
            ].sort()
          }
        }
        out[role] = { codigo: inf.code, formas: formsOut }
      }
      rows.push(out)
    }
    report['marcadores'] = rows
  })

  it('consultas exactas del canal (series y marcadores con las instancias)', async () => {
    const rows: unknown[] = []
    for (const [index, id] of groups.entries()) {
      const selector = groupSelector(id)
      const series = await query(CHANNEL_SERIES.join(','), selector)
      const markers = await query(CHANNEL_MARKERS.join(','), selector, { resolution: 'Inf' })
      // Referencias: series por instancia (para la media de cada una).
      const reference: Record<string, Map<string, Values>> = {}
      for (const [role, metric] of [
        ['cpu', METRICS.cpu],
        ['memoria', METRICS.memoria]
      ] as const) {
        const perInstance = await query(`${metric}:${BY_PGI}`, selector)
        reference[role] = new Map(
          (perInstance.results[0]?.data ?? []).map((d) => [
            String(d.dimensionMap['dt.entity.process_group_instance']),
            d.values
          ])
        )
      }
      const instancesOf = (index: number): SeriesItem[] => markers.results[index]?.data ?? []
      const cpuInstances = instancesOf(CHANNEL_MARKERS.length - 2)
      const memoryInstances = instancesOf(CHANNEL_MARKERS.length - 1)
      const compareInstances = (items: SeriesItem[], role: string): string[] => [
        ...new Set(
          items.map((d) =>
            compare(
              d.values[0] ?? null,
              mean(
                reference[role]?.get(String(d.dimensionMap['dt.entity.process_group_instance'])) ??
                  []
              )
            )
          )
        )
      ]
      const ids = new Set(
        [...cpuInstances, ...memoryInstances].map(
          (d) => d.dimensionMap['dt.entity.process_group_instance']
        )
      )
      rows.push({
        grupo: `#${index + 1}`,
        series: {
          codigo: series.code,
          resolution: series.resolution,
          porExpresion: CHANNEL_SERIES.map((expression, i) => ({
            expresion: expression,
            metricIdIgualAlPedido: series.results[i]?.metricId === expression,
            series: bucket(series.results[i]?.data.length ?? 0)
          }))
        },
        marcadores: {
          codigo: markers.code,
          porExpresion: CHANNEL_MARKERS.map((expression, i) => ({
            expresion: expression,
            metricIdIgualAlPedido: markers.results[i]?.metricId === expression,
            series: bucket(markers.results[i]?.data.length ?? 0),
            puntos: [...new Set((markers.results[i]?.data ?? []).map((d) => d.values.length))],
            clavesDeDimensionMap: [
              ...new Set(
                (markers.results[i]?.data ?? []).flatMap((d) =>
                  Object.keys(d.dimensionMap).map(dimKey)
                )
              )
            ].sort()
          })),
          mediaDelGrupoFrenteALaSerie: Object.keys(METRICS).map((_role, i) =>
            compare(
              markers.results[i]?.data[0]?.values[0] ?? null,
              mean(series.results[i]?.data[0]?.values ?? [])
            )
          ),
          cpuPorInstanciaFrenteASuSerie: compareInstances(cpuInstances, 'cpu'),
          memoriaPorInstanciaFrenteASuSerie: compareInstances(memoryInstances, 'memoria'),
          instanciasEnMarcadores: bucket(ids.size),
          instanciasIgualQueEntidades: ids.size === instanceCount.get(id),
          cpuYMemoriaMismasInstancias:
            cpuInstances.length === memoryInstances.length &&
            cpuInstances.every((c) =>
              memoryInstances.some(
                (m) =>
                  m.dimensionMap['dt.entity.process_group_instance'] ===
                  c.dimensionMap['dt.entity.process_group_instance']
              )
            ),
          todasConNombreYHost: [...cpuInstances, ...memoryInstances].every(
            (d) =>
              typeof d.dimensionMap['dt.entity.process_group_instance.name'] === 'string' &&
              HOST_PATTERN.test(String(d.dimensionMap['dt.entity.host'])) &&
              typeof d.dimensionMap['dt.entity.host.name'] === 'string'
          )
        }
      })
    }
    report['canal'] = { series: CHANNEL_SERIES, marcadores: CHANNEL_MARKERS, porGrupo: rows }
  })

  it('CA1 (0031): el informe no contiene ningún id ni nombre observado', () => {
    const text = JSON.stringify(report)
    for (const value of observed) {
      if (value.length < 4) continue
      expect(text.includes(value), 'el informe contiene un id o un nombre observado').toBe(false)
    }
    expect(observed.size).toBeGreaterThan(0)
    // Trae lo que pide la ficha: selector del grupo y por instancia, nombres, hosts y tramos.
    expect(Object.keys(report)).toEqual(
      expect.arrayContaining([
        'catalogo',
        'grupos',
        'instancias',
        'porInstancia',
        'grupo',
        'marcadores',
        'canal'
      ])
    )
  })
})
