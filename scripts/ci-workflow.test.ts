import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Tests de los workflows de `.github/workflows/`, sin lanzar el CI: leen el YAML como texto con un
 * lector mínimo (pasos, sus claves y su `with:`), suficiente para los workflows de este repositorio.
 *
 * Ficha 0005: las acciones del CI van en una versión mayor que corre con Node 24 (sin el aviso de
 * deprecación de Node 20). Las dos pasaron a Node 24 en la v5.0.0 (releases oficiales:
 * actions/checkout #2226 y actions/setup-node #1325). Decisión del Orquestador (2026-10-07): v7,
 * la última mayor de las dos, sin cambios incompatibles para este workflow.
 *
 * Ficha 0056: cada acción se fija por SHA de commit (una etiqueta la puede mover el dueño de la
 * acción o quien le robe la cuenta), con la versión en un comentario. Los SHA salen de
 * `git ls-remote https://github.com/actions/<acción> refs/tags/<versión>` (2026-10-10; las cuatro
 * etiquetas son ligeras, así que el SHA es el del commit). Las versiones son a las que apuntaba ese
 * día la etiqueta mayor que ya se usaba (checkout v7 y setup-node v7) o, en las acciones nuevas, la
 * última mayor (upload-artifact v7 y cache v6). Al subir una acción se cambia aquí y en el workflow.
 */
interface PinnedAction {
  major: string
  version: string
  sha: string
}

const PINNED: Record<string, PinnedAction> = {
  'actions/checkout': {
    major: 'v7',
    version: 'v7.0.1',
    sha: '3d3c42e5aac5ba805825da76410c181273ba90b1'
  },
  'actions/setup-node': {
    major: 'v7',
    version: 'v7.1.0',
    sha: '949feb2413d6458794dcd2491c4babbbce0c15c1'
  },
  'actions/upload-artifact': {
    major: 'v7',
    version: 'v7.0.2',
    sha: 'cf430e030ddbb5b0abf93d22962f4752f3646cd9'
  },
  'actions/cache': {
    major: 'v6',
    version: 'v6.1.0',
    sha: '55cc8345863c7cc4c66a329aec7e433d2d1c52a9'
  }
}

const WORKFLOWS_DIR = '.github/workflows'
const CI = join(WORKFLOWS_DIR, 'ci.yml')
const AUDIT = join(WORKFLOWS_DIR, 'audit.yml')

const PROD_AUDIT = 'npm audit --omit=dev --audit-level=high'
const DEV_AUDIT = 'npm audit --audit-level=critical'

interface Step {
  /** Claves del paso (`run`, `uses`, `if`, `continue-on-error`...), con el valor tal cual. */
  fields: Record<string, string>
  /** Claves de su `with:`. */
  with: Record<string, string>
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length
}

function isBlank(line: string): boolean {
  const trimmed = line.trim()
  return trimmed === '' || trimmed.startsWith('#')
}

/** Quita comillas envolventes y el comentario final de un valor escalar. */
function scalar(raw: string): string {
  const value = raw.replace(/\s+#.*$/, '').trim()
  const quoted = /^(['"])(.*)\1$/.exec(value)
  return quoted ? (quoted[2] ?? '') : value
}

/** Pasos de todos los `steps:` del workflow, en orden. */
function stepsOf(workflow: string): Step[] {
  const lines = workflow.split(/\r?\n/)
  const steps: Step[] = []
  for (let i = 0; i < lines.length; i++) {
    const header = /^(\s*)steps:\s*$/.exec(lines[i] ?? '')
    if (!header) continue
    const stepsIndent = (header[1] ?? '').length
    let itemIndent = -1
    let current: string[] | null = null
    const items: string[][] = []
    let j = i + 1
    for (; j < lines.length; j++) {
      const line = lines[j] ?? ''
      if (isBlank(line)) continue
      const indent = indentOf(line)
      if (indent <= stepsIndent) break
      const item = /^(\s*)-\s+(.*)$/.exec(line)
      if (item && (itemIndent === -1 || indent === itemIndent)) {
        itemIndent = indent
        current = [' '.repeat(indent + 2) + (item[2] ?? '')]
        items.push(current)
      } else if (current) {
        current.push(line)
      }
    }
    for (const item of items) steps.push(parseStep(item, itemIndent + 2))
    i = j - 1
  }
  return steps
}

function parseStep(lines: string[], keyIndent: number): Step {
  const step: Step = { fields: {}, with: {} }
  let block: 'with' | 'run' | null = null
  let runLines: string[] = []
  for (const line of lines) {
    if (isBlank(line) && block !== 'run') continue
    const indent = indentOf(line)
    const key = /^\s*([\w-]+):\s*(.*)$/.exec(line)
    if (indent === keyIndent && key) {
      const name = key[1] ?? ''
      const value = key[2] ?? ''
      if (block === 'run') step.fields.run = runLines.join('\n').trim()
      block = null
      if (name === 'with' && value.trim() === '') {
        block = 'with'
      } else if (name === 'run' && /^[|>][-+]?\s*$/.test(value.trim())) {
        block = 'run'
        runLines = []
      } else {
        step.fields[name] = name === 'uses' ? value.trim() : scalar(value)
      }
    } else if (block === 'with' && key && indent > keyIndent) {
      step.with[key[1] ?? ''] = scalar(key[2] ?? '')
    } else if (block === 'run') {
      runLines.push(line.trim())
    }
  }
  if (block === 'run') step.fields.run = runLines.join('\n').trim()
  return step
}

/** Bloque de primer nivel `name:` (líneas con más sangría que él), o `undefined` si no está. */
function topBlock(workflow: string, name: string): string | undefined {
  const lines = workflow.split(/\r?\n/)
  const start = lines.findIndex((line) => new RegExp(`^${name}:`).test(line))
  if (start === -1) return undefined
  const body: string[] = [lines[start] ?? '']
  for (const line of lines.slice(start + 1)) {
    if (!isBlank(line) && indentOf(line) === 0) break
    body.push(line)
  }
  return body.join('\n')
}

interface UsesRef {
  action: string
  ref: string
  comment: string
}

/** Todas las líneas `uses:` del workflow: acción, referencia y comentario final. */
function usesOf(workflow: string): UsesRef[] {
  const pattern = /^\s*(?:-\s+)?uses:\s*['"]?([^@\s'"]+)@([^\s'"#]+)['"]?\s*(?:#\s*(.*))?$/gm
  return [...workflow.matchAll(pattern)].map((match) => ({
    action: match[1] ?? '',
    ref: match[2] ?? '',
    comment: (match[3] ?? '').trim()
  }))
}

function workflowFiles(): string[] {
  return readdirSync(WORKFLOWS_DIR)
    .filter((name) => /\.ya?ml$/.test(name))
    .map((name) => join(WORKFLOWS_DIR, name))
}

/** Contenido del fichero, o vacío si aún no existe (el test falla en su comprobación, no al cargar). */
function read(path: string): string {
  return existsSync(path) ? readFileSync(path, 'utf8') : ''
}

function isRun(step: Step, command: string): boolean {
  return (step.fields.run ?? '').split('\n').some((line) => line.trim() === command)
}

function indexOfRun(steps: Step[], command: string): number {
  return steps.findIndex((step) => isRun(step, command))
}

function indexOfUses(steps: Step[], action: string): number {
  return steps.findIndex((step) => (step.fields.uses ?? '').startsWith(`${action}@`))
}

describe('lector mínimo de workflows (la propia comprobación)', () => {
  const sample = [
    'on:',
    '  push:',
    'jobs:',
    '  a:',
    '    steps:',
    '      - uses: actions/checkout@abc # v1.2.3',
    '        with:',
    '          fetch-depth: 0',
    '      - run: npm ci',
    '      - name: Auditoría',
    "        run: 'npm audit'",
    '        continue-on-error: true',
    '      - run: |',
    '          echo uno',
    '          echo dos',
    '        if: ${{ failure() }}',
    '  b:',
    '    steps:',
    '      - run: echo b'
  ].join('\n')

  it('lee los pasos de todos los jobs con sus claves y su with', () => {
    const steps = stepsOf(sample)
    expect(steps).toHaveLength(5)
    expect(steps[0]?.fields.uses).toBe('actions/checkout@abc # v1.2.3')
    expect(steps[0]?.with['fetch-depth']).toBe('0')
    expect(steps[2]?.fields).toMatchObject({ run: 'npm audit', 'continue-on-error': 'true' })
    expect(steps[3]?.fields.run).toBe('echo uno\necho dos')
    expect(steps[3]?.fields.if).toBe('${{ failure() }}')
    expect(steps[4]?.fields.run).toBe('echo b')
  })

  it('lee acción, referencia y comentario de cada uses', () => {
    expect(usesOf(sample)).toEqual([{ action: 'actions/checkout', ref: 'abc', comment: 'v1.2.3' }])
  })

  it('aísla un bloque de primer nivel', () => {
    expect(topBlock(sample, 'on')).toBe('on:\n  push:')
    expect(topBlock(sample, 'concurrency')).toBeUndefined()
  })
})

describe('CA1 (0056): acciones fijadas por SHA de 40 hexadecimales con su versión', () => {
  const files = workflowFiles()

  it('hay workflows que comprobar (ci.yml y audit.yml)', () => {
    expect(files).toEqual(expect.arrayContaining([CI, AUDIT]))
  })

  for (const file of files) {
    describe(file, () => {
      const uses = usesOf(read(file))

      it('usa al menos una acción', () => {
        expect(uses.length).toBeGreaterThan(0)
      })

      for (const { action, ref, comment } of uses) {
        it(`${action}: SHA de 40 hexadecimales y comentario # vX.Y.Z de la mayor esperada`, () => {
          const pinned = PINNED[action]
          expect(pinned, `${action} no está en la lista de acciones fijadas del test`).toBeDefined()
          expect(ref).toMatch(/^[0-9a-f]{40}$/)
          expect(comment).toMatch(/^v\d+\.\d+\.\d+$/)
          expect(comment.split('.')[0]).toBe(pinned?.major)
          expect({ ref, comment }).toEqual({ ref: pinned?.sha, comment: pinned?.version })
        })
      }
    })
  }

  it('ci.yml usa las cuatro acciones (checkout, setup-node, upload-artifact y cache)', () => {
    const actions = usesOf(read(CI)).map((use) => use.action)
    expect(new Set(actions)).toEqual(new Set(Object.keys(PINNED)))
  })
})

describe('CA6 (0005): acciones del CI en la versión mayor con Node 24', () => {
  const uses = usesOf(read(CI))

  for (const action of ['actions/checkout', 'actions/setup-node']) {
    it(`${action} va en v7 en todos sus usos (versión del comentario)`, () => {
      const majors = uses
        .filter((use) => use.action === action)
        .map((use) => use.comment.split('.')[0])
      expect(majors.length, `${action} en ${CI}`).toBeGreaterThan(0)
      expect(majors).toEqual(majors.map(() => 'v7'))
    })
  }
})

describe('CA2 (0056): npm audit en el CI y revisión semanal', () => {
  for (const file of [CI, AUDIT]) {
    describe(file, () => {
      const steps = stepsOf(read(file))
      const install = indexOfRun(steps, 'npm ci --ignore-scripts')
      const prod = indexOfRun(steps, PROD_AUDIT)
      const dev = indexOfRun(steps, DEV_AUDIT)

      it(`tiene \`${PROD_AUDIT}\` bloqueante tras instalar`, () => {
        expect(install, 'paso npm ci --ignore-scripts').toBeGreaterThanOrEqual(0)
        expect(prod, PROD_AUDIT).toBeGreaterThan(install)
        expect(steps[prod]?.fields['continue-on-error'] ?? 'false').toBe('false')
      })

      it(`tiene \`${DEV_AUDIT}\` no bloqueante (continue-on-error: true) tras instalar`, () => {
        expect(dev, DEV_AUDIT).toBeGreaterThan(install)
        expect(steps[dev]?.fields['continue-on-error']).toBe('true')
      })
    })
  }

  it('audit.yml se lanza por schedule semanal (un cron) y por workflow_dispatch', () => {
    const on = topBlock(read(AUDIT), 'on') ?? ''
    expect(on).toMatch(/^\s+schedule:\s*$/m)
    expect(on).toMatch(/^\s+-\s+cron:\s*['"][^'"]+['"]/m)
    expect(on).toMatch(/^\s+workflow_dispatch:/m)
  })

  it('el cron de audit.yml es semanal: un día de la semana fijo, cualquier día del mes', () => {
    const on = topBlock(read(AUDIT), 'on') ?? ''
    const crons = [...on.matchAll(/cron:\s*['"]([^'"]+)['"]/g)].map((match) => match[1] ?? '')
    expect(crons).toHaveLength(1)
    const [minute, hour, dayOfMonth, month, dayOfWeek] = (crons[0] ?? '').trim().split(/\s+/)
    expect(minute).toMatch(/^\d+$/)
    expect(hour).toMatch(/^\d+$/)
    expect({ dayOfMonth, month }).toEqual({ dayOfMonth: '*', month: '*' })
    expect(dayOfWeek).toMatch(/^[0-6]$/)
  })
})

describe('CA3 (0056): ci.yml sube test-results/ solo si falla, 7 días', () => {
  const steps = stepsOf(read(CI))
  const e2e = indexOfRun(steps, 'npm run test:e2e')
  const upload = indexOfUses(steps, 'actions/upload-artifact')
  const step = steps[upload]

  it('el paso de upload-artifact va tras npm run test:e2e', () => {
    expect(e2e, 'paso npm run test:e2e').toBeGreaterThanOrEqual(0)
    expect(upload, 'paso actions/upload-artifact').toBeGreaterThan(e2e)
  })

  it('solo se ejecuta si falla (if: failure())', () => {
    expect(step?.fields.if?.replace(/^\$\{\{\s*(.*?)\s*\}\}$/, '$1')).toBe('failure()')
  })

  it('sube test-results/ y lo guarda 7 días', () => {
    expect(step?.with.path?.replace(/\/$/, '')).toBe('test-results')
    expect(step?.with['retention-days']).toBe('7')
  })
})

describe('CA4 (0056): runs encolados y caché de Electron', () => {
  const workflow = read(CI)
  const steps = stepsOf(workflow)
  const electronVersion = (
    JSON.parse(read('package.json')) as { devDependencies: Record<string, string> }
  ).devDependencies.electron

  // Desde la 0072 las PR cancelan su run anterior; el push a main sigue encolando (CA5 de la 0072).
  it('concurrency.cancel-in-progress nunca es true sin condición', () => {
    const concurrency = topBlock(workflow, 'concurrency') ?? ''
    expect(concurrency).toMatch(/^\s+cancel-in-progress:/m)
    expect(concurrency).not.toMatch(/cancel-in-progress:\s*true/)
  })

  it('hay un paso de actions/cache antes de npx install-electron', () => {
    const cache = indexOfUses(steps, 'actions/cache')
    const install = indexOfRun(steps, 'npx install-electron')
    expect(install, 'paso npx install-electron').toBeGreaterThanOrEqual(0)
    expect(cache, 'paso actions/cache').toBeGreaterThanOrEqual(0)
    expect(cache).toBeLessThan(install)
  })

  it('la caché es la de Electron, con el sistema y la versión de package.json en la clave', () => {
    const step = steps[indexOfUses(steps, 'actions/cache')]
    expect(electronVersion).toMatch(/^\d+\.\d+\.\d+$/)
    expect(step?.with.path ?? '').toMatch(/electron/i)
    const key = step?.with.key ?? ''
    expect(key).toContain('runner.os')
    expect(key).toContain(electronVersion)
  })
})

/**
 * Ficha 0072: CI en las PR a main. Jobs `cambios` (decide si hay código), `windows` (check y e2e
 * completo, `dist:win` solo fuera de las PR) y `ci-ok` («CI ok», siempre presente).
 */

/** Bloque `name:` con la sangría dada dentro de `parent` (sus líneas con más sangría), o vacío. */
function childBlock(parent: string, name: string, indent: number): string {
  const lines = parent.split(/\r?\n/)
  const start = lines.findIndex((line) => new RegExp(`^ {${indent}}['"]?${name}['"]?:`).test(line))
  if (start === -1) return ''
  const body: string[] = [lines[start] ?? '']
  for (const line of lines.slice(start + 1)) {
    if (!isBlank(line) && indentOf(line) <= indent) break
    body.push(line)
  }
  return body.join('\n')
}

function jobBlock(workflow: string, name: string): string {
  return childBlock(topBlock(workflow, 'jobs') ?? '', name, 2)
}

function onBlock(workflow: string, event: string): string {
  return childBlock(topBlock(workflow, 'on') ?? '', event, 2)
}

/** Valor de una clave escalar directa del job (`if`, `name`, `runs-on`...), sin `${{ }}`. */
function jobField(job: string, key: string): string {
  const match = new RegExp(`^ {4}${key}:\\s*(.*)$`, 'm').exec(job)
  return scalar(match?.[1] ?? '').replace(/^\$\{\{\s*(.*?)\s*\}\}$/, '$1')
}

/** Lista de `needs:` del job, en una línea (`[a, b]` o `a`) o como lista YAML. */
function needsOf(job: string): string[] {
  const inline = /^ {4}needs:\s*(\S.*)$/m.exec(job)
  if (inline) {
    return scalar(inline[1] ?? '')
      .replace(/^\[|\]$/g, '')
      .split(',')
      .map((name) => scalar(name))
      .filter(Boolean)
  }
  const block = childBlock(job, 'needs', 4)
  return [...block.matchAll(/^\s+-\s*(.+)$/gm)].map((match) => scalar(match[1] ?? ''))
}

function stripExpression(value: string | undefined): string {
  return (value ?? '').replace(/^\$\{\{\s*(.*?)\s*\}\}$/, '$1')
}

/** El `if` excluye los pull_request (o solo deja pasar el push). */
function excludesPullRequest(condition: string): boolean {
  return (
    /github\.event_name\s*!=\s*'pull_request'/.test(condition) ||
    /github\.event_name\s*==\s*'push'/.test(condition)
  )
}

describe('CA2 (0072): pull_request a main sin paths-ignore; push a main lo conserva', () => {
  const workflow = read(CI)
  const pullRequest = onBlock(workflow, 'pull_request')
  const push = onBlock(workflow, 'push')

  it('se lanza en pull_request a main', () => {
    expect(pullRequest, 'on.pull_request').not.toBe('')
    expect(pullRequest).toMatch(
      /branches:\s*\[\s*['"]?main['"]?\s*\]|branches:\s*\n\s+-\s*['"]?main/
    )
  })

  it('pull_request no tiene paths-ignore ni paths', () => {
    expect(pullRequest).not.toMatch(/paths-ignore:/)
    expect(pullRequest).not.toMatch(/^\s+paths:/m)
  })

  it('push a main conserva su paths-ignore con los cuatro globs de hoy', () => {
    expect(push).toMatch(/branches:\s*\[\s*['"]?main['"]?\s*\]/)
    expect(push).toMatch(/paths-ignore:/)
    for (const glob of ['**/*.md', 'docs/**', 'tasks/**', '.claude/**']) {
      expect(push).toContain(`'${glob}'`)
    }
  })

  it('sigue teniendo workflow_dispatch', () => {
    expect(topBlock(workflow, 'on') ?? '').toMatch(/^\s{2}workflow_dispatch:/m)
  })
})

describe('CA3 (0072): windows depende de cambios y en las PR no empaqueta', () => {
  const workflow = read(CI)
  const cambios = jobBlock(workflow, 'cambios')
  const windows = jobBlock(workflow, 'windows')
  const steps = stepsOf(windows)

  it('cambios va en ubuntu-latest, usa scripts/ci-changes.mjs y expone la salida codigo', () => {
    expect(cambios, 'job cambios').not.toBe('')
    expect(jobField(cambios, 'runs-on')).toBe('ubuntu-latest')
    expect(cambios).toMatch(/node\s+\.?\/?scripts\/ci-changes\.mjs/)
    expect(childBlock(cambios, 'outputs', 4)).toMatch(/^\s+codigo:/m)
  })

  it('cambios no usa acciones de terceros (solo actions/*)', () => {
    for (const { action } of usesOf(cambios)) expect(action).toMatch(/^actions\//)
  })

  it('windows necesita a cambios y se salta si no hay código', () => {
    expect(needsOf(windows)).toContain('cambios')
    expect(jobField(windows, 'if')).toContain('needs.cambios.outputs.codigo')
  })

  it('windows ejecuta npm run check y npm run test:e2e (completo) sin excluir las PR', () => {
    for (const command of ['npm run check', 'npm run test:e2e']) {
      const index = indexOfRun(steps, command)
      expect(index, command).toBeGreaterThanOrEqual(0)
      expect(excludesPullRequest(stripExpression(steps[index]?.fields.if))).toBe(false)
    }
  })

  it('windows no usa los e2e afectados', () => {
    expect(windows).not.toMatch(/test:e2e:affected/)
  })

  it('npm run dist:win no se ejecuta en pull_request (sí en el push a main)', () => {
    const index = indexOfRun(steps, 'npm run dist:win')
    expect(index, 'paso npm run dist:win').toBeGreaterThanOrEqual(0)
    expect(excludesPullRequest(stripExpression(steps[index]?.fields.if))).toBe(true)
  })
})

describe('CA4 (0072): ci-ok («CI ok») siempre se ejecuta y falla si algún job falló', () => {
  const workflow = read(CI)
  const ciOk = jobBlock(workflow, 'ci-ok')
  const otherJobs = [
    ...(topBlock(workflow, 'jobs') ?? '').matchAll(/^ {2}['"]?([\w-]+)['"]?:\s*$/gm)
  ]
    .map((match) => match[1] ?? '')
    .filter((name) => name !== 'ci-ok')

  it('existe con el nombre visible «CI ok»', () => {
    expect(ciOk, 'job ci-ok').not.toBe('')
    expect(jobField(ciOk, 'name')).toBe('CI ok')
  })

  it('tiene if: always()', () => {
    expect(jobField(ciOk, 'if')).toBe('always()')
  })

  it('necesita a todos los demás jobs (cambios y windows)', () => {
    expect(otherJobs).toEqual(expect.arrayContaining(['cambios', 'windows']))
    expect([...needsOf(ciOk)].sort()).toEqual([...otherJobs].sort())
  })

  it('su comprobación mira el resultado de los needs y trata failure y cancelled como rojo', () => {
    const check = stepsOf(ciOk)
      .map((step) => `${step.fields.if ?? ''}\n${step.fields.run ?? ''}`)
      .join('\n')
    expect(check).toMatch(/needs/)
    expect(check).toMatch(/failure/)
    expect(check).toMatch(/cancelled/)
  })
})

describe('CA5 (0072): concurrencia que cancela en las PR y encola en main', () => {
  const concurrency = topBlock(read(CI), 'concurrency') ?? ''
  const cancel = stripExpression(
    scalar(/^\s+cancel-in-progress:\s*(.*)$/m.exec(concurrency)?.[1] ?? '')
  )

  it('el grupo es por PR o por rama', () => {
    expect(concurrency).toMatch(
      /group:.*(github\.ref|github\.head_ref|github\.event\.pull_request\.number)/
    )
  })

  it('cancel-in-progress es verdadero solo en pull_request (en el push a main, false)', () => {
    expect(cancel).toMatch(
      /^github\.event_name\s*==\s*'pull_request'$|^github\.event_name\s*!=\s*'push'$/
    )
  })
})
