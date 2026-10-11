#!/usr/bin/env node
'use strict'
/**
 * e2e afectados por un rango de commits (más los cambios sin commitear):
 *   npm run test:e2e:affected -- [rango] [--no-build] [-g <patrón>] [--last-failed]
 *   (rango por defecto origin/main..HEAD; opciones en cualquier orden, --help para el uso)
 *
 * --no-build no compila y usa el out/ que haya (sin comprobar si está al día);
 * -g/--grep y --last-failed se pasan a Playwright tras los specs.
 *
 * Con e2e/areas.json decide qué specs ejecutar (siempre con smoke), si hace
 * falta el e2e completo (un fichero transversal o sin área) o si no hace falta
 * ninguno (solo docs o tests unitarios). Imprime la decisión y el motivo,
 * compila una vez y lanza Playwright. La decisión (`decide`), la lectura de
 * argumentos (`parseArgs`) y el plan de comandos (`plan`) son puras y probadas.
 *
 * Textos (ficha 0071): los `locales/<idioma>/common.json` no tienen área. Se
 * comparan las hojas del principio del rango con las del árbol de trabajo
 * (`changedKeys`) y cada clave cambiada va a sus zonas por `locales` de
 * e2e/areas.json (gana el prefijo más largo). Si solo cambian textos, se lanzan
 * los unitarios de textos y Playwright con los specs de esas zonas y smoke,
 * filtrado con --grep por sus etiquetas; si cambian más cosas, esas zonas suman
 * sus specs como un área más. Una clave sin zona o un JSON roto: e2e completo.
 *
 * Cómo se hizo el mapa `locales` (y cómo se amplía): para cada prefijo (el de
 * primer nivel y, en `entities`, el de segundo) se buscan los ficheros de src/
 * que lo nombran (`t('module.…')`, también con plantilla `t(`entities.host.${…}`)`).
 * Cada fichero aporta las zonas de sus áreas: la del área y las de los tests de
 * los specs que lanza (las reglas de la ficha 0070). Los ficheros transversales
 * (navigation.ts, lib/…) se miran a mano: dónde se pintan. Cuando una parte de
 * un prefijo se pinta en más sitios que el resto, lleva un prefijo propio más
 * largo: los textos comunes de las páginas de entidad que viven en
 * `entities.service` (marcadores abiertos/cerrados, carga, rango, resolución,
 * banda de problemas, tarjeta de información, columnas de exportación) van a
 * todas las zonas de entidad, y el resto de `entities.service`, solo a
 * @servicio; los niveles de uso de `entities.host` y `entities.monitor`, también
 * a @proceso.
 *
 * Mirar dónde se pintan no basta (ronda 1 de la ficha 0071): hay claves que se
 * montan fuera del componente que las pinta (`module.noEnvironment`, en
 * data/modules.ts) y tests que pasan por pantallas de otra zona (el botón de
 * idioma de la barra superior en @tls y @errors). Por eso, al tocar el mapa,
 * también se repasa e2e/*.spec.ts: cada texto literal de un common.json (es o en),
 * cada `t('es', '…')` y cada `es.…`/`en.…` que use un test tiene que caer en un
 * prefijo que incluya la zona de ese test (o, si el test tiene varias, alguna de
 * ellas). Las coincidencias con nombres de los fixtures, datos del simulador o
 * data-testid («Producción», «Pasos», «environment-form»…) se descartan a mano.
 *
 * La guarda (`localeMapProblems`, en check) exige que cada sección de textos
 * tenga prefijo y que cada zona exista; la pasada por los specs no es guarda.
 */
const { execFileSync, spawnSync } = require('node:child_process')
const { existsSync, readdirSync, readFileSync } = require('node:fs')
const { join, posix } = require('node:path')

const toPosix = (file) => file.replace(/\\/g, '/')
const matches = (file, globs) => globs.some((glob) => posix.matchesGlob(file, glob))
const SPEC = /^e2e\/[^/]+\.spec\.ts$/
const LOCALE_FILE = /^src\/renderer\/src\/locales\/[^/]+\/common\.json$/
const SMOKE_TAG = '@smoke'
/** Los unitarios de textos: paridad es/en, lint de i18n y los de cada página. */
const TEXT_UNITS = { command: 'npx', args: ['vitest', 'run', 'src/renderer/src/locales'] }

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

/** Hojas de un JSON de textos, con su ruta completa (`a.b.c`). */
function leaves(node, path, out) {
  for (const [key, value] of Object.entries(node)) {
    const full = path === '' ? key : `${path}.${key}`
    if (isObject(value)) leaves(value, full, out)
    else out.set(full, value)
  }
  return out
}

/**
 * Rutas de las hojas añadidas, quitadas o cambiadas entre dos JSON de textos.
 * @param {object} before
 * @param {object} after
 * @returns {string[]}
 */
function changedKeys(before, after) {
  const a = leaves(before, '', new Map())
  const b = leaves(after, '', new Map())
  const keys = new Set()
  for (const [key, value] of a) if (!b.has(key) || b.get(key) !== value) keys.add(key)
  for (const key of b.keys()) if (!a.has(key)) keys.add(key)
  return [...keys].sort()
}

/** Zonas de una clave: las del prefijo más largo del mapa que la contiene, o null. */
function zonesOfKey(key, locales) {
  let best = null
  for (const prefix of Object.keys(locales)) {
    if ((key === prefix || key.startsWith(`${prefix}.`)) && (!best || prefix.length > best.length))
      best = prefix
  }
  return best === null ? null : locales[best]
}

/**
 * La guarda del mapa: cada clave de primer nivel de los textos (y de segundo en
 * `entities`) tiene su prefijo en `locales`, y cada zona del mapa está en `zones`.
 * @param {object} texts un common.json ya leído
 * @param {{ zones: Record<string, string>, locales?: Record<string, string[]> }} config
 * @returns {string[]} problemas (vacío si todo está mapeado)
 */
function localeMapProblems(texts, config) {
  const locales = config.locales ?? {}
  const problems = []
  const sections = []
  for (const [key, value] of Object.entries(texts)) {
    if (key === 'entities' && isObject(value))
      for (const sub of Object.keys(value)) sections.push(`entities.${sub}`)
    else sections.push(key)
  }
  for (const section of sections) {
    if (!Object.hasOwn(locales, section))
      problems.push(`la sección de textos ${section} no tiene prefijo en locales (e2e/areas.json)`)
  }
  for (const [prefix, zones] of Object.entries(locales)) {
    if (!Array.isArray(zones) || zones.length === 0)
      problems.push(`el prefijo ${prefix} no tiene zonas`)
    else
      for (const zone of zones)
        if (!Object.hasOwn(config.zones ?? {}, zone))
          problems.push(`el prefijo ${prefix} apunta a ${zone}, que no está en zones`)
  }
  return problems
}

/** Specs de e2e/ con algún test de la zona: su etiqueta aparece entre comillas en el fichero. */
function specsWithZone(zone, dir = join(__dirname, '..', 'e2e')) {
  const quoted = new RegExp(`['"]${zone}['"]`)
  return readdirSync(dir)
    .filter((name) => name.endsWith('.spec.ts'))
    .filter((name) => quoted.test(readFileSync(join(dir, name), 'utf8')))
    .map((name) => `e2e/${name}`)
}

const parseText = (text) => {
  if (text === null) return {}
  const value = JSON.parse(text)
  if (!isObject(value)) throw new TypeError('no es un objeto')
  return value
}

/**
 * Zonas de los textos cambiados, o los motivos para el e2e completo.
 * @returns {{ zones: string[], reasons: string[], all: boolean }}
 */
function localeZones(localeFiles, config, texts) {
  const reasons = []
  const broken = []
  const keys = new Set()
  for (const file of localeFiles) {
    const entry = texts?.[file]
    if (!entry) {
      broken.push(`locales: no hay texto para comparar de ${file}`)
      continue
    }
    try {
      for (const key of changedKeys(parseText(entry.before), parseText(entry.after))) keys.add(key)
    } catch {
      broken.push(`locales: ${file} no es un JSON válido`)
    }
  }
  if (broken.length > 0) return { zones: [], reasons: broken, all: true }
  if (!isObject(config.locales)) {
    return { zones: [], reasons: ['locales: e2e/areas.json no tiene mapa de textos'], all: true }
  }
  const zones = new Set()
  const unmapped = []
  for (const key of [...keys].sort()) {
    const found = zonesOfKey(key, config.locales)
    if (found === null) {
      unmapped.push(`locales sin zona: ${key}`)
      continue
    }
    for (const zone of found) zones.add(zone)
    reasons.push(`locales: ${key} → ${found.join(', ')}`)
  }
  if (unmapped.length > 0) return { zones: [], reasons: unmapped, all: true }
  if (keys.size === 0) reasons.push('locales: ninguna clave cambiada')
  return { zones: [...zones].sort(), reasons, all: false }
}

/**
 * @param {string[]} files rutas relativas a la carpeta del proyecto (la de package.json, desde la
 *   que se lanza), con / o \: las que da `git diff --name-only --relative`
 * @param {{ always: string[], ignore: string[], transversal: string[],
 *   zones?: Record<string, string>, locales?: Record<string, string[]>,
 *   areas: Record<string, { globs: string[], specs: string[] }> }} config
 * @param {Record<string, { before: string | null, after: string | null }>} [texts] el texto,
 *   sin leer, de cada common.json cambiado: al principio del rango (null si no existía) y ahora
 * @returns {{ mode: 'all' | 'some' | 'none', specs: string[], reasons: string[],
 *   grepTags?: string[], textUnits?: boolean }} con solo textos, `grepTags` (las etiquetas que
 *   filtra Playwright) y `textUnits` (lanzar los unitarios de textos)
 */
function decide(files, config, texts) {
  // Obligatoria: sin ella no hay forma segura de decidir (nada de un valor por defecto).
  if (config === null || typeof config !== 'object' || !Array.isArray(config.ignore)) {
    throw new TypeError('decide necesita la config de e2e/areas.json')
  }
  // Solo se ignoran ficheros por su patrón (docs, tests): si queda alguno, cuenta.
  const relevant = [...new Set(files.map(toPosix))].filter(
    (file) => file !== '' && !matches(file, config.ignore)
  )
  if (relevant.length === 0) return { mode: 'none', specs: [], reasons: [] }

  const transversal = relevant.filter((file) => matches(file, config.transversal))
  if (transversal.length > 0) {
    return { mode: 'all', specs: [], reasons: transversal.map((file) => `transversal: ${file}`) }
  }

  const specs = new Set(config.always)
  const reasons = []
  const orphans = []
  const localeFiles = relevant.filter((file) => LOCALE_FILE.test(file))
  const others = relevant.filter((file) => !LOCALE_FILE.test(file))
  let textZones = []
  if (localeFiles.length > 0) {
    const found = localeZones(localeFiles, config, texts)
    if (found.all) return { mode: 'all', specs: [], reasons: found.reasons }
    textZones = found.zones
    reasons.push(...found.reasons)
    for (const zone of textZones) for (const spec of specsWithZone(zone)) specs.add(spec)
  }
  for (const file of others) {
    if (SPEC.test(file)) {
      specs.add(file)
      reasons.push(`spec cambiado: ${file}`)
      continue
    }
    const areas = Object.entries(config.areas).filter(([, area]) => matches(file, area.globs))
    if (areas.length === 0) {
      orphans.push(file)
      continue
    }
    for (const [, area] of areas) for (const spec of area.specs) specs.add(spec)
    reasons.push(`${file} → ${areas.map(([name]) => name).join(', ')}`)
  }
  // Un fichero sin área podría afectar a cualquier cosa: e2e completo.
  if (orphans.length > 0) {
    return { mode: 'all', specs: [], reasons: orphans.map((file) => `sin área: ${file}`) }
  }
  if (localeFiles.length > 0 && others.length === 0) {
    // Solo textos: de cada spec, solo los tests de esas zonas (y smoke, que siempre va).
    const grepTags = [...new Set([...textZones, SMOKE_TAG])].sort()
    return { mode: 'some', specs: [...specs].sort(), reasons, grepTags, textUnits: true }
  }
  return { mode: 'some', specs: [...specs].sort(), reasons }
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * El patrón de --grep: las etiquetas de zona y, si quien lo lanza pasó -g, también el suyo (los
 * dos a la vez, con dos lookahead). Playwright lo compara con el título más las etiquetas.
 */
function zoneGrep(tags, userPattern) {
  const zones = `(?:${tags.map(escapeRegExp).join('|')})(?![\\w-])`
  if (userPattern === undefined) return zones
  // Un /patrón/flags de Playwright se combina por su contenido.
  const literal = userPattern.match(/^\/(.*)\/([gi]*)$/)
  const user = literal ? literal[1] : userPattern
  return `^(?=.*${zones})(?=.*(?:${user}))`
}

const DEFAULT_RANGE = 'origin/main..HEAD'

const USAGE = `Uso: npm run test:e2e:affected -- [rango] [opciones]

  rango               commits a comparar (por defecto ${DEFAULT_RANGE}), antes o después de las opciones
  --no-build          no compila: usa el out/ que haya. No comprueba si out/ está al día; si has
                      cambiado algo fuera de e2e/, compila antes con npm run build
  -g, --grep <patrón> se pasa a Playwright (por ejemplo -g "(0070)")
  --last-failed       se pasa a Playwright: solo los tests que fallaron en la última tanda
  --help              muestra este uso`

const usageError = (problem) => ({
  exit: 2,
  message: `test:e2e:affected: ${problem}

${USAGE}`
})

/**
 * @param {string[]} argv argumentos tras el nombre del script
 * @returns {{ range: string, build: boolean, playwright: string[] } | { exit: number, message: string }}
 */
function parseArgs(argv) {
  if (argv.includes('--help')) return { exit: 0, message: USAGE }
  let range
  let build = true
  const playwright = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--no-build') build = false
    else if (arg === '--last-failed') playwright.push(arg)
    else if (arg === '-g' || arg === '--grep') {
      const pattern = argv[i + 1]
      if (pattern === undefined) return usageError(`${arg} necesita un patrón`)
      playwright.push(arg, pattern)
      i++
    } else if (arg.startsWith('-')) return usageError(`opción desconocida: ${arg}`)
    else if (range !== undefined)
      return usageError(`sobra un argumento: ${arg} (el rango ya es ${range})`)
    else range = arg
  }
  return { range: range ?? DEFAULT_RANGE, build, playwright }
}

/**
 * Comandos a ejecutar, en orden. Si no se puede seguir, también `exit` y `message`.
 * @param {{ mode: 'all' | 'some' | 'none', specs: string[] }} decision
 * @param {{ build: boolean, playwright: string[] }} options
 * @param {{ outExists: boolean }} env
 * @returns {{ commands: { command: string, args: string[] }[], exit?: number, message?: string }}
 */
function plan(decision, options, { outExists }) {
  if (decision.mode === 'none') return { commands: [] }
  if (!options.build && !outExists) {
    return {
      commands: [],
      exit: 2,
      message: 'test:e2e:affected: falta `out/`: compila con `npm run build` o quita `--no-build`.'
    }
  }
  const commands = []
  // Ficha 0071: con solo textos, primero sus unitarios (rápidos; check no se ha pasado aún).
  if (decision.textUnits) commands.push(TEXT_UNITS)
  // La misma compilación que test:e2e (sin tipos: eso ya lo hace check).
  if (options.build) commands.push({ command: 'npx', args: ['electron-vite', 'build'] })
  let extra = options.playwright
  if (Array.isArray(decision.grepTags) && decision.grepTags.length > 0) {
    // El -g de quien lo lanza (el último, como Playwright) se combina con el de zonas.
    let userPattern
    extra = []
    for (let i = 0; i < options.playwright.length; i++) {
      const arg = options.playwright[i]
      if (arg === '-g' || arg === '--grep') userPattern = options.playwright[++i]
      else extra.push(arg)
    }
    extra.push('--grep', zoneGrep(decision.grepTags, userPattern))
  }
  // Ficha 0075: solo el proyecto que bloquea; los de la cuarentena van con test:e2e:inestables.
  commands.push({
    command: 'npx',
    args: ['playwright', 'test', '--project=e2e', ...decision.specs, ...extra]
  })
  return { commands }
}

/**
 * Principio del rango, para leer los textos de entonces: `a..b` → a; `a...b` → la base común
 * (`merge-base`); un solo ref → él mismo (git diff lo compara con el árbol de trabajo).
 * @returns {{ ref: string } | { mergeBase: [string, string] }}
 */
function rangeBase(range) {
  const three = range.indexOf('...')
  if (three !== -1) {
    return { mergeBase: [range.slice(0, three) || 'HEAD', range.slice(three + 3) || 'HEAD'] }
  }
  const two = range.indexOf('..')
  if (two !== -1) return { ref: range.slice(0, two) || 'HEAD' }
  return { ref: range }
}

function gitLines(args) {
  return execFileSync('git', args, { encoding: 'utf8' })
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
}

/**
 * Texto de un fichero en un commit, o null si allí no existía. Con `./`, la ruta es relativa a
 * la carpeta actual, como las de `git diff --relative` (sin él, git la toma desde la raíz).
 */
function gitShow(ref, file) {
  try {
    return execFileSync('git', ['show', `${ref}:./${file}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    })
  } catch {
    return null
  }
}

/** Los common.json cambiados, al principio del rango y en el árbol de trabajo (sin leer). */
function readTexts(files, range) {
  const base = rangeBase(range)
  const ref =
    'ref' in base
      ? base.ref
      : execFileSync('git', ['merge-base', ...base.mergeBase], { encoding: 'utf8' }).trim()
  const texts = {}
  for (const file of new Set(files.map(toPosix))) {
    if (!LOCALE_FILE.test(file)) continue
    const path = join(__dirname, '..', file)
    texts[file] = {
      before: gitShow(ref, file),
      after: existsSync(path) ? readFileSync(path, 'utf8') : null
    }
  }
  return texts
}

/** Paquete de cada binario que usa el plan (el que está en devDependencies). */
const BIN_PACKAGES = {
  playwright: '@playwright/test',
  'electron-vite': 'electron-vite',
  vitest: 'vitest'
}

/** Ruta del .js de un binario local, por el campo `bin` de su paquete en node_modules. */
function localBin(name) {
  const pkg = BIN_PACKAGES[name] ?? name
  const root = join(__dirname, '..', 'node_modules', ...pkg.split('/'))
  const { bin } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const entry = typeof bin === 'string' ? bin : bin?.[name]
  if (!entry) throw new Error(`test:e2e:affected: ${pkg} no tiene el binario ${name}`)
  return join(root, entry)
}

/**
 * Cómo se lanza un paso del plan, sin shell (reapertura de la ficha 0071): con `shell: true`, cmd
 * tomaba el `|` del --grep de zonas (y el `^`, `&`, `>`, `<` o `%` de un -g) como sintaxis suya.
 * `npx <bin> …` pasa a node con el .js del binario local; así no hace falta `npx.cmd`, que Node
 * no deja lanzar sin shell. Los argumentos llegan tal cual.
 */
function invocation(command, args, resolveBin = localBin) {
  if (command === 'npx') {
    const [name, ...rest] = args
    return { file: process.execPath, args: [resolveBin(name), ...rest], shell: false }
  }
  return { file: command, args, shell: false }
}

function run(command, args) {
  const { file, args: argv, shell } = invocation(command, args)
  const result = spawnSync(file, argv, { stdio: 'inherit', shell })
  if (result.error)
    console.error(`test:e2e:affected: no se pudo lanzar ${file}: ${result.error.message}`)
  return result.status ?? 1
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.exit !== undefined) {
    ;(options.exit === 0 ? console.log : console.error)(options.message)
    return options.exit
  }
  const { range } = options
  const files = [
    ...gitLines(['diff', '--name-only', '--relative', range]),
    // Cambios sin commitear (en el índice o no) y ficheros nuevos sin seguimiento.
    ...gitLines(['diff', '--name-only', '--relative', 'HEAD']),
    ...gitLines(['ls-files', '--others', '--exclude-standard'])
  ]
  const config = JSON.parse(readFileSync(join(__dirname, '..', 'e2e', 'areas.json'), 'utf8'))
  const decision = decide(files, config, readTexts(files, range))

  console.log(`test:e2e:affected: rango ${range} más los cambios sin commitear`)
  for (const reason of decision.reasons) console.log(`  · ${reason}`)
  if (decision.mode === 'none') {
    console.log('test:e2e:affected: solo docs o tests unitarios; no hace falta ningún e2e.')
    return 0
  }
  console.log(
    decision.mode === 'all'
      ? 'test:e2e:affected: e2e COMPLETO.'
      : `test:e2e:affected: ${decision.specs.join(' ')}`
  )
  if (decision.grepTags) {
    console.log(
      `test:e2e:affected: solo textos; unitarios de textos y, de esos specs, solo ${decision.grepTags.join(' ')}`
    )
  }
  const steps = plan(decision, options, { outExists: existsSync(join(__dirname, '..', 'out')) })
  if (steps.message) console.error(steps.message)
  for (const { command, args } of steps.commands) {
    const status = run(command, args)
    if (status !== 0) return status
  }
  return steps.exit ?? 0
}

module.exports = {
  changedKeys,
  decide,
  invocation,
  localBin,
  localeMapProblems,
  parseArgs,
  plan,
  rangeBase,
  zoneGrep
}

if (require.main === module) process.exitCode = main()
