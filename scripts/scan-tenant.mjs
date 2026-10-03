// Busca restos del tenant real de pruebas en un rango de git antes de hacer push.
//
// Uso: npm run scan:tenant -- [rango]   (por defecto origin/main..HEAD)
//
// Lee .env.live.local en tiempo de ejecución y NUNCA imprime sus valores: solo
// el tipo de coincidencia y fichero:línea (o el hash del commit). Busca en las
// líneas añadidas del diff y en los mensajes de commit del rango. Sale con 1 si
// encuentra algo, con 0 si no (o si no existe el .env) y con 2 si hay un error.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const DEFAULT_RANGE = 'origin/main..HEAD'
const DEFAULT_ENV = '.env.live.local'

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
 * Busca los valores del .env en el rango. Devuelve { envFound: false } si no
 * hay .env, o { envFound: true, kinds, hits } con hits = ['tipo: fichero:línea', …].
 */
export function scan({ cwd = process.cwd(), range = DEFAULT_RANGE, envPath = DEFAULT_ENV } = {}) {
  const fullEnvPath = resolve(cwd, envPath)
  if (!existsSync(fullEnvPath)) return { envFound: false }

  const needles = extractNeedles(readFileSync(fullEnvPath, 'utf8'))
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

  return {
    envFound: true,
    kinds: [...new Set(needles.map((n) => n.kind))],
    count: needles.length,
    hits
  }
}

export function main(argv) {
  const range = argv[0] ?? DEFAULT_RANGE
  let result
  try {
    result = scan({ range })
  } catch (error) {
    // El mensaje de git no lleva valores del .env: solo el rango o la ruta.
    console.error(
      `scan:tenant: no se ha podido revisar el rango ${range}: ${error.message.split('\n')[0]}`
    )
    return 2
  }
  if (!result.envFound) {
    console.log('scan:tenant: sin .env.live.local: no hay nada que buscar.')
    return 0
  }
  if (result.count === 0) {
    // Existe pero sin valores: no se ha revisado nada y no debe parecer que sí.
    console.warn('AVISO: .env.live.local está vacío; la revisión del tenant NO está activa.')
    return 0
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
