import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createLiveClient } from '../../test/live-client'
import { loadLiveEnv } from '../../test/live-env'
import { DtError } from '../dynatrace/errors'

/**
 * Ficha 0027, paso 0: EXPLORACIÓN EN VIVO de las métricas de un proceso
 * (PROCESS_GROUP_INSTANCE). SOLO LECTURA, una petición detrás de otra.
 *
 * 1. Catálogo: `GET /metrics?metricSelector=builtin:tech.generic.*` y `…=builtin:pgi.*`
 *    (comodín final, OpenAPI v2) con unidad, agregaciones y dimensiones.
 * 2. Con datos: como mucho 3 procesos (de los hosts de los problemas de los últimos 7 días
 *    o, si no hay, de `type("PROCESS_GROUP_INSTANCE")` con `pageSize` 3), qué métricas del
 *    catálogo tienen datos en `now-24h` con `entitySelector=entityId("<id>")`.
 * 3. Elección por papel con la regla de la ficha (la primera del catálogo con datos).
 * 4. Entidad: claves de `properties` y nombres de relaciones de `GET /entities/{entityId}`,
 *    y si alguna clave (también dentro de `metadata`) lleva la línea de comandos o argumentos.
 *
 * El informe (live-reports/process-metrics-explore.json, ignorado) guarda SOLO
 * comportamientos y claves de la API (métricas integradas, dimensiones, propiedades y
 * relaciones). Nunca un id, un nombre ni un valor. CA1 (0027) comprueba que no se cuela
 * ningún id ni nombre observado.
 */

const env = loadLiveEnv()
const live = env === null ? null : createLiveClient(env)
const report: Record<string, unknown> = {}
const timings: number[] = []
/** Ids, nombres y valores observados: el informe no puede contener ninguno (CA1). */
const observed = new Set<string>()
const MAX_PROCESSES = 3
/** La API admite como mucho 10 expresiones por consulta de /metrics/query. */
const BATCH = 10
const FROM = 'now-24h'
const PREFIXES = ['builtin:tech.generic.', 'builtin:pgi.'] as const
const CATALOG_FIELDS =
  '+unit,+aggregationTypes,+defaultAggregation,+dimensionDefinitions,+entityType,+resolutionInfSupported,+transformations'
const ENTITY_FIELDS = '+properties,+fromRelationships,+toRelationships,+firstSeenTms,+lastSeenTms'
const PGI_PATTERN = /^PROCESS_GROUP_INSTANCE-[0-9A-F]{16}$/
const HOST_PATTERN = /^HOST-[0-9A-F]{16}$/
/** Claves que pueden llevar la línea de comandos o sus argumentos (no se enseñan, 0029). */
const COMMAND_LINE = /cmd|command|arg|commandline|exe_?path|startup|parameter/i

type Raw = Record<string, unknown>

/**
 * Valores de enumeración de la API (`LINUX`, `JAVA`…) y booleanos en texto: no son datos
 * del tenant y chocarían con las claves y los literales del informe.
 */
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

/** Clave de una dimensión de una métrica integrada (las define Dynatrace; pueden llevar espacios). */
const dimKey = (key: string): string =>
  /^[A-Za-z][A-Za-z0-9_.: ()-]{0,40}$/.test(key) ? key : 'otra'

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

/**
 * Papeles de la ficha: qué claves del catálogo pueden servir, por su nombre y su unidad. La
 * elección es la primera del catálogo (en su orden) que encaje y tenga datos.
 */
const ROLES: Record<string, (m: CatalogEntry) => boolean> = {
  cpu: (m) => /\.cpu\.usage$/.test(m.metricId) && m.unit === 'Percent',
  memoria: (m) =>
    /\.mem\.(workingSetSize|residentSetSize|usage)$/i.test(m.metricId) && m.unit === 'Byte',
  redEntrada: (m) =>
    /\.(network|net|traffic)\.[^:]*(bytesRx|traffic\.?in|in(bound)?|received|rx)$/i.test(
      m.metricId
    ),
  redSalida: (m) =>
    /\.(network|net|traffic)\.[^:]*(bytesTx|traffic\.?out|out(bound)?|sent|tx)$/i.test(m.metricId),
  saludDeRed: (m) => /retrans|roundTrip|rtt|responseTime|ackRoundTrip/i.test(m.metricId),
  disponibilidad: (m) => /availability|\.state$|\.status$/i.test(m.metricId),
  recursos: (m) => /thread|handle|fileDescriptor|\.fd\b|openFiles/i.test(m.metricId)
}

const G = 'builtin:tech.generic.'
const BY_PGI = ':splitBy("dt.entity.process_group_instance")'
/** Expresiones candidatas del canal, por papel (se prueban con entitySelector=entityId(...)). */
const CANDIDATE_EXPRESSIONS: Record<string, string[]> = {
  cpu: [`${G}cpu.usage`, `${G}cpu.usage:avg`, `${G}cpu.usage:max`],
  memoria: [`${G}mem.workingSetSize`, `${G}mem.workingSetSize:avg`, `${G}mem.workingSetSize:max`],
  red: [
    `${G}network.bytesRx`,
    `${G}network.bytesTx`,
    `${G}network.bytesRx:avg`,
    `${G}network.bytesTx:avg`
  ],
  saludDeRed: [`${G}network.packets.retransmission`, `${G}network.roundTrip`],
  disponibilidad: ['builtin:pgi.availability', 'builtin:pgi.availability:avg'],
  recursos: [
    `${G}handles.fileDescriptorsPercentUsed`,
    `${G}handles.fileDescriptorsPercentUsed:avg`,
    `${G}handles.fileDescriptorsPercentUsed:max`,
    `${G}handles.fileDescriptorsPercentUsed${BY_PGI}:max`,
    `${G}handles.fileDescriptorsUsed`,
    `${G}handles.fileDescriptorsUsed:max`
  ]
}

const catalog: CatalogEntry[] = []
const processes: string[] = []
/** Métrica → por proceso: ¿tiene datos?, series y claves de dimensionMap. */
const withData = new Map<string, { data: boolean; series: number; detail: Raw }[]>()

/**
 * Series y marcadores que usará el canal, cada uno en una consulta. Con la regla de la ficha
 * (la primera del catálogo con datos en los procesos de muestra), red y salud de red se quedan
 * sin métrica: ninguna muestra trae datos de red. Sus candidatas se prueban aparte, en una
 * instancia del entorno con datos de red, y se anotan.
 */
const CHANNEL_SERIES = [
  `${G}cpu.usage`,
  `${G}mem.workingSetSize`,
  'builtin:pgi.availability',
  `${G}handles.fileDescriptorsPercentUsed`
]
const CHANNEL_MARKERS = [
  `${G}cpu.usage:avg`,
  `${G}cpu.usage:max`,
  `${G}mem.workingSetSize:avg`,
  `${G}mem.workingSetSize:max`,
  'builtin:pgi.availability:avg',
  `${G}handles.fileDescriptorsPercentUsed:max`
]
/** Una instancia del entorno con datos de red (ninguna muestra los trae). */
let networkProcess: string | null = null

/**
 * Prueba unas expresiones con entitySelector=entityId(...): en series (resolución de la API) y
 * con resolution=Inf (o solo una de las dos). Devuelve comportamientos, nunca valores.
 */
async function tryExpressions(
  label: string,
  id: string,
  expressions: string[],
  only?: 'series' | 'inf'
): Promise<Raw> {
  const scope = { entitySelector: `entityId("${id}")`, from: FROM }
  const none = { code: 'no pedida', body: null }
  const series =
    only === 'inf'
      ? none
      : await codeOf(get('/metrics/query', { metricSelector: expressions.join(','), ...scope }))
  const inf =
    only === 'series'
      ? none
      : await codeOf(
          get('/metrics/query', {
            metricSelector: expressions.join(','),
            ...scope,
            resolution: 'Inf'
          })
        )
  const seriesResults = (series.body?.['result'] as Raw[] | undefined) ?? []
  const infResults = (inf.body?.['result'] as Raw[] | undefined) ?? []
  return {
    proceso: label,
    codigoSeries: series.code,
    codigoInf: inf.code,
    resolution: series.body?.['resolution'] ?? null,
    porExpresion: expressions.map((expression, i) => {
      const s = (seriesResults[i]?.['data'] as Raw[] | undefined) ?? []
      const f = (infResults[i]?.['data'] as Raw[] | undefined) ?? []
      const values = (s[0]?.['values'] as (number | null)[] | undefined) ?? []
      const present = values.filter((v): v is number => v !== null)
      const infValue = ((f[0]?.['values'] as (number | null)[] | undefined) ?? [])[0] ?? null
      const sum = present.reduce((a, b) => a + b, 0)
      const mean = present.length === 0 ? null : sum / present.length
      const max = present.length === 0 ? null : Math.max(...present)
      for (const item of [...s, ...f]) observe(item['dimensionMap'])
      const results = only === 'inf' ? infResults : seriesResults
      return {
        expresion: expression,
        metricIdIgualAlPedido: results[i]?.['metricId'] === expression,
        seriesEnSeries: bucket(s.length),
        seriesEnInf: bucket(f.length),
        puntos: bucket(values.length),
        nulos: `${values.length - present.length} de ${values.length}`,
        ultimoNull: (values.at(-1) ?? null) === null,
        tramo: range(only === 'inf' ? infValue : max),
        infFrenteAMedia: compare(infValue, mean),
        infFrenteAMaximo: compare(infValue, max),
        ratios: [
          ratioBucket(results[i]?.['dataPointCountRatio']),
          ratioBucket(results[i]?.['dimensionCountRatio'])
        ]
      }
    })
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
    join('live-reports', 'process-metrics-explore.json'),
    `${JSON.stringify(report, null, 2)}\n`
  )
})

describe.skipIf(live === null)('Ficha 0027: métricas de un proceso (paso 0)', () => {
  it('catálogo de builtin:tech.generic.* y builtin:pgi.*', async () => {
    const out: Record<string, unknown> = {}
    for (const prefix of PREFIXES) {
      const { code, body } = await codeOf(
        get('/metrics', { metricSelector: `${prefix}*`, fields: CATALOG_FIELDS, pageSize: 500 })
      )
      const metrics = ((body?.['metrics'] as Raw[] | undefined) ?? []).filter((m) =>
        String(m['metricId']).startsWith(prefix)
      )
      const entries = metrics.map((m) => ({
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
      catalog.push(...entries)
      out[prefix] = {
        codigo: code,
        totalCount: body?.['totalCount'] ?? null,
        masPaginas: body?.['nextPageKey'] !== null && body?.['nextPageKey'] !== undefined,
        metricas: entries
      }
    }
    report['catalogo'] = out
    expect(catalog.length).toBeGreaterThan(0)
  })

  it('elige como mucho 3 procesos de los hosts de los problemas (o de type(...))', async () => {
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
    // Un proceso por host (el primero que devuelva la API), hasta 3.
    for (const host of hosts) {
      if (processes.length >= MAX_PROCESSES) break
      const page = (await codeOf(
        get('/entities', {
          entitySelector: `type("PROCESS_GROUP_INSTANCE"),fromRelationships.isProcessOf(entityId("${host}"))`,
          from: 'now-24h',
          pageSize: 1
        })
      )) as { body: Raw | null }
      for (const entity of (page.body?.['entities'] as Raw[] | undefined) ?? []) {
        const id = String(entity['entityId'])
        observed.add(id)
        if (typeof entity['displayName'] === 'string') observed.add(entity['displayName'])
        if (PGI_PATTERN.test(id) && !processes.includes(id)) processes.push(id)
      }
    }
    const fromProblems = processes.length
    if (processes.length < MAX_PROCESSES) {
      const page = (await get('/entities', {
        entitySelector: 'type("PROCESS_GROUP_INSTANCE")',
        from: 'now-24h',
        pageSize: MAX_PROCESSES
      })) as Raw
      for (const entity of (page['entities'] as Raw[] | undefined) ?? []) {
        const id = String(entity['entityId'])
        observed.add(id)
        if (typeof entity['displayName'] === 'string') observed.add(entity['displayName'])
        if (!processes.includes(id)) processes.push(id)
      }
    }
    processes.splice(MAX_PROCESSES)
    report['procesos'] = {
      hostsDeProblemas: bucket(hosts.length),
      deHostsDeProblemas: fromProblems,
      deEntities: processes.length - fromProblems,
      formatoDelId: processes.every((id) => PGI_PATTERN.test(id))
    }
    expect(processes.length).toBeGreaterThan(0)
  })

  it('qué métricas del catálogo tienen datos en now-24h con entitySelector=entityId(...)', async () => {
    const keys = catalog.map((m) => m.metricId)
    for (const [index, id] of processes.entries()) {
      const scope = { entitySelector: `entityId("${id}")`, from: FROM }
      for (let start = 0; start < keys.length; start += BATCH) {
        const chunk = keys.slice(start, start + BATCH)
        const batch = await codeOf(
          get('/metrics/query', {
            metricSelector: chunk.map((key) => `${key}:names`).join(','),
            ...scope,
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
              get('/metrics/query', { metricSelector: `${key}:names`, ...scope })
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
          const otherEntities = new Set<string>()
          for (const item of data) {
            const map = (item['dimensionMap'] as Record<string, unknown> | undefined) ?? {}
            for (const [dimension, value] of Object.entries(map)) {
              dimensionKeys.add(dimKey(dimension))
              observe(value)
              if (dimension === 'dt.entity.process_group_instance' && value !== id)
                otherEntities.add(String(value))
            }
          }
          const rows = withData.get(key) ?? []
          rows.push({
            data: present.length > 0,
            series: data.length,
            detail: {
              proceso: `#${index + 1}`,
              codigo: code,
              series: bucket(data.length),
              seriesDeOtrosProcesos: bucket(otherEntities.size),
              clavesDeDimensionMap: [...dimensionKeys].sort(),
              tramoMaximo: range(present.length === 0 ? null : Math.max(...present))
            }
          })
          withData.set(key, rows)
        }
      }
    }
    report['datos'] = Object.fromEntries(
      [...withData.entries()].map(([key, rows]) => [
        key,
        {
          conDatosEn: `${rows.filter((r) => r.data).length} de ${rows.length}`,
          porProceso: rows.map((r) => r.detail)
        }
      ])
    )
  })

  it('las que no tienen datos en las muestras: ¿tienen datos en algún proceso del entorno?', async () => {
    const empty = catalog
      .map((m) => m.metricId)
      .filter((key) => !(withData.get(key) ?? []).some((r) => r.data))
    const out: Record<string, unknown> = {}
    for (let start = 0; start < empty.length; start += BATCH) {
      const chunk = empty.slice(start, start + BATCH)
      // Todas las instancias juntas (splitBy()): una serie como mucho, sin ids.
      const query = {
        entitySelector: 'type("PROCESS_GROUP_INSTANCE")',
        from: FROM,
        resolution: 'Inf'
      }
      const batch = await codeOf(
        get('/metrics/query', {
          metricSelector: chunk.map((key) => `${key}:splitBy()`).join(','),
          ...query
        })
      )
      const results: { key: string; code: string; result: Raw | undefined }[] = []
      if (batch.body !== null) {
        const list = (batch.body['result'] as Raw[] | undefined) ?? []
        chunk.forEach((key, i) => results.push({ key, code: 'ok', result: list[i] }))
      } else {
        for (const key of chunk) {
          const one = await codeOf(
            get('/metrics/query', {
              metricSelector: `${key}:splitBy()`,
              entitySelector: query.entitySelector,
              from: FROM
            })
          )
          results.push({
            key,
            code: `tanda ${batch.code}; sola ${one.code}`,
            result: ((one.body?.['result'] as Raw[] | undefined) ?? [])[0]
          })
        }
      }
      for (const { key, code, result } of results) {
        const data = (result?.['data'] as Raw[] | undefined) ?? []
        const values = data.flatMap((d) => (d['values'] as (number | null)[] | undefined) ?? [])
        out[key] = { codigo: code, conDatosEnElEntorno: values.some((v) => v !== null) }
      }
    }
    report['sinDatosEnLasMuestras'] = out
  })

  it('elección por papel: la primera del catálogo que encaje y tenga datos', () => {
    const table: Record<string, unknown> = {}
    for (const [role, fits] of Object.entries(ROLES)) {
      const candidates = catalog.filter(fits)
      const chosen = candidates.find((m) => (withData.get(m.metricId) ?? []).some((r) => r.data))
      table[role] = {
        candidatas: candidates.map((m) => ({
          metrica: m.metricId,
          conDatos: (withData.get(m.metricId) ?? []).some((r) => r.data)
        })),
        eleccion:
          chosen === undefined
            ? null
            : {
                metrica: chosen.metricId,
                unidad: chosen.unit,
                agregacionPorDefecto:
                  (chosen.defaultAggregation as Raw | null)?.['type'] ?? chosen.defaultAggregation,
                agregaciones: chosen.aggregationTypes,
                dimensiones: chosen.dimensions,
                resolutionInf: chosen.resolutionInfSupported
              }
      }
    }
    report['eleccion'] = table
  })

  it('expresiones candidatas del canal: series (resolución de la API) e Inf, con entityId', async () => {
    const out: Record<string, unknown[]> = {}
    for (const [index, id] of processes.entries()) {
      for (const [role, expressions] of Object.entries(CANDIDATE_EXPRESSIONS)) {
        const rows = out[role] ?? []
        rows.push(await tryExpressions(`#${index + 1}`, id, expressions))
        out[role] = rows
      }
    }
    report['candidatas'] = out
  })

  it('red y salud de red: las mismas candidatas en un proceso del entorno con datos de red', async () => {
    // Ninguna muestra trae red: se busca una instancia con datos de bytesRx (la primera serie).
    const { code, body } = await codeOf(
      get('/metrics/query', {
        metricSelector: `${G}network.bytesRx`,
        entitySelector: 'type("PROCESS_GROUP_INSTANCE")',
        from: FROM,
        resolution: 'Inf'
      })
    )
    const data = ((body?.['result'] as Raw[] | undefined) ?? [])[0]?.['data'] as Raw[] | undefined
    const id = (data ?? [])
      .map(
        (item) => (item['dimensionMap'] as Raw | undefined)?.['dt.entity.process_group_instance']
      )
      .find((value): value is string => typeof value === 'string' && PGI_PATTERN.test(value))
    if (id !== undefined) {
      observed.add(id)
      networkProcess = id
    }
    const out: Record<string, unknown> = { codigoBusqueda: code, encontrado: id !== undefined }
    if (id !== undefined) {
      for (const role of ['red', 'saludDeRed', 'cpu', 'memoria', 'disponibilidad', 'recursos']) {
        out[role] = await tryExpressions('con red', id, CANDIDATE_EXPRESSIONS[role] ?? [])
      }
    }
    report['procesoConRed'] = out
  })

  it('consultas exactas del canal (series y marcadores) en las muestras y en el proceso con red', async () => {
    const targets = [
      ...processes.map((id, index) => ({ label: `#${index + 1}`, id })),
      ...(networkProcess === null ? [] : [{ label: 'con red', id: networkProcess }])
    ]
    const out: unknown[] = []
    for (const { label, id } of targets) {
      const series = await tryExpressions(label, id, CHANNEL_SERIES, 'series')
      const markers = await tryExpressions(label, id, CHANNEL_MARKERS, 'inf')
      out.push({ series, marcadores: markers })
    }
    report['canal'] = {
      series: CHANNEL_SERIES,
      marcadores: CHANNEL_MARKERS,
      porProceso: out
    }
  })

  it('entidad: claves de properties, relaciones y si alguna lleva la línea de comandos', async () => {
    const rows: unknown[] = []
    for (const [index, id] of processes.entries()) {
      const { code, body } = await codeOf(get(`/entities/${id}`, { fields: ENTITY_FIELDS }))
      if (body === null) {
        rows.push({ proceso: `#${index + 1}`, codigo: code })
        continue
      }
      if (typeof body['displayName'] === 'string') observed.add(body['displayName'])
      const properties = (body['properties'] as Raw | undefined) ?? {}
      observe(properties)
      // Claves de metadata (si es una lista de {key, value}): solo las claves de la API.
      const metadata = properties['metadata']
      const metadataKeys = Array.isArray(metadata)
        ? [
            ...new Set(
              (metadata as Raw[]).map((item) =>
                typeof item?.['key'] === 'string' && isEnum(item['key']) ? item['key'] : 'otra'
              )
            )
          ].sort()
        : null
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
      const keys = Object.keys(properties).map(apiKey)
      rows.push({
        proceso: `#${index + 1}`,
        codigo: code,
        type: body['type'] ?? null,
        firstSeenTms: kindOf(body['firstSeenTms']),
        lastSeenTms: kindOf(body['lastSeenTms']),
        properties: Object.fromEntries(
          Object.keys(properties)
            .sort()
            .map((key) => [apiKey(key), kindOf(properties[key])])
        ),
        clavesDeMetadata: metadataKeys,
        clavesConLineaDeComandos: [
          ...keys.filter((key) => COMMAND_LINE.test(key)),
          ...(metadataKeys ?? [])
            .filter((key) => COMMAND_LINE.test(key))
            .map((key) => `metadata.${key}`)
        ],
        relaciones: relations
      })
    }
    report['entidad'] = rows
  })

  it('CA1 (0027): el informe no contiene ningún id ni nombre observado', () => {
    const text = JSON.stringify(report)
    for (const value of observed) {
      if (value.length < 4) continue
      expect(text.includes(value), 'el informe contiene un id o un nombre observado').toBe(false)
    }
    expect(observed.size).toBeGreaterThan(0)
    // Trae lo que pide la ficha: catálogo, datos, elección y claves de la entidad.
    expect(Object.keys(report)).toEqual(
      expect.arrayContaining([
        'catalogo',
        'procesos',
        'datos',
        'eleccion',
        'candidatas',
        'canal',
        'entidad'
      ])
    )
    const entity = report['entidad'] as Raw[]
    expect(entity.every((row) => 'clavesConLineaDeComandos' in row || 'codigo' in row)).toBe(true)
  })
})
