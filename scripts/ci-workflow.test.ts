import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Ficha 0005: las acciones del CI van en la versión mayor que ya corre con Node 24 (sin el aviso
 * de deprecación de Node 20). Según sus notas de versión oficiales (GitHub, releases), las dos
 * pasaron a Node 24 en la v5.0.0: actions/checkout («Update actions checkout to use node 24»,
 * #2226) y actions/setup-node («Upgrade action to use node24», #1325); su action.yml dice
 * `using: node24` desde la v5.
 */
const EXPECTED: Record<string, string> = {
  'actions/checkout': 'v5',
  'actions/setup-node': 'v5'
}

const WORKFLOW = '.github/workflows/ci.yml'

/** Versiones con las que el workflow usa una acción (`uses: <acción>@<versión>`). */
function versionsOf(workflow: string, action: string): string[] {
  const escaped = action.replace(/[/.-]/g, (char) => `\\${char}`)
  const pattern = new RegExp(`^\\s*(?:-\\s+)?uses:\\s*['"]?${escaped}@([^\\s'"#]+)`, 'gm')
  return [...workflow.matchAll(pattern)].map((match) => match[1] ?? '')
}

describe('versionsOf (la propia comprobación)', () => {
  it('lee la versión con y sin guion, con comillas y con comentario', () => {
    const workflow = [
      '    steps:',
      '      - uses: actions/checkout@v9',
      "        uses: 'actions/checkout@v8' # comentario",
      '      - uses: actions/checkout-otra@v1',
      '      - run: echo actions/checkout@v7'
    ].join('\n')
    expect(versionsOf(workflow, 'actions/checkout')).toEqual(['v9', 'v8'])
  })
})

describe('CA6 (0005): acciones del CI en la versión mayor con Node 24', () => {
  const workflow = readFileSync(WORKFLOW, 'utf8')

  for (const [action, version] of Object.entries(EXPECTED)) {
    it(`${action} va en ${version} en todos sus usos`, () => {
      const used = versionsOf(workflow, action)
      expect(used.length, `${action} en ${WORKFLOW}`).toBeGreaterThan(0)
      expect(used).toEqual(used.map(() => version))
    })
  }
})
