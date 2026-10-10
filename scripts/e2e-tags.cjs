'use strict'
/**
 * Etiquetas de zona de los e2e (ficha 0067). Cada test de `e2e/*.spec.ts` lleva exactamente una
 * zona de `zones` (`e2e/areas.json`), propia o heredada de su `test.describe`; solo etiquetas de
 * `zones` o de `resourceTags`; y `@portapapeles` si usa el portapapeles del sistema. Una zona de
 * la lista que no tiene ningún test también es un fallo (zona muerta).
 *
 * `checkTags` es pura: recibe el texto de los specs y la config y devuelve los problemas, sin
 * ejecutar nada. Lee los specs con el compilador de TypeScript, porque los títulos llevan
 * comillas y paréntesis. La usa `scripts/e2e-tags.test.ts` (dentro de `npm run check`).
 */
const ts = require('typescript')

const CLIPBOARD_TAG = '@portapapeles'
/** Métodos de `test` que declaran un test: `test(...)`, `test.skip(...)`, etc. */
const TEST_MODIFIERS = new Set(['only', 'skip', 'fixme', 'fail', 'slow'])
/** Métodos de `test.describe` que declaran un grupo (no `configure`). */
const DESCRIBE_MODIFIERS = new Set(['only', 'skip', 'fixme', 'serial', 'parallel'])

/**
 * Qué declara una llamada: un test, un describe o nada. Solo cuenta si su primer argumento es un
 * título (texto) y el último, una función: así `test.skip(condición)` dentro de un test no cuenta.
 * @param {ts.CallExpression} call
 * @returns {'test' | 'describe' | null}
 */
function callKind(call) {
  const args = call.arguments
  if (args.length < 2) return null
  if (!isTitle(args[0])) return null
  const last = args[args.length - 1]
  if (!ts.isArrowFunction(last) && !ts.isFunctionExpression(last)) return null
  const chain = calleeChain(call.expression)
  if (chain === null || chain[0] !== 'test') return null
  if (chain.length === 1) return 'test'
  if (chain.length === 2 && TEST_MODIFIERS.has(chain[1])) return 'test'
  if (chain[1] !== 'describe') return null
  if (chain.length === 2) return 'describe'
  if (chain.length === 3 && DESCRIBE_MODIFIERS.has(chain[2])) return 'describe'
  return null
}

/** `test.describe.serial` → `['test', 'describe', 'serial']`; otra cosa → null. */
function calleeChain(expression) {
  if (ts.isIdentifier(expression)) return [expression.text]
  if (ts.isPropertyAccessExpression(expression)) {
    const left = calleeChain(expression.expression)
    return left === null ? null : [...left, expression.name.text]
  }
  return null
}

function isTitle(node) {
  return (
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isTemplateExpression(node)
  )
}

/** El título tal cual: el texto del literal, o la plantilla entera (sin las comillas) si lleva `${}`. */
function titleText(node, source) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  return node.getText(source).slice(1, -1)
}

/** Etiquetas de la opción `tag` (texto o lista de textos) del segundo argumento, si es un objeto. */
function ownTags(call) {
  if (call.arguments.length < 3) return []
  const options = call.arguments[1]
  if (!ts.isObjectLiteralExpression(options)) return []
  const tags = []
  for (const property of options.properties) {
    if (!ts.isPropertyAssignment(property)) continue
    const name = property.name
    if (!(ts.isIdentifier(name) || ts.isStringLiteral(name)) || name.text !== 'tag') continue
    const value = property.initializer
    if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value))
      tags.push(value.text)
    if (ts.isArrayLiteralExpression(value)) {
      for (const element of value.elements) {
        if (ts.isStringLiteral(element) || ts.isNoSubstitutionTemplateLiteral(element)) {
          tags.push(element.text)
        }
      }
    }
  }
  return tags
}

/**
 * Cómo se detecta el portapapeles: un identificador o una propiedad llamada `clipboard` (el
 * `({ clipboard })` de `app.evaluate`, o `navigator.clipboard`), en el cuerpo del test o en una
 * función del propio spec que el test llame (directa o indirectamente, como `clipboardText`).
 * Las funciones son las de nivel superior del spec: `function f()` y `const f = () => …`. No mira
 * los hooks (`beforeAll`, `afterAll`…): guardar y restaurar el portapapeles no es un test.
 */
function mentionsClipboard(node) {
  let found = false
  const visit = (child) => {
    if (found) return
    if (ts.isIdentifier(child) && child.text === 'clipboard') {
      found = true
      return
    }
    ts.forEachChild(child, visit)
  }
  visit(node)
  return found
}

/** Identificadores que aparecen dentro de `node`. */
function identifiersIn(node) {
  const names = new Set()
  const visit = (child) => {
    if (ts.isIdentifier(child)) names.add(child.text)
    ts.forEachChild(child, visit)
  }
  visit(node)
  return names
}

/** Funciones de nivel superior del spec: nombre → nodo de su cuerpo. */
function topLevelFunctions(source) {
  const functions = new Map()
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name && statement.body) {
      functions.set(statement.name.text, statement.body)
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const init = declaration.initializer
        if (
          ts.isIdentifier(declaration.name) &&
          init !== undefined &&
          (ts.isArrowFunction(init) || ts.isFunctionExpression(init))
        ) {
          functions.set(declaration.name.text, init.body)
        }
      }
    }
  }
  return functions
}

/** Nombres de las funciones del spec que usan el portapapeles, también a través de otras. */
function clipboardFunctions(source) {
  const functions = topLevelFunctions(source)
  const calls = new Map()
  const using = new Set()
  for (const [name, body] of functions) {
    calls.set(name, identifiersIn(body))
    if (mentionsClipboard(body)) using.add(name)
  }
  let changed = true
  while (changed) {
    changed = false
    for (const [name, names] of calls) {
      if (using.has(name)) continue
      if ([...names].some((other) => using.has(other))) {
        using.add(name)
        changed = true
      }
    }
  }
  return using
}

function usesClipboard(body, helpers) {
  if (mentionsClipboard(body)) return true
  for (const name of identifiersIn(body)) if (helpers.has(name)) return true
  return false
}

/**
 * @param {{ file: string, code: string }[]} specs
 * @param {{ zones: Record<string, string>, resourceTags: Record<string, string> }} config
 * @returns {{ kind: 'sin-zona' | 'dos-zonas' | 'desconocida' | 'portapapeles' | 'zona-muerta',
 *   file?: string, test?: string, tag?: string, message: string }[]}
 */
function checkTags(specs, config) {
  if (config === null || typeof config !== 'object' || typeof config.zones !== 'object') {
    throw new TypeError('checkTags necesita zones y resourceTags de e2e/areas.json')
  }
  const zones = new Set(Object.keys(config.zones ?? {}))
  const resources = new Set(Object.keys(config.resourceTags ?? {}))
  const used = new Set()
  const problems = []

  for (const { file, code } of specs) {
    const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    const helpers = clipboardFunctions(source)

    /** @param {string[]} inherited etiquetas de los describe que lo contienen */
    const visit = (node, inherited) => {
      if (ts.isCallExpression(node)) {
        const kind = callKind(node)
        if (kind !== null) {
          const title = titleText(node.arguments[0], source)
          const own = ownTags(node)
          const where = kind === 'describe' ? `el describe «${title}»` : `el test «${title}»`
          // Las desconocidas se dicen una vez, donde están escritas.
          for (const tag of own) {
            if (zones.has(tag) || resources.has(tag)) continue
            problems.push({
              kind: 'desconocida',
              file,
              test: title,
              tag,
              message: `${file}: ${where} usa la etiqueta ${tag}, que no está en zones ni en resourceTags de e2e/areas.json`
            })
          }
          const tags = [...new Set([...inherited, ...own])]
          const body = node.arguments[node.arguments.length - 1]
          if (kind === 'describe') {
            ts.forEachChild(body, (child) => visit(child, tags))
            return
          }
          const testZones = tags.filter((tag) => zones.has(tag))
          for (const zone of testZones) used.add(zone)
          if (testZones.length === 0) {
            problems.push({
              kind: 'sin-zona',
              file,
              test: title,
              message: `${file}: ${where} no tiene zona (ni propia ni de su describe)`
            })
          } else if (testZones.length > 1) {
            problems.push({
              kind: 'dos-zonas',
              file,
              test: title,
              message: `${file}: ${where} tiene más de una zona: ${testZones.join(', ')}`
            })
          }
          if (!tags.includes(CLIPBOARD_TAG) && usesClipboard(body, helpers)) {
            problems.push({
              kind: 'portapapeles',
              file,
              test: title,
              message: `${file}: ${where} usa el portapapeles y no lleva ${CLIPBOARD_TAG}`
            })
          }
          return
        }
      }
      ts.forEachChild(node, (child) => visit(child, inherited))
    }
    visit(source, [])
  }

  for (const zone of zones) {
    if (used.has(zone)) continue
    problems.push({
      kind: 'zona-muerta',
      tag: zone,
      message: `la zona ${zone} de e2e/areas.json no tiene ningún test`
    })
  }
  return problems
}

module.exports = { checkTags }
