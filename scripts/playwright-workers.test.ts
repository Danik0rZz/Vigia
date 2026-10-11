import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Ficha 0070, punto 5: `workers` depende de `process.env.CI`. Ficha 0087: sin `CI`, 6 (con 8
 * subieron los fallos de tiempos en local). Ficha 0098: con `CI`, 2 y no 4. En el runner
 * (`windows-latest`, 4 núcleos lógicos), con 3 o 4 apps a la vez cada test de vistas tarda de 1,7 a
 * 2,1 veces lo de antes de la 0070; con 2, 1,1 (medición en el «Resultado» de la ficha).
 */

const CONFIG = join(__dirname, '..', 'playwright.config.ts')
/** Workers sin CI (ficha 0087). */
const LOCAL_WORKERS = 6
/** Workers con CI (ficha 0098). */
const CI_WORKERS = 2

async function workersWith(ci: string | undefined): Promise<unknown> {
  vi.resetModules()
  if (ci === undefined) vi.stubEnv('CI', undefined)
  else vi.stubEnv('CI', ci)
  const module = (await import('../playwright.config')) as { default: { workers?: unknown } }
  return module.default.workers
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('CA5 (0070): workers de playwright.config.ts según CI', () => {
  it('CA1 (0098): con CI, 2 workers', async () => {
    expect(await workersWith('true')).toBe(CI_WORKERS)
  })

  it('CA1 (0087): sin CI, 6 workers', async () => {
    expect(await workersWith(undefined)).toBe(LOCAL_WORKERS)
  })

  it('CA5 (0070): el valor de workers depende de process.env.CI', () => {
    const source = ts.createSourceFile(
      CONFIG,
      readFileSync(CONFIG, 'utf8'),
      ts.ScriptTarget.Latest,
      true
    )
    let workers: ts.Expression | undefined
    const visit = (node: ts.Node): void => {
      if (
        ts.isPropertyAssignment(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === 'workers'
      ) {
        workers = node.initializer
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
    expect(workers, 'propiedad workers en la config').toBeDefined()
    const text = workers?.getText(source) ?? ''
    // `process.env.CI`, `process.env['CI']` o una constante del fichero que lo lea.
    const readsCi = /process\.env(\.CI\b|\[['"]CI['"]\])/
    const usesCi =
      readsCi.test(text) ||
      source.statements.some(
        (statement) =>
          ts.isVariableStatement(statement) &&
          readsCi.test(statement.getText(source)) &&
          statement.declarationList.declarations.some(
            (declaration) =>
              ts.isIdentifier(declaration.name) &&
              new RegExp(`\\b${declaration.name.text}\\b`).test(text)
          )
      )
    expect(usesCi, `workers: ${text}`).toBe(true)
  })
})
