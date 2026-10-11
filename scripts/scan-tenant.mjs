// Busca restos del tenant real de pruebas en un rango de git antes de hacer push.
//
// Uso: npm run scan:tenant -- [rango]   (por defecto origin/main..HEAD)
//      node scripts/scan-tenant.mjs --pre-push   (lo lanza .githooks/pre-push: lee de la
//      entrada estándar las líneas que git pasa al hook y escanea lo que de verdad se sube)
//
// Lee .env.live.local (del directorio de trabajo o, si no está, del checkout principal) en
// tiempo de ejecución y NUNCA imprime sus valores: solo el tipo de coincidencia y
// fichero:línea (o el hash del commit). Busca en las líneas añadidas del diff, en los
// mensajes de commit del rango y en los nombres de los ficheros añadidos, modificados o
// renombrados (ficha 0091; el hallazgo da la carpeta y el tipo, nunca el nombre con el valor).
// Un binario añadido o modificado fuera de build/ no se puede comprobar y sale con 2, salvo con
// VIGIA_SCAN_ALLOW_BINARY=1, que busca en su contenido como texto latin1 y UTF-16LE. Sale con
// 1 si encuentra algo, con 0 si no y con 2 si no puede comprobar: un error de git o la falta
// del .env, o un .env sin valores reconocibles (falla cerrado, ficha 0055), salvo con
// VIGIA_SCAN_TENANT_OPTIONAL=1 para lo del .env, que lo convierte en un aviso y sale con 0.
// Con --pre-push y la entrada vacía (git no sube ningún ref) sale con 0.
//
//      node scripts/scan-tenant.mjs --check-refs   (también del pre-push, antes del escaneo; ficha
//      0088): solo deja publicar en ramas integra/ (o en los refs exactos de
//      VIGIA_PUSH_ALLOW_REFS, separados por comas) y solo con avance rápido. Sale con 1 si algún
//      destino no pasa y con 2 si no puede leer la entrada estándar.
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { findLiveEnv, LIVE_ENV_FILE } from './lib/env-file.mjs'

export const DEFAULT_RANGE = 'origin/main..HEAD'
export const OPTIONAL_VAR = 'VIGIA_SCAN_TENANT_OPTIONAL'
export const ALLOW_REFS_VAR = 'VIGIA_PUSH_ALLOW_REFS'
export const ALLOW_BINARY_VAR = 'VIGIA_SCAN_ALLOW_BINARY'
/** Binarios que se dan por buenos sin mirarlos: hoy, los iconos de build/ (ficha 0091). */
const TRUSTED_BINARY_PREFIX = 'build/'
const NEW_BRANCH_BASE = 'origin/main'
const INTEGRA_PREFIX = 'refs/heads/integra/'
const ZERO_SHA = /^0+$/

/**
 * Valores a buscar a partir del contenido de un .env: host y id de entorno de
 * las URL, id público y un fragmento del secreto de los tokens dt0…, y
 * cualquier otro valor de 12 caracteres o más. Todo en minúsculas.
 */
export function extractNeedles(envText) {
  const needles = []
  for (const raw of envText.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#') || !line.includes('=')) continue
    const value = line
      .slice(line.indexOf('=') + 1)
      .trim()
      .replace(/^["']|["']$/g, '')
    if (value.length < 6) continue

    let matched = false
    try {
      const url = new URL(value)
      if (url.hostname) {
        needles.push({ kind: 'host', value: url.hostname.toLowerCase() })
        const sub = url.hostname.split('.')[0]
        if (sub && sub.length >= 6)
          needles.push({ kind: 'id-de-entorno', value: sub.toLowerCase() })
        matched = true
      }
    } catch {
      // No es una URL.
    }
    const token = /^(dt0[a-z]\d\d)\.([A-Z0-9]+)\.([A-Z0-9]+)$/i.exec(value)
    if (token) {
      needles.push({ kind: 'token-id-publico', value: token[2].toLowerCase() })
      needles.push({ kind: 'token-secreto', value: token[3].slice(8, 24).toLowerCase() })
      matched = true
    }
    if (!matched && value.length >= 12)
      needles.push({ kind: 'otro-valor', value: value.toLowerCase() })
  }
  return needles
}

/**
 * Git con el stderr recogido, nunca heredado (ronda 2 de la 0091): sus avisos llevan rutas
 * enteras (`warning: in the working copy of '<ruta>'…` con core.autocrlf), que pueden llevar un
 * valor. Si git falla, el stderr va en error.stderr y en el mensaje tras la primera línea
 * (`Command failed: git <args>`), que es la única que se imprime.
 */
function git(cwd, args, encoding = 'utf8') {
  return execFileSync('git', args, {
    cwd,
    encoding,
    maxBuffer: 512 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  })
}

function containsNeedle(text, needles) {
  const lower = text.toLowerCase()
  return needles.filter((needle) => lower.includes(needle.value))
}

/**
 * Cómo se nombra una ruta en un hallazgo sin imprimir valores del .env (ficha 0091): cada
 * carpeta o nombre que lleva un valor se cambia entero por un aviso (no se enmascara solo el
 * valor: del secreto de un token solo se busca un fragmento y el resto quedaría a la vista), y
 * del nombre así tapado queda la extensión, si es segura (shownExtension). Si aun así la ruta
 * lleva un valor (uno con «/» repartido entre carpetas), se tapa la ruta entera.
 */
export function safePath(path, needles) {
  const parts = path.split('/')
  const shown = parts
    .map((part, index) => {
      const found = containsNeedle(part, needles)
      if (found.length === 0) return part
      if (index < parts.length - 1) return '<carpeta con un valor del .env>'
      const ext = shownExtension(part, found, needles)
      return ext !== undefined
        ? `<nombre con un valor del .env> (fichero ${ext})`
        : '<nombre con un valor del .env>'
    })
    .join('/')
  return containsNeedle(shown, needles).length === 0 ? shown : '<ruta con un valor del .env>'
}

/**
 * La extensión que se puede enseñar de un nombre que lleva los valores `found` (ronda 2 de la
 * 0091), o undefined: tiene que ser corta, el nombre sin ella tiene que seguir llevando cada uno
 * de `found` (si no, la extensión es el final de un valor) y ningún valor puede contenerla
 * (con `foo.internal`, el nombre `foo.internal.internal` no deja ver `.internal`).
 */
function shownExtension(part, found, needles) {
  const ext = /\.[a-z0-9]{1,8}$/i.exec(part)?.[0]
  if (ext === undefined) return undefined
  const stem = part.slice(0, -ext.length).toLowerCase()
  if (!found.every((needle) => stem.includes(needle.value))) return undefined
  const lowerExt = ext.toLowerCase()
  return needles.some((needle) => needle.value.includes(lowerExt)) ? undefined : ext
}

/**
 * Ficheros del rango que no se borran (añadidos, modificados, cambios de tipo; un renombrado,
 * con --no-renames, sale como borrado del origen y añadido del destino): ruta, blob de destino
 * y si git lo trata como binario (`-` en las dos columnas de --numstat).
 */
function changedFiles(cwd, range) {
  const files = new Map()
  const raw = git(cwd, ['diff', '--raw', '-z', '--no-renames', '--no-abbrev', range]).split('\0')
  for (let i = 0; i + 1 < raw.length; i += 2) {
    const meta = /^:\d+ \d+ [0-9a-f]+ ([0-9a-f]+) ([A-Z])/.exec(raw[i])
    if (!meta) throw new Error('salida de git diff --raw con un formato inesperado')
    if (meta[2] !== 'D') files.set(raw[i + 1], { path: raw[i + 1], blob: meta[1], binary: false })
  }
  const numstat = git(cwd, ['diff', '--numstat', '-z', '--no-renames', range]).split('\0')
  for (const entry of numstat) {
    const stat = /^(-|\d+)\t(-|\d+)\t(.*)$/s.exec(entry)
    if (stat && stat[1] === '-' && stat[2] === '-' && files.has(stat[3]))
      files.get(stat[3]).binary = true
  }
  return [...files.values()]
}

/**
 * Contenido de un binario: el blob de destino o, si es el árbol de trabajo (ceros), el disco.
 * El error de Node lleva la ruta absoluta (que puede llevar un valor): se relanza uno con la
 * ruta tapada y solo el código del error.
 */
function binaryContent(cwd, file, needles) {
  if (!ZERO_SHA.test(file.blob)) return git(cwd, ['cat-file', 'blob', file.blob], 'buffer')
  try {
    return readFileSync(resolve(cwd, file.path))
  } catch (error) {
    throw new Error(
      `no se ha podido leer el binario ${safePath(file.path, needles)} (${error.code ?? 'error'})`
    )
  }
}

/** El binario leído como texto latin1 y UTF-16LE (en las dos alineaciones). */
function binaryAsText(content) {
  return [
    content.toString('latin1'),
    content.toString('utf16le'),
    content.subarray(1).toString('utf16le')
  ].join('\n')
}

/**
 * Busca los valores del .env en el rango (o en varios, con `ranges`). Sin
 * `envPath`, el .env se busca con findLiveEnv (cwd y, si no, checkout
 * principal). Devuelve { envFound: false } si no hay .env, o
 * { envFound: true, kinds, count, hits } con hits = ['tipo: fichero:línea', …].
 */
export function scan({
  cwd = process.cwd(),
  range = DEFAULT_RANGE,
  ranges,
  envPath,
  allowBinary = false
} = {}) {
  const fullEnvPath = envPath === undefined ? findLiveEnv(cwd) : resolve(cwd, envPath)
  if (fullEnvPath === undefined || !existsSync(fullEnvPath)) return { envFound: false }

  const needles = extractNeedles(readFileSync(fullEnvPath, 'utf8'))
  const hits = []
  const binaries = []
  for (const one of ranges ?? [range]) {
    hits.push(...scanRange(cwd, one, needles))
    const files = scanFiles(cwd, one, needles, allowBinary)
    hits.push(...files.hits)
    for (const path of files.binaries) if (!binaries.includes(path)) binaries.push(path)
  }
  return {
    envFound: true,
    kinds: [...new Set(needles.map((n) => n.kind))],
    count: needles.length,
    hits,
    binaries
  }
}

/**
 * Nombres y binarios del rango (ficha 0091). Devuelve los hallazgos y, sin allowBinary, los
 * binarios fuera de build/ que no se han podido comprobar (rutas ya tapadas con safePath).
 */
function scanFiles(cwd, range, needles, allowBinary) {
  const hits = []
  const binaries = []
  for (const file of changedFiles(cwd, range)) {
    const shown = safePath(file.path, needles)
    for (const needle of containsNeedle(file.path, needles))
      hits.push(`nombre-de-fichero (${needle.kind}): ${shown}`)
    if (!file.binary || file.path.startsWith(TRUSTED_BINARY_PREFIX)) continue
    if (!allowBinary) {
      binaries.push(shown)
      continue
    }
    for (const needle of containsNeedle(binaryAsText(binaryContent(cwd, file, needles)), needles))
      hits.push(`${needle.kind}: ${shown} (contenido binario)`)
  }
  return { hits, binaries }
}

function scanRange(cwd, range, needles) {
  const hits = []

  // core.quotePath=false: la ruta sale tal cual (sin escapes octales) y safePath la puede tapar.
  const diff = git(cwd, ['-c', 'core.quotePath=false', 'diff', '--unified=0', '--no-color', range])
  let file = ''
  let lineNo = 0
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) {
      file = line.startsWith('+++ b/') ? line.slice(6) : line.slice(4)
      continue
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(line)
    if (hunk) {
      lineNo = Number(hunk[1])
      continue
    }
    if (line.startsWith('+')) {
      const lower = line.toLowerCase()
      for (const needle of needles)
        if (lower.includes(needle.value))
          hits.push(`${needle.kind}: ${safePath(file, needles)}:${lineNo}`)
      lineNo += 1
    }
  }

  for (const entry of git(cwd, ['log', '--format=%h%x00%B%x01', range]).split('\x01')) {
    const [hash, body = ''] = entry.trim().split('\x00')
    if (!hash) continue
    const lower = body.toLowerCase()
    for (const needle of needles)
      if (lower.includes(needle.value)) hits.push(`${needle.kind}: mensaje de commit ${hash}`)
  }
  return hits
}

/**
 * Rangos a escanear a partir de la entrada estándar del pre-push de git
 * (`<ref local> <sha local> <ref remota> <sha remota>` por línea): `remota..local`,
 * o `origin/main..local` si la rama remota no existe (sha a ceros). Las líneas de
 * borrado (sha local a ceros) no suben nada y no dan rango. Una línea con otra
 * forma lanza: mejor parar que dar por bueno algo que no se ha entendido.
 */
export function prePushRanges(input) {
  const ranges = []
  for (const raw of String(input).split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '') continue
    const parts = line.split(/\s+/)
    const [, local, , remote] = parts
    if (parts.length !== 4 || !/^[0-9a-f]+$/i.test(local) || !/^[0-9a-f]+$/i.test(remote))
      throw new Error('línea de la entrada estándar con un formato inesperado')
    if (ZERO_SHA.test(local)) continue
    ranges.push(ZERO_SHA.test(remote) ? `${NEW_BRANCH_BASE}..${local}` : `${remote}..${local}`)
  }
  return ranges
}

/**
 * Refs exactos de VIGIA_PUSH_ALLOW_REFS, separados por comas (ficha 0088). Sin comodines ni
 * prefijos: cada uno se compara entero con el ref remoto.
 */
export function allowedRefs(value) {
  if (typeof value !== 'string') return []
  return value
    .split(',')
    .map((ref) => ref.trim())
    .filter((ref) => ref !== '')
}

/**
 * Comprueba los destinos del pre-push (ficha 0088). Por cada línea de la entrada estándar
 * (`<ref local> <sha local> <ref remoto> <sha remoto>`) da como mucho un problema, el primero de:
 * una línea con otra forma, un borrado (SHA local a ceros, como en la 0082), un destino que no es
 * `refs/heads/integra/…` ni está entero en `allowed`, y un push que no es un avance rápido (el SHA
 * remoto no es ceros y no es antecesor del local). `isAncestor(antecesor, descendiente)` devuelve
 * un booleano; si lanza (el commit remoto no está en el clon), se rechaza: falla cerrado.
 * Devuelve la lista de problemas (`{ ref, reason, message }`), vacía si todo pasa. Los mensajes
 * solo llevan el ref remoto, nunca valores del tenant.
 */
export function checkPushRefs(lines, { allowed = [], isAncestor }) {
  const problems = []
  for (const raw of lines) {
    const line = String(raw).trim()
    if (line === '') continue
    const parts = line.split(/\s+/)
    const [, local, ref, remote] = parts
    if (parts.length !== 4 || !/^[0-9a-f]+$/i.test(local) || !/^[0-9a-f]+$/i.test(remote)) {
      problems.push({
        ref: '',
        reason: 'malformed',
        message: 'línea de la entrada estándar con un formato inesperado; no se da por buena'
      })
      continue
    }
    if (ZERO_SHA.test(local)) {
      problems.push({
        ref,
        reason: 'delete',
        message: `${ref}: se borra un ref remoto; los borrados están bloqueados (una rama se borra desde GitHub)`
      })
      continue
    }
    if (!ref.startsWith(INTEGRA_PREFIX) && !allowed.includes(ref)) {
      problems.push({
        ref,
        reason: 'not-integra',
        message: `${ref}: el destino no es una rama integra/; solo se publica en ${INTEGRA_PREFIX}…. Otro destino, como un tag, se publica nombrándolo entero en ${ALLOW_REFS_VAR} (por ejemplo, ${ALLOW_REFS_VAR}=refs/tags/v0.12.0)`
      })
      continue
    }
    if (ZERO_SHA.test(remote)) continue
    let linear
    try {
      linear = isAncestor(remote, local)
    } catch {
      problems.push({
        ref,
        reason: 'unknown-remote',
        message: `${ref}: no se puede comprobar que sea un avance rápido: el commit remoto no está en este clon. Haz git fetch y vuelve a intentarlo`
      })
      continue
    }
    if (!linear) {
      problems.push({
        ref,
        reason: 'not-fast-forward',
        message: `${ref}: no es un avance rápido; el remoto tiene commits que no están en lo que se sube y no se reescribe un ref publicado`
      })
    }
  }
  return problems
}

/**
 * `git merge-base --is-ancestor` en el clon actual: true con 0, false con 1. Si el commit remoto
 * no está en el clon, u otro error de git, lanza (checkPushRefs lo rechaza).
 */
function gitIsAncestor(ancestor, descendant) {
  const present = spawnSync('git', ['cat-file', '-e', `${ancestor}^{commit}`], { stdio: 'ignore' })
  if (present.status !== 0) throw new Error('el commit remoto no está en el clon')
  const result = spawnSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], {
    stdio: 'ignore'
  })
  if (result.status === 0) return true
  if (result.status === 1) return false
  throw new Error('git merge-base no ha podido comprobarlo')
}

/** --check-refs: los destinos del pre-push (ficha 0088). 0 si pasan, 1 si no, 2 si no se lee. */
function checkRefsMain(env) {
  let input
  try {
    input = readFileSync(0, 'utf8')
  } catch (error) {
    console.error(
      `pre-push: no se ha podido leer la entrada estándar: ${error.message.split('\n')[0]}`
    )
    return 2
  }
  const problems = checkPushRefs(String(input).split(/\r?\n/), {
    allowed: allowedRefs(env[ALLOW_REFS_VAR]),
    isAncestor: gitIsAncestor
  })
  for (const problem of problems) console.error(`pre-push: ${problem.message}.`)
  return problems.length > 0 ? 1 : 0
}

/** Lee la entrada estándar del pre-push y la convierte en rangos; código 2 si no se puede. */
function prePushInput() {
  let input
  try {
    input = readFileSync(0, 'utf8')
  } catch (error) {
    return { error: `no se ha podido leer la entrada estándar: ${error.message.split('\n')[0]}` }
  }
  let ranges
  try {
    ranges = prePushRanges(input)
  } catch (error) {
    return { error: error.message }
  }
  return { ranges, empty: input.trim() === '' }
}

/**
 * Sin .env (o con uno sin valores reconocibles) no se puede comprobar: 2, salvo con
 * VIGIA_SCAN_TENANT_OPTIONAL=1, que sale con 0 y un AVISO. Devuelve el código, o
 * undefined si hay valores que buscar.
 */
function checkLiveEnv(env) {
  const envPath = findLiveEnv(process.cwd())
  let problem
  if (envPath === undefined) {
    problem = `falta ${LIVE_ENV_FILE} (ni aquí ni en el checkout principal)`
  } else {
    let needles
    try {
      needles = extractNeedles(readFileSync(envPath, 'utf8'))
    } catch (error) {
      // El mensaje de Node solo lleva la ruta y el código del error, no el contenido.
      problem = `no se ha podido leer ${LIVE_ENV_FILE} (${error.code ?? 'error'})`
    }
    // Vacío o solo con comentarios y claves sin valor: no se revisaría nada.
    if (needles !== undefined && needles.length === 0)
      problem = `${LIVE_ENV_FILE} está vacío o sin valores reconocibles`
  }
  if (problem === undefined) return undefined
  if (env[OPTIONAL_VAR] === '1') {
    console.warn(
      `AVISO: scan:tenant: ${problem} y ${OPTIONAL_VAR}=1: la revisión del tenant NO está activa.`
    )
    return 0
  }
  console.error(
    `scan:tenant: ${problem}: no se puede comprobar y no se da por bueno. En un clon sin tenant de pruebas, ${OPTIONAL_VAR}=1 lo deja pasar con un aviso.`
  )
  return 2
}

export function main(argv, env = process.env) {
  if (argv[0] === '--check-refs') return checkRefsMain(env)
  const prePush = argv[0] === '--pre-push'
  const envCode = checkLiveEnv(env)
  if (envCode !== undefined) return envCode

  let ranges
  if (prePush) {
    const parsed = prePushInput()
    if (parsed.error) {
      console.error(`scan:tenant: ${parsed.error}`)
      return 2
    }
    ranges = parsed.ranges
    if (parsed.empty) {
      // Git lanza el hook aunque no haya nada que subir y omite los refs al día y los
      // rechazados (non-fast-forward…): con 0, el aviso que se ve es el de git.
      console.log(
        'scan:tenant: git no indica ningún ref que subir: todo al día o rechazado por git.'
      )
      return 0
    }
    if (ranges.length === 0) {
      // Solo borrados de ramas remotas: no se sube contenido nuevo.
      console.log('scan:tenant: solo se borran ramas remotas; no se sube nada que revisar.')
      return 0
    }
  } else {
    ranges = [argv[0] ?? DEFAULT_RANGE]
  }
  const range = ranges.join(', ')

  let result
  try {
    result = scan({ ranges, allowBinary: env[ALLOW_BINARY_VAR] === '1' })
  } catch (error) {
    // La primera línea del error de git es `Command failed: git <args>` (rango o hash, no
    // rutas; su stderr va detrás y no se imprime, ver git()); la de leer un binario del disco
    // llega rehecha con la ruta tapada (binaryContent).
    console.error(
      `scan:tenant: no se ha podido revisar el rango ${range}: ${error.message.split('\n')[0]}`
    )
    return 2
  }
  if (!result.envFound || result.count === 0) {
    // Ha desaparecido o se ha vaciado entre la comprobación y la lectura.
    console.error(`scan:tenant: ${LIVE_ENV_FILE} sin valores que buscar: no se puede comprobar.`)
    return 2
  }
  console.log(
    `scan:tenant: rango ${range}; valores buscados: ${result.count} (${result.kinds.join(', ') || 'ninguno'})`
  )
  console.log(`scan:tenant: coincidencias: ${result.hits.length}`)
  for (const hit of result.hits) console.log(`  ${hit}`)
  // Con hallazgos y binarios sin comprobar a la vez, se avisa de los dos y sale con 1.
  if (result.binaries.length > 0) {
    console.error(
      `scan:tenant: ${result.binaries.length} binario(s) fuera de ${TRUSTED_BINARY_PREFIX} que no se pueden comprobar: ${result.binaries.join(', ')}. No se da por bueno. Si has revisado que no llevan datos del tenant, ${ALLOW_BINARY_VAR}=1 busca en su contenido como texto (latin1 y UTF-16LE) y lo deja pasar si no encuentra nada.`
    )
  }
  if (result.hits.length > 0) return 1
  return result.binaries.length > 0 ? 2 : 0
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)))
}
