// Integración por PR (ficha 0073): la parte comprobable de integrar una ficha.
//
// Uso (en la rama de la ficha, con el árbol limpio):
//   node scripts/integrate.mjs <ruta de la ficha> <zona>
// y, para agrupar la cola en PR (escribe el resultado de groupForPrs en JSON):
//   node scripts/integrate.mjs --agrupar <ficha> [<ficha> …]
//
// Lee el front matter de la ficha y comprueba que está `verificada`, que el árbol está limpio y que
// la rama actual es la suya. Si todo está en orden, escribe en la salida estándar el mensaje del
// commit de la ficha (`feat(zona): título (#NNNN)`, `fix(…)` si la rama es `fix/`) y sale con 0;
// si no, escribe los motivos en la salida de error y sale con 1. No toca git: el `git merge
// --squash` en la rama `integra/…` y el commit los hace el Orquestador (`.claude/commands/tarea.md`).
//
// `groupForPrs` decide cómo se agrupan las fichas de la cola en PR. Lo usa el Orquestador; el
// script no abre PR.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

/** Valores válidos del campo `exclusiones` de una ficha (los de `tasks/_PLANTILLA.md`). */
export const EXCLUSIONES = ['ipc', 'api', 'dependencias', 'esquema', 'seguridad', 'externos']

/** Tamaño de las PR agrupadas: se abre al llegar a MAX_GROUP (las de menos de MIN, al acabar). */
export const MIN_GROUP = 3
export const MAX_GROUP = 5

/** Quita el comentario final (` # …`) y las comillas envolventes de un valor. */
function cleanScalar(raw) {
  const value = raw.replace(/\s+#.*$/, '').trim()
  const quoted = /^(['"])(.*)\1$/.exec(value)
  return quoted ? (quoted[2] ?? '') : value
}

/**
 * Pura: el front matter de una ficha como objeto. Los escalares, sin comillas ni comentario; las
 * listas en una línea (`[a, 'b']`), como arrays de cadenas. Una clave ausente no aparece.
 */
export function parseFrontMatter(text) {
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? ''
  const ficha = {}
  for (const line of block.split(/\r?\n/)) {
    const match = /^([\w-]+):\s*(.*)$/.exec(line)
    if (!match) continue
    const key = match[1] ?? ''
    const raw = match[2] ?? ''
    // Una lista entera: el comentario no puede ir dentro de los corchetes.
    const list = /^\[(.*)\]\s*(?:#.*)?$/.exec(raw.trim())
    ficha[key] = list
      ? (list[1] ?? '')
          .split(',')
          .map((item) => cleanScalar(item))
          .filter((item) => item !== '')
      : cleanScalar(raw)
  }
  return ficha
}

/** Pura: `<tipo>(<zona>): <titulo> (#<id>)`, con `fix` si la rama empieza por `fix/`. */
export function buildCommitMessage(ficha, zona) {
  const tipo = String(ficha.rama ?? '').startsWith('fix/') ? 'fix' : 'feat'
  return `${tipo}(${zona}): ${ficha.titulo} (#${ficha.id})`
}

/**
 * Pura: motivos por los que no se puede integrar la ficha (vacío si se puede). `clean` dice si el
 * árbol está limpio y `branch` es la rama actual, que tiene que ser la del campo `rama` (al reabrir
 * una ficha por el CI, `rama: fix/NNNN-ci`).
 */
export function checkIntegration({ ficha, clean, branch }) {
  const reasons = []
  if (ficha.estado !== 'verificada') {
    reasons.push(
      `La ficha ${ficha.id} está «${ficha.estado ?? '(sin estado)'}»: solo se integra verificada.`
    )
  }
  if (!clean) reasons.push('El árbol tiene cambios sin commitear.')
  if (branch !== ficha.rama) {
    reasons.push(
      `La rama actual es «${branch}» y la de la ficha es «${ficha.rama ?? '(sin rama)'}».`
    )
  }
  return reasons
}

/**
 * Pura: agrupa las fichas de la cola (en su orden) en PR. Una ficha con alguna exclusión, o sin el
 * campo `exclusiones` (las de antes de la 0073), va sola y la fusiona Dani. Las demás se juntan de
 * MIN_GROUP a MAX_GROUP: la PR se cierra al llegar a MAX_GROUP o al acabar la cola con las que haya.
 * Una ficha sola en medio no corta el grupo en curso. Lanza un Error con un valor desconocido.
 */
export function groupForPrs(fichas) {
  const prs = []
  let current = []
  for (const ficha of fichas) {
    const exclusiones = ficha.exclusiones
    for (const value of exclusiones ?? []) {
      if (!EXCLUSIONES.includes(value)) {
        throw new Error(
          `Ficha ${ficha.id}: exclusión «${value}» desconocida (válidas: ${EXCLUSIONES.join(', ')}).`
        )
      }
    }
    if (exclusiones === undefined || exclusiones.length > 0) {
      prs.push({ fichas: [ficha.id], fusionaDani: true })
      continue
    }
    current.push(ficha.id)
    if (current.length === MAX_GROUP) {
      prs.push({ fichas: current, fusionaDani: false })
      current = []
    }
  }
  if (current.length > 0) prs.push({ fichas: current, fusionaDani: false })
  return prs
}

function git(args, execFile) {
  return execFile('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
}

const USAGE = [
  'Uso: node scripts/integrate.mjs <ruta de la ficha> <zona>',
  '     node scripts/integrate.mjs --agrupar <ficha> [<ficha> …]  (en el orden de la cola)'
].join('\n')

export function main({ argv, readFile, execFile, stdout, stderr }) {
  if (argv[0] === '--agrupar') {
    const paths = argv.slice(1)
    if (paths.length === 0) {
      stderr(USAGE)
      return 2
    }
    const fichas = paths.map((file) => parseFrontMatter(readFile(file)))
    try {
      stdout(JSON.stringify(groupForPrs(fichas), null, 2))
    } catch (error) {
      stderr(error instanceof Error ? error.message : String(error))
      return 1
    }
    return 0
  }
  const [path, zona] = argv
  if (!path || !zona) {
    stderr(USAGE)
    return 2
  }
  const ficha = parseFrontMatter(readFile(path))
  const clean = git(['status', '--porcelain'], execFile).trim() === ''
  const branch = git(['branch', '--show-current'], execFile).trim()
  const reasons = checkIntegration({ ficha, clean, branch })
  if (reasons.length > 0) {
    for (const reason of reasons) stderr(reason)
    return 1
  }
  stdout(buildCommitMessage(ficha, zona))
  return 0
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main({
    argv: process.argv.slice(2),
    readFile: (file) => readFileSync(file, 'utf8'),
    execFile: execFileSync,
    stdout: (message) => process.stdout.write(`${message}\n`),
    stderr: (message) => process.stderr.write(`${message}\n`)
  })
}
