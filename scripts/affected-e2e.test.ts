import { existsSync, readFileSync } from 'node:fs'
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
const { decide } = require(join(__dirname, 'affected-e2e.cjs')) as {
  decide: (files: string[], config: Config) => Decision
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

describe.skipIf(!existsSync(AREAS))('e2e/areas.json real', () => {
  const real = JSON.parse(existsSync(AREAS) ? readFileSync(AREAS, 'utf8') : '{}') as Config
  const specsFor = (file: string): Decision => decide([file], real)

  it('todo spec de e2e/ está en algún área o en always', () => {
    const declared = new Set([...real.always, ...Object.values(real.areas).flatMap((a) => a.specs)])
    for (const spec of ['shell', 'smoke', 'tenants', 'tls', 'views']) {
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
    ['src/main/dynatrace/client.ts', 'e2e/views.spec.ts'],
    ['src/renderer/src/settings/ConnectionPanel.tsx', 'e2e/tls.spec.ts'],
    ['src/renderer/src/pages/ProblemsPage.tsx', 'e2e/views.spec.ts'],
    ['src/renderer/src/components/ProblemsTable.tsx', 'e2e/views.spec.ts'],
    ['src/main/export/csv.ts', 'e2e/views.spec.ts'],
    ['src/main/ipc/handlers/modules.ts', 'e2e/views.spec.ts'],
    ['src/shared/problem-row.ts', 'e2e/views.spec.ts'],
    ['src/renderer/src/components/Sidebar.tsx', 'e2e/shell.spec.ts'],
    ['src/renderer/src/components/TopBar.tsx', 'e2e/shell.spec.ts'],
    ['src/renderer/src/components/TopBar.tsx', 'e2e/views.spec.ts'],
    ['src/renderer/src/app/problem-filters.ts', 'e2e/views.spec.ts'],
    ['src/renderer/src/app/page-crumb.ts', 'e2e/views.spec.ts'],
    ['src/shared/problem-sort.ts', 'e2e/views.spec.ts']
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
  it('DataGrid, grid-sort, problem-evidence y event-metric → some con views y smoke', () => {
    const d = decide(
      [
        'src/renderer/src/components/DataGrid.tsx',
        'src/shared/grid-sort.ts',
        'src/shared/problem-evidence.ts',
        'src/shared/event-metric.ts'
      ],
      real
    )
    expect(d).toMatchObject({ mode: 'some', specs: [SMOKE, 'e2e/views.spec.ts'].sort() })
  })

  // Los locales los cubre el test de paridad y main.css el de contraste (los dos
  // en check): solos, disparan shell; con un fichero de un módulo, también el suyo.
  it.each(['src/renderer/src/locales/es/common.json', 'src/renderer/src/assets/main.css'])(
    '%s solo → some con shell y smoke, nada más',
    (file) => {
      const d = specsFor(file)
      expect(d.mode).toBe('some')
      expect(d.specs).toEqual([SMOKE, 'e2e/shell.spec.ts'].sort())
    }
  )

  it('locales junto a una página de un módulo → shell y el spec de ese módulo', () => {
    const d = decide(
      ['src/renderer/src/locales/en/common.json', 'src/renderer/src/pages/ProblemsPage.tsx'],
      real
    )
    expect(d.mode).toBe('some')
    expect(d.specs).toEqual([SMOKE, 'e2e/shell.spec.ts', 'e2e/views.spec.ts'].sort())
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
