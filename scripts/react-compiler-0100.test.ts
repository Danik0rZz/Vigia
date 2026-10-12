import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Ficha 0100: el unitario del React Compiler (`scripts/react-compiler.test.ts`, «CA3 (0059)») se
 * quedaba sin tiempo bajo carga porque la carga en frío de la configuración (y de Babel) contaba
 * dentro del `it`. Se lee el texto de ese test (no el de la configuración) para comprobar que:
 *
 * - CA1: sus dos pruebas siguen con los mismos nombres y comprobando lo mismo, y la preparación
 *   cara (cargar la configuración real y tomar el plugin) va en un `beforeAll`, fuera de la prueba.
 *
 * CA2 (verde en tres `npm run check` seguidos con `npm run test:e2e` a la vez) lo ejecuta el
 * verifier: no es un test.
 */

const FILE = resolve(__dirname, 'react-compiler.test.ts')
const code = readFileSync(FILE, 'utf8')

const VERSION_TEST =
  'CA3 (0059): babel-plugin-react-compiler es dependencia de desarrollo con versión exacta'
const COMPILER_TEST =
  'CA3 (0059): el plugin de React del renderer compila los componentes con el React Compiler'

/** El texto de un bloque que empieza en `start`, hasta su cierre `\n  })` (dos espacios). */
function block(start: number): string {
  const end = code.indexOf('\n  })', start)
  expect(end, 'el bloque se cierra').toBeGreaterThan(start)
  return code.slice(start, end)
}

describe('CA1 (0100): el test del React Compiler comprueba lo mismo, sin la carga dentro de la prueba', () => {
  it('CA1 (0100): las dos pruebas «CA3 (0059)» conservan sus nombres y sus comprobaciones', () => {
    expect(code).toContain(`'${VERSION_TEST}'`)
    expect(code).toContain(`'${COMPILER_TEST}'`)
    // Versión exacta, en devDependencies y no en dependencies.
    expect(code).toContain('pkg.devDependencies?.[COMPILER]')
    expect(code).toContain(String.raw`.toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/)`)
    expect(code).toContain('pkg.dependencies?.[COMPILER]')
    // La configuración real, cargada (no leída como texto), y el plugin de Babel del renderer.
    expect(code).toContain("import('../electron.vite.config')")
    expect(code).toContain("plugin.name === 'vite:react-babel'")
    // La salida usa el runtime y la caché del compilador.
    expect(code).toContain(".toContain('react/compiler-runtime')")
    expect(code).toContain(String.raw`.toMatch(/\b_c\(\d+\)/)`)
  })

  it('CA1 (0100): la carga de la configuración y del plugin va en un beforeAll, no en la prueba', () => {
    const hook = code.indexOf('beforeAll(')
    expect(hook, 'hay un beforeAll').toBeGreaterThan(-1)
    expect(block(hook), 'el beforeAll toma el plugin de la configuración').toContain(
      'rendererBabelPlugin('
    )

    const test = code.indexOf(`'${COMPILER_TEST}'`)
    expect(test).toBeGreaterThan(-1)
    const body = block(test)
    expect(body, 'la prueba no importa la configuración').not.toContain('import(')
    expect(body, 'la prueba no carga el plugin').not.toContain('rendererBabelPlugin(')
    // Lo que llame la prueba para transformar tampoco carga la configuración.
    const transform = code.indexOf('async function transformForBuild(')
    if (transform > -1) {
      const fn = code.slice(transform, code.indexOf('\n}', transform))
      expect(fn, 'transformForBuild no carga el plugin').not.toContain('rendererBabelPlugin(')
    }
  })
})
