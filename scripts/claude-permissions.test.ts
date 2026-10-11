import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Tests de los permisos de `.claude/settings.json` (ficha 0082): que fusione por squash o rebase o
 * que borre la rama al fusionar queda negado en los permisos, en Bash y en PowerShell, sin negar el
 * flujo de hoy (`docs/flujo.md`, «Git»). El borrado de ramas remotas no va en los permisos (decisión
 * de Dani: `git push * :*` termina en `:*`, que Claude Code lee como prefijo); lo para el hook
 * `.githooks/pre-push` (`scripts/pre-push.test.ts`, CA4).
 *
 * El comparador es uno sencillo de comodines (`*` es cualquier texto, la regla entera tiene que
 * casar con la línea): no pretende imitar al de Claude Code, solo comprobar que las reglas están y
 * que ninguna es un prefijo que niegue lo permitido.
 */

const ROOT = join(__dirname, '..')

interface Settings {
  permissions: { allow: string[]; deny: string[] }
}

const settings = (): Settings =>
  JSON.parse(readFileSync(join(ROOT, '.claude/settings.json'), 'utf8')) as Settings

const SHELLS = ['Bash', 'PowerShell'] as const

/** Patrones (lo de dentro de `Shell(…)`) de las reglas `deny` de esa herramienta. */
function denyPatterns(shell: (typeof SHELLS)[number]): string[] {
  const prefix = `${shell}(`
  return settings()
    .permissions.deny.filter((rule) => rule.startsWith(prefix) && rule.endsWith(')'))
    .map((rule) => rule.slice(prefix.length, -1))
}

function matches(pattern: string, command: string): boolean {
  const source = pattern
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  return new RegExp(`^${source}$`, 's').test(command)
}

const deniedBy = (shell: (typeof SHELLS)[number], command: string): string[] =>
  denyPatterns(shell).filter((pattern) => matches(pattern, command))

// Fusiones que tienen que quedar negadas: cada opción, sola al final o seguida de otras.
const MERGE_FLAGS = ['--squash', '-s', '--rebase', '-r', '--delete-branch', '-d']
const DENIED_MERGES = MERGE_FLAGS.flatMap((flag) => [
  `gh pr merge 12 ${flag}`,
  `gh pr merge 12 ${flag} --admin`,
  `gh pr merge 12 --merge ${flag}`,
  // La opción delante del número, o sin número (la PR de la rama actual).
  `gh pr merge ${flag} 12`,
  `gh pr merge ${flag}`,
  `gh pr merge --merge ${flag} 12`
])

// El flujo de hoy: tiene que seguir permitido.
const ALLOWED = [
  'gh pr merge 12 --merge',
  'gh pr create --base main --head integra/20261011-1 --title "Integra" --body "Cuerpo"',
  'git push origin integra/20261011-1',
  'git push -u origin integra/20261011-1',
  'git push origin HEAD:integra/20261011-1',
  'git push origin main'
]

describe('CA1 (0082): deny niega las fusiones por squash o rebase y el borrado de la rama al fusionar, sin la regla git push * :*', () => {
  for (const shell of SHELLS) {
    for (const command of DENIED_MERGES) {
      it(`CA1 (0082): ${shell} niega «${command}»`, () => {
        expect(deniedBy(shell, command)).not.toEqual([])
      })
    }

    it(`CA1 (0082): ${shell} no tiene la regla «git push * :*»`, () => {
      expect(denyPatterns(shell)).not.toContain('git push * :*')
    })
  }
})

describe('CA2 (0082): ninguna regla de deny niega el flujo de hoy', () => {
  for (const shell of SHELLS) {
    for (const command of ALLOWED) {
      it(`CA2 (0082): ${shell} no niega «${command}»`, () => {
        expect(deniedBy(shell, command)).toEqual([])
      })
    }
  }
})

describe('CA4 (0088): deny niega los refspec +, --mirror, --prune y git -c con push, sin negar los push a integra/', () => {
  const RULES = ['git push * +*', 'git push * --mirror*', 'git push * --prune*', 'git -c *push*']
  const DENIED = [
    'git push origin +HEAD:integra/x',
    'git push origin +x:integra/y',
    'git push origin --mirror',
    'git push origin --prune',
    'git push origin --prune integra/x',
    'git -c core.hooksPath=/dev/null push origin integra/x'
  ]
  const STILL_ALLOWED = ['git push origin integra/x', 'git push -u origin integra/x']

  for (const shell of SHELLS) {
    for (const rule of RULES) {
      it(`CA4 (0088): ${shell} tiene la regla «${rule}»`, () => {
        expect(denyPatterns(shell)).toContain(rule)
      })
    }
    for (const command of DENIED) {
      it(`CA4 (0088): ${shell} niega «${command}»`, () => {
        expect(deniedBy(shell, command)).not.toEqual([])
      })
    }
    for (const command of STILL_ALLOWED) {
      it(`CA4 (0088): ${shell} no niega «${command}»`, () => {
        expect(deniedBy(shell, command)).toEqual([])
      })
    }
  }
})

describe('CA3 (0082): las reglas que ya había en deny y en allow siguen todas', () => {
  // Las reglas de antes de la ficha 0082 (`.claude/settings.json` del 2026-10-11).
  const PREVIOUS_ALLOW = [
    'Bash(npm run check)',
    'Bash(npm run lint)',
    'Bash(npm run typecheck)',
    'Bash(npm run format:check)',
    'Bash(npm run test:e2e:affected *)',
    'Bash(npm run scan:tenant)',
    'Bash(npx vitest *)',
    'Bash(git status *)',
    'Bash(git diff *)',
    'Bash(git log *)',
    'Bash(git show *)',
    'Bash(git worktree list *)',
    'Bash(node scripts/notify-telegram.mjs *)',
    'PowerShell(npm run check)',
    'PowerShell(npm run test:e2e:affected *)',
    'PowerShell(git status *)',
    'PowerShell(git diff *)',
    'PowerShell(git log *)',
    'PowerShell(git show *)',
    'PowerShell(node scripts/notify-telegram.mjs *)'
  ]
  const PREVIOUS_DENY_PATTERNS = [
    'git push --force *',
    'git push -f *',
    'git push --force-with-lease *',
    'git push * --force *',
    'git push * --force',
    'git push * -f *',
    'git push * -f',
    'git push * --force-with-lease*',
    'git push * --tags*',
    'git push * --delete *',
    'git tag *',
    'gh release *',
    '* --no-verify*'
  ]
  const PREVIOUS_DENY = [
    ...SHELLS.flatMap((shell) => PREVIOUS_DENY_PATTERNS.map((pattern) => `${shell}(${pattern})`)),
    'Read(./.env*)',
    'Read(**/.env.live.local)'
  ]

  it('CA3 (0082): allow conserva todas las reglas de antes', () => {
    expect(settings().permissions.allow).toEqual(expect.arrayContaining(PREVIOUS_ALLOW))
  })

  it('CA3 (0082): deny conserva todas las reglas de antes', () => {
    expect(settings().permissions.deny).toEqual(expect.arrayContaining(PREVIOUS_DENY))
  })
})

describe('CA3 (0090): la fusión atada al commit (--match-head-commit) no la niega ninguna regla de deny', () => {
  for (const shell of SHELLS) {
    it(`CA3 (0090): ${shell} no niega «gh pr merge 12 --merge --match-head-commit abc123»`, () => {
      expect(deniedBy(shell, 'gh pr merge 12 --merge --match-head-commit abc123')).toEqual([])
    })

    for (const flag of ['--squash', '--rebase', '--delete-branch']) {
      it(`CA3 (0090): ${shell} sigue negando «gh pr merge 12 ${flag} --match-head-commit abc123»`, () => {
        expect(deniedBy(shell, `gh pr merge 12 ${flag} --match-head-commit abc123`)).not.toEqual([])
      })
    }
  }
})
