import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * Ficha 0076: los tests que fallaron en la medición van a cuarentena (`@inestable` con la anotación
 * `arreglo`). Qué tests son sale de la medición, no de la ficha: estos tests no fijan la lista, sino
 * que la que haya en los specs reales cumpla los criterios.
 *
 * - CA1: la guarda de la 0075 (`checkTags`) no da ningún problema de cuarentena en los specs reales.
 * - CA2: `--list` del proyecto `inestables` da exactamente los tests con `@inestable` de `e2e/`, y
 *   el de `e2e` no da ninguno de ellos. Lo esperado se saca con un proyecto sin filtro (config
 *   aparte, en una carpeta temporal), para no comparar el filtro consigo mismo. `--list` no lanza
 *   la app: no necesita `out/`.
 */

const ROOT = resolve(__dirname, '..')
const E2E_DIR = join(ROOT, 'e2e')
const TASKS_DIR = join(ROOT, 'tasks')
const QUARANTINE_KINDS = ['sin-arreglo', 'ficha-inexistente', 'ficha-hecha']

interface Spec {
  file: string
  code: string
}

interface Problem {
  kind: string
  message: string
}

const require = createRequire(import.meta.url)
const { checkTags } = require(join(__dirname, 'e2e-tags.cjs')) as {
  checkTags: (specs: Spec[], config: unknown, modules?: Spec[], tasks?: Spec[]) => Problem[]
}

function realSpecs(): Spec[] {
  return readdirSync(E2E_DIR)
    .filter((name) => name.endsWith('.spec.ts'))
    .map((name) => ({ file: `e2e/${name}`, code: readFileSync(join(E2E_DIR, name), 'utf8') }))
}

function taskFiles(): Spec[] {
  return readdirSync(TASKS_DIR)
    .filter((name) => /^\d{4}-.*\.md$/.test(name))
    .map((name) => ({ file: `tasks/${name}`, code: readFileSync(join(TASKS_DIR, name), 'utf8') }))
}

describe('CA1 (0076): los tests en cuarentena llevan @inestable y arreglo a una ficha que existe', () => {
  it('CA1 (0076): la guarda de la 0075 no da problemas de cuarentena en los specs reales', () => {
    const areas = JSON.parse(readFileSync(join(E2E_DIR, 'areas.json'), 'utf8')) as unknown
    const specs = realSpecs()
    expect(specs.length).toBeGreaterThan(0)
    const problems = checkTags(specs, areas, [], taskFiles()).filter((p) =>
      QUARANTINE_KINDS.includes(p.kind)
    )
    expect(problems.map((p) => p.message)).toEqual([])
  })
})

interface JsonSpec {
  title: string
  file: string
  tags?: string[]
  tests: { projectName: string }[]
}

interface JsonSuite {
  title: string
  specs?: JsonSpec[]
  suites?: JsonSuite[]
}

/** Cada test listado: `fichero › describe › título`, con sus etiquetas y su proyecto. */
interface Listed {
  key: string
  tags: string[]
  project: string
}

function flatten(suite: JsonSuite, path: string[]): Listed[] {
  const out: Listed[] = []
  for (const spec of suite.specs ?? []) {
    for (const t of spec.tests) {
      out.push({
        key: [spec.file, ...path, spec.title].join(' › '),
        tags: (spec.tags ?? []).map((tag) => (tag.startsWith('@') ? tag : `@${tag}`)),
        project: t.projectName
      })
    }
  }
  for (const child of suite.suites ?? []) {
    // El primer nivel es el fichero, que ya va en `spec.file`.
    out.push(...flatten(child, [...path, child.title]))
  }
  return out
}

describe('CA2 (0076): --list de cada proyecto con los specs reales', () => {
  const cli = join(dirname(require.resolve('@playwright/test/package.json')), 'cli.js')
  let dir = ''
  let real: Listed[] = []
  let all: Listed[] = []

  function list(args: string[]): Listed[] {
    const result = spawnSync(
      process.execPath,
      [cli, 'test', '--list', '--reporter=json', ...args],
      {
        cwd: ROOT,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        env: { ...process.env, FORCE_COLOR: '0' }
      }
    )
    expect(result.status, result.stderr).toBe(0)
    const report = JSON.parse(result.stdout) as { suites: JsonSuite[] }
    return report.suites.flatMap((fileSuite) => flatten(fileSuite, []))
  }

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'vigia-0076-'))
    const config = join(ROOT, 'playwright.config.ts').replace(/\\/g, '/')
    writeFileSync(
      join(dir, 'playwright.config.ts'),
      `import base from '${config}'
export default { ...base, testDir: '${E2E_DIR.replace(/\\/g, '/')}', projects: [{ name: 'todos' }] }
`
    )
    real = list([])
    all = list(['--config', join(dir, 'playwright.config.ts')])
  }, 120_000)

  afterAll(() => {
    if (dir !== '') rmSync(dir, { recursive: true, force: true })
  })

  const keys = (items: Listed[]): string[] => [...new Set(items.map((i) => i.key))].sort()

  it('CA2 (0076): sin filtro se listan los tests de e2e/ (la lista de referencia no está vacía)', () => {
    expect(all.length).toBeGreaterThan(0)
  })

  it('CA2 (0076): el proyecto inestables lista exactamente los tests con @inestable', () => {
    const expected = keys(all.filter((i) => i.tags.includes('@inestable')))
    expect(keys(real.filter((i) => i.project === 'inestables'))).toEqual(expected)
  })

  it('CA2 (0076): el proyecto e2e no lista ninguno con @inestable y sí todos los demás', () => {
    const quarantined = new Set(keys(all.filter((i) => i.tags.includes('@inestable'))))
    const e2e = keys(real.filter((i) => i.project === 'e2e'))
    expect(e2e.filter((key) => quarantined.has(key))).toEqual([])
    expect(e2e).toEqual(keys(all).filter((key) => !quarantined.has(key)))
  })
})
