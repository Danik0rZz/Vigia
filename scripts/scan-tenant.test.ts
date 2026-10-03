import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
const { extractNeedles, scan } = (await import(pathToFileURL(SCRIPT).href)) as {
  extractNeedles: (text: string) => { kind: string; value: string }[]
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

/** Ejecuta el script como lo haría npm y devuelve código y salida completa. */
function cli(...args: string[]): { status: number | null; output: string } {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: repo, encoding: 'utf8' })
  return { status: result.status, output: `${result.stdout}${result.stderr}` }
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
  it('sin .env termina en 0 con el aviso', () => {
    commit('a.txt', 'x\n', 'Algo')
    const { status, output } = cli('HEAD~1..HEAD')
    expect(status).toBe(0)
    expect(output).toContain('sin .env.live.local: no hay nada que buscar')
  })

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
