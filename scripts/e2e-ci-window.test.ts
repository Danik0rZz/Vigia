import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * Ficha 0021: todos los e2e corren con el contenido de la ventana del CI (1024×720). Cada spec,
 * nada más arrancar la app, llama a `useCiWindow` (e2e/window-size.ts): la sentencia siguiente a
 * la que lanza Electron tiene que ser `await useCiWindow(...)`. Si la app se lanza dentro de una
 * función propia del spec (el lanzador común de tenants), la regla se aplica dentro de ella.
 *
 * Ficha 0069: la app también se lanza desde módulos de `e2e/` que no son specs (el arnés de vistas,
 * `e2e/views/harness.ts`, la lanza para `views.spec.ts`), así que se miran todos los `.ts` de
 * `e2e/`, también los de sus subcarpetas.
 */

const E2E_DIR = 'e2e'

/**
 * Ficheros de `e2e/` que arrancan la app hoy (rutas desde `e2e/`): si alguno deja de hacerlo o
 * aparece otro, este test se revisa. Los specs de vistas la arrancan a través del arnés.
 */
const LAUNCHING_FILES = [
  'errors.spec.ts',
  'shell.spec.ts',
  'smoke.spec.ts',
  'tenants.spec.ts',
  'tls.spec.ts',
  'views/harness.ts'
]

/** Ficheros `.ts` de `e2e/` (recursivo), con rutas posix desde `e2e/`. */
function e2eFiles(dir = ''): string[] {
  const files: string[] = []
  for (const name of readdirSync(join(E2E_DIR, dir))) {
    const relative = dir === '' ? name : `${dir}/${name}`
    if (statSync(join(E2E_DIR, relative)).isDirectory()) files.push(...e2eFiles(relative))
    else if (name.endsWith('.ts')) files.push(relative)
  }
  return files
}

interface LaunchCheck {
  /** Línea (desde 1) de cada `launch` de Electron. */
  launches: number[]
  /** Líneas de los `launch` a los que no sigue `await useCiWindow(...)`. */
  missing: number[]
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

/** Si `statement` es exactamente `await useCiWindow(...)`. */
function isUseCiWindow(statement: ts.Statement | undefined): boolean {
  if (statement === undefined || !ts.isExpressionStatement(statement)) return false
  const expression = statement.expression
  if (!ts.isAwaitExpression(expression)) return false
  const call = expression.expression
  return (
    ts.isCallExpression(call) &&
    ts.isIdentifier(call.expression) &&
    call.expression.text === 'useCiWindow'
  )
}

/** La sentencia que contiene `node` dentro de una lista de sentencias (bloque o fichero). */
function enclosingStatement(node: ts.Node): ts.Statement | undefined {
  let current: ts.Node = node
  while (current.parent !== undefined) {
    const parent = current.parent
    if (ts.isBlock(parent) || ts.isSourceFile(parent)) return current as ts.Statement
    current = parent
  }
  return undefined
}

/** Comprueba que a cada `launch` de Electron le sigue `await useCiWindow(...)`. */
function checkCiWindow(code: string, fileName = 'spec.ts'): LaunchCheck {
  const source = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true)
  const aliases = electronAliases(source)
  const result: LaunchCheck = { launches: [], missing: [] }
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'launch' &&
      ts.isIdentifier(node.expression.expression) &&
      aliases.has(node.expression.expression.text)
    ) {
      const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1
      result.launches.push(line)
      const statement = enclosingStatement(node)
      const list = statement?.parent as ts.Block | ts.SourceFile | undefined
      const index =
        statement === undefined || list === undefined ? -1 : list.statements.indexOf(statement)
      if (index < 0 || !isUseCiWindow(list?.statements[index + 1])) result.missing.push(line)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return result
}

describe('checkCiWindow (la propia comprobación)', () => {
  const header = "import { _electron as electron, test } from '@playwright/test'\n"

  it('CA1 (0021): acepta el launch seguido de await useCiWindow', () => {
    const code = `${header}test.beforeAll(async () => {
  app = await electron.launch({ args: ['.'] })
  await useCiWindow(app)
  page = await app.firstWindow()
})`
    expect(checkCiWindow(code)).toEqual({ launches: [3], missing: [] })
  })

  it('CA1 (0021): rechaza el launch sin useCiWindow o con algo en medio', () => {
    const without = `${header}async function launch() {
  app = await electron.launch({ args: ['.'] })
  page = await app.firstWindow()
}`
    expect(checkCiWindow(without).missing).toEqual([3])
    const between = `${header}async function launch() {
  app = await electron.launch({ args: ['.'] })
  page = await app.firstWindow()
  await useCiWindow(app)
}`
    expect(checkCiWindow(between).missing).toEqual([3])
    const notAwaited = `${header}async function launch() {
  app = await electron.launch({ args: ['.'] })
  void useCiWindow(app)
}`
    expect(checkCiWindow(notAwaited).missing).toEqual([3])
  })

  it('CA1 (0021): reconoce _electron sin alias y no confunde otros launch', () => {
    const code = `import { _electron } from '@playwright/test'
const app = await _electron.launch({})
const other = await browser.launch({})`
    expect(checkCiWindow(code)).toEqual({ launches: [2], missing: [2] })
  })
})

describe('specs de e2e', () => {
  const files = e2eFiles()

  it('CA1 (0021): los ficheros de e2e/ que arrancan la app son los conocidos', () => {
    const launching = files.filter(
      (name) => checkCiWindow(readFileSync(join(E2E_DIR, name), 'utf8'), name).launches.length > 0
    )
    expect(launching.sort()).toEqual([...LAUNCHING_FILES].sort())
  })

  it.each(files)('CA1 (0021): %s llama a useCiWindow justo después de arrancar la app', (name) => {
    const { missing } = checkCiWindow(readFileSync(join(E2E_DIR, name), 'utf8'), name)
    expect(missing, `launch sin useCiWindow justo después (líneas)`).toEqual([])
  })
})
