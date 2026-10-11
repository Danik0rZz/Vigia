import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { PlaywrightTestConfig } from '@playwright/test'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * Ficha 0075: cuarentena de los e2e inestables. `playwright.config.ts` tiene dos proyectos: `e2e`
 * (todo menos `@inestable`, con `grepInvert`) y `inestables` (solo `@inestable`, con `grep`), con
 * las demás opciones iguales. Bloquea solo `e2e`: `test:e2e` y `test:e2e:nobuild` lanzan
 * `--project=e2e`; `test:e2e:inestables` lanza `--project=inestables`. El plan de
 * `test:e2e:affected` se prueba en `scripts/affected-e2e.test.ts`.
 */

const ROOT = resolve(__dirname, '..')
const CONFIG = join(ROOT, 'playwright.config.ts')

type Pattern = RegExp | RegExp[] | null | undefined

/** Como Playwright: un patrón (o lista) casa si alguno casa con el texto. */
function matches(pattern: Pattern, text: string): boolean {
  if (pattern === null || pattern === undefined) return false
  const list = Array.isArray(pattern) ? pattern : [pattern]
  return list.some((regexp) => {
    regexp.lastIndex = 0
    return regexp.test(text)
  })
}

/** Si el proyecto ejecuta un test con ese título y esas etiquetas (como lo filtra Playwright). */
function selects(project: { grep?: Pattern; grepInvert?: Pattern }, text: string): boolean {
  const included =
    project.grep === undefined || project.grep === null || matches(project.grep, text)
  return included && !matches(project.grepInvert, text)
}

// Títulos de ejemplo como los ve el filtro de Playwright: título y etiquetas.
const STABLE = 'shell.spec.ts CA1 (0001): abre el menú @shell'
const STABLE_CLIPBOARD = 'views.spec.ts CA2 (0001): copia la tabla @metricas @portapapeles'
const FLAKY = 'tenants.spec.ts CA3 (0001): guarda el tenant @tenants @inestable'
const FLAKY_CLIPBOARD =
  'views.spec.ts CA4 (0001): copia el gráfico @metricas @portapapeles @inestable'

describe('CA1 (0075): playwright.config.ts tiene los proyectos e2e e inestables', () => {
  let config: PlaywrightTestConfig

  beforeAll(async () => {
    config = (await import('../playwright.config')).default as PlaywrightTestConfig
  })

  const project = (name: string): NonNullable<PlaywrightTestConfig['projects']>[number] => {
    const found = (config.projects ?? []).find((p) => p.name === name)
    expect(found, `proyecto ${name}`).toBeDefined()
    return found as NonNullable<PlaywrightTestConfig['projects']>[number]
  }

  it('CA1 (0075): hay exactamente dos proyectos, e2e e inestables', () => {
    expect((config.projects ?? []).map((p) => p.name).sort()).toEqual(['e2e', 'inestables'])
  })

  it('CA1 (0075): e2e excluye @inestable con grepInvert y deja pasar lo demás', () => {
    const e2e = project('e2e')
    expect(e2e.grepInvert, 'grepInvert de e2e').toBeTruthy()
    expect(selects(e2e, FLAKY)).toBe(false)
    expect(selects(e2e, FLAKY_CLIPBOARD)).toBe(false)
    expect(selects(e2e, STABLE)).toBe(true)
    expect(selects(e2e, STABLE_CLIPBOARD)).toBe(true)
  })

  it('CA1 (0075): inestables solo incluye @inestable, con grep', () => {
    const inestables = project('inestables')
    expect(inestables.grep, 'grep de inestables').toBeTruthy()
    expect(selects(inestables, FLAKY)).toBe(true)
    expect(selects(inestables, FLAKY_CLIPBOARD)).toBe(true)
    expect(selects(inestables, STABLE)).toBe(false)
    expect(selects(inestables, STABLE_CLIPBOARD)).toBe(false)
  })

  it('CA1 (0075): los proyectos solo cambian el filtro; el resto de opciones es el común', () => {
    for (const p of config.projects ?? []) {
      expect(
        Object.keys(p).filter((key) => !['name', 'grep', 'grepInvert'].includes(key)),
        `opciones propias de ${p.name}`
      ).toEqual([])
    }
    // Lo común sigue igual que antes de la 0075.
    expect(config.testDir).toBe('e2e')
    expect(config.retries).toBe(0)
    expect(config.forbidOnly).toBe(true)
    // `workers` lo fija la 0070 según `CI` (4 con él; sin él, el medido): lo prueba
    // scripts/playwright-workers.test.ts.
  })
})

describe('CA2 (0075): los scripts de package.json lanzan cada uno su proyecto', () => {
  const scripts =
    (
      JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
        scripts?: Record<string, string>
      }
    ).scripts ?? {}
  const projectsOf = (script: string): string[] =>
    [...(scripts[script] ?? '').matchAll(/--project[= ]['"]?([\w-]+)/g)].map((m) => m[1] ?? '')

  it('CA2 (0075): test:e2e compila y lanza playwright test --project=e2e', () => {
    expect(scripts['test:e2e']).toMatch(/electron-vite build/)
    expect(scripts['test:e2e']).toMatch(/playwright test/)
    expect(projectsOf('test:e2e')).toEqual(['e2e'])
  })

  it('CA2 (0075): test:e2e:nobuild lanza playwright test --project=e2e, sin compilar', () => {
    expect(scripts['test:e2e:nobuild']).toMatch(/playwright test/)
    expect(scripts['test:e2e:nobuild']).not.toMatch(/electron-vite build/)
    expect(projectsOf('test:e2e:nobuild')).toEqual(['e2e'])
  })

  it('CA2 (0075): test:e2e:inestables lanza playwright test --project=inestables', () => {
    expect(scripts['test:e2e:inestables'], 'script test:e2e:inestables').toBeDefined()
    expect(scripts['test:e2e:inestables']).toMatch(/playwright test/)
    expect(projectsOf('test:e2e:inestables')).toEqual(['inestables'])
  })
})

/**
 * CA5: con un spec de ejemplo fuera de `e2e/`, `--list` del proyecto `e2e` no incluye el test
 * `@inestable` y el de `inestables` sí. Se usa la config real con otro `testDir` (una carpeta
 * temporal): los proyectos y sus filtros son los de `playwright.config.ts`. `--list` no lanza la
 * app, así que no necesita `out/`.
 */
describe('CA5 (0075): --list de cada proyecto con un spec de ejemplo', () => {
  const require = createRequire(import.meta.url)
  const cli = join(dirname(require.resolve('@playwright/test/package.json')), 'cli.js')
  const testIndex = require.resolve('@playwright/test').replace(/\\/g, '/')
  let dir = ''

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'vigia-0075-'))
    writeFileSync(
      join(dir, 'ejemplo.spec.ts'),
      `import { test } from '${testIndex}'
test('CA9 (0075): ejemplo estable', { tag: '@shell' }, async () => {})
test('CA9 (0075): ejemplo inestable', {
  tag: ['@shell', '@inestable'],
  annotation: { type: 'arreglo', description: '0076' }
}, async () => {})
`
    )
    writeFileSync(
      join(dir, 'playwright.config.ts'),
      `import base from '${CONFIG.replace(/\\/g, '/')}'
export default { ...base, testDir: '${dir.replace(/\\/g, '/')}' }
`
    )
  })

  afterAll(() => {
    if (dir !== '') rmSync(dir, { recursive: true, force: true })
  })

  function list(project: string): { status: number | null; output: string } {
    const result = spawnSync(
      process.execPath,
      [
        cli,
        'test',
        '--config',
        join(dir, 'playwright.config.ts'),
        '--list',
        `--project=${project}`
      ],
      { cwd: ROOT, encoding: 'utf8', env: { ...process.env, FORCE_COLOR: '0' } }
    )
    return { status: result.status, output: `${result.stdout}\n${result.stderr}` }
  }

  it('CA5 (0075): el proyecto e2e lista el estable y no el @inestable', () => {
    const { status, output } = list('e2e')
    expect(status, output).toBe(0)
    expect(output).toContain('ejemplo estable')
    expect(output).not.toContain('ejemplo inestable')
  }, 60_000)

  it('CA5 (0075): el proyecto inestables lista el @inestable y no el estable', () => {
    const { status, output } = list('inestables')
    expect(status, output).toBe(0)
    expect(output).toContain('ejemplo inestable')
    expect(output).not.toContain('ejemplo estable')
  }, 60_000)
})
