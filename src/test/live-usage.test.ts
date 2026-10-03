import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Que la guarda de solo lectura no se pueda saltar: las pruebas en vivo
 * (src/**\/*.live.test.ts) solo llegan al tenant a través de createLiveClient.
 * Revisión estática de los ficheros versionados y sin seguimiento.
 */

function files(pattern: RegExp): string[] {
  return execFileSync('git', ['ls-files', '-co', '--exclude-standard', 'src'], { encoding: 'utf8' })
    .split('\n')
    .map((file) => file.trim())
    .filter((file) => pattern.test(file))
}

/** Código sin comentarios, para que una mención en un comentario no cuente. */
function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
}

const LIVE_TESTS = files(/\.live\.test\.ts$/)

const FORBIDDEN_IN_LIVE_TESTS: [RegExp, string][] = [
  [/\bcreateDtClient\b/, 'usa createDtClient (tiene que ser createLiveClient)'],
  [/(^|[^.\w])fetch\s*\(/m, 'llama a fetch directamente'],
  [/\bglobalThis\.fetch\b/, 'usa globalThis.fetch'],
  [/\bnew\s+Request\b/, 'construye un Request'],
  [/['"]node:(https?|net|tls|http2)['"]/, 'importa un módulo de red de Node'],
  [/['"](https?|net|tls|http2)['"]/, 'importa un módulo de red de Node'],
  [/['"]undici['"]/, 'importa undici'],
  [/['"]axios['"]/, 'importa axios'],
  [/['"]electron['"]/, 'importa electron (net)'],
  [
    /from\s+['"][^'"]*dynatrace\/(client|network|oauth|services)['"]/,
    'importa el cliente o la red de la app sin pasar por createLiveClient'
  ]
]

describe('uso de la red en las pruebas en vivo', () => {
  it('hay al menos un *.live.test.ts que revisar', () => {
    expect(LIVE_TESTS.length).toBeGreaterThan(0)
  })

  it.each(LIVE_TESTS)('%s solo llega al tenant por createLiveClient', (file) => {
    const source = code(file)
    const problems = FORBIDDEN_IN_LIVE_TESTS.filter(([pattern]) => pattern.test(source)).map(
      ([, reason]) => `${file}: ${reason}`
    )
    expect(problems).toEqual([])
    expect(source, `${file}: no importa createLiveClient`).toMatch(
      /import\s*\{[^}]*\bcreateLiveClient\b[^}]*\}\s*from\s*['"][^'"]*test\/live-client['"]/
    )
  })
})

describe('el helper de vivo', () => {
  const helper = code('src/test/live-client.ts')

  it('createDtClient recibe el fetch envuelto, nunca el de Node ni el inyectado sin envolver', () => {
    const fetchFor = /fetchFor\s*:\s*([^,\n}]+)/.exec(helper)?.[1] ?? ''
    expect(fetchFor, 'fetchFor declarado').not.toBe('')
    expect(fetchFor).not.toMatch(/=>\s*(fetch|globalThis\.fetch|options\.fetch|base)\s*$/)
  })

  it('no exporta el fetch sin envolver', () => {
    expect(helper).not.toMatch(/export\s+(const|let|function)\s+(fetch|rawFetch|baseFetch)\b/)
  })
})

describe('el código de la app no usa el arnés de vivo', () => {
  it('nada fuera de src/test y de los *.live.test.ts importa src/test/', () => {
    const offenders = files(/\.(ts|tsx)$/)
      .filter((file) => !file.startsWith('src/test/') && !/\.live\.test\.ts$/.test(file))
      .filter((file) => /from\s+['"][^'"]*\/test\/live-(client|env|setup)['"]/.test(code(file)))
    expect(offenders).toEqual([])
  })
})
