import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Ficha 0073: con la integración por PR, ningún documento de `.claude/` ni `docs/flujo.md` sigue
 * diciendo que el push a `main` es la única forma de integrar ni que el CI lo lanza cada ficha
 * (test de texto, como los de la 0021).
 *
 * Frases que se buscan (con los saltos de línea y espacios juntados en uno), sacadas de los textos
 * del flujo anterior:
 * - «solo `git push origin main`» en una frase que no nombra también las ramas `integra/`.
 * - «cada push es una ficha».
 * - «el CI del push» (el Orquestador sondeaba el CI del push de cada ficha; ahora, el de la PR).
 * - «el CI de cada ficha» / «cada ficha lanza el CI».
 *
 * Y, en positivo, que `docs/flujo.md` y `.claude/commands/tarea.md` cuentan el flujo nuevo.
 */

const CLAUDE_DIR = '.claude'
const FLUJO = 'docs/flujo.md'
const TAREA = '.claude/commands/tarea.md'

/** Ficheros `.md` de `.claude/` (recursivo), con rutas posix. */
function markdownFiles(dir: string): string[] {
  const files: string[] = []
  for (const name of readdirSync(dir)) {
    const path = `${dir}/${name}`
    if (statSync(path).isDirectory()) files.push(...markdownFiles(path))
    else if (name.endsWith('.md')) files.push(path)
  }
  return files
}

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ')
}

const FORBIDDEN: { name: string; pattern: RegExp }[] = [
  { name: 'cada push es una ficha', pattern: /cada push es una ficha/i },
  { name: 'el CI del push', pattern: /\bel CI del push\b/i },
  { name: 'el CI de cada ficha', pattern: /\bCI de cada ficha\b/i },
  { name: 'cada ficha lanza el CI', pattern: /cada ficha (lanza|dispara) (el )?CI/i }
]

/** Frases del texto que contradicen la integración por PR (vacío si ninguna). */
function outdatedPhrases(text: string): string[] {
  const found: string[] = []
  const flat = normalize(text)
  for (const sentence of flat.split(/(?<=[.:;])\s/)) {
    if (/solo `?git push origin main`?/i.test(sentence) && !/integra\//.test(sentence)) {
      found.push(`solo git push origin main: «${sentence.trim()}»`)
    }
  }
  for (const { name, pattern } of FORBIDDEN) {
    const match = pattern.exec(flat)
    if (match) found.push(`${name}: «${match[0]}»`)
  }
  return found
}

describe('outdatedPhrases (la propia comprobación)', () => {
  it('CA5 (0073): detecta el push a main como única forma de integrar, también partido en líneas', () => {
    expect(
      outdatedPhrases('- Push: solo `git push origin main`, y solo con el reviewer.')
    ).toHaveLength(1)
    expect(
      outdatedPhrases('Push: solo\n  `git push origin main`, y solo con el reviewer.')
    ).toHaveLength(1)
  })

  it('CA5 (0073): acepta el push a main junto a las ramas de integración', () => {
    const text =
      'Push: solo `git push origin main` y `git push origin integra/<nombre>`, nunca --force.'
    expect(outdatedPhrases(text)).toEqual([])
  })

  it('CA5 (0073): detecta que el CI lo lanza cada ficha', () => {
    expect(outdatedPhrases('Hoy cada push\nes una ficha.')).toHaveLength(1)
    expect(outdatedPhrases('Sondea el CI del push en segundo plano.')).toHaveLength(1)
    expect(outdatedPhrases('Se espera al CI de cada ficha.')).toHaveLength(1)
  })

  it('CA5 (0073): no se queja del CI de una PR ni del push a main del CI', () => {
    expect(
      outdatedPhrases('Sondea el CI de la PR. El push a `main` pasa check y dist:win.')
    ).toEqual([])
  })
})

describe('CA5 (0073): documentos del flujo sin la integración de antes', () => {
  const files = [...markdownFiles(CLAUDE_DIR), FLUJO]

  it('hay documentos que revisar (agentes, comandos y flujo)', () => {
    expect(files).toEqual(
      expect.arrayContaining([TAREA, '.claude/commands/cerrar-version.md', FLUJO])
    )
    expect(files.filter((file) => file.startsWith('.claude/agents/')).length).toBeGreaterThan(0)
  })

  it.each(files)(
    'CA5 (0073): %s no dice que se integra solo con el push a main ni que el CI va por ficha',
    (file) => {
      expect(outdatedPhrases(readFileSync(join(file), 'utf8'))).toEqual([])
    }
  )

  it('CA5 (0073): docs/flujo.md cuenta las ramas integra/ y las PR (gh pr create, gh pr merge --merge)', () => {
    const flujo = normalize(readFileSync(FLUJO, 'utf8'))
    expect(flujo).toMatch(/integra\//)
    expect(flujo).toMatch(/gh pr create/)
    expect(flujo).toMatch(/gh pr merge --merge/)
  })

  it('CA5 (0073): /tarea integra con git merge --squash en una rama integra/', () => {
    const tarea = normalize(readFileSync(TAREA, 'utf8'))
    expect(tarea).toMatch(/merge --squash/)
    expect(tarea).toMatch(/integra\//)
  })
})
