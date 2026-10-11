import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Tiempo propio (reapertura por el CI): CA2 y CA3 crean un repositorio y un remoto y hacen uno o
// dos push con el hook, que lanza Node y scan:tenant. En el runner de Windows del CI eso pasa de
// los 5 s por defecto de vitest (8,5 s medidos). Los unitarios de CA1 no lo necesitan, pero no les
// cambia nada.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

/**
 * Ficha 0088: el pre-push solo publica en ramas `integra/` (o en los refs exactos de
 * `VIGIA_PUSH_ALLOW_REFS`) y solo hacia delante (avance rápido); los borrados siguen parados (0082).
 *
 * - CA1, unitario: `checkPushRefs(lines, { allowed, isAncestor })`, exportada por
 *   `scripts/scan-tenant.mjs` (la ficha deja elegir; ahí la copia ya el test de la 0082). `lines`
 *   son las líneas de la entrada estándar del pre-push
 *   (`<ref local> <sha local> <ref remoto> <sha remoto>`), `allowed` los refs exactos permitidos,
 *   `isAncestor(antecesor, descendiente)` dice si el primero es antecesor del segundo. Devuelve la
 *   lista de problemas: vacía si todo pasa.
 * - CA2 y CA3, con git de verdad (como `scripts/pre-push.test.ts`): repositorio y remoto desnudo
 *   temporales, el hook y los scripts copiados del repositorio y un `.env.live.local` FALSO.
 */

const ROOT = join(__dirname, '..')
const ENV =
  'DT_URL=https://zz99fake.live.dynatrace.com\nDT_CLIENT_SECRET=otro-valor-largo-falso-123\n'
const ALLOW_VAR = 'VIGIA_PUSH_ALLOW_REFS'

// Mensajes de la especificación (punto 2).
const NOT_INTEGRA = 'el destino no es una rama integra/'
const NOT_FAST_FORWARD = 'no es un avance rápido'
const DELETES = 'se borra un ref remoto'

// ---------------------------------------------------------------------------------------------
// CA1: la función pura
// ---------------------------------------------------------------------------------------------

type CheckPushRefs = (
  lines: string[],
  options: { allowed: string[]; isAncestor: (ancestor: string, descendant: string) => boolean }
) => unknown[]

const { checkPushRefs } = (await import(
  pathToFileURL(join(ROOT, 'scripts', 'scan-tenant.mjs')).href
)) as { checkPushRefs: CheckPushRefs }

const ZERO = '0'.repeat(40)
const OLD = 'a'.repeat(40)
const NEW = 'b'.repeat(40)
const OTHER = 'c'.repeat(40)

/** Historia inventada: OLD es antecesor de NEW; OTHER no tiene relación con ninguno. */
const isAncestor = (ancestor: string, descendant: string): boolean =>
  ancestor === descendant || (ancestor === OLD && descendant === NEW)

const check = (line: string, allowed: string[] = []): unknown[] =>
  checkPushRefs([line], { allowed, isAncestor })

describe('CA1 (0088): checkPushRefs rechaza destinos que no son integra/, borrados y pushes no lineales', () => {
  it('CA1 (0088): un push a refs/heads/main da un problema', () => {
    const problems = check(`refs/heads/main ${NEW} refs/heads/main ${OLD}`)
    expect(problems).toHaveLength(1)
    expect(JSON.stringify(problems)).toContain(NOT_INTEGRA)
  })

  it('CA1 (0088): un push a refs/heads/feat/x da un problema', () => {
    const problems = check(`refs/heads/feat/x ${NEW} refs/heads/feat/x ${ZERO}`)
    expect(problems).toHaveLength(1)
    expect(JSON.stringify(problems)).toContain(NOT_INTEGRA)
  })

  it('CA1 (0088): un borrado (SHA local a ceros) da un problema', () => {
    const problems = check(`(delete) ${ZERO} refs/heads/integra/20261011-1 ${OLD}`)
    expect(problems).toHaveLength(1)
    expect(JSON.stringify(problems)).toContain(DELETES)
  })

  it('CA1 (0088): un push no lineal a integra/ (el remoto no es antecesor) da un problema', () => {
    const problems = check(`refs/heads/trabajo ${OTHER} refs/heads/integra/20261011-1 ${OLD}`)
    expect(problems).toHaveLength(1)
    expect(JSON.stringify(problems)).toContain(NOT_FAST_FORWARD)
  })

  it('CA1 (0088): un avance rápido a refs/heads/integra/AAAAMMDD-N no da ningún problema', () => {
    expect(check(`refs/heads/trabajo ${NEW} refs/heads/integra/20261011-1 ${OLD}`)).toEqual([])
  })

  it('CA1 (0088): una rama integra/ nueva (SHA remoto a ceros) no da ningún problema', () => {
    expect(check(`refs/heads/trabajo ${NEW} refs/heads/integra/20261011-2 ${ZERO}`)).toEqual([])
  })

  it('CA1 (0088): con varias líneas, devuelve un problema por cada una que falla', () => {
    const problems = checkPushRefs(
      [
        `refs/heads/trabajo ${NEW} refs/heads/integra/20261011-1 ${OLD}`,
        `refs/heads/main ${NEW} refs/heads/main ${OLD}`,
        `refs/heads/trabajo ${OTHER} refs/heads/integra/20261011-3 ${OLD}`
      ],
      { allowed: [], isAncestor }
    )
    expect(problems).toHaveLength(2)
  })
})

describe('CA3 (0088): checkPushRefs con refs permitidos solo abre el destino exacto', () => {
  it('CA3 (0088): el ref exacto de allowed pasa', () => {
    expect(
      check(`refs/tags/v0.12.0 ${NEW} refs/tags/v0.12.0 ${ZERO}`, ['refs/tags/v0.12.0'])
    ).toEqual([])
  })

  it.each([['refs/tags/v0.12'], ['refs/tags/'], ['refs/tags/*'], ['refs/tags/v*'], ['v0.12.0']])(
    'CA3 (0088): allowed = [%s] no deja pasar refs/tags/v0.12.0',
    (allowed) => {
      expect(check(`refs/tags/v0.12.0 ${NEW} refs/tags/v0.12.0 ${ZERO}`, [allowed])).toHaveLength(1)
    }
  )

  it('CA3 (0088): allowed no deja pasar un push no lineal ni un borrado', () => {
    expect(
      JSON.stringify(
        check(`refs/heads/feat/x ${OTHER} refs/heads/feat/x ${OLD}`, ['refs/heads/feat/x'])
      )
    ).toContain(NOT_FAST_FORWARD)
    expect(
      JSON.stringify(check(`(delete) ${ZERO} refs/heads/feat/x ${OLD}`, ['refs/heads/feat/x']))
    ).toContain(DELETES)
  })
})

// ---------------------------------------------------------------------------------------------
// CA2 y CA3: el hook con git de verdad
// ---------------------------------------------------------------------------------------------

let dir: string
let repo: string
let remote: string

/** Entorno sin variables de git heredadas ni las de la puerta (la opcional del escáner y la 0088). */
function cleanEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith('GIT_') && key !== 'VIGIA_SCAN_TENANT_OPTIONAL' && key !== ALLOW_VAR)
      env[key] = value
  }
  return { ...env, ...extra }
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    'git',
    ['-c', 'user.name=Prueba', '-c', 'user.email=prueba@example.invalid', ...args],
    { cwd, encoding: 'utf8', env: cleanEnv() }
  )
}

/** `git push` con el hook activo; devuelve el código y toda la salida (la del hook incluida). */
function push(
  args: string[],
  extra: NodeJS.ProcessEnv = {}
): { status: number | null; output: string } {
  const result = spawnSync('git', ['push', ...args], {
    cwd: repo,
    encoding: 'utf8',
    env: cleanEnv(extra)
  })
  return { status: result.status, output: `${result.stdout}${result.stderr}` }
}

function commit(file: string, content: string, message: string): void {
  writeFileSync(join(repo, file), content)
  git(repo, 'add', file)
  git(repo, 'commit', '-q', '-m', message)
}

/** SHA de un ref en el remoto, o '' si no existe. */
function remoteSha(ref: string): string {
  const result = spawnSync('git', ['rev-parse', '--verify', '--quiet', ref], {
    cwd: remote,
    encoding: 'utf8',
    env: cleanEnv()
  })
  return result.status === 0 ? result.stdout.trim() : ''
}

const head = (): string => git(repo, 'rev-parse', 'HEAD').trim()

/** Copia los `.mjs` de una carpeta de scripts (el hook puede llamar a uno nuevo). */
function copyScripts(from: string, to: string): void {
  mkdirSync(to, { recursive: true })
  for (const name of readdirSync(from)) {
    if (name.endsWith('.mjs') || name.endsWith('.cjs'))
      copyFileSync(join(from, name), join(to, name))
  }
}

const INTEGRA = 'refs/heads/integra/20261011-1'
let base: string
let integraTip: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vigia-prepush-refs-'))
  remote = join(dir, 'remoto.git')
  repo = join(dir, 'repo')
  git(dir, 'init', '-q', '--bare', remote)
  git(dir, 'init', '-q', '-b', 'main', repo)
  commit('base.txt', 'nada\n', 'Base')
  base = head()
  git(repo, 'remote', 'add', 'origin', remote)
  // Estado inicial del remoto, antes de activar el hook: main, feat/x y una integra/ con un commit
  // más que main.
  git(repo, 'branch', 'feat/x')
  git(repo, 'checkout', '-q', '-b', 'trabajo')
  commit('integra.txt', 'uno\n', 'Integra')
  integraTip = head()
  git(repo, 'push', '-q', 'origin', 'main', 'feat/x', `HEAD:${INTEGRA}`)

  // El hook y los scripts, como en el repositorio; el .env falso, sin seguir por git.
  mkdirSync(join(repo, '.githooks'))
  copyFileSync(join(ROOT, '.githooks', 'pre-push'), join(repo, '.githooks', 'pre-push'))
  copyScripts(join(ROOT, 'scripts'), join(repo, 'scripts'))
  copyScripts(join(ROOT, 'scripts', 'lib'), join(repo, 'scripts', 'lib'))
  writeFileSync(join(repo, '.env.live.local'), ENV)
  writeFileSync(join(repo, '.git', 'info', 'exclude'), '.githooks/\nscripts/\n.env.live.local\n')
  git(repo, 'config', 'core.hooksPath', '.githooks')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** Deja `trabajo` en una historia que no contiene la punta de la integra/ remota. */
function divergeFromIntegra(): void {
  git(repo, 'reset', '-q', '--hard', base)
  commit('otro.txt', 'dos\n', 'Otro')
}

describe('CA2 (0088): el hook solo publica en integra/ y solo con avance rápido', () => {
  it('CA2 (0088): un push a main sale con error, lo explica y el remoto no cambia', () => {
    git(repo, 'checkout', '-q', 'main')
    commit('limpio.ts', 'const x = 1\n', 'Limpio')
    const { status, output } = push(['origin', 'main'])
    expect(status).not.toBe(0)
    expect(output).toContain(NOT_INTEGRA)
    expect(remoteSha('refs/heads/main')).toBe(base)
  })

  it('CA2 (0088): un push (avance rápido) a feat/x sale con error y el remoto no cambia', () => {
    const { status, output } = push(['origin', 'HEAD:feat/x'])
    expect(status).not.toBe(0)
    expect(output).toContain(NOT_INTEGRA)
    expect(remoteSha('refs/heads/feat/x')).toBe(base)
  })

  it('CA2 (0088): un push a una rama nueva que no es integra/ sale con error y no la crea', () => {
    const { status, output } = push(['origin', 'HEAD:refs/heads/otra'])
    expect(status).not.toBe(0)
    expect(output).toContain(NOT_INTEGRA)
    expect(remoteSha('refs/heads/otra')).toBe('')
  })

  it('CA2 (0088): un push no lineal (+refspec) a integra/ sale con error y el remoto no cambia', () => {
    divergeFromIntegra()
    const { status, output } = push(['origin', `+HEAD:${INTEGRA}`])
    expect(status).not.toBe(0)
    expect(output).toContain(NOT_FAST_FORWARD)
    expect(remoteSha(INTEGRA)).toBe(integraTip)
  })

  it('CA2 (0088): un avance rápido a integra/ publica', () => {
    commit('limpio.ts', 'const x = 1\n', 'Limpio')
    const { status } = push(['origin', `HEAD:${INTEGRA}`])
    expect(status).toBe(0)
    expect(remoteSha(INTEGRA)).toBe(head())
  })

  it('CA2 (0088): una rama integra/ nueva publica', () => {
    commit('limpio.ts', 'const x = 1\n', 'Limpio')
    const { status } = push(['origin', 'HEAD:integra/20261011-2'])
    expect(status).toBe(0)
    expect(remoteSha('refs/heads/integra/20261011-2')).toBe(head())
  })
})

describe('CA3 (0088): VIGIA_PUSH_ALLOW_REFS abre solo el destino exacto y nunca un push no lineal', () => {
  const TAG = 'refs/tags/v0.12.0'

  beforeEach(() => {
    git(repo, 'tag', 'v0.12.0')
  })

  it('CA3 (0088): sin la variable, el tag no se publica', () => {
    const { status, output } = push(['origin', TAG])
    expect(status).not.toBe(0)
    expect(output).toContain(NOT_INTEGRA)
    expect(remoteSha(TAG)).toBe('')
  })

  it('CA3 (0088): con el ref exacto en la variable, el tag se publica', () => {
    const { status } = push(['origin', TAG], { [ALLOW_VAR]: TAG })
    expect(status).toBe(0)
    expect(remoteSha(TAG)).toBe(head())
  })

  it('CA3 (0088): con varios refs separados por comas, el exacto se publica', () => {
    const { status } = push(['origin', TAG], { [ALLOW_VAR]: `refs/heads/otra,${TAG}` })
    expect(status).toBe(0)
    expect(remoteSha(TAG)).toBe(head())
  })

  it.each([['refs/tags/v0.12'], ['refs/tags/'], ['refs/tags/*'], ['refs/tags/v*'], ['v0.12.0']])(
    'CA3 (0088): con la variable a «%s» (parecido, no exacto), el tag no se publica',
    (value) => {
      const { status } = push(['origin', TAG], { [ALLOW_VAR]: value })
      expect(status).not.toBe(0)
      expect(remoteSha(TAG)).toBe('')
    }
  )

  it('CA3 (0088): la variable no deja pasar un push no lineal a un ref permitido', () => {
    // feat/x está en base: se avanza primero (permitido) y luego se intenta reescribir.
    const first = push(['origin', 'HEAD:feat/x'], { [ALLOW_VAR]: 'refs/heads/feat/x' })
    expect(first.status).toBe(0)
    const published = remoteSha('refs/heads/feat/x')
    expect(published).toBe(integraTip)
    divergeFromIntegra()
    const { status, output } = push(['origin', '+HEAD:feat/x'], {
      [ALLOW_VAR]: 'refs/heads/feat/x'
    })
    expect(status).not.toBe(0)
    expect(output).toContain(NOT_FAST_FORWARD)
    expect(remoteSha('refs/heads/feat/x')).toBe(published)
  })

  it('CA3 (0088): la variable no deja pasar un push no lineal a integra/', () => {
    divergeFromIntegra()
    const { status } = push(['origin', `+HEAD:${INTEGRA}`], { [ALLOW_VAR]: INTEGRA })
    expect(status).not.toBe(0)
    expect(remoteSha(INTEGRA)).toBe(integraTip)
  })

  it('CA3 (0088): la variable no deja pasar un borrado', () => {
    const { status } = push(['origin', ':feat/x'], { [ALLOW_VAR]: 'refs/heads/feat/x' })
    expect(status).not.toBe(0)
    expect(remoteSha('refs/heads/feat/x')).toBe(base)
  })
})
