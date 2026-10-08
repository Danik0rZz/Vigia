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

/** Si `node` es `await exportTo(...)` (o `exportTo(...)` sin await). */
function isExportToCall(node: ts.Expression): boolean {
  let current = unwrap(node)
  if (ts.isAwaitExpression(current)) current = unwrap(current.expression)
  return (
    ts.isCallExpression(current) &&
    ts.isIdentifier(current.expression) &&
    current.expression.text === 'exportTo'
  )
}

/**
 * Si la variable `name`, vista desde `node`, se declaró con `exportTo(...)`: busca la declaración
 * en las sentencias de cada bloque que la contiene, del más cercano al fichero.
 */
function comesFromExportTo(node: ts.Node, name: string): boolean {
  for (let current = node.parent; current !== undefined; current = current.parent) {
    if (!ts.isBlock(current) && !ts.isSourceFile(current)) continue
    for (const statement of current.statements) {
      if (!ts.isVariableStatement(statement)) continue
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || declaration.name.text !== name) continue
        return declaration.initializer !== undefined && isExportToCall(declaration.initializer)
      }
    }
  }
  return false
}

/** Líneas (desde 1) de cada `readFileSync` que lee el resultado de `exportTo(...)`. */
function exportToReads(code: string, fileName = 'spec.ts'): number[] {
  const source = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true)
  const lines: number[] = []
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'readFileSync' &&
      node.arguments[0] !== undefined
    ) {
      const arg = unwrap(node.arguments[0])
      if (isExportToCall(arg) || (ts.isIdentifier(arg) && comesFromExportTo(node, arg.text))) {
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
      expect(lines, 'readFileSync del resultado de exportTo (líneas)').toEqual([])
    }
  )
})
