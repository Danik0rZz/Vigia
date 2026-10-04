import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, it } from 'vitest'
import { z } from 'zod'
import { DT_ENDPOINTS } from '@shared/dt-endpoints'
import { createLiveClient } from '../../test/live-client'
import { loadLiveEnv } from '../../test/live-env'
import { DtError } from '../dynatrace/errors'
import { sloSchema } from './slos'

/**
 * EXPLORACIÓN EN VIVO del bloque d (SLOs), SOLO LECTURA. evaluate=true es caro:
 * solo dos veces y con pageSize 5; lo demás, con evaluate=false. timeFrame,
 * from y to siempre explícitos.
 *
 * Los SLO son del cliente: el informe (live-reports/slos-explore.json,
 * ignorado) guarda solo la forma (campos y tipos), valores de enum de la API
 * (status, evaluationType), proporciones redondeadas y códigos de error.
 * Nunca nombres, ids, selectores, expresiones de métricas ni el texto de
 * `error` (solo si es "NONE" o no).
 */

const env = loadLiveEnv()
const live = env === null ? null : createLiveClient(env)
const report: Record<string, unknown> = {}
const timings: number[] = []

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

const share = (part: number, whole: number): string =>
  whole === 0 ? 'sin datos' : `${Math.round((part / whole) * 20) * 5} %`

function typeOf(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

/** Forma de una lista de SLO sin ningún valor del cliente. */
function shapeOf(slos: Raw[]): Record<string, unknown> {
  const fields = [...new Set(slos.flatMap((slo) => Object.keys(slo)))].sort()
  return {
    campos: Object.fromEntries(
      fields.map((field) => [
        field,
        [...new Set(slos.map((slo) => typeOf(slo[field])))].sort().join('|')
      ])
    ),
    status: [...new Set(slos.map((slo) => String(slo['status'])))].sort(),
    evaluationType: [...new Set(slos.map((slo) => String(slo['evaluationType'])))].sort(),
    'evaluatedPercentage = -1': share(
      slos.filter((slo) => slo['evaluatedPercentage'] === -1).length,
      slos.length
    ),
    'errorBudget = -1': share(slos.filter((slo) => slo['errorBudget'] === -1).length, slos.length),
    'error = NONE': share(slos.filter((slo) => slo['error'] === 'NONE').length, slos.length),
    enabled: share(slos.filter((slo) => slo['enabled'] === true).length, slos.length),
    'no valida con sloSchema': share(
      slos.filter((slo) => !sloSchema.safeParse(slo).success).length,
      slos.length
    )
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
  writeFileSync(join('live-reports', 'slos-explore.json'), `${JSON.stringify(report, null, 2)}\n`)
})

const SLO = DT_ENDPOINTS.slo.path

describe.skipIf(live === null)('exploración: SLOs (bloque d)', () => {
  let firstId: string | null = null

  it('lista sin evaluar: forma, paginación y límites', async () => {
    const body = (await get(SLO, {
      evaluate: 'false',
      pageSize: 10,
      timeFrame: 'CURRENT',
      from: 'now-2w',
      to: 'now'
    })) as Raw
    const slos = (Array.isArray(body['slo']) ? body['slo'] : []) as Raw[]
    firstId = typeof slos[0]?.['id'] === 'string' ? (slos[0]['id'] as string) : null
    report['sin evaluar: claves de la respuesta'] = Object.keys(body).sort()
    report['sin evaluar: forma'] = shapeOf(slos)
    const key = body['nextPageKey']
    if (typeof key === 'string') {
      report['página 2 solo con nextPageKey'] = await codeOf(get(SLO, { nextPageKey: key }))
      report['página 2 con nextPageKey y evaluate'] = await codeOf(
        get(SLO, { nextPageKey: key, evaluate: 'false' })
      )
    } else {
      report['paginación'] = 'una sola página (sin comprobar en vivo)'
    }
  })

  it('evaluada (dos veces, pageSize 5): CURRENT y un rango de 7 días', async () => {
    const current = (await get(SLO, {
      evaluate: 'true',
      pageSize: 5,
      timeFrame: 'CURRENT',
      from: 'now-2w',
      to: 'now'
    })) as Raw
    report['evaluada CURRENT: forma'] = shapeOf(
      (Array.isArray(current['slo']) ? current['slo'] : []) as Raw[]
    )
    const gtf = (await get(SLO, {
      evaluate: 'true',
      pageSize: 5,
      timeFrame: 'GTF',
      from: 'now-7d',
      to: 'now'
    })) as Raw
    report['evaluada GTF 7d: forma'] = shapeOf(
      (Array.isArray(gtf['slo']) ? gtf['slo'] : []) as Raw[]
    )
  })

  it('límites: evaluate con pageSize 26 y timeFrame no válido', async () => {
    report['evaluate=true con pageSize 26'] = await codeOf(
      get(SLO, { evaluate: 'true', pageSize: 26, timeFrame: 'CURRENT', from: 'now-2w', to: 'now' })
    )
    report['timeFrame no válido'] = await codeOf(
      get(SLO, { evaluate: 'false', pageSize: 1, timeFrame: 'XYZ', from: 'now-2w', to: 'now' })
    )
  })

  it('GET /slo/{id}: forma del detalle', async (ctx) => {
    if (firstId === null) {
      report['detalle'] = 'sin SLO'
      ctx.skip()
      return
    }
    const detail = (await get(`${SLO}/${encodeURIComponent(firstId)}`, {
      timeFrame: 'GTF',
      from: 'now-7d',
      to: 'now'
    })) as Raw
    report['detalle: forma'] = shapeOf([detail])
  })
})
