import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

/** Ficha 0073: la parte del script que lee la ficha y pregunta a git (el developer). */

interface Deps {
  argv: string[]
  readFile: (path: string) => string
  execFile: (cmd: string, args: string[], options: unknown) => string
  stdout: (message: string) => void
  stderr: (message: string) => void
}

const { main } = (await import(pathToFileURL(join(__dirname, 'integrate.mjs')).href)) as {
  main: (deps: Deps) => number
}

const FICHA = [
  '---',
  "id: '0099'",
  "titulo: 'Agrupa los avisos'",
  'estado: verificada # comentario',
  'rama: feat/0099-agrupa-avisos',
  'exclusiones: []',
  '---',
  ''
].join('\n')

function deps(
  argv: string[],
  { status = '', branch = 'feat/0099-agrupa-avisos', ficha = FICHA } = {}
): Deps & { out: string[]; err: string[] } {
  const out: string[] = []
  const err: string[] = []
  return {
    argv,
    readFile: () => ficha,
    execFile: vi.fn((_cmd: string, args: string[]) =>
      args[0] === 'status' ? status : `${branch}\n`
    ),
    stdout: (message) => out.push(message),
    stderr: (message) => err.push(message),
    out,
    err
  }
}

describe('integrate.mjs: main', () => {
  it('con todo en orden escribe el mensaje del commit y sale con 0', () => {
    const d = deps(['tasks/0099-agrupa-avisos.md', 'avisos'])
    expect(main(d)).toBe(0)
    expect(d.out).toEqual(['feat(avisos): Agrupa los avisos (#0099)'])
    expect(d.err).toEqual([])
    expect(d.execFile).toHaveBeenCalledWith('git', ['status', '--porcelain'], expect.anything())
    expect(d.execFile).toHaveBeenCalledWith('git', ['branch', '--show-current'], expect.anything())
  })

  it('con el árbol sucio y otra rama da los motivos y sale con 1, sin mensaje', () => {
    const d = deps(['tasks/0099-agrupa-avisos.md', 'avisos'], {
      status: ' M src/x.ts\n',
      branch: 'main'
    })
    expect(main(d)).toBe(1)
    expect(d.out).toEqual([])
    expect(d.err).toHaveLength(2)
  })

  it('sin ficha o sin zona explica el uso y sale con 2', () => {
    const d = deps(['tasks/0099-agrupa-avisos.md'])
    expect(main(d)).toBe(2)
    expect(d.err[0]).toMatch(/Uso:/)
    expect(d.execFile).not.toHaveBeenCalled()
  })

  it('--agrupar da en JSON las PR: la sola al aparecer y el grupo al cerrarse', () => {
    const fichas: Record<string, string> = {
      'a.md': FICHA,
      'b.md': FICHA.replace("id: '0099'", "id: '0100'").replace(
        'exclusiones: []',
        'exclusiones: [ipc]'
      )
    }
    const d = {
      ...deps(['--agrupar', 'a.md', 'b.md']),
      readFile: (path: string) => fichas[path] ?? ''
    }
    expect(main(d)).toBe(0)
    expect(JSON.parse(d.out[0] ?? '')).toEqual([
      { fichas: ['0100'], fusionaDani: true },
      { fichas: ['0099'], fusionaDani: false }
    ])
    expect(d.execFile).not.toHaveBeenCalled()
  })

  it('--agrupar con una exclusión desconocida sale con 1 y sin fichas, con 2', () => {
    const bad = { ...deps(['--agrupar', 'a.md']), readFile: () => FICHA.replace('[]', '[red]') }
    expect(main(bad)).toBe(1)
    expect(bad.err[0]).toMatch(/red/)
    expect(main(deps(['--agrupar']))).toBe(2)
  })

  it.each([
    ['vacío', 'exclusiones:'],
    ['escalar', 'exclusiones: ipc'],
    ['escalar entre comillas', "exclusiones: ''"]
  ])('--agrupar con exclusiones %s (no es una lista) sale con 1 y lo explica', (_caso, campo) => {
    const d = {
      ...deps(['--agrupar', 'a.md']),
      readFile: () => FICHA.replace('exclusiones: []', campo)
    }
    expect(main(d)).toBe(1)
    expect(d.out).toEqual([])
    expect(d.err[0]).toMatch(/0099/)
    expect(d.err[0]).toMatch(/lista/)
  })
})
