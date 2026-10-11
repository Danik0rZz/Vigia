'use strict'
/**
 * Etiquetas de zona de los e2e (ficha 0067). Cada test de `e2e/*.spec.ts` lleva exactamente una
 * zona de `zones` (`e2e/areas.json`), propia o heredada de su `test.describe`; solo etiquetas de
 * `zones` o de `resourceTags`; y `@portapapeles` si usa el portapapeles del sistema. Una zona de
 * la lista que no tiene ningún test también es un fallo (zona muerta).
 *
 * Ficha 0075: un test con `@inestable` (en cuarentena) lleva una anotación de Playwright de tipo
 * `arreglo` con el número de su ficha de arreglo en `description` (propia o de su describe); esa
 * ficha (`tasks/NNNN-*.md`) existe y no está `hecha` (si lo está, la etiqueta sobra).
 *
 * `checkTags` es pura: recibe el texto de los specs y la config y devuelve los problemas, sin
 * ejecutar nada. Lee los specs con el compilador de TypeScript, porque los títulos llevan
 * comillas y paréntesis. La usa `scripts/e2e-tags.test.ts` (dentro de `npm run check`).
 */
const ts = require('typescript')

const CLIPBOARD_TAG = '@portapapeles'
const QUARANTINE_TAG = '@inestable'
/** Tipo de la anotación que dice qué ficha arregla un test en cuarentena. */
const FIX_ANNOTATION = 'arreglo'
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

/** El valor de la opción `key` del segundo argumento (el objeto de opciones), si lo hay. */
function optionValue(call, key) {
  if (call.arguments.length < 3) return undefined
  const options = call.arguments[1]
  if (!ts.isObjectLiteralExpression(options)) return undefined
  for (const property of options.properties) {
    if (!ts.isPropertyAssignment(property)) continue
    const name = property.name
    if ((ts.isIdentifier(name) || ts.isStringLiteral(name)) && name.text === key) {
      return property.initializer
    }
  }
  return undefined
}

/** Texto de un literal sin sustituciones; si no lo es, undefined. */
function literalText(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  return undefined
}

/**
 * Anotaciones de la opción `annotation` (un objeto o una lista de objetos), como
 * `{ type, description }`; solo las escritas con literales.
 */
function ownAnnotations(call) {
  const value = optionValue(call, 'annotation')
  if (value === undefined) return []
  const objects = ts.isArrayLiteralExpression(value) ? [...value.elements] : [value]
  const annotations = []
  for (const object of objects) {
    if (!ts.isObjectLiteralExpression(object)) continue
    const annotation = {}
    for (const property of object.properties) {
      if (!ts.isPropertyAssignment(property)) continue
      const name = property.name
      if (!(ts.isIdentifier(name) || ts.isStringLiteral(name))) continue
      const text = literalText(property.initializer)
      if (text !== undefined && (name.text === 'type' || name.text === 'description')) {
        annotation[name.text] = text
      }
    }
    annotations.push(annotation)
  }
  return annotations
}

/**
 * Estado de cada ficha, por su número: el `estado:` de la cabecera de `tasks/NNNN-*.md`.
 * @param {{ file: string, code: string }[]} tasks
 * @returns {Map<string, string>}
 */
function taskStates(tasks) {
  const states = new Map()
  for (const { file, code } of tasks) {
    const id = /(?:^|[\\/])(\d{4})-[^\\/]*\.md$/.exec(file)?.[1]
    if (id === undefined) continue
    const header = /^---\r?\n([\s\S]*?)\r?\n---/.exec(code)?.[1] ?? ''
    const state = /^estado:\s*['"]?([\w-]+)/m.exec(header)?.[1] ?? ''
    states.set(id, state)
  }
  return states
}

/** Etiquetas de la opción `tag` (texto o lista de textos) del segundo argumento, si es un objeto. */
function ownTags(call) {
  const value = optionValue(call, 'tag')
  const tags = []
  if (value !== undefined) {
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
 *
 * Ficha 0069: también cuentan las funciones de los módulos de `e2e/` que no son specs (el arnés de
 * vistas, `e2e/views/`) y que el spec importa: `checkTags` las recibe en `modules`.
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

/**
 * Nombres de las funciones de `sources` que usan el portapapeles, también a través de otras de
 * ellas o de `seed` (las de los módulos que importa el spec).
 */
function clipboardFunctions(sources, seed = new Set()) {
  const functions = new Map()
  for (const source of sources)
    for (const [name, body] of topLevelFunctions(source)) functions.set(name, body)
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
      if ([...names].some((other) => using.has(other) || seed.has(other))) {
        using.add(name)
        changed = true
      }
    }
  }
  return using
}

/**
 * Nombres locales con los que el spec importa funciones de `imported` (nombre exportado): las del
 * arnés que usan el portapapeles, con el alias que les dé el spec.
 */
function importedNames(source, imported) {
  const names = new Set()
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue
    const bindings = statement.importClause?.namedBindings
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue
    for (const element of bindings.elements) {
      if (imported.has((element.propertyName ?? element.name).text)) names.add(element.name.text)
    }
  }
  return names
}

function usesClipboard(body, helpers) {
  if (mentionsClipboard(body)) return true
  for (const name of identifiersIn(body)) if (helpers.has(name)) return true
  return false
}

/**
 * Qué le falta a un test en cuarentena, o null si está bien: la anotación `arreglo` con su ficha,
 * que la ficha exista y que no esté `hecha`.
 * @param {Map<string, string>} states estado de cada ficha, por su número
 * @param {{ type?: string, description?: string }[]} annotations las del test y sus describe
 * @returns {{ kind: 'sin-arreglo' | 'ficha-inexistente' | 'ficha-hecha', text: string } | null}
 */
function quarantineProblem(states, annotations) {
  const fix = annotations.find((annotation) => annotation.type === FIX_ANNOTATION)
  const id = fix?.description?.trim()
  if (id === undefined || id === '') {
    return {
      kind: 'sin-arreglo',
      text: `lleva ${QUARANTINE_TAG} sin la anotación ${FIX_ANNOTATION} con el número de su ficha de arreglo`
    }
  }
  if (!states.has(id)) {
    return {
      kind: 'ficha-inexistente',
      text: `lleva ${QUARANTINE_TAG} y su ficha de arreglo ${id} no existe en tasks/`
    }
  }
  if (states.get(id) === 'hecha') {
    return {
      kind: 'ficha-hecha',
      text: `lleva ${QUARANTINE_TAG} y su ficha de arreglo ${id} ya está hecha: quita la etiqueta`
    }
  }
  return null
}

/**
 * @param {{ file: string, code: string }[]} specs
 * @param {{ zones: Record<string, string>, resourceTags: Record<string, string> }} config
 * @param {{ file: string, code: string }[]} [modules] módulos de `e2e/` que no son specs (sus tests
 *   no se comprueban; sus funciones cuentan como auxiliares de los specs que las importan)
 * @param {{ file: string, code: string }[]} [tasks] fichas (`tasks/NNNN-*.md`, con su cabecera),
 *   para la guarda de `@inestable` (ficha 0075)
 * @returns {{ kind: 'sin-zona' | 'dos-zonas' | 'desconocida' | 'portapapeles' | 'zona-muerta'
 *   | 'sin-arreglo' | 'ficha-inexistente' | 'ficha-hecha',
 *   file?: string, test?: string, tag?: string, message: string }[]}
 */
function checkTags(specs, config, modules = [], tasks = []) {
  if (config === null || typeof config !== 'object' || typeof config.zones !== 'object') {
    throw new TypeError('checkTags necesita zones y resourceTags de e2e/areas.json')
  }
  const zones = new Set(Object.keys(config.zones ?? {}))
  const resources = new Set(Object.keys(config.resourceTags ?? {}))
  const used = new Set()
  const problems = []
  const moduleSources = modules.map(({ file, code }) =>
    ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  )
  const moduleClipboard = clipboardFunctions(moduleSources)
  const states = taskStates(tasks)

  for (const { file, code } of specs) {
    const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    const seed = importedNames(source, moduleClipboard)
    const helpers = new Set([...clipboardFunctions([source], seed), ...seed])

    /**
     * @param {string[]} inherited etiquetas de los describe que lo contienen
     * @param {{ type?: string, description?: string }[]} inheritedAnnotations sus anotaciones
     */
    const visit = (node, inherited, inheritedAnnotations) => {
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
          const annotations = [...inheritedAnnotations, ...ownAnnotations(node)]
          const body = node.arguments[node.arguments.length - 1]
          if (kind === 'describe') {
            ts.forEachChild(body, (child) => visit(child, tags, annotations))
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
          if (tags.includes(QUARANTINE_TAG)) {
            const quarantine = quarantineProblem(states, annotations)
            if (quarantine !== null) {
              problems.push({
                kind: quarantine.kind,
                file,
                test: title,
                message: `${file}: ${where} ${quarantine.text}`
              })
            }
          }
          return
        }
      }
      ts.forEachChild(node, (child) => visit(child, inherited, inheritedAnnotations))
    }
    visit(source, [], [])
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

/** `views-<zona>.spec.ts` (con o sin carpeta delante) → `<zona>`; otro fichero → null. */
function viewSpecName(file) {
  const match = /(?:^|[\\/])views-([a-z0-9-]+)\.spec\.ts$/.exec(file)
  return match === null ? null : match[1]
}

/** El spec de vistas que reúne los tests del portapapeles (ficha 0070). */
const CLIPBOARD_SPEC = 'portapapeles'

/**
 * Ficha 0070: dónde está cada test. Pura, con los mismos specs y config que `checkTags`:
 * - `otra-zona`: un test de `views-<zona>.spec.ts` cuya zona (propia o de su `describe`) no es
 *   `@<zona>` (`tag` es la zona del test);
 * - `portapapeles-fuera`: un test con `@portapapeles` en un spec que no es
 *   `views-portapapeles.spec.ts`;
 * - `sin-portapapeles`: un test de `views-portapapeles.spec.ts` sin `@portapapeles`.
 * En `views-portapapeles.spec.ts` cada test conserva su zona, sea cual sea. Un test sin zona o con
 * dos ya lo dice `checkTags`: aquí solo cuenta una zona distinta de la del fichero.
 * @param {{ file: string, code: string }[]} specs
 * @param {{ zones: Record<string, string>, resourceTags: Record<string, string> }} config
 * @returns {{ kind: 'otra-zona' | 'portapapeles-fuera' | 'sin-portapapeles', file: string,
 *   test: string, tag?: string, message: string }[]}
 */
function checkPlacement(specs, config) {
  if (config === null || typeof config !== 'object' || typeof config.zones !== 'object') {
    throw new TypeError('checkPlacement necesita zones y resourceTags de e2e/areas.json')
  }
  const zones = new Set(Object.keys(config.zones ?? {}))
  const problems = []
  for (const { file, code } of specs) {
    const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    const view = viewSpecName(file)
    const visit = (node, inherited) => {
      if (ts.isCallExpression(node)) {
        const kind = callKind(node)
        if (kind !== null) {
          const title = titleText(node.arguments[0], source)
          const tags = [...new Set([...inherited, ...ownTags(node)])]
          const body = node.arguments[node.arguments.length - 1]
          if (kind === 'describe') {
            ts.forEachChild(body, (child) => visit(child, tags))
            return
          }
          const clipboard = tags.includes(CLIPBOARD_TAG)
          if (view === CLIPBOARD_SPEC) {
            if (!clipboard) {
              problems.push({
                kind: 'sin-portapapeles',
                file,
                test: title,
                message: `${file}: el test «${title}» no lleva ${CLIPBOARD_TAG}; aquí solo van los que usan el portapapeles (los demás, en el spec de su zona)`
              })
            }
            return
          }
          if (clipboard) {
            problems.push({
              kind: 'portapapeles-fuera',
              file,
              test: title,
              message: `${file}: el test «${title}» lleva ${CLIPBOARD_TAG} y tiene que ir en e2e/views-${CLIPBOARD_SPEC}.spec.ts`
            })
          }
          if (view !== null) {
            for (const tag of tags.filter((t) => zones.has(t) && t !== `@${view}`)) {
              problems.push({
                kind: 'otra-zona',
                file,
                test: title,
                tag,
                message: `${file}: el test «${title}» es de la zona ${tag} y está en el spec de @${view}`
              })
            }
          }
          return
        }
      }
      ts.forEachChild(node, (child) => visit(child, inherited))
    }
    visit(source, [])
  }
  return problems
}

module.exports = { checkTags, checkPlacement }
