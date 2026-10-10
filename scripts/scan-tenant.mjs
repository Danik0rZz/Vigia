// Busca restos del tenant real de pruebas en un rango de git antes de hacer push.
//
// Uso: npm run scan:tenant -- [rango]   (por defecto origin/main..HEAD)
//      node scripts/scan-tenant.mjs --pre-push   (lo lanza .githooks/pre-push: lee de la
//      entrada estándar las líneas que git pasa al hook y escanea lo que de verdad se sube)
//
// Lee .env.live.local (del directorio de trabajo o, si no está, del checkout principal) en
// tiempo de ejecución y NUNCA imprime sus valores: solo el tipo de coincidencia y
// fichero:línea (o el hash del commit). Busca en las líneas añadidas del diff y en los
// mensajes de commit del rango. Sale con 1 si encuentra algo, con 0 si no y con 2 si no puede
// comprobar: un error de git o la falta del .env, o un .env sin valores reconocibles (falla
// cerrado, ficha 0055), salvo con VIGIA_SCAN_TENANT_OPTIONAL=1 para lo del .env, que lo
// convierte en un aviso y sale con 0. Con --pre-push y la entrada vacía (git no sube ningún
// ref) sale con 0.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { findLiveEnv, LIVE_ENV_FILE } from './lib/env-file.mjs'

export const DEFAULT_RANGE = 'origin/main..HEAD'
export const OPTIONAL_VAR = 'VIGIA_SCAN_TENANT_OPTIONAL'
const NEW_BRANCH_BASE = 'origin/main'
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

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 })
}

/**
 * Busca los valores del .env en el rango (o en varios, con `ranges`). Sin
 * `envPath`, el .env se busca con findLiveEnv (cwd y, si no, checkout
 * principal). Devuelve { envFound: false } si no hay .env, o
 * { envFound: true, kinds, count, hits } con hits = ['tipo: fichero:línea', …].
 */
export function scan({ cwd = process.cwd(), range = DEFAULT_RANGE, ranges, envPath } = {}) {
  const fullEnvPath = envPath === undefined ? findLiveEnv(cwd) : resolve(cwd, envPath)
  if (fullEnvPath === undefined || !existsSync(fullEnvPath)) return { envFound: false }

  const needles = extractNeedles(readFileSync(fullEnvPath, 'utf8'))
  const hits = []
  for (const one of ranges ?? [range]) hits.push(...scanRange(cwd, one, needles))
  return {
    envFound: true,
    kinds: [...new Set(needles.map((n) => n.kind))],
    count: needles.length,
    hits
  }
}

function scanRange(cwd, range, needles) {
  const hits = []

  let file = ''
  let lineNo = 0
  for (const line of git(cwd, ['diff', '--unified=0', '--no-color', range]).split('\n')) {
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
        if (lower.includes(needle.value)) hits.push(`${needle.kind}: ${file}:${lineNo}`)
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
    result = scan({ ranges })
  } catch (error) {
    // El mensaje de git no lleva valores del .env: solo el rango o la ruta.
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
  return result.hits.length > 0 ? 1 : 0
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)))
}
