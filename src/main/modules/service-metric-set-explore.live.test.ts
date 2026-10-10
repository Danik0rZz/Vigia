import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createLiveClient } from '../../test/live-client'
import { loadLiveEnv } from '../../test/live-env'
import { DtError } from '../dynatrace/errors'

/**
 * Ficha 0046, paso 0: EXPLORACIÓN EN VIVO de las métricas de un servicio según
 * su `serviceType`. SOLO LECTURA, una petición detrás de otra (unas 120 como
 * mucho).
 *
 * Para cada `serviceType` de la tabla de la ficha que exista en el tenant, 2
 * servicios (`entitySelector=type("SERVICE"),serviceType("…")`; en
 * WEB_REQUEST_SERVICE y RPC_SERVICE, uno con la propiedad y otro sin ella si los
 * hay). De cada uno: su entidad con los `fields` del canal, si tienen datos en
 * `now-24h` las métricas de su conjunto y las de Servidor, y en las unificadas
 * cómo se separan las fallidas. Más los descriptores de todas las métricas.
 *
 * El informe (live-reports/service-metric-set-explore.json, ignorado) guarda
 * SOLO tipos de Dynatrace, claves de métricas y comportamientos (códigos,
 * tramos, coincidencias). Nunca un id, un nombre ni un valor. CA1 (0046)
 * comprueba que no se cuela ningún id, nombre ni valor de propiedad observado.
 */

const env = loadLiveEnv()
const live = env === null ? null : createLiveClient(env)
const report: Record<string, unknown> = {}
const timings: number[] = []
/** Ids, nombres y valores observados: el informe no puede contener ninguno (CA1). */
const observed = new Set<string>()
const RANGE = 'now-24h'
const PER_TYPE = 2
const FIELDS =
  '+properties.serviceType,+properties.webServerName,+properties.remoteEndpoint,+properties.remoteServiceName'

/** Los `serviceType` de la tabla de la ficha (tipos estándar de Dynatrace). */
const TYPES = [
  'WEB_SERVICE',
  'CUSTOM_SERVICE',
  'BACKGROUND_ACTIVITY',
  'SPAN',
  'MESSAGING_SERVICE',
  'EXTERNAL',
  'WEB_REQUEST_SERVICE',
  'RPC_SERVICE',
  'DATABASE_SERVICE',
  'UNIFIED',
  'QUEUE_LISTENER_SERVICE'
] as const

type MetricSet = 'server' | 'client' | 'unified' | 'activity'

const SET_METRICS: Record<MetricSet, readonly string[]> = {
  server: [
    'builtin:service.response.server',
    'builtin:service.errors.server.count',
    'builtin:service.errors.server.rate',
    'builtin:service.requestCount.server'
  ],
  client: [
    'builtin:service.response.client',
    'builtin:service.errors.client.count',
    'builtin:service.errors.client.rate',
    'builtin:service.requestCount.client'
  ],
  unified: [
    'builtin:service.request.response_time_service_aggregation',
    'builtin:service.request.failure_count_service_aggregation',
    'builtin:service.request.count_service_aggregation'
  ],
  activity: ['builtin:service.response.server']
}

/** El conjunto de la tabla de la ficha (aquí solo para elegir qué preguntar). */
function setOf(type: string, props: Record<string, unknown>): MetricSet {
  const has = (key: string): boolean => {
    const value = props[key]
    return typeof value === 'string' ? value !== '' : Array.isArray(value) && value.length > 0
  }
  if (type === 'UNIFIED') return 'unified'
  if (type === 'QUEUE_LISTENER_SERVICE') return 'activity'
  if (type === 'DATABASE_SERVICE') return 'client'
  if (type === 'WEB_REQUEST_SERVICE') return has('webServerName') ? 'server' : 'client'
  if (type === 'RPC_SERVICE')
    return has('remoteEndpoint') || has('remoteServiceName') ? 'client' : 'server'
  return 'server'
}

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
  count === 0 ? '0' : count === 1 ? '1' : count < 10 ? '2-9' : count <= 100 ? '10-100' : '> 100'

/** ¿Coinciden dos números? Solo el tramo de la diferencia, nunca los valores. */
function compare(a: number | null, b: number | null): string {
  if (a === null || b === null) return a === b ? 'los dos null' : 'uno null'
  if (a === b) return 'iguales'
  const scale = Math.max(Math.abs(a), Math.abs(b))
  const diff = Math.abs(a - b) / scale
  return diff < 1e-6 ? 'iguales (redondeo)' : diff < 0.01 ? 'casi (< 1 %)' : 'distintos (≥ 1 %)'
}

interface Result {
  metricId: string
  series: number
  value: number | null
  dimensionKeys: string[]
  dimensionMaps: Record<string, string>[]
}

/** Resultados de /metrics/query con resolution=Inf: un valor por serie. */
function resultsOf(body: Raw | null): Result[] {
  const results = (Array.isArray(body?.['result']) ? body['result'] : []) as Raw[]
  return results.map((result) => {
    const data = (Array.isArray(result['data']) ? result['data'] : []) as Raw[]
    const first = data[0]
    const values = (first?.['values'] as (number | null)[] | undefined) ?? []
    const maps = data.map((d) => (d['dimensionMap'] as Record<string, string> | undefined) ?? {})
    return {
      metricId: String(result['metricId']),
      series: data.length,
      value: values[0] ?? null,
      dimensionKeys: [...new Set(maps.flatMap((m) => Object.keys(m)))].sort(),
      dimensionMaps: maps
    }
  })
}

/** Resumen de un resultado: si hay datos, cuántas series y qué dimensiones (claves). */
const summary = (r: Result | undefined): Record<string, unknown> =>
  r === undefined
    ? { resultado: 'no llega' }
    : {
        datos: r.series > 0 && r.value !== null ? 'sí' : r.series > 0 ? 'series sin valor' : 'no',
        series: bucket(r.series),
        dimensiones: r.dimensionKeys
      }

/** Una consulta con resolution=Inf y el servicio por entitySelector; si falla, una a una. */
async function query(id: string, expressions: string[]): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {}
  const joined = await codeOf(
    get('/metrics/query', {
      metricSelector: expressions.join(','),
      entitySelector: `entityId("${id}")`,
      from: RANGE,
      resolution: 'Inf'
    })
  )
  if (joined.code === 'ok') {
    const results = resultsOf(joined.body)
    expressions.forEach((expression, i) => {
      out[expression] = { codigo: 'ok', ...summary(results[i]) }
    })
    return out
  }
  for (const expression of expressions) {
    const single = await codeOf(
      get('/metrics/query', {
        metricSelector: expression,
        entitySelector: `entityId("${id}")`,
        from: RANGE,
        resolution: 'Inf'
      })
    )
    out[expression] = { codigo: single.code, ...summary(resultsOf(single.body)[0]) }
  }
  return out
}

/** Valor único de la primera serie de una expresión, con resolution=Inf. */
async function valueOf(id: string, expression: string): Promise<number | null | string> {
  const { code, body } = await codeOf(
    get('/metrics/query', {
      metricSelector: expression,
      entitySelector: `entityId("${id}")`,
      from: RANGE,
      resolution: 'Inf'
    })
  )
  if (code !== 'ok') return code
  return resultsOf(body)[0]?.value ?? null
}

/** Expresiones de cada conjunto con las que se pregunta (agregaciones candidatas). */
function expressionsOf(set: MetricSet): string[] {
  const [a, b, c, d] = SET_METRICS[set]
  if (set === 'unified') {
    return [`${a}:median`, `${a}:percentile(90)`, `${a}:percentile(99)`, `${b}`, `${c}`]
  }
  if (set === 'activity') return [`${a}:count`, `${a}:median`]
  return [`${a}:median`, `${a}:percentile(90)`, `${a}:percentile(99)`, `${b}`, `${c}`, `${d}`]
}

afterAll(() => {
  if (live === null || env === null) return
  const sorted = [...timings].sort((x, y) => x - y)
  report['tiempos'] = {
    peticiones: sorted.length,
    medianaMs: sorted[Math.floor(sorted.length / 2)] ?? null,
    maxMs: sorted.at(-1) ?? null
  }
  report['tokenEnLog'] = live.logged.some((line) => line.includes(env.token))
  mkdirSync('live-reports', { recursive: true })
  writeFileSync(
    join('live-reports', 'service-metric-set-explore.json'),
    `${JSON.stringify(report, null, 2)}\n`
  )
})

describe.skipIf(live === null)(
  'Ficha 0046: métricas de un servicio por serviceType (paso 0)',
  () => {
    /** Servicios elegidos por tipo (ids solo en memoria). */
    const picked: { type: string; caso: string; id: string }[] = []

    const remember = (entity: Raw): Raw => {
      observed.add(String(entity['entityId']))
      if (typeof entity['displayName'] === 'string') observed.add(entity['displayName'])
      const props = (entity['properties'] as Raw | undefined) ?? {}
      for (const key of ['webServerName', 'remoteEndpoint', 'remoteServiceName']) {
        const value = props[key]
        if (typeof value === 'string') observed.add(value)
        if (Array.isArray(value)) for (const v of value) observed.add(String(v))
      }
      return props
    }

    it('qué serviceType existen (censo de type("SERVICE") en now-24h, 3 páginas como mucho)', async () => {
      const counts: Record<string, number> = {}
      let total = 0
      let nextPageKey: string | null = null
      for (let page = 0; page < 3; page += 1) {
        const body = (await get(
          '/entities',
          nextPageKey === null
            ? {
                entitySelector: 'type("SERVICE")',
                fields: '+properties.serviceType',
                from: RANGE,
                pageSize: 500
              }
            : { nextPageKey }
        )) as Raw
        for (const entity of (body['entities'] as Raw[] | undefined) ?? []) {
          const props = remember(entity)
          const type =
            typeof props['serviceType'] === 'string' ? props['serviceType'] : '(sin tipo)'
          // Solo tipos con forma de enumerado de Dynatrace; cualquier otra cosa, contada aparte.
          const key = /^[A-Z_]+$/.test(type) || type === '(sin tipo)' ? type : '(otra forma)'
          counts[key] = (counts[key] ?? 0) + 1
          total += 1
        }
        nextPageKey = typeof body['nextPageKey'] === 'string' ? body['nextPageKey'] : null
        if (nextPageKey === null) break
      }
      report['censo'] = {
        servicios: bucket(total),
        masPaginas: nextPageKey !== null,
        porTipo: Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, bucket(v)])),
        fueraDeLaTabla: Object.keys(counts).filter((k) => !(TYPES as readonly string[]).includes(k))
      }
    })

    it('elige 2 servicios por tipo con serviceType("…") (con y sin propiedad si la hay)', async () => {
      const perType: Record<string, unknown> = {}
      for (const type of TYPES) {
        const { code, body } = await codeOf(
          get('/entities', {
            entitySelector: `type("SERVICE"),serviceType("${type}")`,
            fields: FIELDS,
            from: RANGE,
            pageSize: 100
          })
        )
        const entities = ((body?.['entities'] as Raw[] | undefined) ?? []).map((entity) => ({
          id: String(entity['entityId']),
          props: remember(entity)
        }))
        const present = (props: Raw, key: string): boolean =>
          typeof props[key] === 'string'
            ? props[key] !== ''
            : Array.isArray(props[key]) && props[key].length > 0
        const withProp = (props: Raw): boolean =>
          type === 'WEB_REQUEST_SERVICE'
            ? present(props, 'webServerName')
            : present(props, 'remoteEndpoint') || present(props, 'remoteServiceName')
        const choices: { caso: string; id: string }[] = []
        if (type === 'WEB_REQUEST_SERVICE' || type === 'RPC_SERVICE') {
          const yes = entities.find((e) => withProp(e.props))
          const no = entities.find((e) => !withProp(e.props))
          if (yes !== undefined) choices.push({ caso: 'con propiedad', id: yes.id })
          if (no !== undefined) choices.push({ caso: 'sin propiedad', id: no.id })
        } else {
          for (const e of entities.slice(0, PER_TYPE))
            choices.push({ caso: 'sin propiedad', id: e.id })
        }
        for (const choice of choices) picked.push({ type, ...choice })
        perType[type] = {
          codigo: code,
          servicios: bucket(entities.length),
          todosDeEseTipo: entities.every((e) => e.props['serviceType'] === type),
          tiposDePropiedades: Object.fromEntries(
            ['webServerName', 'remoteEndpoint', 'remoteServiceName'].map((key) => [
              key,
              [
                ...new Set(
                  entities.map((e) =>
                    e.props[key] === undefined
                      ? 'no llega'
                      : Array.isArray(e.props[key])
                        ? 'lista'
                        : typeof e.props[key]
                  )
                )
              ]
            ])
          ),
          ...(type === 'WEB_REQUEST_SERVICE' || type === 'RPC_SERVICE'
            ? {
                conPropiedad: bucket(entities.filter((e) => withProp(e.props)).length),
                sinPropiedad: bucket(entities.filter((e) => !withProp(e.props)).length)
              }
            : {}),
          elegidos: choices.map((c) => c.caso)
        }
      }
      report['por tipo'] = perType
    })

    it('descriptores de las métricas de los cuatro conjuntos', async () => {
      const descriptors: Record<string, unknown> = {}
      const metrics = [...new Set(Object.values(SET_METRICS).flat())]
      for (const metric of metrics) {
        const { code, body } = await codeOf(get(`/metrics/${encodeURIComponent(metric)}`, {}))
        descriptors[metric] =
          body === null
            ? { codigo: code }
            : {
                codigo: code,
                unit: body['unit'] ?? null,
                entityType: body['entityType'] ?? null,
                resolutionInfSupported: body['resolutionInfSupported'] ?? null,
                defaultAggregation: body['defaultAggregation'] ?? null,
                aggregationTypes: body['aggregationTypes'] ?? null,
                dimensiones: Array.isArray(body['dimensionDefinitions'])
                  ? (body['dimensionDefinitions'] as Raw[]).map((d) => ({
                      key: d['key'] ?? null,
                      type: d['type'] ?? null
                    }))
                  : null,
                transformations: Array.isArray(body['transformations'])
                  ? (body['transformations'] as unknown[]).includes('fold')
                    ? 'incluye fold'
                    : 'sin fold'
                  : null
              }
      }
      report['descriptores'] = descriptors
    })

    it('por servicio: entidad, datos de su conjunto y de Servidor en now-24h', async () => {
      const rows: unknown[] = []
      const counters: Record<string, number> = {}
      for (const { type, caso, id } of picked) {
        counters[type] = (counters[type] ?? 0) + 1
        const row: Record<string, unknown> = { tipo: type, caso, n: counters[type] }
        const detail = await codeOf(get(`/entities/${encodeURIComponent(id)}`, { fields: FIELDS }))
        const props = detail.body === null ? {} : remember(detail.body)
        const set = setOf(type, props)
        row['entidad'] = {
          codigo: detail.code,
          serviceTypeIgual: props['serviceType'] === type,
          claves: Object.keys(props).sort()
        }
        row['conjunto'] = set
        row['servidor'] = await query(id, expressionsOf('server'))
        if (set !== 'server') row[set] = await query(id, expressionsOf(set))

        if (set === 'activity') {
          // ¿El recuento de response.server coincide con requestCount.server?
          const count = await valueOf(id, 'builtin:service.response.server:count')
          const requests = await valueOf(id, 'builtin:service.requestCount.server')
          row['recuento frente a requestCount.server'] =
            typeof count === 'string' || typeof requests === 'string'
              ? { codigos: [count, requests].map((v) => (typeof v === 'string' ? v : 'ok')) }
              : compare(count, requests)
        }

        if (set === 'unified') {
          const [time, failures, total] = SET_METRICS.unified
          const failed = await valueOf(id, `${failures}`)
          const all = await valueOf(id, `${total}`)
          row['fallidas frente a total'] =
            typeof failed === 'string' || typeof all === 'string'
              ? { codigos: [failed, all].map((v) => (typeof v === 'string' ? v : 'ok')) }
              : {
                  fallidasMenorOIgualQueTotal:
                    failed === null || all === null ? 'sin datos' : failed <= all,
                  totalCero: all === 0,
                  tasaEn0a100:
                    failed === null || all === null || all === 0
                      ? 'sin datos'
                      : (failed / all) * 100 >= 0 && (failed / all) * 100 <= 100
                }
          // ¿Se separan las fallidas por una dimensión? Se pregunta por las que no son de entidad.
          for (const metric of [total, time]) {
            const descriptor = (await codeOf(get(`/metrics/${encodeURIComponent(metric!)}`, {})))
              .body
            const dims = (
              Array.isArray(descriptor?.['dimensionDefinitions'])
                ? (descriptor['dimensionDefinitions'] as Raw[])
                : []
            )
              .map((d) => String(d['key']))
              .filter((key) => !key.startsWith('dt.entity.'))
            const split: Record<string, unknown> = {}
            for (const dim of dims.slice(0, 3)) {
              const { code, body } = await codeOf(
                get('/metrics/query', {
                  metricSelector: `${metric}:splitBy("dt.entity.service","${dim}")`,
                  entitySelector: `entityId("${id}")`,
                  from: RANGE,
                  resolution: 'Inf'
                })
              )
              const values = [
                ...new Set(resultsOf(body)[0]?.dimensionMaps.map((m) => m[dim] ?? '(no llega)'))
              ]
              split[dim] = {
                codigo: code,
                // Solo valores booleanos o de enumerado corto; el resto, contados.
                valores: values.every((v) => /^(true|false|\(no llega\))$/.test(v))
                  ? values.sort()
                  : `${bucket(values.length)} valores`
              }
              if (values.includes('true') && values.includes('false')) {
                const yes = await valueOf(
                  id,
                  `${metric}:filter(eq("${dim}","true")):splitBy("dt.entity.service")`
                )
                split[`${dim}=true frente a ${failures}`] =
                  typeof yes === 'string' || typeof failed === 'string'
                    ? 'error'
                    : compare(yes, failed)
              }
            }
            row[`dimensiones de ${metric}`] = split
          }
        }
        rows.push(row)
      }
      report['servicios'] = rows
    })

    it('expresiones del canal por conjunto (filtro y splitBy por servicio), series e Inf', async () => {
      const out: Record<string, unknown> = {}
      const byService = (id: string): string =>
        `:filter(eq("dt.entity.service","${id}")):splitBy("dt.entity.service")`
      /** Las expresiones candidatas del canal, con el papel de cada una. */
      const channel = (set: MetricSet, id: string): [string, string][] => {
        const scope = byService(id)
        const [a, b, c, d] = SET_METRICS[set]
        if (set === 'activity') return [['peticiones', `${a}${scope}:count`]]
        if (set === 'unified')
          return [
            ['mediana', `${a}${scope}:median`],
            ['p90', `${a}${scope}:percentile(90.0)`],
            ['p99', `${a}${scope}:percentile(99.0)`],
            ['errores', `${b}${scope}`],
            ['peticiones', `${c}${scope}`]
          ]
        return [
          ['mediana', `${a}${scope}:median`],
          ['p90', `${a}${scope}:percentile(90.0)`],
          ['p99', `${a}${scope}:percentile(99.0)`],
          ['errores', `${b}${scope}`],
          ['tasa', `${c}${scope}`],
          ['peticiones', `${d}${scope}`]
        ]
      }
      const sumOf = (body: Raw | null, i: number): number | null => {
        const results = (Array.isArray(body?.['result']) ? body['result'] : []) as Raw[]
        const data = (results[i]?.['data'] as Raw[] | undefined) ?? []
        const values = (data[0]?.['values'] as (number | null)[] | undefined) ?? []
        return values.every((v) => v === null)
          ? null
          : values.reduce<number>((acc, v) => acc + (v ?? 0), 0)
      }
      const cases: { name: string; set: MetricSet; type: string }[] = [
        { name: 'server (WEB_SERVICE)', set: 'server', type: 'WEB_SERVICE' },
        { name: 'client (DATABASE_SERVICE)', set: 'client', type: 'DATABASE_SERVICE' },
        { name: 'unified (UNIFIED)', set: 'unified', type: 'UNIFIED' },
        {
          name: 'activity (QUEUE_LISTENER_SERVICE)',
          set: 'activity',
          type: 'QUEUE_LISTENER_SERVICE'
        },
        { name: 'client (EXTERNAL, sin datos de Servidor)', set: 'client', type: 'EXTERNAL' }
      ]
      for (const { name, set, type } of cases) {
        const id = picked.find((p) => p.type === type)?.id
        if (id === undefined) {
          out[name] = 'sin servicio de ese tipo'
          continue
        }
        const roles = channel(set, id)
        const selector = roles.map(([, e]) => e).join(',')
        const series = await codeOf(
          get('/metrics/query', { metricSelector: selector, from: RANGE })
        )
        const inf = await codeOf(
          get('/metrics/query', { metricSelector: selector, from: RANGE, resolution: 'Inf' })
        )
        const seriesResults = resultsOf(series.body)
        const infResults = resultsOf(inf.body)
        out[name] = {
          forma: roles.map(([role, e]) => `${role}: ${e.split(id).join('<id>')}`),
          codigoSeries: series.code,
          codigoInf: inf.code,
          resolutionSeries: series.body?.['resolution'] ?? null,
          resultadosEnOrden: seriesResults.every(
            (r, i) => r.metricId === roles[i]?.[1].replace(`"${id}"`, id)
          ),
          seriesPorExpresion: Object.fromEntries(
            roles.map(([role], i) => [
              role,
              `${bucket(seriesResults[i]?.series ?? 0)} / Inf ${bucket(infResults[i]?.series ?? 0)}`
            ])
          ),
          conDatosInf: Object.fromEntries(
            roles.map(([role], i) => [role, (infResults[i]?.value ?? null) !== null])
          ),
          recuentoInfFrenteASumaDeLaSerie: Object.fromEntries(
            roles
              .map(([role], i) => [role, i] as const)
              .filter(([role]) => role === 'peticiones' || role === 'errores')
              .map(([role, i]) => [
                role,
                compare(infResults[i]?.value ?? null, sumOf(series.body, i))
              ])
          )
        }
        if (set === 'unified') {
          // El total con splitBy del servicio frente a la suma de failed=true y failed=false.
          const [, failures, total] = SET_METRICS.unified
          const split = await codeOf(
            get('/metrics/query', {
              metricSelector: `${total}:filter(eq("dt.entity.service","${id}")):splitBy("dt.entity.service","failed")`,
              from: RANGE,
              resolution: 'Inf'
            })
          )
          const parts = resultsOf(split.body)[0]
          const partValues =
            ((split.body?.['result'] as Raw[] | undefined)?.[0]?.['data'] as Raw[] | undefined) ??
            []
          const sumParts = partValues.reduce<number>(
            (acc, d) => acc + (((d['values'] as (number | null)[] | undefined) ?? [])[0] ?? 0),
            0
          )
          const totalIdx = roles.findIndex(([role]) => role === 'peticiones')
          const failIdx = roles.findIndex(([role]) => role === 'errores')
          const totalValue = infResults[totalIdx]?.value ?? null
          const failValue = infResults[failIdx]?.value ?? null
          ;(out[name] as Raw)['total con splitBy(servicio) frente a suma por failed'] = {
            codigo: split.code,
            series: bucket(parts?.series ?? 0),
            comparacion: compare(totalValue, partValues.length === 0 ? null : sumParts)
          }
          ;(out[name] as Raw)['fallidas ≤ total (Inf)'] =
            totalValue === null || failValue === null ? 'sin datos' : failValue <= totalValue
          ;(out[name] as Raw)['métrica de tasa directa'] = `no hay (solo ${failures} y ${total})`
        }
      }
      report['expresiones del canal'] = out
    })

    it('CA1 (0046): el informe no contiene ningún id, nombre ni valor observado', () => {
      const text = JSON.stringify(report)
      for (const value of observed) {
        if (value.length < 4) continue
        expect(text.includes(value), 'el informe contiene un id, un nombre o un valor').toBe(false)
      }
      expect(observed.size).toBeGreaterThan(0)
    })
  }
)
