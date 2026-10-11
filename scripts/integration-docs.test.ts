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

/**
 * Ficha 0090: la fusión va atada al commit que pasó «CI ok». En `/tarea` y `/cerrar-version`, el
 * verde se lee con `gh pr checks <n> --json name,state` (no del texto), el SHA de la cabeza sale de
 * `gh pr view <n> --json headRefOid` y se fusiona con `gh pr merge <n> --merge --match-head-commit
 * <sha>`. Y ningún documento del flujo recomienda `[skip ci]`.
 */

const CERRAR_VERSION = '.claude/commands/cerrar-version.md'
const MERGE_COMMANDS = [TAREA, CERRAR_VERSION]

/** Fragmentos de código en línea (entre comillas invertidas) que empiezan por `prefix`. */
function codeSpans(text: string, prefix: string): string[] {
  const spans = normalize(text).match(/`[^`]+`/g) ?? []
  return spans.map((span) => span.slice(1, -1).trim()).filter((span) => span.startsWith(prefix))
}

describe('CA1 (0090): /tarea y /cerrar-version fusionan atados al commit que pasó «CI ok»', () => {
  it.each(MERGE_COMMANDS)(
    'CA1 (0090): %s fusiona con gh pr merge <n> --merge --match-head-commit <sha>',
    (file) => {
      const merges = codeSpans(readFileSync(file, 'utf8'), 'gh pr merge')
      expect(merges.length).toBeGreaterThan(0)
      for (const merge of merges) {
        expect(merge).toMatch(/^gh pr merge \S+ --merge --match-head-commit \S+/)
      }
    }
  )

  it.each(MERGE_COMMANDS)(
    'CA1 (0090): %s lee «CI ok» con gh pr checks <n> --json name,state, nunca del texto',
    (file) => {
      const text = readFileSync(file, 'utf8')
      const checks = codeSpans(text, 'gh pr checks')
      expect(checks.length).toBeGreaterThan(0)
      for (const check of checks) {
        expect(check).toMatch(/^gh pr checks \S+ --json name,state\b/)
      }
      expect(normalize(text)).toMatch(/CI ok/)
    }
  )

  it.each(MERGE_COMMANDS)(
    'CA1 (0090): %s toma el SHA de la cabeza con gh pr view <n> --json headRefOid',
    (file) => {
      const views = codeSpans(readFileSync(file, 'utf8'), 'gh pr view')
      expect(views.some((view) => /^gh pr view \S+ --json headRefOid\b/.test(view))).toBe(true)
    }
  )
})

const ADR_DIR = 'docs/adr'

/** ADR vigentes: los `NNNN-*.md` cuyo «Estado:» no empieza por «sustituido». */
function currentAdrs(): string[] {
  return readdirSync(ADR_DIR)
    .filter((name) => /^\d{4}-.+\.md$/.test(name))
    .map((name) => `${ADR_DIR}/${name}`)
    .filter((file) => {
      const estado = /^Estado:\s*(.*)$/m.exec(readFileSync(file, 'utf8'))
      return !estado || !/^sustituido/i.test((estado[1] ?? '').trim())
    })
}

/** Frases que mencionan `[skip ci]` sin negarlo (nunca, no, sin, ni): las que lo recomiendan. */
function skipCiRecommendations(text: string): string[] {
  return normalize(text)
    .split(/(?<=[.:;])\s/)
    .filter((sentence) => /\[skip ci\]/i.test(sentence))
    .filter((sentence) => !/\b(nunca|no|sin|ni)\b/i.test(sentence))
    .map((sentence) => sentence.trim())
}

describe('skipCiRecommendations (la propia comprobación)', () => {
  it('CA2 (0090): detecta la frase de hoy del ADR-0013, partida en líneas', () => {
    expect(
      skipCiRecommendations(
        'Si el commit de medición tuviera que ir con código, lleva\n  `[skip ci]`; el resto sigue.'
      )
    ).toHaveLength(1)
  })

  it('CA2 (0090): acepta que se diga que no se usa', () => {
    expect(skipCiRecommendations('Nunca se usa `[skip ci]`: la PR se quedaría sin CI.')).toEqual([])
    expect(
      skipCiRecommendations(
        'La medición va en el commit de documentación; si tiene que ir con código, va en su PR y pasa el CI.'
      )
    ).toEqual([])
  })
})

describe('CA2 (0090): ningún documento del flujo recomienda [skip ci]', () => {
  const files = [...markdownFiles(CLAUDE_DIR), FLUJO, ...currentAdrs()]

  it('CA2 (0090): entre los ADR vigentes está el 0013', () => {
    expect(files).toContain(`${ADR_DIR}/0013-carril-rapido-y-menos-repeticiones.md`)
  })

  it.each(files)('CA2 (0090): %s no recomienda [skip ci]', (file) => {
    expect(skipCiRecommendations(readFileSync(file, 'utf8'))).toEqual([])
  })
})
