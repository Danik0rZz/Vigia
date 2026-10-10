import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, posix } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * Ficha 0069: el Dynatrace simulado, los fixtures, los ayudantes y los ganchos de las vistas viven
 * en un arnés común de `e2e/` (módulos que no acaban en `.spec.ts` ni `.test.ts`), y cada spec de
 * vistas los registra llamando a `setupViewsApp()` una sola vez, en el nivel superior.
 *
 * El arnés se encuentra sin suponer su nombre: es el módulo de `e2e/` que exporta `setupViewsApp`
 * y, si está en una subcarpeta de `e2e/` (por ejemplo `e2e/views/`), también los demás módulos de
 * esa carpeta (simulador, fixtures…). Un spec «de vistas» es el que importa alguno de ellos.
 *
 * Un spec de vistas falla la guarda si no llama a `setupViewsApp()`, si la llama más de una vez,
 * si la llama dentro de un `describe`, de un test o de cualquier otra función, o si lanza la app
 * por su cuenta (un `beforeAll` propio con `electron.launch`).
 */

const E2E_DIR = 'e2e'
const SETUP = 'setupViewsApp'

type Kind = 'sin-llamada' | 'varias-llamadas' | 'no-superior' | 'lanza-la-app'

interface Problem {
  kind: Kind
  /** Línea (desde 1) de la llamada o del `launch`; no aplica a `sin-llamada`. */
  line?: number
}

/** Nombres locales con los que el fichero importa `_electron` de Playwright. */
function electronAliases(source: ts.SourceFile): Set<string> {
  const names = new Set<string>()
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue
    if (statement.moduleSpecifier.text !== '@playwright/test') continue
    const bindings = statement.importClause?.namedBindings
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue
    for (const element of bindings.elements) {
      const imported = (element.propertyName ?? element.name).text
      if (imported === '_electron') names.add(element.name.text)
    }
  }
  return names
}

/** Especificadores de los `import` del fichero (también los de solo tipos). */
function importSpecifiers(source: ts.SourceFile): string[] {
  return source.statements
    .filter(ts.isImportDeclaration)
    .map((statement) => statement.moduleSpecifier)
    .filter(ts.isStringLiteral)
    .map((specifier) => specifier.text)
}

/** Nombres locales de `setupViewsApp` importada de un módulo del arnés. */
function setupAliases(source: ts.SourceFile, isHarness: (specifier: string) => boolean): string[] {
  const names: string[] = []
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue
    if (!isHarness(statement.moduleSpecifier.text)) continue
    const bindings = statement.importClause?.namedBindings
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue
    for (const element of bindings.elements) {
      if ((element.propertyName ?? element.name).text === SETUP) names.push(element.name.text)
    }
  }
  return names.length > 0 ? names : [SETUP]
}

/**
 * Comprueba un spec. Si no importa ningún módulo del arnés (`isHarness`), no es de vistas y no
 * hay nada que comprobar.
 */
function checkHarnessUse(code: string, isHarness: (specifier: string) => boolean): Problem[] {
  const source = ts.createSourceFile('spec.ts', code, ts.ScriptTarget.Latest, true)
  if (!importSpecifiers(source).some(isHarness)) return []
  const setups = new Set(setupAliases(source, isHarness))
  const electrons = electronAliases(source)
  const lineOf = (node: ts.Node): number =>
    source.getLineAndCharacterOfPosition(node.getStart()).line + 1

  const calls: ts.CallExpression[] = []
  const launches: ts.CallExpression[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      if (ts.isIdentifier(callee) && setups.has(callee.text)) calls.push(node)
      if (
        ts.isPropertyAccessExpression(callee) &&
        callee.name.text === 'launch' &&
        ts.isIdentifier(callee.expression) &&
        electrons.has(callee.expression.text)
      ) {
        launches.push(node)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)

  const problems: Problem[] = []
  if (calls.length === 0) problems.push({ kind: 'sin-llamada' })
  if (calls.length > 1) {
    for (const call of calls) problems.push({ kind: 'varias-llamadas', line: lineOf(call) })
  }
  for (const call of calls) {
    const statement = call.parent
    const topLevel =
      ts.isExpressionStatement(statement) &&
      statement.expression === call &&
      ts.isSourceFile(statement.parent)
    if (!topLevel) problems.push({ kind: 'no-superior', line: lineOf(call) })
  }
  for (const launch of launches) problems.push({ kind: 'lanza-la-app', line: lineOf(launch) })
  return problems
}

/** Ficheros `.ts` de `e2e/` (recursivo), con rutas posix relativas a la raíz del repositorio. */
function e2eFiles(dir = E2E_DIR): string[] {
  const files: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) files.push(...e2eFiles(path))
    else if (name.endsWith('.ts')) files.push(path.replace(/\\/g, '/'))
  }
  return files
}

const isTestFile = (file: string): boolean => /\.(spec|test)\.ts$/.test(file)

/** Si el módulo exporta `setupViewsApp` (función o constante). */
function exportsSetup(code: string): boolean {
  const source = ts.createSourceFile('m.ts', code, ts.ScriptTarget.Latest, true)
  const exported = (node: ts.Node): boolean =>
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === SETUP) {
      if (exported(statement)) return true
    }
    if (ts.isVariableStatement(statement) && exported(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.name.text === SETUP) return true
      }
    }
    if (ts.isExportDeclaration(statement) && statement.exportClause !== undefined) {
      if (ts.isNamedExports(statement.exportClause)) {
        if (statement.exportClause.elements.some((e) => e.name.text === SETUP)) return true
      }
    }
  }
  return false
}

/** Módulos del arnés de vistas en el repositorio (rutas posix desde la raíz). */
function harnessModules(): string[] {
  const modules = e2eFiles().filter((file) => !isTestFile(file))
  const setupFiles = modules.filter((file) => exportsSetup(readFileSync(file, 'utf8')))
  const result = new Set(setupFiles)
  for (const file of setupFiles) {
    const dir = posix.dirname(file)
    if (dir === E2E_DIR) continue
    for (const sibling of modules) if (posix.dirname(sibling) === dir) result.add(sibling)
  }
  return [...result].sort()
}

/** Resuelve un especificador relativo de `fromFile` a una ruta posix desde la raíz (o null). */
function resolveModule(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null
  const base = posix.normalize(posix.join(posix.dirname(fromFile), specifier))
  for (const candidate of [base, `${base}.ts`, `${base}/index.ts`]) {
    if (candidate.endsWith('.ts') && existsSync(candidate) && statSync(candidate).isFile()) {
      return candidate
    }
  }
  return null
}

describe('checkHarnessUse (la propia comprobación)', () => {
  const header = `import { _electron as electron, expect, test } from '@playwright/test'
import { setupViewsApp, state } from './views/harness'
`
  const isHarness = (specifier: string): boolean => specifier.startsWith('./views/')

  it('CA2 (0069): acepta un spec que llama a setupViewsApp() una vez, en el nivel superior', () => {
    const code = `${header}
setupViewsApp()

test('CA1 (0001): algo', { tag: '@problemas' }, async () => {
  await expect(state.page.getByText('x')).toBeVisible()
})
test.describe('grupo', () => {
  test.beforeAll(async () => {
    // Preparar datos sí está permitido: lo que no se permite es lanzar la app.
  })
})
`
    expect(checkHarnessUse(code, isHarness)).toEqual([])
  })

  it('CA2 (0069): acepta setupViewsApp importada con otro nombre', () => {
    const code = `import { test } from '@playwright/test'
import { setupViewsApp as setup } from './views/harness'
setup()
test('CA1 (0001): algo', { tag: '@problemas' }, async () => {})
`
    expect(checkHarnessUse(code, isHarness)).toEqual([])
  })

  it('CA2 (0069): ignora los specs que no importan el arnés', () => {
    const code = `import { _electron as electron, test } from '@playwright/test'
test.beforeAll(async () => {
  await electron.launch({ args: ['.'] })
})
test('CA1 (0001): algo', { tag: '@shell' }, async () => {})
`
    expect(checkHarnessUse(code, isHarness)).toEqual([])
  })

  it('CA2 (0069): falla si un spec que importa el arnés no llama a setupViewsApp()', () => {
    const code = `${header}
test('CA1 (0001): algo', { tag: '@problemas' }, async () => {})
`
    expect(checkHarnessUse(code, isHarness)).toEqual([{ kind: 'sin-llamada' }])
  })

  it('CA2 (0069): falla si solo importa otro módulo del arnés y no llama a setupViewsApp()', () => {
    const code = `import { test } from '@playwright/test'
import { problemFixture } from './views/fixtures'
test('CA1 (0001): algo', { tag: '@problemas' }, async () => {
  void problemFixture
})
`
    expect(checkHarnessUse(code, isHarness)).toEqual([{ kind: 'sin-llamada' }])
  })

  it('CA2 (0069): falla si la llama dos veces', () => {
    const code = `${header}
setupViewsApp()
setupViewsApp()
test('CA1 (0001): algo', { tag: '@problemas' }, async () => {})
`
    expect(checkHarnessUse(code, isHarness)).toEqual([
      { kind: 'varias-llamadas', line: 4 },
      { kind: 'varias-llamadas', line: 5 }
    ])
  })

  it('CA2 (0069): falla si la llama dentro de un describe', () => {
    const code = `${header}
test.describe('grupo', { tag: '@problemas' }, () => {
  setupViewsApp()
  test('CA1 (0001): algo', async () => {})
})
`
    expect(checkHarnessUse(code, isHarness)).toEqual([{ kind: 'no-superior', line: 5 }])
  })

  it('CA2 (0069): falla si la llama dentro de un test o de un gancho', () => {
    const inTest = `${header}
test('CA1 (0001): algo', { tag: '@problemas' }, async () => {
  setupViewsApp()
})
`
    expect(checkHarnessUse(inTest, isHarness)).toEqual([{ kind: 'no-superior', line: 5 }])
    const inHook = `${header}
test.beforeAll(() => {
  setupViewsApp()
})
test('CA1 (0001): algo', { tag: '@problemas' }, async () => {})
`
    expect(checkHarnessUse(inHook, isHarness)).toEqual([{ kind: 'no-superior', line: 5 }])
  })

  it('CA2 (0069): falla si la llamada no es una sentencia propia del nivel superior', () => {
    const code = `${header}
if (process.env.CI) setupViewsApp()
test('CA1 (0001): algo', { tag: '@problemas' }, async () => {})
`
    expect(checkHarnessUse(code, isHarness)).toEqual([{ kind: 'no-superior', line: 4 }])
  })

  it('CA2 (0069): falla si un spec de vistas lanza la app con su propio beforeAll', () => {
    const code = `${header}
setupViewsApp()
test.beforeAll(async () => {
  const app = await electron.launch({ args: ['.'] })
  void app
})
test('CA1 (0001): algo', { tag: '@problemas' }, async () => {})
`
    expect(checkHarnessUse(code, isHarness)).toEqual([{ kind: 'lanza-la-app', line: 6 }])
  })
})

describe('arnés de vistas en el repositorio', () => {
  const harness = harnessModules()
  const specs = readdirSync(E2E_DIR)
    .filter((name) => name.endsWith('.spec.ts'))
    .map((name) => `${E2E_DIR}/${name}`)
  const isHarnessFrom =
    (spec: string) =>
    (specifier: string): boolean => {
      const resolved = resolveModule(spec, specifier)
      return resolved !== null && harness.includes(resolved)
    }

  it('CA2 (0069): hay un módulo de e2e/, que no es un spec ni un test, que exporta setupViewsApp', () => {
    const withSetup = harness.filter((file) => exportsSetup(readFileSync(file, 'utf8')))
    expect(withSetup, 'módulos que exportan setupViewsApp').toHaveLength(1)
    for (const file of harness) expect(isTestFile(file), file).toBe(false)
  })

  it('CA2 (0069): views.spec.ts importa el arnés', () => {
    const spec = `${E2E_DIR}/views.spec.ts`
    const source = ts.createSourceFile(
      spec,
      readFileSync(spec, 'utf8'),
      ts.ScriptTarget.Latest,
      true
    )
    expect(importSpecifiers(source).some(isHarnessFrom(spec))).toBe(true)
  })

  it.each(specs)('CA2 (0069): %s usa el arnés como se espera (si lo importa)', (spec) => {
    expect(checkHarnessUse(readFileSync(spec, 'utf8'), isHarnessFrom(spec))).toEqual([])
  })

  it('CA2 (0069): el arnés lanza la app y llama a useCiWindow justo después', () => {
    const launching = harness.filter((file) => /\.launch\(/.test(readFileSync(file, 'utf8')))
    expect(launching, 'módulos del arnés que lanzan la app').toHaveLength(1)
    const code = readFileSync(launching[0] as string, 'utf8')
    expect(code).toMatch(/\.launch\([\s\S]*?\)\s*\n\s*await useCiWindow\(/)
  })

  it('CA2 (0069): cambiar un módulo del arnés lanza los specs de vistas (e2e/areas.json)', () => {
    const require = createRequire(import.meta.url)
    const { decide } = require(join(__dirname, 'affected-e2e.cjs')) as {
      decide: (
        files: string[],
        config: unknown
      ) => { mode: 'all' | 'some' | 'none'; specs: string[]; reasons: string[] }
    }
    const config = JSON.parse(readFileSync(join(E2E_DIR, 'areas.json'), 'utf8')) as {
      areas: Record<string, { globs: string[]; specs: string[] }>
    }
    expect(harness.length).toBeGreaterThan(0)
    const views = config.areas.views
    expect(views, 'área views').toBeDefined()
    for (const file of harness) {
      expect(
        views?.globs.some((glob) => posix.matchesGlob(file, glob)),
        `${file} en los globs de views`
      ).toBe(true)
      const decision = decide([file], config)
      expect(decision.mode, file).toBe('some')
      expect(decision.specs, file).toContain(`${E2E_DIR}/views.spec.ts`)
    }
  })
})
