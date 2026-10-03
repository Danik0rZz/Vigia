import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

/**
 * Ningún texto de interfaz escrito directamente en los componentes: la regla
 * de `eslint-plugin-i18next` está activa como error en el renderer y no
 * encuentra nada.
 */
const RULE = 'i18next/no-literal-string'

describe('regla de ESLint de textos sin traducir', () => {
  const eslint = new ESLint()

  it('está activa como error en los componentes del renderer', async () => {
    const config = (await eslint.calculateConfigForFile('src/renderer/src/main.tsx')) as {
      rules?: Record<string, unknown>
    }
    const entry = config.rules?.[RULE]
    const severity = Array.isArray(entry) ? entry[0] : entry
    expect(severity === 2 || severity === 'error', `${RULE} = ${JSON.stringify(entry)}`).toBe(true)
  })

  it('no encuentra textos sin traducir en el renderer', async () => {
    const results = await eslint.lintFiles(['src/renderer/src/**/*.{ts,tsx}'])
    const hits = results.flatMap((result) =>
      result.messages
        .filter((message) => message.ruleId === RULE)
        .map((message) => `${result.filePath}:${message.line} ${message.message}`)
    )
    expect(hits).toEqual([])
  }, 60_000)
})
