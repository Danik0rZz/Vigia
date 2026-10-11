import { readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Ficha 0071: un cambio solo en los textos (locales/) lanza los unitarios de textos y los e2e de
 * las zonas de las claves cambiadas, filtrados con --grep; con otros ficheros, esas zonas suman
 * sus specs como un área más.
 *
 * Contrato de 0071 (lo que estos tests suponen de affected-e2e.cjs):
 * - `changedKeys(before, after)`: rutas de las hojas añadidas, quitadas o cambiadas.
 * - `decide(files, config, texts)`: `texts` lleva, por ruta de cada common.json cambiado, el texto
 *   del principio del rango (`before`, null si no existía) y el del árbol de trabajo (`after`), sin
 *   leer: un JSON roto se detecta dentro.
 * - `localeMapProblems(texts, config)`: la guarda; lista de problemas (vacía si todo está mapeado).
 * - `e2e/areas.json` gana `locales`: prefijo de clave → etiquetas de zona (de `zones`).
 * Los specs de una zona son los de e2e/ que tienen tests con su etiqueta.
 */

type Decision = { mode: 'all' | 'some' | 'none'; specs: string[]; reasons: string[] }
type Config = {
  always: string[]
  ignore: string[]
  transversal: string[]
  zones: Record<string, string>
  locales: Record<string, string[]>
  areas: Record<string, { globs: string[]; specs: string[] }>
}
type Texts = Record<string, { before: string | null; after: string | null }>
type Command = { command: string; args: string[] }
type Options = { range: string; exit?: undefined }
type Plan = { commands: Command[]; exit?: number; message?: string }
type Json = { [key: string]: Json } | string

const require = createRequire(import.meta.url)
const { changedKeys, decide, localeMapProblems, parseArgs, plan } = require(
  join(__dirname, 'affected-e2e.cjs')
) as {
  changedKeys: (before: object, after: object) => string[]
  decide: (files: string[], config: Config, texts?: Texts) => Decision
  localeMapProblems: (texts: object, config: Config) => string[]
  parseArgs: (argv: string[]) => Options
  plan: (decision: Decision, options: Options, env: { outExists: boolean }) => Plan
}

const ROOT = join(__dirname, '..')
const E2E = join(ROOT, 'e2e')
const ES = 'src/renderer/src/locales/es/common.json'
const EN = 'src/renderer/src/locales/en/common.json'
const SMOKE = 'e2e/smoke.spec.ts'
const UNIT: Command = { command: 'npx', args: ['vitest', 'run', 'src/renderer/src/locales'] }

const real = JSON.parse(readFileSync(join(E2E, 'areas.json'), 'utf8')) as Config
const readJson = (file: string): Record<string, Json> =>
  JSON.parse(readFileSync(join(ROOT, file), 'utf8')) as Record<string, Json>
const realEs = readJson(ES)
const realEn = readJson(EN)

/** Specs de e2e/ con algún test de la zona (su etiqueta aparece en el fichero). */
function specsWithTag(tag: string): string[] {
  return readdirSync(E2E)
    .filter((name) => name.endsWith('.spec.ts'))
    .filter((name) => new RegExp(`['"]${tag}['"]`).test(readFileSync(join(E2E, name), 'utf8')))
    .map((name) => `e2e/${name}`)
}

/** Lo esperado con solo textos: smoke y los specs de cada zona, ordenados y sin repetir. */
function expectedSpecs(tags: string[]): string[] {
  return [...new Set([SMOKE, ...tags.flatMap(specsWithTag)])].sort()
}

/** Primera hoja (ruta completa) bajo un prefijo de los textos. */
function firstLeaf(node: Json, path: string): string {
  if (typeof node === 'string') return path
  const key = Object.keys(node)[0] as string
  return firstLeaf(node[key] as Json, `${path}.${key}`)
}

function leafUnder(texts: Record<string, Json>, prefix: string): string {
  const node = prefix
    .split('.')
    .reduce<Json>((acc, key) => (acc as Record<string, Json>)[key] as Json, texts)
  return firstLeaf(node, prefix)
}

/** Copia de los textos con una hoja cambiada (o creada). */
function withLeaf(texts: Record<string, Json>, path: string, value: string): Record<string, Json> {
  const copy = structuredClone(texts)
  const keys = path.split('.')
  let node = copy as Record<string, Json>
  for (const key of keys.slice(0, -1)) {
    if (typeof node[key] !== 'object') node[key] = {}
    node = node[key] as Record<string, Json>
  }
  node[keys.at(-1) as string] = value
  return copy
}

/** Diff de una hoja en los dos idiomas. */
function textsFor(path: string): Texts {
  return {
    [ES]: {
      before: JSON.stringify(realEs),
      after: JSON.stringify(withLeaf(realEs, path, 'texto cambiado'))
    },
    [EN]: {
      before: JSON.stringify(realEn),
      after: JSON.stringify(withLeaf(realEn, path, 'changed text'))
    }
  }
}

function playwrightOf(p: Plan): Command {
  const last = p.commands.find((c) => c.args[0] === 'playwright')
  expect(last, 'el plan lanza Playwright').toBeDefined()
  return last as Command
}

/** Patrones de --grep / -g que lleva Playwright (también con --grep=…). */
function greps(command: Command): string[] {
  const found: string[] = []
  command.args.forEach((arg, i) => {
    if (arg === '--grep' || arg === '-g') found.push(command.args[i + 1] ?? '')
    else if (arg.startsWith('--grep=')) found.push(arg.slice('--grep='.length))
  })
  return found
}

/** Specs que lleva Playwright: los argumentos que son rutas de e2e/. */
const specsOf = (command: Command): string[] =>
  command.args.filter((arg) => /^e2e\/[^/]+\.spec\.ts$/.test(arg)).sort()

/** Si el --grep (un solo patrón) deja pasar un test con esa etiqueta. */
function grepAccepts(command: Command, tag: string): boolean {
  const patterns = greps(command)
  expect(patterns.length, 'un --grep de zonas').toBeGreaterThan(0)
  return patterns.every((pattern) => new RegExp(pattern).test(`CA1 (0001): algo ${tag}`))
}

describe('CA1 (0071): changedKeys da las hojas añadidas, quitadas y cambiadas', () => {
  const sorted = (keys: string[]): string[] => [...keys].sort()

  it('sin cambios → ninguna clave', () => {
    expect(changedKeys({ a: { b: 'x' } }, { a: { b: 'x' } })).toEqual([])
  })

  it('añadida, quitada y cambiada, con la ruta completa de la hoja', () => {
    const before = {
      entities: { service: { availability: { title: 'Disponibilidad', sub: 'igual' } } },
      problems: { old: 'se va' }
    }
    const after = {
      entities: { service: { availability: { title: 'Otra', sub: 'igual' } } },
      problems: { added: 'nueva' }
    }
    expect(sorted(changedKeys(before, after))).toEqual(
      ['entities.service.availability.title', 'problems.added', 'problems.old'].sort()
    )
  })

  it('una sección entera quitada da todas sus hojas, no la sección', () => {
    const before = { home: { a: 'x', b: { c: 'y' } }, metrics: { t: 'z' } }
    expect(sorted(changedKeys(before, { metrics: { t: 'z' } }))).toEqual(['home.a', 'home.b.c'])
  })

  it('claves con plural (_one, _other) son hojas propias', () => {
    const before = {
      problems: { count_one: '{{count}} problema', count_other: '{{count}} problemas' }
    }
    const after = { problems: { count_one: '{{count}} problema', count_other: '{{count}} avisos' } }
    expect(changedKeys(before, after)).toEqual(['problems.count_other'])
    expect(sorted(changedKeys({}, before))).toEqual(['problems.count_one', 'problems.count_other'])
  })

  it('con un fichero que antes no existía ({}) → todas las hojas del nuevo', () => {
    const after = { home: { title: 'Inicio' }, entities: { host: { cpu: 'CPU' } } }
    expect(sorted(changedKeys({}, after))).toEqual(['entities.host.cpu', 'home.title'])
  })

  it('una hoja que pasa a sección (o al revés) cuenta como cambio', () => {
    const keys = changedKeys({ home: { title: 'Inicio' } }, { home: { title: { short: 'Ini' } } })
    expect(keys.length).toBeGreaterThan(0)
    expect(keys.every((key) => key.startsWith('home.title'))).toBe(true)
  })
})

describe('CA2 (0071): solo textos de entities.service → unitarios de textos y @servicio con @smoke', () => {
  const key = leafUnder(realEs, 'entities.service')
  const files = [ES, EN]

  it('el mapa real lleva entities.service a @servicio', () => {
    expect(real.locales?.['entities.service']).toEqual(['@servicio'])
  })

  it('locales/** ya no está en el área shell', () => {
    expect((real.areas.shell?.globs ?? []).some((glob) => glob.includes('locales'))).toBe(false)
  })

  it('specs: views-servicio, smoke y el del portapapeles solo si @servicio tiene tests allí', () => {
    const d = decide(files, real, textsFor(key))
    expect(d.mode).toBe('some')
    const run = playwrightOf(plan(d, parseArgs([]), { outExists: true }))
    expect(specsOf(run)).toEqual(expectedSpecs(['@servicio']))
    expect(specsOf(run)).toContain('e2e/views-servicio.spec.ts')
    expect(specsOf(run)).not.toContain('e2e/shell.spec.ts')
  })

  it('lanza los unitarios de textos (vitest run src/renderer/src/locales)', () => {
    const p = plan(decide(files, real, textsFor(key)), parseArgs([]), { outExists: true })
    expect(p.commands).toContainEqual(UNIT)
  })

  it('--grep deja pasar @servicio y @smoke, y no @shell ni otra zona', () => {
    const run = playwrightOf(
      plan(decide(files, real, textsFor(key)), parseArgs([]), { outExists: true })
    )
    expect(grepAccepts(run, '@servicio')).toBe(true)
    expect(grepAccepts(run, '@smoke')).toBe(true)
    expect(grepAccepts(run, '@shell')).toBe(false)
    expect(grepAccepts(run, '@problema-detalle')).toBe(false)
  })

  it('el motivo dice la clave y su zona', () => {
    const d = decide(files, real, textsFor(key))
    expect(d.reasons).toContain(`locales: ${key} → @servicio`)
  })

  it('con tests unitarios u otros ignorados junto a los textos, sigue siendo «solo textos»', () => {
    const d = decide(
      [...files, 'src/renderer/src/locales/service-info.test.ts', 'docs/flujo.md'],
      real,
      textsFor(key)
    )
    const p = plan(d, parseArgs([]), { outExists: true })
    expect(p.commands).toContainEqual(UNIT)
    expect(specsOf(playwrightOf(p))).toEqual(expectedSpecs(['@servicio']))
    expect(greps(playwrightOf(p)).length).toBeGreaterThan(0)
  })

  it('con -g de quien lo lanza, Playwright lleva su patrón y el filtro de zonas', () => {
    const run = playwrightOf(
      plan(decide(files, real, textsFor(key)), parseArgs(['-g', '(0070)']), { outExists: true })
    )
    const joined = run.args.join(' ')
    expect(joined).toContain('(0070)')
    expect(joined).toContain('@servicio')
    expect(joined).toContain('@smoke')
  })

  it('con --no-build no compila y mantiene los specs y el --grep', () => {
    const p = plan(decide(files, real, textsFor(key)), parseArgs(['--no-build']), {
      outExists: true
    })
    expect(p.commands.some((c) => c.args.includes('electron-vite'))).toBe(false)
    expect(specsOf(playwrightOf(p))).toEqual(expectedSpecs(['@servicio']))
    expect(greps(playwrightOf(p)).length).toBeGreaterThan(0)
  })
})

describe('CA3 (0071): un prefijo compartido (module) lanza los specs de todas sus zonas', () => {
  const zones = real.locales?.module ?? []
  const key = leafUnder(realEs, 'module')

  it('module se usa en varias zonas', () => {
    expect(zones.length).toBeGreaterThanOrEqual(2)
  })

  it('specs y --grep de cada zona de module', () => {
    const d = decide([ES, EN], real, textsFor(key))
    expect(d.mode).toBe('some')
    const run = playwrightOf(plan(d, parseArgs([]), { outExists: true }))
    expect(specsOf(run)).toEqual(expectedSpecs(zones))
    for (const zone of zones) expect(grepAccepts(run, zone), zone).toBe(true)
    expect(grepAccepts(run, '@smoke')).toBe(true)
  })

  it('gana el prefijo más largo: entities.host no lanza las zonas de entities.service', () => {
    const d = decide([ES, EN], real, textsFor(leafUnder(realEs, 'entities.host')))
    const run = playwrightOf(plan(d, parseArgs([]), { outExists: true }))
    expect(specsOf(run)).toContain('e2e/views-host.spec.ts')
    expect(specsOf(run)).not.toContain('e2e/views-servicio.spec.ts')
  })
})

describe('CA4 (0071): textos y un fichero de otra área → specs de los dos, sin --grep de zonas', () => {
  const key = leafUnder(realEs, 'entities.service')
  const page = 'src/renderer/src/pages/ProblemsPage.tsx'

  it('suma views-servicio a los specs de la página de Problemas', () => {
    const d = decide([ES, EN, page], real, textsFor(key))
    expect(d.mode).toBe('some')
    const run = playwrightOf(plan(d, parseArgs([]), { outExists: true }))
    const pageOnly = decide([page], real).specs
    for (const spec of pageOnly) expect(specsOf(run), spec).toContain(spec)
    expect(specsOf(run)).toContain('e2e/views-servicio.spec.ts')
    expect(greps(run)).toEqual([])
  })

  it('el -g de quien lo lanza sí llega, solo él', () => {
    const d = decide([ES, EN, page], real, textsFor(key))
    const run = playwrightOf(plan(d, parseArgs(['-g', '(0070)']), { outExists: true }))
    expect(greps(run)).toEqual(['(0070)'])
  })
})

describe('CA5 (0071): prefijo sin mapa o JSON roto → e2e completo con el motivo', () => {
  it('una sección nueva sin prefijo en el mapa → all, y el motivo nombra la clave', () => {
    const d = decide([ES, EN], real, textsFor('seccionNuevaSinMapa.title'))
    expect(d.mode).toBe('all')
    expect(d.reasons.join(' ')).toContain('seccionNuevaSinMapa.title')
    const run = playwrightOf(plan(d, parseArgs([]), { outExists: true }))
    expect(specsOf(run)).toEqual([])
    expect(greps(run)).toEqual([])
  })

  it.each([
    ['el de ahora', { before: JSON.stringify(realEn), after: '{ "problems": ' }],
    ['el del principio del rango', { before: '{ "problems": ', after: JSON.stringify(realEn) }]
  ])('un common.json que no es JSON válido (%s) → all, y el motivo nombra el fichero', (_c, en) => {
    const texts: Texts = { ...textsFor(leafUnder(realEs, 'entities.service')), [EN]: en }
    const d = decide([ES, EN], real, texts)
    expect(d.mode).toBe('all')
    expect(d.reasons.join(' ')).toContain(EN)
  })
})

describe('CA6 (0071): la guarda del mapa de textos', () => {
  it('pasa sobre los textos reales (es y en)', () => {
    expect(localeMapProblems(realEs, real)).toEqual([])
    expect(localeMapProblems(realEn, real)).toEqual([])
  })

  it('cada zona del mapa real existe en zones', () => {
    for (const [prefix, zones] of Object.entries(real.locales ?? {})) {
      expect(zones.length, prefix).toBeGreaterThan(0)
      for (const zone of zones)
        expect(Object.keys(real.zones), `${prefix} → ${zone}`).toContain(zone)
    }
  })

  it('falla con una clave de primer nivel sin prefijo', () => {
    const problems = localeMapProblems({ ...realEs, seccionNuevaSinMapa: { title: 'x' } }, real)
    expect(problems.length).toBeGreaterThan(0)
    expect(problems.join(' ')).toContain('seccionNuevaSinMapa')
  })

  it('falla con un prefijo que apunta a una zona que no existe', () => {
    const config = { ...real, locales: { ...real.locales, problems: ['@zona-que-no-existe'] } }
    const problems = localeMapProblems(realEs, config)
    expect(problems.length).toBeGreaterThan(0)
    expect(problems.join(' ')).toContain('@zona-que-no-existe')
  })
})
