import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

/** Ficha 0072: la parte del script que habla con git y con GITHUB_OUTPUT (el developer). */

interface Deps {
  env: Record<string, string | undefined>
  execFile: (cmd: string, args: string[], options: unknown) => string
  appendOutput: (path: string, text: string) => void
  stdout: (message: string) => void
}

const { main } = (await import(pathToFileURL(join(__dirname, 'ci-changes.mjs')).href)) as {
  main: (deps: Deps) => boolean
}

function deps(env: Deps['env'], gitOutput = ''): Deps & { written: string[] } {
  const written: string[] = []
  return {
    env,
    execFile: vi.fn(() => gitOutput),
    appendOutput: (_path, text) => written.push(text),
    stdout: () => undefined,
    written
  }
}

describe('ci-changes.mjs: main', () => {
  it('en pull_request compara el commit de fusión con su primer padre y escribe la salida', () => {
    const d = deps(
      { GITHUB_EVENT_NAME: 'pull_request', GITHUB_OUTPUT: 'out' },
      'docs/a.md\0src/x.ts\0'
    )
    expect(main(d)).toBe(true)
    expect(d.execFile).toHaveBeenCalledWith(
      'git',
      ['diff', '--name-only', '-z', 'HEAD^1', 'HEAD'],
      expect.anything()
    )
    expect(d.written).toEqual(['codigo=true\n'])
  })

  it('en pull_request solo con documentos da false', () => {
    const d = deps({ GITHUB_EVENT_NAME: 'pull_request', GITHUB_OUTPUT: 'out' }, 'tasks/a.md\0')
    expect(main(d)).toBe(false)
    expect(d.written).toEqual(['codigo=false\n'])
  })

  it('fuera de pull_request da true sin mirar git', () => {
    const d = deps({ GITHUB_EVENT_NAME: 'push', GITHUB_OUTPUT: 'out' })
    expect(main(d)).toBe(true)
    expect(d.execFile).not.toHaveBeenCalled()
    expect(d.written).toEqual(['codigo=true\n'])
  })

  it('sin GITHUB_OUTPUT no escribe nada', () => {
    const d = deps({ GITHUB_EVENT_NAME: 'workflow_dispatch' })
    expect(main(d)).toBe(true)
    expect(d.written).toEqual([])
  })
})

/**
 * Ficha 0089: dentro del CI (GITHUB_ACTIONS definido), sin GITHUB_OUTPUT el script falla en vez de
 * no escribir nada (si no, `codigo` llegaría vacío). Fuera del CI, como hoy. Se lanza el script de
 * verdad para ver su código de salida, con un entorno sin las variables de GitHub del que lo corre.
 */
describe('CA3 (0089): sin GITHUB_OUTPUT falla dentro del CI y fuera no', () => {
  const SCRIPT = join(__dirname, 'ci-changes.mjs')

  function run(extra: Record<string, string>): ReturnType<typeof spawnSync> {
    const env: Record<string, string> = {}
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined && !key.startsWith('GITHUB_')) env[key] = value
    }
    // Evento push: no mira git, así el resultado no depende del checkout.
    return spawnSync(process.execPath, [SCRIPT], {
      env: { ...env, GITHUB_EVENT_NAME: 'push', ...extra },
      encoding: 'utf8'
    })
  }

  it('con GITHUB_ACTIONS=true y sin GITHUB_OUTPUT sale con código distinto de 0 y lo explica', () => {
    const result = run({ GITHUB_ACTIONS: 'true' })
    expect(result.status).not.toBe(0)
    expect(String(result.stderr)).toMatch(/GITHUB_OUTPUT/)
  })

  it('sin GITHUB_ACTIONS ni GITHUB_OUTPUT sale con 0, como hoy', () => {
    const result = run({})
    expect(result.status).toBe(0)
  })
})
