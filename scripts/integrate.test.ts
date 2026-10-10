import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Ficha 0073: integración por PR. `scripts/integrate.mjs` compone el mensaje del commit de una
 * ficha (uno por ficha, con `git merge --squash`), comprueba que se puede integrar y agrupa las
 * fichas de la cola en PR.
 *
 * Contrato que fijan estos tests (la ficha solo daba los nombres de `integrate.mjs` y `groupForPrs`):
 * - Todo se exporta desde `scripts/integrate.mjs`; importarlo no lanza nada (el `main` solo corre
 *   si se ejecuta con `node`).
 * - `parseFrontMatter(texto)` devuelve el front matter de una ficha como objeto: los escalares sin
 *   comillas ni comentario final (`id`, `titulo`, `estado`, `rama`, `ligera`...) y las listas como
 *   arrays de cadenas (`exclusiones: [ipc, api]` → `['ipc', 'api']`; `[]` → `[]`). Una clave que no
 *   está no aparece (`exclusiones` queda `undefined`).
 * - `buildCommitMessage(ficha, zona)` devuelve `<tipo>(<zona>): <titulo> (#<id>)`, con `tipo` `fix`
 *   si la rama empieza por `fix/` y `feat` si no. La zona la da el Orquestador: el front matter no
 *   la tiene.
 * - `checkIntegration({ ficha, clean, branch })` devuelve la lista de motivos (cadenas en español)
 *   por los que no se puede integrar; vacía si se puede. `clean` dice si el árbol está limpio y
 *   `branch` es la rama actual.
 * - `groupForPrs(fichas)` recibe las fichas en el orden de la cola (`{ id, exclusiones?, ... }`) y
 *   devuelve las PR: `{ fichas: string[], fusionaDani: boolean }[]`, con los id de cada PR en el
 *   orden de la cola. Lanza un `Error` si una ficha trae una exclusión fuera de la lista.
 * - `EXCLUSIONES` es la lista de valores válidos del campo `exclusiones`.
 */

const SCRIPT = join(__dirname, 'integrate.mjs')
const TEMPLATE = join(__dirname, '..', 'tasks', '_PLANTILLA.md')

interface Ficha {
  id: string
  titulo?: string
  estado?: string
  rama?: string
  ligera?: string
  exclusiones?: string[]
  [key: string]: unknown
}

interface Pr {
  fichas: string[]
  fusionaDani: boolean
}

interface Api {
  parseFrontMatter: (text: string) => Ficha
  buildCommitMessage: (ficha: Ficha, zona: string) => string
  checkIntegration: (input: { ficha: Ficha; clean: boolean; branch: string }) => string[]
  groupForPrs: (fichas: Ficha[]) => Pr[]
  EXCLUSIONES: string[]
}

// Si el script aún no existe, solo fallan los tests que lo usan.
const loaded = existsSync(SCRIPT) ? ((await import(pathToFileURL(SCRIPT).href)) as Api) : undefined
function api(): Api {
  if (!loaded) throw new Error('No existe scripts/integrate.mjs')
  return loaded
}

const SIX = ['ipc', 'api', 'dependencias', 'esquema', 'seguridad', 'externos']

/** Ficha inventada con el formato de `tasks/`. */
function fichaText(fields: Record<string, string>): string {
  const lines = Object.entries(fields).map(([key, value]) => `${key}: ${value}`)
  return ['---', ...lines, '---', '', '## Petición original', '', 'Texto.', ''].join('\n')
}

const VERIFIED = fichaText({
  id: "'0099'",
  titulo: "'Agrupa los avisos: por zona y por día' # comentario que no cuenta",
  estado: 'verificada # borrador | aprobada | verificada',
  tamano: 'S',
  ligera: 'no',
  rama: 'feat/0099-agrupa-avisos',
  exclusiones: '[] # ipc | api | dependencias | esquema | seguridad | externos',
  depende_de: "['0098']"
})

function queued(id: string, exclusiones: string[] | undefined, ligera = 'no'): Ficha {
  return exclusiones === undefined ? { id, ligera } : { id, ligera, exclusiones }
}

describe('CA1 (0073): mensaje del commit desde el front matter', () => {
  it('lee id, título, estado, rama y exclusiones sin comillas ni comentarios', () => {
    const ficha = api().parseFrontMatter(VERIFIED)
    expect(ficha).toMatchObject({
      id: '0099',
      titulo: 'Agrupa los avisos: por zona y por día',
      estado: 'verificada',
      rama: 'feat/0099-agrupa-avisos',
      ligera: 'no',
      exclusiones: []
    })
  })

  it('lee una lista de exclusiones y deja undefined si no está el campo', () => {
    const { parseFrontMatter } = api()
    const conDos = fichaText({ id: "'0100'", exclusiones: '[ipc, externos]' })
    expect(parseFrontMatter(conDos).exclusiones).toEqual(['ipc', 'externos'])
    const sinCampo = fichaText({ id: "'0101'", estado: 'verificada' })
    expect(parseFrontMatter(sinCampo).exclusiones).toBeUndefined()
  })

  it('rama feat/: feat(zona): título (#NNNN)', () => {
    const { parseFrontMatter, buildCommitMessage } = api()
    expect(buildCommitMessage(parseFrontMatter(VERIFIED), 'avisos')).toBe(
      'feat(avisos): Agrupa los avisos: por zona y por día (#0099)'
    )
  })

  it('rama fix/: fix(zona): título (#NNNN)', () => {
    const { buildCommitMessage } = api()
    const ficha: Ficha = {
      id: '0042',
      titulo: 'Corrige el orden de los problemas',
      estado: 'verificada',
      rama: 'fix/0042-ci'
    }
    expect(buildCommitMessage(ficha, 'problemas')).toBe(
      'fix(problemas): Corrige el orden de los problemas (#0042)'
    )
  })

  it('con todo en orden, no hay motivos para negarse', () => {
    const { parseFrontMatter, checkIntegration } = api()
    const ficha = parseFrontMatter(VERIFIED)
    expect(checkIntegration({ ficha, clean: true, branch: 'feat/0099-agrupa-avisos' })).toEqual([])
  })

  it('se niega si la ficha no está verificada', () => {
    const { parseFrontMatter, checkIntegration } = api()
    for (const estado of ['aprobada', 'en_revision', 'hecha', 'bloqueada']) {
      const ficha = { ...parseFrontMatter(VERIFIED), estado }
      const reasons = checkIntegration({ ficha, clean: true, branch: 'feat/0099-agrupa-avisos' })
      expect(reasons, estado).toHaveLength(1)
      expect(reasons[0]).toMatch(/verificada/)
    }
  })

  it('se niega con el árbol sucio', () => {
    const { parseFrontMatter, checkIntegration } = api()
    const ficha = parseFrontMatter(VERIFIED)
    const reasons = checkIntegration({ ficha, clean: false, branch: 'feat/0099-agrupa-avisos' })
    expect(reasons).toHaveLength(1)
  })

  it('se niega con una rama que no es la de la ficha', () => {
    const { parseFrontMatter, checkIntegration } = api()
    const ficha = parseFrontMatter(VERIFIED)
    for (const branch of ['main', 'feat/0098-otra', 'integra/20261011-1']) {
      expect(checkIntegration({ ficha, clean: true, branch }), branch).toHaveLength(1)
    }
  })

  it('junta todos los motivos si falla más de una cosa', () => {
    const { parseFrontMatter, checkIntegration } = api()
    const ficha = { ...parseFrontMatter(VERIFIED), estado: 'aprobada' }
    expect(checkIntegration({ ficha, clean: false, branch: 'main' })).toHaveLength(3)
  })
})

describe('CA2 (0073): groupForPrs agrupa la cola en PR', () => {
  it('una ficha con alguna exclusión va sola y la fusiona Dani', () => {
    for (const value of SIX) {
      expect(api().groupForPrs([queued('0101', [value])]), value).toEqual([
        { fichas: ['0101'], fusionaDani: true }
      ])
    }
  })

  it('una ficha sin el campo exclusiones también va sola y la fusiona Dani', () => {
    expect(api().groupForPrs([queued('0101', undefined)])).toEqual([
      { fichas: ['0101'], fusionaDani: true }
    ])
  })

  it('tres sin exclusiones forman una PR, sean rápidas, normales o mezcladas', () => {
    const { groupForPrs } = api()
    const cases: Record<string, string[]> = {
      rápidas: ['sí', 'sí', 'sí'],
      normales: ['no', 'no', 'no'],
      mezcladas: ['sí', 'no', 'sí']
    }
    for (const [name, ligeras] of Object.entries(cases)) {
      const cola = ligeras.map((ligera, i) => queued(`010${i + 1}`, [], ligera))
      expect(groupForPrs(cola), name).toEqual([
        { fichas: ['0101', '0102', '0103'], fusionaDani: false }
      ])
    }
  })

  it('seis sin exclusiones: una PR de 5 y otra de 1 si la cola acaba ahí', () => {
    const cola = ['0101', '0102', '0103', '0104', '0105', '0106'].map((id) => queued(id, []))
    expect(api().groupForPrs(cola)).toEqual([
      { fichas: ['0101', '0102', '0103', '0104', '0105'], fusionaDani: false },
      { fichas: ['0106'], fusionaDani: false }
    ])
  })

  it('una ficha sola en medio no corta el grupo en curso', () => {
    const cola = [
      queued('0101', []),
      queued('0102', []),
      queued('0103', ['esquema']),
      queued('0104', []),
      queued('0105', undefined),
      queued('0106', [])
    ]
    const prs = api().groupForPrs(cola)
    expect(prs).toHaveLength(3)
    expect(prs).toContainEqual({ fichas: ['0101', '0102', '0104', '0106'], fusionaDani: false })
    expect(prs).toContainEqual({ fichas: ['0103'], fusionaDani: true })
    expect(prs).toContainEqual({ fichas: ['0105'], fusionaDani: true })
  })

  it('respeta el orden de la cola dentro de cada grupo', () => {
    const ids = ['0110', '0104', '0107', '0102', '0109', '0101', '0108']
    const cola = ids.map((id) => queued(id, []))
    expect(api().groupForPrs(cola)).toEqual([
      { fichas: ['0110', '0104', '0107', '0102', '0109'], fusionaDani: false },
      { fichas: ['0101', '0108'], fusionaDani: false }
    ])
  })

  it('cada ficha de la cola sale en una sola PR', () => {
    const cola = [
      queued('0101', []),
      queued('0102', ['api', 'ipc']),
      queued('0103', []),
      queued('0104', [])
    ]
    const ids = api()
      .groupForPrs(cola)
      .flatMap((pr) => pr.fichas)
    expect([...ids].sort()).toEqual(['0101', '0102', '0103', '0104'])
  })

  it('la cola vacía no da ninguna PR', () => {
    expect(api().groupForPrs([])).toEqual([])
  })
})

describe('CA4 (0073): campo exclusiones en la plantilla y valores válidos', () => {
  const template = existsSync(TEMPLATE) ? readFileSync(TEMPLATE, 'utf8') : ''
  const frontMatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(template)?.[1] ?? ''
  const line = /^exclusiones:.*$/m.exec(frontMatter)?.[0] ?? ''

  it('tasks/_PLANTILLA.md tiene el campo exclusiones en su front matter, vacío por defecto', () => {
    expect(line, 'línea exclusiones: del front matter').not.toBe('')
    expect(line).toMatch(/^exclusiones:\s*\[\]/)
  })

  it('la plantilla nombra los seis valores posibles', () => {
    for (const value of SIX) expect(line, value).toMatch(new RegExp(`\\b${value}\\b`))
  })

  it('EXCLUSIONES son exactamente los seis valores', () => {
    expect([...api().EXCLUSIONES].sort()).toEqual([...SIX].sort())
  })

  it('groupForPrs rechaza un valor que no está en la lista', () => {
    const { groupForPrs } = api()
    for (const value of ['IPC', 'red', 'base-de-datos', '']) {
      expect(() => groupForPrs([queued('0101', []), queued('0102', [value])]), value).toThrow(Error)
    }
  })

  it('groupForPrs acepta cualquiera de los seis', () => {
    expect(() => api().groupForPrs([queued('0101', SIX)])).not.toThrow()
  })
})
