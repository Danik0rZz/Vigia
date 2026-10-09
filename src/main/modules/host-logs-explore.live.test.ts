import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createLiveClient } from '../../test/live-client'
import { loadLiveEnv } from '../../test/live-env'
import { DtError } from '../dynatrace/errors'

/**
 * Ficha 0041, paso 0: EXPLORACIÓN EN VIVO de los logs detectados en los procesos de un host.
 * SOLO LECTURA, una petición detrás de otra.
 *
 * 1. Tipo: `GET /entityTypes/PROCESS_GROUP_INSTANCE`, qué dice de `logFileStatus`,
 *    `logPathLastUpdate` y `logSourceState` (id, tipo y nombre de Dynatrace de la propiedad).
 * 2. Hosts: como mucho 3 de `type("HOST")` que tengan procesos.
 * 3. Selector: `fromRelationships.isProcessOf(entityId("<host>"))` (forma de la OpenAPI) y
 *    `fromRelationship.isProcessOf(...)` (la de la captura de Dani): código y recuento.
 * 4. La consulta del canal: `type("PROCESS_GROUP_INSTANCE"),fromRelationships.isProcessOf(...)`
 *    con `fields=+properties.logFileStatus,+properties.logPathLastUpdate,+properties.logSourceState`,
 *    `from`/`to` (relativo y absoluto) y `pageSize=500`. Forma de cada propiedad (texto, lista,
 *    objeto, número), valores de enumeración (son de Dynatrace) y si llevan rutas, y cuántos
 *    procesos tienen logs.
 *
 * El informe (live-reports/host-logs-explore.json, ignorado) guarda SOLO comportamientos, claves
 * y valores de enumeración de la API. Nunca un id, un nombre, una ruta ni un valor libre. CA1
 * (0041) comprueba que no se cuela ninguno de los observados ni nada con forma de ruta.
 */

const env = loadLiveEnv()
const live = env === null ? null : createLiveClient(env)
const report: Record<string, unknown> = {}
const timings: number[] = []
/** Ids, nombres y valores libres observados: el informe no puede contener ninguno (CA1). */
const observed = new Set<string>()
const MAX_HOSTS = 3
const FROM = 'now-2h'
const PAGE_SIZE = 500
const PROPS = ['logFileStatus', 'logPathLastUpdate', 'logSourceState'] as const
const FIELDS = PROPS.map((key) => `+properties.${key}`).join(',')

type Raw = Record<string, unknown>

/** Valores de enumeración de la API (`OK`, `NOT_AVAILABLE`…): no son datos del tenant. */
const isEnum = (value: string): boolean =>
  /^[A-Z][A-Z0-9_]*$/.test(value) || /^(true|false|null)$/.test(value)

/** ¿Puede ser una ruta de fichero (Windows o Unix)? Cualquier barra cuenta. */
const looksLikePath = (value: string): boolean => /[\\/]/.test(value) || /^[A-Za-z]:/.test(value)

/** Rasgos de una clave de mapa (nunca la clave): ¿es una ruta, un fichero, un nombre? */
function keyTraits(value: string): string {
  const traits = [
    /^[A-Za-z]:[\\/]/.test(value) ? 'unidad de Windows' : null,
    value.startsWith('/') ? 'empieza por /' : null,
    value.includes('\\') ? 'con \\' : null,
    value.includes('/') ? 'con /' : null,
    /\.[A-Za-z0-9]{1,5}$/.test(value) ? 'con extensión' : null,
    /\s/.test(value) ? 'con espacios' : null,
    /[*?]/.test(value) ? 'con comodín' : null
  ].filter((trait) => trait !== null)
  return traits.length === 0 ? 'ninguno' : traits.join(', ')
}

const observe = (value: unknown): void => {
  if (typeof value === 'string' && !isEnum(value)) observed.add(value)
  if (typeof value === 'number') return
  if (Array.isArray(value)) for (const item of value) observe(item)
  else if (value !== null && typeof value === 'object')
    for (const [key, item] of Object.entries(value as Raw)) {
      // Las claves con forma de clave de la API (`key`, `value`…) no son datos del tenant.
      if (apiKey(key) !== key) observe(key)
      observe(item)
    }
}

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

const bucket = (count: number): string =>
  count === 0 ? '0' : count === 1 ? '1' : count < 10 ? '2-9' : count <= 150 ? '10-150' : '> 150'

/** Nombre de clave de la API: solo letras, puntos y guiones bajos (no se cuela un valor). */
const apiKey = (key: string): string => (/^[A-Za-z][A-Za-z0-9_.:-]*$/.test(key) ? key : 'otra')

/** Forma de un valor, nunca el valor (salvo enumeraciones de Dynatrace). */
function shapeOf(value: unknown, depth = 0): unknown {
  if (value === undefined) return 'ausente'
  if (value === null) return 'null'
  if (typeof value === 'number') {
    // ¿Fecha en milisegundos o en segundos desde epoch? Solo el tipo, nunca el valor.
    if (value > 1e12 && value < 1e13) return 'número (epoch ms)'
    if (value > 1e9 && value < 1e10) return 'número (epoch s)'
    return 'número'
  }
  if (typeof value === 'boolean') return 'booleano'
  if (typeof value === 'string') {
    if (isEnum(value)) return `enum ${value}`
    if (looksLikePath(value)) return 'texto (ruta)'
    if (!Number.isNaN(Date.parse(value)) && /\d{4}-\d{2}-\d{2}/.test(value)) return 'texto (fecha)'
    if (/^\d+$/.test(value)) return 'texto (número)'
    return 'texto (libre)'
  }
  if (Array.isArray(value)) {
    const kinds = [...new Set(value.map((item) => JSON.stringify(shapeOf(item, depth + 1))))]
    return { lista: bucket(value.length), elementos: kinds.sort().map((k) => JSON.parse(k)) }
  }
  if (typeof value === 'object' && depth < 3) {
    const entries = Object.entries(value as Raw)
    // Las claves de un objeto pueden ser rutas: se marca, nunca se copia.
    return {
      objeto: bucket(entries.length),
      claves: [
        ...new Set(
          entries.map(([key, item]) => {
            const name = looksLikePath(key) ? '(ruta)' : apiKey(key)
            return `${name}: ${JSON.stringify(shapeOf(item, depth + 1))}`
          })
        )
      ].sort()
    }
  }
  return typeof value
}

/** ¿Lleva alguna ruta, en sus valores o en sus claves? */
function hasPath(value: unknown): boolean {
  if (typeof value === 'string') return looksLikePath(value)
  if (Array.isArray(value)) return value.some(hasPath)
  if (value !== null && typeof value === 'object')
    return Object.entries(value as Raw).some(([key, item]) => looksLikePath(key) || hasPath(item))
  return false
}

/** ¿Cuántas rutas lleva (para el recuento que pide la ficha)? */
function countPaths(value: unknown): number {
  if (typeof value === 'string') return looksLikePath(value) ? 1 : 0
  if (Array.isArray(value)) return value.reduce<number>((sum, item) => sum + countPaths(item), 0)
  if (value !== null && typeof value === 'object')
    return Object.entries(value as Raw).reduce<number>(
      (sum, [key, item]) => sum + (looksLikePath(key) ? 1 : 0) + countPaths(item),
      0
    )
  return 0
}

const hosts: string[] = []

const selectorFor = (host: string, form: 'plural' | 'singular'): string =>
  `type("PROCESS_GROUP_INSTANCE"),${form === 'plural' ? 'fromRelationships' : 'fromRelationship'}.isProcessOf(entityId("${host}"))`

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
    join('live-reports', 'host-logs-explore.json'),
    `${JSON.stringify(report, null, 2)}\n`
  )
})

describe.skipIf(live === null)('Ficha 0041: logs de los procesos de un host (paso 0)', () => {
  it('tipo PROCESS_GROUP_INSTANCE: qué dice de las tres propiedades', async () => {
    const { code, body } = await codeOf(get('/entityTypes/PROCESS_GROUP_INSTANCE', {}))
    const properties = ((body?.['properties'] as Raw[] | undefined) ?? []).filter((p) =>
      (PROPS as readonly string[]).includes(String(p['id']))
    )
    report['tipo'] = {
      codigo: code,
      propiedades: properties.map((p) => ({
        id: apiKey(String(p['id'])),
        // Tipo y nombre de Dynatrace de la propiedad (igual en todos los tenants).
        type: typeof p['type'] === 'string' ? apiKey(p['type']) : null,
        displayName:
          typeof p['displayName'] === 'string' && /^[A-Za-z ]{1,40}$/.test(p['displayName'])
            ? p['displayName']
            : 'otro'
      }))
    }
  })

  it('elige como mucho 3 hosts con procesos', async () => {
    const page = (await get('/entities', {
      entitySelector: 'type("HOST")',
      from: FROM,
      pageSize: 20
    })) as Raw
    const candidates: string[] = []
    for (const entity of (page['entities'] as Raw[] | undefined) ?? []) {
      const id = String(entity['entityId'])
      observed.add(id)
      if (typeof entity['displayName'] === 'string') observed.add(entity['displayName'])
      candidates.push(id)
    }
    let tried = 0
    for (const host of candidates) {
      if (hosts.length >= MAX_HOSTS || tried >= 10) break
      tried += 1
      const { body } = await codeOf(
        get('/entities', { entitySelector: selectorFor(host, 'plural'), from: FROM, pageSize: 1 })
      )
      if (typeof body?.['totalCount'] === 'number' && body['totalCount'] > 0) hosts.push(host)
    }
    report['hosts'] = {
      candidatos: bucket(candidates.length),
      probados: tried,
      elegidos: hosts.length
    }
    expect(hosts.length).toBeGreaterThan(0)
  })

  it('selector: fromRelationships (OpenAPI) y fromRelationship (captura)', async () => {
    const rows: unknown[] = []
    for (const [index, host] of hosts.entries()) {
      const row: Raw = { host: `#${index + 1}` }
      for (const form of ['plural', 'singular'] as const) {
        const { code, body } = await codeOf(
          get('/entities', { entitySelector: selectorFor(host, form), from: FROM, pageSize: 1 })
        )
        row[form] = {
          codigo: code,
          totalCount: typeof body?.['totalCount'] === 'number' ? bucket(body['totalCount']) : null
        }
      }
      rows.push(row)
    }
    report['selector'] = rows
  })

  it('consulta del canal: forma de las propiedades, rutas y cuántos procesos tienen logs', async () => {
    const to = Date.now()
    const absolute = {
      from: new Date(to - 2 * 3_600_000).toISOString(),
      to: new Date(to).toISOString()
    }
    const rows: unknown[] = []
    for (const [index, host] of hosts.entries()) {
      const relative = await codeOf(
        get('/entities', {
          entitySelector: selectorFor(host, 'plural'),
          fields: FIELDS,
          from: FROM,
          pageSize: PAGE_SIZE
        })
      )
      const abs = await codeOf(
        get('/entities', {
          entitySelector: selectorFor(host, 'plural'),
          fields: FIELDS,
          from: absolute.from,
          to: absolute.to,
          pageSize: PAGE_SIZE
        })
      )
      const entities = (relative.body?.['entities'] as Raw[] | undefined) ?? []
      const perProperty: Record<string, unknown> = {}
      for (const key of PROPS) {
        const shapes = new Map<string, number>()
        let withPath = 0
        let paths = 0
        let present = 0
        for (const entity of entities) {
          const properties = (entity['properties'] as Raw | undefined) ?? {}
          const value = properties[key]
          observe(value)
          if (value !== undefined) present += 1
          if (hasPath(value)) withPath += 1
          paths += countPaths(value)
          const shape = JSON.stringify(shapeOf(value))
          shapes.set(shape, (shapes.get(shape) ?? 0) + 1)
        }
        perProperty[key] = {
          procesosConElla: bucket(present),
          procesosConRutas: bucket(withPath),
          rutas: bucket(paths),
          formas: [...shapes.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([shape, count]) => ({ forma: JSON.parse(shape), procesos: bucket(count) }))
        }
      }
      // Mapas `[{ key, value }]`: rasgos de las claves, entradas por proceso, valores de
      // enumeración y si las claves de las tres propiedades son las mismas en cada proceso.
      const maps: Record<string, unknown> = {}
      const keysOf = (entity: Raw, key: string): string[] => {
        const value = ((entity['properties'] as Raw | undefined) ?? {})[key]
        return Array.isArray(value)
          ? value.map((item) => String((item as Raw | null)?.['key'] ?? ''))
          : []
      }
      for (const key of PROPS) {
        const traits = new Map<string, number>()
        const perProcess = new Map<string, number>()
        const values = new Set<string>()
        for (const entity of entities) {
          const list = ((entity['properties'] as Raw | undefined) ?? {})[key]
          if (!Array.isArray(list)) continue
          perProcess.set(bucket(list.length), (perProcess.get(bucket(list.length)) ?? 0) + 1)
          for (const item of list as Raw[]) {
            const trait = keyTraits(String(item?.['key'] ?? ''))
            traits.set(trait, (traits.get(trait) ?? 0) + 1)
            const value = item?.['value']
            if (typeof value === 'string' && isEnum(value)) values.add(value)
            if (value !== null && typeof value === 'object' && !Array.isArray(value))
              for (const inner of Object.values(value as Raw))
                if (typeof inner === 'string' && isEnum(inner)) values.add(inner)
          }
        }
        maps[key] = {
          entradasPorProceso: Object.fromEntries(
            [...perProcess.entries()].map(([b, n]) => [b, bucket(n)])
          ),
          rasgosDeLaClave: Object.fromEntries(
            [...traits.entries()].map(([t, n]) => [t, bucket(n)])
          ),
          valores: [...values].sort()
        }
      }
      // ¿Las claves sin barra se repiten entre procesos (fuente genérica) o son de cada uno?
      for (const key of PROPS) {
        const all = entities.flatMap((entity) => keysOf(entity, key))
        const noSlash = all.filter((k) => !/[\\/]/.test(k))
        maps[`${key}SinBarra`] = {
          entradas: bucket(noSlash.length),
          distintas: bucket(new Set(noSlash).size),
          palabras: [...new Set(noSlash.map((k) => bucket(k.trim().split(/\s+/).length)))].sort()
        }
      }
      let same = 0
      let compared = 0
      for (const entity of entities) {
        const status = keysOf(entity, 'logFileStatus')
        const update = keysOf(entity, 'logPathLastUpdate')
        if (status.length === 0 || update.length === 0) continue
        compared += 1
        if (status.every((key) => update.includes(key))) same += 1
      }
      maps['clavesDeEstadoEnUltimaActualizacion'] = {
        comparados: bucket(compared),
        iguales: bucket(same)
      }
      let sourceSame = 0
      let sourceCompared = 0
      for (const entity of entities) {
        const source = keysOf(entity, 'logSourceState')
        const status = keysOf(entity, 'logFileStatus')
        if (source.length === 0 || status.length === 0) continue
        sourceCompared += 1
        if (source.some((key) => status.includes(key))) sourceSame += 1
      }
      maps['clavesDeFuenteEnEstado'] = {
        comparados: bucket(sourceCompared),
        algunaIgual: bucket(sourceSame)
      }
      for (const entity of entities) {
        observed.add(String(entity['entityId']))
        if (typeof entity['displayName'] === 'string') observed.add(entity['displayName'])
      }
      // Otras claves que llegan en la entidad (además de entityId, displayName y properties).
      const otherKeys = [
        ...new Set(entities.flatMap((entity) => Object.keys(entity).map(apiKey)))
      ].sort()
      const propertyKeys = [
        ...new Set(
          entities.flatMap((entity) =>
            Object.keys((entity['properties'] as Raw | undefined) ?? {}).map(apiKey)
          )
        )
      ].sort()
      const withAny = entities.filter((entity) => {
        const properties = (entity['properties'] as Raw | undefined) ?? {}
        return PROPS.some((key) => properties[key] !== undefined)
      }).length
      rows.push({
        host: `#${index + 1}`,
        codigoRelativo: relative.code,
        codigoAbsoluto: abs.code,
        totalCount:
          typeof relative.body?.['totalCount'] === 'number'
            ? bucket(relative.body['totalCount'])
            : null,
        pageSize: relative.body?.['pageSize'] ?? null,
        masPaginas:
          relative.body?.['nextPageKey'] !== null && relative.body?.['nextPageKey'] !== undefined,
        procesos: bucket(entities.length),
        procesosConAlgunaPropiedad: bucket(withAny),
        mismoTotalAbsoluto: abs.body?.['totalCount'] === relative.body?.['totalCount'],
        clavesEntidad: otherKeys,
        clavesProperties: propertyKeys,
        propiedades: perProperty,
        mapas: maps
      })
    }
    report['canal'] = rows
  })

  it('entities:get de un proceso con logs: ¿trae las propiedades de logs en +properties?', async () => {
    // Para saber si «Todas las propiedades» del proceso enseñaría rutas de log.
    const rows: unknown[] = []
    for (const [index, host] of hosts.entries()) {
      const page = (await get('/entities', {
        entitySelector: selectorFor(host, 'plural'),
        fields: FIELDS,
        from: FROM,
        pageSize: PAGE_SIZE
      })) as Raw
      const withPathLike = ((page['entities'] as Raw[] | undefined) ?? []).find((entity) =>
        PROPS.some((key) => hasPath(((entity['properties'] as Raw | undefined) ?? {})[key]))
      )
      const sample =
        withPathLike ??
        ((page['entities'] as Raw[] | undefined) ?? []).find((entity) =>
          PROPS.some((key) => ((entity['properties'] as Raw | undefined) ?? {})[key] !== undefined)
        )
      if (sample === undefined) {
        rows.push({ host: `#${index + 1}`, proceso: 'ninguno con logs' })
        continue
      }
      const id = String(sample['entityId'])
      observed.add(id)
      const { code, body } = await codeOf(
        get(`/entities/${id}`, {
          fields: '+properties,+fromRelationships,+toRelationships,+firstSeenTms,+lastSeenTms'
        })
      )
      const properties = (body?.['properties'] as Raw | undefined) ?? {}
      observe(properties)
      rows.push({
        host: `#${index + 1}`,
        conRutaEnLaLista: withPathLike !== undefined,
        codigo: code,
        propiedadesDeLogs: PROPS.filter((key) => properties[key] !== undefined),
        otrasClavesConLog: Object.keys(properties)
          .filter((key) => /log/i.test(key) && !(PROPS as readonly string[]).includes(key))
          .map(apiKey)
          .sort(),
        rutasEnProperties: countPaths(
          Object.fromEntries(PROPS.map((key) => [key, properties[key]]))
        )
      })
    }
    report['entidad'] = rows
  })

  it('CA1 (0041): el informe dice si la consulta funciona, la forma de las propiedades y si llevan rutas, sin ids, nombres ni rutas', () => {
    expect(Object.keys(report)).toEqual(
      expect.arrayContaining(['tipo', 'hosts', 'selector', 'canal'])
    )
    const text = JSON.stringify(report)
    for (const value of observed) {
      if (value.length < 4) continue
      expect(
        text.includes(value),
        'el informe contiene un id, un nombre o un valor observado'
      ).toBe(false)
    }
    // Nada con forma de ruta ni de id de entidad.
    expect(text).not.toMatch(/[A-Za-z]:\\\\/)
    expect(text).not.toMatch(/"\/[^"\s]+/)
    expect(text).not.toMatch(/[A-Z_]+-[0-9A-F]{16}/)
    expect(observed.size).toBeGreaterThan(0)
  })
})
