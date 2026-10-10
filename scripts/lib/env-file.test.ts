import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

/**
 * Ficha 0055: función común para encontrar `.env.live.local`, que usan scan-tenant.mjs y
 * notify-telegram.mjs. Todo con repositorios y .env FALSOS en carpetas temporales.
 *
 * Contrato que fijan estos tests (la ficha daba el nombre como ejemplo):
 * - `findLiveEnv(cwd, { mainCheckout }?)` devuelve la ruta del `.env.live.local` del `cwd` si
 *   existe; si no, la del checkout principal (primera entrada de `git worktree list --porcelain`
 *   lanzado en `cwd`); si tampoco, `undefined`. No lanza.
 * - `mainCheckout` (opcional) sustituye a la consulta a git: devuelve la ruta del checkout
 *   principal o `undefined`. Es lo que inyectan los tests de notify-telegram.
 */

const MODULE = join(__dirname, 'env-file.mjs')
type Api = {
  findLiveEnv: (
    cwd: string,
    options?: { mainCheckout?: () => string | undefined }
  ) => string | undefined
}
const loaded = existsSync(MODULE) ? ((await import(pathToFileURL(MODULE).href)) as Api) : undefined
function api(): Api {
  if (!loaded) throw new Error('No existe scripts/lib/env-file.mjs')
  return loaded
}

const ENV_MAIN = 'DT_URL=https://qq11principal.example.invalid\n'
const ENV_WORKTREE = 'DT_URL=https://qq22worktree.example.invalid\n'

const dirs: string[] = []
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'vigia-envfile-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0).reverse()) rmSync(dir, { recursive: true, force: true })
})

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    'git',
    ['-c', 'user.name=Prueba', '-c', 'user.email=prueba@example.invalid', ...args],
    { cwd, encoding: 'utf8' }
  )
}

/** Repositorio principal con un commit y un worktree suyo en otra carpeta. */
function repoWithWorktree(): { main: string; worktree: string } {
  const main = tempDir()
  git(main, 'init', '-q')
  writeFileSync(join(main, 'base.txt'), 'nada\n')
  git(main, 'add', 'base.txt')
  git(main, 'commit', '-q', '-m', 'Base')
  const worktree = join(tempDir(), 'wt')
  git(main, 'worktree', 'add', '-q', '-b', 'otra', worktree)
  return { main, worktree }
}

function contentOf(path: string | undefined): string | undefined {
  return path === undefined ? undefined : readFileSync(path, 'utf8')
}

describe('CA2 (0055): findLiveEnv busca en el cwd y, si no, en el checkout principal', () => {
  it('CA2 (0055): con el fichero solo en el checkout principal y el cwd en un worktree, devuelve el del principal', () => {
    const { main, worktree } = repoWithWorktree()
    writeFileSync(join(main, '.env.live.local'), ENV_MAIN)
    expect(contentOf(api().findLiveEnv(worktree))).toBe(ENV_MAIN)
  })

  it('CA2 (0055): si el cwd tiene su propio fichero, lo prefiere al del principal', () => {
    const { main, worktree } = repoWithWorktree()
    writeFileSync(join(main, '.env.live.local'), ENV_MAIN)
    writeFileSync(join(worktree, '.env.live.local'), ENV_WORKTREE)
    expect(contentOf(api().findLiveEnv(worktree))).toBe(ENV_WORKTREE)
  })

  it('CA2 (0055): sin fichero en ninguno de los dos, devuelve undefined', () => {
    const { worktree } = repoWithWorktree()
    expect(api().findLiveEnv(worktree)).toBeUndefined()
  })

  it('CA2 (0055): fuera de un repositorio de git y sin fichero, devuelve undefined sin lanzar', () => {
    const dir = tempDir()
    expect(api().findLiveEnv(dir)).toBeUndefined()
  })

  it('CA2 (0055): con mainCheckout inyectado, lo usa en lugar de git', () => {
    const cwd = tempDir()
    const main = tempDir()
    writeFileSync(join(main, '.env.live.local'), ENV_MAIN)
    expect(contentOf(api().findLiveEnv(cwd, { mainCheckout: () => main }))).toBe(ENV_MAIN)
    expect(api().findLiveEnv(cwd, { mainCheckout: () => undefined })).toBeUndefined()
  })
})
