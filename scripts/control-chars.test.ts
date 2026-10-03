import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * AUD-17: ningún fichero de texto versionado lleva bytes de control (< 0x20)
 * salvo tabulador, salto de línea y retorno de carro. Un 0x0B o un 0x1B
 * colado (por ejemplo, al pegar una ruta con \v) rompe el renderizado y los diffs.
 */

const EXTENSIONS = /\.(md|ts|tsx|json|yml|yaml|cjs|mjs|css|html)$/i
const ALLOWED = new Set([0x09, 0x0a, 0x0d])

/** Bytes de control prohibidos de un contenido, como "línea:0xNN". */
function controlBytes(content: Buffer): string[] {
  const found: string[] = []
  let line = 1
  for (const byte of content) {
    if (byte === 0x0a) line += 1
    if (byte < 0x20 && !ALLOWED.has(byte)) {
      found.push(`${line}:0x${byte.toString(16).toUpperCase().padStart(2, '0')}`)
    }
  }
  return found
}

describe('controlBytes (la propia comprobación)', () => {
  it('detecta 0x0B, 0x00 y 0x1B con su línea, y deja tab, LF y CR', () => {
    const content = Buffer.from('a\tb\r\nc\x0Bd\ne\x00\x1Bf\n', 'latin1')
    expect(controlBytes(content)).toEqual(['2:0x0B', '3:0x00', '3:0x1B'])
    expect(controlBytes(Buffer.from('limpio\ttab\r\nsí\n', 'utf8'))).toEqual([])
  })

  it('no confunde los bytes de UTF-8 multibyte (á, ñ, €, emojis) con bytes de control', () => {
    expect(controlBytes(Buffer.from('Vigía año € 🙂 ‹ ›', 'utf8'))).toEqual([])
  })
})

describe('ficheros versionados', () => {
  const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
    .split('\n')
    .map((file) => file.trim())
    .filter((file) => EXTENSIONS.test(file))

  it('hay ficheros que revisar', () => {
    expect(files.length).toBeGreaterThan(50)
  })

  it('ninguno lleva bytes de control salvo \\t, \\n y \\r', () => {
    const problems = files.flatMap((file) =>
      controlBytes(readFileSync(file)).map((hit) => {
        const [line, code] = hit.split(':')
        return `${file}:${line} byte ${code}`
      })
    )
    expect(problems).toEqual([])
  })
})
