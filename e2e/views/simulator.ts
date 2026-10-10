import { createServer, type Server } from 'node:https'
import type { AddressInfo } from 'node:net'
import {
  applicationBandProblems,
  applicationMetricResponse,
  bandProblems,
  DAY_MS,
  detailExtras,
  detailOnly,
  diskMetricResponse,
  ENTITY_NAMES,
  entityBodies,
  entityCountProblems,
  EV_ALL_COMMENTS,
  EV_ID,
  eventMetricResponse,
  type FakeProblem,
  hostBandProblems,
  hostBreakdownResponse,
  hostEventsResponse,
  hostLogsResponse,
  hostMetricResponse,
  HOUR,
  isApplicationMetricsQuery,
  isDiskMetricsQuery,
  isEventSelector,
  isHostBreakdownQuery,
  isHostMetricsQuery,
  isMonitorBreakdownQuery,
  isMonitorMetricsQuery,
  isProcessGroupMetricsQuery,
  isProcessMetricsQuery,
  isServiceSelector,
  longIdProblems,
  manyProblems,
  markerProblems,
  monitorBandProblems,
  monitorBreakdownResponse,
  monitorMetricResponse,
  NOW,
  problemsA,
  problemsB,
  PROCESS_GROUP_CUT_ID,
  PROCESS_GROUP_CUT_TOTAL,
  processBandProblems,
  processGroupBandProblems,
  processGroupInstances,
  processGroupMetricResponse,
  processGroupOf,
  processGroupSelector,
  processMetricResponse,
  serviceMetricResponse,
  serviceTypeBodies,
  shortProblems,
  spreadSeries,
  TOKEN_A,
  TOKEN_B,
  TOKEN_FORBIDDEN,
  TOKEN_NO_ENTITIES,
  TOKEN_NO_EVENTS,
  TOKEN_NO_METRICS
} from './fixtures'
import { sim } from './sim-state'
import { generate } from 'selfsigned'

/**
 * Arnés de las vistas (ficha 0069): el Dynatrace simulado, un servidor HTTPS en 127.0.0.1 con un
 * certificado propio (los entornos usan el nivel 'ignore'). Responde con los datos de
 * `fixtures.ts` según el estado de `sim`. `server` y `port` los asigna `startServer`; desde
 * fuera se leen (enlaces vivos de los módulos, ver `harness.ts`).
 */

export let server: Server
export let port = 0

export function problemsFor(token: string): FakeProblem[] {
  return token === TOKEN_B ? problemsB : problemsA
}

/** Valores de un criterio con lista, p. ej. severityLevel("A","B") → ['A', 'B']. */
export function selectorList(selector: string, name: string): string[] | undefined {
  const inner = new RegExp(`${name}\\(([^)]*)\\)`).exec(selector)?.[1]
  return inner === undefined ? undefined : [...inner.matchAll(/"([^"]*)"/g)].map((m) => m[1] ?? '')
}

/** Aplica de forma aproximada status, text, severityLevel e impactLevel del problemSelector. */
export function applySelector(problems: FakeProblem[], selector: string | null): FakeProblem[] {
  if (selector === null) return problems
  const status = /status\("(open|closed)"\)/.exec(selector)?.[1]
  const text = /text\("((?:[^"~]|~.)*)"\)/.exec(selector)?.[1]?.replace(/~(.)/g, '$1')
  const severities = selectorList(selector, 'severityLevel')
  const impacts = selectorList(selector, 'impactLevel')
  const affected = selectorList(selector, 'affectedEntities')
  const affects = (p: FakeProblem, ids: string[]): boolean =>
    ((p['affectedEntities'] as { entityId: { id: string } }[] | undefined) ?? []).some((e) =>
      ids.includes(e.entityId.id)
    )
  return problems.filter(
    (p) =>
      (affected === undefined || affects(p, affected)) &&
      (status === undefined || p.status.toLowerCase() === status) &&
      (text === undefined || p.title.toLowerCase().includes(text.toLowerCase())) &&
      (severities === undefined || severities.includes(String(p['severityLevel']))) &&
      (impacts === undefined || impacts.includes(String(p['impactLevel'])))
  )
}

export async function startServer(): Promise<void> {
  const pems = await generate([{ name: 'commonName', value: '127.0.0.1' }], {
    keySize: 2048,
    algorithm: 'sha256',
    extensions: [{ name: 'subjectAltName', altNames: [{ type: 7, ip: '127.0.0.1' }] }]
  })
  server = createServer({ key: pems.private, cert: pems.cert }, (req, res) => {
    const url = new URL(req.url ?? '/', 'https://127.0.0.1')
    const token = (req.headers.authorization ?? '').replace(/^Api-Token /, '')
    const send = (status: number, body: unknown): void => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    req.resume()
    req.on('end', () => {
      sim.requests.push(`${req.method ?? ''} ${url.pathname}`)
      if (
        ![
          TOKEN_A,
          TOKEN_B,
          TOKEN_NO_METRICS,
          TOKEN_FORBIDDEN,
          TOKEN_NO_ENTITIES,
          TOKEN_NO_EVENTS
        ].includes(token)
      ) {
        return send(401, { error: { code: 401, message: 'Missing or invalid token' } })
      }
      if (req.method === 'POST' && url.pathname === '/api/v2/apiTokens/lookup') {
        return send(200, {
          id: 'dt0c01.PUBLICAPRUEBA0000000000A',
          name: 'e2e',
          enabled: true,
          // Ficha 0042: events.read en todos menos en TOKEN_NO_EVENTS.
          scopes:
            token === TOKEN_NO_METRICS
              ? ['problems.read', 'slo.read', 'entities.read', 'events.read']
              : token === TOKEN_NO_ENTITIES
                ? ['problems.read', 'metrics.read', 'slo.read', 'events.read']
                : token === TOKEN_NO_EVENTS
                  ? ['problems.read', 'metrics.read', 'slo.read', 'entities.read']
                  : ['problems.read', 'metrics.read', 'slo.read', 'entities.read', 'events.read']
        })
      }
      if (req.method === 'GET' && url.pathname === '/api/v2/problems') {
        sim.problemsRequests += 1
        sim.lastProblemsQuery = url.searchParams
        if (sim.problemsGate !== null) {
          void sim.problemsGate.then(() => respondProblems())
          return
        }
        return respondProblems()
      }
      function respondProblems(): void {
        if (token === TOKEN_FORBIDDEN) {
          return send(403, {
            error: {
              code: 403,
              message: 'Token is missing required scope',
              details: { missingScopes: ['problems.read'] }
            }
          })
        }
        if (sim.badRequest) {
          return send(400, { error: { code: 400, message: 'Selector mal formado en la prueba' } })
        }
        const selector = url.searchParams.get('problemSelector')
        // Ficha 0007: con affectedEntities, como la API: pageSize recorta la lista y
        // totalCount sigue siendo el total.
        if (selector !== null && selector.includes('affectedEntities(')) {
          // Ficha 0010: sin status es la lista de la franja (aparte de los recuentos).
          const list = !selector.includes('status(')
          if (list) sim.entityProblemListQueries.push(url.searchParams)
          else sim.entityProblemQueries.push(url.searchParams)
          if (list && sim.entityProblemListFail) {
            return send(400, {
              error: { code: 400, message: 'Lista de problemas no disponible (simulado)' }
            })
          }
          if (!list && sim.entityProblemsFail) {
            return send(400, {
              error: { code: 400, message: 'Recuento de problemas no disponible (simulado)' }
            })
          }
          const matching = applySelector(
            [
              ...problemsFor(token),
              ...entityCountProblems,
              ...markerProblems(),
              ...bandProblems(),
              ...shortProblems(),
              ...hostBandProblems(),
              ...monitorBandProblems(),
              ...processBandProblems(),
              ...processGroupBandProblems(),
              ...applicationBandProblems(),
              ...longIdProblems()
            ],
            selector
          )
          const pageSize = Number(url.searchParams.get('pageSize') ?? '50')
          return send(200, {
            totalCount: matching.length,
            pageSize,
            problems: matching.slice(0, pageSize),
            nextPageKey: matching.length > pageSize ? 'pagina-recuento' : null
          })
        }
        const source = sim.many && token === TOKEN_A ? manyProblems : problemsFor(token)
        const selected = applySelector(source, selector)
        const problems = sim.invalidOne
          ? [...selected, { displayId: 'P-ROTO', title: 'Sin problemId', status: 'OPEN' }]
          : selected
        return send(200, {
          ...(sim.warnings.length > 0 ? { warnings: sim.warnings } : {}),
          // Al truncar, el total de la API es mayor que lo que llega (AUD-07).
          totalCount: sim.truncate ? 999 : problems.length,
          problems,
          nextPageKey: sim.truncate ? `pagina-${sim.problemsRequests}` : null
        })
      }
      const single = /^\/api\/v2\/problems\/([^/]+)$/.exec(url.pathname)
      if (req.method === 'GET' && single !== null) {
        sim.lastDetailQuery = url.searchParams
        const respondDetail = (): void => {
          // 400 y no 404 (un 404 es «no existe») ni 5xx (el cliente los reintenta).
          if (sim.detailFails) {
            return send(400, {
              error: { code: 400, message: 'Detalle no disponible en la prueba' }
            })
          }
          // Los de la lista (también los 300 masivos) y uno que solo existe en el detalle.
          const found = [
            ...problemsFor(token),
            ...manyProblems,
            ...detailOnly,
            ...bandProblems(),
            ...hostBandProblems(),
            ...monitorBandProblems(),
            ...processBandProblems(),
            ...processGroupBandProblems(),
            ...applicationBandProblems()
          ].find((p) => p['problemId'] === decodeURIComponent(single[1] ?? ''))
          return found
            ? send(200, { ...found, ...(found['problemId'] === 'pa-1' ? detailExtras : {}) })
            : send(404, { error: { code: 404, message: 'No existe' } })
        }
        if (sim.detailGate !== null) {
          void sim.detailGate.then(respondDetail)
          return
        }
        return respondDetail()
      }
      const comments = /^\/api\/v2\/problems\/([^/]+)\/comments$/.exec(url.pathname)
      if (req.method === 'GET' && comments !== null) {
        sim.commentsRequests += 1
        sim.lastCommentsQuery = url.searchParams
        return decodeURIComponent(comments[1] ?? '') === EV_ID
          ? send(200, {
              totalCount: EV_ALL_COMMENTS.length,
              pageSize: 500,
              comments: EV_ALL_COMMENTS
            })
          : send(404, { error: { code: 404, message: 'No existe' } })
      }
      if (req.method === 'GET' && url.pathname === '/api/v2/metrics') {
        // Filtra por text (AUD-13: «Sin resultados» con un texto que no casa).
        const text = (url.searchParams.get('text') ?? '').toLowerCase()
        const metrics = [
          { metricId: 'builtin:host.cpu.usage', displayName: 'CPU usage %', unit: 'Percent' },
          { metricId: 'builtin:host.cpu.idle', displayName: 'CPU idle', unit: 'Percent' }
        ].filter((m) => `${m.metricId} ${m.displayName}`.toLowerCase().includes(text))
        return send(200, { totalCount: metrics.length, nextPageKey: null, metrics })
      }
      if (req.method === 'GET' && url.pathname === '/api/v2/metrics/query') {
        sim.metricsQueries += 1
        sim.lastMetricsQuery = url.searchParams
        // v0.9.2: las de los mini gráficos de las evidencias, aparte (con su retardo y su
        // cuenta de peticiones en vuelo).
        const eventSelector = url.searchParams.get('metricSelector') ?? ''
        if (isEventSelector(eventSelector)) {
          sim.eventMetricQueries.push(url.searchParams)
          sim.eventMetricInFlight += 1
          sim.eventMetricMaxInFlight = Math.max(sim.eventMetricMaxInFlight, sim.eventMetricInFlight)
          setTimeout(() => {
            sim.eventMetricInFlight -= 1
            const [status, body] = eventMetricResponse(url.searchParams)
            send(status, body)
          }, sim.eventMetricDelayMs)
          return
        }
        // Ficha 0033: las del canal entities:applicationMetrics, aparte.
        if (isApplicationMetricsQuery(url.searchParams)) {
          sim.applicationMetricQueries.push(url.searchParams)
          const [status, body] = applicationMetricResponse(url.searchParams)
          return send(status, body)
        }
        // Ficha 0031: las del canal entities:processGroupMetrics, aparte.
        if (isProcessGroupMetricsQuery(url.searchParams)) {
          sim.processGroupMetricQueries.push(url.searchParams)
          const [status, body] = processGroupMetricResponse(url.searchParams)
          return send(status, body)
        }
        // Ficha 0027: las del canal entities:processMetrics, aparte.
        if (isProcessMetricsQuery(url.searchParams)) {
          sim.processMetricQueries.push(url.searchParams)
          const [status, body] = processMetricResponse(url.searchParams)
          return send(status, body)
        }
        // Ficha 0040: las del canal entities:diskMetrics, aparte.
        if (isDiskMetricsQuery(url.searchParams)) {
          sim.diskMetricQueries.push(url.searchParams)
          const [status, body] = diskMetricResponse(url.searchParams)
          return send(status, body)
        }
        // Ficha 0017: las del canal entities:hostBreakdown, aparte.
        if (isHostBreakdownQuery(url.searchParams)) {
          sim.hostBreakdownQueries.push(url.searchParams)
          const [status, body] = hostBreakdownResponse(url.searchParams)
          return send(status, body)
        }
        // Ficha 0023: las del canal entities:monitorBreakdown, aparte.
        if (isMonitorBreakdownQuery(url.searchParams)) {
          sim.monitorBreakdownQueries.push(url.searchParams)
          const [status, body] = monitorBreakdownResponse(url.searchParams)
          return send(status, body)
        }
        // Ficha 0022: las del canal entities:monitorMetrics, aparte.
        if (isMonitorMetricsQuery(url.searchParams)) {
          sim.monitorMetricQueries.push(url.searchParams)
          const [status, body] = monitorMetricResponse(url.searchParams)
          return send(status, body)
        }
        // Ficha 0016: las del canal entities:hostMetrics, aparte (antes que la vista Métricas).
        if (isHostMetricsQuery(url.searchParams)) {
          sim.hostMetricQueries.push(url.searchParams)
          const [status, body] = hostMetricResponse(url.searchParams)
          return send(status, body)
        }
        // Ficha 0006: las del canal entities:serviceMetrics, aparte.
        if (isServiceSelector(eventSelector)) {
          sim.serviceMetricQueries.push(url.searchParams)
          const [status, body] = serviceMetricResponse(url.searchParams)
          return send(status, body)
        }
        // v0.10.2: con metricsSpread, puntos por todo el rango (now-7d o ISO), para el eje de días.
        const relative = /^now-(\d+)([mhd])$/.exec(url.searchParams.get('from') ?? '')
        const spreadQuery = new URLSearchParams(url.searchParams)
        if (relative !== null) {
          const unit = { m: 60_000, h: HOUR, d: DAY_MS }[relative[2] as 'm' | 'h' | 'd']
          spreadQuery.set('from', new Date(Date.now() - Number(relative[1]) * unit).toISOString())
          spreadQuery.set('to', new Date().toISOString())
        }
        const spread = sim.metricsSpread ? spreadSeries(spreadQuery) : null
        const timestamps = spread?.timestamps ?? [0, 1, 2, 3, 4].map((i) => NOW - (4 - i) * 60_000)
        // Varias métricas separadas por comas: un resultado por métrica.
        const selectors = (url.searchParams.get('metricSelector') ?? 'x').split(',')
        return send(200, {
          resolution: spread?.resolution ?? url.searchParams.get('resolution') ?? '1m',
          totalCount: selectors.length,
          ...(sim.metricWarnings.length > 0 ? { warnings: sim.metricWarnings } : {}),
          result: selectors.map((metricId) => ({
            metricId,
            ...sim.metricRatios,
            data: [
              {
                dimensionMap: { 'dt.entity.host': 'HOST-AAA1' },
                timestamps,
                values:
                  spread === null
                    ? [10, 20, null, 15, 30]
                    : timestamps.map((_, i) => 10 + (i % 5) * 4)
              }
            ]
          }))
        })
      }
      if (req.method === 'GET' && url.pathname === '/api/v2/slo') {
        return send(200, {
          totalCount: 4,
          nextPageKey: null,
          slo: [
            {
              id: 'slo-1',
              name: 'Disponibilidad pagos',
              enabled: true,
              status: 'SUCCESS',
              target: 99.5,
              warning: 99.8,
              evaluatedPercentage: 99.9,
              errorBudget: 80,
              error: 'NONE',
              relatedOpenProblems: 0
            },
            {
              id: 'slo-2',
              name: 'Latencia carrito',
              enabled: true,
              status: 'FAILURE',
              target: 95,
              warning: 97,
              evaluatedPercentage: 90.1,
              errorBudget: -20,
              error: 'NONE',
              relatedOpenProblems: 2
            },
            {
              // Entre target y warning: la API dice WARNING.
              id: 'slo-3',
              name: 'Errores de login',
              enabled: true,
              status: 'WARNING',
              target: 99,
              warning: 99.5,
              evaluatedPercentage: 99.2,
              errorBudget: 20,
              error: 'NONE',
              // -1: Dynatrace no pudo calcularlo (OpenAPI). Con sim.sloRelatedFailed a false, 0.
              relatedOpenProblems: sim.sloRelatedFailed ? -1 : 0
            },
            {
              // Sin evaluar: la API da -1 y SUCCESS; la tarjeta no puede decir «Correcto».
              id: 'slo-4',
              name: 'Búsqueda sin datos',
              enabled: true,
              status: 'SUCCESS',
              target: 98,
              warning: 99,
              evaluatedPercentage: -1,
              errorBudget: -1,
              error: 'NONE'
            }
          ]
        })
      }
      // Ficha 0042: eventos (entities:hostEvents).
      if (req.method === 'GET' && url.pathname === '/api/v2/events') {
        const events = hostEventsResponse(url.searchParams)
        return send(events.status, events.body)
      }
      // Ficha 0014: una entidad (entities:get) y los nombres de una lista de ids (entities:names).
      const entityPath = /^\/api\/v2\/entities\/([^/]+)$/.exec(url.pathname)
      // Ficha 0046: la entidad que pide entities:serviceMetrics para elegir las métricas.
      if (
        req.method === 'GET' &&
        entityPath !== null &&
        (url.searchParams.get('fields') ?? '').includes('properties.serviceType')
      ) {
        const id = decodeURIComponent(entityPath[1] ?? '')
        sim.serviceEntityQueries.push(`${id} ${url.searchParams.get('fields') ?? ''}`)
        if (token === TOKEN_NO_ENTITIES) {
          return send(403, {
            error: {
              code: 403,
              message: 'Token is missing required scope',
              details: { missingScopes: ['entities.read'] }
            }
          })
        }
        const body = serviceTypeBodies()[id]
        return body !== undefined
          ? send(200, body)
          : send(404, { error: { code: 404, message: 'Entity not found' } })
      }
      if (req.method === 'GET' && entityPath !== null) {
        sim.entityInfoQueries.push(url.searchParams)
        if (sim.entityInfoFail) {
          return send(400, { error: { code: 400, message: 'Consulta de entidad rechazada' } })
        }
        const body = entityBodies()[decodeURIComponent(entityPath[1] ?? '')]
        return body !== undefined
          ? send(200, body)
          : send(404, { error: { code: 404, message: 'Entity not found' } })
      }
      if (req.method === 'GET' && url.pathname === '/api/v2/entities') {
        // Ficha 0050: el total real de instancias de un grupo inventado (totalCount, con la
        // primera página de pageSize), como en vivo con el selector de la 0031.
        const group = processGroupOf(url.searchParams)
        if (
          group !== null &&
          url.searchParams.get('entitySelector') === processGroupSelector(group)
        ) {
          sim.processGroupEntityQueries.push(url.searchParams)
          // Ficha 0051: sin entities.read, el total real no se puede saber.
          if (sim.processGroupEntitiesFail) {
            return send(403, {
              error: { code: 403, message: 'Token sin entities.read (simulado)' }
            })
          }
          const all = processGroupInstances(group)
          const totalCount = group === PROCESS_GROUP_CUT_ID ? PROCESS_GROUP_CUT_TOTAL : all.length
          const pageSize = Number(url.searchParams.get('pageSize') ?? '50')
          const entities = all.slice(0, pageSize).map((instance) => ({
            entityId: instance.id,
            displayName: instance.name,
            type: 'PROCESS_GROUP_INSTANCE'
          }))
          return send(200, {
            totalCount,
            pageSize,
            nextPageKey: totalCount > entities.length ? 'AQAAABQBAAAABQ==' : null,
            entities
          })
        }
        // Ficha 0041: la consulta de logs del host no es de entities:names.
        const logs = hostLogsResponse(url.searchParams)
        if (logs !== null) return send(logs.status, logs.body)
        sim.entityNamesQueries.push(url.searchParams)
        const selector = url.searchParams.get('entitySelector') ?? ''
        const inner = /^entityId\((.*)\)$/.exec(selector)?.[1]
        if (inner === undefined) {
          return send(400, { error: { code: 400, message: 'entitySelector no válido' } })
        }
        const ids = [...inner.matchAll(/"([^"]*)"/g)].map((m) => m[1] ?? '')
        const entities = ids
          .filter((id) => ENTITY_NAMES[id] !== undefined)
          .map((id) => ({ entityId: id, displayName: ENTITY_NAMES[id], type: id.split('-')[0] }))
        return send(200, { totalCount: entities.length, pageSize: 50, entities })
      }
      send(404, { error: { code: 404, message: 'No existe' } })
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  port = (server.address() as AddressInfo).port
}
