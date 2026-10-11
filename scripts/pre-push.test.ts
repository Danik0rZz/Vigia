import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * Hook `.githooks/pre-push` (ficha 0082, CA4): un push que borra una rama remota (git le pasa la
 * línea con el SHA local a ceros) se para con un mensaje claro, sea con `:rama`, `--delete` o `-d`;
 * un push normal y uno a `HEAD:integra/…` pasan, y el hook sigue llamando a scan:tenant (0055).
 *
 * Se prueba con git de verdad: un repositorio y un remoto desnudo en carpetas temporales, el hook y
 * `scan-tenant.mjs` copiados del repositorio, y un `.env.live.local` FALSO (ningún dato real).
 */

const ROOT = join(__dirname, '..')
const ENV =
  'DT_URL=https://zz99fake.live.dynatrace.com\nDT_CLIENT_SECRET=otro-valor-largo-falso-123\n'

let dir: string
let repo: string
let remote: string

/** Entorno sin variables de git heredadas (p. ej. de un hook que lance los tests) ni la opcional. */
function cleanEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith('GIT_') && key !== 'VIGIA_SCAN_TENANT_OPTIONAL') env[key] = value
  }
  return env
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    'git',
    ['-c', 'user.name=Prueba', '-c', 'user.email=prueba@example.invalid', ...args],
    { cwd, encoding: 'utf8', env: cleanEnv() }
  )
}

/** `git push` con el hook activo; devuelve el código y toda la salida (la del hook incluida). */
function push(...args: string[]): { status: number | null; output: string } {
  const result = spawnSync('git', ['push', ...args], {
    cwd: repo,
    encoding: 'utf8',
    env: cleanEnv()
  })
  return { status: result.status, output: `${result.stdout}${result.stderr}` }
}

function commit(file: string, content: string, message: string): void {
  writeFileSync(join(repo, file), content)
  git(repo, 'add', file)
  git(repo, 'commit', '-q', '-m', message)
}

const remoteHas = (branch: string): boolean => git(remote, 'branch', '--list', branch).trim() !== ''

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vigia-prepush-'))
  remote = join(dir, 'remoto.git')
  repo = join(dir, 'repo')
  git(dir, 'init', '-q', '--bare', remote)
  git(dir, 'init', '-q', '-b', 'main', repo)
  commit('base.txt', 'nada\n', 'Base')
  git(repo, 'remote', 'add', 'origin', remote)
  // Estado inicial del remoto, antes de activar el hook: main y una rama que borrar.
  git(repo, 'branch', 'rama')
  git(repo, 'push', '-q', 'origin', 'main', 'rama')

  // El hook y el escáner, como en el repositorio; el .env falso, sin seguir por git.
  mkdirSync(join(repo, '.githooks'))
  copyFileSync(join(ROOT, '.githooks', 'pre-push'), join(repo, '.githooks', 'pre-push'))
  mkdirSync(join(repo, 'scripts'))
  copyFileSync(join(ROOT, 'scripts', 'scan-tenant.mjs'), join(repo, 'scripts', 'scan-tenant.mjs'))
  mkdirSync(join(repo, 'scripts', 'lib'))
  copyFileSync(
    join(ROOT, 'scripts', 'lib', 'env-file.mjs'),
    join(repo, 'scripts', 'lib', 'env-file.mjs')
  )
  writeFileSync(join(repo, '.env.live.local'), ENV)
  writeFileSync(join(repo, '.git', 'info', 'exclude'), '.githooks/\nscripts/\n.env.live.local\n')
  git(repo, 'config', 'core.hooksPath', '.githooks')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('CA4 (0082): el pre-push para los borrados de ramas remotas y deja pasar el resto', () => {
  it.each([
    'origin :rama',
    'origin --delete rama',
    '--delete origin rama',
    'origin -d rama',
    '-d origin rama'
  ])('CA4 (0082): «git push %s» sale con error, lo explica y no borra la rama', (args) => {
    const { status, output } = push(...args.split(' '))
    expect(status).not.toBe(0)
    expect(output).toMatch(/pre-push/)
    expect(output).toMatch(/borr/i)
    expect(remoteHas('rama')).toBe(true)
  })

  it('CA4 (0082): un push normal a una integra/ pasa (y scan:tenant se ejecuta)', () => {
    commit('limpio.ts', 'const x = 1\n', 'Limpio')
    // Destino integra/ y no main desde la ficha 0088, que solo deja publicar en integra/.
    const { status, output } = push('origin', 'HEAD:integra/20261011-2')
    expect(output).toContain('scan:tenant')
    expect(status).toBe(0)
    expect(git(remote, 'rev-parse', 'integra/20261011-2').trim()).toBe(
      git(repo, 'rev-parse', 'HEAD').trim()
    )
  })

  it('CA4 (0082): un push a HEAD:integra/… (rama nueva) pasa', () => {
    git(repo, 'checkout', '-q', '-b', 'trabajo')
    commit('limpio.ts', 'const x = 1\n', 'Limpio')
    const { status } = push('origin', 'HEAD:integra/20261011-1')
    expect(status).toBe(0)
    expect(remoteHas('integra/20261011-1')).toBe(true)
  })

  it('CA4 (0082): con una fuga del tenant, el pre-push sigue parando el push (scan:tenant, 0055)', () => {
    commit('fuga.ts', 'zz99fake.live.dynatrace.com\n', 'Fuga')
    const { status, output } = push('origin', 'HEAD:integra/20261011-3')
    expect(status).not.toBe(0)
    expect(output).toContain('scan:tenant')
    expect(output.toLowerCase()).not.toContain('zz99fake')
  })
})
