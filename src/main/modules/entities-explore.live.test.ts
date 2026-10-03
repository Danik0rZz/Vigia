import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, it } from 'vitest'
import { z } from 'zod'
import { DT_ENDPOINTS } from '@shared/dt-endpoints'
import { createLiveClient } from '../../test/live-client'
import { loadLiveEnv } from '../../test/live-env'
import { DtError } from '../dynatrace/errors'

/**
 * EXPLORACIÓN EN VIVO del bloque b (Entities y entityTypes), SOLO LECTURA y
 * con unas 15 peticiones como mucho.
 *
 * El informe (live-reports/entities-explore.json, ignorado) guarda solo
 * comportamientos: nombres de campo de la API, proporciones redondeadas,
 * códigos de error y tiempos. Los tipos personalizados o de extensión (con ":"
 * o fuera del patrón de los estándar) solo se CUENTAN, nunca se nombran. Nunca
 * IDs, nombres de entidades, etiquetas ni valores de propiedades.
 */

const env = loadLiveEnv()
const live = env === null ? null : createLiveClient(env)
const report: Record<string, unknown> = {}
const timings: number[] = []

/** Tipos estándar que se exploran (si existen en el tenant). */
const SAMPLE_TYPES = ['SERVICE', 'HOST', 'PROCESS_GROUP', 'APPLICATION', 'KUBERNETES_CLUSTER']
const FIELDS = '+properties,+tags,+managementZones,+fromRelationships,+toRelationships'

/** Un tipo estándar: mayúsculas, dígitos y "_" (los de extensión llevan ":" o minúsculas). */
const isStandardType = (type: string): boolean => /^[A-Z][A-Z0-9_]*$/.test(type)

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

const isEmpty = (value: unknown): boolean =>
  value === undefined ||
  value === null ||
  value === '' ||
  (Array.isArray(value) && value.length === 0) ||
  (typeof value === 'object' && value !== null && Object.keys(value).length === 0)

const keysOf = (value: unknown): string[] =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value) : []

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
    join('live-reports', 'entities-explore.json'),
    `${JSON.stringify(report, null, 2)}\n`
  )
})

describe.skipIf(live === null)('exploración: Entities y entityTypes (bloque b)', () => {
  const available = new Set<string>()

  it('entityTypes: forma, paginación y tipos personalizados (solo contados)', async () => {
    const first = (await get(DT_ENDPOINTS.entityTypes.path, { pageSize: 500 })) as Raw
    const types = (Array.isArray(first['types']) ? first['types'] : []) as Raw[]
    report['entityTypes: claves de la respuesta'] = Object.keys(first).sort()
    report['entityTypes: claves de un tipo'] = [...new Set(types.flatMap(keysOf))].sort()
    report['entityTypes: hay nextPageKey con pageSize 500'] =
      typeof first['nextPageKey'] === 'string'
    const names = types.map((type) => String(type['type']))
    for (const name of names) if (isStandardType(name)) available.add(name)
    report['entityTypes: personalizados o de extensión (proporción)'] = share(
      names.filter((name) => !isStandardType(name)).length,
      names.length
    )
    report['entityTypes: tipos de muestra presentes'] = SAMPLE_TYPES.filter((t) => available.has(t))
    if (typeof first['nextPageKey'] === 'string') {
      report['entityTypes: página 2 solo con nextPageKey'] = await codeOf(
        get(DT_ENDPOINTS.entityTypes.path, { nextPageKey: first['nextPageKey'] })
      )
    }
  })

  it('entities por tipo estándar: campos, propiedades y relaciones', async () => {
    for (const type of SAMPLE_TYPES.filter((t) => available.has(t))) {
      const body = (await get(DT_ENDPOINTS.entities.path, {
        entitySelector: `type("${type}")`,
        from: 'now-3d',
        pageSize: 50,
        fields: FIELDS
      })) as Raw
      const entities = (Array.isArray(body['entities']) ? body['entities'] : []) as Raw[]
      report[`${type}: claves de la respuesta`] = Object.keys(body).sort()
      report[`${type}: claves de una entidad`] = [...new Set(entities.flatMap(keysOf))].sort()
      report[`${type}: campos vacíos (proporción)`] = Object.fromEntries(
        [
          'displayName',
          'properties',
          'tags',
          'managementZones',
          'fromRelationships',
          'toRelationships'
        ].map((field) => [
          field,
          share(entities.filter((e) => isEmpty(e[field])).length, entities.length)
        ])
      )
      // Claves de propiedades y relaciones: son de la API para los tipos estándar.
      report[`${type}: claves de properties`] = [
        ...new Set(entities.flatMap((e) => keysOf(e['properties'])))
      ].sort()
      report[`${type}: relaciones (from)`] = [
        ...new Set(entities.flatMap((e) => keysOf(e['fromRelationships'])))
      ].sort()
      report[`${type}: relaciones (to)`] = [
        ...new Set(entities.flatMap((e) => keysOf(e['toRelationships'])))
      ].sort()
      report[`${type}: hay más páginas`] = typeof body['nextPageKey'] === 'string'
    }
  })

  it('paginación de /entities: con fields en la página 2 → error; solo nextPageKey → ok', async (ctx) => {
    const type = SAMPLE_TYPES.find((t) => available.has(t))
    if (type === undefined) {
      ctx.skip()
      return
    }
    const first = (await get(DT_ENDPOINTS.entities.path, {
      entitySelector: `type("${type}")`,
      from: 'now-3d',
      pageSize: 1,
      fields: '+properties'
    })) as Raw
    const key = first['nextPageKey']
    if (typeof key !== 'string') {
      report['paginación'] = 'una sola página'
      ctx.skip()
      return
    }
    report['página 2 solo con nextPageKey'] = await codeOf(
      get(DT_ENDPOINTS.entities.path, { nextPageKey: key })
    )
    report['página 2 con nextPageKey y fields'] = await codeOf(
      get(DT_ENDPOINTS.entities.path, { nextPageKey: key, fields: '+properties' })
    )
  })

  it('límites: sin entitySelector y con un selector mal formado', async () => {
    report['sin entitySelector'] = await codeOf(
      get(DT_ENDPOINTS.entities.path, { from: 'now-3d', pageSize: 1 })
    )
    report['entitySelector mal formado'] = await codeOf(
      get(DT_ENDPOINTS.entities.path, {
        entitySelector: 'type(SERVICE',
        from: 'now-3d',
        pageSize: 1
      })
    )
  })
})
