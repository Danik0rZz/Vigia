import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

/** Ficha 0075: el resumen de los e2e en cuarentena que escribe el CI (el developer). */

interface Summary {
  passed: number
  failed: number
  skipped: number
  failures: { title: string; file: string; task: string | null }[]
  errors: string[]
}

interface Deps {
  argv: string[]
  env: Record<string, string | undefined>
  readFile: (path: string) => string
  fileExists: (path: string) => boolean
  appendSummary: (path: string, text: string) => void
  stdout: (message: string) => void
}

const { summarize, markdown, main } = (await import(
  pathToFileURL(join(__dirname, 'e2e-inestables-summary.mjs')).href
)) as {
  summarize: (report: unknown) => Summary
  markdown: (summary: Summary) => string
  main: (deps: Deps) => number
}

/** Un informe con la forma del reporter json de Playwright: suites anidadas, specs y tests. */
const REPORT = {
  suites: [
    {
      title: 'tenants.spec.ts',
      file: 'tenants.spec.ts',
      specs: [
        {
          title: 'CA1 (0010): guarda',
          file: 'tenants.spec.ts',
          tests: [{ status: 'expected', annotations: [{ type: 'arreglo', description: '0901' }] }]
        }
      ],
      suites: [
        {
          title: 'grupo',
          file: 'tenants.spec.ts',
          specs: [
            {
              title: 'CA2 (0010): borra',
              file: 'tenants.spec.ts',
              tests: [
                {
                  status: 'unexpected',
                  annotations: [
                    { type: 'nota', description: 'x' },
                    { type: 'arreglo', description: ' 0902 ' }
                  ]
                }
              ]
            },
            {
              title: 'CA3 (0010): sin anotación',
              file: 'tenants.spec.ts',
              tests: [{ status: 'unexpected', annotations: [] }]
            },
            {
              title: 'CA4 (0010): saltado',
              file: 'tenants.spec.ts',
              tests: [{ status: 'skipped' }]
            }
          ]
        }
      ]
    }
  ],
  errors: []
}

function deps(argv: string[], files: Record<string, string>): Deps & { written: string[] } {
  const written: string[] = []
  return {
    argv,
    env: { GITHUB_STEP_SUMMARY: 'summary.md' },
    readFile: (path) => files[path] ?? '',
    fileExists: (path) => path in files,
    appendSummary: (_path, text) => written.push(text),
    stdout: () => undefined,
    written
  }
}

describe('e2e-inestables-summary.mjs', () => {
  it('cuenta pasados, fallados y saltados, con el título completo y la ficha de cada fallo', () => {
    const summary = summarize(REPORT)
    expect([summary.passed, summary.failed, summary.skipped]).toEqual([1, 2, 1])
    expect(summary.failures).toEqual([
      { title: 'grupo › CA2 (0010): borra', file: 'tenants.spec.ts', task: '0902' },
      { title: 'grupo › CA3 (0010): sin anotación', file: 'tenants.spec.ts', task: null }
    ])
  })

  it('el Markdown dice los números y cada fallo con su ficha', () => {
    const text = markdown(summarize(REPORT))
    expect(text).toContain('Pasaron 1 y fallaron 2 (1 saltados)')
    expect(text).toContain('- tenants.spec.ts: grupo › CA2 (0010): borra (ficha 0902)')
    expect(text).toContain('(ficha sin anotación arreglo)')
  })

  it('main escribe en GITHUB_STEP_SUMMARY y sale con 1 si alguno falló', () => {
    const d = deps(['r.json'], { 'r.json': JSON.stringify(REPORT) })
    expect(main(d)).toBe(1)
    expect(d.written.join('')).toContain('fallaron 2')
  })

  it('main sale con 0 si todos pasaron o no hay ninguno en cuarentena', () => {
    const d = deps(['r.json'], { 'r.json': JSON.stringify({ suites: [], errors: [] }) })
    expect(main(d)).toBe(0)
    expect(d.written.join('')).toContain('Pasaron 0 y fallaron 0')
  })

  it('main sale con 1 si Playwright dio errores fuera de los tests', () => {
    const report = { suites: [], errors: [{ message: 'Error: no carga\n  en la línea 3' }] }
    const d = deps(['r.json'], { 'r.json': JSON.stringify(report) })
    expect(main(d)).toBe(1)
    expect(d.written.join('')).toContain('- Error: no carga\n')
  })

  it('main sale con 1 y lo dice en el resumen si no hay informe', () => {
    const d = deps(['r.json'], {})
    expect(main(d)).toBe(1)
    expect(d.written.join('')).toContain('No hay informe de Playwright')
  })
})
