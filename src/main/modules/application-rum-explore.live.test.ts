import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createLiveClient } from '../../test/live-client'
import { loadLiveEnv } from '../../test/live-env'
import { DtError } from '../dynatrace/errors'

/**
 * Ficha 0052, paso 0: EXPLORACIÓN EN VIVO de las métricas de RUM de una aplicación web
 * (APPLICATION) para el canal `entities:applicationRum`. SOLO LECTURA, una petición detrás de
 * otra, y SOLO API clásica (`builtin:apps.web.*` por `GET /metrics/query`): nada de Grail ni DQL
 * (decisión de Dani).
 *
 * 1. Como mucho 3 aplicaciones (de los problemas de 7 días o de `type("APPLICATION")`).
 * 2. Descriptor de cada candidata (`GET /metrics/{metricId}`): unidad, agregaciones y dimensiones.
 * 3. Qué candidatas tienen datos en `now-24h`.
 * 4. Errores por tipo: valores de `Error type` y `Error origin` y si los tipos suman el total (en
 *    el rango y en cada intervalo), y si `jsErrorsDuringUa` + `jsErrorsWithoutUa` es el tipo
 *    JavaScript.
 * 5. `activeUsersEst`: qué agregación da los usuarios del rango con `resolution=Inf`.
 * 6. Unidades: tramos de duración de sesión, rebote, LCP, CLS e INP.
 * 7. Consultas exactas del canal (series y totales), como mucho 10 expresiones por consulta.
 *
 * El informe (live-reports/application-rum-explore.json, ignorado) guarda SOLO comportamientos y
 * claves de la API. Nunca un id, un nombre ni un valor. CA1 (0052) comprueba que no se cuela
 * ningún id ni nombre observado.
 */

const env = loadLiveEnv()
const live = env === null ? null : createLiveClient(env)
const report: Record<string, unknown> = {}
const timings: number[] = []
/** Ids y nombres observados: el informe no puede contener ninguno (CA1). */
const observed = new Set<string>()
const MAX_APPS = 3
/** La API admite como mucho 10 expresiones por consulta de /metrics/query (OpenAPI v2). */
const BATCH = 10
const FROM = 'now-24h'
const W = 'builtin:apps.web.'
const APP_PATTERN = /^APPLICATION-[0-9A-F]{16}$/

type Raw = Record<string, unknown>
type Values = (number | null)[]

const isEnum = (value: string): boolean =>
  /^[A-Z][A-Z0-9_]*$/.test(value) || /^(true|false|null)$/.test(value)
const note = (value: unknown): void => {
  if (typeof value === 'string' && !isEnum(value)) observed.add(value)
}

/** Candidatas de la ficha, por papel (todas con el prefijo `builtin:apps.web.`). */
const CANDIDATES: Record<string, string[]> = {
  accionesPorTipo: [
    'actionCount.load.browser',
    'actionCount.xhr.browser',
    'actionCount.custom.browser'
  ],
  duracionPorTipo: [
    'actionDuration.load.browser',
    'actionDuration.xhr.browser',
    'actionDuration.custom.browser'
  ],
  erroresPorTipo: [
    'countOfErrors',
    'errorCountForDavis',
    'countOfStandaloneErrors',
    'countOfErrorsDuringUserActions',
    'jsErrorsDuringUa',
    'jsErrorsWithoutUa'
  ],
  accionesAfectadas: ['percentageOfUserActionsAffectedByErrors', 'countOfUserActionsWithErrors'],
  usuariosActivos: ['activeUsersEst'],
  sesiones: [
    'startedSessions',
    'activeSessions',
    'endedSessions',
    'sessionDuration',
    'actionsPerSession',
    'bouncedSessionRatio'
  ],
  experiencia: [
    'largestContentfulPaint.load.browser',
    'cumulativeLayoutShift.load.browser',
    'interactionToNextPaint'
  ],
  frustracion: ['event.count.rageClick']
}
const ALL = Object.values(CANDIDATES)
  .flat()
  .map((key) => `${W}${key}`)

/**
 * Consultas del canal, por papel y en este orden (decisiones del test-writer, refinables, en la
 * ficha): recuentos con `:sum`, tiempos con `:avg`, Core Web Vitals con el percentil 75 (el de
 * Google; INP no admite `avg`) y errores por `Error type`. Los porcentajes y los usuarios, sin
 * agregación (`:splitBy()`, igual que `:value`): con varios tipos de usuario, `:avg` es la media
 * sin ponderar de los tipos y no coincide.
 */
const CHANNEL = [
  `${W}actionCount.load.browser:splitBy():sum`,
  `${W}actionCount.xhr.browser:splitBy():sum`,
  `${W}actionCount.custom.browser:splitBy():sum`,
  `${W}actionDuration.load.browser:splitBy():avg`,
  `${W}actionDuration.xhr.browser:splitBy():avg`,
  `${W}actionDuration.custom.browser:splitBy():avg`,
  `${W}countOfErrors:splitBy("Error type"):sum`,
  `${W}percentageOfUserActionsAffectedByErrors:splitBy()`,
  `${W}activeUsersEst:splitBy()`,
  `${W}startedSessions:splitBy():sum`,
  `${W}endedSessions:splitBy():sum`,
  `${W}sessionDuration:splitBy():avg`,
  `${W}actionsPerSession:splitBy():avg`,
  `${W}bouncedSessionRatio:splitBy()`,
  `${W}largestContentfulPaint.load.browser:splitBy():percentile(75)`,
  `${W}cumulativeLayoutShift.load.browser:splitBy():percentile(75)`,
  `${W}interactionToNextPaint:splitBy():percentile(75)`,
  `${W}event.count.rageClick:splitBy():sum`
]

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

/** Tramo de un valor (para unidades), nunca el valor. */
function range(value: number | null): string {
  if (value === null) return 'null'
  if (value < 0) return '< 0'
  if (value <= 1) return '[0, 1]'
  if (value <= 100) return '(1, 100]'
  if (value <= 1e4) return '(100, 1e4]'
  if (value <= 1e6) return '(1e4, 1e6]'
  return '> 1e6'
}

function compare(a: number | null, b: number | null): string {
  if (a === null || b === null) return a === b ? 'los dos null' : 'uno null'
  if (a === b) return 'iguales'
  const scale = Math.max(Math.abs(a), Math.abs(b))
  const diff = Math.abs(a - b) / scale
  return diff < 1e-6 ? 'iguales (redondeo)' : diff < 0.01 ? 'casi (< 1 %)' : 'distintos (≥ 1 %)'
}

const ratioBucket = (value: unknown): string =>
  typeof value !== 'number' ? 'sin campo' : value <= 1 ? '<= 1' : '> 1'

/** Valores de las dimensiones estándar de RUM (los fija Dynatrace): solo palabras cortas. */
const STANDARD = new Set(['Error type', 'Error origin', 'User type', 'Users'])
const textOf = (key: string, value: unknown): string =>
  typeof value === 'string' &&
  (isEnum(value) ||
    (STANDARD.has(key.replace(/\.name$/, '')) &&
      /^[A-Za-z][A-Za-z]{0,15}( [A-Za-z]{1,15}){0,2}$/.test(value)))
    ? value
    : 'otro'

const present = (values: Values): number[] => values.filter((v): v is number => v !== null)
const sumOf = (values: Values): number | null => {
  const p = present(values)
  return p.length === 0 ? null : p.reduce((a, b) => a + b, 0)
}
const maxOf = (values: Values): number | null => {
  const p = present(values)
  return p.length === 0 ? null : Math.max(...p)
}

interface SeriesItem {
  dimensionMap: Record<string, unknown>
  timestamps: number[]
  values: Values
}
interface QueryResult {
  code: string
  resolution: unknown
  results: { metricId: unknown; ratios: string[]; data: SeriesItem[] }[]
}

async function query(metricSelector: string, extra: Record<string, string>): Promise<QueryResult> {
  const { code, body } = await codeOf(
    get('/metrics/query', { metricSelector, from: FROM, ...extra })
  )
  const results = ((body?.['result'] as Raw[] | undefined) ?? []).map((r) => {
    const data = ((r['data'] as Raw[] | undefined) ?? []).map((d) => ({
      dimensionMap: (d['dimensionMap'] as Record<string, unknown> | undefined) ?? {},
      timestamps: (d['timestamps'] as number[] | undefined) ?? [],
      values: (d['values'] as Values | undefined) ?? []
    }))
    for (const item of data)
      for (const [key, value] of Object.entries(item.dimensionMap))
        if (key.startsWith('dt.entity.') && !/\.(browser|geolocation)\.name$/.test(key)) note(value)
    return {
      metricId: r['metricId'],
      ratios: [ratioBucket(r['dataPointCountRatio']), ratioBucket(r['dimensionCountRatio'])],
      data
    }
  })
  return { code, resolution: body?.['resolution'] ?? null, results }
}

/** Las consultas de una lista de expresiones, de 10 en 10, juntas en el orden pedido. */
async function batched(expressions: string[], extra: Record<string, string>): Promise<QueryResult> {
  const out: QueryResult = { code: 'ok', resolution: null, results: [] }
  for (let start = 0; start < expressions.length; start += BATCH) {
    const one = await query(expressions.slice(start, start + BATCH).join(','), extra)
    if (one.code !== 'ok') out.code = one.code
    out.resolution ??= one.resolution
    out.results.push(...one.results)
  }
  return out
}

const keysOf = (data: SeriesItem[]): string[] =>
  [...new Set(data.flatMap((d) => Object.keys(d.dimensionMap)))].sort()

const apps: string[] = []

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
    join('live-reports', 'application-rum-explore.json'),
    `${JSON.stringify(report, null, 2)}\n`
  )
})

describe.skipIf(live === null)('Ficha 0052: métricas de RUM de una aplicación web (paso 0)', () => {
  it('elige como mucho 3 aplicaciones', async () => {
    const list = (await get('/problems', { from: 'now-7d', pageSize: 100 })) as Raw
    for (const problem of (list['problems'] as Raw[] | undefined) ?? []) {
      note(problem['problemId'])
      note(problem['displayId'])
      note(problem['title'])
      const entities = [
        ...((problem['affectedEntities'] as Raw[] | undefined) ?? []),
        ...((problem['impactedEntities'] as Raw[] | undefined) ?? [])
      ]
      for (const entity of entities) {
        const id = (entity['entityId'] as Raw | undefined)?.['id']
        note(entity['name'])
        if (typeof id !== 'string') continue
        observed.add(id)
        if (APP_PATTERN.test(id) && !apps.includes(id)) apps.push(id)
      }
    }
    const fromProblems = Math.min(apps.length, MAX_APPS)
    if (apps.length < MAX_APPS) {
      const page = (await get('/entities', {
        entitySelector: 'type("APPLICATION")',
        from: 'now-7d',
        pageSize: MAX_APPS
      })) as Raw
      for (const entity of (page['entities'] as Raw[] | undefined) ?? []) {
        const id = String(entity['entityId'])
        observed.add(id)
        note(entity['displayName'])
        if (!apps.includes(id)) apps.push(id)
      }
    }
    apps.splice(MAX_APPS)
    report['aplicaciones'] = {
      deProblemas: fromProblems,
      deEntities: apps.length - fromProblems,
      formatoDelId: apps.every((id) => APP_PATTERN.test(id))
    }
    expect(apps.length).toBeGreaterThan(0)
  })

  it('descriptores de las candidatas (GET /metrics/{metricId})', async () => {
    const out: Record<string, unknown> = {}
    for (const metricId of ALL) {
      const { code, body } = await codeOf(get(`/metrics/${metricId}`, {}))
      out[metricId] =
        body === null
          ? { codigo: code }
          : {
              codigo: code,
              unidad: body['unit'] ?? null,
              agregacionPorDefecto: (body['defaultAggregation'] as Raw | null)?.['type'] ?? null,
              agregaciones: body['aggregationTypes'] ?? null,
              resolutionInfSupported: body['resolutionInfSupported'] ?? null,
              dimensiones: ((body['dimensionDefinitions'] as Raw[] | undefined) ?? []).map(
                (d) => `${String(d['key'])} (${String(d['type'])})`
              )
            }
    }
    report['descriptores'] = out
  })

  it('qué candidatas tienen datos en now-24h', async () => {
    const out: Record<string, string[]> = {}
    for (const [index, id] of apps.entries()) {
      const result = await batched(ALL, { entitySelector: `entityId("${id}")`, resolution: 'Inf' })
      ALL.forEach((metricId, i) => {
        const data = result.results[i]?.data ?? []
        const values = data.flatMap((d) => present(d.values))
        const row = out[metricId] ?? []
        row.push(
          `#${index + 1}: ${result.code}, ${bucket(data.length)} series, ${values.length > 0 ? 'con datos' : 'sin datos'}`
        )
        out[metricId] = row
      })
    }
    report['datos'] = out
  })

  it('errores por tipo: Error type, Error origin y si los tipos suman el total', async () => {
    const rows: unknown[] = []
    const metrics = [
      'countOfErrors',
      'errorCountForDavis',
      'countOfStandaloneErrors',
      'countOfErrorsDuringUserActions'
    ]
    for (const [index, id] of apps.entries()) {
      const scope = { entitySelector: `entityId("${id}")` }
      const perMetric: Record<string, unknown> = {}
      for (const metric of metrics) {
        const forms = [
          `${W}${metric}:splitBy():sum`,
          `${W}${metric}:splitBy("Error type"):sum`,
          `${W}${metric}:splitBy("Error origin"):sum`,
          `${W}${metric}:splitBy("Error type","Error origin"):sum`
        ]
        const inf = await query(forms.join(','), { ...scope, resolution: 'Inf' })
        const series = await query(forms.join(','), scope)
        const total = inf.results[0]?.data[0]?.values[0] ?? null
        const typeData = inf.results[1]?.data ?? []
        const typeSum = sumOf(typeData.map((d) => d.values[0] ?? null))
        // Por intervalo: ¿la suma de los tipos es el total del intervalo?
        const totalSeries = series.results[0]?.data[0]
        const typeSeries = series.results[1]?.data ?? []
        const perInterval = (totalSeries?.timestamps ?? []).map((t, i) => {
          const sum = sumOf(
            typeSeries.map((d) => {
              const at = d.timestamps.indexOf(t)
              return at === -1 ? null : (d.values[at] ?? null)
            })
          )
          return compare(totalSeries?.values[i] ?? null, sum)
        })
        perMetric[metric] = {
          codigoInf: inf.code,
          codigoSeries: series.code,
          metricIdIgualAlPedido: forms.map((f, i) => inf.results[i]?.metricId === f),
          tiposDeError: [
            ...new Set(typeData.map((d) => textOf('Error type', d.dimensionMap['Error type'])))
          ].sort(),
          clavesConTipo: keysOf(typeData),
          origenes: [
            ...new Set(
              (inf.results[2]?.data ?? []).map((d) =>
                textOf('Error origin', d.dimensionMap['Error origin'])
              )
            )
          ].sort(),
          sumaDeTiposFrenteAlTotal: compare(total, typeSum),
          sumaDeOrigenesFrenteAlTotal: compare(
            total,
            sumOf((inf.results[2]?.data ?? []).map((d) => d.values[0] ?? null))
          ),
          porIntervalo: [...new Set(perInterval)].sort(),
          mismosTimestampsEnTipos: typeSeries.every(
            (d) =>
              d.timestamps.length === (totalSeries?.timestamps.length ?? 0) &&
              d.timestamps.every((t, i) => t === totalSeries?.timestamps[i])
          ),
          tramoTotal: range(total)
        }
      }
      // ¿jsErrorsDuringUa + jsErrorsWithoutUa es el tipo JavaScript de countOfErrors?
      const js = await query(
        [
          `${W}jsErrorsDuringUa:splitBy():sum`,
          `${W}jsErrorsWithoutUa:splitBy():sum`,
          `${W}countOfErrors:filter(eq("Error type","JavaScript")):splitBy():sum`,
          `${W}countOfErrors:filter(eq("Error type","Request")):splitBy():sum`
        ].join(','),
        { ...scope, resolution: 'Inf' }
      )
      const during = js.results[0]?.data[0]?.values[0] ?? null
      const without = js.results[1]?.data[0]?.values[0] ?? null
      const filtered = js.results[2]?.data[0]?.values[0] ?? null
      rows.push({
        aplicacion: `#${index + 1}`,
        porMetrica: perMetric,
        jsDeLasDosFrenteAlTipoJavaScript: {
          codigo: js.code,
          resultado: compare(sumOf([during, without]), filtered),
          filtroRequestConDatos: (js.results[3]?.data.length ?? 0) > 0
        }
      })
    }
    report['errores'] = rows
  })

  it('activeUsersEst: qué agregación da los usuarios del rango con resolution=Inf', async () => {
    const rows: unknown[] = []
    const forms = [
      `${W}activeUsersEst:splitBy()`,
      `${W}activeUsersEst:splitBy():sum`,
      `${W}activeUsersEst:splitBy():value`,
      `${W}activeUsersEst:splitBy():max`,
      `${W}activeUsersEst:splitBy():avg`,
      `${W}startedSessions:splitBy():sum`
    ]
    for (const [index, id] of apps.entries()) {
      const scope = { entitySelector: `entityId("${id}")` }
      const inf = await query(forms.join(','), { ...scope, resolution: 'Inf' })
      const series = await query(forms.join(','), scope)
      const seriesSum = series.results[1]?.data[0]?.values ?? []
      const sessions = inf.results[5]?.data[0]?.values[0] ?? null
      rows.push({
        aplicacion: `#${index + 1}`,
        codigoInf: inf.code,
        codigoSeries: series.code,
        porForma: forms.slice(0, 5).map((form, i) => {
          const value = inf.results[i]?.data[0]?.values[0] ?? null
          const values = series.results[i]?.data[0]?.values ?? []
          return {
            expresion: form,
            codigoYDatos: `${inf.code}, ${bucket(inf.results[i]?.data.length ?? 0)} series`,
            infFrenteASumaDeSuSerie: compare(value, sumOf(values)),
            infFrenteAMaximoDeSuSerie: compare(value, maxOf(values)),
            infFrenteASumaDeLaSerieSum: compare(value, sumOf(seriesSum)),
            infMenorOIgualQueSesiones:
              value === null || sessions === null ? 'sin dato' : value <= sessions,
            tramo: range(value)
          }
        })
      })
    }
    report['usuariosActivos'] = rows
  })

  it('unidades y tramos: sesión, rebote, acciones por sesión y Core Web Vitals', async () => {
    const rows: unknown[] = []
    const forms = [
      `${W}sessionDuration:splitBy():avg`,
      `${W}bouncedSessionRatio:splitBy():avg`,
      `${W}actionsPerSession:splitBy():avg`,
      `${W}largestContentfulPaint.load.browser:splitBy():percentile(75)`,
      `${W}cumulativeLayoutShift.load.browser:splitBy():percentile(75)`,
      `${W}interactionToNextPaint:splitBy():percentile(75)`,
      `${W}percentageOfUserActionsAffectedByErrors:splitBy():avg`,
      `${W}countOfUserActionsWithErrors:splitBy():sum`,
      `${W}actionCount.summary:splitBy():sum`
    ]
    for (const [index, id] of apps.entries()) {
      const scope = { entitySelector: `entityId("${id}")` }
      const inf = await query(forms.join(','), { ...scope, resolution: 'Inf' })
      const series = await query(forms.join(','), scope)
      const valueOf = (i: number): number | null => inf.results[i]?.data[0]?.values[0] ?? null
      const withErrors = valueOf(7)
      const actions = valueOf(8)
      rows.push({
        aplicacion: `#${index + 1}`,
        codigoInf: inf.code,
        codigoSeries: series.code,
        porForma: forms.slice(0, 7).map((form, i) => ({
          expresion: form,
          tramoInf: range(valueOf(i)),
          tramoMaximoDeLaSerie: range(maxOf(series.results[i]?.data[0]?.values ?? [])),
          series: bucket(series.results[i]?.data.length ?? 0)
        })),
        // ¿El porcentaje de acciones afectadas es 100 × con errores / acciones?
        porcentajeAfectadasFrenteAlCociente: compare(
          valueOf(6),
          withErrors === null || actions === null || actions === 0
            ? null
            : (100 * withErrors) / actions
        )
      })
    }
    report['unidades'] = rows
  })

  it('consultas exactas del canal (series y totales, de 10 en 10)', async () => {
    const rows: unknown[] = []
    for (const [index, id] of apps.entries()) {
      const scope = { entitySelector: `entityId("${id}")` }
      const series = await batched(CHANNEL, scope)
      const totals = await batched(CHANNEL, { ...scope, resolution: 'Inf' })
      const firstTimestamps = series.results[0]?.data[0]?.timestamps ?? []
      rows.push({
        aplicacion: `#${index + 1}`,
        codigoSeries: series.code,
        codigoTotales: totals.code,
        resolution: series.resolution,
        porExpresion: CHANNEL.map((expression, i) => {
          const s = series.results[i]
          const t = totals.results[i]
          return {
            expresion: expression,
            metricIdIgualAlPedido: s?.metricId === expression,
            seriesEnSeries: bucket(s?.data.length ?? 0),
            seriesEnTotales: bucket(t?.data.length ?? 0),
            clavesDeDimensionMap: keysOf(s?.data ?? []),
            mismosTimestampsQueLaPrimera: (s?.data ?? []).every(
              (d) =>
                d.timestamps.length === firstTimestamps.length &&
                d.timestamps.every((ts, k) => ts === firstTimestamps[k])
            ),
            totalFrenteASumaDeLaSerie: compare(
              t?.data[0]?.values[0] ?? null,
              sumOf(s?.data[0]?.values ?? [])
            ),
            ratios: [...new Set([...(s?.ratios ?? []), ...(t?.ratios ?? [])])]
          }
        })
      })
    }
    report['canal'] = { expresiones: CHANNEL, porAplicacion: rows }
  })

  it('porcentajes y usuarios: formas de agregación comparadas entre sí', async () => {
    const rows: unknown[] = []
    const forms = [
      `${W}activeUsersEst:splitBy()`,
      `${W}activeUsersEst:splitBy():sum`,
      `${W}activeUsersEst:splitBy():value`,
      `${W}percentageOfUserActionsAffectedByErrors:splitBy()`,
      `${W}percentageOfUserActionsAffectedByErrors:splitBy():avg`,
      `${W}percentageOfUserActionsAffectedByErrors:splitBy():value`,
      `${W}countOfUserActionsWithErrors:splitBy():sum`,
      `${W}actionCount.summary:splitBy():sum`,
      `${W}bouncedSessionRatio:splitBy()`,
      `${W}bouncedSessionRatio:splitBy():avg`
    ]
    for (const [index, id] of apps.entries()) {
      const scope = { entitySelector: `entityId("${id}")` }
      const inf = await query(forms.join(','), { ...scope, resolution: 'Inf' })
      const series = await query(forms.join(','), scope)
      const v = (i: number): number | null => inf.results[i]?.data[0]?.values[0] ?? null
      const s = (i: number): Values => series.results[i]?.data[0]?.values ?? []
      const actions = v(7)
      const ratio =
        actions === null || actions === 0 || v(6) === null ? null : (100 * v(6)!) / actions
      // Por intervalo: ¿el porcentaje es 100 × con errores / acciones?
      const perInterval = s(4).map((value, i) => {
        const a = s(7)[i] ?? null
        const e = s(6)[i] ?? null
        return compare(value, a === null || a === 0 || e === null ? null : (100 * e) / a)
      })
      rows.push({
        aplicacion: `#${index + 1}`,
        codigoInf: inf.code,
        codigoSeries: series.code,
        usuarios: {
          sumFrenteASinAgregacion: compare(v(1), v(0)),
          valueFrenteASinAgregacion: compare(v(2), v(0))
        },
        afectadas: {
          avgFrenteASinAgregacion: compare(v(4), v(3)),
          valueFrenteASinAgregacion: compare(v(5), v(3)),
          avgFrenteAlCocienteEnElRango: compare(v(4), ratio),
          sinAgregacionFrenteAlCocienteEnElRango: compare(v(3), ratio),
          avgFrenteAlCocientePorIntervalo: [...new Set(perInterval)].sort()
        },
        rebote: {
          avgFrenteASinAgregacion: compare(v(9), v(8)),
          tramoMaximoDeLaSerie: range(maxOf(s(9)))
        }
      })
      // Duración de sesión y acciones por sesión: ¿`:splitBy()` (auto) es `:avg`?
      const session = [
        `${W}sessionDuration:splitBy()`,
        `${W}sessionDuration:splitBy():avg`,
        `${W}actionsPerSession:splitBy()`,
        `${W}actionsPerSession:splitBy():avg`
      ]
      const sInf = await query(session.join(','), { ...scope, resolution: 'Inf' })
      const sv = (i: number): number | null => sInf.results[i]?.data[0]?.values[0] ?? null
      rows.push({
        aplicacion: `#${index + 1}`,
        codigo: sInf.code,
        duracionDeSesionAvgFrenteASinAgregacion: compare(sv(1), sv(0)),
        accionesPorSesionAvgFrenteASinAgregacion: compare(sv(3), sv(2))
      })
    }
    report['agregaciones'] = rows
  })

  it('CA1 (0052): el informe no contiene ningún id ni nombre observado', () => {
    const text = JSON.stringify(report)
    for (const value of observed) {
      if (value.length < 4) continue
      // El mensaje no lleva el valor.
      expect(text.includes(value), 'el informe contiene un id o un nombre observado').toBe(false)
    }
    expect(observed.size).toBeGreaterThan(0)
    expect(Object.keys(report)).toEqual(
      expect.arrayContaining([
        'aplicaciones',
        'descriptores',
        'datos',
        'errores',
        'usuariosActivos',
        'unidades',
        'canal'
      ])
    )
  })
})
