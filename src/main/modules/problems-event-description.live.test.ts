import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createLiveClient } from '../../test/live-client'
import { loadLiveEnv } from '../../test/live-env'

/**
 * Ficha 0001, paso 0 (CA1): MEDIR `dt.event.description` en vivo, SOLO LECTURA y
 * con pocas peticiones (GET /problems de 7 días y como mucho 10
 * GET /problems/{id}?fields=evidenceDetails), para fijar MAX_DESCRIPTION_LENGTH.
 *
 * El informe (live-reports/problems-event-description.json, ignorado) guarda
 * SOLO comportamientos: proporciones, posiciones, longitudes, tramos, rasgos de
 * Markdown y esquemas de enlace. Nunca el texto de una descripción, un id ni un
 * nombre; el test lo comprueba antes de escribirlo.
 */

const env = loadLiveEnv()
const live = env === null ? null : createLiveClient(env)
const report: Record<string, unknown> = {}
const timings: number[] = []
const DESCRIPTION_KEY = 'dt.event.description'
/** Detalles de problema que se piden como mucho. */
const MAX_DETAILS = 10
/** Propiedades que main mandaba antes de esta ficha (MAX_EVENT_PROPERTIES). */
const SHOWN_PROPERTIES = 8
/** Esquemas que se nombran en el informe; cualquier otro cuenta como «otro». */
const KNOWN_SCHEMES = new Set(['http', 'https', 'mailto', 'ftp', 'file', 'javascript', 'data'])

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

const LENGTH_BUCKETS: [string, number][] = [
  ['≤ 300', 300],
  ['≤ 1 000', 1000],
  ['≤ 5 000', 5000],
  ['≤ 10 000', 10_000],
  ['≤ 20 000', 20_000]
]
const lengthBucket = (length: number): string =>
  LENGTH_BUCKETS.find(([, limit]) => length <= limit)?.[0] ?? 'más de 20 000'

/** Rasgos de Markdown que se cuentan (solo si aparecen, nunca qué dicen). */
const MARKDOWN_FEATURES: Record<string, RegExp> = {
  títulos: /^\s{0,3}#{1,6}\s/m,
  listas: /^\s*(?:[-*+]|\d+[.)])\s+\S/m,
  negrita: /(\*\*|__)(?=\S)[\s\S]*?\S\1/,
  código: /`[^`\n]+`|^\s*(?:```|~~~)/m,
  tablas: /^\s*\|?[^\n]*\|[^\n]*\n\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?\s*$/m,
  enlaces: /(?<!!)\[[^\]\n]*\]\([^)\s]+[^)]*\)|<[a-z][a-z0-9+.-]*:[^>\s]+>|\bhttps?:\/\/\S/i,
  imágenes: /!\[[^\]\n]*\]\([^)]+\)/
}
const RAW_HTML = /<[a-zA-Z][\w-]*(?=[\s>/])/

/** Esquemas de los enlaces (Markdown, autoenlaces y URL sueltas), solo el nombre. */
function linkSchemes(text: string): string[] {
  const found = [
    ...text.matchAll(/\]\(\s*<?([a-z][a-z0-9+.-]*):/gi),
    ...text.matchAll(/<([a-z][a-z0-9+.-]*):[^>\s]+>/gi),
    ...text.matchAll(/^\s*\[[^\]]+\]:\s*<?([a-z][a-z0-9+.-]*):/gim),
    ...text.matchAll(/\b(https?):\/\//gi)
  ].map((match) => (match[1] ?? '').toLowerCase())
  return found.map((scheme) => (KNOWN_SCHEMES.has(scheme) ? scheme : 'otro'))
}

/** Todos los valores hoja del informe, como texto (las claves son fijas de este fichero). */
function leaves(value: unknown): string[] {
  if (value === null || value === undefined) return []
  if (Array.isArray(value)) return value.flatMap(leaves)
  if (typeof value === 'object') return Object.values(value as Raw).flatMap(leaves)
  return [String(value)]
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
    join('live-reports', 'problems-event-description.json'),
    `${JSON.stringify(report, null, 2)}\n`
  )
})

describe.skipIf(live === null)('CA1 (0001): medición en vivo de dt.event.description', () => {
  it('informe de comportamientos, sin textos, ids ni nombres', async () => {
    const list = (await get('/problems', {
      from: 'now-7d',
      pageSize: 100,
      sort: '-startTime'
    })) as Raw
    const problems = ((list['problems'] as Raw[] | undefined) ?? []).slice(0, MAX_DETAILS)

    /** Lo que NO puede aparecer en el informe: descripciones, ids y nombres vistos. */
    const forbidden = new Set<string>()
    const remember = (value: unknown): void => {
      if (typeof value === 'string' && value.trim() !== '') forbidden.add(value.trim())
    }
    const descriptions: string[] = []

    let events = 0
    let withDescription = 0
    let valueIsString = 0
    let afterShown = 0
    let repeated = 0
    let emptyOrBlank = 0
    const lengths: number[] = []
    const buckets: Record<string, number> = {}
    const features: Record<string, number> = Object.fromEntries(
      Object.keys(MARKDOWN_FEATURES).map((name) => [name, 0])
    )
    let withAnyMarkdown = 0
    let withHtml = 0
    const schemes: Record<string, number> = {}

    for (const problem of problems) {
      const id = String(problem['problemId'])
      remember(id)
      remember(problem['displayId'])
      remember(problem['title'])
      const detail = (await get(`/problems/${encodeURIComponent(id)}`, {
        fields: 'evidenceDetails'
      })) as Raw
      const details =
        ((detail['evidenceDetails'] as Raw | undefined)?.['details'] as Raw[] | undefined) ?? []
      for (const evidence of details) {
        remember(evidence['displayName'])
        const entity = evidence['entity'] as Raw | undefined
        remember(entity?.['name'])
        remember((entity?.['entityId'] as Raw | undefined)?.['id'])
        if (evidence['evidenceType'] !== 'EVENT') continue
        events += 1
        const data = (evidence['data'] as Raw | undefined) ?? {}
        remember(data['eventId'])
        remember(data['title'])
        const properties = Array.isArray(data['properties'])
          ? (data['properties'] as { key?: unknown; value?: unknown }[])
          : []
        const indexes = properties
          .map((property, index) => (property?.key === DESCRIPTION_KEY ? index : -1))
          .filter((index) => index >= 0)
        if (indexes.length === 0) continue
        withDescription += 1
        if (indexes.length > 1) repeated += 1
        const first = indexes[0] as number
        if (first >= SHOWN_PROPERTIES) afterShown += 1
        const value = properties[first]?.value
        if (typeof value !== 'string') continue
        valueIsString += 1
        remember(value)
        if (value.trim() === '') {
          emptyOrBlank += 1
          continue
        }
        descriptions.push(value)
        lengths.push(value.length)
        const range = lengthBucket(value.length)
        buckets[range] = (buckets[range] ?? 0) + 1
        let markdown = false
        for (const [name, pattern] of Object.entries(MARKDOWN_FEATURES)) {
          if (pattern.test(value)) {
            features[name] = (features[name] ?? 0) + 1
            markdown = true
          }
        }
        if (markdown) withAnyMarkdown += 1
        if (RAW_HTML.test(value)) withHtml += 1
        for (const scheme of new Set(linkSchemes(value))) {
          schemes[scheme] = (schemes[scheme] ?? 0) + 1
        }
      }
    }

    const sortedLengths = [...lengths].sort((a, b) => a - b)
    report['detalles mirados'] = problems.length
    report['evidencias EVENT'] = bucket(events)
    report[`EVENT con ${DESCRIPTION_KEY}`] = share(withDescription, events)
    report['el value es texto'] = share(valueIsString, withDescription)
    report['el value es siempre texto'] = withDescription > 0 && valueIsString === withDescription
    report['texto vacío o solo espacios'] = share(emptyOrBlank, valueIsString)
    report['la clave se repite en el mismo evento'] = share(repeated, withDescription)
    report[`después de la propiedad ${SHOWN_PROPERTIES}`] = share(afterShown, withDescription)
    report['longitud'] = {
      mínima: sortedLengths[0] ?? null,
      mediana: sortedLengths[Math.floor(sortedLengths.length / 2)] ?? null,
      máxima: sortedLengths.at(-1) ?? null
    }
    report['tramos de longitud'] = Object.fromEntries(
      [...LENGTH_BUCKETS.map(([name]) => name), 'más de 20 000'].map((name) => [
        name,
        share(buckets[name] ?? 0, lengths.length)
      ])
    )
    report['con algún rasgo de Markdown'] = share(withAnyMarkdown, lengths.length)
    report['rasgos de Markdown'] = Object.fromEntries(
      Object.entries(features).map(([name, count]) => [name, share(count, lengths.length)])
    )
    report['con HTML en crudo'] = share(withHtml, lengths.length)
    report['esquemas de los enlaces (descripciones que los usan)'] = Object.fromEntries(
      Object.entries(schemes)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([scheme, count]) => [scheme, bucket(count)])
    )
    report['alguna descripción en el log del cliente'] = descriptions.some((text) =>
      live?.logged.some((line) => line.includes(text.trim()))
    )

    // CA1: ningún valor del informe contiene una descripción, un id o un nombre observados.
    const values = leaves(report)
    const leaked = [...forbidden].filter((text) => values.some((value) => value.includes(text)))
    // Solo se cuentan: el mensaje del fallo no puede llevar el texto.
    expect(leaked.length, 'valores del tenant en el informe').toBe(0)
  })
})
