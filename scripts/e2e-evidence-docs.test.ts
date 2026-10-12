import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Ficha 0107, CA5: los agentes saben de las evidencias (test de texto, como los de
 * `integration-docs.test.ts`).
 * - `.claude/agents/test-writer.md` pide `captureEvidence` en los e2e de los criterios que cambian
 *   algo visible.
 * - `.claude/agents/verifier.md` pide una tirada más de los e2e de la ficha con
 *   `VIGIA_EVIDENCIAS=1`, da la ruta del manifiesto (`manifiesto.json`) en su informe y dice que esa
 *   tirada no cambia su resultado.
 *
 * Se busca por párrafos (bloques separados por una línea en blanco), con los saltos de línea y
 * espacios juntados en uno: lo que se pide tiene que ir junto, no en sitios sueltos del fichero.
 */

const TEST_WRITER = '.claude/agents/test-writer.md'
const VERIFIER = '.claude/agents/verifier.md'

function paragraphs(file: string): string[] {
  return readFileSync(file, 'utf8')
    .split(/\r?\n\s*\r?\n/)
    .map((block) => block.replace(/\s+/g, ' ').trim())
}

describe('CA5 (0107): test-writer y verifier piden las evidencias', () => {
  it('CA5 (0107): test-writer.md pide captureEvidence en los e2e de los criterios visibles', () => {
    const found = paragraphs(TEST_WRITER).filter(
      (block) => /`captureEvidence`/.test(block) && /visible/i.test(block)
    )
    expect(
      found,
      `${TEST_WRITER}: un párrafo con captureEvidence y los criterios visibles`
    ).not.toEqual([])
  })

  it('CA5 (0107): verifier.md pide la tirada con VIGIA_EVIDENCIAS=1 y la ruta del manifiesto', () => {
    const found = paragraphs(VERIFIER).filter(
      (block) => /VIGIA_EVIDENCIAS=1/.test(block) && /manifiesto/i.test(block)
    )
    expect(found, `${VERIFIER}: un párrafo con VIGIA_EVIDENCIAS=1 y el manifiesto`).not.toEqual([])
  })

  it('CA5 (0107): verifier.md dice que la tirada de evidencias no cambia su resultado', () => {
    const found = paragraphs(VERIFIER).filter(
      (block) =>
        /VIGIA_EVIDENCIAS=1/.test(block) &&
        /(no cambia|sin (que )?cambiar|sin que cambie)[^.]*resultado/i.test(block)
    )
    expect(found, `${VERIFIER}: junto a la tirada, que no cambia el resultado`).not.toEqual([])
  })
})
