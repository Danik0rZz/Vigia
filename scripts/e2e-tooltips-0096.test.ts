import { readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Ficha 0096: los tres tests de tooltips que no llegaban a abrirse en el CI salen de cuarentena.
 *
 * - CA3: ninguno de los tres (A, B y C, este último añadido por Dani) lleva `@inestable` ni la anotación `arreglo`, y la guarda de la 0075
 *   (`checkTags`) sigue sin problemas en los specs reales.
 *
 * CA1 (10 de 10 con `--repeat-each 10` y con `--workers=1`) y CA2 (verde en el CI de la PR) se
 * comprueban ejecutando los e2e, no con un test. CA4 solo aplica si la causa está en la app: su test
 * se escribe con el arreglo, cuando se conozca la causa.
 *
 * Los títulos pueden ganar «, arreglo (0096)» al final: se buscan por su comienzo.
 */

const ROOT = resolve(__dirname, '..')
const E2E_DIR = join(ROOT, 'e2e')
const TASKS_DIR = join(ROOT, 'tasks')

interface Spec {
  file: string
  code: string
}

interface Problem {
  kind: string
  message: string
}

const require = createRequire(import.meta.url)
const { checkTags } = require(join(__dirname, 'e2e-tags.cjs')) as {
  checkTags: (specs: Spec[], config: unknown, modules?: Spec[], tasks?: Spec[]) => Problem[]
}

const TESTS = [
  {
    name: 'A',
    file: 'views-problema-detalle.spec.ts',
    title:
      'v0.10.2: evidencia de 45 días: últimos 7 por defecto, etiquetas de fecha variadas (no «00:00»), nota y sin línea de inicio'
  },
  {
    name: 'B',
    file: 'views-problemas.spec.ts',
    title: 'grid de Problemas: ARIA, orden por columna, barra de estado y afectados'
  },
  {
    name: 'C',
    file: 'views-host.spec.ts',
    title: 'CA4 (0039): el tooltip de ayuda de «recuperable» sale con el ratón y con el foco'
  }
]

/** Lo que va entre el título del test y su cuerpo: las opciones (`tag`, `annotation`). */
function optionsOf(file: string, title: string): string {
  const code = readFileSync(join(E2E_DIR, file), 'utf8')
  const start = code.indexOf(`'${title}`)
  expect(start, `no se encuentra el test «${title}» en e2e/${file}`).toBeGreaterThanOrEqual(0)
  // El título termina en su comilla de cierre (puede llevar «, arreglo (0096)» antes de ella).
  const titleEnd = code.indexOf("'", start + 1)
  const body = code.indexOf('async', titleEnd)
  expect(body).toBeGreaterThan(titleEnd)
  return code.slice(titleEnd + 1, body)
}

function realSpecs(): Spec[] {
  return readdirSync(E2E_DIR)
    .filter((name) => name.endsWith('.spec.ts'))
    .map((name) => ({ file: `e2e/${name}`, code: readFileSync(join(E2E_DIR, name), 'utf8') }))
}

function taskFiles(): Spec[] {
  return readdirSync(TASKS_DIR)
    .filter((name) => /^\d{4}-.*\.md$/.test(name))
    .map((name) => ({ file: `tasks/${name}`, code: readFileSync(join(TASKS_DIR, name), 'utf8') }))
}

describe('CA3 (0096): los tests de tooltips A, B y C salen de cuarentena', () => {
  for (const t of TESTS) {
    it(`CA3 (0096): el test ${t.name} (${t.file}) no lleva @inestable`, () => {
      expect(optionsOf(t.file, t.title)).not.toContain('@inestable')
    })

    it(`CA3 (0096): el test ${t.name} (${t.file}) no lleva la anotación arreglo`, () => {
      const options = optionsOf(t.file, t.title)
      expect(options).not.toMatch(/annotation/)
      expect(options).not.toMatch(/arreglo/)
    })
  }

  it('CA3 (0096): la guarda de la 0075 no da problemas en los specs reales', () => {
    const areas = JSON.parse(readFileSync(join(E2E_DIR, 'areas.json'), 'utf8')) as unknown
    const problems = checkTags(realSpecs(), areas, [], taskFiles())
    expect(problems.map((p) => p.message)).toEqual([])
  })
})
