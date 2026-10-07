import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { DT_ENDPOINTS } from '@shared/dt-endpoints'
import { createLiveClient, LIVE_ENV_ID } from '../../test/live-client'
import { loadLiveEnv } from '../../test/live-env'
import { DtError } from '../dynatrace/errors'

/**
 * PRUEBA EN VIVO de la ficha 0007 (CA5), SOLO LECTURA y con pocas peticiones
 * (unas 15): ¿`problemSelector=affectedEntities("<id>"),status("open"|"closed")`
 * da 200?, ¿llega `totalCount` con `pageSize=1`? y ¿coincide con contar la
 * lista completa con el mismo selector y con filtrar a mano la lista del rango?
 *
 * Ficha 0010 (CA7): ¿la lista con `affectedEntities("<id>")`, el rango, `pageSize=100` y
 * `sort=-startTime` da 200?, ¿los `startTime`/`endTime` cuadran con el estado (abiertos con
 * `-1`, cerrados con un fin no anterior al inicio)? y ¿llegan ordenados?
 *
 * El informe (live-reports/problems-entity-count.json, ignorado) guarda SOLO
 * comportamientos: códigos, tipos de entidad estándar y si las cosas coinciden
 * (sí/no). Nunca ids, nombres, títulos ni recuentos.
 */

const env = loadLiveEnv()
const live = env === null ? null : createLiveClient(env)
const report: Record<string, unknown> = {}
/** Ids y nombres vistos: el informe no puede contener ninguno. */
const observed = new Set<string>()

/** Formato de id que acepta el canal (CA1 de la ficha). */
const ENTITY_ID = /^[A-Z][A-Z0-9_]*-[0-9A-F]{16}$/
const RANGE = 'now-7d'
const STATUSES = ['open', 'closed'] as const
/** Entidades de la muestra (una por tipo, hasta este número). */
const MAX_SAMPLE = 3

const listItemSchema = z.looseObject({
  problemId: z.string(),
  displayId: z.string().optional(),
  title: z.string().optional(),
  status: z.string(),
  affectedEntities: z
    .array(
      z.looseObject({
        entityId: z.looseObject({ id: z.string(), type: z.string() }),
        name: z.string().optional()
      })
    )
    .optional()
})
type ListItem = z.output<typeof listItemSchema>

/** Ficha 0010: los campos de la franja, tal como los define el esquema `Problem` de la OpenAPI. */
const bandItemSchema = z.looseObject({
  problemId: z.string(),
  displayId: z.string(),
  title: z.string(),
  status: z.string(),
  severityLevel: z.string(),
  startTime: z.number(),
  endTime: z.number().nullable(),
  affectedEntities: z
    .array(z.looseObject({ entityId: z.looseObject({ id: z.string() }) }))
    .optional()
})

/** Código del error, sin su mensaje (puede llevar el host del tenant). */
function codeOf(error: unknown): string {
  return error instanceof DtError
    ? `${error.code}${error.status === undefined ? '' : ` ${error.status}`}`
    : 'NO_DT_ERROR'
}

function client(): NonNullable<typeof live>['client'] {
  if (live === null) throw new Error('sin .env.live.local')
  return live.client
}

const selectorFor = (id: string, status: (typeof STATUSES)[number]): string =>
  `affectedEntities("${id}"),status("${status}")`

afterAll(() => {
  if (live === null || env === null) return
  report['tokenEnLog'] = live.logged.some((line) => line.includes(env.token))
  report['peticiones'] = live.stats.requests
  mkdirSync('live-reports', { recursive: true })
  writeFileSync(
    join('live-reports', 'problems-entity-count.json'),
    `${JSON.stringify(report, null, 2)}\n`
  )
})

describe.skipIf(live === null)('en vivo (0007): problemas de una entidad', () => {
  const sample: { id: string; type: string }[] = []
  let list: ListItem[] = []
  let listComplete = false

  it('muestra: entidades afectadas por problemas en 7 días', async (ctx) => {
    const page = await client().paginate({
      envId: LIVE_ENV_ID,
      api: 'classic',
      endpoint: DT_ENDPOINTS.problems,
      query: { from: RANGE, pageSize: 500 },
      schema: listItemSchema,
      maxPages: 2
    })
    list = page.items
    listComplete = !page.truncated && page.invalid === 0
    report['lista 7d: completa'] = listComplete
    for (const problem of list) {
      observed.add(problem.problemId)
      if (problem.displayId !== undefined) observed.add(problem.displayId)
      if (problem.title !== undefined) observed.add(problem.title)
      for (const entity of problem.affectedEntities ?? []) {
        observed.add(entity.entityId.id)
        if (entity.name !== undefined) observed.add(entity.name)
      }
    }
    // Una entidad por tipo, empezando por SERVICE (la página de la 0008).
    const candidates = list
      .flatMap((problem) => problem.affectedEntities ?? [])
      .map((entity) => entity.entityId)
      .filter((entity) => ENTITY_ID.test(entity.id))
      .sort((a, b) => Number(b.type === 'SERVICE') - Number(a.type === 'SERVICE'))
    for (const entity of candidates) {
      if (sample.length >= MAX_SAMPLE) break
      if (sample.some((s) => s.type === entity.type)) continue
      sample.push({ id: entity.id, type: entity.type })
    }
    report['muestra: tipos'] = sample.map((s) => s.type)
    report['afectadas con id que no cumple el formato del canal'] = list.some((problem) =>
      (problem.affectedEntities ?? []).some((entity) => !ENTITY_ID.test(entity.entityId.id))
    )
    if (sample.length === 0) {
      report['muestra'] = 'sin entidades afectadas en 7 días'
      ctx.skip()
    }
  })

  it('affectedEntities + status: 200, totalCount con pageSize=1 y coincide con la lista', async (ctx) => {
    if (sample.length === 0) {
      ctx.skip()
      return
    }
    const results: Record<string, unknown>[] = []
    for (const [index, entity] of sample.entries()) {
      for (const status of STATUSES) {
        const row: Record<string, unknown> = { muestra: index, tipo: entity.type, status }
        const query = { from: RANGE, problemSelector: selectorFor(entity.id, status) }
        let totalCount: number | null = null
        try {
          const one = await client().dtRequest({
            envId: LIVE_ENV_ID,
            api: 'classic',
            path: DT_ENDPOINTS.problems.path,
            query: { ...query, pageSize: 1 },
            schema: z.looseObject({ totalCount: z.unknown(), problems: z.array(z.unknown()) })
          })
          row['pageSize=1'] = 'ok'
          row['totalCount llega'] = typeof one.totalCount === 'number'
          row['pageSize=1: como mucho 1 elemento'] = one.problems.length <= 1
          totalCount = typeof one.totalCount === 'number' ? one.totalCount : null
        } catch (error) {
          row['pageSize=1'] = codeOf(error)
        }
        try {
          const all = await client().paginate({
            envId: LIVE_ENV_ID,
            api: 'classic',
            endpoint: DT_ENDPOINTS.problems,
            query: { ...query, pageSize: 500 },
            schema: listItemSchema,
            maxPages: 4
          })
          row['lista con el selector'] = all.truncated ? 'truncada' : 'ok'
          row['todos con el estado pedido'] = all.items.every(
            (p) => p.status.toLowerCase() === status
          )
          row['todos afectan a la entidad'] = all.items.every((p) =>
            (p.affectedEntities ?? []).some((e) => e.entityId.id === entity.id)
          )
          if (totalCount !== null && !all.truncated) {
            row['totalCount = elementos de la lista'] = totalCount === all.items.length
          }
          if (totalCount !== null && listComplete) {
            const local = list.filter(
              (p) =>
                p.status.toLowerCase() === status &&
                (p.affectedEntities ?? []).some((e) => e.entityId.id === entity.id)
            ).length
            row['totalCount = filtrar a mano la lista de 7 días'] = totalCount === local
          }
        } catch (error) {
          row['lista con el selector'] = codeOf(error)
        }
        results.push(row)
      }
    }
    report['affectedEntities + status'] = results
    for (const row of results) {
      expect(row['pageSize=1'], `pageSize=1 ${String(row['status'])}`).toBe('ok')
      expect(row['totalCount llega'], `totalCount ${String(row['status'])}`).toBe(true)
    }
  })

  it('CA7 (0010): la lista con affectedEntities y rango (pageSize=100, sort=-startTime) da 200 y las fechas cuadran con el estado', async (ctx) => {
    if (sample.length === 0) {
      ctx.skip()
      return
    }
    const results: Record<string, unknown>[] = []
    for (const [index, entity] of sample.entries()) {
      const row: Record<string, unknown> = { muestra: index, tipo: entity.type }
      try {
        const page = await client().dtRequest({
          envId: LIVE_ENV_ID,
          api: 'classic',
          path: DT_ENDPOINTS.problems.path,
          query: {
            from: RANGE,
            problemSelector: `affectedEntities("${entity.id}")`,
            pageSize: 100,
            sort: '-startTime'
          },
          schema: z.looseObject({
            totalCount: z.unknown(),
            problems: z.array(z.unknown())
          })
        })
        row['lista'] = 'ok'
        row['totalCount llega'] = typeof page.totalCount === 'number'
        row['recortada (totalCount > recibidos)'] =
          typeof page.totalCount === 'number' && page.totalCount > page.problems.length
        const items = page.problems.map((raw) => bandItemSchema.safeParse(raw))
        row['elementos que no cumplen el esquema'] = items.filter((item) => !item.success).length
        const valid = items.flatMap((item) => (item.success ? [item.data] : []))
        for (const problem of valid) {
          observed.add(problem.problemId)
          observed.add(problem.displayId)
          observed.add(problem.title)
        }
        const open = valid.filter((p) => p.status === 'OPEN')
        const closed = valid.filter((p) => p.status === 'CLOSED')
        row['hay abiertos'] = open.length > 0
        row['hay cerrados'] = closed.length > 0
        row['estados conocidos (OPEN/CLOSED)'] = valid.every(
          (p) => p.status === 'OPEN' || p.status === 'CLOSED'
        )
        row['abiertos: endTime -1'] = open.every((p) => p.endTime === -1)
        row['abiertos: algún endTime null'] = open.some((p) => p.endTime === null)
        row['abiertos: sin fin (-1 o null)'] = open.every(
          (p) => p.endTime === -1 || p.endTime === null
        )
        row['cerrados: endTime >= startTime'] = closed.every(
          (p) => typeof p.endTime === 'number' && p.endTime !== -1 && p.endTime >= p.startTime
        )
        row['startTime en milisegundos'] = valid.every((p) => p.startTime > 1e12)
        row['orden: startTime de más nuevo a más antiguo'] = valid.every(
          (p, i) => i === 0 || (valid[i - 1]?.startTime ?? 0) >= p.startTime
        )
        row['todos afectan a la entidad'] = valid.every((p) =>
          (p.affectedEntities ?? []).some((e) => e.entityId.id === entity.id)
        )
      } catch (error) {
        row['lista'] = codeOf(error)
      }
      results.push(row)
    }
    report['lista de una entidad (0010)'] = results
    for (const row of results) {
      expect(row['lista'], `lista de la muestra ${String(row['muestra'])}`).toBe('ok')
      expect(row['totalCount llega'], 'totalCount').toBe(true)
      expect(row['abiertos: sin fin (-1 o null)'], 'abiertos sin fin').toBe(true)
      expect(row['cerrados: endTime >= startTime'], 'cerrados con fin').toBe(true)
    }
  })

  it('CA5 (0007) y CA7 (0010): el informe no contiene ningún id ni nombre observado', () => {
    const text = JSON.stringify(report)
    const leaked = [...observed].filter((value) => value.length >= 4 && text.includes(value))
    expect(leaked, 'valores del tenant en el informe').toHaveLength(0)
  })
})
