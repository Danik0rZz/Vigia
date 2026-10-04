import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { DT_ENDPOINTS } from '@shared/dt-endpoints'
import { createLiveClient } from '../../test/live-client'
import { loadLiveEnv } from '../../test/live-env'
import { DtError } from '../dynatrace/errors'
import { problemDetailSchema, toProblemDetail } from './problems'

/**
 * PRUEBA EN VIVO de la 0.9.0 (lista ordenada y página de detalle), SOLO
 * LECTURA y con pocas peticiones (como mucho unas 10).
 *
 * El informe (live-reports/problems-detail.json, ignorado) guarda SOLO
 * comportamientos: si el orden se cumple, tramos de tamaño (nunca recuentos
 * exactos), nombres de campo, valores de enum, códigos de error y tiempos.
 * Nunca IDs, títulos, nombres de entidades, comentarios ni evidencias.
 */

const env = loadLiveEnv()
const live = env === null ? null : createLiveClient(env)
const report: Record<string, unknown> = {}
const timings: number[] = []
const DETAIL_FIELDS = 'evidenceDetails,recentComments'
/** Problemas cuyo detalle se pide como mucho buscando uno con muchas evidencias. */
const MAX_DETAILS = 6

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

/** Código del error, sin su mensaje (puede llevar el host del tenant). */
async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
    return 'ok'
  } catch (error) {
    return error instanceof DtError
      ? `${error.code}${error.status === undefined ? '' : ` ${error.status}`}`
      : 'NO_DT_ERROR'
  }
}

/** Proporción redondeada a un 5 %, para no revelar recuentos exactos. */
const share = (part: number, whole: number): string =>
  whole === 0 ? 'sin datos' : `${Math.round((part / whole) * 20) * 5} %`

/** Tramo de un tamaño, para no revelar recuentos exactos. */
const bucket = (count: number): string =>
  count === 0 ? '0' : count < 10 ? '1-9' : count <= 50 ? '10-50' : 'más de 50'

const nonIncreasing = (times: number[]): boolean =>
  times.every((time, index) => index === 0 || time <= (times[index - 1] ?? time))

const startTimes = (body: Raw): number[] =>
  ((body['problems'] as Raw[] | undefined) ?? []).map((p) => Number(p['startTime']))

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
    join('live-reports', 'problems-detail.json'),
    `${JSON.stringify(report, null, 2)}\n`
  )
})

describe.skipIf(live === null)('0.9.0: lista ordenada y detalle de Problems', () => {
  const sample: Raw[] = []

  it('sort=-startTime: los más recientes primero, también en la página 2', async () => {
    const first = (await get('/problems', {
      from: 'now-7d',
      pageSize: 5,
      sort: '-startTime'
    })) as Raw
    sample.push(...((first['problems'] as Raw[] | undefined) ?? []))
    const times = startTimes(first)
    report['sort=-startTime: página 1 ordenada'] = nonIncreasing(times)
    expect(nonIncreasing(times)).toBe(true)

    const key = first['nextPageKey']
    if (typeof key === 'string') {
      const second = (await get(DT_ENDPOINTS.problems.path, { nextPageKey: key })) as Raw
      const next = startTimes(second)
      report['sort=-startTime: página 2 (solo nextPageKey) sigue el orden'] =
        nonIncreasing(next) && (next[0] ?? 0) <= (times.at(-1) ?? Infinity)
    } else {
      report['sort=-startTime: página 2'] = 'una sola página'
    }
    report['sort con un campo no válido'] = await codeOf(
      get('/problems', { from: 'now-7d', pageSize: 1, sort: '-noExiste' })
    )
  })

  it('detalle de uno abierto y uno cerrado: forma y parseItems', async (ctx) => {
    // Más muestra para encontrar uno de cada estado, con una sola petición.
    const more = (await get('/problems', {
      from: 'now-7d',
      pageSize: 100,
      sort: '-startTime'
    })) as Raw
    sample.push(...((more['problems'] as Raw[] | undefined) ?? []))
    const open = sample.find((p) => p['status'] === 'OPEN')
    const closed = sample.find((p) => p['status'] === 'CLOSED')
    report['hay abierto y cerrado en 7 días'] = {
      abierto: open !== undefined,
      cerrado: closed !== undefined
    }
    const targets = [open, closed].filter((p): p is Raw => p !== undefined)
    if (targets.length === 0) {
      ctx.skip()
      return
    }
    for (const target of targets) {
      const label = target['status'] === 'OPEN' ? 'abierto' : 'cerrado'
      const id = String(target['problemId'])
      const raw = (await get(`/problems/${encodeURIComponent(id)}`, {
        fields: DETAIL_FIELDS
      })) as Raw
      const parsed = problemDetailSchema.safeParse(raw)
      report[`${label}: valida con problemDetailSchema`] = parsed.success
      expect(parsed.success).toBe(true)
      if (!parsed.success) continue
      const detail = toProblemDetail(parsed.data)
      report[`${label}: elementos descartados (parseItems)`] = detail.invalid
      report[`${label}: evidencias`] = bucket(detail.evidence.length)
      report[`${label}: tipos de evidencia`] = [
        ...new Set(detail.evidence.map((e) => e.evidenceType))
      ].sort()
      report[`${label}: comentarios`] = bucket(detail.comments.length)
      report[`${label}: id con "-" o "_" (encodeURIComponent)`] = /[-_]/.test(id)
      expect(detail.invalid).toBe(0)
    }
  })

  it('un problema con muchas evidencias, si lo hay', async () => {
    let found: { evidences: string; ms: number; invalid: number } | null = null
    for (const target of sample.slice(0, MAX_DETAILS)) {
      const started = Date.now()
      const raw = await get(`/problems/${encodeURIComponent(String(target['problemId']))}`, {
        fields: DETAIL_FIELDS
      })
      const parsed = problemDetailSchema.safeParse(raw)
      if (!parsed.success) continue
      const detail = toProblemDetail(parsed.data)
      if (detail.evidence.length > 50) {
        found = {
          evidences: bucket(detail.evidence.length),
          ms: Date.now() - started,
          invalid: detail.invalid
        }
        break
      }
    }
    report['con más de 50 evidencias'] = found ?? `ninguno entre los ${MAX_DETAILS} primeros`
  })

  it('0.9.1: forma de las evidencias por tipo y de los comentarios', async () => {
    // Abiertos y cerrados de la muestra, sin pasar de MAX_DETAILS detalles.
    const targets = [
      ...sample.filter((p) => p['status'] === 'OPEN').slice(0, MAX_DETAILS / 2),
      ...sample.filter((p) => p['status'] === 'CLOSED').slice(0, MAX_DETAILS / 2)
    ]
    const byType: Record<
      string,
      {
        endTime: Set<string>
        units: Set<string>
        conAntesYDespues: number
        conMetricId: number
        metricIdBuiltin: number
        conGroupingEntity: number
        causaRaiz: number
        conPropiedades: number
        total: number
      }
    > = {}
    let truncatedByApi = 0
    let withComments = 0
    let commentWithContext = 0
    let commentTotal = 0
    let target: string | null = null
    for (const problem of targets) {
      const id = String(problem['problemId'])
      const raw = (await get(`/problems/${encodeURIComponent(id)}`, {
        fields: DETAIL_FIELDS
      })) as Raw
      const parsed = problemDetailSchema.safeParse(raw)
      if (!parsed.success) continue
      const detail = toProblemDetail(parsed.data)
      if (detail.evidenceTotal !== null && detail.evidenceTotal > detail.evidence.length) {
        truncatedByApi += 1
      }
      for (const evidence of detail.evidence) {
        const entry = (byType[evidence.evidenceType] ??= {
          endTime: new Set(),
          units: new Set(),
          conAntesYDespues: 0,
          conMetricId: 0,
          metricIdBuiltin: 0,
          conGroupingEntity: 0,
          causaRaiz: 0,
          conPropiedades: 0,
          total: 0
        })
        entry.total += 1
        entry.endTime.add(
          evidence.endTime === null ? 'null' : evidence.endTime === -1 ? '-1' : 'número'
        )
        // Solo unidades estándar de la OpenAPI: una propia se cuenta, sin su nombre.
        if (evidence.unit !== null) {
          entry.units.add(STANDARD_UNITS.has(evidence.unit) ? evidence.unit : 'otra (no estándar)')
        }
        if (evidence.valueBefore !== null && evidence.valueAfter !== null)
          entry.conAntesYDespues += 1
        if (evidence.metricId !== null) {
          entry.conMetricId += 1
          if (evidence.metricId.startsWith('builtin:')) entry.metricIdBuiltin += 1
        }
        if (evidence.groupingEntity !== null) entry.conGroupingEntity += 1
        if (evidence.rootCauseRelevant) entry.causaRaiz += 1
        if (evidence.properties.length > 0) entry.conPropiedades += 1
      }
      if (detail.comments.length > 0) withComments += 1
      commentWithContext += detail.comments.filter((c) => c.context !== null).length
      commentTotal += detail.comments.length
      if (target === null && (detail.commentTotal ?? 0) >= 2) target = id
    }
    report['0.9.1: detalles pedidos'] = targets.length
    report['0.9.1: evidencias por tipo'] = Object.fromEntries(
      Object.entries(byType).map(([type, entry]) => [
        type,
        {
          evidencias: bucket(entry.total),
          endTime: [...entry.endTime].sort(),
          unidades: [...entry.units].sort(),
          'con antes y después': share(entry.conAntesYDespues, entry.total),
          'con metricId': share(entry.conMetricId, entry.total),
          'metricId builtin:': share(entry.metricIdBuiltin, entry.conMetricId),
          'con groupingEntity': share(entry.conGroupingEntity, entry.total),
          'causa raíz': share(entry.causaRaiz, entry.total),
          'con propiedades (EVENT)': share(entry.conPropiedades, entry.total)
        }
      ])
    )
    report['0.9.1: detalles con evidencias truncadas por la API'] = share(
      truncatedByApi,
      targets.length
    )
    report['0.9.1: detalles con comentarios'] = share(withComments, targets.length)
    report['0.9.1: comentarios con context'] = share(commentWithContext, commentTotal)

    // /problems/{id}/comments: la página 2 solo con nextPageKey, y qué pasa con fields.
    if (target === null) {
      report['comments: paginación'] = 'ningún problema con 2 comentarios o más en la muestra'
      // Aun así, la forma de la respuesta y qué pasa con fields, con uno sin comentarios.
      target = targets[0] === undefined ? null : String(targets[0]['problemId'])
      if (target === null) return
    }
    const path = `/problems/${encodeURIComponent(target)}/comments`
    const first = (await get(path, { pageSize: 1 })) as Raw
    report['comments: claves de la respuesta'] = Object.keys(first).sort()
    const key = first['nextPageKey']
    report['comments: página 2 solo con nextPageKey'] =
      typeof key === 'string' ? await codeOf(get(path, { nextPageKey: key })) : 'sin página 2'
    report['comments: con fields (no existe en la OpenAPI)'] = await codeOf(
      get(path, { pageSize: 1, fields: 'evidenceDetails' })
    )
  })
})

/** Unidades de MetricEvidence en la OpenAPI (APIv2.json): solo estas se nombran en el informe. */
const STANDARD_UNITS = new Set([
  'Ampere',
  'Billion',
  'Bit',
  'BitPerHour',
  'BitPerMinute',
  'BitPerSecond',
  'Byte',
  'BytePerHour',
  'BytePerMinute',
  'BytePerSecond',
  'Cores',
  'Count',
  'Day',
  'DecibelMilliWatt',
  'GibiByte',
  'GibiBytePerHour',
  'GibiBytePerMinute',
  'GibiBytePerSecond',
  'Giga',
  'GigaByte',
  'GigaBytePerHour',
  'GigaBytePerMinute',
  'GigaBytePerSecond',
  'Hertz',
  'Hour',
  'KibiByte',
  'KibiBytePerHour',
  'KibiBytePerMinute',
  'KibiBytePerSecond',
  'Kilo',
  'KiloByte',
  'KiloBytePerHour',
  'KiloBytePerMinute',
  'KiloBytePerSecond',
  'KiloMetrePerHour',
  'MSU',
  'MebiByte',
  'MebiBytePerHour',
  'MebiBytePerMinute',
  'MebiBytePerSecond',
  'Mega',
  'MegaByte',
  'MegaBytePerHour',
  'MegaBytePerMinute',
  'MegaBytePerSecond',
  'MetrePerHour',
  'MetrePerSecond',
  'MicroSecond',
  'MilliCores',
  'MilliSecond',
  'MilliSecondPerMinute',
  'Million',
  'Minute',
  'Month',
  'NanoSecond',
  'NanoSecondPerMinute',
  'NotApplicable',
  'PerHour',
  'PerMinute',
  'PerSecond',
  'Percent',
  'Pixel',
  'Promille',
  'Ratio',
  'Second',
  'State',
  'Trillion',
  'Unspecified',
  'Volt',
  'Watt',
  'Week',
  'Year'
])
