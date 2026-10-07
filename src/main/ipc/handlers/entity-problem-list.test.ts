import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { errorReasonKeys } from '@shared/error-reasons'
import type { IpcChannel } from '@shared/ipc'
import type { AppDatabase } from '../../db/database'
import { createDtClient } from '../../dynatrace/client'
import { createSavedQueryStore } from '../../modules/saved-queries'
import { createSecretStore } from '../../secrets/store'
import { createTenantRepository } from '../../tenants/repository'
import { createIpcHandler, type IpcHandlerDeps, type IpcImplementation } from '../handler'
import { createModuleHandlers } from './modules'
import { createTestDb, fakeCrypto } from '../../../test/fixtures'

/**
 * Ficha 0010: canal `entities:problems` (la lista de problemas que afectan a una
 * entidad en el rango, para la franja del gráfico «Tasa de error»), con el cliente de
 * Dynatrace REAL sobre un fetch falso. Se comprueba qué se pide a GET /api/v2/problems y
 * qué llega a la interfaz.
 *
 * Según la OpenAPI v2 (APIv2.json, GET /problems): `problemSelector` admite
 * `affectedEntities("id")`; `pageSize` va hasta 500 (50 por defecto); `sort=-startTime`
 * ordena de más nuevo a más antiguo; la respuesta (`Problems`) trae `problems` y
 * `totalCount` (obligatorios), y en cada `Problem` `startTime` y `endTime` son enteros en
 * milisegundos UTC, con `endTime` a `-1` si el problema sigue abierto.
 */

const TRUSTED = { url: 'app://vigia/index.html', isMainFrame: true }
const TOKEN = `dt0c01.PUBLICAPRUEBA0000000000A.${'SECRETOLISTAENTIDAD'.padEnd(64, 'X')}`
const BASE = 'https://abc12345.live.dynatrace.com'
const CHANNEL = 'entities:problems' as IpcChannel
/** Id inventado, con el formato de Dynatrace. */
const ENTITY_ID = 'SERVICE-0123456789ABCDEF'

const START = Date.parse('2026-10-03T08:00:00.000Z')
const END = Date.parse('2026-10-03T09:00:00.000Z')

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

/** Un `Problem` de la API con todos sus campos obligatorios. */
function problem(
  id: string,
  status: 'OPEN' | 'CLOSED',
  endTime: number | null = status === 'OPEN' ? -1 : END
): Record<string, unknown> {
  return {
    problemId: id,
    displayId: `P-${id}`,
    title: `Problema ${id}`,
    status,
    severityLevel: 'ERROR',
    impactLevel: 'SERVICES',
    startTime: START,
    endTime,
    affectedEntities: [{ entityId: { id: ENTITY_ID, type: 'SERVICE' }, name: 'pagos' }],
    impactedEntities: [],
    rootCauseEntity: { entityId: { id: ENTITY_ID, type: 'SERVICE' }, name: 'pagos' },
    managementZones: [],
    problemFilters: []
  }
}

/** Separa un selector por las comas de primer nivel (no las de dentro de paréntesis o comillas). */
function criteria(selector: string | null): string[] {
  if (selector === null) return []
  const parts: string[] = []
  let depth = 0
  let quoted = false
  let current = ''
  for (const char of selector) {
    if (char === '"') quoted = !quoted
    if (!quoted && char === '(') depth += 1
    if (!quoted && char === ')') depth -= 1
    if (!quoted && depth === 0 && char === ',') {
      parts.push(current.trim())
      current = ''
      continue
    }
    current += char
  }
  if (current.trim() !== '') parts.push(current.trim())
  return parts.sort()
}

/** Respuesta de /problems; cada prueba puede cambiarla. */
let respond: (url: URL) => Response
let requests: URL[]
let db: AppDatabase
let envId: string
let deps: IpcHandlerDeps
let handlers: ReturnType<typeof createModuleHandlers>

const fakeFetch = vi.fn(async (input: unknown) => {
  const url = new URL(String(input instanceof Request ? input.url : input))
  requests.push(url)
  if (url.pathname === '/api/v2/problems') return respond(url)
  return json(404, { error: { code: 404, message: 'No existe' } })
})

/** Página de la API con esos problemas y ese totalCount. */
function page(problems: unknown[], totalCount = problems.length) {
  return (): Response =>
    json(200, {
      totalCount,
      pageSize: 100,
      problems,
      nextPageKey: totalCount > problems.length ? 'siguiente' : null
    })
}

beforeEach(() => {
  requests = []
  respond = page([problem('1', 'OPEN'), problem('2', 'CLOSED')])

  db = createTestDb()
  const repo = createTenantRepository(db)
  const secrets = createSecretStore(db, fakeCrypto())
  const client = repo.createClient({ name: 'Cliente A', color: '#111111' })
  envId = repo.createEnvironment({
    clientId: client.id,
    name: 'Producción',
    type: 'production',
    deployment: 'saas',
    classicApiUrl: BASE,
    platformUrl: null,
    ssoUrl: null,
    oauthClientId: null,
    oauthScopes: [],
    accountUuid: null,
    certificateLevel: 'system',
    captureUrlPatterns: [],
    tags: [],
    readOnly: false
  }).id
  secrets.set(envId, 'classicToken', TOKEN)

  const dtClient = createDtClient({
    fetchFor: () => fakeFetch as unknown as typeof fetch,
    getEnvironment: (id: string) => repo.getEnvironment(id),
    readSecret: (id: string, kind: 'classicToken' | 'oauthClientSecret' | 'platformToken') =>
      secrets.read(id, kind),
    oauth: { getToken: vi.fn(), invalidate: vi.fn(), expiresAt: vi.fn(() => null) },
    sleep: async () => undefined,
    now: () => new Date('2026-10-03T10:00:00.000Z'),
    random: () => 0,
    logger: { warn: vi.fn(), error: vi.fn() }
  } as unknown as Parameters<typeof createDtClient>[0])

  handlers = createModuleHandlers({
    client: dtClient,
    savedQueries: createSavedQueryStore(db),
    repo
  } as unknown as Parameters<typeof createModuleHandlers>[0])
  deps = { isTrustedSender: () => true, logger: { warn: vi.fn(), error: vi.fn() } }
})

afterEach(() => {
  db.$client.close()
})

type Output = {
  problems: Record<string, unknown>[]
  totalCount: number | null
  truncated: boolean
  invalid: number
}

type Result = {
  ok: boolean
  data?: Output
  error?: { code: string; message: string; reason?: { key: string } }
}

async function call(input: Record<string, unknown> = {}): Promise<Result> {
  const implementation = (handlers as Record<string, unknown>)[CHANNEL] as IpcImplementation<
    typeof CHANNEL
  >
  expect(implementation, `implementación de ${CHANNEL}`).toBeTypeOf('function')
  const result = (await createIpcHandler(
    CHANNEL,
    implementation,
    deps
  )(TRUSTED, {
    environmentId: envId,
    entityId: ENTITY_ID,
    timeRange: '2h',
    ...input
  })) as Result
  // Ninguna salida lleva el token.
  expect(JSON.stringify(result)).not.toContain('SECRETOLISTAENTIDAD')
  return result
}

describe('CA1 (0010): una petición a /problems con la entidad, el rango, pageSize=100 y sort=-startTime', () => {
  it.each([
    ['2h', 'now-2h'],
    ['24h', 'now-24h'],
    ['7d', 'now-7d']
  ])('rango relativo %s: from %s y sin to', async (timeRange, from) => {
    const result = await call({ timeRange })
    expect(result.ok, JSON.stringify(result.error)).toBe(true)

    expect(requests).toHaveLength(1)
    const [url] = requests as [URL]
    expect(url.pathname).toBe('/api/v2/problems')
    expect(criteria(url.searchParams.get('problemSelector'))).toEqual([
      `affectedEntities("${ENTITY_ID}")`
    ])
    expect(url.searchParams.get('pageSize')).toBe('100')
    expect(url.searchParams.get('sort')).toBe('-startTime')
    expect(url.searchParams.get('from')).toBe(from)
    expect(url.searchParams.has('to')).toBe(false)
    expect(url.searchParams.has('nextPageKey')).toBe(false)
  })

  it('rango absoluto: from y to en ISO', async () => {
    const result = await call({
      entityId: 'HOST-00000000000000A1',
      timeRange: { from: '2026-10-01T08:00:00.000Z', to: '2026-10-01T10:00:00.000Z' }
    })
    expect(result.ok, JSON.stringify(result.error)).toBe(true)

    expect(requests).toHaveLength(1)
    const [url] = requests as [URL]
    expect(criteria(url.searchParams.get('problemSelector'))).toEqual([
      'affectedEntities("HOST-00000000000000A1")'
    ])
    expect(url.searchParams.get('from')).toBe('2026-10-01T08:00:00.000Z')
    expect(url.searchParams.get('to')).toBe('2026-10-01T10:00:00.000Z')
    expect(url.searchParams.get('pageSize')).toBe('100')
    expect(url.searchParams.get('sort')).toBe('-startTime')
  })

  it('con un id no válido (misma validación que entities:problemCounts) no pide nada', async () => {
    for (const entityId of [
      'SERVICE-0123456789ABCDEF"),status("closed',
      'SERVICE-0123456789abcdef',
      'custom:device-0123456789ABCDEF'
    ]) {
      const result = await call({ entityId })
      expect(result, entityId).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
    }
    expect(requests).toHaveLength(0)
  })

  it('la salida lleva los siete campos de cada problema; endTime -1 o null pasa a null', async () => {
    respond = page([
      problem('1', 'OPEN', -1),
      problem('2', 'CLOSED', END),
      problem('3', 'OPEN', null)
    ])
    const result = await call()
    expect(result.ok, JSON.stringify(result.error)).toBe(true)
    expect(result.data?.problems).toEqual([
      {
        problemId: '1',
        displayId: 'P-1',
        title: 'Problema 1',
        status: 'OPEN',
        severityLevel: 'ERROR',
        startTime: START,
        endTime: null
      },
      {
        problemId: '2',
        displayId: 'P-2',
        title: 'Problema 2',
        status: 'CLOSED',
        severityLevel: 'ERROR',
        startTime: START,
        endTime: END
      },
      {
        problemId: '3',
        displayId: 'P-3',
        title: 'Problema 3',
        status: 'OPEN',
        severityLevel: 'ERROR',
        startTime: START,
        endTime: null
      }
    ])
    expect(result.data).toMatchObject({ totalCount: 3, truncated: false, invalid: 0 })
  })

  it('si totalCount es mayor que lo recibido, truncated y el total real; sin pedir más páginas', async () => {
    respond = page([problem('1', 'OPEN'), problem('2', 'CLOSED')], 250)
    const result = await call()
    expect(result.ok, JSON.stringify(result.error)).toBe(true)
    expect(result.data).toMatchObject({ totalCount: 250, truncated: true, invalid: 0 })
    expect(result.data?.problems).toHaveLength(2)
    expect(requests).toHaveLength(1)
  })

  it('sin problemas en el rango: lista vacía, totalCount 0 y sin recortar', async () => {
    respond = page([])
    const result = await call()
    expect(result).toEqual({
      ok: true,
      data: { problems: [], totalCount: 0, truncated: false, invalid: 0 }
    })
  })
})

describe('CA2 (0010): un elemento que no cumple el esquema cuenta en invalid; un 400 da error con reason', () => {
  it('los elementos rotos se cuentan y el resto de la lista llega', async () => {
    const withoutId = problem('roto', 'OPEN')
    delete withoutId['problemId']
    const textStart = { ...problem('roto2', 'CLOSED'), startTime: 'ayer' }
    respond = page([problem('1', 'OPEN'), withoutId, problem('2', 'CLOSED'), textStart])
    const result = await call()
    expect(result.ok, JSON.stringify(result.error)).toBe(true)
    expect(result.data?.invalid).toBe(2)
    expect(result.data?.problems.map((p) => p['problemId'])).toEqual(['1', '2'])
    expect(result.data?.totalCount).toBe(4)
  })

  it('un 400 de Dynatrace acaba en error con un reason conocido', async () => {
    respond = () => json(400, { error: { code: 400, message: 'Selector mal formado' } })
    const result = await call()
    expect(result.ok).toBe(false)
    expect(result.error?.reason, JSON.stringify(result.error)).toBeDefined()
    expect(errorReasonKeys as readonly string[]).toContain(result.error?.reason?.key)
  })
})
