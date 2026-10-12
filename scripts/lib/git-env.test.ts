import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

/**
 * Ficha 0101: los tests no heredan las variables `GIT_*` de los hooks de git.
 *
 * Contrato que fijan estos tests (la ficha no daba nombres):
 * - `scripts/lib/git-env.mjs` exporta `withoutGitVars(env)`: devuelve un objeto NUEVO con todas
 *   las variables de `env` salvo las que empiezan por `GIT_` sin distinguir mayúsculas (como en
 *   Windows). No modifica `env`.
 * - `vitest.config.ts` declara en `test.setupFiles` un fichero de preparación que borra de
 *   `process.env` esas mismas variables antes de cargar cada fichero de test.
 *
 * Todos los repositorios de git son FALSOS y viven en carpetas temporales: nunca se lanza git con
 * `GIT_DIR` apuntando al repositorio real.
 *
 * CA4 (`npm run check` en verde también desde un commit, con el pre-commit) lo ejecuta el
 * verifier: no es un test.
 */

const MODULE = join(__dirname, 'git-env.mjs')
const ROOT = resolve(__dirname, '..', '..')
const VITEST = join(ROOT, 'node_modules', 'vitest', 'vitest.mjs')
const THIS_FILE = 'scripts/lib/git-env.test.ts'

// La sonda de CA3: el proceso hijo de Vitest solo ejecuta este test (con `-t`).
const PROBE = 'CA3 (0101): sonda, ninguna variable GIT_ llega a process.env dentro de un test'
// `-t` es una expresión regular: se filtra por un trozo del nombre sin paréntesis.
const PROBE_PATTERN = 'sonda, ninguna variable GIT_'
const PROBE_FLAG = 'VIGIA_GIT_ENV_PROBE'

/** Limpieza local (no la del módulo): para lanzar git y Vitest en los tests sin depender de él. */
function cleanEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (!/^git_/i.test(key)) env[key] = value
  }
  return env
}

const dirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'vigia-0101-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function git(cwd: string, args: string[], env: NodeJS.ProcessEnv = cleanEnv()): string {
  return execFileSync(
    'git',
    ['-c', 'user.name=Prueba', '-c', 'user.email=prueba@example.invalid', ...args],
    { cwd, encoding: 'utf8', env }
  ).trim()
}

/** Repositorio de prueba con árbol de trabajo, un commit y un worktree enlazado. */
function repoWithWorktree(): { repo: string; worktree: string; worktreeGitDir: string } {
  const base = tempDir()
  const repo = join(base, 'repo')
  const worktree = join(base, 'wt')
  mkdirSync(repo)
  git(repo, ['init', '-q'])
  git(repo, ['commit', '-q', '--allow-empty', '-m', 'inicio'])
  git(repo, ['worktree', 'add', '-q', '-b', 'trabajo', worktree])
  // El GIT_DIR que exporta un hook lanzado desde el worktree: su carpeta dentro de .git/worktrees.
  const gitDir = git(worktree, ['rev-parse', '--git-dir'])
  const worktreeGitDir = isAbsolute(gitDir) ? gitDir : resolve(worktree, gitDir)
  return { repo, worktree, worktreeGitDir }
}

function isBare(repo: string): string {
  return git(repo, ['config', '--get', 'core.bare'])
}

describe('CA1 (0101): git init con el GIT_DIR de un hook deja core.bare=true en otro repositorio', () => {
  it('CA1 (0101): con GIT_DIR apuntando al gitdir de un worktree, git init en otra carpeta pone core.bare=true en el config común', () => {
    const { repo, worktreeGitDir } = repoWithWorktree()
    expect(isBare(repo)).toBe('false')

    // Un test que crea su repositorio temporal con `git init` y hereda el GIT_DIR del hook.
    const other = tempDir()
    git(other, ['init', '-q'], { ...cleanEnv(), GIT_DIR: worktreeGitDir })

    expect(isBare(repo)).toBe('true')
  })

  it('CA1 (0101): sin GIT_DIR, git init en otra carpeta no toca el repositorio de prueba', () => {
    const { repo } = repoWithWorktree()
    const other = tempDir()
    git(other, ['init', '-q'])

    expect(isBare(repo)).toBe('false')
    expect(existsSync(join(other, '.git'))).toBe(true)
  })
})

describe('CA2 (0101): withoutGitVars quita todas las GIT_* y deja las demás', () => {
  async function load(): Promise<(env: NodeJS.ProcessEnv) => NodeJS.ProcessEnv> {
    const mod = (await import(pathToFileURL(MODULE).href)) as {
      withoutGitVars: (env: NodeJS.ProcessEnv) => NodeJS.ProcessEnv
    }
    return mod.withoutGitVars
  }

  it('CA2 (0101): quita GIT_* en mayúsculas, minúsculas y mezcladas', async () => {
    const withoutGitVars = await load()
    const env: NodeJS.ProcessEnv = {
      GIT_DIR: 'C:\\falso\\.git',
      GIT_INDEX_FILE: 'C:\\falso\\.git\\index',
      GIT_WORK_TREE: 'C:\\falso',
      git_dir: 'minusculas',
      Git_Work_Tree: 'mezcladas',
      gIt_ObJeCt_DiReCtOrY: 'mezcladas'
    }
    expect(withoutGitVars(env)).toEqual({})
  })

  it('CA2 (0101): deja intactas las demás variables, aunque contengan GIT', async () => {
    const withoutGitVars = await load()
    const env: NodeJS.ProcessEnv = {
      PATH: 'C:\\Windows',
      Path: 'C:\\Windows\\System32',
      TZ: 'Europe/Madrid',
      GITHUB_ACTIONS: 'true',
      GIT: 'sin guion bajo',
      VIGIA_GIT_DIR: 'no empieza por GIT_',
      MY_GIT_INDEX_FILE: 'tampoco',
      GIT_DIR: 'C:\\falso\\.git'
    }
    expect(withoutGitVars(env)).toEqual({
      PATH: 'C:\\Windows',
      Path: 'C:\\Windows\\System32',
      TZ: 'Europe/Madrid',
      GITHUB_ACTIONS: 'true',
      GIT: 'sin guion bajo',
      VIGIA_GIT_DIR: 'no empieza por GIT_',
      MY_GIT_INDEX_FILE: 'tampoco'
    })
  })

  it('CA2 (0101): devuelve un objeto nuevo y no modifica el de entrada', async () => {
    const withoutGitVars = await load()
    const env: NodeJS.ProcessEnv = { GIT_DIR: 'x', HOME: 'C:\\Users\\prueba' }
    const result = withoutGitVars(env)
    expect(result).not.toBe(env)
    expect(env).toEqual({ GIT_DIR: 'x', HOME: 'C:\\Users\\prueba' })
  })
})

describe('CA3 (0101): ningún test hereda GIT_DIR, GIT_WORK_TREE ni GIT_INDEX_FILE', () => {
  it('CA3 (0101): vitest.config.ts carga un fichero de preparación en setupFiles', async () => {
    const config = (await import('../../vitest.config')).default as {
      test?: { setupFiles?: string | string[] }
    }
    const setupFiles = config.test?.setupFiles
    const files = setupFiles === undefined ? [] : [setupFiles].flat()
    expect(files.length, 'hay al menos un fichero en setupFiles').toBeGreaterThan(0)
    for (const file of files) {
      expect(existsSync(resolve(ROOT, file)), `existe ${file}`).toBe(true)
    }
  })

  // La sonda corre también en la pasada normal: dentro de un test nunca hay variables GIT_.
  it(PROBE, () => {
    const leaked = Object.keys(process.env).filter((key) => /^git_/i.test(key))
    expect(leaked).toEqual([])
  })

  it.skipIf(process.env[PROBE_FLAG] === '1')(
    'CA3 (0101): Vitest lanzado con GIT_DIR, GIT_WORK_TREE y GIT_INDEX_FILE no las pasa a los tests',
    () => {
      // Las variables apuntan a un repositorio FALSO de una carpeta temporal, no al real.
      const fake = tempDir()
      git(fake, ['init', '-q'])
      const env: NodeJS.ProcessEnv = {
        ...cleanEnv(),
        [PROBE_FLAG]: '1',
        GIT_DIR: join(fake, '.git'),
        GIT_WORK_TREE: fake,
        GIT_INDEX_FILE: join(fake, '.git', 'index')
      }
      const result = spawnSync(
        process.execPath,
        [VITEST, 'run', THIS_FILE, '-t', PROBE_PATTERN, '--reporter=verbose'],
        { cwd: ROOT, encoding: 'utf8', env, timeout: 110_000 }
      )
      const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
      expect(result.status, output).toBe(0)
      expect(output).toMatch(/\b1 passed\b/)
      expect(isBare(fake)).toBe('false')
    },
    120_000
  )
})
