import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * scan:tenant: busca restos del tenant real en un rango de git sin imprimir
 * nunca los valores del .env. Todo con un repositorio y un .env FALSOS en una
 * carpeta temporal; ningún dato real.
 */

const SCRIPT = join(__dirname, 'scan-tenant.mjs')
const { extractNeedles, scan, prePushRanges } = (await import(pathToFileURL(SCRIPT).href)) as {
  extractNeedles: (text: string) => { kind: string; value: string }[]
  // Ficha 0055: rangos a escanear a partir de la entrada estándar del pre-push.
  prePushRanges: (input: string) => string[]
  scan: (options: { cwd: string; range?: string; envPath?: string }) => {
    envFound: boolean
    kinds?: string[]
    hits?: string[]
  }
}

// Valores inventados con la forma de los reales.
const HOST = 'zz99fake.live.dynatrace.com'
const PUBLIC_ID = 'PUBLICOFALSO000000000000'
const SECRET = 'SECRETOFALSOABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.padEnd(64, 'Q')
const TOKEN = `dt0c01.${PUBLIC_ID}.${SECRET}`
const CLIENT_SECRET = 'otro-valor-largo-falso-123'
const ENV = [
  '# comentario',
  `DT_URL=https://${HOST}`,
  `DT_TOKEN="${TOKEN}"`,
  `DT_CLIENT_SECRET=${CLIENT_SECRET}`,
  'CORTO=abc',
  ''
].join('\n')

let repo: string

/**
 * Entorno sin las variables de git que fijan el repositorio (GIT_INDEX_FILE, GIT_DIR,
 * GIT_WORK_TREE…). En el pre-commit, git exporta GIT_INDEX_FILE y los `git` de estos tests
 * usarían el índice del repositorio real en vez del de su carpeta temporal (ficha 0091).
 */
function withoutGitVars(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const clean: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(env)) {
    if (!key.toUpperCase().startsWith('GIT_')) clean[key] = value
  }
  return clean
}

// `scan()` se llama en este proceso y sus `git` heredan process.env: se limpia también aquí.
for (const key of Object.keys(process.env)) {
  if (key.toUpperCase().startsWith('GIT_')) delete process.env[key]
}

function git(...args: string[]): string {
  return execFileSync(
    'git',
    ['-c', 'user.name=Prueba', '-c', 'user.email=prueba@example.invalid', ...args],
    {
      cwd: repo,
      encoding: 'utf8',
      env: withoutGitVars(process.env)
    }
  )
}

function commit(file: string, content: string, message: string): void {
  writeFileSync(join(repo, file), content)
  git('add', file)
  git('commit', '-q', '-m', message)
}

/** Entorno del proceso sin la variable que hace opcional el .env (ficha 0055). */
function cleanEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env = withoutGitVars(process.env)
  delete env.VIGIA_SCAN_TENANT_OPTIONAL
  return { ...env, ...extra }
}

type CliOptions = { cwd?: string; env?: Record<string, string>; input?: string }
type CliResult = { status: number | null; output: string; stdout: string; stderr: string }

/** Ejecuta el script como lo haría npm (o el pre-push) y devuelve código y salida completa. */
function cliWith(args: string[], options: CliOptions = {}): CliResult {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: options.cwd ?? repo,
    encoding: 'utf8',
    env: cleanEnv(options.env),
    input: options.input ?? ''
  })
  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
    stdout: result.stdout,
    stderr: result.stderr
  }
}

function cli(...args: string[]): { status: number | null; output: string } {
  return cliWith(args)
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'vigia-scan-'))
  git('init', '-q')
  commit('base.txt', 'nada\n', 'Base')
})

afterEach(() => {
  rmSync(repo, { recursive: true, force: true })
})

describe('extractNeedles', () => {
  it('saca host, id de entorno, id público, fragmento del secreto y valores largos; ignora comentarios y cortos', () => {
    const needles = extractNeedles(ENV)
    expect(needles).toEqual(
      expect.arrayContaining([
        { kind: 'host', value: HOST },
        { kind: 'id-de-entorno', value: 'zz99fake' },
        { kind: 'token-id-publico', value: PUBLIC_ID.toLowerCase() },
        { kind: 'token-secreto', value: SECRET.slice(8, 24).toLowerCase() },
        { kind: 'otro-valor', value: CLIENT_SECRET }
      ])
    )
    expect(needles.some((n) => n.value === 'abc')).toBe(false)
  })
})

describe('scan', () => {
  it('sin .env devuelve envFound false', () => {
    commit('a.txt', 'x\n', 'Algo')
    expect(scan({ cwd: repo, range: 'HEAD~1..HEAD' })).toEqual({ envFound: false })
  })

  it('encuentra cada tipo con fichero y línea, y en el mensaje de commit', () => {
    writeFileSync(join(repo, '.env.live.local'), ENV)
    commit(
      'fuga.ts',
      [
        'línea limpia',
        `const url = 'https://${HOST.toUpperCase()}/api'`,
        `const t = '${TOKEN}'`,
        `// ${CLIENT_SECRET}`
      ].join('\n') + '\n',
      `Prueba con ${PUBLIC_ID}`
    )

    const result = scan({ cwd: repo, range: 'HEAD~1..HEAD' })
    expect(result.envFound).toBe(true)
    expect(result.hits).toEqual(
      expect.arrayContaining([
        'host: fuga.ts:2',
        'id-de-entorno: fuga.ts:2',
        'token-id-publico: fuga.ts:3',
        'token-secreto: fuga.ts:3',
        'otro-valor: fuga.ts:4',
        expect.stringMatching(/^token-id-publico: mensaje de commit [0-9a-f]+$/)
      ])
    )
    expect(result.hits?.some((hit) => hit.includes('fuga.ts:1'))).toBe(false)
  })

  it('solo mira las líneas añadidas del rango, no las borradas ni las anteriores', () => {
    writeFileSync(join(repo, '.env.live.local'), ENV)
    commit('viejo.ts', `${HOST}\n`, 'Antes del rango')
    commit('viejo.ts', 'limpio\n', 'Se borra la línea')
    expect(scan({ cwd: repo, range: 'HEAD~1..HEAD' }).hits).toEqual([])
  })
})

describe('CLI', () => {
  it('con coincidencias termina en 1 y NUNCA imprime los valores del .env', () => {
    writeFileSync(join(repo, '.env.live.local'), ENV)
    commit('fuga.ts', `${HOST} ${TOKEN} ${CLIENT_SECRET}\n`, 'Fuga')

    const { status, output } = cli('HEAD~1..HEAD')
    expect(status).toBe(1)
    expect(output).toContain('fuga.ts:1')
    const lower = output.toLowerCase()
    for (const secret of [
      HOST,
      'zz99fake',
      PUBLIC_ID,
      SECRET.slice(0, 16),
      SECRET.slice(8, 24),
      CLIENT_SECRET
    ]) {
      expect(lower).not.toContain(secret.toLowerCase())
    }
  })

  it('sin coincidencias termina en 0', () => {
    writeFileSync(join(repo, '.env.live.local'), ENV)
    commit('limpio.ts', 'const x = 1\n', 'Limpio')
    const { status, output } = cli('HEAD~1..HEAD')
    expect(status).toBe(0)
    expect(output).toContain('coincidencias: 0')
  })

  // Ficha 0055, decisión del Orquestador (ronda 1): un .env vacío o sin valores reconocibles ya
  // no da 0 con AVISO, sino 2 («no puede comprobar»), salvo con VIGIA_SCAN_TENANT_OPTIONAL=1.
  const EMPTY_ENVS = [
    ['vacío', ''],
    [
      'solo con claves vacías y comentarios',
      '# comentario\nVIGIA_LIVE_URL=\nVIGIA_LIVE_TOKEN=""\nCORTO=abc\n'
    ]
  ]

  it.each(EMPTY_ENVS)(
    'con el .env %s termina en 2 y dice que no se puede comprobar (0055)',
    (_case, content) => {
      writeFileSync(join(repo, '.env.live.local'), content)
      commit('a.txt', 'x\n', 'Algo')
      const { status, stderr } = cliWith(['HEAD~1..HEAD'])
      expect(status).toBe(2)
      expect(stderr).toContain('.env.live.local')
      expect(stderr).toContain('no se puede comprobar')
    }
  )

  it.each(EMPTY_ENVS)(
    'con el .env %s y VIGIA_SCAN_TENANT_OPTIONAL=1 avisa de que la revisión NO está activa y termina en 0 (0055)',
    (_case, content) => {
      writeFileSync(join(repo, '.env.live.local'), content)
      commit('a.txt', 'x\n', 'Algo')
      const { status, stderr } = cliWith(['HEAD~1..HEAD'], {
        env: { VIGIA_SCAN_TENANT_OPTIONAL: '1' }
      })
      expect(status).toBe(0)
      expect(stderr).toContain('AVISO')
      expect(stderr).toContain('NO está activa')
    }
  )

  it.each(EMPTY_ENVS)(
    'con el .env %s en --pre-push también termina en 2 (0055)',
    (_case, content) => {
      writeFileSync(join(repo, '.env.live.local'), content)
      const remote = sha()
      commit('a.txt', 'x\n', 'Algo')
      const { status } = cliWith(['--pre-push'], {
        input: `refs/heads/main ${sha()} refs/heads/main ${remote}\n`
      })
      expect(status).toBe(2)
    }
  )

  it('con valores en el .env no avisa de que esté vacío', () => {
    writeFileSync(join(repo, '.env.live.local'), ENV)
    commit('limpio.ts', 'const x = 1\n', 'Limpio')
    const result = spawnSync(process.execPath, [SCRIPT, 'HEAD~1..HEAD'], {
      cwd: repo,
      encoding: 'utf8',
      env: withoutGitVars(process.env)
    })
    expect(result.stderr).not.toContain('NO está activa')
  })

  it('sin rango usa origin/main..HEAD', () => {
    writeFileSync(join(repo, '.env.live.local'), ENV)
    git('update-ref', 'refs/remotes/origin/main', 'HEAD')
    commit('fuga.ts', `${HOST}\n`, 'Después de origin/main')
    const { status, output } = cli()
    expect(status).toBe(1)
    expect(output).toContain('origin/main..HEAD')
    expect(output).toContain('host: fuga.ts:1')
  })

  it('con un rango que no existe termina en 2 sin imprimir valores', () => {
    writeFileSync(join(repo, '.env.live.local'), ENV)
    const { status, output } = cli('noexiste..HEAD')
    expect(status).toBe(2)
    expect(output.toLowerCase()).not.toContain(HOST)
  })
})

// --- Ficha 0055: scan:tenant falla cerrado y escanea lo que de verdad se sube ---
//
// Contrato que fijan estos tests (la ficha daba ejemplos; se toma la opción conservadora):
// - Sin .env.live.local (ni en el cwd ni en el checkout principal) el CLI sale con 2 y lo dice
//   nombrando el fichero; solo con VIGIA_SCAN_TENANT_OPTIONAL=1 (exactamente «1») sale con 0 y un
//   AVISO por stderr.
// - `prePushRanges(entrada)` convierte las líneas del pre-push
//   (`<ref local> <sha local> <ref remota> <sha remota>`) en rangos `remota..local`, o
//   `origin/main..local` si la remota va a ceros.
// - `node scripts/scan-tenant.mjs --pre-push` lee esas líneas de la entrada estándar y escanea esos
//   rangos (no origin/main..HEAD); el hook `.githooks/pre-push` lo llama así.

const ZEROS = '0'.repeat(40)
const ROOT = join(__dirname, '..')

/** Fragmentos del .env inventado que no pueden salir nunca por la terminal. */
const SECRETS = [
  HOST,
  'zz99fake',
  PUBLIC_ID,
  SECRET.slice(0, 16),
  SECRET.slice(8, 24),
  CLIENT_SECRET
]

function expectNoSecrets(output: string): void {
  const lower = output.toLowerCase()
  for (const secret of SECRETS) expect(lower).not.toContain(secret.toLowerCase())
}

function gitIn(cwd: string, ...args: string[]): string {
  return execFileSync(
    'git',
    ['-c', 'user.name=Prueba', '-c', 'user.email=prueba@example.invalid', ...args],
    { cwd, encoding: 'utf8', env: withoutGitVars(process.env) }
  )
}

function sha(ref = 'HEAD', cwd = repo): string {
  return gitIn(cwd, 'rev-parse', ref).trim()
}

const extraDirs: string[] = []
afterEach(() => {
  for (const dir of extraDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/**
 * Crea un worktree del repositorio temporal (que hace de checkout principal) en otra carpeta
 * temporal, con una rama propia, y devuelve su ruta.
 */
function addWorktree(): string {
  const parent = mkdtempSync(join(tmpdir(), 'vigia-scan-wt-'))
  extraDirs.push(parent)
  const worktree = join(parent, 'wt')
  gitIn(repo, 'worktree', 'add', '-q', '-b', 'otra', worktree)
  return worktree
}

function commitIn(cwd: string, file: string, content: string, message: string): void {
  writeFileSync(join(cwd, file), content)
  gitIn(cwd, 'add', file)
  gitIn(cwd, 'commit', '-q', '-m', message)
}

describe('CA1 (0055): sin .env.live.local falla cerrado', () => {
  it('CA1 (0055): sin fichero y sin VIGIA_SCAN_TENANT_OPTIONAL termina en 2 con un mensaje que nombra el fichero', () => {
    commit('a.txt', 'x\n', 'Algo')
    const { status, output } = cliWith(['HEAD~1..HEAD'])
    expect(status).toBe(2)
    expect(output).toContain('.env.live.local')
    expect(output).not.toContain('no hay nada que buscar')
  })

  it('CA1 (0055): sin fichero y con VIGIA_SCAN_TENANT_OPTIONAL=1 termina en 0 con un AVISO por stderr', () => {
    commit('a.txt', 'x\n', 'Algo')
    const { status, stderr } = cliWith(['HEAD~1..HEAD'], {
      env: { VIGIA_SCAN_TENANT_OPTIONAL: '1' }
    })
    expect(status).toBe(0)
    expect(stderr).toContain('AVISO')
    expect(stderr).toContain('.env.live.local')
  })

  it.each(['0', '', 'true'])(
    'CA1 (0055): con VIGIA_SCAN_TENANT_OPTIONAL=%j (distinto de 1) sigue fallando con 2',
    (value) => {
      commit('a.txt', 'x\n', 'Algo')
      const { status } = cliWith(['HEAD~1..HEAD'], { env: { VIGIA_SCAN_TENANT_OPTIONAL: value } })
      expect(status).toBe(2)
    }
  )

  it('CA1 (0055): en modo --pre-push, sin fichero y sin la variable, también termina en 2', () => {
    const remote = sha()
    commit('a.txt', 'x\n', 'Algo')
    const local = sha()
    const { status, output } = cliWith(['--pre-push'], {
      input: `refs/heads/main ${local} refs/heads/main ${remote}\n`
    })
    expect(status).toBe(2)
    expect(output).toContain('.env.live.local')
  })
})

describe('CA2 (0055): busca el .env en el checkout principal desde otro worktree', () => {
  it('CA2 (0055): con el fichero solo en el checkout principal, scan desde el worktree lo encuentra y escanea', () => {
    writeFileSync(join(repo, '.env.live.local'), ENV)
    const worktree = addWorktree()
    commitIn(worktree, 'fuga.ts', `${HOST}\n`, 'Fuga en el worktree')

    const result = scan({ cwd: worktree, range: 'HEAD~1..HEAD' })
    expect(result.envFound).toBe(true)
    expect(result.hits).toEqual(expect.arrayContaining(['host: fuga.ts:1']))
  })

  it('CA2 (0055): el CLI lanzado desde el worktree encuentra el fichero del principal y termina en 1', () => {
    writeFileSync(join(repo, '.env.live.local'), ENV)
    const worktree = addWorktree()
    commitIn(worktree, 'fuga.ts', `${HOST}\n`, 'Fuga en el worktree')

    const { status, output } = cliWith(['HEAD~1..HEAD'], { cwd: worktree })
    expect(status).toBe(1)
    expect(output).toContain('host: fuga.ts:1')
  })

  it('CA2 (0055): desde el worktree y sin fuga termina en 0 (ha escaneado, no ha fallado por falta de .env)', () => {
    writeFileSync(join(repo, '.env.live.local'), ENV)
    const worktree = addWorktree()
    commitIn(worktree, 'limpio.ts', 'const x = 1\n', 'Limpio')

    const { status, output } = cliWith(['HEAD~1..HEAD'], { cwd: worktree })
    expect(status).toBe(0)
    expect(output).toContain('coincidencias: 0')
  })

  it('CA2 (0055): si el worktree tiene su propio .env, usa ese antes que el del principal', () => {
    writeFileSync(join(repo, '.env.live.local'), 'DT_URL=https://qq11principal.example.invalid\n')
    const worktree = addWorktree()
    writeFileSync(join(worktree, '.env.live.local'), ENV)
    commitIn(worktree, 'fuga.ts', `${HOST}\n`, 'Fuga en el worktree')

    const { status, output } = cliWith(['HEAD~1..HEAD'], { cwd: worktree })
    expect(status).toBe(1)
    expect(output).toContain('host: fuga.ts:1')
  })
})

describe('CA3 (0055): el pre-push escanea los refs que le pasa git', () => {
  const LOCAL = 'a'.repeat(40)
  const REMOTE = 'b'.repeat(40)

  it('CA3 (0055): prePushRanges convierte una línea en remota..local', () => {
    expect(prePushRanges(`refs/heads/feat ${LOCAL} refs/heads/feat ${REMOTE}\n`)).toEqual([
      `${REMOTE}..${LOCAL}`
    ])
  })

  it('CA3 (0055): prePushRanges, con la remota a ceros (rama nueva), usa origin/main..local', () => {
    expect(prePushRanges(`refs/heads/nueva ${LOCAL} refs/heads/nueva ${ZEROS}\n`)).toEqual([
      `origin/main..${LOCAL}`
    ])
  })

  it('CA3 (0055): prePushRanges devuelve un rango por línea, en orden, y admite CRLF', () => {
    const input = [
      `refs/heads/main ${LOCAL} refs/heads/main ${REMOTE}`,
      `refs/heads/nueva ${REMOTE} refs/heads/nueva ${ZEROS}`,
      ''
    ].join('\r\n')
    expect(prePushRanges(input)).toEqual([`${REMOTE}..${LOCAL}`, `origin/main..${REMOTE}`])
  })

  it('CA3 (0055): --pre-push escanea remota..local de la entrada estándar y no lo anterior a la remota', () => {
    writeFileSync(join(repo, '.env.live.local'), ENV)
    commit('viejo.ts', `${HOST}\n`, 'Ya publicado')
    const remote = sha()
    commit('nuevo.ts', `${HOST}\n`, 'Lo que se sube')
    const local = sha()
    // HEAD en otro sitio: el rango tiene que salir de la entrada, no de HEAD.
    git('checkout', '-q', '--detach', 'HEAD~2')

    const { status, output } = cliWith(['--pre-push'], {
      input: `refs/heads/main ${local} refs/heads/main ${remote}\n`
    })
    expect(status).toBe(1)
    expect(output).toContain('host: nuevo.ts:1')
    expect(output).not.toContain('viejo.ts')
  })

  it('CA3 (0055): --pre-push con la remota a ceros escanea origin/main..local', () => {
    writeFileSync(join(repo, '.env.live.local'), ENV)
    commit('viejo.ts', `${HOST}\n`, 'Ya en origin/main')
    git('update-ref', 'refs/remotes/origin/main', 'HEAD')
    commit('nuevo.ts', `${HOST}\n`, 'Rama nueva')
    const local = sha()
    // Con origin/main..HEAD no habría nada: HEAD queda en origin/main.
    git('checkout', '-q', '--detach', 'origin/main')

    const { status, output } = cliWith(['--pre-push'], {
      input: `refs/heads/nueva ${local} refs/heads/nueva ${ZEROS}\n`
    })
    expect(status).toBe(1)
    expect(output).toContain('host: nuevo.ts:1')
    expect(output).not.toContain('viejo.ts')
  })

  it('CA3 (0055): --pre-push sin coincidencias en el rango termina en 0', () => {
    writeFileSync(join(repo, '.env.live.local'), ENV)
    const remote = sha()
    commit('limpio.ts', 'const x = 1\n', 'Limpio')
    const local = sha()
    const { status } = cliWith(['--pre-push'], {
      input: `refs/heads/main ${local} refs/heads/main ${remote}\n`
    })
    expect(status).toBe(0)
  })

  it('CA3 (0055): el hook pre-push llama a scan-tenant con --pre-push y no fija origin/main..HEAD', () => {
    const hook = readFileSync(join(ROOT, '.githooks', 'pre-push'), 'utf8')
    expect(hook).toMatch(/scan-tenant\.mjs["']?\s+--pre-push/)
    expect(hook).not.toContain('origin/main..HEAD')
  })
})

describe('CA5 (0055): ninguna salida contiene un valor del .env de prueba', () => {
  it('CA5 (0055): desde un worktree con el .env del principal y una fuga, no imprime valores', () => {
    writeFileSync(join(repo, '.env.live.local'), ENV)
    const worktree = addWorktree()
    commitIn(worktree, 'fuga.ts', `${HOST} ${TOKEN} ${CLIENT_SECRET}\n`, `Fuga ${PUBLIC_ID}`)
    const { status, output } = cliWith(['HEAD~1..HEAD'], { cwd: worktree })
    expect(status).toBe(1)
    expectNoSecrets(output)
  })

  it('CA5 (0055): en modo --pre-push con una fuga, no imprime valores', () => {
    writeFileSync(join(repo, '.env.live.local'), ENV)
    const remote = sha()
    commit('fuga.ts', `${HOST} ${TOKEN} ${CLIENT_SECRET}\n`, `Fuga ${PUBLIC_ID}`)
    const local = sha()
    const { status, output } = cliWith(['--pre-push'], {
      input: `refs/heads/main ${local} refs/heads/main ${remote}\n`
    })
    expect(status).toBe(1)
    expectNoSecrets(output)
  })

  it('CA5 (0055): con un rango que no existe (error 2), no imprime valores', () => {
    writeFileSync(join(repo, '.env.live.local'), ENV)
    const { status, output } = cliWith(['--pre-push'], {
      input: `refs/heads/main ${'c'.repeat(40)} refs/heads/main ${'d'.repeat(40)}\n`
    })
    expect(status).toBe(2)
    expectNoSecrets(output)
  })
})

// Decisiones del developer (ficha 0055, lo que los criterios no fijaban): una línea de borrado
// (sha local a ceros) no sube nada y no se escanea; una entrada vacía (git no sube ningún ref:
// todo al día o rechazado) da 0 para no tapar el aviso de git (ronda 1); una mal formada, 2.
describe('0055 (developer): borrados y entrada vacía en --pre-push', () => {
  const LOCAL = 'a'.repeat(40)

  it('prePushRanges omite las líneas de borrado de rama remota', () => {
    expect(
      prePushRanges(
        `(delete) ${ZEROS} refs/heads/vieja ${'b'.repeat(40)}\nrefs/heads/x ${LOCAL} refs/heads/x ${ZEROS}\n`
      )
    ).toEqual([`origin/main..${LOCAL}`])
  })

  it('prePushRanges lanza con una línea de formato inesperado', () => {
    expect(() => prePushRanges('refs/heads/x noesunsha refs/heads/x\n')).toThrow()
  })

  it('--pre-push con solo borrados termina en 0 y lo dice', () => {
    writeFileSync(join(repo, '.env.live.local'), ENV)
    const { status, output } = cliWith(['--pre-push'], {
      input: `(delete) ${ZEROS} refs/heads/vieja ${sha()}\n`
    })
    expect(status).toBe(0)
    expect(output).toContain('borran')
  })

  it('--pre-push con la entrada estándar vacía termina en 0 y dice que git no indica ningún ref', () => {
    writeFileSync(join(repo, '.env.live.local'), ENV)
    const { status, output } = cliWith(['--pre-push'], { input: '' })
    expect(status).toBe(0)
    expect(output).toContain('git no indica ningún ref que subir')
  })

  it('--pre-push con la entrada vacía y sin .env sigue terminando en 2 (el .env va antes)', () => {
    const { status, output } = cliWith(['--pre-push'], { input: '' })
    expect(status).toBe(2)
    expect(output).toContain('.env.live.local')
  })

  it('--pre-push con una línea mal formada termina en 2', () => {
    writeFileSync(join(repo, '.env.live.local'), ENV)
    const { status } = cliWith(['--pre-push'], { input: 'basura\n' })
    expect(status).toBe(2)
  })
})

// Ficha 0055, decisión del Orquestador (ronda 1): el .env del worktree tiene prioridad, así que uno
// vacío tapa al del checkout principal; eso no puede dar verde.
describe('0055 (ronda 1): un .env vacío en el worktree tapa al del principal y falla cerrado', () => {
  it.each([
    ['vacío', ''],
    ['solo con comentarios', '# comentario\n# otro\n']
  ])('con el .env del worktree %s y uno válido en el principal, termina en 2', (_case, content) => {
    writeFileSync(join(repo, '.env.live.local'), ENV)
    const worktree = addWorktree()
    writeFileSync(join(worktree, '.env.live.local'), content)
    commitIn(worktree, 'fuga.ts', `${HOST}\n`, 'Fuga en el worktree')

    const { status, output } = cliWith(['HEAD~1..HEAD'], { cwd: worktree })
    expect(status).toBe(2)
    expect(output).toContain('no se puede comprobar')
    expectNoSecrets(output)
  })

  it('con el .env del worktree vacío y VIGIA_SCAN_TENANT_OPTIONAL=1, termina en 0 con AVISO', () => {
    writeFileSync(join(repo, '.env.live.local'), ENV)
    const worktree = addWorktree()
    writeFileSync(join(worktree, '.env.live.local'), '')
    commitIn(worktree, 'limpio.ts', 'const x = 1\n', 'Limpio')

    const { status, stderr } = cliWith(['HEAD~1..HEAD'], {
      cwd: worktree,
      env: { VIGIA_SCAN_TENANT_OPTIONAL: '1' }
    })
    expect(status).toBe(0)
    expect(stderr).toContain('AVISO')
  })
})

// --- Ficha 0091: scan:tenant mira también los nombres de fichero, los renombrados y los binarios ---
//
// CA5 (0091): los tests de la 0055 de arriba (falla cerrado, nunca imprime valores) no cambian lo
// que esperan; tienen que seguir en verde.

/** Escribe (creando las carpetas) y hace commit de un fichero con contenido de texto o binario. */
function commitFile(file: string, content: string | Buffer, message: string): void {
  const path = join(repo, file)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
  git('add', file)
  git('commit', '-q', '-m', message)
}

/** Contenido binario para git (lleva bytes nulos) sin ningún valor del .env. */
const CLEAN_BINARY = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 0),
  Buffer.from('contenido inventado sin valores', 'latin1'),
  Buffer.alloc(64, 0)
])

/** Binario con el host del .env de prueba escrito en la codificación indicada. */
function binaryWith(encoding: 'latin1' | 'utf16le'): Buffer {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(32, 0),
    Buffer.from(`https://${HOST}/ui`, encoding),
    Buffer.alloc(32, 0)
  ])
}

const FILE_NAME_KIND = /nombre[- ]de[- ]fichero/i

describe('CA1 (0091): un fichero nuevo con un valor del .env en el nombre', () => {
  it('CA1 (0091): termina en 1, da un hallazgo de nombre de fichero y no imprime el valor', () => {
    writeFileSync(join(repo, '.env.live.local'), ENV)
    commitFile('datos/informe-zz99fake.json', '{}\n', 'Fichero nuevo')

    const { status, output } = cli('HEAD~1..HEAD')
    expect(status).toBe(1)
    expect(output).toMatch(FILE_NAME_KIND)
    // Nombra el fichero (por su carpeta) sin el valor del .env.
    expect(output).toContain('datos/')
    expectNoSecrets(output)
  })

  it('CA1 (0091): con un nombre sin valores del .env termina en 0', () => {
    writeFileSync(join(repo, '.env.live.local'), ENV)
    commitFile('datos/informe-limpio.json', '{}\n', 'Fichero nuevo')

    const { status, output } = cli('HEAD~1..HEAD')
    expect(status).toBe(0)
    expect(output).not.toMatch(FILE_NAME_KIND)
  })
})

describe('CA2 (0091): un renombrado hacia un nombre con un valor del .env', () => {
  it('CA2 (0091): termina en 1 aunque el contenido no cambie, sin imprimir el valor', () => {
    writeFileSync(join(repo, '.env.live.local'), ENV)
    commitFile('datos/informe.json', '{"a": 1}\n', 'Fichero limpio')
    git('mv', 'datos/informe.json', 'datos/informe-zz99fake.json')
    git('commit', '-q', '-m', 'Renombrado')

    const { status, output } = cli('HEAD~1..HEAD')
    expect(status).toBe(1)
    expect(output).toMatch(FILE_NAME_KIND)
    expectNoSecrets(output)
  })
})

describe('CA3 (0091): un binario añadido fuera de build/ no se puede comprobar', () => {
  it('CA3 (0091): un binario nuevo fuera de build/ termina en 2 y el mensaje nombra VIGIA_SCAN_ALLOW_BINARY', () => {
    writeFileSync(join(repo, '.env.live.local'), ENV)
    commitFile('docs/captura.png', CLEAN_BINARY, 'Captura')

    const { status, output } = cli('HEAD~1..HEAD')
    expect(status).toBe(2)
    expect(output).toContain('VIGIA_SCAN_ALLOW_BINARY')
    expectNoSecrets(output)
  })

  it('CA3 (0091): un binario nuevo dentro de build/ no hace fallar el escaneo', () => {
    writeFileSync(join(repo, '.env.live.local'), ENV)
    commitFile('build/icono.png', CLEAN_BINARY, 'Icono')

    const { status } = cli('HEAD~1..HEAD')
    expect(status).toBe(0)
  })
})

describe('CA4 (0091): con VIGIA_SCAN_ALLOW_BINARY=1 se busca en el contenido del binario', () => {
  const ALLOW = { env: { VIGIA_SCAN_ALLOW_BINARY: '1' } }

  it('CA4 (0091): un binario sin valores del .env pasa (0)', () => {
    writeFileSync(join(repo, '.env.live.local'), ENV)
    commitFile('docs/captura.png', CLEAN_BINARY, 'Captura limpia')

    const { status } = cliWith(['HEAD~1..HEAD'], ALLOW)
    expect(status).toBe(0)
  })

  it.each([['latin1' as const], ['utf16le' as const]])(
    'CA4 (0091): un binario con un valor del .env en %s termina en 1 sin imprimir el valor',
    (encoding) => {
      writeFileSync(join(repo, '.env.live.local'), ENV)
      commitFile('docs/captura.png', binaryWith(encoding), 'Captura con fuga')

      const { status, output } = cliWith(['HEAD~1..HEAD'], ALLOW)
      expect(status).toBe(1)
      expect(output).toContain('docs/captura.png')
      expectNoSecrets(output)
    }
  )
})

// --- Ficha 0091, ronda 1 de revisión: la ruta nunca sale con un valor ---

const { safePath } = (await import(pathToFileURL(SCRIPT).href)) as {
  safePath: (path: string, needles: { kind: string; value: string }[]) => string
}

describe('CA1 (0091): valor en el nombre y en el contenido', () => {
  it('CA1 (0091): con un valor en el nombre y otro en el contenido termina en 1 y no imprime ninguno', () => {
    writeFileSync(join(repo, '.env.live.local'), ENV)
    commitFile('datos/informe-zz99fake.json', `{"url": "https://${HOST}"}\n`, 'Fichero nuevo')

    const { status, output } = cli('HEAD~1..HEAD')
    expect(status).toBe(1)
    expect(output).toMatch(FILE_NAME_KIND)
    expectNoSecrets(output)
  })
})

describe('safePath (0091): un valor que cruza carpetas también se tapa', () => {
  it('safePath (0091): un valor con / repartido entre tramos no sale en la ruta', () => {
    const value = 'valor/con/barra-falso'
    const needles = extractNeedles(`DT_OTRO=${value}\n`)
    expect(needles).toEqual([{ kind: 'otro-valor', value }])

    const shown = safePath(`datos/${value}.json`, needles)
    expect(shown).not.toContain(value)
    expect(shown).not.toContain('barra-falso')
  })

  it('safePath (0091): una ruta sin valores sale igual', () => {
    expect(safePath('datos/informe.json', extractNeedles(ENV))).toBe('datos/informe.json')
  })
})

// --- Ficha 0091, ronda 2 de revisión: ni el stderr de git ni la extensión llevan un valor ---

describe('CA1 (0091): el stderr de git no saca la ruta con el valor', () => {
  it('CA1 (0091): con core.autocrlf=true y un rango contra el árbol de trabajo no imprime el valor', () => {
    writeFileSync(join(repo, '.env.live.local'), ENV)
    commitFile('datos/informe-zz99fake.txt', 'a\n', 'Fichero con LF')
    git('config', 'core.autocrlf', 'true')
    // Modificado sin commit y con LF: git avisa de que lo cambiará a CRLF, con la ruta entera.
    writeFileSync(join(repo, 'datos/informe-zz99fake.txt'), 'a\nb\n')

    const { status, stdout, stderr } = cliWith(['HEAD'])
    expect(status).toBe(1)
    expectNoSecrets(stdout)
    expectNoSecrets(stderr)
  })
})

describe('safePath (0091): la extensión no puede ser el final del valor', () => {
  const value = 'foo-falso.internal'
  const needles = extractNeedles(`DT_OTRO=${value}\n`)

  it('safePath (0091): un valor que acaba en .xxxx no deja su extensión a la vista', () => {
    expect(needles).toEqual([{ kind: 'otro-valor', value }])
    const shown = safePath(`datos/${value}`, needles)
    expect(shown).not.toContain('.internal')
    expect(shown).toContain('datos/')
  })

  it('safePath (0091): si el valor sigue en el nombre sin la extensión, la extensión se muestra', () => {
    const shown = safePath(`datos/informe-${value}.json`, needles)
    expect(shown).toContain('.json')
    expect(shown).not.toContain('.internal')
  })
})

describe('0091 (ronda 2): hallazgo y binario sin comprobar a la vez', () => {
  it('0091 (ronda 2): termina en 1 y avisa también de VIGIA_SCAN_ALLOW_BINARY, sin imprimir valores', () => {
    writeFileSync(join(repo, '.env.live.local'), ENV)
    commitFile('docs/captura.png', CLEAN_BINARY, 'Captura')
    commitFile('fuga.ts', `const url = 'https://${HOST}'\n`, 'Fuga')

    const { status, output } = cli('HEAD~2..HEAD')
    expect(status).toBe(1)
    expect(output).toContain('host: fuga.ts:1')
    expect(output).toContain('VIGIA_SCAN_ALLOW_BINARY')
    expectNoSecrets(output)
  })
})
