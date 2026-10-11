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

/**
 * Ficha 0099: en la PR de una ficha sola, Dani activa el auto-merge de GitHub («Enable auto-merge»
 * con «Create a merge commit») y GitHub la fusiona con «CI ok» en verde. El Orquestador avisa al
 * abrir la PR, la sondea con `gh pr view <n> --json state` y, al salir `MERGED`, hace «Traer
 * `main`» sin esperar a que Dani diga que está fusionada. Nunca activa el auto-merge él.
 */

/** Líneas de `text` desde la primera que cumple `start` hasta la anterior a la que cumple `end`. */
function sliceLines(text: string, start: RegExp, end: RegExp): string {
  const lines = text.split(/\r?\n/)
  const from = lines.findIndex((line) => start.test(line))
  if (from < 0) return ''
  const rest = lines.slice(from + 1)
  const to = rest.findIndex((line) => end.test(line))
  return [lines[from], ...(to < 0 ? rest : rest.slice(0, to))].join('\n')
}

/** Frases (cortadas por punto o punto y coma) del texto normalizado. */
function sentences(text: string): string[] {
  return normalize(text)
    .split(/(?<=[.;])\s/)
    .map((sentence) => sentence.trim())
}

/** Viñetas de primer nivel (con sus líneas de continuación) de un bloque de lista. */
function topLevelBullets(text: string): string[] {
  const bullets: string[] = []
  for (const line of text.split(/\r?\n/)) {
    if (/^- /.test(line)) bullets.push(line)
    else if (bullets.length > 0 && /^\s+\S/.test(line)) bullets[bullets.length - 1] += `\n${line}`
  }
  return bullets.map(normalize)
}

/** `gh pr merge … --auto` en código (en línea o en un bloque ```), que activaría el auto-merge. */
function autoMergeCommands(text: string): string[] {
  const fences = text.match(/```[\s\S]*?```/g) ?? []
  const inline = codeSpans(text.replace(/```[\s\S]*?```/g, ''), 'gh pr merge').filter((span) =>
    /(^|\s)--auto\b/.test(span)
  )
  const fenced = fences.flatMap((block) =>
    block.split(/\r?\n/).filter((line) => /gh pr merge\b.*\s--auto\b/.test(line))
  )
  return [...inline, ...fenced.map((line) => line.trim())]
}

const flujoText = (): string => readFileSync(FLUJO, 'utf8')
const tareaText = (): string => readFileSync(TAREA, 'utf8')

/** Sección «Git» de `docs/flujo.md` (hasta el siguiente título de nivel 2). */
const gitSection = (): string => sliceLines(flujoText(), /^## Git\s*$/, /^## /)
/** Viñeta «PR de una ficha sola» de la sección «Git», con sus pasos. */
const singlePrBullet = (): string =>
  topLevelBullets(gitSection()).find((bullet) => /^- \*\*PR de una ficha sola/.test(bullet)) ?? ''
/** Paso 9 (integración) y paso 10 (CI y fusión) de `/tarea`. */
const step9 = (): string => sliceLines(tareaText(), /^9\. /, /^10\. /)
const step10 = (): string => sliceLines(tareaText(), /^10\. /, /^\*\*/)
/** Sección **Aviso** de `/tarea`: su párrafo y su lista. */
const avisoSection = (): string => sliceLines(tareaText(), /^\*\*Aviso\*\* \(/, /^(\*\*|#)/)

describe('CA1 (0099): Dani activa el auto-merge en la PR de una ficha sola', () => {
  it('CA1 (0099): docs/flujo.md, en «Git», tiene la viñeta «PR de una ficha sola»', () => {
    expect(singlePrBullet()).not.toBe('')
  })

  it('CA1 (0099): esa viñeta cuenta que Dani pulsa «Enable auto-merge» con «Create a merge commit»', () => {
    const bullet = singlePrBullet()
    expect(bullet).toMatch(/Enable auto-merge/)
    expect(bullet).toMatch(/Create a merge commit/)
    expect(bullet).toMatch(/Dani/)
  })

  it('CA1 (0099): esa viñeta cuenta que GitHub la fusiona cuando «CI ok» sale en verde', () => {
    expect(
      sentences(singlePrBullet()).some(
        (s) => /GitHub/.test(s) && /fusiona/i.test(s) && /CI ok/.test(s) && /verde/i.test(s)
      )
    ).toBe(true)
  })

  it('CA1 (0099): el paso 9 de /tarea pide «Enable auto-merge» con «Create a merge commit»', () => {
    const step = normalize(step9())
    expect(step).toMatch(/Enable auto-merge/)
    expect(step).toMatch(/Create a merge commit/)
  })

  it('CA1 (0099): /tarea cuenta que con el auto-merge la PR se fusiona cuando pasa «CI ok»', () => {
    expect(
      sentences(tareaText()).some(
        (s) => /auto-merge/.test(s) && /fusiona/i.test(s) && /CI ok/.test(s)
      )
    ).toBe(true)
  })
})

describe('autoMergeCommands (la propia comprobación)', () => {
  it('CA2 (0099): detecta gh pr merge con --auto en código, en línea, partido en líneas o en un bloque', () => {
    expect(autoMergeCommands('Fusiona con `gh pr merge 12 --auto --merge`.')).toHaveLength(1)
    expect(autoMergeCommands('Fusiona con `gh pr merge <n>\n  --merge --auto`.')).toHaveLength(1)
    expect(autoMergeCommands('```sh\ngh pr merge 12 --merge --auto\n```')).toHaveLength(1)
  })

  it('CA2 (0099): acepta la prohibición en prosa y la fusión atada al SHA', () => {
    expect(
      autoMergeCommands(
        'El Orquestador nunca usa gh pr merge con --auto ni activa el auto-merge por otra vía.'
      )
    ).toEqual([])
    expect(autoMergeCommands('Nunca pases `--auto`.')).toEqual([])
    expect(
      autoMergeCommands('Fusiona con `gh pr merge <número> --merge --match-head-commit <sha>`.')
    ).toEqual([])
  })
})

describe('CA2 (0099): ningún documento del flujo activa el auto-merge con gh pr merge --auto', () => {
  const files = [...markdownFiles(CLAUDE_DIR), FLUJO]

  it.each(files)('CA2 (0099): %s no tiene `gh pr merge … --auto` en código', (file) => {
    expect(autoMergeCommands(readFileSync(file, 'utf8'))).toEqual([])
  })

  it('CA2 (0099): /tarea dice que el Orquestador nunca activa el auto-merge (ni con --auto)', () => {
    const rule = sentences(tareaText()).filter(
      (s) => /\bnunca\b/i.test(s) && /auto-merge/.test(s) && /--auto\b/.test(s)
    )
    expect(rule.length).toBeGreaterThan(0)
  })
})

describe('CA3 (0099): /tarea sondea la PR de una ficha sola hasta MERGED y trae main', () => {
  it('CA3 (0099): /tarea tiene `gh pr view <número> --json state`', () => {
    const views = codeSpans(tareaText(), 'gh pr view')
    expect(views.some((view) => /^gh pr view \S+ --json state(?![\w,])/.test(view))).toBe(true)
  })

  it('CA3 (0099): el paso 10 sondea la PR de una ficha sola con gh pr view --json state', () => {
    const step = step10()
    expect(normalize(step)).toMatch(/ficha sola/)
    expect(codeSpans(step, 'gh pr view').some((v) => /--json state(?![\w,])/.test(v))).toBe(true)
  })

  it('CA3 (0099): al salir MERGED, el paso 10 hace «Traer `main`»', () => {
    expect(sentences(step10()).some((s) => /MERGED/.test(s) && /Traer `main`/.test(s))).toBe(true)
  })

  it('CA3 (0099): el paso 10 no espera a que Dani escriba «fusionada»', () => {
    expect(
      sentences(step10()).some(
        (s) => /fusionada/.test(s) && /Dani/.test(s) && /\b(no|sin|nunca)\b/i.test(s)
      )
    ).toBe(true)
  })
})

describe('CA4 (0099): el Aviso de parada sale al abrir la PR de una ficha sola y pide el auto-merge', () => {
  const paradaBullet = (): string =>
    topLevelBullets(avisoSection()).find(
      (bullet) => /`estado: parada`/.test(bullet) && /ficha sola/.test(bullet)
    ) ?? ''

  it('CA4 (0099): la sección Aviso tiene el `estado: parada` de la PR de una ficha sola', () => {
    expect(paradaBullet()).not.toBe('')
  })

  it('CA4 (0099): sale al abrir la PR, sin esperar al CI', () => {
    const bullet = paradaBullet()
    expect(bullet).toMatch(/al abrir la PR/)
    expect(bullet).toMatch(/sin esperar (a|al) (el )?CI/i)
  })

  it('CA4 (0099): su decision pide activar el auto-merge, no que la fusione él', () => {
    const bullet = paradaBullet()
    expect(bullet).toMatch(/`decision`[^.]*auto-merge/)
    expect(bullet).toMatch(/Enable auto-merge/)
    expect(bullet).not.toMatch(/que la fusione él/)
  })
})
