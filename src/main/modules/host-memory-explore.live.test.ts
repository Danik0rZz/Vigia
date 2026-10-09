import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createLiveClient } from '../../test/live-client'
import { loadLiveEnv } from '../../test/live-env'
import { DtError } from '../dynatrace/errors'

/**
 * Ficha 0039, paso 0: EXPLORACIÓN EN VIVO de la memoria recuperable de un host,
 * SOLO LECTURA, una petición detrás de otra y unas 15 como mucho.
 *
 * Descriptor de `builtin:host.mem.recl` (o, si no existe, búsqueda con
 * `text=reclaimable`), y datos de usada, recuperable y total en como mucho 3
 * hosts de type("HOST") con now-2h. Además, si la consulta de series de la 0016
 * admite una expresión más (la API documenta 10 métricas por consulta).
 *
 * El informe (live-reports/host-memory-explore.json, ignorado) guarda SOLO
 * comportamientos: códigos, unidad, agregaciones, tramos y relaciones. Nunca un
 * id, un nombre ni un valor. CA1 (0039) comprueba que no se cuela ninguno.
 */

const env = loadLiveEnv()
const live = env === null ? null : createLiveClient(env)
const report: Record<string, unknown> = {}
const observed = new Set<string>()
const MAX_HOSTS = 3

const MEM = 'builtin:host.mem.usage'
const MEM_USED = 'builtin:host.mem.used'
const MEM_TOTAL = 'builtin:host.mem.total'
const MEM_RECL = 'builtin:host.mem.recl'

/** Las 10 expresiones de series de la 0016, más la recuperable. */
const SERIES_PLUS_RECL = [
  'builtin:host.cpu.usage',
  'builtin:host.cpu.user',
  'builtin:host.cpu.system',
  'builtin:host.cpu.iowait',
  MEM,
  MEM_USED,
  MEM_TOTAL,
  'builtin:host.net.nic.trafficIn:splitBy():sum',
  'builtin:host.net.nic.trafficOut:splitBy():sum',
  'builtin:host.disk.usedPct:splitBy():max',
  MEM_RECL
]

type Raw = Record<string, unknown>

async function get(path: string, query: Record<string, string | number>): Promise<unknown> {
  if (live === null) throw new Error('sin .env.live.local')
  return live.client.dtRequest({ envId: 'live', api: 'classic', path, query, schema: z.unknown() })
}

/** Código del error, sin su mensaje (puede llevar el selector, con el id). */
async function codeOf(promise: Promise<unknown>): Promise<{ code: string; body: Raw | null }> {
  try {
    return { code: 'ok', body: (await promise) as Raw }
  } catch (error) {
    return {
      code:
        error instanceof DtError
          ? `${error.code}${error.status === undefined ? '' : ` ${error.status}`}`
          : 'NO_DT_ERROR',
      body: null
    }
  }
}

const lastOf = (values: (number | null)[]): number | null =>
  [...values].reverse().find((v) => v !== null) ?? null

/** Tramo de un valor (¿bytes?), nunca el valor. */
function range(value: number | null): string {
  if (value === null) return 'null'
  if (value < 0) return '< 0'
  if (value <= 100) return '[0, 100]'
  if (value <= 1e6) return '(100, 1e6]'
  if (value <= 1e9) return '(1e6, 1e9]'
  return '> 1e9'
}

/** Relación entre dos números, sin los números. */
function relation(a: number | null, b: number | null): string {
  if (a === null || b === null) return 'sin datos'
  const scale = Math.max(Math.abs(a), Math.abs(b), 1)
  if (Math.abs(a - b) / scale < 0.01) return 'casi iguales (< 1 %)'
  return a < b ? 'menor' : 'mayor'
}

function firstSeries(body: Raw | null, index: number): (number | null)[] {
  const results = (Array.isArray(body?.['result']) ? body['result'] : []) as Raw[]
  const data = (results[index]?.['data'] as Raw[] | undefined) ?? []
  return (data[0]?.['values'] as (number | null)[] | undefined) ?? []
}

function seriesCount(body: Raw | null, index: number): number {
  const results = (Array.isArray(body?.['result']) ? body['result'] : []) as Raw[]
  return ((results[index]?.['data'] as Raw[] | undefined) ?? []).length
}

afterAll(() => {
  if (live === null || env === null) return
  report['tokenEnLog'] = live.logged.some((line) => line.includes(env.token))
  mkdirSync('live-reports', { recursive: true })
  writeFileSync(
    join('live-reports', 'host-memory-explore.json'),
    `${JSON.stringify(report, null, 2)}\n`
  )
})

describe.skipIf(live === null)('Ficha 0039: memoria recuperable de un host (paso 0)', () => {
  const hosts: string[] = []

  it('elige como mucho 3 hosts', async () => {
    const page = (await get('/entities', {
      entitySelector: 'type("HOST")',
      from: 'now-2h',
      pageSize: MAX_HOSTS
    })) as Raw
    for (const entity of (page['entities'] as Raw[] | undefined) ?? []) {
      const id = String(entity['entityId'])
      observed.add(id)
      if (typeof entity['displayName'] === 'string') observed.add(entity['displayName'])
      if (!hosts.includes(id)) hosts.push(id)
    }
    hosts.splice(MAX_HOSTS)
    report['hosts'] = hosts.length
    expect(hosts.length).toBeGreaterThan(0)
  })

  it('descriptor de la recuperable (y búsqueda si no existe)', async () => {
    const { code, body } = await codeOf(get(`/metrics/${encodeURIComponent(MEM_RECL)}`, {}))
    if (body === null) {
      const search = await codeOf(get('/metrics', { text: 'reclaimable', pageSize: 50 }))
      report['descriptor'] = {
        existe: false,
        codigo: code,
        busqueda: search.code,
        // Solo las integradas del host: las propias del tenant no se anotan.
        integradasDelHost: ((search.body?.['metrics'] as Raw[] | undefined) ?? [])
          .map((m) => String(m['metricId']))
          .filter((id) => id.startsWith('builtin:host.'))
      }
      return
    }
    report['descriptor'] = {
      existe: true,
      codigo: code,
      displayName: body['displayName'] ?? null,
      // Texto de Dynatrace para la métrica integrada (igual en todos los tenants).
      description: body['description'] ?? null,
      unit: body['unit'] ?? null,
      defaultAggregation: body['defaultAggregation'] ?? null,
      aggregationTypes: body['aggregationTypes'] ?? null,
      resolutionInfSupported: body['resolutionInfSupported'] ?? null,
      entityType: body['entityType'] ?? null,
      dimensiones: ((body['dimensionDefinitions'] as Raw[] | undefined) ?? []).map(
        (d) => `${String(d['key'])} (${String(d['type'])})`
      )
    }
  })

  it('datos de usada, recuperable y total por host, y su relación', async () => {
    const rows: unknown[] = []
    for (const [index, id] of hosts.entries()) {
      const { code, body } = await codeOf(
        get('/metrics/query', {
          metricSelector: [MEM_USED, MEM_RECL, MEM_TOTAL, MEM].join(','),
          entitySelector: `entityId("${id}")`,
          from: 'now-2h'
        })
      )
      const used = firstSeries(body, 0)
      const recl = firstSeries(body, 1)
      const total = firstSeries(body, 2)
      const usage = firstSeries(body, 3)
      const lastUsed = lastOf(used)
      const lastRecl = lastOf(recl)
      const lastTotal = lastOf(total)
      rows.push({
        host: `#${index + 1}`,
        codigo: code,
        resolution: body?.['resolution'] ?? null,
        seriesDeLaRecuperable: seriesCount(body, 1),
        recuperableConDato: lastRecl !== null,
        tramoRecuperable: range(lastRecl),
        ultimoPuntoNull: (recl.at(-1) ?? null) === null,
        mismosPuntosQueUsada: recl.length === used.length,
        recuperableFrenteATotal: relation(lastRecl, lastTotal),
        usadaMasRecuperableFrenteATotal:
          lastUsed === null || lastRecl === null
            ? 'sin datos'
            : relation(lastUsed + lastRecl, lastTotal),
        usadaEntreTotalFrenteAUsage:
          lastUsed === null || lastTotal === null || lastTotal === 0
            ? 'sin datos'
            : relation((lastUsed * 100) / lastTotal, lastOf(usage)),
        // ¿«usada» ya incluye la recuperable? (usada + recuperable sobre 100 % sería señal)
        usadaMasRecuperableEntreTotalFrenteAUsage:
          lastUsed === null || lastRecl === null || lastTotal === null || lastTotal === 0
            ? 'sin datos'
            : relation(((lastUsed + lastRecl) * 100) / lastTotal, lastOf(usage))
      })
    }
    report['por host'] = rows
  })

  it('la consulta de series de la 0016 con la recuperable (11 expresiones)', async () => {
    const id = hosts[0]
    if (id === undefined) return
    const { code, body } = await codeOf(
      get('/metrics/query', {
        metricSelector: SERIES_PLUS_RECL.join(','),
        entitySelector: `entityId("${id}")`,
        from: 'now-2h'
      })
    )
    report['once expresiones en una consulta'] = {
      codigo: code,
      resultados: Array.isArray(body?.['result']) ? (body['result'] as unknown[]).length : 0
    }
  })

  it('CA1 (0039): el informe dice si la recuperable existe, su unidad y si hay datos, sin ids ni nombres', () => {
    const descriptor = report['descriptor'] as Raw | undefined
    expect(descriptor, 'descriptor en el informe').toBeDefined()
    expect(typeof descriptor?.['existe']).toBe('boolean')
    if (descriptor?.['existe'] === true) {
      expect(descriptor['unit'], 'unidad de la recuperable').toEqual(expect.any(String))
      const rows = report['por host'] as Raw[]
      expect(rows.length).toBeGreaterThan(0)
      for (const row of rows) expect(typeof row['recuperableConDato']).toBe('boolean')
    }
    const text = JSON.stringify(report)
    for (const value of observed) {
      if (value.length < 4) continue
      expect(text.includes(value), 'el informe contiene un id o un nombre observado').toBe(false)
    }
    expect(observed.size).toBeGreaterThan(0)
  })
})
