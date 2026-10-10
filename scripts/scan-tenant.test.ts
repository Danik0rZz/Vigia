import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

function git(...args: string[]): string {
  return execFileSync(
    'git',
    ['-c', 'user.name=Prueba', '-c', 'user.email=prueba@example.invalid', ...args],
    {
      cwd: repo,
      encoding: 'utf8'
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
  const env: NodeJS.ProcessEnv = { ...process.env }
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

  it.each([
    ['vacío', ''],
    [
      'solo con claves vacías y comentarios',
      '# comentario\nVIGIA_LIVE_URL=\nVIGIA_LIVE_TOKEN=""\nCORTO=abc\n'
    ]
  ])(
    'con el .env %s avisa por stderr de que la revisión NO está activa y termina en 0',
    (_case, content) => {
      writeFileSync(join(repo, '.env.live.local'), content)
      commit('a.txt', 'x\n', 'Algo')
      const result = spawnSync(process.execPath, [SCRIPT, 'HEAD~1..HEAD'], {
        cwd: repo,
        encoding: 'utf8'
      })
      expect(result.status).toBe(0)
      expect(result.stderr).toContain('AVISO')
      expect(result.stderr).toContain('NO está activa')
    }
  )

  it('con valores en el .env no avisa de que esté vacío', () => {
    writeFileSync(join(repo, '.env.live.local'), ENV)
    commit('limpio.ts', 'const x = 1\n', 'Limpio')
    const result = spawnSync(process.execPath, [SCRIPT, 'HEAD~1..HEAD'], {
      cwd: repo,
      encoding: 'utf8'
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
    { cwd, encoding: 'utf8' }
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
