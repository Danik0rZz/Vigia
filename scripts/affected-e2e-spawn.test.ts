import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

/**
 * Reapertura de la ficha 0071: en Windows, `test:e2e:affected` lanzaba los comandos con
 * `shell: true`, y cmd tomaba el `|` del `--grep` de zonas (`(?:@servicio|@smoke)`) como una
 * tubería. Contrato: `invocation(command, args, resolveBin?)` traduce cada paso del plan
 * (`npx <bin> …`) a `{ file, args, shell: false }`: el ejecutable de node con el .js del binario
 * local y los argumentos tal cual, sin pasar por ninguna shell. `resolveBin(nombre)` da la ruta
 * del .js (por defecto, el de `node_modules`).
 */

type Command = { command: string; args: string[] }
type Invocation = { file: string; args: string[]; shell: false }

const require = createRequire(import.meta.url)
const { invocation, localBin, parseArgs, plan } = require(join(__dirname, 'affected-e2e.cjs')) as {
  invocation: (command: string, args: string[], resolveBin?: (name: string) => string) => Invocation
  localBin: (name: string) => string
  parseArgs: (argv: string[]) => Record<string, unknown>
  plan: (
    decision: unknown,
    options: unknown,
    env: { outExists: boolean }
  ) => { commands: Command[] }
}

/** Patrones que una shell (cmd o sh) interpretaría si no fueran como argumento suelto. */
const NASTY = [
  '(0071)|(0080)',
  'a^b',
  'a & echo pwned',
  'a > salida.txt',
  'a < entrada.txt',
  '%PATH%',
  '"comillas" y \'simples\'',
  '$HOME `x`'
]

const LOCALES_ONLY = {
  mode: 'some',
  specs: ['e2e/smoke.spec.ts', 'e2e/views-servicio.spec.ts'],
  grepTags: ['@servicio', '@smoke'],
  textUnits: true,
  reasons: []
}

const dir = mkdtempSync(join(tmpdir(), 'vigia-affected-spawn-'))
const echo = join(dir, 'echo-argv.cjs')
writeFileSync(echo, 'process.stdout.write(JSON.stringify(process.argv.slice(2)))\n')
afterAll(() => rmSync(dir, { recursive: true, force: true }))

function runEcho(command: Command): string[] {
  const inv = invocation(command.command, command.args, () => echo)
  const result = spawnSync(inv.file, inv.args, { shell: inv.shell, encoding: 'utf8' })
  expect(result.status).toBe(0)
  return JSON.parse(result.stdout) as string[]
}

describe('reapertura (0071): los pasos del plan no pasan por una shell', () => {
  it('cada paso se lanza con node y el .js del binario, sin shell', () => {
    const steps = plan(LOCALES_ONLY, parseArgs([]), { outExists: false }).commands
    expect(steps.length).toBeGreaterThan(0)
    for (const step of steps) {
      const inv = invocation(step.command, step.args)
      expect(inv.shell).toBe(false)
      expect(inv.file).toBe(process.execPath)
      expect(inv.args[0]).toMatch(/\.(c|m)?js$/)
      expect(existsSync(inv.args[0] as string)).toBe(true)
      expect(inv.args.slice(1)).toEqual(step.args.slice(1))
    }
  })

  it('el --grep de zonas llega a Playwright entero, con su |', () => {
    const steps = plan(LOCALES_ONLY, parseArgs([]), { outExists: true }).commands
    const playwright = steps.find((c) => c.args[0] === 'playwright') as Command
    const received = runEcho(playwright)
    expect(received).toEqual(playwright.args.slice(1))
    expect(received[received.indexOf('--grep') + 1]).toContain('|')
  })

  it.each(NASTY)('un -g del usuario con caracteres de shell llega intacto: %s', (pattern) => {
    for (const decision of [LOCALES_ONLY, { mode: 'all', specs: [], reasons: [] }]) {
      const steps = plan(decision, parseArgs(['--no-build', '-g', pattern]), {
        outExists: true
      }).commands
      const playwright = steps.find((c) => c.args[0] === 'playwright') as Command
      expect(runEcho(playwright)).toEqual(playwright.args.slice(1))
    }
  })

  it('localBin encuentra los binarios que usa el plan', () => {
    for (const name of ['playwright', 'electron-vite', 'vitest']) {
      expect(existsSync(localBin(name))).toBe(true)
    }
  })

  it('un comando que no es npx se lanza tal cual, también sin shell', () => {
    const inv = invocation('git', ['log', 'a|b'])
    expect(inv).toEqual({ file: 'git', args: ['log', 'a|b'], shell: false })
  })
})
