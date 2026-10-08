import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createLiveClient } from '../../test/live-client'
import { loadLiveEnv } from '../../test/live-env'
import { DtError } from '../dynatrace/errors'

/**
 * Ficha 0023: EXPLORACIÓN EN VIVO del desglose de los monitores sintéticos, por
 * localización y por paso (browser) o petición (HTTP). SOLO LECTURA, una petición
 * detrás de otra.
 *
 * Lección de la 0022: cada expresión del canal tiene que ser EXACTAMENTE una de las
 * que se prueban aquí. Para 3 monitores de cada tipo, cada expresión candidata se
 * pide sola y en el selector del canal, con y sin `resolution=Inf`, y se anota:
 * código, `metricId` igual a la expresión, series (tramo; el tope es 1000), claves
 * de `dimensionMap` (¿llegan los `.name` con `:names`?), ratios y si las series
 * coinciden en número con las localizaciones (`runsOn`) y los pasos (`isStepOf`) de
 * la entidad. También las claves de las propiedades de los pasos (¿número de
 * secuencia?).
 *
 * El informe (live-reports/monitor-breakdown-explore.json, ignorado) guarda SOLO
 * comportamientos y claves de la API. Nunca un id, un nombre ni un valor.
 */

const env = loadLiveEnv()
const live = env === null ? null : createLiveClient(env)
const report: Record<string, unknown> = {}
const timings: number[] = []
const observed = new Set<string>()
const MAX_MONITORS = 3
const FROM = 'now-24h'

type Kind = 'browser' | 'httpCheck'
type Raw = Record<string, unknown>
const ID_PATTERN = /^(SYNTHETIC_TEST|HTTP_CHECK)-[0-9A-F]{16}$/
const TYPES: Record<Kind, { entityType: string; stepType: string; prefix: string }> = {
  browser: {
    entityType: 'SYNTHETIC_TEST',
    stepType: 'SYNTHETIC_TEST_STEP',
    prefix: 'builtin:synthetic.browser.'
  },
  httpCheck: {
    entityType: 'HTTP_CHECK',
    stepType: 'HTTP_CHECK_STEP',
    prefix: 'builtin:synthetic.http.'
  }
}

const B = 'builtin:synthetic.browser.'
const H = 'builtin:synthetic.http.'
const BY_LOCATION = ':splitBy("dt.entity.synthetic_location")'
const BY_TEST_STEP = ':splitBy("dt.entity.synthetic_test_step")'
const BY_CHECK_STEP = ':splitBy("dt.entity.http_check_step")'
/** Filtro por el monitor; `<id>` se cambia por el id al pedir (el informe guarda la plantilla). */
const BY_TEST_FILTER = ':filter(eq("dt.entity.synthetic_test","<id>"))'
const withId = (template: string, id: string): string => template.split('<id>').join(id)

/** Ámbito de la consulta: el monitor, sus pasos (por relación) o sin entitySelector. */
type Scope = 'monitor' | 'steps' | 'none'
interface Candidate {
  role: string
  expression: string
  scope: Scope
}

/** Expresiones candidatas por tipo (las del canal saldrán de las que respondan bien). */
const CANDIDATES: Record<Kind, Candidate[]> = {
  browser: [
    {
      role: 'locAvailability',
      expression: `${B}availability${BY_LOCATION}:avg:names`,
      scope: 'monitor'
    },
    {
      role: 'locDuration',
      expression: `${B}duration${BY_LOCATION}:avg:names`,
      scope: 'monitor'
    },
    {
      role: 'stepDuration',
      expression: `${B}step.duration${BY_TEST_STEP}:avg:names`,
      scope: 'monitor'
    },
    {
      role: 'stepDuration',
      expression: `${B}step.duration${BY_TEST_STEP}:avg:names`,
      scope: 'steps'
    },
    {
      role: 'locAvailability',
      expression: `${B}availability${BY_TEST_FILTER}${BY_LOCATION}:avg:names`,
      scope: 'monitor'
    },
    {
      role: 'locDuration',
      expression: `${B}duration${BY_TEST_FILTER}${BY_LOCATION}:avg:names`,
      scope: 'monitor'
    },
    {
      role: 'locDuration',
      expression: `${B}duration${BY_TEST_FILTER}${BY_LOCATION}:avg:names`,
      scope: 'none'
    },
    {
      role: 'stepDuration',
      expression: `${B}step.duration${BY_TEST_FILTER}${BY_TEST_STEP}:avg:names`,
      scope: 'monitor'
    },
    {
      role: 'stepDuration',
      expression: `${B}step.duration${BY_TEST_FILTER}${BY_TEST_STEP}:avg:names`,
      scope: 'none'
    }
  ],
  httpCheck: [
    {
      role: 'locAvailability',
      expression: `${H}availability${BY_LOCATION}:avg:names`,
      scope: 'monitor'
    },
    {
      role: 'locAvailability',
      expression: `${H}availability.location.total${BY_LOCATION}:avg:names`,
      scope: 'monitor'
    },
    {
      role: 'locDuration',
      expression: `${H}duration.geo${BY_LOCATION}:avg:names`,
      scope: 'monitor'
    },
    {
      role: 'locFailed',
      expression: `${H}resultStatus:filter(eq("Result status","FAILURE"))${BY_LOCATION}:sum:names`,
      scope: 'monitor'
    },
    {
      role: 'stepDuration',
      expression: `${H}request.duration.geo${BY_CHECK_STEP}:avg:names`,
      scope: 'steps'
    },
    {
      role: 'stepDuration',
      expression: `${H}request.duration.geo${BY_CHECK_STEP}:avg:names`,
      scope: 'monitor'
    }
  ]
}

/** Selector de localizaciones que se propone para el canal (ámbito: entityId del monitor). */
const CHANNEL_LOCATIONS: Record<Kind, string[]> = {
  browser: [
    `${B}availability${BY_LOCATION}:avg:names`,
    `${B}duration${BY_TEST_FILTER}${BY_LOCATION}:avg:names`
  ],
  httpCheck: [
    `${H}availability${BY_LOCATION}:avg:names`,
    `${H}duration.geo${BY_LOCATION}:avg:names`,
    `${H}resultStatus:filter(eq("Result status","FAILURE"))${BY_LOCATION}:sum:names`
  ]
}

const catalogs: Record<Kind, { metricId: string; dimensions: string[]; aggs: unknown }[]> = {
  browser: [],
  httpCheck: []
}
const monitors: Record<Kind, string[]> = { browser: [], httpCheck: [] }

const isEnum = (value: string): boolean =>
  /^[A-Z][A-Z0-9_]*$/.test(value) || /^(true|false|null)$/.test(value)
const observe = (value: unknown): void => {
  if (typeof value === 'string' && !isEnum(value)) observed.add(value)
}
const dimKey = (key: string): string =>
  /^[A-Za-z][A-Za-z0-9_.: ()-]{0,40}$/.test(key) ? key : 'otra'
const apiKey = (key: string): string => (/^[A-Za-z][A-Za-z0-9_.:-]*$/.test(key) ? key : 'otra')
const bucket = (count: number): string =>
  count === 0
    ? '0'
    : count === 1
      ? '1'
      : count < 10
        ? '2-9'
        : count <= 150
          ? '10-150'
          : count <= 1000
            ? '151-1000'
            : 'más de 1000'
const ratioBucket = (value: unknown): string =>
  typeof value !== 'number'
    ? 'sin campo'
    : value < 0.01
      ? '< 0.01'
      : value < 1
        ? '[0.01, 1)'
        : value === 1
          ? '1'
          : '> 1'
function range(value: number | null): string {
  if (value === null) return 'null'
  if (value < 0) return '< 0'
  if (value <= 1) return '[0, 1]'
  if (value <= 100) return '(1, 100]'
  if (value <= 1e6) return '(100, 1e6]'
  return '> 1e6'
}
const compareCount = (a: number, b: number): string =>
  a === b ? 'iguales' : a < b ? 'menos series' : 'más series'

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

const entitySelectorFor = (kind: Kind, id: string, scope: Scope): Record<string, string> =>
  scope === 'none'
    ? {}
    : {
        entitySelector:
          scope === 'monitor'
            ? `entityId("${id}")`
            : `type("${TYPES[kind].stepType}"),fromRelationships.isStepOf(entityId("${id}"))`
      }

/** Resumen de un resultado de /metrics/query, sin valores. */
function summarize(result: Raw | undefined, expression: string, counts: Raw): Raw {
  const data = (result?.['data'] as Raw[] | undefined) ?? []
  const keys = new Set<string>()
  let namesForAll = data.length > 0
  for (const item of data) {
    const map = (item['dimensionMap'] as Record<string, unknown> | undefined) ?? {}
    for (const [dimension, value] of Object.entries(map)) {
      keys.add(dimKey(dimension))
      observe(value)
    }
    const entityDims = Object.keys(map).filter(
      (dimension) => dimension.startsWith('dt.entity.') && !dimension.endsWith('.name')
    )
    if (!entityDims.every((dimension) => typeof map[`${dimension}.name`] === 'string'))
      namesForAll = false
  }
  const values = data.flatMap((d) => (d['values'] as (number | null)[] | undefined) ?? [])
  const present = values.filter((v): v is number => v !== null)
  const points = data.map((d) => ((d['values'] as unknown[] | undefined) ?? []).length)
  return {
    metricIdIgualAlPedido: result?.['metricId'] === expression,
    series: bucket(data.length),
    puntosPorSerie: [...new Set(points.map(bucket))].sort(),
    clavesDeDimensionMap: [...keys].sort(),
    nombresEnTodas: namesForAll,
    nulos: `${values.length - present.length} de ${values.length}`,
    tramoMax: range(present.length === 0 ? null : Math.max(...present)),
    tramoMin: range(present.length === 0 ? null : Math.min(...present)),
    ratios: [
      ratioBucket(result?.['dataPointCountRatio']),
      ratioBucket(result?.['dimensionCountRatio'])
    ],
    ...counts
  }
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
    join('live-reports', 'monitor-breakdown-explore.json'),
    `${JSON.stringify(report, null, 2)}\n`
  )
})

describe.skipIf(live === null)('Ficha 0023: desglose de los monitores (paso 0)', () => {
  it('catálogo: métricas con dimensión de localización o de paso', async () => {
    const out: Record<string, unknown> = {}
    for (const kind of ['browser', 'httpCheck'] as const) {
      const { body } = await codeOf(
        get('/metrics', {
          metricSelector: `${TYPES[kind].prefix}*`,
          fields: '+dimensionDefinitions,+aggregationTypes',
          pageSize: 500
        })
      )
      catalogs[kind] = ((body?.['metrics'] as Raw[] | undefined) ?? []).map((m) => ({
        metricId: String(m['metricId']),
        aggs: m['aggregationTypes'] ?? null,
        dimensions: ((m['dimensionDefinitions'] as Raw[] | undefined) ?? []).map((d) =>
          dimKey(String(d['key']))
        )
      }))
      out[kind] = catalogs[kind]
        .filter((m) =>
          m.dimensions.some(
            (d) =>
              d === 'dt.entity.synthetic_location' ||
              d === 'dt.entity.synthetic_test_step' ||
              d === 'dt.entity.http_check_step'
          )
        )
        .map((m) => ({ metrica: m.metricId, dimensiones: m.dimensions, agregaciones: m.aggs }))
    }
    report['catalogo'] = out
    expect(catalogs.browser.length + catalogs.httpCheck.length).toBeGreaterThan(0)
  })

  it('elige como mucho 3 monitores de cada tipo', async () => {
    const list = (await get('/problems', { from: 'now-7d', pageSize: 100 })) as Raw
    for (const problem of (list['problems'] as Raw[] | undefined) ?? []) {
      observe(problem['problemId'])
      observe(problem['displayId'])
      observe(problem['title'])
      for (const entity of [
        ...((problem['affectedEntities'] as Raw[] | undefined) ?? []),
        ...((problem['impactedEntities'] as Raw[] | undefined) ?? [])
      ]) {
        const id = (entity['entityId'] as Raw | undefined)?.['id']
        observe(entity['name'])
        if (typeof id !== 'string') continue
        observed.add(id)
        if (!ID_PATTERN.test(id)) continue
        const kind: Kind = id.startsWith('HTTP_CHECK-') ? 'httpCheck' : 'browser'
        if (!monitors[kind].includes(id)) monitors[kind].push(id)
      }
    }
    for (const kind of ['browser', 'httpCheck'] as const) {
      if (monitors[kind].length < MAX_MONITORS) {
        const page = (await get('/entities', {
          entitySelector: `type("${TYPES[kind].entityType}")`,
          from: 'now-7d',
          pageSize: 2 * MAX_MONITORS
        })) as Raw
        for (const entity of (page['entities'] as Raw[] | undefined) ?? []) {
          const id = String(entity['entityId'])
          observed.add(id)
          observe(entity['displayName'])
          if (!monitors[kind].includes(id)) monitors[kind].push(id)
        }
      }
      monitors[kind].splice(MAX_MONITORS)
    }
    report['monitores'] = { browser: monitors.browser.length, httpCheck: monitors.httpCheck.length }
    expect(monitors.browser.length + monitors.httpCheck.length).toBeGreaterThan(0)
  })

  it('cada expresión candidata, sola y en el selector del canal, con y sin Inf', async () => {
    const out: Record<string, unknown> = {}
    for (const kind of ['browser', 'httpCheck'] as const) {
      const rows: unknown[] = []
      for (const [index, id] of monitors[kind].entries()) {
        // Entidad: cuántas localizaciones y pasos tiene (para comparar con las series).
        const entity = await codeOf(
          get(`/entities/${id}`, { fields: '+properties,+fromRelationships,+toRelationships' })
        )
        observe(entity.body?.['displayName'])
        const runsOn = ((entity.body?.['fromRelationships'] as Raw | undefined)?.['runsOn'] ??
          []) as Raw[]
        const isStepOf = ((entity.body?.['toRelationships'] as Raw | undefined)?.['isStepOf'] ??
          []) as Raw[]
        for (const target of [...runsOn, ...isStepOf]) observed.add(String(target['id']))
        const properties = (entity.body?.['properties'] as Raw | undefined) ?? {}
        for (const value of Object.values(properties)) {
          observe(value)
          if (Array.isArray(value)) for (const item of value) observe(item)
        }
        const stepsProperty = properties['steps']
        const stepItems = Array.isArray(stepsProperty) ? (stepsProperty as unknown[]) : []
        const stepItemKeys = new Set<string>()
        for (const item of stepItems) {
          if (item !== null && typeof item === 'object') {
            for (const [key, value] of Object.entries(item as Raw)) {
              stepItemKeys.add(apiKey(key))
              observe(value)
            }
          }
        }

        // Pasos como entidades: claves de sus propiedades (¿número de secuencia?).
        const stepsPage = await codeOf(
          get('/entities', {
            ...entitySelectorFor(kind, id, 'steps'),
            fields: '+properties',
            from: 'now-7d',
            pageSize: 50
          })
        )
        const stepEntities = (stepsPage.body?.['entities'] as Raw[] | undefined) ?? []
        const stepPropertyKeys = new Set<string>()
        for (const step of stepEntities) {
          observed.add(String(step['entityId']))
          observe(step['displayName'])
          for (const [key, value] of Object.entries(
            (step['properties'] as Raw | undefined) ?? {}
          )) {
            stepPropertyKeys.add(apiKey(key))
            observe(value)
          }
        }
        const counts = { localizaciones: runsOn.length, pasos: isStepOf.length }

        // Cada candidata, sola, con y sin Inf.
        const single: unknown[] = []
        for (const candidate of CANDIDATES[kind]) {
          for (const inf of [false, true]) {
            const { code, body } = await codeOf(
              get('/metrics/query', {
                metricSelector: withId(candidate.expression, id),
                ...entitySelectorFor(kind, id, candidate.scope),
                from: FROM,
                ...(inf ? { resolution: 'Inf' } : {})
              })
            )
            const result = ((body?.['result'] as Raw[] | undefined) ?? [])[0]
            const data = (result?.['data'] as Raw[] | undefined) ?? []
            const reference =
              candidate.role === 'stepDuration' ? counts.pasos : counts.localizaciones
            single.push({
              papel: candidate.role,
              expresion: candidate.expression,
              ambito: candidate.scope,
              inf,
              codigo: code,
              resolution: body?.['resolution'] ?? null,
              ...summarize(result, withId(candidate.expression, id), {
                seriesFrenteAEntidad: compareCount(data.length, reference),
                metricIdDevuelto: String(result?.['metricId'] ?? '')
                  .split(id)
                  .join('<id>')
              })
            })
          }
        }

        // Selector del canal: las de localización juntas (ámbito del monitor), con y sin Inf.
        const locationExpressions = CHANNEL_LOCATIONS[kind]
        const together: unknown[] = []
        for (const inf of [false, true]) {
          const { code, body } = await codeOf(
            get('/metrics/query', {
              metricSelector: locationExpressions.map((e) => withId(e, id)).join(','),
              ...entitySelectorFor(kind, id, 'monitor'),
              from: FROM,
              ...(inf ? { resolution: 'Inf' } : {})
            })
          )
          const results = (body?.['result'] as Raw[] | undefined) ?? []
          together.push({
            inf,
            codigo: code,
            resultados: results.length,
            metricIds: results.map((r) => String(r['metricId']).split(id).join('<id>')),
            series: results.map((r) => bucket(((r['data'] as Raw[] | undefined) ?? []).length)),
            seriesFrenteALocalizaciones: results.map((r) =>
              compareCount(((r['data'] as Raw[] | undefined) ?? []).length, runsOn.length)
            ),
            // ¿Las series de cada localización vienen en el mismo orden en todas las métricas?
            mismoOrdenDeLocalizaciones: (() => {
              const orders = results.map((r) =>
                ((r['data'] as Raw[] | undefined) ?? []).map((d) =>
                  String(
                    ((d['dimensionMap'] as Raw | undefined) ?? {})['dt.entity.synthetic_location']
                  )
                )
              )
              return orders.every((o) => JSON.stringify(o) === JSON.stringify(orders[0]))
            })()
          })
        }

        rows.push({
          monitor: `#${index + 1}`,
          entidad: entity.code,
          localizacionesEnLaEntidad: bucket(runsOn.length),
          pasosEnLaEntidad: bucket(isStepOf.length),
          propiedadSteps: {
            tipo: Array.isArray(stepsProperty) ? 'lista' : typeof stepsProperty,
            elementos: bucket(stepItems.length),
            clavesDeCadaElemento: [...stepItemKeys].sort(),
            igualQueIsStepOf: stepItems.length === isStepOf.length
          },
          pasosComoEntidades: {
            codigo: stepsPage.code,
            cuantos: bucket(stepEntities.length),
            igualQueIsStepOf: stepEntities.length === isStepOf.length,
            clavesDePropiedades: [...stepPropertyKeys].sort()
          },
          porExpresion: single,
          selectorDeLocalizacion: together
        })
      }
      out[kind] = rows
    }
    report['exploracion'] = out
  })

  it('el informe no contiene ningún id ni nombre observado', () => {
    const text = JSON.stringify(report)
    for (const value of observed) {
      if (value.length < 4) continue
      expect(text.includes(value), 'el informe contiene un id o un nombre observado').toBe(false)
    }
    expect(observed.size).toBeGreaterThan(0)
  })
})
