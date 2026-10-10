// Job `cambios` del CI (ficha 0072): decide si una PR a main trae algo más que documentos.
//
// Uso (en el CI): node scripts/ci-changes.mjs
//
// Lee GITHUB_EVENT_NAME y escribe `codigo=true|false` en GITHUB_OUTPUT. Fuera de pull_request
// (push a main o workflow_dispatch) siempre es `true`: el push ya filtra con su paths-ignore. En
// pull_request compara el commit de fusión que hace GitHub (refs/pull/N/merge) con su primer
// padre, que es main: son justo los ficheros que la PR cambia (el checkout necesita fetch-depth 2).
import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

/**
 * Lo que no cuenta como código. Es la única lista: el paths-ignore del push de ci.yml tiene que
 * coincidir con ella (lo comprueba scripts/ci-changes.test.ts).
 */
export const NON_CODE_PATTERNS = ['**/*.md', 'docs/**', 'tasks/**', '.claude/**']

/** Glob a expresión regular: `**` cruza carpetas, `*` no. Basta para los globs de arriba. */
export function globToRegExp(glob) {
  let source = ''
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i]
    if (glob.startsWith('**/', i)) {
      source += '(?:.*/)?'
      i += 2
    } else if (glob.startsWith('**', i)) {
      source += '.*'
      i += 1
    } else if (char === '*') {
      source += '[^/]*'
    } else {
      source += char.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    }
  }
  return new RegExp(`^${source}$`)
}

const NON_CODE = NON_CODE_PATTERNS.map(globToRegExp)

/** Pura: `codigo` es true si algún fichero no es un documento. Una lista vacía no trae código. */
export function classifyChanges(files) {
  const codigo = files.some((file) => !NON_CODE.some((pattern) => pattern.test(file)))
  return { codigo }
}

/** Ficheros que cambia la PR, separados por NUL para no depender de cómo cita git las rutas. */
export function changedFiles(execFile = execFileSync) {
  const output = execFile('git', ['diff', '--name-only', '-z', 'HEAD^1', 'HEAD'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit']
  })
  return output.split('\0').filter(Boolean)
}

export function main({ env, execFile, appendOutput, stdout }) {
  let codigo = true
  if (env.GITHUB_EVENT_NAME === 'pull_request') {
    const files = changedFiles(execFile)
    codigo = classifyChanges(files).codigo
    stdout(`${files.length} ficheros cambiados; código: ${codigo ? 'sí' : 'no'}`)
  } else {
    stdout(`Evento ${env.GITHUB_EVENT_NAME ?? '(sin evento)'}: se prueba todo`)
  }
  if (env.GITHUB_OUTPUT) appendOutput(env.GITHUB_OUTPUT, `codigo=${codigo}\n`)
  return codigo
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main({
    env: process.env,
    execFile: execFileSync,
    appendOutput: (path, text) => appendFileSync(path, text),
    stdout: (message) => process.stdout.write(`${message}\n`)
  })
}

// Prueba de la 0072: PR con un cambio de código inocuo. Se cierra sin fusionar.
