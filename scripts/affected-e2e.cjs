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
 */
const { execFileSync, spawnSync } = require('node:child_process')
const { existsSync, readFileSync } = require('node:fs')
const { join, posix } = require('node:path')

const toPosix = (file) => file.replace(/\\/g, '/')
const matches = (file, globs) => globs.some((glob) => posix.matchesGlob(file, glob))
const SPEC = /^e2e\/[^/]+\.spec\.ts$/

/**
 * @param {string[]} files rutas relativas a app/ (con / o \)
 * @param {{ always: string[], ignore: string[], transversal: string[],
 *   areas: Record<string, { globs: string[], specs: string[] }> }} config
 * @returns {{ mode: 'all' | 'some' | 'none', specs: string[], reasons: string[] }}
 */
function decide(files, config) {
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
  for (const file of relevant) {
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
  return { mode: 'some', specs: [...specs].sort(), reasons }
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
  // La misma compilación que test:e2e (sin tipos: eso ya lo hace check).
  if (options.build) commands.push({ command: 'npx', args: ['electron-vite', 'build'] })
  commands.push({
    command: 'npx',
    args: ['playwright', 'test', ...decision.specs, ...options.playwright]
  })
  return { commands }
}

function gitLines(args) {
  return execFileSync('git', args, { encoding: 'utf8' })
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32' })
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
  const decision = decide(files, config)

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
  const steps = plan(decision, options, { outExists: existsSync(join(__dirname, '..', 'out')) })
  if (steps.message) console.error(steps.message)
  for (const { command, args } of steps.commands) {
    const status = run(command, args)
    if (status !== 0) return status
  }
  return steps.exit ?? 0
}

module.exports = { decide, parseArgs, plan }

if (require.main === module) process.exitCode = main()
