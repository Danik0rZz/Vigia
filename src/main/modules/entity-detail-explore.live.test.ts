import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createLiveClient } from '../../test/live-client'
import { loadLiveEnv } from '../../test/live-env'
import { DtError } from '../dynatrace/errors'

/**
 * Ficha 0014, paso 0: EXPLORACIÓN EN VIVO de `GET /entities/{entityId}` sobre
 * como mucho 3 servicios de los problemas de los últimos 7 días, y de si los
 * ids de sus relaciones se resuelven con
 * `GET /entities?entitySelector=entityId(...)` con el `from` por defecto
 * (`now-3d`) o hace falta uno mayor. SOLO LECTURA, una petición detrás de otra.
 *
 * El informe (live-reports/entity-detail-explore.json, ignorado) guarda SOLO
 * comportamientos: claves y tipos de la API, tramos y proporciones. Nunca un id,
 * un nombre, una etiqueta ni un valor. CA1 (0014) comprueba que no se cuela
 * ninguno de los observados.
 */

const env = loadLiveEnv()
const live = env === null ? null : createLiveClient(env)
const report: Record<string, unknown> = {}
const timings: number[] = []
/** Ids, nombres y valores observados: el informe no puede contener ninguno (CA1). */
const observed = new Set<string>()
const MAX_SERVICES = 3
/** Como mucho, relaciones por servicio cuyos nombres se intentan resolver. */
const MAX_RELATIONS_PER_SERVICE = 12
const NAME_BATCH = 50
const LARGER_FROMS = ['now-30d', 'now-1y'] as const
const FIELDS =
  '+properties,+tags,+managementZones,+fromRelationships,+toRelationships,+firstSeenTms,+lastSeenTms,+icon'

/** Claves de `properties` de un SERVICE que nombra la ficha (de la API, no del tenant). */
const KNOWN_PROPERTY_KEYS = new Set([
  'serviceType',
  'serviceTechnologyTypes',
  'softwareTechnologies',
  'agentTechnologyType',
  'webServerName',
  'webServiceName',
  'webServiceNamespace',
  'contextRoot',
  'port',
  'ipAddress',
  'isExternalService',
  'externalDependency',
  'remoteEndpoint',
  'remoteServiceName',
  'databaseName',
  'databaseVendor',
  'databaseHostNames',
  'applicationName',
  'applicationEnvironment',
  'applicationReleaseVersion',
  'publicCloudId',
  'publicCloudRegion',
  'detectedName',
  'conditionalName',
  'dt.security_context',
  'matchedServiceDetectionV2Rules',
  'serviceDetectionAttributes',
  'unifiedServiceIndicators'
])

/** Relaciones que nombra la ficha (de la API). */
const KNOWN_RELATIONS = new Set([
  'calls',
  'runsOn',
  'runsOnHost',
  'runsOnProcessGroupInstance',
  'isServiceOf',
  'isServiceOfProcessGroup',
  'indirectlySendsToQueue',
  'isServiceMethodOfService',
  'isClusterOfService',
  'isNamespaceOfService',
  'isInstanceOf',
  'isGroupOf'
])

/** Nombres de la API que el informe puede llevar. */
const API_NAMES = [...KNOWN_PROPERTY_KEYS, ...KNOWN_RELATIONS]

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

const share = (part: number, whole: number): string =>
  whole === 0 ? 'sin datos' : `${Math.round((part / whole) * 20) * 5} %`

const bucket = (count: number): string =>
  count === 0
    ? '0'
    : count === 1
      ? '1'
      : count < 10
        ? '2-9'
        : count <= 50
          ? '10-50'
          : count <= 200
            ? '51-200'
            : 'más de 200'

const asObject = (value: unknown): Raw | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Raw) : null

/** Forma de un valor, sin el valor. */
function kindOf(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) {
    const inner = [...new Set(value.map(kindOf))].sort()
    return inner.length === 0 ? 'lista vacía' : `lista de ${inner.join('|')}`
  }
  if (typeof value === 'object') return `objeto {${Object.keys(value).sort().join(',')}}`
  return typeof value
}

/** Largo de un valor pasado a texto, en tramos (para el recorte a 300). */
function textLength(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  const length = text.length
  return length <= 100 ? '≤ 100' : length <= 300 ? '101-300' : 'más de 300'
}

/** Guarda en `observed` todo texto que pueda ser un dato del tenant. */
function observe(value: unknown): void {
  if (typeof value === 'string') {
    observed.add(value)
    return
  }
  if (typeof value === 'number') {
    observed.add(String(value))
    return
  }
  if (Array.isArray(value)) for (const item of value) observe(item)
  else if (value !== null && typeof value === 'object')
    for (const v of Object.values(value)) observe(v)
}

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
    join('live-reports', 'entity-detail-explore.json'),
    `${JSON.stringify(report, null, 2)}\n`
  )
})

describe.skipIf(live === null)('Ficha 0014: datos de una entidad (paso 0)', () => {
  const services: string[] = []
  const entities: Raw[] = []

  it('elige como mucho 3 servicios de los problemas de los últimos 7 días', async () => {
    const list = (await get('/problems', { from: 'now-7d', pageSize: 50 })) as Raw
    for (const problem of (list['problems'] as Raw[] | undefined) ?? []) {
      observed.add(String(problem['problemId']))
      observed.add(String(problem['displayId']))
      for (const key of ['affectedEntities', 'impactedEntities']) {
        for (const entity of (problem[key] as Raw[] | undefined) ?? []) {
          const id = asObject(entity['entityId'])?.['id']
          if (typeof entity['name'] === 'string') observed.add(entity['name'])
          if (typeof id !== 'string') continue
          observed.add(id)
          if (/^SERVICE-[0-9A-F]{16}$/.test(id) && !services.includes(id)) services.push(id)
        }
      }
    }
    report['servicios sacados de problemas'] = Math.min(services.length, MAX_SERVICES)
    if (services.length === 0) {
      const page = (await get('/entities', {
        entitySelector: 'type("SERVICE")',
        from: 'now-3d',
        pageSize: MAX_SERVICES
      })) as Raw
      for (const entity of (page['entities'] as Raw[] | undefined) ?? []) {
        const id = String(entity['entityId'])
        observed.add(id)
        if (typeof entity['displayName'] === 'string') observed.add(entity['displayName'])
        services.push(id)
      }
      report['servicios sacados de /entities'] = services.length
    }
    services.splice(MAX_SERVICES)
  })

  it('GET /entities/{id} con los fields de la ficha: icon, fechas, properties y relaciones', async () => {
    const perService: unknown[] = []
    for (const [index, id] of services.entries()) {
      const { code, body } = await codeOf(get(`/entities/${id}`, { fields: FIELDS }))
      const row: Record<string, unknown> = { servicio: `#${index + 1}`, codigo: code }
      if (body === null) {
        perService.push(row)
        continue
      }
      observe(body)
      entities.push(body)
      row['claves de la respuesta'] = Object.keys(body).sort()
      const icon = body['icon']
      row['icon'] = {
        forma: kindOf(icon),
        primaryIconType: typeof asObject(icon)?.['primaryIconType'],
        primaryIconTypeConMinusculasYGuiones:
          typeof asObject(icon)?.['primaryIconType'] === 'string'
            ? /^[a-z0-9-]+$/.test(String(asObject(icon)?.['primaryIconType']))
            : 'sin campo'
      }
      row['firstSeenTms'] = typeof body['firstSeenTms']
      row['lastSeenTms'] = typeof body['lastSeenTms']
      row['firstSeen ≤ lastSeen'] =
        typeof body['firstSeenTms'] === 'number' && typeof body['lastSeenTms'] === 'number'
          ? body['firstSeenTms'] <= body['lastSeenTms']
          : 'sin datos'
      row['managementZones'] = {
        forma: kindOf(
          Array.isArray(body['managementZones']) ? body['managementZones'].slice(0, 1) : null
        ),
        cuantas: bucket(Array.isArray(body['managementZones']) ? body['managementZones'].length : 0)
      }
      row['tags'] = {
        forma: kindOf(Array.isArray(body['tags']) ? body['tags'].slice(0, 1) : null),
        cuantas: bucket(Array.isArray(body['tags']) ? body['tags'].length : 0),
        todasConStringRepresentation: Array.isArray(body['tags'])
          ? body['tags'].every((t) => typeof asObject(t)?.['stringRepresentation'] === 'string')
          : 'sin campo'
      }
      const properties = asObject(body['properties']) ?? {}
      const known = Object.keys(properties).filter((key) => KNOWN_PROPERTY_KEYS.has(key))
      row['properties'] = {
        forma: kindOf(body['properties']).startsWith('objeto')
          ? 'objeto'
          : kindOf(body['properties']),
        claves: bucket(Object.keys(properties).length),
        clavesNoListadasEnLaFicha: Object.keys(properties).length - known.length,
        // Solo claves de la API que nombra la ficha, con la forma de su valor.
        formaPorClave: Object.fromEntries(
          known.sort().map((key) => [key, kindOf(properties[key])])
        ),
        largoComoTexto: Object.fromEntries(
          known.sort().map((key) => [key, textLength(properties[key])])
        )
      }
      const relations: Record<string, unknown> = {}
      for (const direction of ['fromRelationships', 'toRelationships'] as const) {
        const group = asObject(body[direction]) ?? {}
        for (const [name, list] of Object.entries(group)) {
          const items = Array.isArray(list) ? (list as Raw[]) : []
          const types = new Set(items.map((item) => String(item['type'])))
          const label = KNOWN_RELATIONS.has(name) ? name : 'otra (no listada)'
          relations[`${direction === 'fromRelationships' ? 'from' : 'to'}.${label}`] = {
            ids: bucket(items.length),
            tipos: types.size === 1 ? 'uno' : `${types.size}`,
            tiposEstandar: [...types].every(isStandardType),
            formaDeUnElemento: kindOf(items[0] ?? null)
          }
        }
      }
      row['relaciones'] = relations
      perService.push(row)
    }
    report['por servicio'] = perService
  })

  it('GET /entities/{id} de un id con el formato bien pero que no existe', async () => {
    const { code } = await codeOf(
      get('/entities/SERVICE-0000000000000000', { fields: '+properties' })
    )
    report['entidad que no existe'] = code
  })

  it('nombres de las relaciones con entityId(...): from por defecto frente a uno mayor', async () => {
    const results: unknown[] = []
    for (const [index, entity] of entities.entries()) {
      let tried = 0
      for (const direction of ['fromRelationships', 'toRelationships'] as const) {
        const group = asObject(entity[direction]) ?? {}
        for (const [name, list] of Object.entries(group)) {
          if (tried >= MAX_RELATIONS_PER_SERVICE) break
          const items = Array.isArray(list) ? (list as Raw[]) : []
          // Un lote del mismo tipo (la API lo exige): el del primer elemento.
          const type = String(items[0]?.['type'] ?? '')
          const ids = items
            .filter((item) => String(item['type']) === type)
            .map((item) => String(item['id']))
            .slice(0, NAME_BATCH)
          if (ids.length === 0) continue
          tried += 1
          const selector = `entityId(${ids.map((id) => `"${id}"`).join(',')})`
          const row: Record<string, unknown> = {
            servicio: `#${index + 1}`,
            relacion: `${direction === 'fromRelationships' ? 'from' : 'to'}.${KNOWN_RELATIONS.has(name) ? name : 'otra'}`,
            tipoEstandar: isStandardType(type),
            pedidos: bucket(ids.length)
          }
          const first = await codeOf(get('/entities', { entitySelector: selector, pageSize: 50 }))
          const found = (body: Raw | null): Set<string> => {
            const list = (body?.['entities'] as Raw[] | undefined) ?? []
            for (const item of list) observe(item)
            return new Set(list.map((item) => String(item['entityId'])))
          }
          const byDefault = found(first.body)
          row['from por defecto'] = {
            codigo: first.code,
            resueltos: share(ids.filter((id) => byDefault.has(id)).length, ids.length),
            todosConDisplayName: ((first.body?.['entities'] as Raw[] | undefined) ?? []).every(
              (item) => typeof item['displayName'] === 'string'
            ),
            totalCountIgualAlNumero:
              first.body?.['totalCount'] ===
              ((first.body?.['entities'] as Raw[] | undefined) ?? []).length,
            hayNextPageKey: typeof first.body?.['nextPageKey'] === 'string'
          }
          const missing = ids.filter((id) => !byDefault.has(id))
          if (missing.length > 0) {
            for (const from of LARGER_FROMS) {
              const retry = await codeOf(
                get('/entities', { entitySelector: selector, pageSize: 50, from })
              )
              const resolved = found(retry.body)
              row[`from ${from}`] = {
                codigo: retry.code,
                resueltosDeLosQueFaltaban: share(
                  missing.filter((id) => resolved.has(id)).length,
                  missing.length
                )
              }
            }
          }
          results.push(row)
        }
      }
    }
    report['nombres de relaciones'] = results
  })

  it('entityId(...) con tipos mezclados', async () => {
    const pair: string[] = []
    for (const entity of entities) {
      for (const direction of ['fromRelationships', 'toRelationships'] as const) {
        for (const list of Object.values(asObject(entity[direction]) ?? {})) {
          for (const item of Array.isArray(list) ? (list as Raw[]) : []) {
            const type = String(item['type'])
            if (pair.every((id) => !id.startsWith(`${type}-`)) && pair.length < 2)
              pair.push(String(item['id']))
          }
        }
      }
    }
    if (pair.length < 2) {
      report['tipos mezclados'] = 'sin dos tipos distintos'
      return
    }
    const { code } = await codeOf(
      get('/entities', {
        entitySelector: `entityId(${pair.map((id) => `"${id}"`).join(',')})`,
        pageSize: 50
      })
    )
    report['tipos mezclados'] = code
  })

  it('CA1 (0014): el informe no contiene ningún id ni nombre observado', () => {
    const text = JSON.stringify(report)
    for (const value of observed) {
      // Valores cortos (true, 0, 443…) pueden coincidir con texto propio del informe.
      if (value.length < 6) continue
      // Un valor que es parte de un nombre de la API de la ficha (p. ej. una propiedad cuyo
      // valor coincide con parte del nombre de otra clave) no es un dato del tenant.
      if (API_NAMES.some((name) => name.includes(value))) continue
      expect(
        text.includes(value),
        'el informe contiene un id, un nombre o un valor observado'
      ).toBe(false)
    }
    expect(observed.size).toBeGreaterThan(0)
  })
})

/**
 * Ficha 0020: EXPLORACIÓN EN VIVO de `GET /entities/{entityId}` sobre como mucho 3 HOST de los
 * problemas de los últimos 7 días (autorizada por Dani, solo lectura): qué claves de
 * `properties` y qué relaciones trae un host de verdad. El informe guarda SOLO nombres de la API
 * (claves y relaciones que define `GET /entityTypes/HOST`, o que nombra la ficha) con la forma de
 * su valor; nunca un id, un nombre ni un valor.
 */
const MAX_HOSTS = 3

/**
 * Forma de un valor sin sus claves: las de un objeto pueden ser datos del tenant (etiquetas de
 * Kubernetes, metadatos propios del host).
 */
function shapeOf(value: unknown): string {
  if (Array.isArray(value)) {
    const inner = [...new Set(value.map(shapeOf))].sort()
    return inner.length === 0 ? 'lista vacía' : `lista de ${inner.join('|')}`
  }
  if (value !== null && typeof value === 'object') return 'objeto'
  return value === null ? 'null' : typeof value
}

/** Claves de `properties` de un HOST que nombra la ficha 0020 (de la API, no del tenant). */
const HOST_PROPERTY_KEYS = new Set([
  'osType',
  'osVersion',
  'osArchitecture',
  'bitness',
  'cpuCores',
  'logicalCpuCores',
  'physicalMemory',
  'memoryTotal',
  'ipAddress',
  'networkZone',
  'monitoringMode',
  'state',
  'installerVersion',
  'hostGroupName',
  'cloudType',
  'hypervisorType'
])

/** Relaciones de un HOST que nombra la ficha 0020. */
const HOST_RELATIONS = new Set(['isProcessOf', 'runsOnHost', 'runsOn', 'isInstanceOf'])

describe.skipIf(live === null)('Ficha 0020: datos de un HOST (exploración)', () => {
  const hosts: string[] = []
  const hostObserved = new Set<string>()
  /** Nombres que define el tipo HOST (propiedades y relaciones): se pueden escribir. */
  const typeNames = new Set<string>()
  const hostReport: Record<string, unknown> = {}

  const watch = (value: unknown): void => {
    if (typeof value === 'string') hostObserved.add(value)
    else if (typeof value === 'number') hostObserved.add(String(value))
    else if (Array.isArray(value)) for (const item of value) watch(item)
    else if (value !== null && typeof value === 'object')
      for (const v of Object.values(value)) watch(v)
  }

  it('lee la definición del tipo HOST (nombres de propiedades y relaciones)', async () => {
    const { code, body } = await codeOf(get('/entityTypes/HOST', {}))
    hostReport['entityTypes/HOST'] = code
    for (const property of (body?.['properties'] as Raw[] | undefined) ?? []) {
      if (typeof property['id'] === 'string') typeNames.add(property['id'])
    }
    for (const key of ['fromRelationships', 'toRelationships']) {
      for (const relation of (body?.[key] as Raw[] | undefined) ?? []) {
        if (typeof relation['id'] === 'string') typeNames.add(relation['id'])
      }
    }
    hostReport['nombres en la definición'] = bucket(typeNames.size)
  })

  it('elige como mucho 3 hosts de los problemas de los últimos 7 días', async () => {
    const list = (await get('/problems', { from: 'now-7d', pageSize: 50 })) as Raw
    for (const problem of (list['problems'] as Raw[] | undefined) ?? []) {
      watch(problem['problemId'])
      watch(problem['displayId'])
      for (const key of ['affectedEntities', 'impactedEntities']) {
        for (const entity of (problem[key] as Raw[] | undefined) ?? []) {
          const id = asObject(entity['entityId'])?.['id']
          watch(entity['name'])
          if (typeof id !== 'string') continue
          hostObserved.add(id)
          if (/^HOST-[0-9A-F]{16}$/.test(id) && !hosts.includes(id)) hosts.push(id)
        }
      }
    }
    hostReport['hosts sacados de problemas'] = Math.min(hosts.length, MAX_HOSTS)
    if (hosts.length < MAX_HOSTS) {
      // Pocos en los problemas: se completa con hosts cualesquiera (una sola lectura).
      const page = (await get('/entities', {
        entitySelector: 'type("HOST")',
        from: 'now-3d',
        pageSize: 10
      })) as Raw
      for (const entity of (page['entities'] as Raw[] | undefined) ?? []) {
        watch(entity)
        const id = String(entity['entityId'])
        if (!hosts.includes(id)) hosts.push(id)
      }
    }
    hosts.splice(MAX_HOSTS)
    hostReport['hosts'] = hosts.length
  })

  it('GET /entities/{id} de cada host: claves de properties y relaciones', async () => {
    const isApiName = (name: string): boolean =>
      typeNames.has(name) || HOST_PROPERTY_KEYS.has(name) || HOST_RELATIONS.has(name)
    const perHost: unknown[] = []
    const seenKeys = new Map<string, number>()
    const seenRelations = new Map<string, number>()
    for (const [index, id] of hosts.entries()) {
      const { code, body } = await codeOf(get(`/entities/${id}`, { fields: FIELDS }))
      const row: Record<string, unknown> = { host: `#${index + 1}`, codigo: code }
      if (body === null) {
        perHost.push(row)
        continue
      }
      watch(body)
      const properties = asObject(body['properties']) ?? {}
      const keys = Object.keys(properties)
      for (const key of keys.filter(isApiName)) seenKeys.set(key, (seenKeys.get(key) ?? 0) + 1)
      row['claves'] = bucket(keys.length)
      row['clavesFueraDeLaDefinicion'] = keys.filter((key) => !isApiName(key)).length
      row['formaPorClave'] = Object.fromEntries(
        keys
          .filter(isApiName)
          .sort()
          .map((key) => [key, shapeOf(properties[key])])
      )
      // Unidad de la memoria, por su orden de magnitud (sin el valor): bytes si pasa de 2^30.
      for (const key of ['physicalMemory', 'memoryTotal']) {
        const value = properties[key]
        row[`${key}Magnitud`] =
          typeof value === 'number'
            ? value >= 2 ** 30
              ? '≥ 1 GiB'
              : value >= 2 ** 20
                ? 'entre 1 MiB y 1 GiB'
                : 'menos de 1 MiB'
            : 'sin dato'
      }
      row['physicalMemoryIgualAMemoryTotal'] =
        properties['physicalMemory'] === properties['memoryTotal']
      const relations: Record<string, unknown> = {}
      for (const direction of ['fromRelationships', 'toRelationships'] as const) {
        const short = direction === 'fromRelationships' ? 'from' : 'to'
        for (const [name, items] of Object.entries(asObject(body[direction]) ?? {})) {
          const label = isApiName(name) ? name : 'otra (fuera de la definición)'
          const list = Array.isArray(items) ? (items as Raw[]) : []
          const types = [...new Set(list.map((item) => String(item['type'])))]
          seenRelations.set(`${short}.${label}`, (seenRelations.get(`${short}.${label}`) ?? 0) + 1)
          relations[`${short}.${label}`] = {
            ids: bucket(list.length),
            tipos: types.every(isStandardType) ? types.sort() : 'alguno no estándar'
          }
        }
      }
      row['relaciones'] = relations
      perHost.push(row)
    }
    hostReport['por host'] = perHost
    hostReport['claves vistas (en cuántos hosts)'] = Object.fromEntries([...seenKeys].sort())
    hostReport['relaciones vistas (en cuántos hosts)'] = Object.fromEntries(
      [...seenRelations].sort()
    )
    hostReport['claves de la ficha que no llegaron'] = [...HOST_PROPERTY_KEYS]
      .filter((key) => !seenKeys.has(key))
      .sort()
    report['hosts (0020)'] = hostReport
  })

  it('Ficha 0020: el informe de hosts no contiene ningún id, nombre ni valor observado', () => {
    const text = JSON.stringify(hostReport)
    for (const value of hostObserved) {
      if (value.length < 6) continue
      if ([...typeNames, ...HOST_PROPERTY_KEYS, ...HOST_RELATIONS].some((n) => n.includes(value)))
        continue
      // Enumerados de la API en mayúsculas (LINUX, KUBERNETES…) forman parte de los tipos
      // estándar del informe (KUBERNETES_NODE…): no son datos del tenant.
      if (isStandardType(value)) continue
      expect(text.includes(value), 'el informe contiene un dato observado').toBe(false)
    }
  })
})
