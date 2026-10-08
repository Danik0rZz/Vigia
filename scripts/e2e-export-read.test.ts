import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * Ficha 0030: una exportación se lee con `exportSaved` (espera al aviso «Guardado» y a que el
 * fichero tenga contenido), nunca con lo que devuelve `exportTo`: el nombre aparece en la carpeta
 * en cuanto main empieza a escribirlo, y leerlo entonces da un fichero vacío o a medias.
 *
 * Se marca un `readFileSync` cuyo primer argumento es `await exportTo(...)` o una variable que se
 * inicializó con `await exportTo(...)` (la declaración más cercana con ese nombre, por bloques).
 * También la espera copiada a mano: un `readFileSync` cuyo argumento usa `exportDir` (por ejemplo,
 * `join(exportDir, created)`) o llama a una función propia del spec que busca en `exportDir` (como
 * `exportTo`), salvo `exportSaved`, o una variable declarada con esa llamada.
 */

const E2E_DIR = 'e2e'

/** Quita paréntesis y conversiones de tipo (`as`, `!`) alrededor de una expresión. */
function unwrap(node: ts.Expression): ts.Expression {
  let current = node
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression
  }
  return current
}

/** La función que lee una exportación esperando al aviso y al contenido. */
const SAVED_HELPER = 'exportSaved'

/** Si en `node` aparece el identificador `exportDir` (la carpeta de exportación del spec). */
function usesExportDir(node: ts.Node): boolean {
  if (ts.isIdentifier(node) && node.text === 'exportDir') return true
  return ts.forEachChild(node, usesExportDir) === true
}

/**
 * Nombres de las funciones del fichero (declaradas o `const f = async () => …`) que buscan en
 * `exportDir`, salvo `exportSaved`: `exportTo` y sus copias a mano.
 */
function exportDirHelpers(source: ts.SourceFile): Set<string> {
  const names = new Set<string>(['exportTo'])
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name !== undefined && usesExportDir(node)) {
      names.add(node.name.text)
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) &&
      usesExportDir(node.initializer)
    ) {
      names.add(node.name.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  names.delete(SAVED_HELPER)
  return names
}

/** Si `node` es `await f(...)` (o `f(...)` sin await) con `f` en `helpers`. */
function isHelperCall(node: ts.Expression, helpers: Set<string>): boolean {
  let current = unwrap(node)
  if (ts.isAwaitExpression(current)) current = unwrap(current.expression)
  return (
    ts.isCallExpression(current) &&
    ts.isIdentifier(current.expression) &&
    helpers.has(current.expression.text)
  )
}

/**
 * Si la variable `name`, vista desde `node`, se declaró con `exportTo(...)`: busca la declaración
 * en las sentencias de cada bloque que la contiene, del más cercano al fichero.
 */
function comesFromHelper(node: ts.Node, name: string, helpers: Set<string>): boolean {
  for (let current = node.parent; current !== undefined; current = current.parent) {
    if (!ts.isBlock(current) && !ts.isSourceFile(current)) continue
    for (const statement of current.statements) {
      if (!ts.isVariableStatement(statement)) continue
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || declaration.name.text !== name) continue
        return (
          declaration.initializer !== undefined && isHelperCall(declaration.initializer, helpers)
        )
      }
    }
  }
  return false
}

/** Líneas (desde 1) de cada `readFileSync` que lee el resultado de `exportTo(...)`. */
function exportToReads(code: string, fileName = 'spec.ts'): number[] {
  const source = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true)
  const helpers = exportDirHelpers(source)
  const lines: number[] = []
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'readFileSync' &&
      node.arguments[0] !== undefined
    ) {
      const arg = unwrap(node.arguments[0])
      if (
        isHelperCall(arg, helpers) ||
        (ts.isIdentifier(arg) && comesFromHelper(node, arg.text, helpers)) ||
        usesExportDir(arg)
      ) {
        lines.push(source.getLineAndCharacterOfPosition(node.getStart()).line + 1)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return lines
}

describe('exportToReads (la propia comprobación)', () => {
  it('CA2 (0030): marca readFileSync de await exportTo(...), directo o con as', () => {
    const code = `const csv = readFileSync(await exportTo('t', 'export-csv'))
await book.xlsx.load(
  readFileSync(await exportTo('t', 'export-xlsx')) as unknown as ArrayBuffer
)`
    expect(exportToReads(code)).toEqual([1, 3])
  })

  it('CA2 (0030): marca readFileSync de una variable que viene de exportTo', () => {
    const code = `const file = await exportTo('t', 'export-csv')
expect(file).toMatch(/csv$/)
const buffer = readFileSync(file)`
    expect(exportToReads(code)).toEqual([3])
  })

  it('CA2 (0030): una variable con el mismo nombre en otro test no cuenta', () => {
    const code = `test('a', async () => {
  const file = await exportTo('t', 'capture-save')
})
test('b', async () => {
  const file = await exportSaved('t', 'export-xlsx')
  readFileSync(file)
})
test('c', async () => {
  const file = await exportTo('t', 'export-csv')
  readFileSync(file)
})`
    expect(exportToReads(code)).toEqual([10])
  })

  it('CA2 (0030): marca la espera copiada a mano: join(exportDir, …) y una función propia', () => {
    const inline = `const before = new Set(readdirSync(exportDir))
let created = ''
await book.xlsx.load(readFileSync(join(exportDir, created)) as unknown as ArrayBuffer)`
    expect(exportToReads(inline)).toEqual([3])
    const helper = `test('a', async () => {
  const save = async (option: string): Promise<string> => {
    const before = new Set(readdirSync(exportDir))
    return join(exportDir, option)
  }
  const csv = readFileSync(await save('export-csv'))
  const file = await save('export-xlsx')
  readFileSync(file)
})`
    expect(exportToReads(helper)).toEqual([6, 8])
  })

  it('CA2 (0030): exportSaved puede usar exportDir y no cuenta como copia', () => {
    const code = `async function exportSaved(target: string): Promise<string> {
  return join(exportDir, target)
}
const csv = readFileSync(await exportSaved('t'))`
    expect(exportToReads(code)).toEqual([])
  })

  it('CA2 (0030): acepta exportSaved y otras lecturas', () => {
    const code = `const file = await exportSaved('t', 'export-csv')
const buffer = readFileSync(file)
const xlsx = readFileSync(await exportSaved('t', 'export-xlsx'))
const log = readFileSync(logFile, 'utf8')
const png = await exportTo('t', 'capture-save')`
    expect(exportToReads(code)).toEqual([])
  })
})

describe('specs de e2e', () => {
  const specs = readdirSync(E2E_DIR).filter((name) => name.endsWith('.spec.ts'))

  it.each(specs)(
    'CA2 (0030): %s lee las exportaciones con exportSaved, no con exportTo',
    (name) => {
      const lines = exportToReads(readFileSync(join(E2E_DIR, name), 'utf8'), name)
      expect(lines, 'readFileSync de una exportación sin exportSaved (líneas)').toEqual([])
    }
  )
})
