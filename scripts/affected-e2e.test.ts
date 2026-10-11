import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Qué e2e hay que ejecutar según los ficheros cambiados (nivel 1 y 2 de la
 * estrategia de validación). La decisión es pura: se prueba con una config
 * fija y, además, con el e2e/areas.json real para los ficheros típicos.
 */

type Decision = { mode: 'all' | 'some' | 'none'; specs: string[]; reasons: string[] }
type Config = {
  always: string[]
  ignore: string[]
  transversal: string[]
  areas: Record<string, { globs: string[]; specs: string[] }>
}

const require = createRequire(import.meta.url)
// Contrato de 0068: parseArgs devuelve las opciones (con `range`) o, para
// --help y los errores, { exit, message }; plan devuelve los comandos y, si no
// se puede seguir, también { exit, message }. Las opciones son opacas para plan.
type Command = { command: string; args: string[] }
type Options = { range: string; exit?: undefined }
type Exit = { exit: number; message: string }
type Plan = { commands: Command[]; exit?: number; message?: string }

const { decide, parseArgs, plan } = require(join(__dirname, 'affected-e2e.cjs')) as {
  decide: (files: string[], config: Config) => Decision
  parseArgs: (argv: string[]) => Options | Exit
  plan: (decision: Decision, options: Options | Exit, env: { outExists: boolean }) => Plan
}

const SMOKE = 'e2e/smoke.spec.ts'
const config: Config = {
  always: [SMOKE],
  ignore: ['docs/**', '**/*.md', 'src/**/*.test.ts', 'src/**/*.live.test.ts', 'src/test/**'],
  transversal: ['src/shared/ipc.ts', 'src/main/db/**', 'package.json'],
  areas: {
    tenants: {
      globs: ['src/main/tenants/**', 'src/renderer/src/settings/**'],
      specs: ['e2e/tenants.spec.ts']
    },
    tls: {
      globs: ['src/main/dynatrace/**', 'src/renderer/src/settings/**'],
      specs: ['e2e/tls.spec.ts']
    },
    views: {
      globs: ['src/renderer/src/pages/**', 'src/main/dynatrace/**'],
      specs: ['e2e/views.spec.ts']
    },
    shell: { globs: ['src/renderer/src/components/Sidebar.tsx'], specs: ['e2e/shell.spec.ts'] }
  }
}

function expectReasons(decision: Decision): void {
  if (decision.mode === 'none') expect(decision.reasons).toEqual([])
  else expect(decision.reasons.length, 'reasons no vacío').toBeGreaterThan(0)
}

describe('decide', () => {
  it.each([
    ['sin config', undefined],
    ['con null', null],
    ['con {}', {}],
    ['con ignore que no es lista', { ...config, ignore: 'docs/**' }],
    ['con un texto', 'e2e/areas.json']
  ])('%s → TypeError con un mensaje claro (sin valor por defecto)', (_case, bad) => {
    const call = (): Decision => decide(['src/renderer/src/pages/X.tsx'], bad as unknown as Config)
    expect(call).toThrow(TypeError)
    expect(call).toThrow('decide necesita la config de e2e/areas.json')
  })

  it('la comprobación de la config va antes que los ficheros (también con una lista vacía)', () => {
    expect(() => decide([], null as unknown as Config)).toThrow(TypeError)
  })

  it('sin ficheros → none', () => {
    const d = decide([], config)
    expect(d).toMatchObject({ mode: 'none', specs: [] })
    expectReasons(d)
  })

  it('todo ignorado → none (docs y tests unitarios)', () => {
    const d = decide(
      ['docs/a.md', 'src/main/x.test.ts', 'src/main/y.live.test.ts', 'src/test/live-client.ts'],
      config
    )
    expect(d).toMatchObject({ mode: 'none', specs: [] })
  })

  it('el ignore va por patrón de fichero, no por carpeta: x.ts y x.test.ts juntos no dan none', () => {
    const d = decide(['src/main/dynatrace/x.ts', 'src/main/dynatrace/x.test.ts'], config)
    expect(d.mode).toBe('some')
    expect(d.specs).toEqual([SMOKE, 'e2e/tls.spec.ts', 'e2e/views.spec.ts'].sort())
  })

  it('un .md junto a una página → some con views y smoke', () => {
    const d = decide(['docs/a.md', 'src/renderer/src/pages/ProblemsPage.tsx'], config)
    expect(d).toMatchObject({ mode: 'some', specs: [SMOKE, 'e2e/views.spec.ts'].sort() })
    expectReasons(d)
  })

  it('transversal → all, specs vacío y una reason por fichero transversal', () => {
    const d = decide(
      ['src/renderer/src/pages/X.tsx', 'src/shared/ipc.ts', 'src/main/db/schema.ts'],
      config
    )
    expect(d).toMatchObject({ mode: 'all', specs: [] })
    expect(d.reasons.length).toBeGreaterThanOrEqual(2)
  })

  it('un spec cambiado se ejecuta a sí mismo (más smoke)', () => {
    const d = decide(['e2e/tls.spec.ts'], config)
    expect(d).toMatchObject({ mode: 'some', specs: [SMOKE, 'e2e/tls.spec.ts'].sort() })
  })

  it('un fichero en varias áreas suma sus specs, ordenados y sin duplicados', () => {
    const d = decide(
      [
        'src/renderer/src/settings/Form.tsx',
        'src/main/tenants/repo.ts',
        'src/renderer/src/settings/Otro.tsx'
      ],
      config
    )
    expect(d.specs).toEqual([SMOKE, 'e2e/tenants.spec.ts', 'e2e/tls.spec.ts'].sort())
    expect(new Set(d.specs).size).toBe(d.specs.length)
  })

  it('un fichero sin área → all con su reason', () => {
    const d = decide(['src/main/algo-nuevo.ts'], config)
    expect(d.mode).toBe('all')
    expect(d.reasons.join(' ')).toContain('src/main/algo-nuevo.ts')
  })

  it('un fichero sin área gana aunque otros tengan área (por seguridad)', () => {
    expect(decide(['src/renderer/src/pages/X.tsx', 'src/main/algo-nuevo.ts'], config).mode).toBe(
      'all'
    )
  })

  it('normaliza rutas de Windows (\\) antes de comparar', () => {
    const d = decide(['src\\renderer\\src\\pages\\ProblemsPage.tsx'], config)
    expect(d).toMatchObject({ mode: 'some', specs: [SMOKE, 'e2e/views.spec.ts'].sort() })
    expect(decide(['src\\shared\\ipc.ts'], config).mode).toBe('all')
  })

  it('smoke va siempre en some, una sola vez', () => {
    const d = decide(['e2e/smoke.spec.ts', 'src/renderer/src/components/Sidebar.tsx'], config)
    expect(d.specs).toEqual([SMOKE, 'e2e/shell.spec.ts'].sort())
  })
})

const AREAS = join(__dirname, '..', 'e2e', 'areas.json')

// Ficha 0070: el área views se parte en una por spec de vistas (views-<zona>.spec.ts) y los tests
// con @portapapeles van todos a views-portapapeles.spec.ts.
const viewSpec = (zone: string): string => `e2e/views-${zone}.spec.ts`
const PORTAPAPELES = viewSpec('portapapeles')
const ENTITY_SPECS = ['entidad', 'servicio', 'host', 'proceso', 'monitor', 'aplicacion'].map(
  viewSpec
)
const isViewSpec = (spec: string): boolean => /^e2e\/views-[a-z-]+\.spec\.ts$/.test(spec)
const E2E = join(__dirname, '..', 'e2e')
const PORTAPAPELES_FILE = join(E2E, 'views-portapapeles.spec.ts')

/** Si views-portapapeles.spec.ts tiene algún test de la zona (su etiqueta aparece en el spec). */
function clipboardHasZone(zone: string): boolean {
  if (!existsSync(PORTAPAPELES_FILE)) return false
  return new RegExp(`['"]@${zone}['"]`).test(readFileSync(PORTAPAPELES_FILE, 'utf8'))
}

/** Lo esperado para una zona: su spec, smoke y el del portapapeles si la zona tiene tests ahí. */
function expectedFor(zones: string[]): string[] {
  const specs = [SMOKE, ...zones.map(viewSpec)]
  if (zones.some(clipboardHasZone)) specs.push(PORTAPAPELES)
  return specs.sort()
}

describe.skipIf(!existsSync(AREAS))('e2e/areas.json real', () => {
  const real = JSON.parse(existsSync(AREAS) ? readFileSync(AREAS, 'utf8') : '{}') as Config
  const specsFor = (file: string): Decision => decide([file], real)

  it('todo spec de e2e/ está en algún área o en always', () => {
    const declared = new Set([...real.always, ...Object.values(real.areas).flatMap((a) => a.specs)])
    for (const spec of ['shell', 'smoke', 'tenants', 'tls']) {
      expect(declared.has(`e2e/${spec}.spec.ts`), spec).toBe(true)
    }
  })

  it.each([
    ['src/shared/ipc.ts'],
    ['src/preload/index.ts'],
    ['src/main/ipc/handler.ts'],
    ['src/main/security/csp.ts'],
    ['src/main/index.ts'],
    ['src/main/db/schema.ts'],
    ['src/main/db/migrations/0003_algo.sql'],
    ['src/renderer/src/app/Layout.tsx'],
    ['src/renderer/src/app/router.tsx'],
    ['src/renderer/src/app/navigation.ts'],
    ['src/renderer/src/main.tsx'],
    ['package.json'],
    ['package-lock.json'],
    ['electron.vite.config.ts'],
    ['electron-builder.yml'],
    ['playwright.config.ts'],
    ['e2e/areas.json']
  ])('%s es transversal → all', (file) => {
    expect(specsFor(file).mode).toBe('all')
  })

  it.each([
    ['src/renderer/src/settings/TenantsSection.tsx', 'e2e/tenants.spec.ts'],
    ['src/main/tenants/repository.ts', 'e2e/tenants.spec.ts'],
    ['src/main/secrets/store.ts', 'e2e/tenants.spec.ts'],
    ['src/renderer/src/components/EnvSelector.tsx', 'e2e/tenants.spec.ts'],
    ['src/main/dynatrace/tls.ts', 'e2e/tls.spec.ts'],
    ['src/main/dynatrace/client.ts', 'e2e/tls.spec.ts'],
    ['src/main/dynatrace/client.ts', 'e2e/views-vistas-comun.spec.ts'],
    ['src/renderer/src/settings/ConnectionPanel.tsx', 'e2e/tls.spec.ts'],
    ['src/renderer/src/pages/ProblemsPage.tsx', 'e2e/views-problemas.spec.ts'],
    ['src/renderer/src/components/ProblemsTable.tsx', 'e2e/views-problemas.spec.ts'],
    ['src/main/export/csv.ts', 'e2e/views-problemas.spec.ts'],
    ['src/main/ipc/handlers/modules.ts', 'e2e/views-problemas.spec.ts'],
    ['src/shared/problem-row.ts', 'e2e/views-problemas.spec.ts'],
    ['src/renderer/src/components/Sidebar.tsx', 'e2e/shell.spec.ts'],
    ['src/renderer/src/components/TopBar.tsx', 'e2e/shell.spec.ts'],
    ['src/renderer/src/components/TopBar.tsx', 'e2e/views-vistas-comun.spec.ts'],
    ['src/renderer/src/app/problem-filters.ts', 'e2e/views-problemas.spec.ts'],
    ['src/renderer/src/app/page-crumb.ts', 'e2e/views-problema-detalle.spec.ts'],
    ['src/shared/problem-sort.ts', 'e2e/views-problemas.spec.ts']
  ])('%s → incluye %s y smoke', (file, spec) => {
    const d = specsFor(file)
    expect(['some', 'all']).toContain(d.mode)
    if (d.mode === 'some') {
      expect(d.specs).toContain(spec)
      expect(d.specs).toContain(SMOKE)
    }
  })

  // 0.10.0: el grid genérico y la lógica de la tabla de evidencias solo los usa
  // Problemas; sin mapear disparaban el e2e completo.
  it('DataGrid, grid-sort, la tabla de evidencias y sus gráficos → some con specs de vistas (problema-detalle) y smoke', () => {
    const d = decide(
      [
        'src/renderer/src/components/DataGrid.tsx',
        'src/shared/grid-sort.ts',
        'src/shared/problem-evidence.ts',
        'src/shared/event-metric.ts',
        'src/renderer/src/components/EvidenceSection.tsx',
        'src/renderer/src/components/EvidenceMetricChart.tsx',
        'src/renderer/src/app/evidence-table.ts'
      ],
      real
    )
    expect(d.mode).toBe('some')
    expect(d.specs).toContain(SMOKE)
    expect(d.specs).toContain(viewSpec('problema-detalle'))
    for (const spec of d.specs) expect(spec === SMOKE || isViewSpec(spec), spec).toBe(true)
  })

  // main.css lo cubre el test de contraste (en check): solo, dispara shell. Los
  // locales van por claves y zonas desde la ficha 0071 (affected-e2e-locales.test.ts).
  it.each(['src/renderer/src/assets/main.css'])(
    '%s solo → some con shell y smoke, nada más',
    (file) => {
      const d = specsFor(file)
      expect(d.mode).toBe('some')
      expect(d.specs).toEqual([SMOKE, 'e2e/shell.spec.ts'].sort())
    }
  )

  // --- Ficha 0070: afectados por zona de vistas ---

  it.each([
    'src/renderer/src/pages/entities/ServiceEntityPage.tsx',
    'src/renderer/src/pages/entities/ServiceCharts.tsx',
    'src/renderer/src/pages/entities/ServiceMarkers.tsx',
    'src/main/modules/service-metrics.ts'
  ])(
    'CA3 (0070): %s (página del servicio o su canal) → solo views-servicio y smoke (y el portapapeles si la zona tiene tests ahí)',
    (file) => {
      const d = specsFor(file)
      expect(d.mode).toBe('some')
      expect(d.specs).toEqual(expectedFor(['servicio']))
    }
  )

  it.each(['src/renderer/src/pages/entities/EntityPageFrame.tsx'])(
    'CA3 (0070): %s (común de las páginas de entidad) → las seis de entidad y smoke',
    (file) => {
      const d = specsFor(file)
      expect(d.mode).toBe('some')
      expect(d.specs).toEqual(
        expectedFor(['entidad', 'servicio', 'host', 'proceso', 'monitor', 'aplicacion'])
      )
      for (const spec of ENTITY_SPECS) expect(d.specs).toContain(spec)
    }
  )

  it('CA3 (0070): la página de Métricas → views-metricas y views-portapapeles', () => {
    const d = specsFor('src/renderer/src/pages/MetricsPage.tsx')
    expect(d.mode).toBe('some')
    expect(d.specs).toContain(SMOKE)
    expect(d.specs).toContain(viewSpec('metricas'))
    expect(d.specs).toContain(PORTAPAPELES)
  })

  it('CA3 (0070): un área con tests de su zona en views-portapapeles.spec.ts incluye ese spec', () => {
    expect(existsSync(PORTAPAPELES_FILE), 'e2e/views-portapapeles.spec.ts').toBe(true)
    const zones = Object.keys((real as unknown as { zones: Record<string, string> }).zones)
      .map((tag) => tag.slice(1))
      .filter(clipboardHasZone)
    expect(zones.length, 'zonas con tests de portapapeles').toBeGreaterThan(0)
    for (const zone of zones) {
      const areas = Object.values(real.areas).filter((area) => area.specs.includes(viewSpec(zone)))
      for (const area of areas) expect(area.specs, zone).toContain(PORTAPAPELES)
    }
  })

  it('CA4 (0070): cada spec de areas.json existe en e2e/', () => {
    const declared = new Set([...real.always, ...Object.values(real.areas).flatMap((a) => a.specs)])
    expect(declared.size).toBeGreaterThan(0)
    for (const spec of declared) expect(existsSync(join(__dirname, '..', spec)), spec).toBe(true)
  })

  it('CA4 (0070): cada views-*.spec.ts de e2e/ está en al menos un área', () => {
    const inAreas = new Set(Object.values(real.areas).flatMap((a) => a.specs))
    const viewSpecs = readdirSync(E2E)
      .filter((name) => /^views-[a-z-]+\.spec\.ts$/.test(name))
      .map((name) => `e2e/${name}`)
    // Uno por zona de vistas (11) más el del portapapeles.
    expect(viewSpecs.length).toBe(12)
    for (const spec of viewSpecs) expect(inAreas.has(spec), spec).toBe(true)
    expect(inAreas.has('e2e/views.spec.ts'), 'e2e/views.spec.ts ya no existe').toBe(false)
  })

  it.each([
    'docs/notas-api-v2.md',
    'src/main/dynatrace/client.test.ts',
    'src/main/modules/problems.live.test.ts',
    // Los scripts de herramientas no van en la app empaquetada.
    'scripts/affected-e2e.cjs',
    'scripts/scan-tenant.mjs'
  ])('%s solo → none', (file) => {
    expect(specsFor(file).mode).toBe('none')
  })
})

// --- Ficha 0068: opciones --no-build, -g/--grep, --last-failed y --help ---

const BUILD: Command = { command: 'npx', args: ['electron-vite', 'build'] }
// Ficha 0075: el plan solo lanza el proyecto bloqueante (`--project=e2e`), justo tras `test`.
const PROJECT = '--project=e2e'
const playwright = (...args: string[]): Command => ({
  command: 'npx',
  args: ['playwright', 'test', PROJECT, ...args]
})
const SOME: Decision = {
  mode: 'some',
  specs: [SMOKE, 'e2e/views.spec.ts'],
  reasons: ['src/renderer/src/pages/X.tsx → views']
}
const ALL: Decision = { mode: 'all', specs: [], reasons: ['transversal: src/shared/ipc.ts'] }
const NONE: Decision = { mode: 'none', specs: [], reasons: [] }
const SCRIPT = join(__dirname, 'affected-e2e.cjs')

function options(argv: string[]): Options {
  const parsed = parseArgs(argv)
  expect(parsed.exit, `parseArgs(${JSON.stringify(argv)}) no debería salir`).toBeUndefined()
  return parsed as Options
}

function expectUsage(text: string): void {
  expect(text).toContain('test:e2e:affected')
  for (const option of ['--no-build', '-g', '--grep', '--last-failed', '--help']) {
    expect(text, `el uso menciona ${option}`).toContain(option)
  }
}

describe('CA1 (0068): sin opciones, el plan es el de hoy', () => {
  it('rango por defecto origin/main..HEAD', () => {
    expect(options([]).range).toBe('origin/main..HEAD')
  })

  it('some → compila y lanza Playwright con los specs decididos', () => {
    const p = plan(SOME, options([]), { outExists: true })
    expect(p.commands).toEqual([BUILD, playwright(...SOME.specs)])
    expect(p.exit ?? 0).toBe(0)
  })

  it('all → compila y lanza Playwright sin specs (e2e completo)', () => {
    expect(plan(ALL, options([]), { outExists: true }).commands).toEqual([BUILD, playwright()])
  })

  it('sin --no-build compila aunque no exista out/', () => {
    expect(plan(SOME, options([]), { outExists: false }).commands).toEqual([
      BUILD,
      playwright(...SOME.specs)
    ])
  })
})

describe('CA2 (0068): --no-build', () => {
  it('con out/ presente → no compila, solo Playwright', () => {
    const p = plan(SOME, options(['--no-build']), { outExists: true })
    expect(p.commands).toEqual([playwright(...SOME.specs)])
    expect(p.exit ?? 0).toBe(0)
  })

  it('con out/ presente y all → Playwright sin specs, sin compilar', () => {
    expect(plan(ALL, options(['--no-build']), { outExists: true }).commands).toEqual([playwright()])
  })

  it.each([
    ['some', SOME],
    ['all', ALL]
  ])('sin out/ (%s) → código 2, el mensaje y ningún comando', (_mode, decision) => {
    const p = plan(decision, options(['--no-build']), { outExists: false })
    expect(p.commands).toEqual([])
    expect(p.exit).toBe(2)
    expect(p.message).toMatch(/falta .?out\/.?: compila con .?npm run build.? o quita .?--no-build/)
  })
})

describe('CA3 (0068): -g, --grep y --last-failed llegan a Playwright después de los specs', () => {
  it.each([[['-g', '(0070)']], [['--grep', '(0070)']], [['--last-failed']]])(
    '%j tal cual, tras los specs',
    (extra) => {
      expect(plan(SOME, options(extra), { outExists: true }).commands).toEqual([
        BUILD,
        playwright(...SOME.specs, ...extra)
      ])
    }
  )

  it('con all, también tras playwright test', () => {
    expect(plan(ALL, options(['-g', '(0070)']), { outExists: true }).commands).toEqual([
      BUILD,
      playwright('-g', '(0070)')
    ])
  })

  it('junto con --no-build', () => {
    expect(
      plan(SOME, options(['--no-build', '--last-failed']), { outExists: true }).commands
    ).toEqual([playwright(...SOME.specs, '--last-failed')])
  })

  it.each([
    [['main..HEAD', '--no-build', '-g', '(0070)']],
    [['--no-build', '-g', '(0070)', 'main..HEAD']],
    [['-g', '(0070)', 'main..HEAD', '--no-build']],
    [['--grep', '(0070)', 'main..HEAD']],
    [['--last-failed', 'main..HEAD']],
    [['main..HEAD', '--last-failed']]
  ])('el rango se lee igual antes o después de las opciones: %j', (argv) => {
    const parsed = options(argv)
    expect(parsed.range).toBe('main..HEAD')
    const last = plan(SOME, parsed, { outExists: true }).commands.at(-1)
    expect(last?.args.slice(0, 3 + SOME.specs.length)).toEqual([
      'playwright',
      'test',
      PROJECT,
      ...SOME.specs
    ])
    expect(last?.args).not.toContain('main..HEAD')
  })

  it('el valor de -g no se toma por el rango', () => {
    const parsed = options(['-g', '(0070)'])
    expect(parsed.range).toBe('origin/main..HEAD')
    expect(plan(SOME, parsed, { outExists: true }).commands.at(-1)).toEqual(
      playwright(...SOME.specs, '-g', '(0070)')
    )
  })
})

describe('CA4 (0068): opción desconocida y --help', () => {
  it.each([['--no-buidl'], ['-x'], ['--grpe']])('%s → uso y código 2', (bad) => {
    const parsed = parseArgs(['main..HEAD', bad]) as Exit
    expect(parsed.exit).toBe(2)
    expectUsage(parsed.message)
  })

  it('--help → uso y código 0 (también con otras opciones)', () => {
    for (const argv of [['--help'], ['main..HEAD', '--help'], ['--no-build', '--help']]) {
      const parsed = parseArgs(argv) as Exit
      expect(parsed.exit, JSON.stringify(argv)).toBe(0)
      expectUsage(parsed.message)
    }
  })

  it('el uso habla de out/ (--no-build no comprueba si está al día)', () => {
    expect((parseArgs(['--help']) as Exit).message).toContain('out/')
  })

  it('el script con --no-buidl sale con 2 y el uso, sin compilar ni lanzar Playwright', () => {
    const result = spawnSync(process.execPath, [SCRIPT, '--no-buidl'], {
      cwd: join(__dirname, '..'),
      encoding: 'utf8',
      timeout: 30_000
    })
    expect(result.status).toBe(2)
    const output = `${result.stdout}${result.stderr}`
    expectUsage(output)
    expect(output).not.toMatch(/electron-vite|Running \d+ tests?/)
  })
})

describe('CA5 (0068): con la decisión «ninguno», el plan está vacío', () => {
  it.each([[[]], [['-g', '(0070)']], [['--last-failed']], [['--no-build', '--grep', '(0070)']]])(
    '%j → sin comandos',
    (argv) => {
      const p = plan(NONE, options(argv), { outExists: true })
      expect(p.commands).toEqual([])
      expect(p.exit ?? 0).toBe(0)
    }
  )
})

describe('CA2 (0075): el plan de test:e2e:affected lanza solo el proyecto e2e', () => {
  it.each([
    ['some', SOME, []],
    ['all', ALL, []],
    ['some con --no-build y -g', SOME, ['--no-build', '-g', '(0070)']],
    ['all con --last-failed', ALL, ['--last-failed']]
  ] as const)(
    '%s → Playwright con --project=e2e y nunca con inestables',
    (_case, decision, argv) => {
      const last = plan(decision, options([...argv]), { outExists: true }).commands.at(-1)
      expect(last?.args.slice(0, 2)).toEqual(['playwright', 'test'])
      expect(last?.args).toContain('--project=e2e')
      expect(last?.args.filter((arg) => arg.startsWith('--project'))).toEqual(['--project=e2e'])
      expect(last?.args.join(' ')).not.toMatch(/inestables/)
    }
  )
})
