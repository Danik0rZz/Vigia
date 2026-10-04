import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
 * Canales de Problemas, Métricas, SLOs y consultas guardadas, con el cliente
 * de Dynatrace REAL sobre un fetch falso: se comprueba qué se pide a la API,
 * qué llega al renderer y que ninguna salida lleva el token.
 */

const TRUSTED = { url: 'app://vigia/index.html', isMainFrame: true }
const TOKEN = `dt0c01.PUBLICAPRUEBA0000000000A.${'SECRETOMODULOS'.padEnd(64, 'X')}`
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000'
const BASE = 'https://abc12345.live.dynatrace.com'

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

function problem(id: string, status = 'OPEN'): Record<string, unknown> {
  return {
    problemId: id,
    displayId: `P-${id}`,
    title: `Problema ${id}`,
    status,
    severityLevel: 'ERROR',
    impactLevel: 'SERVICES',
    startTime: 1791050000000,
    endTime: status === 'OPEN' ? -1 : 1791053600000,
    affectedEntities: [{ entityId: { id: 'SERVICE-1', type: 'SERVICE' }, name: 'pagos' }],
    impactedEntities: [],
    managementZones: [],
    problemFilters: []
  }
}

/** Respuestas por ruta; cada prueba puede cambiarlas. */
let routes: Record<string, (url: URL) => Response>
let requests: URL[]
let db: AppDatabase
let envId: string
let deps: IpcHandlerDeps
let handlers: ReturnType<typeof createModuleHandlers>
let outputs: string[]
let called: Set<string>

const fakeFetch = vi.fn(async (input: unknown) => {
  const url = new URL(String(input instanceof Request ? input.url : input))
  requests.push(url)
  const route = routes[url.pathname.replace(/^\/api\/v2/, '')]
  if (route === undefined) {
    const single = /^\/api\/v2\/problems\/(.+)$/.exec(url.pathname)
    if (single) return json(200, problem(decodeURIComponent(single[1] ?? '')))
    return json(404, { error: { code: 404, message: 'No existe' } })
  }
  return route(url)
})

beforeEach(() => {
  requests = []
  routes = {
    '/problems': () =>
      json(200, {
        totalCount: 2,
        problems: [problem('1'), problem('2', 'CLOSED')],
        nextPageKey: null
      }),
    '/metrics/query': (url) =>
      json(200, {
        resolution: url.searchParams.get('resolution') ?? '1m',
        totalCount: 1,
        result: [
          {
            metricId: url.searchParams.get('metricSelector'),
            data: [
              {
                dimensionMap: { 'dt.entity.host': 'HOST-1' },
                timestamps: [1, 2],
                values: [1, null]
              }
            ]
          }
        ]
      }),
    '/metrics': () =>
      json(200, {
        totalCount: 1,
        nextPageKey: null,
        metrics: [{ metricId: 'builtin:host.cpu.usage', displayName: 'CPU' }]
      }),
    '/slo': () =>
      json(200, {
        totalCount: 1,
        nextPageKey: null,
        slo: [
          {
            id: 'slo-1',
            name: 'Disponibilidad',
            enabled: true,
            status: 'SUCCESS',
            target: 99,
            warning: 99.5,
            evaluatedPercentage: -1,
            errorBudget: -1,
            error: 'NONE'
          }
        ]
      })
  }

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
  outputs = []
  called = new Set()
})

afterEach(() => {
  db.$client.close()
})

async function call(
  channel: IpcChannel,
  input?: unknown
): Promise<{ ok: boolean; data?: unknown; error?: { code: string; message: string } }> {
  const implementation = (handlers as Record<string, unknown>)[channel] as IpcImplementation<
    typeof channel
  >
  expect(implementation, `implementación de ${channel}`).toBeTypeOf('function')
  const result = (await createIpcHandler(channel, implementation, deps)(TRUSTED, input)) as {
    ok: boolean
    data?: unknown
    error?: { code: string; message: string }
  }
  called.add(channel)
  outputs.push(`${channel}: ${JSON.stringify(result)}`)
  return result
}

describe('problems:list', () => {
  it('pide /problems con el rango, el selector y pageSize 100, y devuelve los resúmenes', async () => {
    const result = await call('problems:list', {
      environmentId: envId,
      timeRange: '2h',
      status: 'open',
      severity: ['ERROR'],
      text: 'x"y'
    })

    expect(result).toMatchObject({ ok: true, data: { totalCount: 2, truncated: false } })
    const data = result.data as { problems: { problemId: string; endTime: number | null }[] }
    expect(data.problems.map((p) => p.problemId)).toEqual(['1', '2'])
    expect(data.problems[0]?.endTime).toBeNull()

    const url = requests[0]
    expect(url?.pathname).toBe('/api/v2/problems')
    expect(url?.searchParams.get('from')).toBe('now-2h')
    expect(url?.searchParams.has('to')).toBe(false)
    expect(url?.searchParams.get('pageSize')).toBe('100')
    expect(url?.searchParams.get('problemSelector')).toBe(
      'status("open"),severityLevel("ERROR"),text("x~"y")'
    )
  })

  it('con un rango personalizado manda from y to en ISO', async () => {
    await call('problems:list', {
      environmentId: envId,
      timeRange: { from: '2026-10-01T08:00:00.000Z', to: '2026-10-01T10:00:00.000Z' }
    })
    expect(requests[0]?.searchParams.get('from')).toBe('2026-10-01T08:00:00.000Z')
    expect(requests[0]?.searchParams.get('to')).toBe('2026-10-01T10:00:00.000Z')
  })

  it('AUD-08: un problema sin problemId se descarta, se cuenta y el resto llega bien', async () => {
    const bad = problem('x')
    delete bad['problemId']
    routes['/problems'] = () =>
      json(200, { totalCount: 3, problems: [problem('1'), bad, problem('2')], nextPageKey: null })
    const result = await call('problems:list', { environmentId: envId, timeRange: '2h' })
    expect(result).toMatchObject({ ok: true, data: { invalid: 1, totalCount: 3 } })
    expect(
      (result.data as { problems: { problemId: string }[] }).problems.map((p) => p.problemId)
    ).toEqual(['1', '2'])
  })

  it('AUD-08: sin inválidos, invalid 0; y los warnings de la API se juntan sin duplicados', async () => {
    let n = 0
    routes['/problems'] = () => {
      n += 1
      return json(200, {
        totalCount: 2,
        problems: [problem(String(n))],
        nextPageKey: n === 1 ? 'k1' : null,
        warnings: n === 1 ? ['Aviso uno', 'Aviso dos'] : ['Aviso dos', 'Aviso tres']
      })
    }
    const result = await call('problems:list', { environmentId: envId, timeRange: '2h' })
    expect(result).toMatchObject({ ok: true, data: { invalid: 0 } })
    expect((result.data as { warnings: string[] }).warnings).toEqual([
      'Aviso uno',
      'Aviso dos',
      'Aviso tres'
    ])
  })

  it('AUD-08: sin warnings en la API, warnings []; y como mucho 20', async () => {
    routes['/problems'] = () =>
      json(200, { totalCount: 1, problems: [problem('1')], nextPageKey: null })
    expect(await call('problems:list', { environmentId: envId, timeRange: '2h' })).toMatchObject({
      ok: true,
      data: { warnings: [] }
    })
    routes['/problems'] = () =>
      json(200, {
        totalCount: 1,
        problems: [problem('1')],
        nextPageKey: null,
        warnings: Array.from({ length: 30 }, (_, i) => `Aviso ${i}`)
      })
    const many = await call('problems:list', { environmentId: envId, timeRange: '2h' })
    expect((many.data as { warnings: string[] }).warnings).toHaveLength(20)
  })

  it('AUD-08: slos:list también descarta y cuenta los inválidos', async () => {
    routes['/slo'] = () =>
      json(200, {
        totalCount: 2,
        nextPageKey: null,
        slo: [
          {
            id: 'slo-1',
            name: 'A',
            enabled: true,
            status: 'SUCCESS',
            target: 99,
            warning: 99.5,
            evaluatedPercentage: 99,
            errorBudget: 1,
            error: 'NONE'
          },
          { id: 'slo-2', name: 'B', status: 'NO_ES_UN_ESTADO' }
        ]
      })
    const result = await call('slos:list', { environmentId: envId })
    expect(result).toMatchObject({ ok: true, data: { invalid: 1, totalCount: 2 } })
    expect((result.data as { slos: { id: string }[] }).slos.map((s) => s.id)).toEqual(['slo-1'])
  })

  it('AUD-08: un 400 de Dynatrace llega como BAD_REQUEST', async () => {
    routes['/problems'] = () => json(400, { error: { code: 400, message: 'Selector mal formado' } })
    const result = await call('problems:list', { environmentId: envId, timeRange: '2h' })
    expect(result).toMatchObject({ ok: false, error: { code: 'BAD_REQUEST' } })
    expect(result.error?.message).toContain('Selector mal formado')
  })

  it('AUD-07: devuelve el totalCount de la API, no el número de elementos', async () => {
    routes['/problems'] = () =>
      json(200, {
        totalCount: 57,
        problems: [problem('1'), problem('2', 'CLOSED')],
        nextPageKey: null
      })
    const result = await call('problems:list', { environmentId: envId, timeRange: '2h' })
    expect(result).toMatchObject({ ok: true, data: { totalCount: 57, truncated: false } })
  })

  it('AUD-07: sin totalCount en la respuesta, totalCount null', async () => {
    routes['/problems'] = () => json(200, { problems: [problem('1')], nextPageKey: null })
    const result = await call('problems:list', { environmentId: envId, timeRange: '2h' })
    expect(result).toMatchObject({ ok: true, data: { totalCount: null } })
  })

  it('con más páginas de las permitidas para en 5, marca truncated y no repite parámetros', async () => {
    let n = 0
    routes['/problems'] = () => {
      n += 1
      return json(200, { totalCount: 999, problems: [problem(String(n))], nextPageKey: `k${n}` })
    }
    const result = await call('problems:list', {
      environmentId: envId,
      timeRange: '24h',
      status: 'open'
    })

    expect(result).toMatchObject({ ok: true, data: { truncated: true } })
    expect((result.data as { problems: unknown[] }).problems).toHaveLength(5)
    expect(requests).toHaveLength(5)
    for (const url of requests.slice(1)) {
      expect([...url.searchParams.keys()]).toEqual(['nextPageKey'])
    }
  })

  it.each([
    ['un texto de más de 30 caracteres', { text: 'x'.repeat(31) }],
    ['un rango desconocido', { timeRange: '30d' }],
    [
      'un rango personalizado invertido',
      { timeRange: { from: '2026-10-02T00:00:00Z', to: '2026-10-01T00:00:00Z' } }
    ],
    ['un estado desconocido', { status: 'pending' }]
  ])('rechaza %s sin llamar a la API', async (_case, change) => {
    const result = await call('problems:list', { environmentId: envId, timeRange: '2h', ...change })
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
    expect(requests).toEqual([])
  })

  it('un 403 de Dynatrace llega como FORBIDDEN', async () => {
    routes['/problems'] = () =>
      json(403, {
        error: {
          code: 403,
          message: 'Missing scope',
          details: { missingScopes: ['problems.read'] }
        }
      })
    const result = await call('problems:list', { environmentId: envId, timeRange: '2h' })
    expect(result).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } })
    expect(result.error?.message).toContain('problems.read')
  })

  it('un entorno que no existe da NOT_FOUND', async () => {
    const result = await call('problems:list', { environmentId: UNKNOWN_ID, timeRange: '2h' })
    expect(result).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
    expect(requests).toEqual([])
  })
})

describe('problems:get', () => {
  it('pide /problems/{id} con el id codificado', async () => {
    const result = await call('problems:get', { environmentId: envId, problemId: 'abc/123' })
    expect(result).toMatchObject({ ok: true, data: { problemId: 'abc/123' } })
    expect(requests[0]?.pathname).toBe('/api/v2/problems/abc%2F123')
  })

  it('v0.9.1: pide exactamente fields=evidenceDetails,recentComments (sin impactAnalysis)', async () => {
    await call('problems:get', { environmentId: envId, problemId: 'p-1' })
    expect(requests[0]?.searchParams.get('fields')).toBe('evidenceDetails,recentComments')
  })
})

describe('problems:comments (v0.9.1: "Ver todos")', () => {
  const comment = (i: number, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: `c-${i}`,
    authorName: `autor-${i}`,
    content: `contenido ${i}`,
    context: 'ui',
    createdAtTimestamp: 1791050000000 + i,
    ...extra
  })

  it('pide /problems/{id}/comments con pageSize 500 y el id codificado; mapea los comentarios', async () => {
    routes['/problems/abc%2F1/comments'] = () =>
      json(200, { totalCount: 2, pageSize: 500, comments: [comment(1), comment(2)] })
    const result = await call('problems:comments', { environmentId: envId, problemId: 'abc/1' })
    expect(result).toEqual({
      ok: true,
      data: {
        comments: [
          { author: 'autor-1', content: 'contenido 1', context: 'ui', createdAt: 1791050000001 },
          { author: 'autor-2', content: 'contenido 2', context: 'ui', createdAt: 1791050000002 }
        ],
        totalCount: 2,
        truncated: false,
        invalid: 0
      }
    })
    expect(requests).toHaveLength(1)
    expect(requests[0]?.pathname).toBe('/api/v2/problems/abc%2F1/comments')
    expect(Object.fromEntries(requests[0]?.searchParams ?? [])).toEqual({ pageSize: '500' })
  })

  it('la página 2 solo lleva nextPageKey (el endpoint no tiene fields)', async () => {
    routes['/problems/p-1/comments'] = (url) =>
      url.searchParams.get('nextPageKey') === null
        ? json(200, { totalCount: 3, nextPageKey: 'k2', comments: [comment(1), comment(2)] })
        : json(200, { totalCount: 3, comments: [comment(3)] })
    const result = await call('problems:comments', { environmentId: envId, problemId: 'p-1' })
    expect(result).toMatchObject({ ok: true, data: { totalCount: 3, truncated: false } })
    expect((result.data as { comments: unknown[] }).comments).toHaveLength(3)
    expect(requests).toHaveLength(2)
    expect(Object.fromEntries(requests[1]?.searchParams ?? [])).toEqual({ nextPageKey: 'k2' })
  })

  it('como mucho 4 páginas: después, truncated', async () => {
    let page = 0
    routes['/problems/p-1/comments'] = () => {
      page += 1
      return json(200, { totalCount: 9999, nextPageKey: `k${page + 1}`, comments: [comment(page)] })
    }
    const result = await call('problems:comments', { environmentId: envId, problemId: 'p-1' })
    expect(requests).toHaveLength(4)
    expect(result).toMatchObject({ ok: true, data: { totalCount: 9999, truncated: true } })
  })

  it('los comentarios sin fecha (o que no son objeto) cuentan como invalid', async () => {
    routes['/problems/p-1/comments'] = () =>
      json(200, {
        totalCount: 4,
        comments: [
          comment(1),
          { authorName: 'sin fecha', content: 'x' },
          null,
          { createdAtTimestamp: 5 }
        ]
      })
    const result = await call('problems:comments', { environmentId: envId, problemId: 'p-1' })
    expect(result).toMatchObject({ ok: true, data: { invalid: 2 } })
    expect((result.data as { comments: unknown[] }).comments).toEqual([
      { author: 'autor-1', content: 'contenido 1', context: 'ui', createdAt: 1791050000001 },
      { author: null, content: '', context: null, createdAt: 5 }
    ])
  })

  it('un entorno que no existe da NOT_FOUND sin pedir nada', async () => {
    const result = await call('problems:comments', {
      environmentId: UNKNOWN_ID,
      problemId: 'p-1'
    })
    expect(result).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
    expect(requests).toEqual([])
  })

  it.each([
    ['problemId vacío', { problemId: '' }],
    ['problemId de más de 200', { problemId: 'x'.repeat(201) }],
    ['environmentId que no es uuid', { environmentId: 'no-uuid' }]
  ])('entrada inválida (%s) → INVALID_INPUT sin pedir nada', async (_label, override) => {
    const result = await call('problems:comments', {
      environmentId: envId,
      problemId: 'p-1',
      ...override
    })
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
    expect(requests).toEqual([])
  })
})

describe('metrics:query y metrics:search', () => {
  it('manda metricSelector, resolution y el rango, y devuelve las series', async () => {
    const result = await call('metrics:query', {
      environmentId: envId,
      timeRange: '7d',
      metricSelector: 'builtin:host.cpu.usage:avg',
      resolution: '1h'
    })
    expect(result).toMatchObject({
      ok: true,
      data: {
        resolution: '1h',
        series: [
          {
            metricId: 'builtin:host.cpu.usage:avg',
            dimensions: { 'dt.entity.host': 'HOST-1' },
            values: [1, null]
          }
        ]
      }
    })
    const url = requests[0]
    expect(url?.pathname).toBe('/api/v2/metrics/query')
    expect(url?.searchParams.get('metricSelector')).toBe('builtin:host.cpu.usage:avg')
    expect(url?.searchParams.get('resolution')).toBe('1h')
    expect(url?.searchParams.get('from')).toBe('now-7d')
  })

  it('sin resolution no la manda (la API usa la suya)', async () => {
    await call('metrics:query', { environmentId: envId, timeRange: '2h', metricSelector: 'm' })
    expect(requests[0]?.searchParams.has('resolution')).toBe(false)
  })

  it.each([
    ['resolución no válida', { resolution: '10s' }],
    ['selector vacío', { metricSelector: '' }],
    ['selector de más de 2000 caracteres', { metricSelector: 'm'.repeat(2001) }]
  ])('rechaza %s', async (_case, change) => {
    const result = await call('metrics:query', {
      environmentId: envId,
      timeRange: '2h',
      metricSelector: 'm',
      ...change
    })
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
    expect(requests).toEqual([])
  })

  it('metrics:search pide una página de 50 con el texto y marca truncated si hay más', async () => {
    const result = await call('metrics:search', { environmentId: envId, text: 'cpu' })
    expect(result).toMatchObject({
      ok: true,
      data: {
        metrics: [
          { metricId: 'builtin:host.cpu.usage', displayName: 'CPU', unit: null, description: null }
        ],
        truncated: false
      }
    })
    expect(requests[0]?.pathname).toBe('/api/v2/metrics')
    expect(requests[0]?.searchParams.get('text')).toBe('cpu')
    expect(requests[0]?.searchParams.get('pageSize')).toBe('50')

    expect(result).toMatchObject({ data: { totalCount: 1 } })

    routes['/metrics'] = () => json(200, { totalCount: 500, nextPageKey: 'k', metrics: [] })
    expect(await call('metrics:search', { environmentId: envId, text: 'cpu' })).toMatchObject({
      ok: true,
      data: { truncated: true, totalCount: 500 }
    })
    // Sigue siendo una sola página.
    expect(requests).toHaveLength(2)
  })

  it('AUD-13: metrics:search descarta las métricas inválidas y las cuenta en invalid', async () => {
    routes['/metrics'] = () =>
      json(200, {
        totalCount: 3,
        nextPageKey: null,
        metrics: [
          { metricId: 'builtin:host.cpu.usage', displayName: 'CPU' },
          { displayName: 'Sin metricId' },
          { metricId: 'builtin:host.cpu.idle' }
        ]
      })
    const result = await call('metrics:search', { environmentId: envId, text: 'cpu' })
    expect(result).toMatchObject({ ok: true, data: { invalid: 1 } })
    const ids = (result as { data: { metrics: { metricId: string }[] } }).data.metrics.map(
      (m) => m.metricId
    )
    expect(ids).toEqual(['builtin:host.cpu.usage', 'builtin:host.cpu.idle'])
  })

  it('AUD-13: metrics:search sin inválidas → invalid 0', async () => {
    expect(await call('metrics:search', { environmentId: envId, text: 'cpu' })).toMatchObject({
      ok: true,
      data: { invalid: 0 }
    })
  })

  it('AUD-13: metrics:query devuelve partial con los ratios < 1 de la API', async () => {
    routes['/metrics/query'] = () =>
      json(200, {
        resolution: '1m',
        totalCount: 1,
        result: [
          {
            metricId: 'builtin:host.cpu.usage',
            dataPointCountRatio: 0.5,
            dimensionCountRatio: 1,
            data: [{ dimensionMap: {}, timestamps: [1], values: [1] }]
          }
        ]
      })
    expect(
      await call('metrics:query', { environmentId: envId, timeRange: '2h', metricSelector: 'm' })
    ).toMatchObject({
      ok: true,
      data: {
        resolution: '1m',
        partial: [{ metricId: 'builtin:host.cpu.usage', dataPoints: 0.5, dimensions: null }]
      }
    })
  })

  it.each(['', 'x'.repeat(101)])('metrics:search rechaza el texto %j', async (text) => {
    expect(await call('metrics:search', { environmentId: envId, text })).toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT' }
    })
  })
})

describe('slos:list', () => {
  it('pide los SLOs evaluados, 25 por página', async () => {
    const result = await call('slos:list', { environmentId: envId })
    expect(result).toMatchObject({
      ok: true,
      data: {
        slos: [{ id: 'slo-1', evaluatedPercentage: null, errorBudget: null, error: null }],
        truncated: false
      }
    })
    expect(requests[0]?.pathname).toBe('/api/v2/slo')
    expect(requests[0]?.searchParams.get('evaluate')).toBe('true')
    expect(requests[0]?.searchParams.get('pageSize')).toBe('25')
    expect(result).toMatchObject({ data: { totalCount: 1 } })
  })

  it('AUD-07: pagina con nextPageKey (solo nextPageKey en la página 2) y devuelve el totalCount de la API', async () => {
    let n = 0
    routes['/slo'] = () => {
      n += 1
      return json(200, {
        totalCount: 30,
        nextPageKey: n === 1 ? 'k1' : null,
        slo: [
          {
            id: `slo-${n}`,
            name: `SLO ${n}`,
            enabled: true,
            status: 'SUCCESS',
            target: 99,
            warning: 99.5,
            evaluatedPercentage: 99.9,
            errorBudget: 10,
            error: 'NONE'
          }
        ]
      })
    }
    const result = await call('slos:list', { environmentId: envId })
    expect(result).toMatchObject({ ok: true, data: { truncated: false, totalCount: 30 } })
    expect((result.data as { slos: { id: string }[] }).slos.map((s) => s.id)).toEqual([
      'slo-1',
      'slo-2'
    ])
    expect(requests).toHaveLength(2)
    expect([...(requests[1]?.searchParams.entries() ?? [])]).toEqual([['nextPageKey', 'k1']])
  })

  it('AUD-07: con más de 4 páginas para en 4 y marca truncated', async () => {
    routes['/slo'] = () => json(200, { totalCount: 500, nextPageKey: 'k', slo: [] })
    expect(await call('slos:list', { environmentId: envId })).toMatchObject({
      ok: true,
      data: { truncated: true, totalCount: 500 }
    })
    expect(requests).toHaveLength(4)
  })
})

describe('consultas guardadas', () => {
  it('guarda, lista, actualiza y borra', async () => {
    const saved = await call('savedQueries:save', {
      environmentId: envId,
      name: 'CPU',
      metricSelector: 'builtin:host.cpu.usage',
      resolution: null
    })
    expect(saved).toMatchObject({
      ok: true,
      data: { environmentId: envId, name: 'CPU', resolution: null }
    })
    const id = (saved.data as { id: string }).id

    expect(await call('savedQueries:list', { environmentId: envId })).toMatchObject({
      ok: true,
      data: [{ id, name: 'CPU' }]
    })
    expect(
      await call('savedQueries:save', {
        environmentId: envId,
        id,
        name: 'CPU 5m',
        metricSelector: 'x',
        resolution: '5m'
      })
    ).toMatchObject({ ok: true, data: { id, name: 'CPU 5m', resolution: '5m' } })
    expect(
      await call('savedQueries:save', {
        environmentId: envId,
        name: 'cpu 5M',
        metricSelector: 'y',
        resolution: null
      })
    ).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
    expect(await call('savedQueries:delete', { id })).toEqual({ ok: true, data: { ok: true } })
    expect(await call('savedQueries:list', { environmentId: envId })).toEqual({
      ok: true,
      data: []
    })
  })
})

describe('todos los canales de módulos', () => {
  it('se han llamado y ninguna salida contiene el token', async () => {
    await call('problems:list', { environmentId: envId, timeRange: '2h' })
    await call('problems:get', { environmentId: envId, problemId: '1' })
    await call('problems:comments', { environmentId: envId, problemId: '1' })
    await call('metrics:query', { environmentId: envId, timeRange: '2h', metricSelector: 'm' })
    await call('metrics:search', { environmentId: envId, text: 'cpu' })
    await call('slos:list', { environmentId: envId })
    const saved = await call('savedQueries:save', {
      environmentId: envId,
      name: 'Q',
      metricSelector: 'm',
      resolution: null
    })
    await call('savedQueries:list', { environmentId: envId })
    await call('savedQueries:delete', { id: (saved.data as { id: string }).id })

    expect(Object.keys(handlers).filter((channel) => !called.has(channel))).toEqual([])
    for (const output of outputs) {
      expect(output).not.toContain('SECRETOMODULOS')
      expect(output).not.toContain('enc:')
    }
  })
})
