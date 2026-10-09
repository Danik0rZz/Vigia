import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createLiveClient } from '../../test/live-client'
import { loadLiveEnv } from '../../test/live-env'
import { DtError } from '../dynatrace/errors'

/**
 * Ficha 0042, paso 0: EXPLORACIÓN EN VIVO de los eventos de un host y de lo que corre en él.
 * SOLO LECTURA, una petición detrás de otra (unas 60 como mucho).
 *
 * 1. Scope: `GET /events?pageSize=1`. Sin `events.read` (403) se anota y se salta lo demás.
 * 2. Hosts: de `type("HOST")`, como mucho 6 candidatos; de cada uno, `GET /entities/{id}` con
 *    `+fromRelationships,+toRelationships` (qué relaciones y tipos trae: nombres de la API).
 *    Se eligen como mucho 3 con eventos en el rango, propios o de lo relacionado.
 * 3. Forma A (la de la ficha): `eventSelector=entityId("<host>","<id-2>",…)` con el host y los
 *    ids de sus relaciones (RELATIONS). Código, recuento y longitud del selector.
 * 4. Forma B: una consulta por tipo con `entitySelector` y la relación con el host
 *    (`type("PROCESS_GROUP_INSTANCE"),fromRelationships.isProcessOf(entityId("<host>"))`…), más
 *    `entitySelector=entityId("<host>")`. ¿Trae lo mismo que A (recuentos y eventIds)?
 * 5. Cuántos ids caben en `eventSelector`: el host y sus ids reales, rellenados con ids
 *    INVENTADOS de formato válido (`PROCESS_GROUP_INSTANCE-0000000000000000`…), en tramos.
 * 6. Forma de un evento (claves, tipos, `status`, `endTime` de los activos, `entityId`), orden de
 *    la respuesta, `pageSize=20` con `totalCount`, y rango absoluto frente a relativo.
 *
 * El parámetro `optionalEntitySelector` de la interfaz de Dynatrace NO está en la OpenAPI: aquí no
 * se usa.
 *
 * El informe (live-reports/host-events-explore.json, ignorado) guarda SOLO comportamientos,
 * códigos, recuentos en tramos, claves y valores de enumeración de la API y tipos estándar de
 * entidad y de evento. Nunca un id, un nombre ni un título. CA1 (0042) lo comprueba.
 */

const env = loadLiveEnv()
const live = env === null ? null : createLiveClient(env)
const report: Record<string, unknown> = {}
const timings: number[] = []
/** Ids, nombres y títulos observados: el informe no puede contener ninguno (CA1). */
const observed = new Set<string>()
const MAX_CANDIDATES = 6
const MAX_HOSTS = 3
const FROM = 'now-24h'
/**
 * Relaciones de la ficha, con su dirección vista desde el host (`to:` = la entidad apunta al host).
 * El nodo de Kubernetes llega por `to:isNodeOfHost` (no por `runsOn`); `to:runsOn` es el
 * PROCESS_GROUP, que no se pide (ya están sus instancias).
 */
const RELATIONS = [
  'to:isProcessOf',
  'to:isDiskOf',
  'to:isNetworkInterfaceOf',
  'to:isCgiOfHost',
  'to:isNodeOfHost',
  'from:runsOn'
]
const inRelations = (r: Related): boolean => RELATIONS.includes(`${r.direction}:${r.relation}`)

type Raw = Record<string, unknown>
interface Related {
  id: string
  type: string
  relation: string
  direction: 'from' | 'to'
}

/** Valores de enumeración de la API (`OPEN`, `HOST`…): no son datos del tenant. */
const isEnum = (value: string): boolean => /^[A-Z][A-Z0-9_]*$/.test(value)
/** Nombre de clave de la API: solo letras, puntos y guiones bajos (no se cuela un valor). */
const apiKey = (key: string): string => (/^[A-Za-z][A-Za-z0-9_.:-]*$/.test(key) ? key : 'otra')

const bucket = (count: number): string =>
  count === 0
    ? '0'
    : count === 1
      ? '1'
      : count < 10
        ? '2-9'
        : count < 20
          ? '10-19'
          : count < 50
            ? '20-49'
            : count < 200
              ? '50-199'
              : count < 1000
                ? '200-999'
                : '>= 1000'

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

/** Código del error, sin su mensaje (puede llevar el selector, con los ids). */
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

function typeOf(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

const quoted = (ids: readonly string[]): string => ids.map((id) => `"${id}"`).join(',')
const eventsOf = (body: Raw | null): Raw[] =>
  (Array.isArray(body?.['events']) ? body['events'] : []) as Raw[]
const totalOf = (body: Raw | null): number | null =>
  typeof body?.['totalCount'] === 'number' ? body['totalCount'] : null
const eventIdOf = (event: Raw): string => String(event['eventId'])
const entityOf = (event: Raw): { id: string; type: string; name: unknown } => {
  const stub = (event['entityId'] ?? {}) as Raw
  const inner = (stub['entityId'] ?? {}) as Raw
  return { id: String(inner['id']), type: String(inner['type']), name: stub['name'] }
}

function observeEvent(event: Raw): void {
  observed.add(eventIdOf(event))
  if (typeof event['title'] === 'string') observed.add(event['title'])
  if (typeof event['correlationId'] === 'string') observed.add(event['correlationId'])
  const entity = entityOf(event)
  observed.add(entity.id)
  if (typeof entity.name === 'string') observed.add(entity.name)
}

/** Relaciones de la entidad: `{ nombre: [{ id, type }] }` en cada dirección. */
function relationsOf(entity: Raw): Related[] {
  const related: Related[] = []
  for (const direction of ['from', 'to'] as const) {
    const group = (entity[`${direction}Relationships`] ?? {}) as Raw
    for (const [relation, list] of Object.entries(group)) {
      for (const item of Array.isArray(list) ? (list as Raw[]) : []) {
        const id = String(item['id'])
        observed.add(id)
        related.push({ id, type: String(item['type']), relation, direction })
      }
    }
  }
  return related
}

interface Host {
  id: string
  related: Related[]
}
const hosts: Host[] = []
let hasScope = false

/** Ids de la forma A: el host y los de las relaciones de la ficha, sin repetir. */
const idsOf = (host: Host): string[] => [
  host.id,
  ...new Set(host.related.filter(inRelations).map((r) => r.id))
]

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
    join('live-reports', 'host-events-explore.json'),
    `${JSON.stringify(report, null, 2)}\n`
  )
})

describe.skipIf(live === null)('Ficha 0042: eventos de un host (paso 0)', () => {
  it('scope: ¿el token puede leer eventos (events.read)?', async () => {
    const { code } = await codeOf(get('/events', { from: 'now-2h', pageSize: 1 }))
    hasScope = code === 'ok'
    report['scope'] = { codigo: code, eventsRead: hasScope }
  })

  it('tipo HOST: relaciones posibles (nombre de la API y tipos estándar)', async (ctx) => {
    if (!hasScope) return ctx.skip()
    const { code, body } = await codeOf(get('/entityTypes/HOST', {}))
    const positions = (key: string, typesKey: string): Record<string, string[]> =>
      Object.fromEntries(
        ((body?.[key] as Raw[] | undefined) ?? [])
          .map((p) => [
            apiKey(String(p['id'])),
            ((p[typesKey] as unknown[] | undefined) ?? []).map(String).filter(isEnum).sort()
          ])
          .sort(([a], [b]) => String(a).localeCompare(String(b)))
      )
    report['tipoHost'] = {
      codigo: code,
      // El host en la posición FROM (relaciones `from:` de un host concreto).
      from: positions('fromRelationships', 'toTypes'),
      // El host en la posición TO (relaciones `to:`).
      to: positions('toRelationships', 'fromTypes')
    }
  })

  it('hosts: relaciones que traen y como mucho 3 con eventos', async (ctx) => {
    if (!hasScope) return ctx.skip()
    const page = (await get('/entities', {
      entitySelector: 'type("HOST")',
      from: FROM,
      pageSize: 20
    })) as Raw
    const candidates = ((page['entities'] as Raw[] | undefined) ?? []).map((entity) => {
      const id = String(entity['entityId'])
      observed.add(id)
      if (typeof entity['displayName'] === 'string') observed.add(entity['displayName'])
      return id
    })
    const relationTypes = new Map<string, Set<string>>()
    let tried = 0
    for (const id of candidates) {
      if (hosts.length >= MAX_HOSTS || tried >= MAX_CANDIDATES) break
      tried += 1
      const { body } = await codeOf(
        get(`/entities/${id}`, { fields: '+fromRelationships,+toRelationships' })
      )
      if (body === null) continue
      const related = relationsOf(body)
      for (const r of related) {
        const key = `${r.direction}:${apiKey(r.relation)}`
        const set = relationTypes.get(key) ?? new Set<string>()
        if (isEnum(r.type)) set.add(r.type)
        relationTypes.set(key, set)
      }
      const host = { id, related }
      const probe = await codeOf(
        get('/events', {
          eventSelector: `entityId(${quoted(idsOf(host))})`,
          from: FROM,
          pageSize: 1
        })
      )
      if ((totalOf(probe.body) ?? 0) > 0) hosts.push(host)
    }
    report['hosts'] = {
      candidatos: bucket(candidates.length),
      probados: tried,
      elegidos: hosts.length,
      // Relaciones que traen los hosts probados (dirección:nombre → tipos estándar).
      relaciones: Object.fromEntries(
        [...relationTypes.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, types]) => [key, [...types].sort()])
      )
    }
    expect(hosts.length).toBeGreaterThan(0)
  })

  it('forma A (eventSelector con ids mezclados) frente a forma B (entitySelector por tipo)', async (ctx) => {
    if (!hasScope || hosts.length === 0) return ctx.skip()
    const rows: unknown[] = []
    for (const [index, host] of hosts.entries()) {
      const ids = idsOf(host)
      const selectorA = `entityId(${quoted(ids)})`
      const a = await codeOf(
        get('/events', { eventSelector: selectorA, from: FROM, pageSize: 500 })
      )
      const eventsA = eventsOf(a.body)
      eventsA.forEach(observeEvent)
      const idSet = new Set(ids)

      // Solo el host: ¿cuántos eventos aportan las entidades relacionadas?
      const onlyHost = await codeOf(
        get('/events', { eventSelector: `entityId("${host.id}")`, from: FROM, pageSize: 1 })
      )

      // Forma B: una consulta por (relación, dirección, tipo) y el propio host.
      const groups = new Map<string, Related>()
      for (const r of host.related.filter(inRelations))
        groups.set(`${r.direction}:${r.relation}:${r.type}`, r)
      const eventIdsB = new Set<string>()
      let totalB = 0
      const groupRows: unknown[] = []
      const selectorsB: [string, string][] = [['host', `entityId("${host.id}")`]]
      for (const r of groups.values()) {
        // En el host, `to:R` son las entidades X con `fromRelationships.R` hacia él (y al revés).
        const inverse = r.direction === 'to' ? 'fromRelationships' : 'toRelationships'
        selectorsB.push([
          `${r.direction}:${apiKey(r.relation)}:${isEnum(r.type) ? r.type : 'otro'}`,
          `type("${r.type}"),${inverse}.${r.relation}(entityId("${host.id}"))`
        ])
      }
      for (const [label, selector] of selectorsB) {
        const b = await codeOf(
          get('/events', { entitySelector: selector, from: FROM, pageSize: 500 })
        )
        const events = eventsOf(b.body)
        events.forEach(observeEvent)
        for (const event of events) eventIdsB.add(eventIdOf(event))
        totalB += totalOf(b.body) ?? 0
        groupRows.push({ grupo: label, codigo: b.code, totalCount: bucket(totalOf(b.body) ?? 0) })
      }
      const idsA = new Set(eventsA.map(eventIdOf))
      rows.push({
        host: `#${index + 1}`,
        idsEnElSelector: bucket(ids.length),
        longitudSelectorA: bucket(selectorA.length),
        codigoA: a.code,
        totalA: bucket(totalOf(a.body) ?? 0),
        totalSoloHost: bucket(totalOf(onlyHost.body) ?? 0),
        // Eventos de A cuya entidad no está entre los ids pedidos (¿trae «relacionados» de más?).
        eventosDeOtrasEntidades: bucket(eventsA.filter((e) => !idSet.has(entityOf(e).id)).length),
        tiposDeEntidadEnA: [...new Set(eventsA.map((e) => entityOf(e).type).filter(isEnum))].sort(),
        formaB: groupRows,
        consultasB: selectorsB.length,
        totalB: bucket(totalB),
        mismoTotal: totalOf(a.body) === totalB,
        mismosEventIds:
          idsA.size === eventIdsB.size && [...idsA].every((id) => eventIdsB.has(id))
            ? 'sí'
            : `no (solo en A: ${bucket([...idsA].filter((id) => !eventIdsB.has(id)).length)}, solo en B: ${bucket([...eventIdsB].filter((id) => !idsA.has(id)).length)})`
      })
    }
    report['formas'] = rows
  })

  it('cuántos ids caben en eventSelector (rellenando con ids inventados)', async (ctx) => {
    if (!hasScope || hosts.length === 0) return ctx.skip()
    const real = idsOf(hosts[0]!)
    const rows: unknown[] = []
    for (const count of [50, 100, 200, 250, 300, 350, 400]) {
      const ids = [...real]
      for (let n = 0; ids.length < count; n += 1)
        ids.push(`PROCESS_GROUP_INSTANCE-${n.toString(16).toUpperCase().padStart(16, '0')}`)
      const selector = `entityId(${quoted(ids.slice(0, count))})`
      const { code, body } = await codeOf(
        get('/events', { eventSelector: selector, from: FROM, pageSize: 1 })
      )
      rows.push({
        ids: count,
        longitud: selector.length,
        codigo: code,
        totalCount: bucket(totalOf(body) ?? 0)
      })
      if (code !== 'ok') break
    }
    report['limiteDeIds'] = rows
  })

  it('forma de un evento, orden, pageSize=20 y rango absoluto', async (ctx) => {
    if (!hasScope || hosts.length === 0) return ctx.skip()
    const host = hosts[0]!
    const selector = `entityId(${quoted(idsOf(host))})`
    const page = await codeOf(get('/events', { eventSelector: selector, from: FROM, pageSize: 20 }))
    const events = eventsOf(page.body)
    events.forEach(observeEvent)
    const starts = events.map((e) => Number(e['startTime']))
    const fields = [...new Set(events.flatMap((e) => Object.keys(e).map(apiKey)))].sort()
    const to = Date.now()
    const absolute = await codeOf(
      get('/events', {
        eventSelector: selector,
        from: new Date(to - 24 * 3_600_000).toISOString(),
        to: new Date(to).toISOString(),
        pageSize: 1
      })
    )
    const open = events.filter((e) => e['status'] === 'OPEN')
    report['eventos'] = {
      codigo: page.code,
      claves: Object.keys(page.body ?? {})
        .map(apiKey)
        .sort(),
      llegan: bucket(events.length),
      totalCount: bucket(totalOf(page.body) ?? 0),
      conNextPageKey: typeof page.body?.['nextPageKey'] === 'string',
      campos: Object.fromEntries(
        fields.map((field) => [
          field,
          [...new Set(events.map((e) => typeOf(e[field])))].sort().join('|')
        ])
      ),
      status: [...new Set(events.map((e) => String(e['status'])).filter(isEnum))].sort(),
      eventType: [...new Set(events.map((e) => String(e['eventType'])).filter(isEnum))].sort(),
      eventTypeNoEstandar: bucket(events.filter((e) => !isEnum(String(e['eventType']))).length),
      endTimeDeLosActivos: [
        ...new Set(
          open.map((e) =>
            String(
              typeOf(e['endTime']) === 'number'
                ? e['endTime'] === -1
                  ? '-1'
                  : 'fecha'
                : typeOf(e['endTime'])
            )
          )
        )
      ].sort(),
      formaDeEntityId: [
        ...new Set(
          events.map((e) => {
            const stub = (e['entityId'] ?? {}) as Raw
            const inner = (stub['entityId'] ?? {}) as Raw
            return `{${Object.keys(stub).map(apiKey).sort().join(',')}} / entityId {${Object.keys(inner).map(apiKey).sort().join(',')}}`
          })
        )
      ].sort(),
      sinNombreDeEntidad: bucket(events.filter((e) => typeof entityOf(e).name !== 'string').length),
      ordenStartTimeDescendente: starts.every((s, i) => i === 0 || starts[i - 1]! >= s),
      ordenStartTimeAscendente: starts.every((s, i) => i === 0 || starts[i - 1]! <= s),
      codigoRangoAbsoluto: absolute.code,
      mismoTotalAbsoluto: totalOf(absolute.body) === totalOf(page.body)
    }
  })

  it('CA1 (0042): el informe dice qué forma funciona, cuántos ids caben y la forma de los eventos, sin ids, nombres ni títulos', () => {
    expect(report['scope'], 'el informe dice si hay events.read').toBeDefined()
    if (!hasScope) return
    expect(Object.keys(report)).toEqual(
      expect.arrayContaining(['hosts', 'formas', 'limiteDeIds', 'eventos'])
    )
    const text = JSON.stringify(report)
    for (const value of observed) {
      if (value.length < 4) continue
      expect(text.includes(value), 'el informe contiene un id, un nombre o un título').toBe(false)
    }
    expect(text).not.toMatch(/[A-Z_]+-[0-9A-F]{16}/)
    expect(observed.size).toBeGreaterThan(0)
  })
})
