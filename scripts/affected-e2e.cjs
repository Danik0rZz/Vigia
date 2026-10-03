#!/usr/bin/env node
'use strict'
/**
 * e2e afectados por un rango de commits (más los cambios sin commitear):
 *   npm run test:e2e:affected -- [rango]   (por defecto origin/main..HEAD)
 *
 * Con e2e/areas.json decide qué specs ejecutar (siempre con smoke), si hace
 * falta el e2e completo (un fichero transversal o sin área) o si no hace falta
 * ninguno (solo docs o tests unitarios). Imprime la decisión y el motivo,
 * compila una vez y lanza Playwright. La decisión es `decide`, pura y probada.
 */
const { execFileSync, spawnSync } = require('node:child_process')
const { readFileSync } = require('node:fs')
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
  const range = process.argv[2] ?? 'origin/main..HEAD'
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
  // La misma compilación que test:e2e (sin tipos: eso ya lo hace check).
  const built = run('npx', ['electron-vite', 'build'])
  if (built !== 0) return built
  return run('npx', ['playwright', 'test', ...decision.specs])
}

module.exports = { decide }

if (require.main === module) process.exitCode = main()
