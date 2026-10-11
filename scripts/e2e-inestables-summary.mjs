// Resumen de los e2e en cuarentena (ficha 0075) para el job del CI.
//
// Uso (en el CI, tras `npm run test:e2e:inestables` con el reporter json):
//   node scripts/e2e-inestables-summary.mjs <informe.json>
//
// Lee el informe JSON de Playwright del proyecto `inestables` y añade al resumen del job
// (`$GITHUB_STEP_SUMMARY`) cuántos pasaron y fallaron, con el título y la ficha de arreglo (la
// anotación `arreglo`) de cada uno que falló. Sale con 1 si alguno falló o si no hay informe, para
// que el paso se vea en rojo; el paso lleva `continue-on-error: true`, así que no bloquea.
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

/** Tipo de la anotación con el número de la ficha que arregla el test (la misma que la guarda). */
const FIX_ANNOTATION = 'arreglo'

/**
 * Pura: recorre el informe y cuenta los tests por resultado. `expected` pasó, `unexpected` falló;
 * `skipped` no cuenta en ninguno (y `flaky` no sale, porque no hay reintentos).
 * @param {any} report informe JSON de Playwright
 * @returns {{ passed: number, failed: number, skipped: number,
 *   failures: { title: string, file: string, task: string | null }[], errors: string[] }}
 */
export function summarize(report) {
  const result = { passed: 0, failed: 0, skipped: 0, failures: [], errors: [] }
  const visit = (suite, path) => {
    const titles = suite.title && suite.title !== suite.file ? [...path, suite.title] : path
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        if (test.status === 'expected') result.passed++
        else if (test.status === 'skipped') result.skipped++
        else {
          result.failed++
          const fix = (test.annotations ?? []).find(({ type }) => type === FIX_ANNOTATION)
          result.failures.push({
            title: [...titles, spec.title].join(' › '),
            file: spec.file ?? suite.file ?? '',
            task: fix?.description?.trim() || null
          })
        }
      }
    }
    for (const child of suite.suites ?? []) visit(child, titles)
  }
  for (const suite of report?.suites ?? []) visit(suite, [])
  for (const error of report?.errors ?? []) {
    result.errors.push(String(error?.message ?? error).split(/\r?\n/)[0] ?? '')
  }
  return result
}

/** Pura: el Markdown del resumen del job. */
export function markdown(summary) {
  const lines = [
    '## e2e en cuarentena (@inestable)',
    '',
    `Pasaron ${summary.passed} y fallaron ${summary.failed}` +
      (summary.skipped > 0 ? ` (${summary.skipped} saltados)` : '') +
      '. No bloquean: «CI ok» no depende de este paso.'
  ]
  if (summary.failures.length > 0) {
    lines.push('', 'Fallaron:', '')
    for (const { title, file, task } of summary.failures) {
      lines.push(`- ${file}: ${title} (ficha ${task ?? 'sin anotación arreglo'})`)
    }
  }
  if (summary.errors.length > 0) {
    lines.push('', 'Errores de Playwright:', '')
    for (const error of summary.errors) lines.push(`- ${error}`)
  }
  return `${lines.join('\n')}\n`
}

/** Escribe el resumen y devuelve el código de salida (0 si nada falló). */
export function main({ argv, env, readFile, fileExists, appendSummary, stdout }) {
  const path = argv[0]
  if (path === undefined || !fileExists(path)) {
    const text =
      '## e2e en cuarentena (@inestable)\n\nNo hay informe de Playwright: el paso no llegó a lanzar los tests.\n'
    if (env.GITHUB_STEP_SUMMARY) appendSummary(env.GITHUB_STEP_SUMMARY, text)
    stdout(text)
    return 1
  }
  const summary = summarize(JSON.parse(readFile(path)))
  const text = markdown(summary)
  if (env.GITHUB_STEP_SUMMARY) appendSummary(env.GITHUB_STEP_SUMMARY, text)
  stdout(text)
  return summary.failed > 0 || summary.errors.length > 0 ? 1 : 0
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main({
    argv: process.argv.slice(2),
    env: process.env,
    readFile: (path) => readFileSync(path, 'utf8'),
    fileExists: existsSync,
    appendSummary: (path, text) => appendFileSync(path, text),
    stdout: (message) => process.stdout.write(message)
  })
}
