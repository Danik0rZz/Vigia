import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 0088 (developer): casos de `checkPushRefs` y `allowedRefs` que no cubren los criterios: falla
 * cerrado si el commit remoto no está en el clon o la línea no se entiende, y la lista de
 * VIGIA_PUSH_ALLOW_REFS se parte por comas sin comodines.
 */

type Problem = { ref: string; reason: string; message: string }

const { checkPushRefs, allowedRefs } = (await import(
  pathToFileURL(join(__dirname, 'scan-tenant.mjs')).href
)) as {
  checkPushRefs: (
    lines: string[],
    options: { allowed: string[]; isAncestor: (a: string, d: string) => boolean }
  ) => Problem[]
  allowedRefs: (value: string | undefined) => string[]
}

const NEW = 'b'.repeat(40)
const OLD = 'a'.repeat(40)

describe('0088 (developer): checkPushRefs falla cerrado', () => {
  it('si isAncestor lanza (el commit remoto no está en el clon), pide git fetch', () => {
    const problems = checkPushRefs([`refs/heads/x ${NEW} refs/heads/integra/1 ${OLD}`], {
      allowed: [],
      isAncestor: () => {
        throw new Error('falta')
      }
    })
    expect(problems).toHaveLength(1)
    expect(problems[0]?.reason).toBe('unknown-remote')
    expect(problems[0]?.message).toContain('git fetch')
  })

  it('una línea con otra forma es un problema, y las vacías se saltan', () => {
    const problems = checkPushRefs(['', 'basura', '  '], { allowed: [], isAncestor: () => true })
    expect(problems.map((p) => p.reason)).toEqual(['malformed'])
  })

  it('el mensaje del destino explica cómo se publica un tag', () => {
    const [problem] = checkPushRefs([`refs/tags/v1 ${NEW} refs/tags/v1 ${'0'.repeat(40)}`], {
      allowed: [],
      isAncestor: () => true
    })
    expect(problem?.message).toContain('VIGIA_PUSH_ALLOW_REFS=refs/tags/')
  })
})

describe('0088 (developer): allowedRefs', () => {
  it('parte por comas, recorta espacios y descarta vacíos', () => {
    expect(allowedRefs(' refs/tags/v1 , ,refs/heads/otra,')).toEqual([
      'refs/tags/v1',
      'refs/heads/otra'
    ])
  })

  it('sin variable, ninguno', () => {
    expect(allowedRefs(undefined)).toEqual([])
    expect(allowedRefs('')).toEqual([])
  })
})
