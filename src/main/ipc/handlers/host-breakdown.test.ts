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
 * Ficha 0017: canal `entities:hostBreakdown` (detalle por disco y los 10 procesos
 * con más CPU de una entidad HOST), con el cliente de Dynatrace REAL sobre un fetch
 * falso. Se comprueba qué se pide a /metrics/query y cómo llega la respuesta.
 *
 * El fetch falso imita lo observado en vivo (paso 0 de la ficha):
 * - las 7 candidatas existen: `builtin:host.disk.usedPct` (Percent, 0–100),
 *   `.disk.used` y `.disk.avail` (Byte), `.disk.bytesRead` y `.disk.bytesWritten`
 *   (BytePerSecond), con las dimensiones `dt.entity.host` y `dt.entity.disk`;
 *   `builtin:tech.generic.cpu.usage` (Percent) y `.mem.workingSetSize` (Byte), con
 *   la dimensión `dt.entity.process_group_instance` (sin `dt.entity.host`);
 * - discos: con `entitySelector=entityId("<host>")`, una serie por disco;
 * - procesos: solo los limita al host el `entitySelector` por relación
 *   (`type("PROCESS_GROUP_INSTANCE"),fromRelationships.isProcessOf(entityId("<host>"))`)
 *   o el mismo selector dentro de un `filter(in(..., entitySelector(...)))`. Un
 *   filtro por `dt.entity.host` o `entityId("<host>")` a secas dan 200 sin series;
 * - los nombres de disco y proceso solo llegan en `dimensionMap`
 *   (`dt.entity.disk.name`, `dt.entity.process_group_instance.name`) si la
 *   expresión lleva `:names`;
 * - `:last` con `resolution=Inf` da 400, igual que `:fold(...)` con Inf (ficha 0006);
 * - el último punto de la serie llega a null;
 * - `bytesRead` y `bytesWritten` pueden traer discos que no están en `usedPct`.
 *
 * Los datos son coherentes entre las formas de pedirlos: la media de la serie es la
 * media con Inf, su máximo el máximo con Inf y su último punto con dato el último.
 */

const TRUSTED = { url: 'app://vigia/index.html', isMainFrame: true }
const TOKEN = `dt0c01.PUBLICAPRUEBA0000000000A.${'SECRETODISCO'.padEnd(64, 'X')}`
const BASE = 'https://abc12345.live.dynatrace.com'
const CHANNEL = 'entities:hostBreakdown' as IpcChannel
/** Ids inventados, con el formato de Dynatrace. */
const HOST_ID = 'HOST-0123456789ABCDEF'
const OTHER_HOST = 'HOST-FEDCBA9876543210'
const T0 = Date.parse('2026-10-03T08:00:00.000Z')
const T = [T0, T0 + 60_000, T0 + 120_000, T0 + 180_000]

const DISK_PCT = 'builtin:host.disk.usedPct'
const DISK_USED = 'builtin:host.disk.used'
const DISK_AVAIL = 'builtin:host.disk.avail'
const DISK_READ = 'builtin:host.disk.bytesRead'
const DISK_WRITE = 'builtin:host.disk.bytesWritten'
const PROC_CPU = 'builtin:tech.generic.cpu.usage'
const PROC_MEM = 'builtin:tech.generic.mem.workingSetSize'
const DISK_METRICS = [DISK_PCT, DISK_USED, DISK_AVAIL, DISK_READ, DISK_WRITE]
const PROCESS_METRICS = [PROC_CPU, PROC_MEM]
const DISK_DIM = 'dt.entity.disk'
const PGI_DIM = 'dt.entity.process_group_instance'

/** Último punto con dato, media y máximo de una serie (lo que se pide de cada una). */
interface Stats {
  last: number
  avg: number
  max: number
}
interface FakeDisk {
  id: string
  name: string | null
  metrics: Partial<Record<string, Stats>>
}
interface FakeProcess {
  id: string
  name: string | null
  cpu: Stats
  memory: Stats
}

/** Serie de 4 puntos con ese último dato, esa media y ese máximo; el último punto, null. */
function seriesOf(stats: Stats): (number | null)[] {
  return [stats.max, 3 * stats.avg - stats.max - stats.last, stats.last, null]
}

const flat = (value: number): Stats => ({ last: value, avg: value, max: value })

const diskId = (n: number): string => `DISK-00000000000000${String(n).padStart(2, '0')}`
const pgiId = (n: number): string =>
  `PROCESS_GROUP_INSTANCE-00000000000000${String(n).padStart(2, '0')}`

/**
 * Tres discos. Por último dato de uso: /datos (91), /var (72), / (55). Por máximo
 * del rango el orden sería otro (/var 95, /datos 93, / 60).
 */
function threeDisks(): FakeDisk[] {
  return [
    {
      id: diskId(1),
      name: '/',
      metrics: {
        [DISK_PCT]: { last: 55, avg: 50, max: 60 },
        [DISK_USED]: { last: 55_000_000_000, avg: 54_000_000_000, max: 56_000_000_000 },
        [DISK_AVAIL]: { last: 45_000_000_000, avg: 46_000_000_000, max: 47_000_000_000 },
        [DISK_READ]: { last: 1000, avg: 1200, max: 2000 },
        [DISK_WRITE]: { last: 500, avg: 800, max: 1500 }
      }
    },
    {
      id: diskId(2),
      name: '/datos',
      metrics: {
        [DISK_PCT]: { last: 91, avg: 90, max: 93 },
        [DISK_USED]: { last: 910_000_000_000, avg: 900_000_000_000, max: 930_000_000_000 },
        [DISK_AVAIL]: { last: 90_000_000_000, avg: 100_000_000_000, max: 110_000_000_000 },
        [DISK_READ]: { last: 30_000, avg: 25_000, max: 40_000 },
        [DISK_WRITE]: { last: 9000, avg: 12_000, max: 20_000 }
      }
    },
    {
      id: diskId(3),
      name: '/var',
      metrics: {
        [DISK_PCT]: { last: 72, avg: 80, max: 95 },
        [DISK_USED]: { last: 7_200_000_000, avg: 8_000_000_000, max: 9_500_000_000 },
        [DISK_AVAIL]: { last: 2_800_000_000, avg: 2_000_000_000, max: 3_000_000_000 },
        [DISK_READ]: { last: 0, avg: 100, max: 250 },
        [DISK_WRITE]: { last: 3000, avg: 4000, max: 7000 }
      }
    }
  ]
}

/** CPU media de los 15 procesos (en este orden); la máxima ordena distinto. */
const CPU_AVG = [3, 47, 12, 0.5, 33, 8, 21, 64, 1.5, 17, 5, 29, 2, 40, 10]
const CPU_MAX = [5, 52, 20, 0.9, 63, 9, 40, 70, 2.5, 33, 9.5, 30, 3, 41, 19]

function fifteenProcesses(): FakeProcess[] {
  return CPU_AVG.map((avg, i) => ({
    id: pgiId(i + 1),
    name: `proceso-${String(i + 1).padStart(2, '0')}`,
    cpu: { last: avg, avg, max: CPU_MAX[i] ?? avg },
    memory: flat((i + 1) * 100_000_000)
  }))
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

/** Separa un metricSelector por las comas de primer nivel (no las de dentro de paréntesis). */
function splitSelector(selector: string): string[] {
  const parts: string[] = []
  let depth = 0
  let quoted = false
  let current = ''
  for (const char of selector) {
    if (char === '"') quoted = !quoted
    if (!quoted && char === '(') depth += 1
    if (!quoted && char === ')') depth -= 1
    if (!quoted && depth === 0 && char === ',') {
      parts.push(current)
      current = ''
      continue
    }
    current += char
  }
  if (current !== '') parts.push(current)
  return parts
}

/** Clave de la métrica (lo que va antes de la primera transformación). */
const keyOf = (expression: string): string =>
  /^builtin:[A-Za-z.]+/.exec(expression)?.[0].replace(/\.$/, '') ?? ''
const has = (expression: string, transformation: string): boolean =>
  new RegExp(`:${transformation}\\b`).test(expression)
/** Sin comillas ni espacios, para comparar selectores escritos de formas equivalentes. */
const compact = (text: string): string => text.replace(/["\s]/g, '')

/** ¿La consulta limita los discos al host pedido (entitySelector o filtro en la expresión)? */
function disksScoped(expression: string, query: URLSearchParams): boolean {
  const scope = compact(query.get('entitySelector') ?? '')
  return scope === `entityId(${HOST_ID})` || compact(expression).includes(HOST_ID)
}

/** El selector por relación que, en vivo, deja los procesos del host. */
const RELATION = `fromRelationships.isProcessOf(entityId(${HOST_ID}))`

/** ¿La consulta limita los procesos al host (por relación, en entitySelector o en un filtro in)? */
function processesScoped(expression: string, query: URLSearchParams): boolean {
  const scope = compact(query.get('entitySelector') ?? '')
  const inScope = scope.includes('type(PROCESS_GROUP_INSTANCE)') && scope.includes(RELATION)
  const inFilter =
    compact(expression).includes('entitySelector(') &&
    compact(expression).includes('type(PROCESS_GROUP_INSTANCE)') &&
    compact(expression).includes(RELATION)
  return inScope || inFilter
}

/** Valor de un punto único (Inf o fold) según la agregación y el fold de la expresión. */
function singleValue(expression: string, stats: Stats): number {
  const fold = /:fold\((\w*)\)/.exec(expression)?.[1]
  if (fold === 'max') return stats.max
  if (fold === 'last' || fold === 'value') return stats.last
  if (fold === undefined && has(expression, 'max')) return stats.max
  return stats.avg
}

let disks: FakeDisk[]
let processes: FakeProcess[]
/** Disco que solo sale en bytesRead y bytesWritten (en vivo pasa en algunos hosts). */
let ioOnlyDisk: FakeDisk | null
let failWith: { status: number; message: string } | null
let empty: 'result' | 'data' | null

interface Item {
  id: string
  name: string | null
  stats: Stats
}

/** Las entidades (disco o proceso) con dato para una expresión. */
function itemsOf(expression: string, query: URLSearchParams): Item[] {
  const key = keyOf(expression)
  if (DISK_METRICS.includes(key)) {
    if (!disksScoped(expression, query)) return []
    const all = [...disks, ...(ioOnlyDisk === null ? [] : [ioOnlyDisk])]
    return all.flatMap((disk) => {
      const stats = disk.metrics[key]
      return stats === undefined ? [] : [{ id: disk.id, name: disk.name, stats }]
    })
  }
  if (PROCESS_METRICS.includes(key)) {
    if (!processesScoped(expression, query)) return []
    return processes.map((p) => ({
      id: p.id,
      name: p.name,
      stats: key === PROC_CPU ? p.cpu : p.memory
    }))
  }
  return []
}

function metricsResponse(query: URLSearchParams): Response {
  if (failWith !== null) {
    return json(failWith.status, { error: { code: failWith.status, message: failWith.message } })
  }
  const selector = query.get('metricSelector') ?? ''
  const inf = query.get('resolution') === 'Inf'
  // Observado en vivo: fold (ficha 0006) y :last (ficha 0017) con resolution=Inf dan 400.
  if (inf && (selector.includes(':fold(') || /:last\b/.test(selector))) {
    return json(400, { error: { code: 400, message: 'Transformación no admitida con Inf' } })
  }
  const single = inf || selector.includes(':fold(')
  const result =
    empty === 'result'
      ? []
      : splitSelector(selector).map((expression) => {
          const key = keyOf(expression)
          const dimension = DISK_METRICS.includes(key) ? DISK_DIM : PGI_DIM
          let items = itemsOf(expression, query)
          // sort(value(...,descending|ascending)) y limit(n), como en vivo.
          const sort = /:sort\(value\(\w+,(descending|ascending)\)\)/.exec(expression)?.[1]
          if (sort !== undefined) {
            const value = (item: Item): number =>
              single ? singleValue(expression, item.stats) : item.stats.avg
            items = [...items].sort((a, b) =>
              sort === 'descending' ? value(b) - value(a) : value(a) - value(b)
            )
          }
          const limit = /:limit\((\d+)\)/.exec(expression)?.[1]
          if (limit !== undefined) items = items.slice(0, Number(limit))
          const names = has(expression, 'names')
          return {
            metricId: expression,
            dataPointCountRatio: 0.005,
            dimensionCountRatio: 0.005,
            data:
              empty === 'data'
                ? []
                : items.map((item) => {
                    const dimensionMap: Record<string, string> =
                      dimension === DISK_DIM
                        ? { [DISK_DIM]: item.id, 'dt.entity.host': HOST_ID }
                        : { [PGI_DIM]: item.id }
                    if (names && item.name !== null) dimensionMap[`${dimension}.name`] = item.name
                    if (names && dimension === DISK_DIM) {
                      dimensionMap['dt.entity.host.name'] = 'servidor-prueba'
                    }
                    return {
                      dimensionMap,
                      dimensions: Object.values(dimensionMap),
                      timestamps: single ? [T0 + 240_000] : T,
                      values: single ? [singleValue(expression, item.stats)] : seriesOf(item.stats)
                    }
                  })
          }
        })
  return json(200, {
    totalCount: result.length,
    nextPageKey: null,
    resolution: inf ? 'Inf' : '1m',
    result
  })
}

let requests: URL[]
let db: AppDatabase
let envId: string
let deps: IpcHandlerDeps
let handlers: ReturnType<typeof createModuleHandlers>

const fakeFetch = vi.fn(async (input: unknown) => {
  const url = new URL(String(input instanceof Request ? input.url : input))
  requests.push(url)
  if (url.pathname === '/api/v2/metrics/query') return metricsResponse(url.searchParams)
  return json(404, { error: { code: 404, message: 'No existe' } })
})

beforeEach(() => {
  requests = []
  failWith = null
  empty = null
  disks = threeDisks()
  processes = fifteenProcesses()
  ioOnlyDisk = null

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

interface Envelope {
  ok: boolean
  data?: unknown
  error?: { code: string; message: string; reason?: { key: string } }
}

async function call(input: unknown): Promise<Envelope> {
  const implementation = (handlers as Record<string, unknown>)[CHANNEL] as IpcImplementation<
    typeof CHANNEL
  >
  expect(implementation, `implementación de ${CHANNEL}`).toBeTypeOf('function')
  const result = (await createIpcHandler(CHANNEL, implementation, deps)(TRUSTED, input)) as Envelope
  expect(JSON.stringify(result)).not.toContain('SECRETODISCO')
  return result
}

const metricQueries = (): URL[] => requests.filter((u) => u.pathname === '/api/v2/metrics/query')
const expressionsOf = (url: URL): string[] =>
  splitSelector(url.searchParams.get('metricSelector') ?? '')

interface Disk {
  id: string
  name: string
  usedPct: { last: number | null; max: number | null }
  used: number | null
  avail: number | null
  read: number | null
  write: number | null
}
interface Process {
  id: string
  name: string
  cpu: { avg: number | null; max: number | null }
  memory: number | null
}
interface Breakdown {
  disks: Disk[]
  processes: { items: Process[]; total: number }
}

const base = { entityId: HOST_ID, timeRange: '2h' as const }

describe('CA2 (0017): las consultas llevan las métricas confirmadas, el id del host en su selector y el rango', () => {
  it.each([
    ['relativo (2h)', '2h' as const, { from: 'now-2h', to: null }],
    [
      'absoluto',
      { from: '2026-10-01T08:00:00.000Z', to: '2026-10-01T10:00:00.000Z' },
      { from: '2026-10-01T08:00:00.000Z', to: '2026-10-01T10:00:00.000Z' }
    ]
  ])('rango %s', async (_case, timeRange, expected) => {
    const result = await call({ environmentId: envId, entityId: HOST_ID, timeRange })
    expect(result.ok, JSON.stringify(result.error)).toBe(true)

    // Solo consultas a /metrics/query (los nombres salen de dimensionMap, no de /entities).
    expect(requests.length).toBeGreaterThan(0)
    expect(metricQueries()).toHaveLength(requests.length)

    const keys = new Set<string>()
    for (const url of metricQueries()) {
      const expressions = expressionsOf(url)
      // Como mucho 10 métricas por consulta (OpenAPI v2, metricSelector).
      expect(expressions.length).toBeGreaterThan(0)
      expect(expressions.length).toBeLessThanOrEqual(10)
      // El rango global en todas.
      expect(url.searchParams.get('from')).toBe(expected.from)
      expect(url.searchParams.get('to')).toBe(expected.to)
      for (const expression of expressions) {
        const key = keyOf(expression)
        keys.add(key)
        // Solo las métricas confirmadas en el paso 0.
        expect([...DISK_METRICS, ...PROCESS_METRICS]).toContain(key)
        // Discos acotados con entityId del host; procesos, por la relación isProcessOf.
        if (DISK_METRICS.includes(key)) {
          expect(disksScoped(expression, url.searchParams), `disco: ${expression}`).toBe(true)
        } else {
          expect(processesScoped(expression, url.searchParams), `proceso: ${expression}`).toBe(true)
        }
      }
    }
    // Las 7 métricas confirmadas, entre todas las consultas.
    expect([...keys].sort()).toEqual([...DISK_METRICS, ...PROCESS_METRICS].sort())
  })

  it('el id entra en los selectores tal cual: otro host no recibe los datos de este', async () => {
    const result = await call({ environmentId: envId, entityId: OTHER_HOST, timeRange: '2h' })
    expect(result.ok, JSON.stringify(result.error)).toBe(true)
    for (const url of metricQueries()) {
      expect(url.searchParams.toString()).not.toContain(HOST_ID)
      expect(url.searchParams.toString()).toContain(OTHER_HOST)
    }
    expect(result.data).toMatchObject({ disks: [], processes: { items: [], total: 0 } })
  })

  it.each([
    ['otro tipo', 'SERVICE-0123456789ABCDEF'],
    ['inyección tras un id válido', 'HOST-0123456789ABCDEF")),type("SERVICE'],
    ['minúsculas', 'HOST-0123456789abcdef']
  ])('un id que no es de host (%s) se rechaza sin llamar a Dynatrace', async (_case, entityId) => {
    const result = await call({ environmentId: envId, entityId, timeRange: '2h' })
    expect(result.ok).toBe(false)
    expect(requests).toHaveLength(0)
  })

  it('la interfaz no manda selectores: un metricSelector en la entrada no llega a Dynatrace', async () => {
    const result = await call({
      environmentId: envId,
      ...base,
      metricSelector: 'builtin:tenant.otra'
    })
    for (const url of metricQueries()) {
      expect(url.searchParams.get('metricSelector') ?? '').not.toContain('builtin:tenant.otra')
    }
    if (result.ok) expect(metricQueries().length).toBeGreaterThan(0)
  })
})

describe('CA3 (0017): 3 discos ordenados por uso y los 10 procesos con más CPU de 15', () => {
  it('discos del más lleno al menos (último dato de uso), con último dato, máximo, bytes y bytes/s', async () => {
    const result = await call({ environmentId: envId, ...base })
    expect(result.ok, JSON.stringify(result.error)).toBe(true)
    const data = result.data as Breakdown
    expect(data.disks).toMatchObject([
      {
        id: diskId(2),
        name: '/datos',
        usedPct: { last: 91, max: 93 },
        used: 910_000_000_000,
        avail: 90_000_000_000,
        read: 25_000,
        write: 12_000
      },
      {
        id: diskId(3),
        name: '/var',
        usedPct: { last: 72, max: 95 },
        used: 7_200_000_000,
        avail: 2_800_000_000,
        read: 100,
        write: 4000
      },
      {
        id: diskId(1),
        name: '/',
        usedPct: { last: 55, max: 60 },
        used: 55_000_000_000,
        avail: 45_000_000_000,
        read: 1200,
        write: 800
      }
    ])
  })

  it('los 10 procesos con más CPU media, de más a menos, con CPU media y máxima, memoria media y total 15', async () => {
    const result = await call({ environmentId: envId, ...base })
    expect(result.ok, JSON.stringify(result.error)).toBe(true)
    const data = result.data as Breakdown
    const expected = CPU_AVG.map((avg, i) => ({ avg, i }))
      .sort((a, b) => b.avg - a.avg)
      .slice(0, 10)
      .map(({ avg, i }) => ({
        id: pgiId(i + 1),
        name: `proceso-${String(i + 1).padStart(2, '0')}`,
        cpu: { avg, max: CPU_MAX[i] },
        memory: (i + 1) * 100_000_000
      }))
    // 64, 47, 40, 33, 29, 21, 17, 12, 10 y 8 (por la máxima el orden sería otro).
    expect(expected.map((p) => p.cpu.avg)).toEqual([64, 47, 40, 33, 29, 21, 17, 12, 10, 8])
    expect(data.processes.items).toMatchObject(expected)
    expect(data.processes.total).toBe(15)
  })

  it('todos los discos: uno que solo trae lectura y escritura va al final, sin uso', async () => {
    ioOnlyDisk = {
      id: diskId(4),
      name: 'sdb',
      metrics: {
        [DISK_READ]: { last: 10, avg: 20, max: 40 },
        [DISK_WRITE]: { last: 30, avg: 40, max: 60 }
      }
    }
    const result = await call({ environmentId: envId, ...base })
    expect(result.ok, JSON.stringify(result.error)).toBe(true)
    const data = result.data as Breakdown
    expect(data.disks.map((d) => d.id)).toEqual([diskId(2), diskId(3), diskId(1), diskId(4)])
    expect(data.disks[3]).toMatchObject({
      id: diskId(4),
      name: 'sdb',
      usedPct: { last: null, max: null },
      used: null,
      avail: null,
      read: 20,
      write: 40
    })
  })
})

describe('CA4 (0017): nombres de dimensionMap y, si falta, el id', () => {
  it('nombre de disco y de proceso de dimensionMap; sin nombre, el id', async () => {
    disks = threeDisks().map((disk) => (disk.id === diskId(3) ? { ...disk, name: null } : disk))
    processes = fifteenProcesses().map((p) => (p.id === pgiId(8) ? { ...p, name: null } : p))
    const result = await call({ environmentId: envId, ...base })
    expect(result.ok, JSON.stringify(result.error)).toBe(true)
    const data = result.data as Breakdown
    expect(data.disks.map((d) => [d.id, d.name])).toEqual([
      [diskId(2), '/datos'],
      [diskId(3), diskId(3)],
      [diskId(1), '/']
    ])
    // El de más CPU (64 %) es el 8, sin nombre; el segundo (47 %) es el 2.
    expect(data.processes.items[0]).toMatchObject({ id: pgiId(8), name: pgiId(8) })
    expect(data.processes.items[1]).toMatchObject({ id: pgiId(2), name: 'proceso-02' })
  })
})

describe('CA5 (0017): errores de Dynatrace y host sin datos', () => {
  it.each([400, 404])('un %i acaba en error con reason', async (status) => {
    failWith = { status, message: 'Mensaje de Dynatrace en la prueba' }
    const result = await call({ environmentId: envId, ...base })
    expect(result.ok).toBe(false)
    expect(result.error?.reason?.key, 'reason del error').toEqual(expect.any(String))
  })

  it.each([
    ['sin resultados (result vacío)', 'result' as const],
    ['resultados sin series (data vacío)', 'data' as const]
  ])('%s: listas vacías y total 0, sin error', async (_case, kind) => {
    empty = kind
    const result = await call({ environmentId: envId, ...base })
    expect(result.ok, JSON.stringify(result.error)).toBe(true)
    expect(result.data).toMatchObject({ disks: [], processes: { items: [], total: 0 } })
  })
})
