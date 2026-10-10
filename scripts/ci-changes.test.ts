import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Ficha 0072: el job `cambios` del CI decide si una PR trae algo más que documentos.
 *
 * Contrato que fijan estos tests (la ficha no daba los nombres):
 * - `classifyChanges(files: string[])` es pura y devuelve `{ codigo: boolean }`.
 * - `NON_CODE_PATTERNS: string[]` es la lista de lo que no cuenta como código (los globs de hoy en
 *   `paths-ignore`). Puede venir de un JSON que lea el script, pero el script la exporta.
 * - Importar el script no lanza nada (el `main` solo corre si se ejecuta con `node`).
 */

const SCRIPT = join(__dirname, 'ci-changes.mjs')
const CI = join(__dirname, '..', '.github', 'workflows', 'ci.yml')

interface Api {
  classifyChanges: (files: string[]) => { codigo: boolean }
  NON_CODE_PATTERNS: string[]
}

// Si el script aún no existe, solo fallan los tests que lo usan.
const loaded = existsSync(SCRIPT) ? ((await import(pathToFileURL(SCRIPT).href)) as Api) : undefined
function api(): Api {
  if (!loaded) throw new Error('No existe scripts/ci-changes.mjs')
  return loaded
}

const EXPECTED_PATTERNS = ['**/*.md', 'docs/**', 'tasks/**', '.claude/**']

/** Globs del `paths-ignore` del `push` de ci.yml, en orden. */
function pushPathsIgnore(workflow: string): string[] {
  const lines = workflow.split(/\r?\n/)
  const push = lines.findIndex((line) => /^\s{2}push:\s*$/.test(line))
  if (push === -1) return []
  const result: string[] = []
  let inside = false
  for (const line of lines.slice(push + 1)) {
    if (line.trim() === '' || line.trim().startsWith('#')) continue
    const indent = line.length - line.trimStart().length
    if (indent <= 2) break
    if (/^\s*paths-ignore:\s*$/.test(line)) {
      inside = true
      continue
    }
    if (!inside) continue
    const item = /^\s*-\s*['"]?([^'"]+)['"]?\s*$/.exec(line)
    if (!item) break
    result.push(item[1] ?? '')
  }
  return result
}

describe('CA1 (0072): classifyChanges decide si una PR trae código', () => {
  const sinCodigo: Array<[string, string[]]> = [
    ['un .md en la raíz', ['README.md']],
    ['un .md en cualquier carpeta', ['src/main/CLAUDE.md', 'e2e/CLAUDE.md']],
    [
      'ficheros de docs/ (también los que no son .md)',
      ['docs/adr/0014-pr.md', 'docs/img/flujo.png']
    ],
    ['fichas de tasks/', ['tasks/0072-ci-en-pull-request.md', 'tasks/_PLANTILLA.md']],
    ['ficheros de .claude/', ['.claude/agents/test-writer.md', '.claude/settings.json']],
    [
      'una mezcla de solo documentos',
      ['CHANGELOG.md', 'docs/flujo.md', 'tasks/0073-x.md', '.claude/commands/tarea.md']
    ],
    ['una lista vacía (sin código)', []]
  ]

  for (const [caso, files] of sinCodigo) {
    it(`codigo: false con ${caso}`, () => {
      expect(api().classifyChanges(files)).toEqual({ codigo: false })
    })
  }

  const conCodigo: Array<[string, string[]]> = [
    ['un .ts', ['src/main/index.ts']],
    ['un .md más un .ts', ['README.md', 'src/shared/types.ts']],
    ['el propio workflow', ['.github/workflows/ci.yml']],
    ['un script', ['scripts/ci-changes.mjs']],
    ['package.json', ['docs/flujo.md', 'package.json']],
    ['una carpeta que solo empieza como docs', ['docsx/a.ts']],
    ['un .md.ts que no es .md', ['src/renderer/notas.md.ts']]
  ]

  for (const [caso, files] of conCodigo) {
    it(`codigo: true con ${caso}`, () => {
      expect(api().classifyChanges(files)).toEqual({ codigo: true })
    })
  }

  it('es pura: no cambia la lista que recibe y da lo mismo dos veces', () => {
    const files = ['README.md', 'src/main/index.ts']
    const copy = [...files]
    const first = api().classifyChanges(files)
    expect(api().classifyChanges(files)).toEqual(first)
    expect(files).toEqual(copy)
  })

  it('exporta la lista de lo que no cuenta: la de hoy en paths-ignore', () => {
    expect([...api().NON_CODE_PATTERNS].sort()).toEqual([...EXPECTED_PATTERNS].sort())
  })

  it('la lista vive en un solo sitio: el paths-ignore del push coincide con la del script', () => {
    expect([...pushPathsIgnore(readFileSync(CI, 'utf8'))].sort()).toEqual(
      [...api().NON_CODE_PATTERNS].sort()
    )
  })

  it('el workflow no repite la lista fuera del paths-ignore del push', () => {
    const workflow = readFileSync(CI, 'utf8')
    for (const pattern of EXPECTED_PATTERNS) {
      const count = workflow.split(pattern).length - 1
      expect(count, `${pattern} en ci.yml`).toBe(1)
    }
  })
})
