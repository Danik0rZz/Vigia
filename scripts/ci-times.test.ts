import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

/**
 * Tiempos del CI con `scripts/ci-times.mjs <run>` (ficha 0074).
 *
 * Todo simulado: `fetch`, el remoto de git y el entorno. Ningún test hace red. Los runs, jobs,
 * pasos y fechas son inventados, con la forma de la respuesta de
 * `GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs` (`total_count` y `jobs`, cada job con
 * `name`, `status`, `conclusion`, `started_at`, `completed_at` y `steps`, y cada paso con los
 * mismos campos y `number`).
 *
 * Contrato que fijan estos tests (la ficha no lo detallaba):
 * - `buildRows(respuesta)` es pura y devuelve el texto Markdown (string): una fila de tabla por
 *   job y, debajo, una por cada uno de sus pasos, con las 7 columnas de «Ejecuciones» de
 *   `docs/flujo.md` (quién, comando, inicio, fin, duración, resultado y tests), y una línea con
 *   «total».
 * - `parseRunArg(arg)` devuelve el id del run (string) a partir del número o de la URL del run, y
 *   lanza un error con otra cosa.
 * - `main(argv, deps)` (síncrona o asíncrona) devuelve el código de salida, con
 *   `deps = { env, fetchImpl, remoteUrl(), stdout(texto), stderr(texto) }`: `env` sustituye a
 *   `process.env`, `remoteUrl()` a `git remote get-url origin` y `argv[0]` es el `<run>`.
 */

const SCRIPT = join(__dirname, 'ci-times.mjs')

type Step = {
  name: string
  status: string
  conclusion: string | null
  number: number
  started_at: string | null
  completed_at: string | null
}
type Job = {
  id: number
  run_id: number
  name: string
  status: string
  conclusion: string | null
  started_at: string
  completed_at: string | null
  steps: Step[]
}
type JobsResponse = { total_count: number; jobs: Job[] }
type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>
type Deps = {
  env: Record<string, string | undefined>
  fetchImpl: FetchImpl
  remoteUrl: () => string
  stdout: (text: string) => void
  stderr: (text: string) => void
}
type Api = {
  buildRows: (data: JobsResponse) => string
  parseRunArg: (arg: string | undefined) => string
  main: (argv: string[], deps: Deps) => number | Promise<number>
}

const loaded = existsSync(SCRIPT) ? ((await import(pathToFileURL(SCRIPT).href)) as Api) : undefined
function api(): Api {
  if (!loaded) throw new Error('No existe scripts/ci-times.mjs')
  return loaded
}

const RUN_ID = '1234567890'
const RUN_URL = `https://github.com/ejemplo/vigia/actions/runs/${RUN_ID}`
const REMOTE = 'https://github.com/ejemplo/vigia.git'
// Token de mentira con la forma de uno real.
const TOKEN = 'ghp_TokenDeMentira0074abcdefXYZ123456789'

function step(
  number: number,
  name: string,
  started_at: string | null,
  completed_at: string | null,
  conclusion: string | null = 'success',
  status = 'completed'
): Step {
  return { name, status, conclusion, number, started_at, completed_at }
}

// Dos jobs terminados. En octubre, Europe/Madrid va a +02:00.
// check: 12:00:05 → 12:13:50 (13 min 45 s); e2e: 12:00:20 → 12:20:35 (20 min 15 s).
// Total del run: 12:00:05 → 12:20:35 (20 min 30 s).
const TWO_JOBS: JobsResponse = {
  total_count: 2,
  jobs: [
    {
      id: 111,
      run_id: Number(RUN_ID),
      name: 'check',
      status: 'completed',
      conclusion: 'success',
      started_at: '2026-10-08T10:00:05Z',
      completed_at: '2026-10-08T10:13:50Z',
      steps: [
        step(1, 'Set up job', '2026-10-08T10:00:05Z', '2026-10-08T10:01:10Z'),
        step(2, 'npm run check', '2026-10-08T10:01:10Z', '2026-10-08T10:13:50Z')
      ]
    },
    {
      id: 222,
      run_id: Number(RUN_ID),
      name: 'e2e',
      status: 'completed',
      conclusion: 'failure',
      started_at: '2026-10-08T10:00:20Z',
      completed_at: '2026-10-08T10:20:35Z',
      steps: [
        step(1, 'Set up job', '2026-10-08T10:00:20Z', '2026-10-08T10:02:00Z'),
        step(2, 'npm run test:e2e', '2026-10-08T10:02:00Z', '2026-10-08T10:20:35Z', 'failure')
      ]
    }
  ]
}

// Un job en curso (con un paso en curso y otro saltado) y un job saltado.
const UNFINISHED: JobsResponse = {
  total_count: 2,
  jobs: [
    {
      id: 333,
      run_id: Number(RUN_ID),
      name: 'e2e',
      status: 'in_progress',
      conclusion: null,
      started_at: '2026-10-08T10:00:20Z',
      completed_at: null,
      steps: [
        step(1, 'Set up job', '2026-10-08T10:00:20Z', '2026-10-08T10:02:00Z'),
        step(2, 'npm run test:e2e', '2026-10-08T10:02:00Z', null, null, 'in_progress'),
        step(3, 'Subir el informe', null, null, 'skipped')
      ]
    },
    {
      id: 444,
      run_id: Number(RUN_ID),
      name: 'publicar',
      status: 'completed',
      conclusion: 'skipped',
      started_at: '2026-10-08T10:00:21Z',
      completed_at: '2026-10-08T10:00:21Z',
      steps: []
    }
  ]
}

const DATE = /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/
const DURATION = /\d+ min \d+ s|\d+ s/

/** Celdas de una fila Markdown (sin los bordes). */
function cells(row: string): string[] {
  return row
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

/** Filas de jobs y pasos: las de la tabla con «no se cuentan», sin la línea de total. */
function dataRows(text: string): string[] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim().startsWith('|'))
    .filter((line) => line.includes('no se cuentan'))
    .filter((line) => !/total/i.test(line))
}

function totalLine(text: string): string | undefined {
  return text.split(/\r?\n/).find((line) => /total/i.test(line))
}

function okResponse(data: JobsResponse = TWO_JOBS): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })
}

function errorResponse(
  status: number,
  message: string,
  headers: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify({ message, documentation_url: 'https://docs.github.com' }), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  })
}

function deps(
  fetchImpl: FetchImpl,
  env: Deps['env'] = {}
): Deps & { out: string[]; err: string[]; fetchMock: ReturnType<typeof vi.fn> } {
  const out: string[] = []
  const err: string[] = []
  const fetchMock = vi.fn(fetchImpl)
  return {
    env,
    fetchImpl: fetchMock as unknown as FetchImpl,
    remoteUrl: () => REMOTE,
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
    out,
    err,
    fetchMock
  }
}

function authHeader(init: RequestInit | undefined): string | null {
  return new Headers(init?.headers).get('authorization')
}

describe('CA1 (0074): filas de cada job y de cada paso, en hora local, y el total', () => {
  it('saca una fila por job y, debajo, una por paso, con las 7 columnas de la tabla', () => {
    const rows = dataRows(api().buildRows(TWO_JOBS))
    expect(rows).toHaveLength(6)
    for (const row of rows) {
      expect(row.trim().endsWith('|')).toBe(true)
      expect(cells(row)).toHaveLength(7)
      expect(cells(row)[6]).toBe('no se cuentan')
    }
    const commands = rows.map((row) => cells(row)[1])
    expect(commands[0]).toContain('check')
    expect(commands[1]).toContain('Set up job')
    expect(commands[2]).toContain('npm run check')
    expect(commands[3]).toContain('e2e')
    expect(commands[4]).toContain('Set up job')
    expect(commands[5]).toContain('npm run test:e2e')
  })

  it('pone inicio, fin y duración en hora local (Europe/Madrid) con el formato de la tabla', () => {
    const rows = dataRows(api().buildRows(TWO_JOBS)).map(cells)
    expect(rows[0]!.slice(2, 5)).toEqual([
      '2026-10-08 12:00:05',
      '2026-10-08 12:13:50',
      '13 min 45 s'
    ])
    expect(rows[1]!.slice(2, 5)).toEqual([
      '2026-10-08 12:00:05',
      '2026-10-08 12:01:10',
      '1 min 5 s'
    ])
    expect(rows[2]!.slice(2, 5)).toEqual([
      '2026-10-08 12:01:10',
      '2026-10-08 12:13:50',
      '12 min 40 s'
    ])
    expect(rows[3]!.slice(2, 5)).toEqual([
      '2026-10-08 12:00:20',
      '2026-10-08 12:20:35',
      '20 min 15 s'
    ])
    expect(rows[4]!.slice(2, 5)).toEqual([
      '2026-10-08 12:00:20',
      '2026-10-08 12:02:00',
      '1 min 40 s'
    ])
    expect(rows[5]!.slice(2, 5)).toEqual([
      '2026-10-08 12:02:00',
      '2026-10-08 12:20:35',
      '18 min 35 s'
    ])
  })

  it('pone el resultado de cada job y paso', () => {
    const rows = dataRows(api().buildRows(TWO_JOBS)).map(cells)
    expect(rows[0]![5]).toMatch(/ok|success/i)
    expect(rows[2]![5]).toMatch(/ok|success/i)
    expect(rows[3]![5]).toMatch(/falla|failure/i)
    expect(rows[5]![5]).toMatch(/falla|failure/i)
  })

  it('añade la línea de total del run, del inicio del primer job al fin del último', () => {
    const total = totalLine(api().buildRows(TWO_JOBS))
    expect(total).toBeDefined()
    expect(total).toContain('2026-10-08 12:00:05')
    expect(total).toContain('2026-10-08 12:20:35')
    expect(total).toContain('20 min 30 s')
  })
})

describe('CA2 (0074): lo que está en curso o saltado sale como tal, sin duración inventada', () => {
  it('un job en curso no tiene fin ni duración y dice que está en curso', () => {
    const rows = dataRows(api().buildRows(UNFINISHED)).map(cells)
    const job = rows.find(
      (row) => (row[1] ?? '').includes('e2e') && !(row[1] ?? '').includes('npm')
    )
    expect(job).toBeDefined()
    expect(job![2]).toBe('2026-10-08 12:00:20')
    expect(job![3]).not.toMatch(DATE)
    expect(job![4]).not.toMatch(DURATION)
    expect(job![5]).toMatch(/en curso|in_progress/i)
  })

  it('un paso en curso no tiene fin ni duración; el terminado sí', () => {
    const rows = dataRows(api().buildRows(UNFINISHED)).map(cells)
    const running = rows.find((row) => (row[1] ?? '').includes('npm run test:e2e'))
    expect(running).toBeDefined()
    expect(running![2]).toBe('2026-10-08 12:02:00')
    expect(running![3]).not.toMatch(DATE)
    expect(running![4]).not.toMatch(DURATION)
    expect(running![5]).toMatch(/en curso|in_progress/i)
    const done = rows.find((row) => (row[1] ?? '').includes('Set up job'))
    expect(done![4]).toBe('1 min 40 s')
  })

  it('un paso saltado dice que está saltado, sin horas ni duración', () => {
    const rows = dataRows(api().buildRows(UNFINISHED)).map(cells)
    const skipped = rows.find((row) => (row[1] ?? '').includes('Subir el informe'))
    expect(skipped).toBeDefined()
    expect(skipped![2]).not.toMatch(DATE)
    expect(skipped![3]).not.toMatch(DATE)
    expect(skipped![4]).not.toMatch(DURATION)
    expect(skipped![5]).toMatch(/saltad|skipped/i)
  })

  it('un job saltado dice que está saltado y no lleva duración', () => {
    const rows = dataRows(api().buildRows(UNFINISHED)).map(cells)
    const skipped = rows.find((row) => (row[1] ?? '').includes('publicar'))
    expect(skipped).toBeDefined()
    expect(skipped![4]).not.toMatch(DURATION)
    expect(skipped![5]).toMatch(/saltad|skipped/i)
  })
})

describe('CA3 (0074): <run> como número o URL del run; otra cosa es un error de uso', () => {
  it('acepta el id del run', () => {
    expect(api().parseRunArg(RUN_ID)).toBe(RUN_ID)
  })

  it('acepta la URL del run', () => {
    expect(api().parseRunArg(RUN_URL)).toBe(RUN_ID)
  })

  it.each([
    ['vacío', ''],
    ['texto', 'abc'],
    ['número con letras', '12a'],
    ['URL de una PR', 'https://github.com/ejemplo/vigia/pull/5'],
    ['URL de otra web', `https://example.invalid/actions/runs/${RUN_ID}`]
  ])('rechaza %s', (_caso, arg) => {
    const { parseRunArg } = api()
    expect(() => parseRunArg(arg)).toThrow()
  })

  it('con un <run> no válido, main da un error de uso, sale con código distinto de 0 y no pide nada', async () => {
    const d = deps(async () => okResponse())
    const code = await api().main(['abc'], d)
    expect(code).not.toBe(0)
    expect(d.err.join('\n')).toMatch(/uso/i)
    expect(d.fetchMock).not.toHaveBeenCalled()
  })

  it('sin <run>, main da un error de uso y sale con código distinto de 0', async () => {
    const d = deps(async () => okResponse())
    const code = await api().main([], d)
    expect(code).not.toBe(0)
    expect(d.err.join('\n')).toMatch(/uso/i)
    expect(d.fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ['número', RUN_ID],
    ['URL', RUN_URL]
  ])(
    'con el %s del run, pide los jobs de ese run del repositorio de origin',
    async (_caso, arg) => {
      const d = deps(async () => okResponse())
      const code = await api().main([arg], d)
      expect(code).toBe(0)
      expect(d.fetchMock).toHaveBeenCalledTimes(1)
      const url = String(d.fetchMock.mock.calls[0]![0])
      expect(url).toMatch(
        new RegExp(
          `^https://api\\.github\\.com/repos/ejemplo/vigia/actions/runs/${RUN_ID}/jobs(\\?|$)`
        )
      )
      expect(dataRows(d.out.join('\n'))).toHaveLength(6)
    }
  )
})

describe('CA4 (0074): GITHUB_TOKEN va en la petición y nunca en la salida', () => {
  it('con GITHUB_TOKEN, la petición lo lleva en la cabecera Authorization', async () => {
    const d = deps(async () => okResponse(), { GITHUB_TOKEN: TOKEN })
    expect(await api().main([RUN_ID], d)).toBe(0)
    const init = d.fetchMock.mock.calls[0]![1] as RequestInit | undefined
    expect(authHeader(init)).toContain(TOKEN)
    expect([...d.out, ...d.err].join('\n')).not.toContain(TOKEN)
  })

  it('sin GITHUB_TOKEN, la petición va sin Authorization (lectura anónima)', async () => {
    const d = deps(async () => okResponse(), {})
    expect(await api().main([RUN_ID], d)).toBe(0)
    const init = d.fetchMock.mock.calls[0]![1] as RequestInit | undefined
    expect(authHeader(init)).toBeNull()
  })

  it.each([401, 403, 404, 429, 500])(
    'con una respuesta de error %i que repite el token, ningún mensaje lo contiene',
    async (status) => {
      const d = deps(async () => errorResponse(status, `Bad credentials: token ${TOKEN}`), {
        GITHUB_TOKEN: TOKEN
      })
      const code = await api().main([RUN_ID], d)
      expect(code).not.toBe(0)
      const all = [...d.out, ...d.err].join('\n')
      expect(all.length).toBeGreaterThan(0)
      expect(all).not.toContain(TOKEN)
    }
  )

  it('si la red falla con un error que lleva el token, el mensaje no lo contiene', async () => {
    const d = deps(
      async () => {
        throw new TypeError(`fetch failed (Authorization: Bearer ${TOKEN})`)
      },
      { GITHUB_TOKEN: TOKEN }
    )
    const code = await api().main([RUN_ID], d)
    expect(code).not.toBe(0)
    const all = [...d.out, ...d.err].join('\n')
    expect(all.length).toBeGreaterThan(0)
    expect(all).not.toContain(TOKEN)
  })
})

describe('CA5 (0074): 404, 403/429 y sin red dan un mensaje claro y código distinto de 0', () => {
  it('404: dice que el run no existe', async () => {
    const d = deps(async () => errorResponse(404, 'Not Found'))
    const code = await api().main([RUN_ID], d)
    expect(code).not.toBe(0)
    expect(d.err.join('\n')).toMatch(/no existe|no se encuentra|404/i)
    expect(dataRows(d.out.join('\n'))).toHaveLength(0)
  })

  it.each([
    [403, { 'x-ratelimit-limit': '60', 'x-ratelimit-remaining': '0' }],
    [429, {}]
  ])(
    '%i: dice que es el límite de peticiones, con el mensaje de GitHub',
    async (status, headers) => {
      const message = 'API rate limit exceeded for 203.0.113.7.'
      const d = deps(async () => errorResponse(status, message, headers))
      const code = await api().main([RUN_ID], d)
      expect(code).not.toBe(0)
      const err = d.err.join('\n')
      expect(err).toMatch(/límite/i)
      expect(err).toContain(message)
      expect(dataRows(d.out.join('\n'))).toHaveLength(0)
    }
  )

  it('sin red: dice que no hay conexión con GitHub', async () => {
    const d = deps(async () => {
      throw new TypeError('fetch failed')
    })
    const code = await api().main([RUN_ID], d)
    expect(code).not.toBe(0)
    expect(d.err.join('\n')).toMatch(/red|conexi/i)
    expect(dataRows(d.out.join('\n'))).toHaveLength(0)
  })
})
