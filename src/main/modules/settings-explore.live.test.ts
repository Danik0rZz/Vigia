import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, it } from 'vitest'
import { z } from 'zod'
import { createLiveClient } from '../../test/live-client'
import { loadLiveEnv } from '../../test/live-env'
import { DtError } from '../dynatrace/errors'

/**
 * EXPLORACIÓN EN VIVO del bloque f (Settings 2.0), SOLO GET a /settings/schemas
 * y /settings/objects, con unas 6 peticiones.
 *
 * Los objetos pueden llevar valores SENSIBLES (webhooks, credenciales,
 * cabeceras, emails):
 * - casi todas las peticiones piden fields=objectId,schemaId,scope (sin value);
 * - la única que trae `value` (pageSize 1, un esquema builtin) lo convierte en
 *   el acto en su tipo y sus claves de primer nivel y no lo guarda;
 * - el informe (live-reports/settings-explore.json) solo lleva booleanos,
 *   tipos, schemaIds builtin:* y proporciones. Los esquemas de apps y
 *   extensiones solo se cuentan.
 */

const env = loadLiveEnv()
const live = env === null ? null : createLiveClient(env)
const report: Record<string, unknown> = {}
const timings: number[] = []

type Raw = Record<string, unknown>

const isBuiltin = (schemaId: string): boolean => schemaId.startsWith('builtin:')
/**
 * Candidatos de muestra para ver la forma de `value`: estándar y poco
 * sensibles (nada de credenciales, webhooks ni notificaciones). Se usa el
 * primero que exista en el tenant.
 */
const SAMPLE_CANDIDATES = [
  'builtin:anomaly-detection.services',
  'builtin:anomaly-detection.infrastructure-hosts',
  'builtin:host.monitoring',
  'builtin:management-zones',
  'builtin:health-experience.cloud-alert'
]
let SAMPLE_SCHEMA = SAMPLE_CANDIDATES[0] ?? ''
const SAFE_FIELDS = 'objectId,schemaId,scope'

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
    join('live-reports', 'settings-explore.json'),
    `${JSON.stringify(report, null, 2)}\n`
  )
})

describe.skipIf(live === null)('exploración: Settings 2.0 (bloque f), solo lectura', () => {
  let sampleAvailable = false

  it('schemas: forma; builtin nombrables, el resto solo contado', async () => {
    const body = (await get('/settings/schemas', {})) as Raw
    const items = (Array.isArray(body['items']) ? body['items'] : []) as Raw[]
    report['schemas: claves de la respuesta'] = Object.keys(body).sort()
    report['schemas: claves de un esquema'] = [
      ...new Set(items.flatMap((item) => Object.keys(item)))
    ].sort()
    const ids = items.map((item) => String(item['schemaId']))
    report['schemas: la lista llega completa (items = totalCount)'] =
      items.length === body['totalCount']
    // Los builtin:* son estándar y se pueden nombrar: una muestra para elegir esquema.
    report['schemas: muestra de builtin'] = ids.filter(isBuiltin).sort().slice(0, 25)
    report['schemas: no builtin (proporción)'] = share(
      ids.filter((id) => !isBuiltin(id)).length,
      ids.length
    )
    const sample = SAMPLE_CANDIDATES.find((candidate) => ids.includes(candidate))
    sampleAvailable = sample !== undefined
    if (sample !== undefined) SAMPLE_SCHEMA = sample
    report['schemas: esquema de muestra'] = sample ?? 'ninguno de los candidatos'
  })

  it('objects sin value: forma, paginación y límites', async () => {
    report['objects sin schemaIds ni scopes'] = await codeOf(
      get('/settings/objects', { fields: SAFE_FIELDS, pageSize: 1 })
    )
    if (!sampleAvailable) return
    const body = (await get('/settings/objects', {
      schemaIds: SAMPLE_SCHEMA,
      fields: SAFE_FIELDS,
      pageSize: 1
    })) as Raw
    const items = (Array.isArray(body['items']) ? body['items'] : []) as Raw[]
    report['objects: claves de la respuesta'] = Object.keys(body).sort()
    report['objects con fields=objectId,schemaId,scope: claves de un objeto'] = [
      ...new Set(items.flatMap((item) => Object.keys(item)))
    ].sort()
    report['objects: trae value sin pedirlo'] = items.some((item) => 'value' in item)
    const key = body['nextPageKey']
    if (typeof key === 'string') {
      report['página 2 solo con nextPageKey'] = await codeOf(
        get('/settings/objects', { nextPageKey: key })
      )
      report['página 2 con nextPageKey y fields'] = await codeOf(
        get('/settings/objects', { nextPageKey: key, fields: SAFE_FIELDS })
      )
    } else {
      report['paginación'] = 'no comprobada en vivo'
    }
  })

  it('forma de value (un objeto, sin guardar el valor)', async (ctx) => {
    if (!sampleAvailable) {
      ctx.skip()
      return
    }
    const body = (await get('/settings/objects', {
      schemaIds: SAMPLE_SCHEMA,
      fields: 'objectId,value',
      pageSize: 1
    })) as Raw
    // En el acto: solo el tipo de `value` y si es un objeto. Ni el valor ni sus claves.
    const first = ((Array.isArray(body['items']) ? body['items'] : []) as Raw[])[0]
    report['value: tipo de nivel superior'] =
      first === undefined ? 'sin objetos' : typeOf(first['value'])
  })
})
