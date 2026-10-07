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
 * Ficha 0007: canal `entities:problemCounts` (problemas abiertos y cerrados que
 * afectan a una entidad en el rango), con el cliente de Dynatrace REAL sobre un
 * fetch falso. Se comprueba qué se pide a GET /api/v2/problems y qué llega a la
 * interfaz.
 *
 * Según la OpenAPI v2 (APIv2.json, GET /problems): `problemSelector` admite
 * `affectedEntities("id")` y `status("open")` / `status("closed")` (un solo
 * estado), los criterios se separan por comas (AND), `pageSize` va de 1 a 500
 * y la respuesta (`Problems`) trae `totalCount` y `problems`.
 */

const TRUSTED = { url: 'app://vigia/index.html', isMainFrame: true }
const TOKEN = `dt0c01.PUBLICAPRUEBA0000000000A.${'SECRETORECUENTO'.padEnd(64, 'X')}`
const BASE = 'https://abc12345.live.dynatrace.com'
const CHANNEL = 'entities:problemCounts' as IpcChannel
/** Id inventado, con el formato de Dynatrace. */
const ENTITY_ID = 'SERVICE-0123456789ABCDEF'

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

function problem(id: string, status: 'OPEN' | 'CLOSED'): Record<string, unknown> {
  return {
    problemId: id,
    displayId: `P-${id}`,
    title: `Problema ${id}`,
    status,
    severityLevel: 'ERROR',
    impactLevel: 'SERVICES',
    startTime: Date.parse('2026-10-03T08:00:00.000Z'),
    endTime: status === 'OPEN' ? -1 : Date.parse('2026-10-03T09:00:00.000Z'),
    affectedEntities: [{ entityId: { id: ENTITY_ID, type: 'SERVICE' }, name: 'pagos' }],
    impactedEntities: [],
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

/** Estado pedido en el selector ('open', 'closed' o null si no lo lleva). */
function statusOf(url: URL): string | null {
  return (
    /status\("(open|closed)"\)/.exec(url.searchParams.get('problemSelector') ?? '')?.[1] ?? null
  )
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

/** Por defecto: 3 abiertos y 12 cerrados, pero con pageSize=1 solo llega uno en la lista. */
function countsResponse(open: number | undefined, closed: number | undefined) {
  return (url: URL): Response => {
    const status = statusOf(url)
    const total = status === 'open' ? open : closed
    const body: Record<string, unknown> = {
      problems: total === 0 ? [] : [problem('1', status === 'open' ? 'OPEN' : 'CLOSED')],
      nextPageKey: total !== undefined && total > 1 ? 'siguiente' : null,
      pageSize: 1
    }
    if (total !== undefined) body['totalCount'] = total
    return json(200, body)
  }
}

beforeEach(() => {
  requests = []
  respond = countsResponse(3, 12)

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

type Result = {
  ok: boolean
  data?: unknown
  error?: { code: string; message: string; reason?: { key: string } }
}

async function call(input: Record<string, unknown>): Promise<Result> {
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
  expect(JSON.stringify(result)).not.toContain('SECRETORECUENTO')
  return result
}

describe('CA1 (0007): main solo pide con un id válido', () => {
  it.each([
    ['comillas y paréntesis', 'SERVICE-0123456789ABCDEF"),status("closed'],
    ['minúsculas', 'SERVICE-0123456789abcdef'],
    ['tipo personalizado con dos puntos', 'custom:device-0123456789ABCDEF']
  ])('un id con %s da INVALID_INPUT sin llamar a Dynatrace', async (_case, entityId) => {
    const result = await call({ entityId })
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
    expect(requests).toHaveLength(0)
  })
})

describe('CA2 (0007): dos peticiones a /problems con pageSize=1, el selector y el rango', () => {
  it.each([
    ['2h', 'now-2h'],
    ['24h', 'now-24h'],
    ['7d', 'now-7d']
  ])('rango relativo %s: from %s y sin to', async (timeRange, from) => {
    const result = await call({ timeRange })
    expect(result.ok, JSON.stringify(result.error)).toBe(true)

    expect(requests).toHaveLength(2)
    for (const url of requests) {
      expect(url.pathname).toBe('/api/v2/problems')
      expect(url.searchParams.get('pageSize')).toBe('1')
      expect(url.searchParams.get('from')).toBe(from)
      expect(url.searchParams.has('to')).toBe(false)
      expect(url.searchParams.has('nextPageKey')).toBe(false)
    }
    const selectors = requests.map((url) => criteria(url.searchParams.get('problemSelector')))
    expect(selectors).toEqual(
      expect.arrayContaining([
        criteria(`affectedEntities("${ENTITY_ID}"),status("open")`),
        criteria(`affectedEntities("${ENTITY_ID}"),status("closed")`)
      ])
    )
  })

  it('rango absoluto: from y to en ISO en las dos peticiones', async () => {
    const result = await call({
      entityId: 'PROCESS_GROUP_INSTANCE-00000000000000A1',
      timeRange: { from: '2026-10-01T08:00:00.000Z', to: '2026-10-01T10:00:00.000Z' }
    })
    expect(result.ok, JSON.stringify(result.error)).toBe(true)

    expect(requests).toHaveLength(2)
    for (const url of requests) {
      expect(url.searchParams.get('pageSize')).toBe('1')
      expect(url.searchParams.get('from')).toBe('2026-10-01T08:00:00.000Z')
      expect(url.searchParams.get('to')).toBe('2026-10-01T10:00:00.000Z')
    }
    expect(requests.map((url) => criteria(url.searchParams.get('problemSelector')))).toEqual(
      expect.arrayContaining([
        criteria('affectedEntities("PROCESS_GROUP_INSTANCE-00000000000000A1"),status("open")'),
        criteria('affectedEntities("PROCESS_GROUP_INSTANCE-00000000000000A1"),status("closed")')
      ])
    )
  })

  it('el selector solo lleva la entidad y el estado (ni causa raíz ni impactadas)', async () => {
    await call({})
    for (const url of requests) {
      const parts = criteria(url.searchParams.get('problemSelector'))
      expect(parts).toHaveLength(2)
      expect(parts.some((part) => part === `affectedEntities("${ENTITY_ID}")`)).toBe(true)
    }
    expect(requests.map(statusOf).sort()).toEqual(['closed', 'open'])
  })
})

describe('CA3 (0007): los totalCount llegan como open y closed', () => {
  it('usa totalCount, no el número de problemas de la página', async () => {
    const result = await call({})
    expect(result).toEqual({ ok: true, data: { open: 3, closed: 12 } })
  })

  it('un 0 de la API es 0, no null', async () => {
    respond = countsResponse(0, 0)
    const result = await call({})
    expect(result).toEqual({ ok: true, data: { open: 0, closed: 0 } })
  })

  it('sin totalCount en la respuesta, null (no 0)', async () => {
    respond = countsResponse(undefined, undefined)
    const result = await call({})
    expect(result).toEqual({ ok: true, data: { open: null, closed: null } })
  })

  it('si solo falta en una de las dos, solo esa es null', async () => {
    respond = countsResponse(4, undefined)
    expect(await call({})).toEqual({ ok: true, data: { open: 4, closed: null } })

    requests = []
    respond = countsResponse(undefined, 7)
    expect(await call({})).toEqual({ ok: true, data: { open: null, closed: 7 } })
  })
})

describe('CA4 (0007): un 400 de Dynatrace acaba en error con reason', () => {
  it.each(['las dos', 'solo la de cerrados'])(
    'si falla %s, el canal da un error con un reason conocido',
    async (which) => {
      const ok = countsResponse(3, 12)
      respond = (url) =>
        which === 'las dos' || statusOf(url) === 'closed'
          ? json(400, { error: { code: 400, message: 'Selector mal formado' } })
          : ok(url)
      const result = await call({})
      expect(result.ok).toBe(false)
      expect(result.error?.reason, JSON.stringify(result.error)).toBeDefined()
      expect(errorReasonKeys as readonly string[]).toContain(result.error?.reason?.key)
    }
  )
})
