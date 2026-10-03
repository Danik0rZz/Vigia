import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { DT_ENDPOINTS } from '@shared/dt-endpoints'
import { createLiveClient } from '../../test/live-client'
import { loadLiveEnv } from '../../test/live-env'
import { DtError } from '../dynatrace/errors'
import { problemDetailSchema, problemSchema } from './problems'

/**
 * EXPLORACIÓN EN VIVO del bloque a (Problems), SOLO LECTURA y con pocas
 * peticiones (como mucho unas 15). Sirve para documentar en
 * docs/notas-api-v2.md cómo se comporta la API de verdad.
 *
 * El informe (live-reports/problems-explore.json, ignorado) guarda SOLO
 * comportamientos: proporciones (nunca recuentos absolutos), nombres de campo
 * de la API, valores de enum, códigos de error y tiempos. Nunca IDs, títulos,
 * nombres de entidades, etiquetas, zonas ni namespaces.
 */

const env = loadLiveEnv()
const live = env === null ? null : createLiveClient(env)
const report: Record<string, unknown> = {}
const timings: number[] = []

/** Campos de Problem según la OpenAPI (para detectar los que no declara). */
const OPENAPI_PROBLEM_FIELDS = new Set([
  'affectedEntities',
  'displayId',
  'endTime',
  'entityTags',
  'evidenceDetails',
  'impactAnalysis',
  'impactLevel',
  'impactedEntities',
  'linkedProblemInfo',
  'managementZones',
  'problemFilters',
  'problemId',
  'recentComments',
  'rootCauseEntity',
  'severityLevel',
  'startTime',
  'status',
  'title',
  'k8s.namespace.name'
])

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

const isEmpty = (value: unknown): boolean =>
  value === undefined ||
  value === null ||
  value === '' ||
  (Array.isArray(value) && value.length === 0)

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
    join('live-reports', 'problems-explore.json'),
    `${JSON.stringify(report, null, 2)}\n`
  )
})

describe.skipIf(live === null)('exploración: Problems (bloque a)', () => {
  const sample: Raw[] = []

  it('lista de 7 días: campos vacíos, desconocidos, enums y esquema', async () => {
    const body = (await get('/problems', { from: 'now-7d', pageSize: 100 })) as Raw
    const problems = (Array.isArray(body['problems']) ? body['problems'] : []) as Raw[]
    sample.push(...problems)
    report['lista: claves de la respuesta'] = Object.keys(body).sort()
    report['lista: totalCount es número'] = typeof body['totalCount'] === 'number'

    const fields = [...OPENAPI_PROBLEM_FIELDS]
    report['lista: campos vacíos o ausentes (proporción)'] = Object.fromEntries(
      fields.map((field) => [
        field,
        share(problems.filter((p) => isEmpty(p[field])).length, problems.length)
      ])
    )
    report['lista: campos que no declara la OpenAPI'] = [
      ...new Set(problems.flatMap((p) => Object.keys(p)))
    ]
      .filter((key) => !OPENAPI_PROBLEM_FIELDS.has(key))
      .sort()
    report['lista: endTime -1 en abiertos'] = share(
      problems.filter((p) => p['status'] === 'OPEN' && p['endTime'] === -1).length,
      problems.filter((p) => p['status'] === 'OPEN').length
    )
    for (const key of ['status', 'severityLevel', 'impactLevel'] as const) {
      report[`enum ${key}`] = [...new Set(problems.map((p) => String(p[key])))].sort()
    }
    report['enum entityId.type (afectadas)'] = [
      ...new Set(
        problems.flatMap((p) =>
          ((p['affectedEntities'] as Raw[] | undefined) ?? []).map((e) =>
            String((e['entityId'] as Raw | undefined)?.['type'])
          )
        )
      )
    ].sort()
    const invalid = problems.filter((p) => !problemSchema.safeParse(p).success).length
    report['lista: elementos que no validan con problemSchema'] = share(invalid, problems.length)
    expect(invalid).toBe(0)
  })

  it('pageSize y paginación: la 2.ª página con nextPageKey y fields', async (ctx) => {
    const first = (await get('/problems', {
      from: 'now-7d',
      pageSize: 2,
      fields: '+evidenceDetails'
    })) as Raw
    const key = first['nextPageKey']
    report['pageSize 2: elementos'] = Array.isArray(first['problems'])
      ? first['problems'].length
      : 'sin lista'
    if (typeof key !== 'string') {
      report['paginación'] = 'una sola página'
      ctx.skip()
      return
    }
    const second = (await get(DT_ENDPOINTS.problems.path, {
      nextPageKey: key,
      fields: '+evidenceDetails'
    })) as Raw
    const items = (second['problems'] as Raw[] | undefined) ?? []
    report['página 2: totalCount presente'] = typeof second['totalCount'] === 'number'
    report['página 2 con fields repetido: trae evidenceDetails'] = share(
      items.filter((p) => p['evidenceDetails'] !== undefined).length,
      items.length
    )
    const withoutFields = (await get(DT_ENDPOINTS.problems.path, { nextPageKey: key })) as Raw
    const plain = (withoutFields['problems'] as Raw[] | undefined) ?? []
    report['página 2 sin fields: trae evidenceDetails'] = share(
      plain.filter((p) => p['evidenceDetails'] !== undefined).length,
      plain.length
    )
    report['página 2 con otro parámetro (from) además de nextPageKey'] = await codeOf(
      get(DT_ENDPOINTS.problems.path, { nextPageKey: key, from: 'now-7d' })
    )
  })

  it('problemSelector y entitySelector', async () => {
    const cases: Record<string, Record<string, string | number>> = {
      'status("open")': { problemSelector: 'status("open")' },
      'severityLevel("ERROR","AVAILABILITY")': {
        problemSelector: 'severityLevel("ERROR","AVAILABILITY")'
      },
      'text("a")': { problemSelector: 'text("a")' },
      'selector mal formado': { problemSelector: 'status(open' },
      'entitySelector type("SERVICE")': { entitySelector: 'type("SERVICE")' }
    }
    for (const [name, query] of Object.entries(cases)) {
      report[`selector ${name}`] = await codeOf(
        get('/problems', { from: 'now-7d', pageSize: 1, ...query })
      )
    }
  })

  it('rangos largos', async () => {
    for (const from of ['now-30d', 'now-90d', 'now-1y']) {
      report[`rango ${from}`] = await codeOf(get('/problems', { from, pageSize: 1 }))
    }
  })

  it('detalle con fields: partes presentes y vacías', async (ctx) => {
    const target = sample[0]
    if (target === undefined) {
      report['detalle'] = 'sin problemas en 7 días'
      ctx.skip()
      return
    }
    const detail = (await get(`/problems/${encodeURIComponent(String(target['problemId']))}`, {
      fields: 'evidenceDetails,impactAnalysis,recentComments'
    })) as Raw
    report['detalle: claves'] = Object.keys(detail).sort()
    report['detalle: valida con problemDetailSchema'] =
      problemDetailSchema.safeParse(detail).success
    report['detalle: tipos de evidencia'] = [
      ...new Set(
        (
          ((detail['evidenceDetails'] as Raw | undefined)?.['details'] as Raw[] | undefined) ?? []
        ).map((item) => String(item['evidenceType']))
      )
    ].sort()
    report['detalle: claves de un impacto'] = [
      ...new Set(
        (
          ((detail['impactAnalysis'] as Raw | undefined)?.['impacts'] as Raw[] | undefined) ?? []
        ).flatMap((item) => Object.keys(item))
      )
    ].sort()
    report['detalle: comentarios presentes'] = !isEmpty(
      (detail['recentComments'] as Raw | undefined)?.['comments']
    )
    report['detalle: id inexistente'] = await codeOf(
      get('/problems/0000000000000000000_0000000000000', {})
    )
  })
})
