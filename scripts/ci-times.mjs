// Tiempos del CI para la tabla «Ejecuciones» de una ficha medida (ficha 0074).
//
// Uso: node scripts/ci-times.mjs <run>
//
// <run> es el id del run de GitHub Actions o su URL
// (https://github.com/<owner>/<repo>/actions/runs/<id>). El repositorio sale de
// `git remote get-url origin`. Lee los jobs del run con
// GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs (REST API de GitHub, «workflow jobs») y
// saca filas Markdown: una por job y, debajo, una por paso, con inicio y fin en hora local, la
// duración y el resultado; al final, la línea de total del run. Nunca descarga logs.
//
// Sin token basta la lectura anónima (el repositorio es público). Si existe GITHUB_TOKEN, va en
// la cabecera Authorization y nunca se escribe: todo texto de salida pasa antes por `redact`.
//
// Salida: 0 bien, 2 error de uso, 1 cualquier otro fallo (404, límite, red…). Los jobs saltados
// no cuentan para el total. El repositorio es siempre el de origin, aunque la URL diga otro.
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const USAGE = 'Uso: node scripts/ci-times.mjs <run> (id del run o su URL de GitHub)'
const API = 'https://api.github.com'
const TIMEOUT_MS = 15_000
// La API devuelve 30 jobs por página por defecto y 100 como mucho: una sola petición basta.
const PER_PAGE = 100
const WHO = 'CI'
const TESTS = 'no se cuentan'
const NONE = '—'

const CONCLUSIONS = {
  success: 'ok',
  failure: 'falla',
  cancelled: 'cancelado',
  skipped: 'saltado',
  timed_out: 'tiempo agotado',
  neutral: 'neutral',
  action_required: 'requiere acción',
  stale: 'caducado'
}
const RUNNING = new Set(['in_progress'])

function pad(value) {
  return String(value).padStart(2, '0')
}

/** `AAAA-MM-DD HH:MM:SS` en hora local, o `—` si no hay fecha. */
export function formatLocal(iso) {
  if (!iso) return NONE
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return NONE
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  )
}

/** `13 min 45 s` o `45 s`, a partir de milisegundos. */
export function formatDuration(ms) {
  const total = Math.max(0, Math.round(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return minutes > 0 ? `${minutes} min ${seconds} s` : `${seconds} s`
}

function isSkipped(item) {
  return item.conclusion === 'skipped'
}

function isFinished(item) {
  return item.status === 'completed' && Boolean(item.completed_at) && !isSkipped(item)
}

function result(item) {
  if (item.status !== 'completed') return RUNNING.has(item.status) ? 'en curso' : 'en cola'
  if (!item.conclusion) return NONE
  return CONCLUSIONS[item.conclusion] ?? item.conclusion
}

function cell(value) {
  return String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
}

function row(values) {
  return `| ${values.map(cell).join(' | ')} |`
}

function itemRow(command, item) {
  const skipped = isSkipped(item)
  const finished = isFinished(item)
  const start = skipped ? NONE : formatLocal(item.started_at)
  const end = finished ? formatLocal(item.completed_at) : NONE
  const duration =
    finished && item.started_at
      ? formatDuration(Date.parse(item.completed_at) - Date.parse(item.started_at))
      : NONE
  return row([WHO, command, start, end, duration, result(item), TESTS])
}

function totalRow(jobs) {
  const counted = jobs.filter((job) => !isSkipped(job) && job.started_at)
  const starts = counted.map((job) => Date.parse(job.started_at)).filter(Number.isFinite)
  const running = counted.some((job) => job.status !== 'completed')
  const ends = counted.map((job) => Date.parse(job.completed_at ?? '')).filter(Number.isFinite)
  const first = starts.length > 0 ? Math.min(...starts) : undefined
  const last = !running && ends.length > 0 ? Math.max(...ends) : undefined
  let outcome = 'ok'
  if (running) outcome = 'en curso'
  else if (counted.length === 0) outcome = NONE
  else {
    const bad = counted.find((job) => job.conclusion !== 'success')
    if (bad) outcome = result(bad)
  }
  return row([
    WHO,
    '**total del run**',
    first === undefined ? NONE : formatLocal(new Date(first).toISOString()),
    last === undefined ? NONE : formatLocal(new Date(last).toISOString()),
    first === undefined || last === undefined ? NONE : formatDuration(last - first),
    outcome,
    TESTS
  ])
}

/**
 * Filas Markdown de la tabla «Ejecuciones» (docs/flujo.md, «Medición del flujo») a partir de la
 * respuesta de la API de jobs: una por job, debajo una por paso, y la línea de total. Pura.
 */
export function buildRows(data) {
  const jobs = Array.isArray(data?.jobs) ? data.jobs : []
  const lines = []
  for (const job of jobs) {
    lines.push(itemRow(`job \`${job.name}\``, job))
    const steps = Array.isArray(job.steps) ? [...job.steps] : []
    steps.sort((a, b) => (a.number ?? 0) - (b.number ?? 0))
    for (const step of steps) lines.push(itemRow(`↳ ${step.name}`, step))
  }
  lines.push(totalRow(jobs))
  return lines.join('\n')
}

/** Id del run a partir de su número o de su URL de GitHub; si no, lanza un error de uso. */
export function parseRunArg(arg) {
  const value = String(arg ?? '').trim()
  if (/^\d+$/.test(value)) return value
  const match =
    /^https:\/\/github\.com\/[^/?#\s]+\/[^/?#\s]+\/actions\/runs\/(\d+)(?:[/?#]\S*)?$/.exec(value)
  if (match) return match[1]
  throw new Error(`<run> no válido: ${value || '(vacío)'}`)
}

/** `owner/repo` a partir de la URL del remoto (https o ssh de github.com). */
export function parseRemote(url) {
  const value = String(url ?? '').trim()
  const match =
    /^(?:https:\/\/(?:[^@/]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(
      value
    )
  if (!match) throw new Error('el remoto origin no es un repositorio de github.com')
  return `${match[1]}/${match[2]}`
}

function redactor(token) {
  return (text) => {
    const value = String(text)
    return token ? value.split(token).join('[token oculto]') : value
  }
}

async function errorMessage(response) {
  try {
    const body = await response.json()
    return typeof body?.message === 'string' ? body.message : ''
  } catch {
    return ''
  }
}

function isRateLimit(status, headers, message) {
  if (status === 429) return true
  if (status !== 403) return false
  return headers.get('x-ratelimit-remaining') === '0' || /rate limit/i.test(message)
}

function describeError(status, headers, message, runId, repo, withToken) {
  const detail = message ? `: ${message}` : ''
  if (status === 404) return `El run ${runId} no existe en ${repo} (404)${detail}`
  if (isRateLimit(status, headers, message)) {
    const reset = Number(headers.get('x-ratelimit-reset'))
    const when =
      Number.isFinite(reset) && reset > 0
        ? `; se renueva a las ${formatLocal(new Date(reset * 1000).toISOString())}`
        : ''
    const hint = withToken ? '' : ' Sin GITHUB_TOKEN, el límite anónimo es de 60 por hora.'
    return `Límite de peticiones de GitHub alcanzado (${status})${detail}${when}.${hint}`
  }
  if (status === 401) return `GitHub rechaza el token de GITHUB_TOKEN (401)${detail}`
  if (status === 403) return `GitHub deniega el acceso (403)${detail}`
  return `GitHub respondió con un error (${status})${detail}`
}

/**
 * Punto de entrada. `deps = { env, fetchImpl, remoteUrl(), stdout(texto), stderr(texto) }`.
 * Devuelve el código de salida: 0 bien, 2 error de uso, 1 cualquier otro fallo.
 */
export async function main(argv, deps) {
  const token = String(deps.env?.GITHUB_TOKEN ?? '').trim()
  const redact = redactor(token)
  const out = (text) => deps.stdout(redact(text))
  const err = (text) => deps.stderr(redact(text))

  let runId
  try {
    runId = parseRunArg(argv[0])
  } catch (error) {
    err(`${error.message}\n${USAGE}`)
    return 2
  }

  let repo
  try {
    repo = parseRemote(deps.remoteUrl())
  } catch (error) {
    err(`No se puede saber el repositorio: ${error instanceof Error ? error.message : error}`)
    return 1
  }

  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'vigia-ci-times'
  }
  if (token) headers.Authorization = `Bearer ${token}`
  const url = `${API}/repos/${repo}/actions/runs/${runId}/jobs?per_page=${PER_PAGE}`

  let response
  try {
    response = await deps.fetchImpl(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    err(`Sin conexión con GitHub (fallo de red): ${reason}`)
    return 1
  }

  if (!response.ok) {
    const message = await errorMessage(response)
    err(describeError(response.status, response.headers, message, runId, repo, Boolean(token)))
    return 1
  }

  let data
  try {
    data = await response.json()
  } catch {
    err('GitHub devolvió una respuesta que no es JSON')
    return 1
  }
  if (!Array.isArray(data?.jobs)) {
    err('La respuesta de GitHub no trae la lista de jobs')
    return 1
  }

  out(buildRows(data))
  if (Number(data.total_count) > data.jobs.length) {
    err(
      `Aviso: el run tiene ${data.total_count} jobs y solo salen los ${data.jobs.length} primeros`
    )
  }
  return 0
}

function gitRemote() {
  return execFileSync('git', ['remote', 'get-url', 'origin'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    windowsHide: true,
    shell: false
  }).trim()
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2), {
    env: process.env,
    fetchImpl: (url, init) => fetch(url, init),
    remoteUrl: gitRemote,
    stdout: (message) => process.stdout.write(`${message}\n`),
    stderr: (message) => process.stderr.write(`${message}\n`)
  })
}
