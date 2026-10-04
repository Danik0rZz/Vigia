import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, it } from 'vitest'
import { z } from 'zod'
import { createLiveClient } from '../../test/live-client'
import { loadLiveEnv } from '../../test/live-env'

/**
 * EXPLORACIÓN EN VIVO para la 0.10.0 (tabla de eventos con su propio
 * estado), SOLO LECTURA y con pocas peticiones.
 *
 * El informe (live-reports/problems-event-state.json, ignorado) guarda SOLO
 * la forma: qué campos de `data` llegan, si data.status cuadra con endTime,
 * la forma de entityTags (sin ningún tag) y el tipo de los flags, en
 * proporciones redondeadas. Nunca títulos, tags, ids ni nombres.
 */

const env = loadLiveEnv()
const live = env === null ? null : createLiveClient(env)
const report: Record<string, unknown> = {}
const timings: number[] = []
/** Detalles que se piden como mucho (abiertos y cerrados). */
const MAX_DETAILS = 10

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

const share = (part: number, whole: number): string =>
  whole === 0 ? 'sin datos' : `${Math.round((part / whole) * 20) * 5} %`

const bucket = (count: number): string =>
  count === 0 ? '0' : count < 10 ? '1-9' : count <= 50 ? '10-50' : 'más de 50'

/** Tipo de un valor para el informe (sin el valor). */
const kind = (value: unknown): string =>
  value === undefined
    ? 'ausente'
    : value === null
      ? 'null'
      : Array.isArray(value)
        ? 'array'
        : typeof value

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
    join('live-reports', 'problems-event-state.json'),
    `${JSON.stringify(report, null, 2)}\n`
  )
})

describe.skipIf(live === null)('0.10.0: estado propio de los eventos', () => {
  it('data.status frente a endTime, entityTags y flags', async () => {
    const list = (await get('/problems', {
      from: 'now-7d',
      pageSize: 100,
      sort: '-startTime'
    })) as Raw
    const all = (list['problems'] as Raw[] | undefined) ?? []
    const problems = [
      ...all.filter((p) => p['status'] === 'OPEN').slice(0, MAX_DETAILS / 2),
      ...all.filter((p) => p['status'] === 'CLOSED').slice(0, MAX_DETAILS / 2)
    ]

    let events = 0
    let withData = 0
    const dataKeys = new Set<string>()
    let statusOpen = 0
    let statusClosed = 0
    let statusOther = 0
    let coherent = 0
    let incoherent = 0
    const evidenceEndForms = new Set<string>()
    const dataEndForms = new Set<string>()
    const tagForms = new Set<string>()
    let withTags = 0
    const flagKinds: Record<string, Set<string>> = {}
    const flagTrue: Record<string, number> = {}
    let titleEqualsDisplay = 0
    let withTitle = 0
    let closedProblemWithOpenEvent = 0
    let openProblemWithClosedEvent = 0

    for (const problem of problems) {
      const id = String(problem['problemId'])
      const detail = (await get(`/problems/${encodeURIComponent(id)}`, {
        fields: 'evidenceDetails'
      })) as Raw
      const details =
        ((detail['evidenceDetails'] as Raw | undefined)?.['details'] as Raw[] | undefined) ?? []
      let anyOpen = false
      let anyClosed = false
      for (const evidence of details) {
        if (evidence['evidenceType'] !== 'EVENT') continue
        events += 1
        const end = evidence['endTime']
        evidenceEndForms.add(end === -1 ? '-1' : kind(end) === 'number' ? 'número' : kind(end))
        const data = evidence['data'] as Raw | undefined
        if (data === undefined || data === null) continue
        withData += 1
        for (const key of Object.keys(data)) dataKeys.add(key)
        const dataEnd = data['endTime']
        dataEndForms.add(
          dataEnd === -1 ? '-1' : kind(dataEnd) === 'number' ? 'número' : kind(dataEnd)
        )
        const status = data['status']
        if (status === 'OPEN') statusOpen += 1
        else if (status === 'CLOSED') statusClosed += 1
        else statusOther += 1
        // ¿Cuadra con el fin de la evidencia? Activa = -1, null o ausente.
        const activeByEnd = end === -1 || end === null || end === undefined
        if (status === 'OPEN' || status === 'CLOSED') {
          if ((status === 'OPEN') === activeByEnd) coherent += 1
          else incoherent += 1
          if (status === 'OPEN') anyOpen = true
          else anyClosed = true
        }
        const tags = data['entityTags']
        if (Array.isArray(tags) && tags.length > 0) {
          withTags += 1
          for (const tag of tags as Raw[]) tagForms.add(Object.keys(tag).sort().join(','))
        }
        for (const flag of [
          'underMaintenance',
          'frequentEvent',
          'suppressProblem',
          'suppressAlert'
        ]) {
          ;(flagKinds[flag] ??= new Set()).add(kind(data[flag]))
          if (data[flag] === true) flagTrue[flag] = (flagTrue[flag] ?? 0) + 1
        }
        if (typeof data['title'] === 'string') {
          withTitle += 1
          if (data['title'] === evidence['displayName']) titleEqualsDisplay += 1
        }
      }
      if (problem['status'] === 'CLOSED' && anyOpen) closedProblemWithOpenEvent += 1
      if (problem['status'] === 'OPEN' && anyClosed) openProblemWithClosedEvent += 1
    }

    report['detalles mirados'] = problems.length
    report['evidencias EVENT'] = bucket(events)
    report['EVENT con data'] = share(withData, events)
    report['claves de data'] = [...dataKeys].sort()
    report['data.status'] = {
      OPEN: share(statusOpen, withData),
      CLOSED: share(statusClosed, withData),
      otro: share(statusOther, withData)
    }
    report['data.status cuadra con el endTime de la evidencia'] = share(
      coherent,
      coherent + incoherent
    )
    report['data.status NO cuadra (cuántos)'] = bucket(incoherent)
    report['endTime de la evidencia (formas)'] = [...evidenceEndForms].sort()
    report['data.endTime (formas)'] = [...dataEndForms].sort()
    report['data.entityTags: con alguno'] = share(withTags, withData)
    report['data.entityTags: claves de cada tag'] = [...tagForms].sort()
    report['flags: tipos'] = Object.fromEntries(
      Object.entries(flagKinds).map(([flag, kinds]) => [flag, [...kinds].sort()])
    )
    report['flags: en true'] = Object.fromEntries(
      Object.entries(flagTrue).map(([flag, count]) => [flag, share(count, withData)])
    )
    report['data.title igual a displayName'] = share(titleEqualsDisplay, withTitle)
    report['problemas cerrados con algún evento abierto'] = bucket(closedProblemWithOpenEvent)
    report['problemas abiertos con algún evento cerrado'] = bucket(openProblemWithClosedEvent)
  })
})
