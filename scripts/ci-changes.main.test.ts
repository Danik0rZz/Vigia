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
