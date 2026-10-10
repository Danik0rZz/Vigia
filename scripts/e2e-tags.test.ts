import { readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Ficha 0067: cada test de `e2e/*.spec.ts` lleva exactamente una etiqueta de zona (propia o de su
 * `test.describe`), solo etiquetas conocidas (`zones` y `resourceTags` de `e2e/areas.json`) y
 * `@portapapeles` si usa el portapapeles del sistema. Una zona de la lista sin ningún test también
 * es un fallo (zona muerta).
 *
 * La lógica es `checkTags` (`scripts/e2e-tags.cjs`), pura: recibe el texto de los specs y la config
 * y devuelve los problemas. Se prueba con specs de ejemplo y, además, sobre los specs reales.
 */

type Kind = 'sin-zona' | 'dos-zonas' | 'desconocida' | 'portapapeles' | 'zona-muerta'

interface Problem {
  kind: Kind
  /** Fichero del spec (como se pasó en `file`); no aplica a `zona-muerta`. */
  file?: string
  /** Título del test tal cual está en el spec; no aplica a `zona-muerta`. */
  test?: string
  /** Etiqueta implicada: la desconocida o la zona muerta. */
  tag?: string
  /** Texto para el fallo: nombra el fichero y el test (o la zona muerta). */
  message: string
}

interface TagConfig {
  /** Zona → descripción de una línea. */
  zones: Record<string, string>
  /** Etiqueta de recurso → descripción de una línea. */
  resourceTags: Record<string, string>
}

interface Spec {
  file: string
  code: string
}

const require = createRequire(import.meta.url)
const { checkTags } = require(join(__dirname, 'e2e-tags.cjs')) as {
  checkTags: (specs: Spec[], config: TagConfig) => Problem[]
}

const E2E_DIR = 'e2e'

const config: TagConfig = {
  zones: { '@shell': 'menú y barra', '@metricas': 'Métricas' },
  resourceTags: { '@portapapeles': 'usa el portapapeles del sistema' }
}

const header = "import { expect, test } from '@playwright/test'\n"

/** Specs de ejemplo que usan las dos zonas, para que no salten zonas muertas por accidente. */
const filler: Spec = {
  file: 'relleno.spec.ts',
  code: `${header}test('relleno shell', { tag: '@shell' }, async () => {})
test('relleno métricas', { tag: '@metricas' }, async () => {})
`
}

function check(code: string, file = 'ejemplo.spec.ts'): Problem[] {
  return checkTags([{ file, code }, filler], config)
}

describe('checkTags (la propia comprobación)', () => {
  it('CA2 (0067): acepta un test con una zona, en texto o en lista, y con títulos con comillas y paréntesis', () => {
    const code = `${header}test('CA1 (0001): «abre» el "menú" (con paréntesis)', { tag: '@shell' }, async () => {})
test("CA2 (0001): con lista y recurso", { tag: ['@metricas', '@portapapeles'] }, async () => {})
`
    expect(check(code)).toEqual([])
  })

  it('CA2 (0067): falla y nombra fichero y test si un test no tiene zona', () => {
    const code = `${header}test('CA1 (0001): con zona', { tag: '@shell' }, async () => {})
test('CA2 (0001): «sin» zona (nada)', async () => {
  expect(1).toBe(1)
})
test('CA3 (0001): solo recurso', { tag: '@portapapeles' }, async ({}) => {
  await app.evaluate(({ clipboard }) => clipboard.clear())
})
`
    const problems = check(code, 'sinzona.spec.ts')
    expect(problems.map((p) => [p.kind, p.file, p.test])).toEqual([
      ['sin-zona', 'sinzona.spec.ts', 'CA2 (0001): «sin» zona (nada)'],
      ['sin-zona', 'sinzona.spec.ts', 'CA3 (0001): solo recurso']
    ])
    for (const p of problems) {
      expect(p.message).toContain('sinzona.spec.ts')
      expect(p.message).toContain(p.test)
    }
  })

  it('CA2 (0067): falla y nombra fichero y test si un test tiene dos zonas', () => {
    const code = `${header}test('CA1 (0002): dos zonas', { tag: ['@shell', '@metricas'] }, async () => {})
`
    const problems = check(code, 'doszonas.spec.ts')
    expect(problems.map((p) => [p.kind, p.file, p.test])).toEqual([
      ['dos-zonas', 'doszonas.spec.ts', 'CA1 (0002): dos zonas']
    ])
    expect(problems[0]?.message).toContain('doszonas.spec.ts')
    expect(problems[0]?.message).toContain('CA1 (0002): dos zonas')
  })

  it('CA2 (0067): falla y nombra fichero, test y etiqueta si usa una etiqueta desconocida', () => {
    const code = `${header}test('CA1 (0003): etiqueta rara', { tag: ['@shell', '@rara'] }, async () => {})
`
    const problems = check(code, 'rara.spec.ts')
    expect(problems.map((p) => [p.kind, p.file, p.test, p.tag])).toEqual([
      ['desconocida', 'rara.spec.ts', 'CA1 (0003): etiqueta rara', '@rara']
    ])
    expect(problems[0]?.message).toContain('rara.spec.ts')
    expect(problems[0]?.message).toContain('CA1 (0003): etiqueta rara')
    expect(problems[0]?.message).toContain('@rara')
  })

  it('CA2 (0067): falla si el cuerpo del test usa el portapapeles sin @portapapeles', () => {
    const code = `${header}test('CA1 (0004): copia sin etiqueta', { tag: '@metricas' }, async () => {
  const text = await app.evaluate(({ clipboard }) => clipboard.readText())
  expect(text).toBe('x')
})
test('CA2 (0004): copia con etiqueta', { tag: ['@metricas', '@portapapeles'] }, async () => {
  const text = await app.evaluate(({ clipboard }) => clipboard.readText())
  expect(text).toBe('x')
})
`
    const problems = check(code, 'copia.spec.ts')
    expect(problems.map((p) => [p.kind, p.file, p.test])).toEqual([
      ['portapapeles', 'copia.spec.ts', 'CA1 (0004): copia sin etiqueta']
    ])
    expect(problems[0]?.message).toContain('copia.spec.ts')
    expect(problems[0]?.message).toContain('CA1 (0004): copia sin etiqueta')
  })

  it('CA2 (0067): falla si el test usa el portapapeles a través de una función auxiliar del spec', () => {
    const code = `${header}async function clipboardText(): Promise<string> {
  return app.evaluate(({ clipboard }) => clipboard.readText())
}
test('CA1 (0005): copia por la auxiliar', { tag: '@metricas' }, async () => {
  expect(await clipboardText()).toBe('x')
})
test('CA2 (0005): auxiliar con etiqueta', { tag: ['@metricas', '@portapapeles'] }, async () => {
  expect(await clipboardText()).toBe('x')
})
test('CA3 (0005): no copia', { tag: '@metricas' }, async () => {
  expect(1).toBe(1)
})
`
    const problems = check(code, 'auxiliar.spec.ts')
    expect(problems.map((p) => [p.kind, p.file, p.test])).toEqual([
      ['portapapeles', 'auxiliar.spec.ts', 'CA1 (0005): copia por la auxiliar']
    ])
  })
})

describe('CA3 (0067): zona heredada de test.describe', () => {
  it('CA3 (0067): acepta la zona de un describe, también anidado, y suma los recursos del test', () => {
    const code = `${header}test.describe('Métricas', { tag: '@metricas' }, () => {
  test('CA1 (0006): hereda la zona', async () => {})
  test.describe('sin etiqueta propia', () => {
    test('CA2 (0006): hereda de dos niveles', async () => {})
  })
  test('CA3 (0006): copia', { tag: '@portapapeles' }, async () => {
    await app.evaluate(({ clipboard }) => clipboard.clear())
  })
})
`
    expect(check(code)).toEqual([])
  })

  it('CA3 (0067): rechaza el test cuya zona choca con la de su describe', () => {
    const code = `${header}test.describe('Métricas', { tag: '@metricas' }, () => {
  test('CA1 (0007): misma zona heredada', async () => {})
  test('CA2 (0007): choca con el describe', { tag: '@shell' }, async () => {})
})
`
    const problems = check(code, 'choque.spec.ts')
    expect(problems.map((p) => [p.kind, p.file, p.test])).toEqual([
      ['dos-zonas', 'choque.spec.ts', 'CA2 (0007): choca con el describe']
    ])
  })

  it('CA3 (0067): un describe sin zona no la da a sus tests', () => {
    const code = `${header}test.describe('sin zona', () => {
  test('CA1 (0008): sin zona dentro', async () => {})
})
`
    const problems = check(code, 'describe.spec.ts')
    expect(problems.map((p) => [p.kind, p.test])).toEqual([
      ['sin-zona', 'CA1 (0008): sin zona dentro']
    ])
  })
})

describe('CA4 (0067): zonas de la lista', () => {
  it('CA4 (0067): una zona de la lista sin ningún test hace fallar la guarda', () => {
    const only = `${header}test('CA1 (0009): solo shell', { tag: '@shell' }, async () => {})
`
    const problems = checkTags([{ file: 'solo.spec.ts', code: only }], config)
    expect(problems.map((p) => [p.kind, p.tag])).toEqual([['zona-muerta', '@metricas']])
    expect(problems[0]?.message).toContain('@metricas')
  })

  it('CA4 (0067): e2e/areas.json tiene zones y resourceTags, con @portapapeles', () => {
    const areas = JSON.parse(
      readFileSync(join(E2E_DIR, 'areas.json'), 'utf8')
    ) as Partial<TagConfig>
    expect(areas.zones).toBeTypeOf('object')
    expect(areas.resourceTags).toBeTypeOf('object')
    const zones = Object.entries(areas.zones ?? {})
    expect(zones.length).toBeGreaterThan(0)
    for (const [zone, description] of zones) {
      expect(zone).toMatch(/^@[a-z0-9-]+$/)
      expect(description).toBeTypeOf('string')
      expect(description.length).toBeGreaterThan(0)
    }
    expect(Object.keys(areas.resourceTags ?? {})).toContain('@portapapeles')
    for (const tag of Object.keys(areas.resourceTags ?? {})) {
      expect(Object.keys(areas.zones ?? {})).not.toContain(tag)
    }
  })
})

describe('CA1 (0067): specs reales de e2e', () => {
  it('CA1 (0067): cada test de e2e/*.spec.ts tiene una zona conocida y @portapapeles si lo usa', () => {
    const areas = JSON.parse(readFileSync(join(E2E_DIR, 'areas.json'), 'utf8')) as TagConfig
    const specs = readdirSync(E2E_DIR)
      .filter((name) => name.endsWith('.spec.ts'))
      .map((name) => ({ file: `e2e/${name}`, code: readFileSync(join(E2E_DIR, name), 'utf8') }))
    expect(specs.length).toBeGreaterThan(0)
    const problems = checkTags(specs, areas)
    expect(problems.map((p) => p.message)).toEqual([])
  })
})
