import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createLiveClient } from '../../test/live-client'
import { loadLiveEnv } from '../../test/live-env'
import { DtError } from '../dynatrace/errors'

/**
 * Ficha 0040, paso 0: EXPLORACIÓN EN VIVO de las métricas de un disco (DISK). SOLO LECTURA,
 * una petición detrás de otra.
 *
 * 1. Catálogo: `GET /metrics?metricSelector=builtin:host.disk.*` (comodín final, OpenAPI v2)
 *    con unidad, agregaciones, dimensiones y si admite `resolution=Inf`.
 * 2. Discos: uno por host de como mucho 3 hosts de `type("HOST")`, sacado de la dimensión
 *    `dt.entity.disk` de `builtin:host.disk.usedPct` acotada al host.
 * 3. Con datos: qué métricas del catálogo tienen datos en `now-2h` para cada disco, de las dos
 *    formas de la ficha: `entitySelector=entityId("<disco>")` y `:filter(eq("dt.entity.disk",…))`.
 *    Como mucho 10 expresiones por consulta (límite de la OpenAPI, decisión de la 0039).
 * 4. Elección por papel (uso, espacio, rendimiento, latencia, cola, inodos).
 * 5. Entidad: claves de `properties` y relaciones de `GET /entities/{entityId}`.
 * 6. Consultas exactas del canal (series sin `resolution` y marcadores con `Inf`).
 *
 * El informe (live-reports/disk-metrics-explore.json, ignorado) guarda SOLO comportamientos y
 * claves de la API. Nunca un id, un nombre ni un valor. CA1 (0040) comprueba que no se cuela
 * ningún id ni nombre observado.
 */

const env = loadLiveEnv()
const live = env === null ? null : createLiveClient(env)
const report: Record<string, unknown> = {}
const timings: number[] = []
/** Ids y nombres observados: el informe no puede contener ninguno (CA1). */
const observed = new Set<string>()
const MAX_DISKS = 3
/** La OpenAPI documenta como mucho 10 métricas por consulta (decisión de la 0039). */
const BATCH = 10
const FROM = 'now-2h'
const PREFIX = 'builtin:host.disk.'
const CATALOG_FIELDS =
  '+unit,+aggregationTypes,+defaultAggregation,+dimensionDefinitions,+entityType,+resolutionInfSupported,+transformations,+displayName'
const ENTITY_FIELDS = '+properties,+fromRelationships,+toRelationships,+firstSeenTms,+lastSeenTms'
const DISK_PATTERN = /^DISK-[0-9A-F]{16}$/

type Raw = Record<string, unknown>

/** Valores de enumeración de la API (`LINUX`, `NTFS`…): no son datos del tenant. */
const isEnum = (value: string): boolean =>
  /^[A-Z][A-Z0-9_]*$/.test(value) || /^(true|false|null)$/.test(value)
const observe = (value: unknown): void => {
  if (typeof value === 'string' && !isEnum(value)) observed.add(value)
  if (typeof value === 'number') return
  if (Array.isArray(value)) for (const item of value) observe(item)
  else if (value !== null && typeof value === 'object')
    for (const item of Object.values(value as Raw)) observe(item)
}

interface CatalogEntry {
  metricId: string
  displayName: unknown
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
  count === 0 ? '0' : count === 1 ? '1' : count < 10 ? '2-9' : count <= 150 ? '10-150' : '> 150'

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

/** Tipo de un valor de la API (nunca el valor). */
function kindOf(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return `lista (${bucket(value.length)})`
  return typeof value === 'object' ? 'objeto' : typeof value
}

/** Tipo de entidad de un id (`HOST-…` → `HOST`), o `otro`. */
const typeOfId = (id: unknown): string =>
  typeof id === 'string' && /^[A-Z_]+-[0-9A-F]{16}$/.test(id) ? id.split('-')[0]! : 'otro'

/** Nombre de clave de la API: solo letras, puntos y guiones bajos (no se cuela un valor). */
const apiKey = (key: string): string => (/^[A-Za-z][A-Za-z0-9_.:-]*$/.test(key) ? key : 'otra')

const dimKey = (key: string): string =>
  /^[A-Za-z][A-Za-z0-9_.: ()-]{0,40}$/.test(key) ? key : 'otra'

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

/** Papeles de la ficha: qué métricas del catálogo pueden servir, por su nombre. */
const ROLES: Record<string, (m: CatalogEntry) => boolean> = {
  uso: (m) => /\.usedPct$/.test(m.metricId),
  espacio: (m) => /\.(used|avail|free|total|capacity)$/i.test(m.metricId),
  rendimiento: (m) => /\.(bytesRead|bytesWritten|readOps|writeOps)$/i.test(m.metricId),
  latencia: (m) => /time|latency/i.test(m.metricId),
  cola: (m) => /queue/i.test(m.metricId),
  inodos: (m) => /inode/i.test(m.metricId)
}

const catalog: CatalogEntry[] = []
const disks: string[] = []
/** Métrica → por disco y forma de acotar: ¿tiene datos?, series. */
const withData = new Map<string, { form: string; data: boolean; detail: Raw }[]>()

/** Las dos formas de acotar al disco que propone la ficha. */
const FORMS = {
  entityId: (id: string) => ({
    expression: (key: string) => key,
    query: { entitySelector: `entityId("${id}")` }
  }),
  filtro: (id: string) => ({
    expression: (key: string) => `${key}:filter(eq("dt.entity.disk","${id}"))`,
    query: {}
  })
} as const

/**
 * Consultas del canal elegidas con lo observado: con `entityId("<disco>")` ninguna métrica trae
 * series (su entidad es el HOST), así que se acota con `:filter(eq("dt.entity.disk", …))`.
 * Series: 9 expresiones (como mucho 10 por consulta). Marcadores con `resolution=Inf`.
 */
const diskFilter = (id: string): string => `:filter(eq("dt.entity.disk","${id}"))`
const CHANNEL_SERIES = [
  'usedPct',
  'used',
  'avail',
  'bytesRead',
  'bytesWritten',
  'readTime',
  'writeTime',
  'queueLength',
  'inodesAvail'
].map((key) => `${PREFIX}${key}`)
const CHANNEL_MARKERS: [string, string][] = [
  [`${PREFIX}usedPct`, ':max'],
  [`${PREFIX}bytesRead`, ':avg'],
  [`${PREFIX}bytesWritten`, ':avg'],
  [`${PREFIX}readTime`, ':avg'],
  [`${PREFIX}writeTime`, ':avg'],
  [`${PREFIX}queueLength`, ':avg']
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
    join('live-reports', 'disk-metrics-explore.json'),
    `${JSON.stringify(report, null, 2)}\n`
  )
})

describe.skipIf(live === null)('Ficha 0040: métricas de un disco (paso 0)', () => {
  it('catálogo de builtin:host.disk.*', async () => {
    const { code, body } = await codeOf(
      get('/metrics', { metricSelector: `${PREFIX}*`, fields: CATALOG_FIELDS, pageSize: 500 })
    )
    const metrics = ((body?.['metrics'] as Raw[] | undefined) ?? []).filter((m) =>
      String(m['metricId']).startsWith(PREFIX)
    )
    catalog.push(
      ...metrics.map((m) => ({
        metricId: String(m['metricId']),
        // Nombre de Dynatrace de la métrica integrada (igual en todos los tenants).
        displayName: m['displayName'] ?? null,
        unit: m['unit'] ?? null,
        defaultAggregation:
          (m['defaultAggregation'] as Raw | null | undefined)?.['type'] ??
          m['defaultAggregation'] ??
          null,
        aggregationTypes: m['aggregationTypes'] ?? null,
        resolutionInfSupported: m['resolutionInfSupported'] ?? null,
        entityType: m['entityType'] ?? null,
        dimensions: ((m['dimensionDefinitions'] as Raw[] | undefined) ?? []).map(
          (d) => `${dimKey(String(d['key']))} (${String(d['type'])})`
        )
      }))
    )
    report['catalogo'] = {
      codigo: code,
      totalCount: body?.['totalCount'] ?? null,
      masPaginas: body?.['nextPageKey'] !== null && body?.['nextPageKey'] !== undefined,
      metricas: catalog
    }
    expect(catalog.length).toBeGreaterThan(0)
  })

  it('elige un disco de cada uno de como mucho 3 hosts', async () => {
    const page = (await get('/entities', {
      entitySelector: 'type("HOST")',
      from: FROM,
      pageSize: 10
    })) as Raw
    const hosts: string[] = []
    for (const entity of (page['entities'] as Raw[] | undefined) ?? []) {
      const id = String(entity['entityId'])
      observed.add(id)
      if (typeof entity['displayName'] === 'string') observed.add(entity['displayName'])
      hosts.push(id)
    }
    let hostsWithDisks = 0
    for (const host of hosts) {
      if (disks.length >= MAX_DISKS) break
      // El disco del host con más papeles con datos (uso, rendimiento, latencia y cola): no
      // todos los discos traen las de E/S.
      const probe = ['usedPct', 'bytesRead', 'readTime', 'queueLength']
      const { body } = await codeOf(
        get('/metrics/query', {
          metricSelector: probe.map((key) => `${PREFIX}${key}:splitBy("dt.entity.disk")`).join(','),
          entitySelector: `entityId("${host}")`,
          from: FROM,
          resolution: 'Inf'
        })
      )
      const score = new Map<string, number>()
      for (const result of (body?.['result'] as Raw[] | undefined) ?? []) {
        for (const item of (result['data'] as Raw[] | undefined) ?? []) {
          observe(item['dimensionMap'])
          const value = (item['dimensionMap'] as Raw | undefined)?.['dt.entity.disk']
          const values = (item['values'] as (number | null)[] | undefined) ?? []
          if (typeof value !== 'string' || !DISK_PATTERN.test(value)) continue
          if (values.some((v) => v !== null)) score.set(value, (score.get(value) ?? 0) + 1)
        }
      }
      const disk = [...score.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
      if (disk !== undefined && !disks.includes(disk)) {
        disks.push(disk)
        hostsWithDisks += 1
      }
    }
    // ¿Se listan también con /entities y type("DISK")?
    const byType = await codeOf(
      get('/entities', { entitySelector: 'type("DISK")', from: FROM, pageSize: 1 })
    )
    for (const entity of (byType.body?.['entities'] as Raw[] | undefined) ?? []) observe(entity)
    report['discos'] = {
      hosts: bucket(hosts.length),
      hostsConDisco: hostsWithDisks,
      discos: disks.length,
      formatoDelId: disks.every((id) => DISK_PATTERN.test(id)),
      typeDiskEnEntities: {
        codigo: byType.code,
        totalCount: bucket(Number(byType.body?.['totalCount'] ?? 0))
      }
    }
    expect(disks.length).toBeGreaterThan(0)
  })

  it('qué métricas del catálogo tienen datos por disco, con entityId y con filter', async () => {
    const keys = catalog.map((m) => m.metricId)
    for (const [index, id] of disks.entries()) {
      for (const [form, build] of Object.entries(FORMS)) {
        const { expression, query } = build(id)
        for (let start = 0; start < keys.length; start += BATCH) {
          const chunk = keys.slice(start, start + BATCH)
          const batch = await codeOf(
            get('/metrics/query', {
              metricSelector: chunk.map(expression).join(','),
              ...query,
              from: FROM,
              resolution: 'Inf'
            })
          )
          const bodies: { key: string; code: string; result: Raw | undefined }[] = []
          if (batch.body !== null) {
            const results = (batch.body['result'] as Raw[] | undefined) ?? []
            chunk.forEach((key, i) => bodies.push({ key, code: 'ok', result: results[i] }))
          } else {
            for (const key of chunk) {
              const one = await codeOf(
                get('/metrics/query', { metricSelector: expression(key), ...query, from: FROM })
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
            let otherDisks = 0
            for (const item of data) {
              const map = (item['dimensionMap'] as Record<string, unknown> | undefined) ?? {}
              for (const [dimension, value] of Object.entries(map)) {
                dimensionKeys.add(dimKey(dimension))
                observe(value)
                if (dimension === 'dt.entity.disk' && value !== id) otherDisks += 1
              }
            }
            const rows = withData.get(key) ?? []
            rows.push({
              form,
              data: present.length > 0,
              detail: {
                disco: `#${index + 1}`,
                forma: form,
                codigo: code,
                series: bucket(data.length),
                seriesDeOtrosDiscos: bucket(otherDisks),
                clavesDeDimensionMap: [...dimensionKeys].sort(),
                tramoMaximo: range(present.length === 0 ? null : Math.max(...present))
              }
            })
            withData.set(key, rows)
          }
        }
      }
    }
    report['datos'] = Object.fromEntries(
      [...withData.entries()].map(([key, rows]) => [
        key,
        {
          conDatosConEntityId: `${rows.filter((r) => r.form === 'entityId' && r.data).length} de ${disks.length}`,
          conDatosConFiltro: `${rows.filter((r) => r.form === 'filtro' && r.data).length} de ${disks.length}`,
          porDisco: rows.map((r) => r.detail)
        }
      ])
    )
  })

  it('por host: qué discos trae cada métrica y cuántos coinciden con los de usedPct', async () => {
    const page = (await get('/entities', {
      entitySelector: 'type("HOST")',
      from: FROM,
      pageSize: 5
    })) as Raw
    const hosts = ((page['entities'] as Raw[] | undefined) ?? []).map((e) => String(e['entityId']))
    for (const id of hosts) observed.add(id)
    const keys = catalog.map((m) => m.metricId)
    const rows: unknown[] = []
    for (const [index, host] of hosts.entries()) {
      const perMetric = new Map<string, Set<string>>()
      for (let start = 0; start < keys.length; start += BATCH) {
        const chunk = keys.slice(start, start + BATCH)
        const { body } = await codeOf(
          get('/metrics/query', {
            metricSelector: chunk.map((key) => `${key}:splitBy("dt.entity.disk")`).join(','),
            entitySelector: `entityId("${host}")`,
            from: FROM,
            resolution: 'Inf'
          })
        )
        const results = (body?.['result'] as Raw[] | undefined) ?? []
        chunk.forEach((key, i) => {
          const set = new Set<string>()
          for (const item of (results[i]?.['data'] as Raw[] | undefined) ?? []) {
            const values = (item['values'] as (number | null)[] | undefined) ?? []
            const disk = (item['dimensionMap'] as Raw | undefined)?.['dt.entity.disk']
            if (typeof disk === 'string' && values.some((v) => v !== null)) {
              observed.add(disk)
              set.add(disk)
            }
          }
          perMetric.set(key, set)
        })
      }
      const base = perMetric.get(`${PREFIX}usedPct`) ?? new Set<string>()
      rows.push({
        host: `#${index + 1}`,
        porMetrica: Object.fromEntries(
          [...perMetric.entries()].map(([key, set]) => [
            key,
            {
              discos: bucket(set.size),
              tambienEnUsedPct: bucket([...set].filter((d) => base.has(d)).length)
            }
          ])
        )
      })
    }
    report['porHost'] = rows
  })

  it('elección por papel: las del catálogo que encajan y tienen datos', () => {
    const table: Record<string, unknown> = {}
    for (const [role, fits] of Object.entries(ROLES)) {
      const candidates = catalog.filter(fits)
      table[role] = candidates.map((m) => ({
        metrica: m.metricId,
        nombre: m.displayName,
        unidad: m.unit,
        agregacionPorDefecto: m.defaultAggregation,
        resolutionInf: m.resolutionInfSupported,
        conDatos: (withData.get(m.metricId) ?? []).some((r) => r.data)
      }))
    }
    report['eleccion'] = table
  })

  it('consultas exactas del canal: series sin resolution y marcadores con Inf, con filter', async () => {
    const out: unknown[] = []
    for (const [index, id] of disks.entries()) {
      const series = CHANNEL_SERIES.map((key) => `${key}${diskFilter(id)}`)
      const markers = CHANNEL_MARKERS.map(([key, agg]) => `${key}${diskFilter(id)}${agg}`)
      const s = await codeOf(
        get('/metrics/query', { metricSelector: series.join(','), from: FROM })
      )
      const m = await codeOf(
        get('/metrics/query', { metricSelector: markers.join(','), from: FROM, resolution: 'Inf' })
      )
      const describe = (body: Raw | null, expressions: string[]): unknown =>
        expressions.map((expression, i) => {
          const result = ((body?.['result'] as Raw[] | undefined) ?? [])[i]
          const data = (result?.['data'] as Raw[] | undefined) ?? []
          const values = (data[0]?.['values'] as (number | null)[] | undefined) ?? []
          for (const item of data) observe(item['dimensionMap'])
          return {
            expresion: expression.replace(id, '<disco>'),
            metricIdIgualAlPedido: result?.['metricId'] === expression,
            metricId: String(result?.['metricId'] ?? '').replace(id, '<disco>'),
            series: bucket(data.length),
            puntos: bucket(values.length),
            ultimoNull: (values.at(-1) ?? null) === null,
            conDato: values.some((v) => v !== null),
            ratios: [
              ratioBucket(result?.['dataPointCountRatio']),
              ratioBucket(result?.['dimensionCountRatio'])
            ]
          }
        })
      out.push({
        disco: `#${index + 1}`,
        codigoSeries: s.code,
        resolution: s.body?.['resolution'] ?? null,
        series: describe(s.body, series),
        codigoMarcadores: m.code,
        marcadores: describe(m.body, markers)
      })
    }
    report['canal'] = out
  })

  it('entidad: claves de properties y relaciones', async () => {
    const rows: unknown[] = []
    for (const [index, id] of disks.entries()) {
      const { code, body } = await codeOf(get(`/entities/${id}`, { fields: ENTITY_FIELDS }))
      if (body === null) {
        rows.push({ disco: `#${index + 1}`, codigo: code })
        continue
      }
      if (typeof body['displayName'] === 'string') observed.add(body['displayName'])
      const properties = (body['properties'] as Raw | undefined) ?? {}
      observe(properties)
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
        disco: `#${index + 1}`,
        codigo: code,
        type: body['type'] ?? null,
        firstSeenTms: kindOf(body['firstSeenTms']),
        lastSeenTms: kindOf(body['lastSeenTms']),
        tags: kindOf(body['tags']),
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

  it('CA1 (0040): el informe trae el catálogo, qué métricas tienen datos y las claves de la entidad, sin ids ni nombres', () => {
    expect(Object.keys(report)).toEqual(
      expect.arrayContaining(['catalogo', 'discos', 'datos', 'eleccion', 'entidad'])
    )
    const text = JSON.stringify(report)
    for (const value of observed) {
      if (value.length < 4) continue
      expect(text.includes(value), 'el informe contiene un id o un nombre observado').toBe(false)
    }
    expect(observed.size).toBeGreaterThan(0)
  })
})
