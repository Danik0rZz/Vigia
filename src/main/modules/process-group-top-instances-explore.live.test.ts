import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createLiveClient } from '../../test/live-client'
import { loadLiveEnv } from '../../test/live-env'
import { DtError } from '../dynatrace/errors'

/**
 * Ficha 0050, paso 0: EXPLORACIÓN EN VIVO de `:sort`/`:limit` en la CPU por instancia de un
 * process group, de cómo traer la memoria de las de más CPU y de `totalCount` de `/entities`.
 * SOLO LECTURA, una petición detrás de otra.
 *
 * 1. Grupos: los de más instancias entre las primeras instancias del tenant (contadas por su
 *    relación `isInstanceOf`), como mucho 3.
 * 2. Por grupo: la lista completa de CPU por instancia (la de la 0031) como referencia, y las
 *    variantes con `:sort(value(avg,descending))` y `:limit(n)` con `resolution=Inf`: código,
 *    orden y si son las primeras de la referencia. Con un `:limit` menor que las instancias
 *    (`limit(2)`) se comprueba que se queda con las de más CPU y no con unas cualesquiera.
 * 3. Memoria de las de más CPU: (a) la de todas en la misma consulta, casada por id; (b) una
 *    consulta aparte filtrada por los ids con `:filter(or(eq(…),…))`.
 * 4. `GET /entities` con el selector del grupo y `pageSize=1`: `totalCount` frente a la lista.
 * 5. Tope de series: el máximo que se deduce de `dimensionCountRatio` (pedido / máximo).
 *
 * El informe (live-reports/process-group-top-instances-explore.json, ignorado) guarda SOLO
 * comportamientos y claves de la API, nunca un id, un nombre ni un valor. CA1 (0050) comprueba
 * que no se cuela ningún id ni nombre observado.
 */

const env = loadLiveEnv()
const live = env === null ? null : createLiveClient(env)
const report: Record<string, unknown> = {}
const timings: number[] = []
const observed = new Set<string>()
const MAX_GROUPS = 3
const FROM = 'now-24h'
const PG_PATTERN = /^PROCESS_GROUP-[0-9A-F]{16}$/
const PGI = 'dt.entity.process_group_instance'

type Raw = Record<string, unknown>

const G = 'builtin:tech.generic.'
const CPU = `${G}cpu.usage`
const MEMORY = `${G}mem.workingSetSize`
const BY_INSTANCE = ':parents:splitBy("dt.entity.process_group_instance","dt.entity.host"):avg'
const SORT = ':sort(value(avg,descending))'
const TOTALS = [`${CPU}`, `${MEMORY}`, `${G}network.bytesRx`, `${G}network.bytesTx`].map(
  (metric) => `${metric}:splitBy():sum`
)

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
          : count <= 20
            ? '10-20'
            : count <= 50
              ? '21-50'
              : count <= 150
                ? '51-150'
                : 'más de 150'

const dimKey = (key: string): string =>
  /^[A-Za-z][A-Za-z0-9_.: ()-]{0,60}$/.test(key) ? key : 'otra'

interface SeriesItem {
  dimensionMap: Record<string, unknown>
  values: (number | null)[]
}
interface QueryResult {
  code: string
  results: {
    metricId: unknown
    dimensionCountRatio: unknown
    dataPointCountRatio: unknown
    data: SeriesItem[]
  }[]
}

async function query(metricSelector: string, entitySelector: string): Promise<QueryResult> {
  const { code, body } = await codeOf(
    get('/metrics/query', { metricSelector, entitySelector, from: FROM, resolution: 'Inf' })
  )
  const results = ((body?.['result'] as Raw[] | undefined) ?? []).map((r) => {
    const data = ((r['data'] as Raw[] | undefined) ?? []).map((d) => ({
      dimensionMap: (d['dimensionMap'] as Record<string, unknown> | undefined) ?? {},
      values: (d['values'] as (number | null)[] | undefined) ?? []
    }))
    for (const item of data) observe(item.dimensionMap)
    return {
      metricId: r['metricId'],
      dimensionCountRatio: r['dimensionCountRatio'],
      dataPointCountRatio: r['dataPointCountRatio'],
      data
    }
  })
  return { code, results }
}

const idOf = (item: SeriesItem): string => String(item.dimensionMap[PGI])
const valueOf = (item: SeriesItem): number | null => item.values[0] ?? null

/** Ids ordenados por CPU de más a menos (null al final), como haría main. */
function sortedIds(items: SeriesItem[]): string[] {
  return [...items]
    .sort((a, b) => {
      const x = valueOf(a)
      const y = valueOf(b)
      if (x === null) return y === null ? 0 : 1
      if (y === null) return -1
      return y - x
    })
    .map(idOf)
}

/** ¿Vienen de más a menos (null al final)? */
function isDescending(items: SeriesItem[]): boolean {
  let seenNull = false
  for (const [i, item] of items.entries()) {
    const value = valueOf(item)
    if (value === null) {
      seenNull = true
      continue
    }
    if (seenNull) return false
    const previous = i === 0 ? null : valueOf(items[i - 1]!)
    if (previous !== null && value > previous) return false
  }
  return true
}

/** ¿Son, como conjunto, las `n` primeras de la referencia? (los empates pueden cambiar el orden) */
function sameTop(items: SeriesItem[], reference: SeriesItem[]): boolean {
  const byValue = new Map(reference.map((r) => [idOf(r), valueOf(r)]))
  const expected = sortedIds(reference).slice(0, items.length)
  const threshold = byValue.get(expected.at(-1) ?? '') ?? null
  return items.every((item) => {
    if (expected.includes(idOf(item))) return true
    // Empate con la última de la referencia: también vale.
    return threshold !== null && byValue.get(idOf(item)) === threshold
  })
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
    join('live-reports', 'process-group-top-instances-explore.json'),
    `${JSON.stringify(report, null, 2)}\n`
  )
})

describe.skipIf(live === null)('Ficha 0050: las de más CPU de un process group (paso 0)', () => {
  it('elige los grupos con más instancias', async () => {
    const { code, body } = await codeOf(
      get('/entities', {
        entitySelector: 'type("PROCESS_GROUP_INSTANCE")',
        fields: '+fromRelationships.isInstanceOf',
        from: FROM,
        pageSize: 500
      })
    )
    for (const entity of (body?.['entities'] as Raw[] | undefined) ?? []) {
      observe(entity['entityId'])
      observe(entity['displayName'])
      const targets =
        ((entity['fromRelationships'] as Raw | undefined)?.['isInstanceOf'] as Raw[] | undefined) ??
        []
      for (const target of targets) {
        const id = String(target['id'])
        observed.add(id)
        if (PG_PATTERN.test(id)) instanceCount.set(id, (instanceCount.get(id) ?? 0) + 1)
      }
    }
    const ranked = [...instanceCount.entries()].sort((a, b) => b[1] - a[1])
    groups.push(...ranked.slice(0, MAX_GROUPS).map(([id]) => id))
    report['grupos'] = {
      codigo: code,
      instanciasLeidas: bucket(((body?.['entities'] as Raw[] | undefined) ?? []).length),
      hayMasPaginas: typeof body?.['nextPageKey'] === 'string',
      grupos: bucket(instanceCount.size),
      elegidos: groups.map((id) => bucket(instanceCount.get(id) ?? 0))
    }
    expect(groups.length).toBeGreaterThan(0)
  })

  it(':sort y :limit en la CPU por instancia, con resolution=Inf', async () => {
    const rows: unknown[] = []
    for (const [index, id] of groups.entries()) {
      const selector = groupSelector(id)
      const reference = await query(`${CPU}${BY_INSTANCE}:names`, selector)
      const all = reference.results[0]?.data ?? []
      const variants: Record<string, string> = {
        namesSortLimit20: `${CPU}${BY_INSTANCE}:names${SORT}:limit(20)`,
        sortLimit20Names: `${CPU}${BY_INSTANCE}${SORT}:limit(20):names`,
        namesSortSinLimit: `${CPU}${BY_INSTANCE}:names${SORT}`,
        namesSortLimit2: `${CPU}${BY_INSTANCE}:names${SORT}:limit(2)`,
        namesLimit2SinSort: `${CPU}${BY_INSTANCE}:names:limit(2)`,
        sortAscendente: `${CPU}${BY_INSTANCE}:names:sort(value(avg,ascending)):limit(20)`
      }
      const out: Record<string, unknown> = {
        grupo: `#${index + 1}`,
        referencia: {
          codigo: reference.code,
          series: bucket(all.length),
          yaVieneOrdenada: isDescending(all)
        }
      }
      for (const [label, expression] of Object.entries(variants)) {
        const result = await query(expression, selector)
        const data = result.results[0]?.data ?? []
        const limit = /:limit\((\d+)\)/.exec(expression)?.[1]
        out[label] = {
          codigo: result.code,
          metricIdIgualAlPedido: result.results[0]?.metricId === expression,
          series: bucket(data.length),
          seriesEsperadas:
            data.length === Math.min(all.length, limit === undefined ? all.length : Number(limit)),
          deMasAMenos: isDescending(data),
          sonLasDeMasCpu: sameTop(data, all),
          mismoOrdenQueOrdenarEnMain:
            JSON.stringify(data.map(idOf)) === JSON.stringify(sortedIds(all).slice(0, data.length)),
          clavesDeDimensionMap: [
            ...new Set(data.flatMap((d) => Object.keys(d.dimensionMap).map(dimKey)))
          ].sort(),
          dimensionCountRatio: typeof result.results[0]?.dimensionCountRatio
        }
      }
      rows.push(out)
    }
    report['sortLimit'] = rows
  })

  it('memoria de las de más CPU: en la misma consulta (todas) o filtrada por ids', async () => {
    const rows: unknown[] = []
    for (const [index, id] of groups.entries()) {
      const selector = groupSelector(id)
      // (a) Una consulta: totales, CPU de las 20 de más CPU y memoria de todas (casada por id).
      const cpuTop = `${CPU}${BY_INSTANCE}:names${SORT}:limit(20)`
      const memoryAll = `${MEMORY}${BY_INSTANCE}:names`
      const together = [...TOTALS, cpuTop, memoryAll]
      const a = await query(together.join(','), selector)
      const top = a.results[4]?.data ?? []
      const memory = a.results[5]?.data ?? []
      const memoryIds = new Set(memory.map(idOf))
      // (b) Consulta aparte: memoria filtrada por los ids de las 20.
      const ids = top.map(idOf)
      const filter =
        ids.length === 1
          ? `eq("${PGI}","${ids[0]}")`
          : `or(${ids.map((pgi) => `eq("${PGI}","${pgi}")`).join(',')})`
      const memoryFiltered = `${MEMORY}${BY_INSTANCE}:filter(${filter}):names`
      const b = ids.length === 0 ? null : await query(memoryFiltered, selector)
      const filtered = b?.results[0]?.data ?? []
      rows.push({
        grupo: `#${index + 1}`,
        mismaConsulta: {
          codigo: a.code,
          expresiones: together.length,
          metricIdIgualAlPedido: together.map((e, i) => a.results[i]?.metricId === e),
          topDeMasAMenos: isDescending(top),
          memoriaDeTodas: bucket(memory.length),
          memoriaDeLasDelTop: top.every((t) => memoryIds.has(idOf(t))),
          topConHostYNombre: top.every(
            (t) =>
              typeof t.dimensionMap[`${PGI}.name`] === 'string' &&
              typeof t.dimensionMap['dt.entity.host'] === 'string' &&
              typeof t.dimensionMap['dt.entity.host.name'] === 'string'
          )
        },
        filtradaPorIds: {
          codigo: b?.code ?? 'sin ids',
          series: bucket(filtered.length),
          lasMismasQueElTop:
            filtered.length === ids.length && filtered.every((f) => ids.includes(idOf(f))),
          mismosValoresQueSinFiltro: filtered.every(
            (f) => memory.find((m) => idOf(m) === idOf(f))?.values[0] === valueOf(f)
          )
        }
      })
    }
    report['memoria'] = rows
  })

  it('totalCount de /entities con pageSize=1 frente a la lista de instancias', async () => {
    const rows: unknown[] = []
    for (const [index, id] of groups.entries()) {
      const selector = groupSelector(id)
      const one = await codeOf(
        get('/entities', { entitySelector: selector, from: FROM, pageSize: 1 })
      )
      const list = await codeOf(
        get('/entities', { entitySelector: selector, from: FROM, pageSize: 500 })
      )
      for (const page of [one, list])
        for (const entity of (page.body?.['entities'] as Raw[] | undefined) ?? []) {
          observe(entity['entityId'])
          observe(entity['displayName'])
        }
      const cpu = await query(`${CPU}${BY_INSTANCE}:names`, selector)
      const total = one.body?.['totalCount']
      const listed = ((list.body?.['entities'] as Raw[] | undefined) ?? []).length
      rows.push({
        grupo: `#${index + 1}`,
        pageSize1: {
          codigo: one.code,
          entidades: bucket(((one.body?.['entities'] as Raw[] | undefined) ?? []).length),
          totalCountEsNumero: typeof total === 'number',
          claves: Object.keys(one.body ?? {}).sort()
        },
        totalCountIgualALaLista: total === listed,
        totalCountIgualALasSeriesDeCpu: total === (cpu.results[0]?.data.length ?? -1)
      })
    }
    report['totalCount'] = rows
  })

  it('tope de series: el máximo que se deduce de dimensionCountRatio', async () => {
    const id = groups[0]
    if (id === undefined) return
    const result = await query(
      [`${CPU}${BY_INSTANCE}:names`, `${MEMORY}${BY_INSTANCE}:names`].join(','),
      groupSelector(id)
    )
    report['tope'] = result.results.map((r) => {
      const ratio = typeof r.dimensionCountRatio === 'number' ? r.dimensionCountRatio : null
      const series = r.data.length
      return {
        codigo: result.code,
        ratioEsNumero: ratio !== null,
        // pedido / máximo: el máximo, redondeado (es un límite de la API, no un dato del tenant).
        maximoDeducido: ratio === null || ratio === 0 ? null : Math.round(series / ratio)
      }
    })
  })

  it('CA1 (0050): el informe no contiene ningún id ni nombre observado', () => {
    const text = JSON.stringify(report)
    for (const value of observed) {
      if (value.length < 4) continue
      expect(text.includes(value), 'el informe contiene un id o un nombre observado').toBe(false)
    }
    expect(observed.size).toBeGreaterThan(0)
    expect(Object.keys(report)).toEqual(
      expect.arrayContaining(['grupos', 'sortLimit', 'memoria', 'totalCount', 'tope'])
    )
  })
})
