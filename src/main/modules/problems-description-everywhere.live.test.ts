import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createLiveClient } from '../../test/live-client'
import { loadLiveEnv, loadLiveProblemId } from '../../test/live-env'

/**
 * Ficha 0035, punto 1 (CA1): MEDIR otra vez las descripciones en vivo, SOLO LECTURA: GET /problems
 * de los últimos 30 días y como mucho 50 GET /problems/{id}?fields=evidenceDetails, más el
 * problema de `VIGIA_LIVE_PROBLEM_ID` si `.env.live.local` lo trae.
 *
 * El informe (live-reports/problems-description-everywhere.json, ignorado) guarda SOLO
 * comportamientos: en qué tipos de evidencia y en qué campo llega `dt.event.description` (u otra
 * clave con «description» dentro de la evidencia), longitudes y tramos, y rasgos de Markdown
 * (títulos, listas, marcas, código, lenguajes de los bloques, tablas, citas, avisos de GitHub,
 * nombres de etiquetas HTML y `==resaltado==`). Nunca un texto, un id ni un nombre: el test lo
 * comprueba antes de escribirlo, y un fallo de petición se cuenta sin su mensaje (podría llevar
 * la ruta, con el id).
 */

const env = loadLiveEnv()
const live = env === null ? null : createLiveClient(env)
const targetId = env === null ? null : loadLiveProblemId()
const report: Record<string, unknown> = {}
const timings: number[] = []
/** Detalles de problema que se piden como mucho (sin contar el problema indicado). */
const MAX_DETAILS = 50

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

const bucket = (count: number): string =>
  count === 0 ? '0' : count < 10 ? '1-9' : count <= 50 ? '10-50' : 'más de 50'

const share = (part: number, whole: number): string =>
  whole === 0 ? 'sin datos' : `${Math.round((part / whole) * 20) * 5} %`

const LENGTH_BUCKETS: [string, number][] = [
  ['≤ 300', 300],
  ['≤ 1 000', 1000],
  ['≤ 5 000', 5000],
  ['≤ 10 000', 10_000],
  ['≤ 15 000', 15_000],
  ['≤ 20 000', 20_000]
]
const OVER = 'más de 20 000'
const lengthBucket = (length: number): string =>
  LENGTH_BUCKETS.find(([, limit]) => length <= limit)?.[0] ?? OVER

/** Celda de la fila de alineación de una tabla GFM. */
const DELIMITER_CELL = String.raw`[ \t]*:?-+:?[ \t]*`
const TABLE = new RegExp(
  String.raw`^[^\n]*\|[^\n]*\r?\n[ \t]*(?=[^\n]*\|)\|?${DELIMITER_CELL}(?:\|${DELIMITER_CELL})*\|?[ \t]*\r?$`,
  'm'
)
const FENCE = /^[ \t]{0,3}(`{3,}|~{3,})[ \t]*([^\s`]*)/gm

/** Rasgos que se cuentan (solo si aparecen, nunca qué dicen). */
const FEATURES: Record<string, RegExp> = {
  títulos: /^\s{0,3}#{1,6}\s/m,
  listas: /^\s*(?:[-*+]|\d+[.)])\s+\S/m,
  'listas de tareas': /^\s*[-*+]\s+\[[ xX]\]\s/m,
  'marcas ✓ ✔ ✅': /[✓✔✅]/u,
  'marcas ✗ ✘ ❌': /[✗✘❌]/u,
  'marcas ⚠': /⚠/u,
  'otros emojis': /\p{Extended_Pictographic}/u,
  negrita: /(\*\*|__)(?=\S)[\s\S]*?\S\1/,
  'código en línea': /(?<!`)`[^`\n]+`(?!`)/,
  'bloques de código': /^[ \t]{0,3}(?:```|~~~)/m,
  'código sangrado': /(?:^|\n\n)(?: {4}|\t)\S/,
  tablas: TABLE,
  citas: /^\s{0,3}>\s?/m,
  'avisos de GitHub': /^\s{0,3}>\s*\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/im,
  '==resaltado==': /==(?=\S)[^=\n]+?(?<=\S)==/,
  enlaces: /(?<!!)\[[^\]\n]*\]\([^)\s]+[^)]*\)|\bhttps?:\/\/\S/i,
  imágenes: /!\[[^\]\n]*\]\([^)]+\)/,
  'líneas horizontales': /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/m,
  'HTML en crudo': /<[a-zA-Z][\w-]*(?=[\s>/])/,
  'HTML con style': /<[a-zA-Z][\w-]*[^>]*\sstyle\s*=/i,
  'HTML con color': /\scolor\s*=|color\s*:/i
}

/** Lenguajes de bloque que se nombran; cualquier otro cuenta como «otro». */
const KNOWN_LANGUAGES = new Set(
  'yaml yml json jsonc bash sh shell zsh powershell ps1 cmd bat sql dql promql xml html css js javascript ts typescript python py java go text txt plaintext log diff ini toml properties dockerfile markdown md'.split(
    ' '
  )
)
/** Etiquetas HTML que se nombran; cualquier otra cuenta como «otra». */
const KNOWN_TAGS = new Set(
  'a abbr b blockquote br code del details div em font h1 h2 h3 h4 h5 h6 hr i img ins kbd li mark ol p pre s small span strong sub summary sup table tbody td th thead tr u ul'.split(
    ' '
  )
)
/** Rasgos que cuentan como «tiene Markdown» al mirar cada sitio. */
const MARKDOWN_HINTS = [
  'títulos',
  'listas',
  'negrita',
  'código en línea',
  'bloques de código',
  'tablas',
  'citas',
  'enlaces'
]
const GITHUB_ALERTS = ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION']

/** Todos los valores hoja del informe, como texto (las claves son fijas de este fichero). */
function leaves(value: unknown): string[] {
  if (value === null || value === undefined) return []
  if (Array.isArray(value)) return value.flatMap(leaves)
  if (typeof value === 'object') return Object.values(value as Raw).flatMap(leaves)
  return [String(value)]
}

/** Claves estructurales que se nombran en una ruta (las de la OpenAPI); el resto, «otra». */
const STRUCTURAL = /^[a-zA-Z]{1,40}$/

/** Un sitio donde llega una descripción dentro de la evidencia, y su texto. */
interface Found {
  where: string
  text: string
}

/**
 * Recorre la evidencia y devuelve las descripciones: propiedades `{ key, value }` cuya clave es
 * `dt.event.description` (o lleva «description») y campos de objeto llamados `description`.
 */
function descriptionsIn(evidence: unknown): Found[] {
  const found: Found[] = []
  const walk = (value: unknown, path: string): void => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item, `${path}[]`)
      return
    }
    if (value === null || typeof value !== 'object') return
    const object = value as Raw
    if (typeof object['key'] === 'string' && 'value' in object) {
      const key = object['key']
      const text = object['value']
      if (typeof text === 'string' && /description/i.test(key)) {
        // Las claves `dt.*` son de Dynatrace y se nombran (y `description` a secas); las demás
        // pueden ser del tenant y solo se cuentan.
        const name =
          /^dt\.[a-z0-9_.]{1,60}$/.test(key) || /^description$/i.test(key)
            ? key
            : 'otra clave con description'
        found.push({ where: `${path}{key: ${name}}`, text })
      }
    }
    for (const [key, child] of Object.entries(object)) {
      const segment = STRUCTURAL.test(key) ? key : 'otra'
      const next = path === '' ? segment : `${path}.${segment}`
      if (/description/i.test(key) && typeof child === 'string') {
        found.push({ where: next, text: child })
      } else {
        walk(child, next)
      }
    }
  }
  walk(evidence, '')
  return found
}

/** Acumulador de las mediciones de un conjunto de descripciones. */
function newStats(): {
  lengths: number[]
  features: Record<string, number>
  languages: Record<string, number>
  tags: Record<string, number>
  alerts: Record<string, number>
} {
  return {
    lengths: [],
    features: Object.fromEntries(Object.keys(FEATURES).map((name) => [name, 0])),
    languages: {},
    tags: {},
    alerts: {}
  }
}
type Stats = ReturnType<typeof newStats>

function measure(stats: Stats, text: string): void {
  stats.lengths.push(text.length)
  for (const [name, pattern] of Object.entries(FEATURES)) {
    if (pattern.test(text)) stats.features[name] = (stats.features[name] ?? 0) + 1
  }
  // Lenguajes: solo las aperturas (en una descripción, los bloques van por pares).
  const fences = [...text.matchAll(FENCE)]
  const languages = new Set<string>()
  for (let i = 0; i < fences.length; i += 2) {
    const raw = (fences[i]?.[2] ?? '').toLowerCase()
    languages.add(raw === '' ? 'sin lenguaje' : KNOWN_LANGUAGES.has(raw) ? raw : 'otro')
  }
  for (const language of languages) {
    stats.languages[language] = (stats.languages[language] ?? 0) + 1
  }
  const tags = new Set(
    [...text.matchAll(/<\/?([a-zA-Z][\w-]*)(?=[\s>/])/g)].map((match) => {
      const tag = (match[1] ?? '').toLowerCase()
      return KNOWN_TAGS.has(tag) ? tag : 'otra'
    })
  )
  for (const tag of tags) stats.tags[tag] = (stats.tags[tag] ?? 0) + 1
  for (const alert of GITHUB_ALERTS) {
    if (new RegExp(String.raw`^\s{0,3}>\s*\[!${alert}\]`, 'im').test(text)) {
      stats.alerts[alert] = (stats.alerts[alert] ?? 0) + 1
    }
  }
}

function summarize(stats: Stats): Record<string, unknown> {
  const sorted = [...stats.lengths].sort((a, b) => a - b)
  const total = sorted.length
  const counts: Record<string, number> = {}
  for (const length of sorted) {
    const range = lengthBucket(length)
    counts[range] = (counts[range] ?? 0) + 1
  }
  const ofTotal = (record: Record<string, number>): Record<string, string> =>
    Object.fromEntries(
      Object.entries(record)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, count]) => [name, share(count, total)])
    )
  return {
    descripciones: bucket(total),
    longitud: {
      mínima: sorted[0] ?? null,
      mediana: sorted[Math.floor(total / 2)] ?? null,
      máxima: sorted.at(-1) ?? null
    },
    'tramos de longitud': Object.fromEntries(
      [...LENGTH_BUCKETS.map(([name]) => name), OVER].map((name) => [
        name,
        share(counts[name] ?? 0, total)
      ])
    ),
    rasgos: ofTotal(stats.features),
    'lenguajes de los bloques de código': ofTotal(stats.languages),
    'etiquetas HTML': ofTotal(stats.tags),
    'avisos de GitHub por tipo': ofTotal(stats.alerts)
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
    join('live-reports', 'problems-description-everywhere.json'),
    `${JSON.stringify(report, null, 2)}\n`
  )
})

describe.skipIf(live === null)('CA1 (0035): medición en vivo de las descripciones', () => {
  it('informe de comportamientos, sin textos, ids ni nombres', async () => {
    /** Lo que NO puede aparecer en el informe: descripciones, ids y nombres vistos. */
    const forbidden = new Set<string>()
    const remember = (value: unknown): void => {
      if (typeof value === 'string' && value.trim() !== '') forbidden.add(value.trim())
    }
    remember(targetId)

    const list = (await get('/problems', {
      from: 'now-30d',
      pageSize: 100,
      sort: '-startTime'
    })) as Raw
    const listed = (list['problems'] as Raw[] | undefined) ?? []
    for (const problem of listed) {
      remember(problem['problemId'])
      remember(problem['displayId'])
      remember(problem['title'])
    }
    const ids = listed
      .slice(0, MAX_DETAILS)
      .map((problem) => String(problem['problemId']))
      .filter((id) => id !== targetId)

    const all = newStats()
    const target = newStats()
    const typesSeen: Record<string, number> = {}
    const typesWithDescription: Record<string, number> = {}
    const places: Record<string, number> = {}
    /** Por sitio, cuántas traen algún rasgo de Markdown. */
    const placesWithMarkdown: Record<string, number> = {}
    const placesByType: Record<string, Record<string, number>> = {}
    let failed = 0
    let targetStatus = targetId === null ? 'no indicado' : 'pendiente'
    let targetTypes: string[] = []

    const visit = async (id: string, isTarget: boolean): Promise<void> => {
      let detail: Raw
      try {
        detail = (await get(`/problems/${encodeURIComponent(id)}`, {
          fields: 'evidenceDetails'
        })) as Raw
      } catch {
        // Sin el mensaje: podría llevar la ruta (con el id).
        failed += 1
        if (isTarget) targetStatus = 'error al pedirlo'
        return
      }
      remember(detail['displayId'])
      remember(detail['title'])
      const details =
        ((detail['evidenceDetails'] as Raw | undefined)?.['details'] as Raw[] | undefined) ?? []
      const seenTypes = new Set<string>()
      for (const evidence of details) {
        remember(evidence['displayName'])
        const entity = evidence['entity'] as Raw | undefined
        remember(entity?.['name'])
        remember((entity?.['entityId'] as Raw | undefined)?.['id'])
        const data = evidence['data'] as Raw | undefined
        remember(data?.['eventId'])
        remember(data?.['title'])
        const rawType = evidence['evidenceType']
        const type =
          typeof rawType === 'string' && /^[A-Z_]{1,40}$/.test(rawType) ? rawType : 'otro'
        typesSeen[type] = (typesSeen[type] ?? 0) + 1
        const found = descriptionsIn(evidence).filter(({ text }) => text.trim() !== '')
        if (found.length === 0) continue
        typesWithDescription[type] = (typesWithDescription[type] ?? 0) + 1
        seenTypes.add(type)
        for (const { where, text } of found) {
          remember(text)
          places[where] = (places[where] ?? 0) + 1
          if (MARKDOWN_HINTS.some((name) => FEATURES[name]?.test(text) === true)) {
            placesWithMarkdown[where] = (placesWithMarkdown[where] ?? 0) + 1
          }
          const byType = (placesByType[type] ??= {})
          byType[where] = (byType[where] ?? 0) + 1
          measure(all, text)
          if (isTarget) measure(target, text)
        }
      }
      if (isTarget) {
        targetStatus = 'mirado'
        targetTypes = [...seenTypes].sort()
      }
    }

    for (const id of ids) await visit(id, false)
    if (targetId !== null) await visit(targetId, true)

    const bucketed = (record: Record<string, number>): Record<string, string> =>
      Object.fromEntries(
        Object.entries(record)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([name, count]) => [name, bucket(count)])
      )
    report['problemas en 30 días (primera página)'] = bucket(listed.length)
    report['detalles mirados'] = ids.length
    report['peticiones de detalle fallidas'] = failed
    report['evidencias por tipo'] = bucketed(typesSeen)
    report['evidencias con descripción por tipo'] = bucketed(typesWithDescription)
    report['dónde llega la descripción'] = bucketed(places)
    report['dónde llega, con algún rasgo de Markdown'] = bucketed(placesWithMarkdown)
    report['dónde llega, por tipo'] = Object.fromEntries(
      Object.entries(placesByType)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([type, record]) => [type, bucketed(record)])
    )
    report['todas las descripciones'] = summarize(all)
    report['problema indicado (VIGIA_LIVE_PROBLEM_ID)'] = {
      estado: targetStatus,
      'tipos con descripción': targetTypes,
      ...(targetStatus === 'mirado' ? summarize(target) : {})
    }
    report['alguna descripción en el log del cliente'] = [...forbidden].some(
      (text) => text.length > 40 && live?.logged.some((line) => line.includes(text))
    )

    // CA1: ningún valor del informe contiene una descripción, un id o un nombre observados.
    const values = leaves(report)
    const leaked = [...forbidden].filter((text) => values.some((value) => value.includes(text)))
    // Solo se cuentan: el mensaje del fallo no puede llevar el texto.
    expect(leaked.length, 'valores del tenant en el informe').toBe(0)
  })
})
