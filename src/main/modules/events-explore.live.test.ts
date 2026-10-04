import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, it } from 'vitest'
import { z } from 'zod'
import { DT_ENDPOINTS } from '@shared/dt-endpoints'
import { createLiveClient } from '../../test/live-client'
import { loadLiveEnv } from '../../test/live-env'
import { DtError } from '../dynatrace/errors'

/**
 * EXPLORACIÓN EN VIVO del bloque e (Events y eventTypes), SOLO LECTURA, con
 * unas 8 peticiones.
 *
 * El informe (live-reports/events-explore.json, ignorado) guarda solo
 * comportamientos: claves y tipos de los campos, valores de enum de la API,
 * tipos de evento ESTÁNDAR (los personalizados solo se cuentan), proporciones
 * redondeadas y códigos. Nunca títulos, propiedades (ni sus claves),
 * entidades, ids ni management zones de los eventos.
 */

const env = loadLiveEnv()
const live = env === null ? null : createLiveClient(env)
const report: Record<string, unknown> = {}
const timings: number[] = []

type Raw = Record<string, unknown>

/** Tipo estándar de Dynatrace: mayúsculas, dígitos y "_" (los propios no lo cumplen). */
const isStandardType = (type: string): boolean => /^[A-Z][A-Z0-9_]*$/.test(type)

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
  writeFileSync(join('live-reports', 'events-explore.json'), `${JSON.stringify(report, null, 2)}\n`)
})

describe.skipIf(live === null)('exploración: Events (bloque e)', () => {
  const events: Raw[] = []

  it('eventTypes: forma y tipos estándar (los propios, solo contados)', async () => {
    const body = (await get(DT_ENDPOINTS.eventTypes.path, { pageSize: 500 })) as Raw
    const types = (Array.isArray(body['eventTypeInfos']) ? body['eventTypeInfos'] : []) as Raw[]
    report['eventTypes: claves de la respuesta'] = Object.keys(body).sort()
    report['eventTypes: claves de un tipo'] = [
      ...new Set(types.flatMap((type) => Object.keys(type)))
    ].sort()
    const names = types.map((type) => String(type['type']))
    report['eventTypes: estándar'] = names.filter(isStandardType).sort()
    report['eventTypes: personalizados (proporción)'] = share(
      names.filter((name) => !isStandardType(name)).length,
      names.length
    )
  })

  it('events de 24 h: forma, enums y campos vacíos; paginación', async () => {
    const body = (await get(DT_ENDPOINTS.events.path, { from: 'now-24h', pageSize: 100 })) as Raw
    events.push(...((Array.isArray(body['events']) ? body['events'] : []) as Raw[]))
    report['events: claves de la respuesta'] = Object.keys(body).sort()
    const fields = [...new Set(events.flatMap((event) => Object.keys(event)))].sort()
    report['events: campos y tipos'] = Object.fromEntries(
      fields.map((field) => [
        field,
        [...new Set(events.map((event) => typeOf(event[field])))].sort().join('|')
      ])
    )
    report['events: status'] = [...new Set(events.map((event) => String(event['status'])))].sort()
    const types = events.map((event) => String(event['eventType']))
    report['events: eventType estándar presentes'] = [
      ...new Set(types.filter(isStandardType))
    ].sort()
    report['events: eventType personalizados (proporción)'] = share(
      types.filter((type) => !isStandardType(type)).length,
      types.length
    )
    report['events: con correlationId'] = share(
      events.filter((event) => typeof event['correlationId'] === 'string').length,
      events.length
    )
    report['events: endTime -1 (abiertos)'] = share(
      events.filter((event) => event['endTime'] === -1).length,
      events.length
    )
    report['events: forma de entityId'] = [
      ...new Set(
        events.map((event) => {
          const entity = event['entityId']
          return entity !== null && typeof entity === 'object'
            ? `{${Object.keys(entity).sort().join(',')}}`
            : typeOf(entity)
        })
      )
    ].sort()
    report['events: forma de properties'] = [
      ...new Set(
        events.flatMap((event) =>
          Array.isArray(event['properties'])
            ? (event['properties'] as Raw[]).map((p) => `{${Object.keys(p).sort().join(',')}}`)
            : [typeOf(event['properties'])]
        )
      )
    ].sort()
    const key = body['nextPageKey']
    if (typeof key === 'string') {
      report['página 2 solo con nextPageKey'] = await codeOf(
        get(DT_ENDPOINTS.events.path, { nextPageKey: key })
      )
      report['página 2 con nextPageKey y from'] = await codeOf(
        get(DT_ENDPOINTS.events.path, { nextPageKey: key, from: 'now-24h' })
      )
    } else {
      report['paginación'] = 'no comprobada en vivo'
    }
  })

  it('relación con los problemas: ¿correlationId es el problemId?', async (ctx) => {
    const correlated = events.filter((event) => typeof event['correlationId'] === 'string')
    if (correlated.length === 0) {
      report['relación con problemas'] = 'sin eventos con correlationId'
      ctx.skip()
      return
    }
    const problems = (await get(DT_ENDPOINTS.problems.path, {
      from: 'now-24h',
      pageSize: 500
    })) as Raw
    const ids = new Set(
      ((Array.isArray(problems['problems']) ? problems['problems'] : []) as Raw[]).map((p) =>
        String(p['problemId'])
      )
    )
    report['correlationId que es un problemId de las mismas 24 h'] = share(
      correlated.filter((event) => ids.has(String(event['correlationId']))).length,
      correlated.length
    )
  })

  // El máximo de pageSize (1000 según la OpenAPI) no se prueba: test:live no pasa de 500.
  it('límites: eventSelector mal formado', async () => {
    report['eventSelector mal formado'] = await codeOf(
      get(DT_ENDPOINTS.events.path, { from: 'now-2h', pageSize: 1, eventSelector: 'status(OPEN' })
    )
  })
})
