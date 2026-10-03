import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { IpcChannel } from '@shared/ipc'
import type { ProblemSummary } from '@shared/modules'
import { toProblemRow } from '@shared/problem-row'
import { createIpcHandler, type IpcImplementation } from '../ipc/handler'
import { createModuleHandlers } from '../ipc/handlers/modules'
import { createLiveClient, LIVE_ENV_ID } from '../../test/live-client'
import { loadLiveEnv } from '../../test/live-env'
import { DtError } from '../dynatrace/errors'
import { problemsPageSchema } from './problems'

/**
 * PRUEBAS EN VIVO contra el tenant de pruebas (npm run test:live), SOLO LECTURA.
 *
 * Reglas (repositorio público):
 * - Los asertos son solo estructurales: validan con los esquemas y que el
 *   mapeo no lanza. Nunca se compara ni se imprime un valor del tenant.
 * - Los mensajes de fallo solo llevan el canal, el rango y el código de error.
 * - Si algo no valida, live-reports/ (ignorada por git) recibe las rutas y los
 *   códigos de los issues de Zod: nunca sus mensajes ni los valores.
 */

const env = loadLiveEnv()
const live = env === null ? null : createLiveClient(env)

type Result = { ok: boolean; data?: unknown; error?: { code: string } }

const report: Record<string, unknown> = {}

/** Rutas y códigos de los issues de Zod, sin mensajes ni valores. */
function issuePaths(schema: z.ZodType, value: unknown): { path: string; code: string }[] {
  const parsed = schema.safeParse(value)
  if (parsed.success) return []
  return parsed.error.issues.slice(0, 50).map((issue) => ({
    // Los índices de array se generalizan para no revelar cuántos elementos hay.
    path: issue.path.map((part) => (typeof part === 'number' ? '[]' : String(part))).join('.'),
    code: issue.code
  }))
}

/** Código de un error sin su mensaje (el mensaje puede llevar el host del tenant). */
function codeOf(error: unknown): string {
  return error instanceof DtError ? error.code : 'NO_DT_ERROR'
}

function handlers(): ReturnType<typeof createModuleHandlers> {
  if (live === null) throw new Error('sin .env.live.local')
  return createModuleHandlers({
    client: live.client,
    // Solo lectura: las consultas guardadas no se usan en vivo.
    savedQueries: {
      list: () => [],
      save: () => {
        throw new Error('no se escribe en vivo')
      },
      delete: () => undefined
    },
    repo: { getEnvironment: () => ({ id: LIVE_ENV_ID }) }
  } as unknown as Parameters<typeof createModuleHandlers>[0])
}

/** Llama a un canal pasando por createIpcHandler, que también valida la salida con Zod. */
async function call(channel: IpcChannel, input: unknown): Promise<Result> {
  const implementation = (handlers() as Record<string, unknown>)[channel] as IpcImplementation<
    typeof channel
  >
  const silent = { warn: (): void => undefined, error: (): void => undefined }
  return (await createIpcHandler(channel, implementation, {
    isTrustedSender: () => true,
    logger: silent
  })({ url: 'app://vigia/index.html', isMainFrame: true }, input)) as Result
}

afterAll(() => {
  if (live === null) return
  // Informe estructural, sin datos del tenant ni el token.
  report['tokenEnLog'] = live.logged.some((line) => env !== null && line.includes(env.token))
  mkdirSync('live-reports', { recursive: true })
  writeFileSync(join('live-reports', 'problems.json'), JSON.stringify(report, null, 2))
})

describe.skipIf(live === null)('en vivo: Problemas, Métricas y SLOs (solo lectura)', () => {
  const summaries: ProblemSummary[] = []

  it.each(['2h', '24h', '7d'] as const)(
    'problems:list con %s valida y cada fila se mapea',
    async (range) => {
      const result = await call('problems:list', { environmentId: LIVE_ENV_ID, timeRange: range })
      report[`problems:list ${range}`] = result.ok ? 'ok' : result.error?.code
      expect(result.ok, `problems:list ${range}: ${result.error?.code ?? ''}`).toBe(true)

      const problems = (result.data as { problems: ProblemSummary[] }).problems
      report[`problems:list ${range} recuento`] = problems.length
      let mapped = 0
      for (const problem of problems) {
        toProblemRow(problem, new Date())
        mapped += 1
      }
      expect(mapped, `problems:list ${range}: todas las filas se mapean`).toBe(problems.length)
      if (range === '7d') summaries.push(...problems)
    }
  )

  for (const status of ['OPEN', 'CLOSED'] as const) {
    it(`detalle de un problema ${status} con fields`, async (ctx) => {
      const target = summaries.find((p) => p.status === status)
      if (target === undefined) {
        report[`problems:get ${status}`] = 'sin problemas con ese estado en 7 días'
        ctx.skip()
        return
      }
      const result = await call('problems:get', {
        environmentId: LIVE_ENV_ID,
        problemId: target.problemId
      })
      report[`problems:get ${status}`] = result.ok ? 'ok' : result.error?.code
      expect(result.ok, `problems:get ${status}: ${result.error?.code ?? ''}`).toBe(true)
    })
  }

  it('si hay más de una página, la segunda también valida', async (ctx) => {
    if (live === null) return
    let first: unknown
    try {
      first = await live.client.dtRequest({
        envId: LIVE_ENV_ID,
        api: 'classic',
        path: '/problems',
        query: { from: 'now-7d', pageSize: 2 },
        schema: problemsPageSchema
      })
    } catch (error) {
      report['paginación 1.ª'] = codeOf(error)
      expect.fail(`paginación, 1.ª página: ${codeOf(error)}`)
    }
    const nextPageKey = (first as { nextPageKey?: string | null }).nextPageKey
    if (nextPageKey === undefined || nextPageKey === null) {
      report['paginación'] = 'una sola página'
      ctx.skip()
      return
    }
    try {
      await live.client.dtRequest({
        envId: LIVE_ENV_ID,
        api: 'classic',
        path: '/problems',
        query: { nextPageKey },
        schema: problemsPageSchema
      })
      report['paginación 2.ª'] = 'ok'
    } catch (error) {
      report['paginación 2.ª'] = codeOf(error)
      expect.fail(`paginación, 2.ª página: ${codeOf(error)}`)
    }
  })

  it('si la lista no valida, el informe guarda dónde (rutas y códigos, sin valores)', async () => {
    if (live === null) return
    // Diagnóstico: la respuesta cruda se valida aparte para anotar solo las rutas que fallan.
    let raw: unknown
    try {
      raw = await live.client.dtRequest({
        envId: LIVE_ENV_ID,
        api: 'classic',
        path: '/problems',
        query: { from: 'now-7d', pageSize: 100 },
        schema: z.unknown()
      })
    } catch (error) {
      report['diagnóstico'] = codeOf(error)
      return
    }
    const issues = issuePaths(problemsPageSchema, raw)
    report['diagnóstico: issues de problemsPageSchema'] = issues
    expect(issues.length, 'la lista cruda de /problems valida con problemsPageSchema').toBe(0)
  })

  it('metrics:query de builtin:host.cpu.usage con 2 h y metrics:search "cpu"', async () => {
    const query = await call('metrics:query', {
      environmentId: LIVE_ENV_ID,
      timeRange: '2h',
      metricSelector: 'builtin:host.cpu.usage'
    })
    report['metrics:query'] = query.ok ? 'ok' : query.error?.code
    expect(query.ok, `metrics:query: ${query.error?.code ?? ''}`).toBe(true)

    const search = await call('metrics:search', { environmentId: LIVE_ENV_ID, text: 'cpu' })
    report['metrics:search'] = search.ok ? 'ok' : search.error?.code
    expect(search.ok, `metrics:search: ${search.error?.code ?? ''}`).toBe(true)
  })

  it('slos:list evaluada valida', async () => {
    const result = await call('slos:list', { environmentId: LIVE_ENV_ID })
    report['slos:list'] = result.ok ? 'ok' : result.error?.code
    expect(result.ok, `slos:list: ${result.error?.code ?? ''}`).toBe(true)
  })

  it('el log del cliente no contiene el token', () => {
    if (live === null || env === null) return
    const leaked = live.logged.some((line) => line.includes(env.token))
    expect(leaked, 'el token no aparece en ningún mensaje del log').toBe(false)
  })
})
